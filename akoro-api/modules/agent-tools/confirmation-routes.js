/**
 * Browser-facing review endpoints for pending Python-agent write proposals.
 * They use the learner's normal authenticated session; they never expose the
 * private gateway credential or accept a user id from the request body.
 */
import { Router } from "express";

import { authenticateToken } from "../auth/index.js";
import {
  confirmWriteConfirmation,
  listWriteConfirmations,
  rejectWriteConfirmation,
} from "./write-confirmations.js";
import { relayConfirmedPythonAction } from "./python-action-relay.js";

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function confirmationError(res, error) {
  const message = error?.message || "Action confirmation could not be completed";
  if (/not found/i.test(message)) return res.status(404).json({ success: false, error: message });
  if (/expired/i.test(message)) return res.status(410).json({ success: false, error: message });
  if (/declined|already used|no longer available|already being used/i.test(message)) {
    return res.status(409).json({ success: false, error: message });
  }
  console.error("[agent-action-confirmations]", message);
  return res.status(500).json({ success: false, error: "Action confirmation could not be completed" });
}

router.get("/confirmations", authenticateToken, async (req, res) => {
  try {
    const confirmations = await listWriteConfirmations({ userId: req.user.id });
    return res.json({ success: true, confirmations });
  } catch (error) {
    return confirmationError(res, error);
  }
});

router.post("/confirmations/:confirmationId/confirm", authenticateToken, async (req, res) => {
  if (req.body?.confirmed !== true) {
    return res.status(422).json({ success: false, error: "confirmed must be true" });
  }
  if (!UUID.test(req.params.confirmationId)) {
    return res.status(422).json({ success: false, error: "confirmationId is invalid" });
  }
  try {
    const confirmation = await confirmWriteConfirmation({
      confirmationId: req.params.confirmationId,
      userId: req.user.id,
    });
    // The browser never receives this short-lived token. Node relays it with
    // its own internal credential to the live Python session, which can only
    // redeem the exact server-stored proposal once.
    const { confirmationToken, sessionId, ...review } = confirmation;
    let delivery;
    try {
      delivery = await relayConfirmedPythonAction({ sessionId, confirmationToken });
    } catch (relayError) {
      console.error("[agent-action-confirmations relay]", relayError.message);
      return res.status(503).json({
        success: false,
        error: "Your approval was saved, but the Python agent could not complete the action yet. Please try confirming again.",
        confirmation: review,
      });
    }
    if (delivery?.delivered && delivery.execution?.success === false) {
      return res.status(409).json({
        success: false,
        error: delivery.execution.error || "The confirmed action is not available for execution yet.",
        confirmation: review,
        delivery,
      });
    }
    return res.json({ success: true, confirmation: review, delivery });
  } catch (error) {
    return confirmationError(res, error);
  }
});

router.post("/confirmations/:confirmationId/reject", authenticateToken, async (req, res) => {
  if (req.body?.rejected !== true) {
    return res.status(422).json({ success: false, error: "rejected must be true" });
  }
  if (!UUID.test(req.params.confirmationId)) {
    return res.status(422).json({ success: false, error: "confirmationId is invalid" });
  }
  try {
    const confirmation = await rejectWriteConfirmation({
      confirmationId: req.params.confirmationId,
      userId: req.user.id,
    });
    return res.json({ success: true, confirmation });
  } catch (error) {
    return confirmationError(res, error);
  }
});

export default router;
