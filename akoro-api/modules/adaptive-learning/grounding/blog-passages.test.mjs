// Grand Plan §7.14 (D35): blog passage search — article BODIES are split into
// passages and ranked; each passage carries its post's title, heading and link.
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";

const { blogPassages, rankPassages, searchBlogPassages, BLOG_PASSAGE_MAX_CHARS } = await import("../../../lib/blogResearch.js");

const BODY = [
  { type: "p", text: "Why revision matters before an exam." },
  { type: "h", text: "Spaced <b>repetition</b>" },
  { type: "p", text: "Review your notes on day 1, day 3 and day 7. Spacing beats cramming." },
  { type: "list", items: ["Day 1", "Day 3"] },
  { type: "image", src: "https://cdn/x.jpg", alt: "A timetable" },
  { type: "h", text: "Past questions" },
  { type: "p", text: "Answer past questions under timed conditions." },
];

test("a body splits into passages by heading; the heading travels with its passage; image blocks are dropped", () => {
  const ps = blogPassages(BODY);
  assert.deepEqual(ps.map((p) => p.heading), [null, "Spaced repetition", "Past questions"]);
  assert.match(ps[1].text, /day 1, day 3 and day 7/);
  assert.match(ps[1].text, /- Day 1/);
  assert.doesNotMatch(ps.map((p) => p.text).join(" "), /image|cdn/);
  assert.deepEqual(ps.map((p) => p.ord), [0, 1, 2]);
  const long = blogPassages([{ type: "h", text: "Long" }, { type: "p", text: "A sentence here. ".repeat(200) }]);
  assert.ok(long.length > 1 && long.every((p) => p.text.length <= BLOG_PASSAGE_MAX_CHARS && p.heading === "Long"));
  assert.deepEqual(blogPassages(null), []);
});

test("passages rank by the query's words (heading and title count); no hit, no passage", () => {
  const ps = blogPassages(BODY).map((p) => ({ ...p, title: "How to revise" }));
  const ranked = rankPassages(ps, "spaced repetition");
  assert.equal(ranked[0].heading, "Spaced repetition");
  assert.equal(rankPassages(ps, "timed past questions")[0].heading, "Past questions");
  assert.deepEqual(rankPassages(ps, "volcano"), []);
  assert.deepEqual(rankPassages(ps, "the and of"), [], "stop words alone match nothing");
});

test("search uses the indexed passages, and falls back to ranking bodies in memory when the index is missing or empty", async () => {
  const rows = [{ post_id: "p1", slug: "spacing", title: "Spacing", category: "Study", heading: "Spaced repetition", chunk_text: "Review on day 1, 3 and 7." }];
  const indexed = await searchBlogPassages({ query: "spaced repetition" }, { embed: async () => null, rpc: async (a) => { assert.equal(a.p_query_text, "spaced repetition"); return { data: rows, error: null }; } });
  assert.equal(indexed.index, "chunks");
  assert.deepEqual(indexed.passages[0], { slug: "spacing", title: "Spacing", heading: "Spaced repetition", category: "Study", passage: "Review on day 1, 3 and 7.", link: "/blog/spacing" });

  const memory = [{ slug: "pq", title: "Past questions", heading: null, category: null, passage: "Answer them timed.", link: "/blog/pq" }];
  const missing = await searchBlogPassages({ query: "past questions" }, { embed: async () => null, rpc: async () => ({ data: null, error: { message: "function match_blog_chunks does not exist" } }), inMemory: async () => memory });
  assert.equal(missing.index, "memory");
  assert.equal(missing.passages[0].link, "/blog/pq");

  let backfilled = 0;
  const empty = await searchBlogPassages({ query: "exam stress" }, { embed: async () => null, rpc: async () => ({ data: [], error: null }), inMemory: async () => [], backfill: async () => { backfilled += 1; } });
  assert.equal(empty.count, 0);
  assert.ok(backfilled <= 1);
  assert.match((await searchBlogPassages({ query: "" })).error, /word or two/);
});
