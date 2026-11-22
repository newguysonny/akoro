// H1/H2/H3: chunks follow the document's structure, never split tables or
// code, drop document-wide boilerplate, and suppress exact duplicates.
import assert from "node:assert/strict";
import test from "node:test";
import { boilerplateLines, chunkHash, chunksForPages, chunksFromMarkdown, cleanForEmbed, stripBoilerplate, MAX_CHUNK_CHARS } from "./searchLib.js";

const page = (pageNumber, markdown) => ({ pageNumber, markdown });

test("headings become section paths on every chunk", () => {
  const md = [
    "# Cell structure",
    "Cells contain organelles.",
    "## Chloroplast",
    "The thylakoid membrane holds the photosystems.",
  ].join("\n");
  const chunks = chunksFromMarkdown(md, { pageNumber: 1 });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].sectionPath, "Cell structure");
  assert.match(chunks[0].text, /Cells contain organelles/);
  assert.equal(chunks[1].sectionPath, "Cell structure > Chloroplast");
});

test("long prose is split to the cap at boundaries, keeping every chunk bounded", () => {
  const para = "Photosynthesis converts light energy into chemical energy. ".repeat(50);
  const chunks = chunksFromMarkdown(para);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.text.length <= MAX_CHUNK_CHARS, `${c.text.length} > cap`);
  assert.ok(chunks.map((c) => c.text).join(" ").includes("chemical energy"));
});

test("a table is atomic even when it is larger than the cap", () => {
  const rows = ["| Process | ATP |", "| --- | --- |", ...Array.from({ length: 120 }, (_, i) => `| Step ${i} | ${i} |`)].join("\n");
  const chunks = chunksFromMarkdown(`# Yield\n${rows}`);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].oversized, true);
  assert.ok(chunks[0].text.includes("Step 119"));
});

test("code fences stay whole; figure-only content is not embedded", () => {
  const md = ["# Code", "```js", "const a = 1;", "```", "# Figure", "*[figure]*"].join("\n");
  const chunks = chunksFromMarkdown(md);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0].text, /const a = 1/);
  assert.ok(!chunks.some((c) => /\[figure\]/.test(c.text)));
});

test("document-wide headers and page numbers are stripped, content stays", () => {
  const pages = [
    page(1, "BIO 111 — General Biology\nPage 1\nThe cell is the unit of life."),
    page(2, "BIO 111 — General Biology\nPage 2\nOrganelles divide the labour."),
    page(3, "BIO 111 — General Biology\nPage 3\nEnergy flows through membranes."),
  ];
  const boiler = boilerplateLines(pages);
  assert.ok(boiler.has("BIO 111 — General Biology"));
  const stripped = stripBoilerplate(pages[0].markdown, boiler);
  assert.ok(!stripped.includes("BIO 111"));
  assert.ok(!stripped.includes("Page 1"));
  assert.match(stripped, /unit of life/);
});

test("identical pages collapse to one chunk (exact dedupe)", () => {
  const body = "The mitochondria produce ATP through respiration in the cristae.";
  const rows = chunksForPages([page(1, body), page(2, body)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contentHash, chunkHash(body));
});

test("content hashes ignore case and punctuation, not meaning", () => {
  assert.equal(chunkHash("The Cell, the cell!"), chunkHash("the cell the cell"));
  assert.notEqual(chunkHash("cell"), chunkHash("cells"));
});

test("character offsets are present, ordered and within the cleaned page", () => {
  const md = "# A\nFirst sentence here.\n\nSecond paragraph here.\n\nThird paragraph closes the section.";
  const rows = chunksFromMarkdown(md);
  let last = -1;
  for (const c of rows) {
    assert.ok(Number.isInteger(c.charStart) && Number.isInteger(c.charEnd));
    assert.ok(c.charStart >= last);
    assert.ok(c.charEnd > c.charStart);
    last = c.charStart;
  }
});

test("cleanForEmbed removes OCR layout tokens but keeps table pipes", () => {
  const cleaned = cleanForEmbed("<|ref|>text<|/ref|><|box|>[[1,2,3,4]]<|/box|>\n| a | b |\n| c | d |");
  assert.ok(!cleaned.includes("<|"));
  assert.match(cleaned, /\| a \| b \|/);
});
