/**
 * modules/autonomy/cycle.js — the background study brain (Level 2).
 *
 * One bounded cycle per learner per night: GATHER signals with pure reads →
 * REASON with ONE metered structured call → VALIDATE server-side (caps,
 * dedupe, quiet hours) → PERSIST proposals to the inbox. Nothing executes
 * here — approval is the inbox's job. docs/learner-full-autonomy-plan.md §5.
 */
import db from "../../db.js";
import { OPENAI_MODEL, openai } from "../../lib/aiModel.js";
import { reportAgentActivity, clearAgentActivity } from "../../lib/agentActivity.js";

const edu = () => db.schema("edu");

export const MAX_PROPOSALS_PER_CYCLE = 3;
export const MAX_PENDING_PROPOSALS = 5;
export const DEDUPE_WINDOW_DAYS = 30;
const ALLOWED_KINDS = ["task", "session", "goal", "practice"];

const LAGOS = "Africa/Lagos";
// Quiet hours 20:00–07:30 Africa/Lagos (locked decision, plan §9.2).
const QUIET_START_MIN = 20 * 60;        // 1200
const QUIET_END_MIN = 7 * 60 + 30;      // 450

const minutesInLagos = (date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LAGOS, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
};

/** Is this instant inside quiet hours (Africa/Lagos)? */
export function inQuietHours(date) {
  const mins = minutesInLagos(date);
  return mins >= QUIET_START_MIN || mins < QUIET_END_MIN;
}

/** Next instant outside quiet hours (Lagos is fixed UTC+1, no DST). */
export function outsideQuietHours(date) {
  if (!inQuietHours(date)) return date.toISOString();
  // evening (≥20:00) shifts to tomorrow 07:30; early morning shifts to today 07:30
  const evening = minutesInLagos(date) >= QUIET_START_MIN;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: LAGOS, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(evening ? new Date(date.getTime() + 24 * 3600 * 1000) : date);
  return `${day}T07:30:00+01:00`;
}

const normalizeTitle = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** ── 1. GATHER — pure reads, no model. Anything missing is simply absent. */
export async function gatherSignals(userId) {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [goals, pendingTasks, recentDone, pendingProposals, recentFeedback] = await Promise.all([
    edu().from("learner_goals").select("title, category, exam, target_date, metric")
      .eq("user_id", userId).eq("status", "active").order("updated_at", { ascending: false }).limit(5)
      .then((r) => r.data ?? []).catch(() => []),
    db.from("tasks").select("title, due_at, status, priority")
      .eq("creator_id", userId).in("status", ["pending", "queued"]).limit(30)
      .then((r) => r.data ?? []).catch(() => []),
    db.from("tasks").select("id", { count: "exact", head: true })
      .eq("creator_id", userId).eq("status", "done").gte("updated_at", since)
      .then((r) => r.count ?? 0).catch(() => 0),
    edu().from("agent_proposals").select("title").eq("user_id", userId).eq("status", "proposed")
      .then((r) => r.data ?? []).catch(() => []),
    edu().from("agent_proposals").select("kind, decision_note")
      .eq("user_id", userId).eq("status", "dismissed")
      .gte("decided_at", new Date(Date.now() - DEDUPE_WINDOW_DAYS * 24 * 3600 * 1000).toISOString())
      .limit(20).then((r) => r.data ?? []).catch(() => []),
  ]);

  const nowMs = Date.now();
  const overdue = pendingTasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < nowMs);
  return {
    goals,
    tasks: {
      pending: pendingTasks.length,
      overdue: overdue.length,
      doneLastWeek: recentDone,
      titles: pendingTasks.slice(0, 8).map((t) => t.title),
    },
    pendingProposalTitles: pendingProposals.map((p) => p.title),
    dismissalTaste: recentFeedback.map((d) => `${d.kind}:${d.decision_note ?? "unspecified"}`),
  };
}

