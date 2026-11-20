// =============================================================
// modules/adaptive-learning/realtime/websocket.js  —  entry point
//
// Wires the adaptive-learning Socket.io handlers to the shared io instance.
// The implementation lives in focused siblings:
//   identity.js          token-identity guard for identity-bearing events
//   presence.js          student/user room subscription + disconnect cleanup
//   chat.js              agent inventory + retired session starts
//   teachingSession.js   start_adaptive_session, teacher_message, request_summary
//   teachingLifecycle.js resume/park/end, teaching mode, open_workflow
//   teachingSwitch.js    switch_agent_pair
//   knowledge.js         decay health, topics, alerts, state, agent growth
//   sessions.js          active session map + reap grace window
//   rooms.js / rules.js  room joins, event rules, room naming
//   format.js            pure summary formatters
// =============================================================

import { decayEngine } from "../agents/student/decayEngine.js";
import { installIdentityGuard } from "./identity.js";
import { registerPresenceHandlers } from "./presence.js";
import { registerChatHandlers } from "./chat.js";
import { registerTeachingSessionHandlers } from "./teachingSession.js";
import { registerTeachingLifecycleHandlers } from "./teachingLifecycle.js";
import { registerTeachingSwitchHandlers } from "./teachingSwitch.js";
import { registerKnowledgeHandlers } from "./knowledge.js";

export { activeSessions } from "./sessions.js";

export function setupWebSocket(io) {
  // Wire decay engine + global io for webhook emits
  decayEngine.setWsManager(io);
  global._io = io;

  io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    installIdentityGuard(socket);
    registerPresenceHandlers(socket);
    registerChatHandlers(socket);
    registerTeachingSessionHandlers(socket);
    registerTeachingLifecycleHandlers(socket);
    registerTeachingSwitchHandlers(socket);
    registerKnowledgeHandlers(socket);
  });
}
