/**
 * cart-store.js — every Supabase query for cart and checkout.
 *
 * No Express import and no request/response objects: the service passes plain
 * ids and payloads. Queries, columns and conflict targets are the originals,
 * unchanged, so join shapes and status semantics stay identical.
 */

import crypto from "crypto";
import db from "../../db.js";

// ─── § CART READS ─────────────────────────────────────────────────────────────

/** Cart rows for a user, oldest first, with the course + instructor join. */
export function listCartItems(userId) {
  return db
    .from("cart_items")
    .select(`
      id, added_at, item_type, course_id, listing_id,
      courses (
        id, title, slug, cover_image_url, course_type,
        price, discount_price, discount_expires_at,
        currency, is_free, is_published,
        users!courses_instructor_id_fkey ( id, full_name, avatar_url )
      )
    `)
    .eq("user_id", userId)
    .order("added_at", { ascending: true });
}

/** Active enrolment course ids among the given cart course ids. */
export function listActiveEnrollmentCourseIds(userId, courseIds) {
  return db.from("enrollments")
    .select("course_id").eq("user_id", userId).eq("status", "active").in("course_id", courseIds);
}

export function findCartItemByCourse(userId, courseId) {
  return db.from("cart_items").select("id").eq("user_id", userId).eq("course_id", courseId).single();
}

export function findCartItemByListing(userId, listingId) {
  return db.from("cart_items").select("id").eq("user_id", userId).eq("listing_id", listingId).single();
}

export function findCourse(courseId) {
  return db.from("courses").select("id, title, is_published, is_free").eq("id", courseId).single();
}

export function findPublishedCourse(courseId) {
  return db.from("courses").select("id, title, is_published").eq("id", courseId).single();
}

export function findActiveEnrollment(userId, courseId) {
  return db.from("enrollments")
    .select("id").eq("user_id", userId).eq("course_id", courseId).eq("status", "active").single();
}

export function findActiveCoupon(code) {
  return db.from("coupons").select("*").eq("code", code).eq("is_active", true).single();
}

// ─── § AGENT LISTINGS ─────────────────────────────────────────────────────────

/** Listings for cart display: price, cover, teacher, currency. */
export function listAgentListings(listingIds) {
  return db
    .schema("edu").from("marketplace_listings")
    .select("id, agent_id, title, subject, teacher_name, teacher_avatar, cover_image_url, price_kobo, currency, is_active")
    .in("id", listingIds);
}

/** Listings for webhook fulfilment: the fields needed to grant + notify. */
export function listAgentListingsForFulfilment(listingIds) {
  return db
    .schema("edu").from("marketplace_listings")
    .select("id, agent_id, title, price_kobo, currency").in("id", listingIds);
}

export function findActiveAgentListing(listingId) {
  return db
    .schema("edu").from("marketplace_listings")
    .select("id, title, agent_id, is_active")
    .eq("id", listingId).eq("is_active", true).single();
}

export function findOwnedAgent(userId, listingId) {
  return db
    .schema("edu").from("agent_purchases")
    .select("id").eq("student_id", userId).eq("listing_id", listingId).eq("access_granted", true).single();
}

// ─── § CART WRITES ────────────────────────────────────────────────────────────

export function insertAgentCartItem(userId, listingId) {
  return db.from("cart_items").insert({ user_id: userId, item_type: "agent", listing_id: listingId });
}

export function insertCourseCartItem(userId, courseId) {
  return db.from("cart_items").insert({ user_id: userId, course_id: courseId }).select().single();
}

export function upsertCartCourse(userId, courseId) {
  return db.from("cart_items").upsert({ user_id: userId, course_id: courseId }, { onConflict: "user_id,course_id" });
}

export function deleteCartCourse(userId, courseId) {
  return db.from("cart_items").delete().eq("user_id", userId).eq("course_id", courseId);
}

export function deleteCartListing(userId, listingId) {
  return db.from("cart_items").delete().eq("user_id", userId).eq("listing_id", listingId);
}

export function deleteCartCourses(userId, courseIds) {
  return db.from("cart_items").delete().eq("user_id", userId).in("course_id", courseIds);
}

export function deleteCartListings(userId, listingIds) {
  return db.from("cart_items").delete().eq("user_id", userId).in("listing_id", listingIds);
}

