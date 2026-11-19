/**
 * battle/service.js — request orchestration for the battle router. One export
 * per handler; the router only names them. No SQL here (store.js owns the
 * queries) and no rules here (rules.js owns the pure decisions).
 *
 * The handlers are split by resource to stay small:
 *   service-create    → open lobby, session battle, guide review
 *   service-class     → classes, class roster, class invite
 *   service-course    → course roster and course invite
 *   service-listings  → my battles/challenges, participants, listings, series
 *   service-challenge → accept/decline/join/start/end, state, heartbeat
 *   service-battle    → detail, results, questions, edit/delete, stats
 *   service-bank      → the course question bank
 *   service-health    → the operational /health diagnosis
 */
export { battleHealth } from "./service-health.js";
export { createOpenBattle, createSessionBattle, guideReview } from "./service-create.js";
export { myClasses, classRoster, classInvite } from "./service-class.js";
export { courseRoster, courseInvite } from "./service-course.js";
export {
  myBattles, myChallenges, battleParticipants,
  courseChallenges, challengeDetail, openBattleLobby, courseBattles, sessionBattles,
  battleLog, skipSeriesOccurrence, optOutOfSeries, endRecurringSeries,
} from "./service-listings.js";
export {
  battleEntry, acceptChallenge, declineChallenge, cancelChallenge,
  joinBattle, battleHeartbeat, battleState, startBattleNow, endBattleNow, answerNotAccepted,
} from "./service-challenge.js";
export {
  battleDetail, battleResults, battleQuestionsPdf, battleQuestions,
  editBattle, deleteBattle, instructorStats,
} from "./service-battle.js";
export {
  listBankQuestions, createBankQuestion, updateBankQuestion,
  retireBankQuestion, generateBankQuestions,
} from "./service-bank.js";
