/**
 * modules/self-study/aiGrade.js — AI auto-grade: DRAFT marks for the
 * instructor to approve ("Drafts a mark per answer for you to approve").
 *
 *   • Multiple-choice questions are scored exactly, from the answer key —
 *     no model involved.
 *   • Written answers, the activity's rubric and the feedback are drafted
 *     by the model from the submission's markdown copy (the same work the
 *     PDF shows) plus up to four attached photos (handwritten work).
 *   • The result is stored on the target as ai_grade and shown in the
 *     grading panel. It is never published by itself — the instructor
 *     applies it, adjusts, and publishes.
 *
 * Billing: the activity's owner (the instructor), or their school when it
 * funds them — the feature is theirs, not the learner's.
 * The shaping is pure and covered by ai-grade.contract.test.mjs.
 */

export const AI_GRADE_LIMITS = Object.freeze({
  MAX_MARKDOWN_CHARS: 24_000,
  MAX_IMAGES: 4,
  MAX_IMAGE_BYTES: 4 * 1024 * 1024,
  DEFAULT_POINTS: 5,          // a question with no max_points
});

const qText = (q) => (typeof q === "object" && q !== null ? String(q.q ?? "") : String(q ?? ""));
const isMcq = (q) => typeof q === "object" && q !== null && Array.isArray(q.options);
const pointsOf = (q) => {
  const n = Number(typeof q === "object" && q ? q.max_points ?? q.points : NaN);
  return Number.isFinite(n) && n > 0 ? n : AI_GRADE_LIMITS.DEFAULT_POINTS;
};

/** The activity's rubric as [{ name, max }] (empty when it has none). */
export function rubricRows(details) {
  return (Array.isArray(details?.rubric) ? details.rubric : [])
    .map((r) => ({ name: String(r?.criterion ?? r?.name ?? "").trim(), max: Math.round(Number(r?.points ?? r?.max)) }))
    .filter((r) => r.name && r.max > 0 && r.max <= 20)
    .slice(0, 12);
}

/** MCQs scored from the key: [{ index, awarded, max, auto: true, why }]. */
export function scoreMcqs(questions, answers = {}) {
  const out = [];
  (questions || []).forEach((q, i) => {
    if (!isMcq(q) || q.correct == null) return;
    const raw = answers[String(i)] ?? answers[i];
    const max = pointsOf(q);
    const answered = raw !== undefined && raw !== null && String(raw).trim() !== "";
    const right = answered && Number(raw) === Number(q.correct);
    out.push({ index: i, awarded: right ? max : 0, max, auto: true,
      why: !answered ? "No answer." : right ? "Correct." : `Chose ${"ABCDEFGHIJ"[Number(raw)] ?? "?"}; the answer is ${"ABCDEFGHIJ"[Number(q.correct)] ?? "?"}.` });
  });
  return out;
}

/** The questions the model marks (not auto-scored MCQs). */
export const openQuestions = (questions) =>
  (questions || []).map((q, i) => ({ q, i })).filter(({ q }) => !(isMcq(q) && q.correct != null));

export function aiGradeSchema() {
  return {
    type: "object", additionalProperties: false, required: ["questions", "rubric", "feedback"],
    properties: {
      questions: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "awarded", "why"],
        properties: { index: { type: "integer" }, awarded: { type: "number" }, why: { type: "string" } } } },
      rubric: { type: "array", items: { type: "object", additionalProperties: false, required: ["criterion", "level", "why"],
        properties: { criterion: { type: "string" }, level: { type: "integer" }, why: { type: "string" } } } },
      feedback: { type: "string" },
    },
  };
}

/** The model's messages: system rules + the submission (text and photos). */
export function buildAiGradeMessages({ assignment = {}, markdown = "", images = [] }) {
  const questions = Array.isArray(assignment.details?.questions) ? assignment.details.questions : [];
  const open = openQuestions(questions);
  const rubric = rubricRows(assignment.details);
  const passages = Array.isArray(assignment.details?.passages) ? assignment.details.passages : [];
  const system = [
    `You are drafting marks for a teacher on a learner's submission for "${String(assignment.title || "an activity").slice(0, 160)}"${assignment.subject ? ` (${assignment.subject})` : ""}.`,
    "The teacher reviews and approves everything you produce. Be fair, specific and brief; never invent work the learner didn't submit.",
    open.length ? "Mark each listed question: `awarded` from 0 to its max points (halves allowed), `why` in one sentence citing what the learner wrote." : "",
    open.length ? open.map(({ q, i }) => `Q${i + 1} (index ${i}, max ${pointsOf(q)}${Number.isInteger(q?.passage) && passages[q.passage] ? `, about passage ${q.passage + 1}` : ""}): ${qText(q)}${q?.figure ? " [has a diagram the learner saw]" : ""}${typeof q === "object" && q?.answer ? `\n  Model answer: ${typeof q.answer === "object" ? Object.entries(q.answer).map(([k, v]) => `${k}: ${v}`).join("; ") : q.answer}` : ""}${q?.format === "label" ? " [the learner names each labelled part as \"P: …\" lines]" : ""}`).join("\n") : "",
    // A comprehension passage the open questions are about.
    open.some(({ q }) => Number.isInteger(q?.passage) && passages[q.passage])
      ? `Passages:\n${passages.map((p, n) => `Passage ${n + 1}${p.title ? ` — ${p.title}` : ""}:\n${String(p.text || "").slice(0, 6000)}`).join("\n\n")}` : "",
    rubric.length ? `Score each rubric criterion with an integer level from 0 to its max, \`why\` in one sentence:\n${rubric.map((r) => `- ${r.name} (max ${r.max})`).join("\n")}` : "There is no rubric: return an empty rubric list.",
    "Write `feedback` to the learner (2-4 sentences): what they did well, what to fix, one next step. Use the learner's language.",
    "Photos attached are the learner's own pages (e.g. handwriting) — read them as part of the submission.",
  ].filter(Boolean).join("\n\n");
  const content = [{ type: "text", text: `The submission:\n\n${String(markdown).slice(0, AI_GRADE_LIMITS.MAX_MARKDOWN_CHARS)}` }];
  for (const img of images.slice(0, AI_GRADE_LIMITS.MAX_IMAGES)) {
    content.push({ type: "image_url", image_url: { url: `data:${img.mime};base64,${Buffer.from(img.bytes).toString("base64")}`, detail: "high" } });
  }
  return [{ role: "system", content: system }, { role: "user", content }];
}

