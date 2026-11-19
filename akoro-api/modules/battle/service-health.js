/**
 * battle/service-health.js — the public /health diagnosis: is the realtime
 * pipeline alive (Redis + queue), do live battles have questions, and is
 * anything actually playing? Kept apart from the battle handlers because it
 * answers an operational question rather than serving a learner.
 */
import { getBattleQueue } from "./service-core.js";
import { battles, questions } from "./store.js";

export async function battleHealth(req, res) {
  const out = { socket: !!global.io };

  // Redis / queue
  try {
    const q = await getBattleQueue();
    out.redis = "up";
    out.queue = await q.getJobCounts("active", "waiting", "delayed", "completed", "failed");
  } catch (err) { out.redis = "down"; out.queueError = err.message; }

  // Data coverage — do live battles actually have questions to render?
  try {
    const { data: liveB } = await battles.liveBattlesCoverage();
    const ids = (liveB ?? []).map((b) => b.id);
    const { data: qrows } = await questions.battleQuestionIds(ids);
    const withQ = new Set((qrows ?? []).map((r) => r.battle_id));
    const missing = (liveB ?? []).filter((b) => !withQ.has(b.id));
    out.battles = {
      live: ids.length,
      withQuestions: ids.length - missing.length,
      missingQuestions: missing.length,
      sampleMissing: missing.slice(0, 3).map((b) => ({ id: b.id, title: b.title })),
      sampleReady:   (liveB ?? []).filter((b) => withQ.has(b.id)).slice(0, 3).map((b) => ({ id: b.id, title: b.title, type: b.battle_type })),
    };
  } catch (err) { out.battlesError = err.message; }

  // ── Is anything actually PLAYING? ────────────────────────────────────────
  // "The battle doesn't play" has several possible causes that look identical
  // from the outside: agents were never scheduled (a battle started by an older
  // deploy), the queue is not draining, or it is simply early — with a
  // 15-minute duration over 15 questions each agent answers somewhere in a
  // 60-second window, so a freshly started battle showing 0–0 is normal.
  // Guessing between those cost a diagnosis, so the answer is reported here.
  try {
    const q = await getBattleQueue();
    const { data: liveB } = await battles.liveBattlesStarted();

    const jobs = await q.getJobs(["delayed", "waiting", "active"]);
    const pendingByBattle = new Map();
    for (const j of jobs) {
      if (j?.name !== "agent-answer") continue;
      const id = j.data?.battleId;
      pendingByBattle.set(id, (pendingByBattle.get(id) ?? 0) + 1);
    }

    const ids = (liveB ?? []).map((b) => b.id);
    const { data: answered } = await questions.answerBattleIds(ids);
    const answerCount = new Map();
    for (const a of (answered ?? [])) answerCount.set(a.battle_id, (answerCount.get(a.battle_id) ?? 0) + 1);

    out.play = (liveB ?? []).map((b) => {
      const answers = answerCount.get(b.id) ?? 0;
      const pending = pendingByBattle.get(b.id) ?? 0;
      const ageSec  = b.actual_start ? Math.round((Date.now() - new Date(b.actual_start)) / 1000) : null;
      return {
        id: b.id, title: b.title, startedSecondsAgo: ageSec,
        answers, pendingAgentJobs: pending,
        // The verdict, in one word, so nobody has to interpret the numbers.
        // `ageSec ?? 0` would have read a NULL actual_start as "0 seconds old"
        // and so reported "just started" for ever — which is exactly the kind of
        // reassuring-but-false answer this endpoint exists to avoid. A live
        // battle with no start time never really started.
        verdict: answers > 0        ? "playing"
               : pending > 0        ? "agents queued — waiting for their thinking time"
               : ageSec == null     ? "live but never started — no actual_start"
               : ageSec < 90        ? "just started — no answers yet is normal"
               : "STUCK — no answers and no agent jobs queued",
      };
    });
  } catch (err) { out.playError = err.message; }

  res.json({ ok: out.redis === "up", ...out });
}
