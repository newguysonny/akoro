/**
 * modules/communities/store.js — Supabase access for communities.
 *
 * Every function here is a query (or a pair of queries over the same table)
 * and nothing else: no HTTP responses, no membership decisions, no payload
 * shaping beyond a Map/array. The flows live in service.js and the pure gates
 * in rules.js.
 *
 * All reads that can wedge a learner's page run through
 * lib/queryDeadline.step(), so a stuck query answers 504 instead of hanging;
 * the step label is the one named in the logs. Labels are kept identical to
 * the pre-split routes.js so existing diagnostics and grep proofs still work.
 */

import db                     from "../../db.js";
import { step }               from "../../lib/queryDeadline.js";

const edu = () => db.schema("edu");

/* Supabase's REST client returns structured errors. Retain that information
   instead of throwing only its message, so a missing newly-deployed table can
   be distinguished from an unexpected application failure below. */
export const communityDbError = (error, operation) => {
  const err = new Error(error?.message || `Could not ${operation}.`);
  err.code = error?.code;
  err.details = error?.details;
  err.hint = error?.hint;
  err.operation = operation;
  return err;
};

export const isCommunitySchemaUnavailable = (err) => {
  const text = [err?.message, err?.details, err?.hint].filter(Boolean).join(" ");
  return err?.code === "42P01" || err?.code === "PGRST106" || err?.code === "PGRST205" ||
    /(?:schema cache|schema .* not (?:exposed|allowed)|relation .* does not exist|could not find (?:the )?table)/i.test(text);
};

// ─── display extras ─────────────────────────────────────────────────────────

/** Member counts for the given community ids, in one query. */
export async function memberCounts(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await step("memberCounts", edu().from("community_members")
    .select("community_id").in("community_id", ids));
  if (error) throw communityDbError(error, "load member counts");
  const counts = new Map();
  for (const r of data || []) counts.set(r.community_id, (counts.get(r.community_id) || 0) + 1);
  return counts;
}

/** Display names for the given user ids, in one query. */
export async function userNames(userIds) {
  if (!userIds.length) return new Map();
  const { data, error } = await step("userNames", db.from("users")
    .select("id, full_name").in("id", [...new Set(userIds)]));
  if (error) throw communityDbError(error, "load names");
  const names = new Map();
  for (const u of data || []) names.set(u.id, u.full_name || "");
  return names;
}

/** Names + avatars for a message page's authors, in one query. */
export async function discussionAuthors(userIds) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  const { data, error } = await step("discussionAuthors", db.from("users")
    .select("id, full_name, avatar_url").in("id", ids));
  if (error) throw communityDbError(error, "load the discussion");
  return new Map((data || []).map((u) => [u.id, u]));
}

/** Names + avatars for a member list, in one query. */
export async function usersByIds(ids) {
  const { data } = await db.from("users")
    .select("id, full_name, avatar_url").in("id", ids);
  return data || [];
}

// ─── communities ────────────────────────────────────────────────────────────

/** Fetch one community row or null. The error is surfaced (not folded
    into a null) so an unready schema reaches the 503 handler in routes.js
    instead of masquerading as "Not found". */
export async function findCommunity(id) {
  const { data, error } = await step("findCommunity", edu().from("communities").select("*").eq("id", id).maybeSingle());
  if (error) throw communityDbError(error, "load this community");
  return data ?? null;
}

export async function listMyCommunities(userId) {
  const { data, error } = await edu().from("community_members")
    .select("role, joined_at, communities(*)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false });
  if (error) throw communityDbError(error, "complete this community request");
  return data || [];
}

export async function listPublicCommunities({ term, limit }) {
  let query = edu().from("communities").select("*").eq("is_public", true);
  if (term) query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) throw communityDbError(error, "complete this community request");
  return data || [];
}

export async function insertCommunity(row) {
  const { data: created, error } = await edu().from("communities")
    .insert(row)
    .select("*")
    .single();
  if (error) throw communityDbError(error, "create this community");
  return created;
}

/** Owner membership insert. Raw result: service.js rolls the community back
    when this fails, so it needs the error rather than a throw. */
export async function insertOwnerMembership(communityId, userId) {
  return edu().from("community_members")
    .insert({ community_id: communityId, user_id: userId, role: "owner" })
    .select("role, joined_at")
    .single();
}

