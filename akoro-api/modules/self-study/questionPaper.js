/**
 * modules/self-study/questionPaper.js — an assignment's questions built from
 * the teacher's own words ("5 questions on photosynthesis, 3 MCQ, 2 direct
 * theory"), the same way from the workbench and from the instructor chat.
 *
 *   parseQuestionRequest(text)   the request → a plan the result is held to
 *   buildPaperMessages(...)      the model's instructions (first draft)
 *   buildRevisionMessages(...)   … and for a follow-up ("make Q4 harder")
 *   normalizePaper(json, plan)   the model's JSON → stored question shape
 *   applyRevision(base, json)    a follow-up's JSON → the next version;
 *                                untouched questions are copied, not rewritten
 *   checkPaper(paper, plan)      does it honour the request? → problems[]
 *   draftPaper / revisePaper     generate, check, retry once, else warn
 *
 * The plan is a contract: if the model returns 4 questions for "5", or two
 * MCQs for "3 MCQ", it is asked once more; if it still misses, the version
 * carries a warning instead of quietly changing what the teacher asked for.
 *
 * Questions are stored the way details.questions always has been —
 * { q, type, max_points, difficulty, cognitive_level, options?, correct?,
 *   figure?, figure_note?, section?, passage? } — so the learner stepper,
 * grading and the PDF read them unchanged. The paper template adds two
 * optional fields: answer_space (how it is answered on paper) and marking
 * (the teacher copy's marking-scheme line).
 *
 * The model answers in a strict JSON schema (paperSchema.js) — `chat` gets
 * it as its second argument: chat(messages, { response_format }).
 */
import { sanitizeSvg } from "./paperLayout.js";
import { ANSWER_SPACES, dropNulls, paperResponseFormat, revisionResponseFormat } from "./paperSchema.js";

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const num = (s) => (s == null ? null : /^\d+$/.test(s) ? Number(s) : WORD_NUM[String(s).toLowerCase()] ?? null);
const NUM = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)";

export const MAX_QUESTIONS = 30;
export const MAX_VERSIONS = 10;

/* Question kinds a teacher names, and what each is. `kind` is how it is
   answered (mcq: pick an option · open: write · label: name each marked part);
   `format` marks the kinds with a fixed shape. */
const KINDS = [
  { re: /^(mcqs?|objectives?|objective questions?|multiple[- ]choice(?: questions?)?)$/i, label: "MCQ", kind: "mcq" },
  { re: /^(?:direct |short )?theory(?: questions?)?$/i, label: "Theory", kind: "open" },
  { re: /^short[- ]answers?(?: questions?)?$/i, label: "Short answer", kind: "open" },
  { re: /^structured(?: questions?)?$/i, label: "Structured", kind: "open" },
  { re: /^essays?(?: questions?)?$/i, label: "Essay", kind: "open" },
  { re: /^fill[- ]in[- ](?:the[- ])?(?:gaps?|blanks?)(?: questions?)?$/i, label: "Fill in the gap", kind: "open" },
  { re: /^true\s*(?:\/|or|-)\s*false(?: questions?| statements?)?$/i, label: "True or false", kind: "mcq", format: "true_false", options: 2,
    loose: /\btrue\s*(?:\/|or|-)\s*false\b/i },
  { re: /^(?:identification|labell?ing|label(?:led|ed)?[- ]diagrams?)(?: questions?)?$/i, label: "Labelling", kind: "label", format: "label",
    loose: /\b(identification|labell?ing questions?|label(?:led|ed)? diagrams?|label the parts|name the (?:labell?ed )?parts)\b/i },
  { re: /^assertion[- ](?:and|&)[- ]reason(?:ing)?(?: questions?)?$/i, label: "Assertion and reason", kind: "mcq", format: "assertion_reason", options: 4,
    loose: /\bassertion[- ](?:and|&)[- ]reason/i },
  { re: /^(?:case[- ]stud(?:y|ies)|scenarios?(?:[- ]based)?)(?: questions?)?$/i, label: "Case study", kind: "open", format: "case_study",
    loose: /\b(case[- ]stud(?:y|ies)|scenario[- ]based)\b/i },
  { re: /^calculations?(?: questions?)?$/i, label: "Calculation", kind: "open" },
];
const KIND_WORDS = "(?:direct |short )?theory(?: questions?)?|short[- ]answers?(?: questions?)?|structured(?: questions?)?|essays?(?: questions?)?|"
  + "fill[- ]in[- ](?:the[- ])?(?:gaps?|blanks?)(?: questions?)?|true\\s*(?:\\/|or|-)\\s*false(?: questions?| statements?)?|calculations?(?: questions?)?|"
  + "(?:identification|labell?ing|label(?:led|ed)?[- ]diagrams?)(?: questions?)?|assertion[- ](?:and|&)[- ]reason(?:ing)?(?: questions?)?|"
  + "(?:case[- ]stud(?:y|ies)|scenarios?(?:[- ]based)?)(?: questions?)?|"
  + "mcqs?|objectives?(?: questions?)?|multiple[- ]choice(?: questions?)?";

