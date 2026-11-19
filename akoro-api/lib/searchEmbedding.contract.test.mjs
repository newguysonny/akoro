import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * A search waits a few seconds at most for its query vector (2026-10-20):
 * late or failed → null, and the search ranks on text. Storing keeps the plain embed.
 */
import { embedForSearch, searchEmbedStats } from "./searchEmbedding.js";

const vec = { data: [{ embedding: [0.1, 0.2] }] };

test("in time → the vector; late → null at the limit (the call still finishes); failed → null; empty → no call", async () => {
  assert.deepEqual(await embedForSearch("osmosis", { create: async () => vec, timeoutMs: 500 }), [0.1, 0.2]);

  let finished = false;
  const t0 = Date.now();
  const late = await embedForSearch("osmosis", { timeoutMs: 300, create: () => new Promise((r) => setTimeout(() => { finished = true; r(vec); }, 600)) });
  const waited = Date.now() - t0;
  assert.equal(late, null);
  assert.ok(waited >= 280 && waited < 550, `gave up at the limit, not when the call ended (${waited} ms)`);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(finished, true, "the late call is left to finish (it wakes a cold worker)");

  assert.equal(await embedForSearch("osmosis", { create: async () => { throw new Error("breaker open"); } }), null);
  let called = false;
  assert.equal(await embedForSearch("   ", { create: async () => { called = true; return vec; } }), null);
  assert.equal(called, false);
  const s = searchEmbedStats();
  assert.ok(s.late >= 1 && s.failed >= 1 && s.timeoutMs >= 250);
});

test("billing: the learner's when given, the platform's when asked", async () => {
  const seen = [];
  const create = async (p) => { seen.push(p); return vec; };
  await embedForSearch("q", { userId: "u1", feature: "record_search", create });
  await embedForSearch("q", { payer: "platform", userId: "u1", create });
  assert.equal(seen[0].__userId, "u1");
  assert.equal(seen[0].__feature, "record_search");
  assert.equal(seen[1].__payer, "platform");
  assert.equal(seen[1].__userId, undefined);
});

test("every search embeds its question through the limit, and the vector-only searches now pass their text", async () => {
  const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
  const [pq, cur, syl, rec, mem, recall, know, sql, manifest] = await Promise.all([
    read("../modules/past-questions/routes.js"), read("../modules/curriculum/routes.js"), read("../modules/adaptive-learning/teaching/syllabus.js"),
    read("../modules/records/searchLib.js"), read("../lib/conversationContextStore.js"), read("../modules/battle/agentRecall.js"),
    read("../modules/adaptive-learning/agents/student/knowledge.js"), read("../migrations/2026-search-text-fallback.sql"), read("../migrations/manifest.json"),
  ]);
  // curriculum: 2 — its /search/topics endpoint had no caller and was removed
  for (const [name, src, n] of [["past questions", pq, 3], ["curriculum", cur, 2]]) {
    assert.equal((src.match(/p_query_embedding: await embedForSearch\(/g) || []).length, n, `${name}: every search`);
    assert.equal((src.match(/p_query_text:/g) || []).length, n, `${name}: its text for the fallback`);
    assert.doesNotMatch(src, /p_query_embedding: await embed\(/, `${name}: no search waits on the plain embed`);
  }
  assert.match(syl, /p_query_embedding: await embedForSearch\(query/);
  assert.match(syl, /h\.lexical \|\| \(h\.similarity/, "a text match skips the cosine floor");
  assert.match(rec, /embedForSearch\(query, \{ userId, feature: "record_search" \}\)/);
  assert.match(mem, /embedForSearch\(query, \{ userId, feature: "learner_agent_memory_query" \}\)/);
  assert.match(recall, /embedForSearch\(String\(text \?\? ""\), \{ feature: "battle_recall", payer: "platform" \}\)/);
  assert.doesNotMatch(know, /embedOrNull\(query\)/, "knowledge searches use the limited embed");
  for (const fn of ["match_past_questions", "match_curriculum", "match_syllabus"]) {
    assert.match(sql, new RegExp(`CREATE FUNCTION ${fn}\\(`));
  }
  assert.equal((sql.match(/ELSIF public\.or_tsquery\(p_query_text\) IS NOT NULL THEN/g) || []).length, 3);
  const schema = JSON.parse(manifest).schema;
  assert.ok(schema.indexOf("2026-search-text-fallback.sql") > Math.max(...["2026-past-questions.sql", "2026-curriculum.sql", "2026-syllabus.sql", "2026-hybrid-retrieval.sql"].map((f) => schema.indexOf(f))), "runs after the files that re-create the old functions");
});

test("one question, one embedding: the same text shares one call; a failure isn't reused", async () => {
  const { sharedCall, searchEmbedStats } = await import("./searchEmbedding.js");
  let made = 0;
  const make = () => { made++; return Promise.resolve({ data: [{ embedding: [1, 2, 3] }] }); };
  const a = sharedCall("explain photosynthesis", make);
  const b = sharedCall("explain photosynthesis", make);
  assert.equal(a, b, "same text, same call");
  assert.equal(made, 1);
  assert.ok(searchEmbedStats().shared >= 1);
  sharedCall("another question", make);
  assert.equal(made, 2, "different text, its own call");
  let failMade = 0;
  const failing = () => { failMade++; return Promise.reject(new Error("down")); };
  await sharedCall("will fail", failing).catch(() => {});
  await new Promise((r) => setTimeout(r, 0));
  await sharedCall("will fail", failing).catch(() => {});
  assert.equal(failMade, 2, "a failed call is tried again, never reused");
});
