/**
 * modules/agentConsole/routes.js — the learner Agent Chat test console.
 *
 * Same front door as the HF mirror and parse consoles: a shared-key guard,
 * JSON in/out, and a small HTML page. It lets an operator (or Claude, given
 * the key) drive the REAL learner Agent Chat as a TEST learner and see what
 * happened — the tools it called, their results, the reply, the server log.
 *
 *   GET  /api/agent-console/status         tools, which ones change data, flags, models
 *   POST /api/agent-console/pick           { prompt, model? } → which tool + args the model
 *                                          picks. No learner, nothing runs.
 *   POST /api/agent-console/chat           { learner, prompt, mode: "dry"|"live", history?, think? }
 *                                          → one real Agent Chat turn as the learner.
 *                                          dry (default): tools that change data are
 *                                          simulated ("would have…"); read-only tools run.
 *   POST /api/agent-console/tool           { learner, tool, input, mode } → one tool, directly
 *   GET  /api/agent-console/logs           ?since=<seq>&filter=&level= → server log lines
 *   GET  /api/agent-console/runs           the last 50 console runs
 *   GET  /api/agent-console/runs/:id       one run in full (request, reply, tools, logs)
 *   GET  /api/agent-console                the console page (?key=)
 *
 * Env:
 *   AGENT_CONSOLE_KEY       shared secret — arms the routes (header x-agent-console-key, Authorization: Bearer, or ?key=)
 *   AGENT_CONSOLE_LEARNERS  optional comma list of @usernames/emails allowed as test learners
 *
 * Guard rails: the learner must be a LEARNER account (and on the allow-list
 * when one is set); "live" mode is the only way anything is changed, and it
 * is said so in every response.
 */
import express from "express";
import { randomUUID } from "node:crypto";
import db from "../../db.js";
import { openai } from "../../lib/aiModel.js";
import { readLogs, logSeq } from "../../lib/logTap.js";
import { runDry } from "../../lib/dryRunContext.js";
import { signInternalAccess } from "../auth/routes.js";

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const API_BASE = process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o", "gpt-4.1"];

let chatMod = null;
const chat = async () => (chatMod ||= await import("../adaptive-learning/chat.js"));

const guard = (req, res, next) => {
  const want = process.env.AGENT_CONSOLE_KEY;
  if (!want) return res.status(501).json({ success: false, error: "Agent console not configured — set AGENT_CONSOLE_KEY on the server." });
  // Bearer too: a cloud environment's network secret can inject
  // "Authorization: Bearer <key>" but not a custom header.
  const bearer = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "")?.[1]?.trim();
  const got = req.get("x-agent-console-key") || bearer || req.query.key;
  if (got !== want) return res.status(401).json({ success: false, error: "Bad console key" });
  next();
};
const bad = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg });

/* The last 50 runs, newest first, kept in memory. */
const runs = [];
const keepRun = (r) => { runs.unshift(r); if (runs.length > 50) runs.length = 50; return r; };

/** @username, email or id of a LEARNER (and on the allow-list when one is set). */
async function resolveLearner(raw) {
  const s = String(raw || "").trim();
  if (!s) throw Object.assign(new Error("Which test learner? Pass learner: @username, email or id."), { status: 400 });
  const cols = "id, full_name, username, email, role";
  const q = /^[0-9a-f-]{36}$/i.test(s) ? db.from("users").select(cols).eq("id", s)
    : s.includes("@") && !s.startsWith("@") ? db.from("users").select(cols).ilike("email", s)
    : db.from("users").select(cols).ilike("username", s.replace(/^@/, ""));
  const { data } = await q.limit(1);
  const u = data?.[0];
  if (!u) throw Object.assign(new Error(`No account found for "${s}".`), { status: 404 });
  if (!["student", "learner"].includes(String(u.role || "").toLowerCase())) {
    throw Object.assign(new Error(`${u.username || u.email} isn't a learner account.`), { status: 400 });
  }
  const allow = String(process.env.AGENT_CONSOLE_LEARNERS || "").split(",").map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (allow.length && !allow.includes(String(u.username || "").toLowerCase()) && !allow.includes(String(u.email || "").toLowerCase())) {
    throw Object.assign(new Error(`${u.username || u.email} isn't on AGENT_CONSOLE_LEARNERS — only listed test learners can be used.`), { status: 403 });
  }
  return { id: u.id, name: u.full_name || u.username, username: u.username, role: u.role };
}
const fail = (res, e) => res.status(e.status || 500).json({ success: false, error: e.message || String(e) });

