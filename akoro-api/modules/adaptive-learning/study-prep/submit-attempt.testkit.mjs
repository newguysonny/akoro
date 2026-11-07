/**
 * The in-memory twin of edu.study_prep_submit_attempt (migrations/
 * 2026-study-prep-topic-states.sql) for contract tests: the same contract —
 * score + run record + topic outcome written together, once; a second submit
 * changes nothing and reports the recorded score; only a topic that is
 * checking (diagnostic | retest) with its run *_ready takes answers.
 * Not a test file itself (no .test.mjs suffix).
 *
 *   memorySubmitAttempt({ store, runs, key, passThreshold?, maxAttempts? })
 *     store: { topics: Map, sessions: Map } (or a () => store getter)
 *     runs:  Map runId → { status, current_attempt, max_attempts?, pass_threshold? }
 */
import { scoreAttempt } from "./education-engine.js";
import { runStatusAfterScore, topicStateAfterScore } from "./state-machine.js";

export function memorySubmitAttempt({ store, runs, key, passThreshold = 0.7, maxAttempts = 3 }) {
  return async ({ learnerId, sessionId, topicId, runId, answers }) => {
    const s = typeof store === "function" ? store() : store;
    const run = runs.get(runId);
    const topic = s.topics.get(topicId);
    const session = topic ? s.sessions.get(topic.session_id) : null;
    if (!run || !topic || topic.session_id !== sessionId || session?.learner_id !== learnerId || topic.exam_prep_run_id !== runId) return { notFound: true };
    run.submitted ||= {};
    const n = run.current_attempt;
    if (run.submitted[n]) return { ok: true, applied: false, duplicate: true, code: "attempt_already_submitted", score: run.submitted[n].score, topic };
    if (!["diagnostic", "retest"].includes(topic.status)) return { ok: false, applied: false, code: "invalid_state_transition", topic };
    if (!["diagnostic_ready", "retest_ready"].includes(run.status)) return { ok: false, applied: false, code: "attempt_not_ready", topic };
    const scored = scoreAttempt(key, answers);   // invalid answers throw before anything is written
    const threshold = Number(run.pass_threshold ?? passThreshold);
    const cap = Number(run.max_attempts ?? maxAttempts);
    const passed = scored.score >= threshold;
    const capped = !passed && Number(topic.attempts_used) >= cap;
    run.submitted[n] = { score: scored.score };
    run.status = runStatusAfterScore({ passed, currentAttempt: n, maxAttempts: cap });
    run.last_score = scored.score;
    const next = { ...topic, status: topicStateAfterScore({ passed, capped }), learner_confirmed_ready: false };
    s.topics.set(topic.id, next);
    return { ok: true, applied: true, score: scored.score, correct: scored.correct, total: scored.total, passed, capped, topic: next };
  };
}
