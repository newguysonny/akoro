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
 * Community items (members share content into a community — the
 * "Add to community" page, mirroring the library's Add-to-folder):
 *   GET    /:id/items          → the community's shared materials (members only)
 *   POST   /items              → add one thing to N communities (members
 *                                only, idempotent per community)
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
import { authenticateToken }              from "../auth/index.js";
import { emitAutonomyEvent } from "../autonomy/index.js";
import { step, DEFAULT_QUERY_TIMEOUT_MS } from "../../lib/queryDeadline.js";

const router = Router();
const edu    = () => db.schema("edu");
const now    = () => new Date().toISOString();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok      = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const bad     = (res, m) => res.status(400).json({ success: false, error: m });
const denied  = (res, m) => res.status(403).json({ success: false, error: m });
const missing = (res) => res.status(404).json({ success: false, error: "Not found" });

/* ?q= search term — strip characters that break the PostgREST or-grammar
   and cap the length, same contract as the courses/records endpoints. */
const likeTerm = (raw) => String(raw ?? "").replace(/[,()%\\]/g, " ").trim().slice(0, 80);

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

// ── Arrival + auth brackets ────────────────────────────────────────────────
// The detail route has hung for days across two services and three builds,
// while every audited path on e33316f is deadline-capped (10s auth I/O, 20s
// queries). When reality disagrees with the audit, instrument reality: one
// line the INSTANT a communities request arrives, one when auth has passed.
// The next hang then names its segment from the logs alone —
//   no "arrived"  → the request never reached this process (edge/SW/browser)
//   arrived, no "auth ok" → wedged in authenticateToken (the [auth] 503 line
//                           names the call; its absence is itself a finding)
//   auth ok, no response  → wedged in a route handler (the step 504 line
//                           names the query)
router.use((req, _res, next) => {
  console.log(`[communities] ${req.method} ${req.originalUrl} — arrived`);
  next();
});
router.use(authenticateToken);
router.use((req, _res, next) => {
  console.log(`[communities] ${req.method} ${req.originalUrl} — auth ok (${req.user?.role ?? "?"} ${String(req.user?.id ?? "").slice(0, 8)})`);
  next();
});

// ─── helpers ───────────────────────────────────────────────────────────────

/* ── Query deadlines ──────────────────────────────────────────────────────
   A wedged database call (a stuck lock, a starved PostgREST pool) never
   rejects on its own — the route's promise stays pending forever, the HTTP
   request never answers, and the learner watches a skeleton that never ends
   (live report: the community details page "keeps loading, no data
   arriving" — while every unauthenticated probe of the same route answered
   instantly). Each communities query races a deadline; past it the route
   answers 504 at once and the step that hung is named in the server logs,
   so the next occurrence points at its culprit instead of masquerading as
   a frontend bug. The losing query is left to settle in the background —
   its late failure is swallowed on purpose (an unhandled rejection from a
   race we already abandoned must not crash the process). */
// Exported for /health: the deployed build must be able to PROVE it carries
// the query deadline — a deploy that silently rolled back is otherwise
// indistinguishable from a hang, which is exactly the ambiguity we just hit.
export const COMMUNITIES_QUERY_TIMEOUT_MS = DEFAULT_QUERY_TIMEOUT_MS;


/** Member counts for the given community ids, in one query. */
async function memberCounts(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await step("memberCounts", edu().from("community_members")
    .select("community_id").in("community_id", ids));
  if (error) throw communityDbError(error, "load member counts");
  const counts = new Map();
  for (const r of data || []) counts.set(r.community_id, (counts.get(r.community_id) || 0) + 1);
  return counts;
}

/** Display names for the given user ids, in one query. */
async function userNames(userIds) {
  if (!userIds.length) return new Map();
  const { data, error } = await step("userNames", db.from("users")
    .select("id, full_name").in("id", [...new Set(userIds)]));
  if (error) throw communityDbError(error, "load names");
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

/** Fetch one community row or null. The error is surfaced (not folded
    into a null) so an unready schema reaches the 503 handler below instead
    of masquerading as "Not found". */
async function findCommunity(id) {
  const { data, error } = await step("findCommunity", edu().from("communities").select("*").eq("id", id).maybeSingle());
  if (error) throw communityDbError(error, "load this community");
  return data ?? null;
}

/** Is this user a member (owner included) of the community? */
async function isMember(communityId, userId) {
  const { data } = await step("membership", edu().from("community_members")
    .select("user_id").eq("community_id", communityId).eq("user_id", userId).maybeSingle());
  return !!data;
}

/** Fetch one community, with extras, or respond 404. */
async function communityOr404(res, id) {
  const c = await findCommunity(id);
  if (!c) { missing(res); return null; }
  // withExtras is async: it returns a Promise. The founding typo of the
  // communities saga indexed that promise — a promise has no 0 property,
  // so the helper resolved undefined for every community that EXISTS —
  // and all nine callers replied to a truthy-checking `if (!c) return;`
  // by returning WITHOUT a response: the request hung forever, no error,
  // no log. Present since the base commit; "not found" answered instantly
  // while "found" never answered at all.
  const rows = await withExtras([c]);
  if (!rows[0]) { missing(res); return null; }  // falsy ⇒ ALWAYS responded
  return rows[0];
}

/** Add creator_name + submissions_count to raw activity rows. */
async function withActivityExtras(rows) {
  if (!rows.length) return rows;
  const [subs, names] = await Promise.all([
    step("activitySubmissions", edu().from("community_activity_submissions")
      .select("activity_id").in("activity_id", rows.map(r => r.id))),
    userNames(rows.map(r => r.creator_id)),
  ]);
  // The builder resolves (not rejects) with { data, error }; the error used to
  // be ignored, and `for (const s of { data, error })` then threw a bare
  // TypeError (a 500) instead of reaching the schema-pending handler below.
  if (subs?.error) throw communityDbError(subs.error, "load these activities");
  const counts = new Map();
  for (const s of subs?.data || []) counts.set(s.activity_id, (counts.get(s.activity_id) || 0) + 1);
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

// ─── community items (shared materials) ──────────────────────────────────────
// Caps and payload validation mirror modules/records (the Add-to-folder
// family): one bulk write over the caller's selected communities, the
// display snapshot stored at add time, idempotent per community.
const MAX_COMMUNITIES_PER_ADD = 50;
const MAX_COMMUNITY_ITEMS     = 200;
const ITEM_TYPES = new Set(["record", "pharmd_topic", "lesson", "library"]);
const ITEM_KINDS = new Set(["pdf", "audio", "video", "image", "text", "link", "paste", "blog", "course", "topic"]);

/* Validate the shared-item payload; returns { error } or { row }. */
function normalizeCommunityItem(body = {}) {
  const itemType = String(body.itemType || "").trim();
  if (!ITEM_TYPES.has(itemType)) return { error: `itemType must be one of: ${[...ITEM_TYPES].join(", ")}.` };
  const itemRef = String(body.itemRef || "").trim();
  if (!itemRef || itemRef.length > 200) return { error: "itemRef is required (≤ 200 characters)." };
  const title = String(body.title || "").trim();
  if (!title || title.length > 255) return { error: "A title is required (≤ 255 characters)." };
  const sub = String(body.sub || "").trim().slice(0, 255) || null;
  const kind = String(body.kind || "").trim().slice(0, 50) || null;
  if (kind && !ITEM_KINDS.has(kind)) return { error: `kind must be one of: ${[...ITEM_KINDS].join(", ")}.` };
  const link = String(body.link || "").trim();
  if (link && !/^\/[a-zA-Z0-9\-_/]*$/.test(link)) return { error: "link must be an in-app path starting with /." };
  return { row: { item_type: itemType, item_ref: itemRef, title, sub, kind, link: link || null } };
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
  // Event trigger: class work handed in — fresh signal for the planner.
  emitAutonomyEvent(req.user.id, "submission").catch(() => {});
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

// ─── POST /items — add one thing to N communities (members only) ─────────────
// The Add-to-community page multi-selects communities for a single item, so
// the write is bulk over the caller's chosen community ids — the mirror of
// POST /api/records/folders/items. Registered before the /:id routes
// ("items" must not be captured as :id).
router.post("/items", asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const body = req.body || {};

  const communityIds = [...new Set(Array.isArray(body.communityIds) ? body.communityIds.map(String) : [])];
  if (!communityIds.length) return bad(res, "Pick at least one community.");
  if (communityIds.length > MAX_COMMUNITIES_PER_ADD) return bad(res, "Too many communities selected.");

  const { error: itemErr, row } = normalizeCommunityItem(body);
  if (itemErr) return bad(res, itemErr);

  // Every target community must have the caller as a member.
  const { data: mems } = await step("communityMembership", edu().from("community_members")
    .select("community_id").eq("user_id", userId).in("community_id", communityIds));
  const memberIds = new Set((mems || []).map((m) => m.community_id));
  if (memberIds.size !== communityIds.length) {
    return denied(res, "You can only add to communities you've joined.");
  }

  // Community names, for the caller's toast.
  const { data: comms } = await step("communityNames", edu().from("communities")
    .select("id, name").in("id", communityIds));

  for (const communityId of communityIds) {
    // Respect the per-community cap on every target.
    const { count } = await step("communityItemCount", edu().from("community_items")
      .select("id", { count: "exact", head: true }).eq("community_id", communityId));
    if ((count || 0) >= MAX_COMMUNITY_ITEMS) {
      return bad(res, `A community is full (${MAX_COMMUNITY_ITEMS} items) — remove one first.`);
    }
    const { error } = await edu().from("community_items")
      .upsert({ community_id: communityId, user_id: userId, ...row }, { onConflict: "community_id,item_type,item_ref" });
    if (error) throw communityDbError(error, "add this item");
  }
  ok(res, { added: communityIds.length, communities: (comms || []).map((c) => c.name) });
}));

// ─── community discussions — the community's group chat, in the reader ──────
/* One discussion per community (edu.community_discussions, UNIQUE
   community_id) — OWNED by the community, never by the content. Any
   content the community is connected to (edu.community_items) opens
   with this conversation attached: members chat in the reader and the
   same thread follows the community's materials everywhere — the PDF,
   the audio lecture, the video. Writes broadcast to the socket.io room
   `discussion:<communityId>`; the room JOIN is membership-gated in
   discussionSocket.js, so only the community's members ever receive. */

const DISCUSSION_MAX_BODY = 2000;

/* GET /for-item?itemType=record&itemRef=<id> — which of MY communities
   have this content. The reader calls it when content opens; an empty
   list means no discussion feature on it (the messaging only exists
   where a community connection does). */
router.get("/for-item", asyncHandler(async (req, res) => {
  const itemType = String(req.query.itemType || "record");
  const itemRef  = String(req.query.itemRef || "").slice(0, 120);
  if (!itemRef) return bad(res, "itemRef is required.");
  if (!["record", "pharmd_topic", "lesson", "library"].includes(itemType)) return bad(res, "Unknown itemType.");

  // My memberships first — the discussion is for members, so anything
  // else the item sits in is invisible here.
  const { data: mems, error: memErr } = await step("discussionMyMemberships", edu().from("community_members")
    .select("community_id").eq("user_id", req.user.id));
  if (memErr) throw communityDbError(memErr, "open this discussion");
  const myIds = [...new Set((mems || []).map((m) => m.community_id))];
  if (!myIds.length) return ok(res, [], { total: 0 });

  const { data: items, error: itemErr } = await step("discussionItems", edu().from("community_items")
    .select("community_id").eq("item_type", itemType).eq("item_ref", itemRef).in("community_id", myIds));
  if (itemErr) throw communityDbError(itemErr, "open this discussion");
  const ids = [...new Set((items || []).map((i) => i.community_id))];
  if (!ids.length) return ok(res, [], { total: 0 });

  const { data: comms, error: commErr } = await step("discussionCommunities", edu().from("communities")
    .select("id, name, emoji, owner_id").in("id", ids));
  if (commErr) throw communityDbError(commErr, "open this discussion");

  const extras = await withExtras(comms || []);
  ok(res, extras.map((c) => ({
    id: c.id, name: c.name, emoji: c.emoji || null,
    memberCount: c.member_count, ownerName: c.owner_name,
  })), { total: extras.length });
}));

/* The community's discussion row — born the first time anyone opens or
   writes it, alive exactly as long as the community (cascade). */
async function discussionFor(communityId) {
  const { error: insErr } = await edu().from("community_discussions")
    .upsert({ community_id: communityId }, { onConflict: "community_id", ignoreDuplicates: true });
  if (insErr) throw communityDbError(insErr, "open this discussion");
  const { data: disc, error: selErr } = await edu().from("community_discussions")
    .select("id, community_id, created_at, last_message_at").eq("community_id", communityId).maybeSingle();
  if (selErr || !disc) throw communityDbError(selErr || new Error("discussion row missing"), "open this discussion");
  return disc;
}

/** Names + avatars for a message page's authors, in one query. */
async function discussionAuthors(userIds) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  const { data, error } = await step("discussionAuthors", db.from("users")
    .select("id, full_name, avatar_url").in("id", ids));
  if (error) throw communityDbError(error, "load the discussion");
  return new Map((data || []).map((u) => [u.id, u]));
}

const toDiscussionMessage = (m, users) => ({
  id: m.id, communityId: m.community_id, body: m.body, createdAt: m.created_at,
  author: {
    id: m.user_id,
    name: users.get(m.user_id)?.full_name || "Learner",
    avatarUrl: users.get(m.user_id)?.avatar_url || null,
  },
});

/* GET /:id/discussion/messages — the persistent history (newest last).
   ?limit=60 (max 200), ?before=<ISO> pages back in time. */
router.get("/:id/discussion/messages", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const { data: mem } = await step("discussionReadMembership", edu().from("community_members")
    .select("user_id").eq("community_id", c.id).eq("user_id", req.user.id).maybeSingle());
  if (!mem) return denied(res, "Join this community to read its discussion.");

  const disc = await discussionFor(c.id);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 200);
  const before = req.query.before ? String(req.query.before) : null;

  let q = edu().from("community_discussion_messages")
    .select("id, discussion_id, user_id, body, created_at")
    .eq("discussion_id", disc.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (before) q = q.lt("created_at", before);
  const { data: msgs, error: msgErr } = await q;
  if (msgErr) throw communityDbError(msgErr, "load the discussion");

  const rows = (msgs || []).map((m) => ({ ...m, community_id: c.id })).reverse();
  const users = await discussionAuthors(rows.map((r) => r.user_id));
  ok(res, {
    discussionId: disc.id,
    community: { id: c.id, name: c.name, emoji: c.emoji || null },
    messages: rows.map((m) => toDiscussionMessage(m, users)),
    hasMore: (msgs || []).length === limit,
  });
}));

