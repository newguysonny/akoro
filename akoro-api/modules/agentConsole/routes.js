/**
 * modules/agentConsole/routes.js — the learner Agent Chat test console.
 *
 * Same front door as the HF mirror and parse consoles: a shared-key guard,
 * JSON in/out, and a small HTML page. It lets an operator (or Claude, given
 * the key) drive the REAL learner Agent Chat as a TEST learner and see what
 * happened — the tools it called, their results, the reply, the server log.
 *
 *   GET  /api/agent-console/status         tools, which ones change data, flags, models
 *   POST /api/agent-console/pick           { prompt, model? } → which tool + args the model
 *                                          picks. No learner, nothing runs.
 *   POST /api/agent-console/chat           { learner, prompt, mode: "dry"|"live", history?, think? }
 *                                          → one real Agent Chat turn as the learner.
 *                                          dry (default): tools that change data are
 *                                          simulated ("would have…"); read-only tools run.
 *   POST /api/agent-console/tool           { learner, tool, input, mode } → one tool, directly
 *   GET  /api/agent-console/logs           ?since=<seq>&filter=&level= → server log lines
 *   GET  /api/agent-console/runs           the last 50 console runs
 *   GET  /api/agent-console/runs/:id       one run in full (request, reply, tools, logs)
 *   GET  /api/agent-console                the console page (?key=)
 *
 * Env:
 *   AGENT_CONSOLE_KEY       shared secret — arms the routes (header x-agent-console-key, Authorization: Bearer, or ?key=)
 *   AGENT_CONSOLE_LEARNERS  optional comma list of @usernames/emails allowed as test learners
 *
 * Guard rails: the learner must be a LEARNER account (and on the allow-list
 * when one is set); "live" mode is the only way anything is changed, and it
 * is said so in every response.
 *
 * Handlers live in console-service-chat.js, console-service-tools.js,
 * console-service-ai.js and console-service-runs.js; every route stays behind
 * the shared-key guard in console-rules.js.
 */
import express from "express";
import { asyncHandler, guard } from "./console-rules.js";
import { chatTurn, logs, pick, runTool, status } from "./console-service-chat.js";
import {
  cleanupDomainTools,
  contentParses,
  debugToken,
  learnerTools,
  pharmdHashBackfill,
  repairLibraryTools,
} from "./console-service-tools.js";
import {
  aiFailoverTest,
  aiPing,
  aiProvider,
  groundingAb,
  structuredTest,
} from "./console-service-ai.js";
import {
  consolePage,
  executionDigests,
  executionRun,
  executionRuns,
  getRun,
  listRuns,
} from "./console-service-runs.js";

const router = express.Router();

router.get("/status", guard, asyncHandler(status));

router.post("/pick", guard, asyncHandler(pick));

router.post("/chat", guard, asyncHandler(chatTurn));

router.post("/tool", guard, asyncHandler(runTool));

router.get("/logs", guard, logs);

router.post("/repair-library-tools", guard, asyncHandler(repairLibraryTools));

router.post("/cleanup-domain-tools", guard, asyncHandler(cleanupDomainTools));

router.get("/ai-provider", guard, aiProvider);

router.post("/ai-ping", guard, asyncHandler(aiPing));

router.post("/ai-failover-test", guard, asyncHandler(aiFailoverTest));

router.get("/content-parses", guard, asyncHandler(contentParses));

router.post("/debug-token", guard, asyncHandler(debugToken));

router.post("/pharmd-hash-backfill", guard, asyncHandler(pharmdHashBackfill));

router.post("/structured-test", guard, asyncHandler(structuredTest));

router.post("/grounding-ab", guard, asyncHandler(groundingAb));

router.get("/learner-tools", guard, asyncHandler(learnerTools));

router.get("/runs", guard, listRuns);
router.get("/runs/:id", guard, getRun);

router.get("/execution/runs", guard, asyncHandler(executionRuns));
router.get("/execution/runs/:id", guard, asyncHandler(executionRun));
router.get("/execution/digests", guard, asyncHandler(executionDigests));

/* The console page. */
router.get("/", guard, consolePage);

export default router;
