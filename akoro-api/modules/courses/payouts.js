/**
 * routes/payouts.js  —  Piabam Instructor Payout Dashboard
 *
 * Handles:
 *   - Instructor earnings overview (gross, commission, net)
 *   - Per-course earnings breakdown
 *   - Bank account management (Paystack resolve + save)
 *   - Payout request → Paystack Transfer API
 *   - Payout history
 *   - Admin: view all instructor earnings, process payouts manually
 *
 * Commission is read from PLATFORM_COMMISSION_PERCENT env var.
 * Each instructor_earnings row snapshots the rate at time of purchase
 * so rate changes never retroactively alter settled earnings.
 *
 * Usage in app.js:
 *   import payoutsRouter from "./routes/payouts.js";
 *   app.use("/api", payoutsRouter);
 */

import { Router }                         from "express";
import axios                              from "axios";
import { body, validationResult }         from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { businessConfig }                 from "../../config/index.js";
import { verifyTransaction }              from "../adaptive-learning/marketplace/paystackService.js";
import { performRefund }                  from "./payments.js";
import { notify }                         from "../notifications/events.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const res403 = (res, msg)             => res.status(403).json({ success: false, message: msg });
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

const now = () => new Date().toISOString();

const PAYSTACK_KEY = () => process.env.PAYSTACK_SECRET_KEY ?? "";

// ─── Earnings summary builder ─────────────────────────────────────────────────

const buildEarningsSummary = (earnings) => {
  const all       = earnings ?? [];
  const pending   = all.filter((e) => e.status === "pending");
  const paid      = all.filter((e) => e.status === "paid");
  const refunded  = all.filter((e) => e.status === "refunded");

  const sumNet    = (rows) => rows.reduce((s, e) => s + e.net_amount, 0);
  const sumGross  = (rows) => rows.reduce((s, e) => s + e.gross_amount, 0);

  const pendingNet = sumNet(pending);

  return {
    commission_percent:       businessConfig.commissionPercent,
    total_gross_ngn:          sumGross(all) / 100,
    total_platform_fee_ngn:   all.reduce((s, e) => s + e.commission_amount, 0) / 100,
    total_net_ngn:            sumNet(all) / 100,
    pending_payout_ngn:       pendingNet / 100,
    paid_out_ngn:             sumNet(paid) / 100,
    refunded_ngn:             sumNet(refunded) / 100,
    total_sales:              all.length,
    pending_sales:            pending.length,
    can_request_payout:       pendingNet >= businessConfig.payoutMinimumKobo,
    minimum_payout_ngn:       businessConfig.payoutMinimumKobo / 100,
  };
};

// ─── Instructor earnings handlers ─────────────────────────────────────────────

const earningsHandlers = {

  /**
   * GET /api/instructor/earnings
   * Full earnings overview for the authenticated instructor.
   */
  overview: asyncHandler(async (req, res) => {
    const instructorId = req.user.id;

    const { data: earnings, error } = await db
      .from("instructor_earnings")
      .select(`
        id, gross_amount, commission_percent, commission_amount,
        net_amount, currency, status, earned_at, payout_id,
        courses ( id, title, cover_image_url ),
        student:users!instructor_earnings_student_id_fkey ( id, full_name, username )
      `)
      .eq("instructor_id", instructorId)
      .order("earned_at", { ascending: false });

    if (error) throw new Error(error.message);

    const summary = buildEarningsSummary(earnings ?? []);

    res200(res, {
      summary,
      earnings: earnings ?? [],
    });
  }),

  /**
   * GET /api/instructor/earnings/by-course
   * Earnings grouped by course — useful for the payout dashboard chart.
   */
  byCourse: asyncHandler(async (req, res) => {
    const { data: earnings, error } = await db
      .from("instructor_earnings")
      .select("course_id, net_amount, gross_amount, commission_amount, status, courses(id, title, cover_image_url)")
      .eq("instructor_id", req.user.id)
      .neq("status", "refunded");

    if (error) throw new Error(error.message);

    // Group by course
    const grouped = {};
    for (const e of (earnings ?? [])) {
      const cid = e.course_id;
      if (!grouped[cid]) {
        grouped[cid] = {
          course_id:        cid,
          course_title:     e.courses?.title,
          cover_image_url:  e.courses?.cover_image_url,
          total_sales:      0,
          gross_ngn:        0,
          platform_fee_ngn: 0,
          net_ngn:          0,
          pending_ngn:      0,
        };
      }
      grouped[cid].total_sales      += 1;
      grouped[cid].gross_ngn        += e.gross_amount / 100;
      grouped[cid].platform_fee_ngn += e.commission_amount / 100;
      grouped[cid].net_ngn          += e.net_amount / 100;
      if (e.status === "pending")
        grouped[cid].pending_ngn    += e.net_amount / 100;
    }

    res200(res, Object.values(grouped));
  }),

  /**
   * GET /api/instructor/earnings/monthly
   * Monthly earnings breakdown for chart display.
   */
  monthly: asyncHandler(async (req, res) => {
    const { data: earnings, error } = await db
      .from("instructor_earnings")
      .select("net_amount, gross_amount, commission_amount, status, earned_at")
      .eq("instructor_id", req.user.id)
      .neq("status", "refunded")
      .order("earned_at", { ascending: true });

    if (error) throw new Error(error.message);

    // Group by year-month
    const monthly = {};
    for (const e of (earnings ?? [])) {
      const key = e.earned_at.slice(0, 7); // "2025-06"
      if (!monthly[key]) {
        monthly[key] = { month: key, sales: 0, gross_ngn: 0, net_ngn: 0, platform_fee_ngn: 0 };
      }
      monthly[key].sales          += 1;
      monthly[key].gross_ngn      += e.gross_amount / 100;
      monthly[key].net_ngn        += e.net_amount / 100;
      monthly[key].platform_fee_ngn += e.commission_amount / 100;
    }

    res200(res, Object.values(monthly));
  }),
};

