/**
 * adaptive-learning/strategies/executors.js — Phase 4a: the Study Prep
 * harness runs the strategies that are not a Teaching session (§7.7.2:
 * "chunk_plan, schedule_plan, offline_pack, prerequisite_review, interleave
 * are executed by the Study Prep harness (replan / schedule / export)").
 *
 *   HARNESS_EXECUTORS            strategy id → executor (the ones that exist)
 *   runStrategyOffer({...})      the ONE entry the Study Prep harness calls from
 *                                offer_strategy: library + limit checks, ranked
 *                                candidates, and — once the learner accepts — the
 *                                executor plus a pending outcome the next
 *                                attempt judges (outcomes.settlePendingStrategyOutcomes)
 *   planReorder / positionMoves / chunkParts / buildOfflinePack   PURE
 *
 * Executors:
 *   replan          interleave (a related topic next), prerequisite_review (the
 *                   active topic's prerequisites first), chunk_plan (the rest of
 *                   the plan in parts of two, each later part on its own day).
 *                   Only QUEUED topics move, through the store's conditional
 *                   writes; an order that would break a prerequisite edge is
 *                   refused, never written.
 *   schedule        space_out (one later pass, two days on), schedule_plan (a
 *                   daily check-in until the exam, default 14 days) — the
 *                   learner's own chat follow-ups.
 *   offline_export  offline_pack — a Markdown summary + self-test from the
 *                   topic's last check, saved to the learner's Records with a
 *                   download link.
 * Strategies whose runner does not exist yet (escalate_human, peer_help,
 * goal_clarify) are offered and accepted as before, with execution
 * `no_executor`; Teaching strategies report `runs_in_teaching`.
 *
 * Dependencies are injected (`deps`) so the harness contract tests run with
 * no database; the real ones load lazily.
 */
import { getStrategy, strategyRefusal } from "./library.js";

const DAY_MIN = 24 * 60;
const slug = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
const keyOf = (t) => t?.syllabus_topic_id || slug(t?.label);

/** PURE: the prerequisite edges this order (topic keys) breaks. */
export function orderViolations(order, edges = []) {
  const at = new Map(order.map((k, i) => [k, i]));
  return (edges || []).filter((e) => at.has(e.before) && at.has(e.after) && at.get(e.before) > at.get(e.after));
}

/** PURE: an edge the NEW order breaks that the old one kept → the edge, or null. */
export function orderViolation(order, edges = [], previous = null) {
  const before = new Set(previous ? orderViolations(previous, edges) : []);
  return orderViolations(order, edges).find((e) => !before.has(e)) || null;
}

/**
 * PURE: the new order of the QUEUED topics for a replan strategy.
 * → { order: [topicId], moved: [label], missing: [label], reason? }
 */
export function planReorder({ strategy, topics = [], edges = [] }) {
  const sorted = [...topics].sort((a, b) => Number(a.position) - Number(b.position));
  const active = sorted.find((t) => t.status === "active");
  const queued = sorted.filter((t) => t.status === "queued");
  if (!active) return { order: queued.map((t) => t.id), moved: [], missing: [], reason: "no_active_topic" };
  const ak = keyOf(active);
  let front = [];
  let missing = [];
  if (strategy === "prerequisite_review") {
    const pre = edges.filter((e) => e.after === ak);
    front = queued.filter((t) => pre.some((e) => e.before === keyOf(t)));
    const inPlan = new Set(sorted.map(keyOf));
    missing = pre.filter((e) => !inPlan.has(e.before)).map((e) => e.beforeLabel || e.before);
  } else if (strategy === "interleave") {
    const near = new Set(edges.flatMap((e) => (e.after === ak ? [e.before] : e.before === ak ? [e.after] : [])));
    front = queued.filter((t) => near.has(keyOf(t))).slice(0, 1);
    if (!front.length && queued.length) front = [queued[0]];
  }
  const order = [...front, ...queued.filter((t) => !front.includes(t))];
  const settled = sorted.filter((t) => t.status !== "queued");
  // The active topic cannot go back in the queue, so a prerequisite after it is already out of
  // order; a replan may fix such an edge, never break one the plan kept.
  const violation = orderViolation([...settled, ...order].map(keyOf), edges, [...settled, ...queued].map(keyOf));
  if (violation) return { order: queued.map((t) => t.id), moved: [], missing, reason: "prerequisite_violation" };
  const moved = order.filter((t, i) => queued[i] !== t).map((t) => t.label);
  return { order: order.map((t) => t.id), moved, missing, ...(front.length ? {} : { reason: strategy === "prerequisite_review" && missing.length ? "prerequisite_not_in_plan" : "nothing_to_move" }) };
}

