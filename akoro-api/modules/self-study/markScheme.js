/**
 * modules/self-study/markScheme.js — an assignment's rubric / mark scheme.
 *
 * Criteria → marking points → levels, for every question the AI marks:
 *
 *   scheme = {
 *     version: 1, total_points,
 *     criteria: [{
 *       id, title, description, question (0-based index into the paper's questions), points,
 *       marking_points: [{
 *         id, looks_for, model_answer, points,
 *         levels: [{ points, label, descriptor }]   // from "no marks" (0) up to full marks
 *         full_marks_also_for: [string],            // other answers that earn full marks
 *         no_marks_for: [string],                   // answers that earn nothing
 *       }]
 *     }]
 *   }
 *
 * When the teacher turns auto-grading on, the scheme is written from the paper (one bounded model call,
 * strict JSON), shown in a Rubric tab, editable, and copied onto the assignment (details.mark_scheme).
 * The AI grader then reads each answer and picks the level that fits each marking point; a question's
 * mark is the sum of its marking points (aiGrade.js).
 *
 * Multiple-choice questions with a key are marked from the key, never by the model, so they get no
 * criteria. Everything here is pure: the model's JSON and a teacher's edits both pass through
 * cleanMarkScheme, which keeps every question's marking points adding up to its marks exactly.
 */
import { createHash } from "node:crypto";

export const MARK_SCHEME_LIMITS = Object.freeze({
  criteria: 30, markingPoints: 6, levels: 5, chips: 6,
  title: 140, description: 400, lookFor: 320, modelAnswer: 480, chip: 120, label: 60, descriptor: 280,
});

const DEFAULT_POINTS = 5;   // a question with no max_points (the grader's own default)
const half = (n) => Math.round(Number(n) * 2) / 2;
const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export const isKeyedMcq = (q) => !!q && typeof q === "object" && Array.isArray(q.options) && q.correct != null;
export const needsScheme = (q) => !isKeyedMcq(q);
export const questionPoints = (q) => {
  const n = Number(q && typeof q === "object" ? q.max_points ?? q.points : NaN);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_POINTS;
};

/** Which question indexes get criteria (everything the key doesn't mark). */
export const markedIndexes = (paper) => (paper?.questions || []).map((q, i) => (needsScheme(q) ? i : -1)).filter((i) => i >= 0);

/** A short fingerprint of the questions: a scheme written for other questions is stale. */
export function paperDigest(paper) {
  const qs = (paper?.questions || []).map((q) => (typeof q === "object" && q ? [q.q, q.type, questionPoints(q), q.options || null, q.correct ?? null, q.answer ?? null] : [String(q)]));
  return createHash("sha1").update(JSON.stringify(qs)).digest("hex").slice(0, 16);
}

/** The levels a marking point of `points` can be awarded: 0, then up to full marks. */
export function levelPoints(points) {
  const p = half(points);
  if (p <= 1) return [0, p];
  const mid = half(p / 2);
  return [...new Set([0, mid, p])].sort((a, b) => a - b);
}

/** Split `total` marks across weights, in halves, each at least a half, adding up exactly. */
export function fitPoints(weights, total) {
  const n = weights.length;
  if (!n) return [];
  const T = half(total);
  if (T < n * 0.5) return weights.map((_, i) => (i === 0 ? T : 0));   // fewer marks than marking points: the rest carry nothing
  const sum = weights.reduce((s, w) => s + Math.max(0, Number(w) || 0), 0) || n;
  const out = weights.map((w) => Math.max(0.5, half(((Math.max(0, Number(w) || 0) || sum / n) / sum) * T)));
  let diff = half(T - out.reduce((s, x) => s + x, 0));
  // Settle the difference on the largest points first (or the smallest, when taking away), a half at a time.
  for (let guard = 0; diff !== 0 && guard < 400; guard++) {
    const order = out.map((v, i) => i).sort((a, b) => (diff > 0 ? out[b] - out[a] : out[a] - out[b]));
    const i = order.find((k) => diff > 0 || out[k] > 0.5);
    if (i === undefined) break;
    out[i] = half(out[i] + (diff > 0 ? 0.5 : -0.5));
    diff = half(diff + (diff > 0 ? -0.5 : 0.5));
  }
  return out;
}