// ─── Bank account handlers ─────────────────────────────────────────────────────

const bankHandlers = {

  /**
   * GET /api/instructor/bank-details
   * Get instructor's saved bank details.
   */
  get: asyncHandler(async (req, res) => {
    const { data } = await db
      .from("instructor_bank_details")
      .select("id, bank_code, bank_name, account_number, account_name, is_default, created_at")
      .eq("instructor_id", req.user.id)
      .single();

    res200(res, data ?? null);
  }),

  /**
   * POST /api/instructor/bank-details/verify
   * Verify a bank account number via Paystack Resolve API before saving.
   * Returns the account holder name for the instructor to confirm.
   */
  verify: asyncHandler(async (req, res) => {
    const { account_number, bank_code } = req.body;

    const { data: psData } = await axios.get(
      `https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_KEY()}` } }
    );

    if (!psData.status) return res400(res, "Could not verify account");

    res200(res, {
      account_number: psData.data.account_number,
      account_name:   psData.data.account_name,
      bank_code,
      verified:       true,
    });
  }),

  /**
   * PUT /api/instructor/bank-details
   * Save verified bank details for payouts.
   */
  save: asyncHandler(async (req, res) => {
    const { bank_code, bank_name, account_number, account_name } = req.body;

    const { data, error } = await db
      .from("instructor_bank_details")
      .upsert({
        instructor_id:  req.user.id,
        bank_code,
        bank_name,
        account_number,
        account_name,
        is_default:     true,
      }, { onConflict: "instructor_id" })
      .select()
      .single();

    if (error) throw new Error(error.message);
    res200(res, data);
  }),

  /**
   * GET /api/payouts/banks
   * List supported Nigerian banks from Paystack (for bank selector dropdown).
   */
  listBanks: asyncHandler(async (req, res) => {
    const { data: psData } = await axios.get(
      "https://api.paystack.co/bank?country=nigeria&per_page=100&use_cursor=false",
      { headers: { Authorization: `Bearer ${PAYSTACK_KEY()}` } }
    );

    const banks = (psData.data ?? []).map((b) => ({
      code: b.code,
      name: b.name,
      slug: b.slug,
    }));

    res200(res, banks, { total: banks.length });
  }),
};

// ─── Payout handlers ──────────────────────────────────────────────────────────

