/** Self-tooling: learner-built tools, capabilities, confirmations, escalation. */

export { startViewRegistry } from "./viewRegistry.js";
export { armSweep, enqueueResume, startResumeWorker } from "./resumeQueue.js";
export { CAPABILITIES, FORBIDDEN, agreesToBuild, learnerGrantable } from "./capabilities.js";
export {
  LIMITS,
  createTool,
  forcedSelfTool,
  getChatsToolState,
  getLibraryToolState,
  getMergedToolState,
  getToolView,
  learnerToolDefs,
  learnerToolDefsWithAreas,
  listMyTools,
  runChatsViewAction,
  runLearnerTool,
  runLibraryViewAction,
  runMergedViewAction,
  saveComputation,
} from "./pipeline.js";
export {
  LIBRARY_BASE_ACTIONS,
  LIBRARY_MERGED_ACTIONS,
  libraryDeltaActions,
  mergedLibraryDef,
  mergedLibraryEnabled,
} from "./mergedLibrary.js";
export {
  CHATS_BASE_ACTIONS,
  CHATS_MERGED_ACTIONS,
  chatsDeltaActions,
  mergedChatsDef,
  mergedChatsEnabled,
} from "./mergedChats.js";
export { MERGED_DOMAIN_LIST, MERGED_DOMAINS } from "./mergedDomains.js";
export { selfToolingAllowedFor, selfToolingEnabled } from "./access.js";
export { activeGrants, capabilityStatus, learnerGrants, schemaLookup } from "./registry.js";
export { awaitDecision, listConfirmedDecisions } from "./confirmations.js";
export { decideRequest, postIntoChat, revokeGrant } from "./escalation.js";
export {
  analytics,
  auditRow,
  auditRows,
  getTool,
  listTools,
  promoteTool,
  setToolStatus,
  similarTools,
} from "./library.js";
export { isDocumentGoal } from "./toolSimilarity.js";
export { DATA_VIEWS, viewColumns } from "./views.js";
export { runDefinition, validateDefinition } from "./interpreters.js";
export { coerceInput } from "./bind.js";
export { CODE_LIMITS, codeEnabled, runCode, staticCheck } from "./sandbox/index.js";
export { readView } from "./viewRuntime.js";
export { akoroInspect } from "./inspect.js";
export { runModeAction, getToolState } from "./toolState.js";
export { validateModeDefinition } from "./modeSpec.js";
export { UI_COMPONENTS, UI_SLOTS, describeCatalogue, validatePresentation } from "./uiCatalogue.js";
