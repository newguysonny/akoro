// Study Prep through its real REST route, as a test learner (risk: write —
// a session row is created, then cancelled and deleted).

export const planCompletes = {
  name: "studyprep.plan_completes", area: "study-prep", risk: "write",
  description: "Starting a Study Prep session runs the planning agent to a proposed plan — not a session stuck in 'planning'.",
  params: { learner: { default: "@tester12" }, subject: { default: "Basic Science" }, classLevel: { default: "JSS1" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    // One active session per learner: remove sessions earlier gate runs left
    // (they carry a run marker in the goal), then cancel any other active one.
    const stale = await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: "[verify:%" } } });
    if (stale) ctx.note(`removed ${stale} leftover gate session(s)`);
    const active = await ctx.http({ as: p.learner, path: "/api/adaptive/study-prep/sessions" });
    const prior = active.body?.session;
    if (prior?.id) await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/study-prep/sessions/${prior.id}/cancel`, body: {} });
    // Registered before creating: even a failed create leaves nothing behind.
    ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));

    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/study-prep/sessions",
      body: { goal: `${ctx.marker} Prepare for my ${p.classLevel} ${p.subject} test next week`, subject: p.subject, classLevel: p.classLevel, examBoard: "WAEC" } });
    const session = made.body?.session;
    ctx.expect.status("session created", made, 201);
    const events = made.body?.events || [];
    const failures = events.filter((e) => e.eventType === "observation" && e.facts?.ok === false).map((e) => e.facts?.error?.message || e.facts?.error || "error");
    ctx.note(`loop: ${JSON.stringify(made.body?.loop || null)}; status ${session?.status}; ${events.length} events${failures.length ? `; failed tool calls: ${failures.slice(0, 3).join(" | ")}` : ""}`);
    if (made.status >= 400) ctx.note(`error: ${JSON.stringify(made.body).slice(0, 300)}`);
    ctx.expect.eq("planning ends with a plan to confirm", session?.status, "awaiting_confirmation");
    ctx.expect.gte("plan has topics", Array.isArray(session?.plan) ? session.plan.length : 0, 1);
  },
};

export const practiceChargedOnce = {
  name: "studyprep.practice_charged_once", area: "study-prep", risk: "write",
  // The human-answered practice (the off switch's path); the Agent Check's
  // own one-charge rule is studyprep.agent_check_battle.
  description: "One human-answered Study Prep practice costs the learner exactly the flat practice price — the question generation is not billed on top.",
  params: { learner: { default: "@tester13" }, subject: { default: "Basic Science" }, classLevel: { default: "JSS1" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const base = "/api/adaptive/study-prep/sessions";
    await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: "[verify:%" } } });
    const active = await ctx.http({ as: p.learner, path: base });
    if (active.body?.session?.id) await ctx.http({ as: p.learner, method: "POST", path: `${base}/${active.body.session.id}/cancel`, body: {} });
    ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));

    const made = await ctx.http({ as: p.learner, method: "POST", path: base,
      body: { goal: `${ctx.marker} Revise ${p.subject} before my test`, subject: p.subject, classLevel: p.classLevel, examBoard: "WAEC" } });
    const id = made.body?.session?.id;
    if (made.body?.session?.status !== "awaiting_confirmation") ctx.expect.blocked(`planning didn't reach a plan (${made.body?.session?.status || made.status}) — run studyprep.plan_completes`);
    const confirmed = await ctx.http({ as: p.learner, method: "POST", path: `${base}/${id}/confirm`, body: {} });
    ctx.expect.status("plan confirmed", confirmed, [200, 201]);
    const topic = (confirmed.body?.topics || []).find((t) => t.status === "active");
    if (!topic) ctx.expect.blocked("no active topic after confirming the plan");

    const [acct] = await ctx.db.rows("coin_accounts", { owner_id: me.id }, { columns: "id, balance", limit: 1 });
    if (!acct) ctx.expect.blocked(`${p.learner} has no coin account`);
    const t0 = new Date(Date.now() - 1000).toISOString();
    const { getPracticeHarness } = await import("../../adaptive-learning/study-prep/wiring.js");
    let practice;
    try {
      practice = await getPracticeHarness().startTopicPractice({ sessionId: id, learnerId: me.id, topicId: topic.id, mode: "diagnostic" });
    } catch (e) {
      if (e.code === "insufficient_balance") ctx.expect.blocked(`${p.learner} can't afford a practice`);
      throw e;
    }
    ctx.expect.ok("practice generated", !!practice?.attempt, JSON.stringify(practice || null).slice(0, 200));
    const runId = practice?.run?.id;
    if (runId) ctx.cleanup(() => ctx.db.deleteOwned("edu.learner_exam_prep_runs", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: runId } }));

    // Token charges are written just after the provider answers — give them a moment.
    await new Promise((r) => setTimeout(r, 8000));
    const recent = (await ctx.db.rows("coin_transactions", { account_id: acct.id }, { columns: "delta, type, feature, created_at", limit: 30, order: { column: "created_at", ascending: false } }))
      .filter((t) => t.created_at >= t0 && t.type === "debit");
    ctx.note(`debits since the practice started: ${JSON.stringify(recent.map((t) => ({ feature: t.feature, delta: t.delta })))}`);
    const flat = recent.filter((t) => t.feature === "study_prep_practice");
    ctx.expect.eq("one flat practice charge", flat.length, 1);
    ctx.expect.eq("flat charge is 2 coins", flat[0]?.delta, -2);
    // The agent's wake after the approval is part of the session and billed as such (study_prep_wake).
    ctx.expect.eq("question generation not billed to the learner", recent.filter((t) => !["study_prep_practice", "study_prep_wake"].includes(t.feature)).length, 0);
  },
};

