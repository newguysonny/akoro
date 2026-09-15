/**
 * modules/blogs/mirror.js — learner blogs on the public blog.
 *
 * When a learner publishes, the post is mirrored into content.blog_posts
 * under the "Community" category — the landing homepage carousel and the
 * /blog page already render that table, so learner writing appears on the
 * public website as just another category. The mirror is kept in sync:
 * edits re-sync, unpublish/delete removes it. public_slug on edu.blogs
 * remembers the mirrored row.
 *
 * Mirroring is best-effort by contract: the caller wraps every call in
 * try/catch — the learner's save must never fail because a public mirror
 * hiccuped, and the next publish re-syncs anyway (upsert by slug).
 */
import db, { contentDb } from "../../db.js";
import { markdownToBlogBlocks, blogReadMinutes } from "../../lib/blogBody.js";

export const COMMUNITY_CATEGORY = "Community";

// Stable study-theme covers (the same source the marketing posts use) —
// rotated deterministically by post id so a card never changes cover.
const COVERS = [
  "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=1200&q=80",
];

const coverFor = (id) => {
  let h = 0;
  const s = String(id || "");
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COVERS[h % COVERS.length];
};

const slugify = (title) =>
  String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "community-post";

const excerptOf = (body) =>
  String(body || "").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 140) ?? null;

/**
 * Mirror one published learner blog into content.blog_posts.
 * `blog` is the full edu.blogs row; `author` is the display name.
 */
export async function syncPublishedBlogMirror(blog, author) {
  if (!blog?.id || !blog.title) return null;

  // The slug embeds a slice of the blog id, so it is stable across edits
  // and effectively collision-free; a taken slug (paranoid path) widens it.
  let slug = blog.public_slug || `${slugify(blog.title)}-${String(blog.id).slice(0, 8)}`;
  const { data: taken } = await contentDb.from("blog_posts")
    .select("id").eq("slug", slug).maybeSingle();
  if (taken && blog.public_slug !== slug) slug = `${slug}-${String(blog.id).replace(/-/g, "").slice(0, 12)}`;

  const row = {
    slug,
    title: blog.title,
    excerpt: blog.excerpt ?? excerptOf(blog.body),
    category: COMMUNITY_CATEGORY,
    image: coverFor(blog.id),
    author: author || "Akoro learner",
    author_role: "Learner",
    read_min: blogReadMinutes(blog.body),
    body: markdownToBlogBlocks(blog.body),
    featured: false,
    status: "published",
    published_at: blog.published_at ?? new Date().toISOString(),
  };

  const { data: existing } = await contentDb.from("blog_posts")
    .select("id").eq("slug", slug).maybeSingle();
  if (existing) {
    const { error } = await contentDb.from("blog_posts").update(row).eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await contentDb.from("blog_posts").insert(row);
    if (error) throw new Error(error.message);
  }

  if (blog.public_slug !== slug) {
    await db.schema("edu").from("blogs").update({ public_slug: slug }).eq("id", blog.id);
  }
  return slug;
}

/** The mirror exists only while the post is published — unpublish/remove it. */
export async function removeBlogMirror(publicSlug) {
  if (!publicSlug) return false;
  const { error } = await contentDb.from("blog_posts").delete().eq("slug", publicSlug);
  if (error) throw new Error(error.message);
  return true;
}
