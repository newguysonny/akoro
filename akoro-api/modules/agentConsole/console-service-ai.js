import { openai, fallbackLadder, runWithProviders } from "../../lib/aiModel.js";
import { readLogs, logSeq } from "../../lib/logTap.js";
import { modelRegistry, availabilityOf, ROLES } from "../../lib/modelRegistry.js";
import { validateShape, readStructured } from "../../lib/structuredOutput.js";
import { buildToolMessages, toolSchema, shapeToolResult } from "../records/index.js";
import { featureModels } from "../../lib/aiFeatureModels.js";
import { makeOpenCodeAdapter } from "../../lib/providers/opencode.js";
import { bad } from "./console-rules.js";

/* The OpenCode lane, as configured on THIS server (no secrets) + a 1-token
   live ping so an env change can be verified without a deploy. */
export function aiProvider(_req, res) {
  const lane = String(process.env.OPENCODE_LANE || "go");
  const base = String(process.env.OPENCODE_BASE_URL || "https://opencode.ai/inference").replace(/\/+$/, "");
  res.json({ success: true, data: {
    provider: process.env.AI_PROVIDER || null,
    defaultModel: modelRegistry.defaultId,
    envDefault: modelRegistry.envDefaultId,
    fallback: modelRegistry.fallbackId,
    lane,
    baseURL: base,
    keySet: !!process.env.OPENCODE_API_KEY,
    billProviderCost: process.env.AI_BILL_PROVIDER_COST !== "false",
    models: modelRegistry.catalogue.filter((e) => e.selectable).map((e) => ({
      id: e.id, label: e.label, apiModel: e.apiModel, lane: e.lane, provider: e.provider,
      fallbackModel: e.fallbackModel,
      ladder: fallbackLadder(e).map((t) => t.id),
      availability: availabilityOf(e),
    })),
    // Hidden failover routes (e.g. DeepSeek's own API behind the public model).
    targets: modelRegistry.catalogue.filter((e) => !e.selectable && e.enabled)
      .map((e) => ({ id: e.id, apiModel: e.apiModel, provider: e.provider, availability: availabilityOf(e) })),
    roles: Object.keys(ROLES).map((role) => {
      const r = modelRegistry.resolve({ role });
      return { role, model: r.model.id, source: r.source, locked: !!ROLES[role].locked };
    }),
    features: featureModels(process.env, modelRegistry.envDefaultId),
  } });
}

