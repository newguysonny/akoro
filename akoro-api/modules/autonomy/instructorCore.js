/**
 * modules/autonomy/instructorCore.js — the proactive engine over an
 * instructor's own classes (Grand Plan §7.16.3, step 7). Pure: no db, no
 * model — every proposal is a fact about their activities. It never reads a
 * learner's chats or memories; only the activity, who was assigned it, who
 * started or finished, and the grades the instructor gave.
 *
 *   instructorProposals(activities, { now })
 *     activities: [{ id, title, subject, topic, classroom_id, due_at, created_at,
 *                    targets: [{ student_id, status, grade }] }]
 *   → [{ kind, title, rationale, payload, preview }]   at most 3, most urgent first
 */
export const INSTRUCTOR_LIMITS = Object.freeze({ PER_RUN: 3, LOW_AVG: 55, MIN_GRADED: 3, STALE_DAYS: 3, NEXT_DONE: 0.8, NEXT_GAP_DAYS: 5 });

const DAY = 86_400_000;
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const when = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" });

export function instructorProposals(activities = [], { now = new Date(), limit = INSTRUCTOR_LIMITS.PER_RUN } = {}) {
  const out = [];
  const t = now.getTime();
  for (const a of activities) {
    const targets = a.targets || [];
    if (!targets.length) continue;
    const title = clip(a.title || a.topic, 80);
    const age = (t - new Date(a.created_at).getTime()) / DAY;
    const due = a.due_at ? new Date(a.due_at).getTime() : null;

    // Missing work: still not started, with the due date near or past (or 3+ days out).
    const missing = targets.filter((x) => x.status === "assigned");
    const dueNear = due != null && due - t < 2 * DAY && t - due < 3 * DAY;
    if (missing.length && missing.length / targets.length >= 0.2 && (dueNear || (due == null && age >= INSTRUCTOR_LIMITS.STALE_DAYS))) {
      out.push({ urgency: dueNear ? 3 : 1, kind: "chase_missing",
        title: `Remind ${missing.length} learner${missing.length === 1 ? "" : "s"} to start "${title}"`,
        rationale: `${missing.length} of ${targets.length} haven't started "${title}"${due != null ? ` — it's due ${when(a.due_at)}` : ` (set ${Math.floor(age)} days ago)`}.`,
        payload: { assignmentId: a.id, studentIds: missing.map((x) => x.student_id).slice(0, 60) },
        preview: { kind: "reminder", activity: title, missing: missing.length, total: targets.length, due: a.due_at || null } });
    }

    // Low scores: enough graded, and the average under the line → a revision activity drafted.
    const graded = targets.filter((x) => Number.isFinite(Number(x.grade)) && x.grade !== null);
    if (graded.length >= INSTRUCTOR_LIMITS.MIN_GRADED) {
      const avg = Math.round(graded.reduce((s, x) => s + Number(x.grade), 0) / graded.length);
      if (avg < INSTRUCTOR_LIMITS.LOW_AVG) {
        out.push({ urgency: 2, kind: "revise_low_scores",
          title: `A revision activity on ${clip(a.topic || title, 60)}`,
          rationale: `The average on "${title}" is ${avg}% across ${graded.length} graded.`,
          payload: { assignmentId: a.id, subject: a.subject || null, topic: a.topic || title, classroomId: a.classroom_id || null, studentIds: targets.map((x) => x.student_id).slice(0, 60) },
          preview: { kind: "revision", activity: title, avg, graded: graded.length, below: graded.filter((x) => Number(x.grade) < 50).length } });
      }
    }

    // Done and nothing new set: the next activity, drafted for them to check.
    const done = targets.filter((x) => x.status === "complete").length;
    // Something newer already set for the same class (or the same learners): not "nothing new".
    const newer = activities.some((b) => b.id !== a.id && new Date(b.created_at) > new Date(a.created_at)
      && (a.classroom_id ? b.classroom_id === a.classroom_id : (b.targets || []).some((x) => targets.some((y) => y.student_id === x.student_id))));
    if (done / targets.length >= INSTRUCTOR_LIMITS.NEXT_DONE && !newer && age >= 1 && age <= 14) {
      out.push({ urgency: 0, kind: "next_activity",
        title: `The next activity after "${title}"`,
        rationale: `${done} of ${targets.length} finished "${title}" and nothing new is set for them.`,
        payload: { assignmentId: a.id, subject: a.subject || null, topic: a.topic || title, classroomId: a.classroom_id || null, studentIds: targets.map((x) => x.student_id).slice(0, 60) },
        preview: { kind: "next", activity: title, done, total: targets.length } });
    }
  }
  return out.sort((x, y) => y.urgency - x.urgency).slice(0, limit).map(({ urgency, ...p }) => p);
}

/** The next syllabus topic after this one, else a practice on the same topic (they review the draft either way). */
export function nextTopicAfter(topic, syllabus = []) {
  const flat = (Array.isArray(syllabus) ? syllabus : []).flatMap((s) => s.topics || [s]).map((x) => String(x.title || x.label || "")).filter(Boolean);
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const i = flat.findIndex((x) => norm(x) === norm(topic) || norm(x).includes(norm(topic)) || norm(topic).includes(norm(x)));
  return i >= 0 && flat[i + 1] ? flat[i + 1] : `Practice: ${clip(topic, 80)}`;
}
