/**
 * modules/communities/service.js — communities flows (HTTP handlers).
 *
 * Each exported handler is the body of one route in routes.js. The flow is
 * the same everywhere: load through store.js (deadline-capped), gate through
 * rules.js (membership / ownership / visibility), act through store.js, and
 * answer with this module's success/error envelope. routes.js owns the router,
 * middleware, registration order, and the 503/504 error handlers.
 */

import { emitAutonomyEvent } from "../autonomy/index.js";
import {
  isOwner,
  isActivityCreator,
  isOwnerRole,
  requiresMembership,
  canJoin,
  parseDueAt,
} from "./rules.js";
import {
  communityDbError,
  memberCounts,
  userNames,
  usersByIds,
  findCommunity,
  listMyCommunities as readMyCommunities,
  listPublicCommunities as readPublicCommunities,
  insertCommunity,
  insertOwnerMembership,
  deleteCommunityRow,
  updateCommunity as writeCommunity,
  upsertMember,
  deleteMember,
  listMembers as readMembers,
  isMember,
  myMembership,
  readMembership,
  memberCommunityIds,
  findActivity,
  activitySubmissions,
  upsertSubmission,
  submissionIds,
  deleteActivity as removeActivity,
  listActivities as readActivities,
  insertActivity,
  myActivitySubmissions,
  listActivityNames,
  countSubmissions,
  recentSubmissions,
  communityNames,
  countCommunityItems,
  upsertCommunityItem,
  listCommunityItems as readCommunityItems,
} from "./store.js";

// ─── response envelope ──────────────────────────────────────────────────────

/* Shared with discussions.js, which owns the discussion flows. */
export const ok      = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
export const bad     = (res, m) => res.status(400).json({ success: false, error: m });
export const denied  = (res, m) => res.status(403).json({ success: false, error: m });
export const missing = (res) => res.status(404).json({ success: false, error: "Not found" });

const now = () => new Date().toISOString();

// ─── shared helpers ─────────────────────────────────────────────────────────

/* ?q= search term — strip characters that break the PostgREST or-grammar
   and cap the length, same contract as the courses/records endpoints. */
const likeTerm = (raw) => String(raw ?? "").replace(/[,()%\\]/g, " ").trim().slice(0, 80);

/** Add member_count + owner_name to raw community rows. */
export async function withExtras(communityRows) {
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

/** Fetch one community, with extras, or respond 404. */
export async function communityOr404(res, id) {
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
    activitySubmissions(rows.map(r => r.id)),
    userNames(rows.map(r => r.creator_id)),
  ]);
  // The builder resolves (not rejects) with { data, error }; the error used to
  // be ignored, and `for (const s of { data, error })` then threw a bare
  // TypeError (a 500) instead of reaching the schema-pending handler.
  if (subs?.error) throw communityDbError(subs.error, "load these activities");
  const counts = new Map();
  for (const s of subs?.data || []) counts.set(s.activity_id, (counts.get(s.activity_id) || 0) + 1);
  return rows.map(r => ({
    ...r,
    creator_name:    names.get(r.creator_id) || "",
    submissions_count: counts.get(r.id) || 0,
  }));
}

// ─── shared items ───────────────────────────────────────────────────────────

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

// ─── activity routes (registered before /:id routes) ───────────────────────

/* POST /activities/:activityId/submit — a member submits (idempotent). */
export async function submitActivity(req, res) {
  const a = await findActivity(req.params.activityId);
  if (!a) return missing(res);

  const mem = await readMembership(a.community_id, req.user.id);
  if (!mem) return denied(res, "Join this community first.");

  await upsertSubmission(a.id, req.user.id, now());

  const subs = await submissionIds(a.id);
  // Event trigger: class work handed in — fresh signal for the planner.
  emitAutonomyEvent(req.user.id, "submission").catch(() => {});
  ok(res, { submitted: true, submissions_count: subs.length });
}

/* DELETE /activities/:activityId — the activity's creator only. */
export async function deleteActivity(req, res) {
  const a = await findActivity(req.params.activityId);
  if (!a) return missing(res);
  if (!isActivityCreator(a, req.user.id)) return denied(res, "Only the activity creator can delete it.");

  await removeActivity(a.id);

  ok(res, { deleted: true });
}

