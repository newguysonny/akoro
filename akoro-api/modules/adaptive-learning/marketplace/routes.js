// =============================================================
// marketplace/marketplaceRoutes.js
// All marketplace + payment routes.
//
// MARKETPLACE
//   GET  /marketplace/listings              — all active listings
//   GET  /marketplace/listings/:id          — single listing
//   GET  /marketplace/listings/subject/:sub — filter by subject
//   GET  /marketplace/search                — search listings
//   POST /marketplace/list                  — teacher lists agent
//   PUT  /marketplace/listings/:id          — teacher updates listing
//   DELETE /marketplace/listings/:id        — teacher removes listing
//
// PAYMENTS
//   POST /marketplace/checkout              — init Paystack payment
//   GET  /marketplace/verify/:reference     — manual verify (backup)
//   POST /marketplace/webhook               — Paystack webhook handler
//   GET  /marketplace/payment/callback      — browser redirect after pay
//
// USER AGENTS
//   GET  /marketplace/my-agents/:userId     — agents user has access to
//   POST /marketplace/set-default           — set preferred agent for chat
//   GET  /marketplace/purchases/:userId     — purchase history
//
// REVIEWS
//   POST /marketplace/review                — submit review
//   GET  /marketplace/reviews/:listingId    — get reviews for listing
// =============================================================

import express from "express";
import db from "../../../db.js";
import { authenticateToken, requireRole } from "../../auth/index.js";
import { addPurchasedAgent } from "../../learner-state/index.js";
import { notify } from "../../notifications/events.js";
import { v4 as uuid } from "uuid";
import {
  initializeTransaction,
  verifyTransaction,
  validateWebhookSignature,
  generateReference,
} from "../../../lib/paystackService.js";

const router = express.Router();

// ── Shared helpers ────────────────────────────────────────────
const APP_URL = process.env.APP_URL || "http://localhost:3000";

async function getUserEmail(userId) {
  // Akoro users live in public.users (custom JWT auth) — NOT Supabase Auth.
  // The old db.auth.admin.getUserById() always returned null here, so paid
  // guide checkout failed with "email required for payment".
  const { data } = await db.from("users").select("email").eq("id", userId).maybeSingle();
  return data?.email || null;
}

async function grantAgentAccess(studentId, agentId, purchaseId) {
  // 1. Add to purchased_agents array
  const { data: prefs } = await db
    .schema("edu").from("user_agent_preferences")
    .select("purchased_agents")
    .eq("user_id", studentId)
    .single();

  const existing = prefs?.purchased_agents || [];
  if (!existing.includes(agentId)) {
    await db
      .schema("edu").from("user_agent_preferences")
      .upsert(
        {
          user_id:          studentId,
          purchased_agents: [...existing, agentId],
          updated_at:       new Date(),
        },
        { onConflict: "user_id" }
      );
  }

  // 2. Mark purchase access_granted
  await db
    .schema("edu").from("agent_purchases")
    .update({
      access_granted: true,
      paystack_status: "success",
      verified_at:     new Date(),
    })
    .eq("id", purchaseId);
}

async function incrementListingStudents(listingId) {
  // Atomic increment only. (Previously a read-modify-write "fallback" ran AFTER
  // the RPC on every call — double-incrementing, and a lost-update under
  // concurrent purchases.)
  const { error } = await db.rpc("increment_listing_students", { p_listing_id: listingId });
  if (error) console.error("[marketplace] increment_listing_students failed:", error.message);
}

// =============================================================
// MARKETPLACE — LISTINGS
// =============================================================

