/**
 * modules/communities/routes.js — learner communities (higher-ed tier)
 *
 * Communities are study groups for higher-ed learners. The learner app's
 * Community page lists the caller's joined communities (GET /mine); the
 * plus icon creates one (POST /); every community has an Activity page
 * (community activities posted by its creator), plus settings / people /
 * analytics pages for the creator and a profile view for members.
 *
 * Mounted at /api/communities. All routes require an authenticated user.
 *
 * Community:
 *   GET    /mine               → my joined communities (role + member counts)
 *   GET    /                   → public communities (discovery, ?q= to search)
 *   POST   /                   → create (body: name, description?, emoji?)
 *   GET    /:id                → one community + my membership
 *   PATCH  /:id                → edit (creator only)
 *   POST   /:id/join           → join (idempotent)
 *   POST   /:id/leave          → leave (members only — creators delete instead)
 *   DELETE /:id                → delete (creator only)
 *
 * Community activities (creator posts, members submit):
 *   GET    /:id/activities     → the community's activity feed (with
 *                                creator name, submission counts, my_submitted)
 *   POST   /:id/activities     → create (creator only)
 *   POST   /activities/:activityId/submit → member submits (idempotent)
 *   DELETE /activities/:activityId        → delete (activity creator only)
 *
 * Creator tools:
 *   GET    /:id/members        → member list (names, avatars, roles)
 *   GET    /:id/analytics      → community stats + recent submissions
 *
 * NOTE on ordering: the /activities/:activityId routes are registered
 * before the /:id routes — "activities" must not be captured as :id.
 */

import { Router }                         from "express";
import db                                 from "../../db.js";
import { authenticateToken }              from "../auth/routes.js";

const router = Router();
const edu    = () => db.schema("edu");
const now    = () => new Date().toISOString();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok      = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const bad     = (res, m) => res.status(400).json({ success: false, error: m });
const denied  = (res, m) => res.status(403).json({ success: false, error: m });
const missing = (res) => res.status(404).json({ success: false, error: "Not found" });

// Supabase's REST client returns structured errors. Retain that information
// instead of throwing only its message, so a missing newly-deployed table can
// be distinguished from an unexpected application failure below.
const communityDbError = (error, operation) => {
  const err = new Error(error?.message || `Could not ${operation}.`);
  err.code = error?.code;
  err.details = error?.details;
  err.hint = error?.hint;
  err.operation = operation;
  return err;
};

const isCommunitySchemaUnavailable = (err) => {
  const text = [err?.message, err?.details, err?.hint].filter(Boolean).join(" ");
  return err?.code === "42P01" || err?.code === "PGRST106" || err?.code === "PGRST205" ||
    /(?:schema cache|schema .* not (?:exposed|allowed)|relation .* does not exist|could not find (?:the )?table)/i.test(text);
};

router.use(authenticateToken);

// ─── helpers ───────────────────────────────────────────────────────────────

/** Member counts for the given community ids, in one query. */
async function memberCounts(ids) {
  if (!ids.length) return new Map();
  const { data } = await edu().from("community_members")
    .select("community_id").in("community_id", ids);
  const counts = new Map();
  for (const r of data || []) counts.set(r.community_id, (counts.get(r.community_id) || 0) + 1);
  return counts;
}

/** Display names for the given user ids, in one query. */
async function userNames(userIds) {
  if (!userIds.length) return new Map();
  const { data } = await db.from("users")
    .select("id, full_name").in("id", [...new Set(userIds)]);
  const names = new Map();
  for (const u of data || []) names.set(u.id, u.full_name || "");
  return names;
}

/** Add member_count + owner_name to raw community rows. */
async function withExtras(communityRows) {
  if (!communityRows.length) return communityRows;
  const [counts, names] = await Promise.all([
    memberCounts(communityRows.map(c => c.id)),
    userNames(communityRows.map(c => c.owner_id)),
  ]);
  return communityRows.map(c => ({
    ...c,
    member_count: counts.get(c.id) || 0,
    owner_name:   names.get(c.owner_id) || "",
  }));
}