// ─── POST /items — add one thing to N communities (members only) ───────────
// The Add-to-community page multi-selects communities for a single item, so
// the write is bulk over the caller's chosen community ids — the mirror of
// POST /api/records/folders/items.
export async function addItems(req, res) {
  const userId = req.user.id;
  const body = req.body || {};

  const communityIds = [...new Set(Array.isArray(body.communityIds) ? body.communityIds.map(String) : [])];
  if (!communityIds.length) return bad(res, "Pick at least one community.");
  if (communityIds.length > MAX_COMMUNITIES_PER_ADD) return bad(res, "Too many communities selected.");

  const { error: itemErr, row } = normalizeCommunityItem(body);
  if (itemErr) return bad(res, itemErr);

  // Every target community must have the caller as a member.
  const memberIds = await memberCommunityIds(userId, communityIds);
  if (memberIds.size !== communityIds.length) {
    return denied(res, "You can only add to communities you've joined.");
  }

  // Community names, for the caller's toast.
  const comms = await communityNames(communityIds);

  for (const communityId of communityIds) {
    // Respect the per-community cap on every target.
    if ((await countCommunityItems(communityId)) >= MAX_COMMUNITY_ITEMS) {
      return bad(res, `A community is full (${MAX_COMMUNITY_ITEMS} items) — remove one first.`);
    }
    await upsertCommunityItem({ community_id: communityId, user_id: userId, ...row });
  }
  ok(res, { added: communityIds.length, communities: comms.map((c) => c.name) });
}

// ─── GET /mine — my joined communities ─────────────────────────────────────

export async function listMyCommunities(req, res) {
  const data = await readMyCommunities(req.user.id);

  const mine = data
    .filter(r => r.communities)
    .map(r => ({ role: r.role, joined_at: r.joined_at, ...r.communities }));

  ok(res, await withExtras(mine), { total: mine.length });
}

// ─── GET / — public communities (discovery) ─────────────────────────────────

export async function listPublicCommunities(req, res) {
  const term   = likeTerm(req.query.q);
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 100);

  const data = await readPublicCommunities({ term, limit });

  ok(res, await withExtras(data), { total: data.length });
}

// ─── POST / — create ────────────────────────────────────────────────────────

