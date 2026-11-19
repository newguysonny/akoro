/** Agent context: strategy manifests, prompt assembly, personas, overrides. */

export { assembleChatDoctrine, protegeIdentity, tutorSystemPrompt } from "./chat-doctrine.js";
export {
  CONTEXT_BUDGET,
  CONTEXT_MANIFEST,
  CONTEXT_SETS,
  CONTEXT_SET_NAMES,
  MANIFEST_VERSION,
  PENDING_ADOPTION,
  buildAgentContext,
  clearContextCache,
  contextSetFor,
  contextVersion,
  loadContext,
  loadDefaultRaw,
  loadDoctrine,
  loadRaw,
  preflight,
} from "./context-manager.js";
export { SETS } from "./manifest.mjs";
export {
  ContextUnavailableError,
  LIVE_OPERATIONS,
  OPERATION_SETS,
  operationRows,
  teachingTurnOperation,
} from "./operations.mjs";
export {
  createOverrideCache,
  hashText,
  overridesInstalled,
  partStatus,
} from "./overrides.js";
export {
  PromptPartError,
  assembledPrompt,
  editPart,
  installPromptOverrides,
  keepMine,
  listParts,
  partHistory,
  promptSets,
  readPart,
  resetPart,
  useNewDefault,
} from "./override-store.js";
export { buildStudentCloneAnalyzePrompt, buildStudentCloneReplyPrompt } from "./personas/student-clone.js";
export {
  buildClassAnalyticsPrompt,
  buildCoachTurnPrompt,
  buildEvaluateSessionPrompt,
  buildEvaluateSubtopicPrompt,
  buildEvidenceInstruction,
  buildKnowledgeMapPrompt,
  buildMustKnowPrompt,
  buildObjectivesPrompt,
  buildOpenSubtopicPrompt,
  buildPushFurtherPrompt,
  buildTipDecisionPrompt,
} from "./personas/nana-esumai.js";
export {
  buildAssessmentDriftPrompt,
  buildAssessmentEvaluatePrompt,
  buildAssessmentQuestionsPrompt,
  buildAssessmentVerdictPrompt,
  buildProctorEvaluatePrompt,
  buildProctorHintPrompt,
  buildProctorProbePrompt,
  buildProctorQuestionsPrompt,
  buildProctorVerdictPrompt,
} from "./personas/sargeant.js";
export {
  buildDecayMustKnowPrompt,
  buildMergeNotesPrompt,
  buildStudentAgentAnalyzePrompt,
  buildStudentAgentEvidencePrompt,
  buildStudentAgentExtractPrompt,
  buildStudentAgentReplyPrompt,
  personalityBand,
  studentPersonality,
} from "./personas/student.js";
export {
  buildTrainedBoundaryPrompt,
  buildTrainedControlDriftPrompt,
  buildTrainedEvaluateSessionPrompt,
  buildTrainedGuideTipPrompt,
  buildTrainedMustKnowPrompt,
  buildTrainedStudentReplyPrompt,
  trainedShell,
} from "./personas/trained.js";
