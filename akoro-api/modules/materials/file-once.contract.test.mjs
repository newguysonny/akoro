/**
 * Stage 4 — file once, narrate once (chat-upload-materials plan).
 *
 * The send path used to classify files by NAME (a model call), file them
 * into the guessed folder at once, and let the read move them again — the
 * learner watched "From chat — Unsorted" become "Chemistry — Notes", and
 * heard the filing twice (the turn's reply naming the guess, then the
 * completion message correcting it). Stage 4: create starts the upload
 * unfiled; /records only attaches; the read files ONCE. Agent-driven
 * (2026-11-16): the filing mechanics live in filingDb.fileIngestFromDecision,
 * shared by /structure and the agent's file_upload tool — and the server
 * posts NOTHING into the chat; the agent narrates its own filing.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const filingDb = await readFile(new URL("./filingDb.js", import.meta.url), "utf8");
const uploadTools = await readFile(new URL("./uploadTools.js", import.meta.url), "utf8");
const chat = await readFile(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");

const create = routes.slice(routes.indexOf('router.post("/ingest"'), routes.indexOf('router.post("/ingest/:id/records"'));
const records = routes.slice(routes.indexOf('router.post("/ingest/:id/records"'), routes.indexOf('router.post("/ingest/:id/progress"'));
const structure = routes.slice(routes.indexOf('router.post("/ingest/:id/structure"'), routes.indexOf("async function findSimilar"));
const filing = filingDb.slice(filingDb.indexOf("export async function fileIngestFromDecision"));

test("create: no classify, no folder — the upload starts unfiled", () => {
  assert.doesNotMatch(routes, /__feature: "material_ingest"/, "the name-classify model call is off the send path entirely");
  assert.doesNotMatch(create, /classify\(|resolveFolder|folderContext|sortSteps|folderSteps/, "create guesses nothing and files nothing");
  assert.match(create, /state: "received",\s*folder_id: null, folder_name: null, folder_created: false,\s*doc_kind: null, subject: null/, "the row starts with no folder, subject or kind");
  assert.match(create, /filing: \{ fileIndexes: names\.map\(\(_, i\) => i\) \}/, "one upload holds the message's files, in order");
  assert.match(create, /receivedSteps\(\{ batchId, count: names\.length \}\)/, "the steps say it will be read, then filed — not where");
  assert.match(create, /replaced\?\.state === "undone" && replaced\.chat_message_id/, "\"Save it again\" still takes over the undone upload's message");
});

test("records: attached under the Library visibility rule, but NOT filed and NOT sent to Study Prep yet", () => {
  assert.doesNotMatch(records, /library_folder_items/, "no folder items are written before the read");
  assert.doesNotMatch(records, /attachUploadsToStudyPrep/, "Study Prep waits for the read subject");
  assert.doesNotMatch(records, /update\(\{ private: true \}\)/, "no blanket private marking — chat uploads follow the Library rule (public for free, Premium excluded in Discover)");
  assert.match(records, /savedSteps\(\{ ingestId: row\.id, first \}\)/, "the step says saved — not filed");
});

test("filing happens ONCE, from the decision — and the Study Prep attach goes with it", () => {
  assert.match(structure, /fileIngestFromDecision\(\{ userId, row, subject, kind, guesses, structure, items, questions, records \}\)/, "/structure delegates to the shared filing");
  assert.match(filing, /await resolveFolder\(userId, \{ subject, kind \}, await folderContext\(userId\)\)/, "one resolution, from the decision's subject (null → Unsorted via pickFolder)");
  assert.match(filing, /filePatch = await refile\(userId, \{ \.\.\.row, doc_kind: kind \}/, "the files land in that folder — there is no earlier filing to move");
  assert.match(filing, /filing = subject \? \{ filed: true,/, "a first filing is recorded as filed, not moved");
  assert.match(filing, /filedSteps\(\{ ingestId: row\.id, folderName: row\.folder_name, first \}\)/, "the filing step is written at the filing, with the real folder");
  assert.match(filing, /attachUploadsToStudyPrep\(\{ learnerId: userId, subject, recordIds: row\.record_ids \|\| \[\] \}\)/, "Study Prep gets the decision's subject");
  assert.doesNotMatch(routes + filingDb, /subjectKey\(found\) !== subjectKey\(row\.subject\)/, "the old guess-vs-read comparison (the move) is gone");
});

test("the fallbacks: no subject → Unsorted + ask; a finally-failed read → Unsorted, once", () => {
  assert.match(filing, /else if \(!subject\) filing = \{ needsSubject: true, subjectOptions: guesses \}/, "no subject and nowhere to file: the card still asks");
  assert.match(filingDb, /export async function fileUnsorted\(userId, row\)/, "the fallback filer exists");
  assert.match(structure, /if \(final && !back\.folder_id && back\.record_ids\?\.length\) settled = await fileUnsorted\(userId, back\)/, "only the FINAL failed try files the fallback — a retry is still coming otherwise");
});

test("no server narration: the agent reads, files and narrates with its own tools", () => {
  const inserts = (routes + filingDb).match(/from\("chat_messages"\)\.insert/g) || [];
  assert.equal(inserts.length, 0, "zero server posts into the chat — the agent narrates");
  assert.doesNotMatch(chat, /ingestRecordsContext/, "the extracted text is no longer injected — read_upload is the door");
  assert.match(chat, /## Uploads waiting on you/, "the turn lists the waiting uploads for the agent");
  assert.match(chat, /pendingUploads\.length \? "read_upload"/, "the first call is forced to read_upload");
  assert.match(chat, /never name a folder before file_upload returns it/, "the model names a folder only from the tool result");
  assert.match(uploadTools, /export async function readUploadTool/, "the read is a tool");
  assert.match(uploadTools, /export async function fileUploadTool/, "the filing is a tool");
});
