/**
 * modules/self-study/routines.js — recurring, human-approved preparation.
 *
 * "Every Friday, prep a multiplication drill battle for JSS 2" becomes a
 * routine. The scheduler (in-process, catch-up safe) PREPARES a draft at the
 * scheduled slot — the same private draft flow as chat: the instructor is
 * nudged by bell, previews, and assigns each occurrence by hand. Preparation
 * is automation; assignment stays human. A routine has no path to learners.
 *
 * Multi-instance safety: `last_run_at` is claimed before preparing (an
 * UPDATE … WHERE last_run_at = seen), so two API instances can never
 * double-prepare the same occurrence.
 */

import db from "../../db.js";
import { createActivityDraft, DRAFT_TYPES, instructorClassrooms } from "./drafts.js";

// `invalid` (an Error carrying an HTTP status) is createAssignment.js's —
// drafts.js imports it from there too.
import { invalid } from "./createAssignment.js";

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const dayIndex = (name) => DAY_NAMES.indexOf(String(name || "").toLowerCase());

/** The instructor's routines, most recently created first. */
export async function listRoutines(instructor) {
  const { data } = await db.from("draft_routines")
    .select("*").eq("created_by", instructor.id)
    .order("created_at", { ascending: false }).limit(50);
  return data ?? [];
}

/**
 * createRoutine — validate once at creation so a typo doesn't surface as a
 * silent non-event every Friday: type must be draftable, the brief must
 * carry a topic and an audience (the no-guess rule applies to routines too —
 * the agent asks the instructor first, never guesses an audience).
 */
export async function createRoutine(instructor, input) {
  const brief = input?.brief && typeof input.brief === "object" ? input.brief : {};
  const type = brief.type;
  if (!DRAFT_TYPES.includes(type)) throw invalid(`Unknown activity type: ${type}. Valid: ${DRAFT_TYPES.join(", ")}`);
  if (!String(brief.topic || "").trim()) throw invalid("The routine needs a topic to prepare from");

  const a = brief.audience && typeof brief.audience === "object" ? brief.audience : {};
  const hasAudience = a.whole_class === true || a.everyone === true
    || (Array.isArray(a.usernames) && a.usernames.length)
    || (Array.isArray(a.user_ids) && a.user_ids.length)
    || a.classroom_id || a.classroom_name || a.class_name;
  if (!hasAudience) throw invalid("audience_required");
  // A routine whose "entire class" can never resolve would silently fail at
  // every run — reject it now, while the instructor is still in the chat.
  if ((a.whole_class === true || a.everyone === true) && !a.classroom_id) {
    const rooms = await instructorClassrooms(instructor.id);
    if (!rooms.length) throw invalid("You don't have a class yet — create one in Classes first");
    if (rooms.length > 1) throw invalid(`Which class? You have: ${rooms.map(r => r.name).join(", ")}`, "clarify");
    a.classroom_id = rooms[0].id;
    a.classroom_name = rooms[0].name;
  }

  const dow = dayIndex(input?.day);
  if (dow < 0) throw invalid(`day must be one of: ${DAY_NAMES.join(", ")}`);
  const hour = Number.isFinite(Number(input?.hour)) ? Math.min(23, Math.max(0, Math.trunc(Number(input.hour)))) : 7;

  const { data, error } = await db.from("draft_routines").insert({
    created_by: instructor.id,
    title: String(input?.title || "").trim() || `${brief.topic} — ${DAY_NAMES[dow]}`,
    brief: { ...brief, audience: { ...a } },
    schedule: "weekly",
    day_of_week: dow,
    hour,
    status: "active",
  }).select().single();
  if (error) throw invalid(error.message, 500);
  return data;
}

/** Pause / resume — the only human edit a routine needs. */
export async function updateRoutine(instructor, id, patch) {
  const routine = await ownedRoutine(instructor, id);
  if (patch?.status && ["active", "paused"].includes(patch.status)) {
    const { data, error } = await db.from("draft_routines")
      .update({ status: patch.status, updated_at: new Date().toISOString() })
      .eq("id", routine.id).select().single();
    if (error) throw invalid(error.message, 500);
    return data;
  }
  return routine;
}

