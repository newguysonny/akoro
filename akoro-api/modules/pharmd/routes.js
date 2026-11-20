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
 *
 * UNIFIED READS: since migrations/2026-pharmd-unified.sql, the four data
 * endpoints first try the generic Program Courses tables (the programme
 * with source='pharmd') — the rows the admin Program Courses section
 * edits — and fall back to the legacy pharmd_* tables only when no
 * unified programme exists or AKORO_PHARMD_UNIFIED=false. See the
 * "Unified read path" section below.
 */
import { Router }             from "express";
import db                     from "../../db.js";
import { authenticateToken }  from "../auth/index.js";
import { runPharmdUpload }    from "./uploader.js";
import { safeCompare } from "../../lib/safeCompare.js";
import { openai, OPENAI_MODEL } from "../../lib/aiModel.js";
import { buildAskMessages, extractCitations, cleanModelOutput, createPresignedDownload, recordsStorageEnabled, readFileObject } from "../records/index.js";
import { pharmdContentKey } from "../../lib/contentKey.js";

const edu = () => db.schema("edu");

const router = Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok  = (res, data)  => res.json({ success: true, data });
const bad = (res, m)     => res.status(400).json({ success: false, error: m });
const missing = (res, m) => res.status(404).json({ success: false, error: m });

/* The URL a learner opens a topic PDF with.
   A stored public URL is only correct while the object is genuinely public:
   a seeded or admin-uploaded file can live in a private bucket, and the
   catalogue then hands out a 403 link the reader reports as "Failed to
   fetch". Sign on read instead — R2 first (the catalogue uploader and the
   records store share the bucket), then the Supabase bucket, and only fall
   back to the stored/public URL when neither can sign. */
const FILE_URL_TTL = 6 * 3600;   // outlasts a study sitting, like record downloads

/* The object key inside a stored URL: R2 public/presigned URLs look like
   /<bucket>/<key>, Supabase like /storage/v1/object/public/<bucket>/<key>.
   The catalogue's rows do not always keep the same key the uploader wrote
   (seeded rows can store a generated name), so the URL is a candidate too. */
function keyFromUrl(u) {
  try {
    const url = new URL(u);
    const all = url.pathname.replace(/^\/+/, "");
    // Virtual-hosted R2: the bucket is the subdomain, so the whole path is key.
    if (/\.r2\.cloudflarestorage\.com$/i.test(url.hostname)) return all || null;
    const parts = all.split("/");
    const i = parts.findIndex((seg) => seg === "public" || seg === "sign");
    return (i >= 0 ? parts.slice(i + 2) : parts.slice(1)).join("/") || null;   // path-style: drop bucket
  } catch { return null; }
}

/* The bucket a stored URL points into. R2 URLs are
   <bucket>.<account>.r2.cloudflarestorage.com/<key>; a path-style or Supabase
   URL keeps it as the first path segment (after /public/). The catalogue rows
   were uploaded through more than one store, so the bucket in the row wins
   over the configured one. */
function bucketFromUrl(u) {
  try {
    const host = new URL(u).hostname;
    const r2 = host.match(/^([a-z0-9-]+)\.([a-z0-9]+\.r2\.cloudflarestorage\.com)$/i);
    if (r2) return r2[1];
    const parts = new URL(u).pathname.replace(/^\/+/, "").split("/");
    const i = parts.indexOf("public");
    return (i >= 0 ? parts[i + 1] : parts[0]) || null;
  } catch { return null; }
}

async function resolveFileUrl(bucket, path, storedUrl) {
  const keys = [...new Set([path, storedUrl ? keyFromUrl(storedUrl) : null].filter(Boolean))];
  // Supabase first: the uploader creates "pharmd-courses" as a public bucket,
  // and its signer is the one configured wherever R2 is not.
  for (const key of keys) {
    try {
      const { data } = await db.storage.from(bucket || "pharmd-courses").createSignedUrl(key, FILE_URL_TTL);
      if (data?.signedUrl) return data.signedUrl;
    } catch (err) {
      console.error("[pharmd] could not sign file url (supabase):", key, err?.message || err);
    }
  }
  // R2 only when it is actually configured - without a bucket name the SDK
  // returns a bucket-less URL that 404s, which is worse than the stored one.
  if (recordsStorageEnabled()) {
    const urlBucket = storedUrl ? bucketFromUrl(storedUrl) : null;
    for (const key of keys) {
      for (const b of [urlBucket, undefined]) {
        try {
          return await createPresignedDownload(key, b ? { bucket: b } : undefined);
        } catch (err) {
          console.error("[pharmd] could not sign file url (r2)", b || "(configured)", key, err?.message || err);
        }
      }
    }
  }
  return storedUrl || publicFileUrl(bucket, path);
}

