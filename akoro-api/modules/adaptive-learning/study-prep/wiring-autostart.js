/**
 * study-prep/wiring-autostart.js — the Study Prep sweeps, extracted from
 * wiring.js: the 1-minute Agent Check auto-start, its "nothing to check" line
 * and the interval that also auto-approves due teaching handoffs.
 */

import db from "../../../db.js";
import { supabaseStore as store } from "./store.js";
import { TOPIC_STARTABLE_STATES } from "./state-machine.js";
import { workflowEngineEnabled } from "./workflow.js";
import { AUTO_START_MS, autoStartFor, spentOnChecks } from "./wake.js";
import {
  agentCheckEnabled, getHarness, studyPrepEnabled, teachingHandoff,
  topicWorkflow, wakeRunning, wakeStudyPrep, workflowMirror,
} from "./wiring.js";

/**
 * The 1-minute auto-start (2026-10-19): every few seconds, an active topic
 * whose next Agent Check is due (a first check a minute after the topic
 * started, a retest a minute after the teach-back) starts it — inside the
 * approved estimate only. Past the estimate the agent asks, once.
 */
const asked = new Set();
const failedAt = new Map();
export async function autoStartDueChecks({ nowMs = Date.now(), sessionId = null } = {}) {
  if (!studyPrepEnabled() || !agentCheckEnabled()) return { started: 0, skipped: 0 };
  const cutoff = new Date(nowMs - AUTO_START_MS).toISOString();
  // sessionId: one session only (the gate's, run with a later clock).
  let query = db.schema("edu").from("study_prep_topics").select("id, session_id")
    .in("status", TOPIC_STARTABLE_STATES).lte("updated_at", cutoff);
  if (sessionId) query = query.eq("session_id", sessionId);
  const { data: rows, error } = await query.order("updated_at", { ascending: true }).limit(25);
  if (error) throw error;
  let started = 0;
  let skipped = 0;
  for (const row of rows || []) {
    if (nowMs - (failedAt.get(row.id) || 0) < 10 * 60_000) continue;
    const session = await store.getSession(row.session_id).catch(() => null);
    if (!session || session.status !== "topic_active" || wakeRunning(session.id)) continue;
    const harness = getHarness();
    const view = await harness.getSessionView({ sessionId: session.id, learnerId: session.learner_id, eventLimit: 500 }).catch(() => null);
    const topic = view?.topics?.find((t) => t.id === row.id);
    if (!topic) continue;
    const policy = await topicWorkflow.policyFor({ examBoard: session.exam_board, subject: session.subject }).catch(() => null);
    const due = autoStartFor(topic, view.session, { spent: spentOnChecks(view.events), maxAttempts: policy?.max_attempts ?? Infinity });
    if (!due) continue;
    if (due.blocked === "over_estimate") {
      const key = `${topic.id}:${topic.attemptsUsed}`;
      if (!asked.has(key)) { asked.add(key); wakeStudyPrep({ sessionId: session.id, learnerId: session.learner_id, trigger: "over_estimate", facts: { topic: topic.label } }); }
      continue;
    }
    if (Date.parse(due.at) > nowMs) continue;
    try {
      const done = await harness.startTopicPractice({ sessionId: session.id, learnerId: session.learner_id, topicId: topic.id, mode: due.mode, withinEstimateOnly: true });
      if (done?.skipped) { skipped += 1; if (!done.skipped.already) await sayNothingToCheck(session.id, topic.label); } else started += 1;
    } catch (error) {
      failedAt.set(row.id, nowMs);
      console.warn(`[study-prep] auto-start failed for topic ${row.id}: ${error?.message || error}`);
    }
  }
  return { started, skipped };
}

/** An Agent Check found no notes to check: the agent says so in the chat (code-written, no model call). */
export async function sayNothingToCheck(sessionId, topicLabel) {
  if (!workflowEngineEnabled()) return;
  await workflowMirror().agentMessage(sessionId, store, {
    text: `I went to start the Agent Check on ${topicLabel || "this topic"}, but you haven't taught me anything on it yet — so there's nothing to check, and nothing was charged. Teach me about it here, then tap Start Agent Check on the card.`,
  }).catch(() => null);
}

let autoStartTimer = null;
export function startStudyPrepAutoStart({ everyMs = 15_000 } = {}) {
  if (autoStartTimer) return autoStartTimer;
  autoStartTimer = setInterval(() => {
    autoStartDueChecks().catch((e) => console.warn(`[study-prep] auto-start sweep: ${e?.message || e}`));
    // A teaching session nobody confirmed for a minute is set up by itself.
    if (studyPrepEnabled() && workflowEngineEnabled()) teachingHandoff().autoApproveDue().catch((e) => console.warn(`[study-prep] teaching auto-approve: ${e?.message || e}`));
  }, everyMs);
  autoStartTimer.unref?.();
  return autoStartTimer;
}
