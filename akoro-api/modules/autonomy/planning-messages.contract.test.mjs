import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// planningMessages is pure, but cycle.js imports the db: read the source for the wiring,
// and exercise the function where the env allows.
const cycle = await readFile(new URL("./cycle.js", import.meta.url), "utf8");

test("the planner's gather reads what the agent knows — with consent, nothing sensitive", () => {
  assert.match(cycle, /const learnFromChats = autonomyRow\?\.learn_from_chats !== false;/);
  assert.match(cycle, /learnFromChats \? await Promise\.all\(\[/, "notes and summaries only with consent");
  assert.match(cycle, /memories: memories\.filter\(\(m\) => !isSensitive\(m\.content\)\)/);
  assert.match(cycle, /!\/\^Latest learner request:\/\.test\(t\) && !isSensitive\(t\)/);
  for (const src of ["learner_concept_state", "decay_notifications", 'from("records")', "user_settings"]) assert.ok(cycle.includes(src), src);
  assert.match(cycle, /days_left: g\.target_date \?/);
  // the resolver returns { timeZone, source } — the planner takes the name
  assert.match(cycle, /resolveLearnerTimeZone\(\{ configuredTimeZone: settingsRow\?\.settings\?\.timezone \}\)\.timeZone \|\| LAGOS/);
});

test("the learner's words go in as data; the platform pays; the learner's time zone is used", () => {
  assert.match(cycle, /untrusted\(said, \{ source: "the learner's own words and notes", limit: 4000 \}\)/);
  assert.match(cycle, /UNTRUSTED_SYSTEM_RULE;/);
  assert.match(cycle, /never mention health, feelings, family or money/);
  assert.match(cycle, /Now \(\$\{tz\}\): /);
  assert.match(cycle, /__payer: "platform", __feature: "agent_autonomy"/);
});
