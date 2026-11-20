/**
 * modules/self-study/paperPrompts.js — the model's instructions: the rule
 * lines the plan becomes, the strict JSON shape it answers in, and the
 * messages for a first draft and for a follow-up revision.
 */
import { FORMATS, hasFormat } from "./paperRules.js";

const FIGURE_RULES =
  "A FIGURE is a small black-line SVG: <svg viewBox=\"0 0 W H\"> with W ≤ 400 and H ≤ 300, only line, polyline, polygon, rect, circle, ellipse, path and text; " +
  "stroke=\"#000\", fill=\"none\" for shapes, font-size 12–16, every label the question mentions drawn in it. Label parts with letters P, Q, R, S… or numbers " +
  "(never A–D, those are the option letters). The question says \"the diagram below\" and the figure MUST match it. " +
  "Give every figure an \"alt\": one sentence describing what it shows. " +
  "If a good line drawing isn't possible (a photo, a detailed organism, a map), give NO svg: put \"figure_note\" on the question saying what figure the teacher should add.";

const FORMAT_RULES = {
  true_false: 'A "True or false" question is ONE statement in "text" for the learner to judge (no question mark); set "format": "true_false", options exactly ["True", "False"], "correct" 0 when the statement is true, 1 when false. Mix true and false statements.',
  assertion_reason: 'An "Assertion and reason" question sets "format": "assertion_reason" and gives "assertion" and "reason" — one sentence each, without the words Assertion/Reason. Leave "options" out: the standard four are added (0: both true and the reason explains the assertion · 1: both true but the reason does not explain it · 2: assertion true, reason false · 3: assertion false, reason true); "correct" is 0–3 in that order. Vary which one is right.',
  label: `A "Labelling" question sets "format": "label": a diagram with 2–6 parts marked P, Q, R… by leader lines (the names are NOT written in it), "text" asks the learner to name the labelled parts, "labels": ["P", "Q", …] and "label_answers": [{ "label": "P", "answer": "…" }, …]. ${"The figure follows the FIGURE rules"}; if a clean drawing isn't possible give "figure_note" describing the diagram and where each letter points instead.`,
  case_study: 'A "Case study" is a realistic scenario of 80–200 words written ONCE in "passages" (title it "Case study: …"), then its open, analytical questions (apply, analyse, evaluate — not recall); each sets "format": "case_study" and "passage" to that scenario\'s 0-based index. At most 4 questions per scenario.',
};

function rulesFor(plan) {
  const r = [];
  const opts = plan.options || 4;
  if (plan.total) r.push(`Write EXACTLY ${plan.total} question${plan.total === 1 ? "" : "s"}.`);
  else r.push("Write 5 questions unless the request says otherwise (never more than 12 unless asked).");
  if (plan.mix.length) {
    r.push(`The mix is a contract — exactly: ${plan.mix.map((x) => `${x.count} × "${x.label}" (${x.format === "assertion_reason" ? "assertion and reason" : x.format === "true_false" ? "true or false" : x.kind === "mcq" ? `multiple choice, ${x.options || opts} options` : x.kind === "label" ? "name the labelled parts of a diagram" : "open answer, no options"})`).join("; ")}. ` +
      `Set each question's "type" to exactly one of those labels. Order: all of the first label, then the next, and so on.`);
  }
  r.push(`Multiple-choice questions have exactly ${opts} options (read as ${opts === 5 ? "A–E" : "A–D"}) and "correct", the 0-based index of the right one; open questions have no options. ` +
    "Options are short and parallel, never \"all of the above\" or \"none of the above\".");
  if ((plan.wanted || []).length) r.push(`The request also asks for: ${plan.wanted.map((w) => `"${w}"`).join(", ")} — include at least one of each, with "type" set to that label.`);
  for (const f of FORMATS) if (hasFormat(plan, f)) r.push(FORMAT_RULES[f]);
  if (plan.diagrams === 0 && !hasFormat(plan, "label")) r.push("Use NO figures.");
  else if (typeof plan.diagrams === "number") r.push(`Exactly ${plan.diagrams} question${plan.diagrams === 1 ? "" : "s"} must use a figure. ${FIGURE_RULES}`);
  else if (plan.diagrams === true) r.push(`The request asks for diagrams or visuals: add a figure to the questions that are about one (at least 1, at most half the questions). ${FIGURE_RULES}`);
  else r.push(`Use no figures unless a question cannot be asked without one (e.g. reading a graph${hasFormat(plan, "label") ? ", or a Labelling question" : ""}). ${FIGURE_RULES}`);
  if (plan.totalPoints) r.push(`max_points across all questions sum EXACTLY to ${plan.totalPoints}.`);
  else r.push("Choose max_points per question (MCQ usually 1–2, open answers more) — harder and higher-order questions earn more.");
  if (plan.sections) r.push("Group the questions into the sections the request describes: \"sections\": [{ title, instructions }], each question's \"section\" is its 0-based index.");
  else r.push("Do NOT use sections — one plain numbered list.");
  if (hasFormat(plan, "case_study")) { /* the case-study rule covers passages */ }
  else if (plan.passage) r.push("Write the passage ONCE in \"passages\": [{ title, text }]; the questions about it set \"passage\": 0 and say \"According to the passage…\".");
  else r.push("No passages.");
  return r;
}

