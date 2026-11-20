/**
 * Private Akoro API gateway for the Python agent's function tools.
 *
 * This router is deliberately not mounted under a browser feature path. Every
 * request needs both the deployed Python service credential and a short-lived,
 * session-bound capability minted by an authenticated Akoro API bridge.
 *
 * Validation and capability checks live in gateway-rules.js, durable
 * idempotency in gateway-store.js, and the invocation orchestration in
 * gateway-service.js.
 */
import { Router } from "express";

import { requireAgentToolsCredential } from "./capability.js";
import conversationContextRouter from "./conversation-context-routes.js";
import conceptStateRouter from "./concept-state-routes.js";
import learningInsightsRouter from "./learning-insights-routes.js";
import soulStateRouter from "./soul-state-routes.js";
import teachingWorkflowRouter from "./teaching-workflow-routes.js";
import {
  catalog,
  executeConfirmed,
  invoke,
  prepareConfirmation,
} from "./gateway-service.js";

const router = Router();

// Separate private subresource: same service credential/capability boundary as
// tools, but it never appears in the model's function catalogue.
router.use("/conversations", conversationContextRouter);
// Canonical curriculum concept state is a separate bounded resource. It never
// appears in the model tool catalogue and cannot be used by teacher contexts.
router.use("/concept-state", conceptStateRouter);
// Slow-moving learner signals and compact episodes use the same private
// credential/capability boundary but are never advertised as model functions.
router.use("/learning-insights", learningInsightsRouter);
// Learner-selected interaction preferences and a short-lived self-report are
// read-only prompt context; this route is not a model function.
router.use("/soul-state", soulStateRouter);
// A Python service may relay a complete teaching turn to the canonical Node
// workflow. This is not exposed in the model tool catalogue.
router.use("/teaching-workflow", teachingWorkflowRouter);

router.post("/confirmations", requireAgentToolsCredential, prepareConfirmation);

router.post("/catalog", requireAgentToolsCredential, catalog);

router.post("/execute-confirmed", requireAgentToolsCredential, executeConfirmed);

router.post("/invoke", requireAgentToolsCredential, invoke);

export default router;
