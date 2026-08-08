/**
 * modules/battle/questionSource.js — where a battle's questions come from.
 *
 * Three sources, one shape. Until now a battle could only use what was already
 * archived: a course's question_bank, or the past-papers bank by subject. That
 * makes most subjects unplayable — the NCEE archive covers five, and a teacher
 * wanting a battle on Photosynthesis for JSS2 had nothing.
 *
 * So AI generation is a first-class source. The interesting part is not asking a
 * model for questions — it's making its questions look like the bank's. A
 * generic "write 15 MCQs" prompt produces recognisably different work:
 * four options where the exam uses five, prose stems where the exam is terse,
 * no distractor discipline. Learners notice, and a mixed battle reads as half
 * real and half filler.
 *
 * The fix is not adjectives in a prompt. It is EXEMPLARS: pull real verified
 * questions for that subject out of the bank and show them to the model as the
 * house style to imitate. Style transfer from actual examples, grounded further
 * by the curriculum's own performance objectives when we have them.
 *
 * Everything returns the same normalised row, so the battle doesn't know or
 * care which source filled it.
 */

import db from "../../db.js";
import { openai, OPENAI_MODEL } from "../../lib/aiModel.js";
import { chargeForAI, schoolBillTo, InsufficientCoins } from "../../lib/coins.js";

/** One battle_questions row, however it was produced. */
/**
 * perQuestionSeconds — turn the battle's Duration into a clock per question.
 *
 * The engine paces a battle by battle_questions.time_limit_seconds and NOTHING
 * else; it never reads the battle's own time_limit_seconds. That was hardcoded
 * to 15 here, so the Duration field on the create form changed nothing at all:
 * every battle ran at 15 seconds a question, and a teacher who asked for 15
 * minutes over 15 questions got a battle that was over in under four.
 *
 * Duration is now what it looks like — the time the whole battle should take,
 * shared out across its questions.
 *
 * Floors at 8s because below that a learner cannot read the stem, let alone
 * think; caps at 180s so a mistyped duration can't leave a class watching one
 * question for an hour. Falls back to 15s when there is nothing to divide.
 */
export function perQuestionSeconds(totalSeconds, questionCount) {
  const total = Number(totalSeconds);
  const count = Number(questionCount);
  if (!Number.isFinite(total) || !Number.isFinite(count) || total <= 0 || count <= 0) return 15;
  return Math.min(180, Math.max(8, Math.floor(total / count)));
}

const row = (battleId, order, q, seconds = 15) => ({
  battle_id:            battleId,
  question_order:       order,
  question_text:        q.stem,
  options_json:         JSON.stringify(q.options.map((o) => `${o.label}. ${o.text}`)),
  correct_answer_index: q.correctIndex,
  topic:                q.topic || null,
  xp_value:             q.xp ?? 35,
  time_limit_seconds:   seconds,
});

/**
 * normalise — the one gate everything passes through.
 *
 * A question whose answer key doesn't match any option is worse than a missing
 * question: it marks a correct learner wrong, in a competition, permanently.
 * So the answer must resolve to an option or the question is dropped, whatever
 * produced it.
 */
function normalise(raw, fallbackTopic) {
  const opts = (Array.isArray(raw.options) ? raw.options : [])
    .map((o, i) => (typeof o === "string"
      ? { label: String.fromCharCode(65 + i), text: o.replace(/^[A-E][.)]\s*/, "") }
      : { label: String(o.label ?? String.fromCharCode(65 + i)).trim().toUpperCase(), text: String(o.text ?? "").trim() }))
    .filter((o) => o.text);

  if (opts.length < 2) return null;
  const stem = String(raw.stem ?? raw.question_text ?? raw.question ?? "").trim();
  if (!stem) return null;

  const key = String(raw.answer ?? "").trim().toUpperCase();
  let idx = opts.findIndex((o) => o.label === key);
  // Some models answer with the option's TEXT rather than its letter.
  if (idx < 0) idx = opts.findIndex((o) => o.text.toLowerCase() === String(raw.answer ?? "").trim().toLowerCase());
  if (idx < 0 && Number.isInteger(raw.correct_answer_index)) idx = raw.correct_answer_index;
  if (idx < 0 || idx >= opts.length) return null;

  return { stem, options: opts, correctIndex: idx, topic: raw.topic || fallbackTopic || null, xp: raw.xp_value ?? 35 };
}