const SHAPE =
  'Return JSON: { "instructions": string (ONE line for the top of the paper, e.g. "Answer all questions."), ' +
  '"sections"?: [{ "title", "instructions" }], "passages"?: [{ "title", "text" }], ' +
  '"questions": [ { "text", "type", "max_points", "difficulty" (Easy|Medium|Hard), "cognitive_level" (Recall|Understand|Apply|Analyze|Evaluate|Create), ' +
  '"options"?: string[], "correct"?: number, "figure"?: { "svg", "caption", "alt" }, "figure_note"?: string, "section"?: number, "passage"?: number, ' +
  '"format"?: "true_false"|"assertion_reason"|"label"|"case_study", "assertion"?: string, "reason"?: string, "labels"?: string[], "label_answers"?: [{ "label", "answer" }], ' +
  '"answer_space": "options"|"true_false"|"lines"|"working"|"blank"|"labels", "answer"?: string, "marking": string } ] } — unused fields are null.\n' +
  'Every question has an "answer_space" (how it is answered on the printed paper): multiple choice "options"; true or false "true_false"; labelling "labels"; ' +
  'a fill-in-the-gap question "blank" with its gap written as ____ in "text"; a calculation or a question that needs steps "working" (a box for working, then "Answer: ___"); other open answers "lines". ' +
  'Every question has "marking": the teacher copy\'s marking-scheme line — the answer and how its marks split, e.g. "C – 135 (2¼ × 60)" or "3x = 20 − 5 (1 mark); x = 5 (1 mark)"; ' +
  'open questions also give "answer", the model answer (the final value for working questions).';

const level = (lv) => (lv ? `\nClass / level: ${lv}` : "");

/** Messages for a first draft. */
export function buildPaperMessages({ topic, subject, classLevel = null, request = "", plan, difficulty = null, subtopics = null, feedback = null, previous = null }) {
  const system = [
    "You write graded assignment questions for a school class, from the teacher's request. Follow the request exactly — its count, its mix of question types, " +
      "whether it wants diagrams — and nothing more. Pitch the language and difficulty at the class level. Write maths with Unicode, never LaTeX: x², 10³, ½, √2, π, °, ×, ÷, ≤, ≥, ₦.",
    ...rulesFor(plan),
    SHAPE,
  ].join("\n");
  const user = `Teacher's request: ${request ? `"${String(request).slice(0, 1500)}"` : "(none — use the defaults)"}\nTopic: ${topic}\nSubject: ${subject}` + level(classLevel) +
    (difficulty ? `\nDifficulty: ${difficulty}` : "") +
    (Array.isArray(subtopics) && subtopics.length ? `\nCover these areas: ${subtopics.slice(0, 12).join("; ")}` : "");
  const msgs = [{ role: "system", content: system }, { role: "user", content: user }];
  if (feedback && previous) {
    msgs.push({ role: "assistant", content: JSON.stringify(previous).slice(0, 30_000) });
    msgs.push({ role: "user", content: `That doesn't match the request: ${feedback.join(" ")} Return the full corrected JSON.` });
  }
  return msgs;
}

