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
import { agentDeps } from "../../lib/agentDeps.js";

export async function runDecisionFollowUp({ userId, conversationId = null, outcomeText, confirmationId }) {
  if (!userId || !confirmationId) return null;
  try {
    const [{ runAgentToolLoop, getLearnerChatTools, SIDE_EFFECT_TOOLS, readChat }, { postIntoChat }] = await Promise.all([
      Promise.resolve(agentDeps()),
      import("./escalation.js"),
    ]);

    // Read-only tool set: no create/delete/send tools reach the model here.
    const tools = getLearnerChatTools({ allowToolRequest: false, selfTooling: false })
      .filter((t) => !SIDE_EFFECT_TOOLS.includes(t.name))
      .map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));

    // The decision arrives as a SEPARATE request, so this turn has no memory of
    // the conversation that set the change up. Without that history the model
    // can only say "I'll take a look" — it has no idea what it promised to
    // verify or what changed. Load the recent transcript so it can actually
    // follow through (e.g. list the chats after deleting one).
    let history = [];
    if (conversationId) {
      try {
        const h = await readChat(userId, conversationId, { limit: 12 });
        history = (h?.messages || []).map((m) => ({
          role: m.from === "agent" ? "assistant" : "user",
          content: String(m.text || "").slice(0, 1000),
        })).filter((m) => m.content);
      } catch { /* history is best-effort */ }
    }

    const systemContent = "You are the learner's study agent. The learner just made a decision in the app and the app has ALREADY applied (or undone) it — do not ask them to confirm it again. Your job now is to VERIFY the result and report it, not to promise you'll look later: use a READ tool to check the change actually took effect (if something was deleted or created, list that item and confirm it is gone/present — e.g. list_chats, list_my_tasks). Reply in one or two short lines: a brief acknowledgement, then what you actually read back. If no read tool fits, say plainly what was applied. You may only READ right now; never claim to change, create, delete or send anything. Do not re-propose the same change or repeat its change card.";
    const timed = new Promise((_, reject) => { const t = setTimeout(() => reject(new Error("decision follow-up timed out")), 25_000); t.unref?.(); });
    const run = await Promise.race([
      runAgentToolLoop({
        systemContent,
        messages: [...history, { role: "user", content: String(outcomeText || "").slice(0, 600) }],
        studentId: userId,
        conversationId: conversationId || null,
        tools,
        // Keep streaming on: the loop only exposes the final answer as
        // `finalText` when streaming is enabled (the last assistant turn is not
        // pushed to `messages` on the no-tool-call path), so turning it off
        // dropped the reply and this follow-up posted nothing.
        streamText: true,
        think: false,
        status: () => {},
        toolLimitMs: 18_000,
      }),
      timed,
    ]);

    // The answer lives in `finalText` on the common no-tool-call path; fall back
    // to the transcript for the tool-call path.
    const transcript = run?.messages || [];
    const reply = String(run?.finalText || "").trim()
      || [...transcript].reverse().find((m) => m.role === "assistant" && String(m.content || "").trim())?.content?.trim()
      || "";
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
