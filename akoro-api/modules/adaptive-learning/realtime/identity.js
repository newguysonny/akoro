// Socket identity guard: overwrite client-supplied user/student ids with the
// authenticated token identity before an identity-bearing event runs.

import { IDENTITY_EVENTS } from "./rules.js";

export function installIdentityGuard(socket) {
  socket.use((packet, next) => {
    const [event, payload] = packet;
    if (IDENTITY_EVENTS.has(event)) {
      const u = socket.data.user;
      if (!u) { socket.emit("error", { message: "Sign in required." }); return; } // drop the packet
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        payload.userId = u.id;
        if ("studentId" in payload || /^(start_student_session|start_decay_session|start_adaptive_session|get_knowledge_health|get_subject_topics|get_agent_growth)$/.test(event)) {
          payload.studentId = u.id;
        }
      }
    }
    next();
  });
}
