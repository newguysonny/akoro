/**
 * modules/self-tooling/pipeline.js — the custom-tool pipeline entry
 * (plan §7.4, §7.9, §7.10). Stages 1 (recipe), 2 (spec), 3 (sandboxed code,
 * sandbox/ — on by default; AKORO_SELF_TOOLING_CODE_ENABLED=false turns it off)
 * and 4 (escalate to an admin, escalation.js).
 *
 * The implementation is split by responsibility; this file is the module entry
 * that keeps the historical import surface:
 *
 *   pipeline-create.js  createTool, validation, reuse, escalation, build loop, save paths
 *   pipeline-dry.js     domain/spec dry runs and the domain build guard
 *   pipeline-verify.js  execution and assertion evaluation
 *   pipeline-io.js      tool-definition storage and the catalogue
 *   rules.js            pure shape/normalisation/validation helpers
 *
 *   createTool  → { status: created|escalated|rejected, … }   one call in, one status out
 *   runLearnerTool / learnerToolDefs / listMyTools / setMyToolStatus
 */
export {
  LIMITS,
  REBUILD_HONESTY,
  asksAboutOthersInBattles,
  hardCodedTargets,
  howToUse,
  inventedDates,
  isAnswerOnlyRead,
  mergedRowRule,
  needsCode,
  othersCapabilityFirst,
  pickReplacement,
  presentMergedToolRow,
  toolActions,
  toolDef,
  toolParamNames,
  visibleActions,
} from "./rules.js";
export {
  activateBuiltTool,
  archiveUnusedTools,
  forcedSelfTool,
  getChatsToolState,
  getLibraryToolState,
  getMergedToolState,
  learnerToolDefs,
  learnerToolDefsWithAreas,
  listMyTools,
  runChatsViewAction,
  runLearnerTool,
  runLibraryViewAction,
  runMergedViewAction,
  saveComputation,
  updateMyTool,
} from "./pipeline-io.js";
export { createTool } from "./pipeline-create.js";
