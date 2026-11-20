// =============================================================
// agents/student/decay-schedule.js
// Intervals and urgency math for the decay engine — pure.
// =============================================================

import { DECAY_CONFIG } from "./decay-rules.js";

// =============================================================
// CORE DECAY MATH
// =============================================================

/**
 * Calculate current confidence after time decay.
 * Decay slows as mastery level increases.
 */
export function calculateDecayedConfidence(confidence, daysSinceReview, decayRate) {
  const masteryBucket = Math.min(4, Math.floor(confidence * 5));
  const multiplier    = DECAY_CONFIG.masteryMultiplier[masteryBucket] || 1.0;
  const effectiveRate = decayRate * multiplier;
  const decayAmount   = effectiveRate * daysSinceReview;
  return Math.max(
    DECAY_CONFIG.minConfidence,
    Math.min(0.98, confidence - decayAmount)
  );
}

/**
 * Determine priority from confidence level.
 */
export function getPriority(confidence) {
  const t = DECAY_CONFIG.priorityThresholds;
  if (confidence < t.critical) return "critical";
  if (confidence < t.high)     return "high";
  if (confidence < t.medium)   return "medium";
  return "low";
}

/**
 * Calculate when the next review is due.
 */
export function getNextReviewDate(confidence, priority) {
  const days = DECAY_CONFIG.reviewIntervals[priority] ||
               DECAY_CONFIG.reviewIntervals.low;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
