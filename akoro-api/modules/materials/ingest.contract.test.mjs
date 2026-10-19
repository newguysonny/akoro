import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canTransition } from "../workflows/definition.js";
import { workflowDefinition } from "../workflows/registry.js";
import { folderItemFor, folderNameFor, guessKind, ingestToApi, ingestWorkflow, shapeClassification } from "./ingestCore.js";
import { uploadChip, uploadsFrom } from "../adaptive-learning/chatSuggestions.js";

const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const chat = await readFile(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");
const app = await readFile(new URL("../../app.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../../migrations/manifest.json", import.meta.url), "utf8"));

test("material_ingest is a registered workflow; Undo is final and reachable from every live state", () => {
  assert.equal(workflowDefinition("material_ingest"), ingestWorkflow);
  for (const s of ingestWorkflow.states.filter((x) => x !== "undone")) assert.ok(canTransition(ingestWorkflow, s, "undone"), `${s} → undone`);
  assert.deepEqual(ingestWorkflow.transitions.undone, []);
  assert.ok(!canTransition(ingestWorkflow, "received", "ready"), "a batch is filed before it is ready");
  assert.ok(canTransition(ingestWorkflow, "failed", "extracting"), "a failed read can be retried");
});

test("the folder: subject and kind, private, an existing one reused (D51, D53)", () => {
  assert.equal(folderNameFor({ subject: "biology", kind: "past_paper" }), "Biology — Past papers");
  assert.equal(folderNameFor({ subject: null, kind: "notes", topic: "cell structure" }), "Cell Structure — Notes");
  assert.equal(folderNameFor({}), "From chat — Materials");
  assert.deepEqual(guessKind({ names: ["WAEC Biology 2019 Paper 2.pdf"] }), { subject: "Biology", kind: "past_paper", topic: null });
  assert.equal(guessKind({ names: ["scan.jpg"], ask: "my maths notes" }).subject, "Mathematics");
  assert.equal(guessKind({ names: ["WAEC Biology2019.pdf"] }).subject, "Biology", "a subject glued to a year still counts");
  // A past-paper name wins over a model that missed it; an off-list kind falls back.
  assert.equal(shapeClassification({ subject: "Biology", kind: "notes", topic: null }, { subject: null, kind: "past_paper" }).kind, "past_paper");
  assert.equal(shapeClassification({ subject: "x", kind: "poem", topic: null }, { subject: null, kind: "notes" }).kind, "notes");
  assert.match(routes, /visibility: "private"/);
  assert.match(routes, /f\.name\.toLowerCase\(\) === name\.toLowerCase\(\)/);
  assert.deepEqual(folderItemFor({ id: "r1", name: "a.pdf", mime: "application/pdf" }, "past_paper"),
    { item_type: "record", item_ref: "r1", title: "a.pdf", sub: "From chat · Past papers", kind: "pdf", link: null });
  assert.equal(ingestToApi({ id: "i", state: "filed", folder_id: "f", folder_name: "Biology — Notes", folder_created: true, doc_kind: "notes" }).folder.created, true);
});

test("Undo removes exactly what the upload made", () => {
  const undo = routes.slice(routes.indexOf('"/ingest/:id/undo"'));
  assert.match(undo, /library_folder_items"\)\.delete\(\)\.eq\("user_id", userId\)\.eq\("item_type", "record"\)\.in\("item_ref", ids\)/);
  assert.match(undo, /from\("records"\)\.delete\(\)\.eq\("user_id", userId\)\.in\("id", ids\)/);
  assert.match(undo, /row\.folder_id && row\.folder_created/, "a folder is removed only if this upload made it");
  assert.match(undo, /if \(!count\)/, "…and only when it is empty");
  assert.match(routes, /assertTransition\(ingestWorkflow, row\.state, to\)/, "every move is checked against the definition");
  assert.match(routes, /__payer: "platform", __feature: "material_ingest"/);
});

test("wiring: mounted, migrated after its folders, the chat turn carries the upload card", () => {
  assert.match(app, /app\.use\("\/api\/agent\/materials", standardLimit, materialsModule\)/);
  const order = manifest.schema || manifest.migrations || Object.values(manifest).flat();
  assert.ok(order.indexOf("2026-material-ingest.sql") > order.indexOf("2026-library-folder-items.sql"));
  assert.match(chat, /ingest \? \{ ingest: \{ id: ingest\.id \} \}/);
  assert.match(chat, /chat_message_id: messageId/);
});

test("suggestions: after an upload one chip is always the study step (§7.17.5)", () => {
  assert.equal(uploadChip(uploadsFrom([{ name: "WAEC Biology 2019.pdf", kind: "past_paper" }])), "Find the topics that keep coming up");
  assert.equal(uploadChip(uploadsFrom([{ name: "Cell notes.pdf", kind: "notes" }])), "Make a study plan from Cell notes");
  assert.equal(uploadChip(uploadsFrom([{ name: "a.pdf" }, { name: "b.pdf" }])), "Make a study plan from these files");
  assert.equal(uploadChip([]), null);
  assert.match(chat, /\[guideChip\(notTaught\), uploadChip\(uploads\)\]/);
});

test("a chat upload is private: never in Discover, never opened or asked by anyone else (D51, D53)", async () => {
  const recRoutes = await readFile(new URL("../records/routes.js", import.meta.url), "utf8");
  const access = await readFile(new URL("../records/access.js", import.meta.url), "utf8");
  const mig = await readFile(new URL("../../migrations/2026-material-structure.sql", import.meta.url), "utf8");
  assert.match(mig, /ALTER TABLE edu\.records ADD COLUMN IF NOT EXISTS private boolean NOT NULL DEFAULT false/);
  assert.match(routes, /from\("records"\)\.update\(\{ private: true \}\)\.eq\("user_id", req\.user\.id\)\.in\("id", ids\)/);
  assert.match(recRoutes, /query = query\.eq\("private", false\);/, "the Discover feed leaves private records out");
  assert.match(recRoutes, /if \(r\.private && r\.user_id !== req\.user\.id\) return res404/, "…and won't open one");
  assert.match(access, /if \(rec\.private && rec\.user_id !== userId\) return \{ status: 404/, "shared-file access (ask, guide, extract) refuses it");
});
