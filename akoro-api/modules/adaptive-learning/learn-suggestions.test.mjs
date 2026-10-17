import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildLearnSuggestionMessages, shapeSuggestions, LEARN_LIMITS } from "./chatSuggestions.js";

test("learn suggestions ground in the material when there is some", () => {
  const [sys, user] = buildLearnSuggestionMessages({ topic: "Cells", subject: "Biology", title: "BIO 111", excerpt: "The cell wall is made of cellulose. ".repeat(200) });
  assert.match(sys.content, /exactly 4/);
  assert.match(sys.content, /actually appear in the MATERIAL/);
  assert.match(user.content, /TOPIC: Cells \(Biology\)/);
  assert.match(user.content, /MATERIAL TITLE: BIO 111/);
  assert.ok(user.content.length < LEARN_LIMITS.excerptChars + 300, "the excerpt is capped");
});

test("with no material they follow the topic and its subtopics", () => {
  const [sys, user] = buildLearnSuggestionMessages({ topic: "Photosynthesis", subtopics: ["Light reactions", "Calvin cycle"] });
  assert.match(sys.content, /no material: base them on the TOPIC/);
  assert.match(user.content, /SUBTOPICS: Light reactions; Calvin cycle/);
  assert.doesNotMatch(user.content, /MATERIAL:/);
});

test("the reply shapes to at most four clean suggestions", () => {
  const raw = JSON.stringify({ suggestions: ["1. Summarise the cell wall section", "Explain cellulose simply", "Quiz me on the nucleus", "Real-life example of osmosis", "a fifth"] });
  assert.deepEqual(shapeSuggestions(raw, { count: LEARN_LIMITS.count, chars: LEARN_LIMITS.chars }),
    ["Summarise the cell wall section", "Explain cellulose simply", "Quiz me on the nucleus", "Real-life example of osmosis"]);
  assert.equal(shapeSuggestions(raw).length, 3, "the Agent Chat chips keep their default of three");
});

test("the route exists, is bounded and never fails the chat", async () => {
  const src = await readFile(new URL("./chat.js", import.meta.url), "utf8");
  const route = src.slice(src.indexOf('router.post("/learn-suggestions"'), src.indexOf('router.post("/agent"'));
  assert.ok(route.length > 50);
  assert.match(route, /__timeoutMs: 12_000/);
  assert.match(route, /__feature: "learn_suggestions"/);
  assert.match(route, /suggestions: \[\] \}\);\s*\}\s*\}\);/);
});
