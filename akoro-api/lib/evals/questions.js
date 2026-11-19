// lib/evals/questions.js
//
// Does the model write questions that can be MARKED?
//
// This is the one place on the platform where a model error is silently
// harmful and cannot be taken back. questionSource.js says it plainly:
//
//   "A question whose answer key doesn't match any option is worse than a
//    missing question: it marks a correct learner wrong, in a competition,
//    permanently."
//
// normalise() already rejects the worst of it at generation time — but nothing
// measured how OFTEN it has to, and a rejection rate that doubles after a model
// swap would have been invisible. That rate is the number this suite exists to
// produce.
//
// Every check here is PROGRAMMATIC. No LLM judge: "is the answer key among the
// options" has a right answer, and a judge that can be wrong about it would
// only add a second thing to debug. Judging whether a question is *good* is a
// different job, and one worth deferring until real learners have complained
// about real questions.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generate } from "../../modules/battle/index.js";

// Goldens live in data/questions.json — data, not code, so a subject or a
// nastier topic can be added without a deploy, and so the threshold sits
// beside the cases it judges.
const DATA     = JSON.parse(readFileSync(fileURLToPath(new URL("./data/questions.json", import.meta.url)), "utf8"));
const CASES    = DATA.cases;
const PER_CASE = DATA.perCase;

/**
 * One case = one generation request, judged as a batch.
 *
 * Asserting per-question would report "34 of 35 passed" for a batch that is
 * unusable — a teacher gets the whole set or nothing, so the batch is the unit
 * that matters.
 */
function judge({ requested, questions, charged }) {
  const problems = [];
  const seenStems = new Set();

  for (const [i, q] of questions.entries()) {
    const where = `Q${i + 1}`;
    const opts = Array.isArray(q.options) ? q.options : [];

    if (!q.stem || String(q.stem).trim().length < 10) problems.push(`${where}: stem missing or too short`);
    if (opts.length < 3) problems.push(`${where}: only ${opts.length} options`);

    // The irreversible one.
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= opts.length) {
      problems.push(`${where}: answer key ${q.correctIndex} is not one of ${opts.length} options`);
    }

    const texts = opts.map((o) => String(o.text ?? o).trim().toLowerCase());
    if (new Set(texts).size !== texts.length) problems.push(`${where}: duplicate options`);
    if (texts.some((t) => !t)) problems.push(`${where}: an empty option`);

    // A repeated stem inside one battle is a wasted question and looks broken
    // to the learner who sees it twice.
    const key = String(q.stem ?? "").trim().toLowerCase();
    if (seenStems.has(key)) problems.push(`${where}: duplicate of an earlier question`);
    seenStems.add(key);
  }

  // The reject rate. normalise() drops what it cannot mark, so a short batch
  // means the model produced unusable output even though nothing downstream
  // errored — exactly the silent degradation worth watching across models.
  const kept = questions.length;
  const rejected = Math.max(0, requested - kept);
  if (kept === 0) problems.push("nothing usable was generated");
  else if (kept < Math.ceil(requested * 0.6)) {
    problems.push(`only ${kept} of ${requested} survived normalise() — ${rejected} rejected`);
  }

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("; ") : `${kept}/${requested} usable`,
    metrics: { requested, kept, rejected, charged },
  };
}

export const questionsSuite = {
  key: "questions",
  title: "Battle question generation",
  purpose:
    "Can generated questions actually be marked? Checks the answer key is among the options, " +
    "no duplicates, and how many survive normalise(). A wrong key marks a correct learner wrong, " +
    "permanently — this is the one model output nobody reads before it counts.",
  threshold: DATA.threshold,
  thresholdNote: DATA.thresholdNote,
  // Roughly what one run costs: a generation call per case, ~1.5k output tokens.
  estimatedCalls: CASES.length,
  cases: CASES.map((c) => ({
    key: `${c.subject}:${c.topic}:${c.difficulty}`.toLowerCase().replace(/\s+/g, "-"),
    name: `${c.subject} — ${c.topic} (${c.difficulty})`,
    async run({ model, userId }) {
      const res = await generate({
        subject: c.subject, topic: c.topic, difficulty: c.difficulty,
        count: PER_CASE, classLabel: "JSS1", userId,
        exemplars: [],
        // The model under test, not the platform default — comparing tiers is
        // the whole reason this suite exists.
        model,
        // Tagged so eval spend is isolated on the AI spend page instead of
        // inflating battle_generate and making real feature costs unreadable.
        feature: 'eval',
      });
      const j = judge({ requested: PER_CASE, questions: res.questions ?? [], charged: res.charged ?? 0 });
      return {
        passed: j.passed,
        expected: `${PER_CASE} markable questions`,
        actual: `${(res.questions ?? []).length} usable`,
        detail: j.detail,
        metrics: j.metrics,
      };
    },
  })),
};
