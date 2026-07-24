/**
 * websiteTemplates.js — admin CRUD for the platform website-template catalogue
 * (edu.platform_website_templates). Lets platform admins add / edit / delete
 * templates and set the default that schools see first. Mounted under /api/admin.
 */
import { Router } from "express";
import multer from "multer";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }).single("file");

const shape = (t) => ({
  id: t.id, name: t.name, description: t.description, html: t.html,
  importPayload: t.import_payload || null, thumbnailUrl: t.thumbnail_url || null,
  isDefault: t.is_default, isPublished: t.is_published, sortOrder: t.sort_order,
  updatedAt: t.updated_at,
});

// GET /api/admin/website-templates
router.get("/website-templates", adminOnly, async (_req, res) => {
  try {
    const { data, error } = await db.schema("edu").from("platform_website_templates")
      .select("*").order("is_default", { ascending: false }).order("sort_order").order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: (data || []).map(shape) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/website-templates  { name, description?, html?, importPayload?, isPublished? }
router.post("/website-templates", adminOnly, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    const { data, error } = await db.schema("edu").from("platform_website_templates").insert({
      name, description: req.body?.description || "", html: req.body?.html || "",
      import_payload: req.body?.importPayload || null, is_published: req.body?.isPublished !== false,
    }).select("*").single();
    if (error) { if (error.code === "23505") return res.status(409).json({ error: "A template with that name already exists" }); throw error; }
    res.status(201).json({ success: true, data: shape(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/website-templates/upload  (multipart: file=.html, name, description)
router.post("/website-templates/upload", ...adminOnly, (req, res) => {
  upload(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: "Choose an .html file" });
      const fname = (req.file.originalname || "").toLowerCase();
      if (!fname.endsWith(".html") && !fname.endsWith(".htm") && req.file.mimetype !== "text/html")
        return res.status(400).json({ error: "Only .html files are supported here. Paste HTML for anything else." });
      const html = req.file.buffer.toString("utf8");
      const name = String(req.body?.name || "").trim() || req.file.originalname.replace(/\.(html?|HTML?)$/, "");
      const { data, error } = await db.schema("edu").from("platform_website_templates").insert({
        name, description: req.body?.description || "", html, is_published: true,
      }).select("*").single();
      if (error) { if (error.code === "23505") return res.status(409).json({ error: "A template with that name already exists" }); throw error; }
      res.status(201).json({ success: true, data: shape(data) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

// PUT /api/admin/website-templates/:id
router.put("/website-templates/:id", adminOnly, async (req, res) => {
  try {
    const patch = {};
    for (const k of ["name", "description", "html"]) if (req.body[k] != null) patch[k] = req.body[k];
    if (req.body.isPublished != null) patch.is_published = !!req.body.isPublished;
    if (req.body.sortOrder != null) patch.sort_order = Number(req.body.sortOrder) || 0;
    if (req.body.importPayload !== undefined) patch.import_payload = req.body.importPayload;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await db.schema("edu").from("platform_website_templates")
      .update(patch).eq("id", req.params.id).select("*").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Template not found" });
    res.json({ success: true, data: shape(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/website-templates/:id/default  — make it the one default.
router.post("/website-templates/:id/default", adminOnly, async (req, res) => {
  try {
    await db.schema("edu").from("platform_website_templates").update({ is_default: false }).neq("id", req.params.id);
    const { data, error } = await db.schema("edu").from("platform_website_templates")
      .update({ is_default: true, is_published: true, updated_at: new Date().toISOString() })
      .eq("id", req.params.id).select("*").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Template not found" });
    res.json({ success: true, data: shape(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/website-templates/:id
router.delete("/website-templates/:id", adminOnly, async (req, res) => {
  try {
    const { error } = await db.schema("edu").from("platform_website_templates").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