const publicFileUrl = (bucket, path) =>
  path ? db.storage.from(bucket || "pharmd-courses").getPublicUrl(path).data.publicUrl : null;

/* Catalogue PDFs are served by the API. A signed third-party URL is useless
   when that bucket has no CORS for the app origins (R2 in the sandbox):
   the browser refuses the fetch even though curl gets 200. The API streams
   the bytes instead — same origin as every other call, cacheable, and it can
   read whichever store the row actually lives in. */
function topicFileUrl(req, id) {
  return id ? `${req.protocol}://${req.get("host")}/api/pharmd/topics/${id}/file` : null;
}

router.get("/topics/:id/file", asyncHandler(async (req, res) => {
  const id = req.params.id;
  // programme_materials has no file_bucket column: the unified catalogue
  // lives in "pharmd-courses"; the legacy table carries its own bucket.
  const uni = await edu().from("programme_materials")
    .select("file_path, url").eq("id", id).maybeSingle();
  let row = uni.data;
  if (!row) {
    const legacy = await edu().from("pharmd_topics")
      .select("file_bucket, file_path").eq("id", id).maybeSingle();
    row = legacy.data;
  }
  if (!row) return missing(res, "Topic not found");
  const keys = [...new Set([row.file_path, row.url ? keyFromUrl(row.url) : null].filter(Boolean))];
  const urlBucket = row.url ? bucketFromUrl(row.url) : null;
  const supabaseBuckets = [...new Set([row.file_bucket, "pharmd-courses"].filter(Boolean))];

  for (const key of keys) {
    for (const bucket of supabaseBuckets) {
      try {
        const { data, error } = await db.storage.from(bucket).download(key);
        if (!error && data) {
          res.set("Content-Type", data.type || "application/pdf");
          res.set("Cache-Control", "public, max-age=3600");
          return res.send(Buffer.from(await data.arrayBuffer()));
        }
      } catch { /* try the next store */ }
    }
  }
  for (const key of keys) {
    try {
      const { body, contentType } = await readFileObject(key, urlBucket ? { bucket: urlBucket } : undefined);
      res.set("Content-Type", contentType || "application/pdf");
      res.set("Cache-Control", "public, max-age=3600");
      return res.send(body);
    } catch { /* try the next key */ }
  }
  return missing(res, "This document is not available right now");
}));

/* ── Unified read path ─────────────────────────────────────────────────────
   The generic tables are the source of truth: status gates at every level
   (an unpublished programme/course/material never leaves), topic ids in
   responses are MATERIAL ids, and progress lives in
   edu.programme_material_progress (backfilled from pharmd_topic_progress).
   Each serve* returns true when it answered (including a deliberate 404),
   false when there is no unified programme and the legacy handler runs. */
const UNIFIED_OFF = () => process.env.AKORO_PHARMD_UNIFIED === "false";
const MIME_BY_TYPE = { pdf: "application/pdf", video: "video/mp4", audio: "audio/mpeg", note: "text/plain", link: "text/html", slides: "application/vnd.ms-powerpoint" };
const parseMinutes = (meta) => { const m = String(meta || "").match(/^(\d+)\s*min\b/i); return m ? Number(m[1]) : null; };
const parseSizeBytes = (meta) => {
  const m = String(meta || "").match(/^([\d.]+)\s*(MB|KB|GB)\b/i);
  if (!m) return null;
  const mult = { KB: 1024, MB: 1048576, GB: 1073741824 }[m[2].toUpperCase()] || 1048576;
  return Math.round(Number(m[1]) * mult);
};

async function unifiedProgrammeRow() {
  const { data } = await edu().from("programmes")
    .select("id, name, code, description, status")
    .eq("source", "pharmd").eq("code", "PHARMD").maybeSingle();
  return data ?? null;
}

async function serveUnifiedProgramme(res) {
  const gp = await unifiedProgrammeRow();
  if (!gp) return false;
  if (gp.status !== "published") { missing(res, "That programme is not published"); return true; }
  const [{ data: sections }, { data: courses }] = await Promise.all([
    edu().from("programme_sections").select("id, name, position").eq("programme_id", gp.id).order("position"),
    edu().from("programme_courses").select("id, section_id, code, title").eq("programme_id", gp.id).eq("status", "published").order("position"),
  ]);
  const ids = (courses ?? []).map((c) => c.id);
  const { data: mats } = ids.length
    ? await edu().from("programme_materials").select("course_id").in("course_id", ids).eq("status", "published")
    : { data: [] };
  const countByCourse = new Map();
  for (const row of mats ?? []) countByCourse.set(row.course_id, (countByCourse.get(row.course_id) ?? 0) + 1);
  ok(res, {
    programme: { code: gp.code, name: gp.name, subtitle: gp.description || null },
    years: (sections ?? []).map((sec, i) => ({
      number: i + 1,
      label: sec.name,
      courses: (courses ?? []).filter((c) => c.section_id === sec.id).map((c) => ({
        id: c.id, code: c.code, title: c.title || c.code, topics: countByCourse.get(c.id) ?? 0,
      })),
    })),
  });
  return true;
}

