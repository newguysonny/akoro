import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Add-a-record contract — the + and its sheet moved from the Learn tab's
 * higher-ed-only FAB to the Library page header, styled like the community
 * page's +, and available to every learner (school and higher-ed alike).
 * Records stay device-local under the signed-in learner's id, so nothing
 * saved from the old FAB is lost, and the Now-Studying bar's + deep-links
 * to /library?add=1 instead of owning the sheet.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [page, header, content, cards, modals, data, meta, dashboard, modal] = await Promise.all([
  read("../src/features/library/LibraryPage.jsx"),
  read("../src/features/library/components/LibraryHeader.jsx"),
  read("../src/features/library/components/LibraryContent.jsx"),
  read("../src/features/library/components/LibraryCards.jsx"),
  read("../src/features/library/components/LibraryModals.jsx"),
  read("../src/features/library/hooks/useLibraryData.js"),
  read("../src/features/library/components/libraryMeta.js"),
  read("../src/features/dashboard/LearnerDashboard.jsx"),
  read("../src/components/dashboard/AddRecordModal.jsx"),
]);
const library = [page, header, content, cards, modals, data, meta].join("\n");

test("the Library header carries the + and the sheet, community-style", () => {
  assert.match(library, /aria-label=\{t\('records\.title'\)\}/, "the + button, labelled like the old FAB");
  assert.match(library, /<Icon name="ti-plus"/, "same plus glyph as the community header");
  assert.match(library, /borderRadius: 100, width: 34, height: 34/, "same 34×34 round button as the community header");
  assert.match(library, /<AddRecordModal/, "the sheet renders here now");
  assert.match(library, /user=\{\{ id: STUDENT_ID \}\}/, "records key stays the signed-in learner's");
  assert.match(library, /searchParams\.get\('add'\)/, "the Now-Studying bar's + deep-links in with ?add=1");
  // Every learner: no tier gate on the page that hosts the +.
  assert.doesNotMatch(library, /isHigherEdUI/);
  // Opening still tells the truth about uploads/pastes; links open.
  // The real record viewer shipped (server-backed): uploads and pastes open
  // in it, and it explains itself for pre-viewer uploads with no stored
  // bytes — the old records.viewer_soon placeholder copy is gone.
  assert.match(library, /setViewer\(r\)/);
  assert.match(library, /window\.open\(r\.url, '_blank', 'noopener'\)/);
});

test("the Learn tab no longer owns the FAB or the sheet — but record seams survive", () => {
  assert.doesNotMatch(dashboard, /AddRecordModal/, "the sheet moved out");
  assert.doesNotMatch(dashboard, /recordsOpen|recordCount|refreshRecordCount/, "FAB state moved out");
  assert.doesNotMatch(dashboard, /records\.title/, "the FAB (its only user) is gone");
  // The Now-Studying bar's + now routes to the Library sheet.
  assert.match(dashboard, /onAdd=\{\(\)=>navigate\('\/library\?add=1'\)\}/);
  // Discovery and the Now bar still open records through the tracked path.
  // Records are server-backed now (recordsApi seam), so the dashboard loads
  // them with listRecords() instead of the old localStorage loader.
  assert.match(dashboard, /openRecordTracked/);
  assert.match(dashboard, /listRecords\(\)/);
});

test("marking a record done flips the row immediately, not after a reopen", () => {
  // The modal updates its own list optimistically (functional form), then
  // persists through the server-backed progress seam.
  assert.match(modal, /setRecords\(\(rs\) => rs\.map\(x => x\.id === r\.id \? \{ \.\.\.x, progress: p/);
  assert.match(modal, /await setRecordProgress\(r\.id, p\)/);
});
