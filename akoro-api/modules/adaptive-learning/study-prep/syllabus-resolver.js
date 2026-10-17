/**
 * study-prep syllabus resolver (Master Plan §4.15 step 4). Read-only over the
 * existing edu.syllabus_* tables — the agent plans against REAL syllabus
 * rows, never invented topics. JSS1 Basic Science ingestion is the preflight
 * blocker: with no rows the resolver returns an empty syllabus and the
 * harness rejects every plan with topic_not_in_syllabus (safe failure).
 *
 * db-backed (imports db.js) — the shaping helpers are pure and re-exported
 * for the contract tests.
 */

import db from "../../../db.js";

/** Stable topic id: slugified title (≤120 chars, matches the topics table CHECK). */
export function topicSlug(title) {
  return String(title || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "topic";
}

/** db-free shaping so tests never touch Postgres. */
export function shapeSyllabus(subjects, topicsBySubject) {
  const out = [];
  for (const subject of subjects || []) {
    for (const topic of topicsBySubject.get(subject.id) || []) {
      out.push({ id: topicSlug(topic.title), label: topic.title, subjectId: subject.id, exam: subject.exam });
    }
  }
  return out;
}

const EXAM_FOR_BOARD = (board) => {
  const normalized = String(board || "").toUpperCase();
  if (normalized === "NECO") return "NECO";
  if (normalized === "JAMB") return "JAMB";
  if (normalized === "NCEE") return "NCEE";
  return "WASSCE";
};

/**
 * Resolve the topic list for a subject + class level. Class level is matched
 * loosely (JSS1 / JSS 1 / Basic 7) against the subject name or code; when no
 * class-scoped subject exists we fall back to the exam board's subject so a
 * missing class tag never blocks planning.
 */
export async function resolveTopics({ subject, classLevel = "JSS1", exam = "WAEC" }) {
  const subjectPattern = `%${String(subject || "").trim()}%`;
  const { data: subjects, error } = await db.schema("edu").from("syllabus_subjects")
    .select("id, exam, name, slug, code")
    .ilike("name", subjectPattern)
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) throw error;
  let rows = subjects || [];
  const classToken = String(classLevel || "").replace(/\s+/g, "").toUpperCase();
  // A whole class token, not a substring: "SS1" must not match "JSS1" (or "JSS1" match "JSS10").
  const classPattern = classToken ? new RegExp(`(^|[^A-Z0-9])${classToken.replace(/[^A-Z0-9]/g, "")}($|[^0-9])`) : null;
  const hasClass = (value) => !!classPattern && classPattern.test(String(value || "").toUpperCase().replace(/([A-Z])\s+(\d)/g, "$1$2"));
  const classScoped = rows.filter((row) => hasClass(row.code) || hasClass(row.name));
  const examName = EXAM_FOR_BOARD(exam);
  const examScoped = (classScoped.length ? classScoped : rows).filter((row) => row.exam === examName);
  rows = examScoped.length ? examScoped : (classScoped.length ? classScoped : rows);
  if (!rows.length) return [];

  const { data: topics, error: topicsError } = await db.schema("edu").from("syllabus_topics")
    .select("id, subject_id, title, sort_order")
    .in("subject_id", rows.map((row) => row.id))
    .order("sort_order", { ascending: true })
    .limit(200);
  if (topicsError) throw topicsError;
  const bySubject = new Map();
  for (const topic of topics || []) {
    if (!bySubject.has(topic.subject_id)) bySubject.set(topic.subject_id, []);
    bySubject.get(topic.subject_id).push(topic);
  }
  return shapeSyllabus(rows, bySubject);
}

/**
 * Approved prerequisite edges (edu.concept_edges, relation prerequisite_for,
 * status approved — S4 §6). Edges map concept titles onto topic slugs; edges
 * whose endpoints don't match resolvable syllabus topics for this subject are
 * ignored (no invented constraints).
 */
