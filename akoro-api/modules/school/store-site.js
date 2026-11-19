/**
 * modules/school/store-site.js — Supabase queries for the public site and
 * website builder: edu.school_website, edu.school_website_templates,
 * edu.platform_website_templates, mgmt.site_pages/site_menus/site_menu_items,
 * notices, events and admission settings. No Express import.
 */

import db from "../../db.js";

const edu = () => db.schema("edu");
const mgmt = () => db.schema("mgmt");

// ── edu.school_website ───────────────────────────────────────────────────────
export const websiteBySchool = (schoolId) => edu()
  .from("school_website").select("*").eq("school_id", schoolId).maybeSingle();

export const websiteCreate = (schoolId) => edu()
  .from("school_website").insert({ school_id: schoolId }).select("*").single();

export const websiteUpdate = (schoolId, patch) => edu()
  .from("school_website").update(patch).eq("school_id", schoolId).select("*").single();

export const websiteSetMode = (schoolId, mode) => edu()
  .from("school_website").update({ mode, updated_at: new Date() }).eq("school_id", schoolId);

// ── edu.school_website_templates ─────────────────────────────────────────────
export const websiteTemplatesBySchool = (schoolId) => edu()
  .from("school_website_templates")
  .select("id, name, description, is_active, updated_at, import_payload")
  .eq("school_id", schoolId).order("updated_at", { ascending: false });

export const platformTemplatesPublished = () => edu()
  .from("platform_website_templates")
  .select("id, name, description, is_default, import_payload").eq("is_published", true)
  .order("is_default", { ascending: false }).order("sort_order");

export const platformTemplateById = (templateId) => edu()
  .from("platform_website_templates")
  .select("name, description, html").eq("id", templateId).maybeSingle();

export const platformTemplateImport = (templateId) => edu()
  .from("platform_website_templates")
  .select("name, description, html, import_payload").eq("id", templateId).maybeSingle();

export const schoolTemplateByName = (schoolId, name) => edu()
  .from("school_website_templates").select("id").eq("school_id", schoolId).eq("name", name).maybeSingle();

export const schoolTemplateInsertId = (row) => edu()
  .from("school_website_templates").insert(row).select("id").single();

export const schoolTemplateInsertFull = (row) => edu()
  .from("school_website_templates").insert(row).select("*").single();

export const schoolTemplateById = (schoolId, templateId) => edu()
  .from("school_website_templates").select("*").eq("id", templateId).eq("school_id", schoolId).maybeSingle();

export const schoolTemplateId = (schoolId, templateId) => edu()
  .from("school_website_templates").select("id").eq("id", templateId).eq("school_id", schoolId).maybeSingle();

export const schoolTemplateImportRow = (schoolId, templateId) => edu()
  .from("school_website_templates")
  .select("id, name, import_payload").eq("id", templateId).eq("school_id", schoolId).maybeSingle();

export const schoolTemplateUpdate = (schoolId, templateId, patch) => edu()
  .from("school_website_templates")
  .update(patch).eq("id", templateId).eq("school_id", schoolId).select("*").single();

export const schoolTemplateUpdateRaw = (templateId, patch) => edu()
  .from("school_website_templates").update(patch).eq("id", templateId);

export const schoolTemplateDelete = (schoolId, templateId) => edu()
  .from("school_website_templates").delete().eq("id", templateId).eq("school_id", schoolId);

export const schoolTemplatesDeactivate = (schoolId) => edu()
  .from("school_website_templates").update({ is_active: false }).eq("school_id", schoolId);

export const schoolTemplateActivate = (templateId) => edu()
  .from("school_website_templates").update({ is_active: true }).eq("id", templateId);

export const activeTemplateHtml = (schoolId) => edu()
  .from("school_website_templates").select("html").eq("school_id", schoolId).eq("is_active", true).maybeSingle();

// ── mgmt.site_pages ──────────────────────────────────────────────────────────
export const pageBySlug = (schoolId, slug) => mgmt()
  .from("site_pages")
  .select("title, content, status, deleted_at, slug").eq("school_id", schoolId).eq("slug", slug).maybeSingle();

