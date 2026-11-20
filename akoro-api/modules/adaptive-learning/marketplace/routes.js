import express from "express";
import { authenticateToken, requireRole } from "../../auth/index.js";
import { validateWebhookSignature } from "../../../lib/paystackService.js";
import { APP_URL } from "./rules.js";
import {
  listListings,
  getListing,
  listListingsBySubject,
  searchListings,
  createListing,
  updateListing,
  deleteListing,
  checkout,
  verifyPayment,
  handlePaymentCallback,
  getMyAgents,
  setDefaultAgent,
  getPurchases,
  submitReview,
  getReviews,
  fulfillMarketplaceEvent,
} from "./service.js";

const router = express.Router();

function send(res, result) {
  res.status(result.status).json(result.body);
}

router.get("/listings", async (req, res) => {
  try {
    send(res, await listListings(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/listings/:id", async (req, res) => {
  try {
    send(res, await getListing(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/listings/subject/:subject", async (req, res) => {
  try {
    send(res, await listListingsBySubject(req.params.subject, req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/search", async (req, res) => {
  try {
    send(res, await searchListings(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/list", authenticateToken, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    send(res, await createListing(req.user.id, req.body));
  } catch (err) {
    console.error("[/marketplace/list]", err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/listings/:id", authenticateToken, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    send(res, await updateListing(req.user.id, req.params.id, req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/listings/:id", authenticateToken, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    send(res, await deleteListing(req.user.id, req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/checkout", authenticateToken, async (req, res) => {
  try {
    send(res, await checkout(req.user.id, req.body));
  } catch (err) {
    console.error("[/marketplace/checkout]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/verify/:reference", async (req, res) => {
  try {
    send(res, await verifyPayment(req.params.reference));
  } catch (err) {
    console.error("[/marketplace/verify]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const rawBody = req.body.toString();
    const signature = req.headers["x-paystack-signature"];

    if (!validateWebhookSignature(rawBody, signature)) {
      console.warn("[Paystack Webhook] Invalid signature — rejected");
      return res.status(400).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(rawBody);
    console.log("[Paystack Webhook] Event:", event.event);

    await fulfillMarketplaceEvent(event);
    res.sendStatus(200);
  } catch (err) {
    console.error("[Paystack Webhook] Error:", err);
    res.sendStatus(500);
  }
});

router.get("/payment/callback", async (req, res) => {
  try {
    return res.redirect(await handlePaymentCallback(req.query));
  } catch (err) {
    console.error("[Payment Callback]", err);
    return res.redirect(`${APP_URL}/marketplace?payment=error`);
  }
});

router.get("/my-agents/:userId", authenticateToken, async (req, res) => {
  try {
    send(res, await getMyAgents(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/set-default", authenticateToken, async (req, res) => {
  try {
    send(res, await setDefaultAgent(req.user.id, req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/purchases/:userId", authenticateToken, async (req, res) => {
  try {
    send(res, await getPurchases(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/review", authenticateToken, async (req, res) => {
  try {
    send(res, await submitReview(req.user.id, req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/reviews/:listingId", async (req, res) => {
  try {
    send(res, await getReviews(req.params.listingId, req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { fulfillMarketplaceEvent };
export default router;
