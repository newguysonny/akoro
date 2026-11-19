/**
 * Scenario K (Grand Plan §7.11.5, §7.11.4, Phase 11) on a live server:
 *   models.pick_persisted              the chat's pick is saved on the thread and
 *                                       is the learner's pick on every device
 *   models.pick_reaches_workflows      a pick on a workflow is a model.changed event,
 *                                       a chat pick reaches open workflows, and the
 *                                       Study Prep / Teaching controller and persona
 *                                       calls carry it (the assessor doesn't)
 *   models.no_forced_tool_choice_claude a Claude model never gets a forced tool_choice
 *   models.refusal_fallback            a refusal becomes model_refusal + the fallback's answer
 *
 * The provider-level checks run the deployed code with a stand-in provider
 * (lib/aiModel.js runWithProviders — only the code inside it sees the
 * stand-in): a real model can't be made to refuse on demand, and a recorded
 * request body is the proof of what Claude would be sent.
 */

/** A model the tester may pick here: available, in their plan, not the default. → { id, label, provider } | null */
async function pickable(ctx, who, { prefer = null } = {}) {
  const r = await ctx.http({ as: who, path: "/api/adaptive/chat/models" });
  const models = (r.body?.models || []).filter((m) => m.available && !m.default);
  return models.find((m) => prefer && m.provider === prefer) || models[0] || null;
}

/** Undo what a pick wrote on the tester's open workflows (their model_selection and the model.changed rows). */
async function restoreWorkflows(ctx, db, me, since) {
  const before = new Map();
  const { data } = await db.schema("edu").from("workflow_instances").select("id, model_selection").eq("learner_id", me.id).not("status", "in", "(completed,abandoned,cancelled)");
  for (const w of data || []) before.set(w.id, w.model_selection || {});
  ctx.cleanup(async () => {
    for (const [id, sel] of before) await db.schema("edu").from("workflow_instances").update({ model_selection: sel }).eq("id", id).eq("learner_id", me.id);
    if (before.size) await db.schema("edu").from("workflow_events").delete().in("workflow_id", [...before.keys()]).eq("event_type", "model.changed").gte("created_at", since);
  });
  return before;
}

export const pickPersisted = {
  name: "models.pick_persisted", area: "chat", risk: "write",
  description: "Scenario K: the chat box's pick is saved on the chat thread (PUT/GET /chat/sessions/:id/model), GET /chat/models answers it as picker.saved for every device, the same pick twice is no change, an unknown model is refused.",
  params: { learner: { default: "@tester42" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { default: db } = await import("../../../db.js");
    const probe = await db.from("chat_sessions").select("model_selection").limit(1);
    if (probe.error) ctx.expect.blocked(`chat_sessions.model_selection not there yet (run 2026-chat-model-selection.sql): ${probe.error.message}`);
    const pick = await pickable(ctx, p.learner);
    if (!pick) ctx.expect.blocked("no model besides the default is set up and in this tester's plan here");
    await restoreWorkflows(ctx, db, me, new Date(Date.now() - 1000).toISOString());

    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} model pick` } });
    const chatId = made.body?.session?.id;
    if (!chatId) ctx.expect.blocked(`couldn't make a chat: ${made.status}`);
    ctx.cleanup(() => ctx.http({ as: p.learner, method: "DELETE", path: `/api/adaptive/chat/sessions/${chatId}` }));

    const saved = await ctx.http({ as: p.learner, method: "PUT", path: `/api/adaptive/chat/sessions/${chatId}/model`, body: { modelId: pick.id } });
    ctx.expect.status("the pick is saved", saved, 200);
    ctx.expect.eq("…as a change", saved.body?.changed, true);
    ctx.expect.eq("…resolved to the picked model", saved.body?.selection?.resolved, pick.id);
    const thread = await ctx.http({ as: p.learner, path: `/api/adaptive/chat/sessions/${chatId}/model` });
    ctx.expect.eq("the chat holds it", thread.body?.modelSelection?.modelId, pick.id);
    const [row] = await ctx.db.rows("chat_sessions", { id: chatId }, { columns: "model_selection", limit: 1 });
    ctx.expect.eq("…in chat_sessions.model_selection", row?.model_selection?.modelId, pick.id);

    // Another device: a fresh read of the model list opens on it.
    const models = await ctx.http({ as: p.learner, path: "/api/adaptive/chat/models" });
    ctx.expect.eq("GET /chat/models answers the saved pick", models.body?.picker?.saved?.modelId, pick.id);
    ctx.expect.eq("…from this chat", models.body?.picker?.saved?.conversationId, chatId);

    const again = await ctx.http({ as: p.learner, method: "PUT", path: `/api/adaptive/chat/sessions/${chatId}/model`, body: { modelId: pick.id } });
    ctx.expect.eq("the same pick again is no change", again.body?.changed, false);
    const bad = await ctx.http({ as: p.learner, method: "PUT", path: `/api/adaptive/chat/sessions/${chatId}/model`, body: { modelId: "not-a-model" } });
    ctx.expect.status("an unknown model is refused", bad, 422);
    ctx.expect.eq("…with its code", bad.body?.code, "unknown_model");
    const back = await ctx.http({ as: p.learner, method: "PUT", path: `/api/adaptive/chat/sessions/${chatId}/model`, body: { modelId: null } });
    ctx.expect.eq("back to the default (null) is saved too", back.body?.selection?.modelId, null);
    const after = await ctx.http({ as: p.learner, path: "/api/adaptive/chat/models" });
    ctx.expect.ok("…and is what every device now opens on", after.body?.picker?.saved && after.body.picker.saved.modelId === null, after.body?.picker?.saved);
  },
};

