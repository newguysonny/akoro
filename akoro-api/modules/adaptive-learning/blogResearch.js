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
import { flattenBlogBody, sanitizeBlogQuery, blogBlockToLines, BLOG_QUERY_MAX_CHARS } from "../../lib/blogBody.js";

export const BLOG_SEARCH_MAX_RESULTS = 8;

/* ── Passage search (Grand Plan §7.14, D35) ────────────────────────────────
 * Article BODIES are searched, not just titles: each published post is split
 * into passages (one per heading section, long sections split again) kept in
 * content.blog_chunks and searched with match_blog_chunks (hybrid: vector +
 * stemmed keywords, published only). When nothing indexed matches — a post
 * not indexed yet, or the table not there yet — the same passages are made
 * and ranked in memory from the newest published posts, so the search always
 * reads bodies.
 * Every passage carries its post's slug, title and heading, and a link, so
 * the agent can quote and cite it. The blog is never a syllabus source and
 * never evidence. */

export const BLOG_PASSAGE_MAX_CHARS = 900;
export const BLOG_PASSAGE_LIMIT = 6;
const FALLBACK_POSTS = 40;
const STOP = new Set("the a an and or of to in on for with is are was be it as at by from that this how what why when can do does your you my i me we our their they".split(" "));

/** Split one long text into ≤ max pieces at paragraph, then sentence, boundaries. */
function splitLong(text, max) {
  const out = [];
  let rest = String(text || "").trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.4) { cut = rest.lastIndexOf(". ", max); if (cut >= 0) cut += 1; }
    if (cut < max * 0.4) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/**
 * PURE: a post body (ordered block array) → its passages
 * [{ ord, heading, text }]. A heading block starts a new section; the
 * heading travels with every passage of its section.
 */
