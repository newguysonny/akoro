/**
 * modules/communities/routes.js — learner communities (higher-ed tier)
 *
 * Communities are study groups for higher-ed learners. The learner app's
 * Community page lists the caller's joined communities (GET /mine); the
 * plus icon creates one (POST /); every community has its own Activity
 * page in the learner app, fed by GET /:id/activities.
 *
 * Mounted at /api/communities. All routes require an authenticated user.
 *
 *   GET    /mine               → my joined communities (role + member counts)
 *   GET    /                   → public communities (discovery, ?q= to search)
 *   POST   /                   → create (body: name, description?, emoji?)
 *   GET    /:id                → one community + my membership
 *   PATCH  /:id                → edit (owner only)
 *   POST   /:id/join           → join (idempotent)
 *   POST   /:id/leave          → leave (members only — owners delete instead)
 *   DELETE /:id                → delete (owner only)
 *   GET    /:id/activities     → the community's activity feed
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

router.use(authenticateToken);

// ─── helpers ────────────────────────────────────────────────────────────────

/** Member counts for the given community ids, in one query. */
async function memberCounts(ids) {
  if (!ids.length) return new Map();
  const { data } = await edu().from("community_members")
    .select("community_id").in("community_id", ids);
  const counts = new Map();
  for (const r of data || []) counts.set(r.community_id, (counts.get(r.community_id) || 0) + 1);
  return counts;
}

/** Owner display names for the given user ids, in one query. */
async function ownerNames(ownerIds) {
  if (!ownerIds.length) return new Map();
  const { data } = await db.from("users")
    .select("id, full_name").in("id", [...new Set(ownerIds)]);
  const names = new Map();
  for (const u of data || []) names.set(u.id, u.full_name || "");
  return names;
}

/** Add member_count + owner_name to raw community rows. */
async function withExtras(communityRows) {
  if (!communityRows.length) return communityRows;
  const [counts, names] = await Promise.all([
    memberCounts(communityRows.map(c => c.id)),
    ownerNames(communityRows.map(c => c.owner_id)),
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

// ─── GET /mine — my joined communities ──────────────────────────────────────

router.get("/mine", asyncHandler(async (req, res) => {
  const { data, error } = await edu().from("community_members")
    .select("role, joined_at, communities(*)")
    .eq("user_id", req.user.id)
    .order("joined_at", { ascending: false });
  if (error) throw new Error(error.message);

  const mine = (data || [])
    .filter(r => r.communities)
    .map(r => ({
      role:      r.role,
      joined_at: r.joined_at,
      ...r.communities,
    }));

  ok(res, await withExtras(mine), { total: mine.length });
}));

// ─── GET / — public communities (discovery) ─────────────────────────────────

router.get("/", asyncHandler(async (req, res) => {
  const q      = String(req.query.q || "").trim();
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 100);

  let query = edu().from("communities").select("*").eq("is_public", true);
  if (q) query = query.ilike("name", `%${q}%`);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);

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
    .insert({
      name,
      description,
      emoji,
      owner_id: req.user.id,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  // The creator is the owner of record on both sides.
  const { error: memErr } = await edu().from("community_members")
    .insert({ community_id: created.id, user_id: req.user.id, role: "owner" });
  if (memErr) throw new Error(memErr.message);

  ok(res, { role: "owner", joined_at: now(), ...(await withExtras([created]))[0] });
}));

// ─── GET /:id — one community + my membership ───────────────────────────────

router.get("/:id", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const { data: mem } = await edu().from("community_members")
    .select("role, joined_at").eq("community_id", c.id).eq("user_id", req.user.id).maybeSingle();

  ok(res, { ...c, my_role: mem?.role || null, joined_at: mem?.joined_at || null });
}));

// ─── PATCH /:id — edit (owner only) ─────────────────────────────────────────

router.patch("/:id", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  if (c.owner_id !== req.user.id) return denied(res, "Only the community owner can edit it.");

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
  if (error) throw new Error(error.message);

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
  if (error) throw new Error(error.message);

  ok(res, { joined: true, community: (await withExtras([c]))[0] });
}));

// ─── POST /:id/leave — leave (members only) ─────────────────────────────────

router.post("/:id/leave", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const { data: mem } = await edu().from("community_members")
    .select("role").eq("community_id", c.id).eq("user_id", req.user.id).maybeSingle();
  if (!mem) return bad(res, "You're not in this community.");
  if (mem.role === "owner") return bad(res, "Owners can't leave — delete the community or make someone else the owner.");

  const { error } = await edu().from("community_members")
    .delete().eq("community_id", c.id).eq("user_id", req.user.id);
  if (error) throw new Error(error.message);

  ok(res, { left: true });
}));

// ─── DELETE /:id — delete (owner only) ──────────────────────────────────────

router.delete("/:id", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  if (c.owner_id !== req.user.id) return denied(res, "Only the community owner can delete it.");

  const { error } = await edu().from("communities").delete().eq("id", c.id);
  if (error) throw new Error(error.message);

  ok(res, { deleted: true });
}));

// ─── GET /:id/activities — the community's activity feed ────────────────────
//
// SEAM: no community-scoped activity source exists yet. The learner app
// renders this route with the standard Activity shell (kind pills + cards),
// so when the first community activity kind lands (assignments posted to a
// community, shared resources, …), only this handler changes.
router.get("/:id/activities", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  // TODO: join community-scoped activity sources once they exist.
  ok(res, [], { total: 0 });
}));

export default router;
