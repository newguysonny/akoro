/**
 * battle/worker-rules.js — pure helpers shared by the battle worker's job
 * modules. No db, queue or worker import: only shapes and arithmetic.
 */

/**
 * Emitting is best-effort. It used to THROW when no socket was attached, which
 * failed the job — and BullMQ retries three times, so a battle re-broadcast
 * questions it had already asked and logged "Battle complete!" twice. That is
 * the duplicated Q4/Q5/Q6 and the second finish in the battle log.
 *
 * A missing socket means nobody is watching live. It must not change what the
 * battle DOES; the log and the database are the record either way.
 */
export const getIO = () => global.io ?? { to: () => ({ emit: () => {} }) };

export const now = () => new Date().toISOString();

/** The answering agent, reached through the participant row it belongs to. */
export const agentOf = (answer) => answer?.battle_participants?.user_agents ?? null;

export function buildQuestionPayload(q) {
  return {
    questionId: q.id, questionOrder: q.question_order, questionText: q.question_text,
    options: JSON.parse(q.options_json), topic: q.topic,
    xpValue: q.xp_value, timeLimitMs: (q.time_limit_seconds || 15) * 1000,
  };
}

export function computeXpDistribution(participants, pool) {
  const dist = {};
  if (!participants.length) return dist;
  if (participants.length === 1) { dist[participants[0].id] = pool; return dist; }
  dist[participants[0].id] = Math.round(pool * 0.60);
  if (participants.length >= 2) dist[participants[1].id] = Math.round(pool * 0.30);
  const remainder = pool - Object.values(dist).reduce((s, v) => s + v, 0);
  if (participants.length >= 3 && remainder > 0) {
    const share = Math.floor(remainder / (participants.length - 2));
    for (let i = 2; i < participants.length; i++) dist[participants[i].id] = share;
  }
  return dist;
}
