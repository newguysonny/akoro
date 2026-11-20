/**
 * modules/self-study/paperNormalize.js — the model's JSON becomes the stored
 * question shape, then the paper template lays it out.
 *
 * Questions are stored the way details.questions always has been —
 * { q, type, max_points, difficulty, cognitive_level, options?, correct?,
 *   figure?, figure_note?, section?, passage? } — so the learner stepper,
 * grading and the PDF read them unchanged. The paper template adds two
 * optional fields: answer_space (how it is answered on paper) and marking
 * (the teacher copy's marking-scheme line).
 */
import { sanitizeSvg } from "./paperLayout.js";
import { ANSWER_SPACES, answerSpaceFor, dropNulls } from "./paperSchema.js";
import { layoutPaper } from "./paperTemplate.js";
import { AR_OPTIONS, FORMATS, MAX_QUESTIONS, TF_OPTIONS, kindFor, str } from "./paperRules.js";

/** One model question → the stored shape. */
function normalizeQuestion(q, { options = null } = {}) {
  if (!q || typeof q !== "object") return null;
  q = dropNulls(q);
  // The kind its type names decides the shape ("MCQ" is never true/false);
  // only a type we don't know leaves it to the model's format — and a
  // true/false format on a question with other options is a slip.
  const named = kindFor(String(q.type || "").replace(/_/g, " "));
  let format = named ? named.format || null : FORMATS.includes(q.format) ? q.format : null;
  if (!named && format === "true_false" && Array.isArray(q.options) && q.options.length > 2) format = null;
  let text = str(q.text ?? q.q, 2000);
  let assertion = "", reason = "";
  if (format === "assertion_reason") {
    // Two sentences, the four options fixed. Older text "Assertion: … Reason: …" splits back.
    const m = /assertion\s*[:\-–]\s*([\s\S]+?)\s*\n?\s*reason\s*[:\-–]\s*([\s\S]+)/i.exec(text);
    assertion = str(q.assertion, 600) || str(m?.[1], 600);
    reason = str(q.reason, 600) || str(m?.[2], 600);
    if (!assertion || !reason) return null;
    text = `Assertion: ${assertion}\nReason: ${reason}`;
  }
  if (!text) return null;
  const out = {
    q: text,
    type: str(q.type, 40),
    max_points: Number(q.max_points) > 0 ? Math.round(Number(q.max_points) * 2) / 2 : null,
    difficulty: str(q.difficulty, 20),
    cognitive_level: str(q.cognitive_level, 20),
    ...(format ? { format } : {}),
  };
  if (format === "true_false") {
    out.options = [...TF_OPTIONS];
    const c = typeof q.correct === "boolean" ? (q.correct ? 0 : 1)
      : /^(true|false)$/i.test(String(q.answer ?? "")) ? (/^true$/i.test(String(q.answer)) ? 0 : 1)
      : Number(q.correct) === 1 ? 1 : 0;
    out.correct = c;
  } else if (format === "assertion_reason") {
    out.assertion = assertion;
    out.reason = reason;
    out.options = [...AR_OPTIONS];
    out.correct = Number.isInteger(q.correct) && q.correct >= 0 && q.correct < AR_OPTIONS.length ? q.correct : 0;
  } else if (format === "label") {
    // The parts to name, and the key (stripped for learners like any answer).
    const labels = [...new Set((Array.isArray(q.labels) ? q.labels : []).map((l) => str(l, 12)).filter(Boolean))].slice(0, 8);
    if (labels.length < 1) return null;
    out.labels = labels;
    // label_answers: [{ label, answer }] (the schema) or { P: "…" } (older replies, stored keys).
    const pairs = Array.isArray(q.label_answers) ? Object.fromEntries(q.label_answers.map((x) => [str(x?.label, 12), x?.answer])) : null;
    const key = pairs || (q.label_answers && typeof q.label_answers === "object" ? q.label_answers : q.answer && typeof q.answer === "object" ? q.answer : {});
    const answer = Object.fromEntries(labels.map((l) => [l, str(key[l], 200)]).filter(([, v]) => v));
    if (Object.keys(answer).length) out.answer = answer;
  } else if (Array.isArray(q.options)) {
    const opts = q.options.map((o) => str(o, 300)).filter(Boolean).slice(0, options || 5);
    if (opts.length >= 2) {
      out.options = opts;
      out.correct = Number.isInteger(q.correct) && q.correct >= 0 && q.correct < opts.length ? q.correct : 0;
    }
  }
  if (typeof q.answer === "string" && format !== "true_false" && str(q.answer, 2000)) out.answer = str(q.answer, 2000);
  const svg = q.figure && typeof q.figure.svg === "string" ? sanitizeSvg(q.figure.svg) : null;
  if (svg) {
    out.figure = { svg, ...(str(q.figure.caption, 200) ? { caption: str(q.figure.caption, 200) } : {}), ...(str(q.figure.alt, 300) ? { alt: str(q.figure.alt, 300) } : {}) };
  } else if (q.figure && typeof q.figure === "object" && q.figure.src) {
    out.figure = q.figure;   // a teacher's upload, carried through a revision (cleaned again on save)
  } else if (q.figure && typeof q.figure === "object" && (q.figure.alt || q.figure.caption)) {
    // A figure the model described but couldn't draw cleanly → a slot for the teacher.
    out.figure_note = str(q.figure.alt || q.figure.caption, 300);
  }
  if (!out.figure && str(q.figure_note, 300)) out.figure_note = str(q.figure_note, 300);
  if (Number.isInteger(q.section)) out.section = q.section;
  if (Number.isInteger(q.passage)) out.passage = q.passage;
  // The paper template: how it is answered, and the marking-scheme line.
  const space = ANSWER_SPACES.includes(q.answer_space) ? q.answer_space : null;
  const fits = space && (Array.isArray(out.options)
    ? (out.format === "true_false" ? space === "true_false" : space === "options")
    : out.format === "label" ? space === "labels" : !["options", "true_false", "labels"].includes(space));
  out.answer_space = fits ? space : answerSpaceFor(out);
  if (str(q.marking, 600)) out.marking = str(q.marking, 600);
  return out;
}

