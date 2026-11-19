/**
 * modules/school/service-website.js — website settings, templates and the
 * authenticated pixel-perfect previews.
 *
 * Rendering context comes from service-site.js so the preview and the public
 * site cannot drift; queries live in store-site.js.
 */

import { renderMiniTemplate, renderThemePage, renderSitePage } from "./siteRenderer.js";
import { assembleTemplateFromZip, ensureResponsiveViewport } from "./templateZip.js";
import { ensureBucket, uploadZipToStorage, removeTemplateAssets } from "./templateStorage.js";
import { DEFAULT_TEMPLATES, getDefaultTemplate } from "./defaultTemplates/index.js";
import { SITE_BASE_DOMAIN } from "./tenant.js";
import * as store from "./store.js";
import * as siteStore from "./store-site.js";
import {
  WEBSITE_FIELD_MAP, shapeWebsite, isFullDocument, parseTemplateColorVars, templateColorStyle,
} from "./rules.js";
import { getMySchool, ensureSchoolSlug } from "./service.js";
import { getWebsiteConfig, buildSiteCtx, syncAiChatPage } from "./service-site.js";

// ── POST /api/school/website/preview-page  (AUTH — pixel-perfect draft preview) ─
// Renders draft page content through the REAL site renderer (same chrome,
// menus, theme, colours, custom CSS as production) so the editor's live
// preview matches the published page exactly. Body: { title, content, slug }.
export async function previewPage(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const website = await getWebsiteConfig(school.id);
    const ctx = await buildSiteCtx(school, website);
    const page = { title: req.body.title || "Untitled", content: req.body.content || "", slug: req.body.slug || "" };
    res.json({ success: true, html: renderSitePage(website, ctx, page, { hideTitle: page.slug === "home" }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/website/preview-site  (AUTH — pixel-perfect appearance) ──
// Renders the LANDING page with DRAFT appearance settings (colours, hero,
// sections, SEO, scripts, social, custom CSS) merged over the saved config —
// so the Appearance editor previews changes live before saving. Body: the same
// camelCase fields as PUT /website.
export async function previewSite(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const draft = { ...(await getWebsiteConfig(school.id)) };
    for (const [k, col] of Object.entries(WEBSITE_FIELD_MAP)) if (req.body[k] !== undefined) draft[col] = req.body[k];
    const ctx = await buildSiteCtx(school, draft);
    let html;
    if (draft.mode === "template") {
      const { data: tpl } = await siteStore.activeTemplateHtml(school.id);
      html = tpl?.html ? renderMiniTemplate(tpl.html, ctx) : renderThemePage(draft, ctx);
    } else {
      // Mirror the LIVE renderer: a published "home" page (e.g. an activated
      // template's landing) overrides the theme sections — so the Appearance
      // preview shows what visitors actually see, not the stale theme page.
      const { data: home } = await siteStore.homePage(school.id);
      if (home && home.status === "published" && !home.deleted_at) {
        if (isFullDocument(home.content)) {
          html = home.content;
          const brand = templateColorStyle(draft.template_colors);
          if (brand) html = html.includes("</head>") ? html.replace("</head>", `${brand}\n</head>`) : brand + html;
        } else {
          html = renderSitePage(draft, ctx, home, { hideTitle: true });
        }
      } else {
        html = renderThemePage(draft, ctx);
      }
    }
    res.json({ success: true, html });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── GET /api/school/website ────────────────────────────────────────────────────
export async function getWebsite(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const website = await getWebsiteConfig(school.id);
    const slug = await ensureSchoolSlug(school); // persist a real slug so previews resolve
    // Public site URL is the wildcard subdomain of the base domain, e.g.
    // https://<slug>.akoro.name.ng — not the API host. A verified custom
    // domain, if any, takes precedence as the primary URL.
    const { data: dom } = await store.verifiedDomainFirst(school.id);
    const defaultDomain = `${slug}.${SITE_BASE_DOMAIN}`;
    const siteUrl = `https://${dom?.domain || defaultDomain}`;
    // Template detection for the Appearance page: when a published
    // full-document "home" page drives the landing, the theme-only controls
    // (hero, about, sections, colours) don't affect the site.
    const { data: home } = await siteStore.homePage(school.id, "content, status, deleted_at");
    const homeIsDocument = !!(home && home.status === "published" && !home.deleted_at && isFullDocument(home.content));
    const templateColorVars = homeIsDocument ? parseTemplateColorVars(home.content) : [];
    res.json({ success: true, data: { ...shapeWebsite(website), slug, defaultDomain, customDomain: dom?.domain || null, siteUrl, homeIsDocument, templateColorVars } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PUT /api/school/website ─────────────────────────────────────────────────────
export async function updateWebsite(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    await getWebsiteConfig(school.id); // ensure row exists
    const b = req.body || {};
    const patch = { updated_at: new Date() };
    for (const [k, col] of Object.entries(WEBSITE_FIELD_MAP)) if (b[k] !== undefined) patch[col] = b[k];
    const { data, error } = await siteStore.websiteUpdate(school.id, patch);
    if (error) throw new Error(error.message);
    // Sync AI Bot toggle: add the "AI Chat" page to the site when turned on,
    // move it to Trash when turned off.
    if (b.aiChatEnabled !== undefined) await syncAiChatPage(school.id, !!b.aiChatEnabled);
    res.json({ success: true, data: shapeWebsite(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── GET /api/school/website/templates ───────────────────────────────────────────
export async function listTemplates(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await siteStore.websiteTemplatesBySchool(school.id);
    const own = (data || []).map((t) => ({ id: t.id, name: t.name, description: t.description, active: t.is_active, updatedAt: t.updated_at, importable: !!t.import_payload }));
    // Shared gallery: admin-managed platform templates + the built-in defaults.
    const ownNames = new Set(own.map((t) => t.name));
    const { data: plat } = await siteStore.platformTemplatesPublished();
    const platform = (plat || [])
      .filter((t) => !ownNames.has(t.name))
      .map((t) => ({ id: `platform:${t.id}`, name: t.name, description: t.description, active: false, updatedAt: null, importable: !!(t.import_payload && (t.import_payload.pages?.length || t.import_payload.menu?.length)), isDefault: true, recommended: t.is_default }));
    const platNames = new Set((plat || []).map((t) => t.name));
    const defaults = DEFAULT_TEMPLATES
      .filter((t) => !ownNames.has(t.name) && !platNames.has(t.name)) // hide once installed or overridden
      .map((t) => ({ id: `default:${t.id}`, name: t.name, description: t.description, active: false, updatedAt: null, importable: !!(t.importPayload && (t.importPayload.pages?.length || t.importPayload.menu?.length)), isDefault: true }));
    res.json({ success: true, data: [...own, ...platform, ...defaults] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Clone a default template into the school's own templates (idempotent by name)
// and return the school-owned id. Non-default ids pass through unchanged.
async function ensureSchoolTemplate(school, id) {
  let def = null;
  if (String(id).startsWith("default:")) {
    def = getDefaultTemplate(String(id).slice("default:".length));
  } else if (String(id).startsWith("platform:")) {
    const { data } = await siteStore.platformTemplateImport(String(id).slice("platform:".length));
    if (data) def = { name: data.name, description: data.description, html: data.html, importPayload: data.import_payload || null };
  } else {
    return id; // already a school-owned template id
  }
  if (!def) return null;
  const { data: existing } = await siteStore.schoolTemplateByName(school.id, def.name);
  if (existing) return existing.id;
  const { data: row, error } = await siteStore.schoolTemplateInsertId({
    school_id: school.id, name: def.name, description: def.description, html: def.html, import_payload: def.importPayload || null, is_active: false,
  });
  if (error) throw new Error(error.message);
  return row.id;
}

// ── GET /api/school/website/templates/:id ───────────────────────────────────────
export async function getTemplate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    if (String(req.params.id).startsWith("default:")) {
      const def = getDefaultTemplate(String(req.params.id).slice("default:".length));
      if (!def) return res.status(404).json({ error: "Template not found" });
      return res.json({ success: true, data: { id: req.params.id, name: def.name, description: def.description, html: def.html, active: false, isDefault: true } });
    }
    if (String(req.params.id).startsWith("platform:")) {
      const { data: p } = await siteStore.platformTemplateById(String(req.params.id).slice("platform:".length));
      if (!p) return res.status(404).json({ error: "Template not found" });
      return res.json({ success: true, data: { id: req.params.id, name: p.name, description: p.description, html: p.html, active: false, isDefault: true } });
    }
    const { data } = await siteStore.schoolTemplateById(school.id, req.params.id);
    if (!data) return res.status(404).json({ error: "Template not found" });
    res.json({ success: true, data: { id: data.id, name: data.name, description: data.description, html: data.html, active: data.is_active, updatedAt: data.updated_at } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/website/templates ──────────────────────────────────────────
// Body: { name, description?, html? }
export async function createTemplate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { name, description = "", html = "" } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const { data, error } = await siteStore.schoolTemplateInsertFull({
      school_id: school.id, name: name.trim(), description, html: ensureResponsiveViewport(html),
    });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data: { id: data.id, name: data.name, description: data.description, html: data.html, active: data.is_active, updatedAt: data.updated_at } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/website/templates/upload  (.zip or .html) ──────────────────
// Multipart field "file". A .zip is unpacked into one self-contained HTML
// (CSS/JS/images inlined); a .html/.htm is stored as-is.
export async function uploadTemplate(req, res, uploadErr) {
  try {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    const school = await getMySchool(req, res);
    if (!school) return;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const original = req.file.originalname || "template";
    const isZip = /\.zip$/i.test(original) || req.file.mimetype === "application/zip";
    const name = (req.body.name?.trim()) || original.replace(/\.(zip|html?|txt)$/i, "") || "Uploaded template";
    const description = req.body.description || "Uploaded template";

    // Plain HTML — store as-is.
    if (!isZip) {
      const html = req.file.buffer.toString("utf-8");
      if (!/<[a-z!]/i.test(html)) return res.status(400).json({ error: "No HTML content found in the upload." });
      const { data, error } = await siteStore.schoolTemplateInsertFull({
        school_id: school.id, name, description, html,
      });
      if (error) throw new Error(error.message);
      return res.status(201).json({ success: true, data: { id: data.id, name: data.name, active: data.is_active } });
    }

    // Zip — host assets in Storage (real files), fall back to inlining if
    // Storage is unavailable. Insert first so we have an id for the folder.
    const { data: created, error: insErr } = await siteStore.schoolTemplateInsertId({
      school_id: school.id, name, description, html: "",
    });
    if (insErr) throw new Error(insErr.message);

    let html, importPayload = null, hosting = "storage";
    try {
      await ensureBucket();
      ({ html, importPayload } = await uploadZipToStorage(req.file.buffer, { schoolId: school.id, templateId: created.id }));
    } catch (storageErr) {
      console.warn("[template upload] storage failed, inlining:", storageErr.message);
      try { ({ html } = assembleTemplateFromZip(req.file.buffer)); hosting = "inline"; }
      catch (zipErr) {
        await siteStore.schoolTemplateDelete(school.id, created.id);
        return res.status(400).json({ error: `Could not read the zip: ${zipErr.message}` });
      }
    }
    await siteStore.schoolTemplateUpdateRaw(created.id, { html: ensureResponsiveViewport(html), import_payload: importPayload });
    res.status(201).json({ success: true, data: { id: created.id, name, active: false, importable: !!importPayload }, hosting });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PUT /api/school/website/templates/:id ───────────────────────────────────────
// Body: { name?, description?, html? }
export async function updateTemplate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const patch = { updated_at: new Date() };
    if (req.body.name !== undefined) patch.name = req.body.name;
    if (req.body.description !== undefined) patch.description = req.body.description;
    if (req.body.html !== undefined) patch.html = ensureResponsiveViewport(req.body.html);
    const { data, error } = await siteStore.schoolTemplateUpdate(school.id, req.params.id, patch);
    if (error) throw new Error(error.message);
    res.json({ success: true, data: { id: data.id, name: data.name, description: data.description, html: data.html, active: data.is_active, updatedAt: data.updated_at } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/website/templates/:id/activate ─────────────────────────────
export async function activateTemplate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const templateId = await ensureSchoolTemplate(school, req.params.id); // clone if it's a default
    if (!templateId) return res.status(404).json({ error: "Template not found" });
    const { data: tpl } = await siteStore.schoolTemplateId(school.id, templateId);
    if (!tpl) return res.status(404).json({ error: "Template not found" });
    await siteStore.schoolTemplatesDeactivate(school.id);
    await siteStore.schoolTemplateActivate(templateId);
    await siteStore.websiteSetMode(school.id, "template");
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/website/templates/:id/import  (template → builder) ─────────
// Creates real builder content from the template's stashed import payload:
//   • a published "home" page from the zip's index.html (rendered as landing)
//   • one published site_page per extra .html (existing slugs kept)
//   • a Primary menu built from the template's nav (any current primary menu
//     is unassigned, not deleted)
// The site switches to builder ('theme') mode: home + pages render through
// the builder chrome, so EVERYTHING — content, links, appearance — is edited
// in Pages / Menus / Appearance. Idempotent: existing slugs are skipped.
export async function importTemplate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const templateId = await ensureSchoolTemplate(school, req.params.id); // clone if it's a default
    if (!templateId) return res.status(404).json({ error: "Template not found" });
    const { data: tpl } = await siteStore.schoolTemplateImportRow(school.id, templateId);
    if (!tpl) return res.status(404).json({ error: "Template not found" });
    const payload = tpl.import_payload;
    if (!payload || (!payload.pages?.length && !payload.menu?.length)) {
      return res.status(400).json({ error: "This template has no importable pages or menu (single-page upload)." });
    }

    // 1) Pages — upsert by slug. Existing pages are OVERWRITTEN with the
    // template's full-fidelity documents (and un-trashed / re-published), so
    // re-importing heals pages broken by older stripped imports. blocks is
    // cleared so the page opens in the visual editor, not the block editor.
    const { data: existing } = await siteStore.pagesBySchool(school.id);
    const idBySlug = Object.fromEntries((existing || []).map((p) => [p.slug, p.id]));
    let pagesCreated = 0, pagesUpdated = 0;
    for (const [i, p] of (payload.pages || []).entries()) {
      if (!p.slug) continue;
      const body = { title: p.title || p.slug, content: p.content || "", blocks: [], status: "published", sort_order: i, deleted_at: null };
      if (idBySlug[p.slug]) {
        const { error } = await siteStore.pageUpdate(idBySlug[p.slug], body);
        if (error) throw new Error(error.message);
        pagesUpdated++;
      } else {
        const { data: row, error } = await siteStore.pageInsert({ ...body, school_id: school.id, slug: p.slug });
        if (error) throw new Error(error.message);
        idBySlug[row.slug] = row.id;
        pagesCreated++;
      }
    }

    // 1b) Activating a template REPLACES the site: every page that isn't part
    // of the new template is moved to Trash (soft delete — recoverable from
    // Pages → Trash), so stale pages from a previous template never linger in
    // the Pages list or stay reachable on the live site.
    let pagesRemoved = 0;
    const keepSlugs = new Set((payload.pages || []).map((p) => p.slug).filter(Boolean));
    const stale = (existing || []).filter((p) => !keepSlugs.has(p.slug));
    if (stale.length) {
      const { error: trashErr } = await siteStore.pagesTrash(stale.map((p) => p.id));
      if (trashErr) throw new Error(trashErr.message);
      pagesRemoved = stale.length;
    }

    // 2) Menus — the new template's menu replaces ALL existing menus (old
    // template menus, unassigned leftovers), so the Menus builder shows only
    // the active template's navigation.
    let menuItems = 0;
    if (payload.menu?.length) {
      const menuName = `${tpl.name} Menu`;
      const { data: oldMenus } = await siteStore.menuIdsBySchool(school.id);
      for (const m of oldMenus || []) {
        await siteStore.menuItemsDelete(m.id);
        await siteStore.menuDelete(m.id);
      }
      const { data: menu, error: menuErr } = await siteStore.menuInsert({ school_id: school.id, name: menuName, location: "primary" });
      if (menuErr) throw new Error(menuErr.message);
      const rows = payload.menu.map((it, i) => ({
        school_id: school.id, menu_id: menu.id, label: it.label,
        page_id: it.slug ? (idBySlug[it.slug] || null) : null,
        url: it.url || (it.slug && !idBySlug[it.slug] ? "#" : null),
        parent_label: it.parent || null,
        target: "_self", sort_order: i,
      })).filter((r) => r.page_id || r.url);
      if (rows.length) {
        const { error } = await siteStore.menuItemsInsert(rows);
        if (error) throw new Error(error.message);
        menuItems = rows.length;
      }
    }

    // 3) Mark this template as the source and switch to builder mode — the
    // imported "home" page is a full document, served raw as the landing.
    await siteStore.schoolTemplatesDeactivate(school.id);
    await siteStore.schoolTemplateActivate(tpl.id);
    await siteStore.websiteSetMode(school.id, "theme");

    res.json({ success: true, pagesCreated, pagesUpdated, pagesRemoved, menuItems });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── DELETE /api/school/website/templates/:id ─────────────────────────────────────
export async function deleteTemplate(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await siteStore.schoolTemplateDelete(school.id, req.params.id);
    if (error) throw new Error(error.message);
    await removeTemplateAssets(school.id, req.params.id); // best-effort storage cleanup
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
