import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const { sanitizeSvg, cleanFigure, cleanPaperDetails, paperBlocks, passageRange, figurePng, LIMITS } = await import("./paperLayout.js");
const { buildSubmissionPdf, submissionMarkdown } = await import("./submissionPdf.js");
const { buildAiGradeMessages } = await import("./aiGrade.js");
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [guide, routes, createAssignment, page, builder, learnerPaper, instructorPaper, detail, marker] = await Promise.all([
  read("../adaptive-learning/agents/nana-esumai/guide.js"), read("./routes.js"), read("./createAssignment.js"),
  Promise.all([   // the Activities page and the parts it was split into
    "../../../akoro-instructor/src/pages/ActivitiesPage.jsx", "../../../akoro-instructor/src/components/activities/ActivityForm.jsx",
    "../../../akoro-instructor/src/pages/activities-page/ActivitiesHome.jsx", "../../../akoro-instructor/src/pages/activities-page/DetailPage.jsx",
    "../../../akoro-instructor/src/pages/activities-page/DraftsStrip.jsx",
  ].map(read)).then((parts) => parts.join("\n")), read("../../../akoro-instructor/src/components/paper/PaperBuilder.jsx"),
  read("../../../akoro-learner/src/lib/paper.js"), read("../../../akoro-instructor/src/lib/paper.js"),
  read("../../../akoro-learner/src/pages/ActivityDetailPage.jsx"), read("../../../akoro-instructor/src/components/grading/QuestionMarker.jsx"),
]);

const TRIANGLE = '<svg viewBox="0 0 320 220"><polygon points="40,190 280,190 40,40" fill="none" stroke="#000"/><text x="150" y="210" font-size="14">8 cm</text></svg>';

test("figures: the SVG is rebuilt from an allow-list — shapes and text only", () => {
  const dirty = `<svg viewBox="0 0 10 10" onload="alert(1)" style="x"><script>alert(1)</script><foreignObject><div>x</div></foreignObject>`
    + `<line x1="0" y1="0" x2="10" y2="10" stroke="#000" onclick="x"/><image href="https://evil/x.png"/><path d="M0 0" fill="url(https://x)"/>`
    + `<text x="1" y="9">a &lt; b &deg; <tspan>30°</tspan></text></svg>`;
  const svg = sanitizeSvg(dirty);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'));
  for (const bad of ["script", "onload", "onclick", "foreignObject", "image", "evil", "style=", "url(https"]) assert.ok(!svg.includes(bad), `${bad} removed`);
  assert.match(svg, /<line x1="0"/);
  assert.match(svg, /a &lt; b &amp;deg; <tspan>30°<\/tspan>/);
  assert.equal(sanitizeSvg("<div>no svg</div>"), null);
  assert.equal(sanitizeSvg('<svg viewBox="0 0 1 1"></svg>'), null, "nothing drawn");
  assert.equal(sanitizeSvg(`<svg>${"<line/>".repeat(LIMITS.svgChars)}</svg>`), null, "too big");
  assert.equal(sanitizeSvg(42), null);
});

test("figures: uploaded images must be small data: URLs of real image types", () => {
  assert.deepEqual(cleanFigure({ src: "data:image/png;base64,AAAA", caption: " Fig 1 " }), { src: "data:image/png;base64,AAAA", caption: "Fig 1" });
  assert.equal(cleanFigure({ src: "data:image/svg+xml;base64,AAAA" }), null);
  assert.equal(cleanFigure({ src: "https://example.com/x.png" }), null);
  assert.equal(cleanFigure({ src: `data:image/png;base64,${"A".repeat(LIMITS.imageChars)}` }), null);
  assert.ok(cleanFigure({ svg: TRIANGLE }).svg.includes("<polygon"));
});

