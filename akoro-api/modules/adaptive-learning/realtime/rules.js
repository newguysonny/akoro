// Pure socket rules and limits for the adaptive-learning WebSocket.
// No imports, no side effects: constants and naming helpers only.

// When a socket drops we keep its orchestrator alive briefly so a reconnecting
// client can resume the same session seamlessly. If no resume arrives within the
// grace window, the orchestrator is reaped to bound memory.
export const SESSION_REAP_GRACE_MS = 5 * 60 * 1000;

// Events that act on a specific user's data. They require an authenticated
// socket (socket.data.user, set by the io.use() JWT middleware in app.js),
// and the client-supplied studentId/userId are OVERWRITTEN with the token
// identity — a client can never start/read/drive a session as someone else.
export const IDENTITY_EVENTS = new Set([
  "list_agent_pairs", "get_my_agents",
  "start_session", "start_student_session", "start_decay_session", "start_adaptive_session",
  "teacher_message", "request_summary", "resume_session", "park_session", "end_session",
  "switch_agent_pair", "get_knowledge_health", "get_subject_topics",
  "acknowledge_alert", "get_state", "get_agent_growth",
  "subscribe-student", "join-student-room",
]);

// Session starts retired by D42: teaching now starts with start_adaptive_session.
export const RETIRED_SESSION_EVENTS = [
  "start_session", "start_student_session", "start_decay_session",
];

export const sessionRoom = (sessionId) => `session:${sessionId}`;
export const studentRoom = (studentId) => `student:${studentId}`;
export const userRoom    = (userId)    => `user:${userId}`;