export async function prerequisiteEdges({ subject }) {
  const { data: edges, error } = await db.schema("edu").from("concept_edges")
    .select("from_concept_id, to_concept_id, relation, status")
    .eq("relation", "prerequisite_for").eq("status", "approved")
    .limit(500);
  if (error) throw error;
  if (!edges?.length) return [];
  const ids = [...new Set(edges.flatMap((edge) => [edge.from_concept_id, edge.to_concept_id]))];
  const { data: concepts, error: conceptsError } = await db.schema("edu").from("concept_catalog")
    .select("id, title, subject, topic_key, status")
    .in("id", ids)
    .eq("status", "approved")
    .limit(500);
  if (conceptsError) throw conceptsError;
  const byId = new Map((concepts || []).map((concept) => [concept.id, concept]));
  const subjectPattern = String(subject || "").trim().toLowerCase();
  const out = [];
  for (const edge of edges) {
    const from = byId.get(edge.from_concept_id);
    const to = byId.get(edge.to_concept_id);
    if (!from || !to) continue;
    if (subjectPattern && !String(from.subject || "").toLowerCase().includes(subjectPattern)
      && !String(to.subject || "").toLowerCase().includes(subjectPattern)) continue;
    const before = topicSlug(from.topic_key || from.title);
    const after = topicSlug(to.topic_key || to.title);
    if (before === after) continue;
    out.push({ before, after, beforeLabel: from.title, afterLabel: to.title });
  }
  return out;
}

// ── The learner's own school syllabus (Grand Plan §8.7, D30) ────────────────
//
// Most specific first: the learner's CLASS syllabus, then their SCHOOL's (any
// class), then the platform's. The school and class come only from a linked
// enrollment — mgmt.students.user_id = the authenticated learner, active —
// never from a self-reported school name or a student's name (names repeat,
// and matching on one could open another child's class).

const TERM_ORDER = ["first", "second", "third"];
const termRank = (term) => {
  const index = TERM_ORDER.findIndex((name) => String(term || "").toLowerCase().startsWith(name));
  return index < 0 ? TERM_ORDER.length : index;
};

/** The learner's linked enrollment → { schoolId, classId, className } or null. */
export async function learnerEnrollment(learnerId) {
  if (!learnerId) return null;
  const { data: students, error } = await db.schema("mgmt").from("students")
    .select("id, school_id, class_id").eq("user_id", learnerId).eq("status", "active").limit(2);
  if (error) throw error;
  // Linked to more than one active enrollment: ambiguous — use neither.
  if ((students || []).length !== 1) return null;
  const student = students[0];
  let className = null;
  if (student.class_id) {
    const { data: classes, error: classError } = await db.schema("mgmt").from("classes")
      .select("id, name").eq("id", student.class_id).limit(1);
    if (classError) throw classError;
    className = classes?.[0]?.name || null;
  }
  return { schoolId: student.school_id, classId: student.class_id || null, className };
}

/**
 * The school's current term: the latest resumption on or before today, unless
 * that term's vacation has already started (between terms → null).
 */
export async function currentTerm(schoolId, today = new Date().toISOString().slice(0, 10)) {
  if (!schoolId) return null;
  const { data: events, error } = await db.schema("mgmt").from("academic_calendar")
    .select("term, event_type, starts_on").eq("school_id", schoolId)
    .in("event_type", ["resumption", "vacation"]).lte("starts_on", today)
    .order("starts_on", { ascending: false }).limit(10);
  if (error) throw error;
  const latest = (events || [])[0];
  return latest?.event_type === "resumption" && latest.term ? latest.term : null;
}

/** The school's subject rows matching a subject name. */
async function schoolSubjectIds(schoolId, subject) {
  const name = String(subject || "").trim();
  if (!schoolId || !name) return [];
  const { data, error } = await db.schema("mgmt").from("subjects")
    .select("id, name").eq("school_id", schoolId).ilike("name", `%${name}%`).limit(10);
  if (error) throw error;
  return (data || []).map((row) => row.id);
}

/** syllabus_items → topics: one per slug, current term first, then by term. */
export function shapeSchoolTopics(items, { term = null, source } = {}) {
  const seen = new Set();
  const out = [];
  const sorted = [...(items || [])].sort((a, b) => {
    const current = (row) => (term && String(row.term || "").toLowerCase() === String(term).toLowerCase() ? 0 : 1);
    return current(a) - current(b) || termRank(a.term) - termRank(b.term);
  });
  for (const item of sorted) {
    const id = topicSlug(item.topic);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: String(item.topic).trim(), term: item.term || null, covered: item.status === "covered", source });
  }
  return out;
}