router.get("/status", guard, asyncHandler(async (_req, res) => {
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
}));

/* Which tool would the agent pick? No learner, nothing runs — the cheapest check. */
router.post("/pick", guard, asyncHandler(async (req, res) => {
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
}));

/* One real Agent Chat turn as the test learner. */
router.post("/chat", guard, asyncHandler(async (req, res) => {
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
}));

/* One tool, directly. */
router.post("/tool", guard, asyncHandler(async (req, res) => {
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
}));

router.get("/logs", guard, (req, res) => {
  res.json({ success: true, data: readLogs({ since: req.query.since, filter: req.query.filter, level: req.query.level, limit: req.query.limit }) });
});

router.get("/runs", guard, (_req, res) => {
  res.json({ success: true, data: runs.map((r) => ({ id: r.id, kind: r.kind, at: r.at, mode: r.mode, prompt: r.prompt, tool: r.tool, ms: r.ms, ok: !r.error && !(r.result?.error || r.result?.threw) })) });
});
router.get("/runs/:id", guard, (req, res) => {
  const r = runs.find((x) => x.id === req.params.id);
  return r ? res.json({ success: true, data: r }) : bad(res, "No such run (runs live in memory and reset on restart).", 404);
});

/* The console page. */
router.get("/", guard, (req, res) => {
  const key = String(req.query.key || "").replace(/[^\w.-]/g, "");
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent console</title><style>
body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#f7f7fb;color:#1a1a2e}h1{font-size:18px}
.card{background:#fff;border:1px solid #e3e3ee;border-radius:12px;padding:14px;margin:0 0 12px}
input,textarea,select{width:100%;box-sizing:border-box;padding:9px;border:1px solid #d5d5e3;border-radius:8px;font:inherit;margin:4px 0 8px}
button{padding:9px 14px;border:0;border-radius:8px;background:#6C3BFF;color:#fff;font-weight:600;cursor:pointer;margin-right:6px}
button.alt{background:#eee;color:#1a1a2e}pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:#11111b;color:#e4e4ef;padding:10px;border-radius:8px;max-height:420px;overflow:auto}
.row{display:flex;gap:8px}.row>*{flex:1}
</style></head><body><h1>Agent console — learner Agent Chat</h1>
<div class="card"><div class="row"><div><label>Test learner</label><input id="learner" placeholder="@testlearner"></div>
<div><label>Mode</label><select id="mode"><option value="dry">dry — nothing changes</option><option value="live">live — tools run for real</option></select></div></div>
<label>Prompt</label><textarea id="prompt" rows="3" placeholder="Are there any battles I can join?"></textarea>
<button onclick="go('chat')">Send to agent</button><button class="alt" onclick="go('pick')">Which tool? (pick only)</button><button class="alt" onclick="logs()">Logs</button></div>
<div class="card"><pre id="out">Ready.</pre></div>
<script>const K=${JSON.stringify(key)};const H={'Content-Type':'application/json','x-agent-console-key':K};
async function go(kind){const out=document.getElementById('out');out.textContent='Running…';
const body={prompt:document.getElementById('prompt').value,learner:document.getElementById('learner').value,mode:document.getElementById('mode').value};
const r=await fetch('/api/agent-console/'+kind,{method:'POST',headers:H,body:JSON.stringify(body)});out.textContent=JSON.stringify(await r.json(),null,2);}
async function logs(){const r=await fetch('/api/agent-console/logs?filter=agent-chat',{headers:H});document.getElementById('out').textContent=JSON.stringify(await r.json(),null,2);}
</script></body></html>`);
});

export default router;