/* POST /:id/discussion/messages { body } — post to the community's
   discussion. REST is the single write path (deadline-capped); the
   socket room only fans the message out to live readers. */
router.post("/:id/discussion/messages", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const { data: mem } = await step("discussionWriteMembership", edu().from("community_members")
    .select("user_id").eq("community_id", c.id).eq("user_id", req.user.id).maybeSingle());
  if (!mem) return denied(res, "Join this community to post in its discussion.");

  const body = String(req.body?.body ?? "").trim().slice(0, DISCUSSION_MAX_BODY);
  if (!body) return bad(res, "Write something first.");

  const disc = await discussionFor(c.id);
  const { data: ins, error: insErr } = await edu().from("community_discussion_messages")
    .insert({ discussion_id: disc.id, user_id: req.user.id, body })
    .select("id, discussion_id, user_id, body, created_at").single();
  if (insErr) throw communityDbError(insErr, "post this message");
  await edu().from("community_discussions")
    .update({ last_message_at: new Date().toISOString() }).eq("id", disc.id);

  const users = await discussionAuthors([req.user.id]);
  const message = toDiscussionMessage({ ...ins, community_id: c.id }, users);

  // Realtime fan-out — everyone reading this discussion (in the reader
  // on any connected content) gets it live.
  const io = req.app.get("io");
  io?.to(`discussion:${c.id}`).emit("discussion:message", { communityId: c.id, message });

  ok(res, message);
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
  const term   = likeTerm(req.query.q);
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 100);

  let query = edu().from("communities").select("*").eq("is_public", true);
  if (term) query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
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

  // Extras are cosmetic here and the community is already committed — a
  // member-count/name lookup failing must not report a creation that
  // actually succeeded (a retry would then duplicate it).
  ok(res, {
    role: membership.role,
    joined_at: membership.joined_at,
    ...(await withExtras([created]).catch(() => [created]))[0],
  });
}));

