/**
 * syllabus.js — the exam-syllabus knowledge base (WASSCE/WAEC first).
 *
 * Two responsibilities:
 *   1. INGEST  a structured subject document → normalised tables + embedded
 *      chunks (edu.syllabus_*). The document is expected as clean JSON; a PDF is
 *      turned into this JSON upstream (by hand or by an LLM extraction step).
 *   2. RETRIEVE for agents: structured outline lookups + semantic RAG search,
 *      plus a prompt-ready context string agents can inject to ground teaching.
 *
 * Embeddings match the rest of the platform: text-embedding-3-small (1536),
 * cosine, via the edu.syllabus_chunks ivfflat index + match_syllabus() RPC.
 */
import { Router } from "express";
import db from "../../db.js";
import { openai } from "../../lib/aiModel.js";

const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function embed(text) {
  const res = await openai.embeddings.create({ model: "text-embedding-3-small", input: String(text).slice(0, 8000) });
  return res.data[0].embedding;
}

/**
 * Ingest one subject. Idempotent per (exam, slug): re-ingesting replaces the
 * subject's topics/subtopics/chunks so you can re-run after fixing content.
 *
 * doc = {
 *   exam?, name, code?, aims?, paper_structure?, source?,
 *   topics: [ { title, subtopics: [ { title, content?, objectives?: string[] } ] } ]
 * }
 */
export async function ingestSubject(doc) {
  const exam = doc.exam || "WASSCE";
  const slug = slugify(doc.name);
  if (!slug || !Array.isArray(doc.topics)) throw new Error("ingestSubject: name and topics[] are required");

  // Upsert the subject.
  const { data: subject, error: sErr } = await db.schema("edu").from("syllabus_subjects")
    .upsert({
      exam, name: doc.name, slug, code: doc.code ?? null, aims: doc.aims ?? null,
      paper_structure: doc.paper_structure ?? null, source: doc.source ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: "exam,slug" })
    .select("id").single();
  if (sErr) throw new Error(sErr.message);

  // Clear prior structure for a clean re-ingest (chunks cascade off subtopics/subject).
  await db.schema("edu").from("syllabus_topics").delete().eq("subject_id", subject.id);
  await db.schema("edu").from("syllabus_chunks").delete().eq("subject_id", subject.id);

  let counts = { topics: 0, subtopics: 0, chunks: 0 };
  for (const [ti, topic] of (doc.topics || []).entries()) {
    const { data: t } = await db.schema("edu").from("syllabus_topics")
      .insert({ subject_id: subject.id, title: topic.title, sort_order: ti }).select("id").single();
    counts.topics++;

    for (const [si, sub] of (topic.subtopics || []).entries()) {
      const { data: st } = await db.schema("edu").from("syllabus_subtopics")
        .insert({ topic_id: t.id, title: sub.title, content: sub.content ?? null, objectives: sub.objectives ?? null, sort_order: si })
        .select("id").single();
      counts.subtopics++;

      // One embedded chunk per subtopic — subject + topic + subtopic + objectives.
      const chunkText = [
        `${doc.name} › ${topic.title} › ${sub.title}`,
        sub.content || "",
        (sub.objectives || []).map((o) => `- ${o}`).join("\n"),
      ].filter(Boolean).join("\n");

      let vector = null;
      try { vector = await embed(chunkText); } catch (e) { console.warn("[syllabus] embed failed:", e.message); }

      await db.schema("edu").from("syllabus_chunks").insert({
        subject_id: subject.id, subject_slug: slug, topic_title: topic.title,
        subtopic_id: st.id, content: chunkText, embedding: vector,
      });
      counts.chunks++;
    }
  }
  return { subject_id: subject.id, slug, ...counts };
}

/** Semantic RAG search across the syllabus (optionally one subject). */
export async function searchSyllabus(query, { subject = null, limit = 6 } = {}) {
  const embedding = await embed(query);
  const { data, error } = await db.rpc("match_syllabus", {
    p_query_embedding: embedding,
    p_subject_slug: subject ? slugify(subject) : null,
    p_match_count: limit,
  });
  if (error) throw new Error(error.message);
  return data || [];
}

/** Prompt-ready context string agents can inject to ground their teaching. */
export async function getSyllabusContext(query, opts = {}) {
  const hits = await searchSyllabus(query, opts).catch(() => []);
  if (!hits.length) return "";
  return "Relevant WASSCE syllabus references:\n" +
    hits.map((h, i) => `${i + 1}. [${h.subject_slug} › ${h.topic_title}] ${h.content}`).join("\n\n");
}

/** Structured outline for a subject (topics → subtopics). */
export async function getSubjectOutline(subjectSlug) {
  const slug = slugify(subjectSlug);
  const { data: subject } = await db.schema("edu").from("syllabus_subjects")
    .select("id, exam, name, slug, code, aims, paper_structure").eq("slug", slug).maybeSingle();
  if (!subject) return null;
  const { data: topics } = await db.schema("edu").from("syllabus_topics")
    .select("id, title, sort_order, syllabus_subtopics ( id, title, content, objectives, sort_order )")
    .eq("subject_id", subject.id).order("sort_order");
  return { ...subject, topics: topics || [] };
}

export async function listSubjects() {
  const { data } = await db.schema("edu").from("syllabus_subjects")
    .select("exam, name, slug, code").order("name");
  return data || [];
}

// ── Router (mounted at /api/adaptive/syllabus) ────────────────────────────────
export const syllabusRouter = Router();

syllabusRouter.get("/subjects", async (_req, res) => {
  try { res.json({ success: true, data: await listSubjects() }); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

syllabusRouter.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ success: false, message: "q is required" });
    const data = await searchSyllabus(q, { subject: req.query.subject || null, limit: Math.min(Number(req.query.limit) || 6, 20) });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

syllabusRouter.get("/:slug/outline", async (req, res) => {
  try {
    const outline = await getSubjectOutline(req.params.slug);
    if (!outline) return res.status(404).json({ success: false, message: "Subject not found" });
    res.json({ success: true, data: outline });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
