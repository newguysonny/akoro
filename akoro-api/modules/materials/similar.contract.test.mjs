import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { folderItemForCandidate, searchTopics, shapeCandidates } from "./similarCore.js";

const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");

test("only Akoro's own material, deduped, each saying why (D52)", () => {
  const topics = searchTopics({ topics: [{ name: "Ecology", weight: 15 }, { name: "Osmosis and diffusion", weight: 22 }] });
  assert.deepEqual(topics.map((t) => t.query), ["Osmosis", "Ecology"], "heaviest first; 'X and Y' searches X");
  const out = shapeCandidates([
    { topic: "Osmosis and diffusion", courses: [{ slug: "transport-in-plants", title: "SS2 Biology: Transport in plants" }], posts: [{ slug: "osmosis-potato", title: "Osmosis with potato strips", readMin: 5 }] },
    { topic: "Ecology", courses: [{ slug: "transport-in-plants", title: "dup" }], posts: [{ slug: "", title: "no slug" }] },
  ], { questionsByTopic: { "Osmosis and diffusion": ["1", "2"] } });
  assert.deepEqual(out.map((c) => c.key), ["course:transport-in-plants", "blog:osmosis-potato"]);
  assert.equal(out[0].why, "Osmosis and diffusion · Q1, Q2");
  assert.equal(out[1].href, "/blog/osmosis-potato");
  assert.deepEqual(folderItemForCandidate(out[1]), { item_type: "library", item_ref: "blog:osmosis-potato", title: "Osmosis with potato strips", sub: "Blog · 5 min read", kind: "blog", link: "/blog/osmosis-potato" });
});

test("the learner picks: only what was offered and still exists goes in; Undo takes it out", () => {
  assert.match(routes, /\.eq\("is_published", true\)/, "published courses only");
  assert.match(routes, /filter\(\(k\) => offered\.has\(k\)\)/, "a key that wasn't offered is ignored");
  assert.match(routes, /\(await findSimilar\(row, userId\)\)\.filter\(\(c\) => keys\.includes\(c\.key\)\)/, "re-found, never taken from the request");
  assert.match(routes, /\.eq\("item_type", "library"\)\.in\("item_ref", added\)/, "Undo removes what was added");
});
