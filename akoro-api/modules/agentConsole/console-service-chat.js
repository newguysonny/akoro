import { randomUUID } from "node:crypto";
import { openai } from "../../lib/aiModel.js";
import { readLogs, logSeq } from "../../lib/logTap.js";
import { runDry } from "../../lib/dryRunContext.js";
import { signInternalAccess } from "../auth/index.js";
import {
  API_BASE, MODELS, bad, chat, fail, keepRun, resolveLearner,
} from "./console-rules.js";

export async function status(_req, res) {
  const { getLearnerChatTools, isSideEffecting } = await chat();
  const tools = getLearnerChatTools().map((t) => ({ name: t.name, changesData: isSideEffecting(t.name, {}), description: t.description }));
  res.json({
    success: true,
    data: {
      tools, toolCount: tools.length, models: MODELS,
      liveKey: !!process.env.OPENAI_API_KEY,
      learnerAllowList: String(process.env.AGENT_CONSOLE_LEARNERS || "").split(",").map((x) => x.trim()).filter(Boolean),
      modes: { dry: "tools that change data are simulated; read-only tools run (default)", live: "everything runs for real — creates tasks, sends messages, etc." },
      logSeq: logSeq(),
    },
  });
}

/* Which tool would the agent pick? No learner, nothing runs — the cheapest check. */
export async function pick(req, res) {
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) return bad(res, "prompt is required");
  const model = MODELS.includes(req.body?.model) ? req.body.model : MODELS[0];
  const { getLearnerChatTools } = await chat();
  const tools = getLearnerChatTools().map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const t0 = Date.now();
  const resp = await openai.chat.completions.create({
    model, max_tokens: 500, temperature: 0, __feature: "eval", __payer: "platform", tools, tool_choice: "auto",
    messages: [
      { role: "system", content: "You are a learner's personal study agent on Akoro. If a tool fits the learner's request, call it; use only what they said." },
      { role: "user", content: prompt },
    ],
  });
  const msg = resp.choices?.[0]?.message || {};
  const calls = (msg.tool_calls || []).map((c) => { let args = {}; try { args = JSON.parse(c.function.arguments || "{}"); } catch { args = { _raw: c.function.arguments }; } return { tool: c.function.name, args }; });
  const run = keepRun({ id: randomUUID(), kind: "pick", at: new Date().toISOString(), model, prompt, calls, text: msg.content || null, ms: Date.now() - t0 });
  res.json({ success: true, data: run });
}

/* One real Agent Chat turn as the test learner. */
export async function chatTurn(req, res) {
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) return bad(res, "prompt is required");
  const mode = req.body?.mode === "live" ? "live" : "dry";
  let learner;
  try { learner = await resolveLearner(req.body?.learner); } catch (e) { return fail(res, e); }
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-20) : [];
  const fromSeq = logSeq();
  const t0 = Date.now();
  const token = signInternalAccess({ id: learner.id, role: learner.role || "student" }, 600);
  let status = 0, body = null;
  try {
    const r = await fetch(`${API_BASE}/api/adaptive/chat/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${token}`,
        ...(mode === "dry" ? { "x-agent-console-dry": process.env.AGENT_CONSOLE_KEY } : {}),
      },
      body: JSON.stringify({ message: prompt, history, ...(req.body?.think ? { mode: "think" } : {}) }),
    });
    status = r.status;
    body = await r.json().catch(() => null);
  } catch (e) {
    body = { error: e.message };
  }
  const logs = readLogs({ since: fromSeq, limit: 400 }).lines;
  const run = keepRun({
    id: randomUUID(), kind: "chat", at: new Date().toISOString(), mode, learner: { username: learner.username, name: learner.name },
    prompt, status, ms: Date.now() - t0,
    reply: body?.reply ?? body?.response ?? null,
    tools: (body?.toolExecutions || []).map((x) => ({ tool: x.tool, success: x.success, ...(x.agents ? { agents: x.agents.length } : {}), ...(x.requests ? { requests: x.requests.length } : {}) })),
    trace: body?.trace ?? null,
    error: status >= 400 ? (body?.error || `HTTP ${status}`) : null,
    logs,
    note: mode === "dry" ? "DRY: nothing was changed — tools that change data answered with what they would do." : "LIVE: tools ran for real.",
  });
  res.status(status >= 400 ? 502 : 200).json({ success: status < 400, data: run });
}

/* One tool, directly. */
export async function runTool(req, res) {
  const tool = String(req.body?.tool || "").trim();
  if (!tool) return bad(res, "tool is required");
  const mode = req.body?.mode === "live" ? "live" : "dry";
  let learner;
  try { learner = await resolveLearner(req.body?.learner); } catch (e) { return fail(res, e); }
  const { getLearnerChatTools, executeChatTool } = await chat();
  if (!getLearnerChatTools().some((t) => t.name === tool)) return bad(res, `"${tool}" isn't a learner chat tool on this server (see /status).`);
  const input = req.body?.input && typeof req.body.input === "object" ? req.body.input : {};
  const fromSeq = logSeq();
  const t0 = Date.now();
  let result;
  try {
    const go = () => executeChatTool(tool, input, learner.id, { role: "student", channel: "agent-console" });
    result = mode === "dry" ? await runDry(go) : await go();
  } catch (e) { result = { threw: e.message || String(e) }; }
  const run = keepRun({
    id: randomUUID(), kind: "tool", at: new Date().toISOString(), mode, learner: { username: learner.username, name: learner.name },
    tool, input, result, ms: Date.now() - t0, logs: readLogs({ since: fromSeq, limit: 200 }).lines,
  });
  res.json({ success: !(result && (result.error || result.threw)), data: run });
}

export function logs(req, res) {
  res.json({ success: true, data: readLogs({ since: req.query.since, filter: req.query.filter, level: req.query.level, limit: req.query.limit }) });
}