export function blogPassages(body, { max = BLOG_PASSAGE_MAX_CHARS } = {}) {
  const sections = [];
  let cur = { heading: null, lines: [] };
  for (const block of Array.isArray(body) ? body : []) {
    if (block?.type === "h") {
      if (cur.lines.length) sections.push(cur);
      cur = { heading: blogBlockToLines(block)[0]?.replace(/^##\s*/, "") || null, lines: [] };
      continue;
    }
    cur.lines.push(...blogBlockToLines(block).filter((l) => !l.startsWith("[image:")));
  }
  if (cur.lines.length) sections.push(cur);
  const passages = [];
  for (const s of sections) {
    for (const text of splitLong(s.lines.join("\n\n"), max)) passages.push({ ord: passages.length, heading: s.heading, text });
  }
  return passages;
}

const terms = (query) => [...new Set(String(query || "").toLowerCase().match(/[a-z0-9]+/g) || [])].filter((w) => w.length > 2 && !STOP.has(w));

/**
 * PURE: rank passages for a query by keyword hits (the in-memory fallback of
 * match_blog_chunks' lexical arm): every term counts (capped per term), a
 * heading hit and the whole phrase count extra. Passages with no hit drop.
 */
export function rankPassages(passages, query) {
  const words = terms(query);
  if (!words.length) return [];
  const phrase = String(query || "").toLowerCase().replace(/\s+/g, " ").trim();
  const scored = passages.map((p) => {
    const text = String(p.text || "").toLowerCase();
    // The section heading and the post's title count as the passage's heading.
    const head = `${p.heading || ""} ${p.title || ""}`.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const w of words) {
      const re = new RegExp(`\\b${w}`, "g");
      const hits = (text.match(re) || []).length;
      if (hits || re.test(head)) matched += 1;
      score += Math.min(hits, 3) + (new RegExp(`\\b${w}`).test(head) ? 2 : 0);
    }
    if (phrase.length > 4 && text.includes(phrase)) score += 4;
    // Passages that hit more of the query's words come first.
    return { ...p, score: score + matched * 2, matched };
  });
  return scored.filter((p) => p.matched > 0).sort((a, b) => b.score - a.score);
}

const passageOut = (p) => ({
  slug: p.slug, title: p.title, heading: p.heading || null, category: p.category || null,
  passage: String(p.text ?? p.chunk_text ?? "").slice(0, BLOG_PASSAGE_MAX_CHARS),
  link: `/blog/${p.slug}`,
});

/** In memory: passages from the newest published posts, ranked by keyword. */
async function passagesInMemory({ query, category, limit }) {
  let q = contentDb.from("blog_posts").select("id, slug, title, category, body").eq("status", "published");
  if (category) q = q.eq("category", category);
  const { data, error } = await q.order("published_at", { ascending: false }).limit(FALLBACK_POSTS);
  if (error) throw new Error(error.message);
  const all = (data || []).flatMap((post) => blogPassages(post.body).map((p) => ({ ...p, slug: post.slug, title: post.title, category: post.category })));
  return rankPassages(all, query).slice(0, limit).map(passageOut);
}

let lastBackfill = 0;
/**
 * blog.search — the best passages for a query across published posts.
 * → { searched, query, count, passages: [{ slug, title, heading, category, passage, link }], index }
 */
export async function searchBlogPassages({ query, category, limit } = {}, deps = {}) {
  const sanitized = sanitizeBlogQuery(query);
  if (!sanitized.ok) return { error: sanitized.reason === "too_long" ? `Keep the search under ${BLOG_QUERY_MAX_CHARS} characters.` : "Give the search a word or two to look for." };
  const capped = Math.min(Math.max(Number.parseInt(limit, 10) || BLOG_PASSAGE_LIMIT, 1), BLOG_SEARCH_MAX_RESULTS);
  const cat = category && String(category).trim() && String(category) !== "All" ? String(category).trim().slice(0, 60) : null;
  const rpc = deps.rpc || (async (args) => (await import("../../db.js")).default.rpc("match_blog_chunks", args));
  const embed = deps.embed || (async (text) => (await import("../../lib/searchEmbedding.js")).embedForSearch(text, { payer: "platform", feature: "blog_search" }));
  let index = "chunks";
  let passages = [];
  try {
    const embedding = await embed(sanitized.query).catch(() => null);
    const { data, error } = await rpc({ p_query_embedding: embedding, p_match_count: capped, p_query_text: sanitized.query, p_category: cat });
    if (error) throw new Error(error.message);
    passages = (data || []).map(passageOut);
    if (!passages.length && Date.now() - lastBackfill > 10 * 60_000) {
      // Nothing indexed matched: make sure every published post is indexed (in the background).
      lastBackfill = Date.now();
      (deps.backfill || indexPublishedBlogPosts)().catch(() => {});
    }
  } catch {
    index = "memory";   // the table or function is not there yet
  }
  if (!passages.length) {
    index = "memory";
    try { passages = await (deps.inMemory || passagesInMemory)({ query: sanitized.query, category: cat, limit: capped }); }
    catch { return { error: "The blog search index is unavailable right now." }; }
  }
  return { searched: true, query: sanitized.query, category: cat, count: passages.length, passages, index };
}

/** (Re)index one post's passages: published → its passages; otherwise none. Never throws. */
export async function indexBlogPost({ postId = null, slug = null } = {}) {
  try {
    let q = contentDb.from("blog_posts").select("id, status, body");
    q = postId ? q.eq("id", postId) : q.eq("slug", String(slug || ""));
    const { data: post } = await q.maybeSingle();
    if (!post) return { indexed: 0 };
    await contentDb.from("blog_chunks").delete().eq("post_id", post.id);
    if (post.status !== "published") return { indexed: 0 };
    const rows = blogPassages(post.body).map((p) => ({ post_id: post.id, ord: p.ord, heading: p.heading ? p.heading.slice(0, 200) : null, chunk_text: p.text }));
    if (!rows.length) return { indexed: 0 };
    const { error } = await contentDb.from("blog_chunks").insert(rows);
    if (error) throw new Error(error.message);
    return { indexed: rows.length };
  } catch (e) {
    console.warn("[blog-search] index failed:", String(e?.message || e).slice(0, 160));
    return { indexed: 0, error: true };
  }
}

/** Index every published post that has no passages yet (the sweep behind an empty index). */
export async function indexPublishedBlogPosts({ max = 200 } = {}) {
  const { data: posts } = await contentDb.from("blog_posts").select("id").eq("status", "published").order("published_at", { ascending: false }).limit(max);
  const ids = (posts || []).map((p) => p.id);
  if (!ids.length) return { indexed: 0 };
  const { data: have } = await contentDb.from("blog_chunks").select("post_id").in("post_id", ids).eq("ord", 0);
  const done = new Set((have || []).map((h) => h.post_id));
  let indexed = 0;
  for (const id of ids.filter((x) => !done.has(x))) indexed += (await indexBlogPost({ postId: id })).indexed;
  return { indexed };
}

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

  // §7.14: the article bodies too — the best passages, each with its post's title, heading and link.
  const found = sanitized ? await searchBlogPassages({ query: sanitized.query, category, limit: 4 }).catch(() => null) : null;
  const passages = found?.passages || [];
  const seen = new Set((data ?? []).map((p) => p.slug));
  const fromBodies = [];
  for (const p of passages) {
    if (seen.has(p.slug) || fromBodies.length + seen.size >= capped) continue;
    seen.add(p.slug);
    fromBodies.push({ slug: p.slug, title: p.title, excerpt: null, category: p.category });
  }

  return {
    searched: true,
    query: sanitized?.query ?? null,
    category: category ? String(category).trim().slice(0, 60) : null,
    count: (data ?? []).length + fromBodies.length,
    ...(passages.length ? { passages, note: "Quote a passage word for word and name its post (title) — the chat links the post." } : {}),
    posts: [...(data ?? []), ...fromBodies].map((p) => ({
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
