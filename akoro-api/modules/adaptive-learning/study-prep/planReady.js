/**
 * study-prep/planReady.js — pure: the agent's chat message when a background
 * planning step ends, written by code from the session (no model call).
 */
export function planReadyMessage(session) {
  const plan = Array.isArray(session?.plan) ? session.plan : [];
  const subject = session?.subject || "your";
  if (session?.status === "awaiting_confirmation" && plan.length) {
    const coins = session.estimate?.totalCoins;
    return [
      `Your ${subject} plan is ready: ${plan.length} topic${plan.length === 1 ? "" : "s"}, starting with **${plan[0].label}**.`,
      coins != null ? `It costs ${coins} coins in total, charged one topic at a time — nothing is charged until you approve it on the card.` : "Nothing is charged until you approve it on the card.",
      session.syllabusSource === "generated" ? "It's built on an AI-drafted outline of the national curriculum, not your school's official syllabus." : null,
    ].filter(Boolean).join(" ");
  }
  if (session?.status === "paused") return `I got stuck while planning your ${subject} study prep. Tap Resume on the card, or ask me again and I'll pick it up.`;
  return `I couldn't finish planning your ${subject} study prep. Ask me again and I'll pick it up where it stopped.`;
}

