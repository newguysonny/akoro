import assert from "node:assert/strict";
import test from "node:test";
import { hydrateReaderTabs } from "./readerTabCache.js";

test("cached tabs hydrate with remapped ids and the active tab preserved", () => {
  const h = hydrateReaderTabs({
    resultTabs: [
      { id: "r7", artifactId: "a1", toolId: "quiz", title: "Quiz · Page 1" },
      { id: "r9", artifactId: "a2", toolId: "summary", title: "Summary · Page 1" },
    ],
    activeTabId: "r2",
    communityTabsOpen: ["ask"],
    savedItems: [{ id: "a3", kind: "flashcards" }],
  });
  assert.deepEqual(h.resultTabs.map((t) => t.id), ["r1", "r2"]);
  assert.equal(h.activeTabId, "r2");
  assert.equal(h.nextResultId, 3);
  assert.deepEqual(h.communityTabsOpen, ["ask"]);
  assert.equal(h.savedItems.length, 1);
});

test("an out-of-range or missing active tab falls back to the document", () => {
  assert.equal(hydrateReaderTabs({ resultTabs: [{ id: "r1" }], activeTabId: "r9" }).activeTabId, "reader");
  assert.equal(hydrateReaderTabs(null).activeTabId, "reader");
  assert.deepEqual(hydrateReaderTabs(null).resultTabs, []);
  assert.deepEqual(hydrateReaderTabs(null).communityTabsOpen, []);
});

test("non-result active ids (ask/reader) survive hydration", () => {
  assert.equal(hydrateReaderTabs({ resultTabs: [], activeTabId: "ask" }).activeTabId, "ask");
  assert.equal(hydrateReaderTabs({ resultTabs: [], activeTabId: "reader" }).activeTabId, "reader");
});

test("a cached tab without an artifactId does not shadow the saved copy", async () => {
  const { dropShadowTabs } = await import("./readerTabCache.js");
  const local = { toolId: "quiz", createdPage: 0, values: { focus: "two easy questions" } };
  const saved = { kind: "quiz", pageNumber: 1, params: { focus: "two easy questions" } };
  assert.deepEqual(dropShadowTabs([local], [saved]), []);
  const other = { ...local, values: { focus: "something else" } };
  assert.deepEqual(dropShadowTabs([other], [saved]), [other]);
  const withId = { ...local, artifactId: "a1" };
  assert.deepEqual(dropShadowTabs([withId], [saved]), [withId], "already-linked tabs stay");
});
