/**
 * Grand Plan Phase 4 + 5 exit gates.
 *
 *   context.sets_per_operation   (read) every workflow operation resolves to
 *     its §7.4 manifest set on the deployed build: right files, in order,
 *     within budget; the boot preflight is green.
 *   studyprep.inline_full        (write) a whole Study Prep session without
 *     Teaching: plan → a missed diagnostic → an inline strategy → teach-back
 *     → retest passed → next topic passed → completed. A second submit of the
 *     same practice is refused (submit-status guard).
 *   studyprep.plan_rejection     (write) each hard plan rule is a recorded
 *     rejection that changes nothing; the valid plan then reaches the card;
 *     the learner turning it down costs nothing.
 *   studyprep.budget_ceiling     (write) with the approved coins spent, the
 *     agent's next check is refused (over_estimate) and nothing is charged;
 *     "Approve more" lets it go on.
 *   studyprep.cap_out            (write) a topic missed to its attempt cap is
 *     capped out, takes no more practice, is deferred once, retried once with
 *     attempts reset, and a second deferral is refused.
 *
 * The write scenarios drive the harness (the human-answered practice, so no
 * Agent Check battle and no agent wake runs) on their own test learner, read
 * the answer keys from the attempt rows, and remove the session and its runs.
 */

const SUBJECT = "Basic Science";
const CLASS = "JSS3";
const BOARD = "BECE";

const rejected = async (fn) => { try { await fn(); return null; } catch (e) { return e?.code || e?.message || "error"; } };

/** A fresh session for this learner (stale gate sessions removed, an active one cancelled). */
async function freshSession(ctx, p, harness) {
  const me = await ctx.as(p.learner);
  await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: "[verify:%" } } });
  const active = await ctx.http({ as: p.learner, path: "/api/adaptive/study-prep/sessions" });
  if (active.body?.session?.id) await harness.cancelSession({ sessionId: active.body.session.id, learnerId: me.id }).catch(() => {});
  ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));
  const session = await harness.createSession({ learnerId: me.id, goal: `${ctx.marker} Revise ${SUBJECT}`, subject: SUBJECT, classLevel: CLASS, examBoard: BOARD });
  const syllabus = await harness.resolveSyllabus({ sessionId: session.id, learnerId: me.id });
  return { me, session, s: { sessionId: session.id, learnerId: me.id }, topics: syllabus.found ? syllabus.topics : [] };
}

/** Two syllabus topics in an order the prerequisites allow. */
async function validPair(harness, s, topics) {
  const pair = topics.slice(0, 2).map((t) => t.id);
  if ((await harness.validateProposedPlan({ ...s, topicIds: pair })).ok) return pair;
  return pair.reverse();
}

/** The open attempt's answers: all right, or all wrong. */
async function answersFor(ctx, runId, { right }) {
  const [open] = await ctx.db.rows("edu.learner_exam_prep_attempts", { run_id: runId }, { columns: "attempt_number, answer_key, submitted_at", limit: 1, order: { column: "attempt_number", ascending: false } });
  if (!open?.answer_key || open.submitted_at) ctx.expect.blocked(`no open attempt with an answer key on run ${runId}`);
  return Object.entries(open.answer_key).map(([questionId, a]) => ({ questionId, answerIndex: right ? Number(a) : (Number(a) + 1) % 4 }));
}

const decisionNodes = async (ctx, sessionId) => (await ctx.db.rows("edu.study_prep_events", { session_id: sessionId }, { columns: "event_type, decision_node, facts", limit: 300, order: { column: "sequence", ascending: true } }));

/** Starts a practice; a tester who can't afford it is a missing precondition. */
async function practice(ctx, harness, args) {
  try { return await harness.startTopicPractice(args); } catch (e) {
    if (e?.code === "insufficient_balance") ctx.expect.blocked("the test learner can't afford a practice");
    throw e;
  }
}

