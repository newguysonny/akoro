/**
 * modules/self-study/paperRules.js — the teacher's words (and the agent's
 * structured reading of them) become the plan a generated paper is held to.
 *
 *   parseQuestionRequest(text)   the request → a plan the result is held to
 *   mergePlan(parsed, given)     the agent's structured plan over the words
 *   hasFormat(plan, format)      does the plan call for this question format?
 *   describePlan(plan)           one line for the chat card and the warning
 */

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const num = (s) => (s == null ? null : /^\d+$/.test(s) ? Number(s) : WORD_NUM[String(s).toLowerCase()] ?? null);
const NUM = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)";

export const MAX_QUESTIONS = 30;
export const MAX_VERSIONS = 10;

/** Trim, bound — the stored shape's one-string helper. */
export const str = (v, max) => String(v ?? "").trim().slice(0, max);

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
const FORMATS = ["true_false", "assertion_reason", "label", "case_study"];

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
export { FORMATS };

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
  // The teacher's own words win over the agent's reading of them when the
  // agent's mix doesn't even add up to its own total and the words' does
  // ("one case study with 2 questions and 2 MCQ": 2 case-study questions, not 1).
  const sum = (mix) => mix.reduce((a, x) => a + x.count, 0);
  const total = n(given.total);
  if (total && parsed?.mix?.length && sum(out.mix) !== total && sum(parsed.mix) === total) out.mix = [...parsed.mix];
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

