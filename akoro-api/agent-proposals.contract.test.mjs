/**
 * agent-proposals.contract.test.mjs — Full Autonomy steps 2+3.
 *
 * Step 2 (proposal inbox): edu.agent_proposals + edu.autonomy_runs;
 * /api/agent/proposals list/approve/dismiss where APPROVAL REPLAYS the
 * exact chat tool (executeChatTool) — one execution path, HITL enforced
 * by a claim-first status flip.
 * Step 3 (the cycle): nightly queue + scheduler, DB-only signals, ONE
 * metered json_object reasoning call, server-side validation (≤3/run,
 * ≤5 pending, 7d TTL, quiet hours 20:00–07:30 Africa/Lagos), level-2
 * planner opt-in, agent:activity emission.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(ROOT, ...p), "utf8");

const proposalsSql = read("migrations/2026-agent-proposals.sql");
const plannerSql = read("migrations/2026-autonomy-planner.sql");
const proposalsRoutes = read("modules/agent-proposals/routes.js");
const cycle = read("modules/autonomy/cycle.js");
const autonomyIndex = read("modules/autonomy/index.js");
const cadence = read("modules/autonomy/cadence.js");
const appJs = read("app.js");
const learnerAutonomy = read("modules/adaptive-learning/learner-autonomy.js");
const chatJs = read("modules/adaptive-learning/chat.js");
const tab = read("../akoro-learner/src/components/tabs/AgentChatTab.jsx");
const dash = read("../akoro-learner/src/pages/LearnerDashboard.jsx");
const en = read("../akoro-learner/src/contexts/i18n/en.js");

test("step 2 · agent_proposals + autonomy_runs migrations with HITL provenance", () => {
  assert.match(proposalsSql, /CREATE TABLE IF NOT EXISTS edu\.agent_proposals/);
  assert.match(proposalsSql, /kind\s+TEXT NOT NULL CHECK\s*\(\s*kind IN \('task','session','goal','practice','battle','plan_digest'\)\s*\)/);
  assert.match(proposalsSql, /status\s+TEXT NOT NULL DEFAULT 'proposed'[\s\S]*?CHECK\s*\(\s*status IN \('proposed','approved','dismissed','expired','executed','failed'\)\s*\)/);
  // agent-sourced goals arrive ONLY through an approved proposal
  assert.match(proposalsSql, /source\s+TEXT NOT NULL DEFAULT 'cycle' CHECK\s*\(\s*source IN \('cycle','event','chat'\)\s*\)/);
  assert.match(proposalsSql, /executed_ref UUID/);
  assert.match(proposalsSql, /expires_at\s+TIMESTAMPTZ\s+NOT NULL DEFAULT \(now\(\) \+ INTERVAL '7 days'\)/);
  assert.match(proposalsSql, /CREATE TABLE IF NOT EXISTS edu\.autonomy_runs/);
  assert.match(proposalsSql, /idx_edu_agent_proposals_user/);
  // planner level + pacing
  assert.match(plannerSql, /ADD COLUMN IF NOT EXISTS level SMALLINT NOT NULL DEFAULT 1/);
  assert.match(plannerSql, /learner_agent_autonomy_level_check[\s\S]*?CHECK \(level IN \(1, 2\)\)/);
  assert.match(plannerSql, /ADD COLUMN IF NOT EXISTS last_cycle_at TIMESTAMPTZ/);
});

test("step 2 · approval claims first, executes via the SAME chat tools, never forked", () => {
  // claim-first: the status flip is guarded on 'proposed' so a double-tap
  // or replay executes at most once
  assert.match(proposalsRoutes, /\.update\(\{\s*status:\s*"approved",\s*decided_at:\s*now\(\)\s*\}[\s\S]*?\.eq\("status", PENDING\)/);
  // execution rides the chat's own tools — no second write path
  assert.match(proposalsRoutes, /executeChatTool\("create_task",\s*\{\s*priority:\s*"medium",\s*\.\.\.payload\s*\}/);
  assert.match(proposalsRoutes, /executeChatTool\("schedule_chat_follow_up",\s*payload/);
  // agent goals land via the goals table marked source:'agent'
  assert.match(proposalsRoutes, /from\("learner_goals"\)[\s\S]*?source:\s*"agent"/);
  // failed executions release the claim to a visible FAILED state
  assert.match(proposalsRoutes, /status:\s*"failed", decision_note:[\s\S]*?\.eq\("status", "approved"\)/);
  // dismiss records the taste reason for the next cycle's prompt
  assert.match(proposalsRoutes, /DISMISS_REASONS = \["not_useful", "wrong_time", "too_much", "already_doing", "other"\]/);
  assert.match(proposalsRoutes, /decision_note:\s*reason/);
  // 7d TTL sweep on list
  assert.match(proposalsRoutes, /\.lt\("expires_at", now\(\)\)/);
  assert.match(appJs, /app\.use\("\/api\/agent\/proposals", standardLimit, agentProposalsModule\)/);
});

test("step 3 · the cycle: bounded, metered, validated server-side", () => {
  // house rules (plan §9 LOCKED): ≤3 proposals/run, ≤5 pending, 30-day dedupe
  assert.match(cycle, /MAX_PROPOSALS_PER_CYCLE = 3/);
  assert.match(cycle, /MAX_PENDING_PROPOSALS = 5/);
  assert.match(cycle, /DEDUPE_WINDOW_DAYS = 30/);
  // quiet hours 20:00–07:30 Africa/Lagos + the shift-out helper
  assert.match(cycle, /QUIET_START_MIN = 20 \* 60/);
  assert.match(cycle, /QUIET_END_MIN = 7 \* 60 \+ 30/);
  assert.match(cycle, /export function inQuietHours/);
  assert.match(cycle, /export function outsideQuietHours/);
  // ONE reasoning call, structured, metered against the learner's budget
  assert.equal((cycle.match(/openai\.chat\.completions\.create/g) || []).length, 1);
  assert.match(cycle, /response_format:\s*\{\s*type:\s*"json_object"\s*\}/);
  assert.match(cycle, /__userId:\s*userId,\s*__feature:\s*"agent_autonomy"/);
  // budget guard + pacing + level gate
  // weekly budget lives in cadence.js now (one source of truth)
  assert.match(cadence, /AKORO_AUTONOMY_MAX_WEEKLY_RUNS", 30/);
  assert.match(cycle, /const weeklyCap = weeklyRunsCap\(\);/);
  assert.match(cycle, /\? MIN_HOURS_BETWEEN_EVENT_RUNS : cadence\.minCycleHours\) \* 3600 \* 1000/); // nightly ≥20h
  assert.match(cycle, /\(auto\.level \?\? 1\) < 2/);
  // validation clamps and drops — the model never gets the final say
  assert.match(cycle, /shaped\.length >= MAX_PROPOSALS_PER_CYCLE/);
  assert.match(cycle, /Math\.min\(room, MAX_PROPOSALS_PER_CYCLE\)/);
  // agent:activity emission + transparency ledger
  assert.match(cycle, /reportAgentActivity\(userId, "Reviewing your goals…"\)/);
  assert.match(cycle, /Reviewed your goals — \$\{toInsert\.length\} suggestion/);
  assert.match(cycle, /from\("autonomy_runs"\)\.insert/);
});

test("step 3 · nightly scheduler is quota-cheap and worker starts at boot", () => {
  // one tick, small batch, one nightly window — every cadence knob is
  // env-tunable (AKORO_AUTONOMY_*); defaults: 60s tick, 40/tick, 21:00–22:00
  // Africa/Lagos, 20h per learner
  assert.match(autonomyIndex, /QUEUE_NAME = "autonomy-cycle"/);
  assert.match(autonomyIndex, /inNightlyWindow/);
  assert.match(autonomyIndex, /setInterval\(async \(\) =>/);
  assert.match(autonomyIndex, /duePlanners\(limit = autonomyCadence\(\)\.batchLimit\)/);
  // the cadence knobs live in cadence.js — pure module, same defaults as
  // before the env-awareness, unusable values fall back
  assert.match(cadence, /AKORO_AUTONOMY_TICK_MS", derivedTick/);
  assert.match(cadence, /AKORO_AUTONOMY_BATCH_LIMIT", 40/);
  assert.match(cadence, /AKORO_AUTONOMY_MIN_CYCLE_HOURS", 20/);
  assert.match(cadence, /AKORO_AUTONOMY_WINDOW_START_HOUR", 21/);
  assert.match(cadence, /AKORO_AUTONOMY_WINDOW_END_HOUR", 22/);
  assert.match(cadence, /export function inNightlyWindow/);
  // drainDelay/stalledInterval tuned like the other workers (Redis-quota lesson)
  assert.match(autonomyIndex, /drainDelay:\s*60_000/);
  assert.match(autonomyIndex, /stalledInterval:\s*300_000/);
  // the worker MUST carry the traced REDIS_URL connection — BullMQ's
  // 127.0.0.1:6379 default silently killed the planner on remote-Redis
  // deploys (jobs enqueued, never processed)
  assert.match(autonomyIndex, /connection: workerConnection\(\),/);
  assert.match(autonomyIndex, /connection: queueConnection\(\)/);
  // claims rows atomically so multi-replica deploys cannot double-enqueue
  assert.match(autonomyIndex, /\.update\(\{\s*last_cycle_at: new Date\(\)\.toISOString\(\)\s*\}\)/);
  // boot order: migrations self-run before workers; planner after the L1 worker
  assert.match(appJs, /startAutonomyCycleWorker/);
  const la = appJs.indexOf("startLearnerAutonomyWorker()");
  const planner = appJs.indexOf("autonomy.startAutonomyCycleWorker()");
  assert.ok(la > -1 && planner > la, "planner worker must start after the level-1 autonomy worker");
  assert.match(appJs, /skipJob\("autonomy cycle worker"\)/);
  // level plumbing through the persisted opt-in
  assert.match(learnerAutonomy, /level: data\?\.level \?\? 1/);
  assert.match(learnerAutonomy, /Number\.isInteger\(level\) && \[1, 2\]\.includes\(level\)/);
  assert.match(chatJs, /level: typeof req\.body\.level === "number" \? req\.body\.level : undefined/);
});

test("step 2 · the Suggestions inbox renders proposals; planner toggle in the drawer", () => {
  // proposals fetch + approve/dismiss through the inbox API
  assert.match(tab, /apiGet\('\/api\/agent\/proposals'\)/);
  assert.match(tab, /apiPost\(`\/api\/agent\/proposals\/\$\{p\.id\}\/approve`,\{\}\)/);
  assert.match(tab, /apiPost\(`\/api\/agent\/proposals\/\$\{p\.id\}\/dismiss`,\{\}\)/);
  // one request at a time (xviii rule) + optimistic executed state
  assert.match(tab, /if\(proposalBusyId\) return;/);
  assert.match(tab, /\{\.\.\.x,status:'executed'\}/);
  // the Suggestions chip counts proposals too
  assert.match(tab, /suggestionCount=suggestions\.length\+pendingProposals\.length/);
  assert.match(tab, /k==="suggestions"&&suggestionCount>0&&/);
  assert.match(tab, /agent\.proposals_from_review/);
  // approval reflects back into the transcript (agent observes, never assumes)
  assert.match(tab, /pushAgent\(t\('agent\.proposal_done_task'\)\.replace\('\{title\}',d\?\.data\?\.title\|\|p\.title\)\)/);
  assert.match(tab, /refetchTasks\(\)/);
  // combined switch: the dashboard online/offline control is the ONE
  // consent — online enables due-task check-ins AND the background planner
  // (level 2) together; offline pauses both and keeps the level
  assert.match(dash, /next \? \{ enabled: true, level: 2 \} : \{ enabled: false \}/);
  // the drawer no longer carries a second planner switch
  assert.doesNotMatch(tab, /plannerOn|togglePlanner/);
  assert.doesNotMatch(tab, /apiPatch\('\/api\/adaptive\/chat\/autonomy'/);  // i18n coverage (en)
  for (const key of ["agent.proposals_from_review", "agent.proposal_approve", "agent.proposal_kind_session",
    "agent.proposal_done_session", "agent.planner", "agent.planner_sub", "agent.planner_error"]) {
    assert.ok(en.includes(`'${key}'`), `missing i18n key ${key}`);
  }
});