export const setsPerOperation = {
  name: "context.sets_per_operation", area: "agent-context", risk: "read",
  description: "Every workflow operation (planning, strategy selection, teaching turns, decay, practice) loads its own manifest set on this build — the right files in order, within budget — and the context preflight is green.",
  async run(ctx) {
    const { contextSetFor, loadContext, preflight, CONTEXT_MANIFEST, CONTEXT_BUDGET } = await import("../../agent-context/index.js");
    const { operationRows } = await import("../../agent-context/index.js");
    const report = await preflight();
    ctx.note(`context version ${report.version}; ${report.sets.length} sets`);
    ctx.expect.ok("context preflight is green", report.ok, report.problems);
    ctx.expect.eq("planning loads planning", contextSetFor("study_prep", "planning"), "planning");
    ctx.expect.eq("strategy selection loads strategies", contextSetFor("study_prep", "strategy_selection"), "strategies");
    ctx.expect.eq("a teach_agent turn loads teaching_controller", contextSetFor("teaching", "turn:teach_agent"), "teaching_controller");
    ctx.expect.eq("a learn_with_guide turn loads guide_controller", contextSetFor("teaching", "turn:learn_with_guide"), "guide_controller");
    const rows = operationRows();
    const bad = [];
    for (const { workflow, operation, set } of rows) {
      const loaded = await loadContext(contextSetFor(workflow, operation));
      const same = JSON.stringify(loaded.files) === JSON.stringify([...CONTEXT_MANIFEST[set].files]);
      if (!same || Buffer.byteLength(loaded.system) > CONTEXT_BUDGET.MAX_CONTEXT_BYTES) bad.push(`${workflow}.${operation}→${set}`);
    }
    ctx.note(`${rows.length} operations, live: ${rows.filter((r) => r.live).map((r) => `${r.workflow}.${r.operation}`).join(", ")}`);
    ctx.expect.eq("every operation loads its whole set within budget", bad.length, 0);
    const unknown = await rejected(() => loadContext("not_a_set"));
    ctx.expect.eq("an unknown set is context_unavailable", unknown, "context_unavailable");
  },
};

