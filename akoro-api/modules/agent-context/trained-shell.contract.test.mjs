import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * TRAINED_SHELL composition contract (Context Layer Adoption mini-plan P2b).
 *
 * The plan's rule: trained agents compose agents/TRAINED_SHELL.md + shared
 * doctrine FIRST, then the DB-configured teacher style + pgvector chunks —
 * "the context layer composes platform doctrine AROUND a teacher's own
 * style, never replaces it" (D3). This pins the order and that teacher-
 * specific content still comes only from the DB.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const builder = await read("../adaptive-learning/training/agentPromptBuilder.js");
const guide = await read("../adaptive-learning/agents/trained/guide.js");
const control = await read("../adaptive-learning/agents/trained/control.js");
const { trainedShell } = await import("./personas/trained.js");

test("trained prompts compose the platform shell FIRST, then the teacher's DB-configured style", async () => {
  const shellText = await trainedShell();
  assert.ok(shellText.length > 200, "the shell is real doctrine, not a stub");
  assert.match(shellText, /trained AI ensemble/, "the shell names what a trained agent is");
  assert.match(shellText, /teacher's own material|their own material/, "the shell defers to the teacher's training");
  // Every session-loop builder: shell + "\n\n" + template — shell BEFORE the
  // template, so platform doctrine opens the prompt and the teacher's style
  // sits inside it. (The "\n\n" is the literal two-character escape in the
  // source, matched via char codes to avoid regex-escape confusion.)
  const NLNL = String.fromCharCode(92, 110, 92, 110);
  for (const call of ["buildTrainedGuideTipPrompt", "buildTrainedControlDriftPrompt", "buildTrainedStudentReplyPrompt"]) {
    const needle = `(await trainedShell()) + "${NLNL}" + await ${call}`;
    assert.ok(builder.includes(needle), `${call} must compose the shell first`);
  }
  // The teacher's own voice still comes only from the DB config (D3) — the
  // defaults are DB-fallbacks in code, the content is never hardcoded.
  assert.match(builder, /pi\.guidePrefix \|\| "You are a teaching guide\."/, "guide prefix stays DB-configured");
  assert.match(builder, /gc\.topAnalogies/, "analogies stay DB-configured");
  assert.match(builder, /cc\.redirectPhrases/, "redirect phrases stay DB-configured");
  assert.match(builder, /pi\.studentPrefix/, "student prefix stays DB-configured");
  // The style section lives in the template, after the shell opening.
  const guideTip = await read("../../akoro-agent/agents/trained/GUIDE_TIP.md");
  assert.match(guideTip, /## Your teaching style for this teacher/);
});

test("single-source: the trained prompt literals exist only as workspace templates", () => {
  for (const [name, source] of [["builder", builder], ["guide", guide], ["control", control]]) {
    assert.doesNotMatch(source, /You are a curriculum expert/, `${name}: must-know literal remains`);
    assert.doesNotMatch(source, /Define ON-topic and OFF-topic/, `${name}: boundary literal remains`);
    assert.doesNotMatch(source, /Evaluate this teaching session/, `${name}: evaluate-session literal remains`);
    assert.doesNotMatch(source, /Tips are 1-2 sentences max/, `${name}: guide rules literal remains`);
    assert.doesNotMatch(source, /Classify the conversation/, `${name}: control contract literal remains`);
    assert.doesNotMatch(source, /How to respond based on understanding/, `${name}: student ladder literal remains`);
    assert.doesNotMatch(source, /nextAction: DIG_DEEPER/, `${name}: decide contract literal remains`);
  }
  assert.match(builder, /personas\/trained\.js/, "the builder loads the trained seam");
  assert.match(guide, /personas\/trained\.js/, "guide loads the trained seam");
  assert.match(control, /personas\/trained\.js/, "control loads the trained seam");
});