export const homePage = (schoolId, cols = "title, content, status, deleted_at") => mgmt()
  .from("site_pages").select(cols).eq("school_id", schoolId).eq("slug", "home").maybeSingle();

export const pagesBySchool = (schoolId) => mgmt()
  .from("site_pages").select("id, slug").eq("school_id", schoolId);

export const pagesByIds = (ids) => mgmt()
  .from("site_pages").select("id, slug, status, deleted_at").in("id", ids);

export const pageInsert = (row) => mgmt()
  .from("site_pages").insert(row).select("id, slug").single();

export const pageUpdate = (pageId, body) => mgmt()
  .from("site_pages").update(body).eq("id", pageId);

export const pagesTrash = (ids) => mgmt()
  .from("site_pages").update({ deleted_at: new Date() }).in("id", ids);

export const pageBySlugId = (schoolId, slug) => mgmt()
  .from("site_pages").select("id").eq("school_id", schoolId).eq("slug", slug).maybeSingle();

// ── mgmt.site_menus / site_menu_items ────────────────────────────────────────
export const menusWithLocation = (schoolId) => mgmt()
  .from("site_menus")
  .select("id, location").eq("school_id", schoolId).not("location", "is", null);

export const menuItemsByMenus = (menuIds) => mgmt()
  .from("site_menu_items")
  .select("menu_id, label, url, page_id, target, sort_order")
  .in("menu_id", menuIds).order("sort_order", { ascending: true });

export const menuIdsBySchool = (schoolId) => mgmt()
  .from("site_menus").select("id").eq("school_id", schoolId);

export const menuItemsDelete = (menuId) => mgmt()
  .from("site_menu_items").delete().eq("menu_id", menuId);

export const menuDelete = (menuId) => mgmt()
  .from("site_menus").delete().eq("id", menuId);

export const menuInsert = (row) => mgmt()
  .from("site_menus").insert(row).select("id").single();

export const menuItemsInsert = (rows) => mgmt()
  .from("site_menu_items").insert(rows);

// ── mgmt.notices / school_events (rendered landing content) ──────────────────
export const siteNotices = (schoolId, today) => mgmt()
  .from("notices").select("title, body, publish_on, expires_on, pinned")
  .eq("school_id", schoolId).or(`expires_on.is.null,expires_on.gte.${today}`)
  .order("pinned", { ascending: false }).order("publish_on", { ascending: false }).limit(6);

export const siteEvents = (schoolId, today) => mgmt()
  .from("school_events").select("title, description, event_type, starts_on")
  .eq("school_id", schoolId).gte("starts_on", today).order("starts_on", { ascending: true }).limit(6);

// ── edu.school_admission_settings / school_admission_fields ──────────────────
export const admissionSettings = (schoolId) => edu()
  .from("school_admission_settings").select("*").eq("school_id", schoolId).maybeSingle();

export const admissionSettingsCreate = (schoolId) => edu()
  .from("school_admission_settings").insert({ school_id: schoolId }).select("*").single();

export const admissionSettingsUpdate = (schoolId, patch) => edu()
  .from("school_admission_settings")
  .update(patch).eq("school_id", schoolId).select("*").single();

export const admissionFields = (schoolId) => edu()
  .from("school_admission_fields")
  .select("id, label, field_type, options, required, sort_order")
  .eq("school_id", schoolId)
  .order("sort_order", { ascending: true });

export const admissionFieldInsert = (row) => edu()
  .from("school_admission_fields").insert(row)
  .select("id, label, field_type, options, required, sort_order").single();

export const admissionFieldUpdate = (schoolId, fieldId, patch) => edu()
  .from("school_admission_fields")
  .update(patch).eq("id", fieldId).eq("school_id", schoolId)
  .select("id, label, field_type, options, required, sort_order").single();

export const admissionFieldDelete = (schoolId, fieldId) => edu()
  .from("school_admission_fields").delete().eq("id", fieldId).eq("school_id", schoolId);

export const admissionEnabled = (schoolId) => edu()
  .from("school_admission_settings").select("enabled").eq("school_id", schoolId).maybeSingle();