/**
 * MCQ scores + the model's JSON → the draft the panel shows:
 * { score (0-100), questions:[{index,awarded,max,why,auto?}], rubric:[{name,max,level,why}], feedback, notes[] }
 */
export function shapeAiGrade({ assignment = {}, submission = {}, json = {}, notes = [] }) {
  const questions = Array.isArray(assignment.details?.questions) ? assignment.details.questions : [];
  const mcq = scoreMcqs(questions, submission.answers || {});
  const byIndex = new Map((Array.isArray(json?.questions) ? json.questions : []).map((q) => [Number(q?.index), q]));
  const marked = openQuestions(questions).map(({ q, i }) => {
    const max = pointsOf(q);
    const got = byIndex.get(i);
    const awarded = Math.min(max, Math.max(0, Math.round(Number(got?.awarded) * 2) / 2));
    return { index: i, awarded: Number.isFinite(awarded) ? awarded : 0, max, why: String(got?.why || "Not assessed — check this one.").slice(0, 400) };
  });
  const all = [...mcq, ...marked].sort((a, b) => a.index - b.index);
  const rubricDef = rubricRows(assignment.details);
  const rubricIn = new Map((Array.isArray(json?.rubric) ? json.rubric : []).map((r) => [String(r?.criterion || "").trim().toLowerCase(), r]));
  const rubric = rubricDef.map((r) => {
    const got = rubricIn.get(r.name.toLowerCase());
    const level = Math.min(r.max, Math.max(0, Math.round(Number(got?.level))));
    return { name: r.name, max: r.max, level: Number.isFinite(level) ? level : null, why: String(got?.why || "").slice(0, 400) };
  });
  // The score: the questions' points when there are questions, else the rubric.
  const qMax = all.reduce((s, q) => s + q.max, 0);
  const rMax = rubric.reduce((s, r) => s + r.max, 0);
  const score = qMax > 0
    ? Math.round((all.reduce((s, q) => s + q.awarded, 0) / qMax) * 100)
    : rMax > 0 && rubric.every((r) => r.level != null) ? Math.round((rubric.reduce((s, r) => s + r.level, 0) / rMax) * 100) : null;
  return { score, questions: all, rubric, feedback: String(json?.feedback || "").slice(0, 4000), notes };
}

/**
 * Run a draft for one target. deps: { load, chat, save } (injected by the
 * caller and the test). Never throws: a failure lands as status "failed".
 */
export async function runAiGrade(targetId, deps) {
  await deps.save(targetId, { status: "making", at: new Date().toISOString() });
  try {
    const { assignment, submission, markdown, images, notes = [] } = await deps.load(targetId);
    const questions = Array.isArray(assignment.details?.questions) ? assignment.details.questions : [];
    let json = {};
    // Only MCQs and no rubric → nothing for the model to do.
    if (openQuestions(questions).length || rubricRows(assignment.details).length || !questions.length) {
      try { json = JSON.parse(await deps.chat(buildAiGradeMessages({ assignment, markdown, images })) || "{}"); }
      catch (e) {
        if (e?.name === "InsufficientCoins") throw new Error("Out of AI credit — top up to draft marks.");
        throw e;
      }
    }
    const draft = shapeAiGrade({ assignment, submission, json, notes });
    await deps.save(targetId, { status: "ready", ...draft, at: new Date().toISOString() });
    return draft;
  } catch (e) {
    const error = String(e?.message || e).slice(0, 200);
    console.warn("[self-study/ai-grade] failed:", error);
    await deps.save(targetId, { status: "failed", error: /credit/i.test(error) ? error : "Couldn't draft marks right now — try again.", at: new Date().toISOString() }).catch(() => {});
    return null;
  }
}
