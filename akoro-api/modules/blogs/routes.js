/**
 * modules/blogs/routes.js — learner-authored blogs (higherEd library).
 *
 * A learner writes from the Library page's + menu: markdown-subset body
 * (the same subset the chat renders — no HTML anywhere), saved as a draft
 * or published. The author owns their post; a published post is readable
 * by any signed-in user (reading is what publish means), drafts stay
 * private to the author. Mounted at /api/blogs.
 */
import { Router } from "express";
import db from "../../db.js";
import { authenticateToken } from "../auth/routes.js";
import { syncPublishedBlogMirror, removeBlogMirror } from "./mirror.js";

const router = Router();
const edu = () => db.schema("edu");

const TITLE_MAX = 120;
const BODY_MAX = 50_000;
const EXCERPT_LEN = 140;
const BLOG_STATUSES = ["draft", "published"];

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const bad = (res, m) => res.status(400).json({ success: false, error: m });
const missing = (res, m = "Not found") => res.status(404).json({ success: false, error: m });

/** First meaningful line of the body, tags/markers left as written. */
/* ── public-blog mirror (best-effort by contract) ─────────────────────────
   The learner's save never fails because a public mirror hiccuped; the next
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

const excerptOf = (body) => {
  const line = String(body || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  return line.slice(0, EXCERPT_LEN) || null;
};

function validateBlogInput({ title, body, status }) {
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

/* GET /mine — the author's posts, newest edit first. */
router.get("/mine", authenticateToken, asyncHandler(async (req, res) => {
  const { data, error } = await edu().from("blogs")
    .select("id, title, status, created_at, updated_at, published_at, body")
    .eq("user_id", req.user.id)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return res.status(503).json({ success: false, error: "Could not load your blogs" });
  ok(res, (data ?? []).map((b) => ({
    id: b.id, title: b.title, status: b.status,
    excerpt: excerptOf(b.body),
    createdAt: b.created_at, updatedAt: b.updated_at, publishedAt: b.published_at,
  })));
}));

/* POST / — create a draft, or publish straight away. */
router.post("/", authenticateToken, asyncHandler(async (req, res) => {
  const v = validateBlogInput(req.body || {});
  if (v.error) return bad(res, v.error);
  const now = new Date().toISOString();
  const { data, error } = await edu().from("blogs").insert({
    user_id: req.user.id,
    title: v.title,
    body: v.body,
    status: v.status,
    published_at: v.status === "published" ? now : null,
    updated_at: now,
  }).select("*").single();
  if (error) return res.status(503).json({ success: false, error: "Could not save the blog" });
  if (data.status === "published") await mirrorBlog(req.user.id, data);
  ok(res, { id: data.id, title: data.title, status: data.status, created_at: data.created_at, updated_at: data.updated_at, published_at: data.published_at });
}));

/* GET /:id — the author reads any state; a published post reads by anyone. */
router.get("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const { data, error } = await edu().from("blogs")
    .select("id, user_id, title, body, status, created_at, updated_at, published_at")
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) return res.status(503).json({ success: false, error: "Could not load the blog" });
  if (!data) return missing(res, "Blog not found");
  if (data.status !== "published" && data.user_id !== req.user.id) {
    return missing(res, "Blog not found"); // drafts are private — 404, never 403
  }
  const { user_id, ...rest } = data;
  ok(res, { ...rest, mine: data.user_id === req.user.id });
}));

/* PATCH /:id — the author edits title/body and may publish or unpublish.
   The patch is merged over the stored row, then validated as a whole —
   so publishing an empty-body post is impossible from any field shape. */
router.patch("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const { data: existing, error: findError } = await edu().from("blogs")
    .select("id, user_id, title, body, status, published_at, public_slug")
    .eq("id", req.params.id)
    .maybeSingle();
  if (findError) return res.status(503).json({ success: false, error: "Could not load the blog" });
  if (!existing || existing.user_id !== req.user.id) return missing(res, "Blog not found");

  const v = validateBlogInput({
    title: req.body?.title !== undefined ? req.body.title : existing.title,
    body: req.body?.body !== undefined ? req.body.body : existing.body,
    status: req.body?.status !== undefined ? req.body.status : existing.status,
  });
  if (v.error) return bad(res, v.error);

  const patch = { updated_at: new Date().toISOString(), title: v.title, body: v.body, status: v.status };
  if (v.status !== existing.status) {
    patch.published_at = v.status === "published"
      ? (existing.published_at ?? new Date().toISOString())   // first publish stamps; re-publish keeps the date
      : null;
  }

  const { data, error } = await edu().from("blogs").update(patch)
    .eq("id", existing.id).eq("user_id", req.user.id)
    .select("*").single();
  if (error) return res.status(503).json({ success: false, error: "Could not save the blog" });

  if (v.status === "published") {
    // newly published, or edited while published — the mirror follows the post
    await mirrorBlog(req.user.id, { ...data, public_slug: existing.public_slug });
  } else if (existing.status === "published" && v.status !== "published") {
    await unmirrorBlog(existing);            // unpublished → off the public blog
  }

  ok(res, { id: data.id, title: data.title, status: data.status, created_at: data.created_at, updated_at: data.updated_at, published_at: data.published_at });
}));

/* DELETE /:id — the author only. */
router.delete("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const { data: doomed, error: findError } = await edu().from("blogs")
    .select("id, public_slug").eq("id", req.params.id).eq("user_id", req.user.id)
    .maybeSingle();
  if (findError) return res.status(503).json({ success: false, error: "Could not load the blog" });
  if (!doomed) return missing(res, "Blog not found");
  const { error } = await edu().from("blogs").delete().eq("id", doomed.id).eq("user_id", req.user.id);
  if (error) return res.status(503).json({ success: false, error: "Could not delete the blog" });
  if (doomed.public_slug) await unmirrorBlog(doomed);
  ok(res, { deleted: true });
}));

export default router;
