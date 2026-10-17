/**
 * modules/self-study/paperSchema.js — the printed-paper templates
 * (reference/question-layout-for-activity/submission-crop) as structured
 * output.
 *
 *   paperResponseFormat()        strict JSON schema for a first draft's
 *   revisionResponseFormat()     … and a follow-up's model answer
 *   answerSpaceFor(q)            the space a question leaves for its answer
 *   submissionDocument(...)      a learner's submission as the submission
 *                                template lays it out (one data model the
 *                                apps and the PDF can render)
 *
 * The assignment template: a header (school, title, the parts), details
 * (subject · topic · date · due), the learner's fields, instructions, Parts
 * (sections) with a note, case studies written once (passages), numbered
 * questions with their marks and an answer space — options to circle, lines,
 * a working box with "Answer: ___", a blank in the sentence, True / False
 * boxes, or labels — and a teacher's marking scheme (answer / working ·
 * marks per question).
 *
 * The submission template: the same header with LEARNER SUBMISSION, the
 * learner, answered / unanswered / attachments, each question with the
 * learner's answer under it (the chosen option filled in, typed text, the
 * drawing cropped to the handwriting) and a marks box beside it, "No answer
 * submitted" where there is none, and the teacher's feedback at the end.
 */
import { questionPoints, readChoice } from "./submissionView.js";

/** How a question is answered on paper. */
export const ANSWER_SPACES = Object.freeze(["options", "true_false", "lines", "working", "blank", "labels"]);

const S = (description) => ({ type: ["string", "null"], ...(description ? { description } : {}) });
const N = (type, description) => ({ type: [type, "null"], ...(description ? { description } : {}) });
const LIST = (items, description) => ({ type: ["array", "null"], items, ...(description ? { description } : {}) });

/** One question's fields — strict mode: every field present, null when unused. */
const QUESTION_PROPS = {
  text: S("The question as printed. A fill-in-the-gap question marks its gap with ____."),
  type: S("The question kind's label, exactly as the plan names it (e.g. \"MCQ\", \"Theory\")."),
  format: { type: ["string", "null"], enum: ["true_false", "assertion_reason", "label", "case_study", null] },
  answer_space: { type: ["string", "null"], enum: [...ANSWER_SPACES, null],
    description: "options: circle a letter · true_false: tick True or False · lines: a few written lines · working: a box to show working, then \"Answer: ___\" · blank: fill the ____ in the sentence · labels: name each labelled part" },
  max_points: N("number"),
  difficulty: { type: ["string", "null"], enum: ["Easy", "Medium", "Hard", null] },
  cognitive_level: { type: ["string", "null"], enum: ["Recall", "Understand", "Apply", "Analyze", "Evaluate", "Create", null] },
  options: LIST({ type: "string" }, "Multiple choice only."),
  correct: N("integer", "Multiple choice only: the 0-based index of the right option."),
  answer: S("The model answer (open questions; the final value for working questions)."),
  marking: S("The marking scheme line for the teacher copy: the answer and how its marks split, e.g. \"3x = 20 − 5 (1 mark); x = 5 (1 mark)\"."),
  figure: { type: ["object", "null"], additionalProperties: false, required: ["svg", "caption", "alt"],
    properties: { svg: { type: "string" }, caption: S(), alt: S() } },
  figure_note: S(),
  section: N("integer", "0-based index into sections (the paper's Parts)."),
  passage: N("integer", "0-based index into passages (a case study or comprehension passage)."),
  assertion: S(),
  reason: S(),
  labels: LIST({ type: "string" }),
  label_answers: LIST({ type: "object", additionalProperties: false, required: ["label", "answer"],
    properties: { label: { type: "string" }, answer: { type: "string" } } }),
};
const QUESTION_KEYS = Object.keys(QUESTION_PROPS);

const SECTIONS = LIST({ type: "object", additionalProperties: false, required: ["title", "instructions"],
  properties: { title: { type: "string", description: "e.g. \"Part A – Multiple Choice\"" }, instructions: { type: "string", description: "The part's note, e.g. \"Each question carries 1 mark.\"" } } });
const PASSAGES = LIST({ type: "object", additionalProperties: false, required: ["title", "text"],
  properties: { title: { type: "string" }, text: { type: "string" } } });