export const pickReachesWorkflows = {
  name: "models.pick_reaches_workflows", area: "workflows", risk: "write",
  description: "Scenario K: a pick on a teaching workflow is saved (model_selection) with a learner-visible model.changed event; a chat pick reaches the learner's open workflows; the Study Prep controller, the Teaching controller and NaNa are served by the picked model and recorded at its price; the assessor stays locked.",
  params: { learner: { default: "@tester43" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { default: db } = await import("../../../db.js");
    const pick = await pickable(ctx, p.learner);
    if (!pick) ctx.expect.blocked("no model besides the default is set up and in this tester's plan here");
    const since = new Date(Date.now() - 1000).toISOString();
    await restoreWorkflows(ctx, db, me, since);

    const created = await ctx.http({ as: p.learner, method: "POST", path: "/api/teaching/workflows", body: { topic: `${ctx.marker} Osmosis`, subject: "Biology", focus: ["Why water moves into a cell"] } });
    const wfId = created.body?.workflowId;
    if (!wfId) ctx.expect.blocked(`couldn't make a teaching workflow: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
    ctx.cleanup(() => ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: wfId } }));

    // 1. Picked on the workflow (the Teaching composer).
    const put = await ctx.http({ as: p.learner, method: "PUT", path: `/api/workflows/${wfId}/model`, body: { modelId: pick.id } });
    ctx.expect.status("a pick on the workflow is saved", put, 200);
    const got = await ctx.http({ as: p.learner, path: `/api/workflows/${wfId}/model` });
    ctx.expect.eq("…on its model_selection", got.body?.modelSelection?.modelId, pick.id);
    const events = await ctx.http({ as: p.learner, path: `/api/workflows/${wfId}/events` });
    const changed = (events.body?.events || []).filter((e) => e.type === "model.changed");
    ctx.expect.eq("one model.changed event on its stream (learner-visible)", changed.length, 1);
    ctx.expect.eq("…from the default to the pick", changed[0]?.payload?.to, pick.id);

    // 2. Picked in the chat: it reaches the open workflow.
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} pick` } });
    const chatId = made.body?.session?.id;
    if (chatId) {
      ctx.cleanup(() => ctx.http({ as: p.learner, method: "DELETE", path: `/api/adaptive/chat/sessions/${chatId}` }));
      const chat = await ctx.http({ as: p.learner, method: "PUT", path: `/api/adaptive/chat/sessions/${chatId}/model`, body: { modelId: null } });
      ctx.expect.ok("a chat pick reaches the open teaching workflow", (chat.body?.workflows || []).includes(wfId), chat.body);
      const [row] = await ctx.db.rows("edu.workflow_instances", { id: wfId }, { columns: "model_selection", limit: 1 });
      ctx.expect.eq("…its model_selection follows (back to the default)", row?.model_selection?.modelId, null);
      await ctx.http({ as: p.learner, method: "PUT", path: `/api/workflows/${wfId}/model`, body: { modelId: pick.id } });
    }

    // 3. The calls: served by the picked model (stand-in providers record which), recorded at its price.
    const { modelPicks } = await import("../../workflows/index.js");
    const { runWithProviders } = await import("../../../lib/aiModel.js");
    const { modelRegistry } = await import("../../../lib/modelRegistry.js");
    const picks = await modelPicks();
    const fields = await picks.callFields({ learnerId: me.id, workflow: wfId, role: "controller" });
    ctx.expect.eq("the workflow's calls carry the pick", fields.__learnerChoice, pick.id);
    ctx.expect.eq("the assessor gets no pick (locked)", JSON.stringify(await picks.callFields({ learnerId: me.id, workflow: wfId, role: "assessor" })), "{}");
    const want = modelRegistry.resolve({ role: "controller", learnerChoice: pick.id, allowedModels: fields.__allowedModels || null });
    ctx.expect.eq("…and it resolves to the picked model in this plan", want.source, "learner");

    const served = [];
    const stub = (provider) => ({ async create(body, _o, entry) {
      served.push({ provider, entry: entry?.id });
      if (body.stream) return (async function* () { yield { choices: [{ delta: { content: "Hi" } }] }; yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } }; })();
      const name = body.tools?.[0]?.function?.name;
      return { choices: [{ index: 0, finish_reason: name ? "tool_calls" : "stop", message: { role: "assistant", content: name ? null : "Hi", ...(name ? { tool_calls: [{ id: "c", type: "function", function: { name, arguments: JSON.stringify({ intent: "x", thinking: "t", message: "m", args: {}, move: "challenge" }) } }] } : {}) } }], usage: { prompt_tokens: 10, completion_tokens: 2 } };
    } });
    // noForce: a sandbox's AI_FORCE_MODEL would hide which model the pick chose; the stand-ins see the choice itself.
    const providers = { openai: stub("openai"), anthropic: stub("anthropic"), openai_compatible: stub("openai_compatible"), noForce: true };
    const { makeLlmAgent } = await import("../../adaptive-learning/study-prep/llm-agent.js");
    const { modelDecide } = await import("../../adaptive-learning/teaching-session/controller.js");
    const { guideTeach } = await import("../../adaptive-learning/teaching-session/guideTeacher.js");
    const { openai } = await import("../../../lib/aiModel.js");
    await runWithProviders(providers, async () => {
      // The Study Prep agent asks the app's own pick source (no learnerId → unbilled; pick by workflow).
      await makeLlmAgent({ system: "Plan.", pick: () => picks.callFields({ learnerId: me.id, workflow: wfId, role: "controller" }) }).next({ iteration: 1, goal: "g", observations: [] });
      await modelDecide({ context: { mode: "teach_agent", topic: "Osmosis", humanMessage: "x", history: [], studentId: null, modelPick: fields, mustKnowParts: ["a"], mustKnowIndex: 0, orchestrator: { session: { phase: "PHASE_2", turnCount: 1 } }, evidenceUpdate: { dialogue: {}, current: {} } }, observations: [] });
      await guideTeach({ orchestrator: { studentId: null, session: {} }, humanMessage: "x", topic: "Osmosis", part: "a", move: "explain", evidence: {}, history: [], modelPick: await picks.callFields({ learnerId: me.id, workflow: wfId, role: "persona" }) });
      await openai.chat.completions.create({ model: "gpt-4.1-mini", messages: [{ role: "user", content: "judge" }], __role: "assessor", ...fields });
    });
    ctx.note(`served: ${JSON.stringify(served)}`);
    ctx.expect.eq("Study Prep controller decision → the picked model", served[0]?.entry, pick.id);
    ctx.expect.eq("Teaching controller decision → the picked model", served[1]?.entry, pick.id);
    ctx.expect.eq("NaNa's reply → the picked model", served[2]?.entry, pick.id);
    ctx.expect.eq("the assessor keeps its own model", served[3]?.entry, "gpt-4.1-mini");
  },
};

