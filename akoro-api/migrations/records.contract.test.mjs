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
 *              the API never proxies a byte, so 500 MB recordings work);
 *              without R2, files ≤ 5 MB ride a private Supabase Storage
 *              bucket under the same signed-URL protocol
 *   shelf    — the rows live in edu.records and follow the learner across
 *              devices; legacy device rows migrate as details-only
 *   viewer   — PDF renders as real pages, text paginates, audio/video play
 *              with transport (±10s, seek, 0.75×–2×) in the SHARED toolbar
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [migration, manifest, routes, storage, app, recordsApi, addModal, libraryPage, viewer, player, pdfPages, reader, searchPage, dashboard, configJs, envExample, foldersMigration, createSheet, folderPage, itemsMigration, atfPage, pharmd, parts, courseDetails] = await Promise.all([
  read("2026-records.sql"),
  read("manifest.json"),
  read("../modules/records/routes.js"),
  read("../modules/records/lib/storage.js"),
  read("../app.js"),
  read("../../akoro-learner/src/services/recordsApi.js"),
  read("../../akoro-learner/src/components/dashboard/AddRecordModal.jsx"),
  read("../../akoro-learner/src/pages/LibraryPage.jsx"),
  read("../../akoro-learner/src/components/library/RecordTeachSession.jsx"),
  read("../../akoro-learner/src/components/library/MediaPlayer.jsx"),
  read("../../akoro-learner/src/components/library/PdfPages.jsx"),
  read("../../akoro-learner/src/components/teaching/SessionReaderModal.jsx"),
  read("../../akoro-learner/src/components/tabs/DiscoverSearchPage.jsx"),
  read("../../akoro-learner/src/pages/LearnerDashboard.jsx"),
  read("../config/index.js"),
  read("../.env.example"),
  read("2026-library-folders.sql"),
  read("../../akoro-learner/src/components/library/CreateFolderSheet.jsx"),
  read("../../akoro-learner/src/components/library/LibraryFolderPage.jsx"),
  read("2026-library-folder-items.sql"),
  read("../../akoro-learner/src/components/library/AddToFolderPage.jsx"),
  read("../../akoro-learner/src/components/pharmd/PharmDProgram.jsx"),
  read("../../akoro-learner/src/pages/course-details/parts.jsx"),
  read("../../akoro-learner/src/pages/course-details/CourseDetailsPage.jsx"),
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
  assert.ok(routes.includes("recordsStorageEnabled()"), "honest 503 when R2 is missing and the file is over the fallback cap");
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
  assert.ok(routes.includes("ownsRecordFileKey(fileKey, userId)"), "key must live under the owner's prefix — in either store");
  assert.ok(storage.includes('if (key.includes("..")) return false;'), "path traversal rejected in both stores");
  assert.ok(storage.includes("key.startsWith(`records/${userId}/`) || key.startsWith(`${FALLBACK_PREFIX}${userId}/`)"),
    "both stores scope keys to the owner");
  assert.ok(routes.includes("existing.user_id !== userId"), "PATCH/DELETE/file check ownership");
});

