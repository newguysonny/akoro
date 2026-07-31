/**
 * lessonLadder.js — provenance-aware lesson ladder resolution.
 *
 * A "ladder" is the foundation → advanced list of short subtopics (plus their
 * objectives) that structures an adaptive session. We resolve it from the most
 * trustworthy source available, and CACHE it per (school, class, subject,
 * topic) so a teacher's review improves it once for every future learner.
 *
 *   1. scheme_of_work — the school's own teacher-authored plan  (auto-approved)
 *   2. syllabus       — WAEC/JAMB/NECO grounding via retrieval   (pending review)
 *   3. ai             — model knowledge only                     (pending review)
 *
 * Review NEVER blocks a learner: a freshly generated ladder is returned
 * immediately and simply carries its provenance tier. Only an explicitly
 * REJECTED ladder is discarded (and regenerated next time).
 */

import db from "../../db.js";
import { getSyllabusGrounding } from "./syllabus.js";

const key = (s) => String(s || "").toLowerCase().trim();
const NIL = "00000000-0000-0000-0000-000000000000";

/** Resolve the learner's school + class from the mgmt roster (best effort). */
export async function learnerContext(studentId) {
  if (!studentId) return { schoolId: null, classId: null };
  try {
    const { data: stu } = await db.schema("mgmt").from("students")
      .select("school_id, class_id").eq("user_id", studentId)
      .not("school_id", "is", null).limit(1).maybeSingle();
    if (stu?.school_id) return { schoolId: stu.school_id, classId: stu.class_id || null };
    // Not on the mgmt roster — fall back to classroom membership.
    const { data: cs } = await db.from("classroom_students")
      .select("classrooms(school_id)").eq("user_id", studentId).limit(1).maybeSingle();
    return { schoolId: cs?.classrooms?.school_id || null, classId: null };
  } catch { return { schoolId: null, classId: null }; }
}

/** Tier 1 — the school's own scheme of work for this class/subject/topic. */
async function fromSchemeOfWork({ schoolId, classId, subject, topic }) {
  if (!schoolId) return null;
  try {
    let q = db.schema("mgmt").from("scheme_of_work")
      .select("topic, objectives, activities, resources, week, term, subject_id, subjects(name)")
      .eq("school_id", schoolId);
    if (classId) q = q.eq("class_id", classId);
    const { data: rows } = await q.order("term").order("week").limit(200);
    if (!rows?.length) return null;

    const t = key(topic), s = key(subject);
    // Match rows whose topic OR subject relates to what the learner asked for.
    const hits = rows.filter((r) => {
      const rt = key(r.topic), rs = key(r.subjects?.name);
      return rt && (rt.includes(t) || t.includes(rt) || (s && rs === s));
    });
    if (hits.length < 2) return null;   // need a real sequence, not one row

    const subtopics = [];
    const objectives = {};
    for (const r of hits) {
      if (!r.topic || subtopics.includes(r.topic)) continue;
      subtopics.push(r.topic);
      const objs = String(r.objectives || "").split(/\n|;|•/).map((x) => x.trim()).filter(Boolean);
      objectives[r.topic] = objs.length ? objs.slice(0, 4) : [`Understand ${r.topic}.`];
      if (subtopics.length >= 8) break;
    }
    if (subtopics.length < 2) return null;

    return {
      subtopics, objectives,
      provenance: "scheme_of_work",
      refs: [{ source: "Your school's scheme of work", subject: hits[0]?.subjects?.name || subject, topic }],
      status: "approved",            // teacher-authored — already trusted
    };
  } catch { return null; }
}

/** Tier 2/3 — generate, grounded in national syllabus content when available. */
async function generated({ guide, subject, topic }) {
  let context = "", refs = [];
  try {
    ({ context, refs } = await getSyllabusGrounding(`${subject} ${topic}`.trim(), { limit: 5 }));
  } catch { /* grounding optional */ }

  // Only the SUBTOPIC ladder is on the critical path — objectives aren't needed
  // until a subtopic actually opens, and generating 5-6 of them up front added
  // several seconds to session start (painful on slow connections). Generate
  // them in the background and patch the cached row when they land.
  const subtopics  = await guide.generateSubtopics(topic, subject, context);
  const objectives = {};

  return {
    subtopics, objectives, deferObjectives: { guide, topic, subject, context },
    provenance: context ? "syllabus" : "ai",
    refs: refs || [],
    status: "pending_review",       // async teacher review — never blocks
  };
}

/**
 * resolveLadder — the entry point used when an adaptive session starts.
 * Always returns a usable ladder; never throws for provenance reasons.
 */
export async function resolveLadder({ studentId, topic, subject, guide }) {
  const { schoolId, classId } = await learnerContext(studentId);
  const topicKey = key(topic);

  // 1. Cached ladder (skip rejected — those regenerate).
  try {
    const { data: cached } = await db.schema("edu").from("lesson_ladders")
      .select("*")
      .eq("topic_key", topicKey)
      .eq("school_id", schoolId ?? null)
      .eq("class_id", classId ?? null)
      .ilike("subject", subject || "")
      .in("status", ["approved", "pending_review"])
      .maybeSingle();
    if (cached?.subtopics?.length) {
      db.schema("edu").from("lesson_ladders")
        .update({ use_count: (cached.use_count || 0) + 1, updated_at: new Date().toISOString() })
        .eq("id", cached.id).then(() => {}, () => {});
      return {
        subtopics: cached.subtopics, objectives: cached.objectives || {},
        provenance: cached.provenance, refs: cached.refs || [],
        status: cached.status, ladderId: cached.id, cached: true,
      };
    }
  } catch { /* cache miss is fine */ }

  // 2. Build fresh: school scheme of work → syllabus-grounded → AI.
  const built = (await fromSchemeOfWork({ schoolId, classId, subject, topic }))
             || (await generated({ guide, subject, topic }));

  // 3. Cache for the next learner (best effort — never block the session).
  let ladderId = null;
  try {
    const { data } = await db.schema("edu").from("lesson_ladders").insert({
      school_id: schoolId, class_id: classId,
      subject: subject || "General", topic_key: topicKey, topic: topic || "Untitled",
      subtopics: built.subtopics, objectives: built.objectives,
      provenance: built.provenance, refs: built.refs, status: built.status,
      use_count: 1,
    }).select("id").single();
    ladderId = data?.id ?? null;
  } catch (e) {
    console.warn("[lesson_ladders cache]", e.message);
  }

  // Fill objectives in the background so the learner starts immediately.
  if (built.deferObjectives) {
    const { guide, topic: t, subject: sub, context } = built.deferObjectives;
    (async () => {
      const objectives = {};
      await Promise.all(built.subtopics.map(async (st) => {
        objectives[st] = await guide.generateObjectives(st, t, sub, context).catch(() => []);
      }));
      if (ladderId) {
        await db.schema("edu").from("lesson_ladders")
          .update({ objectives, updated_at: new Date().toISOString() })
          .eq("id", ladderId);
      }
    })().catch((e) => console.warn("[lesson_ladders objectives]", e.message));
    delete built.deferObjectives;
  }

  return { ...built, ladderId, cached: false };
}

/** Human-facing provenance chip for the session UI. */
export function provenanceLabel(provenance, status) {
  if (provenance === "scheme_of_work") return "From your school's scheme of work";
  if (provenance === "syllabus")       return status === "approved" ? "Reviewed · aligned to exam syllabus" : "Aligned to exam syllabus";
  return status === "approved" ? "Reviewed by your teacher" : "AI-generated";
}