async function serveUnifiedCourse(req, res, code) {
  const gp = await unifiedProgrammeRow();
  if (!gp) return false;
  if (gp.status !== "published") { missing(res, "Course not found"); return true; }
  const { data: course } = await edu().from("programme_courses")
    .select("id, code, title").eq("programme_id", gp.id).eq("code", code).eq("status", "published").maybeSingle();
  if (!course) { missing(res, "Course not found"); return true; }
  const { data: materials } = await edu().from("programme_materials")
    .select("id, position, title, type, meta, url, file_path, file_hash, file_size, read_minutes")
    .eq("course_id", course.id).eq("status", "published").order("position").order("created_at");
  ok(res, {
    course: { id: course.id, code: course.code, title: course.title || course.code },
    topics: (materials ?? []).map((m) => ({
      id: m.id,
      position: m.position,
      title: m.title,
      read_minutes: m.read_minutes ?? parseMinutes(m.meta),
      mime: MIME_BY_TYPE[m.type] || "application/pdf",
      size: m.file_size ?? parseSizeBytes(m.meta),
      file_url: topicFileUrl(req, m.id),
      file_hash: m.file_hash || null,
      contentKey: m.file_path ? pharmdContentKey({ file_path: m.file_path, file_hash: m.file_hash }) : null,
    })),
  });
  return true;
}

async function serveUnifiedProgress(req, res) {
  const gp = await unifiedProgrammeRow();
  if (!gp) return false;
  const { data } = await edu().from("programme_material_progress")
    .select("material_id").eq("user_id", req.user.id).eq("done", true);
  ok(res, { done: (data ?? []).map((r) => r.material_id) });
  return true;
}

async function serveUnifiedComplete(req, res) {
  const gp = await unifiedProgrammeRow();
  if (!gp) return false;
  const done = req.body?.done !== false;
  const { data: material } = await edu().from("programme_materials")
    .select("id, course_id").eq("id", req.params.id).maybeSingle();
  const { data: course } = material
    ? await edu().from("programme_courses").select("id").eq("id", material.course_id).eq("programme_id", gp.id).maybeSingle()
    : { data: null };
  if (!material || !course) { missing(res, "Topic not found"); return true; }
  if (done) {
    const { error } = await edu().from("programme_material_progress").upsert({
      user_id: req.user.id, material_id: material.id, done: true, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,material_id" });
    if (error) { bad(res, "Could not save that — try again."); return true; }
  } else {
    const { error } = await edu().from("programme_material_progress")
      .delete().eq("user_id", req.user.id).eq("material_id", material.id);
    if (error) { bad(res, "Could not save that — try again."); return true; }
  }
  ok(res, { topic_id: material.id, done });
  return true;
}

/* ── Programme tree — the browse view ─────────────────────────── */
router.get("/programme", asyncHandler(async (_req, res) => {
  if (!UNIFIED_OFF() && (await serveUnifiedProgramme(res))) return;
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
  if (!UNIFIED_OFF() && (await serveUnifiedCourse(req, res, req.params.code))) return;
  const { data: course } = await edu().from("pharmd_courses")
    .select("id, code, title, programme_id").eq("code", req.params.code).maybeSingle();
  if (!course) return missing(res, "Course not found");

  const { data: topics } = await edu().from("pharmd_topics")
    .select("id, position, title, read_minutes, file_bucket, file_path, file_mime, file_size, file_hash")
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
      file_url: topicFileUrl(req, t.id),
      file_hash: t.file_hash || null,
      // Shared extraction key: the parse is cached once per file and every
      // learner reads the same markdown (the workbook is public catalogue
      // content). Versioned by the file hash so a replaced PDF is a new key.
      contentKey: pharmdContentKey(t),
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
  if (!UNIFIED_OFF() && (await serveUnifiedProgress(req, res))) return;
  const { data } = await edu().from("pharmd_topic_progress")
    .select("topic_id").eq("user_id", req.user.id).eq("done", true);
  ok(res, { done: (data ?? []).map((r) => r.topic_id) });
}));

router.post("/topics/:id/complete", asyncHandler(async (req, res) => {
  if (!UNIFIED_OFF() && (await serveUnifiedComplete(req, res))) return;
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