/** The kind a label names ("Assertion and reason" → its format and options). */
export const kindFor = (label) => KINDS.find((k) => k.re.test(String(label || "").trim())) || null;

/** The standard Assertion-and-Reason options, in this order, always. */
export const AR_OPTIONS = Object.freeze([
  "Both the assertion and the reason are true, and the reason correctly explains the assertion.",
  "Both the assertion and the reason are true, but the reason does not explain the assertion.",
  "The assertion is true, but the reason is false.",
  "The assertion is false, but the reason is true.",
]);
export const TF_OPTIONS = Object.freeze(["True", "False"]);
const FORMATS = ["true_false", "assertion_reason", "label", "case_study"];

/**
 * The teacher's request → a plan. Anything not stated stays null (the model
 * decides); only what was stated is held as a contract.
 * → { total, mix:[{label,kind,count,options?}], diagrams, options, totalPoints, sections, passage }
 */
export function parseQuestionRequest(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  const plan = { total: null, mix: [], wanted: [], diagrams: null, options: null, totalPoints: null, sections: false, passage: false };
  if (!s) return plan;
  const mixRe = new RegExp(`\\b${NUM}\\s+(${KIND_WORDS})\\b`, "gi");
  let m;
  while ((m = mixRe.exec(s))) {
    let count = num(m[1]);
    const k = KINDS.find((x) => x.re.test(m[2].trim()));
    if (!k || !count) continue;
    // "1 case study with 3 questions" is 3 questions on one scenario.
    const per = k.format === "case_study" ? new RegExp(`^\\s*(?:with|of|having)\\s+${NUM}\\s+questions?`, "i").exec(s.slice(mixRe.lastIndex)) : null;
    if (per && num(per[1])) count *= num(per[1]);
    const have = plan.mix.find((x) => x.label === k.label);
    if (have) have.count += count;
    else plan.mix.push({ label: k.label, kind: k.kind, count, ...(k.format ? { format: k.format } : {}), ...(k.options ? { options: k.options } : {}) });
  }
  // Kinds named without a count ("include a case study") — at least one each.
  plan.wanted = KINDS.filter((k) => k.loose && k.loose.test(s) && !plan.mix.some((x) => x.label === k.label)).map((k) => k.label);
  const mixSum = plan.mix.reduce((n, x) => n + x.count, 0);
  // The counted kinds are the whole paper — unless others are named without a count.
  if (!plan.total && mixSum && !plan.wanted.length) plan.total = mixSum;
  // "5 questions" — but not "3 MCQ questions" or "2 diagram questions" (those are parts).
  const totalRe = new RegExp(`\\b${NUM}\\s+(?:[a-z-]+\\s+){0,2}questions?\\b`, "gi");
  const partRe = new RegExp(`^${NUM}\\s+(?:of them\\s+)?(?:with\\s+)?(?:a\\s+)?(?:${KIND_WORDS}|diagrams?|figures?|graphs?|pictures?)`, "i");
  for (const t of s.matchAll(totalRe)) {
    // "…case study with 3 questions" counts that scenario's questions, not the paper's.
    if (/\b(?:with|of|having)\s*$/i.test(s.slice(0, t.index))) continue;
    if (num(t[1]) && !partRe.test(t[0])) { plan.total = num(t[1]); break; }
  }
  if (plan.total) plan.total = Math.min(plan.total, MAX_QUESTIONS);

  const dq = new RegExp(`\\b${NUM}\\s+(?:of them\\s+)?(?:with\\s+)?(?:a\\s+)?(?:diagrams?|figures?|graphs?|pictures?)(?:\\s+questions?)?\\b`, "i").exec(s)
    || new RegExp(`\\b${NUM}\\s+(?:questions?\\s+)?(?:with|having|using)\\s+(?:a\\s+)?(?:diagrams?|figures?|graphs?)`, "i").exec(s);
  if (dq && num(dq[1])) plan.diagrams = num(dq[1]);
  else if (/\b(no|without)\s+(diagrams?|figures?|pictures?)\b/i.test(s)) plan.diagrams = 0;
  else if (/\b(diagrams?|figures?|visuals?|graphs?|label(?:led|ed|ling)?\s+(?:the\s+)?(?:parts?|diagram)|illustrat\w*|pictures?)\b/i.test(s)) plan.diagrams = true;

  if (/\b(5|five)\s+options\b|\bA\s*(?:-|–|to)\s*E\b/i.test(s)) plan.options = 5;
  else if (/\b(4|four)\s+options\b|\bA\s*(?:-|–|to)\s*D\b/i.test(s)) plan.options = 4;
  const pts = /\b(?:total(?:\s+of)?|out\s+of|worth)\s+(\d{1,3})\s*(?:marks?|points?|pts)?\b|\b(\d{1,3})\s*(?:marks?|points?)\s+(?:in\s+)?total\b/i.exec(s)
    || /\b(\d{1,3})\s*(?:marks?|points?)\b(?!\s*each)/i.exec(s);
  if (pts) {
    const n = Number(pts[1] || pts[2]);
    if (n > 0 && n <= 500) plan.totalPoints = n;
  }
  plan.sections = /\bsections?\b/i.test(s) && !/\b(no|without)\s+sections?\b/i.test(s);
  plan.passage = /\b(comprehension|passage)\b/i.test(s) && !/\b(no|without)\s+(comprehension|passages?)\b/i.test(s);
  if (hasFormat(plan, "case_study")) plan.passage = true;   // a scenario is a passage the questions share
  return plan;
}