// GET /marketplace/listings
// Returns all active listings, sorted by rating
router.get("/listings", async (req, res) => {
  try {
    const { subject, free, limit = 20, offset = 0 } = req.query;
    // ?q= — database search across the listing's title, teacher, subject
    // and description (PostgREST or-ilike; term sanitised for the grammar).
    const term = String(req.query.q ?? "").replace(/[,()%\\]/g, " ").trim().slice(0, 80);

    let q = db
      .schema("edu").from("marketplace_summary")
      .select("*")
      .eq("is_active", true)
      .order("avg_rating",      { ascending: false })
      .order("total_students",  { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (subject)        q = q.eq("subject", subject);
    if (free === "true") q = q.eq("is_free", true);
    if (term) q = q.or(`title.ilike.%${term}%,teacher_name.ilike.%${term}%,subject.ilike.%${term}%,description.ilike.%${term}%`);

    const { data, error } = await q;
    if (error) throw error;

    res.json({
      success:  true,
      listings: data || [],
      count:    data?.length || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /marketplace/listings/:id
router.get("/listings/:id", async (req, res) => {
  try {
    const { data, error } = await db
      .schema("edu").from("marketplace_summary")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: "Listing not found" });
    res.json({ success: true, listing: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /marketplace/listings/subject/:subject
router.get("/listings/subject/:subject", async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const { data, error } = await db
      .schema("edu").from("marketplace_summary")
      .select("*")
      .eq("subject", req.params.subject)
      .order("avg_rating", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw error;
    res.json({ success: true, listings: data || [], subject: req.params.subject });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /marketplace/search?q=maths&subject=maths
router.get("/search", async (req, res) => {
  try {
    const { q, subject, limit = 20 } = req.query;
    if (!q) return res.status(400).json({ error: "q is required" });
    const qs = String(q).replace(/[,()%*:\\]/g, " ");  // neuter PostgREST filter metacharacters

    let query = db
      .schema("edu").from("marketplace_summary")
      .select("*")
      .or(`title.ilike.%${qs}%,description.ilike.%${qs}%,subject.ilike.%${qs}%`)
      .limit(Number(limit));

    if (subject) query = query.eq("subject", subject);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, listings: data || [], query: q });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /marketplace/list — teacher creates a listing
router.post("/list", authenticateToken, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const teacherId = req.user.id;
    const {
      agentId, title, description,
      subject, topicsCovered = [], previewTopics = [],
      priceKobo = 0, currency = "NGN",
      teacherName, teacherAvatar, sampleTip,
    } = req.body;

    if (!agentId || !title || !subject) {
      return res.status(400).json({ error: "agentId, title and subject required" });
    }

    // Verify agent belongs to teacher
    const { data: config } = await db
      .schema("edu").from("agent_orchestration_config")
      .select("teacher_id, guide_config, flow_type")
      .eq("agent_id", agentId)
      .single();

    if (!config || config.teacher_id !== teacherId) {
      return res.status(403).json({ error: "Agent not found or does not belong to this teacher" });
    }

    // Build style summary from config
    const styleSummary = config.guide_config?.personality
      ? config.guide_config.personality.substring(0, 150)
      : `${config.guide_config?.tone || "Engaging"} teaching style — ${config.flow_type} approach`;

    const { data, error } = await db
      .schema("edu").from("marketplace_listings")
      .insert({
        agent_id:       agentId,
        teacher_id:     teacherId,
        title,
        description,
        subject,
        topics_covered: topicsCovered,
        preview_topics: previewTopics,
        price_kobo:     priceKobo,
        currency,
        teacher_name:   teacherName,
        teacher_avatar: teacherAvatar,
        sample_tip:     sampleTip,
        style_summary:  styleSummary,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, listing: data });
  } catch (err) {
    console.error("[/marketplace/list]", err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /marketplace/listings/:id — teacher updates listing
router.put("/listings/:id", authenticateToken, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { teacherId: _ignored, ...updates } = req.body;

    const { data: existing } = await db
      .schema("edu").from("marketplace_listings")
      .select("teacher_id")
      .eq("id", req.params.id)
      .single();

    if (!existing || existing.teacher_id !== teacherId) {
      return res.status(403).json({ error: "Not authorised" });
    }

    const allowedFields = [
      "title","description","topics_covered","preview_topics",
      "price_kobo","is_active","teacher_avatar","sample_tip","style_summary",
    ];
    const safeUpdates = Object.fromEntries(
      Object.entries(updates).filter(([k]) => allowedFields.includes(k))
    );
    safeUpdates.updated_at = new Date();

    const { data, error } = await db
      .schema("edu").from("marketplace_listings")
      .update(safeUpdates)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, listing: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /marketplace/listings/:id — teacher removes listing
router.delete("/listings/:id", authenticateToken, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const teacherId = req.user.id;

    const { data: existing } = await db
      .schema("edu").from("marketplace_listings")
      .select("teacher_id")
      .eq("id", req.params.id)
      .single();

    if (!existing || existing.teacher_id !== teacherId) {
      return res.status(403).json({ error: "Not authorised" });
    }

    // Soft delete — set inactive rather than hard delete
    await db
      .schema("edu").from("marketplace_listings")
      .update({ is_active: false, updated_at: new Date() })
      .eq("id", req.params.id);

    res.json({ success: true, message: "Listing deactivated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// PAYMENTS — CHECKOUT
// =============================================================

// POST /marketplace/checkout
// Body: { studentId, listingId, email? }
// Returns: { authorization_url, reference, purchaseId }
router.post("/checkout", authenticateToken, async (req, res) => {
  try {
    // Always derive the buyer from the authenticated session — never trust
    // a client-supplied studentId (prevents purchasing on another user's behalf).
    const studentId = req.user.id;
    const { listingId, email: providedEmail } = req.body;
    if (!listingId) {
      return res.status(400).json({ error: "listingId required" });
    }

    // Load listing
    const { data: listing, error: listingErr } = await db
      .schema("edu").from("marketplace_listings")
      .select("*")
      .eq("id", listingId)
      .eq("is_active", true)
      .single();

    if (listingErr || !listing) {
      return res.status(404).json({ error: "Listing not found or inactive" });
    }

    // Check not already purchased
    const { data: existingPurchase } = await db
      .schema("edu").from("agent_purchases")
      .select("id, access_granted")
      .eq("student_id", studentId)
      .eq("listing_id",  listingId)
      .eq("access_granted", true)
      .single();

    if (existingPurchase) {
      return res.status(409).json({
        error:   "Already purchased",
        agentId: listing.agent_id,
      });
    }

    // Handle free agents — grant immediately
    if (listing.price_kobo === 0) {
      const purchaseId = uuid();
      await db.schema("edu").from("agent_purchases").insert({
        id:              purchaseId,
        student_id:      studentId,
        agent_id:        listing.agent_id,
        listing_id:      listingId,
        amount_kobo:     0,
        currency:        listing.currency,
        paystack_ref:    `FREE-${purchaseId}`,
        paystack_status: "success",
        access_granted:  true,
        verified_at:     new Date(),
      });

      await grantAgentAccess(studentId, listing.agent_id, purchaseId);
      await incrementListingStudents(listingId);

      return res.json({
        success:      true,
        free:         true,
        agentId:      listing.agent_id,
        purchaseId,
        message:      `${listing.title} is free — access granted immediately!`,
      });
    }

    // Paid agent — init Paystack
    const email     = providedEmail || await getUserEmail(studentId);
    if (!email) return res.status(400).json({ error: "email required for payment" });

    const reference = generateReference("AGNT");
    const purchaseId = uuid();

    // Create pending purchase record
    await db.schema("edu").from("agent_purchases").insert({
      id:           purchaseId,
      student_id:   studentId,
      agent_id:     listing.agent_id,
      listing_id:   listingId,
      amount_kobo:  listing.price_kobo,
      currency:     listing.currency,
      paystack_ref: reference,
      paystack_status: "pending",
      metadata: {
        listing_title: listing.title,
        subject:       listing.subject,
        teacher_name:  listing.teacher_name,
      },
    });

    // Initialize Paystack transaction
    const paystack = await initializeTransaction({
      email,
      amount_kobo:  listing.price_kobo,
      reference,
      callback_url: `${APP_URL}/marketplace/payment/callback?purchaseId=${purchaseId}`,
      metadata: {
        purchase_id:   purchaseId,
        student_id:    studentId,
        listing_id:    listingId,
        agent_id:      listing.agent_id,
        listing_title: listing.title,
      },
    });

    res.json({
      success:           true,
      authorization_url: paystack.authorization_url,
      access_code:       paystack.access_code,
      reference,
      purchaseId,
      amount_kobo:       listing.price_kobo,
      currency:          listing.currency,
    });

  } catch (err) {
    console.error("[/marketplace/checkout]", err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// PAYMENTS — VERIFY (manual backup)
// =============================================================

// GET /marketplace/verify/:reference
router.get("/verify/:reference", async (req, res) => {
  try {
    const { reference } = req.params;

    // Load purchase
    const { data: purchase } = await db
      .schema("edu").from("agent_purchases")
      .select("*")
      .eq("paystack_ref", reference)
      .single();

    if (!purchase) return res.status(404).json({ error: "Purchase not found" });
    if (purchase.access_granted) {
      return res.json({ success: true, already_granted: true, agentId: purchase.agent_id });
    }

    // Verify with Paystack
    const tx = await verifyTransaction(reference);

    if (tx.status === "success") {
      await grantAgentAccess(purchase.student_id, purchase.agent_id, purchase.id);
      await incrementListingStudents(purchase.listing_id);

      res.json({
        success:      true,
        agentId:      purchase.agent_id,
        amount_kobo:  tx.amount,
        paid_at:      tx.paid_at,
        message:      "Payment verified — agent access granted!",
      });
    } else {
      await db
        .schema("edu").from("agent_purchases")
        .update({ paystack_status: tx.status })
        .eq("id", purchase.id);

      res.json({ success: false, status: tx.status, message: "Payment not successful" });
    }

  } catch (err) {
    console.error("[/marketplace/verify]", err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// PAYMENTS — WEBHOOK (Paystack auto-notifies this)
// =============================================================

// POST /marketplace/webhook
// IMPORTANT: must use raw body parser — see server.js note below
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const rawBody  = req.body.toString();
    const signature = req.headers["x-paystack-signature"];

    // 1. Validate signature
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

/**
 * Fulfil a marketplace Paystack event (agent teaching-guide purchases and
 * platform tool/asset unlocks). Idempotent — every grant is gated on a
 * not-yet-granted row, so replays no-op. Returns true if the event matched a
 * marketplace transaction, else false so a shared dispatcher can try another
 * domain. Exported for the unified /api/webhooks/paystack dispatcher, which
 * verifies the signature once from the raw body.
 */
export async function fulfillMarketplaceEvent(event) {
  // charge.success — agent purchase or platform tool unlock
  if (event.event === "charge.success") {
    const { reference, metadata, status } = event.data;

    if (status !== "success") return false;

    // Platform tool/asset purchase (instructor unlock) — keyed by reference
    if (metadata?.kind === "platform_tool") {
      const { data: row } = await db
        .schema("edu").from("instructor_tool_access")
        .select("id, instructor_id, access_granted")
        .eq("paystack_ref", reference)
        .single();

      if (row && !row.access_granted) {
        await db.schema("edu").from("instructor_tool_access").update({
          access_granted:  true,
          paystack_status: "success",
          verified_at:     new Date(),
        }).eq("id", row.id);

        if (global._io && row.instructor_id) {
          const payload = {
            toolId:   metadata.tool_id,
            toolName: metadata.tool_name,
            message:  `🔓 "${metadata.tool_name}" unlocked for your agent.`,
            timestamp: new Date().toISOString(),
          };
          // The instructor socket joins `user:{id}` (subscribe-notifications);
          // emit to both rooms so the unlock reaches the chat live.
          global._io.to(`user:${row.instructor_id}`).emit("tool_unlocked", payload);
          global._io.to(`instructor:${row.instructor_id}`).emit("tool_unlocked", payload);
        }
        // Persist to the notification bell (the live event above is transient).
        notify.toolUnlocked({ instructorId: row.instructor_id, toolName: metadata.tool_name });
        console.log(`[Webhook] ✅ Tool unlocked: instructor=${row.instructor_id} tool=${metadata.tool_id}`);
      }
      return true;
    }

    const purchaseId = metadata?.purchase_id;
    const studentId  = metadata?.student_id;
    const agentId    = metadata?.agent_id;
    const listingId  = metadata?.listing_id;

    if (!purchaseId || !studentId || !agentId) return false;

    // Load purchase
    const { data: purchase } = await db
      .schema("edu").from("agent_purchases")
      .select("id, access_granted")
      .eq("id", purchaseId)
      .single();

    if (!purchase || purchase.access_granted) {
      return true; // already processed
    }

    // Grant access
    await grantAgentAccess(studentId, agentId, purchaseId);
    await incrementListingStudents(listingId);

    // Emit socket notification if io is available
    if (global._io) {
      global._io.to(`student:${studentId}`).emit("agent_purchased", {
        agentId,
        listingId,
        agentName:  metadata?.listing_title || "Agent",
        purchaseId,
        message:    `🎉 Agent unlocked! You can now use "${metadata?.listing_title}" for your sessions.`,
        timestamp:  new Date().toISOString(),
      });
    }

    // Persist to the notification bell (the live event above is transient).
    notify.agentUnlocked({ userId: studentId, agentName: metadata?.listing_title || "Teaching guide" });
    console.log(`[Webhook] ✅ Access granted: student=${studentId} agent=${agentId}`);
    return true;
  }

  // refund.processed — revoke the matching agent purchase
  if (event.event === "refund.processed") {
    const { transaction_reference } = event.data;
    await db
      .schema("edu").from("agent_purchases")
      .update({ paystack_status: "refunded", access_granted: false })
      .eq("paystack_ref", transaction_reference);
    return true;
  }

  return false;
}

// =============================================================
// PAYMENT CALLBACK (browser redirect after Paystack)
// =============================================================

// GET /marketplace/payment/callback?reference=xxx&purchaseId=xxx
router.get("/payment/callback", async (req, res) => {
  const { reference, purchaseId } = req.query;

  try {
    if (!reference) {
      return res.redirect(`${APP_URL}/marketplace?payment=cancelled`);
    }

    const tx = await verifyTransaction(reference);

    if (tx.status === "success") {
      // Load purchase to get agentId
      const { data: purchase } = await db
        .schema("edu").from("agent_purchases")
        .select("agent_id, student_id, listing_id, access_granted")
        .eq("paystack_ref", reference)
        .single();

      if (purchase && !purchase.access_granted) {
        await grantAgentAccess(purchase.student_id, purchase.agent_id, purchaseId);
        await incrementListingStudents(purchase.listing_id);
      }

      return res.redirect(
        `${APP_URL}/marketplace?payment=success&agentId=${purchase?.agent_id}&reference=${reference}`
      );
    } else {
      return res.redirect(`${APP_URL}/marketplace?payment=failed&reference=${reference}`);
    }
  } catch (err) {
    console.error("[Payment Callback]", err);
    return res.redirect(`${APP_URL}/marketplace?payment=error`);
  }
});

// =============================================================
// USER AGENTS
// =============================================================

// GET /marketplace/my-agents/:userId
// Returns: default platform agent + all purchased agents with full profiles
router.get("/my-agents/:userId", authenticateToken, async (req, res) => {
  try {
    // Ignore the path param for authorization — only ever return the
    // authenticated user's own agents.
    const userId = req.user.id;

    // Load preferences
    const { data: prefs } = await db
      .schema("edu").from("user_agent_preferences")
      .select("*")
      .eq("user_id", userId)
      .single();

    const defaultPairId    = prefs?.default_pair_id   || "nana-sargeant";
    const purchasedAgents  = prefs?.purchased_agents  || [];
    const activeAgentId    = prefs?.active_agent_id   || null;

    // Load profiles for purchased agents
    let purchasedProfiles = [];
    if (purchasedAgents.length > 0) {
      const { data: listings } = await db
        .schema("edu").from("marketplace_listings")
        .select("id, agent_id, title, subject, teacher_name, teacher_avatar, style_summary, avg_rating")
        .in("agent_id", purchasedAgents)
        .eq("is_active", true);
      purchasedProfiles = listings || [];
    }

    // Platform default agent (always available, free)
    const platformAgents = [
      {
        id:          "nana-esumai",
        type:        "platform",
        name:        "NaNa Esumai & Sargeant",
        description: "Platform default — NaNa coaches your teaching quality. Sargeant gates advancement.",
        subject:     "All subjects",
        avatar:      "🧠",
        isFree:      true,
        isDefault:   !defaultPairId || defaultPairId === "nana-esumai" || defaultPairId === "nana-sargeant",
        isActive:    !activeAgentId || activeAgentId === "nana-esumai",
      },
    ];

    const purchased = purchasedProfiles.map(p => ({
      id:          `trained:${p.agent_id}`,
      agentId:     p.agent_id,
      listingId:   p.id,
      type:        "trained",
      name:        p.title,
      subject:     p.subject,
      teacherName: p.teacher_name,
      avatar:      p.teacher_avatar || "🎓",
      styleSummary: p.style_summary,
      rating:      p.avg_rating,
      isFree:      false,
      isPurchased: true,
      isDefault:   defaultPairId === `trained:${p.agent_id}`,
      isActive:    activeAgentId  === p.agent_id,
    }));

    res.json({
      success:          true,
      userId,
      defaultPairId,
      activeAgentId,
      platformAgents,
      purchasedAgents:  purchased,
      totalAgents:      platformAgents.length + purchased.length,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /marketplace/set-default
// Body: { userId, agentPairId, activeAgentId? }
router.post("/set-default", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { agentPairId, activeAgentId } = req.body;
    if (!agentPairId) {
      return res.status(400).json({ error: "agentPairId required" });
    }

    // Verify user owns this agent (if it's a trained agent)
    if (agentPairId !== "nana-esumai" && agentPairId.startsWith("trained:")) {
      const agentId = agentPairId.replace("trained:", "");
      const { data: owns } = await db
        .rpc("edu.user_owns_agent", { p_user_id: userId, p_agent_id: agentId });
      if (!owns) {
        return res.status(403).json({ error: "You do not own this agent" });
      }
    }

    await db
      .schema("edu").from("user_agent_preferences")
      .upsert(
        {
          user_id:         userId,
          default_pair_id: agentPairId,
          active_agent_id: activeAgentId || null,
          updated_at:      new Date(),
        },
        { onConflict: "user_id" }
      );

    res.json({ success: true, userId, defaultPairId: agentPairId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /marketplace/purchases/:userId
router.get("/purchases/:userId", authenticateToken, async (req, res) => {
  try {
    const { data, error } = await db
      .schema("edu").from("agent_purchases")
      .select(`
        id, agent_id, amount_kobo, currency, paystack_ref,
        paystack_status, access_granted, purchased_at,
        edu.marketplace_listings!inner(title, subject, teacher_name, price_kobo)
      `)
      .eq("student_id", req.user.id)
      .order("purchased_at", { ascending: false });

    if (error) throw error;
    res.json({ success: true, purchases: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// REVIEWS
// =============================================================

// POST /marketplace/review
router.post("/review", authenticateToken, async (req, res) => {
  try {
    const studentId = req.user.id;
    const { listingId, rating, reviewText } = req.body;
    if (!listingId || !rating) {
      return res.status(400).json({ error: "listingId and rating required" });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: "rating must be 1–5" });
    }

    // Verify student has purchased and has access
    const { data: purchase } = await db
      .schema("edu").from("agent_purchases")
      .select("id")
      .eq("student_id",    studentId)
      .eq("listing_id",    listingId)
      .eq("access_granted", true)
      .single();

    if (!purchase) {
      return res.status(403).json({ error: "You must purchase this agent before reviewing" });
    }

    const { data, error } = await db
      .schema("edu").from("marketplace_reviews")
      .upsert(
        {
          listing_id:  listingId,
          student_id:  studentId,
          purchase_id: purchase.id,
          rating,
          review_text: reviewText || null,
        },
        { onConflict: "listing_id,student_id" }
      )
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, review: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /marketplace/reviews/:listingId
router.get("/reviews/:listingId", async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const { data, error } = await db
      .schema("edu").from("marketplace_reviews")
      .select("id, rating, review_text, created_at")
      .eq("listing_id", req.params.listingId)
      .order("created_at", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw error;
    res.json({ success: true, reviews: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
