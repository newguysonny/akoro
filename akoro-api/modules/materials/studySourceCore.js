/**
 * modules/materials/studySourceCore.js — a folder as Study Prep's syllabus
 * (Grand Plan §7.17.3, D54): the topics its read uploads cover, ranked by how
 * often the learner's past papers test them. Pure — no db.
 *
 *   folderTopics({ ingests, questions })   → [{ id, label, papers, years, marks, questions, docs, pages }]
 *   questionsForTopic(questions, label)    → the past-paper questions on one topic (for practice)
 */
export const MATERIAL_SOURCE_LIMITS = Object.freeze({ TOPICS: 25, BASED_ON: 6 });

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// The same id rule as the platform syllabus (syllabus-resolver topicSlug), so plans and topics line up.
export const materialTopicId = (label) => String(label || "").toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "topic";

/**
 * ingests:   [{ id, doc_kind, structure: { items: [{ topics: [{ name, pages }] }], topics } }]
 * questions: [{ ingest_id, topic, year, marks }]
 */
export function folderTopics({ ingests = [], questions = [] }) {
  const by = new Map();
  const order = [];
  for (const ing of ingests) {
    const topics = (ing.structure?.items || []).flatMap((it) => it.topics || []);
    for (const t of topics.length ? topics : (ing.structure?.topics || [])) {
      const key = norm(t.name);
      if (!key) continue;
      if (!by.has(key)) {
        by.set(key, { label: String(t.name).trim().slice(0, 80), papers: new Set(), years: new Set(), marks: 0, questions: 0, docs: new Set(), pages: 0 });
        order.push(key);
      }
      const e = by.get(key);
      e.docs.add(ing.id);
      e.pages += Array.isArray(t.pages) ? t.pages.length : 0;
    }
  }
  for (const q of questions) {
    const e = by.get(norm(q.topic));
    if (!e) continue;
    e.papers.add(q.ingest_id);
    if (q.year) e.years.add(q.year);
    e.marks += q.marks || 0;
    e.questions += 1;
  }
  return order.map((key, i) => ({ key, i, ...by.get(key) }))
    // Most past papers first, then marks, then questions; otherwise the order the materials gave.
    .sort((a, b) => b.papers.size - a.papers.size || b.marks - a.marks || b.questions - a.questions || a.i - b.i)
    .slice(0, MATERIAL_SOURCE_LIMITS.TOPICS)
    .map((e) => ({
      id: materialTopicId(e.label), label: e.label, source: "documents",
      papers: e.papers.size, years: [...e.years].sort(), marks: e.marks, questions: e.questions, docs: e.docs.size, pages: e.pages,
    }));
}

/** The learner's own past-paper questions on one topic — what its practice is based on. */
export function questionsForTopic(questions, label) {
  const key = norm(label);
  return questions.filter((q) => norm(q.topic) === key && q.text)
    .sort((a, b) => (b.marks || 0) - (a.marks || 0))
    .slice(0, MATERIAL_SOURCE_LIMITS.BASED_ON)
    .map((q) => `${q.exam ? `${q.exam} ` : ""}${q.year || ""}${q.number ? ` Q${q.number}` : ""}: ${String(q.text).slice(0, 300)}`.trim());
}
