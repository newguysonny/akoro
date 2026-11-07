import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AUTO, decide, isProtectedLearner, learnerText, proposalFor } from "./autoReplyCore.js";

const read = (f) => readFile(new URL(f, import.meta.url), "utf8");

test("policy: study questions answered on their own by default; 'off' asks", () => {
  assert.equal(decide({ kind: "consult" }), "auto_answer");
  assert.equal(decide({ kind: "consult", setting: "off" }), "ask_learner");
  assert.equal(decide({ kind: "consult", hasAnswer: true }), "tell_learner", "answered live on arrival: just tell the learner");
});

test("policy: friendly chat only with study_chat, never for protected learners", () => {
  assert.equal(decide({ kind: "chat" }), "ask_learner", "default 'study' asks");
  assert.equal(decide({ kind: "chat", setting: "study_chat" }), "auto_answer");
  assert.equal(decide({ kind: "chat", setting: "study_chat", protectedLearner: true }), "ask_learner");
});

test("policy: a friend request is ALWAYS the learner's decision; ideas are just told", () => {
  for (const setting of AUTO.SETTINGS) assert.equal(decide({ kind: "friend_request", setting }), "ask_learner");
  assert.equal(decide({ kind: "suggestion" }), "tell_learner");
  assert.equal(decide({ kind: "invite" }), "skip");
  assert.equal(decide({ kind: "buddy_checkin" }), "skip");
});

test("no loops: past the per-pair daily cap, the agent asks instead of answering", () => {
  assert.equal(decide({ kind: "consult", autoToday: AUTO.MAX_AUTO_PER_PAIR_PER_DAY - 1 }), "auto_answer");
  assert.equal(decide({ kind: "consult", autoToday: AUTO.MAX_AUTO_PER_PAIR_PER_DAY }), "ask_learner");
  assert.equal(decide({ kind: "chat", setting: "study_chat", autoToday: 9 }), "ask_learner");
});

test("protected learners: primary and JSS levels", () => {
  for (const level of ["JSS 1", "jss3", "Primary 6", "Junior Secondary", "Basic 7"]) assert.equal(isProtectedLearner({ studyLevel: level }), true, level);
  for (const level of ["SS2", "SSS 3", "University", ""]) assert.equal(isProtectedLearner({ studyLevel: level }), false, level);
});

test("the card text: 'Tega just sent me a message — Tega wants to be friends'", () => {
  const t = learnerText({ action: "ask_learner", kind: "friend_request", fromName: "Tega", body: "Hi! We'd like to be friends." });
  assert.match(t, /^Tega just sent me a message — Tega wants to be friends\./);
  assert.match(t, /Would you like us to be friends\?$/);
  const p = proposalFor({ kind: "friend_request", messageId: "m1", fromName: "Tega" });
  assert.deepEqual([p.kind, p.yes, p.payload.messageId], ["agent_friend", "Be friends", "m1"]);
  const r = proposalFor({ kind: "chat", messageId: "m2", fromName: "Tega", draft: "Hi Tega!" });
  assert.deepEqual([r.kind, r.payload.draft], ["agent_reply", "Hi Tega!"]);
});

test("wiring: arrival, coming online and the Online switch wake the inbox; approvals go through the proposal door", async () => {
  const [messaging, network, chat, inbox, app, migration] = await Promise.all([
    read("./messaging.js"), read("./network.js"), read("../adaptive-learning/chat.js"), read("../agent-proposals/inbox.js"),
    read("../../app.js"), read("../../migrations/2026-agent-conversations.sql"),
  ]);
  assert.match(messaging, /m\.wakeInbox\(target\.id, "message"\)/);
  assert.match(network, /m\.wakeInbox\(userId, "online"\)/);
  assert.match(chat, /m\.wakeInbox\(req\.user\.id, "switched_on"\)/);
  assert.match(inbox, /kind === "agent_friend"/);
  assert.match(inbox, /kind === "agent_reply"/);
  assert.match(inbox, /declineMessage\(userId, prop\.payload\?\.messageId\)/);
  assert.match(app, /startAgentInboxWorker\(\)/);
  assert.match(migration, /'chat', 'friend_request'/);
  assert.match(migration, /'agent_friend','agent_reply'/);
  assert.match(chat, /enum: \["consult", "suggestion", "chat", "friend_request"\]/);
});
