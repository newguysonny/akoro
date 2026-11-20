// =============================================================
// chat.js  v3.1
// HTTP routes — all session types.
// The legacy knowledge-health (decay) routes live in decay-review/routes.js and
// the student-agent routes in agents/student/routes.js; both are mounted below.
// =============================================================

import express from "express";
import { runDry, runInspected } from "../../lib/dryRunContext.js";
import { safeCompare } from "../../lib/safeCompare.js";
import { decayRoutes } from "./decay-review/routes.js";
import studentAgentRoutes from "./agents/student/routes.js";
import { protegeDeps } from "./chat/handlers-social.js";
import { runAgentToolLoop, CHAT_TOOL_LOOP_MAX_ITERATIONS } from "./chat/agent-loop.js";
import { safeHistory, saveReplyIdeas, suggestionsFor } from "./chat/turn-store.js";
import { tutorSystemPrompt, assembleChatDoctrine } from "./chat/turn-prepare.js";
import decisionsRouter from "./chat/routes-decisions.js";
import sessionsRouter from "./chat/routes-sessions.js";
import agentRouter, { chatModelMenu, scheduleDecisionContinuation } from "./chat/routes-agent.js";
export { runAgentToolLoop, CHAT_TOOL_LOOP_MAX_ITERATIONS, safeHistory, saveReplyIdeas, suggestionsFor };
export { protegeDeps };
export {
  CHAT_TOOLS, getLearnerChatTools, INSTRUCTOR_TOOLS, openAiInstructorTools,
  SIDE_EFFECT_TOOLS, isSideEffectingAction, isSideEffecting,
  PARALLEL_CALL_BARRIERS, PARALLEL_READ_BATCH, DECIDED_CONFIRM_STATUSES,
  PARALLEL_READS_NOTE, STEP_NARRATION_NOTE, selfToolDeps, chatToolBasis,
  executeChatTool, clarify, shouldPlanFirst,
} from "./chat/tool-runtime.js";
export { chatModelMenu, scheduleDecisionContinuation };
export { historyPage } from "./chat/routes-sessions.js";
export { tutorSystemPrompt, assembleChatDoctrine };

const router     = express.Router();
// Agent console (modules/agentConsole): a turn sent with the console's key in
// x-agent-console-dry runs in DRY mode — tools that change data are simulated.
// x-agent-console-inspect (same key) adds each tool call's arguments and a
// truncated result to toolExecutions — the verification gate asserts on them.
router.use((req, res, next) => {
  const key = process.env.AGENT_CONSOLE_KEY;
  if (!key) return next();
  const dry = safeCompare(req.get("x-agent-console-dry"), key);
  const inspect = safeCompare(req.get("x-agent-console-inspect"), key);
  let go = next;
  if (inspect) { const inner = go; go = () => runInspected(inner); }
  if (dry) { const inner = go; go = () => runDry(inner); }
  return go();
});

router.use(decisionsRouter);

// =============================================================
// AGENT PAIR ROUTES
// =============================================================

// =============================================================
// DECAY ROUTES  (v3.1) — handlers live in decay-review/routes.js, mounted
// here after the dry-run/inspect middleware so it still applies.
// =============================================================

router.use("/decay", decayRoutes);

// =============================================================
// STUDENT AGENT ROUTES — handlers live in agents/student/routes.js.
// =============================================================

router.use("/student/agent", studentAgentRoutes);

router.use(sessionsRouter);
router.use(agentRouter);

export default router;