export const generatedOutline = {
  name: "studyprep.generated_outline", area: "study-prep", risk: "write",
  // Two synchronous planning runs of up to 10 thinking decisions each.
  timeoutMs: 300_000,
  description: "With no syllabus for the class + subject, planning drafts an AI outline, labels the plan as such, and the next session reuses the same outline.",
  params: { learner: { default: "@tester14" }, subject: { default: "Agricultural Science" }, classLevel: { default: "JSS1" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const base = "/api/adaptive/study-prep/sessions";
    const cov = await ctx.db.count("edu.syllabus_subjects", { name: { like: `%${p.subject}%` } });
    if (cov) ctx.expect.blocked(`${p.subject} has a real syllabus here — pick a subject without one`);
    await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: "[verify:%" } } });
    const active = await ctx.http({ as: p.learner, path: base });
    if (active.body?.session?.id) await ctx.http({ as: p.learner, method: "POST", path: `${base}/${active.body.session.id}/cancel`, body: {} });
    ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));

    const start = () => ctx.http({ as: p.learner, method: "POST", path: base,
      body: { goal: `${ctx.marker} Get ready for my ${p.classLevel} ${p.subject} test`, subject: p.subject, classLevel: p.classLevel, examBoard: "WAEC" } });

    const first = await start();
    const s1 = first.body?.session;
    const refs = new Set();
    ctx.note(`first: ${s1?.status}, source ${s1?.syllabusSource}, ${(s1?.plan || []).length} topics, loop ${JSON.stringify(first.body?.loop || null)}`);
    ctx.expect.eq("plan proposed", s1?.status, "awaiting_confirmation");
    ctx.expect.eq("planned against a generated outline", s1?.syllabusSource, "generated");
    ctx.expect.ok("the plan card is labelled as an AI-drafted outline", /AI-drafted outline/.test(s1?.syllabusLabel || ""), s1?.syllabusLabel);
    ctx.expect.gte("plan has topics", (s1?.plan || []).length, 1);
    ctx.expect.ok("the narration says why", (first.body?.events || []).some((e) => /AI-drafted outline/.test(e.narrative || "")));
    const rows1 = await ctx.db.rows("edu.study_prep_sessions", { id: s1?.id || "00000000-0000-0000-0000-000000000000" }, { columns: "syllabus_ref", limit: 1 });
    if (rows1[0]?.syllabus_ref) refs.add(rows1[0].syllabus_ref);
    const [outline] = rows1[0]?.syllabus_ref ? await ctx.db.rows("edu.generated_syllabi", { id: rows1[0].syllabus_ref }, { columns: "id, status, created_by_learner, topics", limit: 1 }) : [];
    ctx.expect.eq("outline saved as provisional", outline?.status, "provisional");
    ctx.expect.ok("outline passed the code checks (3-15 topics)", Array.isArray(outline?.topics) && outline.topics.length >= 3 && outline.topics.length <= 15, outline?.topics?.length);
    if (outline?.created_by_learner === me.id) ctx.cleanup(() => ctx.db.deleteOwned("edu.generated_syllabi", { ownerColumn: "created_by_learner", ownerId: me.id, filters: { id: outline.id } }));

    // A second session for the same class + subject reuses that outline.
    if (s1?.id) await ctx.http({ as: p.learner, method: "POST", path: `${base}/${s1.id}/cancel`, body: {} });
    const second = await start();
    const s2 = second.body?.session;
    const rows2 = await ctx.db.rows("edu.study_prep_sessions", { id: s2?.id || "00000000-0000-0000-0000-000000000000" }, { columns: "syllabus_ref", limit: 1 });
    ctx.expect.eq("second session planned against the same outline", rows2[0]?.syllabus_ref, outline?.id);
    if (s2?.id) await ctx.http({ as: p.learner, method: "POST", path: `${base}/${s2.id}/cancel`, body: {} });
  },
};

// A confirmed plan with its first Agent Check started (the agent-check scenarios' setup).
async function startAgentCheckFor(ctx, p) {
  const me = await ctx.as(p.learner);
  const base = "/api/adaptive/study-prep/sessions";
  await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: "[verify:%" } } });
  const active = await ctx.http({ as: p.learner, path: base });
  if (active.body?.session?.id) await ctx.http({ as: p.learner, method: "POST", path: `${base}/${active.body.session.id}/cancel`, body: {} });
  ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));

  const made = await ctx.http({ as: p.learner, method: "POST", path: base,
    body: { goal: `${ctx.marker} Revise ${p.subject} cells before my test`, subject: p.subject, classLevel: p.classLevel, examBoard: "WAEC" } });
  const id = made.body?.session?.id;
  if (made.body?.session?.status !== "awaiting_confirmation") ctx.expect.blocked(`planning didn't reach a plan (${made.body?.session?.status || made.status})`);
  // The protégé's thread for this session, and its notifications.
  ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: me.id, filters: { session_id: id } }));
  ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id } }));
  ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: me.id, filters: { related_id: id } }));
  const confirmed = await ctx.http({ as: p.learner, method: "POST", path: `${base}/${id}/confirm`, body: {} });
  ctx.expect.status("plan confirmed", confirmed, [200, 201]);
  const topic = (confirmed.body?.topics || []).find((t) => t.status === "active");
  if (!topic) ctx.expect.blocked("no active topic after confirming the plan");

  const [acct] = await ctx.db.rows("coin_accounts", { owner_id: me.id }, { columns: "id, balance", limit: 1 });
  if (!acct) ctx.expect.blocked(`${p.learner} has no coin account`);
  const t0 = new Date(Date.now() - 1000).toISOString();
  const { getAgentCheckHarness } = await import("../../adaptive-learning/study-prep/wiring.js");
  const harness = getAgentCheckHarness({ questions: 3, secondsPerQuestion: 10 });
  let started;
  try {
    started = await harness.startTopicPractice({ sessionId: id, learnerId: me.id, topicId: topic.id, mode: "diagnostic" });
  } catch (e) {
    if (e.code === "insufficient_balance") ctx.expect.blocked(`${p.learner} can't afford a practice`);
    throw e;
  }
  if (started.skipped) {
    ctx.note(`${p.learner} has no notes on "${topic.label}" — the check was skipped with nothing charged (the no-notes rule)`);
    const debits = (await ctx.db.rows("coin_transactions", { account_id: acct.id }, { columns: "delta, type, feature, created_at", limit: 10, order: { column: "created_at", ascending: false } }))
      .filter((t) => t.created_at >= t0 && t.type === "debit");
    ctx.expect.eq("nothing charged when there is nothing to check", debits.length, 0);
    ctx.expect.blocked(`no notes on "${topic.label}" to check — teach ${p.learner}'s agent this topic, or pick a learner with notes on it`);
  }
  const battleId = started.check?.battleId;
  ctx.expect.ok("a check battle was created", !!battleId, JSON.stringify(started.check || null));
  // Registered after the session's cleanup, so it runs first (cleanups run newest first).
  ctx.cleanup(async () => {
    const { discardCheckBattle } = await import("../../battle/agentCheck.js");
    await discardCheckBattle(battleId, me.id);
  });
  ctx.note(`topic "${topic.label}", battle ${battleId}, ${started.check?.questions} questions`);
  return { me, id, topic, acct, t0, battleId, started };
}

