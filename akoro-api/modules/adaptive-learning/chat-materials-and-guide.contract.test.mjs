import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { collectMaterials, materialsFrom } from "./chat-materials.js";
import { buildCitedLearnSuggestionMessages, buildSuggestionMessages, guideChip, notTaughtFrom, shapeCitedLearnSuggestions } from "./chatSuggestions.js";
import { guidePassagesBlock } from "./documentGrounding.js";

const chat = await readFile(new URL("./chat.js", import.meta.url), "utf8");
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

test("materials: links only from tool results, only to the app's own pages", () => {
  assert.deepEqual(materialsFrom("search_blog_posts", { posts: [{ title: "Titration", slug: "titration-basics" }, { title: "Bad", slug: "../x" }] }),
    [{ kind: "blog", title: "Titration", href: "/blog/titration-basics" }, null]);
  assert.deepEqual(materialsFrom("search_my_library", { records: [{ recordId: ID, name: "Notes.pdf" }] }),
    [{ kind: "record", title: "Notes.pdf", href: `/library?record=${ID}` }]);
  assert.equal(materialsFrom("check_progress", { courses: [{ title: "No slug" }] })[0], null);
  assert.deepEqual(materialsFrom("get_weak_topics", { weak_topics: [{ topic: "Moles", subject: "chemistry" }] })[0].action,
    { type: "teach", topic: "Moles", subject: "chemistry" });
  assert.deepEqual(materialsFrom("anything_else", { posts: [{ title: "x", slug: "y" }] }), []);
  const many = collectMaterials([materialsFrom("search_blog_posts", { posts: Array.from({ length: 12 }, (_, i) => ({ title: `P${i}`, slug: `p${i % 10}` })) })]);
  assert.equal(many.length, 8, "deduped and capped");
  // Echoed per tool and saved with the reply, so a reopened chat keeps its links.
  assert.match(chat, /collectMaterials\(\[materialsFrom\(tool, toolResult\)\]\)/);
  assert.match(chat, /const materials = collectMaterials\(execs\.map/);
});

test("not taught yet: one chip is always 'ask your teaching guide' (the only way to untaught knowledge)", () => {
  assert.deepEqual(notTaughtFrom({ reply: "You haven't taught me photosynthesis yet." }), { topic: null });
  assert.deepEqual(notTaughtFrom({ reply: "Hmm.", tools: [{ tool: "ask_to_be_taught", topic: "Osmosis" }] }), { topic: "Osmosis" });
  assert.equal(notTaughtFrom({ reply: "From NaNa: osmosis is…", tools: [{ tool: "ask_to_be_taught", topic: "Osmosis" }] }), null, "already consulted");
  assert.equal(notTaughtFrom({ reply: "Osmosis is the movement of water." }), null);
  assert.equal(guideChip({ topic: "Osmosis" }), "Ask your teaching guide about Osmosis");
  assert.equal(guideChip(null), null);
  const [system] = buildSuggestionMessages({ ask: "a", reply: "b", capabilities: ["Set study goals"], notTaught: { topic: "Osmosis" } });
  assert.match(system.content, /Set study goals/, "chips are tailored to what the agent can do");
});

test("reader: cited learn suggestions and guide tips point at real passages only", () => {
  const passages = [{ n: 1, pageNumber: 3, text: "Mitochondria make ATP." }, { n: 2, pageNumber: 5, text: "Ribosomes make proteins." }];
  const [, user] = buildCitedLearnSuggestionMessages({ topic: "Cells", passages });
  assert.match(user.content, /\[1\] \(page 3\)/);
  const out = shapeCitedLearnSuggestions({ suggestions: [{ text: "Explain ATP simply", passage: 1 }, { text: "Quiz me on ribosomes", passage: null }] },
    { toCitation: (n) => (n === 1 ? { n, pageNumber: 3 } : null) });
  assert.deepEqual(out, [{ text: "Explain ATP simply", citation: { n: 1, pageNumber: 3 } }, { text: "Quiz me on ribosomes", citation: null }]);
  assert.equal(guidePassagesBlock(null), "");
  assert.equal(guidePassagesBlock({ text: "x" }), "", "no cited passages, no block");
  assert.match(guidePassagesBlock({ cited: true, text: "[1] ATP", name: "Bio" }), /cite the passage[\s\S]*<reference_material>/);
});