/** The agent's structured plan (from the tool call) over what the words say. */
export function mergePlan(parsed, given) {
  const out = { ...parsed, mix: [...(parsed?.mix || [])] };
  if (!given || typeof given !== "object") return out;
  if (Array.isArray(given.mix) && given.mix.length) {
    out.mix = given.mix
      .map((x) => {
        const label = String(x?.label || "").trim().slice(0, 40);
        const k = kindFor(label);   // a kind we know keeps its own shape
        return k
          ? { label: k.label, kind: k.kind, count: Math.max(0, Math.min(MAX_QUESTIONS, Number(x?.count) || 0)), ...(k.format ? { format: k.format } : {}), ...(k.options ? { options: k.options } : {}) }
          : { label, kind: ["mcq", "label"].includes(x?.kind) ? x.kind : "open", count: Math.max(0, Math.min(MAX_QUESTIONS, Number(x?.count) || 0)) };
      })
      .filter((x) => x.label && x.count);
    out.wanted = (out.wanted || []).filter((w) => !out.mix.some((x) => x.label === w));
  }
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  if (n(given.total)) out.total = Math.min(MAX_QUESTIONS, n(given.total));
  else if (out.mix.length) out.total = out.mix.reduce((a, x) => a + x.count, 0);
  if (given.diagrams === 0 || given.diagrams === false) out.diagrams = 0;
  else if (n(given.diagrams)) out.diagrams = n(given.diagrams);
  else if (given.diagrams === true) out.diagrams = true;
  if ([4, 5].includes(Number(given.options))) out.options = Number(given.options);
  if (n(given.total_points ?? given.totalPoints)) out.totalPoints = n(given.total_points ?? given.totalPoints);
  if (typeof given.sections === "boolean") out.sections = given.sections;
  if (typeof given.passage === "boolean") out.passage = given.passage;
  if (hasFormat(out, "case_study")) out.passage = true;
  return out;
}

