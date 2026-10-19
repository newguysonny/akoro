// Sorting chat uploads (Grand Plan §7.17, D51): each file to its subject, into
// the folder the learner already keeps for it — a new folder only when none fits.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalSubject, nameKind, pickFolder, subjectKey, UNSORTED_FOLDER } from "./folderMatch.js";
import { guessFile, shapeClassification } from "./ingestCore.js";
import { filingSentence } from "./structureCore.js";

const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");

test("subjects by any name: short forms, class labels and exam names don't hide them", () => {
  assert.equal(canonicalSubject("Bio"), "Biology");
  assert.equal(canonicalSubject("SS2 Biology"), "Biology");
  assert.equal(canonicalSubject("WAEC prep — Maths"), "Mathematics");
  assert.equal(canonicalSubject("Further Maths"), "Further Mathematics", "the longer name wins");
  assert.equal(canonicalSubject("Agric notes"), "Agricultural Science");
  assert.equal(canonicalSubject("Govt past questions"), "Government");
  assert.equal(canonicalSubject("WAEC prep"), null);
  assert.equal(canonicalSubject("Combined"), null, "no subject hiding inside another word");
  assert.equal(subjectKey("biology"), subjectKey("Bio"));
  assert.equal(nameKind("Biology — Past papers"), "past_paper");
  assert.equal(nameKind("Chem notes"), "notes");
  assert.equal(nameKind("SS2 Biology"), null, "a general folder");
});

const F = (id, name) => ({ id, name });

test("the learner's own folder for the subject wins over making one", () => {
  const folders = [F("bio", "Bio"), F("x", "Holiday photos")];
  assert.deepEqual(pickFolder({ subject: "Biology", kind: "past_paper", folders }), { folder: F("bio", "Bio") });
  // Found by what's in it, whatever it's called.
  const byContent = pickFolder({ subject: "Biology", kind: "notes", folders: [F("w", "Term 2 stuff")], stats: [{ folder_id: "w", subject: "biology", count: 3 }] });
  assert.deepEqual(byContent, { folder: F("w", "Term 2 stuff") });
});

test("kept apart only where the learner keeps them apart", () => {
  const folders = [F("n", "Biology — Notes")];
  assert.deepEqual(pickFolder({ subject: "Biology", kind: "past_paper", folders }), { create: "Biology — Past papers" }, "notes and papers already apart");
  const both = [F("n", "Biology — Notes"), F("p", "Biology past questions")];
  assert.deepEqual(pickFolder({ subject: "Biology", kind: "past_paper", folders: both }), { folder: F("p", "Biology past questions") });
  assert.deepEqual(pickFolder({ subject: "Biology", kind: "notes", folders: [F("g", "SS2 Biology"), F("p", "Biology past questions")] }), { folder: F("g", "SS2 Biology") });
});

test("two that fit equally: ask, the fuller one first; a choice made before is used", () => {
  const folders = [F("a", "SS2 Biology"), F("b", "Bio revision")];
  const stats = [{ folder_id: "b", subject: "Biology", count: 4 }, { folder_id: "a", subject: "Biology", count: 1 }];
  const asked = pickFolder({ subject: "Biology", kind: "notes", folders, stats });
  assert.deepEqual(asked.choices.map((c) => c.id), ["b", "a"]);
  const remembered = pickFolder({ subject: "Biology", kind: "notes", folders, stats, defaults: [{ subject_key: "biology", kind: "notes", folder_id: "a" }] });
  assert.deepEqual(remembered, { folder: F("a", "SS2 Biology") });
  const anyKind = pickFolder({ subject: "Biology", kind: "past_paper", folders, stats, defaults: [{ subject_key: "biology", kind: "", folder_id: "b" }] });
  assert.deepEqual(anyKind, { folder: F("b", "Bio revision") });
});

test("no subject: held in Unsorted; at the folder cap: the closest folder, never a new one", () => {
  assert.deepEqual(pickFolder({ subject: null, kind: "other", folders: [] }), { create: UNSORTED_FOLDER });
  assert.deepEqual(pickFolder({ subject: null, kind: "other", folders: [F("u", UNSORTED_FOLDER)] }), { folder: F("u", UNSORTED_FOLDER) });
  assert.deepEqual(pickFolder({ subject: "Biology", kind: "past_paper", folders: [F("n", "Biology — Notes")], atCap: true }), { folder: F("n", "Biology — Notes") });
  assert.deepEqual(pickFolder({ subject: "Physics", kind: "notes", folders: [F("n", "Biology — Notes")], atCap: true }), { none: true });
});

test("each file sorted by its own name; the learner's words only fill in what a name doesn't say", () => {
  assert.deepEqual(guessFile("chemistry_notes.docx", "my biology papers"), { subject: "Chemistry", kind: "notes", topic: null });
  assert.equal(guessFile("scan_001.jpg", "my biology papers").subject, "Biology");
  const names = ["WAEC Biology 2019.pdf", "Acids and bases notes.docx", "scan_001.jpg"];
  const out = shapeClassification({ files: [
    { index: 1, subject: "Biology", kind: "past_paper", topic: null },
    { index: 2, subject: "Chemistry", kind: "notes", topic: "Acids and bases" },
    { index: 3, subject: null, kind: "other", topic: null },
  ] }, names, "");
  assert.deepEqual(out.map((x) => x.subject), ["Biology", "Chemistry", null]);
  assert.equal(out[1].topic, "Acids and bases");
  assert.equal(shapeClassification("not json", names, "").length, 3, "a broken answer still gives every file a guess");
});

test("the post-back says where it went: moved, which folder, or which subject", () => {
  assert.equal(filingSentence({ names: ["scan_001.jpg"], title: "NECO Physics 2020", folder: "Physics — Past papers", filing: { movedFrom: UNSORTED_FOLDER } }),
    "**scan_001.jpg** is **NECO Physics 2020**, so I've moved it to **Physics — Past papers**.");
  assert.match(filingSentence({ names: ["scan_002.jpg"], summary: "About soil and crop rotation.", filing: { needsSubject: true } }), /Which subject is it\?/);
  assert.match(filingSentence({ names: ["b.pdf"], subject: "Biology", filing: { choices: [{ name: "SS2 Biology" }, { name: "WAEC Biology" }] } }), /\*\*SS2 Biology\*\* or \*\*WAEC Biology\*\*/);
  assert.equal(filingSentence({ names: ["a.pdf"], filing: {} }), "");
});

test("wiring: one upload per folder, a batch id, the choices and subjects answered, moved after reading", () => {
  assert.match(routes, /const where = await resolveFolder\(userId, \{ subject: g\.subject, kind: g\.kind \}, ctx\)/);
  assert.match(routes, /batch_id: batchId/);
  assert.match(routes, /ingests: made\.map\(ingestToApi\), batchId/);
  assert.match(routes, /router\.post\("\/ingest\/:id\/folder"/);
  assert.match(routes, /from\("material_folder_defaults"\)\.upsert/, "a choice is remembered");
  assert.match(routes, /router\.post\("\/ingest\/:id\/subject"/);
  assert.match(routes, /filing = \{ movedFrom: row\.folder_name \|\| null, choices: null \}/);
  assert.match(routes, /needsSubject: true, subjectOptions/);
  assert.match(routes, /router\.get\("\/chat\/:chatId"/);
});
