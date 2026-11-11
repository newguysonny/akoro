/**
 * modules/pharmd/routes.js — the PHARM.D programme catalogue API
 *
 * Backs the learner app's Pharm D discovery pages with the tables
 * seeded by migrations/2026-pharmd-courses.sql and filled by
 * scripts/upload-pharmd-courses.mjs:
 *
 *   GET  /programme           → the programme tree: years → courses
 *                               with topic counts. Public — a course
 *                               catalogue is browseable like
 *                               /api/courses/published.
 *   GET  /courses/:code       → one course + its topics, each with
 *                               the public PDF url. Public.
 *   GET  /progress            → my completed topic ids (learner).
 *   POST /topics/:id/complete → mark a topic done / undone
 *                               ({ done: true|false }). Learner.
 *
 * Plus the admin upload console (see the section below): the
 * uploader engine (./uploader.js) behind a PHARMD_UPLOAD_KEY
 * shared secret, so the topic PDFs can be loaded from a browser
 * against the deployed environment.
 *
 * Everything below /programme and /courses/:code is behind
 * authenticateToken — completion is per-learner state
 * (edu.pharmd_topic_progress), and the frontend reads it once for
 * the whole programme (the folder's done-checks).
 *
 * Mounted at /api/pharmd (app.js).
 */
import { Router }             from "express";
import db                     from "../../db.js";
import { authenticateToken }  from "../auth/routes.js";
import { runPharmdUpload }    from "./uploader.js";
import { safeCompare } from "../../lib/safeCompare.js";
import { openai, OPENAI_MODEL } from "../../lib/aiModel.js";
import { buildAskMessages, extractCitations, cleanModelOutput } from "../records/askLib.js";

const edu = () => db.schema("edu");

const router = Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok  = (res, data)  => res.json({ success: true, data });
const bad = (res, m)     => res.status(400).json({ success: false, error: m });
const missing = (res, m) => res.status(404).json({ success: false, error: m });

/* The public URL of a topic's PDF — bucket objects are public, so
   this is a pure string build (no storage round-trip). */
const publicFileUrl = (bucket, path) =>
  path ? db.storage.from(bucket || "pharmd-courses").getPublicUrl(path).data.publicUrl : null;

/* ── Programme tree — the browse view ─────────────────────────── */
router.get("/programme", asyncHandler(async (_req, res) => {
  const { data: programme } = await edu().from("pharmd_programmes")
    .select("id, code, name, subtitle").eq("code", "PHARMD").maybeSingle();
  if (!programme) return bad(res, "No PHARM.D programme yet — run the migrations.");

  const [{ data: years }, { data: courses }] = await Promise.all([
    edu().from("pharmd_years").select("id, number, label")
      .eq("programme_id", programme.id).order("number"),
    edu().from("pharmd_courses").select("id, code, title, year_id, sort_order")
      .eq("programme_id", programme.id).order("sort_order"),
  ]);

  // Topic counts per course in one query (the pilot is ~130 rows).
  const ids = (courses ?? []).map((c) => c.id);
  const { data: topicRows } = ids.length
    ? await edu().from("pharmd_topics").select("course_id").in("course_id", ids)
    : { data: [] };
  const countByCourse = new Map();
  for (const row of topicRows ?? []) countByCourse.set(row.course_id, (countByCourse.get(row.course_id) ?? 0) + 1);

  ok(res, {
    programme: { code: programme.code, name: programme.name, subtitle: programme.subtitle },
    years: (years ?? []).map((y) => ({
      number: y.number,
      label: y.label,
      courses: (courses ?? []).filter((c) => c.year_id === y.id).map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title || c.code,
        topics: countByCourse.get(c.id) ?? 0,
      })),
    })),
  });
}));

