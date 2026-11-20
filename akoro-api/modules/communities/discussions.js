/**
 * modules/communities/discussions.js — the community's group chat flows.
 *
 * Split out of service.js when the Phase 19 size ratchet left it over 600
 * lines: these are the discussion/for-item handlers only. They share the
 * response envelope and community loader with service.js; the queries live in
 * store.js and the socket JOIN gate in discussionSocket.js.
 */

import { ok, bad, denied, communityOr404, withExtras } from "./service.js";
import {
  myCommunityIds,
  itemsForRef,
  communitiesByIds,
  discussionAuthors,
  discussionReadMembership,
  discussionWriteMembership,
  discussionFor,
  listDiscussionMessages,
  insertDiscussionMessage,
  touchDiscussion,
} from "./store.js";

// ─── discussions — the community's group chat, in the reader ───────────────
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
export async function itemCommunities(req, res) {
  const itemType = String(req.query.itemType || "record");
  const itemRef  = String(req.query.itemRef || "").slice(0, 120);
  if (!itemRef) return bad(res, "itemRef is required.");
  if (!["record", "pharmd_topic", "lesson", "library"].includes(itemType)) return bad(res, "Unknown itemType.");

  // My memberships first — the discussion is for members, so anything
  // else the item sits in is invisible here.
  const myIds = await myCommunityIds(req.user.id);
  if (!myIds.length) return ok(res, [], { total: 0 });

  const items = await itemsForRef(itemType, itemRef, myIds);
  const ids = [...new Set(items.map((i) => i.community_id))];
  if (!ids.length) return ok(res, [], { total: 0 });

  const comms = await communitiesByIds(ids);

  const extras = await withExtras(comms);
  ok(res, extras.map((c) => ({
    id: c.id, name: c.name, emoji: c.emoji || null,
    memberCount: c.member_count, ownerName: c.owner_name,
  })), { total: extras.length });
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
export async function getDiscussionMessages(req, res) {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const mem = await discussionReadMembership(c.id, req.user.id);
  if (!mem) return denied(res, "Join this community to read its discussion.");

  const disc = await discussionFor(c.id);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 200);
  const before = req.query.before ? String(req.query.before) : null;

  const msgs = await listDiscussionMessages(disc.id, { limit, before });

  const rows = msgs.map((m) => ({ ...m, community_id: c.id })).reverse();
  const users = await discussionAuthors(rows.map((r) => r.user_id));
  ok(res, {
    discussionId: disc.id,
    community: { id: c.id, name: c.name, emoji: c.emoji || null },
    messages: rows.map((m) => toDiscussionMessage(m, users)),
    hasMore: msgs.length === limit,
  });
}

/* POST /:id/discussion/messages { body } — post to the community's
   discussion. REST is the single write path (deadline-capped); the
   socket room only fans the message out to live readers. */
export async function postDiscussionMessage(req, res) {
  const c = await communityOr404(res, req.params.id);
  if (!c) return;

  const mem = await discussionWriteMembership(c.id, req.user.id);
  if (!mem) return denied(res, "Join this community to post in its discussion.");

  const body = String(req.body?.body ?? "").trim().slice(0, DISCUSSION_MAX_BODY);
  if (!body) return bad(res, "Write something first.");

  const disc = await discussionFor(c.id);
  const ins = await insertDiscussionMessage({ discussionId: disc.id, userId: req.user.id, body });
  await touchDiscussion(disc.id, new Date().toISOString());

  const users = await discussionAuthors([req.user.id]);
  const message = toDiscussionMessage({ ...ins, community_id: c.id }, users);

  // Realtime fan-out — everyone reading this discussion (in the reader
  // on any connected content) gets it live.
  const io = req.app.get("io");
  io?.to(`discussion:${c.id}`).emit("discussion:message", { communityId: c.id, message });

  ok(res, message);
}
