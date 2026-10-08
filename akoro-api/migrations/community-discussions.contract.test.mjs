import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Community discussions contract — the reader's group chat. Every piece
 * of content connected to a community (edu.community_items) carries the
 * community's discussion into the reader. For that to be true:
 *
 *   ownership — the discussion is ONE row per community
 *               (edu.community_discussions, UNIQUE community_id); the
 *               content never owns it, it only hosts it. It dies with
 *               the community (cascade), never with a record.
 *   gate      — the reader only features the discussion when the content
 *               is connected to one of the CALLER's communities
 *               (GET /for-item filters by membership); no connection,
 *               no messaging.
 *   transport — writes go through REST (deadline-capped, member-checked)
 *               and fan out over the socket.io room discussion:<id>;
 *               the room JOIN re-checks membership server-side, so a
 *               non-member can never ride a community's chat.
 *   reader    — SessionReaderModal renders the live chat when connected,
 *               keeps the old local board for callers without a lookup,
 *               and hides the Discussion card when the lookup came back
 *               empty.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

const [migration, manifest, routes, socket, appJs, communityApi, readerDiscussion, readerModal, teachModal, recordSession] = await Promise.all([
  read("./2026-community-discussions.sql"),
  read("./manifest.json"),
  read("../modules/communities/routes.js"),
  read("../modules/communities/discussionSocket.js"),
  read("../app.js"),
  read("../../akoro-learner/src/services/communityApi.js"),
  read("../../akoro-learner/src/components/teaching/ReaderDiscussion.jsx"),
  read("../../akoro-learner/src/components/teaching/SessionReaderModal.jsx"),
  read("../../akoro-learner/src/components/teaching/TeachAgentModal.jsx"),
  read("../../akoro-learner/src/components/library/RecordTeachSession.jsx"),
]);

test("the discussion is owned by the community, one per community", () => {
  assert.ok(migration.includes("community_id    UUID NOT NULL UNIQUE REFERENCES edu.communities(id) ON DELETE CASCADE"),
    "UNIQUE community_id — one discussion per community, dying with it");
  assert.ok(migration.includes("REFERENCES edu.community_discussions(id) ON DELETE CASCADE"),
    "messages hang off their discussion and die with it");
  assert.ok(migration.includes("user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE"),
    "messages die with their author's user row");
  assert.ok(migration.includes("BETWEEN 1 AND 2000"), "group-chat sized bodies, trimmed non-empty");
  assert.ok(migration.includes("idx_edu_community_discussion_messages_recent"),
    "history reads by (discussion, created_at DESC)");
  assert.ok(manifest.includes("2026-community-discussions.sql"), "the migration is in the deploy manifest");
});

test("/for-item — the connection lookup is membership-scoped", () => {
  assert.ok(routes.includes('router.get("/for-item"'), "the lookup route exists");
  const forItem = routes.indexOf('router.get("/for-item"');
  const byId = routes.indexOf('router.get("/:id"');
  assert.ok(forItem !== -1 && byId !== -1 && forItem < byId,
    "registered before /:id — \"for-item\" must not be captured as an id");
  const route = routes.slice(forItem, routes.indexOf("// ─── GET /mine"));
  assert.ok(route.includes('from("community_members")'), "only MY memberships count");
  assert.ok(route.includes('from("community_items")') && route.includes('eq("item_type", itemType)') && route.includes('eq("item_ref", itemRef)'),
    "…and the item must actually be in one of them");
  assert.ok(route.includes('["record", "pharmd_topic", "lesson", "library"]'),
    "every connected content kind is addressable — record, pharmd topic, lesson, library");
});