test("no R2 yet? small files still work — the Supabase Storage fallback", () => {
  // The fallback is the same protocol as R2 (signed PUT up, signed GET down,
  // bytes never through the API), so the learner client stays store-agnostic —
  // the Library can be used for real before R2 is wired up.
  assert.ok(storage.includes("MAX_FALLBACK_FILE_BYTES = 5 * 1024 * 1024"), "the fallback is capped at 5 MB");
  assert.ok(routes.includes("if (!recordsStorageEnabled() && bytes > MAX_FALLBACK_FILE_BYTES)"),
    "over the cap without R2 → honest 503, not a mystery failure");
  assert.ok(routes.includes("This deployment has no R2 file storage yet"), "the 503 says what to do about it");
  assert.ok(storage.includes("createSignedUploadUrl(key)"), "fallback uploads are signed Supabase PUTs — bytes still bypass the API");
  assert.ok(storage.includes("createSignedUrl(fileKey, DOWNLOAD_TTL_SECONDS, name ? { download: name } : {})"),
    "fallback reads are signed GETs with the same 6h life");
  assert.ok(storage.includes("createBucket(FALLBACK_BUCKET, { public: false, fileSizeLimit: MAX_FALLBACK_FILE_BYTES })"),
    "the fallback bucket is private and hard-capped by Supabase itself");
  assert.ok(storage.includes('const FALLBACK_PREFIX = "records-supabase/";'), "the store travels in the file_key prefix");
  // Reads AND deletes dispatch on the key, so wiring R2 up later never
  // orphans the records uploaded before it existed.
  assert.equal((storage.match(/isFallbackFileKey\(fileKey\)/g) || []).length, 2,
    "both the read and delete paths dispatch on the key's store");
  assert.ok(routes.includes("if (isFallbackFileKey(fileKey) && bytes > MAX_FALLBACK_FILE_BYTES)"),
    "registration refuses to claim a bigger fallback file than the bucket holds");
  assert.ok(routes.includes("createPresignedDownload(r.file_key).catch("),
    "one bad signature degrades that record to 'no saved file' — the shelf never 500s");
  assert.ok(configJs.includes('recordsBucket: env.SUPABASE_RECORDS_BUCKET ?? "akoro-records"'), "the bucket is named in config");
  assert.ok(envExample.includes("SUPABASE_RECORDS_BUCKET"), ".env.example documents the fallback");
  assert.ok(!recordsApi.includes("supabase"), "the learner client stays store-agnostic — zero client changes");
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
  assert.ok(libraryPage.includes("RecordTeachSession"), "tapping a record opens the teaching session");
  assert.ok(libraryPage.includes("recordFileType"), "cards carry what the file IS (pdf/audio/video/…)");
  assert.ok(libraryPage.includes("setRecordProgress"), "progress is the server's now");
});

test("the session viewer shares the reader's toolbar, tools and tabs", () => {
  // The reader grew optional seams; the teaching session must be unaffected.
  assert.ok(reader.includes("renderPageContent = null"), "custom page renderer seam");
  assert.ok(reader.includes("media = null"), "media pane seam");
  assert.ok(reader.includes("allowTextMarking = true"), "annotate/redact can step aside for canvases");
  assert.ok(viewer.includes("buildSessionReaderPages"), "text records paginate like a session guide");
  assert.ok(viewer.includes("<TeachAgentModal"), "records open as real TEACHING sessions");
  assert.ok(viewer.includes("content={content}"), "the record is the session's material");
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
  assert.ok(viewer.includes("type !== 'pdf' && type !== 'image'"), "canvas/image pages don't offer HTML-only annotate/redact");
});

test("the rest of the app reads the server shelf too", () => {
  assert.ok(searchPage.includes("listRecords"), "discover search finds records from the server");
  assert.ok(!searchPage.includes("akoro_records_"), "no localStorage reads remain in search");
  assert.ok(dashboard.includes("RecordTeachSession"), "records opened from the dashboard open as teaching sessions");
  assert.ok(dashboard.includes("setRecordProgressApi"), "dashboard progress goes to the server");
});

