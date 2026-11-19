/**
 * lib/agentDepsSetup.js — the values lower modules used to reach into
 * adaptive-learning for. app.js installs them once at boot; the verify
 * scenario harness installs the same set because it never boots app.js.
 *
 * Phase 19 step 2 (S8b): the same install also fills the narrow boot bridges
 * (chat, teaching workflow, learning recorder, Study Prep, persona) so those
 * consumers never import adaptive-learning internals.
 */
import { setAgentDeps } from "./agentDeps.js";
import { setChatBridge } from "./chatBridge.js";
import { setTeachingWorkflowBridge } from "./teachingWorkflowBridge.js";
import { setLearningRecordBridge } from "./learningRecordBridge.js";
import { setStudyPrepHooks } from "./studyPrepHooks.js";
import { setVerificationAssertions } from "./verificationAssertions.js";
import {
  protegeDeps, tutorSystemPrompt, executeChatTool, scheduleDecisionContinuation,
  selfToolDeps, runAgentToolLoop, getLearnerChatTools, SIDE_EFFECT_TOOLS,
  CHAT_TOOLS, INSTRUCTOR_TOOLS, openAiInstructorTools,
} from "../modules/adaptive-learning/chat.js";
import { loadTaughtKnowledge, renderTaughtContext } from "../modules/adaptive-learning/social/protege.js";
import { helpsOthers, conceptIdFor } from "./peerConsult.js";
import { setLearnerAutonomy, cancelAutonomyReviewForTask, scheduleAutonomyReviewForTask } from "../modules/adaptive-learning/learner/learner-autonomy.js";
import { resolveTopics } from "../modules/adaptive-learning/study-prep/syllabus-resolver.js";
import { collectMaterials, materialsFrom } from "../modules/adaptive-learning/chat/chat-materials.js";
import { readChat } from "../modules/adaptive-learning/chat/chat-history-tools.js";
import { TEACHING_TURN_WORKFLOW } from "../modules/adaptive-learning/teaching-workflow/runner.js";
import { prepareTeachingSession, TEACHING_MODES } from "../modules/adaptive-learning/teaching-session/start.js";
import {
  createSessionRecord, ensureSessionRecord, appendSessionBlocks, completeSessionRecord,
} from "../modules/adaptive-learning/teaching-session/lifecycle.js";
import { carryForward } from "../modules/adaptive-learning/teaching-session/context.js";
import { resultToTypedBlocks } from "../modules/adaptive-learning/teaching-session/blocks.js";
import { recordLearningEvent, refreshConceptRetention } from "../modules/adaptive-learning/learner/learning-events.js";
import { attachUploadsToStudyPrep } from "../modules/adaptive-learning/study-prep/materials-source.js";
import { NaNaEsumai } from "../modules/adaptive-learning/agents/nana-esumai/guide.js";
import { createExpect, repeatVerdict } from "../modules/verify/assertions.js";

export function installAgentDeps() {
  setAgentDeps({
    protegeDeps, tutorSystemPrompt, executeChatTool, scheduleDecisionContinuation, selfToolDeps,
    runAgentToolLoop, getLearnerChatTools, SIDE_EFFECT_TOOLS, loadTaughtKnowledge, renderTaughtContext,
    helpsOthers, conceptIdFor, setLearnerAutonomy, cancelAutonomyReviewForTask, scheduleAutonomyReviewForTask,
    resolveTopics, collectMaterials, materialsFrom, readChat, NaNaEsumai,
  });
  setChatBridge({ CHAT_TOOLS, getLearnerChatTools, INSTRUCTOR_TOOLS, openAiInstructorTools, executeChatTool });
  setTeachingWorkflowBridge({
    TEACHING_TURN_WORKFLOW, prepareTeachingSession, TEACHING_MODES,
    createSessionRecord, ensureSessionRecord, appendSessionBlocks, completeSessionRecord,
    carryForward, resultToTypedBlocks,
  });
  setLearningRecordBridge({ recordLearningEvent, refreshConceptRetention });
  setStudyPrepHooks({ attachUploadsToStudyPrep });
  setVerificationAssertions({ createExpect, repeatVerdict });
}
