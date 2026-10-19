// A teaching turn must survive the embeddings provider being down (no credit,
// breaker open): retrieval falls back to the match_* RPCs' lexical arm and a
// save keeps the row with embedded_at null for lib/embeddingSweeper.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./knowledge.js", import.meta.url), "utf8");

test("knowledge.js only embeds through embedOrNull (a failed embedding never kills the turn)", () => {
  const raw = [...src.matchAll(/await embed\(/g)];
  assert.equal(raw.length, 1, "the only direct embed() call is inside embedOrNull");
  assert.match(src, /export async function embedOrNull\(text\) \{\s*try \{\s*return await embed\(text\);/);
});

test("a save without a vector leaves embedded_at null so the sweeper fills it", () => {
  assert.doesNotMatch(src, /embedded_at:\s*new Date\(\)/);
  assert.equal([...src.matchAll(/embedded_at:\s*\w+ \? new Date\(\) : null/g)].length, 4);
});

test("the match RPCs still get the query text, so they can rank on words alone", () => {
  for (const rpc of ["match_agent_knowledge", "match_student_knowledge", "match_training_chunks"]) {
    const at = src.indexOf(`"${rpc}"`);
    assert.ok(at > 0, rpc);
    assert.match(src.slice(at, at + 900), /p_query_text:\s*query/);
  }
});
