/**
 * modules/adaptive-learning/blogResearch.js — the agent's internal research
 * channel (replaces web search). A coding agent searches the web; Akoro's
 * agent searches OUR blog: published posts from content.blog_posts, read
 * back as plain text the model can quote and reason over.
 *
 * Read-only, published-only — drafts and archived posts are invisible to
 * the agent, exactly as to the public site.
 */
import { contentDb } from "../../db.js";
import { flattenBlogBody, sanitizeBlogQuery, BLOG_QUERY_MAX_CHARS } from "../../lib/blogBody.js";

export const BLOG_SEARCH_MAX_RESULTS = 8;

const CARD_COLS = "id,slug,title,excerpt,category,author,author_role,read_min,published_at";

/** Search published posts (cards). Empty/absent query → latest posts. */
export async function searchBlogPosts({ query, category, limit } = {}) {
  let sanitized = null;
  if (query !== undefined && query !== null && String(query).trim() !== "") {
    sanitized = sanitizeBlogQuery(query);
    if (!sanitized.ok) {
      return { error: sanitized.reason === "too_long"
        ? `Keep the search under ${BLOG_QUERY_MAX_CHARS} characters.`
        : "Give the search a word or two to look for." };
    }
  }

  const capped = Math.min(Math.max(Number.parseInt(limit, 10) || 5, 1), BLOG_SEARCH_MAX_RESULTS);

  let q = contentDb.from("blog_posts")
    .select(CARD_COLS)
    .eq("status", "published");
  if (category && String(category).trim() && String(category) !== "All") {
    q = q.eq("category", String(category).trim().slice(0, 60));
  }
  if (sanitized) {
    const s = sanitized.query;
    q = q.or(`title.ilike.%${s}%,excerpt.ilike.%${s}%,category.ilike.%${s}%`);
  }

  const { data, error } = await q
    .order("published_at", { ascending: false })
    .limit(capped);
  if (error) return { error: "The blog search index is unavailable right now." };

  return {
    searched: true,
    query: sanitized?.query ?? null,
    category: category ? String(category).trim().slice(0, 60) : null,
    count: (data ?? []).length,
    posts: (data ?? []).map((p) => ({
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt ?? null,
      category: p.category,
      author: p.author,
      readMin: p.read_min,
      publishedAt: p.published_at,
    })),
  };
}

/** Read one published post in full (body flattened to plain text). */
export async function readBlogPost({ slug } = {}) {
  const clean = String(slug ?? "").trim().slice(0, 200);
  if (!clean) return { error: "Which post? Pass the slug from search_blog_posts." };

  const { data: post, error } = await contentDb.from("blog_posts")
    .select("id,slug,title,excerpt,category,author,author_role,read_min,published_at,body")
    .eq("slug", clean).eq("status", "published")
    .maybeSingle();
  if (error) return { error: "The blog is unavailable right now." };
  if (!post) return { error: `No published Akoro blog post with the slug "${clean}".` };

  // Same-category reads keep follow-up research one step away.
  const { data: related } = await contentDb.from("blog_posts")
    .select("slug, title")
    .eq("status", "published").eq("category", post.category)
    .neq("id", post.id)
    .order("published_at", { ascending: false })
    .limit(3);

  return {
    found: true,
    slug: post.slug,
    title: post.title,
    author: post.author,
    authorRole: post.author_role ?? null,
    category: post.category,
    readMin: post.read_min,
    publishedAt: post.published_at,
    excerpt: post.excerpt ?? null,
    body: flattenBlogBody(post.body),
    related: (related ?? []).map((r) => ({ slug: r.slug, title: r.title })),
  };
}
