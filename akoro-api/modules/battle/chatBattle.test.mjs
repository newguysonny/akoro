// Battles from chat: a learner's class/course battle (battle/chatBattle.js),
// network repeats (seriesCore.js), and the chat tools that reach them.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readDraftSource } from "../self-study/draftSource.mjs";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-openai-key";
const { pickPlace } = await import("./chatBattle.js");
const { leadOf, seriesCardType, SERIES, seriesTemplate, NETWORK_KEYS } = await import("./seriesCore.js");
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");

test("pickPlace: by id, by a name that matches one, the only one, or not at all", () => {
  const classes = [{ id: "a", name: "JSS 1A" }, { id: "b", name: "JSS 2" }, { id: "c", name: "SS1 Science" }];
  assert.equal(pickPlace(classes, { id: "b" }).id, "b");
  assert.equal(pickPlace(classes, { name: "jss1a" }).id, "a");
  assert.equal(pickPlace(classes, { name: "science" }).id, "c");
  assert.equal(pickPlace(classes, { name: "JSS" }), "ambiguous");
  assert.equal(pickPlace(classes, { name: "Basic 5" }), null);
  assert.equal(pickPlace(classes, {}), null, "more than one and none named: ask");
  assert.equal(pickPlace([classes[1]], {}).id, "b", "the only class");
});

test("network series: a post goes up 12 hours ahead, an invite an hour; cards show the format", () => {
  assert.equal(leadOf({ scope: "network", template: { post: true } }), SERIES.POST_LEAD_MS);
  assert.equal(leadOf({ scope: "network", template: { kind: "1v1" } }), SERIES.LEAD_MS);
  assert.equal(leadOf({ scope: "class", template: {} }), SERIES.LEAD_MS);
  assert.equal(seriesCardType({ scope: "network", template: { post: true, kind: "group" } }, 1, false), "open");
  assert.equal(seriesCardType({ scope: "network", template: { kind: "team" } }, 4, false), "team");
  assert.equal(seriesCardType({ scope: "network", template: { kind: "group" } }, 4, false), "classroom");
  assert.equal(seriesCardType({ scope: "class", template: {} }, 2, false), "1v1");
  assert.equal(seriesCardType({ scope: "class", template: {} }, 2, true), "classroom", "a teacher hosts: never a duel");
  const t = seriesTemplate({ subject: "Maths", kind: "team", teams: { x: "A" }, repeat: { days: [1] }, opponents: ["@a"] }, NETWORK_KEYS);
  assert.deepEqual(t, { subject: "Maths", kind: "team", teams: { x: "A" } }, "the rule and the people are not template");
});

test("chat: every battle tool takes repeat; class_battle is a side effect and routes through the invite route", async () => {
  const chat = await read("../adaptive-learning/chat.js");
  const core = await read("../adaptive-learning/chat/tool-catalogue-core.js");
  const rest = await read("../adaptive-learning/chat/tool-catalogue-rest.js");
  for (const tool of ["challenge_agent", "post_challenge_request", "class_battle"]) {
    const def = core.slice(core.indexOf(`name: "${tool}"`), core.indexOf(`name: "${tool}"`) + 2500);
    assert.match(def, /repeat: REPEAT_SCHEMA/, `${tool} takes repeat`);
  }
  assert.match(chat, /"challenge_agent", "class_battle", "post_challenge_request"/);
  assert.match(rest, /battle_format: \{ type: "string", enum: \["battle", "review"\]/, "instructor drafts say battle or review");
  const mod = await read("./chatBattle.js");
  assert.match(mod, /occurrenceHandlers\.classInvite/);
  const drafts = await readDraftSource();
  assert.match(drafts, /if \(patch\.series_id\) updates\.series_id = patch\.series_id;/, "a recurring battle draft records its series");
});