/** The base version as the model sees it: numbered, with what each has. */
function paperForModel(base) {
  return (base.questions || []).map((q, i) => ({
    index: i, number: i + 1, text: q.q, type: q.type || (Array.isArray(q.options) ? "MCQ" : "Open"), max_points: q.max_points ?? null,
    difficulty: q.difficulty || null, cognitive_level: q.cognitive_level || null,
    ...(Array.isArray(q.options) ? { options: q.options, correct: q.correct ?? null } : {}),
    ...(q.figure ? { has_figure: true, figure_alt: q.figure.alt || q.figure.caption || "" } : {}),
    ...(q.figure_note ? { figure_note: q.figure_note } : {}),
    ...(q.format ? { format: q.format } : {}),
    ...(q.format === "assertion_reason" ? { assertion: q.assertion, reason: q.reason } : {}),
    ...(q.format === "label" ? { labels: q.labels, label_answers: q.answer || {} } : {}),
    ...(Number.isInteger(q.passage) ? { passage: q.passage } : {}),
    ...(q.answer_space ? { answer_space: q.answer_space } : {}),
    ...(q.marking ? { marking: q.marking } : {}),
  }));
}

/** Messages for a follow-up: change only what was asked. */
export function buildRevisionMessages({ topic, subject, classLevel = null, request, base, plan, feedback = null, previous = null }) {
  const opts = plan?.options || Math.max(4, ...(base.questions || []).map((q) => (Array.isArray(q.options) ? q.options.length : 0)));
  const system = [
    "You revise a school assignment the teacher already has. Change ONLY what the teacher's follow-up asks; every other question stays exactly as it is.",
    "A question you are asked to make harder, easier or reworded gets new wording — a different question at that level, not the same question with new options.",
    "The teacher counts questions from 1, as printed: \"question 2\" or \"Q2\" is the one with \"number\": 2 (its index is 1). \"from\" is always the index.",
    'Return the full new list in order. For a question that stays the same return just { "from": <its index> }. ' +
      'For a question you change return { "from": <its index>, "changed": true, ...all its fields }. For a new question return all its fields with no "from". ' +
      "A question that is removed is simply left out. Keep a changed question's figure by setting \"keep_figure\": true instead of redrawing it.",
    `Multiple-choice questions have ${opts} options unless the follow-up says otherwise; open questions have no options.`,
    `When the follow-up asks for a diagram: ${FIGURE_RULES}`,
    `Question kinds keep their shape when changed or added: ${Object.values(FORMAT_RULES).join(" ")}`,
    "A new case-study scenario goes in \"passages\" (the full list, existing ones first, unchanged) and its questions point at it.",
    "Also return \"note\": ONE short line saying what changed, numbered as in the NEW list (e.g. \"Q4 made harder; new Q3 with a diagram\").",
    "Write maths with Unicode, never LaTeX.",
    'Return JSON: { "note": string, "passages"?: [{ "title", "text" }], "questions": [ ... ] } — question fields as: { "text", "type", "max_points", "difficulty", "cognitive_level", "options"?, "correct"?, "figure"?: { "svg", "caption", "alt" }, "figure_note"?, "format"?, "assertion"?, "reason"?, "labels"?, "label_answers"?: [{ "label", "answer" }], "passage"?, "answer_space", "answer"?, "marking" } — unused fields are null (an unchanged question is { "from": i } with everything else null).',
    'A changed or new question gives "answer_space" (options · true_false · lines · working · blank, with its gap as ____ · labels) and "marking", the marking-scheme line (answer and how its marks split).',
    'Its "type" is the kind as the teacher names it — "Essay", "True or false", "Fill in the gap", "MCQ", "Calculation", "Short answer" — never a generic "Open question".',
  ].join("\n");
  const user = `Topic: ${topic}\nSubject: ${subject}` + level(classLevel) +
    (base.passages?.length ? `\nThe current passages:\n${JSON.stringify(base.passages.map((p, i) => ({ index: i, title: p.title, text: String(p.text).slice(0, 1500) })))}` : "") +
    `\nThe current questions:\n${JSON.stringify(paperForModel(base))}\n\nThe teacher's follow-up: "${String(request || "").slice(0, 1500)}"`;
  const msgs = [{ role: "system", content: system }, { role: "user", content: user }];
  if (feedback && previous) {
    msgs.push({ role: "assistant", content: JSON.stringify(previous).slice(0, 30_000) });
    msgs.push({ role: "user", content: `That doesn't match the follow-up: ${feedback.join(" ")} Return the full corrected JSON.` });
  }
  return msgs;
}