export const inlineFull = {
  name: "studyprep.inline_full", area: "study-prep", risk: "write", timeoutMs: 300_000,
  description: "A whole Study Prep session without Teaching: plan, a missed diagnostic, an inline strategy, the teach-back, a passed retest, the next topic passed, completed — a second submit of the same practice is refused.",
  params: { learner: { default: "@tester46" } },
  async run(ctx, p) {
    const { getPracticeHarness } = await import("../../adaptive-learning/index.js");
    const harness = getPracticeHarness();
    const { me, session, s, topics } = await freshSession(ctx, p, harness);
    if (topics.length < 2) ctx.expect.blocked(`no ${CLASS} ${SUBJECT} syllabus with two topics to plan from`);
    const runs = new Set();
    ctx.cleanup(async () => { for (const id of runs) await ctx.db.deleteOwned("edu.learner_exam_prep_runs", { ownerColumn: "learner_id", ownerId: me.id, filters: { id } }); });

    await harness.proposePlan({ ...s, topicIds: await validPair(harness, s, topics) });
    const { topics: planned } = await harness.confirmPlan(s);
    const [a, b] = planned;

    const first = await practice(ctx, harness, { ...s, topicId: a.id, mode: "diagnostic" });
    runs.add(first.run.id);
    const missed = await harness.submitPractice({ ...s, topicId: a.id, answers: await answersFor(ctx, first.run.id, { right: false }) });
    ctx.expect.eq("a missed diagnostic offers a retest (the topic stays active)", `${missed.outcome}/${missed.topic.status}`, "retest_offered/active");
    const twice = await rejected(() => harness.submitPractice({ ...s, topicId: a.id, answers: [{ questionId: "q", answerIndex: 0 }] }));
    ctx.expect.eq("the same practice submitted again is refused", twice, "invalid_state_transition");

    const offered = await harness.offerStrategy({ ...s, topicId: a.id, strategy: "different_analogy", intent: "Re-explain it with an everyday example." });
    ctx.expect.eq("an inline strategy from the library", offered.strategy, "different_analogy");
    ctx.expect.eq("no retest before the teach-back", await rejected(() => harness.startTopicPractice({ ...s, topicId: a.id, mode: "retest" })), "teach_back_gate");
    await harness.confirmTeachBack({ ...s, topicId: a.id });
    const retest = await practice(ctx, harness, { ...s, topicId: a.id, mode: "retest" });
    runs.add(retest.run.id);
    const passed = await harness.submitPractice({ ...s, topicId: a.id, answers: await answersFor(ctx, retest.run.id, { right: true }) });
    ctx.expect.eq("the retest passes: understood", passed.outcome, "understood");

    const next = await harness.advanceTopic({ ...s, intent: "First topic settled." });
    ctx.expect.eq("the next topic is active", next.topic.id, b.id);
    const second = await practice(ctx, harness, { ...s, topicId: b.id, mode: "diagnostic" });
    runs.add(second.run.id);
    const b2 = await harness.submitPractice({ ...s, topicId: b.id, answers: await answersFor(ctx, second.run.id, { right: true }) });
    ctx.expect.eq("second topic understood", b2.outcome, "understood");
    const done = await harness.concludeSession({ ...s, intent: "Both topics settled." });
    ctx.expect.eq("the session completes", done.session.status, "completed");
    ctx.expect.eq("…with both topics understood", done.summary?.understood, 2);

    const events = await decisionNodes(ctx, session.id);
    const nodes = events.map((e) => e.decision_node).filter(Boolean);
    ctx.note(`decisions: ${nodes.join(" → ")}`);
    for (const node of ["plan_validated", "plan_confirmed", "strategy_offered", "teach_back_confirmed", "topic_started", "session_concluded"]) {
      ctx.expect.ok(`${node} is on the stream`, nodes.includes(node));
    }
    ctx.expect.eq("three practices generated", nodes.filter((n) => n === "practice_generated").length, 3);
    ctx.expect.ok("the second submit is a recorded rejection", events.some((e) => e.decision_node === "harness_rejection" && e.facts?.code === "invalid_state_transition"));
    const [row] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "status, workflow_id", limit: 1 });
    if (row?.workflow_id) {
      ctx.expect.eq("no Teaching workflow was created", await ctx.db.count("edu.workflow_instances", { parent_workflow_id: row.workflow_id }), 0);
    }
    const debits = (await ctx.db.rows("coin_transactions", { ref: `study_prep:${session.id}` }, { columns: "delta, type, feature", limit: 50 })).filter((t) => t.type === "debit");
    ctx.expect.eq("charged once per practice", debits.filter((t) => t.feature === "study_prep_practice").length, 3);
  },
};

