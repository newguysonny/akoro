/**
 * websiteTemplates.js — admin CRUD for the platform website-template catalogue
 * (edu.platform_website_templates). Lets platform admins add / edit / delete
 * templates and set the default that schools see first. Mounted under /api/admin.
 */
import { Router } from "express";
import multer from "multer";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/index.js";
import { assembleMultiPageFromZip, ensureResponsiveViewport } from "../school/templateZip.js";
import { DEFAULT_TEMPLATES, getDefaultTemplate } from "../school/defaultTemplates/index.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }).single("file");

// List rows omit the (potentially large) html; preview fetches the full row.
const shape = (t, withHtml = false) => ({
  id: t.id, name: t.name, description: t.description,
  ...(withHtml ? { html: t.html } : { hasHtml: !!(t.html && t.html.length) }),
  importPayload: t.import_payload || null, thumbnailUrl: t.thumbnail_url || null,
  multiPage: !!(t.import_payload && (t.import_payload.pages?.length || 0) > 1),
  pageCount: t.import_payload?.pages?.length || 1,
  isDefault: t.is_default, isPublished: t.is_published, sortOrder: t.sort_order,
  updatedAt: t.updated_at,
});

// A built-in code default (DEFAULT_TEMPLATES) shaped like a list row. It's
// read-only: schools already see it in the gallery, but it has no DB row, so
// it can't be edited / set-default / deleted until "imported" into the table.
const shapeDefault = (t) => ({
  id: `default:${t.id}`, name: t.name, description: t.description || "",
  hasHtml: !!(t.html && t.html.length), importPayload: t.importPayload || null,
  thumbnailUrl: null,
  multiPage: !!(t.importPayload && (t.importPayload.pages?.length || 0) > 1),
  pageCount: t.importPayload?.pages?.length || 1,
  isDefault: false, isPublished: true, sortOrder: 0, updatedAt: null,
  builtIn: true,
});

// GET /api/admin/website-templates
// Returns the DB-managed platform templates PLUS the built-in code defaults
// (read-only) so the admin sees the full gallery schools can browse — not an
// empty table when nothing has been added to the DB yet.
router.get("/website-templates", adminOnly, async (_req, res) => {
  try {
    const { data, error } = await db.schema("edu").from("platform_website_templates")
      .select("id, name, description, import_payload, thumbnail_url, is_default, is_published, sort_order, updated_at, html")
      .order("is_default", { ascending: false }).order("sort_order").order("created_at", { ascending: false });
    if (error) throw error;
    const rows = (data || []).map((t) => shape(t));
    const dbNames = new Set(rows.map((t) => t.name));
    // Built-ins whose name isn't already overridden by a DB row.
    const builtIns = DEFAULT_TEMPLATES.filter((t) => !dbNames.has(t.name)).map(shapeDefault);
    res.json({ success: true, data: [...rows, ...builtIns] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/website-templates/:id  (full row incl. html, for preview)
// Handles both DB rows and built-in "default:<id>" entries.
router.get("/website-templates/:id", adminOnly, async (req, res) => {
  try {
    if (String(req.params.id).startsWith("default:")) {
      const def = getDefaultTemplate(String(req.params.id).slice("default:".length));
      if (!def) return res.status(404).json({ error: "Template not found" });
      return res.json({ success: true, data: { ...shapeDefault(def), html: def.html || "" } });
    }
    const { data, error } = await db.schema("edu").from("platform_website_templates").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Template not found" });
    res.json({ success: true, data: shape(data, true) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/website-templates/import-default  { id: "default:<id>" }
// Copy a built-in default into the DB table so it becomes editable / can be
// set as the default. Idempotent by name.
router.post("/website-templates/import-default", adminOnly, async (req, res) => {
  try {
    const raw = String(req.body?.id || "");
    const def = getDefaultTemplate(raw.startsWith("default:") ? raw.slice("default:".length) : raw);
    if (!def) return res.status(404).json({ error: "Built-in template not found" });
    const { data: existing } = await db.schema("edu").from("platform_website_templates")
      .select("*").eq("name", def.name).maybeSingle();
    if (existing) return res.json({ success: true, data: shape(existing), alreadyImported: true });
    const { data, error } = await db.schema("edu").from("platform_website_templates").insert({
      name: def.name, description: def.description || "", html: ensureResponsiveViewport(def.html || ""),
      import_payload: def.importPayload || null, is_published: true,
    }).select("*").single();
    if (error) { if (error.code === "23505") return res.status(409).json({ error: "A template with that name already exists" }); throw error; }
    res.status(201).json({ success: true, data: shape(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/website-templates  { name, description?, html?, importPayload?, isPublished? }
router.post("/website-templates", adminOnly, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    const { data, error } = await db.schema("edu").from("platform_website_templates").insert({
      name, description: req.body?.description || "", html: ensureResponsiveViewport(req.body?.html || ""),
      import_payload: req.body?.importPayload || null, is_published: req.body?.isPublished !== false,
    }).select("*").single();
    if (error) { if (error.code === "23505") return res.status(409).json({ error: "A template with that name already exists" }); throw error; }
    res.status(201).json({ success: true, data: shape(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/website-templates/upload  (multipart: file=.html or .zip)
// A .zip is inlined into one self-contained HTML (CSS/JS/images embedded); a
// .html/.htm is stored as-is.
router.post("/website-templates/upload", ...adminOnly, (req, res) => {
  upload(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: "Choose an .html or .zip file" });
      const fname = (req.file.originalname || "").toLowerCase();
      const isZip = /\.zip$/i.test(fname) || req.file.mimetype === "application/zip" || req.file.mimetype === "application/x-zip-compressed";
      const isHtml = /\.html?$/i.test(fname) || req.file.mimetype === "text/html";
      if (!isZip && !isHtml) return res.status(400).json({ error: "Upload an .html or .zip file (paste HTML for anything else)." });

      let html, importPayload = null;
      if (isZip) {
        // Multi-page: every .html → a page, plus a nav menu with inter-page
        // links rewritten to slugs. Single-page zips yield one page + html.
        try { ({ html, importPayload = null } = assembleMultiPageFromZip(req.file.buffer)); }
        catch (e) { return res.status(400).json({ error: `Could not read that .zip: ${e.message}` }); }
        // A one-page zip needs no import payload (nothing to link).
        if (importPayload && (importPayload.pages?.length || 0) <= 1) importPayload = null;
      } else {
        html = ensureResponsiveViewport(req.file.buffer.toString("utf8"));
      }
      if (!html?.trim()) return res.status(400).json({ error: "No HTML found in the upload." });

      const name = String(req.body?.name || "").trim() || req.file.originalname.replace(/\.(zip|html?)$/i, "") || "Uploaded template";
      const { data, error } = await db.schema("edu").from("platform_website_templates").insert({
        name, description: req.body?.description || "", html, import_payload: importPayload, is_published: true,
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