// D45 (§7.12): Study Prep practice as an Agent Check battle, end to end —
// the harness charges once, a 'check' battle runs (the protégé answers from
// the learner's notes, Sergeant judges), the Engine scores it as the agent's,
// and the protégé reports in chat. Runs the Agent Check path directly, so it
// works even where AKORO_STUDY_PREP_AGENT_CHECK=false switches it off.
export const agentCheckBattle = {
  name: "studyprep.agent_check_battle", area: "study-prep", risk: "write", regression: false,
  // A live battle: the protégé answers and Sergeant judges each question.
  timeoutMs: 240_000,
  description: "An Agent Check runs as a real battle: one 2-coin charge, the protégé answers from the learner's notes, Sergeant rules, the result is scored as the agent's and posted in chat.",
  params: { learner: { default: "@tester17" }, subject: { default: "Biology" }, classLevel: { default: "SS1" } },
  async run(ctx, p) {
    const { me, id, topic, acct, t0, battleId } = await startAgentCheckFor(ctx, p);

    // 3 questions × 10 s, a 6 s start and the end delay: scored within ~75 s.
    let scored = null;
    for (let i = 0; i < 40 && !scored; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const [row] = await ctx.db.rows("edu.study_prep_topics", { id: topic.id }, { columns: "check_battle_id, check_scored_at, check_result, status", limit: 1 });
      if (row?.check_scored_at) scored = row;
    }
    if (!scored) ctx.expect.blocked("the check battle did not finish within 100 s — is the battle worker running?");
    // Scoring claims the result first, then settles the topic: give it a moment.
    await new Promise((r) => setTimeout(r, 3000));
    [scored] = await ctx.db.rows("edu.study_prep_topics", { id: topic.id }, { columns: "check_battle_id, check_scored_at, check_result, status", limit: 1 });

    const [battle] = await ctx.db.rows("battles", { id: battleId }, { columns: "battle_type, status, study_prep_topic_id, created_by", limit: 1 });
    ctx.expect.eq("battle type is an Agent Check", battle?.battle_type, "check");
    ctx.expect.eq("battle completed", battle?.status, "completed");
    ctx.expect.eq("the platform asked (no creator)", battle?.created_by ?? null, null);
    ctx.expect.eq("one seat: the protégé", await ctx.db.count("battle_participants", { battle_id: battleId }), 1);
    ctx.expect.gte("Sergeant ruled on the questions", await ctx.db.count("battle_log", { battle_id: battleId, event_type: "judge_ruling" }), 1);
    const r = scored.check_result || {};
    ctx.note(`result: ${r.correct}/${r.total} from notes, ${r.guessed} guessed, ${r.unknown} not in the notes; topic → ${scored.status}`);
    ctx.expect.eq("every question scored", (r.perQuestion || []).length, r.total);


    const debits = (await ctx.db.rows("coin_transactions", { account_id: acct.id }, { columns: "delta, type, feature, created_at", limit: 30, order: { column: "created_at", ascending: false } }))
      .filter((t) => t.created_at >= t0 && t.type === "debit");
    ctx.note(`debits: ${JSON.stringify(debits.map((t) => ({ feature: t.feature, delta: t.delta })))}`);
    ctx.expect.eq("one flat practice charge", debits.filter((t) => t.feature === "study_prep_practice").length, 1);
    ctx.expect.eq("nothing else billed (questions and answers are the platform's)", debits.filter((t) => !["study_prep_practice", "study_prep_wake"].includes(t.feature)).length, 0);

    const events = await ctx.db.rows("edu.study_prep_events", { session_id: id, event_type: "engine_result" }, { columns: "facts", limit: 5 });
    const engine = events.find((e) => e.facts?.source === "agent_recall");
    ctx.expect.ok("the Engine scored it as the agent's answers", !!engine);
    // Topic states (§8.3, 2026-11-07): a miss needs an intervention — the topic waits there,
    // or has already been handed to a teaching session (D15); a pass / cap-out is as before.
    const missed = engine?.facts?.outcome === "retest_offered";
    const state = scored.state || scored.status;
    if (missed) ctx.expect.ok("the topic follows the Engine's outcome (a miss needs an intervention)", ["intervention_required", "awaiting_teaching"].includes(state), { status: scored.status, state: scored.state });
    else ctx.expect.eq("the topic follows the Engine's outcome", state, engine?.facts?.outcome);
    const said = await ctx.db.rows("chat_messages", { session_id: id }, { columns: "text, meta", limit: 20 });
    const checkRow = async () => (await ctx.db.rows("edu.workflow_instances", { workflow_type: "practice", learner_id: me.id }, { columns: "id, state, parent_workflow_id, metadata", limit: 20, order: { column: "created_at", ascending: false } }))
      .find((w) => w.metadata?.battleId === battleId);
    let check = await checkRow();
    // Marking closes the check's workflow after the topic is scored: give it a moment.
    for (let i = 0; i < 10 && check && check.state === "running"; i++) { await new Promise((r) => setTimeout(r, 1500)); check = await checkRow(); }
    if (!check) {
      // No Study Prep workflow (engine off): the protégé's own messages, as before.
      ctx.expect.gte("the protégé posted in chat (start + result)", said.filter((m) => m.meta?.battle?.id === battleId).length, 2);
      return;
    }
    ctx.cleanup(() => ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: check.id } }));
    // The check's own workflow, its card on the run's message, a row per question in that run.
    ctx.expect.eq("the Agent Check's workflow completed", check.state, "completed");
    ctx.expect.eq("one run message carries the check's card", said.filter((m) => m.meta?.agentCheck?.battleId === battleId).length, 1);
    const rows = (await ctx.db.rows("edu.workflow_events", { workflow_id: check.parent_workflow_id }, { columns: "event_type, payload", limit: 300, order: { column: "sequence", ascending: true } }))
      .filter((e) => e.payload?.runId === `check:${battleId}` && e.event_type === "tool.completed");
    ctx.note(`run rows: ${JSON.stringify(rows.map((e) => e.payload.headline))}`);
    ctx.expect.eq("a row per marked question", rows.filter((e) => e.payload.tool === "study_prep.check_question").length, r.total);
    ctx.expect.eq("the result closes the run", rows.at(-1)?.payload?.tool, "study_prep.check_marked");
  },
};

