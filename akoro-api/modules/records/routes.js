/**
 * modules/records/routes.js  —  Akoro Records Module (learner library)
 *
 * The learner's own shelf of study material on the Library page:
 * uploaded files (PDF / text / image / audio / video), saved links and
 * pasted text. The shelf started device-local (localStorage, details
 * only — the file's bytes were never kept, so nothing could actually be
 * opened). Records now live on the server and follow the learner across
 * devices:
 *
 *   POST   /api/records/upload-url   → presign an upload PUT — R2, or the
 *                                       Supabase Storage fallback for files
 *                                       ≤ 5 MB when R2 isn't configured
 *                                       (bytes still bypass this API)
 *   POST   /api/records              → register the record (upload after
 *                                       its PUT, or a link, or a paste)
 *   GET    /api/records              → my shelf, newest first; uploads
 *                                       carry a 6h presigned fileUrl
 *   GET    /api/records/discover     → the Contents/Materials feed —
 *                                       every learner's uploads + pasted
 *                                       notes, Premium subscribers' stay
 *                                       private; METADATA only, no
 *                                       presigning (bytes cost nothing
 *                                       until someone opens a record)
 *   GET    /api/records/discover/:id/open → presign a discovered upload,
 *                                       or return a paste's full text —
 *                                       one call per open
 *   PATCH  /api/records/:id          → progress (10 on first open, 100
 *                                       on mark-done — self-reported)
 *   DELETE /api/records/:id          → row + best-effort R2 object
 *   GET    /api/records/:id/file     → 302 to a presigned download
 *   GET    /api/records/folders      → my folders, newest first
 *   POST   /api/records/folders      → create one (name, description,
 *                                       visibility, coverKey) — covers
 *                                       presign via /upload-url with
 *                                       purpose 'folder-cover'
 *   PATCH  /api/records/folders/:id  → rename / re-describe / visibility
 *   DELETE /api/records/folders/:id  → row + best-effort cover object
 *
 * A kind='upload' row with no file_key is a legacy device record whose
 * bytes were never captured — the list says so (fileMissing) so the
 * viewer can be honest instead of pretending.
 *
 * Layering: this router only authenticates and wires handlers. service-*.js
 * owns the orchestration, rules.js the pure validation/limits, and
 * store-*.js every Supabase query. Ownership checks (object-key prefixes,
 * record/folder ownership) stay in the service before any read or write.
 *
 * Usage in app.js:
 *   app.use("/api/records", standardLimit, recordsModule);
 */

import { Router } from "express";
import { authenticateToken } from "../auth/index.js";
import { asyncHandler } from "./http.js";
import multer from "multer";
import * as records from "./service-records.js";
import * as folders from "./service-folders.js";
import * as extract from "./service-extract.js";
import * as ask from "./service-ask.js";
import * as guide from "./service-guide.js";
import * as tools from "./service-tools.js";
import * as artifacts from "./service-artifacts.js";
import * as transcribe from "./service-transcribe.js";

const router = Router();

// ─── Uploads and the shelf ──────────────────────────────────────────────────
router.post("/upload-url", authenticateToken, asyncHandler(records.createUploadUrl));
router.post("/", authenticateToken, asyncHandler(records.createRecord));
router.get("/", authenticateToken, asyncHandler(records.listShelf));
router.get("/search", authenticateToken, asyncHandler(records.searchShelf));

/* ── The Contents/Materials discovery feed (Discover hub, higher-ed) ────────
   Everyone's uploaded material — videos, audio, PDFs, images, text files
   and pasted notes — discoverable by the whole community, with the one
   exception the product draws: uploads owned by PREMIUM subscribers never
   appear (their material stays private to them; see access.js). */
router.get("/discover", authenticateToken, asyncHandler(records.listDiscover));
router.get("/discover/:id/open", authenticateToken, asyncHandler(records.openDiscover));
router.get("/discover/:id/file", authenticateToken, asyncHandler(records.openDiscoverFile));

/* ── Folders — the shelf's organization layer ─────────────────────────────
   The create flow ships first ("Add to library" → Create a folder);
   putting items INTO folders lands next. visibility is stored as the
   learner chose it — 'public' folders get their browsing surface when
   the shared library ships, nothing pretends they're browsable today. */
router.get("/folders", authenticateToken, asyncHandler(folders.listFolders));
router.post("/folders", authenticateToken, asyncHandler(folders.createFolder));
router.patch("/folders/:id", authenticateToken, asyncHandler(folders.updateFolder));
router.delete("/folders/:id", authenticateToken, asyncHandler(folders.deleteFolder));

