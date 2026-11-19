/**
 * modules/content/routes.js  —  Akoro Public-Site Content (Blog + Careers)
 *
 * Backs the public marketing pages (learner app /blog, /blog/:slug, /careers).
 * Data lives in the isolated `content` schema (see migrations/2026-content-schema.sql).
 *
 * Public (read + form intake):
 *   GET  /api/content/blog/posts                 list published posts (?category=&search=&limit=&offset=)
 *   GET  /api/content/blog/posts/featured        the featured published post
 *   GET  /api/content/blog/categories            categories with post counts
 *   GET  /api/content/blog/posts/:slug           single published post (+ related)
 *   POST /api/content/blog/subscribe             newsletter signup
 *   GET  /api/content/careers/departments        departments
 *   GET  /api/content/careers/jobs               open jobs grouped by department (?dept=)
 *   GET  /api/content/careers/jobs/:id           single open job
 *   POST /api/content/careers/jobs/:id/apply     submit application
 *
 * Admin (requires role=admin):
 *   POST   /api/content/admin/blog/posts         create post
 *   PUT    /api/content/admin/blog/posts/:id     update post
 *   DELETE /api/content/admin/blog/posts/:id     delete post
 *   GET    /api/content/admin/blog/subscribers   list subscribers
 *   POST   /api/content/admin/careers/departments        create department
 *   PUT    /api/content/admin/careers/departments/:id     update department
 *   DELETE /api/content/admin/careers/departments/:id     delete department
 *   POST   /api/content/admin/careers/jobs       create job
 *   PUT    /api/content/admin/careers/jobs/:id   update job
 *   DELETE /api/content/admin/careers/jobs/:id   delete job
 *   GET    /api/content/admin/careers/applications        list applications (?job_id=)
 *
 * Usage in app.js:
 *   import contentModule from "./modules/content/routes.js";
 *   app.use("/api/content", standardLimit, contentModule);
 */

import { Router }                         from "express";
import { body, validationResult }         from "express-validator";
import multerLib                          from "multer";
import { contentDb }                      from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { ensureBucket, uploadPublicFile } from "../school/templateStorage.js";

const router = Router();
const upload = multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const res404 = (res, msg = "Not found") => res.status(404).json({ success: false, message: msg });

const checkValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res400(res, errors.array()[0].msg); return false; }
  return true;
};

const adminOnly = [authenticateToken, requireRole(["admin"])];
// §7.14: a saved post's passages are re-indexed for the agent's blog search (after the response; never fails the save).
const reindexBlogPost = (postId) => { import("../../lib/blogResearch.js").then((m) => m.indexBlogPost({ postId })).catch(() => {}); };

// ════════════════════════════════════════════════════════════════════════════
//  BLOG — public
// ════════════════════════════════════════════════════════════════════════════

const BLOG_CARD_COLS = "id,slug,title,excerpt,category,image,author,author_role,read_min,featured,published_at";

