/**
 * modules/school/service-billing.js — payment gateway credentials, admission
 * form configuration and the subscription checkout/verify flow.
 *
 * Secrets are masked on read; money is stored in kobo. Queries live in
 * store-billing.js / store-site.js.
 */

import crypto from "crypto";
import {
  initializeTransaction,
  verifyTransaction,
  generateReference,
} from "../../lib/paystackService.js";
import { urlFor } from "../../lib/urls.js";
import * as store from "./store.js";
import * as billing from "./store-billing.js";
import * as site from "./store-site.js";
import { shapePaymentGateway, toNaira } from "./rules.js";
import { getMySchool } from "./service.js";

const SCHOOL_FRONTEND_URL = urlFor("SCHOOL_FRONTEND_URL");

// =============================================================
// PAYMENT GATEWAY SETTINGS — online fee collection. Secrets are stored but
// never returned raw; GET responses mask them and only report whether a
// value is set (hasLiveKeySecret, etc).
// =============================================================

// ── GET /api/school/payment-gateway ───────────────────────────────────────────
export async function getPaymentGateway(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await billing.paymentGatewayBySchool(school.id);
    res.json({ success: true, data: shapePaymentGateway(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PUT /api/school/payment-gateway ───────────────────────────────────────────
// Secret fields (liveKeySecret, sandboxKeySecret, webhookSecret) are only
// overwritten when a non-empty value is sent — leave blank to keep saved.
export async function updatePaymentGateway(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const b = req.body || {};
    const patch = { school_id: school.id, updated_at: new Date() };
    if (b.enabled !== undefined) patch.enabled = !!b.enabled;
    if (b.provider !== undefined) patch.provider = b.provider;
    if (b.mode !== undefined) patch.mode = b.mode;
    if (b.liveKeyId !== undefined) patch.live_key_id = b.liveKeyId;
    if (b.sandboxKeyId !== undefined) patch.sandbox_key_id = b.sandboxKeyId;
    if (b.liveKeySecret)    patch.live_key_secret = b.liveKeySecret;
    if (b.sandboxKeySecret) patch.sandbox_key_secret = b.sandboxKeySecret;
    if (b.webhookSecret)    patch.webhook_secret = b.webhookSecret;
    if (b.surchargeType !== undefined) patch.surcharge_type = b.surchargeType;
    if (b.surchargeAmount !== undefined) patch.surcharge_amount = b.surchargeAmount;

    const { data, error } = await billing.paymentGatewayUpsert(patch);
    if (error) throw new Error(error.message);
    res.json({ success: true, data: shapePaymentGateway(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// =============================================================
// ADMISSION FORM CONFIGURATION
// =============================================================

async function getAdmissionSettings(schoolId) {
  const { data } = await site.admissionSettings(schoolId);
  if (data) return data;
  const { data: created } = await site.admissionSettingsCreate(schoolId);
  return created;
}

// ── GET /api/school/admission ─────────────────────────────────────────────────
export async function getAdmission(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const settings = await getAdmissionSettings(school.id);
    const { data: fields } = await site.admissionFields(school.id);
    res.json({
      success: true,
      data: {
        settings: {
          enabled: settings.enabled, slug: settings.slug || school.slug || "",
          feeAmount: settings.fee_amount, qrCodeUrl: settings.qr_code_url,
        },
        fields: (fields || []).map((f) => ({
          id: f.id, label: f.label, type: f.field_type, options: f.options || [],
          required: f.required, sortOrder: f.sort_order,
        })),
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PUT /api/school/admission/settings ────────────────────────────────────────
// Body: { enabled?, slug?, feeAmount?, qrCodeUrl? }
export async function updateAdmissionSettings(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    await getAdmissionSettings(school.id); // ensure row exists
    const b = req.body || {};
    const patch = { updated_at: new Date() };
    if (b.enabled !== undefined) patch.enabled = !!b.enabled;
    if (b.slug !== undefined) patch.slug = b.slug?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-") || null;
    if (b.feeAmount !== undefined) patch.fee_amount = b.feeAmount;
    if (b.qrCodeUrl !== undefined) patch.qr_code_url = b.qrCodeUrl;

    const { data, error } = await site.admissionSettingsUpdate(school.id, patch);
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "That URL slug is already taken" });
      throw new Error(error.message);
    }
    res.json({ success: true, data: { enabled: data.enabled, slug: data.slug, feeAmount: data.fee_amount, qrCodeUrl: data.qr_code_url } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/admission/fields ─────────────────────────────────────────
// Body: { label, type?, options?, required?, sortOrder? }
export async function createAdmissionField(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { label, type = "text", options = [], required = false, sortOrder = 0 } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: "label is required" });
    const { data, error } = await site.admissionFieldInsert({
      school_id: school.id, label: label.trim(), field_type: type, options, required, sort_order: sortOrder,
    });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data: { id: data.id, label: data.label, type: data.field_type, options: data.options || [], required: data.required, sortOrder: data.sort_order } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PUT /api/school/admission/fields/:id ──────────────────────────────────────
export async function updateAdmissionField(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const patch = {};
    if (req.body.label !== undefined) patch.label = req.body.label;
    if (req.body.type !== undefined) patch.field_type = req.body.type;
    if (req.body.options !== undefined) patch.options = req.body.options;
    if (req.body.required !== undefined) patch.required = req.body.required;
    if (req.body.sortOrder !== undefined) patch.sort_order = req.body.sortOrder;
    const { data, error } = await site.admissionFieldUpdate(school.id, req.params.id, patch);
    if (error) throw new Error(error.message);
    res.json({ success: true, data: { id: data.id, label: data.label, type: data.field_type, options: data.options || [], required: data.required, sortOrder: data.sort_order } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── DELETE /api/school/admission/fields/:id ───────────────────────────────────
export async function deleteAdmissionField(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await site.admissionFieldDelete(school.id, req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// =============================================================
// SUBSCRIPTION — Manage Subscription + Payment History.
// Plans are a platform-owned catalog (edu.subscription_plans, prices in
// kobo). Checkout mirrors the instructor tools Paystack flow.
// =============================================================

async function getMySubscription(schoolId) {
  const { data } = await billing.subscriptionBySchool(schoolId);
  if (data) return data;
  const { data: created } = await billing.subscriptionCreate(schoolId);
  return created;
}

async function getUserEmail(userId) {
  try {
    const { data } = await store.authUserEmail(userId);
    return data?.user?.email || null;
  } catch { return null; }
}

// ── GET /api/school/subscription ──────────────────────────────────────────────
export async function getSubscription(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const [{ data: plans }, sub] = await Promise.all([
      billing.activePlans(),
      getMySubscription(school.id),
    ]);
    const plan = (plans || []).find((p) => p.key === sub.plan_key);
    res.json({
      success: true,
      data: {
        plans: (plans || []).map((p) => ({
          key: p.key, name: p.name, description: p.description, maxStudents: p.max_students,
          priceMonthly: toNaira(p.price_monthly_kobo), priceYearly: toNaira(p.price_yearly_kobo),
        })),
        current: {
          planKey: sub.plan_key, name: plan?.name || sub.plan_key, description: plan?.description || "",
          maxStudents: plan?.max_students || 0, status: sub.status, billingCycle: sub.billing_cycle,
          startsAt: sub.starts_at, endsAt: sub.ends_at,
        },
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/subscription/checkout ─────────────────────────────────────
// Body: { planKey, cycle: 'monthly' | 'yearly' }
export async function checkoutSubscription(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { planKey, cycle = "yearly" } = req.body;
    if (!["monthly", "yearly"].includes(cycle)) return res.status(400).json({ error: "cycle must be 'monthly' or 'yearly'" });

    const { data: plan } = await billing.planByKey(planKey);
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    const amountKobo = cycle === "monthly" ? plan.price_monthly_kobo : plan.price_yearly_kobo;
    const orderId = `order_${crypto.randomBytes(8).toString("hex")}`;

    // Free plan (e.g. Trial) — activate immediately, no payment needed.
    if (!amountKobo) {
      await billing.subscriptionUpsert({
        school_id: school.id, plan_key: plan.key, status: "active", billing_cycle: cycle,
        starts_at: new Date(), ends_at: new Date(Date.now() + (cycle === "monthly" ? 30 : 365) * 86400000),
        updated_at: new Date(),
      });
      await billing.subscriptionPaymentInsert({
        school_id: school.id, order_id: orderId, plan_key: plan.key, billing_cycle: cycle,
        amount_kobo: 0, method: "Free", status: "paid", paid_at: new Date(),
      });
      return res.json({ success: true, free: true, message: `${plan.name} activated.` });
    }

    const email = req.body.email || req.user.email || (await getUserEmail(req.user.id));
    if (!email) return res.status(400).json({ error: "email required for payment" });

    const reference = generateReference("SUB");
    await billing.subscriptionPaymentInsert({
      school_id: school.id, order_id: orderId, plan_key: plan.key, billing_cycle: cycle,
      amount_kobo: amountKobo, method: "Paystack", paystack_ref: reference, status: "pending",
    });

    const paystack = await initializeTransaction({
      email,
      amount_kobo: amountKobo,
      reference,
      callback_url: `${SCHOOL_FRONTEND_URL}/settings-subscription?sub_ref=${reference}`,
      metadata: { school_id: school.id, plan_key: plan.key, billing_cycle: cycle, kind: "school_subscription" },
    });

    res.json({ success: true, authorization_url: paystack.authorization_url, reference, orderId });
  } catch (e) {
    console.error("[subscription/checkout]", e);
    res.status(500).json({ error: e.message });
  }
}

// ── GET /api/school/subscription/verify/:reference ─────────────────────────────
export async function verifySubscription(req, res) {
  try {
    // Scope to the caller's own school — no verifying another school's payment.
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: payment } = await billing.paymentByRef(school.id, req.params.reference);
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    if (payment.status === "paid") return res.json({ success: true, activated: true, alreadyProcessed: true });

    const tx = await verifyTransaction(req.params.reference);
    if (tx.status === "success") {
      await billing.paymentUpdate(payment.id, { status: "paid", paid_at: new Date(), transaction_id: String(tx.id || "") });
      const days = payment.billing_cycle === "monthly" ? 30 : 365;
      await billing.subscriptionUpsert({
        school_id: payment.school_id, plan_key: payment.plan_key, status: "active",
        billing_cycle: payment.billing_cycle, starts_at: new Date(),
        ends_at: new Date(Date.now() + days * 86400000), updated_at: new Date(),
      });
      return res.json({ success: true, activated: true, message: "Payment verified — subscription activated!" });
    }

    await billing.paymentUpdate(payment.id, { status: "failed" });
    res.json({ success: false, activated: false, status: tx.status, message: "Payment not successful" });
  } catch (e) {
    console.error("[subscription/verify]", e);
    res.status(500).json({ error: e.message });
  }
}

// ── GET /api/school/subscription/payments ───────────────────────────────────────
export async function listSubscriptionPayments(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: plans } = await billing.planNames();
    const planName = Object.fromEntries((plans || []).map((p) => [p.key, p.name]));

    const { data } = await billing.subscriptionPaymentsBySchool(school.id);

    res.json({ success: true, data: (data || []).map((p) => ({
      id: p.id, orderId: p.order_id, plan: planName[p.plan_key] || p.plan_key,
      amount: toNaira(p.amount_kobo), method: p.method, transactionId: p.transaction_id,
      proofUrl: p.proof_url, status: p.status, createdAt: p.created_at, paidAt: p.paid_at,
    })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
