/**
 * modules/hfmirror/routes.js — the Hugging Face mirror console API.
 *
 * Same front-door pattern as the Pharm.D upload console: a shared-key
 * guard, one in-memory job, and a same-origin HTML console that polls a
 * status endpoint. Nothing here needs a signed-in learner — this is an
 * operator surface for copying a HF model repo into the account that
 * owns the HF_TOKEN, straight from the browser.
 *
 *   GET  /api/hf/mirror/status → { job, tokenConfigured, sourceTokenConfigured,
 *                                  maxFileMb, account }
 *   POST /api/hf/mirror        → start { source, target?, private?, revision?,
 *                                  dryRun?, maxFileMb? } (409 while running)
 *   GET  /api/hf/mirror        → the console page (key via ?key=, same
 *                                  as the Pharm.D console)
 *
 * Env:
 *   HF_MIRROR_KEY    — console shared secret (required to arm the routes)
 *   HF_TOKEN         — WRITE token for the destination account (required
 *                      to start a real run; also the default source token)
 *   HF_SOURCE_TOKEN  — optional separate read token for the source repo
 *   HF_MAX_FILE_MB   — optional per-file size cap override
 *
 * The tokens live only in the server env — the console page never sees
 * them, and engine.scrub() keeps anything token-shaped out of the job
 * log the console renders.
 */
import express from "express";
import { DEFAULT_MAX_FILE_MB, parseRepoId, runMirrorJob, scrub } from "./engine.js";
import { whoAmI } from "@huggingface/hub";
import { safeCompare } from "../../lib/safeCompare.js";

const router = express.Router();

const ok   = (res, data, meta = {}) => res.json({ success: true, data, ...meta });

const mirrorGuard = (req, res, next) => {
  const want = process.env.HF_MIRROR_KEY;
  if (!want) return res.status(501).json({ success: false, error: "Mirror console not configured — set HF_MIRROR_KEY" });
  const got = req.get("x-hf-mirror-key") || req.query.key;
  if (!safeCompare(got, want)) return res.status(401).json({ success: false, error: "Bad mirror key" });
  next();
};

/* ── The one job (same shape as the Pharm.D upload job) ─────────────── */
let mirrorJob = null;

const jobSnapshot = () => mirrorJob && {
  running: mirrorJob.running, dryRun: mirrorJob.dryRun,
  source: mirrorJob.source, target: mirrorJob.target, isPrivate: mirrorJob.isPrivate,
  startedAt: mirrorJob.startedAt, finishedAt: mirrorJob.finishedAt,
  result: mirrorJob.result, log: mirrorJob.log.slice(-400),
};

const startMirrorJob = (params) => {
  const job = {
    running: true, dryRun: params.dryRun, source: params.source, target: params.target,
    isPrivate: params.isPrivate, startedAt: new Date().toISOString(), finishedAt: null,
    result: null, log: [],
  };
  runMirrorJob(params, { onLog: (line) => job.log.push(line) })
    .then((summary) => { job.result = summary; })
    .catch((err) => {
      job.log.push(`[hf-mirror] ABORTED: ${scrub(err?.message || err)}`);
      job.result = { ok: false, error: scrub(String(err?.message || err)) };
    })
    .finally(() => { job.running = false; job.finishedAt = new Date().toISOString(); });
  mirrorJob = job;
};

/* The destination account, resolved once per process when the status is
   first polled with a token present — the console shows it so the
   operator can SEE the token works before starting anything. */
let accountCache = { account: null, at: 0 };
async function targetAccount() {
  if (!process.env.HF_TOKEN) return null;
  if (Date.now() - accountCache.at < 10 * 60 * 1000) return accountCache.account;
  try {
    const me = await whoAmI({ accessToken: process.env.HF_TOKEN });
    accountCache = { account: me?.name || null, at: Date.now() };
  } catch {
    accountCache = { account: null, at: Date.now() };   // bad token — shown as null
  }
  return accountCache.account;
}