// The learner stops a running Agent Check from the chat (#77): the battle is
// cancelled, the charge refunded, the run closed, the topic waits (no auto
// start); "running work" lists the check (with its Battles link) until then.
export const agentCheckStop = {
  name: "studyprep.agent_check_stop", area: "study-prep", risk: "write", regression: false,
  timeoutMs: 240_000,
  description: "A running Agent Check is listed in running work with its Battles link; stopping it cancels the battle, refunds the 2 coins, closes its run and leaves the topic waiting.",
  params: { learner: { default: "@tester17" }, subject: { default: "Biology" }, classLevel: { default: "SS1" } },
  async run(ctx, p) {
    const { me, topic, acct, t0, battleId } = await startAgentCheckFor(ctx, p);
    const { runningWork, stopAgentCheck } = await import("../../adaptive-learning/study-prep/wiring.js");
    const work = await runningWork(me.id);
    const listed = work.agentChecks.find((c) => c.battleId === battleId);
    ctx.expect.ok("running work lists the check", !!listed, JSON.stringify(work.agentChecks));
    ctx.expect.eq("with its Battles link", listed?.link, `/?tab=battles&battle=${battleId}`);

    const stop = await stopAgentCheck({ learnerId: me.id });
    ctx.note(`stop: ${JSON.stringify(stop)}`);
    ctx.expect.eq("stopped", stop.stopped, true);
    const [battle] = await ctx.db.rows("battles", { id: battleId }, { columns: "status", limit: 1 });
    ctx.expect.eq("battle cancelled", battle?.status, "cancelled");
    const moves = (await ctx.db.rows("coin_transactions", { account_id: acct.id }, { columns: "delta, type, feature, created_at", limit: 30, order: { column: "created_at", ascending: false } }))
      .filter((t) => t.created_at >= t0 && String(t.feature || "").startsWith("study_prep_practice"));
    ctx.note(`coins: ${JSON.stringify(moves.map((t) => ({ type: t.type, delta: t.delta })))}`);
    ctx.expect.eq("the charge was refunded (net zero)", moves.reduce((sum, t) => sum + Number(t.delta || 0), 0), 0);

    const [row] = await ctx.db.rows("edu.study_prep_topics", { id: topic.id }, { columns: "check_battle_id, check_mode, status", limit: 1 });
    ctx.expect.eq("the topic waits for the learner", row?.check_mode, "stopped");
    ctx.expect.eq("no check on the topic", row?.check_battle_id ?? null, null);
    const [check] = await ctx.db.rows("edu.workflow_instances", { workflow_type: "practice", learner_id: me.id }, { columns: "id, state, metadata", limit: 20, order: { column: "created_at", ascending: false } })
      .then((rows) => rows.filter((w) => w.metadata?.battleId === battleId));
    ctx.expect.ok("the check had its own workflow", !!check);
    if (check) ctx.cleanup(() => ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: check.id } }));
    ctx.expect.eq("its workflow is stopped", check?.state, "stopped");
    ctx.expect.eq("running work no longer lists it", (await runningWork(me.id)).agentChecks.length, 0);
    ctx.expect.eq("a second stop finds nothing", (await stopAgentCheck({ learnerId: me.id })).stopped, false);
  },
};

// §8.7 steps 1–2: a learner with a linked school enrollment plans from their
// OWN class syllabus (mgmt.syllabus_items), not the platform's. The sandbox
// seed gives Akoro Demo Academy's JSS2 a Basic Science class syllabus.
export const classSyllabusFirst = {
  name: "studyprep.class_syllabus_first", area: "study-prep", risk: "write",
  description: "A learner enrolled at a school plans from their own class syllabus first: the session records source 'class', and every planned topic is one of the class's topics.",
  params: { learner: { default: "@tester11" }, subject: { default: "Basic Science" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const base = "/api/adaptive/study-prep/sessions";
    const linked = await ctx.db.rows("mgmt.students", { user_id: me.id }, { columns: "school_id, class_id, status", limit: 5 });
    const student = linked.find((row) => row.status === "active");
    if (!student?.class_id) ctx.expect.blocked(`${p.learner} has no linked, active school enrollment with a class (found ${JSON.stringify(linked.map((row) => ({ status: row.status, hasClass: !!row.class_id })))}) — apply the sandbox seed 2026-seed-sandbox-class-syllabus.sql`);
    const subjects = await ctx.db.rows("mgmt.subjects", { school_id: student.school_id, name: p.subject }, { columns: "id", limit: 1 });
    const items = subjects[0] ? await ctx.db.rows("mgmt.syllabus_items", { school_id: student.school_id, class_id: student.class_id, subject_id: subjects[0].id }, { columns: "topic, term, status", limit: 100 }) : [];
    if (items.length < 2) ctx.expect.blocked(`${p.learner}'s class has no ${p.subject} syllabus items — apply the sandbox seed 2026-seed-sandbox-class-syllabus.sql`);
    const slug = (t) => String(t || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
    const classTopics = new Set(items.map((row) => slug(row.topic)));
    ctx.note(`${p.learner}'s class has ${items.length} ${p.subject} topics`);

    await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: "[verify:%" } } });
    const active = await ctx.http({ as: p.learner, path: base });
    if (active.body?.session?.id) await ctx.http({ as: p.learner, method: "POST", path: `${base}/${active.body.session.id}/cancel`, body: {} });
    ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));

    const made = await ctx.http({ as: p.learner, method: "POST", path: base,
      body: { goal: `${ctx.marker} Revise ${p.subject} for my class test`, subject: p.subject, classLevel: "JSS2", examBoard: "BECE" } });
    const session = made.body?.session;
    ctx.note(`status ${session?.status}, source ${session?.syllabusSource}, plan ${JSON.stringify((session?.plan || []).map((t) => t.syllabusTopicId))}`);
    ctx.expect.eq("planning ends with a plan to confirm", session?.status, "awaiting_confirmation");
    const [row] = await ctx.db.rows("edu.study_prep_sessions", { id: session?.id || "00000000-0000-0000-0000-000000000000" }, { columns: "syllabus_source, syllabus_ref", limit: 1 });
    ctx.expect.eq("planned against the learner's class syllabus", row?.syllabus_source, "class");
    ctx.expect.eq("the source is the learner's class", row?.syllabus_ref, student.class_id);
    const plan = session?.plan || [];
    ctx.expect.gte("plan has topics", plan.length, 1);
    ctx.expect.ok("every planned topic is a class topic", plan.every((t) => classTopics.has(t.syllabusTopicId)), JSON.stringify(plan.map((t) => t.syllabusTopicId)));
    ctx.expect.eq("not labelled as an AI-drafted outline", session?.syllabusLabel ?? null, null);
    ctx.expect.ok("the narration says it's the class syllabus", (made.body?.events || []).some((e) => /your school's .*syllabus/i.test(e.narrative || "")));
    if (session?.id) await ctx.http({ as: p.learner, method: "POST", path: `${base}/${session.id}/cancel`, body: {} });
  },
};