/** ── 2. REASON — one metered, structured call. Coins guard = budget. */
export async function reasonAboutSignals(userId, signals) {
  const system =
    `You are the learner's background study planner for Akoro, an education platform. ` +
    `You receive their active goals and task signals and propose AT MOST ${MAX_PROPOSALS_PER_CYCLE} ` +
    `small, concrete, genuinely useful next steps. House rules:\n` +
    `- kinds: task (a study task), practice (a short focused drill), session (a scheduled agent check-in), goal (a new education-related goal)\n` +
    `- every rationale must cite a real signal ("2 overdue tasks", "goal target in 9 days") — never generic\n` +
    `- never repeat a pending proposal or something in their task list already\n` +
    `- sessions: payload.scheduledAt is ISO 8601 with +01:00 offset, 06:00-21:00 Africa/Lagos never inside 20:00-07:30, at most 14 days ahead\n` +
    `- task/practice payload: { title, description?, priority (high|medium|low), dueAt? ISO, course? }\n` +
    `- goal payload: { title, category?, target_date? YYYY-MM-DD } — education-related only\n` +
    `- the learner dismissed these tastes recently, respect them: ${JSON.stringify(signals.dismissalTaste)}\n` +
    `- prefer FEWER, better proposals; returning zero is correct when nothing would help\n` +
    `JSON only: { "summary": "...", "proposals": [ { "kind": "...", "title": "...", "rationale": "...", "payload": { ... } } ] }`;
  const user =
    `Active goals: ${JSON.stringify(signals.goals)}\n` +
    `Tasks: ${JSON.stringify(signals.tasks)}\n` +
    `Already proposed (pending): ${JSON.stringify(signals.pendingProposalTitles)}\n` +
    `Now (Africa/Lagos): ${new Date().toLocaleString("en-GB", { timeZone: LAGOS })}`;

  const res = await openai.chat.completions.create({
    model: OPENAI_MODEL, temperature: 0.4, max_tokens: 700,
    response_format: { type: "json_object" },
    __userId: userId, __feature: "agent_autonomy",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  let parsed = { summary: "", proposals: [] };
  try { parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}"); } catch { /* stays empty */ }
  return { ...parsed, tokens: res.usage?.total_tokens ?? 0 };
}

/** Clean-room validator: caps, dedupe (pending + 30-day history + tasks), shapes. */
export async function validateAndShapeProposals(userId, rawProposals) {
  if (!Array.isArray(rawProposals)) return [];
  const since = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const [history, openTasks] = await Promise.all([
    edu().from("agent_proposals").select("title").eq("user_id", userId)
      .gte("created_at", since).limit(100).then((r) => r.data ?? []).catch(() => []),
    db.from("tasks").select("title").eq("creator_id", userId)
      .in("status", ["pending", "queued", "done"]).limit(200).then((r) => r.data ?? []).catch(() => []),
  ]);
  const seen = new Set([
    ...history.map((h) => normalizeTitle(h.title)),
    ...openTasks.map((t) => normalizeTitle(t.title)),
  ]);

  const shaped = [];
  for (const p of rawProposals) {
    if (shaped.length >= MAX_PROPOSALS_PER_CYCLE) break;
    if (!p || !ALLOWED_KINDS.includes(p.kind)) continue;
    const title = String(p.title || "").trim();
    if (!title || title.length > 120) continue;
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) continue;

    let payload = (p.payload && typeof p.payload === "object") ? { ...p.payload } : {};
    if (p.kind === "session") {
      const at = new Date(payload.scheduledAt || "");
      const nowMs = Date.now();
      if (!Number.isFinite(at.getTime()) || at.getTime() <= nowMs || at.getTime() > nowMs + 14 * 24 * 3600 * 1000) continue;
      payload.scheduledAt = outsideQuietHours(at);
      payload.title = payload.title || `Check-in: ${title.slice(0, 60)}`;
      payload.message = String(payload.message || `Checking in about: ${title}`).slice(0, 500);
    } else if (p.kind === "task" || p.kind === "practice") {
      if (payload.dueAt) {
        const due = new Date(payload.dueAt);
        if (!Number.isFinite(due.getTime())) delete payload.dueAt;
      }
      payload.priority = ["high", "medium", "low"].includes(payload.priority) ? payload.priority : "medium";
    } else if (p.kind === "goal") {
      payload.title = String(payload.title || title).slice(0, 120);
    }
    payload.title = String(payload.title || title).slice(0, 120);

    shaped.push({
      kind: p.kind,
      title,
      rationale: String(p.rationale || "").slice(0, 280) || null,
      payload,
    });
    seen.add(key);
  }
  return shaped;
}

/** ── 4. The full cycle for one learner. Never throws — failures are recorded. */
export async function runAutonomyCycleForUser(userId, trigger = "nightly") {
  const startedAt = new Date();
  reportAgentActivity(userId, "Reviewing your goals…");
  try {
    // Gate + pace: autonomy on, planner level, one run per ~20h, weekly cap.
    const { data: auto } = await edu().from("learner_agent_autonomy")
      .select("enabled, level, last_cycle_at").eq("user_id", userId).maybeSingle();
    if (!auto?.enabled || (auto.level ?? 1) < 2) return { skipped: "not_enabled" };
    // Pace against the LEDGER (last actual run), not last_cycle_at — the
    // scheduler claims by writing last_cycle_at, so it can't be the signal.
    const { data: lastRun } = await edu().from("autonomy_runs")
      .select("started_at").eq("user_id", userId)
      .order("started_at", { ascending: false }).limit(1);
    if (lastRun?.[0]?.started_at && Date.now() - new Date(lastRun[0].started_at).getTime() < 20 * 3600 * 1000) {
      return { skipped: "recent_run" };
    }
    const weeklyCap = Number(process.env.AKORO_AUTONOMY_MAX_WEEKLY_RUNS ?? 30);
    const { count: weekRuns } = await edu().from("autonomy_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("started_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
    if ((weekRuns ?? 0) >= weeklyCap) return { skipped: "budget" };

    const { count: pendingCount } = await edu().from("agent_proposals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "proposed").gt("expires_at", new Date().toISOString());
    if ((pendingCount ?? 0) >= MAX_PENDING_PROPOSALS) {
      await edu().from("learner_agent_autonomy").update({ last_cycle_at: startedAt.toISOString() }).eq("user_id", userId);
      return { skipped: "inbox_full", pending: pendingCount };
    }

    const signals = await gatherSignals(userId);
    const reasoned = await reasonAboutSignals(userId, signals);
    const shaped = await validateAndShapeProposals(userId, reasoned.proposals || []);

    // Respect the pending cap across what we insert.
    const room = Math.max(0, MAX_PENDING_PROPOSALS - (pendingCount ?? 0));
    const toInsert = shaped.slice(0, Math.min(room, MAX_PROPOSALS_PER_CYCLE)).map((p) => ({
      user_id: userId, kind: p.kind, title: p.title, rationale: p.rationale,
      payload: p.payload, source: trigger === "nightly" ? "cycle" : "event",
    }));

    let runId = null;
    const { data: run } = await edu().from("autonomy_runs").insert({
      user_id: userId, trigger,
      finished_at: new Date().toISOString(),
      proposals_created: toInsert.length,
      tokens_used: reasoned.tokens ?? 0,
      summary: String(reasoned.summary || "").slice(0, 500) || null,
    }).select("id").single();
    runId = run?.id ?? null;
    if (toInsert.length) {
      await edu().from("agent_proposals").insert(toInsert.map((p) => ({ ...p, run_id: runId })));
    }
    await edu().from("learner_agent_autonomy")
      .update({ last_cycle_at: startedAt.toISOString() }).eq("user_id", userId);

    if (toInsert.length) {
      reportAgentActivity(userId, `Reviewed your goals — ${toInsert.length} suggestion${toInsert.length === 1 ? "" : "s"} ready`);
      try {
        await db.from("notifications").insert({
          user_id: userId,
          type: "agent_proposals",
          title: `🤖 ${toInsert.length} suggestion${toInsert.length === 1 ? "" : "s"} from your agent`,
          content: reasoned.summary ? String(reasoned.summary).slice(0, 300) : "Your agent reviewed your goals overnight — take a look in Suggestions.",
        });
      } catch { /* the inbox badge is the durable surface */ }
    } else {
      clearAgentActivity(userId);
    }
    return { ok: true, created: toInsert.length, tokens: reasoned.tokens ?? 0 };
  } catch (error) {
    console.error("[autonomy/cycle] failed:", error.message);
    clearAgentActivity(userId);
    try {
      await edu().from("autonomy_runs").insert({
        user_id: userId, trigger,
        finished_at: new Date().toISOString(),
        summary: `failed: ${String(error.message).slice(0, 400)}`,
      });
    } catch { /* ledger best-effort */ }
    return { ok: false, error: error.message };
  }
}