test("the discussion routes are member-only and REST is the write path", () => {
  assert.ok(routes.includes('router.get("/:id/discussion/messages"'), "history");
  assert.ok(routes.includes('router.post("/:id/discussion/messages"'), "posting");
  const get = routes.slice(routes.indexOf('router.get("/:id/discussion/messages"'),
                           routes.indexOf('router.post("/:id/discussion/messages"'));
  assert.ok(get.includes('from("community_members")') && get.includes("denied"),
    "reading requires membership");
  assert.ok(routes.slice(routes.indexOf('router.post("/:id/discussion/messages"')).includes('from("community_members")'),
    "posting requires membership");
  assert.ok(routes.includes('onConflict: "community_id", ignoreDuplicates: true'),
    "get-or-create — the discussion is born on first use, never duplicated");
  assert.ok(routes.includes("last_message_at"), "the community's pointer stays warm");
  assert.ok(routes.includes("const DISCUSSION_MAX_BODY = 2000"), "the body cap matches the migration");
});

test("messages fan out to the community's socket room", () => {
  assert.ok(routes.includes('req.app.get("io")'), "the REST route reaches the app's socket server");
  assert.ok(routes.includes("discussion:message"), "the event is discussion:message");
  assert.ok(routes.includes("`discussion:${c.id}`"), "the room is the COMMUNITY's, not the content's");
});

test("the socket join re-verifies membership server-side", () => {
  assert.ok(appJs.includes('setupDiscussionSocket } from "./modules/communities/discussionSocket.js"'), "imported");
  assert.ok(appJs.includes("setupDiscussionSocket(io);"), "mounted with the other gateways");
  assert.ok(socket.includes('socket.on("join-discussion"'), "rooms are joined by event, not by hand");
  assert.ok(socket.includes('from("community_members")'), "every join checks edu.community_members");
  assert.ok(socket.includes("socket.data.user"), "identity comes from the JWT middleware, not the client");
  assert.ok(socket.includes("`discussion:${communityId}`"), "the room is the community's");
  assert.ok(socket.includes('socket.on("leave-discussion"'), "leaving is explicit");
});

test("the learner service seam exposes the three calls", () => {
  assert.ok(communityApi.includes("fetchItemCommunities") && communityApi.includes("/for-item"),
    "the connection lookup");
  assert.ok(communityApi.includes("fetchDiscussionMessages") && communityApi.includes("/discussion/messages"),
    "the persistent history");
  assert.ok(communityApi.includes("postDiscussionMessage"), "the write");
});

test("the live chat joins the room and never double-lands a message", () => {
  assert.ok(readerDiscussion.includes('window.io(API'), "realtime rides the app's socket server");
  assert.ok(readerDiscussion.includes("emit('join-discussion'") && readerDiscussion.includes("emit('leave-discussion'"),
    "membership-gated room per active community");
  assert.ok(readerDiscussion.includes("on('discussion:message'"), "live appends");
  assert.ok(readerDiscussion.includes("seenRef"), "the POST response and the socket echo are deduped by id");
  assert.ok(readerDiscussion.includes("postDiscussionMessage"), "sending goes through REST");
  assert.ok(readerDiscussion.includes("fetchDiscussionMessages"), "history loads from the server");
  assert.ok(readerDiscussion.includes("communities.length > 1"), "a chip row when several communities hold the content");
  assert.ok(readerDiscussion.includes("MAX_BODY"), "the client caps bodies like the server does");
});

test("the reader gates the discussion on a real connection", () => {
  assert.ok(readerModal.includes("discussion = null,"), "the prop is optional");
  assert.ok(readerModal.includes('t.id !== "discussion" || !!discussion?.communities?.length'),
    "the Discussion card only features when the content is connected");
  assert.ok(readerModal.includes("<ReaderDiscussion communities={discussion.communities}/>"),
    "connected — the community's real chat renders");
  assert.ok(readerModal.includes("setThreads={setDiscussionThreads}"),
    "not connected / no lookup — the old local board stays");
});

test("records carry their communities into the reader", () => {
  assert.ok(recordSession.includes("fetchItemCommunities({ itemType: 'record', itemRef: String(record.id) })"),
    "the lookup keys on the record id");
  assert.ok(recordSession.includes("discussion: discussionCommunities ? { communities: discussionCommunities } : null"),
    "unresolved lookup keeps the reader exactly as it was");
  assert.ok(teachModal.includes("discussion: content.discussion || null"),
    "the teaching session pipes it into the reader");
});