// Phase 1 + F7: a Study Prep session dual-writes into the generic workflow
// engine, and an illegal move is refused. Runs the harness with the engine
// on (getWorkflowHarness), so it works while WORKFLOW_ENGINE_ENABLED is off.
export const workflowMirror = {
  name: "studyprep.workflow_mirror", area: "study-prep", risk: "write",
  description: "A Study Prep session gets one workflow instance that follows it state for state, with every session event in its stream in order; an illegal move (concluding a cancelled session) is refused and changes nothing.",
  params: { learner: { default: "@tester16" }, subject: { default: "Basic Science" }, classLevel: { default: "JSS3" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: "[verify:%" } } });
    const { getWorkflowHarness } = await import("../../adaptive-learning/study-prep/wiring.js");
    const harness = getWorkflowHarness();
    const active = await ctx.http({ as: p.learner, path: "/api/adaptive/study-prep/sessions" });
    if (active.body?.session?.id) await harness.cancelSession({ sessionId: active.body.session.id, learnerId: me.id }).catch(() => {});
    ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));

    const session = await harness.createSession({ learnerId: me.id, goal: `${ctx.marker} Revise ${p.subject}`, subject: p.subject, classLevel: p.classLevel, examBoard: "BECE" });
    const [linked] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "workflow_id", limit: 1 });
    const wfId = linked?.workflow_id;
    if (!wfId) ctx.expect.blocked("the session has no workflow instance — is migrations/2026-workflow-engine.sql applied?");
    ctx.cleanup(() => ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: wfId } }));

    const wf = async () => (await ctx.db.rows("edu.workflow_instances", { id: wfId }, { columns: "state, status, workflow_type, idempotency_key, cancelled_at", limit: 1 }))[0];
    let row = await wf();
    ctx.expect.eq("one study_prep instance for the session", row?.workflow_type, "study_prep");
    ctx.expect.eq("keyed to the session", row?.idempotency_key, `study_prep:${session.id}`);
    ctx.expect.eq("starts in planning (active)", `${row?.state}/${row?.status}`, "planning/active");

    const syllabus = await harness.resolveSyllabus({ sessionId: session.id, learnerId: me.id });
    if (!syllabus.found || !syllabus.topics.length) ctx.expect.blocked(`no ${p.classLevel} ${p.subject} syllabus to plan from`);
    await harness.proposePlan({ sessionId: session.id, learnerId: me.id, topicIds: [syllabus.topics[0].id] });
    row = await wf();
    ctx.expect.eq("the plan card waits on the learner", `${row?.state}/${row?.status}`, "awaiting_confirmation/waiting_learner");
    await harness.confirmPlan({ sessionId: session.id, learnerId: me.id });
    row = await wf();
    ctx.expect.eq("confirmed: a topic is active", `${row?.state}/${row?.status}`, "topic_active/active");
    await harness.cancelSession({ sessionId: session.id, learnerId: me.id });
    row = await wf();
    ctx.expect.eq("cancelled together", `${row?.state}/${row?.status}`, "cancelled/cancelled");
    ctx.expect.ok("cancelled_at stamped", !!row?.cancelled_at);

    // F7: a finished session can't be concluded — refused, nothing moves.
    let refused = null;
    try { await harness.concludeSession({ sessionId: session.id, learnerId: me.id }); } catch (e) { refused = e.code; }
    ctx.expect.eq("concluding a cancelled session is refused", refused, "invalid_state_transition");
    const [after] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "status", limit: 1 });
    ctx.expect.eq("the session is still cancelled", after?.status, "cancelled");

    const spEvents = await ctx.db.rows("edu.study_prep_events", { session_id: session.id }, { columns: "sequence", limit: 200, order: { column: "sequence", ascending: true } });
    const wfEvents = await ctx.db.rows("edu.workflow_events", { workflow_id: wfId }, { columns: "sequence, payload", limit: 200, order: { column: "sequence", ascending: true } });
    ctx.note(`${spEvents.length} study-prep events, ${wfEvents.length} workflow events`);
    // Phase 3: the stream also holds the workflow's own lifecycle events (created, moves).
    ctx.expect.ok("in order, numbered from 0", wfEvents.every((e, i) => e.sequence === i), JSON.stringify(wfEvents.map((e) => e.sequence)));
    const copied = wfEvents.filter((e) => e.payload?.studyPrepSequence != null);
    ctx.expect.eq("every session event is in the workflow stream", copied.length, spEvents.length);
    ctx.expect.ok("each points back at its session event, in order", copied.every((e, i) => e.payload.studyPrepSequence === spEvents[i]?.sequence));
  },
};

