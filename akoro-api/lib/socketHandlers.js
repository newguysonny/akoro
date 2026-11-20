/**
 * lib/socketHandlers.js — socket authentication, rooms and module websockets
 * (Phase 19 step 4). app.js still creates the Socket.io server and its Redis
 * adapter; this module installs the handlers in the original order:
 * auth middleware → connection rooms → adaptive/discussion/voice wiring.
 */
import { authenticateSocket }      from "../modules/auth/index.js";
import { schoolBillTo }            from "./coins.js";
import { setupAdaptiveWebSocket }  from "../modules/adaptive-learning/index.js";
import { setupDiscussionSocket }   from "../modules/communities/discussionSocket.js";
import { setupVoiceStreaming }     from "../modules/voice/streaming.js";

export function installSocketHandlers(io) {
  // Authenticate every socket connection from its handshake cookies/token.
  // Anonymous connections are still ACCEPTED (socket.data.user = null) so public
  // flows keep working — but identity-bearing events (adaptive teaching,
  // proctored assessments, voice streaming, user-scoped rooms) require and use
  // socket.data.user instead of trusting client-supplied ids.
  io.use(async (socket, next) => {
    socket.data.user = await authenticateSocket(socket);
    // AI billing target: on a school portal the school funds usage (billTo);
    // elsewhere the user's own wallet (student-first hybrid) is used.
    const portal = socket.handshake?.auth?.portal || socket.handshake?.query?.portal || null;
    socket.data.portal = portal;
    socket.data.billTo = (["school", "school_admin", "site"].includes(portal) && socket.data.user)
      ? await schoolBillTo(socket.data.user.id).catch(() => null)
      : null;
    next();
  });

  io.on("connection", (socket) => {
    socket.on("join-session",            (id) => socket.join(`session:${id}`));
    socket.on("leave-session",           (id) => socket.leave(`session:${id}`));
    socket.on("join-chat",               (id) => socket.join(`chat:${id}`));
    socket.on("leave-chat",              (id) => socket.leave(`chat:${id}`));
    socket.on("join-classroom",          (id) => socket.join(`classroom:${id}`));
    socket.on("join-battle",             (id) => socket.join(`battle:${id}`));
    socket.on("leave-battle",            (id) => socket.leave(`battle:${id}`));
    // User-scoped rooms: join the AUTHENTICATED user's room only — the payload
    // id is ignored, so nobody can subscribe to someone else's notifications.
    socket.on("subscribe-notifications", () => { const u = socket.data.user; if (u) socket.join(`user:${u.id}`); });
    socket.on("subscribe-student",       () => { const u = socket.data.user; if (u) socket.join(`user:${u.id}`); });
    // Joins student:{id} room for decay alerts from decayEngine cron
    socket.on("join-student-room",       () => { const u = socket.data.user; if (u) socket.join(`student:${u.id}`); });
    socket.on("join-instructor",         () => { const u = socket.data.user; if (u) socket.join(`instructor:${u.id}`); });
  });

  setupAdaptiveWebSocket(io);
  setupDiscussionSocket(io);   // community discussions — membership-gated chat rooms
  setupVoiceStreaming(io);
}