export async function createCommunity(req, res) {
  const name        = String(req.body?.name || "").trim();
  const description = String(req.body?.description || "").trim() || null;
  const emoji       = String(req.body?.emoji || "").trim() || null;

  if (!name) return bad(res, "Give the community a name.");
  if (name.length > 80) return bad(res, "Community name is too long (max 80).");
  if (description && description.length > 500) return bad(res, "Description is too long (max 500).");

  const created = await insertCommunity({ name, description, emoji, owner_id: req.user.id });

  // The creator is the owner of record on both sides. If the membership write
  // fails, best-effort delete the just-created row so retrying cannot create an
  // orphaned community the learner cannot open or manage.
  const { data: membership, error: memErr } = await insertOwnerMembership(created.id, req.user.id);
  if (memErr) {
    const { error: rollbackErr } = await deleteCommunityRow(created.id);
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
}

// ─── GET /:id — one community + my membership ───────────────────────────────

export async function getCommunity(req, res) {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const mem = await myMembership(c.id, req.user.id);

  ok(res, { ...c, my_role: mem?.role || null, joined_at: mem?.joined_at || null });
}

// ─── community activity feed ────────────────────────────────────────────────

/* GET /:id/activities — the community's activities, newest first. */
export async function listActivities(req, res) {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  // A private community's work is for its members (Phase 15 item 6).
  if (requiresMembership(c) && !(await isMember(c.id, req.user.id))) {
    return denied(res, "Join this community to see its activities.");
  }

  const data = await readActivities(c.id);

  const rows = await withActivityExtras(data);

  // Which of these has the caller already submitted?
  const mine = new Set();
  if (rows.length) {
    const mySubs = await myActivitySubmissions(req.user.id, rows.map(r => r.id));
    for (const s of mySubs) mine.add(s.activity_id);
  }

  ok(res, rows.map(r => ({ ...r, my_submitted: mine.has(r.id) })), { total: rows.length });
}

/* POST /:id/activities — the community creator posts an activity. */
export async function createActivity(req, res) {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  if (!isOwner(c, req.user.id)) return denied(res, "Only the community creator can post activities.");

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

  const dueAt = parseDueAt(req.body?.dueAt);

  const data = await insertActivity({
    community_id: c.id, creator_id: req.user.id,
    name, subject, class_name: className, instructions, due_at: dueAt,
    type, stages,
  });

  ok(res, (await withActivityExtras([data]))[0]);
}

/* GET /:id/items — the community's shared materials (members only).
   Newest first; the adder's name rides along so the page can say who
   shared what. */
export async function listItems(req, res) {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const mem = await readMembership(c.id, req.user.id);
  if (!mem) return denied(res, "Join this community to see its materials.");

  const data = await readCommunityItems(c.id, MAX_COMMUNITY_ITEMS);

  const names = await userNames(data.map((it) => it.user_id));
  ok(res, data.map((it) => ({
    id: it.id, itemType: it.item_type, itemRef: it.item_ref,
    title: it.title, sub: it.sub || "", kind: it.kind || "topic",
    link: it.link || null, createdAt: it.created_at,
    addedBy: names.get(it.user_id) || "",
  })), { total: data.length });
}

// ─── creator tools: members + analytics ─────────────────────────────────────

/* GET /:id/members — who's in the community (owner first). */
export async function listMembers(req, res) {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  // Who's in a community is for the people in it — it used to answer anyone,
  // private communities included (Phase 15 item 6).
  if (!(await isMember(c.id, req.user.id))) return denied(res, "Join this community to see who's in it.");

  const mem = await readMembers(c.id);

  const users = await usersByIds(mem.map(m => m.user_id));
  const uMap = new Map(users.map(u => [u.id, u]));

  const list = mem.map(m => ({
    user_id:   m.user_id,
    role:      m.role,
    joined_at: m.joined_at,
    name:      uMap.get(m.user_id)?.full_name || "Learner",
    avatar_url: uMap.get(m.user_id)?.avatar_url || null,
  }));
  list.sort((a, b) => (b.role === "owner") - (a.role === "owner"));

  ok(res, list, { total: list.length });
}

/* GET /:id/analytics — community stats + recent submissions. */
export async function getAnalytics(req, res) {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  // A creator tool: who submitted what, by name (Phase 15 item 6).
  if (!isOwner(c, req.user.id)) return denied(res, "Only the community creator can see its analytics.");

  const acts = await listActivityNames(c.id);
  const actIds = acts.map(a => a.id);
  const actNames = new Map(acts.map(a => [a.id, a.name]));

  let subCount = 0;
  let recent = [];
  if (actIds.length) {
    subCount = await countSubmissions(actIds);

    const subs = await recentSubmissions(actIds, 10);
    const uNames = await userNames(subs.map(s => s.user_id));
    recent = subs.map(s => ({
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
}

// ─── PATCH /:id — edit (creator only) ───────────────────────────────────────

export async function updateCommunity(req, res) {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  if (!isOwner(c, req.user.id)) return denied(res, "Only the community creator can edit it.");

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

  const data = await writeCommunity(c.id, { ...patch, updated_at: now() });

  ok(res, (await withExtras([data]))[0]);
}

// ─── POST /:id/join — join (idempotent) ─────────────────────────────────────

export async function joinCommunity(req, res) {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  if (!canJoin(c)) return denied(res, "This community is private.");

  await upsertMember(c.id, req.user.id);

  ok(res, { joined: true, community: (await withExtras([c]))[0] });
}

// ─── POST /:id/leave — leave (members only) ─────────────────────────────────

export async function leaveCommunity(req, res) {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const mem = await readMembership(c.id, req.user.id, "role");
  if (!mem) return bad(res, "You're not in this community.");
  if (isOwnerRole(mem)) return bad(res, "Owners can't leave — delete the community instead.");

  await deleteMember(c.id, req.user.id);

  ok(res, { left: true });
}

// ─── DELETE /:id — delete (creator only) ────────────────────────────────────

export async function deleteCommunity(req, res) {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;
  if (!isOwner(c, req.user.id)) return denied(res, "Only the community creator can delete it.");

  const { error } = await deleteCommunityRow(c.id);
  if (error) throw communityDbError(error, "delete this community");

  ok(res, { deleted: true });
}