export async function aiPing(req, res) {
  const id = String(req.body?.model || process.env.AI_MODEL_DEFAULT || modelRegistry.defaultId);
  const entry = modelRegistry.get(id);
  if (!entry) return bad(res, `Unknown model id "${id}".`);
  // A raw Go model can be probed even when this environment's AI_MODELS still
  // defines the public id on another transport (e.g. legacy direct DeepSeek).
  const apiModelOverride = String(req.body?.apiModel || "").trim() || null;
  // viaModel routes through lib/aiModel (the real provider dispatch), so the
  // direct fallback and OpenCode can be compared on the same request.
  const viaModel = req.body?.viaModel === true;
  if (!apiModelOverride && !viaModel && entry.provider !== "opencode") return bad(res, `"${id}" isn't an OpenCode model.`);
  const started = Date.now();
  const maxTokens = Math.max(2, Math.min(512, Number(req.body?.maxTokens) || 16));
  const prompt = String(req.body?.prompt || "ping").slice(0, 200);
  const probeStream = req.body?.stream === true;
  const probeReasoning = req.body?.reasoning === true;
  const probeJson = req.body?.json === true;
  const probeTools = req.body?.tools === true;
  const image = typeof req.body?.image === "string" && req.body.image.startsWith("data:image/") ? req.body.image : "";
  try {
    if (viaModel) {
      const out = await openai.chat.completions.create({
        model: id,
        messages: [{ role: "user", content: image
          ? [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: image } }]
          : prompt }],
        max_tokens: maxTokens,
        ...(probeReasoning ? { reasoning_effort: "medium" } : {}),
        __feature: "vision_probe", __payer: "platform",
      });
      const msg = out?.choices?.[0]?.message || {};
      return res.json({ success: true, data: {
        model: entry.id, provider: entry.provider, apiModel: out?.model || entry.apiModel,
        ms: Date.now() - started, usage: out?.usage ?? null,
        finish: out?.choices?.[0]?.finish_reason ?? null,
        content: String(msg.content ?? "").slice(0, 800),
        reasoningChars: String(msg.reasoning_content ?? msg.reasoning ?? "").length,
      } });
    }
    const adapter = makeOpenCodeAdapter();
    const out = await adapter.create({
      model: apiModelOverride || entry.apiModel,
      messages: [{ role: "user", content: image
        ? [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: image } }]
        : prompt }],
      max_tokens: maxTokens,
      ...(probeReasoning ? { reasoning_effort: "medium" } : {}),
      ...(probeStream ? { stream: true } : {}),
      ...(probeJson ? { response_format: { type: "json_schema", json_schema: {
        name: "ping", strict: true,
        schema: { type: "object", additionalProperties: false, required: ["value"], properties: { value: { type: "string" } } },
      } } } : {}),
      ...(probeTools ? { tools: [{ type: "function", function: {
        name: "ping", description: "Return a value",
        parameters: { type: "object", required: ["value"], properties: { value: { type: "string" } } },
      } }], tool_choice: "required" } : {}),
    }, { timeout: 60000, maxRetries: 0 }, entry);
    if (probeStream) {
      let reasoning = "", content = "", chunks = 0;
      const keys = new Set();
      for await (const ch of out) {
        chunks += 1;
        const d = ch?.choices?.[0]?.delta || {};
        Object.keys(d).forEach((k) => keys.add(k));
        reasoning += String(d.reasoning_content ?? d.reasoning ?? d.thinking ?? "");
        content += String(d.content ?? "");
      }
      return res.json({ success: true, data: {
        model: entry.id, apiModel: apiModelOverride || entry.apiModel, stream: true, chunks,
        deltaKeys: [...keys], reasoningChars: reasoning.length, reasoning: reasoning.slice(0, 1200),
        contentChars: content.length, content: content.slice(0, 300),
      } });
    }
    const msg = out?.choices?.[0]?.message || {};
    return res.json({ success: true, data: {
      model: entry.id, apiModel: apiModelOverride || entry.apiModel,
      ms: Date.now() - started, usage: out?.usage ?? null,
      messageKeys: Object.keys(msg),
      reasoning: String(msg.reasoning_content ?? msg.reasoning ?? msg.thinking ?? "").slice(0, 1200),
      content: String(msg.content ?? "").slice(0, 600),
      parsed: probeJson ? (() => { try { return JSON.parse(String(msg.content || "")); } catch { return null; } })() : null,
      toolCalls: probeTools ? (msg.tool_calls || []).map((c) => ({ name: c?.function?.name, args: String(c?.function?.arguments || "").slice(0, 120) })) : null,
    } });
  } catch (e) {
    res.status(502).json({ success: false, error: String(e?.message || e).slice(0, 300), status: e?.status ?? null,
      model: entry.id, apiModel: entry.apiModel, ms: Date.now() - started });
  }
}

/* Simulate a 429 on the OpenCode transport and let the REAL next hop answer.
   Proves the failover ladder end-to-end without spending the gateway: the
   primary/hop calls are stubbed, the direct transport is a live call. */
export async function aiFailoverTest(req, res) {
  const model = String(req.body?.model || process.env.AI_MODEL_DEFAULT || "deepseek");
  const maxTokens = Math.max(2, Math.min(64, Number(req.body?.maxTokens) || 16));
  const prompt = String(req.body?.prompt || "ping").slice(0, 200);
  const failing = {
    async create() {
      throw Object.assign(new Error("simulated 429 on the OpenCode transport"), { status: 429 });
    },
  };
  const started = Date.now();
  try {
    const out = await runWithProviders({ opencode: failing }, () => openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      __feature: "failover_test",
      __payer: "platform",
    }));
    res.json({ success: true, data: {
      model,
      ms: Date.now() - started,
      content: out?.choices?.[0]?.message?.content ?? null,
      fallback: out?.model_fallback ?? null,
      usage: out?.usage ?? null,
    } });
  } catch (e) {
    res.status(502).json({ success: false, error: String(e?.message || e).slice(0, 300),
      status: e?.status ?? null, model, ms: Date.now() - started });
  }
}

/* Side-by-side structured-output check: same schema + prompt through the
   real aiModel path on two models (default: OpenCode DeepSeek vs DeepSeek
   direct). Reports retries, validation, latency and usage — no learner data. */
