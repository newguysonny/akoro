import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
const { pendingStrategyOffer, documentsPlanLabel } = await import("./harness.js");
const { getStrategy } = await import("../strategies/library.js");
const read = (f) => readFile(new URL(f, import.meta.url), "utf8");

const topics = [{ id: "t1", status: "intervention_required" }, { id: "t2", status: "understood" }];
const offered = (topic, strategy, extra = {}) => ({ decision_node: "strategy_offered", topic_id: topic, facts: { strategy, ...extra } });

test("the open offer: the latest offer on an in-progress topic, not yet answered", () => {
  const o = pendingStrategyOffer([offered("t1", "space_out")], topics, getStrategy);
  assert.equal(o.strategy, "space_out");
  assert.equal(o.topicId, "t1");
  assert.equal(o.operation, "schedule");
  assert.match(o.allowDoes, /short reviews/);
});

test("answered or finished: no offer", () => {
  assert.equal(pendingStrategyOffer([offered("t1", "space_out", { accepted: true })], topics, getStrategy), null, "accepted");
  assert.equal(pendingStrategyOffer([offered("t1", "space_out"), { decision_node: "strategy_declined", topic_id: "t1", facts: { strategy: "space_out" } }], topics, getStrategy), null, "rejected");
  assert.equal(pendingStrategyOffer([offered("t2", "space_out")], topics, getStrategy), null, "topic already understood");
  assert.equal(pendingStrategyOffer([offered("t1", "made_up")], topics, getStrategy), null, "off the library");
});

test("a teaching strategy says it runs in the next lesson", () => {
  assert.match(pendingStrategyOffer([offered("t1", "teach_back")], topics, getStrategy).allowDoes, /teaching session/);
});

test("the files label never passes the outline off as the school's syllabus", () => {
  assert.equal(documentsPlanLabel({ material_record_ids: ["a", "b", "c"] }), "Outline drawn from your files (3 files). Not your school's official syllabus.");
  assert.equal(documentsPlanLabel({}), "Outline drawn from your files. Not your school's official syllabus.");
});

test("wiring: the route's Reject records a decline; the card answers with Allow / Reject / Later", async () => {
  const [routes, session, io, card] = await Promise.all([read("./routes.js"), read("./harness-session.js"), read("./harness-io.js"), read("../../../../akoro-learner/src/components/tabs/studyPrep/StudyPrepChatCard.jsx")]);
  assert.match(routes, /req\.body\?\.accepted === false[\s\S]*declineStrategy\(/);
  assert.match(session, /decisionNode: "strategy_declined"/);
  assert.match(io, /view\.strategyOffer = offer/);
  assert.match(card, /<ApprovalButtons onAllow=\{\(\) => answerOffer\(true\)\} onReject=\{\(\) => answerOffer\(false\)\}/);
  assert.match(card, /syllabusLabelKind === 'documents' \? 'ti-folder'/);
});