export async function deleteRoutine(instructor, id) {
  const routine = await ownedRoutine(instructor, id);
  const { error } = await db.from("draft_routines").delete().eq("id", routine.id);
  if (error) throw invalid(error.message, 500);
  return { deleted: true, id: routine.id };
}

async function ownedRoutine(instructor, id) {
  const { data } = await db.from("draft_routines").select("*").eq("id", id).maybeSingle();
  if (!data) throw invalid("Routine not found", 404);
  if (data.created_by !== instructor.id && instructor.role !== "admin") throw invalid("Not your routine", 403);
  return data;
}

/**
 * nextRunAt — the next UTC occurrence of (day_of_week, hour) strictly after
 * `after`. The instructor's wall clock is their business; the slot is UTC and
 * the default hour (07:00 UTC) lands mid-morning in Lagos.
 */
export function nextRunAt(dayOfWeek, hour, after) {
  const t = new Date(after.getTime());
  t.setUTCHours(hour, 0, 0, 0);
  let delta = (dayOfWeek - t.getUTCDay() + 7) % 7;
  if (delta === 0 && t.getTime() <= after.getTime()) delta = 7;
  return new Date(t.getTime() + delta * 24 * 60 * 60 * 1000);
}

/** Is this routine due for a run, and when was its slot? */
function dueSlot(routine, now) {
  if (routine.status !== "active") return null;
  const after = new Date(routine.last_run_at ?? routine.created_at);
  const slot = nextRunAt(routine.day_of_week, routine.hour, after);
  return slot.getTime() <= now.getTime() ? slot : null;
}

/**
 * runDueRoutines — prepare one draft per due routine. Claim-first per row;
 * preparation failures are logged and swallowed (a failed routine must not
 * crash the scheduler or hot-retry), the claim stands so the next occurrence
 * is a week away — the instructor can also prepare manually anytime.
 */
export async function runDueRoutines(now = new Date()) {
  const { data: actives } = await db.from("draft_routines")
    .select("*").eq("status", "active").limit(200);
  const results = [];
  for (const routine of (actives ?? [])) {
    const slot = dueSlot(routine, now);
    if (!slot) continue;

    // Claim the occurrence before doing anything (multi-instance safe).
    const claimQuery = db.from("draft_routines")
      .update({ last_run_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", routine.id);
    const { data: claimed } = routine.last_run_at == null
      ? await claimQuery.is("last_run_at", null).select()
      : await claimQuery.eq("last_run_at", routine.last_run_at).select();
    if (!claimed?.length) continue;   // another runner took it

    try {
      const { draft } = await createActivityDraft({
        instructor: { id: routine.created_by, role: "instructor" },
        input: { ...(routine.brief || {}) },
        channel: "task_run",
      });
      await db.from("draft_routines")
        .update({ last_draft_id: draft.id, updated_at: new Date().toISOString() })
        .eq("id", routine.id);
      results.push({ routineId: routine.id, draftId: draft.id, title: draft.title });
    } catch (e) {
      console.error("[routines] prepare failed:", routine.id, e.message);
      results.push({ routineId: routine.id, error: e.message });
    }
  }
  return results;
}

let schedulerStarted = false;
/** In-process scheduler: a catch-up pass shortly after boot, then every 10 min. */
export function startRoutineScheduler() {
  if (schedulerStarted) return;
  if (String(process.env.AKORO_ROUTINES_ENABLED || "").toLowerCase() === "false") return;
  schedulerStarted = true;
  setTimeout(() => { runDueRoutines().catch((e) => console.error("[routines] catch-up failed:", e.message)); }, 15_000);
  setInterval(() => { runDueRoutines().catch((e) => console.error("[routines] tick failed:", e.message)); }, 10 * 60 * 1000).unref?.();
}