/**
 * PURE: the conditional position writes that put `order` (topic ids) into the
 * positions the queued topics hold now, without ever breaking
 * UNIQUE (session_id, position) — one free slot in 1..max carries each cycle.
 * → [{ id, position }] in write order, or null when no slot is free.
 */
export function positionMoves({ topics = [], order = [], max = 12 }) {
  const byId = new Map(topics.map((t) => [t.id, Number(t.position)]));
  const slots = order.map((id) => byId.get(id)).sort((a, b) => a - b);
  const target = new Map(order.map((id, i) => [id, slots[i]]));
  const at = new Map(topics.map((t) => [Number(t.position), t.id]));
  const moves = [];
  const todo = order.filter((id) => target.get(id) !== byId.get(id));
  if (!todo.length) return [];
  let free = null;
  for (let p = 1; p <= max; p++) if (!at.has(p)) { free = p; break; }
  if (free == null) return null;
  const done = new Set();
  for (const start of todo) {
    if (done.has(start)) continue;
    // Park the cycle's first topic, slide the rest into place, land the first.
    const startPos = byId.get(start);
    moves.push({ id: start, position: free });
    let hole = startPos;
    for (;;) {
      const next = [...target].find(([id, pos]) => pos === hole && !done.has(id) && id !== start)?.[0];
      // `next` must move INTO the hole, i.e. it is the topic whose target is `hole`.
      if (!next) break;
      moves.push({ id: next, position: hole });
      done.add(next);
      hole = byId.get(next);
    }
    moves.push({ id: start, position: target.get(start) });
    done.add(start);
  }
  return moves;
}

/** PURE: the queued topics in parts of `size` (the first part starts now). */
export function chunkParts(topics = [], size = 2) {
  const queued = [...topics].filter((t) => t.status === "queued").sort((a, b) => Number(a.position) - Number(b.position));
  const parts = [];
  for (let i = 0; i < queued.length; i += size) parts.push(queued.slice(i, i + size).map((t) => t.label));
  return parts;
}

/** PURE: the offline pack's Markdown. */
export function buildOfflinePack({ subject = null, goal = null, topic, gaps = [], notes = [], generatedAt = new Date().toISOString() }) {
  const lines = [`# ${topic}${subject ? ` — ${subject}` : ""}`, "", `_Offline study pack · ${String(generatedAt).slice(0, 10)}_`, ""];
  if (goal) lines.push(`**Goal:** ${goal}`, "");
  lines.push("## What to focus on", "");
  if (gaps.length) for (const g of gaps.slice(0, 8)) lines.push(`- ${g}`);
  else lines.push(`- The key ideas of ${topic}.`);
  if (notes.length) {
    lines.push("", "## What you have shown so far", "");
    for (const n of notes.slice(0, 8)) lines.push(`- ${n}`);
  }
  lines.push("", "## Test yourself (no notes)", "");
  const prompts = gaps.length ? gaps.slice(0, 6).map((g) => `Explain in your own words: ${g}`) : [`Explain ${topic} to a friend in three sentences.`, `Give one real-life example of ${topic}.`];
  prompts.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  lines.push("", "When you are back online, teach your agent what you revised, then take the Agent Check.", "");
  return lines.join("\n");
}

// ── executors ────────────────────────────────────────────────────────────

