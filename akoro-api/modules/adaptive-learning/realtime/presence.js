// Presence: user/student room subscription and disconnect cleanup.

import { joinStudentRooms } from "./rooms.js";
import { activeSessions, scheduleSessionReap } from "./sessions.js";
import { ensureSessionRecord } from "../teaching-session/lifecycle.js";

export function registerPresenceHandlers(socket) {
  // ── subscribe-student / join-student-room ─────────────────
  // Joins the student room so out-of-session pushes (e.g.
  // agent_purchased after a marketplace payment) reach this socket
  // even when no teaching session is active. Identity comes from the
  // token — the payload id is ignored.
  socket.on("subscribe-student",  () => joinStudentRooms(socket));
  socket.on("join-student-room",  () => joinStudentRooms(socket));

  // ── disconnect ────────────────────────────────────────────
  socket.on("disconnect", () => {
    const sid = socket.data?.sessionId;
    // A cancelled/closed session must still be saved: make sure the DB row
    // exists (it stays `active`, so it lists as resumable) before we let the
    // in-memory orchestrator go.
    if (sid && activeSessions.has(sid)) {
      ensureSessionRecord(activeSessions.get(sid))
        .catch(e => console.warn("[adaptive_sessions persist-on-cancel]", e.message));
      // Keep the orchestrator alive through a grace window so a reconnecting
      // client can resume it; reap it if no resume arrives.
      scheduleSessionReap(sid);
    }
    console.log(`🔌 Disconnected: ${socket.id} (session: ${sid || "none"})`);
  });
}
