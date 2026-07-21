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
import multer from "multer";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import db from "../../db.js";
import { openai, llmComplete } from "../../lib/aiModel.js";
import { requireRole } from "../auth/routes.js";

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
    .select("exam, name, slug, code, updated_at, syllabus_topics(count)").order("name");
  return (data || []).map((s) => ({ ...s, topic_count: s.syllabus_topics?.[0]?.count ?? 0 }));
}

export async function deleteSubject(slug) {
  await db.schema("edu").from("syllabus_subjects").delete().eq("slug", slugify(slug));
}

// Turn raw syllabus text (e.g. extracted from a PDF) into the ingest JSON.
const EXTRACT_SYSTEM = `You convert an exam syllabus into structured JSON. Output ONLY valid JSON (no prose, no code fences) matching:
{ "exam": "WASSCE"|"JAMB"|"NECO"|..., "name": string, "code"?: string, "aims"?: string,
  "paper_structure"?: object,
  "topics": [ { "title": string, "subtopics": [ { "title": string, "content"?: string, "objectives"?: string[] } ] } ] }
Preserve the syllabus's real topics/subtopics and learning objectives faithfully. Do not invent content. Keep objectives as short bullet strings.`;

export async function extractSyllabusFromText(rawText, hint = {}) {
  const text = String(rawText || "").slice(0, 40000);
  const raw = await llmComplete(
    `${hint.exam ? `Exam: ${hint.exam}. ` : ""}${hint.name ? `Subject: ${hint.name}. ` : ""}Convert this syllabus text to JSON:\n\n${text}`,
    { system: EXTRACT_SYSTEM, maxTokens: 4000, temperature: 0.2 }
  );
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) s = fence[1].trim();
  const doc = JSON.parse(s);
  if (hint.exam) doc.exam = hint.exam;
  if (hint.name && !doc.name) doc.name = hint.name;
  return doc;
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

// ── Admin: upload / ingest ────────────────────────────────────────────────────
const adminOnly = requireRole(["admin"]);
const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }).single("file");

// Manual form + CSV both resolve client-side to a full doc → ingest here.
syllabusRouter.post("/ingest", adminOnly, async (req, res) => {
  try {
    const doc = req.body?.doc || req.body;
    if (!doc?.name || !Array.isArray(doc?.topics)) return res.status(400).json({ success: false, message: "doc.name and doc.topics[] are required" });
    const result = await ingestSubject(doc);
    res.json({ success: true, data: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PDF → extract text → LLM structure → ingest. Returns what was saved.
syllabusRouter.post("/ingest-pdf", adminOnly, (req, res) => {
  pdfUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    try {
      if (!req.file) return res.status(400).json({ success: false, message: "PDF file is required" });
      const parsed = await pdfParse(req.file.buffer);
      const text = parsed.text || "";
      const pages = parsed.numpages || 1;
      const clean = text.replace(/\s+/g, " ").trim();
      const perPage = clean.length / pages;
      // A real text PDF yields hundreds of characters per page; a scanned
      // (image-only) PDF yields almost none because it has no text layer.
      if (clean.length < 100 || perPage < 40) {
        return res.status(422).json({
          success: false, code: "scanned_pdf",
          message: "This looks like a scanned (image) PDF — it has no readable text layer, so it can't be extracted yet. Please upload a text-based PDF (one where you can select/copy the text), or run it through an OCR tool first.",
          detail: { pages, chars: clean.length, chars_per_page: Math.round(perPage) },
        });
      }
      const doc = await extractSyllabusFromText(text, { exam: req.body?.exam, name: req.body?.name });
      const result = await ingestSubject(doc);
      res.json({ success: true, data: { ...result, name: doc.name, exam: doc.exam, topics: doc.topics?.length ?? 0 } });
    } catch (e) {
      console.error("[syllabus/ingest-pdf]", e.message);
      res.status(500).json({ success: false, message: e.message || "Extraction failed" });
    }
  });
});

syllabusRouter.delete("/:slug", adminOnly, async (req, res) => {
  try { await deleteSubject(req.params.slug); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