/** Fetch one community row or null. */
async function findCommunity(id) {
  const { data } = await edu().from("communities").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

/** Fetch one community, with extras, or respond 404. */
async function communityOr404(res, id) {
  const c = await findCommunity(id);
  if (!c) { missing(res); return null; }
  return withExtras([c])[0];
}

/** Add creator_name + submissions_count to raw activity rows. */
async function withActivityExtras(rows) {
  if (!rows.length) return rows;
  const [subs, names] = await Promise.all([
    edu().from("community_activity_submissions")
      .select("activity_id").in("activity_id", rows.map(r => r.id)),
    userNames(rows.map(r => r.creator_id)),
  ]);
  const counts = new Map();
  for (const s of subs || []) counts.set(s.activity_id, (counts.get(s.activity_id) || 0) + 1);
  return rows.map(r => ({
    ...r,
    creator_name:    names.get(r.creator_id) || "",
    submissions_count: counts.get(r.id) || 0,
  }));
}

/** Fetch one activity row or null. */
async function findActivity(id) {
  const { data } = await edu().from("community_activities").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

// ─── community activity routes (registered before /:id routes) ──────────────

/* POST /activities/:activityId/submit — a member submits (idempotent). */
router.post("/activities/:activityId/submit", asyncHandler(async (req, res) => {
  const a = await findActivity(req.params.activityId);
  if (!a) return missing(res);

  const { data: mem } = await edu().from("community_members")
    .select("user_id")
    .eq("community_id", a.community_id).eq("user_id", req.user.id).maybeSingle();
  if (!mem) return denied(res, "Join this community first.");

  const { error } = await edu().from("community_activity_submissions")
    .upsert(
      { activity_id: a.id, user_id: req.user.id, submitted_at: now(), updated_at: now() },
      { onConflict: "activity_id,user_id" }
    );
  if (error) throw communityDbError(error, "complete this community request");

  const { data: subs } = await edu().from("community_activity_submissions")
    .select("id").eq("activity_id", a.id);
  ok(res, { submitted: true, submissions_count: subs?.length || 0 });
}));

/* DELETE /activities/:activityId — the activity's creator only. */
router.delete("/activities/:activityId", asyncHandler(async (req, res) => {
  const a = await findActivity(req.params.activityId);
  if (!a) return missing(res);
  if (a.creator_id !== req.user.id) return denied(res, "Only the activity creator can delete it.");

  const { error } = await edu().from("community_activities").delete().eq("id", a.id);
  if (error) throw communityDbError(error, "complete this community request");

  ok(res, { deleted: true });
}));

// ─── GET /mine — my joined communities ──────────────────────────────────────

router.get("/mine", asyncHandler(async (req, res) => {
  const { data, error } = await edu().from("community_members")
    .select("role, joined_at, communities(*)")
    .eq("user_id", req.user.id)
    .order("joined_at", { ascending: false });
  if (error) throw communityDbError(error, "complete this community request");

  const mine = (data || [])
    .filter(r => r.communities)
    .map(r => ({ role: r.role, joined_at: r.joined_at, ...r.communities }));

  ok(res, await withExtras(mine), { total: mine.length });
}));

// ─── GET / — public communities (discovery) ─────────────────────────────────

router.get("/", asyncHandler(async (req, res) => {
  const q      = String(req.query.q || "").trim();
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 100);

  let query = edu().from("communities").select("*").eq("is_public", true);
  if (q) query = query.ilike("name", `%${q}%`);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) throw communityDbError(error, "complete this community request");

  ok(res, await withExtras(data || []), { total: data?.length || 0 });
}));

// ─── POST / — create ────────────────────────────────────────────────────────

router.post("/", asyncHandler(async (req, res) => {
  const name        = String(req.body?.name || "").trim();
  const description = String(req.body?.description || "").trim() || null;
  const emoji       = String(req.body?.emoji || "").trim() || null;

  if (!name) return bad(res, "Give the community a name.");
  if (name.length > 80) return bad(res, "Community name is too long (max 80).");
  if (description && description.length > 500) return bad(res, "Description is too long (max 500).");

  const { data: created, error } = await edu().from("communities")
    .insert({ name, description, emoji, owner_id: req.user.id })
    .select("*")
    .single();
  if (error) throw communityDbError(error, "create this community");

  // The creator is the owner of record on both sides. If the membership write
  // fails, best-effort delete the just-created row so retrying cannot create an
  // orphaned community the learner cannot open or manage.
  const { data: membership, error: memErr } = await edu().from("community_members")
    .insert({ community_id: created.id, user_id: req.user.id, role: "owner" })
    .select("role, joined_at")
    .single();
  if (memErr) {
    const { error: rollbackErr } = await edu().from("communities").delete().eq("id", created.id);
    if (rollbackErr) {
      console.error("[communities] could not roll back incomplete creation", {
        communityId: created.id,
        code: rollbackErr.code,
        message: rollbackErr.message,
      });
    }
    throw communityDbError(memErr, "add you as the community owner");
  }

  ok(res, {
    role: membership.role,
    joined_at: membership.joined_at,
    ...(await withExtras([created]))[0],
  });
}));