// ─── GET /:id — one community + my membership ───────────────────────────────

router.get("/:id", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const { data: mem } = await step("myMembership", edu().from("community_members")
    .select("role, joined_at").eq("community_id", c.id).eq("user_id", req.user.id).maybeSingle());

  ok(res, { ...c, my_role: mem?.role || null, joined_at: mem?.joined_at || null });
}));

// ─── community activity feed ────────────────────────────────────────────────

/* GET /:id/activities — the community's activities, newest first. */
router.get("/:id/activities", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  // A private community's work is for its members (Phase 15 item 6).
  if (!c.is_public && !(await isMember(c.id, req.user.id))) return denied(res, "Join this community to see its activities.");

  const { data, error } = await step("activities", edu().from("community_activities")
    .select("*").eq("community_id", c.id)
    .order("created_at", { ascending: false }));
  if (error) throw communityDbError(error, "complete this community request");

  const rows = await withActivityExtras(data || []);

  // Which of these has the caller already submitted?
  const mine = new Set();
  if (rows.length) {
    const { data: mySubs } = await step("mySubmissions", edu().from("community_activity_submissions")
      .select("activity_id").eq("user_id", req.user.id)
      .in("activity_id", rows.map(r => r.id)));
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

/* GET /:id/items — the community's shared materials (members only).
   Newest first; the adder's name rides along so the page can say who
   shared what. */
router.get("/:id/items", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const { data: mem } = await edu().from("community_members")
    .select("user_id").eq("community_id", c.id).eq("user_id", req.user.id).maybeSingle();
  if (!mem) return denied(res, "Join this community to see its materials.");

  const { data, error } = await step("communityItems", edu().from("community_items")
    .select("id, item_type, item_ref, title, sub, kind, link, created_at, user_id")
    .eq("community_id", c.id)
    .order("created_at", { ascending: false }).limit(MAX_COMMUNITY_ITEMS));
  if (error) throw communityDbError(error, "load these materials");

  const names = await userNames((data || []).map((it) => it.user_id));
  ok(res, (data || []).map((it) => ({
    id: it.id, itemType: it.item_type, itemRef: it.item_ref,
    title: it.title, sub: it.sub || "", kind: it.kind || "topic",
    link: it.link || null, createdAt: it.created_at,
    addedBy: names.get(it.user_id) || "",
  })), { total: (data || []).length });
}));

// ─── creator tools: members + analytics ─────────────────────────────────────

/* GET /:id/members — who's in the community (owner first). */
router.get("/:id/members", asyncHandler(async (req, res) => {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  // Who's in a community is for the people in it — it used to answer anyone,
  // private communities included (Phase 15 item 6).
  if (!(await isMember(c.id, req.user.id))) return denied(res, "Join this community to see who's in it.");

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
  // A creator tool: who submitted what, by name (Phase 15 item 6).
  if (c.owner_id !== req.user.id) return denied(res, "Only the community creator can see its analytics.");

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

// A query that outlived its deadline (see `step` above) answers 504 instead of
// hanging the learner's page on a skeleton forever. The step that hung has
// already been named in the server logs by then.
router.use((err, _req, res, next) => {
  if (!err?.deadlineExceeded) return next(err);
  return res.status(504).json({
    success: false,
    error: "This community is taking too long to load. Please try again.",
    code: "COMMUNITIES_QUERY_TIMEOUT",
    step: err.step,
  });
});

export default router;
