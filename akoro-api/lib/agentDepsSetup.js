/**
 * lib/agentDepsSetup.js — the values lower modules used to reach into
 * adaptive-learning for. app.js installs them once at boot; the verify
 * scenario harness installs the same set because it never boots app.js.
 */
import { setAgentDeps } from "./agentDeps.js";
import {
  protegeDeps, tutorSystemPrompt, executeChatTool, scheduleDecisionContinuation,
  selfToolDeps, runAgentToolLoop, getLearnerChatTools, SIDE_EFFECT_TOOLS,
} from "../modules/adaptive-learning/chat.js";
import { loadTaughtKnowledge, renderTaughtContext } from "../modules/adaptive-learning/social/protege.js";
import { helpsOthers, conceptIdFor } from "./peerConsult.js";
import { setLearnerAutonomy, cancelAutonomyReviewForTask, scheduleAutonomyReviewForTask } from "../modules/adaptive-learning/learner/learner-autonomy.js";
import { resolveTopics } from "../modules/adaptive-learning/study-prep/syllabus-resolver.js";
import { collectMaterials, materialsFrom } from "../modules/adaptive-learning/chat/chat-materials.js";
import { readChat } from "../modules/adaptive-learning/chat/chat-history-tools.js";

export function installAgentDeps() {
  setAgentDeps({
    protegeDeps, tutorSystemPrompt, executeChatTool, scheduleDecisionContinuation, selfToolDeps,
    runAgentToolLoop, getLearnerChatTools, SIDE_EFFECT_TOOLS, loadTaughtKnowledge, renderTaughtContext,
    helpsOthers, conceptIdFor, setLearnerAutonomy, cancelAutonomyReviewForTask, scheduleAutonomyReviewForTask,
    resolveTopics, collectMaterials, materialsFrom, readChat,
  });
}
