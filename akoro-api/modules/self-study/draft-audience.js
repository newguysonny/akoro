/**
 * modules/self-study/draft-audience.js — who a draft is for. Resolves the
 * model's audience input into targets, asking for clarification rather than
 * guessing when it cannot say who the work is for.
 */

import db from "../../db.js";
import { invalid, resolveStudents } from "./createAssignment.js";
import { classroomName, instructorClassrooms, resolveClassroomByName } from "./draft-store.js";

/**
 * Normalise the agent's audience input into { body, label }.
 * Throws `invalid("audience_required", "clarify")` when nothing usable was
 * given — the tool turns that into an observation the model must act on by
 * asking the instructor, never by guessing.
 */
export async function resolveAudience(instructor, audience) {
  const a = audience && typeof audience === "object" ? audience : {};
  const usernames = (Array.isArray(a.usernames) ? a.usernames : []).map(u => String(u).trim()).filter(Boolean);
  const user_ids  = (Array.isArray(a.user_ids)  ? a.user_ids  : []).filter(Boolean);
  const whole_class = a.whole_class === true || a.everyone === true;
  let classroom_id = a.classroom_id || null;

  if (!whole_class && !usernames.length && !user_ids.length && !classroom_id) {
    if (a.classroom_name || a.class_name || a.text) {
      const room = await resolveClassroomByName(instructor.id, a.classroom_name || a.class_name || a.text);
      if (room) { classroom_id = room.id; a.classroom_name = room.name; }
    }
  }
  if (!whole_class && !usernames.length && !user_ids.length && !classroom_id) {
    throw invalid("audience_required", "clarify");
  }

  // "The entire class" without a class id: resolve it for real instead of
  // silently targeting nobody. One class → use it; several → ask which;
  // none → say plainly that a class must be created first.
  if (whole_class && !classroom_id) {
    if (!classroom_id && (a.classroom_name || a.class_name || a.text)) {
      const room = await resolveClassroomByName(instructor.id, a.classroom_name || a.class_name || a.text);
      if (room) { classroom_id = room.id; a.classroom_name = room.name; }
    }
    if (!classroom_id) {
      const rooms = await instructorClassrooms(instructor.id);
      if (rooms.length === 1) { classroom_id = rooms[0].id; a.classroom_name = rooms[0].name; }
      else if (rooms.length > 1) {
        throw invalid(`Which class? You have: ${rooms.map(r => r.name).join(", ")}`, "clarify");
      } else {
        throw invalid("You don't have a class yet — create one in Classes first, then I can prepare work for it");
      }
    }
  }

  // Resolve now so the preview shows the real count before anyone assigns.
  const { ids, notFound } = await resolveStudents({ usernames, user_ids, classroom_id, whole_class });

  // A few real names make the preview reviewable at a glance ("@amina, @musa
  // +3 more") — picked audiences only; whole-class shows the count.
  let names;
  if (!whole_class && ids.length) {
    try {
      const { data: people } = await db.from("users")
        .select("username").in("id", ids.slice(0, 8));
      names = (people ?? []).map(u => u.username).filter(Boolean);
    } catch { /* names are cosmetic — never block a draft on them */ }
  }

  const bits = [];
  if (whole_class) bits.push(a.classroom_name || "the whole class");
  if (usernames.length) bits.push(usernames.map(u => `@${String(u).replace(/^@/, "")}`).join(", "));
  if (user_ids.length && !usernames.length) bits.push(`${user_ids.length} learner${user_ids.length === 1 ? "" : "s"} by id`);
  return {
    body: { usernames, user_ids, whole_class, classroom_id: whole_class ? classroom_id : (classroom_id ?? null) },
    className: a.classroom_name || (classroom_id ? await classroomName(classroom_id) : null),
    label: bits.join(" + ") || `${ids.length} learner${ids.length === 1 ? "" : "s"}`,
    resolvedCount: ids.length,
    names,
    notFound,
  };
}
