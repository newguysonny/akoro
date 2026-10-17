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