export const planRejection = {
  name: "studyprep.plan_rejection", area: "study-prep", risk: "write",
  description: "A plan that breaks a hard rule (prerequisites, not in the syllabus, a duplicate, more than 12 topics) is a recorded rejection that changes nothing; the valid plan then reaches the card, and turning it down costs nothing.",
  params: { learner: { default: "@tester49" } },
  async run(ctx, p) {
    const { getPracticeHarness } = await import("../../adaptive-learning/index.js");
    const { prerequisiteEdges } = await import("../../adaptive-learning/index.js");
    const harness = getPracticeHarness();
    const { session, s, topics } = await freshSession(ctx, p, harness);
    if (topics.length < 2) ctx.expect.blocked(`no ${CLASS} ${SUBJECT} syllabus with two topics to plan from`);
    const ids = topics.map((t) => t.id);

    const cases = [
      [[ids[0], "00000000-0000-4000-8000-000000000000"], "topic_not_in_syllabus"],
      [[ids[0], ids[0]], "duplicate_topic"],
      [Array.from({ length: 13 }, (_, i) => ids[i % ids.length]), "plan_too_large"],
    ];
    const edges = (await prerequisiteEdges({ subject: SUBJECT }).catch(() => [])).filter((e) => ids.includes(e.before) && ids.includes(e.after));
    if (edges.length) cases.unshift([[edges[0].after, edges[0].before], "prerequisite_violation"]);
    else ctx.note("no prerequisite edge between two planned topics on this database — prerequisite_violation is covered by the contract test");
    for (const [topicIds, code] of cases) {
      ctx.expect.eq(`${code} is refused`, await rejected(() => harness.proposePlan({ ...s, topicIds, intent: "gate" })), code);
    }
    const [still] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "status, plan", limit: 1 });
    ctx.expect.eq("a refused plan changes nothing", `${still?.status}/${!still?.plan || (Array.isArray(still.plan) && still.plan.length === 0)}`, "planning/true");
    const events = await decisionNodes(ctx, session.id);
    const codes = events.filter((e) => e.decision_node === "harness_rejection").map((e) => e.facts?.code);
    ctx.expect.eq("each refusal is on the stream (a red verification row)", JSON.stringify(codes), JSON.stringify(cases.map(([, c]) => c)));

    const ok = await harness.proposePlan({ ...s, topicIds: await validPair(harness, s, topics), intent: "A valid order." });
    ctx.expect.eq("the valid plan reaches the card", ok.session.status, "awaiting_confirmation");
    ctx.expect.ok("…with its coin estimate", Number(ok.estimate?.totalCoins) > 0, ok.estimate);
    await harness.cancelSession(s);
    const charged = await ctx.db.count("coin_transactions", { ref: `study_prep:${session.id}` });
    ctx.expect.eq("turning the plan down costs nothing", charged, 0);
  },
};

export const budgetCeiling = {
  name: "studyprep.budget_ceiling", area: "study-prep", risk: "write",
  description: "With the coins the learner approved already spent, the agent's next check is refused (over_estimate) and nothing is charged; 'Approve more' lets it go on.",
  params: { learner: { default: "@tester48" } },
  async run(ctx, p) {
    const { getPracticeHarness } = await import("../../adaptive-learning/index.js");
    const { supabaseStore } = await import("../../adaptive-learning/index.js");
    const harness = getPracticeHarness();
    const { me, session, s, topics } = await freshSession(ctx, p, harness);
    if (!topics.length) ctx.expect.blocked(`no ${CLASS} ${SUBJECT} syllabus to plan from`);
    await harness.proposePlan({ ...s, topicIds: [topics[0].id] });
    const { topics: planned } = await harness.confirmPlan(s);
    const [row] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "*", limit: 1 });
    const approved = Number(row?.estimate?.totalCoins) || 0;
    if (!approved) ctx.expect.blocked("the confirmed plan has no coin estimate");

    // The session's own spend up to the ceiling — what its wakes and checks would have charged.
    const ref = `study_prep:${session.id}`;
    let charge;
    try { charge = await supabaseStore.chargeCoins({ learnerId: me.id, coins: approved, feature: "study_prep_wake", ref }); } catch (e) {
      if (e?.code === "insufficient_balance") ctx.expect.blocked(`${p.learner} can't cover ${approved} coins`);
      throw e;
    }
    ctx.cleanup(() => supabaseStore.refundCoins({ charge, feature: "study_prep_wake", ref }));
    const spentRow = await harness.budgetFor(row);
    ctx.note(`approved ${spentRow.approved}, spent ${spentRow.spent}, left ${spentRow.left}`);
    ctx.expect.eq("the ceiling is reached", spentRow.withinEstimate, false);
    ctx.expect.eq("the agent's wake would ask first (0 decisions)", spentRow.wakeDecisions, 0);

    const before = await ctx.db.count("coin_transactions", { ref });
    const refused = await rejected(() => harness.startTopicPractice({ ...s, topicId: planned[0].id, mode: "diagnostic", withinEstimateOnly: true }));
    ctx.expect.eq("the agent's next check is refused", refused, "over_estimate");
    ctx.expect.eq("nothing charged past the ceiling", await ctx.db.count("coin_transactions", { ref }), before);
    const events = await decisionNodes(ctx, session.id);
    ctx.expect.ok("the refusal is on the stream", events.some((e) => e.decision_node === "harness_rejection" && e.facts?.code === "over_estimate"));
    const [topicRow] = await ctx.db.rows("edu.study_prep_topics", { id: planned[0].id }, { columns: "status, attempts_used", limit: 1 });
    ctx.expect.eq("the topic is untouched", `${topicRow?.status}/${topicRow?.attempts_used}`, "active/0");

    const more = await harness.approveMoreCoins(s);
    ctx.expect.eq("'Approve more' lets the agent go on", more.coins?.withinEstimate, true);
    ctx.expect.ok("coins_approved is on the stream", (await decisionNodes(ctx, session.id)).some((e) => e.decision_node === "coins_approved"));
    await harness.cancelSession(s);
  },
};

