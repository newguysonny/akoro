/**
 * agent-network/outreachCore.js — Phase 21 part 2: when a learner's agent may
 * START a conversation with another agent on its own, and when it must ask its
 * learner first. PURE.
 *
 *   No permission:  a study question to a FRIEND's agent, or to a learner who
 *                   opted in to "help other learners" — no personal data, no
 *                   commitment.
 *   Ask first:      anything that creates a relationship (friend request),
 *                   shares the learner's data (notes, scores, school), commits
 *                   their time (a battle), or contacts a stranger; and every
 *                   outreach of a primary / JSS learner.
 *   Never:          a blocked pair; past the daily cap; while the agent is
 *                   Offline or in quiet hours (it waits for the next trigger).
 */
export const OUTREACH = Object.freeze({
  PER_DAY: 3,
  PURPOSES: Object.freeze(["study_question", "friend_request", "battle_invite", "share_data"]),
  TRIGGERS: Object.freeze(["struggle", "topic_start", "missed_check", "planner", "manual"]),
});
/** The agent_messages kind each purpose travels as. */
export const KIND_FOR_PURPOSE = Object.freeze({ study_question: "consult", friend_request: "friend_request", battle_invite: "suggestion", share_data: "suggestion" });

/** → { action: "send" | "ask_learner" | "skip", reason } */
export function decideOutreach({ purpose = "study_question", target = {}, protectedLearner = false, sentToday = 0, agentOnline = true, quiet = false } = {}) {
  if (!OUTREACH.PURPOSES.includes(purpose)) return { action: "skip", reason: "unknown_purpose" };
  if (!target?.userId) return { action: "skip", reason: "no_helper" };
  if (target.blocked) return { action: "skip", reason: "blocked" };
  if (!agentOnline) return { action: "skip", reason: "agent_offline" };
  if (quiet) return { action: "skip", reason: "quiet_hours" };
  if (sentToday >= OUTREACH.PER_DAY) return { action: "skip", reason: "daily_cap" };
  if (purpose !== "study_question") return { action: "ask_learner", reason: "needs_permission" };
  if (protectedLearner) return { action: "ask_learner", reason: "younger_learner" };
  if (target.isFriend || target.optedIn) return { action: "send", reason: target.isFriend ? "friend" : "opted_in" };
  return { action: "ask_learner", reason: "stranger" };
}

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** The question the agent sends (10–400 chars; never any personal detail of its learner). */
export function outreachQuestion({ trigger = "struggle", topic = "", gaps = [], purpose = "study_question" } = {}) {
  const t = clip(topic, 80) || "this topic";
  if (purpose === "friend_request") return `Our learners are both studying ${t}. Would yours like to be study friends?`;
  if (purpose === "battle_invite") return `Would your learner like a friendly revision battle on ${t}?`;
  if (purpose === "share_data") return `My learner is happy to share their notes on ${t} with yours.`;
  const g = (gaps || []).map((x) => clip(x, 60)).filter(Boolean).slice(0, 2);
  if (trigger === "topic_start") return `We're starting ${t}. What's the clearest way you were taught it — one or two key ideas?`;
  return `My learner is stuck on ${t}${g.length ? ` (especially ${g.join(" and ")})` : ""}. How did you get past it — what worked?`.slice(0, 400);
}

/** What the agent tells its own learner, after reaching out or when asking first. */
export function outreachLearnerText({ action, helperName = "another learner", topic = "", purpose = "study_question", answer = null } = {}) {
  const t = clip(topic, 80) || "this topic";
  if (answer) return `I asked ${helperName}'s agent about ${t}. They said: “${clip(answer, 500)}”`;
  if (action === "send") return `I've asked ${helperName}'s agent how they got past ${t}. I'll tell you what they say.`;
  if (purpose === "friend_request") return `${helperName} is studying ${t} too. Shall I ask their agent if you two can be study friends?`;
  if (purpose === "battle_invite") return `Shall I invite ${helperName} to a revision battle on ${t}?`;
  if (purpose === "share_data") return `Shall I share your notes on ${t} with ${helperName}'s agent?`;
  return `${helperName} got past ${t} before. Shall I ask their agent what worked?`;
}
