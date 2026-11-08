import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = await readFile(new URL("./studyMaterial.js", import.meta.url), "utf8");
// The pure helpers, without loading the db: evaluated from the source.
const { toReaderCite, toReaderContent } = await import("data:text/javascript," + encodeURIComponent(
  src.slice(src.indexOf("/** A server citation"), src.indexOf("/** Start a two-voice episode")).replace(/^export /gm, "export ")));

test("citations take the reader's jump shape (0-based page, box, moment, quote)", () => {
  assert.deepEqual(toReaderCite({ pageNumber: 3, bbox: [1, 2, 3, 4], quote: "q" }), { page: 2, bbox: [1, 2, 3, 4], quote: "q" });
  assert.deepEqual(toReaderCite({ startMs: 1200 }), { startMs: 1200 });
  assert.equal(toReaderCite(null), null);
});

test("a chat-made quiz is the same tab the reader saves: questions + fresh answer slots", () => {
  const c = toReaderContent("quiz", { quizQuestions: [{ q: "A?", cite: { pageNumber: 1 } }, { q: "B?", cite: null }] });
  assert.equal(c.quizQuestions[0].cite.page, 0);
  assert.equal(c.ui.quizAnswers.length, 2);
  assert.deepEqual(c.ui.quizAnswers[0], { selected: null, checked: false, dontKnow: false });
  assert.ok(toReaderContent("summary", { summaryPoints: [{ text: "x", cite: { pageNumber: 2 } }] }).summaryPoints[0].cite.page === 1);
  assert.ok(Array.isArray(toReaderContent("flashcards", { cardSet: [{ front: "a", back: "b" }] }).cardSet));
});

test("chat saves it as a reader tab and links to it; a folder with several files asks", () => {
  assert.match(src, /createArtifact\(\{ userId, recordId: found\.record\.id, row: \{\s*kind: tool, page_number: null, open: true/);
  assert.match(src, /href: `\/library\?record=\$\{found\.record\.id\}&artifact=\$\{created\.artifact\.id\}`/);
  assert.match(src, /ask which one \(by name\) to make the \$\{tool\} from; don't guess/);
  assert.match(src, /from\("library_folder_items"\)[\s\S]{0,200}\.eq\("item_type", "record"\)/);
});