export const capOut = {
  name: "studyprep.cap_out", area: "study-prep", risk: "write", timeoutMs: 300_000,
  description: "A topic missed to its attempt cap is capped out and takes no more practice; it is deferred once and retried once with attempts reset, and a second deferral is refused.",
  params: { learner: { default: "@tester47" } },
  async run(ctx, p) {
    const { getPracticeHarness } = await import("../../adaptive-learning/index.js");
    const { examPrepPolicyFor } = await import("../../adaptive-learning/index.js");
    const harness = getPracticeHarness();
    const { me, session, s, topics } = await freshSession(ctx, p, harness);
    if (topics.length < 2) ctx.expect.blocked(`no ${CLASS} ${SUBJECT} syllabus with two topics to plan from`);
    const policy = await examPrepPolicyFor(BOARD, SUBJECT);
    const cap = Number(policy.max_attempts);
    if (!(cap >= 1 && cap <= 3)) ctx.expect.blocked(`attempt cap ${cap} — the gate runs at most 3 generations`);
    const runs = new Set();
    ctx.cleanup(async () => { for (const id of runs) await ctx.db.deleteOwned("edu.learner_exam_prep_runs", { ownerColumn: "learner_id", ownerId: me.id, filters: { id } }); });

    await harness.proposePlan({ ...s, topicIds: await validPair(harness, s, topics) });
    const { topics: planned } = await harness.confirmPlan(s);
    const t = planned[0].id;
    let last = null;
    for (let attempt = 1; attempt <= cap; attempt += 1) {
      if (attempt > 1) await harness.confirmTeachBack({ ...s, topicId: t });
      const started = await practice(ctx, harness, { ...s, topicId: t, mode: attempt === 1 ? "diagnostic" : "retest" });
      runs.add(started.run.id);
      last = await harness.submitPractice({ ...s, topicId: t, answers: await answersFor(ctx, started.run.id, { right: false }) });
    }
    ctx.expect.eq(`missed ${cap} time(s): capped out`, `${last?.outcome}/${last?.topic?.status}`, "capped_out/capped_out");
    ctx.expect.ok("no more practice on a capped topic", !!(await rejected(() => harness.startTopicPractice({ ...s, topicId: t, mode: "retest" }))));

    const deferred = await harness.deferTopic({ ...s, topicId: t, reasonCode: "attempt_cap_reached", intent: "Capped out — come back to it." });
    ctx.expect.eq("deferred", deferred.topic.status, "deferred");
    const retried = await harness.retryDeferredTopic({ ...s, topicId: t });
    ctx.expect.eq("the one retry re-queues it with attempts reset", `${retried.topic.status}/${retried.topic.attemptsUsed}/${retried.topic.deferredRetryUsed}`, "queued/0/true");
    ctx.expect.eq("a second deferral in the session is refused", await rejected(() => harness.deferTopic({ ...s, topicId: t })), "deferred_retry_used");
    const events = await decisionNodes(ctx, session.id);
    ctx.expect.eq("one engine result per attempt", events.filter((e) => e.event_type === "engine_result").length, cap);
    ctx.expect.ok("topic_deferred is on the stream", events.some((e) => e.decision_node === "topic_deferred"));
    await harness.cancelSession(s);
  },
};

