/**
 * battle/worker-jobs.js — the battle queue's job router: action → the module
 * that runs it. worker.js hands each BullMQ job here.
 */
import { battleJobHandler } from "../../lib/battleJobHandlers.js";
import { startBattle } from "./worker-create.js";
import { advanceQuestion } from "./worker-start.js";
import { revealQuestion, agentAnswer } from "./worker-battle.js";
import { endBattle } from "./worker-end.js";
import { expireBattle, refreshLeaderboard } from "./worker-expire.js";

const runActivityReview = (assignmentId) => battleJobHandler("activity-review")(assignmentId);

export async function handleBattleJob(job) {
  const { action, battleId } = job.data;
  switch (action) {
    case "start-battle":        return startBattle(battleId);
    case "advance-question":    return advanceQuestion(battleId, job.data.questionOrder);
    case "reveal-question":     return revealQuestion(battleId, job.data.questionOrder);
    case "agent-answer":        return agentAnswer(battleId, job.data.questionOrder, job.data.participantId, job.data.thinkingMs);
    case "end-battle":          return endBattle(battleId);
    case "expire-battle":       return expireBattle(battleId);
    case "refresh-leaderboard": return refreshLeaderboard(job.data.courseId, job.data.scope);
    // A recurring series: make the battle that starts at startMs (battle/series.js).
    case "series-occurrence":   return (await import("./series.js")).runOccurrence(job.data.seriesId, job.data.startMs);
    // An activity's review battle: each learner's protégé reviewed (self-study/activityReview.js).
    case "activity-review":     return runActivityReview(job.data.assignmentId);
    default: throw new Error(`Unknown action: ${action}`);
  }
}
