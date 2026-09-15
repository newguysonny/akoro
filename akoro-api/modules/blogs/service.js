/**
 * modules/blogs/service.js — the ONE write path for learner blogs.
 *
 * Both the REST routes (/api/blogs) and the agent's chat tools call these
 * functions, so validation, draft privacy, publish rules and the public
 * mirror live in exactly one place. Every write is author-scoped; drafts
 * are private (a non-author's read is a 404-shaped null, never a leak).
 */
import db, { contentDb } from "../../db.js";
import { markdownToBlogBlocks, blogReadMinutes } from "../../lib/blogBody.js";
import { syncPublishedBlogMirror, removeBlogMirror } from "./mirror.js";

const edu = () => db.schema("edu");

export const TITLE_MAX = 120;
export const BODY_MAX = 50_000;
export const EXCERPT_LEN = 140;
export const BLOG_STATUSES = ["draft", "published"];

/** First meaningful line of the body, tags/markers left as written. */
export const excerptOf = (body) => {
  const line = String(body || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  return line.slice(0, EXCERPT_LEN) || null;
};

export function validateBlogInput({ title, body, status }) {
  const cleanTitle = String(title ?? "").trim();
  if (!cleanTitle) return { error: "Give the blog a title." };
  if (cleanTitle.length > TITLE_MAX) return { error: `Keep the title under ${TITLE_MAX} characters.` };
  const cleanBody = String(body ?? "");
  if (cleanBody.length > BODY_MAX) return { error: `Keep the blog under ${BODY_MAX / 1000}k characters.` };
  const cleanStatus = BLOG_STATUSES.includes(status) ? status : "draft";
  if (cleanStatus === "published" && !cleanBody.trim()) {
    return { error: "Write something before publishing — save it as a draft to finish later." };
  }
  return { title: cleanTitle, body: cleanBody, status: cleanStatus };
}

/** ── public-blog mirror (best-effort by contract) ────────────────────────
   The writer's save never fails because a public mirror hiccuped; the next
   publish re-syncs anyway (upsert by slug). */
const mirrorBlog = async (userId, blog) => {
  try {
    const { data: u } = await db.from("users").select("full_name, username").eq("id", userId).maybeSingle();
    await syncPublishedBlogMirror(blog, u?.full_name || u?.username);
  } catch (e) { console.warn("[blogs] public mirror sync failed:", e.message); }
};
const unmirrorBlog = async (blog) => {
  try { await removeBlogMirror(blog.public_slug); }
  catch (e) { console.warn("[blogs] public mirror removal failed:", e.message); }
};

const CARD = "id, title, status, created_at, updated_at, published_at";

/** The author's posts, newest edit first (cards + excerpt). */
export async function listMyBlogs(userId) {
  const { data, error } = await edu().from("blogs")
    .select("id, title, status, created_at, updated_at, published_at, body")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return { error: "Could not load your blogs", status: 503 };
  return { blogs: (data ?? []).map((b) => ({
    id: b.id, title: b.title, status: b.status,
    excerpt: excerptOf(b.body),
    createdAt: b.created_at, updatedAt: b.updated_at, publishedAt: b.published_at,
  })) };
}

/** One post — the author reads any state; a published post reads by anyone.
    Returns { blog: {…, mine} } or { notFound: true } (drafts stay private). */
export async function getBlogFor(userId, id) {
  const { data, error } = await edu().from("blogs")
    .select("id, user_id, title, body, status, created_at, updated_at, published_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: "Could not load the blog", status: 503 };
  if (!data) return { notFound: true };
  if (data.status !== "published" && data.user_id !== userId) return { notFound: true }; // drafts are private
  const { user_id, ...rest } = data;
  return { blog: { ...rest, mine: data.user_id === userId } };
}

export async function createBlogPost(userId, input = {}) {
  const v = validateBlogInput(input);
  if (v.error) return { error: v.error };
  const now = new Date().toISOString();
  const { data, error } = await edu().from("blogs").insert({
    user_id: userId,
    title: v.title,
    body: v.body,
    status: v.status,
    published_at: v.status === "published" ? now : null,
    updated_at: now,
  }).select("*").single();
  if (error) return { error: "Could not save the blog", status: 503 };
  if (data.status === "published") await mirrorBlog(userId, data);
  return { blog: { id: data.id, title: data.title, status: data.status, created_at: data.created_at, updated_at: data.updated_at, published_at: data.published_at } };
}

/** Merge-validate the patch over the stored row, then write — publishing an
    empty-body post is impossible from any field shape. First publish stamps
    published_at; unpublish clears it; re-publish keeps the first date. */
export async function updateBlogPost(userId, id, patch = {}) {
  const { data: existing, error: findError } = await edu().from("blogs")
    .select("id, user_id, title, body, status, published_at, public_slug")
    .eq("id", id)
    .maybeSingle();
  if (findError) return { error: "Could not load the blog", status: 503 };
  if (!existing || existing.user_id !== userId) return { notFound: true };

  const v = validateBlogInput({
    title: patch.title !== undefined ? patch.title : existing.title,
    body: patch.body !== undefined ? patch.body : existing.body,
    status: patch.status !== undefined ? patch.status : existing.status,
  });
  if (v.error) return { error: v.error };

  const update = { updated_at: new Date().toISOString(), title: v.title, body: v.body, status: v.status };
  if (v.status !== existing.status) {
    update.published_at = v.status === "published"
      ? (existing.published_at ?? new Date().toISOString())   // first publish stamps; re-publish keeps the date
      : null;
  }

  const { data, error } = await edu().from("blogs").update(update)
    .eq("id", existing.id).eq("user_id", userId)
    .select("*").single();
  if (error) return { error: "Could not save the blog", status: 503 };

  if (v.status === "published") {
    // newly published, or edited while published — the mirror follows the post
    await mirrorBlog(userId, { ...data, public_slug: existing.public_slug });
  } else if (existing.status === "published" && v.status !== "published") {
    await unmirrorBlog(existing);            // unpublished → off the public blog
  }
  return { blog: { id: data.id, title: data.title, status: data.status, created_at: data.created_at, updated_at: data.updated_at, published_at: data.published_at } };
}

export async function deleteBlogPost(userId, id) {
  const { data: doomed, error: findError } = await edu().from("blogs")
    .select("id, public_slug").eq("id", id).eq("user_id", userId)
    .maybeSingle();
  if (findError) return { error: "Could not load the blog", status: 503 };
  if (!doomed) return { notFound: true };
  const { error } = await edu().from("blogs").delete().eq("id", doomed.id).eq("user_id", userId);
  if (error) return { error: "Could not delete the blog", status: 503 };
  if (doomed.public_slug) await unmirrorBlog(doomed);
  return { deleted: true };
}
