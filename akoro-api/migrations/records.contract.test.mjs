import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Records contract — the Library shelf. A record the learner adds opens as
 * a STUDY SESSION, not a toast: the same reader the teaching session uses
 * (tabs, Generate tools, Q&A) with the actual file as the content. Three
 * pieces must agree for that to be true:
 *
 *   storage  — the bytes live in R2 (presigned PUT up, presigned GET down;
 *              the API never proxies a byte, so 500 MB recordings work)
 *   shelf    — the rows live in edu.records and follow the learner across
 *              devices; legacy device rows migrate as details-only
 *   viewer   — PDF renders as real pages, text paginates, audio/video play
 *              with transport (±10s, seek, 0.75×–2×) in the SHARED toolbar
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [migration, manifest, routes, storage, app, recordsApi, addModal, libraryPage, viewer, player, pdfPages, reader, searchPage, dashboard] = await Promise.all([
  read("2026-records.sql"),
  read("manifest.json"),
  read("../modules/records/routes.js"),
  read("../modules/records/lib/storage.js"),
  read("../app.js"),
  read("../../akoro-learner/src/services/recordsApi.js"),
  read("../../akoro-learner/src/components/dashboard/AddRecordModal.jsx"),
  read("../../akoro-learner/src/pages/LibraryPage.jsx"),
  read("../../akoro-learner/src/components/library/RecordSessionViewer.jsx"),
  read("../../akoro-learner/src/components/library/MediaPlayer.jsx"),
  read("../../akoro-learner/src/components/library/PdfPages.jsx"),
  read("../../akoro-learner/src/components/teaching/SessionReaderModal.jsx"),
  read("../../akoro-learner/src/components/tabs/DiscoverSearchPage.jsx"),
  read("../../akoro-learner/src/pages/LearnerDashboard.jsx"),
]);

test("the shelf is a table that follows the learner, not a device", () => {
  assert.ok(migration.includes("CREATE TABLE IF NOT EXISTS edu.records"), "records table");
  assert.ok(migration.includes("REFERENCES public.users(id) ON DELETE CASCADE"), "row dies with its learner");
  assert.ok(migration.includes("kind IN ('upload', 'link', 'paste')"), "the three record kinds");
  assert.ok(migration.includes("progress BETWEEN 0 AND 100"), "progress is a 0-100 value");
  assert.ok(migration.includes("file_key"), "uploads carry their R2 key");
  assert.ok(migration.includes("url"), "links carry their url");
  assert.ok(migration.includes("content"), "pastes carry their text");
  assert.ok(manifest.includes("2026-records.sql"), "migration is registered in the manifest");
});

test("the bytes never touch the API — presigned up, presigned down", () => {
  assert.ok(routes.includes('"/upload-url"'), "presign endpoint exists");
  assert.ok(routes.includes("recordsStorageEnabled()"), "honest 503 when R2 is not configured");
  assert.ok(storage.includes("records/${userId}/"), "object keys are scoped to the owner");
  assert.ok(storage.includes("createPresignedDownload"), "reads are presigned GETs");
  assert.ok(storage.includes("ResponseContentDisposition"), "downloads carry a friendly filename");
  assert.ok(routes.includes('router.get("/:id/file"'), "stable download seam (302 → presigned)");
  assert.ok(routes.includes("res.redirect(302"), "the seam redirects, it does not stream");
  // The 500 MB guard mirrors the sheet's promise.
  assert.ok(routes.includes("500 * 1024 * 1024"), "500 MB cap on the server");
  assert.ok(recordsApi.includes("putFileTo"), "client PUTs the raw file itself");
  assert.ok(recordsApi.includes("xhr.upload.addEventListener"), "upload progress is real (XHR)");
});

test("one learner can never register another's object", () => {
  assert.ok(routes.includes("fileKey.startsWith(`records/${userId}/`)"), "key must live under the owner's prefix");
  assert.ok(routes.includes('fileKey.includes("..")'), "path traversal rejected");
  assert.ok(routes.includes("existing.user_id !== userId"), "PATCH/DELETE/file check ownership");
});

test("every records route is the learner's own and authed", () => {
  assert.ok(app.includes('app.use("/api/records"'), "mounted in app.js");
  const routeBlocks = routes.split("router.");
  for (const verb of ["post(\"/upload-url\"", "post(\"/\"", "get(\"/\"", "patch(\"/:id\"", "delete(\"/:id\"", "get(\"/:id/file\""]) {
    const block = routeBlocks.find((b) => b.startsWith(verb));
    assert.ok(block, `${verb} route exists`);
    assert.ok(block.slice(0, 200).includes("authenticateToken"), `${verb} requires auth`);
  }
});