router.get("/mirror/status", mirrorGuard, asyncHandler(async (req, res) => {
  ok(res, {
    job: jobSnapshot(),
    tokenConfigured: !!process.env.HF_TOKEN,
    sourceTokenConfigured: !!(process.env.HF_SOURCE_TOKEN || process.env.HF_TOKEN),
    maxFileMb: Number(process.env.HF_MAX_FILE_MB) || DEFAULT_MAX_FILE_MB,
    account: await targetAccount(),
  });
}));

router.post("/mirror", mirrorGuard, asyncHandler(async (req, res) => {
  if (!process.env.HF_TOKEN) {
    return res.status(501).json({ success: false, error: "Set HF_TOKEN (a WRITE token for the destination account) first" });
  }
  if (mirrorJob?.running) {
    return res.status(409).json({ success: false, error: "A mirror job is already running — watch the log", job: jobSnapshot() });
  }
  const src = parseRepoId(req.body?.source);
  if (!src.ok) return res.status(400).json({ success: false, error: src.error });
  let target = null;
  if (req.body?.target && String(req.body.target).trim()) {
    const dst = parseRepoId(req.body.target);
    if (!dst.ok) return res.status(400).json({ success: false, error: dst.error });
    target = dst.id;
  }
  const params = {
    source: src.id,
    target,
    isPrivate: req.body?.private !== false,           // absent = private, the safe default
    revision: typeof req.body?.revision === "string" && req.body.revision.trim() ? req.body.revision.trim() : "main",
    dryRun: req.body?.dryRun !== false,               // absent = dry run, the safe default
    maxFileMb: Number(req.body?.maxFileMb) || Number(process.env.HF_MAX_FILE_MB) || DEFAULT_MAX_FILE_MB,
    writeToken: process.env.HF_TOKEN,
    sourceToken: process.env.HF_SOURCE_TOKEN || null,
  };
  startMirrorJob(params);
  ok(res, { job: jobSnapshot() });
}));

router.get("/mirror", mirrorGuard, (_req, res) => { res.type("html").send(CONSOLE_HTML); });

/* Express 5-style async wrap (same helper the other modules define). */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/* ── The console page — served by the API, same-origin, no build step.
   Styled after the Pharm.D upload console. The key rides the URL
   client-side (never echoed server-side); the log renders as
   textContent — nothing from the job is ever innerHTML'd. */