const payoutHandlers = {

  /**
   * GET /api/instructor/payouts
   * Payout history for the instructor.
   */
  list: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("payouts")
      .select("id, amount, currency, status, earnings_count, bank_code, account_number, account_name, provider_reference, requested_at, processed_at, completed_at, failure_reason")
      .eq("instructor_id", req.user.id)
      .order("requested_at", { ascending: false });

    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  /**
   * POST /api/instructor/payouts/request
   * Instructor requests a payout of all pending earnings.
   * Triggers Paystack Transfer API.
   */
  request: asyncHandler(async (req, res) => {
    const instructorId = req.user.id;

    // Atomically CLAIM the pending earnings (pending → processing) so two
    // concurrent payout requests can't both grab the same earnings and issue
    // two Paystack transfers for the same money. Only the rows THIS call flips
    // are ours; every failure path reverts them to pending.
    const { data: claimed, error: earningsErr } = await db
      .from("instructor_earnings")
      .update({ status: "processing" })
      .eq("instructor_id", instructorId)
      .eq("status", "pending")
      .select("id, net_amount, currency");

    if (earningsErr) throw new Error(earningsErr.message);
    if (!claimed?.length) return res400(res, "No pending earnings to pay out");

    const earningIds = claimed.map((e) => e.id);
    const revert = () => db.from("instructor_earnings").update({ status: "pending" }).in("id", earningIds);
    const totalKobo = claimed.reduce((s, e) => s + e.net_amount, 0);

    if (totalKobo < businessConfig.payoutMinimumKobo) {
      await revert();
      return res400(res, `Minimum payout is ₦${businessConfig.payoutMinimumKobo / 100}. Current balance: ₦${totalKobo / 100}`);
    }

    // Get bank details
    const { data: bankDetails } = await db
      .from("instructor_bank_details")
      .select("bank_code, account_number, account_name")
      .eq("instructor_id", instructorId)
      .single();

    if (!bankDetails) { await revert(); return res400(res, "Please add your bank details before requesting a payout"); }

    // Create payout record first (so we have an ID for the Paystack reference)
    const { data: payout, error: payoutErr } = await db
      .from("payouts")
      .insert({
        instructor_id:  instructorId,
        amount:         totalKobo,
        currency:       "NGN",
        bank_code:      bankDetails.bank_code,
        account_number: bankDetails.account_number,
        account_name:   bankDetails.account_name,
        earnings_count: claimed.length,
        status:         "processing",
      })
      .select()
      .single();

    if (payoutErr) { await revert(); throw new Error(payoutErr.message); }

    // Create Paystack Transfer Recipient
    let recipientCode;
    try {
      const { data: recipient } = await axios.post(
        "https://api.paystack.co/transferrecipient",
        {
          type:           "nuban",
          name:           bankDetails.account_name,
          account_number: bankDetails.account_number,
          bank_code:      bankDetails.bank_code,
          currency:       "NGN",
        },
        { headers: { Authorization: `Bearer ${PAYSTACK_KEY()}`, "Content-Type": "application/json" } }
      );
      recipientCode = recipient.data.recipient_code;
    } catch (e) {
      await db.from("payouts").update({ status: "failed", failure_reason: e.message }).eq("id", payout.id);
      await revert();
      return res400(res, `Could not create transfer recipient: ${e.message}`);
    }

    // Initiate Paystack Transfer
    let transferReference;
    try {
      const { data: transfer } = await axios.post(
        "https://api.paystack.co/transfer",
        {
          source:    "balance",
          amount:    totalKobo,
          recipient: recipientCode,
          reason:    `Piabam instructor payout — ${claimed.length} sales`,
          reference: `akoro_payout_${payout.id}`,
        },
        { headers: { Authorization: `Bearer ${PAYSTACK_KEY()}`, "Content-Type": "application/json" } }
      );
      transferReference = transfer.data.transfer_code;
    } catch (e) {
      await db.from("payouts").update({ status: "failed", failure_reason: e.message }).eq("id", payout.id);
      await revert();
      return res400(res, `Transfer failed: ${e.message}`);
    }

    // Update payout with transfer reference
    await db.from("payouts").update({
      provider_reference: transferReference,
      processed_at:       now(),
    }).eq("id", payout.id);

    // Mark the claimed earnings paid and link to the payout.
    await db.from("instructor_earnings")
      .update({ status: "paid", payout_id: payout.id })
      .in("id", earningIds);

    console.log(`[payouts] ✅ Payout initiated  instructor=${instructorId}  amount=₦${totalKobo / 100}  ref=${transferReference}`);

    res201(res, {
      payout_id:         payout.id,
      amount_ngn:        totalKobo / 100,
      earnings_included: claimed.length,
      transfer_reference: transferReference,
      status:            "processing",
      account_name:      bankDetails.account_name,
      message:           "Payout initiated — funds will arrive within 1 business day",
    });
  }),

  /**
   * POST /api/payouts/webhook
   * Paystack transfer webhook — marks payout as completed or failed.
   * No JWT auth — Paystack signature verification is the security check.
   */
  webhook: asyncHandler(async (req, res) => {
    const hash = require("crypto")
      .createHmac("sha512", PAYSTACK_KEY())
      .update(JSON.stringify(req.body)).digest("hex");

    if (hash !== req.headers["x-paystack-signature"])
      return res.status(400).json({ success: false, message: "Invalid signature" });

    const { event, data } = req.body;
    await fulfillTransferEvent(event, data);
    res.status(200).json({ received: true });
  }),
};