/** Does the plan call for this format (counted or just named)? */
export function hasFormat(plan, format) {
  return (plan?.mix || []).some((x) => x.format === format) || (plan?.wanted || []).some((w) => kindFor(w)?.format === format);
}

/** One line for the chat card and the warning: "5 questions (3 MCQ · 2 Theory)". */
export function describePlan(plan) {
  const mix = (plan?.mix || []).map((x) => `${x.count} ${x.label}`).join(" · ");
  return plan?.total ? `${plan.total} question${plan.total === 1 ? "" : "s"}${mix ? ` (${mix})` : ""}` : mix;
}

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
    index: i, text: q.q, type: q.type || (Array.isArray(q.options) ? "MCQ" : "Open"), max_points: q.max_points ?? null,
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

const str = (v, max) => String(v ?? "").trim().slice(0, max);

/** One model question → the stored shape. */
function normalizeQuestion(q, { options = null } = {}) {
  if (!q || typeof q !== "object") return null;
  q = dropNulls(q);
  const format = FORMATS.includes(q.format) ? q.format : kindFor(q.type)?.format || null;
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
  if (fits) out.answer_space = space;
  if (str(q.marking, 600)) out.marking = str(q.marking, 600);
  return out;
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
      if (Number.isInteger(q.section) && !sections[q.section]) delete q.section;
      if (Number.isInteger(q.passage) && !passages[q.passage]?.text) delete q.passage;
      return q;
    });
  const usedS = questions.some((q) => Number.isInteger(q.section));
  const usedP = questions.some((q) => Number.isInteger(q.passage));
  return {
    instructions: str(j.instructions, 300) || "Answer all questions.",
    questions,
    ...(usedS ? { sections } : {}),
    ...(usedP ? { passages } : {}),
  };
}

/**
 * A follow-up's JSON over the base version → the next paper and what
 * changed. Items that point back ({ from }) are copied from the base as-is
 * (the teacher's own edits included); changed ones are rewritten.
 * → { paper, changes: { [newIndex]: "new"|"changed" }, note }
 */
export function applyRevision(base, json) {
  const j = json && typeof json === "object" ? json : {};
  const src = base.questions || [];
  const opts = Math.max(4, ...src.map((q) => (Array.isArray(q.options) ? q.options.length : 0)));
  const questions = [];
  const changes = {};
  for (let item of (Array.isArray(j.questions) ? j.questions : []).slice(0, MAX_QUESTIONS)) {
    if (!item || typeof item !== "object") continue;
    item = dropNulls(item);
    const from = Number.isInteger(item.from) && src[item.from] ? src[item.from] : null;
    if (from && !item.changed) { questions.push(structuredClone(from)); continue; }
    const q = normalizeQuestion(from && !item.text ? { ...from, ...item, text: from.q } : item, { options: Array.isArray(item.options) ? 5 : opts });
    if (!q) { if (from) questions.push(structuredClone(from)); continue; }
    if (from) {
      if (item.keep_figure && from.figure && !q.figure) { q.figure = structuredClone(from.figure); delete q.figure_note; }
      for (const k of ["section", "passage"]) if (Number.isInteger(from[k]) && q[k] == null) q[k] = from[k];
    }
    changes[questions.length] = from ? "changed" : "new";
    questions.push(q);
  }
  // Passages: the existing ones never change here; new scenarios are appended.
  const passages = [...(base.passages || [])];
  if (Array.isArray(j.passages)) {
    for (const p of j.passages.slice(passages.length, 8)) {
      const text = str(p?.text, 8000);
      passages.push({ title: str(p?.title, 160), text });
    }
  }
  for (const q of questions) if (Number.isInteger(q.passage) && !passages[q.passage]?.text) delete q.passage;
  const paper = {
    instructions: base.instructions || "Answer all questions.",
    questions,
    ...(base.sections ? { sections: base.sections } : {}),
    ...(questions.some((q) => Number.isInteger(q.passage)) ? { passages } : {}),
  };
  return { paper, changes, note: str(j.note, 200) };
}