// ─── GET /:id — one community + my membership ───────────────────────────────

router.get("/:id", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const { data: mem } = await edu().from("community_members")
    .select("role, joined_at").eq("community_id", c.id).eq("user_id", req.user.id).maybeSingle();

  ok(res, { ...c, my_role: mem?.role || null, joined_at: mem?.joined_at || null });
}));

// ─── community activity feed ────────────────────────────────────────────────

/* GET /:id/activities — the community's activities, newest first. */
router.get("/:id/activities", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const { data, error } = await edu().from("community_activities")
    .select("*").eq("community_id", c.id)
    .order("created_at", { ascending: false });
  if (error) throw communityDbError(error, "complete this community request");

  const rows = await withActivityExtras(data || []);

  // Which of these has the caller already submitted?
  const mine = new Set();
  if (rows.length) {
    const { data: mySubs } = await edu().from("community_activity_submissions")
      .select("activity_id").eq("user_id", req.user.id)
      .in("activity_id", rows.map(r => r.id));
    for (const s of mySubs || []) mine.add(s.activity_id);
  }

  ok(res, rows.map(r => ({ ...r, my_submitted: mine.has(r.id) })), { total: rows.length });
}));

/* POST /:id/activities — the community creator posts an activity. */
router.post("/:id/activities", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  if (c.owner_id !== req.user.id) return denied(res, "Only the community creator can post activities.");

  const name         = String(req.body?.name || "").trim();
  const subject      = String(req.body?.subject || "").trim() || null;
  const className    = String(req.body?.["class"] || req.body?.class_name || "").trim() || null;
  const instructions = String(req.body?.instructions || "").trim() || null;

  // Workbench parity: an activity carries its type, and multi_stage
  // journeys carry their ordered stages — the same five types (and stage
  // kinds ≤ 6) the activities workbench drafts.
  const TYPE_KEYS   = ["assignment", "project", "multi_stage", "self_study", "live_course"];
  const STAGE_KINDS = ["self_study", "assignment", "project"];
  const type = TYPE_KEYS.includes(req.body?.type) ? req.body.type : "assignment";
  let stages = [];
  if (type === "multi_stage") {
    stages = (Array.isArray(req.body?.stages) ? req.body.stages : []).slice(0, 6)
      .map((s) => ({ kind: STAGE_KINDS.includes(s?.kind) ? s.kind : "self_study", title: String(s?.title || "").trim() }))
      .filter((s) => s.title);
    if (!stages.length) return bad(res, "A multi-stage journey needs at least one stage with a title.");
  }

  if (!name) return bad(res, "Give the activity a name.");
  if (name.length > 120) return bad(res, "Activity name is too long (max 120).");
  if (subject && subject.length > 80) return bad(res, "Subject is too long (max 80).");
  if (className && className.length > 80) return bad(res, "Class is too long (max 80).");
  if (instructions && instructions.length > 2000) return bad(res, "Instructions are too long (max 2000).");

  let dueAt = null;
  if (req.body?.dueAt) {
    const d = new Date(req.body.dueAt);
    if (!Number.isNaN(d.getTime())) dueAt = d.toISOString();
  }

  const { data, error } = await edu().from("community_activities")
    .insert({
      community_id: c.id, creator_id: req.user.id,
      name, subject, class_name: className, instructions, due_at: dueAt,
      type, stages,
    })
    .select("*")
    .single();
  if (error) throw communityDbError(error, "complete this community request");

  ok(res, (await withActivityExtras([data]))[0]);
}));

// ─── creator tools: members + analytics ─────────────────────────────────────

/* GET /:id/members — who's in the community (owner first). */
router.get("/:id/members", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const { data: mem, error } = await edu().from("community_members")
    .select("user_id, role, joined_at")
    .eq("community_id", c.id)
    .order("joined_at", { ascending: true });
  if (error) throw communityDbError(error, "complete this community request");

  const { data: users } = await db.from("users")
    .select("id, full_name, avatar_url")
    .in("id", (mem || []).map(m => m.user_id));
  const uMap = new Map((users || []).map(u => [u.id, u]));

  const list = (mem || []).map(m => ({
    user_id:   m.user_id,
    role:      m.role,
    joined_at: m.joined_at,
    name:      uMap.get(m.user_id)?.full_name || "Learner",
    avatar_url: uMap.get(m.user_id)?.avatar_url || null,
  }));
  list.sort((a, b) => (b.role === "owner") - (a.role === "owner"));

  ok(res, list, { total: list.length });
}));