/**
 * A question whose type isn't one of the plan's labels (the model wrote its
 * answer space, "lines", or a format, "true_false", there) takes the label of
 * a plan kind it fits that still has room — its format first, then a gap
 * question for "Fill in the gap", working for "Calculation", then any kind of
 * the same shape. So the mix check counts what is really there.
 */
function relabelToPlan(questions, plan) {
  const mix = plan?.mix || [];
  if (!mix.length) return;
  const room = new Map(mix.map((x) => [x.label, x.count - questions.filter((q) => q.type === x.label).length]));
  const fits = (x, q) => (x.format ? q.format === x.format
    : !q.format && (x.kind === "mcq") === Array.isArray(q.options) && x.kind !== "label");
  const score = (x, q) => (x.format && q.format === x.format ? 3
    : q.answer_space === "blank" && /fill/i.test(x.label) ? 2
      : q.answer_space === "working" && /calculat/i.test(x.label) ? 2 : 1);
  for (const q of questions) {
    if (room.has(q.type)) continue;
    const best = mix.filter((x) => room.get(x.label) > 0 && fits(x, q)).sort((a, b) => score(b, q) - score(a, q))[0];
    if (!best) continue;
    q.type = best.label;
    room.set(best.label, room.get(best.label) - 1);
  }
}

/** The model's first-draft JSON → { instructions, questions, sections?, passages? }. */
export function normalizePaper(json, plan = {}) {
  const j = json && typeof json === "object" ? json : {};
  const sections = (Array.isArray(j.sections) ? j.sections : []).slice(0, 12).map((s) => ({ title: str(s?.title, 120), instructions: str(s?.instructions, 1200) }));
  // Kept in place (questions point at them by index); an empty one is dropped below.
  const passages = (Array.isArray(j.passages) ? j.passages : []).slice(0, 8).map((p) => ({ title: str(p?.title, 160), text: str(p?.text, 8000) }));
  const mixOpts = new Map((plan.mix || []).filter((x) => x.options).map((x) => [x.label.toLowerCase(), x.options]));
  const questions = (Array.isArray(j.questions) ? j.questions : []).slice(0, MAX_QUESTIONS)
    .map((q) => normalizeQuestion(q, { options: mixOpts.get(String(q?.type || "").toLowerCase()) || plan.options || 5 }))
    .filter(Boolean)
    .map((q) => {
      // "case_study" / "MCQ" written for the plan's "Case study" / "Objective": the plan's label.
      const k = kindFor(String(q.type || "").replace(/_/g, " "));
      const same = k && (plan.mix || []).find((x) => kindFor(x.label) === k);
      if (same && q.type !== same.label) q.type = same.label;
      return q;
    })
    .map((q) => {
      if (Number.isInteger(q.section) && !sections[q.section]) delete q.section;
      if (Number.isInteger(q.passage) && !passages[q.passage]?.text) delete q.passage;
      return q;
    });
  relabelToPlan(questions, plan);
  const usedS = questions.some((q) => Number.isInteger(q.section));
  const usedP = questions.some((q) => Number.isInteger(q.passage));
  const paper = {
    instructions: str(j.instructions, 300) || "Answer all questions.",
    questions,
    ...(usedS ? { sections } : {}),
    ...(usedP ? { passages } : {}),
  };
  // Every paper is laid out by the template (paperTemplate.js): its Parts by
  // question kind — unless the teacher asked for their own sections.
  return layoutPaper(paper, { keepSections: !!plan.sections && usedS }).paper;
}

export { normalizeQuestion, relabelToPlan };
