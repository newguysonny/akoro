import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { collectMaterials, materialsFrom } from "./chat-materials.js";
import { buildCitedLearnSuggestionMessages, buildSuggestionMessages, guideChip, notTaughtFrom, shapeCitedLearnSuggestions } from "./chatSuggestions.js";
import { guidePassagesBlock } from "../documentGrounding.js";
import { memoryForPrompt, renderRelevantMemory } from "./chat-memory.js";

const chat = await readFile(new URL("../chat.js", import.meta.url), "utf8");
const turnStore = await readFile(new URL("./turn-store.js", import.meta.url), "utf8");
const agentLoop = await readFile(new URL("./agent-loop.js", import.meta.url), "utf8");
const toolCatalogue = await readFile(new URL("./tool-catalogue-rest.js", import.meta.url), "utf8");
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
  assert.match(agentLoop, /collectMaterials\(\[materialsFrom\(tool, toolResult\)\]\)/);
  assert.match(turnStore, /const materials = collectMaterials\(execs\.map/);
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
  const leaked = shapeCitedLearnSuggestions({ suggestions: [{ text: "Summarise the cell wall from passage 1", passage: 1 }, { text: "Quiz me on the nucleus (passage 3)", passage: 3 }, { text: "Explain osmosis [2]", passage: 2 }] },
    { toCitation: (n) => ({ n }) });
  assert.deepEqual(leaked.map((x) => x.text), ["Summarise the cell wall", "Quiz me on the nucleus", "Explain osmosis"], "passage numbers never reach the chip text");
  assert.deepEqual(leaked.map((x) => x.citation.n), [1, 3, 2]);
  assert.equal(guidePassagesBlock(null), "");
  assert.equal(guidePassagesBlock({ text: "x" }), "", "no cited passages, no block");
  assert.match(guidePassagesBlock({ cited: true, text: "[1] ATP", name: "Bio" }), /cite the passage[\s\S]*<reference_material>/);
});

test("memory from other chats: the learner's ask travels, the agent's old reply never does (D50)", () => {
  const summary = { kind: "conversation_summary", content: "Latest learner request: Do I have notes on mitochondria?\nLatest Akoro response: Yes — Record ID: 77d17a49-7615-411e-a07c-595a9479b16d" };
  assert.equal(memoryForPrompt(summary), "Earlier the learner asked: Do I have notes on mitochondria?");
  assert.equal(memoryForPrompt({ kind: "conversation_summary", content: "They revised titration and want more practice." }), "They revised titration and want more practice.");
  const block = renderRelevantMemory([summary, { kind: "study_preference", content: "Likes diagrams" }]);
  assert.doesNotMatch(block, /77d17a49|Record ID/);
  assert.match(block, /never evidence[\s\S]*call the tool/);
  assert.equal(renderRelevantMemory([]), "");
});

test("study tools: the agent sends learners to the reader, the link opens it on the tool", () => {
  const out = materialsFrom("search_my_library", { records: [{ recordId: ID, name: "Cell notes", tool: "quiz" }] });
  assert.deepEqual(out, [{ kind: "study_tool", title: "Quiz · Cell notes", href: `/library?record=${ID}&tool=quiz` }]);
  assert.equal(materialsFrom("search_my_library", { records: [{ recordId: ID, name: "x", tool: "essay" }] })[0], null, "an unknown tool never makes a link");
  assert.match(toolCatalogue, /tool: \{ type: "string", enum: \["quiz", "flashcards", "summary", "notes", "podcast"\]/);
  assert.match(toolCatalogue, /use make_study_material instead/, "making one goes to the tool that builds and saves it");
  assert.match(toolCatalogue, /never write the questions, cards or summary in chat/);
  const made = materialsFrom("make_study_material", { made: true, tool: "quiz", name: "Cell notes", count: 10, href: `/library?record=${ID}&artifact=${ID}` });
  assert.deepEqual(made, [{ kind: "study_output", title: "Quiz · Cell notes", href: `/library?record=${ID}&artifact=${ID}`, sub: "10 questions", tool: "quiz" }]);
  assert.equal(materialsFrom("make_study_material", { made: true, tool: "quiz", name: "x", href: "https://evil.example/" })[0], null, "only the app's own reader link");
});

test("the chips under a reply survive a refresh (saved on its meta)", () => {
  // Saved by suggestionsFor — the same for POST /suggestions and the chips sent on the reply's stream.
  assert.match(turnStore, /void saveReplyIdeas\(\{ userId: user\?\.id, conversationId: body\?\.conversationId, reply, ideas: suggestions \}\)/);
  assert.match(chat, /send\("suggestions", \{ suggestions \}\)/, "the chips ride the reply's stream");
  assert.match(turnStore, /\.eq\("role", "agent"\)\.order\("created_at", \{ ascending: false \}\)\.limit\(1\)/, "only the latest agent message");
  assert.match(turnStore, /if \(!last \|\| norm\(last\.text\) !== norm\(reply\)\) return false;/, "only the reply they were made for");
});

test("not taught yet: Akoro's own material on the topic, as links; never study material from general knowledge", async () => {
  assert.deepEqual(materialsFrom("ask_to_be_taught", { materials: [{ kind: "course", title: "Photosynthesis basics", href: "/course/photosynthesis-basics" }, { kind: "blog", title: "x", href: "https://evil.example" }] }),
    [{ kind: "course", title: "Photosynthesis basics", href: "/course/photosynthesis-basics" }, null]);
  assert.match(chat, /const materials = await akoroMaterialFor\(teach\.topic\)/);
  assert.match(chat, /don't explain it or write study material \(flashcards, notes, a quiz\) on it yourself/);
  const protege = await readFile(new URL("../../../akoro-agent/policies/PROTEGE.md", import.meta.url), "utf8");
  assert.match(protege, /Flashcards, notes, summaries and quizzes are study material: write them only from what you were taught/);
});

test("blog passages the answer used: post + section first (opening the post), then the posts; deduped", () => {
  const out = collectMaterials([materialsFrom("search_blog_posts", {
    passages: [{ title: "How plants lose water", slug: "how-plants-lose-water", heading: "Stomata and the leaf" }],
    posts: [{ title: "How plants lose water", slug: "how-plants-lose-water" }, { title: "Evaporation made simple", slug: "evaporation-made-simple" }],
  })]);
  assert.deepEqual(out[0], { kind: "blog_passage", title: "How plants lose water", href: "/blog/how-plants-lose-water", sub: "Akoro blog · Stomata and the leaf" });
  assert.equal(out.filter((m) => m.href === "/blog/how-plants-lose-water").length, 1, "the post itself isn't listed twice");
  assert.equal(out[1].href, "/blog/evaporation-made-simple");
});