const chips = (list) => (Array.isArray(list) ? list : [])
  .map((c) => text(c, MARK_SCHEME_LIMITS.chip)).filter(Boolean)
  .filter((c, i, a) => a.indexOf(c) === i).slice(0, MARK_SCHEME_LIMITS.chips);

const DEFAULT_LABELS = { zero: "No credit", mid: "Partial credit", full: "Full credit" };

/** A marking point's levels, rebuilt on the points it can actually award, keeping the model's wording where it fits. */
function cleanLevels(raw, points, fallback) {
  const want = levelPoints(points);
  const given = (Array.isArray(raw) ? raw : []).map((l) => ({ points: half(l?.points), label: text(l?.label, MARK_SCHEME_LIMITS.label), descriptor: text(l?.descriptor, MARK_SCHEME_LIMITS.descriptor) }))
    .filter((l) => Number.isFinite(l.points));
  return want.map((p, i) => {
    const hit = given.find((l) => l.points === p)
      || given.slice().sort((a, b) => Math.abs(a.points - p) - Math.abs(b.points - p))[0];
    const role = i === 0 ? "zero" : i === want.length - 1 ? "full" : "mid";
    // Only reuse a level's words when it is the same rung (nearest-points fallback must not put "full" wording on "none").
    const same = hit && (hit.points === p || (given.length === want.length));
    return {
      points: p,
      label: (same && hit.label) || DEFAULT_LABELS[role],
      descriptor: (same && hit.descriptor) || (role === "zero" ? fallback.zero : role === "full" ? fallback.full : fallback.mid),
    };
  });
}

function cleanMarkingPoint(raw, points) {
  const looks = text(raw?.looks_for, MARK_SCHEME_LIMITS.lookFor) || "The answer addresses this part of the question.";
  const model = text(raw?.model_answer, MARK_SCHEME_LIMITS.modelAnswer);
  return {
    looks_for: looks,
    model_answer: model,
    points,
    levels: cleanLevels(raw?.levels, points, {
      zero: "Nothing relevant, or a wrong answer.",
      mid: "Partly there — some of what is needed.",
      full: model ? `Gives the model answer or an equivalent: ${model}`.slice(0, MARK_SCHEME_LIMITS.descriptor) : "Fully correct.",
    }),
    full_marks_also_for: chips(raw?.full_marks_also_for),
    no_marks_for: chips(raw?.no_marks_for),
  };
}

/**
 * Raw criteria (a model's, or a teacher's edits) → the stored scheme for this paper.
 *  - criteria point at real questions the AI marks (keyed MCQs and unknown questions are dropped);
 *  - each question's marking points add up to the question's marks exactly;
 *  - every question the AI marks has at least one criterion (a plain one is added when none was written);
 *  - ids are reissued in order; totals are recomputed.
 * `oneBased`: the model numbers questions from 1; stored schemes use the 0-based index.
 */
