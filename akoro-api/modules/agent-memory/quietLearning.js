/**
 * modules/agent-memory/quietLearning.js — Grand Plan §7.16.6 "quiet learning".
 *
 * After a learner's chat goes quiet (no new turn for QUIET.SETTLE_MS, at
 * least QUIET.MIN_NEW_MESSAGES since the last pass), one background pass
 * writes a real summary of the conversation and merges the learner's
 * memories — add, update, forget — so the agent is sharper next time.
 *
 *   noteChatTurn()      after every saved chat turn: (re)arms one delayed job
 *                       per chat, so a busy chat is read once, when it settles
 *   runQuietPass()      the pass (the worker calls it; the gate calls it with
 *                       force to skip the wait)
 *
 * Fixed in code: the learner's consent (agent Online + "Learn from my
 * conversations", D47); the platform pays (D46, __payer: "platform") within
 * a weekly and daily pass budget; one pass per (chat, watermark) — a replay
 * is a no-op; sensitive content is never stored and memory never feeds
 * mastery (D50); at most QUIET.MAX_ACTIVE active memories per learner.
 */
import { budgetState } from "../autonomy/budget.js";
import { backgroundQueue, handleBackground } from "../../lib/backgroundQueue.js";
import { addLater } from "../../lib/deferredJobs.js";

import db from "../../db.js";
import { openai } from "../../lib/aiModel.js";
import { workerJob } from "../../lib/workerLog.js";
import { QUIET, buildQuietLearningMessages, cleanPassResult, quietLearningSchema, readyForPass } from "./quietLearningCore.js";

const edu = () => db.schema("edu");
const now = () => new Date().toISOString();
export const quietLearningEnabled = () => String(process.env.QUIET_LEARNING_ENABLED ?? "true").toLowerCase() !== "false";

let worker;
// The shared background queue (lib/backgroundQueue.js). The pass waits in
// Postgres until the chat has settled (lib/deferredJobs.js): a busy chat only
// pushes its row back, with no Redis call.
const quietQueue = () => backgroundQueue("quiet-learning", {
  attempts: 2, backoff: { type: "exponential", delay: 60_000 }, removeOnComplete: true, removeOnFail: { count: 200 },
});

/** The learner's consent: agent Online and "Learn from my conversations" on. */
export async function quietLearningConsent(userId) {
  const { data, error } = await edu().from("learner_agent_autonomy")
    .select("enabled, learn_from_chats").eq("user_id", userId).maybeSingle();
  if (error) return { allowed: false, reason: "consent_unavailable" };
  if (!data?.enabled) return { allowed: false, reason: "agent_offline" };
  if (data.learn_from_chats === false) return { allowed: false, reason: "learning_paused" };
  return { allowed: true };
}

/** After a saved turn: one delayed pass per chat, pushed back while the chat is busy. Never throws. */
export async function noteChatTurn({ userId, chatSessionId }) {
  if (!quietLearningEnabled() || !userId || !chatSessionId) return { armed: false };
  try {
    const jobId = `quiet-${chatSessionId}`;
    const q = quietQueue();
    // A pass already handed to the queue: let it run (it re-checks that the chat settled).
    const existing = await q.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "delayed") { await existing.changeDelay(QUIET.SETTLE_MS); return { armed: true, pushedBack: true }; }
      if (state === "active" || state === "waiting") return { armed: true };
      await existing.remove().catch(() => {});
    }
    // Waiting in Postgres: replace pushes the same row back by SETTLE_MS.
    await addLater(q, "pass", { userId, chatSessionId }, { jobId, delay: QUIET.SETTLE_MS, replace: true });
    return { armed: true };
  } catch (error) {
    console.warn("[quiet-learning] could not arm a pass:", error.message);
    return { armed: false };
  }
}

async function budgetLeft(userId) {
  const since = (ms) => new Date(Date.now() - ms).toISOString();
  const count = async (ms) => {
    const { count: n } = await edu().from("quiet_learning_runs").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "done").gte("created_at", since(ms));
    return n ?? 0;
  };
  const [week, day] = await Promise.all([count(7 * 864e5), count(864e5)]);
  return week < QUIET.WEEKLY_PASSES && day < QUIET.DAILY_PASSES;
}

/**
 * One pass over one chat. → { status: "done" | "skipped", reason?, added, updated, forgotten }
 * `force`: the gate's switch to skip the settle wait (never the consent or budget).
 */
