/**
 * modules/school/rules.js — pure predicates, normalisers and constants.
 *
 * No database import, no Express import. Everything here is a synchronous
 * transformation of its arguments so services and routes can share it freely.
 */

export const SCHOOL_ROLES = ["school", "school_admin", "admin"];

// =============================================================
// AUDIT TRAIL — request/body shape helpers.
// =============================================================
export const SECRET_KEY_PATTERN = /token|secret|password|key$/i;
export function sanitizeAuditBody(body) {
  if (!body || typeof body !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? "[redacted]" : v;
  }
  return out;
}
export function pickEntityLabel(body) {
  if (!body || typeof body !== "object") return null;
  return body.name || body.label || body.title || body.domain || null;
}

export const slugify = (s) => (s || "school").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// =============================================================
// SETTINGS — request field → column maps.
// =============================================================
export const SETTINGS_CATEGORY_COLUMN = {
  "system-formats":      "system_formats",
  "attendance":           "attendance",
  "security":             "security",
  "integrations":         "integrations",
  "personalisation":      "personalisation",
  "notification-prefs":   "notification_prefs",
  "modules":              "modules",
  "backup":               "backup_schedule",
  "content":              "content",
};

export const BRANDING_COLUMN = { logo: "logo_url", favicon: "favicon_url", signature: "principal_signature_url" };

// camelCase (API) → snake_case (DB column) map for the website config.
export const WEBSITE_FIELD_MAP = {
  enabled: "enabled", mode: "mode", themeId: "theme_id", syncSchoolInfo: "sync_school_info", aiChatEnabled: "ai_chat_enabled", templateColors: "template_colors",
  heroTitle: "hero_title", heroSubtitle: "hero_subtitle", heroImageUrl: "hero_image_url",
  aboutText: "about_text", metaTitle: "meta_title", metaKeywords: "meta_keywords",
  metaDescription: "meta_description", ogImageUrl: "og_image_url",
  headerScripts: "header_scripts", footerScripts: "footer_scripts",
  primaryColor: "primary_color", secondaryColor: "secondary_color", accentColor: "accent_color",
  bgMode: "bg_mode", socialLinks: "social_links", sections: "sections", customCss: "custom_css",
};

export const DEFAULT_ADMIN_PERMISSIONS = { "*": { view: true, create: true, edit: true, delete: true } };

// =============================================================
// SHAPE / SELECT constants.
// =============================================================
export const AGENT_SELECT = "id, agent_name, agent_emoji, agent_color, agent_bg, total_xp, personality, teacher_agent_id, guide_name, guide_emoji, guide_render_style, is_active";

export const CREATION_COLS = "id, kind, subtype, topic, content, created_at, posted_at, posted_channels, media_url, media_type";

// =============================================================
// CONTENT GENERATOR — prompt copy.
// =============================================================
export const CONTENT_GEN_SYSTEM = {
  social: `You write short, engaging SOCIAL MEDIA posts for a school. Return 3 distinct caption options, each 2–4 lines with a few relevant hashtags and an emoji or two. Friendly and shareable. Tailor tone to the target platform.`,
  activity: `You are an experienced teacher. Design a student ACTIVITY / lesson idea in Markdown: a title, objective, materials, step-by-step instructions, a differentiation tip, and an assessment idea. Age-appropriate and practical.`,
};
// Blog sub-types — each is an SEO-friendly Markdown post with its own angle.
export const BLOG_SYSTEM = {
  newsletter:  `You write a warm weekly school NEWSLETTER in Markdown: a friendly headline, 3–4 short sections (highlights, upcoming events, a note from the school) and a closing. Community-facing, SEO-friendly and positive.`,
  event_recap: `You write an upbeat EVENT RECAP blog post in Markdown for a school website: a catchy SEO title, 2–3 short paragraphs celebrating what happened, a pull-quote, and a closing line. Warm and shareable.`,
  achievement: `You write an ACHIEVEMENT HIGHLIGHT blog post in Markdown celebrating a school's success (results, awards, sports, competitions): an SEO title, an intro, the highlights with specifics, a congratulatory quote, and a proud closing.`,
  announcement:`You write a clear school ANNOUNCEMENT blog post in Markdown: an SEO title, the key information up front (what/when/where/who), any action parents need to take, and a friendly closing.`,
  general:     `You are a school's content writer. Produce a complete BLOG POST in Markdown: an SEO-friendly title, a short intro, 3–5 sections with headers, and a warm closing. Community-facing, positive and informative.`,
};
export const BLOG_TYPES = Object.keys(BLOG_SYSTEM);