async function replan({ strategy, session, topics, deps }) {
  if (strategy === "chunk_plan") {
    const parts = chunkParts(topics);
    if (parts.length < 2) return { executed: false, reason: "plan_already_small", effect: { parts } };
    const scheduled = [];
    for (let i = 1; i < parts.length && i <= 3; i++) {
      const s = await deps.scheduleFollowUp({ title: `Study plan — part ${i + 1}`, message: `Part ${i + 1} of your ${session.subject || ""} plan: ${parts[i].join(", ")}. Open your study session when you are ready.`.replace(/\s+/g, " "), inMinutes: i * DAY_MIN });
      if (s?.followUpId) scheduled.push({ part: i + 1, followUpId: s.followUpId, scheduledAt: s.scheduledAt });
    }
    return { executed: true, effect: { parts, scheduled } };
  }
  const edges = await deps.prerequisites({ subject: session.subject }).catch(() => []);
  const plan = planReorder({ strategy, topics, edges });
  if (plan.reason && !plan.moved.length) return { executed: false, reason: plan.reason, effect: { missingPrerequisites: plan.missing } };
  const moves = positionMoves({ topics, order: plan.order });
  if (moves == null) return { executed: false, reason: "no_free_position", effect: { moved: plan.moved } };
  for (const m of moves) {
    const row = await deps.store.updateTopicConditional(m.id, "queued", { position: m.position, updated_at: deps.now() });
    if (!row) return { executed: false, reason: "topic_moved_on", effect: { moved: [] } };
  }
  return { executed: true, effect: { moved: plan.moved, missingPrerequisites: plan.missing } };
}

async function schedule({ strategy, session, topic, deps }) {
  const label = topic?.label || session.goal || "your topic";
  const input = strategy === "schedule_plan"
    ? { title: "Study plan check-in", message: `Today's study: ${label}. A short session now keeps you on track for your exam.`, inMinutes: DAY_MIN, repeat: "daily", repeatDays: 14 }
    : { title: "Time for another pass", message: `Two days on — a good time for another pass at ${label}.`, inMinutes: 2 * DAY_MIN };
  const s = await deps.scheduleFollowUp(input);
  return s?.followUpId ? { executed: true, effect: { followUpId: s.followUpId, scheduledAt: s.scheduledAt, repeat: s.repeat || null } } : { executed: false, reason: "not_scheduled" };
}

async function offlineExport({ session, topic, learnerId, deps }) {
  if (!topic) return { executed: false, reason: "no_topic" };
  const notes = await deps.evidenceNotes({ learnerId, subject: session.subject, topic: topic.label }).catch(() => []);
  const markdown = buildOfflinePack({ subject: session.subject, goal: session.goal, topic: topic.label, gaps: topic.check_result?.gaps || [], notes, generatedAt: deps.now() });
  const saved = await deps.saveFile({ name: `study-packs/${slug(topic.label) || "topic"}.md`, body: markdown, contentType: "text/markdown; charset=utf-8" });
  return { executed: true, effect: { fileKey: saved.fileKey, downloadUrl: saved.downloadUrl || null, bytes: Buffer.byteLength(markdown, "utf8") } };
}

/** strategy id → executor. Only the ones that exist; the library names the operation. */
export const HARNESS_EXECUTORS = Object.freeze({
  interleave: replan, prerequisite_review: replan, chunk_plan: replan,
  space_out: schedule, schedule_plan: schedule,
  offline_pack: offlineExport,
});

/** The real dependencies (lazy: no database is touched until a strategy runs). */
export function defaultExecutorDeps({ learnerId, store, now = () => new Date().toISOString() }) {
  return {
    store, now,
    prerequisites: async ({ subject }) => (await import("../study-prep/syllabus-resolver.js")).prerequisiteEdges({ subject }),
    scheduleFollowUp: async (input) => (await import("../chat-follow-ups.js")).scheduleChatFollowUp({ userId: learnerId, input }),
    evidenceNotes: async ({ subject, topic }) => {
      const { resolveConceptId } = await import("../learning-events.js");
      const concept = await resolveConceptId({ subject, topic });
      if (!concept) return [];
      const { default: db } = await import("../../../db.js");
      const { data } = await db.schema("edu").from("learner_concept_evidence").select("evidence_summary")
        .eq("learner_id", learnerId).eq("concept_id", concept).order("created_at", { ascending: false }).limit(6);
      return (data || []).map((r) => String(r.evidence_summary || "").slice(0, 200)).filter(Boolean);
    },
    saveFile: async ({ name, body, contentType }) => {
      const { putRecordObject, createPresignedDownload } = await import("../../records/lib/storage.js");
      const fileKey = await putRecordObject({ userId: learnerId, name, body: Buffer.from(body, "utf8"), contentType });
      const downloadUrl = await createPresignedDownload(fileKey, { downloadName: name.split("/").pop() }).catch(() => null);
      return { fileKey, downloadUrl: typeof downloadUrl === "string" ? downloadUrl : downloadUrl?.url || null };
    },
    checkLimit: async (args) => (await import("./recommend.js")).checkStrategyLimit(args),
    recommend: async (args) => (await import("./recommend.js")).recommendStrategies(args),
    recordOutcome: async (args) => (await import("./outcomes.js")).recordStrategyOutcome(args),
  };
}