const labelOf = (q) => String(q?.type || "").trim().toLowerCase();

/** Does the paper honour the plan? → problems the model is told about (empty = yes). */
export function checkPaper(paper, plan = {}) {
  const qs = paper?.questions || [];
  const problems = [];
  if (!qs.length) return ["No questions came back."];
  if (plan.total && qs.length !== plan.total) problems.push(`Asked for ${plan.total} questions, got ${qs.length}.`);
  for (const x of plan.mix || []) {
    const these = qs.filter((q) => labelOf(q) === x.label.toLowerCase());
    if (these.length !== x.count) problems.push(`Asked for ${x.count} ${x.label}, got ${these.length}.`);
    const wrongKind = these.filter((q) => (x.format ? q.format !== x.format : (x.kind === "mcq") !== Array.isArray(q.options))).length;
    if (wrongKind) problems.push(`${wrongKind} ${x.label} question${wrongKind === 1 ? " is" : "s are"} the wrong kind (${
      x.format === "label" ? "needs a labelled diagram and labels" : x.format === "assertion_reason" ? "needs an assertion and a reason"
        : x.format === "true_false" ? "must be a statement marked true or false" : x.format === "case_study" ? "must follow a scenario passage"
        : x.kind === "mcq" ? "needs options" : "must have no options"}).`);
  }
  for (const w of plan.wanted || []) {
    if (!qs.some((q) => labelOf(q) === w.toLowerCase() || (kindFor(w)?.format && q.format === kindFor(w).format))) problems.push(`Asked for ${w} questions, got none.`);
  }
  const strays = qs.filter((q) => q.format === "case_study" && !Number.isInteger(q.passage)).length;
  if (strays) problems.push(`${strays} case-study question${strays === 1 ? " has" : "s have"} no scenario passage.`);
  const bare = qs.filter((q) => q.format === "label" && !q.figure && !q.figure_note).length;
  if (bare) problems.push(`${bare} labelling question${bare === 1 ? " has" : "s have"} no diagram.`);
  const want = plan.options || 4;
  const badOpts = qs.filter((q) => Array.isArray(q.options) && !q.format && q.options.length !== want && !(plan.mix || []).some((x) => x.options && labelOf(q) === x.label.toLowerCase())).length;
  if (badOpts) problems.push(`${badOpts} multiple-choice question${badOpts === 1 ? " doesn't" : "s don't"} have ${want} options.`);
  const figs = qs.filter((q) => (q.figure || q.figure_note) && q.format !== "label").length + qs.filter((q) => q.format === "label" && (q.figure || q.figure_note)).length;
  if (typeof plan.diagrams === "number" && plan.diagrams > 0 && figs < plan.diagrams) problems.push(`Asked for ${plan.diagrams} question${plan.diagrams === 1 ? "" : "s"} with a diagram, got ${figs}.`);
  if (plan.diagrams === true && !figs) problems.push("Asked for diagrams, got none.");
  if (plan.diagrams === 0 && qs.some((q) => (q.figure || q.figure_note) && q.format !== "label")) problems.push("Asked for no diagrams, but some questions have one.");
  if (plan.totalPoints) {
    const sum = qs.reduce((n, q) => n + (Number(q.max_points) || 0), 0);
    if (sum !== plan.totalPoints) problems.push(`Marks should total ${plan.totalPoints}, got ${sum}.`);
  }
  return problems;
}

/** Marks the paper leaves unset get the API's default, so the total is real. */
export const paperTotal = (paper) => (paper?.questions || []).reduce((n, q) => n + (Number(q.max_points) > 0 ? Number(q.max_points) : 5), 0);