export function clearCart(userId) {
  return db.from("cart_items").delete().eq("user_id", userId);
}

export function removeWishlistItem(userId, courseId) {
  return db.from("wishlists").delete().eq("user_id", userId).eq("course_id", courseId);
}

// ─── § ENROLMENTS & EARNINGS ──────────────────────────────────────────────────

export function upsertEnrollment({ userId, courseId }) {
  return db.from("enrollments").upsert(
    { user_id: userId, course_id: courseId, status: "active" },
    { onConflict: "user_id,course_id" }
  );
}

export function upsertEnrollmentWithPayment({ userId, courseId, paymentId }) {
  return db.from("enrollments").upsert(
    { user_id: userId, course_id: courseId, payment_id: paymentId, status: "active" },
    { onConflict: "user_id,course_id" }
  );
}

export async function incrementCourseStudents(courseId) {
  return db.rpc("increment_course_students", { course_id_input: courseId });
}

export function findCourseForEarnings(courseId) {
  return db.from("courses").select("instructor_id, currency, title").eq("id", courseId).single();
}

export function upsertInstructorEarning(row) {
  return db.from("instructor_earnings").upsert(row, { onConflict: "payment_id,course_id" });
}

// ─── § PAYMENTS ───────────────────────────────────────────────────────────────

export function findPaymentByReference(reference, userId) {
  return db.from("payments").select("*").eq("provider_reference", reference).eq("user_id", userId).single();
}

export function findPaymentTotals(paymentId) {
  return db.from("payments").select("amount_paid, provider_reference").eq("id", paymentId).single();
}

export function markPaymentPaid(paymentId, providerResponse, paidAt) {
  return db
    .from("payments")
    .update({ status: "success", paid_at: paidAt, provider_response: providerResponse })
    .eq("id", paymentId).eq("status", "pending").select().maybeSingle();
}

export function insertDirectPayment(row) {
  return db.from("payments").insert(row).select("id").single();
}

export function insertPendingPayment(row) {
  return db.from("payments").insert(row).select().single();
}

export function setPaymentReference(paymentId, reference) {
  return db.from("payments").update({ provider_reference: reference }).eq("id", paymentId);
}

export function findUser(userId) {
  return db.from("users").select("email, full_name").eq("id", userId).single();
}

export function insertCouponUse({ couponId, userId, paymentId }) {
  return db.from("coupon_uses").insert({ coupon_id: couponId, user_id: userId, payment_id: paymentId });
}

export async function incrementCouponUses(couponId) {
  return db.rpc("increment_coupon_uses", { coupon_id_input: couponId });
}

// ─── § AGENT GRANT ────────────────────────────────────────────────────────────

// Grant a purchased agent to a learner (idempotent): record the purchase, add
// the agent to their purchased_agents, and bump the listing's student count.
// Mirrors the marketplace's grantAgentAccess so cart + direct purchase agree.
export const grantAgentFromCart = async (userId, { listingId, agentId, amountKobo = 0, currency = "NGN", paymentRef }) => {
  // Already owns it? skip.
  const { data: owned } = await findOwnedAgent(userId, listingId);
  if (owned) return;

  const purchaseId = crypto.randomUUID();
  try {
    await db.schema("edu").from("agent_purchases").insert({
      id: purchaseId, student_id: userId, agent_id: agentId, listing_id: listingId,
      amount_kobo: amountKobo, currency, paystack_ref: paymentRef || `CART-${purchaseId}`,
      paystack_status: "success", access_granted: true, verified_at: new Date(),
    });
  } catch { /* ignore duplicate */ }

  const { data: prefs } = await db
    .schema("edu").from("user_agent_preferences").select("purchased_agents").eq("user_id", userId).single();
  const existing = prefs?.purchased_agents || [];
  if (!existing.includes(agentId)) {
    await db.schema("edu").from("user_agent_preferences")
      .upsert({ user_id: userId, purchased_agents: [...existing, agentId], updated_at: new Date() }, { onConflict: "user_id" });
  }

  try {
    const { data: l } = await db.schema("edu").from("marketplace_listings").select("total_students").eq("id", listingId).single();
    if (l) await db.schema("edu").from("marketplace_listings")
      .update({ total_students: (l.total_students || 0) + 1, updated_at: new Date() }).eq("id", listingId);
  } catch { /* best-effort */ }
};