/* ── One course + its topics — the folder view ────────────────── */
router.get("/courses/:code", asyncHandler(async (req, res) => {
  const { data: course } = await edu().from("pharmd_courses")
    .select("id, code, title, programme_id").eq("code", req.params.code).maybeSingle();
  if (!course) return missing(res, "Course not found");

  const { data: topics } = await edu().from("pharmd_topics")
    .select("id, position, title, read_minutes, file_bucket, file_path, file_mime, file_size")
    .eq("course_id", course.id).order("position");

  ok(res, {
    course: { id: course.id, code: course.code, title: course.title || course.code },
    topics: (topics ?? []).map((t) => ({
      id: t.id,
      position: t.position,
      title: t.title,
      read_minutes: t.read_minutes,
      mime: t.file_mime,
      size: t.file_size,
      file_url: publicFileUrl(t.file_bucket, t.file_path),
    })),
  });
}));

/* ── Admin upload console — the uploader as a URL ────────────────
   The topic PDFs (~89 MB of zips) ship in the repo's reference/
   folder, and the deployed API already holds the real Supabase
   credentials — so this runs the shared engine (./uploader.js)
   server-side. No local .env, no SSH: open the console in a
   browser, dry-run, then upload.

   Guarded by a shared secret, not learner auth: set
   PHARMD_UPLOAD_KEY in the environment and pass it as ?key= (or
   the X-Pharmd-Upload-Key header). Until the env is set the
   console 404s — disabled by default.

     GET  /admin/upload          the console page (open in a browser)
     GET  /admin/upload/status   JSON — running job / last result + log
     POST /admin/upload          { dryRun?, only? } starts the job
                                 (409 while one is running)

   The job runs in the background (single instance,
   WEB_CONCURRENCY=1), so no request ever hangs on an 89 MB upload. */
const uploadGuard = (req, res, next) => {
  const want = process.env.PHARMD_UPLOAD_KEY;
  if (!want) return missing(res, "Upload console not configured — set PHARMD_UPLOAD_KEY");
  const got = req.get("x-pharmd-upload-key") || req.query.key;
  if (!safeCompare(got, want)) return res.status(401).json({ success: false, error: "Bad upload key" });
  next();
};