/**
 * Fulfil a Paystack transfer webhook (instructor payout settlement).
 * Idempotent — updates are keyed by transfer_code. Returns true if the event
 * was a transfer event this domain owns, else false. Exported for the unified
 * /api/webhooks/paystack dispatcher, which verifies the signature once.
 */
export async function fulfillTransferEvent(event, data) {
  if (event === "transfer.success") {
    const { data: payout } = await db.from("payouts")
      .update({ status: "completed", completed_at: now(), provider_response: data })
      .eq("provider_reference", data.transfer_code)
      .select("instructor_id, amount").maybeSingle();
    if (payout?.instructor_id)
      notify.payoutCompleted({ instructorId: payout.instructor_id, amountNgn: (payout.amount || 0) / 100 });
    console.log(`[payouts] ✅ Transfer complete  ref=${data.transfer_code}`);
    return true;
  }

  if (event === "transfer.failed" || event === "transfer.reversed") {
    // Roll back earnings to pending so instructor can retry
    const { data: payout } = await db
      .from("payouts")
      .select("id, instructor_id, amount")
      .eq("provider_reference", data.transfer_code)
      .single();

    if (payout) {
      await db.from("payouts")
        .update({ status: "failed", failure_reason: data.reason ?? event, provider_response: data })
        .eq("id", payout.id);

      await db.from("instructor_earnings")
        .update({ status: "pending", payout_id: null })
        .eq("payout_id", payout.id);

      notify.payoutFailed({ instructorId: payout.instructor_id, amountNgn: (payout.amount || 0) / 100, reason: data.reason ?? null });
      console.warn(`[payouts] ⚠️  Transfer ${event}  ref=${data.transfer_code}`);
    }
    return true;
  }

  return false;
}

// ─── Admin handlers ────────────────────────────────────────────────────────────

