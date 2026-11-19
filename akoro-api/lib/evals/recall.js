// lib/evals/recall.js
//
// Does the agent answer from the LEARNER's notes, and refuse when they are silent?
//
// Battle agents now answer by recall: the learner's own edu.student_knowledge is
// searched and the model is shown only what it found. Two things have to hold
// for that to mean anything, and only one of them is about getting questions
// right.
//
// The first is that it reads a note correctly, including a scrappy one — real
// notes are not prose, and a feature that only works on tidy notes works for the
// learners who need it least.
//
// The second matters more: it must NOT answer from its own training when the
// notes do not cover the question. A model quietly filling that gap would make
// every agent score full marks, the knowledge bank would become decoration, and
// the battle would stop measuring the learner while looking better than ever.
// That failure is invisible from the outside — the logs would read beautifully.
//
// The golden-path suite cannot check either: its stand-in model returns a fixed
// reply. So this runs against a real one, calling the same answerFromRecall the
// worker calls, with notes supplied directly rather than retrieved — retrieval
// is ordinary SQL and is covered by gp-recall.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { answerFromRecall } from "../../modules/battle/index.js";

const DATA = JSON.parse(readFileSync(fileURLToPath(new URL("./data/recall.json", import.meta.url)), "utf8"));

const letter = (i) => (i == null ? "UNKNOWN" : String.fromCharCode(65 + i));

export const recallSuite = {
  key: "recall",
  title: "Agent recall",
  purpose:
    "Battle agents answer from the learner's own notes. This checks they read a note correctly — including " +
    "a scrappy, learner-written one — and, more importantly, that they refuse to answer from their own " +
    "training when the notes are silent. A model that fills that gap makes every agent look brilliant and " +
    "stops the battle measuring the learner at all.",
  threshold: DATA.threshold,
  thresholdNote: DATA.thresholdNote,
  estimatedCalls: DATA.cases.length,
  cases: DATA.cases.map((c) => ({
    key: c.key,
    name: c.name,
    async run({ model, userId }) {
      const res = await answerFromRecall({
        question: c.question,
        options: c.options,
        notes: c.notes.map((n, i) => ({ id: `n${i}`, topic: n.topic, content: n.content, confidence: 0.7 })),
        userId,
        model,
      });

      const got = res.basis === "unknown" ? "UNKNOWN" : letter(res.index);
      const passed = got === c.expect;

      // Naming which way it failed, because the two directions mean opposite
      // things: answering when it should have refused is the model overriding
      // the learner, and refusing when it should have answered is the feature
      // simply not working.
      const how = passed ? "as expected"
        : c.expect === "UNKNOWN" ? "answered from outside the notes — the failure that makes the bank decoration"
        : got === "UNKNOWN" ? "refused a question its notes did answer"
        : "read the notes and picked the wrong option";

      return {
        passed,
        expected: c.expect === "UNKNOWN" ? "UNKNOWN (notes do not cover it)" : `option ${c.expect}`,
        actual: got,
        detail: how,
      };
    },
  })),
};
