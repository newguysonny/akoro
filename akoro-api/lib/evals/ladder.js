// lib/evals/ladder.js
//
// Does the lesson ladder start at the beginning?
//
// gp-ladder already proves the structure holds — dependencies point backwards,
// kinds are valid, a malformed response degrades to empty. That says nothing
// about whether the path is teachable. A perfectly-ordered route through the
// wrong six ideas passes every structural check that could be written.
//
// This measures the failure that was actually reported: "The water cycle"
// opened on "States of Water: Solid, Liquid, and Gas". A learner who does not
// yet know what water IS cannot be taught that it has three states — the ladder
// began on its second rung, with the first one missing, and looked entirely
// reasonable doing it. Nothing but a real model can produce that mistake, so
// nothing but a live run can catch it.
//
// Deliberately loose about WORDING, strict about ORDER. There are many decent
// ways to name the first step of the water cycle and exactly one place it can
// sit, so the checks assert positions and prerequisites rather than phrasing.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NaNaEsumai } from "../../modules/adaptive-learning/index.js";

const DATA = JSON.parse(readFileSync(fileURLToPath(new URL("./data/ladder.json", import.meta.url)), "utf8"));

const norm = (s) => String(s ?? "").toLowerCase();

/** Where does a term first appear in the ladder? -1 if never. */
const indexOf = (titles, term) => titles.findIndex((t) => norm(t).includes(norm(term)));

export const ladderSuite = {
  key: "ladder",
  title: "Lesson ladder",
  purpose:
    "Does a generated topic ladder start at the real beginning and build in an order a teacher would " +
    "follow? gp-ladder checks the structure; this checks the teaching. The reported failure — opening " +
    "'The water cycle' on the three states of water — is well-formed, plausible, and unusable.",
  threshold: DATA.threshold,
  thresholdNote: DATA.thresholdNote,
  estimatedCalls: DATA.cases.length,
  cases: DATA.cases.map((c) => ({
    key: c.key,
    name: c.name,
    async run({ model, userId }) {
      const guide = new NaNaEsumai();
      const { subtopics, map } = await guide.generateSubtopics(c.topic, c.subject, "", { model, userId, feature: "eval" });

      if (!subtopics?.length) {
        return { passed: false, expected: "a ladder", actual: "nothing", detail: "the generator returned no steps" };
      }

      const problems = [];
      const first = subtopics[0];

      // The reported bug: step 1 already assumes a later idea.
      for (const term of (c.startsBefore ?? [])) {
        if (norm(first).includes(norm(term))) {
          problems.push(`starts on "${first}" — that already assumes ${term}`);
        }
      }

      if (c.firstKind && map[0]?.kind !== c.firstKind) {
        problems.push(`first step is a ${map[0]?.kind ?? "?"}, not a ${c.firstKind}`);
      }
      if (c.endsWithKind && map[map.length - 1]?.kind !== c.endsWithKind) {
        problems.push(`ends on a ${map[map.length - 1]?.kind ?? "?"}, not a ${c.endsWithKind}`);
      }

      // Order between concepts, when one genuinely requires the other.
      for (const [earlier, later] of (c.ordered ?? [])) {
        const a = indexOf(subtopics, earlier), b = indexOf(subtopics, later);
        // Absent is not out of order — a ladder is allowed to scope differently.
        if (a >= 0 && b >= 0 && a > b) problems.push(`"${later}" comes before "${earlier}"`);
      }

      for (const bad of (c.banned ?? [])) {
        const at = indexOf(subtopics, bad);
        if (at >= 0) problems.push(`step ${at + 1} is filler: "${subtopics[at]}"`);
      }

      if (c.minSteps && subtopics.length < c.minSteps) problems.push(`only ${subtopics.length} steps`);
      if (c.maxSteps && subtopics.length > c.maxSteps) problems.push(`${subtopics.length} steps is a syllabus, not a ladder`);

      // Every step should say what it unlocks. A blank whyNow means the model
      // ordered the list without justifying the order, which is the shape the
      // whole change was meant to prevent.
      const unexplained = map.filter((m) => !m.whyNow).length;
      if (unexplained > Math.floor(map.length / 3)) {
        problems.push(`${unexplained} of ${map.length} steps say nothing about what they unlock`);
      }

      return {
        passed: problems.length === 0,
        expected: c.startsBefore?.length
          ? `starts before ${c.startsBefore.slice(0, 2).join(" / ")}`
          : (c.endsWithKind ? `ends in ${c.endsWithKind}` : "a teachable ladder"),
        actual: `1. ${first}${subtopics.length > 1 ? ` … ${subtopics.length}. ${subtopics[subtopics.length - 1]}` : ""}`,
        detail: problems.length ? problems.join("; ") : subtopics.map((t, i) => `${i + 1}. ${t}`).join("  |  "),
      };
    },
  })),
};