export async function structuredTest(req, res) {
  const text = String(req.body?.text || "The cell membrane is a selectively permeable phospholipid bilayer. The nucleus holds DNA. Mitochondria make ATP. Ribosomes build proteins. The cell wall gives plant cells support.").slice(0, 3000);
  const schema = req.body?.schema || {
    type: "object", additionalProperties: false, required: ["title", "items"],
    properties: {
      title: { type: "string" },
      items: { type: "array", minItems: 1, items: {
        type: "object", additionalProperties: false, required: ["term", "definition", "score"],
        properties: { term: { type: "string" }, definition: { type: "string" }, score: { type: "integer" } },
      } },
    },
  };
  const prompt = String(req.body?.prompt || "From the text below, return JSON with a title and 3 items. Each item has term, a one-sentence definition, and an integer score from 1 to 10.\n\nTEXT:\n" + text);
  const models = Array.isArray(req.body?.models) && req.body.models.length ? req.body.models : ["deepseek", "deepseek-direct"];
  const maxTokens = Math.max(64, Math.min(1200, Number(req.body?.maxTokens) || 600));
  const runs = [];
  for (const id of models) {
    const entry = modelRegistry.get(id);
    if (!entry) { runs.push({ id, error: "unknown model" }); continue; }
    const fromSeq = logSeq();
    const t0 = Date.now();
    try {
      const out = await openai.chat.completions.create({
        model: id,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        response_format: { type: "json_schema", json_schema: { name: "compare", strict: true, schema } },
        __feature: "structured_compare",
        __payer: "platform",
      });
      const content = String(out?.choices?.[0]?.message?.content || "");
      let parsed = null;
      try { parsed = JSON.parse(content); } catch { parsed = null; }
      const errors = parsed ? validateShape(parsed, schema) : ["unparseable JSON"];
      const logs = readLogs({ since: fromSeq, limit: 200 }).lines
        .map((l) => (typeof l === "string" ? l : l?.msg || JSON.stringify(l)))
        .filter((l) => /\[ai:json\]|\[ai\].*failed/.test(l));
      runs.push({
        id, provider: entry.provider, lane: entry.lane || null, apiModel: entry.apiModel,
        ms: Date.now() - t0, ok: errors.length === 0, errors: errors.slice(0, 4),
        retries: logs.length, retryLog: logs.slice(0, 3),
        contentChars: content.length, content: content.slice(0, 400),
        parsedOk: !!parsed,
        parsedSummary: parsed && typeof parsed === "object"
          ? Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v === "string" ? v.length : typeof v]))
          : null,
        usage: out?.usage ?? null,
      });
    } catch (e) {
      runs.push({ id, provider: entry.provider, lane: entry.lane || null, apiModel: entry.apiModel,
        ms: Date.now() - t0, ok: false, error: String(e?.message || e).slice(0, 300), status: e?.status ?? null });
    }
  }
  res.json({ success: true, data: { schema, promptChars: prompt.length, maxTokens, runs } });
}

/* Grounding A/B: the SAME question/quiz, two passage sets (pdf text vs
   extracted markdown), then a model judge. Passages are supplied by the
   caller: {n, pageNumber, text, bbox|null}. No learner data is read here. */
