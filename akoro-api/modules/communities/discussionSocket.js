// discussionSocket.js — realtime transport for community discussions.
//
// The discussion is the community's group chat (one per community —
// edu.community_discussions). Readers surface it on any content the
// community is connected to, so a learner opening a connected PDF,
// audio lecture or video joins THIS room and sees the conversation
// that lives with the community, not with the file.
//
// Rooms: `discussion:<communityId>`. New messages are broadcast by the
// REST route (POST /:id/discussion/messages) via req.app.get("io") —
// REST stays the single write path (deadline-capped, auditable), the
// socket only fans out.
//
// Membership is verified on EVERY join against edu.community_members —
// rooms are never joined on client say-so (community materials are
// members-only, so their chat is too). The socket identity comes from
// the io.use() JWT middleware in app.js (socket.data.user).

import db from "../../db.js";

export function setupDiscussionSocket(io) {
  io.on("connection", (socket) => {

    socket.on("join-discussion", async (communityId) => {
      const u = socket.data.user;
      if (!u || !communityId) {
        socket.emit("discussion:error", { code: "auth", message: "Sign in required." });
        return;
      }
      try {
        const { data: mem, error } = await db.schema("edu").from("community_members")
          .select("user_id").eq("community_id", communityId).eq("user_id", u.id).maybeSingle();
        if (error) throw error;
        if (!mem) {
          socket.emit("discussion:error", { code: "not_member", message: "Join this community to join its discussion." });
          return;
        }
        socket.join(`discussion:${communityId}`);
        socket.emit("discussion:joined", { communityId });
      } catch (e) {
        console.warn("[discussion socket] join failed:", e?.message || e);
        socket.emit("discussion:error", { code: "db", message: "Could not open the discussion. Try again." });
      }
    });

    socket.on("leave-discussion", (communityId) => {
      if (!communityId) return;
      socket.leave(`discussion:${communityId}`);
    });
  });
}
