/**
 * Learner-facing endpoint for an explicitly approved Agent Chat feature/tool
 * request. The normal caller is the unified chat tool, but the endpoint keeps
 * the contract available to a future learner feedback surface without exposing
 * it to anonymous visitors or administrators' private review notes.
 */
import { Router } from "express";

import { authenticateToken, requireRole } from "../auth/routes.js";
import { createLearnerToolRequest } from "./service.js";

const router = Router();

router.post("/agent-tool-requests", authenticateToken, requireRole(["student"]), async (req, res) => {
  try {
    const request = await createLearnerToolRequest({ learnerId: req.user.id, body: req.body || {} });
    return res.status(request.createdNew ? 201 : 200).json({
      success: true,
      request: {
        id: request.id,
        status: request.status,
        title: request.title,
        category: request.category,
        createdAt: request.created,
      },
      duplicate: !request.createdNew,
    });
  } catch (error) {
    const validation = /^(title|description|category|A tool request)/.test(error.message || "");
    return res.status(validation ? 422 : 503).json({
      success: false,
      error: validation ? error.message : "Tool request could not be saved",
    });
  }
});

export default router;
