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
import { resolveLearnerTimeZone } from "../adaptive-learning/learner/learner-time-context.js";
import { isSensitive } from "../agent-memory/quietLearningCore.js";
import { deliverProactive } from "./deliver.js";
import { autonomyCadence, minCycleMs, weeklyRunsCap } from "./cadence.js";
import { quietOf, afterQuiet } from "./quietHours.js";
import { IDEAS, LEARNER_KINDS, shapeIdeas, shapeReady, fixIts, progressLine } from "./readyKinds.js";
import { budgetState, noteBudget } from "./budget.js";
import { modesFor, recordObservations } from "./kindModes.js";
import { allOff, defaultModeFor, LEARNER_PROACTIVE_KINDS, MAX_OBSERVATIONS_PER_RUN, observeOnly, splitByMode } from "./kindModesCore.js";
import { usdCost } from "../../lib/aiPricing.js";
import { RULES, basisColumns } from "../agent-runtime/actionBasis.js";
import { appLink } from "../../lib/urls.js";

const edu = () => db.schema("edu");

export const MAX_PROPOSALS_PER_CYCLE = 3;
export const MAX_PENDING_PROPOSALS = 5;
export const DEDUPE_WINDOW_DAYS = 30;
export const MIN_HOURS_BETWEEN_EVENT_RUNS = 4;
export const MAX_EVENT_RUNS_PER_DAY = 2;
/** A run nothing can be shown from (every kind off or observe): platform-paid, outside the learner's weekly budget (Phase 18 item 1). */
export const OBSERVE_FEATURE = "agent_autonomy_observe";

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
    edu().from("learner_goals").select("id, title, category, exam, target_date, metric, progress_note, updated_at")
      .eq("user_id", userId).eq("status", "active").order("updated_at", { ascending: false }).limit(5)
      .then((r) => r.data ?? []).catch(() => []),
    db.from("tasks").select("id, title, due_at, status, priority")
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
    edu().from("learner_agent_autonomy").select("learn_from_chats, quiet_start, quiet_end, time_zone").eq("user_id", userId).maybeSingle()
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
    edu().from("records").select("id, name, progress, created_at").eq("user_id", userId).is("deleted_at", null)
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

  // The week in numbers (goal progress notes are written from these, never guessed) and
  // what each recent record covers (a quiz preview names its topics).
  const [sessionsWeek, battlesWeek, ingests] = await Promise.all([
    edu().from("adaptive_sessions").select("id", { count: "exact", head: true }).eq("student_id", userId).gte("updated_at", since)
      .then((r) => r.count ?? 0).catch(() => 0),
    db.from("battle_participants").select("correct_answers, joined_at, battles(total_questions)").eq("user_id", userId).gte("joined_at", since).limit(20)
      .then((r) => r.data ?? []).catch(() => []),
    recentRecords.length ? edu().from("material_ingests").select("record_ids, pages, structure").eq("user_id", userId).neq("state", "undone")
      .not("structure", "is", null).order("created_at", { ascending: false }).limit(30).then((r) => r.data ?? []).catch(() => []) : [],
  ]);
  const recordInfo = new Map();
  for (const ing of ingests) for (const it of ing.structure?.items || []) {
    if (it.recordId) recordInfo.set(it.recordId, { pages: it.pages || null, topics: (it.topics || []).map((t) => t.name).slice(0, 6) });
  }
  const best = battlesWeek.map((b) => ({ score: b.correct_answers ?? 0, total: b.battles?.total_questions ?? 0 })).filter((b) => b.total)
    .sort((a, b) => b.score / b.total - a.score / a.total)[0] || null;

  const nowMs = Date.now();
  const overdue = pendingTasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < nowMs);
  const day = 24 * 3600 * 1000;
  return {
    // → { timeZone, source }: the name only (a crash here stopped every planner run, gate d681c984).
    timeZone: quietOf(autonomyRow, resolveLearnerTimeZone({ configuredTimeZone: settingsRow?.settings?.timezone }).timeZone).timeZone,
    quiet: quietOf(autonomyRow, resolveLearnerTimeZone({ configuredTimeZone: settingsRow?.settings?.timezone }).timeZone),
    week: { tasksDone: recentDone, sessions: sessionsWeek, bestBattle: best },
    // What the planner was shown, numbered as it saw them — the validator holds it to these (readyKinds.js).
    refs: {
      records: recentRecords.map((r) => ({ id: r.id, name: String(r.name || "").slice(0, 80), ...(recordInfo.get(r.id) || {}) })),
      goals: goals.map((g) => ({ id: g.id, title: g.title, subject: g.category || null, exam: g.exam || null,
        days_left: g.target_date ? Math.ceil((new Date(g.target_date).getTime() - Date.now()) / 864e5) : null,
        days_since_update: g.updated_at ? Math.floor((Date.now() - new Date(g.updated_at).getTime()) / 864e5) : null })),
      weak: weakConcepts.map((c) => ({ concept: c.concept_catalog?.title || null, subject: c.concept_catalog?.subject || null, mastery: Math.round(Number(c.mastery || 0) * 100) })).filter((c) => c.concept),
    },
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
      overdueList: overdue.map((t) => ({ id: t.id, title: t.title, due_at: t.due_at })),
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
    `- kinds: task (a study task), practice (a short focused drill), session (a scheduled agent check-in), goal (a new education-related goal),\n` +
    `  quiz_from_records (a quiz from one of THEIR records: payload.record = its R number), teach_weak_topic (they teach their agent a weak concept: payload.topic = the concept exactly as listed),\n` +
    `  revision_battle (a 5-question Agent Check on a weak concept: payload.topic), study_plan (an exam-countdown plan: payload.goal = the G number of a goal with a date 1–16 weeks away),\n` +
    `  follow_up_question (pick up something they meant to come back to: from_note = an open_thread note, payload.message = the question to start with), goal_nudge (a concrete first step for a goal untouched a week or due within 3 weeks: payload.goal = its G number, payload.title the step)\n` +
    `- prefer a ready kind over a bare task when one fits: it arrives prepared\n` +
    `- a goal they keep mentioning (a learner_goal note not in their goals) → kind goal with from_note; at most one such a week\n` +
    `- every rationale must cite a real signal ("2 overdue tasks", "goal target in 9 days", "streak at 5 days", "scored 6/10 last battle", "mastery 30% on osmosis", "you meant to revise titration curves") — never generic\n` +
    `- use what their agent remembers: something they meant to come back to is a good session or practice; a goal they keep mentioning but never set is a good goal proposal; how they like to learn shapes the task (diagrams, short quizzes)\n` +
    `- weak concepts and review alerts are good practice proposals; a goal with days_left and no recent progress needs a concrete next step\n` +
    `- never repeat a pending proposal or something in their task list already\n` +
    `- sessions: payload.scheduledAt is ISO 8601 in the learner's time zone (${tz}) with its offset, never in their quiet hours (${signals.quiet?.start || "20:00"}–${signals.quiet?.end || "07:30"}), at most 14 days ahead\n` +
    `- task/practice payload: { title, description?, priority (high|medium|low), dueAt? ISO, course? }\n` +
    `- goal payload: { title, category?, target_date? YYYY-MM-DD } — education-related only\n` +
    `- never mention health, feelings, family or money, even if a note does\n` +
    `- the learner dismissed these tastes recently, respect them: ${JSON.stringify(signals.dismissalTaste || [])}\n` +
    `- prefer FEWER, better proposals; returning zero is correct when nothing would help\n` +
    `- ideas (a separate list, at most ${signals.ideaRoom ?? 3}): buildable briefs from their real context — "Turn your Biology notes into a quiz", "Teach your agent osmosis". ` +
    `Each: title, why (one line citing the signal), from (record|goal|weak|note) with ref = its number, brief = what they'd say to start it, in their voice ("Make me a 10-question quiz from my Cell transport notes"), icon. Never an idea that repeats a proposal.\n` +
    `JSON only: { "summary": "...", "proposals": [ { "kind": "...", "title": "...", "rationale": "...", "from_note": n|null, "payload": { ... } } ], "ideas": [ ... ] }` +
    UNTRUSTED_SYSTEM_RULE;
  const said = [
    signals.memories?.length ? `What their agent remembers (numbered — a proposal drawn from a note gives its number in from_note):\n${signals.memories.map((m, i) => `[${i + 1}] ${m.kind}: ${m.note}`).join("\n")}` : "",
    signals.chatSummaries?.length ? `Their recent conversations:\n${signals.chatSummaries.map((t) => `- ${t}`).join("\n")}` : "",
    signals.chatTopics?.length ? `Recent chat titles: ${signals.chatTopics.join(" · ")}` : "",
    signals.recentRecords?.length ? `Added to their library lately: ${signals.recentRecords.map((r) => `${r.name} (${r.progress}% read)`).join(" · ")}` : "",
  ].filter(Boolean).join("\n\n");
  const refs = signals.refs || {};
  const numbered = [
    refs.records?.length ? `Their records: ${refs.records.map((r, i) => `[R${i + 1}] ${r.name}${r.topics?.length ? ` (${r.topics.slice(0, 4).join(", ")})` : ""}`).join(" · ")}` : "",
    refs.goals?.length ? `Their goals: ${refs.goals.map((g, i) => `[G${i + 1}] ${g.title}${g.days_left != null ? `, ${g.days_left} days left` : ""}${g.days_since_update != null ? `, untouched ${g.days_since_update} days` : ""}`).join(" · ")}` : "",
  ].filter(Boolean).join("\n");
  const user =
    (numbered ? `${numbered}\n` : "") +
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
        type: "object", additionalProperties: false, required: ["summary", "proposals", "ideas"],
        properties: {
          summary: { type: "string" },
          proposals: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["kind", "title", "rationale", "from_note", "payload"],
              properties: {
                from_note: { type: ["integer", "null"], description: "The number of the remembered note this comes from, or null." },
                kind: { type: "string", enum: [...LEARNER_KINDS] },
                title: { type: "string" },
                rationale: { type: "string", description: "The real signal this comes from, in one sentence." },
                payload: {
                  type: "object", additionalProperties: false,
                  required: ["title", "description", "priority", "dueAt", "course", "scheduledAt", "message", "category", "target_date", "record", "goal", "topic", "subject"],
                  properties: {
                    title: N("string"), description: N("string"), priority: { type: ["string", "null"], enum: ["high", "medium", "low", null] },
                    dueAt: N("string"), course: N("string"), scheduledAt: N("string"), message: N("string"),
                    category: N("string"), target_date: N("string"),
                    record: N("integer"), goal: N("integer"), topic: N("string"), subject: N("string"),
                  },
                },
              },
            },
          },
          ideas: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["title", "why", "from", "ref", "brief", "icon"],
              properties: {
                title: { type: "string" }, why: { type: "string" },
                from: { type: "string", enum: ["record", "goal", "weak", "note"] }, ref: N("integer"),
                brief: { type: "string" }, icon: { type: "string", enum: ["quiz", "teach", "plan", "notes", "battle", "chat"] },
              },
            },
          },
        },
      },
    },
  };
}