test("the old device shelf migrates honestly — details only, never fake bytes", () => {
  assert.ok(routes.includes("body.legacy === true"), "server accepts legacy detail-only rows");
  assert.ok(routes.includes("file_key: fileKey || null"), "a row can admit it has no file");
  assert.ok(routes.includes("fileMissing"), "the list flags which rows have no bytes");
  assert.ok(addModal.includes("legacy: true"), "the sheet migrates old device records");
  assert.ok(addModal.includes("loadLegacy"), "migration reads the old localStorage key once");
  assert.ok(viewer.includes("record.fileMissing"), "the viewer explains a missing file instead of pretending");
});

test("the sheet saves to the server, with real upload progress", () => {
  assert.ok(addModal.includes("presignRecordUpload"), "step 1: presign");
  assert.ok(addModal.includes("putFileTo"), "step 2: PUT the bytes");
  assert.ok(addModal.includes("createRecord({ kind: 'upload', fileKey"), "step 3: register the key");
  assert.ok(addModal.includes("listRecords()"), "the list comes from the server");
  assert.ok(addModal.includes("saved_cloud"), "the sheet says it saves to the library, not the device");
  // localStorage may only be written as migration bookkeeping (returning the
  // not-yet-migrated remainder) — never as the store for a new record.
  assert.ok(addModal.includes("saveLegacy(uid, remaining)"), "the only write returns migration leftovers");
  assert.equal((addModal.match(/localStorage\.setItem/g) || []).length, 1, "exactly one write site — the legacy remainder");
  assert.ok(!addModal.includes("saveRecords("), "the old localStorage store is gone");
});

test("records are first-class on the Library shelf", () => {
  assert.ok(libraryPage.includes("key: 'records'"), "a 'My records' pill");
  assert.ok(libraryPage.includes("RecordCard"), "records render as cards");
  assert.ok(libraryPage.includes("RecordSessionViewer"), "tapping a record opens the session viewer");
  assert.ok(libraryPage.includes("recordFileType"), "cards carry what the file IS (pdf/audio/video/…)");
  assert.ok(libraryPage.includes("setRecordProgress"), "progress is the server's now");
});

test("the session viewer shares the reader's toolbar, tools and tabs", () => {
  // The reader grew optional seams; the teaching session must be unaffected.
  assert.ok(reader.includes("renderPageContent = null"), "custom page renderer seam");
  assert.ok(reader.includes("media = null"), "media pane seam");
  assert.ok(reader.includes("allowTextMarking = true"), "annotate/redact can step aside for canvases");
  assert.ok(viewer.includes("buildSessionReaderPages"), "text records paginate like a session guide");
  assert.ok(viewer.includes("<SessionReaderModal"), "records open in the real reader");
  assert.ok(reader.includes("GenerateGrid"), "the Generate menu still spawns tool tabs");
  assert.ok(reader.includes("CommunityBoard"), "Q&A and Discussion boards still open as tabs");
  assert.ok(viewer.includes("recordDownloadUrl"), "download-to-view for what can't render");
});

test("media records play the ORIGINAL file with real transport", () => {
  assert.ok(player.includes("playbackRate"), "speed control");
  assert.ok(player.includes("RATES = [0.75, 1, 1.25, 1.5, 2]"), "0.75×–2× speeds");
  assert.ok(player.includes("currentTime = Math.max(0, Math.min(el.duration, (el.currentTime || 0) + delta))"), "±10s skip clamps to the clip");
  assert.ok(player.includes("cycleRate"), "the toolbar cycles speed");
  assert.ok(reader.includes("playerApi?.skip(-10)"), "back/forward live in the SHARED toolbar");
  assert.ok(reader.includes("playerApi?.toggle()"), "the toolbar's play button drives the same element");
  assert.ok(player.includes("onPosition"), "watched-through milestones report back");
  assert.ok(viewer.includes("onProgress"), "the viewer forwards milestones to the shelf");
});

test("PDFs render as the actual document, and tools still work", () => {
  assert.ok(pdfPages.includes("pdfjs-dist"), "pdf.js does the rendering");
  assert.ok(pdfPages.includes("GlobalWorkerOptions.workerSrc"), "worker wired for Vite");
  assert.ok(pdfPages.includes("TextLayer"), "a text layer makes pages selectable");
  assert.ok(pdfPages.includes("IntersectionObserver"), "pages render lazily");
  assert.ok(pdfPages.includes("getTextContent"), "page text is extracted");
  assert.ok(viewer.includes("texts.map"), "tool derivation uses the real page text");
  assert.ok(viewer.includes('allowTextMarking={type !== \'pdf\' && type !== \'image\'}'), "canvas/image pages don't offer HTML-only annotate/redact");
});

test("the rest of the app reads the server shelf too", () => {
  assert.ok(searchPage.includes("listRecords"), "discover search finds records from the server");
  assert.ok(!searchPage.includes("akoro_records_"), "no localStorage reads remain in search");
  assert.ok(dashboard.includes("RecordSessionViewer"), "records opened from the dashboard open as sessions");
  assert.ok(dashboard.includes("setRecordProgressApi"), "dashboard progress goes to the server");
});
