/**
 * lib/aiBilling.js — the metered chat-completion wrapper, extracted from
 * aiModel.js. Charging is centralised here so no call site double-charges:
 * the payer comes from __userId or the request context, an empty wallet is a
 * hard block, and the completion's real usage is debited once.
 */

import { aiContext } from "./aiContext.js";
import { chargeForAI, coinsAvailable, InsufficientCoins } from "./coins.js";
import { AI_DEFAULT_MAX_TOKENS, cachedTokensOf, reportedCostUsd, usdCost } from "./aiPricing.js";
import { errorKindOf, recordAiCall } from "./aiTelemetry.js";
import { forcedModelFor, modelRegistry } from "./modelRegistry.js";
import { jsonRetryInstruction, readStructured, validateShape } from "./structuredOutput.js";

/**
 * Build meteredCreate (and its stream helpers) from the router's moving parts:
 * the chat breaker, the provider adapters, the request-context overrides and
 * the failover/refusal helpers aiModel exports.
 */
export function createMetering({
  OPENAI_MODEL, adapters, chatBreaker, fallbackLadder, getOverrides,
  refusalFallbackFor, refusalOf, retryableFailure, ROLES,
}) {
  /**
   * Metered chat completion. The acting user comes from (in order): explicit
   * __userId on the params, else the AsyncLocalStorage request context. When a
   * user is resolved we HARD-BLOCK on an empty balance and debit the wallet by
   * the completion's real token usage × markup. No user (system/cron) → plain
   * call, unbilled. Charging is centralised HERE so no call site double-charges.
   */
  async function meteredCreate(params = {}) {
    const store   = aiContext.getStore() || {};
    // __payer: "platform" — the app pays (e.g. Sergeant judging a battle), whoever's request it runs in.
    const platform = params.__payer === "platform";
    const userId  = platform ? null : params.__userId  ?? store.userId  ?? null;
    const feature = params.__feature ?? store.feature ?? "ai";
    const ref     = params.__ref     ?? null;
    const billTo  = platform ? null : params.__billTo  ?? store.billTo  ?? null;   // e.g. school funds it
    let clean = { ...params };
    delete clean.__userId; delete clean.__feature; delete clean.__ref; delete clean.__billTo; delete clean.__payer;
    delete clean.__timeoutMs; delete clean.__maxRetries;
    delete clean.__role; delete clean.__learnerChoice; delete clean.__allowedModels;
    // Which model (§7.11.3): the caller's own `model`, else resolved from the
    // role and the learner's choice. Either way the catalogue says who serves it.
    // A call site's own model is its default: a learner's pick that resolves
    // for the call's role (never a locked one) still wins (Scenario K).
    const picked = clean.model && params.__learnerChoice
      ? modelRegistry.resolve({ role: params.__role || "chat", learnerChoice: params.__learnerChoice, allowedModels: params.__allowedModels || null })
      : null;
    let entry = picked?.source === "learner" ? picked.model : clean.model
      ? (modelRegistry.get(clean.model) || modelRegistry.catalogue.find((e) => e.apiModel === clean.model) || null)
      : modelRegistry.resolveModel({ role: params.__role || "chat", learnerChoice: params.__learnerChoice || null, allowedModels: params.__allowedModels || null });
    // AI_FORCE_MODEL (a test sandbox switch, e.g. OpenAI out of credit): every
    // chat call that would go to OpenAI is served by this catalogue model instead.
    // A check's stand-in providers can ask to see the unforced choice (`noForce`).
    const overrides = getOverrides() || null;
    const forced = overrides?.noForce ? null : forcedModelFor(entry, clean.model);
    if (forced) entry = forced;
    if (entry) clean.model = entry.apiModel;
    const serve = (e, body, opts) => {
      const provider = e?.provider || "openai";
      // A stand-in for the OpenAI shape also serves the OpenCode transport (both
      // are chat-completions) — the golden-path and contract tests run keyless.
      const stub = overrides?.[provider] || (provider === "opencode" ? overrides?.openai : null);
      if (stub) return stub.create(body, opts, e);
      return provider !== "openai" && adapters[provider] ? adapters[provider].create(body, opts, e) : chatBreaker.fire(body, opts);
    };
    const fire = (body, opts) => serve(entry, body, opts);
    // Per-call SDK bounds (`__timeoutMs` / `__maxRetries`). The SDK's defaults
    // are a 10-MINUTE timeout with 2 retries — a single stalled provider call
    // once hung a chat turn for minutes while the browser had long given up.
    // Only calls that opt in are bounded; long streams elsewhere keep the
    // SDK defaults.
    // Read from `params`: `clean` has already had them removed above.
    const reqOpts = (params.__timeoutMs != null || params.__maxRetries != null)
      ? {
          ...(params.__timeoutMs != null ? { timeout: params.__timeoutMs } : {}),
          ...(params.__maxRetries != null ? { maxRetries: params.__maxRetries } : {}),
        }
      : undefined;
    // Cost guardrail: bound output when a caller omits max_tokens (0 = off).
    if (AI_DEFAULT_MAX_TOKENS > 0 && clean.max_tokens == null && clean.max_completion_tokens == null) {
      clean.max_tokens = AI_DEFAULT_MAX_TOKENS;
    }

    const bills = Boolean(userId || billTo);
    if (bills) {
      const { ok, total } = await coinsAvailable({ userId, billTo, min: 1 });
      if (!ok) throw new InsufficientCoins(1, total);
    }

    // Billed and recorded under the catalogue id, priced at its own rate.
    const model = entry?.id || clean.model || OPENAI_MODEL;
    const charge = (usage, m = entry?.id || model) => chargeForAI({
      userId, feature, model: m, usage, ref, billTo,
      // Decision A: bill the provider's reported cost when it gives one,
      // unless AI_BILL_PROVIDER_COST is switched off (static price wins).
      costUsd: process.env.AI_BILL_PROVIDER_COST === "false" ? null : reportedCostUsd(usage),
    }).catch((e) => { if (!(e instanceof InsufficientCoins)) console.warn("[coins] charge failed:", e.message); });

    // Every call is TIMED, whether or not it is billed. Cost and tokens used to
    // be recorded only by the wallet debit, so a system or cron call — no payer,
    // no debit — left no trace at all, and latency was recorded nowhere.
    const started = Date.now();
    const report = (usage, { ttfbMs = null, streamed = false, ok = true, errorKind = null, as = entry?.id || model } = {}) => {
      const tokensIn  = usage?.prompt_tokens ?? 0;
      const tokensOut = usage?.completion_tokens ?? 0;
      const cachedIn  = usage ? cachedTokensOf(usage) : 0;
      const entryFor = modelRegistry.get(as) || entry;
      const oc = usage?.opencode || {};
      const providerCost = reportedCostUsd(usage);
      recordAiCall({
        feature, model: as, ms: Date.now() - started, ttfbMs,
        tokensIn, tokensOut, cachedIn,
        costUsd: providerCost ?? (usage ? usdCost(as, tokensIn, tokensOut, cachedIn) : null),
        userId, ref, streamed, ok, errorKind,
        provider: entryFor?.provider || null,
        lane: entryFor?.lane || null,
        billingSource: oc.billing_source ?? null,
        providerCostUsd: providerCost,
        listCostUsd: oc.list_cost ?? null,
        allowanceUsd: oc.allowance ?? null,
        cacheRead: usage?.prompt_tokens_details?.cached_tokens ?? oc.cache_read ?? null,
        cacheWrite: oc.cache_write ?? null,
      });
    };

    // Streamed calls: ask OpenAI for exact usage in a final chunk, then tee it
    // out of the stream and charge when iteration completes. Falls back to an
    // estimate if no usage chunk arrives (e.g. early abort).
    if (clean.stream) {
      let source;
      try {
        source = await fire({
          ...clean,
          ...(bills ? { stream_options: { include_usage: true, ...(clean.stream_options || {}) } } : {}),
        }, reqOpts);
      } catch (e) {
        report(null, { streamed: true, ok: false, errorKind: errorKindOf(e) });
        const ladder = entry && retryableFailure(e) ? fallbackLadder(entry, { role: params.__role || "chat", ROLES }) : [];
        let lastError = e;
        let started = false;
        for (const target of ladder) {
          console.warn(`[ai] ${entry.id} failed (${errorKindOf(e)}) — streaming from ${target.id}`);
          try {
            source = await serve(target, {
              ...clean, model: target.apiModel,
              ...(bills ? { stream_options: { include_usage: true, ...(clean.stream_options || {}) } } : {}),
            }, reqOpts);
            entry = target;
            started = true;
            break;
          } catch (e2) {
            lastError = e2;
            report(null, { streamed: true, ok: false, errorKind: errorKindOf(e2), as: target.id });
          }
        }
        if (!started) throw lastError;
      }

      // A transport failure can also land AFTER the stream has opened — a
      // gateway cutting a quota-exhausted stream, a dropped socket. That error
      // surfaces mid-iteration, past the ladder above, and used to kill the
      // reply outright ("connection dropped"). Until any content has flowed
      // the reply can still be restarted on the next ladder model; once text
      // is out, restarting would duplicate it, so the error stands.
      const restartable = (async function* (first) {
        let current = first;
        let sawContent = false;
        for (;;) {
          try {
            for await (const chunk of current) {
              if (chunk?.choices?.[0]?.delta?.content) sawContent = true;
              yield chunk;
            }
            return;
          } catch (e) {
            if (sawContent) throw e;
            const ladder = entry && retryableFailure(e) ? fallbackLadder(entry, { role: params.__role || "chat", ROLES }) : [];
            if (!ladder.length) throw e;
            report(null, { streamed: true, ok: false, errorKind: errorKindOf(e) });
            let hopped = false;
            for (const target of ladder) {
              console.warn(`[ai] ${entry.id} stream cut (${errorKindOf(e)}) — restarting on ${target.id}`);
              try {
                current = await serve(target, {
                  ...clean, model: target.apiModel,
                  ...(bills ? { stream_options: { include_usage: true, ...(clean.stream_options || {}) } } : {}),
                }, reqOpts);
                entry = target;
                hopped = true;
                break;
              } catch (e2) {
                report(null, { streamed: true, ok: false, errorKind: errorKindOf(e2), as: target.id });
              }
            }
            if (!hopped) throw e;
          }
        }
      })(source);
      if (source?.controller) restartable.controller = source.controller;
      source = restartable;

      const fallback = { prompt_tokens: estimateTokens(clean.messages), completion_tokens: Math.min(clean.max_tokens || 700, 700) };
      const metered = meterStreamUsage(source, (usage, ttfbMs) => {
        // Time to FIRST chunk is the number a user feels; total is what the bill
        // is made of. Kept apart, because averaging them hides the difference.
        report(usage || (bills ? fallback : null), { ttfbMs, streamed: true });
        if (bills) charge(usage || fallback);
      });
      if (!entry) return metered;
      // A streamed refusal (§7.11.4): refused before any text → the fallback model's stream
      // takes over (billed at its own price); refused mid-reply → it ends with the marker.
      return withStreamRefusal(metered, {
        entry,
        target: () => refusalFallbackFor(entry, { noForce: !!overrides?.noForce, role: params.__role || "chat", ROLES }),
        second: async (target) => meterStreamUsage(
          await serve(target, { ...clean, model: target.apiModel, ...(bills ? { stream_options: { include_usage: true, ...(clean.stream_options || {}) } } : {}) }, reqOpts),
          (usage, ttfbMs) => { report(usage || (bills ? fallback : null), { ttfbMs, streamed: true, as: target.id }); if (bills) charge(usage || fallback, target.id); }),
      });
    }

    // Structured output: for OpenCode/compatible models a forced tool call is far
    // more reliable than response_format (DeepSeek often answered complex schemas
    // in prose). The schema becomes the tool's parameters; its arguments are the
    // consumer's JSON. Other providers keep response_format.
    const jsonRequest = !clean.stream && clean.response_format?.type === "json_schema" && clean.response_format.json_schema?.schema
      ? clean.response_format.json_schema.schema : null;
    const forceTool = !!(jsonRequest && !clean.tools && entry?.caps?.tools
      && ["opencode", "openai_compatible"].includes(entry.provider));
    if (forceTool) {
      clean = {
        ...clean,
        tools: [{ type: "function", function: {
          name: "submit_result",
          description: "Submit the final answer as a JSON object that matches the schema.",
          parameters: jsonRequest,
        } }],
        tool_choice: "required",
      };
      delete clean.response_format;
    }
    const extractStructured = (r) => {
      if (!forceTool || !r?.choices?.[0]?.message) return r;
      const msg = r.choices[0].message;
      const call = (msg.tool_calls || []).find((c) => c?.function?.name === "submit_result");
      if (call?.function?.arguments) msg.content = call.function.arguments;
      return r;
    };
    const normalizeStructured = (r) => {
      if (!jsonRequest || !r?.choices?.[0]?.message) return r;
      extractStructured(r);
      const out = readStructured(r.choices[0].message.content, jsonRequest);
      if (out.value != null) r.choices[0].message.content = JSON.stringify(out.value);
      return r;
    };

    let res;
    let resBilled = false;
    const bill = (r) => {
      if (!r || resBilled) return;
      resBilled = true;
      report(r?.usage ?? null);
      if (bills && r?.usage) charge(r.usage);
    };
    try {
      res = extractStructured(await fire(clean, reqOpts));
    } catch (e) {
      report(null, { ok: false, errorKind: errorKindOf(e) });
      const ladder = entry && retryableFailure(e) ? fallbackLadder(entry, { role: params.__role || "chat", ROLES }) : [];
      if (!ladder.length) throw e;
      const tried = [];
      let lastError = e;
      for (const target of ladder) {
        tried.push(target.id);
        console.warn(`[ai] ${entry.id} failed (${errorKindOf(e)}) — trying ${target.id} (${tried.length}/${ladder.length})`);
        try {
          const second = normalizeStructured(await serve(target, { ...clean, model: target.apiModel }, reqOpts));
          report(second?.usage ?? null, { as: target.id });
          if (bills && second?.usage) charge(second.usage, target.id);
          return Object.assign(second || {}, {
            model_fallback: { model: entry.id, fallbackModel: target.id, tried, reason: errorKindOf(e) },
          });
        } catch (e2) {
          lastError = e2;
          report(null, { ok: false, errorKind: errorKindOf(e2), as: target.id });
        }
      }
      throw lastError;
    }

    // A json_schema reply is normalised for EVERY consumer: parse the body, a
    // fence or an embedded object; if the required shape is unusable, retry once
    // and hand back valid JSON. No feature has to parse model JSON on its own.
    if (jsonRequest) {
      const first = readStructured(res?.choices?.[0]?.message?.content, jsonRequest);
      if (first.ok) {
        res.choices[0].message.content = JSON.stringify(first.value);
      } else {
        bill(res);
        const msg0 = res?.choices?.[0]?.message || {};
        const calls0 = (msg0.tool_calls || []).map((c) => ({ name: c?.function?.name, args: String(c?.function?.arguments || "").slice(0, 120) }));
        const finish0 = res?.choices?.[0]?.finish_reason || null;
        console.warn(`[ai:json] retry ${feature} on ${entry?.id || model} (${first.errors[0] || "bad JSON"}) forced=${forceTool} finish=${finish0} calls=${JSON.stringify(calls0)} content=${JSON.stringify(String(msg0.content || "").slice(0, 120))}`);
        try {
          const retryMessages = [...(clean.messages || []), {
            role: "system",
            content: forceTool
              ? `Your previous submit_result was missing or invalid (${first.errors[0] || "bad JSON"}). Call submit_result again with ONLY a JSON object matching this schema:\n${JSON.stringify(jsonRequest)}`
              : jsonRetryInstruction(jsonRequest, first.errors),
          }];
          // A reasoning model can spend the whole completion budget on thinking
          // and truncate the JSON (finish_reason "length"). Give the retry room.
          const limitHit = finish0 === "length";
          const currentMax = Number(clean.max_tokens || clean.max_completion_tokens || 800);
          const bumped = limitHit ? Math.min(4000, Math.round(currentMax * 1.6)) : null;
          const second = extractStructured(await fire({
            ...clean,
            ...(forceTool ? {} : { response_format: { type: "json_object" } }),
            ...(limitHit ? (clean.max_tokens ? { max_tokens: bumped } : { max_completion_tokens: bumped }) : {}),
            messages: retryMessages,
          }, reqOpts));
          const retried = readStructured(second?.choices?.[0]?.message?.content, jsonRequest);
          if (second?.choices?.[0]?.message) {
            if (!retried.ok) {
              const unparseable = retried.value == null;
              // Even after structural repair, an unresolvable shape (bad type,
              // enum, required object) is an honest failure. Missing fields that
              // repair can fill are logged/attached; AI_STRUCTURED_STRICT=true
              // turns those into failures too (fail-closed deployments).
              const repairedErrors = unparseable ? retried.errors : validateShape(retried.value, jsonRequest);
              if (unparseable || repairedErrors.length || process.env.AI_STRUCTURED_STRICT === "true") {
                const err = Object.assign(new Error(`${entry?.id || model}: structured output invalid after retry (${retried.errors.slice(0, 2).join("; ")})`),
                  { status: 502, code: "structured_output_invalid", errors: retried.errors });
                throw err;
              }
              console.warn(`[ai:json] schema_mismatch ${feature} on ${entry?.id || model}: ${retried.errors.slice(0, 3).join("; ")}`);
              Object.defineProperty(second, "__structured_errors", { value: retried.errors, enumerable: false, configurable: true });
            }
            second.choices[0].message.content = JSON.stringify(retried.value ?? {});
            res = second;
            resBilled = false;
          }
        } catch (retryError) {
          if (retryError?.code === "structured_output_invalid") throw retryError;
          report(null, { ok: false, errorKind: errorKindOf(retryError) });
        }
      }
    }
    bill(res);

    // A refusal is not a crash (§7.11.4): the refused call is billed as it ran,
    // then the same request goes once to the fallback model (the entry's
    // fallbackModel, else the default). The answer carries `model_refusal` so
    // an agent loop records a model_refusal observation, never a malformed one.
    const refused = entry ? refusalOf(res) : null;
    if (refused) {
      const target = refusalFallbackFor(entry, { noForce: !!overrides?.noForce, role: params.__role || "chat", ROLES });
      const note = { model: entry.id, reason: refused.reason, category: refused.category, fallbackModel: target?.id || null };
      console.warn(`[ai] model_refusal on ${entry.id} (${feature})${target ? ` — retrying on ${target.id}` : ""}`);
      if (!target) return Object.assign(res, { model_refusal: note });
      let second;
      try {
        second = await serve(target, { ...clean, model: target.apiModel }, reqOpts);
      } catch (e) {
        report(null, { ok: false, errorKind: errorKindOf(e), as: target.id });
        return Object.assign(res, { model_refusal: { ...note, fallbackError: String(e?.message || e).slice(0, 200) } });
      }
      report(second?.usage ?? null, { as: target.id });
      if (bills && second?.usage) charge(second.usage, target.id);
      return Object.assign(second || {}, { model_refusal: note });
    }
    return res;
  }

  // Passthrough async iterable that captures the stream's final usage chunk and
  // charges once iteration ends. Forwards `.controller` for barge-in/abort.
  function meterStreamUsage(source, onDone) {
    let usage = null;
    let ttfbMs = null;
    const t0 = Date.now();
    const gen = (async function* () {
      try {
        for await (const chunk of source) {
          // First chunk with actual content — a leading role-only delta is not
          // the moment anything appears on screen.
          if (ttfbMs == null && chunk?.choices?.[0]?.delta?.content) ttfbMs = Date.now() - t0;
          if (chunk?.usage) usage = chunk.usage;   // final include_usage chunk
          yield chunk;
        }
      } finally {
        try { onDone(usage, ttfbMs); } catch { /* billing must not break the stream */ }
      }
    })();
    if (source && source.controller) gen.controller = source.controller;
    return gen;
  }

  /**
   * A refused stream (finish_reason "content_filter"): yields a `{ choices: [],
   * model_refusal }` marker chunk; if nothing had been written yet, the fallback
   * model's stream follows in its place. Never throws past the caller's loop.
   */
  function withStreamRefusal(source, { entry, target, second }) {
    const gen = (async function* () {
      let wrote = false;
      for await (const chunk of source) {
        const choice = chunk?.choices?.[0];
        if (choice?.delta?.content) wrote = true;
        if (choice?.finish_reason !== "content_filter") { yield chunk; continue; }
        const to = !wrote ? target() : null;
        const note = { model: entry.id, reason: String(choice.delta?.refusal || "The model declined this request.").slice(0, 300), fallbackModel: to?.id || null, streamed: true, ...(wrote ? { partial: true } : {}) };
        console.warn(`[ai] model_refusal (stream) on ${entry.id}${to ? ` — continuing on ${to.id}` : ""}`);
        yield { choices: [], model_refusal: note };
        if (!to) { yield chunk; continue; }
        try { for await (const c of await second(to)) yield c; }
        catch (e) { yield { choices: [], model_refusal: { ...note, fallbackError: String(e?.message || e).slice(0, 200) } }; yield chunk; }
      }
    })();
    if (source && source.controller) gen.controller = source.controller;
    return gen;
  }

  // Rough token estimate for streamed prompts (~4 chars/token).
  function estimateTokens(messages) {
    try {
      const text = (messages || []).map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content || "")).join(" ");
      return Math.max(1, Math.ceil(text.length / 4));
    } catch { return 500; }
  }


  return { meteredCreate, withStreamRefusal, estimateTokens };
}