const CONSOLE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>HF mirror console</title>
<style>
  body{font-family:ui-monospace,Menlo,Consolas,monospace;background:#0F172A;color:#E2E8F0;max-width:860px;margin:0 auto;padding:28px 18px}
  h1{font-size:1.05rem;margin:0 0 6px}
  p{color:#94A3B8;font-size:.8rem;margin:0 0 16px}
  #st{color:#7DD3FC}
  #keep{display:none;color:#FBBF24;font-size:.78rem;margin:-6px 0 14px;line-height:1.5}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
  input[type=text]{flex:1;min-width:200px;background:#1E293B;border:1px solid #334155;color:#E2E8F0;border-radius:8px;padding:9px 12px;font:inherit}
  label{font-size:.78rem;color:#94A3B8;display:flex;align-items:center;gap:6px}
  button{border:none;border-radius:8px;padding:9px 16px;font:inherit;font-weight:700;cursor:pointer}
  #dry{background:#334155;color:#E2E8F0}
  #run{background:#16A34A;color:#fff}
  button:disabled{opacity:.45;cursor:default}
  #log{background:#1E293B;border:1px solid #334155;border-radius:10px;padding:14px;min-height:180px;max-height:60vh;overflow:auto;white-space:pre-wrap;font-size:.78rem;line-height:1.5}
</style></head><body>
<h1>Hugging Face model mirror</h1>
<p>Copies a model repo into your account. Main-revision mirrors go as a server-side duplicate on the Hub — no model bytes pass through this server, however big the model. Anything the duplicate can't do (other revisions, or a destination that already exists) falls back to a file-by-file transfer that resumes where it left off. Start with a dry run — it lists everything without touching anything.</p>
<div id="st">loading…</div>
<p id="keep">⏳ Job running — <strong>keep this tab open</strong>: the 10-second polling keeps this service awake (free Render plans sleep after ~15 quiet minutes) and the log live. Closing the tab never cancels the run — but if you're on the free plan, don't leave it closed for long.</p>
<div class="row">
  <input type="text" id="source" placeholder="Source repo — e.g. openai/whisper-large-v3">
  <input type="text" id="target" placeholder="Target name (optional — defaults to your-account/source-name)">
</div>
<div class="row">
  <input type="text" id="revision" placeholder="Revision (default main)" style="max-width:220px">
  <label><input type="checkbox" id="private" checked> Private</label>
  <button id="dry">Dry run</button>
  <button id="run">Mirror for real</button>
</div>
<pre id="log"></pre>
<script>
var KEY = new URLSearchParams(location.search).get("key") || "";
var HEADERS = { "x-hf-mirror-key": KEY, "content-type": "application/json" };
function setText(id, t){ document.getElementById(id).textContent = t; }
function fmt(n){ if(!n) return "0 B"; var u=["B","KB","MB","GB","TB"],i=Math.min(4,Math.floor(Math.log(n)/Math.log(1024))); return (n/Math.pow(1024,i)).toFixed(i?1:0)+" "+u[i]; }
async function refresh(){
  try {
    var r = await fetch("/api/hf/mirror/status", { headers: HEADERS, cache: "no-store" });
    var j = await r.json();
    if (!j.success) { setText("st", j.error || "status failed"); return; }
    var d = j.data || {};
    var s = d.tokenConfigured
      ? "Token configured ✓" + (d.account ? " — mirrors land on @" + d.account : "")
      : "HF_TOKEN not set — add a WRITE token in the Render env first";
    var job = d.job;
    setText("log", (job && job.log && job.log.length) ? job.log.join("\\n") : "(no run yet)");
    if (job) {
      s += job.running ? " · Running…" : " · Idle — last run finished " + (job.finishedAt || "?");
      var res2 = job.result;
      if (res2) {
        if (res2.dryRun) s += " · DRY RUN: " + res2.files + " files · " + fmt(res2.totalBytes) + " → " + res2.target;
        else s += " · " + res2.copied + "/" + res2.files + " files · " + fmt(res2.transferredBytes) + " moved · " + (res2.ok ? "OK" : res2.failures.length + " failure(s)");
      }
    }
    setText("st", s);
    // While a job runs, surface the keep-alive note: this tab's polling is
    // what keeps a free-tier Render service awake (and the log live).
    document.getElementById("keep").style.display = (job && job.running) ? "block" : "none";
    var busy = !!(job && job.running);
    document.getElementById("run").disabled = busy;
  } catch (e) { setText("st", "status fetch failed: " + e.message); }
}
async function start(dryRun){
  var body = {
    source: document.getElementById("source").value.trim(),
    target: document.getElementById("target").value.trim() || null,
    revision: document.getElementById("revision").value.trim() || null,
    private: document.getElementById("private").checked,
    dryRun: !!dryRun
  };
  if (!body.source) { alert("Give the source repo id first — e.g. openai/whisper-large-v3"); return; }
  var r = await fetch("/api/hf/mirror", { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  var j = await r.json();
  if (!j.success) alert(j.error || "could not start");
  refresh();
}
document.getElementById("dry").onclick = function(){
  var v = document.getElementById("source").value.trim();
  if (!v) { alert("Give the source repo id first — e.g. openai/whisper-large-v3"); return; }
  start(false);
};
document.getElementById("run").onclick = function(){
  var v = document.getElementById("source").value.trim();
  if (!v) { alert("Give the source repo id first — e.g. openai/whisper-large-v3"); return; }
  if (confirm("Mirror " + v + " for real? A new repo is created on your account and every file is transferred. (Run a dry run first if you haven't.)")) start();
};
refresh();
setInterval(refresh, 10000);   // throttled on purpose — metered connections
</script>
</body></html>`;

export default router;