/** Raw delete: used both by creator deletion and the creation rollback. */
export async function deleteCommunityRow(id) {
  return edu().from("communities").delete().eq("id", id);
}

export async function updateCommunity(id, patch) {
  const { data, error } = await edu().from("communities")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw communityDbError(error, "complete this community request");
  return data;
}

export async function upsertMember(communityId, userId) {
  const { error } = await edu().from("community_members")
    .upsert(
      { community_id: communityId, user_id: userId, role: "member" },
      { onConflict: "community_id,user_id" }
    );
  if (error) throw communityDbError(error, "complete this community request");
}

export async function deleteMember(communityId, userId) {
  const { error } = await edu().from("community_members")
    .delete().eq("community_id", communityId).eq("user_id", userId);
  if (error) throw communityDbError(error, "complete this community request");
}

export async function listMembers(communityId) {
  const { data, error } = await edu().from("community_members")
    .select("user_id, role, joined_at")
    .eq("community_id", communityId)
    .order("joined_at", { ascending: true });
  if (error) throw communityDbError(error, "complete this community request");
  return data || [];
}

// ─── membership ─────────────────────────────────────────────────────────────

/** Is this user a member (owner included) of the community? */
export async function isMember(communityId, userId) {
  const { data } = await step("membership", edu().from("community_members")
    .select("user_id").eq("community_id", communityId).eq("user_id", userId).maybeSingle());
  return !!data;
}

