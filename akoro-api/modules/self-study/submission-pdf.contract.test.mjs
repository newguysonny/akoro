import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const { sniffSubmissionFile, storeSubmissionFile, readSubmissionFile, contentDisposition } = await import("./submissionFiles.js");
const { buildSubmissionPdf, submissionMarkdown } = await import("./submissionPdf.js");
const { briefForLearner, pdfIsCurrent, pdfMeta } = await import("./submissionView.js");
const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const manifest = await readFile(new URL("../../migrations/manifest.json", import.meta.url), "utf8");
const migration = await readFile(new URL("../../migrations/2026-submission-storage.sql", import.meta.url), "utf8");

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const makePdf = async (n) => {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) d.addPage([600, 800]).drawText(`Worked page ${i + 1}`, { x: 50, y: 700, size: 14, font: f });
  return Buffer.from(await d.save());
};

test("files are judged by their bytes, not their label", async () => {
  assert.equal(sniffSubmissionFile(await makePdf(1), "x.png").kind, "pdf");
  assert.deepEqual(sniffSubmissionFile(PNG_1x1, "photo.pdf"), { kind: "image", format: "png", mime: "image/png" });
  assert.equal(sniffSubmissionFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]), "a").format, "jpeg");
  assert.equal(sniffSubmissionFile(Buffer.from("PK\x03\x04....word/document.xml"), "a.docx").kind, "docx");
  assert.equal(sniffSubmissionFile(Buffer.from("PK\x03\x04....xl/workbook.xml"), "a.xlsx"), null);       // other zips refused
  assert.equal(sniffSubmissionFile(Buffer.from("Hello, my essay.\nLine two."), "essay.txt").kind, "text");
  assert.equal(sniffSubmissionFile(Buffer.from("Hello"), "essay.exe"), null);
  assert.equal(sniffSubmissionFile(Buffer.from("MZ\x90\x00\x03\x00\x00\x00"), "virus.txt"), null);      // binary in a .txt
});

test("storage: object store first, the row's base64 when it refuses; bytes read back either way", async () => {
  const bytes = Buffer.from("essay text");
  const stored = await storeSubmissionFile({ learnerId: "u1", targetId: "t1", name: "my essay (final).txt", bytes, mime: "text/plain" },
    { put: async ({ userId, name }) => `records/${userId}/123-${name}` });
  assert.deepEqual(stored, { storage_key: "records/u1/123-submissions/t1/my_essay__final_.txt", data: null });
  const fallback = await storeSubmissionFile({ learnerId: "u1", targetId: "t1", name: "a.txt", bytes, mime: "text/plain" },
    { put: async () => { throw new Error("no R2"); } });
  assert.deepEqual(fallback, { storage_key: null, data: bytes.toString("base64") });
  assert.equal((await readSubmissionFile({ data: fallback.data })).toString(), "essay text");
  assert.equal((await readSubmissionFile({ storage_key: "k" }, { presign: async (k) => `https://s/${k}`, download: async (u) => Buffer.from(u) })).toString(), "https://s/k");
  await assert.rejects(readSubmissionFile({}), /no stored bytes/);
});

test("the download header is RFC 6266 (readable names, no %20)", () => {
  assert.equal(contentDisposition("My Essay ọ.pdf"), `inline; filename="My Essay _.pdf"; filename*=UTF-8''My%20Essay%20%E1%BB%8D.pdf`);
  assert.match(contentDisposition('a"b.pdf', "attachment"), /^attachment; filename="a_b\.pdf"/);
});

test("learners never get the answer key before grading", () => {
  const details = { rubric: [{ criterion: "Accuracy", points: 4 }], questions: ["Plain", { q: "Pick", options: ["a", "b"], correct: 1, explanation: "b is right", max_points: 2 }] };
  const before = briefForLearner(details, false);
  assert.deepEqual(before.questions[1], { q: "Pick", options: ["a", "b"], max_points: 2 });
  assert.equal(before.questions[0], "Plain");
  assert.deepEqual(before.rubric, details.rubric);
  assert.equal(briefForLearner(details, true), details);            // graded → the review marks right/wrong
  assert.deepEqual(briefForLearner(null, false), {});
});

test("the PDF meta: current only for the submission it was built for; the key never leaves", () => {
  const t = { submission: { submittedAt: "2026-10-10T08:00:00Z" }, submission_pdf: { key: "records/u/x.pdf", pages: 5, notes: [], builtFor: "2026-10-10T08:00:00Z" } };
  assert.equal(pdfIsCurrent(t), true);
  assert.deepEqual(pdfMeta(t), { ready: true, pages: 5, notes: [] });
  const resubmitted = { ...t, submission: { submittedAt: "2026-10-11T08:00:00Z" } };
  assert.equal(pdfIsCurrent(resubmitted), false);
  assert.deepEqual(pdfMeta(resubmitted), { ready: false, pages: null, notes: [] });
  assert.equal(pdfMeta({ submission: {} }), null);
});