// 2026-10-19: the agent keeps working after the plan is ready. Approving the
// plan wakes it: a chat message opens the wake, it runs up to 4 decisions
// (thought → tool → message) in the workflow's stream, and ends by waiting —
// the session is never paused by it. Then the 1-minute auto-start, run with
// a clock 70 s ahead for this session only.
export const agentWakes = {
  name: "studyprep.agent_wakes", area: "study-prep", risk: "write",
  timeoutMs: 240_000,
  description: "Approving a Study Prep plan wakes the agent: its run (≤ 4 decisions, with messages to the learner) streams under its own chat message and ends waiting; a minute later the Agent Check starts by itself.",
  params: { learner: { default: "@tester16" }, subject: { default: "Basic Science" }, classLevel: { default: "JSS3" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const base = "/api/adaptive/study-prep/sessions";
    await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: "[verify:%" } } });
    const { getHarness, autoStartDueChecks } = await import("../../adaptive-learning/study-prep/wiring.js");
    const harness = getHarness();
    const active = await ctx.http({ as: p.learner, path: base });
    if (active.body?.session?.id) await harness.cancelSession({ sessionId: active.body.session.id, learnerId: me.id }).catch(() => {});
    ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));

    const chat = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} wakes` } });
    const chatId = chat.body?.session?.id;
    if (!chatId) ctx.expect.blocked(`couldn't open a chat (${chat.status})`);
    ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: me.id, filters: { session_id: chatId } }));
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: chatId } }));

    // A plan straight from the harness (planning itself is studyprep.plan_completes).
    const session = await harness.createSession({ learnerId: me.id, goal: `${ctx.marker} Revise ${p.subject}`, subject: p.subject, classLevel: p.classLevel, examBoard: "BECE" });
    const syllabus = await harness.resolveSyllabus({ sessionId: session.id, learnerId: me.id });
    if (!syllabus.found || syllabus.topics.length < 2) ctx.expect.blocked(`no ${p.classLevel} ${p.subject} syllabus to plan from`);
    await harness.proposePlan({ sessionId: session.id, learnerId: me.id, topicIds: syllabus.topics.slice(0, 2).map((t) => t.id) });
    const [linked] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "workflow_id", limit: 1 });
    const wfId = linked?.workflow_id;
    if (!wfId) ctx.expect.blocked("the session has no workflow");
    ctx.cleanup(() => ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: wfId } }));

    // The learner approves on the card, in this chat.
    const approvedAt = new Date(Date.now() - 1000).toISOString();
    const confirmed = await ctx.http({ as: p.learner, method: "POST", path: `${base}/${session.id}/confirm`, body: { conversationId: chatId } });
    ctx.expect.status("plan approved", confirmed, 200);

    const marks = async () => (await ctx.db.rows("edu.workflow_events", { workflow_id: wfId }, { columns: "sequence, event_type, payload", limit: 300, order: { column: "sequence", ascending: true } }));
    let events = [];
    for (let i = 0; i < 40; i += 1) {
      events = await marks();
      if (events.some((e) => e.event_type === "operation.completed" && e.payload?.operation === "wake")) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    const start = events.findIndex((e) => e.event_type === "operation.started" && e.payload?.operation === "wake");
    const end = events.findIndex((e) => e.event_type === "operation.completed" && e.payload?.operation === "wake");
    ctx.expect.ok("the approval woke the agent", start >= 0, JSON.stringify(events.slice(-5).map((e) => e.event_type)));
    ctx.expect.eq("woken by the approval", events[start]?.payload?.trigger, "plan_confirmed");
    ctx.expect.ok("the wake ended", end > start, `start ${start}, end ${end}`);
    const run = events.slice(start + 1, end);
    const decisions = run.filter((e) => e.event_type === "tool.started").length;
    const said = run.filter((e) => e.event_type === "activity" && e.payload?.message).map((e) => e.payload.message);
    ctx.note(`wake: ${decisions} decision(s); said: ${JSON.stringify(said).slice(0, 600)}`);
    ctx.expect.ok("1–4 decisions", decisions >= 1 && decisions <= 4, decisions);
    ctx.expect.gte("it talked to the learner", said.length, 1);
    // Platform-paid: the learner approved the plan's coins, not the agent's thinking.
    const [acct] = await ctx.db.rows("coin_accounts", { owner_id: me.id }, { columns: "id", limit: 1 });
    if (acct) {
      // Only the wake itself (part of the session, study_prep_wake): its reads (the notes search, its rerank) stay the platform's.
      const wakeDebits = (await ctx.db.rows("coin_transactions", { account_id: acct.id }, { columns: "feature, type, created_at", limit: 30, order: { column: "created_at", ascending: false } }))
        .filter((t) => t.created_at >= approvedAt && t.type === "debit");
      ctx.note(`debits during the wake: ${JSON.stringify(wakeDebits.map((t) => t.feature))}`);
      ctx.expect.eq("only the wake is billed to the learner", wakeDebits.filter((t) => t.feature !== "study_prep_wake").length, 0);
    }

    const [after] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "status, paused_reason", limit: 1 });
    ctx.expect.eq("the session keeps running (a wake never pauses it)", after?.status, "topic_active");
    const posted = await ctx.db.rows("chat_messages", { session_id: chatId }, { columns: "role, text, meta", limit: 10 });
    const opener = posted.find((m) => m.meta?.studyPrepWake);
    ctx.expect.ok("the wake opened its own message in the chat", !!opener, JSON.stringify(posted.map((m) => m.meta)).slice(0, 300));
    ctx.expect.eq("…for this session", opener?.meta?.studyPrepWake?.sessionId, session.id);

    // The countdown the card shows, then the auto-start (a clock 70 s ahead, this session only).
    const view = await ctx.http({ as: p.learner, path: `${base}/${session.id}` });
    const next = view.body?.nextCheck;
    ctx.note(`nextCheck: ${JSON.stringify(next)}`);
    if (!view.body?.agentCheck) ctx.expect.blocked("the Agent Check is switched off here");
    ctx.expect.ok("the card has a countdown for the first check", !!next?.at && next.mode === "diagnostic", JSON.stringify(next));
    const msLeft = Date.parse(next?.at || "") - Date.now();
    ctx.expect.ok("about a minute after the topic started", msLeft > 0 && msLeft <= 60_000, msLeft);
    const swept = await autoStartDueChecks({ nowMs: Date.now() + 70_000, sessionId: session.id });
    ctx.note(`auto-start: ${JSON.stringify(swept)}`);
    const checkEvents = await ctx.db.rows("edu.study_prep_events", { session_id: session.id }, { columns: "decision_node, facts", limit: 200 });
    const startedCheck = checkEvents.find((e) => e.decision_node === "agent_check_started");
    const skippedCheck = checkEvents.find((e) => e.decision_node === "agent_check_skipped");
    ctx.expect.ok("the check started by itself (or found no notes to check)", !!startedCheck || !!skippedCheck);
    if (startedCheck?.facts?.battleId) {
      const battleId = startedCheck.facts.battleId;
      ctx.cleanup(async () => {
        const { discardCheckBattle } = await import("../../battle/agentCheck.js");
        await discardCheckBattle(battleId, me.id);
      });
    }
    if (skippedCheck) {
      const again = await autoStartDueChecks({ nowMs: Date.now() + 140_000, sessionId: session.id });
      ctx.expect.eq("no notes: it doesn't try again every minute", again.started + again.skipped, 0);
    }
    await harness.cancelSession({ sessionId: session.id, learnerId: me.id }).catch(() => {});
  },
};

