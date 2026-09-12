/**
 * autonomy-cycle-v2.contract.test.mjs — Full Autonomy increment:
 * event-triggered cycles + richer signals + agent↔agent consultation.
 *
 *   • triggers: task-done / submission / self-study-complete / battle-end
 *     hook sites emit best-effort events; the cycle gates them (pace + caps)
 *   • signals: streak (honest completion math), chat topics, battle results,
 *     class work due — DB-only reads feeding ONE metered reasoning call
 *   • peer consult: privacy-by-design (only a sanitized question travels),
 *     peers ≤ 2, asker excluded, asker's budget meters every call, env
 *     kill-switch on the tool schema
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(ROOT, ...p), "utf8");

const triggers = read("modules/autonomy/triggers.js");
const cycle = read("modules/autonomy/cycle.js");
const autonomyIndex = read("modules/autonomy/index.js");
const tasks = read("modules/tasks/routes.js");
const communities = read("modules/communities/routes.js");
const selfStudy = read("modules/self-study/routes.js");
const battleWorker = read("modules/battle/worker.js");
const chatJs = read("modules/adaptive-learning/chat.js");
const peerConsult = read("modules/adaptive-learning/peerConsult.js");

test("event triggers · four real write sites emit, never block, never guess", () => {
  // the seam: debounce in-process, one Redis enqueue, failures swallowed
  assert.match(triggers, /EMIT_COOLDOWN_MS = 15 \* 60 \* 1000/);
  assert.match(triggers, /enqueueAutonomyCycle\(userId, `event:\$\{kind\}`\)/);
  assert.match(triggers, /lastEmit\.delete\(key\)/);
  // hook sites — the real write paths, with fire-and-forget .catch
  assert.match(tasks, /emitAutonomyEvent\(req\.user\.id, "task_done"\)\.catch\(\(\) => \{\}\)/);
  assert.match(tasks, /import \{ emitAutonomyEvent \} from "\.\.\/autonomy\/triggers\.js";/);
  assert.match(communities, /emitAutonomyEvent\(req\.user\.id, "submission"\)\.catch\(\(\) => \{\}\)/);
  assert.match(selfStudy, /emitAutonomyEvent\(req\.user\.id, "self_study"\)\.catch\(\(\) => \{\}\)/);
  assert.match(battleWorker, /for \(const p of participants \?\? \[\]\) \{\s*emitAutonomyEvent\(p\.user_id, "battle"\)\.catch\(\(\) => \{\}\);\s*\}/);
  // per-trigger jobId so event bursts collapse
  assert.match(autonomyIndex, /jobId: `cycle:\$\{userId\}:\$\{trigger\}:\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 13\)\}`/);
});

test("event pacing · events run sooner than nightly but never frenzied", () => {
  assert.match(cycle, /MIN_HOURS_BETWEEN_EVENT_RUNS = 4/);
  assert.match(cycle, /MAX_EVENT_RUNS_PER_DAY = 2/);
  assert.match(cycle, /const isEvent = trigger !== "nightly";/);
  assert.match(cycle, /\(isEvent \? MIN_HOURS_BETWEEN_EVENT_RUNS : 20\) \* 3600 \* 1000/);
  assert.match(cycle, /\.like\("trigger", "event:%"\)/);
  assert.match(cycle, /skipped: "event_cap"/);
});

test("richer signals · streak, chat topics, battles, class work — DB-only, best-effort", () => {
  // the honest streak algorithm (same as /api/self-study/streak)
  assert.match(cycle, /export function computeStreak/);
  assert.match(cycle, /cursor\.setUTCDate\(cursor\.getUTCDate\(\) - 1\); \/\/ grace/);
  assert.match(cycle, /from\("self_study_targets"\)\.select\("completed_at"\)/);
  // new sources, all capped and .catch-quiet
  assert.match(cycle, /from\("chat_sessions"\)\.select\("title"\)[\s\S]*?order\("last_message_at", \{ ascending: false \}\)\.limit\(5\)/);
  assert.match(cycle, /from\("battle_participants"\)\.select\("score, is_winner, final_rank, correct_answers, joined_at"\)/);
  assert.match(cycle, /from\("community_activities"\)\s*$/m);
  assert.match(cycle, /\.lte\("due_at", weekAhead\)/);
  // they reach the ONE reasoning call
  assert.match(cycle, /`Study streak \(days\): \$\{signals\.streakDays\}\\n`/);
  assert.match(cycle, /signals\.recentBattles/);
  assert.match(cycle, /signals\.classWorkDue/);
  assert.match(cycle, /"streak at 5 days"/);
});

test("agent ↔ agent · consult_peer_agents is privacy-by-design and budget-metered", () => {
  // schema ships with a kill-switch and usage guardrails
  assert.match(chatJs, /name: "consult_peer_agents",\s*\n\s*featureGate: "peer_consult",/);
  assert.match(chatJs, /peer_consult: peerConsultEnabled/);
  assert.match(chatJs, /AKORO_AGENT_PEER_CONSULT_ENABLED \?\? "true"/);
  // execution goes through the one dispatch with a clarify() guard
  assert.match(chatJs, /case "consult_peer_agents": \{[\s\S]*?return clarify\("question"/);
  assert.match(chatJs, /import \{ consultPeerAgents, PEER_QUESTION_MIN, PEER_QUESTION_MAX \} from "\.\/peerConsult\.js";/);
  // privacy: ONLY the question travels; contact patterns rejected; asker excluded
  assert.match(peerConsult, /export function sanitizePeerQuestion/);
  assert.match(peerConsult, /EMAIL_LIKE\.test\(question\)/);
  assert.match(peerConsult, /\.neq\("user_id", userId\)/);
  assert.match(peerConsult, /\.eq\("is_active", true\)/);
  assert.match(peerConsult, /MAX_PEERS_PER_CONSULT = 2/);
  assert.match(peerConsult, /PEER_QUESTION_MAX = 300/);
  // the asking learner's budget meters every peer call
  assert.match(peerConsult, /__userId: userId,\s+\/\/ the asking learner's budget/);
  assert.match(peerConsult, /__feature: PEER_CONSULT_FEATURE/);
  assert.equal((peerConsult.match(/openai\.chat\.completions\.create/g) || []).length, 1);
  // replies tightly capped; a failed peer is skipped, not fatal
  assert.match(peerConsult, /PEER_REPLY_MAX_CHARS = 600/);
  assert.match(peerConsult, /Promise\.allSettled\(asks\)/);
  // not in the side-effecting echo list (it writes nothing to this learner)
  assert.doesNotMatch(chatJs, /sideEffecting: \[[^\]]*consult_peer_agents/);
});
