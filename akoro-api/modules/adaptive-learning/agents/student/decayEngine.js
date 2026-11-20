// =============================================================
// agents/student/decayEngine.js
// Decay & Memory Engine — public entry point.
//
// Responsibilities:
//   1. Calculate confidence decay per topic over time
//   2. Detect topics that need review
//   3. Generate decay session payloads (subject + topic focused)
//   4. Push notifications via WebSocket
//   5. Reinforce confidence on successful review
//   6. Run scheduled decay checks (called by cron)
//
// Configuration and narration: decay-rules.js
// Intervals and urgency math:   decay-schedule.js
// State transitions:            decay-apply.js
// Database queries:             decay-store.js
// =============================================================

export { DECAY_CONFIG } from "./decay-rules.js";
export { calculateDecayedConfidence, getPriority, getNextReviewDate } from "./decay-schedule.js";
export { DecayEngine } from "./decay-apply.js";

import { DecayEngine } from "./decay-apply.js";

// Singleton export
export const decayEngine = new DecayEngine();