export async function runQuietPass({ userId, chatSessionId, force = false, chat = null }) {
  const skipped = (reason) => ({ status: "skipped", reason, added: 0, updated: 0, forgotten: 0 });
  if (!quietLearningEnabled()) return skipped("disabled");
  const consent = await quietLearningConsent(userId);
  if (!consent.allowed) return skipped(consent.reason);
  // The weekly background budget (§7.16.7): at 100% remembering waits for the week to turn.
  if (!force) {
    const budget = await budgetState(userId).catch(() => null);
    if (budget?.stop) return skipped("budget");
  }

  const { data: session } = await db.from("chat_sessions").select("id, user_id").eq("id", chatSessionId).maybeSingle();
  if (!session || session.user_id !== userId) return skipped("no_chat");

  const [{ count: messageCount }, { data: lastRun }, { data: newest }] = await Promise.all([
    db.from("chat_messages").select("id", { count: "exact", head: true }).eq("session_id", chatSessionId).eq("user_id", userId),
    edu().from("quiet_learning_runs").select("watermark").eq("chat_session_id", chatSessionId).in("status", ["done", "running"])
      .order("watermark", { ascending: false }).limit(1).maybeSingle(),
    db.from("chat_messages").select("created_at").eq("session_id", chatSessionId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const watermark = messageCount ?? 0;
  const ready = readyForPass({ messageCount: watermark, lastWatermark: lastRun?.watermark || 0, lastMessageAt: newest?.created_at, force });
  if (!ready.ready) {
    if (ready.reason === "not_settled") await noteChatTurn({ userId, chatSessionId });
    return skipped(ready.reason);
  }
  if (!await budgetLeft(userId)) return skipped("budget");

  // Claim (chat, watermark): a replay or a second worker gets nothing to do.
  const { data: run, error: claimError } = await edu().from("quiet_learning_runs")
    .insert({ user_id: userId, chat_session_id: chatSessionId, watermark, status: "running" })
    .select("id").maybeSingle();
  if (claimError || !run) return skipped("already_done");
  const finish = (patch) => edu().from("quiet_learning_runs").update({ ...patch, finished_at: now() }).eq("id", run.id);

  try {
    const [{ data: msgs }, { data: summaryRow }, { data: memories }] = await Promise.all([
      db.from("chat_messages").select("role, text, created_at").eq("session_id", chatSessionId).eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(QUIET.TRANSCRIPT_MESSAGES),
      edu().from("learner_agent_conversation_summaries").select("summary").eq("chat_session_id", chatSessionId).maybeSingle(),
      edu().from("learner_agent_memories").select("id, kind, content, subject, topic").eq("user_id", userId).eq("status", "active")
        .order("updated_at", { ascending: false }).limit(QUIET.EXISTING_MEMORIES),
    ]);
    const transcript = (msgs || []).reverse().filter((m) => m.text && (m.role === "user" || m.role === "agent"));
    const existing = memories || [];
    const previous = String(summaryRow?.summary || "");
    const messages = buildQuietLearningMessages({ summary: /^Latest learner request:/.test(previous) ? "" : previous, transcript, memories: existing });

    const call = chat || ((body) => openai.chat.completions.create(body));
    const res = await call({
      // No learner chose this model: the background role (lib/modelRegistry.js).
      __role: "background", messages, temperature: 0.2, max_tokens: QUIET.MAX_TOKENS,
      response_format: quietLearningSchema(),
      __payer: "platform", __feature: "quiet_learning", __ref: userId, __timeoutMs: 60_000, __maxRetries: 1,
    });
    let json = {};
    try { json = JSON.parse(res?.choices?.[0]?.message?.content || "{}"); } catch { json = {}; }
    const plan = cleanPassResult(json, { existing });
    const tokens = Number(res?.usage?.total_tokens) || 0;

    if (plan.summary) {
      await edu().from("learner_agent_conversation_summaries").upsert(
        { chat_session_id: chatSessionId, user_id: userId, summary: plan.summary, source_message_count: watermark, updated_at: now() },
        { onConflict: "chat_session_id" });
    }
    if (plan.adds.length) {
      await edu().from("learner_agent_memories").insert(plan.adds.map((m, i) => ({
        user_id: userId, chat_session_id: chatSessionId, agent_session_id: "quiet-learning", agent_turn_id: `w${watermark}-${i}`,
        kind: m.kind, content: m.content, subject: m.subject, topic: m.topic, source: "quiet_learning",
      })));
    }
    for (const u of plan.updates) {
      await edu().from("learner_agent_memories").update({ content: u.content, kind: u.kind, subject: u.subject, topic: u.topic, updated_at: now() })
        .eq("id", u.id).eq("user_id", userId).eq("status", "active");
    }
    if (plan.forgets.length) {
      await edu().from("learner_agent_memories").update({ status: "forgotten", updated_at: now() })
        .in("id", plan.forgets).eq("user_id", userId).eq("status", "active");
    }
    await enforceCap(userId);
    const result = { added: plan.adds.length, updated: plan.updates.length, forgotten: plan.forgets.length };
    await finish({ status: "done", tokens, ...result, reason: plan.dropped.length ? `dropped ${plan.dropped.map((d) => d.why).join(",")}`.slice(0, 300) : null });
    return { status: "done", summary: !!plan.summary, dropped: plan.dropped, ...result };
  } catch (error) {
    await finish({ status: "failed", reason: String(error.message || "failed").slice(0, 300) }).catch(() => {});
    throw error;
  }
}

/** At most QUIET.MAX_ACTIVE active memories: the least recently touched fall off. */
async function enforceCap(userId) {
  const { data } = await edu().from("learner_agent_memories").select("id").eq("user_id", userId).eq("status", "active")
    .order("updated_at", { ascending: false }).range(QUIET.MAX_ACTIVE, QUIET.MAX_ACTIVE + 99);
  const over = (data || []).map((r) => r.id);
  if (over.length) await edu().from("learner_agent_memories").update({ status: "forgotten", updated_at: now() }).in("id", over).eq("user_id", userId);
}

export function startQuietLearningWorker() {
  if (worker) return worker;
  worker = handleBackground("quiet-learning", async (job) => runQuietPass({ userId: job.data?.userId, chatSessionId: job.data?.chatSessionId }), {
    concurrency: 2,
    onCompleted: (job, result) => workerJob("quiet-learning", "done", job, { status: result?.status, reason: result?.reason || null }),
    onFailed: (job, error) => workerJob("quiet-learning", "failed", job, { error: error?.message }),
  });
  return worker;
}