test("folders: create flow with name, cover, description, visibility", () => {
  // The table — organization layer over the shelf, owned per learner.
  assert.ok(foldersMigration.includes("CREATE TABLE IF NOT EXISTS edu.library_folders"), "the folders table");
  assert.ok(foldersMigration.includes("REFERENCES public.users(id) ON DELETE CASCADE"), "dies with its owner");
  assert.ok(foldersMigration.includes("CHECK (visibility IN ('private', 'public'))"), "visibility is exactly private|public");
  assert.ok(foldersMigration.includes("UNIQUE (user_id, name)"), "no duplicate names per learner");
  assert.ok(foldersMigration.includes("idx_library_folders_user"), "listed by owner, newest first");
  assert.ok(foldersMigration.includes("organization lands next"), "honest about what's NOT in scope yet");
  // Registered with the other schema files.
  assert.ok(JSON.parse(manifest).schema.includes("2026-library-folders.sql"), "in the manifest schema group");

  // The routes — same module, same auth, same storage pipeline.
  assert.ok(routes.includes('router.post("/folders"'), "POST /folders creates");
  assert.ok(routes.includes('router.get("/folders"'), "GET /folders lists mine");
  assert.ok(routes.includes("library_folders"), "reads the folders table");
  for (const guard of ["authenticateToken"]) {
    assert.ok((routes.match(/folders[\s\S]{0,200}authenticateToken|authenticateToken[\s\S]{0,80}folders/g) || []).length >= 1, `${guard} on folder routes`);
  }
  assert.ok(routes.includes("purpose === \"folder-cover\""), "covers presign through the same endpoint with a purpose");
  assert.ok(routes.includes("Folder covers must be images."), "covers are image-only");
  assert.ok(routes.includes("MAX_COVER_BYTES"), "covers are size-capped");
  assert.ok(routes.includes("ownsRecordFileKey(coverKey, userId)"), "a cover must be the learner's own object");
  assert.ok(routes.includes("already have a folder with that name"), "duplicate names get a friendly 400");
  assert.ok(routes.includes("MAX_FOLDERS"), "the folder count is capped");

  // The service seam.
  assert.ok(recordsApi.includes("listFolders"), "listFolders()");
  assert.ok(recordsApi.includes("createFolder"), "createFolder()");
  assert.ok(recordsApi.includes("purpose: 'folder-cover'"), "cover presign passes the purpose");

  // The sheet — the four fields, the add-modal entry, the folder strip.
  assert.ok(createSheet.includes("Folder name"), "folder name field");
  assert.ok(createSheet.includes("Cover image"), "cover image field");
  assert.ok(createSheet.includes("Description"), "description field");
  assert.ok(createSheet.includes("private") && createSheet.includes("public"), "visibility choice");
  assert.ok(createSheet.includes("presignFolderCoverUpload") || createSheet.includes("putFileTo"), "cover rides the presigned PUT pipeline");
  assert.ok(libraryPage.includes("CreateFolderSheet"), "the Library page mounts the sheet");
  assert.ok(libraryPage.includes("Create a folder"), "the Add-to-library modal offers it");
  assert.ok(libraryPage.includes("listFolders"), "the page loads folders with the shelf");

  // The folder page — the Pharm.D folder UI, with rename + delete.
  assert.ok(routes.includes('router.patch("/folders/:id"'), "PATCH /folders/:id renames");
  assert.ok(routes.includes('router.delete("/folders/:id"'), "DELETE /folders/:id removes");
  assert.ok(routes.includes("Not your folder."), "rename/delete are owner-only");
  assert.ok(routes.includes("removeRecordFile(existing.cover_key)"), "delete takes the cover object best-effort");
  assert.ok(recordsApi.includes("renameFolder"), "renameFolder()");
  assert.ok(recordsApi.includes("deleteFolder"), "deleteFolder()");
  assert.ok(folderPage.includes("lf-folder-hero"), "the Pharm.D folder hero structure (lf- twins of the pd- classes)");
  for (const cls of ["lf-folder-art", "lf-folder-title", "lf-author-row", "lf-action-row", "lf-sheet-overlay"]) {
    assert.ok(folderPage.includes(cls), cls);
  }
  assert.ok(folderPage.includes("Rename folder"), "rename in the more sheet");
  assert.ok(folderPage.includes("Delete folder"), "delete in the more sheet");
  assert.ok(folderPage.includes("This folder is empty"), "the honest empty state");
  assert.ok(folderPage.includes("This can’t be undone"), "delete asks once — destructive");
  assert.ok(libraryPage.includes("LibraryFolderPage"), "tapping a folder opens the page");
  assert.ok(libraryPage.includes("setFolderPage(f)"), "the folder card click-through");
  assert.ok(!libraryPage.includes("Adding items to folders comes next"), "the placeholder toast is gone");
});