test("details: sections and passages are bounded; dangling references dropped; figure budget kept", () => {
  const big = `data:image/png;base64,${"A".repeat(LIMITS.imageChars - 40)}`;
  const d = cleanPaperDetails({
    rubric: [{ criterion: "x", points: 1 }],
    sections: [{ title: "  Section A ", instructions: "Choose A to E." }, ...Array(20).fill({ title: "s" })],
    passages: [{ title: "P", text: "Ade woke." }],
    questions: [
      { q: "one", section: 0, passage: 0, figure: { svg: TRIANGLE } },
      { q: "two", section: 99, passage: "0", figure: { svg: "<script/>" } },
      "plain",
      ...Array(5).fill(0).map((_, i) => ({ q: `big ${i}`, figure: { src: big } })),
    ],
  });
  assert.equal(d.sections.length, LIMITS.sections);
  assert.equal(d.sections[0].title, "Section A");
  assert.deepEqual(d.rubric, [{ criterion: "x", points: 1 }], "other details pass through");
  assert.equal(d.questions[0].section, 0);
  assert.ok(d.questions[0].figure.svg);
  assert.equal("section" in d.questions[1], false);
  assert.equal(d.questions[1].passage, 0);
  assert.equal("figure" in d.questions[1], false);
  assert.equal(d.questions[2], "plain");
  const kept = d.questions.slice(3).filter((q) => q.figure).length;
  assert.ok(kept >= 1 && kept < 5, `figure budget caps the uploads (kept ${kept})`);
  assert.deepEqual(cleanPaperDetails({ questions: [] }), { questions: [] }, "no empty layout keys added");
});

test("blocks: reading order, a section heads once, a passage names its questions", () => {
  const b = paperBlocks({
    sections: [{ title: "A" }, { title: "B" }], passages: [{ text: "p" }],
    questions: [{ q: 1, section: 0 }, { q: 2, section: 1, passage: 0 }, { q: 3, section: 1, passage: 0 }, { q: 4, section: 1 }],
  });
  assert.deepEqual(b.map((x) => [x.sectionIndex, x.passageIndex, x.newSection, x.items.length]), [[0, null, true, 1], [1, 0, true, 2], [1, null, false, 1]]);
  assert.equal(passageRange(b[1].items), "Questions 2–3");
});