export const noForcedToolChoiceClaude = {
  name: "models.no_forced_tool_choice_claude", area: "chat", risk: "read",
  description: "Scenario K / §7.11.4: a controller call that asks for tool_choice \"required\" (or one named tool) reaches Claude as auto + a call-one-tool instruction — the deployed adapter's request body, recorded; and a live Claude call with it is accepted when a key is set.",
  async run(ctx) {
    const { runWithProviders, openai } = await import("../../../lib/aiModel.js");
    const { makeAnthropicAdapter } = await import("../../../lib/providers/anthropic.js");
    const { makeLlmAgent } = await import("../../agent-runtime/index.js");
    const { modelRegistry, availabilityOf } = await import("../../../lib/modelRegistry.js");
    const bodies = [];
    const client = { messages: { create: async (body) => { bodies.push(body); return { id: "m", model: body.model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: body.tools[0].name, input: { intent: "x", args: {} } }], usage: { input_tokens: 5, output_tokens: 3 } }; } } };
    const anthropic = makeAnthropicAdapter({ client });
    const tools = [{ type: "function", function: { name: "a_act", parameters: { type: "object", properties: {} } } }];
    await runWithProviders({ anthropic }, async () => {
      const agent = makeLlmAgent({ system: "s", catalogue: [{ name: "a.act", description: "act" }], feature: "verify_tool_choice", payer: "platform", model: "claude-sonnet" });
      await agent.next({ iteration: 1, goal: "g", observations: [] });
      for (const choice of ["required", { type: "function", function: { name: "a_act" } }]) {
        await openai.chat.completions.create({ model: "claude-sonnet", messages: [{ role: "user", content: "x" }], tools, tool_choice: choice, __payer: "platform", __feature: "verify_tool_choice" });
      }
    });
    ctx.note(`tool_choice sent: ${JSON.stringify(bodies.map((b) => b.tool_choice))}`);
    ctx.expect.eq("three Claude requests were built", bodies.length, 3);
    ctx.expect.ok("none forces a tool (auto only)", bodies.every((b) => b.tool_choice?.type === "auto"), bodies.map((b) => b.tool_choice));
    ctx.expect.ok("the forced choice became an instruction instead", bodies.every((b) => /Call exactly one of the provided tools/.test(b.system || "")));
    ctx.expect.ok("the agent loop's call reached Claude", bodies[0]?.model === modelRegistry.get("claude-sonnet")?.apiModel, bodies[0]?.model);

    // Live, when this server has a Claude key: the same request is accepted (a forced choice would be a 400).
    const live = modelRegistry.get("claude-haiku");
    if (!live || !availabilityOf(live).available) { ctx.note("no Claude key here: the live call is skipped; the request body above is the proof"); return; }
    try {
      const res = await openai.chat.completions.create({ model: "claude-haiku", max_tokens: 200, messages: [{ role: "user", content: "Call the tool." }], tools, tool_choice: "required", __payer: "platform", __feature: "verify_tool_choice", __timeoutMs: 30_000, __maxRetries: 0 });
      ctx.expect.ok("a live Claude call with tool_choice required is accepted", !!res?.choices?.[0], res?.choices?.[0]?.finish_reason);
    } catch (e) {
      ctx.expect.ok("a live Claude call with tool_choice required is accepted", e?.status !== 400, `${e?.status} ${String(e?.message).slice(0, 200)}`);
    }
  },
};