export async function groundingAb(req, res) {
  const question = String(req.body?.question || "").slice(0, 800);
  const count = Math.max(2, Math.min(6, Number(req.body?.quizCount) || 4));
  const clean = (list) => (Array.isArray(list) ? list : [])
    .map((p, i) => ({ n: i + 1, pageNumber: Number.isInteger(p?.pageNumber) ? p.pageNumber : null,
      text: String(p?.text || "").slice(0, 2200), bbox: Array.isArray(p?.bbox) ? p.bbox : null }))
    .filter((p) => p.text.trim()).slice(0, 18);
  const variants = {
    pdf_text: clean(req.body?.passagesA),
    markdown: clean(req.body?.passagesB),
  };
  const passageText = (ps) => ps.map((p) => `[${p.n}] (${p.pageNumber ? `page ${p.pageNumber}` : "part"})\n${p.text}`).join("\n\n");
  const citeStats = (answer, ps) => {
    const nums = [...new Set((String(answer).match(/\[(\d+)\]/g) || []).map((x) => Number(x.slice(1, -1))))];
    const found = nums.map((n) => ps.find((p) => p.n === n)).filter(Boolean);
    return { cited: found.length, withBbox: found.filter((p) => p.bbox).length,
      bboxRate: found.length ? Math.round((found.filter((p) => p.bbox).length / found.length) * 100) : null,
      pages: [...new Set(found.map((p) => p.pageNumber).filter(Boolean))] };
  };
  const ask = async (ps, label) => {
    const t0 = Date.now();
    const out = await openai.chat.completions.create({
      __role: "chat", __feature: "grounding_ab", __payer: "platform",
      temperature: 0.2, max_tokens: 700,
      messages: [
        { role: "system", content: "Answer the learner's question using ONLY the numbered passages. Cite every claim with [n]. If the passages do not contain the answer, say so plainly." },
        { role: "user", content: `PASSAGES:\n${passageText(ps)}\n\nQUESTION: ${question}` },
      ],
    });
    const answer = String(out?.choices?.[0]?.message?.content || "");
    return { variant: label, ms: Date.now() - t0, answer, usage: out?.usage ?? null, cites: citeStats(answer, ps) };
  };
  const quiz = async (ps, label) => {
    const t0 = Date.now();
    const values = { count: String(count), difficulty: "Medium", focus: "" };
    const out = await openai.chat.completions.create({
      __role: "background", __feature: "grounding_ab_quiz", __payer: "platform",
      temperature: 0.3, max_tokens: 1800,
      messages: buildToolMessages({ tool: "quiz", docName: "the document", passages: ps, values }),
      response_format: { type: "json_schema", json_schema: { name: "reader_quiz", strict: true, schema: toolSchema("quiz") } },
    });
    let json = {}; try { json = JSON.parse(out?.choices?.[0]?.message?.content || "{}"); } catch { json = {}; }
    const shaped = shapeToolResult("quiz", json, ps, values);
    const questions = shaped.quizQuestions || [];
    const cites = questions.map((q) => q.cite).filter(Boolean);
    return { variant: label, ms: Date.now() - t0, count: questions.length,
      withBbox: cites.filter((c) => c?.bbox).length,
      bboxRate: cites.length ? Math.round((cites.filter((c) => c?.bbox).length / cites.length) * 100) : null,
      pages: [...new Set(cites.map((c) => c?.pageNumber).filter(Boolean))],
      sample: questions.slice(0, 2).map((q) => ({ prompt: q.prompt, options: q.options.map((o) => o.text), cite: q.cite })),
      usage: out?.usage ?? null };
  };
  const judge = async (reference, kind, payload) => {
    const out = await openai.chat.completions.create({
      __role: "background", __feature: "grounding_ab_judge", __payer: "platform",
      temperature: 0, max_tokens: 300,
      messages: [
        { role: "system", content: "You grade a study assistant against the reference passages (the truth). Be strict and concise. Return JSON only." },
        { role: "user", content: `TASK: judge the ${kind}. Score 1-10 for correctness, grounding, and completeness (for a quiz: correctness, answerability, distractor quality). List concrete issues.\n\nREFERENCE:\n${reference.slice(0, 5000)}\n\nCANDIDATE:\n${JSON.stringify(payload).slice(0, 5000)}\n\nReturn {"score": int, "grounding": int, "completeness": int, "issues": [string]}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "judge", strict: true,
        schema: { type: "object", additionalProperties: false, required: ["score", "grounding", "completeness", "issues"],
          properties: { score: { type: "integer" }, grounding: { type: "integer" }, completeness: { type: "integer" },
            issues: { type: "array", items: { type: "string" } } } } } },
    });
    const parsed = readStructured(out?.choices?.[0]?.message?.content, { type: "object", required: ["score"], properties: { score: { type: "integer" } } });
    return parsed.value || { score: null, issues: ["judge unparseable"] };
  };

  try {
    const reference = variants.markdown.map((p) => p.text).join("\n\n");
    const results = {};
    for (const [key, ps] of Object.entries(variants)) {
      try {
        const a = await ask(ps, key);
        const q = await quiz(ps, key);
        const ja = await judge(reference, "answer", { answer: a.answer });
        const jq = await judge(reference, "quiz", q.sample);
        results[key] = { passages: ps.length, ask: { ...a, judge: ja }, quiz: { ...q, judge: jq } };
      } catch (e) {
        results[key] = { error: String(e?.message || e).slice(0, 300), status: e?.status ?? null };
      }
    }
    res.json({ success: true, data: { question, count, results } });
  } catch (e) {
    res.status(502).json({ success: false, error: String(e?.message || e).slice(0, 400) });
  }
}