/* GET /:id/analytics — community stats + recent submissions. */
router.get("/:id/analytics", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const { data: acts } = await edu().from("community_activities")
    .select("id, name").eq("community_id", c.id);
  const actIds = (acts || []).map(a => a.id);
  const actNames = new Map((acts || []).map(a => [a.id, a.name]));

  let subCount = 0;
  let recent = [];
  if (actIds.length) {
    const { count } = await edu().from("community_activity_submissions")
      .select("*", { count: "exact", head: true }).in("activity_id", actIds);
    subCount = count || 0;

    const { data: subs } = await edu().from("community_activity_submissions")
      .select("activity_id, user_id, submitted_at")
      .in("activity_id", actIds)
      .order("submitted_at", { ascending: false })
      .limit(10);
    const uNames = await userNames((subs || []).map(s => s.user_id));
    recent = (subs || []).map(s => ({
      user_name:     uNames.get(s.user_id) || "Learner",
      activity_name: actNames.get(s.activity_id) || "Activity",
      submitted_at:  s.submitted_at,
    }));
  }

  ok(res, {
    members:          c.member_count,
    activities:       actIds.length,
    submissions:      subCount,
    avg_per_activity: actIds.length ? Math.round((subCount / actIds.length) * 10) / 10 : 0,
    recent,
  });
}));

// ─── PATCH /:id — edit (creator only) ───────────────────────────────────────

router.patch("/:id", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  if (c.owner_id !== req.user.id) return denied(res, "Only the community creator can edit it.");

  const patch = {};
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return bad(res, "Community name can't be empty.");
    if (name.length > 80) return bad(res, "Community name is too long (max 80).");
    patch.name = name;
  }
  if (req.body?.description !== undefined) {
    const d = String(req.body.description).trim();
    if (d.length > 500) return bad(res, "Description is too long (max 500).");
    patch.description = d || null;
  }
  if (req.body?.emoji !== undefined) {
    patch.emoji = String(req.body.emoji).trim() || null;
  }
  if (!Object.keys(patch).length) return bad(res, "Nothing to update.");

  const { data, error } = await edu().from("communities")
    .update({ ...patch, updated_at: now() })
    .eq("id", c.id)
    .select("*")
    .single();
  if (error) throw communityDbError(error, "complete this community request");

  ok(res, (await withExtras([data]))[0]);
}));

// ─── POST /:id/join — join (idempotent) ─────────────────────────────────────

router.post("/:id/join", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  if (!c.is_public) return denied(res, "This community is private.");

  const { error } = await edu().from("community_members")
    .upsert(
      { community_id: c.id, user_id: req.user.id, role: "member" },
      { onConflict: "community_id,user_id" }
    );
  if (error) throw communityDbError(error, "complete this community request");

  ok(res, { joined: true, community: (await withExtras([c]))[0] });
}));

// ─── POST /:id/leave — leave (members only) ─────────────────────────────────

router.post("/:id/leave", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const { data: mem } = await edu().from("community_members")
    .select("role").eq("community_id", c.id).eq("user_id", req.user.id).maybeSingle();
  if (!mem) return bad(res, "You're not in this community.");
  if (mem.role === "owner") return bad(res, "Owners can't leave — delete the community instead.");

  const { error } = await edu().from("community_members")
    .delete().eq("community_id", c.id).eq("user_id", req.user.id);
  if (error) throw communityDbError(error, "complete this community request");

  ok(res, { left: true });
}));

// ─── DELETE /:id — delete (creator only) ────────────────────────────────────

router.delete("/:id", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  if (c.owner_id !== req.user.id) return denied(res, "Only the community creator can delete it.");

  const { error } = await edu().from("communities").delete().eq("id", c.id);
  if (error) throw communityDbError(error, "delete this community");

  ok(res, { deleted: true });
}));

// The communities feature is backed by its own late-added migration. Surface a
// deploy/readiness problem truthfully instead of the global, unhelpful 500; the
// client can tell the learner to retry while the release's schema step finishes.
router.use((err, _req, res, next) => {
  if (!isCommunitySchemaUnavailable(err)) return next(err);

  console.error("[communities] schema is not ready", {
    operation: err.operation,
    code: err.code,
    message: err.message,
    details: err.details,
  });
  return res.status(503).json({
    success: false,
    error: "Communities are still being set up. Please try again in a minute.",
    code: "COMMUNITIES_SCHEMA_PENDING",
  });
});

export default router;
