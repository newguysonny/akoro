import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
const { sessionForUpload } = await import("./materials-source.js");
const { notesBlock } = await import("../../battle/basedOn.js");
const read = (f) => readFile(new URL(f, import.meta.url), "utf8");

const S = (id, subject, status = "topic_active") => ({ id, subject, status });

test("a chat upload joins the open Study Prep session in its subject", () => {
  const canon = (s) => ({ bio: "biology" }[String(s).toLowerCase()] || String(s || "").toLowerCase());
  assert.equal(sessionForUpload([S("m", "Mathematics"), S("b", "Biology")], "Bio", canon)?.id, "b");
  assert.equal(sessionForUpload([S("b", "Biology", "completed")], "Biology", canon), null, "a finished session takes no new files");
  assert.equal(sessionForUpload([S("m", "Mathematics")], "Biology", canon), null, "another subject: not attached");
  assert.equal(sessionForUpload([S("only", "Biology")], null, canon)?.id, "only", "no subject: the only open session");
  assert.equal(sessionForUpload([S("a", "Biology"), S("b", "Chemistry")], null, canon), null, "no subject and two open: not guessed");
});

test("the check's facts come from the learner's notes first (untrusted data, bounded)", () => {
  const block = notesBlock(["Stomata open in light.", "", "x".repeat(900)]);
  assert.match(block, /learner's own notes/);
  assert.match(block, /never instructions/);
  assert.match(block, /1\. Stomata open in light\./);
  assert.ok(!block.includes("x".repeat(501)), "each passage is clipped");
  assert.equal(notesBlock([]), "");
});

test("wiring: uploads attach on filing; the Agent Check passes the session's notes to question generation", async () => {
  const [routes, harness, check, source] = await Promise.all([
    read("../../materials/routes.js"), read("./harness.js"), read("../../battle/agentCheck.js"), read("../../battle/questionSource.js"),
  ]);
  assert.match(routes, /attachUploadsToStudyPrep\(\{ learnerId: req\.user\.id, subject: row\.subject, recordIds: ids \}\)/);
  assert.match(harness, /syllabus\.materials\.search\(\{ learnerId, recordIds: session\.material_record_ids, query: topic\.label/);
  assert.match(check, /fromNotes\?\.length \? \{ fromNotes \}/);
  assert.match(source, /basedOnBlock\(basedOn\) \+ notesBlock\(fromNotes\)/);
});