// 2026-10-19 (a learner's chat): an unapproved Mathematics plan kept coming back
// for a WAEC Biology request, and "Cancel the plan" couldn't be done. A plan for
// another subject that was never approved is set aside; the learner can cancel.
export const replaceAndCancel = {
  name: "studyprep.replace_and_cancel", area: "study-prep", risk: "write",
  description: "Asking for a Biology plan while an unapproved Mathematics plan exists sets the old one aside (nothing charged) and starts Biology, with the class taken from the exam; the learner can then cancel it from the chat.",
  params: { learner: { default: "@tester15" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: "[verify:%" } } });
    const { getHarness } = await import("../../adaptive-learning/study-prep/wiring.js");
    const harness = getHarness();
    const active = await ctx.http({ as: p.learner, path: "/api/adaptive/study-prep/sessions" });
    if (active.body?.session?.id) await harness.cancelSession({ sessionId: active.body.session.id, learnerId: me.id }).catch(() => {});
    ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));

    // The old card: Mathematics, proposed, never approved.
    const old = await harness.createSession({ learnerId: me.id, goal: `${ctx.marker} plan for a test`, subject: "Mathematics", classLevel: "JSS1", examBoard: "WAEC" });
    const syllabus = await harness.resolveSyllabus({ sessionId: old.id, learnerId: me.id });
    if (!syllabus.found || !syllabus.topics.length) ctx.expect.blocked("no JSS1 Mathematics syllabus to plan the old card from");
    await harness.proposePlan({ sessionId: old.id, learnerId: me.id, topicIds: [syllabus.topics[0].id] });

    const started = await ctx.agent.tool({ as: p.learner, tool: "start_study_prep_session", mode: "live",
      input: { goal: `${ctx.marker} I have WAEC Biology in 6 weeks`, subject: "Biology", examBoard: "WAEC" } });
    ctx.note(`start: ${JSON.stringify(started).slice(0, 300)}`);
    ctx.expect.eq("the old Mathematics card was set aside", started?.replaced, "Mathematics");
    const [oldRow] = await ctx.db.rows("edu.study_prep_sessions", { id: old.id }, { columns: "status", limit: 1 });
    ctx.expect.eq("…cancelled, never approved", oldRow?.status, "cancelled");
    const [fresh] = started?.sessionId ? await ctx.db.rows("edu.study_prep_sessions", { id: started.sessionId }, { columns: "subject, class_level, status", limit: 1 }) : [];
    ctx.expect.eq("a Biology plan started", fresh?.subject, "Biology");
    ctx.expect.eq("WAEC → planned for SS3", fresh?.class_level, "SS3");

    const cancelled = await ctx.agent.tool({ as: p.learner, tool: "cancel_study_prep_session", mode: "live", input: {} });
    ctx.note(`cancel: ${JSON.stringify(cancelled).slice(0, 300)}`);
    ctx.expect.eq("the learner can cancel it from the chat", cancelled?.cancelled, true);
    const [after] = started?.sessionId ? await ctx.db.rows("edu.study_prep_sessions", { id: started.sessionId }, { columns: "status", limit: 1 }) : [];
    ctx.expect.eq("…and it is cancelled", after?.status, "cancelled");
    const none = await ctx.agent.tool({ as: p.learner, tool: "cancel_study_prep_session", mode: "live", input: {} });
    ctx.expect.eq("nothing left to cancel", none?.cancelled, false);
  },
};

