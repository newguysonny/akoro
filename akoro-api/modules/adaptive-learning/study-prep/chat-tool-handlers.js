/**
 * study-prep chat-tool handlers (Master Plan §4.8.8). PLAN-ONLY by design:
 * the model can start a planning session and read its state. Confirm,
 * advance, defer and practice are NOT model-callable — the learner presses
 * the buttons in the session UI (S5 §6.3).
 */

import { supabaseStore as store } from "./store.js";
import { getHarness } from "./wiring.js";

const text = (value, maximum) => String(value || "").replace(/[\r\n\x00]+/g, " ").trim().slice(0, maximum);

/** get_study_prep_session — bounded, read-only status for the chat. */
export async function getStudyPrepSessionSummary(learnerId) {
  const { data, error } = await store.findActiveSessionsList(learnerId);
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) {
    return { enabled: true, sessions: [], message: "No study-prep session yet — offer to start one when they ask for exam preparation." };
  }
  const harness = getHarness();
  const sessions = await Promise.all(rows.slice(0, 3).map(async (row) => {
    const view = await harness.getSessionView({ sessionId: row.id, learnerId, eventLimit: 5 });
    return {
      sessionId: view.session.id, status: view.session.status, goal: view.session.goal,
      subject: view.session.subject, pausedReason: view.session.pausedReason,
      topics: view.topics.map((topic) => ({ label: topic.label, status: topic.status })),
      estimate: view.session.estimate,
      recentNarrative: (view.events || []).filter((event) => event.narrative).slice(-2).map((event) => text(event.narrative, 240)),
    };
  }));
  return { enabled: true, sessions };
}