export async function myMembership(communityId, userId) {
  const { data } = await step("myMembership", edu().from("community_members")
    .select("role, joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle());
  return data ?? null;
}

export async function discussionReadMembership(communityId, userId) {
  const { data } = await step("discussionReadMembership", edu().from("community_members")
    .select("user_id").eq("community_id", communityId).eq("user_id", userId).maybeSingle());
  return data ?? null;
}

export async function discussionWriteMembership(communityId, userId) {
  const { data } = await step("discussionWriteMembership", edu().from("community_members")
    .select("user_id").eq("community_id", communityId).eq("user_id", userId).maybeSingle());
  return data ?? null;
}

/** Membership row for the paths that historically ran outside the deadline. */
export async function readMembership(communityId, userId, columns = "user_id") {
  const { data } = await edu().from("community_members")
    .select(columns).eq("community_id", communityId).eq("user_id", userId).maybeSingle();
  return data ?? null;
}

export async function memberCommunityIds(userId, communityIds) {
  const { data: mems } = await step("communityMembership", edu().from("community_members")
    .select("community_id").eq("user_id", userId).in("community_id", communityIds));
  return new Set((mems || []).map((m) => m.community_id));
}

export async function myCommunityIds(userId) {
  const { data: mems, error } = await step("discussionMyMemberships", edu().from("community_members")
    .select("community_id").eq("user_id", userId));
  if (error) throw communityDbError(error, "open this discussion");
  return [...new Set((mems || []).map((m) => m.community_id))];
}

// ─── activities + submissions ───────────────────────────────────────────────

/** Fetch one activity row or null. */
export async function findActivity(id) {
  const { data } = await edu().from("community_activities").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

/** Submission rows (activity_id) for the given activity ids, deadline-capped.
    Returns the raw { data, error } because the caller checks the error AFTER
    the parallel name lookup settles — preserving the pre-split rejection
    ordering (a builder resolves with an error, it does not reject). */
export async function activitySubmissions(activityIds) {
  return step("activitySubmissions", edu().from("community_activity_submissions")
    .select("activity_id").in("activity_id", activityIds));
}

export async function upsertSubmission(activityId, userId, at) {
  const { error } = await edu().from("community_activity_submissions")
    .upsert(
      { activity_id: activityId, user_id: userId, submitted_at: at, updated_at: at },
      { onConflict: "activity_id,user_id" }
    );
  if (error) throw communityDbError(error, "complete this community request");
}

export async function submissionIds(activityId) {
  const { data } = await edu().from("community_activity_submissions")
    .select("id").eq("activity_id", activityId);
  return data || [];
}

export async function deleteActivity(id) {
  const { error } = await edu().from("community_activities").delete().eq("id", id);
  if (error) throw communityDbError(error, "complete this community request");
}

export async function listActivities(communityId) {
  const { data, error } = await step("activities", edu().from("community_activities")
    .select("*").eq("community_id", communityId)
    .order("created_at", { ascending: false }));
  if (error) throw communityDbError(error, "complete this community request");
  return data || [];
}

export async function insertActivity(row) {
  const { data, error } = await edu().from("community_activities")
    .insert(row)
    .select("*")
    .single();
  if (error) throw communityDbError(error, "complete this community request");
  return data;
}

export async function myActivitySubmissions(userId, activityIds) {
  const { data: mySubs } = await step("mySubmissions", edu().from("community_activity_submissions")
    .select("activity_id").eq("user_id", userId)
    .in("activity_id", activityIds));
  return mySubs || [];
}

/** Analytics: activity ids + names (errors ignored as before). */
export async function listActivityNames(communityId) {
  const { data: acts } = await edu().from("community_activities")
    .select("id, name").eq("community_id", communityId);
  return acts || [];
}

export async function countSubmissions(activityIds) {
  const { count } = await edu().from("community_activity_submissions")
    .select("*", { count: "exact", head: true }).in("activity_id", activityIds);
  return count || 0;
}

export async function recentSubmissions(activityIds, limit) {
  const { data: subs } = await edu().from("community_activity_submissions")
    .select("activity_id, user_id, submitted_at")
    .in("activity_id", activityIds)
    .order("submitted_at", { ascending: false })
    .limit(limit);
  return subs || [];
}

// ─── community items (shared materials) ─────────────────────────────────────

export async function communityNames(ids) {
  const { data: comms } = await step("communityNames", edu().from("communities")
    .select("id, name").in("id", ids));
  return comms || [];
}

export async function communitiesByIds(ids) {
  const { data: comms, error } = await step("discussionCommunities", edu().from("communities")
    .select("id, name, emoji, owner_id").in("id", ids));
  if (error) throw communityDbError(error, "open this discussion");
  return comms || [];
}

export async function itemsForRef(itemType, itemRef, communityIds) {
  const { data: items, error } = await step("discussionItems", edu().from("community_items")
    .select("community_id").eq("item_type", itemType).eq("item_ref", itemRef).in("community_id", communityIds));
  if (error) throw communityDbError(error, "open this discussion");
  return items || [];
}

export async function countCommunityItems(communityId) {
  const { count } = await step("communityItemCount", edu().from("community_items")
    .select("id", { count: "exact", head: true }).eq("community_id", communityId));
  return count || 0;
}

export async function upsertCommunityItem(row) {
  const { error } = await edu().from("community_items")
    .upsert(row, { onConflict: "community_id,item_type,item_ref" });
  if (error) throw communityDbError(error, "add this item");
}

export async function listCommunityItems(communityId, limit) {
  const { data, error } = await step("communityItems", edu().from("community_items")
    .select("id, item_type, item_ref, title, sub, kind, link, created_at, user_id")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false }).limit(limit));
  if (error) throw communityDbError(error, "load these materials");
  return data || [];
}

// ─── discussions ────────────────────────────────────────────────────────────

/* The community's discussion row — born the first time anyone opens or
   writes it, alive exactly as long as the community (cascade). */
export async function discussionFor(communityId) {
  const { error: insErr } = await edu().from("community_discussions")
    .upsert({ community_id: communityId }, { onConflict: "community_id", ignoreDuplicates: true });
  if (insErr) throw communityDbError(insErr, "open this discussion");
  const { data: disc, error: selErr } = await edu().from("community_discussions")
    .select("id, community_id, created_at, last_message_at").eq("community_id", communityId).maybeSingle();
  if (selErr || !disc) throw communityDbError(selErr || new Error("discussion row missing"), "open this discussion");
  return disc;
}

export async function listDiscussionMessages(discussionId, { limit, before }) {
  let q = edu().from("community_discussion_messages")
    .select("id, discussion_id, user_id, body, created_at")
    .eq("discussion_id", discussionId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (before) q = q.lt("created_at", before);
  const { data: msgs, error: msgErr } = await q;
  if (msgErr) throw communityDbError(msgErr, "load the discussion");
  return msgs || [];
}

export async function insertDiscussionMessage({ discussionId, userId, body }) {
  const { data: ins, error } = await edu().from("community_discussion_messages")
    .insert({ discussion_id: discussionId, user_id: userId, body })
    .select("id, discussion_id, user_id, body, created_at").single();
  if (error) throw communityDbError(error, "post this message");
  return ins;
}

export async function touchDiscussion(discussionId, at) {
  await edu().from("community_discussions")
    .update({ last_message_at: at }).eq("id", discussionId);
}
