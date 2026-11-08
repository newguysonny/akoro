import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";

test("word recall: order- and case-free, each read word used once, maths notation normalised", async () => {
  const { wordRecall } = await import("./scenarios/handwritingRead.js");
  assert.equal(wordRecall("Area = 1/2 x base x height = 20 cm2", "Area = ½ × base × height = 20 cm²"), 1);
  assert.equal(wordRecall("water water", "water"), 0.5, "a word read once counts once");
  assert.equal(wordRecall("Osmosis is the movement of water", "osmosis is movement of water"), 5 / 6);
  assert.equal(wordRecall("anything", ""), 0);
});

test("the handwriting samples and their truth ship with the check", async () => {
  const dir = new URL("./fixtures/handwriting/", import.meta.url);
  const truth = JSON.parse(await readFile(new URL("truth.json", dir), "utf8"));
  assert.deepEqual(Object.keys(truth).sort(), ["crossed-out-respiration", "fast-osmosis", "maths-working", "neat-photosynthesis"]);
  for (const id of Object.keys(truth)) assert.ok((await stat(new URL(`${id}.jpg`, dir))).size > 10_000, `${id}.jpg`);
});
