/**
 * modules/records/parseConsole.js — the parse-worker console API.
 *
 * Same front-door pattern as the HF mirror console (modules/hfmirror):
 * a shared-key guard, one same-origin HTML console, JSON in/out. An
 * OPERATOR surface for testing the RunPod hanji-parse endpoint straight
 * from the browser — every Run button is a REAL GPU job, so the routes
 * sit behind a shared key and cost nothing until used.
 *
 *   GET  /api/parse/console/status → { configured, endpointId, keyConfigured, last }
 *   POST /api/parse/console        → { imageBase64 | image_b64, maxNewTokens? }
 *                                    → { blocks, markdown, model, wallMs }
 *   GET  /api/parse/console        → the console page (key via ?key=,
 *                                    same as the Pharm.D / HF consoles)
 *
 * Env:
 *   PARSE_CONSOLE_KEY          — console shared secret (required to arm)
 *   RUNPOD_API_KEY             — RunPod key (required to run)
 *   RUNPOD_PARSE_ENDPOINT_ID   — the serverless parse endpoint
 *
 * The key lives only in the server env — the page reads it from its own
 * URL and echoes it back as the x-parse-console-key header; it is never
 * embedded in the HTML.
 */
import express from "express";
import { parsePageOnRunpod, MAX_IMAGE_B64_CHARS, recordsExtractionEnabled } from "./extractLib.js";

const router = express.Router();

const ok            = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const asyncHandler  = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const consoleGuard = (req, res, next) => {
  const want = process.env.PARSE_CONSOLE_KEY;
  if (!want) return res.status(501).json({ success: false, error: "Parse console not configured — set PARSE_CONSOLE_KEY" });
  const got = req.get("x-parse-console-key") || req.query.key;
  if (got !== want) return res.status(401).json({ success: false, error: "Bad console key" });
  next();
};

/* The last run's one-line outcome — the console's status poll shows it so
   the operator can see the previous attempt (model, blocks, latency or
   the error) without digging through JSON. */
let last = null;

router.get("/console/status", consoleGuard, (_req, res) => {
  ok(res, {
    configured:    recordsExtractionEnabled(),
    endpointId:    process.env.RUNPOD_PARSE_ENDPOINT_ID || null,
    keyConfigured: !!process.env.PARSE_CONSOLE_KEY,
    last,
  });
});

router.post("/console", consoleGuard, asyncHandler(async (req, res) => {
  if (!recordsExtractionEnabled()) {
    return res.status(501).json({ success: false, error: "RunPod extraction is not configured — set RUNPOD_API_KEY and RUNPOD_PARSE_ENDPOINT_ID" });
  }
  const body = req.body || {};
  const raw = String(body.imageBase64 ?? body.image_b64 ?? "");
  if (!raw.trim()) return res.status(400).json({ success: false, error: "imageBase64 is required (a PNG/JPEG page, raw base64 or a data: URI)" });
  // Accept data: URIs — the console's FileReader produces them.
  const b64 = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  if (!b64.trim()) return res.status(400).json({ success: false, error: "imageBase64 carried no payload" });
  if (b64.length > MAX_IMAGE_B64_CHARS) {
    return res.status(413).json({ success: false, error: `Image too large — cap is ~${Math.round(MAX_IMAGE_B64_CHARS / 1024 / 1024)} MB of base64 (one page, not a scan)` });
  }
  const maxNewTokens = Math.min(Math.max(parseInt(body.maxNewTokens, 10) || 4096, 64), 8192);

  const started = Date.now();
  try {
    const out = await parsePageOnRunpod({ imageBase64: b64, maxNewTokens });
    last = { ok: true, model: out.model || null, blocks: out.blocks?.length ?? 0, wallMs: Date.now() - started, at: new Date().toISOString() };
    ok(res, { ...out, wallMs: last.wallMs });
  } catch (err) {
    last = { ok: false, error: String(err?.message || err).slice(0, 300), wallMs: Date.now() - started, at: new Date().toISOString() };
    res.status(502).json({ success: false, error: last.error, wallMs: last.wallMs });
  }
}));

/* ── The console page ──────────────────────────────────────────────────── */