/* ── Folder items ──────────────────────────────────────────────────────────
   Anything can land in a folder: a record, a Pharm.D topic, a course
   lesson, a library shelf item. The display snapshot (title, sub,
   kind, link) is stored at ADD time — the folder page renders without
   re-querying every surface, and an item keeps its shape even if the
   source row later changes. */
router.get("/folders/:id/items", authenticateToken, asyncHandler(folders.listFolderItems));
router.post("/folders/items", authenticateToken, asyncHandler(folders.addFolderItems));

/* ─── AI extraction (hanji-parse-4b on RunPod) — scanned PDFs & images ──────
 *
 * The READER rasterizes pages client-side (pdf.js / the loaded image) and
 * posts them here in ≤16-page batches; each page runs one async RunPod job
 * on the parse worker. NOTE: registered before the generic /:id routes
 * below. Body limit is raised app-wide (app.js) — page JPEGs ride the JSON
 * body, base64'd.
 *
 *   POST /api/records/extract              { recordId|contentKey, pages:≤16 }
 *   GET  /api/records/extract/status       collect the batch's pages
 *   POST /api/records/extract/text         free stored-text read (retry)
 *   GET  /api/records/extract/:recordId    cached extraction (your record)
 *   GET  /api/records/extract/content/:key cached extraction (shared file)
 */
router.post("/extract", authenticateToken, asyncHandler(extract.submitExtract));
router.get("/extract/status", authenticateToken, asyncHandler(extract.extractStatus));
router.post(["/extract/text", "/extract/office"], authenticateToken, asyncHandler(extract.extractText));
router.get("/extract/:recordId", authenticateToken, asyncHandler(extract.getRecordExtraction));
router.get("/extract/content/:key", authenticateToken, asyncHandler(extract.getContentExtraction));

// ─── Ask: questions about ONE document, answered with citations ─────────────
router.post("/ask", authenticateToken, asyncHandler(ask.ask));

// ─── Guide: learning with a guide teacher ───────────────────────────────────
router.post("/guide", authenticateToken, asyncHandler(guide.guide));
router.get("/guide/history", authenticateToken, asyncHandler(guide.guideHistory));

// ─── Reader tools and study material ────────────────────────────────────────
router.post("/tools/:tool", authenticateToken, asyncHandler(tools.runTool));
router.post("/podcast", authenticateToken, asyncHandler(artifacts.createPodcast));
router.get("/podcast/:id", authenticateToken, asyncHandler(artifacts.getPodcast));
router.get("/artifacts", authenticateToken, asyncHandler(artifacts.listArtifacts));
router.post("/artifacts", authenticateToken, asyncHandler(artifacts.createArtifact));
router.patch("/artifacts/:id", authenticateToken, asyncHandler(artifacts.patchArtifact));
router.delete("/artifacts/:id", authenticateToken, asyncHandler(artifacts.deleteArtifact));

/* GET /api/records/ask/history?recordId=|contentKey= — the learner's thread. */
router.get("/ask/history", authenticateToken, asyncHandler(ask.askHistory));

// ─── Generic record routes (after every fixed path above) ───────────────────
router.patch("/:id", authenticateToken, asyncHandler(records.patchRecord));
router.delete("/:id", authenticateToken, asyncHandler(records.deleteRecord));

/* ─── Audio/video transcription (ffmpeg 16k-mono → Deepgram, scene frames
 * → captions) — the Fortizo §5 lane ─────────────────────────────────────────
 *
 *   POST /api/records/transcribe            { recordId } → job started
 *   GET  /api/records/transcribe/:recordId  { job, transcript }
 *   GET  /api/records/transcribe/lesson/:lessonId
 *   GET  /api/records/transcribe/content/:key
 */
router.post("/transcribe", authenticateToken, asyncHandler(transcribe.startTranscription));
router.get("/transcribe/lesson/:lessonId", authenticateToken, asyncHandler(transcribe.getLessonTranscription));
router.get("/transcribe/:recordId", authenticateToken, asyncHandler(transcribe.getRecordTranscription));
router.get("/transcribe/content/:key", authenticateToken, asyncHandler(transcribe.getContentTranscription));

// ─── GET /api/records/:id/file — stable download seam (302 → presigned) ─────
// The viewer streams from the list's presigned fileUrl; this endpoint is the
// friendly "save a copy" link (cookies auth it, the store serves the bytes).
router.get("/:id/file", authenticateToken, asyncHandler(records.openFile));
// The fallback when a browser cannot PUT to the store (bucket without CORS).
// 25 MB in memory is plenty for the fallback; large media uses the presigned
// path wherever the bucket allows it.
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
router.post("/upload", authenticateToken, uploadMem.single("file"), asyncHandler(records.uploadFile));

export default router;
