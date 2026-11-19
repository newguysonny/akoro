/**
 * lib/syllabusGrounding.js — the RETRIEVE half of the exam-syllabus knowledge
 * base: semantic RAG search over edu.syllabus_chunks and the prompt-ready
 * context strings agents inject to ground teaching.
 *
 * Extracted from adaptive-learning/teaching/syllabus.js (Phase 19, S8a) so
 * non-adaptive-learning modules (school/aiConcierge) can ground on the syllabus
 * without importing the module's router internals. The ingest half stays in
 * that module, which re-exports these functions unchanged.
 *
 * Embeddings match the rest of the platform: text-embedding-3-small (1536),
 * cosine, via the edu.syllabus_chunks ivfflat index + match_syllabus() RPC.
 */
import db from "../db.js";

export const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Semantic RAG search across the syllabus (optionally one subject). */
export async function searchSyllabus(query, { subject = null, limit = 6 } = {}) {
  const { embedForSearch } = await import("./searchEmbedding.js");
  const { data, error } = await db.rpc("match_syllabus", {
    p_query_embedding: await embedForSearch(query, { feature: "syllabus_search" }),
    p_subject_slug: subject ? slugify(subject) : null,
    p_match_count: limit,
    p_query_text: String(query || ""),
  });
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Prompt-ready context string agents inject to ground teaching. Only returns
 * chunks above a similarity threshold, so an off-syllabus question injects
 * nothing rather than forcing in weak matches.
 */
export async function getSyllabusContext(query, opts = {}) {
  return (await getSyllabusGrounding(query, opts)).context;
}

/**
 * Like getSyllabusContext but also returns the source references (exam, subject,
 * topic) so the tutor can show the student a "Aligned to JAMB syllabus: <topic>"
 * chip. Returns { context: string, refs: [{ exam, subject, topic }] }.
 */
export async function getSyllabusGrounding(query, { minSimilarity = 0.3, ...opts } = {}) {
  const hits = (await searchSyllabus(query, opts).catch(() => []))
    .filter((h) => h.lexical || (h.similarity ?? 0) >= minSimilarity);
  if (!hits.length) return { context: "", refs: [] };

  const context = "Relevant exam syllabus (WAEC/JAMB/NECO) references — ground your explanation in these and name the topic where it fits:\n" +
    hits.map((h, i) => `${i + 1}. [${h.exam || ""} ${h.subject_name || h.subject_slug} › ${h.topic_title}] ${h.content}`).join("\n\n");

  // Deduped, human-facing source chips (top 3).
  const seen = new Set();
  const refs = [];
  for (const h of hits) {
    const key = `${h.exam}|${h.subject_slug}|${h.topic_title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ exam: h.exam || null, subject: h.subject_name || h.subject_slug, topic: h.topic_title });
    if (refs.length >= 3) break;
  }
  return { context, refs };
}