/** Run one strategy's executor. → { executed, operation, reason?, effect? }. Never throws. */
export async function executeHarnessStrategy({ strategy, learnerId, session, topic, topics, deps }) {
  const s = getStrategy(strategy);
  if (!s) return { executed: false, operation: null, reason: "unknown_strategy" };
  if (s.runsAs.executor !== "harness") return { executed: false, operation: "teach", reason: "runs_in_teaching" };
  const run = HARNESS_EXECUTORS[s.id];
  if (!run) return { executed: false, operation: s.runsAs.operation, reason: "no_executor" };
  try {
    return { operation: s.runsAs.operation, ...(await run({ strategy: s.id, learnerId, session, topic, topics, deps })) };
  } catch (e) {
    console.warn(`[strategies/executors] ${s.id}:`, e?.message || e);
    return { executed: false, operation: s.runsAs.operation, reason: "executor_failed" };
  }
}

/**
 * The Study Prep harness's one call (offer_strategy). Offering: the library
 * check, the per-topic limit, the ranked candidates. Accepting (the learner
 * said yes): the executor runs and a pending outcome is recorded, judged by
 * the next attempt on the topic.
 * → { refusal?, message?, recommended, accepted, execution?, outcomeId? }
 */
export async function runStrategyOffer({ strategy, accepted = false, learnerId, session, topic = null, topics = [], deps }) {
  const id = getStrategy(strategy)?.id || strategy;
  const refusal = strategyRefusal(id, "study_prep");
  if (refusal) return { refusal, message: `“${strategy}” is not allowed in Study Prep` };
  const where = { learnerId, subject: session?.subject || null, topic: topic?.label || null };
  const limit = await deps.checkLimit({ ...where, strategyId: id }).catch(() => ({ refusal: null }));
  if (limit?.refusal) return { refusal: limit.refusal, message: `“${strategy}” was already used ${limit.usesOnTopic} time(s) on this topic (limit ${limit.limit})`, usesOnTopic: limit.usesOnTopic, limit: limit.limit };
  const rec = await deps.recommend({ ...where, workflow: "study_prep" }).catch(() => null);
  const recommended = (rec?.ranked || []).slice(0, 5).map((r) => ({ id: r.id, reasons: r.reasons }));
  if (!accepted) return { accepted: false, recommended, usesOnTopic: limit?.usesOnTopic ?? null, limit: limit?.limit ?? null };
  const execution = await executeHarnessStrategy({ strategy: id, learnerId, session, topic, topics, deps });
  const at = String(deps.now ? deps.now() : new Date().toISOString());
  const outcome = await deps.recordOutcome({
    learnerId, strategyId: id, outcome: "abandoned", workflow: "study_prep",
    sessionRef: `study_prep:${session.id}`, turnRef: `accept:${topic?.id || "session"}:${at}`,
    subject: session?.subject || null, topic: topic?.label || null,
    struggleType: rec?.struggleTypes?.find((t) => getStrategy(id).targets.includes(t)) || null,
    scoreBefore: topic?.check_result?.score ?? null,
    details: { pending: true, use: `study_prep:${session.id}#${at}`, operation: execution.operation, executed: !!execution.executed, reason: execution.reason || null },
  }).catch(() => null);
  return { accepted: true, recommended, execution, outcomeId: outcome?.id || null };
}
