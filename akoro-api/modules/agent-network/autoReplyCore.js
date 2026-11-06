/**
 * agent-network/autoReplyCore.js — Phase 21: what a learner's agent may do on
 * its own when another agent's message arrives. PURE (no db, no model, no
 * clock) so the policy is unit-tested exactly as it runs.
 *
 *   decide({ kind, setting, protectedLearner, autoToday, hasAnswer }) →
 *     "auto_answer"  answer now, on its own (study question; friendly chat when allowed)
 *     "ask_learner"  post an approval card in the learner's chat
 *     "tell_learner" one line in chat, nothing to decide (an idea, an answer that came back)
 *     "skip"         nothing to do (already answered, or a kind with its own flow)
 */
export const AUTO = Object.freeze({
  SETTINGS: ["off", "study", "study_chat"],
  DEFAULT_SETTING: "study",
  // Two agents can never loop: past this many automatic replies between the
  // same pair in a day, the learner is asked instead.
  MAX_AUTO_PER_PAIR_PER_DAY: 3,
  // One processing run handles at most this many messages for one learner.
  BATCH: 10,
  CHAT_REPLY_MAX_CHARS: 300,
});

/** Primary / JSS learners are always asked before friendly chat (a cautious stand-in until accounts carry an age). */
export function isProtectedLearner({ studyLevel = "", yearGroup = "" } = {}) {
  return /\b(primary|pry|nursery|jss|j\.s\.s|junior secondary|basic\s*[1-9]\b|year\s*[1-9]\b|grade\s*[1-6]\b)/i.test(`${studyLevel} ${yearGroup}`);
}

export function decide({ kind, setting = AUTO.DEFAULT_SETTING, protectedLearner = false, autoToday = 0, hasAnswer = false } = {}) {
  const s = AUTO.SETTINGS.includes(setting) ? setting : AUTO.DEFAULT_SETTING;
  const underCap = autoToday < AUTO.MAX_AUTO_PER_PAIR_PER_DAY;
  switch (kind) {
    case "consult":
      if (hasAnswer) return "tell_learner";               // answered live when it arrived: just tell the learner
      return s !== "off" && underCap ? "auto_answer" : "ask_learner";
    case "chat":
      return s === "study_chat" && !protectedLearner && underCap ? "auto_answer" : "ask_learner";
    case "friend_request":
      return "ask_learner";                               // always the learner's decision
    case "suggestion":
      return "tell_learner";
    default:
      return "skip";                                      // invites, buddy check-ins, replies: their own flows
  }
}

/** PURE: the chat line / card text the learner reads, written by code (facts, not model words). */
export function learnerText({ action, kind, fromName, agentName, body, answer = null }) {
  const who = `${fromName}${agentName ? ` (${agentName})` : ""}`;
  const quote = `“${String(body || "").replace(/\s+/g, " ").trim().slice(0, 160)}”`;
  if (kind === "friend_request") {
    return `${fromName} just sent me a message — ${fromName.split(" ")[0]} wants to be friends. ${quote}\n\nWould you like us to be friends?`;
  }
  if (action === "auto_answer" && kind === "consult") {
    return `${who} asked me: ${quote}\n\nI answered from what you've taught me${answer ? `: “${String(answer).slice(0, 200)}”` : "."}`;
  }
  if (action === "auto_answer" && kind === "chat") {
    return `${who} said: ${quote}\n\nI replied for you${answer ? `: “${String(answer).slice(0, 200)}”` : "."}`;
  }
  if (action === "ask_learner" && kind === "consult") {
    return `${who} asked me: ${quote}\n\nShall I answer from what you've taught me?`;
  }
  if (action === "ask_learner" && kind === "chat") {
    return `${who} sent me a message: ${quote}\n\nShall I reply for you?`;
  }
  if (action === "tell_learner" && kind === "consult" && answer) {
    return `${who} asked me: ${quote}\n\nI answered from what you've taught me: “${String(answer).slice(0, 200)}”`;
  }
  if (kind === "suggestion") return `${who} left us an idea: ${quote}`;
  return `${who} sent me a message: ${quote}`;
}

/** PURE: the proposal behind an approval card. */
export function proposalFor({ kind, messageId, fromName, draft = null }) {
  if (kind === "friend_request") {
    return { kind: "agent_friend", title: `Be friends with ${fromName}`, yes: "Be friends", payload: { messageId } };
  }
  return { kind: "agent_reply", title: `Reply to ${fromName}`, yes: "Yes, reply", payload: { messageId, draft } };
}