export function cleanMarkScheme(input, paper, { oneBased = false } = {}) {
  const questions = paper?.questions || [];
  const marked = new Set(markedIndexes(paper));
  const raw = (Array.isArray(input?.criteria) ? input.criteria : []).slice(0, MARK_SCHEME_LIMITS.criteria);

  // 1 · keep what belongs to a marked question, in the order given, capped per criterion
  const kept = [];
  for (const c of raw) {
    const n = Number(c?.question);
    const qi = Number.isInteger(n) ? n - (oneBased ? 1 : 0) : -1;
    if (!marked.has(qi)) continue;
    const mps = (Array.isArray(c?.marking_points) ? c.marking_points : []).slice(0, MARK_SCHEME_LIMITS.markingPoints);
    if (!mps.length) continue;
    kept.push({ qi, title: text(c?.title, MARK_SCHEME_LIMITS.title), description: text(c?.description, MARK_SCHEME_LIMITS.description), mps });
  }

  // 2 · a plain criterion for any marked question the scheme missed
  for (const qi of marked) {
    if (kept.some((c) => c.qi === qi)) continue;
    const q = questions[qi] || {};
    const answer = typeof q.answer === "object" && q.answer ? Object.entries(q.answer).map(([k, v]) => `${k}: ${v}`).join("; ") : q.answer;
    kept.push({ qi, title: `Question ${qi + 1}`, description: text(q.q, MARK_SCHEME_LIMITS.description), mps: [{ looks_for: "The answer is correct and complete.", model_answer: text(answer || q.marking, MARK_SCHEME_LIMITS.modelAnswer), points: questionPoints(q) }] });
  }
  kept.sort((a, b) => a.qi - b.qi);

  // 3 · per question, fit the marking points to the question's marks
  const byQ = new Map();
  for (const c of kept) (byQ.get(c.qi) || byQ.set(c.qi, []).get(c.qi)).push(c);
  const criteria = [];
  for (const [qi, group] of byQ) {
    const flat = group.flatMap((c) => c.mps.map((mp) => ({ c, mp })));
    const fitted = fitPoints(flat.map((x) => Number(x.mp?.points) || 1), questionPoints(questions[qi]));
    flat.forEach((x, k) => { x.points = fitted[k]; });
    for (const c of group) {
      const mps = flat.filter((x) => x.c === c && x.points > 0).map((x) => cleanMarkingPoint(x.mp, x.points));
      if (!mps.length) continue;
      criteria.push({ title: c.title || `Question ${qi + 1}`, description: c.description, question: qi, marking_points: mps });
    }
  }

  // 4 · ids and totals
  const out = criteria.map((c, ci) => ({
    id: `c${ci + 1}`, title: c.title, description: c.description, question: c.question,
    points: half(c.marking_points.reduce((s, m) => s + m.points, 0)),
    marking_points: c.marking_points.map((m, mi) => ({ id: `c${ci + 1}m${mi + 1}`, ...m })),
  }));
  return { version: 1, total_points: half(out.reduce((s, c) => s + c.points, 0)), criteria: out };
}

/** At a glance, for the tab's header ("5 criteria · 10 pts"). */
export function summarizeMarkScheme(scheme) {
  const criteria = Array.isArray(scheme?.criteria) ? scheme.criteria : [];
  return {
    criteria: criteria.length,
    markingPoints: criteria.reduce((s, c) => s + (c.marking_points?.length || 0), 0),
    totalPoints: half(criteria.reduce((s, c) => s + (Number(c.points) || 0), 0)),
  };
}

/** The criteria for one question (0-based). */
export const criteriaFor = (scheme, qi) => (Array.isArray(scheme?.criteria) ? scheme.criteria : []).filter((c) => c.question === qi);

/** The scheme the grader should follow, or null (none, or nothing in it). */
export function gradingScheme(details) {
  const s = details?.mark_scheme;
  return s && Array.isArray(s.criteria) && s.criteria.length ? s : null;
}

/* ── On a draft version, and going out with the assignment ───────────────── */

export const RUBRIC_JOB_MS = 120_000;
/** A rubric still "drafting" well past its deadline was cut off (a restart mid-job). */
export const isRubricJobStale = (r, now = Date.now()) =>
  r?.status === "drafting" && (!r.startedAt || now - Date.parse(r.startedAt) > RUBRIC_JOB_MS + 60_000);