test("folder items: any content files into folders, snapshots at add time", () => {
  // The table — one row per (folder, item), snapshots so the folder never re-queries.
  assert.ok(itemsMigration.includes("CREATE TABLE IF NOT EXISTS edu.library_folder_items"), "the items table");
  assert.ok(itemsMigration.includes("item_type IN ('record', 'pharmd_topic', 'lesson', 'library')"), "the four item types");
  assert.ok(itemsMigration.includes("REFERENCES edu.library_folders(id) ON DELETE CASCADE"), "items die with their folder");
  assert.ok(itemsMigration.includes("UNIQUE (folder_id, item_type, item_ref)"), "an item lands in a folder once");
  assert.ok(itemsMigration.includes("idx_library_folder_items_folder"), "listed by folder, newest first");
  assert.ok(JSON.parse(manifest).schema.includes("2026-library-folder-items.sql"), "in the manifest schema group");

  // The routes — bulk add, owner-checked, capped, idempotent; items listed per folder.
  assert.ok(routes.includes('router.post("/folders/items"'), "POST /folders/items bulk-adds");
  assert.ok(routes.includes('router.get("/folders/:id/items"'), "GET /folders/:id/items lists");
  assert.ok(routes.includes("Not your folder."), "items routes are owner-only");
  assert.ok(routes.includes("MAX_FOLDER_ITEMS"), "a folder cannot grow unbounded");
  assert.ok(routes.includes('"folder_id,item_type,item_ref"'), "upsert is idempotent per item");
  assert.ok(routes.includes("ITEM_TYPES"), "the item-type enum is enforced");
  assert.ok(routes.includes("folderItemCounts"), "the folder list carries live counts");
  assert.ok(recordsApi.includes("addFolderItem"), "addFolderItem()");
  assert.ok(recordsApi.includes("listFolderItems"), "listFolderItems()");

  // The page — the reference Add to folder UI, ported 1:1.
  for (const cls of ["atf-page", "atf-search", "atf-done", "atf-radio"]) {
    assert.ok(atfPage.includes(cls), cls);
  }
  assert.ok(atfPage.includes("New folder"), "New folder pill");
  assert.ok(atfPage.includes("Most relevant"), "the sort row");
  assert.ok(atfPage.includes("Added to"), "the done toast counts folders");
  assert.ok(atfPage.includes("addFolderItem"), "Done is the bulk add");
  assert.ok(atfPage.includes("CreateFolderSheet"), "New folder reuses the create sheet");
  assert.ok((atfPage.match(/linear-gradient\(145deg,/g) || []).length >= 4, "the four accent gradients");

  // Every surface carries ⋯ → Add to folder.
  assert.ok(pharmd.includes("ti-folder-plus"), "Pharm.D topic sheet: folder icon");
  assert.ok(pharmd.includes("'Add to folder'"), "Pharm.D topic sheet: Add to folder action");
  assert.ok(pharmd.includes("itemType: 'pharmd_topic'"), "topics snapshot as pharmd_topic");
  assert.ok(!/topic:\s*\[[^\]]*Add to Library/.test(pharmd), "the old stub label is gone from the topic sheet");
  assert.ok(libraryPage.includes("MoreBtn"), "every shelf card has the ⋯");
  assert.ok((libraryPage.match(/onMore=\{onMore\}/g) || []).length >= 5, "all five card kinds thread onMore");
  assert.ok(libraryPage.includes("fileItemSnapshot"), "the shelf builds item snapshots");
  assert.ok(libraryPage.includes("itemType: 'record'"), "records are fileable");
  assert.ok(parts.includes("onLessonMore"), "curriculum lessons carry ⋯");
  assert.ok(parts.includes("MoreVertical"), "the lesson ⋯ glyph");
  assert.ok(parts.includes("e.stopPropagation()"), "⋯ never plays the lesson");
  assert.ok(courseDetails.includes("itemType: 'lesson'"), "lessons snapshot with their course link");
  assert.ok(courseDetails.includes("AddToFolderPage"), "the course page mounts the picker");

  // The folder page lists what landed — and rows open back on their surface.
  assert.ok(folderPage.includes("listFolderItems"), "the folder page loads its items");
  assert.ok(folderPage.includes("lf-item"), "item rows render");
  assert.ok(folderPage.includes("onOpenItem"), "tapping a row hands it to the parent");
  assert.ok(folderPage.includes("KIND_META"), "icons follow the stored kind");
  assert.ok(libraryPage.includes("openFolderItem"), "the shelf resolves records and links back open");
});