/** The migration's precondition: the topic state machine and the submit function are on this database. */
const notMigrated = (e) => /study_prep_submit_attempt|teaching_workflow_id|study_prep_topics_state_check|violates check constraint|schema cache|does not exist/i.test(String(e?.message || e));

/**
 * Phase 5 §8.3 / D15: a missed topic goes intervention_required →
 * awaiting_teaching (request_teaching) → retest_ready (the teaching session's
 * end, through the real handoff completion path) → retest → understood.
 * The teaching session is finished at once (approve → bind → finish, no
 * socket). The plan's approved coins are set to 0 first so neither the
 * agent's wake nor the auto-start can start a check of its own meanwhile.
 */
export const topicStates = {
  name: "studyprep.topic_states", area: "study-prep", risk: "write", timeoutMs: 300_000,
  description: "A missed topic goes intervention_required → awaiting_teaching (request_teaching makes the teaching session) → retest_ready (its end, through the handoff) → retest → understood, each state on the topic row.",
  params: { learner: { default: "@tester50" } },
  async run(ctx, p) {
    const { getPracticeHarness, teachingHandoff } = await import("../../adaptive-learning/index.js");
    const harness = getPracticeHarness({ teaching: true });
    const { me, session, s, topics } = await freshSession(ctx, p, harness);
    if (!topics.length) ctx.expect.blocked(`no ${CLASS} ${SUBJECT} syllabus to plan from`);
    const [linked] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "workflow_id", limit: 1 });
    const wfId = linked?.workflow_id;
    if (!wfId) ctx.expect.blocked("the session has no workflow instance (workflow engine off?)");
    const runs = new Set();
    const rowsMade = [];
    ctx.cleanup(async () => {
      await harness.cancelSession(s).catch(() => {});
      for (const id of runs) await ctx.db.deleteOwned("edu.learner_exam_prep_runs", { ownerColumn: "learner_id", ownerId: me.id, filters: { id } });
      for (const id of rowsMade) await ctx.db.deleteOwned("edu.adaptive_sessions", { ownerColumn: "student_id", ownerId: me.id, filters: { id } });
      await ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { parent_workflow_id: wfId } });
      await ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: wfId } });
    });
    const state = async (topicId) => (await ctx.db.rows("edu.study_prep_topics", { id: topicId }, { columns: "status, teaching_workflow_id, learner_confirmed_ready", limit: 1 }).catch((e) => {
      if (notMigrated(e)) ctx.expect.blocked(`2026-study-prep-topic-states.sql is not applied: ${e.message}`);
      throw e;
    }))[0];

    await harness.proposePlan({ ...s, topicIds: [topics[0].id] });
    const { topics: planned } = await harness.confirmPlan(s);
    const t = planned[0].id;
    // Keep the agent and the auto-start out of the way: nothing may start a check but this scenario.
    const [row] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "estimate", limit: 1 });
    await harness.store.updateSessionConditional(session.id, "topic_active", { estimate: { ...(row?.estimate || {}), totalCoins: 0, extraCoins: 0 } });

    const first = await practice(ctx, harness, { ...s, topicId: t, mode: "diagnostic" });
    runs.add(first.run.id);
    ctx.expect.eq("the diagnostic is out", (await state(t))?.status, "diagnostic");
    let missed;
    try { missed = await harness.submitPractice({ ...s, topicId: t, answers: await answersFor(ctx, first.run.id, { right: false }) }); } catch (e) {
      if (notMigrated(e)) ctx.expect.blocked(`edu.study_prep_submit_attempt is not on this database: ${e.message}`);
      throw e;
    }
    ctx.expect.eq("missed: intervention_required", `${missed.outcome}/${(await state(t))?.status}`, "retest_offered/intervention_required");
    ctx.expect.eq("…the card still shows it active", missed.topic.status, "active");

    const asked = await harness.requestTeaching({ ...s, topicId: t, strategy: "different_analogy", focusGaps: ["the missed questions"], intent: "An everyday analogy fits this gap." });
    const waiting = await state(t);
    ctx.expect.eq("request_teaching: awaiting_teaching", waiting?.status, "awaiting_teaching");
    ctx.expect.eq("…on the teaching session it made", waiting?.teaching_workflow_id, asked.teaching?.workflowId);
    const [child] = await ctx.db.rows("edu.workflow_instances", { id: asked.teaching?.workflowId }, { columns: "workflow_type, state, parent_workflow_id, metadata", limit: 1 });
    ctx.expect.eq("a teaching child of the Study Prep workflow", `${child?.workflow_type}/${child?.parent_workflow_id === wfId}`, "teaching/true");
    ctx.expect.eq("…with the agent's strategy", child?.metadata?.strategy, "different_analogy");
    ctx.expect.eq("no retest while teaching waits", await rejected(() => harness.startTopicPractice({ ...s, topicId: t, mode: "retest" })), "teach_back_gate");

    // The teaching session, finished at once through the handoff (its end is TEACHING_COMPLETED).
    const handoff = teachingHandoff();
    const approved = await handoff.approve({ workflowId: asked.teaching.workflowId, learnerId: me.id });
    if (approved?.adaptiveSessionId) rowsMade.push(approved.adaptiveSessionId);
    await handoff.bind({ workflowId: asked.teaching.workflowId, learnerId: me.id, liveSessionId: `gate_${me.id}_${Date.now()}` });
    const finished = await handoff.finish({ workflowId: asked.teaching.workflowId, endResult: { totalTurns: 4, learnerEvidenceScore: 60 }, notesAdded: 2, endedBy: "objective_met" });
    ctx.expect.eq("the teaching session completed", finished?.view?.state, "completed");
    let ready = await state(t);
    for (let i = 0; i < 6 && ready?.status !== "retest_ready"; i += 1) { await new Promise((r) => setTimeout(r, 500)); ready = await state(t); }
    ctx.expect.eq("teaching done: retest_ready", `${ready?.status}/${ready?.learner_confirmed_ready}`, "retest_ready/true");

    const retest = await practice(ctx, harness, { ...s, topicId: t, mode: "retest" });
    runs.add(retest.run.id);
    ctx.expect.eq("the retest is out", (await state(t))?.status, "retest");
    const passed = await harness.submitPractice({ ...s, topicId: t, answers: await answersFor(ctx, retest.run.id, { right: true }) });
    ctx.expect.eq("passed: understood", `${passed.outcome}/${(await state(t))?.status}`, "understood/understood");
    const nodes = (await decisionNodes(ctx, session.id)).map((e) => e.decision_node).filter(Boolean);
    ctx.note(`decisions: ${nodes.join(" → ")}`);
    for (const node of ["teaching_requested", "teaching_completed"]) ctx.expect.ok(`${node} is on the stream`, nodes.includes(node));
  },
};