test("the submission PDF prints sections, the passage and the figure; markdown carries them as text", async () => {
  const assignment = {
    title: "Paper", details: {
      sections: [{ title: "Section A", instructions: "Choose the correct option from A to E." }],
      passages: [{ title: "The farmer", text: "Ade woke at dawn." }],
      questions: [
        { q: "Find the hypotenuse in the diagram below.", options: ["8 cm", "10 cm", "12 cm", "14 cm", "16 cm"], correct: 1, section: 0, figure: { svg: sanitizeSvg(TRIANGLE), caption: "Fig. 1" } },
        { q: "When did Ade wake?", section: 0, passage: 0 },
      ],
    },
  };
  const input = { assignment, learner: { name: "Ada" }, submission: { answers: { 0: 1, 1: "At dawn" }, submittedAt: "2026-10-10T10:00:00Z" }, files: [] };
  const png = await figurePng(assignment.details.questions[0].figure);
  assert.ok(png && png.bytes.length > 500 && png.type === "png");
  const { bytes, notes } = await buildSubmissionPdf(input);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
  assert.deepEqual(notes, []);
  assert.ok(Buffer.from(bytes).includes("/Subtype /Image"), "the figure is embedded");
  const md = submissionMarkdown(input);
  assert.match(md, /### Section A\n\n_Choose the correct option from A to E._/);
  assert.match(md, /> \*\*The farmer\*\* \(Question 2\)\n>\n> Ade woke at dawn\./);
  assert.match(md, /_\[Figure: Fig\. 1 — see the PDF\]_/);
  assert.match(md, /\*\*\[x\]\*\* B\. 10 cm/);
  const [system] = buildAiGradeMessages({ assignment, markdown: md });
  assert.match(system.content, /about passage 1/);
  assert.match(system.content, /Passage 1 — The farmer:\nAde woke at dawn\./);
});

test("wiring: the generator lays out a paper; saving cleans it; the apps render it", () => {
  // The generator's rules live in questionPaper.js (tested there); the guide makes the one bounded call.
  assert.equal((guide.match(/__timeoutMs: 45_000, __maxRetries: 1/g) || []).length, 4);
  assert.ok(routes.includes("ok(res, { ...paper, warning, summary: summarizePaper(paper) })"));
  assert.ok(routes.includes("updates.details = cleanPaperDetails(updates.details)"), "edits are cleaned");
  assert.ok(createAssignment.includes("cleanPaperDetails(details)"), "creates are cleaned");
  assert.ok(page.includes("<PaperBuilder") && page.includes("cleanPaper(form)") && page.includes("<PaperView details={data.details}"));
  assert.ok(builder.includes("MAX_OPTIONS = 5") && builder.includes("Paper preview") && builder.includes("imageFileToDataUrl"));
  assert.equal(learnerPaper, instructorPaper, "lib/paper.js is the same in both apps");
  assert.ok(detail.includes("<QuestionContext key={idx} details={paper}") && detail.includes("<QuestionFigure figure={q?.figure}/>"));
  assert.ok(marker.includes("questionContext(paper, step)"));
});

test("answering: an answer box per question, files and drawings per question, one paper-with-answers for learner and teacher", async () => {
  const [learnerAnswerPaper, instructorAnswerPaper, activityApi, board, modal] = await Promise.all([
    read("../../../akoro-learner/src/components/activity/AnswerPaper.jsx"), read("../../../akoro-instructor/src/components/paper/AnswerPaper.jsx"),
    read("../../../akoro-learner/src/services/activityApi.js"), read("../../../akoro-learner/src/components/teaching/WhiteboardModal.jsx"),
    read("../../../akoro-instructor/src/components/grading/GradeSubmissionModal.jsx"),
  ]);
  assert.equal(learnerAnswerPaper, instructorAnswerPaper, "AnswerPaper is the same in both apps");
  assert.ok(learnerAnswerPaper.includes("readChoice(q, value)") && learnerAnswerPaper.includes("Not answered"));
  // Learner: typed answers autosave; files and drawings belong to a question (≤3); no whole-assignment attach for a paper.
  assert.ok(detail.includes("uploadActivityFile(row.assignmentId, file, i)"));
  assert.ok(detail.includes("PER_QUESTION_FILES = 3"));
  assert.ok(detail.includes("drawing-q${i + 1}.png"));
  assert.ok(detail.includes("onAttach={attachDrawing}"));
  assert.ok(detail.includes("<AnswerPaper details={paper}") && detail.includes("<LastCheck") && detail.includes("<Receipt"));
  assert.ok(!detail.includes("ti-microphone"), "no mic in the answer box");
  assert.ok(activityApi.includes("draftFiles:") && activityApi.includes("{ question }"));
  assert.ok(board.includes("onAttach") && board.includes("initialStrokes") && board.includes("toBlob"));
  // Teacher: the same paper, and the key marks typed answers it can read.
  assert.ok(modal.includes("<AnswerPaper details={brief.details}"));
  assert.ok(marker.includes("readChoice(q, a)") && marker.includes("if (answered && pick == null) return;"));
});

test("the answer box opens a Word-style document editor that hands in a real .docx", async () => {
  const [editor, writer, pkg] = await Promise.all([
    read("../../../akoro-learner/src/components/docs/WordEditor.jsx"), read("../../../akoro-learner/src/lib/wordDoc.js"), read("../../../akoro-learner/package.json"),
  ]);
  assert.ok(detail.includes('label="Write it in a document (like Word)"'));
  assert.ok(detail.includes("lazy(() => import('../components/docs/WordEditor.jsx'))"), "the editor loads only when opened");
  assert.ok(detail.includes("`document-q${i + 1}.docx`") && detail.includes("replaceOwnFile(i, new File([blob], docFileName(i)"));
  for (const tab of ["['file', 'File']", "['home', 'Home']", "['insert', 'Insert']", "['layout', 'Layout']", "['view', 'View']"]) assert.ok(editor.includes(tab), tab);
  assert.ok(editor.includes("Save changes to {fileName}?") && editor.includes("<Ruler box={box}") && editor.includes("Page {at} of {pages}"));
  assert.ok(writer.includes("export function wordToDocx(") && writer.includes("PageOrientation.LANDSCAPE"));
  assert.ok(pkg.includes('"docx": "9.5.0"') && pkg.includes('"@tiptap/react": "2.27.3"'), "editor packages pinned to one version");
});