/**
 * syllabus.resolve_class — the learner's class syllabus for this subject
 * (mgmt.syllabus_items for their school + class). This term's topics when the
 * class has any for the term, else every term's. → { topics, term } (empty
 * topics without a linked enrollment).
 */
export async function resolveClassTopics({ learnerId, subject, enrollment = undefined, today } = {}) {
  const linked = enrollment === undefined ? await learnerEnrollment(learnerId) : enrollment;
  if (!linked?.classId) return { topics: [], term: null, enrollment: linked };
  const subjectIds = await schoolSubjectIds(linked.schoolId, subject);
  if (!subjectIds.length) return { topics: [], term: null, enrollment: linked };
  const { data: items, error } = await db.schema("mgmt").from("syllabus_items")
    .select("topic, term, status, subject_id").eq("school_id", linked.schoolId).eq("class_id", linked.classId)
    .in("subject_id", subjectIds).limit(300);
  if (error) throw error;
  const term = await currentTerm(linked.schoolId, today);
  const thisTerm = term ? (items || []).filter((row) => String(row.term || "").toLowerCase() === term.toLowerCase()) : [];
  return { topics: shapeSchoolTopics(thisTerm.length ? thisTerm : items, { term, source: "class" }), term: thisTerm.length ? term : null, enrollment: linked };
}

/** syllabus.resolve_school — the learner's school syllabus for this subject, any class. */
export async function resolveSchoolTopics({ learnerId, subject, enrollment = undefined } = {}) {
  const linked = enrollment === undefined ? await learnerEnrollment(learnerId) : enrollment;
  if (!linked?.schoolId) return { topics: [], enrollment: linked };
  const subjectIds = await schoolSubjectIds(linked.schoolId, subject);
  if (!subjectIds.length) return { topics: [], enrollment: linked };
  const { data: items, error } = await db.schema("mgmt").from("syllabus_items")
    .select("topic, term, status, subject_id, class_id").eq("school_id", linked.schoolId)
    .in("subject_id", subjectIds).limit(500);
  if (error) throw error;
  return { topics: shapeSchoolTopics(items, { source: "school" }), enrollment: linked };
}

/**
 * The syllabus a session plans against, most specific first:
 * class → school → platform. → { source, ref, topics, term } — source null
 * and topics [] when none exists (then, and only then, syllabus.generate).
 */
export async function resolveSyllabusChain({ learnerId, subject, classLevel, exam, today } = {}) {
  const enrollment = await learnerEnrollment(learnerId);
  if (enrollment) {
    const cls = await resolveClassTopics({ subject, enrollment, today });
    if (cls.topics.length) return { source: "class", ref: enrollment.classId, topics: cls.topics, term: cls.term, className: enrollment.className };
    const school = await resolveSchoolTopics({ subject, enrollment });
    if (school.topics.length) return { source: "school", ref: enrollment.schoolId, topics: school.topics, term: null, className: enrollment.className };
  }
  const platform = await resolveTopics({ subject, classLevel, exam });
  if (platform.length) return { source: "platform", ref: null, topics: platform.map((topic) => ({ ...topic, source: "platform" })), term: null };
  return { source: null, ref: null, topics: [], term: null };
}

/** The topics of a session's recorded source (what its plan is checked against). */
export async function topicsForSource({ source, ref, learnerId, subject, classLevel, exam }) {
  if (source === "class" || source === "school") {
    const enrollment = await learnerEnrollment(learnerId);
    // The enrollment changed since the session started: no longer the learner's class/school.
    const still = source === "class" ? enrollment?.classId === ref : enrollment?.schoolId === ref;
    if (!still) return [];
    return source === "class"
      ? (await resolveClassTopics({ subject, enrollment })).topics
      : (await resolveSchoolTopics({ subject, enrollment })).topics;
  }
  return resolveTopics({ subject, classLevel, exam });
}