/** "5 questions (3 MCQ · 2 Theory) · 20 marks" — what the chat card says. */
export function summarizePaper(paper) {
  const qs = paper?.questions || [];
  const byType = new Map();
  for (const q of qs) {
    const t = String(q.type || (Array.isArray(q.options) ? "MCQ" : "Open")).trim();
    byType.set(t, (byType.get(t) || 0) + 1);
  }
  const mix = [...byType].map(([t, n]) => `${n} ${t}`).join(" · ");
  const figs = qs.filter((q) => q.figure || q.figure_note).length;
  const total = paperTotal(paper);
  return {
    count: qs.length, mix: [...byType].map(([label, count]) => ({ label, count })), figures: figs, totalPoints: total,
    line: `${qs.length} question${qs.length === 1 ? "" : "s"}${byType.size > 1 || mix ? ` (${mix})` : ""} · ${total} mark${total === 1 ? "" : "s"}${figs ? ` · ${figs} with a diagram` : ""}`,
  };
}

/**
 * Generate, check, retry once with what was wrong, else return the closer
 * attempt with a warning. `chat(messages)` → the model's JSON string.
 * → { paper, warning|null, plan }
 */
export async function draftPaper({ chat, topic, subject, classLevel, request, plan: given, difficulty, subtopics }) {
  const plan = mergePlan(parseQuestionRequest(request), given);
  const ask = async (feedback, previous) => {
    let json = {};
    try { json = JSON.parse(await chat(buildPaperMessages({ topic, subject, classLevel, request, plan, difficulty, subtopics, feedback, previous }), { response_format: paperResponseFormat() }) || "{}"); } catch { json = {}; }
    return { json, paper: normalizePaper(json, plan) };
  };
  const first = await ask(null, null);
  let problems = checkPaper(first.paper, plan);
  if (!problems.length) return { paper: first.paper, warning: null, plan };
  const second = await ask(problems, first.json);
  const p2 = checkPaper(second.paper, plan);
  const best = p2.length <= problems.length && second.paper.questions.length ? second : first;
  problems = best === second ? p2 : problems;
  if (!best.paper.questions.length) throw new Error("The AI returned no questions — try again.");
  return { paper: best.paper, warning: problems.length ? problems.join(" ") : null, plan };
}

/** A follow-up: the same check-and-retry over applyRevision. → { paper, changes, note, warning } */
export async function revisePaper({ chat, topic, subject, classLevel, request, base, plan: given }) {
  // A follow-up only holds counts it states itself ("make it 8 questions").
  // Counts in a follow-up are changes ("add 2 MCQ"), not the paper's totals,
  // so only what can be checked on the whole paper is held: diagrams added
  // or taken away, and the option count.
  const plan = mergePlan(parseQuestionRequest(request), given);
  const baseOpts = Math.max(4, ...(base.questions || []).map((q) => (Array.isArray(q.options) ? q.options.length : 0)));
  const addsFigure = /\b(add|include|put|give|with)\b[^.]{0,40}\b(diagrams?|figures?|graphs?|pictures?|visuals?)\b/i.test(String(request || ""));
  const contract = { total: null, mix: [], options: plan.options || baseOpts, totalPoints: null, diagrams: plan.diagrams === 0 ? 0 : addsFigure ? true : null };
  const ask = async (feedback, previous) => {
    let json = {};
    try { json = JSON.parse(await chat(buildRevisionMessages({ topic, subject, classLevel, request, base, plan, feedback, previous }), { response_format: revisionResponseFormat() }) || "{}"); } catch { json = {}; }
    return { json, ...applyRevision(base, json) };
  };
  const first = await ask(null, null);
  let problems = checkPaper(first.paper, contract);
  if (!problems.length) return { ...first, warning: null };
  const second = await ask(problems, first.json);
  const p2 = checkPaper(second.paper, contract);
  const best = p2.length <= problems.length && second.paper.questions.length ? second : first;
  problems = best === second ? p2 : problems;
  if (!best.paper.questions.length) throw new Error("The revision came back empty — try again.");
  return { paper: best.paper, changes: best.changes, note: best.note, warning: problems.length ? problems.join(" ") : null };
}
