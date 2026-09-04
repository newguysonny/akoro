/**
 * modules/vouchers/index.js — mount point for the whole voucher module.
 *
 * DECOUPLE STEP: to remove this module from Akoro entirely, delete this
 * folder and the one `app.use("/api/vouchers", vouchersModule)` line (plus
 * the fulfillVoucherWalletTopup wiring in modules/webhooks/paystack.js).
 * Nothing elsewhere in the codebase imports from modules/vouchers/.
 */
import { Router } from "express";
import "./webhookWorker.js";                   // side-effect: schedules outbound webhook delivery
import validateRouter  from "./validate.js";   // public — API-key auth (startups)
import startupsRouter  from "./startups.js";   // Akoro-authenticated (startup owners)
import agentRouter      from "./agent.js";      // Akoro-authenticated (agents)

const router = Router();

// Public, API-key-authenticated surface for startups' own backends.
router.use("/v1", validateRouter);

// Akoro-session-authenticated surfaces.
router.use("/startups", startupsRouter);
router.use("/", agentRouter);   // /marketplace, /wallet*, /purchase, /my-codes, /batches

export default router;
export { fulfillVoucherWalletTopup } from "./fulfillment.js";