const input = async () => ({
  assignment: { title: "Photosynthesis", subject: "Biology", details: { questions: [
    { q: "Which pigment absorbs light?", options: ["Haemoglobin", "Chlorophyll"], correct: 1, max_points: 2 },
    { q: "Why are leaves thin?" },
    "Name a product.",
  ] } },
  learner: { name: "Adéwálé Ọlọ́wọ̀", username: "adewale" },
  submission: { text: "Ẹ ku àárọ̀. مرحبا", answers: { 0: 1, 1: "So gases diffuse quickly." }, submittedAt: "2026-10-10T08:30:00Z" },
  files: [
    { name: "working.pdf", size: 100, kind: "pdf", bytes: await makePdf(3), text: "Worked page 1" },
    { name: "photo.png", size: 70, kind: "image", bytes: PNG_1x1, text: null },
    { name: "notes.txt", size: 10, kind: "text", bytes: Buffer.from("My notes.\n\nMore notes."), text: "My notes.\n\nMore notes." },
    { name: "broken.pdf", size: 9, kind: "pdf", bytes: Buffer.from("%PDF-junk"), text: null },
  ],
});

test("one PDF: cover + answers, attached PDFs merged page for page, photos and text placed, failures noted", async () => {
  const { bytes, pages, notes } = await buildSubmissionPdf(await input());
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), pages);
  // cover/answers (1) + PDF header (1) + 3 merged + photo (1) + text (1) + broken (1) + notes (1)
  assert.equal(pages, 9);
  assert.equal(doc.getTitle(), "Photosynthesis — Adéwálé Ọlọ́wọ̀");
  assert.deepEqual(notes, [
    "broken.pdf: couldn't be added — open the original.",
    `5 characters this PDF's font can't show were replaced with "?" — the original text is in the submission.`,
  ]);
});

test("a long PDF attachment is capped; an empty submission says so", async () => {
  const many = await buildSubmissionPdf({ submission: {}, files: [{ name: "big.pdf", size: 1, kind: "pdf", bytes: await makePdf(160) }] });
  assert.match(many.notes[0], /only the first 150 pages/);
  const empty = await buildSubmissionPdf({ assignment: { title: "T" }, learner: { name: "L" }, submission: {} });
  assert.equal(empty.pages, 1);
});

test("the markdown copy carries the same work for machines — and no answer key", async () => {
  const md = submissionMarkdown(await input());
  assert.match(md, /^# Photosynthesis\n/);
  assert.match(md, /- \*\*\[x\]\*\* B\. Chlorophyll/);
  assert.match(md, /Answer: B/);
  assert.match(md, /### Q3\. Name a product\.\n\n_No answer_/);
  assert.match(md, /### notes\.txt\n\nMy notes\./);
  assert.match(md, /### photo\.png\n\n_An image — see the PDF\._/);
  assert.doesNotMatch(md, /correct/i);
});

test("routes: sniffed uploads to storage, submit locks after grading and after hand-in, the PDF route is shared", () => {
  assert.match(routes, /const sniffed = sniffSubmissionFile\(bytes, clean\);\n  if \(!sniffed\) return bad/);
  assert.match(routes, /storeSubmissionFile\(\{ learnerId: req\.user\.id/);
  assert.match(routes, /if \(target\.grade != null\) return res\.status\(409\)/);
  assert.match(routes, /This work was already handed in — your teacher has it\./);   // one hand-in only
  assert.ok(!/const stray = /.test(routes), "every file on the target is handed in — nothing is pruned at submit");
  assert.match(routes, /buildSubmissionArtifacts\(target\.id\)\n    \.catch/);
  assert.match(routes, /router\.get\(\/\^\\\/targets\\\/\(\[0-9a-f-\]\{36\}\)\\\/submission\\\.\(pdf\|md\)\$\/i/);
  assert.match(routes, /details:\s+briefForLearner\(a\.details, t\.grade != null\)/);
  assert.match(routes, /if \(sentFeedback == null\) \{/);               // a score-only publish keeps feedback
  assert.match(routes, /files:\s+\(filesByTarget\.get\(t\.id\) \?\? \[\]\)\.filter\(\(f\) => handedIn\.has\(f\.id\)\)/);
  assert.match(routes, /router\.delete\("\/:id\/targets\/:studentId\/grade"/);   // unpublish
  assert.match(migration, /ADD COLUMN IF NOT EXISTS storage_key TEXT/);
  assert.match(migration, /ALTER COLUMN data DROP NOT NULL/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS submission_pdf JSONB/);
  assert.ok(JSON.parse(manifest).schema.includes("2026-submission-storage.sql"));
});
