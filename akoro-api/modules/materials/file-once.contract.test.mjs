/**
 * Stage 4 — file once, narrate once (chat-upload-materials plan).
 *
 * The send path used to classify files by NAME (a model call), file them
 * into the guessed folder at once, and let the read move them again — the
 * learner watched "From chat — Unsorted" become "Chemistry — Notes", and
 * heard the filing twice (the turn's reply naming the guess, then the
 * completion message correcting it). Now: create starts the upload
 * unfiled; /records only attaches; /structure files ONCE from the read;
 * the turn never names a folder; the server's completion message is the
 * single filing report.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const chat = await readFile(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");

const create = routes.slice(routes.indexOf('router.post("/ingest"'), routes.indexOf('router.post("/ingest/:id/records"'));
const records = routes.slice(routes.indexOf('router.post("/ingest/:id/records"'), routes.indexOf('router.post("/ingest/:id/progress"'));
const structure = routes.slice(routes.indexOf('router.post("/ingest/:id/structure"'), routes.indexOf("async function findSimilar"));

test("create: no classify, no folder — the upload starts unfiled", () => {
  assert.doesNotMatch(routes, /__feature: "material_ingest"/, "the name-classify model call is off the send path entirely");
  assert.doesNotMatch(create, /classify\(|resolveFolder|folderContext|sortSteps|folderSteps/, "create guesses nothing and files nothing");
  assert.match(create, /state: "received",\s*folder_id: null, folder_name: null, folder_created: false,\s*doc_kind: null, subject: null/, "the row starts with no folder, subject or kind");
  assert.match(create, /filing: \{ fileIndexes: names\.map\(\(_, i\) => i\) \}/, "one upload holds the message's files, in order");
  assert.match(create, /receivedSteps\(\{ batchId, count: names\.length \}\)/, "the steps say it will be read, then filed — not where");
  assert.match(create, /replaced\?\.state === "undone" && replaced\.chat_message_id/, "\"Save it again\" still takes over the undone upload's message");
});

test("records: attached and private, but NOT filed and NOT sent to Study Prep yet", () => {
  assert.doesNotMatch(records, /library_folder_items/, "no folder items are written before the read");
  assert.doesNotMatch(records, /attachUploadsToStudyPrep/, "Study Prep waits for the read subject");
  assert.match(records, /update\(\{ private: true \}\)/, "still marked private at once (D51, D53)");
  assert.match(records, /savedSteps\(\{ ingestId: row\.id, first \}\)/, "the step says saved — not filed");
});

test("structure files ONCE, from the read — and the Study Prep attach goes with it", () => {
  assert.match(structure, /const where = await resolveFolder\(userId, \{ subject, kind \}, await folderContext\(userId\)\)/, "one resolution, from the read subject (null → Unsorted via pickFolder)");
  assert.match(structure, /filePatch = await refile\(userId, \{ \.\.\.row, doc_kind: kind \}/, "the files land in that folder — there is no earlier filing to move");
  assert.match(structure, /filing = found \? \{ filed: true,/, "a first filing is recorded as filed, not moved");
  assert.match(structure, /filedSteps\(\{ ingestId: row\.id, folderName: row\.folder_name, first \}\)/, "the filing step is written at the read, with the real folder");
  assert.match(structure, /attachUploadsToStudyPrep\(\{ learnerId: userId, subject, recordIds: row\.record_ids \|\| \[\] \}\)/, "Study Prep gets the READ subject");
  assert.doesNotMatch(structure, /subjectKey\(found\) !== subjectKey\(row\.subject\)/, "the old guess-vs-read comparison (the move) is gone");
});

test("the fallbacks: no subject → Unsorted + ask; a finally-failed read → Unsorted, once", () => {
  assert.match(structure, /else if \(!found\) filing = \{ needsSubject: true, subjectOptions: guesses \}/, "no subject and nowhere to file: the card still asks");
  assert.match(routes, /async function fileUnsorted\(userId, row\)/, "the fallback filer exists");
  assert.match(structure, /if \(final && !back\.folder_id && back\.record_ids\?\.length\) settled = await fileUnsorted\(userId, back\)/, "only the FINAL failed try files the fallback — a retry is still coming otherwise");
});

test("single narration: the turn never names a folder; one server completion message reports the filing", () => {
  assert.doesNotMatch(chat, /each folder's card shows its files/, "the old turn text (which named the guessed folder) is gone");
  assert.doesNotMatch(chat, /r\.folder_name \?/, "the turn's context no longer reads the ingest's folder at all");
  assert.match(chat, /don't name a folder \(it isn't decided yet\)/, "the model is told the filing isn't decided");
  const inserts = routes.match(/from\("chat_messages"\)\.insert/g) || [];
  assert.equal(inserts.length, 1, "exactly one server post into the chat: the read's completion message");
  assert.match(structure, /const filed = filingSentence\(/, "that message opens with where the read filed it");
});