router.get("/console", consoleGuard, (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Parse-worker console</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#0B0D1A;color:#E7E9F5;font:14px/1.5 'Nunito',system-ui,sans-serif}
  main{max-width:860px;margin:0 auto;padding:28px 18px 60px}
  h1{font-size:20px;margin:0 0 4px}h1 span{color:#8B5CFF}
  p.sub{margin:0 0 22px;color:#9AA0BE;font-size:12.5px}
  label{display:block;font-size:11px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#9AA0BE;margin:14px 0 6px}
  input[type=text],input[type=number],textarea{width:100%;box-sizing:border-box;background:#151830;border:1px solid #2A2F55;border-radius:10px;color:#E7E9F5;padding:10px 12px;font:inherit;outline:none}
  textarea{min-height:96px;font-family:ui-monospace,monospace;font-size:12px}
  button{margin-top:16px;background:linear-gradient(135deg,#6C3BFF,#4C1DCC);border:none;border-radius:100px;color:#fff;font:800 13px 'Nunito',sans-serif;padding:12px 26px;cursor:pointer}
  button[disabled]{opacity:.5;cursor:default}
  .status{margin:10px 0 0;font-size:12px;color:#9AA0BE}
  .status b{color:#7CE3A9}
  .status .err{color:#FF8A8A}
  pre{background:#0F1226;border:1px solid #2A2F55;border-radius:12px;padding:14px;overflow:auto;max-height:420px;font-size:12px;line-height:1.55}
  .md{background:#F7F5FF;color:#1B1E32;border-radius:12px;padding:16px;white-space:pre-wrap;font-size:13px}
  input[type=file]{color:#9AA0BE}
</style></head><body><main>
<h1>Parse-worker <span>console</span></h1>
<p class="sub">One page → the RunPod hanji-parse endpoint. Every run is a real GPU job.</p>

<label>Endpoint</label>
<div class="status" id="status">checking…</div>

<label>Page image (PNG/JPEG — one page, not a whole scan)</label>
<input type="file" id="file" accept="image/png,image/jpeg"/>

<label>…or paste base64 / a data: URI</label>
<textarea id="b64" placeholder="iVBORw0KGgo… or data:image/png;base64,…"></textarea>

<label>max_new_tokens</label>
<input type="number" id="tokens" value="4096" min="64" max="8192" step="64"/>

<button id="run" disabled title="Pick an image or paste base64 first">Run parse</button>
<div class="status" id="fileinfo"></div>
<div class="status" id="runstat"></div>

<h1 style="font-size:15px;margin-top:30px">Result</h1>
<pre id="out">—</pre>
<label>Markdown preview</label>
<div class="md" id="md">—</div>

<script>
(function(){
  var key = new URLSearchParams(location.search).get('key') || '';
  var H = { 'x-parse-console-key': key, 'content-type': 'application/json' };
  var $ = function(id){ return document.getElementById(id); };
  var getJson = function(url, opts){
    return fetch(url, opts).then(function(r){
      return r.text().then(function(t){
        try { return JSON.parse(t); }
        catch(_) {
          throw new Error('The server answered with a non-JSON page (HTTP ' + r.status + ') — the API is likely mid-deploy or restarting. Wait a minute and retry.');
        }
      });
    });
  };
  getJson('/api/parse/console/status', { headers: H })
    .then(function(d){
      var data = d.data || {};
      var bits = [];
      bits.push(data.configured ? 'configured ✓ (endpoint <b>' + (data.endpointId||'') + '</b>)' : '<span class="err">NOT configured — set RUNPOD_API_KEY / RUNPOD_PARSE_ENDPOINT_ID on the service</span>');
      if (data.last) bits.push('last run: ' + (data.last.ok ? ('ok · ' + data.last.blocks + ' blocks · ' + data.last.wallMs + 'ms') : ('<span class="err">' + (data.last.error||'failed') + '</span>')));
      $('status').innerHTML = bits.join(' · ');
    })
    .catch(function(){ $('status').textContent = 'status unreachable'; });
  var refresh = function(){
    var v = $('b64').value.trim();
    $('run').disabled = !v;
    $('fileinfo').innerHTML = v
      ? '✓ image ready · ~' + Math.round(v.length * 3 / 4 / 1024) + ' KB'
        + (v.length > 8000000 ? ' · <span class="err">over the ~6 MB cap — shrink or re-export the page</span>' : '')
      : '';
  };
  $('b64').addEventListener('input', refresh);
  $('file').addEventListener('change', function(){
    var f = this.files && this.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function(){ $('b64').value = r.result; refresh(); };
    r.readAsDataURL(f);
  });
  refresh();
  $('run').addEventListener('click', function(){
    var btn = this; btn.disabled = true;
    $('runstat').textContent = 'parsing… (first call on a cold worker loads the model, ~10-20s)';
    $('out').textContent = '—'; $('md').textContent = '—';
    getJson('/api/parse/console', { method:'POST', headers: H,
        body: JSON.stringify({ imageBase64: $('b64').value, maxNewTokens: parseInt($('tokens').value,10) || 4096 }) })
      .then(function(j){ return { s:0, j:j }; })
      .then(function(x){
        $('out').textContent = JSON.stringify(x.j, null, 2);
        var md = x.j && x.j.data && x.j.data.markdown;
        $('md').textContent = md || (x.j && x.j.error) || '—';
        $('runstat').innerHTML = x.j && x.j.success
          ? '<b>done in ' + (x.j.data.wallMs||0) + 'ms</b>'
          : '<span class="err">' + ((x.j && x.j.error) || 'the request failed') + '</span>';
      })
      .catch(function(e){ $('runstat').innerHTML = '<span class="err">' + e + '</span>'; })
      .finally(function(){ btn.disabled = false; });
  });
})();
</script>
</main></body></html>`);

});

export default router;