/** ── 2. REASON — one structured call. The platform pays for background noticing (D46). */
export async function reasonAboutSignals(userId, signals, { watchOnly = false } = {}) {
  const res = await openai.chat.completions.create({
    model: OPENAI_MODEL, temperature: 0.4, max_tokens: 1200,
    response_format: planningSchema(),
    __payer: "platform", __feature: "agent_autonomy", __ref: userId,
    // Watch-only: the same call, logged under its own feature so it never counts against the learner's budget.
    ...(watchOnly ? { __feature: OBSERVE_FEATURE } : {}),
    messages: planningMessages(signals),
  });
  let parsed = { summary: "", proposals: [], ideas: [] };
  try { parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}"); } catch { /* stays empty */ }
  const u = res.usage || {};
  return { ...parsed, tokens: u.total_tokens ?? 0, costUsd: usdCost(res.model || OPENAI_MODEL, u.prompt_tokens ?? 0, u.completion_tokens ?? 0, 0) };
}

/** Clean-room validator: caps, dedupe (pending + 30-day history + tasks), shapes. */
const READY_SHAPED = new Set(["quiz_from_records", "teach_weak_topic", "study_plan", "revision_battle", "follow_up_question", "goal_nudge"]);

export async function validateAndShapeProposals(userId, rawProposals, { notes = [], refs = {}, quiet = null, impliedThisWeek = 0, modeOf = null } = {}) {
  if (!Array.isArray(rawProposals)) return [];
  const since = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const [history, openTasks, chatOpen] = await Promise.all([
    edu().from("agent_proposals").select("title, kind, payload").eq("user_id", userId)
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

  // A ready kind on the same thing (that record, that topic, that goal) isn't offered twice in 30 days.
  const thingKey = (kind, pl = {}) => `${kind}:${pl.recordId || pl.goalId || norm(pl.topic) || ""}`;
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const things = new Set(history.filter((h) => READY_SHAPED.has(h.kind)).map((h) => thingKey(h.kind, h.payload || {})));
  let implied = impliedThisWeek;
  const refsWithNotes = { ...refs, notes };

  const shaped = [];
  // Watch-only kinds (Phase 18 item 1) are shaped the same way but never take a live proposal's place.
  const observed = [];
  for (const p of rawProposals) {
    if (!p || !LEARNER_KINDS.includes(p.kind)) continue;
    const mode = modeOf ? modeOf(p.kind) : "live";
    if (mode === "off") continue;
    if (mode === "live" && shaped.length >= MAX_PROPOSALS_PER_CYCLE) continue;
    if (mode === "observe" && observed.length >= MAX_OBSERVATIONS_PER_RUN) continue;
    const title = String(p.title || "").trim();
    if (!title || title.length > 120) continue;
    // Every suggestion says what it noticed (§7.16.3): no reason, no proposal.
    if (String(p.rationale || "").trim().length < 12) continue;
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) continue;

    let payload = (p.payload && typeof p.payload === "object")
      ? Object.fromEntries(Object.entries(p.payload).filter(([, v]) => v !== null && v !== undefined && v !== ""))
      : {};
    let preview = null;
    let readyChat = null;
    if (READY_SHAPED.has(p.kind)) {
      // Held to what is really there; the preview is written from those facts (readyKinds.js).
      const ready = shapeReady(p, refsWithNotes);
      if (!ready) continue;
      if (things.has(thingKey(p.kind, ready.payload))) continue;
      things.add(thingKey(p.kind, ready.payload));
      payload = Object.fromEntries(Object.entries(ready.payload).filter(([, v]) => v !== null && v !== undefined));
      preview = ready.preview;
      readyChat = ready.sourceChatId || null;
    } else if (p.kind === "session") {
      const at = new Date(payload.scheduledAt || "");
      const nowMs = Date.now();
      if (!Number.isFinite(at.getTime()) || at.getTime() <= nowMs || at.getTime() > nowMs + 14 * 24 * 3600 * 1000) continue;
      payload.scheduledAt = quiet ? afterQuiet(at, quiet) : outsideQuietHours(at);
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
      // A goal they keep mentioning (from a learner_goal note): at most one a week (§7.16.5).
      const fromNote = Number.isInteger(p.from_note) ? notes[p.from_note - 1] : null;
      if (fromNote?.kind === "learner_goal") {
        if (implied >= 1) continue;
        implied += 1;
        payload.implied = true;
      }
    }
    if (!READY_SHAPED.has(p.kind) || p.kind === "goal_nudge") payload.title = String(payload.title || title).slice(0, 120);

    // The chat the noticed note came from (D49: the proposal is posted there).
    const note = Number.isInteger(p.from_note) ? notes[p.from_note - 1] : null;
    (mode === "observe" ? observed : shaped).push({
      kind: p.kind,
      title,
      rationale: String(p.rationale || "").slice(0, 280) || null,
      payload,
      ...(preview ? { preview } : {}),
      sourceChatId: readyChat || note?.chatId || null,
    });
    seen.add(key);
  }
  return modeOf ? [...shaped, ...observed] : shaped;
}

/** ── 4. The full cycle for one learner. Never throws — failures are recorded. */
export async function runAutonomyCycleForUser(userId, trigger = "nightly", { reason = reasonAboutSignals, force = false } = {}) {
  const startedAt = new Date();
  // Each kind's mode for this learner (Phase 18 item 1); unreadable → the code defaults (existing kinds live).
  const modeOf = await modesFor(userId).catch(() => null) || defaultModeFor;
  // A learner nothing can be shown to (every kind observe) sees no "reviewing" either.
  const watchOnlyLearner = observeOnly(modeOf);
  if (!watchOnlyLearner) reportAgentActivity(userId, "Reviewing your goals…");
  try {
    // Gate + pace: autonomy on, planner level, one run per ~20h, weekly cap.
    const { data: auto } = await edu().from("learner_agent_autonomy")
      .select("enabled, level, proactive, time_zone, last_cycle_at").eq("user_id", userId).maybeSingle();
    // Agent Online, and "Suggestions and ideas" not switched off (D47: on by default with Online).
    if (!auto?.enabled || auto.proactive === false) return { skipped: "not_enabled" };
    if (allOff(modeOf)) { clearAgentActivity(userId); return { skipped: "kinds_off" }; }
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
    // force: the Verification Gate's lever for a test learner (every other rule stays).
    if (!force && lastRun?.[0]?.started_at && Date.now() - new Date(lastRun[0].started_at).getTime() < minGapMs) {
      return { skipped: "recent_run" };
    }
    if (isEvent && !force) {
      const { count: todayEvents } = await edu().from("autonomy_runs")
        .select("id", { count: "exact", head: true })
        // Watch-only runs never count against the learner's caps.
        .eq("user_id", userId).like("trigger", "event:%").eq("observe_only", false)
        .gte("started_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
      if ((todayEvents ?? 0) >= MAX_EVENT_RUNS_PER_DAY) return { skipped: "event_cap" };
    }
    const weeklyCap = weeklyRunsCap();
    const { count: weekRuns } = await edu().from("autonomy_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("observe_only", false).gte("started_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
    if (!force && (weekRuns ?? 0) >= weeklyCap) return { skipped: "budget" };

    const { count: pendingCount } = await edu().from("agent_proposals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "proposed").gt("expires_at", new Date().toISOString());
    // A full inbox stops live proposals; a kind in observe still gets its look (its records are not the inbox).
    const inboxFull = (pendingCount ?? 0) >= MAX_PENDING_PROPOSALS;
    const anyObserve = LEARNER_PROACTIVE_KINDS.some((k) => modeOf(k) === "observe");
    if (inboxFull && !anyObserve) {
      await edu().from("learner_agent_autonomy").update({ last_cycle_at: startedAt.toISOString() }).eq("user_id", userId);
      return { skipped: "inbox_full", pending: pendingCount };
    }
    // Nothing from this run can reach the learner: watch-only (not their budget, not their caps).
    const watchOnly = watchOnlyLearner || inboxFull;

    // The weekly USD budget for background work (§7.16.7): 80% warns ops, 100% stops.
    const budget = await budgetState(userId, { timeZone: quietOf(auto).timeZone }).catch(() => null);
    if (budget?.warn) await noteBudget(userId, budget);
    if (budget?.stop) return { skipped: "budget_usd", budget };

    // Ideas (§7.16.4): stale ones expire; new ones only when 3 or fewer are live.
    await edu().from("agent_ideas").update({ status: "expired" }).eq("user_id", userId).eq("status", "live").lt("expires_at", new Date().toISOString());
    const { data: liveIdeas } = await edu().from("agent_ideas").select("title").eq("user_id", userId).eq("status", "live").limit(IDEAS.LIVE);
    const ideaRoom = (liveIdeas?.length ?? 0) <= IDEAS.REFRESH_AT ? IDEAS.LIVE - (liveIdeas?.length ?? 0) : 0;
    const { count: impliedThisWeek } = await edu().from("agent_proposals").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("kind", "goal").contains("payload", { implied: true })
      .gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString());

    // A fix-it at most once a week (dismissed or not): it's a nudge, not a nag.
    const { count: fixItThisWeek } = await edu().from("agent_proposals").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("kind", "fix_it").gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString());
    const ideaMode = modeOf("idea");
    const signals = { ...await gatherSignals(userId), ideaRoom: ideaMode === "off" ? 0 : ideaRoom };
    const reasoned = await reason(userId, signals, { watchOnly });
    const all = [
      ...await validateAndShapeProposals(userId, reasoned.proposals || [], { notes: signals.memories || [], refs: signals.refs, quiet: signals.quiet, impliedThisWeek: impliedThisWeek ?? 0, modeOf }),
      // Problems in their own things, found by code (fix_it) — after the planner's, within the same caps.
      ...(fixItThisWeek ? [] : fixIts(signals)),
    ];
    // Live → the inbox as before; observe → "would have proposed" records only; off → dropped.
    const byMode = splitByMode(all, modeOf);
    const shaped = byMode.live;
    const allIdeas = ideaRoom && ideaMode !== "off" ? shapeIdeas(reasoned.ideas || [], { ...signals.refs, notes: signals.memories || [] },
      { room: ideaRoom, seen: new Set([...(liveIdeas || []).map((i) => normalizeTitle(i.title)), ...all.map((p) => normalizeTitle(p.title))]) }) : [];
    const ideas = ideaMode === "live" ? allIdeas : [];
    const watched = [...byMode.observe, ...(ideaMode === "observe" ? allIdeas.map((i) => ({ ...i, kind: "idea" })) : [])];

    // Respect the pending cap across what we insert.
    const room = inboxFull ? 0 : Math.max(0, MAX_PENDING_PROPOSALS - (pendingCount ?? 0));
    const toInsert = shaped.slice(0, Math.min(room, MAX_PROPOSALS_PER_CYCLE)).map((p) => ({
      user_id: userId, kind: p.kind, title: p.title, rationale: p.rationale,
      payload: p.payload, source: trigger === "nightly" ? "cycle" : "event",
      ...(p.preview ? { preview: p.preview } : {}),
      ...(p.sourceChatId ? { source_chat_id: p.sourceChatId } : {}),
      // Asked or inferred (Phase 18 item 6): the agent's idea, allowed by its proactive kind.
      ...basisColumns({ basis: "inferred", rule: RULES.proactive(p.kind) }),
    }));

    let runId = null;
    const { data: run } = await edu().from("autonomy_runs").insert({
      user_id: userId, trigger,
      finished_at: new Date().toISOString(),
      proposals_created: toInsert.length,
      tokens_used: reasoned.tokens ?? 0,
      cost_usd: reasoned.costUsd ?? null,
      summary: String(reasoned.summary || "").slice(0, 500) || null,
      ...(watchOnly ? { observe_only: true } : {}),
      ...(watched.length ? { observed: Math.min(watched.length, MAX_OBSERVATIONS_PER_RUN) } : {}),
    }).select("id").single();
    runId = run?.id ?? null;
    // Watch-only kinds: "would have proposed X, because …" — never shown, never charged, never counted.
    const observed = watched.length ? await recordObservations(watched, { userId, runId }) : 0;
    if (toInsert.length) {
      await edu().from("agent_proposals").insert(toInsert.map((p) => ({ ...p, run_id: runId })));
    }
    if (ideas.length) {
      await edu().from("agent_ideas").insert(ideas.map((i) => ({ user_id: userId, run_id: runId, title: i.title, why: i.why, brief: i.brief, icon: i.icon, context: i.context })));
    }
    // Goal progress (§7.16.5): the week in numbers on each active goal — never its target or status.
    const line = progressLine(signals.week);
    // A watch-only run shows the learner nothing — not even a progress line.
    if (line && !watchOnly) {
      for (const g of signals.refs?.goals || []) {
        const was = (signals.goals || []).find((x) => x.title === g.title)?.progress_note;
        if (was !== line) await edu().from("learner_goals").update({ progress_note: line }).eq("id", g.id).eq("user_id", userId);
      }
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
        userId, type: "agent_proposals", link: appLink("tab=agent"),
        title: `${toInsert.length} suggestion${toInsert.length === 1 ? "" : "s"} from your agent`,
        content: reasoned.summary ? String(reasoned.summary).slice(0, 300) : "Your agent reviewed your goals overnight — take a look in Suggestions.",
      }).catch(() => { /* the inbox badge is the durable surface */ });
    } else {
      clearAgentActivity(userId);
    }
    return { ok: true, created: toInsert.length, ideas: ideas.length, observed, watchOnly, runId, tokens: reasoned.tokens ?? 0, costUsd: reasoned.costUsd ?? null };
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
