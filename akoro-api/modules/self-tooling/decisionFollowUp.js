/**
 * self-tooling/decisionFollowUp.js — after the learner approves/declines a
 * change card, the SERVER runs one real agent turn so the agent sees the
 * decision and keeps working (e.g. "tasks deleted — now check Oyibo"), instead
 * of only a static confirmation.
 *
 * Safety:
 *  · READ-ONLY tools only — the model is never handed a change/create/send tool,
 *    so an approved decision can't silently trigger a second write. Any further
 *    change still proposes its own card.
 *  · Idempotent post — the messageId is derived from the confirmation id, so a
 *    retried confirm can't post twice.
 *  · Best-effort — bounded by a timeout; a failure never affects the applied
 *    change (the synchronous outcome message already told the learner).
 */
import { createHash } from "node:crypto";

export async function runDecisionFollowUp({ userId, conversationId = null, outcomeText, confirmationId }) {
  if (!userId || !confirmationId) return null;
  try {
    const [{ runAgentToolLoop, getLearnerChatTools, SIDE_EFFECT_TOOLS }, { postIntoChat }] = await Promise.all([
      import("../adaptive-learning/chat.js"),
      import("./escalation.js"),
    ]);

    // Read-only tool set: no create/delete/send tools reach the model here.
    const tools = getLearnerChatTools({ allowToolRequest: false, selfTooling: false })
      .filter((t) => !SIDE_EFFECT_TOOLS.includes(t.name))
      .map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));

    const systemContent = "You are the learner's study agent. The learner just made a decision in the app and the app has already applied (or undone) it. Continue helping them: acknowledge the decision in one short line, and if a next step is obvious — something you were waiting on, like checking a reply — use a READ tool and report the result. You may only READ right now; never claim to change, create, delete or send anything. Do not re-propose the same change or repeat its change card.";
    const timed = new Promise((_, reject) => { const t = setTimeout(() => reject(new Error("decision follow-up timed out")), 25_000); t.unref?.(); });
    const run = await Promise.race([
      runAgentToolLoop({
        systemContent,
        messages: [{ role: "user", content: String(outcomeText || "").slice(0, 600) }],
        studentId: userId,
        conversationId: conversationId || null,
        tools,
        streamText: false,
        think: false,
        status: () => {},
        toolLimitMs: 18_000,
      }),
      timed,
    ]);

    const transcript = run?.messages || [];
    const reply = [...transcript].reverse().find((m) => m.role === "assistant" && String(m.content || "").trim())?.content?.trim();
    if (!reply) return null;

    await postIntoChat({
      userId,
      conversationId: conversationId || null,
      title: "Your agent",
      text: reply.slice(0, 1200),
      kind: "agent_decision_followup",
      messageId: `00000000-0000-4000-8000-${createHash("sha256").update(`followup-${confirmationId}`).digest("hex").slice(0, 12)}`,
    });
    return reply;
  } catch (e) {
    console.warn("[decision-followup] skipped:", e?.message || e);
    return null;
  }
}