// Phase 6 (2026-10-20): Study Prep → Teaching → Study Prep. A missed Agent
// Check (simulated: the handoff is offered with its gaps, no battle is run)
// offers a teaching session on the card; the learner's tap sets it up on the
// dashboard (the start_teaching_session tool row in the chat); the dashboard's
// session is tied to the live teaching socket, reports its parts, and its end
// unlocks the retest. The session is cancelled at the end, before any retest
// could start. The auto-approve after a minute is unit-tested (it would
// approve real learners' offers early if run here with a later clock).
export const teachingHandoff = {
  name: "studyprep.teaching_handoff", area: "study-prep", risk: "write",
  description: "A missed check offers a teaching session on its gaps (card: proposed + auto-approve time); a tap puts it on the dashboard with a 'Teaching session created' tool row; the live session ties to it, its parts reach the Study Prep stream, and its end confirms the teach-back.",
  params: { learner: { default: "@tester16" }, subject: { default: "Basic Science" }, classLevel: { default: "JSS3" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { getWorkflowHarness, teachingHandoff: handoffOf } = await import("../../adaptive-learning/study-prep/wiring.js");
    const harness = getWorkflowHarness();
    const handoff = handoffOf();
    const active = await ctx.http({ as: p.learner, path: "/api/adaptive/study-prep/sessions" });
    if (active.body?.session?.id) await harness.cancelSession({ sessionId: active.body.session.id, learnerId: me.id }).catch(() => {});

    const session = await harness.createSession({ learnerId: me.id, goal: `${ctx.marker} Revise ${p.subject}`, subject: p.subject, classLevel: p.classLevel, examBoard: "BECE" });
    const [linked] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "*", limit: 1 });
    const wfId = linked?.workflow_id;
    if (!wfId) ctx.expect.blocked("the session has no workflow instance");
    ctx.cleanup(async () => {
      await harness.cancelSession({ sessionId: session.id, learnerId: me.id }).catch(() => {});
      await ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { parent_workflow_id: wfId } });
      await ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: wfId } });
      await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: session.id } });
    });
    const syllabus = await harness.resolveSyllabus({ sessionId: session.id, learnerId: me.id });
    if (!syllabus.found || !syllabus.topics.length) ctx.expect.blocked(`no ${p.classLevel} ${p.subject} syllabus to plan from`);
    await harness.proposePlan({ sessionId: session.id, learnerId: me.id, topicIds: [syllabus.topics[0].id] });
    await harness.confirmPlan({ sessionId: session.id, learnerId: me.id });
    const view = await harness.getSessionView({ sessionId: session.id, learnerId: me.id, eventLimit: 1 });
    const topic = view.topics.find((t) => t.status === "active");
    if (!topic) ctx.expect.blocked("no active topic after confirming");
    const [row] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "*", limit: 1 });

    // 1. The missed check's offer.
    const offered = await handoff.propose({ session: row, topic, outcome: "retest_offered", gaps: ["Why water moves into a cell", "What plasmolysis is"] });
    ctx.expect.eq("offered on the card first", offered?.state, "proposed");
    const card = await ctx.http({ as: p.learner, path: `/api/adaptive/study-prep/sessions/${session.id}` });
    ctx.expect.eq("the card's view carries the offer", card.body?.teaching?.workflowId, offered?.workflowId);
    ctx.expect.ok("…with when it sets itself up", !!card.body?.teaching?.autoApproveAt, card.body?.teaching);
    const listed0 = await ctx.http({ as: p.learner, path: "/api/adaptive/study-prep/teaching-sessions" });
    ctx.expect.ok("not on the dashboard before it's approved", !(listed0.body?.sessions || []).some((s) => s.workflowId === offered?.workflowId));

    // 2. The learner's tap: start_teaching_session.
    const approved = await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/study-prep/sessions/${session.id}/topics/${topic.id}/teaching/approve`, body: {} });
    ctx.expect.eq("the tap sets it up", approved.body?.teaching?.state, "scheduled");
    const listed = await ctx.http({ as: p.learner, path: "/api/adaptive/study-prep/teaching-sessions" });
    const onDash = (listed.body?.sessions || []).find((s) => s.workflowId === offered?.workflowId);
    ctx.expect.ok("on the dashboard", !!onDash, listed.body);
    ctx.expect.eq("…with what to teach", JSON.stringify(onDash?.focus || []), JSON.stringify(["Why water moves into a cell", "What plasmolysis is"]));
    // It is an ordinary session in the dashboard's own list (My Sessions → Agent), opened by its row.
    const rowId = approved.body?.teaching?.adaptiveSessionId;
    if (rowId) ctx.cleanup(() => ctx.db.deleteOwned("edu.adaptive_sessions", { ownerColumn: "student_id", ownerId: me.id, filters: { id: rowId } }));
    const dashList = await ctx.http({ as: p.learner, path: "/api/adaptive/teaching/sessions" });
    const rows = dashList.body?.sessions || dashList.body?.data || [];
    const item = rows.find((r) => r.id === rowId || r.sessionId === rowId);
    ctx.expect.ok("start_teaching_session made a session in the dashboard's list", !!item, { rowId, listed: rows.length });
    ctx.expect.ok("…that the list offers to continue (it has its opening note)", item ? (item.hasHistory !== false) : false, item);
    const byRow = await handoff.forSessionRow({ learnerId: me.id, adaptiveSessionId: rowId });
    ctx.expect.eq("the modal opening that row finds its workflow", byRow?.workflowId, offered?.workflowId);

    // 3–5. The live session (what the socket does), its parts, its end.
    const bound = await handoff.bind({ workflowId: offered.workflowId, learnerId: me.id, liveSessionId: `fresh_${me.id}_${Date.now()}` });
    ctx.expect.eq("opened from the dashboard: teaching", bound?.state, "teaching_active");
    await handoff.progress({ workflowId: offered.workflowId, result: { subtopicIdx: 1, totalSubtopics: 2, currentPhase: "PHASE_1" } });
    const finished = await handoff.finish({ workflowId: offered.workflowId, endResult: { totalTurns: 4, learnerEvidenceScore: 60 }, notesAdded: 3 });
    ctx.expect.eq("ended: completed", finished?.view?.state, "completed");
    const [after] = await ctx.db.rows("edu.study_prep_topics", { id: topic.id }, { columns: "learner_confirmed_ready, status", limit: 1 });
    ctx.expect.eq("the end confirmed the teach-back (the retest unlocks)", after?.learner_confirmed_ready, true);

    const events = await ctx.db.rows("edu.workflow_events", { workflow_id: wfId }, { columns: "event_type, visibility, payload", limit: 300, order: { column: "sequence", ascending: true } });
    const of = (type) => events.filter((e) => e.event_type === type);
    ctx.note(events.filter((e) => e.payload?.narrative && e.visibility === "learner").map((e) => `${e.event_type}: ${e.payload.narrative}`).slice(-8).join(" | "));
    ctx.expect.ok("the card was asked", of("learner.action_required").some((e) => e.payload?.kind === "teaching_handoff"));
    ctx.expect.ok("the chat shows the tool row", of("tool.completed").some((e) => e.payload?.tool === "teaching.start_session" && e.payload?.resultLine === "On your dashboard"));
    ctx.expect.ok("…and where to find it", of("activity").some((e) => /on your dashboard/i.test(e.payload?.message || "")));
    ctx.expect.ok("a part taught reached Study Prep", of("teaching.phase_changed").some((e) => /1 of 2 parts taught/.test(e.payload?.narrative || "")));
    ctx.expect.ok("…and the end", of("workflow.handoff_completed").some((e) => /You finished teaching/.test(e.payload?.narrative || "")));
    // The retest would start a minute after the teach-back: end the plan now (the cleanup cancels it too).
    await harness.cancelSession({ sessionId: session.id, learnerId: me.id }).catch(() => {});
  },
};
