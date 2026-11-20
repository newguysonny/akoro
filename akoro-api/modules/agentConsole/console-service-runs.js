import { bad, runs } from "./console-rules.js";

export function listRuns(_req, res) {
  res.json({ success: true, data: runs.map((r) => ({ id: r.id, kind: r.kind, at: r.at, mode: r.mode, prompt: r.prompt, tool: r.tool, ms: r.ms, ok: !r.error && !(r.result?.error || r.result?.threw) })) });
}

export function getRun(req, res) {
  const r = runs.find((x) => x.id === req.params.id);
  return r ? res.json({ success: true, data: r }) : bad(res, "No such run (runs live in memory and reset on restart).", 404);
}

/* Phase 22: the DURABLE execution trace (edu.agent_runs / agent_run_steps). */
export async function executionRuns(req, res) {
  const { listRuns } = await import("../adaptive-learning/index.js");
  res.json({ success: true, data: await listRuns({ limit: req.query.limit }) });
}

export async function executionRun(req, res) {
  const { getAgentRun } = await import("../adaptive-learning/index.js");
  const run = await getAgentRun(req.params.id);
  return run ? res.json({ success: true, data: run }) : bad(res, "No such run.", 404);
}

export async function executionDigests(req, res) {
  const { listFailureDigests } = await import("../adaptive-learning/index.js");
  res.json({ success: true, data: await listFailureDigests({ limit: req.query.limit }) });
}

/* The console page. */
export function consolePage(req, res) {
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
}