/** What a version's rubric looks like to the preview: status, the scheme, whether the questions moved on since. */
export function rubricView(v, now = Date.now()) {
  const r = v?.rubric || null;
  if (!r) return { status: "none", scheme: null, stale: false, summary: null };
  const status = isRubricJobStale(r, now) ? "failed" : r.status;
  return {
    status,
    scheme: r.scheme || null,
    note: r.note || null,
    error: status === "failed" ? (r.error || "Drafting was interrupted — try again.") : null,
    edited: !!r.edited,
    stale: !!(r.scheme && r.digest && v?.paper && r.digest !== paperDigest(v.paper)),
    summary: r.scheme ? summarizeMarkScheme(r.scheme) : null,
  };
}

/**
 * Auto-grading is on: may this version go out? → a reason it may not, or null.
 * A paper with nothing for the AI to mark (all keyed multiple choice) needs no rubric.
 */
export function assignGate(v, now = Date.now()) {
  if (!markedIndexes(v?.paper).length) return null;
  const r = v?.rubric;
  if (r?.status === "drafting" && !isRubricJobStale(r, now)) return "The rubric is still being written — assign in a moment.";
  if (!r?.scheme?.criteria?.length) return "Auto-grading is on, but this version has no rubric yet — write it on the Rubric tab, or turn auto-grading off.";
  return null;
}

/** The scheme that goes out with the assignment: re-cleaned against the final paper, so it always adds up. */
export function assignScheme(v) {
  if (!v?.rubric?.scheme || !markedIndexes(v?.paper).length) return null;
  const s = cleanMarkScheme(v.rubric.scheme, v.paper);
  return s.criteria.length ? s : null;
}

/* ── Writing it with the model ───────────────────────────────────────────── */

/** How many of the marked questions the model's raw JSON wrote criteria (with marking points) for. */
function coverage(json, marked) {
  const seen = new Set();
  for (const c of Array.isArray(json?.criteria) ? json.criteria : []) {
    const qi = Number(c?.question) - 1;
    if (marked.has(qi) && Array.isArray(c?.marking_points) && c.marking_points.length) seen.add(qi);
  }
  return seen.size;
}

