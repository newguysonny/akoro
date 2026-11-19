// In-process state shared by chat.js and its helpers. ONE module holds it:
// these Maps encode live turns, stops and per-conversation tool-area
// selection, so a second copy would silently break stop and area stickiness.

// The measured learner-profile slice is a separate additive deployment. Keep
// the legacy JavaScript teaching/session engine unchanged while its migration
// and learner controls are being rolled out.
export const learnerInsightsEnabled = String(process.env.AKORO_LEARNER_INSIGHTS_ENABLED || "").toLowerCase() === "true";
export const learnerSoulStateEnabled = String(process.env.AKORO_LEARNER_SOUL_STATE_ENABLED || "").toLowerCase() === "true";
export const conceptTrackerEnabled = String(process.env.AKORO_CONCEPT_TRACKER_ENABLED || "").toLowerCase() === "true";
// Default-ON kill switches (the peer-consult/blog-research pattern): the
// slices ship enabled; AKORO_…_ENABLED=false removes them everywhere at once.
export const examPrepConfidenceEnabled = String(process.env.AKORO_EXAM_PREP_CONFIDENCE_ENABLED ?? "true").toLowerCase() !== "false";
export const studyPrepEnabled = String(process.env.AKORO_STUDY_PREP_ENABLED ?? "true").toLowerCase() !== "false";

// Durable Agent Chat context is the DEFAULT (the four 2026-python-agent-
// conversation-* migrations ship in the manifest). Set the flag to "false"
// only to force the plain-transcript fallback on a lagging environment.
export const durableAgentChatContextEnabled = String(process.env.AKORO_AGENT_CHAT_DURABLE_CONTEXT_ENABLED ?? "true").trim().toLowerCase() === "true";

// A turn that is never saved is invisible everywhere else: the reply already
// went out, so no error path logs it. One warn per process is enough to see
// it in production logs without spamming per message.
export const warnedUnsavedTurn = { warned: false };
export const AGENT_CHAT_SESSION_PREFIX = "agentchat_";
export const CHAT_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CHAT_TURN_ID = /^[A-Za-z0-9_-]{8,180}$/;

export function agentSessionId(conversationId) {
  return `${AGENT_CHAT_SESSION_PREFIX}${String(conversationId).replace(/-/g, "")}`;
}

// ■ Stop. Only an EXPLICIT stop (POST /agent/stop with the turn id) ends a
// turn early — a dropped connection does not: the server still finishes and
// saves the full reply, so the client's same-turnId retry replays the real
// answer instead of a "stopped" stub. In-memory and per instance: a stop that
// lands on another instance is a no-op and the turn simply completes.
export const activeTurnStops = new Map();   // `${userId}:${turnId}` → { stop: boolean }
export const turnStopKey = (userId, turnId) => `${userId}:${turnId}`;

// Runtime area selection (toolSelection.js): the areas active for a
// conversation stick for its life. In-memory and per instance, like the turn
// stops above — a lost set only means the next turn re-derives the areas
// from the learner's message and the loader.
export const conversationAreas = new Map();   // conversationId → Set<area>

export function stickyAreasFor(conversationId) {
  if (!conversationId) return new Set();
  let set = conversationAreas.get(conversationId);
  if (!set) {
    if (conversationAreas.size >= 1000) conversationAreas.delete(conversationAreas.keys().next().value);
    set = new Set();
    conversationAreas.set(conversationId, set);
  }
  return set;
}

export const activeSessionTurns = new Map();       // sessionId -> live /agent turns
export const decisionContinuations = new Map();    // sessionId -> in-flight continuation
