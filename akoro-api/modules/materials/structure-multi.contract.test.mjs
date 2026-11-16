/**
 * Several files in one upload (2026-10-25: "more than one upload on chat, only
 * one file extracted and parsed"). Production showed every file extracted but a
 * 4-file upload structured only 3, the reads ran one after another (3–5 reads of
 * up to 50 s outran the app's 120 s wait, so the found-message missed the open
 * chat), the records came back in any order, and the chips came from one file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync(new URL("./routes.js", import.meta.url), "utf8");
// Scoped to the whole structure handler (it outgrew the old fixed 6000-char
// window when Stage 4's filing block landed in it); the assertions are unchanged.
const structure = routes.slice(routes.indexOf('router.post("/ingest/:id/structure"'), routes.indexOf("async function findSimilar"));

test("every file the upload can hold is read", () => {
  assert.match(routes, /const STRUCTURE_FILES = INGEST_LIMITS\.FILES;/);
});

test("the files are read at once, not one after another", () => {
  assert.match(structure, /await Promise\.all\(records\.map\(\(record\) => readStructure\(record, row, userId\)\)\)/);
  assert.doesNotMatch(structure, /for \(const record of records[^)]*\) \{\s*const pages = await/);
});

test("in the order they were attached — the first file leads", () => {
  assert.match(structure, /const records = ids\.map\(\(id\) => \(fetched \|\| \[\]\)\.find\(\(r\) => r\.id === id\)\)\.filter\(Boolean\)/);
});

test("the chips come from every file read", () => {
  assert.match(structure, /topics: items\.flatMap\(\(it\) => it\.topics \|\| \[\]\)/);
  assert.match(structure, /structureChips\(allFiles\)/);
});

test("one file's failed read never fails the others", () => {
  const fn = routes.slice(routes.indexOf("async function readStructure"), routes.indexOf("async function readStructure") + 1800);
  assert.match(fn, /catch \(error\) \{\s*readOk = false;/);
  assert.match(fn, /pagesOfRecord\(record\)\.catch\(\(\) => \[\]\)/);
});