export const refusalFallback = {
  name: "models.refusal_fallback", area: "chat", risk: "read",
  description: "Scenario K / §7.11.4: a Claude refusal (stop_reason refusal, from a stand-in Claude) is not a crash — the call comes back with model_refusal and the fallback model's real answer; in an agent loop it is a model_refusal record and observation, never a malformed step.",
  async run(ctx) {
    const { runWithProviders, openai } = await import("../../../lib/aiModel.js");
    const { makeAnthropicAdapter } = await import("../../../lib/providers/anthropic.js");
    const { modelRegistry, availabilityOf } = await import("../../../lib/modelRegistry.js");
    const { makeLlmAgent } = await import("../../agent-runtime/index.js");
    const { runAgentLoop } = await import("../../agent-runtime/index.js");
    // Where the server itself sends a refused Claude call (the default, or AI_FORCE_MODEL's model on a sandbox).
    const { refusalFallbackFor } = await import("../../../lib/aiModel.js");
    const fallback = refusalFallbackFor(modelRegistry.get("claude-sonnet"));
    if (!fallback || !availabilityOf(fallback).available) ctx.expect.blocked(`the fallback model (${fallback?.id || modelRegistry.defaultId}) has no key here, so its real answer can't be checked`);
    // A real Claude can't be made to refuse on demand: the deployed adapter gets a stand-in Messages API that refuses.
    const client = { messages: { create: async (body) => ({ id: "m", model: body.model, stop_reason: "refusal", stop_details: { category: "cyber", explanation: "Declined." }, content: [], usage: { input_tokens: 12, output_tokens: 0 } }) } };
    const anthropic = makeAnthropicAdapter({ client });

    const res = await runWithProviders({ anthropic }, () => openai.chat.completions.create({
      model: "claude-sonnet", max_tokens: 20, messages: [{ role: "user", content: "Reply with the single word: ready" }],
      __payer: "platform", __feature: "verify_refusal", __timeoutMs: 30_000, __maxRetries: 0,
    }));
    ctx.note(`model_refusal: ${JSON.stringify(res?.model_refusal)} · answer: ${String(res?.choices?.[0]?.message?.content || "").slice(0, 80)}`);
    ctx.expect.eq("the refusal is reported (model_refusal)", res?.model_refusal?.model, "claude-sonnet");
    ctx.expect.eq("…with its category", res?.model_refusal?.category, "cyber");
    ctx.expect.eq("…and the fallback model", res?.model_refusal?.fallbackModel, fallback.id);
    ctx.expect.ok("the fallback model really answered", String(res?.choices?.[0]?.message?.content || "").trim().length > 0, res?.choices?.[0]);

    // In an agent loop: recorded as model_refusal, the agent sees it; the fallback's decision carries the step.
    const catalogue = [{ name: "verify.done", description: "Finish the step." }];
    const agent = makeLlmAgent({ system: "Call verify.done.", catalogue, feature: "verify_refusal", payer: "platform", maxTokens: 120, model: "claude-sonnet" });
    const records = [];
    const registry = { catalogue, validate: () => ({ ok: true }), execute: async () => ({ done: true }) };
    let out = null;
    let threw = null;
    try {
      out = await runWithProviders({ anthropic }, () => runAgentLoop({ agent, registry, goal: "Finish.", caps: { maxIterations: 2 }, terminalActions: ["verify.done"], record: async (e) => { records.push(e); } }));
    } catch (e) { threw = e?.message || String(e); }
    ctx.note(`loop: ${JSON.stringify(records.map((r) => r.kind))} · ended ${out?.ended}`);
    ctx.expect.eq("the loop doesn't crash", threw, null);
    ctx.expect.eq("the refusal is a model_refusal record", records[0]?.kind, "model_refusal");
    ctx.expect.ok("…never a malformed one", !records.some((r) => r.kind === "malformed"), records.map((r) => r.kind));
    ctx.expect.eq("…and an observation the agent reads", out?.observations?.[0]?.code, "model_refusal");
  },
};