let uploadJob = null;
const jobSnapshot = () => uploadJob && {
  running: uploadJob.running, dryRun: uploadJob.dryRun, only: uploadJob.only,
  startedAt: uploadJob.startedAt, finishedAt: uploadJob.finishedAt,
  result: uploadJob.result, log: uploadJob.log,
};
const startUploadJob = (dryRun, only) => {
  const job = { running: true, dryRun, only, startedAt: new Date().toISOString(), finishedAt: null, log: [], result: null };
  const onLog = (line) => {
    job.log.push(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
    if (job.log.length > 500) job.log.shift();   // keep the tail only
  };
  runPharmdUpload({ dryRun, only, onLog })
    .then((result) => { job.result = result; })
    .catch((err) => { job.result = { ok: false, error: err.message, failures: [err.message] }; })
    .finally(() => { job.running = false; job.finishedAt = new Date().toISOString(); });
  uploadJob = job;
};

router.get("/admin/upload/status", uploadGuard, (_req, res) => ok(res, { job: jobSnapshot() }));

router.post("/admin/upload", uploadGuard, asyncHandler(async (req, res) => {
  if (uploadJob?.running) {
    return res.status(409).json({ success: false, error: "An upload is already running — watch the log", job: jobSnapshot() });
  }
  const dryRun = req.body?.dryRun !== false;   // absent = dry run, the safe default
  const only = typeof req.body?.only === "string" && req.body.only.trim() ? req.body.only.trim() : null;
  startUploadJob(dryRun, only);
  ok(res, { job: jobSnapshot() });
}));

router.get("/admin/upload", uploadGuard, (_req, res) => { res.type("html").send(CONSOLE_HTML); });

/* The console page — served by the API, so it's same-origin and
   needs no build step. The key is read from the page URL client-side
   (never echoed server-side), and the log renders as textContent —
   nothing from the job is ever innerHTML'd. */
const CONSOLE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Pharm.D upload console</title>
<style>
  body{font-family:ui-monospace,Menlo,Consolas,monospace;background:#0F172A;color:#E2E8F0;max-width:860px;margin:0 auto;padding:28px 18px}
  h1{font-size:1.05rem;margin:0 0 6px}
  p{color:#94A3B8;font-size:.8rem;margin:0 0 16px}
  #st{color:#7DD3FC}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
  input{flex:1;min-width:200px;background:#1E293B;border:1px solid #334155;color:#E2E8F0;border-radius:8px;padding:9px 12px;font:inherit}
  button{border:none;border-radius:8px;padding:9px 16px;font:inherit;font-weight:700;cursor:pointer}
  #dry{background:#334155;color:#E2E8F0}
  #run{background:#7C3AED;color:#fff}
  button:disabled{opacity:.45;cursor:default}
  #log{background:#1E293B;border:1px solid #334155;border-radius:10px;padding:14px;min-height:180px;max-height:60vh;overflow:auto;white-space:pre-wrap;font-size:.78rem;line-height:1.5}
</style></head><body>
<h1>Pharm.D topic upload</h1>
<p>Loads the reference zips into the pharmd-courses bucket + edu.pharmd_topics. Idempotent — re-running refreshes.</p>
<div id="st">loading…</div>
<div class="row">
  <input id="only" placeholder="Only one course, e.g. BIO 111 (optional)">
  <button id="dry">Dry run</button>
  <button id="run">Upload for real</button>
</div>
<pre id="log"></pre>
<script>
var KEY = new URLSearchParams(location.search).get("key") || "";
var HEADERS = { "x-pharmd-upload-key": KEY, "content-type": "application/json" };
function setText(id, t){ document.getElementById(id).textContent = t; }
async function refresh(){
  try {
    var r = await fetch("/api/pharmd/admin/upload/status", { headers: HEADERS, cache: "no-store" });
    var j = await r.json();
    if (!j.success) { setText("st", j.error || "status failed"); return; }
    var job = (j.data && j.data.job) || null;
    setText("log", (job && job.log) ? job.log.join("\\n") : "(no run yet)");
    var s = job ? (job.running ? "Running…" : "Idle — last run finished " + (job.finishedAt || "?")) : "Never run";
    if (job && job.result) {
      var mb = (job.result.bytes / 1048576).toFixed(1);
      s += " · " + job.result.topics + " topics · " + mb + " MB · " + (job.result.ok ? "OK" : job.result.failures.length + " failure(s)");
      if (job.result.dryRun) s += " · DRY RUN (nothing written)";
    }
    setText("st", s);
    var busy = !!(job && job.running);
    document.getElementById("dry").disabled = busy;
    document.getElementById("run").disabled = busy;
  } catch (e) { setText("st", "status fetch failed: " + e.message); }
}
async function start(dryRun){
  var only = document.getElementById("only").value.trim() || null;
  var r = await fetch("/api/pharmd/admin/upload", { method: "POST", headers: HEADERS, body: JSON.stringify({ dryRun: dryRun, only: only }) });
  var j = await r.json();
  if (!j.success) alert(j.error || "could not start");
  refresh();
}
document.getElementById("dry").onclick = function(){ start(true); };
document.getElementById("run").onclick = function(){ if (confirm("Upload every topic PDF to Supabase? (idempotent — safe to re-run)")) start(false); };
refresh();
setInterval(refresh, 1500);
</script>
</body></html>`;

/* ── Learner state — everything below needs a signed-in learner ── */
router.use(authenticateToken);

/* POST /api/pharmd/ask — "Ask about this" for a Pharm.D topic.
   { question, selection?, documentText?, docName? }
   The programme PDFs are not indexed like Library records, so the reader (which
   already extracts the page text with pdf.js) sends that text + any selected
   passage, and this answers from it with the SAME ask prompt/citations as the
   Library reader. No document-level thread is stored. */
router.post("/ask", asyncHandler(async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) return bad(res, "Ask a question.");
  if (question.length > 1000) return bad(res, "Keep the question short.");
  const sel = req.body?.selection && typeof req.body.selection.text === "string" && req.body.selection.text.trim()
    ? { text: String(req.body.selection.text).trim().slice(0, 4000),
        pageNumber: Number.isInteger(req.body.selection.pageNumber) ? req.body.selection.pageNumber : null }
    : null;
  const docName = String(req.body?.docName || "this topic").slice(0, 120);
  // Prefer PER-PAGE text so citations carry a page number (and jump). The
  // reader sends the pdf.js text per page; a flat documentText is a fallback.
  const rawPages = Array.isArray(req.body?.pages)
    ? req.body.pages.filter((p) => Number.isInteger(p?.pageNumber) && p.pageNumber > 0 && typeof p?.text === "string" && p.text.trim()).slice(0, 200)
    : [];
  const docText = String(req.body?.documentText || "");

  // Candidate chunks (≈1200 chars each), each tagged with its page when known.
  const candidates = [];
  const addChunks = (text, pageNumber) => {
    for (const chunk of (String(text).replace(/\s+/g, " ").match(/[\s\S]{1,1200}(?=\s|$)/g) || [])) {
      const t = chunk.trim();
      if (t) candidates.push({ pageNumber, text: t });
    }
  };
  if (rawPages.length) for (const p of rawPages) addChunks(p.text, p.pageNumber);
  else if (docText) addChunks(docText.slice(0, 80_000), null);

  // Pick the chunks most overlapping the question; if none overlap, the opening pages.
  const qWords = [...new Set(String(question).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3))];
  const scored = candidates.map((c, i) => {
    const low = c.text.toLowerCase();
    return { ...c, i, score: qWords.reduce((n, w) => n + (low.includes(w) ? 1 : 0), 0) };
  });
  const overlapping = scored.filter((c) => c.score > 0);
  const picked = (overlapping.length ? overlapping : scored)
    .slice().sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 10).sort((a, b) => a.i - b.i);

  const passages = [];
  if (sel?.text) passages.push({ n: 1, pageNumber: sel.pageNumber, text: sel.text, quote: sel.text.slice(0, 160) });
  for (const c of picked) passages.push({ n: passages.length + 1, pageNumber: c.pageNumber, text: c.text, quote: c.text.slice(0, 160) });
  if (!passages.length) return res.status(409).json({ success: false, error: "This topic isn't readable yet — try again in a moment." });

  try {
    const messages = buildAskMessages({ docName, passages, question, history: [] });
    const completion = await openai.chat.completions.create({ model: OPENAI_MODEL, temperature: 0.2, max_tokens: 800, messages });
    const answer = cleanModelOutput(completion.choices?.[0]?.message?.content?.trim() || "")
      || "I couldn't answer from this topic — try rephrasing the question.";
    const { citations } = extractCitations(answer, passages);
    return ok(res, { answer, citations });
  } catch (err) {
    console.warn("[pharmd-ask] failed:", String(err?.message || err).slice(0, 200));
    return res.status(502).json({ success: false, error: "Couldn't answer right now — try again in a moment." });
  }
}));

router.get("/progress", asyncHandler(async (req, res) => {
  const { data } = await edu().from("pharmd_topic_progress")
    .select("topic_id").eq("user_id", req.user.id).eq("done", true);
  ok(res, { done: (data ?? []).map((r) => r.topic_id) });
}));

router.post("/topics/:id/complete", asyncHandler(async (req, res) => {
  const done = req.body?.done !== false;   // absent = true (an explicit "mark done")
  const { data: topic } = await edu().from("pharmd_topics")
    .select("id").eq("id", req.params.id).maybeSingle();
  if (!topic) return missing(res, "Topic not found");

  if (done) {
    const { error } = await edu().from("pharmd_topic_progress").upsert({
      user_id: req.user.id, topic_id: topic.id, done: true, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,topic_id" });
    if (error) return bad(res, "Could not save that — try again.");
  } else {
    const { error } = await edu().from("pharmd_topic_progress")
      .delete().eq("user_id", req.user.id).eq("topic_id", topic.id);
    if (error) return bad(res, "Could not save that — try again.");
  }
  ok(res, { topic_id: topic.id, done });
}));

export default router;
