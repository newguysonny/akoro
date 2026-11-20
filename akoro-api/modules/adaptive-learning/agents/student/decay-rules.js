// =============================================================
// agents/student/decay-rules.js
// Decay policy constants and learner-facing narration — pure, no I/O.
// =============================================================

// =============================================================
// DECAY CONFIGURATION
// =============================================================

export const DECAY_CONFIG = {
  // Base decay per day (10% default)
  baseDecayRate: 0.10,

  // Decay slows as mastery increases
  masteryMultiplier: {
    0: 1.00,  // 0–20%  confidence → full decay speed
    1: 0.85,  // 21–40%
    2: 0.70,  // 41–60%
    3: 0.55,  // 61–80%
    4: 0.40,  // 81–100% → slowest decay
  },

  // Confidence thresholds for priority levels
  priorityThresholds: {
    critical: 0.35,  // < 35%  — teach NOW
    high:     0.55,  // < 55%  — teach soon
    medium:   0.72,  // < 72%  — review this week
    low:      1.00,  // 72%+   — healthy
  },

  // Days between reviews per priority level
  reviewIntervals: {
    critical: 1,
    high:     3,
    medium:   7,
    low:      14,
  },

  // Confidence gain per review
  reinforcementRate: {
    correct:   0.20,  // +20% on correct recall
    partial:   0.10,  // +10% on partial recall
    incorrect: 0.02,  // +2%  — at least reviewed it
  },

  // Minimum confidence floor
  minConfidence: 0.05,
};

// ── Learner-facing narration ─────────────────────────────────

export function buildSessionTitle(topic, confidence) {
  const t = topic.charAt(0).toUpperCase() + topic.slice(1);
  if (confidence < 0.35) return `Urgent Review: ${t}`;
  if (confidence < 0.55) return `Strengthen: ${t} Fundamentals`;
  if (confidence < 0.72) return `Mastery Check: ${t}`;
  return `Reinforce: ${t}`;
}

export function buildSessionDescription(subject, topic, confidence, daysSince) {
  const t = topic.charAt(0).toUpperCase() + topic.slice(1);
  const pct = Math.round(confidence * 100);
  if (daysSince > 7) {
    return `⚠️ It's been ${daysSince} days since your agent was taught ${t}. Knowledge has decayed to ${pct}%. Teach it again to lock this in.`;
  }
  if (confidence < 0.40) {
    return `📉 Your agent's ${t} knowledge is at ${pct}% — it's struggling with this topic. A focused session will make a big difference.`;
  }
  return `🔄 Your agent's ${t} knowledge (${pct}%) can be strengthened. Spaced repetition builds long-term retention.`;
}

export function buildTeachingGoal(topic, confidence) {
  if (confidence < 0.40) return `Rebuild core understanding of ${topic} from scratch`;
  if (confidence < 0.65) return `Reinforce the key principles of ${topic}`;
  return `Push ${topic} knowledge from ${Math.round(confidence * 100)}% toward mastery`;
}

/** The alert text: which concepts are fading, in which topic (D44). Plain text, no emoji. */
export function buildAlertMessage(subject, topic, confidence, daysSince, concepts = []) {
  const cap = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : "");
  const where = subject ? `${cap(subject)} — ${cap(topic)}` : cap(topic);
  const pct = Math.round((Number(confidence) || 0) * 100);
  const names = (concepts || []).filter(Boolean);
  const list = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
  if (names.length) {
    return `Your agent is forgetting ${list} in ${where}. Teach ${names.length === 1 ? "it" : "them"} again — a short session brings ${names.length === 1 ? "it" : "them"} back (topic at ${pct}%).`;
  }
  if (confidence < DECAY_CONFIG.priorityThresholds.critical) return `Your agent is forgetting ${where} (${pct}%). Teach it again before it's lost.`;
  return `${where} needs revision (${pct}%). A short teaching session will reinforce it.`;
}