export function paperSchema() {
  return {
    type: "object", additionalProperties: false, required: ["instructions", "sections", "passages", "questions"],
    properties: {
      instructions: { type: "string", description: "ONE line for the top of the paper, e.g. \"Answer all questions.\"" },
      sections: SECTIONS,
      passages: PASSAGES,
      questions: { type: "array", items: { type: "object", additionalProperties: false, required: QUESTION_KEYS, properties: QUESTION_PROPS } },
    },
  };
}

export function revisionSchema() {
  const props = {
    from: N("integer", "The question's index in the current list; null for a new question."),
    changed: N("boolean", "true when a question with \"from\" is rewritten; null or false keeps it exactly."),
    keep_figure: N("boolean"),
    ...QUESTION_PROPS,
  };
  return {
    type: "object", additionalProperties: false, required: ["note", "passages", "questions"],
    properties: {
      note: { type: "string" },
      passages: PASSAGES,
      questions: { type: "array", items: { type: "object", additionalProperties: false, required: Object.keys(props), properties: props } },
    },
  };
}

const format = (name, schema) => ({ type: "json_schema", json_schema: { name, strict: true, schema } });
export const paperResponseFormat = () => format("assignment_paper", paperSchema());
export const revisionResponseFormat = () => format("assignment_revision", revisionSchema());

/** A strict-mode reply carries every field; null means "not used". */
export function dropNulls(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null));
}

const WORKING_TYPES = /^(calculations?|working)$/i;
const BLANK_TYPES = /^fill[- ]in/i;
const LONG_TYPES = /^(essays?|theory|structured)$/i;

/** The answer space a question leaves (its own, else from its kind). */
export function answerSpaceFor(q) {
  if (!q || typeof q !== "object") return "lines";
  if (ANSWER_SPACES.includes(q.answer_space)) return q.answer_space;
  if (q.format === "true_false") return "true_false";
  if (q.format === "label") return "labels";
  if (Array.isArray(q.options)) return "options";
  const type = String(q.type || "").trim();
  if (BLANK_TYPES.test(type)) return "blank";
  if (WORKING_TYPES.test(type)) return "working";
  return "lines";
}

/** How many lines a "lines" answer gets on paper (essays more). */
export const answerLines = (q) => (LONG_TYPES.test(String(q?.type || "").trim()) && /essay/i.test(String(q?.type)) ? 10 : LONG_TYPES.test(String(q?.type || "").trim()) ? 5 : 3);

const LETTERS = "ABCDEFGHIJ";
const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};
const range = (nums) => (nums.length ? (nums.length === 1 ? `Question ${nums[0]}` : `Questions ${nums[0]}–${nums[nums.length - 1]}`) : "");
const ptsWord = (n) => `${n} point${n === 1 ? "" : "s"}`;

/**
 * The submission as the template lays it out. Pure.
 *   assignment  { title, subject, topic, due_at, details }
 *   target      { submission, grade?, feedback?, graded_at? }
 *   learner     { name, className, username }
 *   files       the submission's files [{ id, name, mime, kind, question }]
 *   org         the school line ("[School Name], [Town], Nigeria") or null
 * → { header, details, learner, totalPoints, summary, parts[], unparted[], feedback }
 * Questions are numbered 1..n in paper order (the template's own numbering
 * runs on from part to part).
 */
