/** Battles: lobby/entry rules, question sources, checks, series, and results. */

export { buildQuestions, collectQuestions, generate, presetQuestions } from "./questionSource.js";
export { answerFromRecall, embedQuestion, guess, recall, recallStrength } from "./agentRecall.js";
export { requestGuideReview, reviewFocus } from "./guideReview.js";
export { classBattleFromChat } from "./chatBattle.js";
export { checkResults, createCheckBattle, discardCheckBattle } from "./agentCheck.js";
export { basedOnBlock, notesBlock } from "./basedOn.js";
export { assertEntry, entryCheck } from "./entry.js";
export {
  NETWORK_LIMITS,
  assignTeams,
  cleanBattleOptions,
  createNetworkBattle,
  seatsFor,
} from "./networkBattle.js";
export { createSeries, runOccurrence } from "./series.js";
export { NETWORK_KEYS, seriesTemplate } from "./seriesCore.js";
export { flagBattleReviewTopics, updateKnowledgeConfidence } from "./knowledge.js";
export { autoPlayers, thinkingTimeMs } from "./agentPlayer.js";
