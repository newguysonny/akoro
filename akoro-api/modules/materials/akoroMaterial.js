/**
 * modules/materials/akoroMaterial.js — Akoro's own material on a topic
 * (published courses and blog posts, D52), for "not taught yet": somewhere
 * to read about it before teaching the protégé. → [{ kind, title, sub, href }]
 */
import db from "../../db.js";
import { searchBlogPosts } from "../adaptive-learning/blogResearch.js";
import { shapeCandidates } from "./similarCore.js";

export async function akoroMaterialFor(topic, { limit = 3 } = {}) {
  const query = String(topic || "").split(/\s+(?:and|&)\s+/i)[0].replace(/\s+/g, " ").trim().slice(0, 60);
  if (query.length < 3) return [];
  const term = query.replace(/[,()%\\]/g, " ").trim();
  const [blog, courses] = await Promise.all([
    searchBlogPosts({ query, limit: 2 }).catch(() => ({ posts: [] })),
    (async () => {
      try {
        const { data } = await db.from("courses").select("title, slug").eq("is_published", true)
          .or(`title.ilike.%${term}%,description.ilike.%${term}%`).limit(2);
        return data || [];
      } catch { return []; }
    })(),
  ]);
  return shapeCandidates([{ topic: query, posts: blog?.posts || [], courses }])
    .slice(0, limit).map(({ kind, title, sub, href }) => ({ kind, title, sub, href }));
}
