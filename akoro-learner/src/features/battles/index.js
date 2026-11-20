// Battles feature — public surface.
//
// The battle arena (BattleModal), the Battles/Challenges lists, the create and
// participant sheets, and the challenge-item helpers. Features only see this
// file; shared code lives in src/{components,contexts,hooks,lib,services,utils,client}.
export { default } from './components/BattleModal.jsx';
export { default as BattleModal } from './components/BattleModal.jsx';
export { default as BattleArenaTab } from './components/BattleArenaTab.jsx';
export { default as BattleStatsTab } from './components/BattleStatsTab.jsx';
export { default as BattleLogTab } from './components/BattleLogTab.jsx';
export { default as BattleQuestionsTab } from './components/BattleQuestionsTab.jsx';
export { default as BattlesTab, ChallengeRow, matchup } from './components/BattlesTab.jsx';
export { default as ChallengeModal, formatLeft } from './components/ChallengeModal.jsx';
export { default as ChallengesList, ChallengeCard, RequestSheet, SeriesSheet } from './components/ChallengesList.jsx';
export { default as CreateBattleSheet } from './components/CreateBattleSheet.jsx';
export { default as NoAgentSheet, isNoAgentError } from './components/NoAgentSheet.jsx';
export { default as ParticipantsSheet } from './components/ParticipantsSheet.jsx';
export { default as SheetFrame, useDesktop } from './components/SheetFrame.jsx';
export {
  repeatsLabel, fromInvite, fromRequest, mergeItems, challengeItems, waitingItems, filterItems,
} from './components/challengeItems.js';