export function submissionDocument({ assignment = {}, target = {}, learner = {}, files = null, org = null }) {
  const details = assignment.details || {};
  const questions = Array.isArray(details.questions) ? details.questions : [];
  const sections = Array.isArray(details.sections) ? details.sections : [];
  const passages = Array.isArray(details.passages) ? details.passages : [];
  const submission = target.submission || {};
  const answers = submission.answers || {};
  const allFiles = Array.isArray(files) ? files : Array.isArray(submission.files) ? submission.files : [];
  const qOf = (f) => { const v = f?.question ?? f?.question_index; return Number.isInteger(v) ? v : null; };
  const filesFor = (i) => allFiles.filter((f) => qOf(f) === i);
  const graded = Array.isArray(target.feedback?.questions) ? new Map(target.feedback.questions.map((q) => [Number(q.index), q])) : new Map();

  const items = questions.map((q, i) => {
    const raw = answers[String(i)] ?? answers[i];
    const typed = raw === undefined || raw === null ? "" : String(raw).trim();
    const own = filesFor(i).map((f) => ({ id: f.id ?? null, name: f.name, mime: f.mime || null, kind: f.kind || null,
      drawing: /^drawing-q\d+\.png$/i.test(String(f.name || "")) }));
    const space = answerSpaceFor(q);
    const choice = Array.isArray(q?.options) && typed ? readChoice(q, raw) : null;
    const points = questionPoints(q);
    const mark = graded.get(i);
    return {
      index: i, number: i + 1,
      text: String(q?.q ?? q ?? ""), type: q?.type || null, format: q?.format || null, answerSpace: space,
      points,
      ...(Array.isArray(q?.options) ? { options: q.options.map((o, j) => ({ letter: LETTERS[j], text: String(o), selected: choice === j })) } : {}),
      ...(q?.format === "assertion_reason" ? { assertion: q.assertion || null, reason: q.reason || null } : {}),
      ...(Array.isArray(q?.labels) ? { labels: q.labels } : {}),
      ...(q?.figure ? { figure: true } : {}),
      section: Number.isInteger(q?.section) && sections[q.section] ? q.section : null,
      passage: Number.isInteger(q?.passage) && passages[q.passage] ? q.passage : null,
      status: typed || own.length ? "answered" : "unanswered",
      answer: {
        text: typed && !(choice !== null && /^\(?[a-j]\)?[.)]?$/i.test(typed)) ? typed : null,
        selected: choice === null ? null : LETTERS[choice],
        drawings: own.filter((f) => f.drawing),
        files: own.filter((f) => !f.drawing),
      },
      marks: { max: points, awarded: mark && Number.isFinite(Number(mark.awarded)) ? Number(mark.awarded) : null, comment: mark?.comment || null },
    };
  });

  // Parts: the sections in order; a paper without sections is one part.
  const partOf = (sec) => {
    const qs = items.filter((it) => it.section === sec);
    const nums = qs.map((it) => it.number);
    const pts = qs.reduce((s, it) => s + (it.points || 0), 0);
    const used = [...new Set(qs.map((it) => it.passage).filter((p) => p !== null))];
    return {
      title: sec === null ? null : sections[sec].title || `Part ${LETTERS[sec]}`,
      note: [range(nums), pts ? ptsWord(pts) : ""].filter(Boolean).join(" · "),
      instructions: sec === null ? null : sections[sec].instructions || null,
      passages: used.map((p) => {
        const about = qs.filter((it) => it.passage === p).map((it) => it.number);
        return { index: p, title: passages[p].title || null, text: passages[p].text || "", questions: range(about) };
      }),
      questions: qs,
    };
  };
  const parts = sections.length ? sections.map((_, s) => partOf(s)).filter((p) => p.questions.length) : [];
  const unparted = items.some((it) => it.section === null) ? partOf(null) : null;
  if (unparted) parts.push(unparted);

  const totalPoints = items.reduce((s, it) => s + (it.points || 0), 0) || Number(details.total_points) || null;
  const unanswered = items.filter((it) => it.status === "unanswered").map((it) => it.number);
  const drawings = items.reduce((s, it) => s + it.answer.drawings.length, 0);
  const loose = allFiles.filter((f) => qOf(f) === null)
    .map((f) => ({ id: f.id ?? null, name: f.name, mime: f.mime || null, kind: f.kind || null }));

  return {
    header: { org: org || null, title: assignment.title || "Assignment", badge: "LEARNER SUBMISSION" },
    details: {
      subject: assignment.subject || null, topic: assignment.topic || null,
      submittedAt: fmtDate(submission.submittedAt), dueAt: fmtDate(assignment.due_at),
      late: !!submission.late, lateByMinutes: submission.lateByMinutes ?? null,
    },
    learner: { name: learner.name || null, className: learner.className || null, username: learner.username || null },
    totalPoints,
    summary: {
      answered: items.length - unanswered.length, total: items.length,
      unanswered,
      attachments: { drawings, files: allFiles.length - drawings },
    },
    instructions: details.instructions || null,
    text: !items.length ? (submission.text || null) : null,
    parts,
    files: loose,
    // Files on a question beyond the paper (a question removed later) still show.
    ...(allFiles.some((f) => qOf(f) !== null && qOf(f) >= items.length) ? { strayFiles: allFiles.filter((f) => qOf(f) >= items.length).map((f) => f.name) } : {}),
    feedback: {
      text: typeof target.feedback === "string" ? target.feedback : target.feedback?.text || null,
      grade: target.grade ?? null,
      score: items.some((it) => it.marks.awarded !== null) ? items.reduce((s, it) => s + (it.marks.awarded || 0), 0) : null,
      gradedAt: fmtDate(target.graded_at),
    },
  };
}
