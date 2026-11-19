/**
 * modules/blogs/routes.js — learner-authored blogs (higherEd library).
 *
 * Thin REST handlers over service.js (the ONE write path the agent's chat
 * tools also share). A learner writes from the Library page's + menu:
 * markdown-subset body (no HTML anywhere), saved as a draft or published.
 * The author owns their post; a published post is readable by any signed-in
 * user; drafts stay private. Mounted at /api/blogs.
 */
import { Router } from "express";
import { authenticateToken } from "../auth/index.js";
import { listMyBlogs, getBlogFor, createBlogPost, updateBlogPost, deleteBlogPost } from "./service.js";

const router = Router();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const bad = (res, m, status = 400) => res.status(status).json({ success: false, error: m });
const missing = (res, m = "Not found") => res.status(404).json({ success: false, error: m });

/* GET /mine — the author's posts, newest edit first. */
router.get("/mine", authenticateToken, asyncHandler(async (req, res) => {
  const { blogs, error, status } = await listMyBlogs(req.user.id);
  if (error) return bad(res, error, status ?? 503);
  ok(res, blogs);
}));

/* POST / — create a draft, or publish straight away. */
router.post("/", authenticateToken, asyncHandler(async (req, res) => {
  const { blog, error, status } = await createBlogPost(req.user.id, req.body || {});
  if (error) return bad(res, error, status ?? 400);
  ok(res, blog);
}));

/* GET /:id — the author reads any state; a published post reads by anyone. */
router.get("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const { blog, error, status, notFound: gone } = await getBlogFor(req.user.id, req.params.id);
  if (gone) return missing(res, "Blog not found");
  if (error) return bad(res, error, status ?? 503);
  ok(res, blog);
}));

/* PATCH /:id — the author edits title/body and may publish or unpublish. */
router.patch("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const { blog, error, status, notFound: gone } = await updateBlogPost(req.user.id, req.params.id, req.body || {});
  if (gone) return missing(res, "Blog not found");
  if (error) return bad(res, error, status ?? 400);
  ok(res, blog);
}));

/* DELETE /:id — the author only. */
router.delete("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const { deleted, error, status, notFound: gone } = await deleteBlogPost(req.user.id, req.params.id);
  if (gone) return missing(res, "Blog not found");
  if (error) return bad(res, error, status ?? 503);
  ok(res, { deleted });
}));

export default router;
