/**
 * modules/self-study/routesSource.mjs — test support only.
 *
 * Phase 19 step 4 split routes.js into routes → service → rules → store. The
 * contract tests that pin route wiring read the router AND every layer, so a
 * behaviour pinned anywhere in the split is still asserted. `readLayer` is for
 * tests that slice one service in isolation.
 */
import { readFile } from "node:fs/promises";

const LAYERS = [
  "routes.js", "rules.js", "http.js", "service-common.js",
  "service-activities.js", "service-drafts.js", "service-files.js",
  "service-grading.js", "service-learner.js", "service-mine.js",
  "store-assignments.js", "store-people.js",
];

export async function readRoutesSource() {
  const parts = await Promise.all(LAYERS.map((f) => readFile(new URL(`./${f}`, import.meta.url), "utf8")));
  return parts.join("\n");
}

export const readLayer = (file) => readFile(new URL(`./${file}`, import.meta.url), "utf8");
