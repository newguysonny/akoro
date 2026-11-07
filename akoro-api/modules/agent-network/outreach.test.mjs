import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { OUTREACH, KIND_FOR_PURPOSE, decideOutreach, outreachQuestion, outreachLearnerText } from "./outreachCore.js";

const read = (f) => readFile(new URL(f, import.meta.url), "utf8");
const friend = { userId: "f", isFriend: true }, optedIn = { userId: "o", optedIn: true }, stranger = { userId: "s" };

test("a study question to a friend or an opted-in learner goes without asking", () => {
  assert.deepEqual(decideOutreach({ target: friend }), { action: "send", reason: "friend" });
  assert.deepEqual(decideOutreach({ target: optedIn }), { action: "send", reason: "opted_in" });
});

test("a stranger, a younger learner, or anything but a study question asks the learner first", () => {
  assert.deepEqual(decideOutreach({ target: stranger }), { action: "ask_learner", reason: "stranger" });
  assert.deepEqual(decideOutreach({ target: friend, protectedLearner: true }), { action: "ask_learner", reason: "younger_learner" });
  for (const purpose of ["friend_request", "battle_invite", "share_data"]) assert.equal(decideOutreach({ purpose, target: friend }).action, "ask_learner", purpose);
});

test("never: blocked, past the daily cap, Offline, quiet hours, no helper, unknown purpose", () => {
  assert.equal(decideOutreach({ target: { ...friend, blocked: true } }).reason, "blocked");
  assert.equal(decideOutreach({ target: friend, sentToday: OUTREACH.PER_DAY }).reason, "daily_cap");
  assert.equal(decideOutreach({ target: friend, sentToday: OUTREACH.PER_DAY - 1 }).action, "send");
  assert.equal(decideOutreach({ target: friend, agentOnline: false }).reason, "agent_offline");
  assert.equal(decideOutreach({ target: friend, quiet: true }).reason, "quiet_hours");
  assert.equal(decideOutreach({ target: {} }).reason, "no_helper");
  assert.equal(decideOutreach({ purpose: "send_money", target: friend }).reason, "unknown_purpose");
  assert.equal(OUTREACH.PER_DAY, 3);
});

test("the question carries no personal detail and fits a message", () => {
  const q = outreachQuestion({ topic: "Stoichiometry", gaps: ["mole ratios"] });
  assert.match(q, /stuck on Stoichiometry \(especially mole ratios\)/);
  assert.ok(q.length >= 10 && q.length <= 400);
  assert.match(outreachQuestion({ trigger: "topic_start", topic: "Osmosis" }), /starting Osmosis/);
  assert.match(outreachQuestion({ purpose: "friend_request", topic: "Osmosis" }), /study friends/);
  assert.equal(KIND_FOR_PURPOSE.study_question, "consult");
  assert.equal(KIND_FOR_PURPOSE.friend_request, "friend_request");
});

test("what the learner is told", () => {
  assert.match(outreachLearnerText({ action: "send", helperName: "Tega", topic: "Osmosis" }), /asked Tega's agent/);
  assert.match(outreachLearnerText({ action: "ask_learner", helperName: "Tega", topic: "Osmosis" }), /Shall I ask their agent/);
  assert.match(outreachLearnerText({ helperName: "Tega", topic: "Osmosis", answer: "Draw it." }), /They said: “Draw it\.”/);
});

test("wiring: messages record origin/trigger/purpose; answers come back; Allow sends; triggers fire", async () => {
  assert.match(await read("./messaging.js"), /input\.origin === "agent" \? \{ origin: "agent", trigger/);
  assert.match(await read("./autoReply.js"), /m\.origin === "agent"\) import\("\.\/outreach\.js"\)\.then\(\(o\) => o\.reportOutreachAnswer/);
  assert.match(await read("./friends.js"), /m\.origin === "agent"\) await import\("\.\/outreach\.js"\)/);
  assert.match(await read("../agent-proposals/inbox.js"), /kind === "agent_outreach"[\s\S]{0,200}approveOutreach\(userId, payload\)/);
  assert.match(await read("../autonomy/deliver.js"), /case "agent_outreach"/);
  assert.match(await read("../adaptive-learning/struggles.js"), /opened\?\.status === "opened" && event\.conceptId && !struggleType\(fx\.type\)\?\.sensitive/);
  assert.match(await read("../adaptive-learning/study-prep/wiring.js"), /trigger: "topic_start", purpose: "study_question"[^\n]*friendsOnly: true/);
  const sql = await read("../../migrations/2026-agent-outreach.sql");
  assert.match(sql, /'agent_outreach'/);
  assert.match(sql, /origin IN \('learner', 'agent'\)/);
  assert.match(await read("../../migrations/manifest.json"), /2026-agent-outreach\.sql/);
});
