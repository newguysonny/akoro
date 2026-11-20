import db from "../../../db.js";

export async function getUserEmail(userId) {
  const { data } = await db.from("users").select("email").eq("id", userId).maybeSingle();
  return data?.email || null;
}

export async function getAgentOrchestrationConfig(agentId) {
  const { data } = await db
    .schema("edu").from("agent_orchestration_config")
    .select("teacher_id, guide_config, flow_type")
    .eq("agent_id", agentId)
    .single();
  return data;
}

export async function insertListing(payload) {
  const { data, error } = await db
    .schema("edu").from("marketplace_listings")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getListingTeacherId(listingId) {
  const { data } = await db
    .schema("edu").from("marketplace_listings")
    .select("teacher_id")
    .eq("id", listingId)
    .single();
  return data;
}

export async function updateListing(listingId, updates) {
  const { data, error } = await db
    .schema("edu").from("marketplace_listings")
    .update(updates)
    .eq("id", listingId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deactivateListing(listingId) {
  await db
    .schema("edu").from("marketplace_listings")
    .update({ is_active: false, updated_at: new Date() })
    .eq("id", listingId);
}

export async function listActiveListings({ subject, free, term, limit, offset }) {
  let query = db
    .schema("edu").from("marketplace_summary")
    .select("*")
    .eq("is_active", true)
    .order("avg_rating",     { ascending: false })
    .order("total_students", { ascending: false })
    .range(offset, offset + limit - 1);

  if (subject)        query = query.eq("subject", subject);
  if (free === "true") query = query.eq("is_free", true);
  if (term) query = query.or(`title.ilike.%${term}%,teacher_name.ilike.%${term}%,subject.ilike.%${term}%,description.ilike.%${term}%`);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getListingById(listingId) {
  const { data } = await db
    .schema("edu").from("marketplace_summary")
    .select("*")
    .eq("id", listingId)
    .single();
  return data;
}

export async function listListingsBySubject(subject, { limit, offset }) {
  const { data, error } = await db
    .schema("edu").from("marketplace_summary")
    .select("*")
    .eq("subject", subject)
    .order("avg_rating", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data || [];
}

export async function searchListings({ term, subject, limit }) {
  let query = db
    .schema("edu").from("marketplace_summary")
    .select("*")
    .or(`title.ilike.%${term}%,description.ilike.%${term}%,subject.ilike.%${term}%`)
    .limit(limit);

  if (subject) query = query.eq("subject", subject);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getActiveListing(listingId) {
  const { data } = await db
    .schema("edu").from("marketplace_listings")
    .select("*")
    .eq("id", listingId)
    .eq("is_active", true)
    .single();
  return data;
}

export async function getGrantedPurchase(studentId, listingId) {
  const { data } = await db
    .schema("edu").from("agent_purchases")
    .select("id, access_granted")
    .eq("student_id", studentId)
    .eq("listing_id", listingId)
    .eq("access_granted", true)
    .single();
  return data;
}

export async function insertPurchase(record) {
  await db.schema("edu").from("agent_purchases").insert(record);
}

export async function getPurchaseByReference(reference) {
  const { data } = await db
    .schema("edu").from("agent_purchases")
    .select("*")
    .eq("paystack_ref", reference)
    .single();
  return data;
}

export async function updatePurchasePaystackStatus(purchaseId, status) {
  await db
    .schema("edu").from("agent_purchases")
    .update({ paystack_status: status })
    .eq("id", purchaseId);
}

export async function getPurchaseFulfillment(purchaseId) {
  const { data } = await db
    .schema("edu").from("agent_purchases")
    .select("id, access_granted")
    .eq("id", purchaseId)
    .single();
  return data;
}

export async function getCallbackPurchase(reference) {
  const { data } = await db
    .schema("edu").from("agent_purchases")
    .select("agent_id, student_id, listing_id, access_granted")
    .eq("paystack_ref", reference)
    .single();
  return data;
}

export async function grantAgentAccess(studentId, agentId, purchaseId) {
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

  await db
    .schema("edu").from("agent_purchases")
    .update({
      access_granted:   true,
      paystack_status:  "success",
      verified_at:      new Date(),
    })
    .eq("id", purchaseId);
}

export async function incrementListingStudents(listingId) {
  const { error } = await db.rpc("increment_listing_students", { p_listing_id: listingId });
  if (error) console.error("[marketplace] increment_listing_students failed:", error.message);
}

export async function getInstructorToolAccess(reference) {
  const { data } = await db
    .schema("edu").from("instructor_tool_access")
    .select("id, instructor_id, access_granted")
    .eq("paystack_ref", reference)
    .single();
  return data;
}

export async function grantInstructorToolAccess(id) {
  await db.schema("edu").from("instructor_tool_access").update({
    access_granted:  true,
    paystack_status: "success",
    verified_at:     new Date(),
  }).eq("id", id);
}

export async function revokeAgentPurchaseByReference(reference) {
  await db
    .schema("edu").from("agent_purchases")
    .update({ paystack_status: "refunded", access_granted: false })
    .eq("paystack_ref", reference);
}

export async function getUserAgentPreferences(userId) {
  const { data } = await db
    .schema("edu").from("user_agent_preferences")
    .select("*")
    .eq("user_id", userId)
    .single();
  return data;
}

export async function getActiveListingProfiles(agentIds) {
  const { data } = await db
    .schema("edu").from("marketplace_listings")
    .select("id, agent_id, title, subject, teacher_name, teacher_avatar, style_summary, avg_rating")
    .in("agent_id", agentIds)
    .eq("is_active", true);
  return data || [];
}

export async function upsertUserAgentPreferences(payload) {
  await db
    .schema("edu").from("user_agent_preferences")
    .upsert(payload, { onConflict: "user_id" });
}

export async function userOwnsAgent(userId, agentId) {
  const { data: owns } = await db
    .rpc("edu.user_owns_agent", { p_user_id: userId, p_agent_id: agentId });
  return owns;
}

export async function listPurchases(studentId) {
  const { data, error } = await db
    .schema("edu").from("agent_purchases")
    .select(`
      id, agent_id, amount_kobo, currency, paystack_ref,
      paystack_status, access_granted, purchased_at,
      edu.marketplace_listings!inner(title, subject, teacher_name, price_kobo)
    `)
    .eq("student_id", studentId)
    .order("purchased_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getReviewablePurchase(studentId, listingId) {
  const { data } = await db
    .schema("edu").from("agent_purchases")
    .select("id")
    .eq("student_id", studentId)
    .eq("listing_id", listingId)
    .eq("access_granted", true)
    .single();
  return data;
}

export async function upsertReview(payload) {
  const { data, error } = await db
    .schema("edu").from("marketplace_reviews")
    .upsert(payload, { onConflict: "listing_id,student_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listReviews(listingId, { limit, offset }) {
  const { data, error } = await db
    .schema("edu").from("marketplace_reviews")
    .select("id, rating, review_text, created_at")
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data || [];
}
