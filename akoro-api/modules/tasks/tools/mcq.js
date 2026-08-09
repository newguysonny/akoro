// modules/tasks/tools/mcq.js
//
// Turn a model-written question into something a battle can actually grade.
//
// Lifted out of create-battle.js when that tool was retired. challenge_peer
// still needs it, and it was the one piece of that file worth keeping: the
// model returns an ANSWER as text, while a battle stores a correct INDEX, and
// bridging the two is fiddlier than it looks — the answer may or may not carry
// its "B." prefix, and may be a substring of the option rather than equal to it.

/**
 * resolveMcq — { options, correctIndex } for a gradable question, or null.
 *
 * Returns null for anything that cannot be a multiple-choice battle question
 * (a short-answer prompt with no options), rather than inventing choices for
 * it — a battle question whose key does not match its options marks a correct
 * learner wrong, permanently, in a competition.
 */
export function resolveMcq(q) {
  let options = Array.isArray(q.options) ? q.options.map((o) => String(o)) : [];
  const answer = String(q.answer ?? "").trim();
  if (!options.length) {
    if (q.type === "true_false" || /^(true|false)$/i.test(answer)) options = ["True", "False"];
    else return null; // short_answer — not representable as an MCQ battle question
  }
  const norm = (s) => String(s).trim().replace(/^[A-E][.)]\s*/i, "").toLowerCase();
  let idx = options.findIndex((o) => norm(o) === norm(answer));
  if (idx < 0) idx = options.findIndex((o) => norm(o).includes(norm(answer)) || (norm(answer) && norm(answer).includes(norm(o))));
  if (idx < 0) idx = 0;
  return { options, correctIndex: idx };
}