/**
 * Phase 5: the single-transaction submit. The same practice submitted twice
 * at once scores once: one submit wins, the other is a recorded rejection;
 * the attempt, the run record and the topic agree; a direct second call of
 * the submit function changes nothing and reports the recorded score.
 */
export const submitAtomic = {
  name: "studyprep.submit_atomic", area: "study-prep", risk: "write", timeoutMs: 180_000,
  description: "Two submits of the same practice at once score once (edu.study_prep_submit_attempt): one wins, the other is refused; attempt, run and topic agree; a repeat call reports the recorded score and changes nothing.",
  params: { learner: { default: "@tester08" } },
  async run(ctx, p) {
    const { getPracticeHarness } = await import("../../adaptive-learning/index.js");
    const { submitStudyPrepAttempt } = await import("../../adaptive-learning/index.js");
    const harness = getPracticeHarness();
    const { me, session, s, topics } = await freshSession(ctx, p, harness);
    if (!topics.length) ctx.expect.blocked(`no ${CLASS} ${SUBJECT} syllabus to plan from`);
    const runs = new Set();
    ctx.cleanup(async () => { for (const id of runs) await ctx.db.deleteOwned("edu.learner_exam_prep_runs", { ownerColumn: "learner_id", ownerId: me.id, filters: { id } }); });
    await harness.proposePlan({ ...s, topicIds: [topics[0].id] });
    const { topics: planned } = await harness.confirmPlan(s);
    const t = planned[0].id;
    let started;
    try { started = await practice(ctx, harness, { ...s, topicId: t, mode: "diagnostic" }); } catch (e) {
      if (notMigrated(e)) ctx.expect.blocked(`2026-study-prep-topic-states.sql is not applied: ${e.message}`);
      throw e;
    }
    runs.add(started.run.id);
    const answers = await answersFor(ctx, started.run.id, { right: true });
    const both = await Promise.allSettled([
      harness.submitPractice({ ...s, topicId: t, answers }),
      harness.submitPractice({ ...s, topicId: t, answers }),
    ]);
    const failure = both.find((r) => r.status === "rejected")?.reason;
    if (failure && notMigrated(failure)) ctx.expect.blocked(`edu.study_prep_submit_attempt is not on this database: ${failure.message}`);
    ctx.note(`results: ${both.map((r) => (r.status === "fulfilled" ? `ok:${r.value.outcome}` : `refused:${r.reason?.code || r.reason?.message}`)).join(", ")}`);
    ctx.expect.eq("exactly one submit wins", both.filter((r) => r.status === "fulfilled").length, 1);
    ctx.expect.eq("…the other is refused", both.filter((r) => r.status === "rejected" && r.reason?.code === "invalid_state_transition").length, 1);

    const [attempt] = await ctx.db.rows("edu.learner_exam_prep_attempts", { run_id: started.run.id }, { columns: "score, submitted_at", limit: 1 });
    const [run] = await ctx.db.rows("edu.learner_exam_prep_runs", { id: started.run.id }, { columns: "status, last_score", limit: 1 });
    const [topic] = await ctx.db.rows("edu.study_prep_topics", { id: t }, { columns: "status", limit: 1 });
    ctx.expect.eq("one score on the attempt", Number(attempt?.score), 1);
    ctx.expect.eq("attempt, run and topic agree", `${run?.status}/${Number(run?.last_score)}/${topic?.status}`, "passed/1/understood");
    const events = await decisionNodes(ctx, session.id);
    ctx.expect.eq("one engine result", events.filter((e) => e.event_type === "engine_result").length, 1);

    const again = await submitStudyPrepAttempt({ learnerId: me.id, sessionId: session.id, topicId: t, runId: started.run.id, answers: answers.map((a) => ({ ...a, answerIndex: (a.answerIndex + 1) % 4 })) });
    ctx.expect.eq("a repeat call is a duplicate with the recorded score", `${again.applied}/${again.duplicate}/${again.score}`, "false/true/1");
    const [after] = await ctx.db.rows("edu.learner_exam_prep_attempts", { run_id: started.run.id }, { columns: "score, submitted_at", limit: 1 });
    ctx.expect.eq("…and changes nothing", `${Number(after?.score)}/${after?.submitted_at}`, `1/${attempt?.submitted_at}`);
    await harness.cancelSession(s).catch(() => {});
  },
};

export const STUDY_PREP_EXIT = [setsPerOperation, inlineFull, planRejection, budgetCeiling, capOut, topicStates, submitAtomic];