export function markSchemeResponseFormat() {
  const str = { type: "string" };
  const list = { type: "array", items: { type: "string" } };
  return {
    type: "json_schema",
    json_schema: {
      name: "mark_scheme", strict: true,
      schema: {
        type: "object", additionalProperties: false, required: ["criteria"],
        properties: {
          criteria: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["question", "title", "description", "marking_points"],
              properties: {
                question: { type: "integer", description: "The question's number as printed (1-based)." },
                title: { ...str, description: "A short name for what this criterion assesses, e.g. \"Octal decoding\"." },
                description: { ...str, description: "One sentence: what a correct answer does for this criterion." },
                marking_points: {
                  type: "array",
                  items: {
                    type: "object", additionalProperties: false,
                    required: ["looks_for", "model_answer", "points", "levels", "full_marks_also_for", "no_marks_for"],
                    properties: {
                      looks_for: { ...str, description: "What the marker looks for, as a question about the learner's answer." },
                      model_answer: str,
                      points: { type: "number", description: "Marks for this marking point (whole or half marks)." },
                      levels: {
                        type: "array",
                        items: { type: "object", additionalProperties: false, required: ["points", "label", "descriptor"],
                          properties: { points: { type: "number" }, label: str, descriptor: str } },
                      },
                      full_marks_also_for: { ...list, description: "Other correct answers or phrasings that earn full marks." },
                      no_marks_for: { ...list, description: "Wrong answers and common misconceptions that earn nothing." },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

const ansText = (q) => (typeof q.answer === "object" && q.answer ? Object.entries(q.answer).map(([k, v]) => `${k}: ${v}`).join("; ") : q.answer);

export function buildMarkSchemeMessages({ paper, topic, subject, classLevel, current = null, request = null }) {
  const questions = paper?.questions || [];
  const marked = new Set(markedIndexes(paper));
  const system = [
    "You are an experienced examiner writing the mark scheme (rubric) a teacher's AI marker will follow, for an assignment on" +
      ` "${text(topic, 160) || "the topic"}"${subject ? ` (${text(subject, 60)})` : ""}${classLevel ? ` for ${text(classLevel, 40)}` : ""}.`,
    "For every question listed, write one or more CRITERIA, each with MARKING POINTS. A marking point is one thing a learner can earn marks for.",
    "For each marking point give: `looks_for` (what the marker checks, phrased as a question about the learner's answer), `model_answer`, `points`, `levels` (from no marks up to full marks, each with a short label and a descriptor of what that level looks like), `full_marks_also_for` (other correct answers or phrasings to accept) and `no_marks_for` (wrong answers and common misconceptions that earn nothing).",
    "The marking points of a question must add up to the question's marks EXACTLY. Whole or half marks only. Use 1-3 marking points for a 1-4 mark question, up to 6 for larger ones.",
    "Base every marking point on the question's own model answer and marking line. Write only what a marker can decide from an answer — handwriting included. Pitch the wording at the class level. Never invent facts the question doesn't support.",
    "Multiple-choice questions marked from a key are not listed: do not write criteria for them.",
  ].join("\n");
  const body = questions.map((q, i) => (marked.has(i)
    ? [`Q${i + 1} (${questionPoints(q)} marks${q.type ? `, ${q.type}` : ""}): ${text(q.q, 900)}`,
       ansText(q) ? `  Model answer: ${text(ansText(q), 600)}` : "",
       q.marking ? `  Marking line: ${text(q.marking, 500)}` : "",
       Array.isArray(q.options) ? `  Options: ${q.options.map((o, j) => `${"ABCDEFGHIJ"[j]}. ${o}`).join("; ")}` : ""].filter(Boolean).join("\n")
    : `Q${i + 1}: marked from the answer key — no criteria needed.`)).join("\n\n");
  const user = [
    `The questions:\n\n${body}`,
    current ? `The mark scheme as it stands (improve it; keep what is good):\n${JSON.stringify({ criteria: (current.criteria || []).map((c) => ({ question: (c.question ?? 0) + 1, title: c.title, description: c.description, marking_points: c.marking_points })) })}` : "",
    request ? `The teacher asks: ${text(request, 600)}` : "",
  ].filter(Boolean).join("\n\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/**
 * Write (or improve) the scheme for a paper. `chat(messages, { response_format })` → the model's JSON string.
 * → { scheme, note }. A paper with nothing for the AI to mark (all keyed MCQs) is a scheme with no criteria.
 */
export async function draftMarkScheme({ chat, paper, topic, subject, classLevel, current = null, request = null }) {
  if (!markedIndexes(paper).length) {
    return { scheme: cleanMarkScheme({ criteria: [] }, paper), note: "Every question is multiple choice, marked from the answer key — there is nothing for a rubric to cover." };
  }
  const marked = new Set(markedIndexes(paper));
  // How many of the questions the AI marks did the model actually write criteria for (the rest get a plain one).
  const ask = async () => {
    const out = await chat(buildMarkSchemeMessages({ paper, topic, subject, classLevel, current, request }), { response_format: markSchemeResponseFormat() });
    let json = {}; try { json = JSON.parse(out || "{}"); } catch { json = {}; }
    return { json, scheme: cleanMarkScheme(json, paper, { oneBased: true }), covered: coverage(json, marked) };
  };
  let best = await ask();
  // The model's own criteria are what count: if it missed questions (bad JSON, wrong numbers), ask once more and keep the fuller one.
  if (best.covered < marked.size) { const again = await ask(); if (again.covered > best.covered) best = again; }
  if (!best.covered || !best.scheme.criteria.length) throw new Error("The AI returned no mark scheme — try again.");
  const scheme = best.scheme;
  return { scheme, note: request ? "Improved as asked." : "Written from the questions." };
}
