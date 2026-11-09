/**
 * modules/tasks/tools/generator-scaffold.js — Lever 4 of the token-cost plan.
 *
 * The fixed shape of a worksheet or lesson plan is a SCRIPT; only the content
 * (the questions, the activities, the wording) is the model's job. Before, the
 * model was asked to also emit the boilerplate — question numbers, option
 * letters, and (for a lesson plan) echo back subject/class/duration and a
 * canonical Starter/Main/Plenary skeleton. That is output tokens spent on a
 * shape a script can guarantee, and a chance for the model to get it wrong.
 *
 * PURE: no clock, no db, no randomness — so the assembled shape is identical on
 * every run for the same content.
 */
const LETTERS = ["A", "B", "C", "D", "E", "F"];
const stripPrefix = (s) => String(s ?? "").replace(/^[A-F][.)]\s*/i, "").trim();
const positiveInt = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : d; };

/** Worksheet questions → fixed shape: sequential n, normalised type, lettered options. */
export function assembleWorksheetQuestions(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const question = String(r?.question ?? r?.stem ?? "").trim();
    if (!question) continue;

    let options = Array.isArray(r?.options) ? r.options.map(stripPrefix).filter(Boolean) : [];
    let type = String(r?.type ?? "").toLowerCase();
    if (!["mcq", "fill_blank", "short", "problem", "true_false"].includes(type)) type = options.length ? "mcq" : "short";
    if (type === "true_false") options = ["True", "False"];
    if (type === "mcq" && options.length < 2) type = "short";   // ungradable MCQ → short answer

    const item = { n: out.length + 1, type, question };
    if (type === "mcq" || type === "true_false") item.options = options.slice(0, LETTERS.length).map((o, i) => `${LETTERS[i]}. ${o}`);
    const answer = String(r?.answer ?? "").trim();
    if (answer) item.answer = answer;
    out.push(item);
  }
  return out;
}

/**
 * Lesson plan → fixed shape. The subject/class/duration are taken from the
 * request (never trusted from the model's echo), and the phases are guaranteed
 * to be a Starter/Main/Plenary skeleton whose minutes add up to the lesson
 * length when the model didn't supply usable ones.
 */
export function assembleLessonPlan(plan = {}, { subject, yearGroup, durationMins } = {}) {
  const dur = positiveInt(durationMins, positiveInt(plan?.durationMins, 40));

  const raw = Array.isArray(plan?.phases) ? plan.phases : [];
  let phases = raw
    .map((p) => ({
      name: String(p?.name ?? "").trim() || "Phase",
      minutes: positiveInt(p?.minutes, 1),
      activity: String(p?.activity ?? "").trim(),
    }))
    .filter((p) => p.activity || p.name);

  if (!phases.length) {
    const starter = Math.max(1, Math.round(dur * 0.15));
    const plenary = Math.max(1, Math.round(dur * 0.2));
    const main = Math.max(1, dur - starter - plenary);
    phases = [
      { name: "Starter", minutes: starter, activity: String(plan?.lessonHook ?? "").trim() || "Open the lesson and hook the class." },
      { name: "Main", minutes: main, activity: String(plan?.assessment ?? "").trim() || "Teach and practise the topic." },
      { name: "Plenary", minutes: plenary, activity: "Review and check understanding." },
    ];
  }

  return {
    ...plan,
    subject: subject ?? plan?.subject ?? "",
    yearGroup: yearGroup ?? plan?.yearGroup ?? "",
    durationMins: dur,
    phases,
  };
}