export const roleLabel = { admin: "an admin", teacher: "a teacher", student: "a student", parent: "a parent" };

// =============================================================
// SHAPERS.
// =============================================================
export const mask = (v) => (v ? "•".repeat(Math.min(20, Math.max(8, v.length))) : "");

export function shapePaymentGateway(row) {
  if (!row) return {
    enabled: false, provider: "", mode: "sandbox",
    liveKeyId: "", liveKeySecret: "", hasLiveKeySecret: false,
    sandboxKeyId: "", sandboxKeySecret: "", hasSandboxKeySecret: false,
    webhookSecret: "", hasWebhookSecret: false,
    surchargeType: "percentage", surchargeAmount: 0,
  };
  return {
    enabled: row.enabled, provider: row.provider || "", mode: row.mode,
    liveKeyId: row.live_key_id || "", liveKeySecret: mask(row.live_key_secret), hasLiveKeySecret: !!row.live_key_secret,
    sandboxKeyId: row.sandbox_key_id || "", sandboxKeySecret: mask(row.sandbox_key_secret), hasSandboxKeySecret: !!row.sandbox_key_secret,
    webhookSecret: mask(row.webhook_secret), hasWebhookSecret: !!row.webhook_secret,
    surchargeType: row.surcharge_type, surchargeAmount: row.surcharge_amount,
  };
}

export const shapeWebsite = (w) => ({
  enabled: w.enabled, mode: w.mode, themeId: w.theme_id, syncSchoolInfo: !!w.sync_school_info, aiChatEnabled: !!w.ai_chat_enabled, templateColors: w.template_colors || {},
  heroTitle: w.hero_title, heroSubtitle: w.hero_subtitle, heroImageUrl: w.hero_image_url,
  aboutText: w.about_text, metaTitle: w.meta_title, metaKeywords: w.meta_keywords,
  metaDescription: w.meta_description, ogImageUrl: w.og_image_url,
  headerScripts: w.header_scripts, footerScripts: w.footer_scripts,
  primaryColor: w.primary_color, secondaryColor: w.secondary_color, accentColor: w.accent_color,
  bgMode: w.bg_mode, socialLinks: w.social_links || {}, sections: w.sections || [], customCss: w.custom_css,
});

// A page whose content is a whole HTML document is served as-is (its own
// header/footer/styles) rather than wrapped in the builder chrome.
export const isFullDocument = (c) => /^\s*(<!doctype html|<html[\s>])/i.test(c || "");

// The active template's editable brand colours: CSS custom properties found in
// the home document's :root block whose values look like colours.
export function parseTemplateColorVars(doc) {
  const out = [];
  const root = String(doc || "").match(/:root\s*{([^}]*)}/);
  if (!root) return out;
  for (const m of root[1].matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+)/g)) {
    const value = m[2].trim();
    if (/^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/.test(value)) out.push({ name: m[1], value });
  }
  return out;
}

// Per-school overrides for those variables, injected after the template's own
// styles so they win — this is how each school brands a shared template.
export function templateColorStyle(colors) {
  const entries = Object.entries(colors || {}).filter(([k, v]) => /^--[a-zA-Z0-9_-]+$/.test(k) && /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/.test(String(v).trim()));
  if (!entries.length) return "";
  return `<style data-akoro-brand>:root{${entries.map(([k, v]) => `${k}:${String(v).trim()}`).join(";")}}</style>`;
}

export const toNaira = (kobo) => Math.round((kobo || 0) / 100);

// The dashboard's session shape — the same mapping the instructor module
// applies (modules/instructor/rules.js mapSession), kept local so the
// school module carries no cross-module import for one pure function.
export const mapSchoolSession = (row) => ({
  ...row,
  startTime:     row.scheduled_start,
  enrolledCount: row.current_participants ?? 0,
  courseId:      row.course_id,
  moduleId:      row.module_id ?? null,
  meetingUrl:    row.meeting_url ?? null,
});
