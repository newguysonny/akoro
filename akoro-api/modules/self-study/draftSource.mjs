/**
 * modules/self-study/draftSource.mjs — test support only.
 *
 * Phase 19 step 4 split drafts.js into draft-*.js layers. The contract tests
 * that pin draft behaviour read the whole split source, so an assertion pinned
 * anywhere in the layers is still asserted without naming each file.
 */
import { readFile } from "node:fs/promises";

const LAYERS = [
  "draft-rules.js", "draft-store.js", "draft-audience.js", "draft-plan.js",
  "draft-model.js", "draft-questions.js", "draft-create.js", "draft-records.js",
  "draft-revise.js", "draft-history.js", "draft-assign.js", "draft-edits.js",
];

export async function readDraftSource() {
  const parts = await Promise.all(LAYERS.map((f) => readFile(new URL(`./${f}`, import.meta.url), "utf8")));
  return parts.join("\n");
}

export const readDraftLayer = (file) => readFile(new URL(`./${file}`, import.meta.url), "utf8");
