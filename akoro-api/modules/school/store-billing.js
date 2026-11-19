/**
 * modules/school/store-billing.js — Supabase queries for the payment gateway,
 * admission checkout plans and school subscriptions. No Express import.
 */

import db from "../../db.js";

const edu = () => db.schema("edu");

// ── edu.school_payment_gateway ───────────────────────────────────────────────
export const paymentGatewayBySchool = (schoolId) => edu()
  .from("school_payment_gateway").select("*").eq("school_id", schoolId).maybeSingle();

export const paymentGatewayUpsert = (patch) => edu()
  .from("school_payment_gateway").upsert(patch, { onConflict: "school_id" }).select("*").single();

// ── edu.subscription_plans ───────────────────────────────────────────────────
export const activePlans = () => edu()
  .from("subscription_plans")
  .select("key, name, description, max_students, price_monthly_kobo, price_yearly_kobo")
  .eq("is_active", true).order("sort_order", { ascending: true });

export const planByKey = (key) => edu()
  .from("subscription_plans").select("*").eq("key", key).eq("is_active", true).maybeSingle();

export const planNames = () => edu()
  .from("subscription_plans").select("key, name");

// ── edu.school_subscriptions ─────────────────────────────────────────────────
export const subscriptionBySchool = (schoolId) => edu()
  .from("school_subscriptions").select("*").eq("school_id", schoolId).maybeSingle();

export const subscriptionCreate = (schoolId) => edu()
  .from("school_subscriptions").insert({ school_id: schoolId }).select("*").single();

export const subscriptionUpsert = (row) => edu()
  .from("school_subscriptions").upsert(row, { onConflict: "school_id" });

// ── edu.school_subscription_payments ─────────────────────────────────────────
export const subscriptionPaymentInsert = (row) => edu()
  .from("school_subscription_payments").insert(row);

export const paymentByRef = (schoolId, reference) => edu()
  .from("school_subscription_payments").select("*").eq("paystack_ref", reference).eq("school_id", schoolId).maybeSingle();

export const paymentUpdate = (paymentId, patch) => edu()
  .from("school_subscription_payments").update(patch).eq("id", paymentId);

export const subscriptionPaymentsBySchool = (schoolId) => edu()
  .from("school_subscription_payments")
  .select("id, order_id, plan_key, amount_kobo, method, transaction_id, proof_url, status, created_at, paid_at")
  .eq("school_id", schoolId)
  .order("created_at", { ascending: false });