const dedupeKey = (q) => q.stem.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);

/* ══════════════════════════ SOURCE 1 — past papers ══════════════════════════ */

/**
 * Verified multiple-choice questions for a subject. Only verified: an
 * unverified vision-parsed question must not be scored as fact in a contest.
 */
export async function fromPastPapers({ subject, difficulty, limit }) {
  const { data } = await db.schema("edu").from("past_questions")
    .select("stem, options, answer, topic, difficulty")
    .eq("type", "mcq").eq("verified", true).ilike("subject", subject)
    .not("answer", "is", null).limit(limit * 4);

  const wanted = difficulty === "intermediate" ? "medium" : difficulty;
  const pool = data ?? [];
  const ordered = [...pool.filter((r) => r.difficulty === wanted),
                   ...pool.filter((r) => r.difficulty !== wanted)];

  const out = [];
  const seen = new Set();
  for (const r of ordered) {
    if (out.length >= limit) break;
    const q = normalise(r, subject);
    if (!q) continue;
    const k = dedupeKey(q);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

/* ══════════════════════════ SOURCE 2 — course bank ══════════════════════════ */

export async function fromCourseBank({ courseId, topic, subject, difficulty, limit }) {
  let q = db.from("question_bank").select("*").eq("course_id", courseId).eq("is_active", true);
  if (topic)   q = q.eq("topic", topic);
  if (subject) q = q.eq("subject", subject);
  const { data: exact } = await q.eq("difficulty", difficulty ?? "intermediate").limit(limit);

  const picked = [...(exact ?? [])];
  if (picked.length < limit) {
    const used = picked.map((r) => r.id);
    let fb = db.from("question_bank").select("*").eq("course_id", courseId).eq("is_active", true);
    if (used.length) fb = fb.not("id", "in", `(${used.join(",")})`);
    const { data: more } = await fb.limit(limit - picked.length);
    picked.push(...(more ?? []));
  }

  const out = [];
  for (const r of picked) {
    let options = r.options_json;
    if (typeof options === "string") { try { options = JSON.parse(options); } catch { options = []; } }
    const q2 = normalise({ stem: r.question_text, options, correct_answer_index: r.correct_answer_index, topic: r.topic, xp_value: r.xp_value }, topic || subject);
    if (q2) out.push(q2);
  }
  return out;
}

/* ══════════════════════════ SOURCE 3 — generated ═══════════════════════════ */

/** Curriculum objectives for the topic, so generated questions test the syllabus. */
async function curriculumGrounding(subject, topic) {
  if (!topic) return "";
  const { data } = await db.schema("edu").from("curriculum_topics")
    .select("title, performance_objectives, content")
    .ilike("title", `%${topic}%`).limit(3);
  const lines = [];
  for (const t of (data ?? [])) {
    const objs = (t.performance_objectives ?? []).slice(0, 5);
    if (objs.length) lines.push(`${t.title}: ${objs.join("; ")}`);
  }
  return lines.length
    ? `\n\nSyllabus objectives to test (from the national curriculum):\n${lines.join("\n")}`
    : "";
}

/** Real questions rendered as the house style to imitate. */
function styleBlock(exemplars) {
  if (!exemplars.length) return "";
  const shown = exemplars.slice(0, 4).map((q, i) =>
    `Example ${i + 1}:\nQ: ${q.stem}\n${q.options.map((o) => `${o.label}. ${o.text}`).join("\n")}\nAnswer: ${q.options[q.correctIndex].label}`
  ).join("\n\n");
  return `\n\nMatch the style of these REAL exam questions exactly — same length of stem, same number of options, same register, same way of phrasing distractors. Do not copy their content.\n\n${shown}`;
}

/**
 * generate — new questions in the bank's own style.
 *
 * Charged after the call, so a failed generation is free. Returns
 * { questions, charged }.
 */
export async function generate({ subject, topic, difficulty, count, classLabel, userId, exemplars = [] }) {
  const style = styleBlock(exemplars);
  const syllabus = await curriculumGrounding(subject, topic);
  const level = classLabel ? ` for ${classLabel} students` : " for Nigerian junior-secondary students";
  const optionCount = exemplars.length
    ? Math.round(exemplars.reduce((s, q) => s + q.options.length, 0) / exemplars.length)
    : 4;

  const system =
    `You write examination multiple-choice questions${level}. ` +
    `Every question must have exactly one defensible correct answer and distractors that a learner ` +
    `holding a specific misconception would actually choose — never filler. ` +
    `Use ${optionCount} options labelled A onwards. Return ONLY valid JSON, no markdown fence, no preamble.`;

  const user =
    `Write ${count} ${difficulty} multiple-choice questions on ${topic ? `"${topic}"` : subject}` +
    `${topic ? ` (${subject})` : ""}.${syllabus}${style}\n\n` +
    `JSON shape:\n` +
    `{"questions":[{"stem":"...","options":[{"label":"A","text":"..."}],"answer":"B","explanation":"one sentence","topic":"...","difficulty":"${difficulty}"}]}`;

  const resp = await openai.chat.completions.create({
    model: OPENAI_MODEL, max_tokens: Math.min(4000, 260 * count + 500), temperature: 0.7,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  });

  const raw = (resp.choices?.[0]?.message?.content ?? "").replace(/```json|```/g, "").trim();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const list = Array.isArray(parsed?.questions) ? parsed.questions : [];

  const seen = new Set(exemplars.map(dedupeKey));
  const out = [];
  for (const r of list) {
    const q = normalise(r, topic || subject);
    if (!q) continue;                       // unusable — dropped, never guessed at
    const k = dedupeKey(q);
    if (seen.has(k)) continue;              // don't restate an exemplar back at us
    seen.add(k);
    out.push(q);
  }

  let charged = 0;
  try {
    const billTo = await schoolBillTo(userId);
    const r = await chargeForAI({
      userId, feature: "battle_questions", model: OPENAI_MODEL,
      usage: resp.usage || {}, ref: subject, billTo,
    });
    charged = r?.charged || 0;
  } catch (e) {
    if (e instanceof InsufficientCoins) throw e;   // the caller turns this into copy
    console.error("[battle/questions] charge failed:", e.message);
  }

  return { questions: out, charged };
}

/* ═══════════════════════════════ ORCHESTRATOR ═══════════════════════════════ */

/**
 * buildQuestions — fill a battle from whichever source(s) the creator chose.
 *
 *   'bank' — archive only; fails loudly if the archive is thin
 *   'ai'   — generated only, still styled on the archive
 *   'auto' — the archive first, AI for the shortfall (the default, because a
 *            real past-paper question is better than a generated one, and a
 *            generated one is better than a battle that can't run)
 *
 * Inserts nothing until it knows what it has, so a battle is never created with
 * a partial set that silently plays short.
 */
export async function buildQuestions({
  battleId, source = "auto", total = 15,
  subject, topic, difficulty = "intermediate", classLabel,
  courseId = null, userId,
  // The battle's Duration. Divided across however many questions actually get
  // placed — not across `total`, because a battle that could only be filled
  // with 9 of 15 questions still has the whole duration to spend.
  durationSeconds = null,
}) {
  const bankOf = courseId
    ? () => fromCourseBank({ courseId, topic, subject, difficulty, limit: total })
    : () => fromPastPapers({ subject, difficulty, limit: total });

  let questions = [];
  let charged = 0;
  let generated = 0;

  if (source !== "ai") questions = await bankOf();

  if (source !== "bank" && questions.length < total) {
    // Even when generating everything, pull a few real ones purely as style
    // exemplars — that is what makes the output look like the bank rather than
    // like a chatbot.
    const exemplars = questions.length
      ? questions
      : await fromPastPapers({ subject, difficulty, limit: 4 });

    const need = total - questions.length;
    const res = await generate({
      subject, topic, difficulty, count: need, classLabel, userId,
      exemplars: source === "ai" ? exemplars : questions,
    });
    charged = res.charged;
    generated = res.questions.length;

    const seen = new Set(questions.map(dedupeKey));
    for (const q of res.questions) {
      if (questions.length >= total) break;
      const k = dedupeKey(q);
      if (seen.has(k)) continue;
      seen.add(k);
      questions.push(q);
    }
  }

  questions = questions.slice(0, total);
  const secs = perQuestionSeconds(durationSeconds, questions.length);
  if (questions.length) {
    await db.from("battle_questions").insert(questions.map((q, i) => row(battleId, i + 1, q, secs)));
  }
  return {
    placed: questions.length, fromBank: questions.length - generated, generated, charged,
    // So the caller can correct the battle's stored duration when fewer
    // questions were placed than asked for, and report the real pace.
    secondsPerQuestion: secs,
  };
}