const adminHandlers = {

  /**
   * GET /api/admin/earnings
   * Platform-wide earnings overview (admin only).
   */
  platformOverview: asyncHandler(async (req, res) => {
    const { data: earnings, error } = await db
      .from("instructor_earnings")
      .select("gross_amount, commission_amount, net_amount, status, currency");

    if (error) throw new Error(error.message);

    const all         = earnings ?? [];
    const totalGross  = all.reduce((s, e) => s + e.gross_amount, 0);
    const totalCommission = all.reduce((s, e) => s + e.commission_amount, 0);
    const totalNet    = all.reduce((s, e) => s + e.net_amount, 0);
    const pendingNet  = all.filter((e) => e.status === "pending").reduce((s, e) => s + e.net_amount, 0);
    const paidNet     = all.filter((e) => e.status === "paid").reduce((s, e) => s + e.net_amount, 0);

    res200(res, {
      commission_percent:          businessConfig.commissionPercent,
      total_gmv_ngn:               totalGross / 100,       // Gross Merchandise Value
      total_platform_revenue_ngn:  totalCommission / 100,
      total_instructor_earnings_ngn: totalNet / 100,
      pending_instructor_payouts_ngn: pendingNet / 100,
      paid_out_ngn:                paidNet / 100,
      total_transactions:          all.length,
    });
  }),

  /**
   * GET /api/admin/earnings/instructors
   * Per-instructor earnings summary (admin only).
   */
  byInstructor: asyncHandler(async (req, res) => {
    const { data: earnings, error } = await db
      .from("instructor_earnings")
      .select(`
        instructor_id, gross_amount, commission_amount, net_amount, status,
        instructor:users!instructor_earnings_instructor_id_fkey ( id, full_name, email, username )
      `);

    if (error) throw new Error(error.message);

    const grouped = {};
    for (const e of (earnings ?? [])) {
      const iid = e.instructor_id;
      if (!grouped[iid]) {
        grouped[iid] = {
          instructor_id:  iid,
          instructor:     e.instructor,
          total_sales:    0,
          gross_ngn:      0,
          platform_fee_ngn: 0,
          net_ngn:        0,
          pending_ngn:    0,
          paid_ngn:       0,
        };
      }
      grouped[iid].total_sales      += 1;
      grouped[iid].gross_ngn        += e.gross_amount / 100;
      grouped[iid].platform_fee_ngn += e.commission_amount / 100;
      grouped[iid].net_ngn          += e.net_amount / 100;
      if (e.status === "pending") grouped[iid].pending_ngn += e.net_amount / 100;
      if (e.status === "paid")    grouped[iid].paid_ngn    += e.net_amount / 100;
    }

    res200(res, Object.values(grouped).sort((a, b) => b.gross_ngn - a.gross_ngn));
  }),

  /**
   * GET /api/admin/payments
   * All payments across the platform (admin), newest first, with buyer + course.
   * Filters: status, email (buyer), limit.
   */
  paymentsList: asyncHandler(async (req, res) => {
    const { status, email, limit = 200 } = req.query;
    let q = db
      .from("payments")
      .select(`
        id, amount_paid, currency, payment_provider, provider_reference, status,
        paid_at, refunded_at, refund_reason, provider_response, created_at, updated_at,
        courses ( id, title ),
        users!payments_user_id_fkey ( id, full_name, email )
      `)
      .order("created_at", { ascending: false })
      .limit(Math.min(Number(limit) || 200, 500));

    if (status && status !== "all") q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    let rows = (data ?? []).map((p) => {
      const meta = p.provider_response || {};
      const isCart = !!meta.is_cart_checkout;
      return {
        id:            p.id,
        created_at:    p.created_at,
        updated_at:    p.updated_at,
        paid_at:       p.paid_at,
        user_name:     p.users?.full_name || null,
        user_email:    p.users?.email || null,
        course_title:  isCart ? `Cart · ${meta.item_count ?? (meta.course_ids?.length || 0) + (meta.listing_ids?.length || 0)} items` : (p.courses?.title || '—'),
        is_cart:       isCart,
        amount:        (p.amount_paid || 0) / 100,   // NGN
        currency:      p.currency || 'NGN',
        provider:      p.payment_provider || '—',
        reference:     p.provider_reference || null,
        status:        p.status,
        refund_reason: p.refund_reason || null,
      };
    });

    // Buyer-email filter (post-join, since it's on the related users row).
    if (email) {
      const needle = String(email).toLowerCase();
      rows = rows.filter((r) => (r.user_email || '').toLowerCase().includes(needle));
    }

    res200(res, rows, { total: rows.length });
  }),

  /**
   * GET /api/admin/payments/stats
   * Platform payment totals for the dashboard cards.
   */
  paymentsStats: asyncHandler(async (req, res) => {
    const { data, error } = await db.from("payments").select("amount_paid, status");
    if (error) throw new Error(error.message);
    const all = data ?? [];
    const sum = (pred) => all.filter(pred).reduce((s, p) => s + (p.amount_paid || 0), 0) / 100;
    res200(res, {
      total_revenue:  sum((p) => p.status === "success"),
      total_refunded: sum((p) => p.status === "refunded"),
      total_success:  all.filter((p) => p.status === "success").length,
      total_failed:   all.filter((p) => p.status === "failed").length,
      total_pending:  all.filter((p) => p.status === "pending").length,
      total_count:    all.length,
    });
  }),

  /**
   * PATCH /api/admin/payments/:paymentId/refund
   * Admin refund — no ownership check, no refund-window limit.
   */
  refundPayment: asyncHandler(async (req, res) => {
    const { data: payment } = await db
      .from("payments")
      .select("id, user_id, course_id, amount_paid, paid_at, status, provider_response")
      .eq("id", req.params.paymentId).single();

    if (!payment)                    return res.status(404).json({ success: false, message: "Payment not found" });
    if (payment.status !== "success") return res.status(400).json({ success: false, message: `Cannot refund: status is ${payment.status}` });

    await performRefund(payment, { reason: req.body?.reason ?? "Admin refund", byUserId: req.user.id, isAdmin: true });
    res200(res, { message: "Refund processed" });
  }),

  /**
   * GET /api/admin/payments/:reference/trace
   * One-call payment forensics for support: stitches together the payment row,
   * its normalized line items, the full append-only event log, any matching
   * agent-guide purchase, and a LIVE Paystack verification of the reference.
   * This is the "what actually happened to this order?" view.
   */
  paymentTrace: asyncHandler(async (req, res) => {
    const reference = req.params.reference;

    // Payment ledger row (by provider_reference).
    const { data: payment } = await db
      .from("payments")
      .select("*, courses ( id, title ), users!payments_user_id_fkey ( id, full_name, email )")
      .eq("provider_reference", reference)
      .maybeSingle();

    // Normalized line items (if we have the payment).
    let items = [];
    if (payment?.id) {
      const { data } = await db.from("payment_items").select("*").eq("payment_id", payment.id);
      items = data ?? [];
    }

    // Full event timeline — match by reference OR the resolved payment id.
    let eventsQuery = db.from("payment_events").select("*").order("created_at", { ascending: true });
    eventsQuery = payment?.id
      ? eventsQuery.or(`reference.eq.${reference},payment_id.eq.${payment.id}`)
      : eventsQuery.eq("reference", reference);
    const { data: events } = await eventsQuery;

    // Matching agent-guide purchase (marketplace lives in the edu schema).
    const { data: agentPurchase } = await db
      .schema("edu").from("agent_purchases")
      .select("id, student_id, agent_id, listing_id, amount_kobo, currency, paystack_status, access_granted, purchased_at")
      .eq("paystack_ref", reference)
      .maybeSingle();

    // Live Paystack truth — re-query the reference every time so support sees the
    // provider's current view, independent of our DB.
    let paystack = null;
    try { paystack = await verifyTransaction(reference); }
    catch (e) { paystack = { error: e?.message || "verify failed" }; }

    res200(res, {
      reference,
      payment:        payment ?? null,
      items,
      agent_purchase: agentPurchase ?? null,
      events:         events ?? [],
      paystack,       // { status, amount, currency, email, paid_at, metadata } or { error }
      reconciled:     !!(payment && paystack && payment.status === "success" && paystack.status === "success"),
    });
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

// Instructor earnings
router.get("/instructor/earnings",                    authenticateToken, requireRole(["instructor", "admin"]), earningsHandlers.overview);
router.get("/instructor/earnings/by-course",          authenticateToken, requireRole(["instructor", "admin"]), earningsHandlers.byCourse);
router.get("/instructor/earnings/monthly",            authenticateToken, requireRole(["instructor", "admin"]), earningsHandlers.monthly);

// Bank details
router.get ("/instructor/bank-details",               authenticateToken, requireRole(["instructor", "admin"]), bankHandlers.get);
router.post ("/instructor/bank-details/verify",       authenticateToken, requireRole(["instructor", "admin"]), [body("account_number").notEmpty(), body("bank_code").notEmpty()], runValidation, bankHandlers.verify);
router.put  ("/instructor/bank-details",              authenticateToken, requireRole(["instructor", "admin"]), [body("bank_code").notEmpty(), body("bank_name").notEmpty(), body("account_number").notEmpty(), body("account_name").notEmpty()], runValidation, bankHandlers.save);
router.get  ("/payouts/banks",                        authenticateToken, bankHandlers.listBanks);

// Payout requests
router.get  ("/instructor/payouts",                   authenticateToken, requireRole(["instructor", "admin"]), payoutHandlers.list);
router.post ("/instructor/payouts/request",           authenticateToken, requireRole(["instructor", "admin"]), payoutHandlers.request);
router.post ("/payouts/webhook",                                         payoutHandlers.webhook);

// Admin
router.get("/admin/earnings",                         authenticateToken, requireRole(["admin"]), adminHandlers.platformOverview);
router.get("/admin/earnings/instructors",             authenticateToken, requireRole(["admin"]), adminHandlers.byInstructor);
router.get  ("/admin/payments",                       authenticateToken, requireRole(["admin"]), adminHandlers.paymentsList);
router.get  ("/admin/payments/stats",                 authenticateToken, requireRole(["admin"]), adminHandlers.paymentsStats);
router.patch("/admin/payments/:paymentId/refund",     authenticateToken, requireRole(["admin"]), adminHandlers.refundPayment);
router.get  ("/admin/payments/:reference/trace",      authenticateToken, requireRole(["admin"]), adminHandlers.paymentTrace);

export default router;