// GET /blog/posts  — list published (card view, no body)
router.get("/blog/posts", asyncHandler(async (req, res) => {
  const { category, search } = req.query;
  const limit  = Math.min(parseInt(req.query.limit, 10) || 24, 100);
  const offset = parseInt(req.query.offset, 10) || 0;

  let q = contentDb.from("blog_posts")
    .select(BLOG_CARD_COLS, { count: "exact" })
    .eq("status", "published");

  if (category && category !== "All") q = q.eq("category", category);
  if (search) { const s = String(search).replace(/[,()%*:\\]/g, " "); q = q.or(`title.ilike.%${s}%,excerpt.ilike.%${s}%`); }

  q = q.order("published_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) throw error;
  return res200(res, data, { meta: { total: count, limit, offset } });
}));

// GET /blog/posts/featured
router.get("/blog/posts/featured", asyncHandler(async (req, res) => {
  const { data, error } = await contentDb.from("blog_posts")
    .select(BLOG_CARD_COLS)
    .eq("status", "published").eq("featured", true)
    .order("published_at", { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw error;
  return res200(res, data);
}));

// GET /blog/categories  — with counts
router.get("/blog/categories", asyncHandler(async (req, res) => {
  const { data, error } = await contentDb.from("blog_posts")
    .select("category").eq("status", "published");
  if (error) throw error;
  const counts = {};
  for (const r of data) counts[r.category] = (counts[r.category] || 0) + 1;
  const categories = Object.entries(counts).map(([name, count]) => ({ name, count }));
  return res200(res, categories);
}));

// GET /blog/posts/:slug  — full post + related
router.get("/blog/posts/:slug", asyncHandler(async (req, res) => {
  const { data: post, error } = await contentDb.from("blog_posts")
    .select("*")
    .eq("slug", req.params.slug).eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  if (!post) return res404(res, "Article not found");

  const { data: related } = await contentDb.from("blog_posts")
    .select(BLOG_CARD_COLS)
    .eq("status", "published").eq("category", post.category)
    .neq("id", post.id)
    .order("published_at", { ascending: false })
    .limit(2);

  return res200(res, { ...post, related: related || [] });
}));

// POST /blog/subscribe
router.post("/blog/subscribe",
  body("email").isEmail().withMessage("A valid email is required").normalizeEmail(),
  asyncHandler(async (req, res) => {
    if (!checkValidation(req, res)) return;
    const { email } = req.body;
    const source = (req.body.source || "blog").slice(0, 40);

    const { error } = await contentDb.from("blog_subscribers")
      .upsert({ email, source }, { onConflict: "email", ignoreDuplicates: true });
    if (error) throw error;
    return res201(res, { subscribed: true });
  }));

// ════════════════════════════════════════════════════════════════════════════
//  CAREERS — public
// ════════════════════════════════════════════════════════════════════════════

// GET /careers/departments
router.get("/careers/departments", asyncHandler(async (req, res) => {
  const { data, error } = await contentDb.from("job_departments")
    .select("id,name,color,sort")
    .order("sort", { ascending: true }).order("name", { ascending: true });
  if (error) throw error;
  return res200(res, data);
}));

// GET /careers/jobs  — open jobs grouped by department
router.get("/careers/jobs", asyncHandler(async (req, res) => {
  const { dept } = req.query;

  let q = contentDb.from("jobs")
    .select("id,title,location,type,summary,posted_at,department_id,job_departments(id,name,color,sort)")
    .eq("status", "open");
  const { data, error } = await q.order("posted_at", { ascending: false });
  if (error) throw error;

  // group by department
  const groups = new Map();
  for (const job of data) {
    const d = job.job_departments || { id: null, name: "Other", color: "#6B7280", sort: 999 };
    if (dept && dept !== "All" && d.name !== dept) continue;
    if (!groups.has(d.id)) groups.set(d.id, { dept: d.name, color: d.color, sort: d.sort ?? 0, jobs: [] });
    const { job_departments, department_id, ...rest } = job;
    groups.get(d.id).jobs.push(rest);
  }
  const result = [...groups.values()].sort((a, b) => a.sort - b.sort);
  return res200(res, result);
}));

// GET /careers/jobs/:id
router.get("/careers/jobs/:id", asyncHandler(async (req, res) => {
  const { data, error } = await contentDb.from("jobs")
    .select("*,job_departments(id,name,color)")
    .eq("id", req.params.id).eq("status", "open")
    .maybeSingle();
  if (error) throw error;
  if (!data) return res404(res, "Role not found");
  return res200(res, data);
}));

// POST /careers/jobs/:id/apply
router.post("/careers/jobs/:id/apply",
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("email").isEmail().withMessage("A valid email is required").normalizeEmail(),
  asyncHandler(async (req, res) => {
    if (!checkValidation(req, res)) return;
    const { id } = req.params;

    const { data: job } = await contentDb.from("jobs")
      .select("id").eq("id", id).eq("status", "open").maybeSingle();
    if (!job) return res404(res, "Role not found or no longer open");

    const { name, email, phone, linkedin, portfolio, message } = req.body;
    const { data, error } = await contentDb.from("job_applications")
      .insert({ job_id: id, name, email, phone, linkedin, portfolio, message })
      .select("id").single();
    if (error) throw error;
    return res201(res, { applicationId: data.id });
  }));

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN — blog
// ════════════════════════════════════════════════════════════════════════════

const blogWriteValidators = [
  body("slug").trim().notEmpty().withMessage("slug is required"),
  body("title").trim().notEmpty().withMessage("title is required"),
  body("category").trim().notEmpty().withMessage("category is required"),
  body("author").trim().notEmpty().withMessage("author is required"),
];

// POST /api/content/admin/blog/upload — upload a blog image, returns { url }.
router.post("/admin/blog/upload", ...adminOnly, upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res400(res, "No file provided");
    // Raster images only — SVG/HTML would be stored XSS on the public blog.
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(req.file.mimetype || "")) return res400(res, "Upload a PNG, JPG, WEBP or GIF image.");
    await ensureBucket().catch(() => {});
    const ext = (req.file.originalname?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `blog/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
    const url = await uploadPublicFile(path, req.file.buffer, req.file.mimetype);
    res201(res, { url });
  }));

router.post("/admin/blog/posts", adminOnly, blogWriteValidators,
  asyncHandler(async (req, res) => {
    if (!checkValidation(req, res)) return;
    const p = req.body;
    const row = {
      slug: p.slug, title: p.title, excerpt: p.excerpt, category: p.category,
      image: p.image, author: p.author, author_role: p.authorRole ?? p.author_role,
      read_min: p.readMin ?? p.read_min ?? 5, body: p.body ?? [],
      featured: !!p.featured, status: p.status || "draft",
      published_at: (p.status === "published") ? (p.publishedAt ?? new Date().toISOString()) : p.publishedAt ?? null,
    };
    const { data, error } = await contentDb.from("blog_posts").insert(row).select("*").single();
    if (error) return res400(res, error.message);
    reindexBlogPost(data.id);
    return res201(res, data);
  }));

router.patch("/admin/blog/posts/:id", adminOnly,
  asyncHandler(async (req, res) => {
    const p = req.body;
    const patch = {};
    for (const [k, col] of [
      ["slug","slug"],["title","title"],["excerpt","excerpt"],["category","category"],
      ["image","image"],["author","author"],["status","status"],["body","body"],
    ]) if (p[k] !== undefined) patch[col] = p[k];
    if (p.authorRole !== undefined || p.author_role !== undefined) patch.author_role = p.authorRole ?? p.author_role;
    if (p.readMin   !== undefined || p.read_min   !== undefined) patch.read_min   = p.readMin ?? p.read_min;
    if (p.featured  !== undefined) patch.featured = !!p.featured;
    if (p.publishedAt !== undefined) patch.published_at = p.publishedAt;
    if (p.status === "published" && p.publishedAt === undefined) {
      const { data: cur } = await contentDb.from("blog_posts").select("published_at").eq("id", req.params.id).maybeSingle();
      if (cur && !cur.published_at) patch.published_at = new Date().toISOString();
    }
    const { data, error } = await contentDb.from("blog_posts")
      .update(patch).eq("id", req.params.id).select("*").maybeSingle();
    if (error) return res400(res, error.message);
    if (!data) return res404(res);
    reindexBlogPost(data.id);
    return res200(res, data);
  }));

router.delete("/admin/blog/posts/:id", adminOnly,
  asyncHandler(async (req, res) => {
    const { error } = await contentDb.from("blog_posts").delete().eq("id", req.params.id);
    if (error) throw error;
    return res200(res, { deleted: true });
  }));

router.get("/admin/blog/subscribers", adminOnly,
  asyncHandler(async (req, res) => {
    const { data, error } = await contentDb.from("blog_subscribers")
      .select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return res200(res, data);
  }));

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN — careers
// ════════════════════════════════════════════════════════════════════════════

router.post("/admin/careers/departments", adminOnly,
  body("name").trim().notEmpty().withMessage("name is required"),
  asyncHandler(async (req, res) => {
    if (!checkValidation(req, res)) return;
    const { name, color, sort } = req.body;
    const { data, error } = await contentDb.from("job_departments")
      .insert({ name, color, sort: sort ?? 0 }).select("*").single();
    if (error) return res400(res, error.message);
    return res201(res, data);
  }));

router.patch("/admin/careers/departments/:id", adminOnly,
  asyncHandler(async (req, res) => {
    const patch = {};
    for (const k of ["name","color","sort"]) if (req.body[k] !== undefined) patch[k] = req.body[k];
    const { data, error } = await contentDb.from("job_departments")
      .update(patch).eq("id", req.params.id).select("*").maybeSingle();
    if (error) return res400(res, error.message);
    if (!data) return res404(res);
    return res200(res, data);
  }));

router.delete("/admin/careers/departments/:id", adminOnly,
  asyncHandler(async (req, res) => {
    const { error } = await contentDb.from("job_departments").delete().eq("id", req.params.id);
    if (error) throw error;
    return res200(res, { deleted: true });
  }));

router.post("/admin/careers/jobs", adminOnly,
  body("title").trim().notEmpty().withMessage("title is required"),
  asyncHandler(async (req, res) => {
    if (!checkValidation(req, res)) return;
    const p = req.body;
    const row = {
      department_id: p.departmentId ?? p.department_id ?? null,
      title: p.title, location: p.location, type: p.type || "Full-time",
      summary: p.summary, description: p.description, status: p.status || "open",
    };
    const { data, error } = await contentDb.from("jobs").insert(row).select("*").single();
    if (error) return res400(res, error.message);
    return res201(res, data);
  }));

router.patch("/admin/careers/jobs/:id", adminOnly,
  asyncHandler(async (req, res) => {
    const p = req.body;
    const patch = {};
    for (const [k, col] of [
      ["title","title"],["location","location"],["type","type"],
      ["summary","summary"],["description","description"],["status","status"],
    ]) if (p[k] !== undefined) patch[col] = p[k];
    if (p.departmentId !== undefined || p.department_id !== undefined) patch.department_id = p.departmentId ?? p.department_id;
    const { data, error } = await contentDb.from("jobs")
      .update(patch).eq("id", req.params.id).select("*").maybeSingle();
    if (error) return res400(res, error.message);
    if (!data) return res404(res);
    return res200(res, data);
  }));

router.delete("/admin/careers/jobs/:id", adminOnly,
  asyncHandler(async (req, res) => {
    const { error } = await contentDb.from("jobs").delete().eq("id", req.params.id);
    if (error) throw error;
    return res200(res, { deleted: true });
  }));

router.get("/admin/careers/applications", adminOnly,
  asyncHandler(async (req, res) => {
    let q = contentDb.from("job_applications").select("*,jobs(title)");
    if (req.query.job_id) q = q.eq("job_id", req.query.job_id);
    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw error;
    return res200(res, data);
  }));

export default router;
