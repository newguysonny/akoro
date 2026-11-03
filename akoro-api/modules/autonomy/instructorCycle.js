/**
 * modules/autonomy/instructorCycle.js — the proactive engine over an
 * instructor's classes (Grand Plan §7.16.8 step 7): missing work, low scores,
 * the next activity. Facts only (instructorCore.js) — no model call, so
 * nothing to budget. Proposals land in their agent chat like a learner's
 * (deliver.js); approval drafts or reminds, and an activity is still only
 * ever assigned by the instructor tapping Assign.
 *
 *   runInstructorCycle(instructorId)  one pass → { created } | { skipped }
 *   instructorSweep({ limit })        the instructors due a pass (scheduler)
 */
import db from "../../db.js";
import { instructorProposals, INSTRUCTOR_LIMITS } from "./instructorCore.js";
import { deliverProactive } from "./deliver.js";
import { RULES, basisColumns } from "../agent-runtime/actionBasis.js";
import { modesFor, recordObservations } from "./kindModes.js";
import { defaultModeFor, INSTRUCTOR_PROACTIVE_KINDS, splitByMode } from "./kindModesCore.js";

const edu = () => db.schema("edu");
const DAY = 86_400_000;
export const INSTRUCTOR_CYCLE = Object.freeze({ PACE_HOURS: 20, LOOKBACK_DAYS: 21, DEDUPE_DAYS: 14, MAX_PENDING: 5 });

export async function runInstructorCycle(instructorId, { trigger = "instructor", force = false } = {}) {
  const { data: user } = await db.from("users").select("role").eq("id", instructorId).maybeSingle();
  if (user?.role !== "instructor") return { skipped: "not_instructor" };
  const { data: auto } = await edu().from("learner_agent_autonomy").select("proactive").eq("user_id", instructorId).maybeSingle();
  if (auto?.proactive === false) return { skipped: "not_enabled" };
  // Each kind's mode for this instructor (Phase 18 item 1): off dropped, observe recorded only.
  const modeOf = await modesFor(instructorId).catch(() => null) || defaultModeFor;
  if (INSTRUCTOR_PROACTIVE_KINDS.every((k) => modeOf(k) === "off")) return { skipped: "kinds_off" };
  if (!force) {
    const { data: last } = await edu().from("autonomy_runs").select("started_at").eq("user_id", instructorId).eq("trigger", "instructor")
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - new Date(last.started_at).getTime() < INSTRUCTOR_CYCLE.PACE_HOURS * 3_600_000) return { skipped: "recent_run" };
  }

  // Their own activities only (created_by), and only what was assigned and graded on them.
  const { data: acts } = await edu().from("self_study_assignments").select("id, title, subject, topic, classroom_id, due_at, created_at")
    .eq("created_by", instructorId).gte("created_at", new Date(Date.now() - INSTRUCTOR_CYCLE.LOOKBACK_DAYS * DAY).toISOString())
    .order("created_at", { ascending: false }).limit(12);
  const ids = (acts || []).map((a) => a.id);
  const { data: targets } = ids.length
    ? await edu().from("self_study_targets").select("assignment_id, student_id, status, grade").in("assignment_id", ids).limit(2000)
    : { data: [] };
  const activities = (acts || []).map((a) => ({ ...a, targets: (targets || []).filter((t) => t.assignment_id === a.id) }));

  const [{ data: recent }, { count: pending }] = await Promise.all([
    edu().from("agent_proposals").select("kind, payload").eq("user_id", instructorId)
      .gte("created_at", new Date(Date.now() - INSTRUCTOR_CYCLE.DEDUPE_DAYS * DAY).toISOString()).limit(100),
    edu().from("agent_proposals").select("id", { count: "exact", head: true }).eq("user_id", instructorId).eq("status", "proposed").gt("expires_at", new Date().toISOString()),
  ]);
  const seen = new Set((recent || []).map((r) => `${r.kind}:${r.payload?.assignmentId}`));
  const room = Math.max(0, INSTRUCTOR_CYCLE.MAX_PENDING - (pending ?? 0));
  const notSeen = (p) => !seen.has(`${p.kind}:${p.payload.assignmentId}`);
  // Every candidate is looked at; the per-run cap (and the pending room) apply to the live ones only —
  // with every kind live this is exactly the old rule (top 3, then dedupe, then room).
  const byMode = splitByMode(instructorProposals(activities, { limit: 30 }), modeOf);
  const fresh = byMode.live.slice(0, INSTRUCTOR_LIMITS.PER_RUN).filter(notSeen).slice(0, room);
  // Watch-only: never in their inbox or chat, never counted against the pending cap.
  const watched = byMode.observe.filter(notSeen);

  const { data: run } = await edu().from("autonomy_runs").insert({
    user_id: instructorId, trigger, finished_at: new Date().toISOString(), proposals_created: fresh.length, tokens_used: 0, cost_usd: 0,
    summary: fresh.length ? fresh.map((p) => p.title).join(" · ").slice(0, 500) : "nothing to raise",
    ...(watched.length ? { observed: watched.length } : {}),
    ...(watched.length && !fresh.length ? { observe_only: true } : {}),
  }).select("id").single();
  const observed = watched.length ? await recordObservations(watched, { userId: instructorId, runId: run?.id ?? null, audience: "instructor" }) : 0;
  if (fresh.length) {
    await edu().from("agent_proposals").insert(fresh.map((p) => ({
      user_id: instructorId, kind: p.kind, title: p.title, rationale: p.rationale, payload: p.payload, preview: p.preview,
      source: "cycle", run_id: run?.id ?? null,
      // Asked or inferred (Phase 18 item 6): the agent's idea, allowed by its proactive kind.
      ...basisColumns({ basis: "inferred", rule: RULES.proactive(p.kind) }),
    })));
    await deliverProactive(instructorId).catch(() => null);
  }
  return { ok: true, created: fresh.length, observed, runId: run?.id ?? null };
}

/** Instructors with activities in the lookback window and no pass in the last ~20h. */
export async function instructorSweep({ limit = 5 } = {}) {
  const since = new Date(Date.now() - INSTRUCTOR_CYCLE.LOOKBACK_DAYS * DAY).toISOString();
  const { data } = await edu().from("self_study_assignments").select("created_by").gte("created_at", since).not("created_by", "is", null).limit(500);
  const ids = [...new Set((data || []).map((r) => r.created_by))];
  let ran = 0;
  for (const id of ids) {
    if (ran >= limit) break;
    const r = await runInstructorCycle(id).catch((e) => ({ skipped: `error: ${e.message}` }));
    if (!r.skipped) ran += 1;
  }
  return { checked: ids.length, ran };
}
