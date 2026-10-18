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
import { notifyUser } from "../notify.js";
import { untrusted, UNTRUSTED_SYSTEM_RULE } from "../../lib/untrusted.js";
import { resolveLearnerTimeZone } from "../adaptive-learning/learner-time-context.js";
import { isSensitive } from "../agent-memory/quietLearningCore.js";
import { deliverProactive } from "./deliver.js";
import { autonomyCadence, minCycleMs, weeklyRunsCap } from "./cadence.js";

const edu = () => db.schema("edu");

export const MAX_PROPOSALS_PER_CYCLE = 3;
export const MAX_PENDING_PROPOSALS = 5;
export const DEDUPE_WINDOW_DAYS = 30;
export const MIN_HOURS_BETWEEN_EVENT_RUNS = 4;
export const MAX_EVENT_RUNS_PER_DAY = 2;
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

/**
 * Consecutive-day streak ending today (or yesterday, grace), computed from
 * completion timestamps — the same honest algorithm as /api/self-study/streak
 * (it can never show a number the learner did not earn).
 */
export function computeStreak(completedAtDays, today = new Date()) {
  const days = new Set(completedAtDays);
  const key = (d) => d.toISOString().slice(0, 10);
  const cursor = new Date(today);
  if (!days.has(key(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1); // grace
  let streak = 0;
  while (days.has(key(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

/** ── 1. GATHER — pure reads, no model. Anything missing is simply absent. */
export async function gatherSignals(userId) {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const weekAhead = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const [
    goals, pendingTasks, recentDone, pendingProposals, recentFeedback,
    completions, chatSessions, battleResults, memberships,
    autonomyRow, weakConcepts, decayAlerts, recentRecords, settingsRow,
  ] = await Promise.all([
    edu().from("learner_goals").select("title, category, exam, target_date, metric, progress_note, updated_at")
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
    // streak source: the learner's real completion timestamps
    edu().from("self_study_targets").select("completed_at").eq("student_id", userId)
      .not("completed_at", "is", null).limit(400)
      .then((r) => (r.data ?? []).map((t) => t.completed_at)).catch(() => []),
    // what the learner has been thinking/talking about with their agent
    db.from("chat_sessions").select("title").eq("user_id", userId)
      .order("last_message_at", { ascending: false }).limit(5)
      .then((r) => (r.data ?? []).map((s) => s.title)).catch(() => []),
    // recent battle/review results (the platform's real scores today)
    db.from("battle_participants").select("score, is_winner, final_rank, correct_answers, joined_at")
      .eq("user_id", userId).order("joined_at", { ascending: false }).limit(3)
      .then((r) => r.data ?? []).catch(() => []),
    // class/community work due this week
    edu().from("community_members").select("community_id").eq("user_id", userId).limit(20)
      .then(async (r) => {
        const ids = (r.data ?? []).map((m) => m.community_id);
        if (!ids.length) return [];
        const { data } = await edu().from("community_activities")
          .select("title, subject, due_at").in("community_id", ids)
          .gte("due_at", new Date().toISOString()).lte("due_at", weekAhead)
          .order("due_at", { ascending: true }).limit(5);
        return data ?? [];
      }).catch(() => []),
    // Rich gather (Grand Plan §7.16.8 step 3) — consent first, then what the agent knows.
    edu().from("learner_agent_autonomy").select("learn_from_chats").eq("user_id", userId).maybeSingle()
      .then((r) => r.data ?? null).catch(() => null),
    // concepts the evidence says are weak, or carry a misconception
    edu().from("learner_concept_state")
      .select("mastery, misconception_active, next_review_due, concept_catalog(title, subject)")
      .eq("learner_id", userId).or("mastery.lt.0.5,misconception_active.eq.true")
      .order("mastery", { ascending: true }).limit(5)
      .then((r) => r.data ?? []).catch(() => []),
    // topics the forgetting curve flagged and the learner hasn't reviewed yet
    edu().from("decay_notifications").select("subject, topic, confidence, created_at")
      .eq("student_id", userId).eq("is_actioned", false)
      .gte("created_at", new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false }).limit(3)
      .then((r) => r.data ?? []).catch(() => []),
    // what they added to their library lately (the names only)
    edu().from("records").select("name, progress, created_at").eq("user_id", userId)
      .gte("created_at", new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false }).limit(5)
      .then((r) => r.data ?? []).catch(() => []),
    db.from("user_settings").select("settings").eq("user_id", userId).maybeSingle()
      .then((r) => r.data ?? null).catch(() => null),
  ]);

  // What the agent remembers, only with "Learn from my conversations" on (D47).
  const learnFromChats = autonomyRow?.learn_from_chats !== false;
  const [memories, summaries] = learnFromChats ? await Promise.all([
    edu().from("learner_agent_memories").select("kind, content, updated_at, chat_session_id")
      .eq("user_id", userId).eq("status", "active").order("updated_at", { ascending: false }).limit(12)
      .then((r) => r.data ?? []).catch(() => []),
    edu().from("learner_agent_conversation_summaries").select("summary, updated_at")
      .eq("user_id", userId).order("updated_at", { ascending: false }).limit(3)
      .then((r) => r.data ?? []).catch(() => []),
  ]) : [[], []];

  const nowMs = Date.now();
  const overdue = pendingTasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < nowMs);
  const day = 24 * 3600 * 1000;
  return {
    // → { timeZone, source }: the name only (a crash here stopped every planner run, gate d681c984).
    timeZone: resolveLearnerTimeZone({ configuredTimeZone: settingsRow?.settings?.timezone }).timeZone || LAGOS,
    goals: goals.map((g) => ({
      title: g.title, category: g.category || null, exam: g.exam || null, metric: g.metric || null,
      target_date: g.target_date || null,
      days_left: g.target_date ? Math.ceil((new Date(g.target_date).getTime() - nowMs) / day) : null,
      progress_note: g.progress_note || null,
      days_since_update: g.updated_at ? Math.floor((nowMs - new Date(g.updated_at).getTime()) / day) : null,
    })),
    tasks: {
      pending: pendingTasks.length,
      overdue: overdue.length,
      doneLastWeek: recentDone,
      titles: pendingTasks.slice(0, 8).map((t) => t.title),
    },
    streakDays: computeStreak(completions.map((c) => String(c).slice(0, 10))),
    chatTopics: chatSessions.filter(Boolean).slice(0, 5),
    recentBattles: battleResults.map((b) => ({
      score: b.score, won: Boolean(b.is_winner), rank: b.final_rank,
    })),
    classWorkDue: memberships.map((a) => ({ title: a.title, due: a.due_at })),
    pendingProposalTitles: pendingProposals.map((p) => p.title),
    weakConcepts: weakConcepts.map((c) => ({
      concept: c.concept_catalog?.title || null, subject: c.concept_catalog?.subject || null,
      mastery: Math.round(Number(c.mastery || 0) * 100), misconception: Boolean(c.misconception_active),
      review_due: c.next_review_due ? c.next_review_due <= new Date(nowMs + 2 * day).toISOString() : false,
    })).filter((c) => c.concept),
    reviewAlerts: decayAlerts.map((d) => ({ subject: d.subject, topic: d.topic, confidence: Math.round(Number(d.confidence || 0)) })),
    recentRecords: recentRecords.map((r) => ({ name: String(r.name || "").slice(0, 80), progress: r.progress ?? 0 })),
    // Quiet-learning notes and chat summaries: guidance, never evidence (D50);
    // sensitive lines never reach the planner even if one slipped into storage.
    memories: memories.filter((m) => !isSensitive(m.content)).map((m) => ({ kind: m.kind, note: String(m.content).slice(0, 200), chatId: m.chat_session_id || null })),
    chatSummaries: summaries.map((x) => String(x.summary || ""))
      .filter((t) => t && !/^Latest learner request:/.test(t) && !isSensitive(t)).map((t) => t.slice(0, 500)),
    dismissalTaste: recentFeedback.map((d) => `${d.kind}:${d.decision_note ?? "unspecified"}`),
  };
}

/**
 * The planner's prompt from the gathered signals — pure, so it can be tested.
 * What the learner said (memories, chat summaries, chat titles, record names)
 * goes in framed as data (lib/untrusted.js): it informs, it never instructs.
 */
export function planningMessages(signals) {
  const tz = signals.timeZone || LAGOS;
  const system =
    `You are the learner's background study planner for Akoro, an education platform. ` +
    `You receive what their agent knows about them and propose AT MOST ${MAX_PROPOSALS_PER_CYCLE} ` +
    `small, concrete, genuinely useful next steps. House rules:\n` +
    `- kinds: task (a study task), practice (a short focused drill), session (a scheduled agent check-in), goal (a new education-related goal)\n` +
    `- every rationale must cite a real signal ("2 overdue tasks", "goal target in 9 days", "streak at 5 days", "scored 6/10 last battle", "mastery 30% on osmosis", "you meant to revise titration curves") — never generic\n` +
    `- use what their agent remembers: something they meant to come back to is a good session or practice; a goal they keep mentioning but never set is a good goal proposal; how they like to learn shapes the task (diagrams, short quizzes)\n` +
    `- weak concepts and review alerts are good practice proposals; a goal with days_left and no recent progress needs a concrete next step\n` +
    `- never repeat a pending proposal or something in their task list already\n` +
    `- sessions: payload.scheduledAt is ISO 8601 in the learner's time zone (${tz}) with its offset, between 06:00 and 21:00 their time, never 20:00-07:30, at most 14 days ahead\n` +
    `- task/practice payload: { title, description?, priority (high|medium|low), dueAt? ISO, course? }\n` +
    `- goal payload: { title, category?, target_date? YYYY-MM-DD } — education-related only\n` +
    `- never mention health, feelings, family or money, even if a note does\n` +
    `- the learner dismissed these tastes recently, respect them: ${JSON.stringify(signals.dismissalTaste || [])}\n` +
    `- prefer FEWER, better proposals; returning zero is correct when nothing would help\n` +
    `JSON only: { "summary": "...", "proposals": [ { "kind": "...", "title": "...", "rationale": "...", "payload": { ... } } ] }` +
    UNTRUSTED_SYSTEM_RULE;
  const said = [
    signals.memories?.length ? `What their agent remembers (numbered — a proposal drawn from a note gives its number in from_note):\n${signals.memories.map((m, i) => `[${i + 1}] ${m.kind}: ${m.note}`).join("\n")}` : "",
    signals.chatSummaries?.length ? `Their recent conversations:\n${signals.chatSummaries.map((t) => `- ${t}`).join("\n")}` : "",
    signals.chatTopics?.length ? `Recent chat titles: ${signals.chatTopics.join(" · ")}` : "",
    signals.recentRecords?.length ? `Added to their library lately: ${signals.recentRecords.map((r) => `${r.name} (${r.progress}% read)`).join(" · ")}` : "",
  ].filter(Boolean).join("\n\n");
  const user =
    `Active goals: ${JSON.stringify(signals.goals)}\n` +
    `Tasks: ${JSON.stringify(signals.tasks)}\n` +
    `Study streak (days): ${signals.streakDays}\n` +
    `Weak concepts (from their evidence): ${JSON.stringify(signals.weakConcepts || [])}\n` +
    `Review alerts (forgetting curve): ${JSON.stringify(signals.reviewAlerts || [])}\n` +
    `Recent battle/review results: ${JSON.stringify(signals.recentBattles)}\n` +
    `Class work due this week: ${JSON.stringify(signals.classWorkDue)}\n` +
    `Already proposed (pending): ${JSON.stringify(signals.pendingProposalTitles)}\n` +
    `Now (${tz}): ${new Date().toLocaleString("en-GB", { timeZone: tz })}` +
    (said ? `\n\n${untrusted(said, { source: "the learner's own words and notes", limit: 4000 })}` : "");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/**
 * The planner's output, strict: every proposal carries its rationale (the
 * json_object mode left it empty on 2 of 3 proposals, gate 4037860c, and the
 * validator then dropped them). Payload fields are all present, null when
 * unused — the validator strips the nulls.
 */
export function planningSchema() {
  const N = (type) => ({ type: [type, "null"] });
  return {
    type: "json_schema",
    json_schema: {
      name: "study_planner", strict: true,
      schema: {
        type: "object", additionalProperties: false, required: ["summary", "proposals"],
        properties: {
          summary: { type: "string" },
          proposals: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["kind", "title", "rationale", "from_note", "payload"],
              properties: {
                from_note: { type: ["integer", "null"], description: "The number of the remembered note this comes from, or null." },
                kind: { type: "string", enum: ALLOWED_KINDS },
                title: { type: "string" },
                rationale: { type: "string", description: "The real signal this comes from, in one sentence." },
                payload: {
                  type: "object", additionalProperties: false,
                  required: ["title", "description", "priority", "dueAt", "course", "scheduledAt", "message", "category", "target_date"],
                  properties: {
                    title: N("string"), description: N("string"), priority: { type: ["string", "null"], enum: ["high", "medium", "low", null] },
                    dueAt: N("string"), course: N("string"), scheduledAt: N("string"), message: N("string"),
                    category: N("string"), target_date: N("string"),
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

/** ── 2. REASON — one structured call. The platform pays for background noticing (D46). */
export async function reasonAboutSignals(userId, signals) {
  const res = await openai.chat.completions.create({
    model: OPENAI_MODEL, temperature: 0.4, max_tokens: 700,
    response_format: planningSchema(),
    __payer: "platform", __feature: "agent_autonomy", __ref: userId,
    messages: planningMessages(signals),
  });
  let parsed = { summary: "", proposals: [] };
  try { parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}"); } catch { /* stays empty */ }
  return { ...parsed, tokens: res.usage?.total_tokens ?? 0 };
}

/** Clean-room validator: caps, dedupe (pending + 30-day history + tasks), shapes. */
export async function validateAndShapeProposals(userId, rawProposals, { notes = [] } = {}) {
  if (!Array.isArray(rawProposals)) return [];
  const since = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const [history, openTasks, chatOpen] = await Promise.all([
    edu().from("agent_proposals").select("title").eq("user_id", userId)
      .gte("created_at", since).limit(100).then((r) => r.data ?? []).catch(() => []),
    db.from("tasks").select("title").eq("creator_id", userId)
      .in("status", ["pending", "queued", "done"]).limit(200).then((r) => r.data ?? []).catch(() => []),
    // The chat's own open suggestions: the one inbox shows each idea once.
    db.from("agent_suggestions").select("title").eq("user_id", userId).eq("status", "open")
      .limit(100).then((r) => r.data ?? []).catch(() => []),
  ]);
  const seen = new Set([
    ...history.map((h) => normalizeTitle(h.title)),
    ...openTasks.map((t) => normalizeTitle(t.title)),
    ...chatOpen.map((s) => normalizeTitle(s.title)),
  ]);

  const shaped = [];
  for (const p of rawProposals) {
    if (shaped.length >= MAX_PROPOSALS_PER_CYCLE) break;
    if (!p || !ALLOWED_KINDS.includes(p.kind)) continue;
    const title = String(p.title || "").trim();
    if (!title || title.length > 120) continue;
    // Every suggestion says what it noticed (§7.16.3): no reason, no proposal.
    if (String(p.rationale || "").trim().length < 12) continue;
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) continue;

    let payload = (p.payload && typeof p.payload === "object")
      ? Object.fromEntries(Object.entries(p.payload).filter(([, v]) => v !== null && v !== undefined && v !== ""))
      : {};
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

    // The chat the noticed note came from (D49: the proposal is posted there).
    const note = Number.isInteger(p.from_note) ? notes[p.from_note - 1] : null;
    shaped.push({
      kind: p.kind,
      title,
      rationale: String(p.rationale || "").slice(0, 280) || null,
      payload,
      sourceChatId: note?.chatId || null,
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
    const isEvent = trigger !== "nightly";
    // Pace against the LEDGER (last actual run), not last_cycle_at — the
    // scheduler claims by writing last_cycle_at, so it can't be the signal.
    // Nightly paces at ≥20h; an event (graded work, submission, battle end)
    // may run sooner, but at most MIN_HOURS_BETWEEN_RUNS apart and at most
    // MAX_EVENT_RUNS_PER_DAY per day — freshness without frenzy.
    const { data: lastRun } = await edu().from("autonomy_runs")
      .select("started_at, trigger").eq("user_id", userId)
      .order("started_at", { ascending: false }).limit(1);
    // Cadence (modules/autonomy/cadence.js): nightly mode keeps the two-lane
    // pace — nightly ≥ min-cycle hours (default 20), events ≥ 4h. Continuous
    // mode (the AKORO_AUTONOMY_MODE=test rig) paces EVERY trigger by the
    // resolved min-cycle ms, so 5-minute test cycles aren't skipped.
    const cadence = autonomyCadence();
    const minGapMs = cadence.mode === "continuous"
      ? minCycleMs(cadence)
      : (isEvent ? MIN_HOURS_BETWEEN_EVENT_RUNS : cadence.minCycleHours) * 3600 * 1000;
    if (lastRun?.[0]?.started_at && Date.now() - new Date(lastRun[0].started_at).getTime() < minGapMs) {
      return { skipped: "recent_run" };
    }
    if (isEvent) {
      const { count: todayEvents } = await edu().from("autonomy_runs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId).like("trigger", "event:%")
        .gte("started_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
      if ((todayEvents ?? 0) >= MAX_EVENT_RUNS_PER_DAY) return { skipped: "event_cap" };
    }
    const weeklyCap = weeklyRunsCap();
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
    const shaped = await validateAndShapeProposals(userId, reasoned.proposals || [], { notes: signals.memories || [] });

    // Respect the pending cap across what we insert.
    const room = Math.max(0, MAX_PENDING_PROPOSALS - (pendingCount ?? 0));
    const toInsert = shaped.slice(0, Math.min(room, MAX_PROPOSALS_PER_CYCLE)).map((p) => ({
      user_id: userId, kind: p.kind, title: p.title, rationale: p.rationale,
      payload: p.payload, source: trigger === "nightly" ? "cycle" : "event",
      ...(p.sourceChatId ? { source_chat_id: p.sourceChatId } : {}),
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
      // D49: one of them goes into the learner's chat (its own notification
      // links there). If none could be posted now, one bell row for the batch.
      const delivered = await deliverProactive(userId).catch(() => ({ posted: false }));
      // Through notifyUser: the bell row, the live socket and web push (the
      // learner's push preference respected) — a bare insert reached none.
      if (!delivered.posted) await notifyUser({
        userId, type: "agent_proposals", link: "/app?tab=agent",
        title: `${toInsert.length} suggestion${toInsert.length === 1 ? "" : "s"} from your agent`,
        content: reasoned.summary ? String(reasoned.summary).slice(0, 300) : "Your agent reviewed your goals overnight — take a look in Suggestions.",
      }).catch(() => { /* the inbox badge is the durable surface */ });
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
