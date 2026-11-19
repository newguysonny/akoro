/**
 * modules/school/websiteAiSync.js — AI website sync, one unit at a time.
 *
 * A "unit" is either a template SECTION (hero/about/contact… from
 * edu.school_website_templates.sections) or a BUILDER PAGE (mgmt.site_pages).
 * The plan endpoint enumerates them so the UI can show real progress
 * ("3/9 pages"), and each unit is refined by its own request.
 *
 * WHY ONE UNIT PER REQUEST, not a single "sync everything" call:
 *  - progress is genuine — the bar advances on completed work, not a timer;
 *  - a failure halfway leaves earlier units already saved;
 *  - billing is metered per unit, so a school is charged for what actually ran.
 *
 * Charged to the SCHOOL wallet via chargeForAI + schoolBillTo, same as every
 * other AI feature.
 */
import { Router } from "express";
import db from "../../db.js";
import { openai, OPENAI_MODEL } from "../../lib/aiModel.js";
import { authenticateToken, requireRole } from "../auth/index.js";
import { chargeForAI, schoolBillTo, InsufficientCoins } from "../../lib/coins.js";
import { serverError } from "../../lib/httpError.js";

const router = Router();
const schoolOnly = [authenticateToken, requireRole(["school", "school_admin", "admin"])];

// School facts a website needs. `field` is the school_profiles column; the UI
// renders `label`/`hint` and PATCHes the field back when the user fills it.
const REQUIRED_INFO = [
  { field: "description",     label: "About the school",   hint: "A short paragraph the About and Hero sections are written from.", long: true },
  { field: "address",         label: "Street address",     hint: "Used on the Contact page and in search results." },
  { field: "city",            label: "City / town",        hint: "" },
  { field: "state",           label: "State",              hint: "" },
  { field: "phone",           label: "Phone number",       hint: "Parents use this to reach you." },
  { field: "email",           label: "Email address",      hint: "" },
  { field: "year_established",label: "Year established",   hint: "Adds credibility on the About page.", type: "number" },
  { field: "gender_type",     label: "Gender",             hint: "Mixed · Boys only · Girls only" },
  { field: "boarding_type",   label: "Day / boarding",     hint: "Day only · Boarding only · Day & Boarding" },
];

// Pictures the site needs. `on: 'website'` fields live in edu.school_website
// rather than public.school_profiles — the PATCH handler routes by that.
// The AI writes copy, never images: a school photo can only come from the
// school, so these are collected the same way the missing facts are.
const REQUIRED_IMAGES = [
  { field: "logo_url",       label: "School logo",       hint: "Shown in the header of every page.", on: "school" },
  { field: "hero_image_url", label: "Homepage banner",   hint: "The large photo behind your homepage headline. A wide shot of the school works best.", on: "website" },
  { field: "og_image_url",   label: "Social share image", hint: "Used when your website link is shared on WhatsApp or Facebook.", on: "website" },
];
const imageField = (f) => REQUIRED_IMAGES.find((x) => x.field === f);

async function mySchool(req) {
  const { data } = await db.from("school_profiles").select("*")
    .eq("admin_user_id", req.user.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  return data || null;
}

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

// A page imported from a website template holds a full HTML document, not
// prose. Writing model text over it destroys the layout — so HTML pages are
// rewritten IN PLACE (same tags, same structure) or not at all.
const looksLikeHtml = (s) => /<\/?[a-z][a-z0-9]*[\s/>]/i.test(String(s || ""));
const tagCount = (s) => (String(s || "").match(/<[a-z][a-z0-9]*[\s/>]/gi) || []).length;
// Above this the document can't be round-tripped through the model without
// risking truncation, which would silently amputate the page.
const MAX_HTML_REWRITE = 12000;

// ── GET /api/school/website/ai-sync/plan ─────────────────────────────────────
router.get("/website/ai-sync/plan", schoolOnly, async (req, res) => {
  try {
    const school = await mySchool(req);
    if (!school) return res.status(404).json({ error: "No school found for this account" });

    const { data: site } = await db.schema("edu").from("school_website")
      .select("*").eq("school_id", school.id).maybeSingle();
    const { data: tpl } = await db.schema("edu").from("school_website_templates")
      .select("id, name, sections").eq("school_id", school.id).eq("is_active", true).maybeSingle();
    const { data: pages } = await db.schema("mgmt").from("site_pages")
      .select("id, title, slug, status, content, content_backup").eq("school_id", school.id)
      .is("deleted_at", null).order("sort_order", { ascending: true });

    // Units = enabled template sections + builder pages.
    const sections = Array.isArray(tpl?.sections) ? tpl.sections : [];
    const units = [
      ...sections.filter((s) => s.on !== false).map((s) => ({
        key: s.key, type: "section", label: s.label || s.key,
      })),
      ...(pages || []).map((p) => ({
        key: p.id, type: "page", label: p.title,
        // A template page is a full HTML document — the AI only re-words it
        // in place, and the UI says so before anyone hits Start.
        html: looksLikeHtml(p.content),
        // A page with almost no body is what the sync is FOR — flag it rather
        // than treating it as done.
        thin: String(p.content || "").trim().length < 120,
      })),
    ];

    const missing = REQUIRED_INFO
      .filter((f) => isBlank(school[f.field]))
      .map((f) => ({ ...f, value: school[f.field] ?? "" }));

    // Images are listed whether set or not — unlike a fact, you can only judge
    // a picture by looking at it, so the UI shows a thumbnail and a Replace.
    const valueOf = (f) => (f.on === "website" ? site?.[f.field] : school[f.field]) ?? "";
    const images = REQUIRED_IMAGES.map((f) => ({ ...f, image: true, value: valueOf(f), missing: isBlank(valueOf(f)) }));

    res.json({
      success: true,
      data: {
        schoolName: school.name,
        templateName: tpl?.name || null,
        units,
        total: units.length,
        missing,
        images,
        imagesMissing: images.filter((i) => i.missing).length,
        // Everything the UI needs to say "you can't sync yet, and here's why".
        canSync: !!tpl || (pages || []).length > 0,
        canRevert: (pages || []).some((p) => p.content_backup != null),
        syncEnabled: !!site?.sync_school_info,
      },
    });
  } catch (e) { serverError(res, e, req); }
});

// ── PATCH /api/school/website/ai-sync/info ───────────────────────────────────
// Fill one missing school fact from the sync screen, without leaving it.
router.patch("/website/ai-sync/info", schoolOnly, async (req, res) => {
  try {
    const school = await mySchool(req);
    if (!school) return res.status(404).json({ error: "No school found for this account" });

    const { field, value } = req.body || {};
    const img = imageField(field);
    const allowed = img || REQUIRED_INFO.find((f) => f.field === field);
    if (!allowed) return res.status(400).json({ error: "Unknown field" });
    if (isBlank(value)) return res.status(400).json({ error: `${allowed.label} cannot be empty` });

    if (img) {
      // The client uploads to storage first and sends back the public URL, so
      // this only ever stores a link — never file bytes.
      const url = String(value).trim();
      if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "That doesn't look like an image link" });

      if (img.on === "website") {
        // Upsert, not update: a school that has never opened Appearance has no
        // school_website row yet, and a plain update would report success
        // while changing nothing.
        const { error } = await db.schema("edu").from("school_website")
          .upsert({ school_id: school.id, [field]: url }, { onConflict: "school_id" });
        if (error) throw error;
      } else {
        const { error } = await db.from("school_profiles").update({ [field]: url }).eq("id", school.id);
        if (error) throw error;
      }
      return res.json({ success: true, field, value: url });
    }

    const v = allowed.type === "number" ? Math.round(Number(value)) : String(value).trim();
    if (allowed.type === "number" && !Number.isFinite(v)) return res.status(400).json({ error: `${allowed.label} must be a number` });

    const { error } = await db.from("school_profiles").update({ [field]: v }).eq("id", school.id);
    if (error) throw error;
    res.json({ success: true, field, value: v });
  } catch (e) { serverError(res, e, req); }
});

// ── POST /api/school/website/ai-sync/unit ────────────────────────────────────
// Body: { key, type }  — refine ONE section or page from school data.
router.post("/website/ai-sync/unit", schoolOnly, async (req, res) => {
  try {
    const school = await mySchool(req);
    if (!school) return res.status(404).json({ error: "No school found for this account" });

    const { key, type } = req.body || {};
    if (!key || !["section", "page"].includes(type)) return res.status(400).json({ error: "key and type ('section'|'page') are required" });

    // Facts the model may use. Nothing else — so it can't invent a phone
    // number or a founding year.
    const facts = Object.fromEntries(
      REQUIRED_INFO.map((f) => [f.field, school[f.field]]).filter(([, v]) => !isBlank(v))
    );
    facts.name = school.name;

    let existing = "", label = key, backup = null;
    if (type === "page") {
      const { data: page } = await db.schema("mgmt").from("site_pages")
        .select("id, title, content, content_backup").eq("id", key).eq("school_id", school.id).maybeSingle();
      if (!page) return res.status(404).json({ error: "Page not found" });
      existing = page.content || ""; label = page.title; backup = page.content_backup;
    }

    const htmlPage = type === "page" && looksLikeHtml(existing);
    if (htmlPage && existing.length > MAX_HTML_REWRITE) {
      // Refusing is the correct outcome: a truncated rewrite would delete most
      // of the page, and nothing about that failure is obvious afterwards.
      return res.status(422).json({
        error: `"${label}" is a full template page and too large to rewrite safely. Edit it in the website builder instead.`,
        code: "PAGE_TOO_LARGE", key, type, skipped: true,
      });
    }

    const system = htmlPage
      ? "You edit the copy inside existing HTML for Nigerian school websites. Return the COMPLETE HTML back, byte-identical in structure: same tags, same nesting, same class names, ids, attributes, links, images and scripts. Change ONLY human-readable text between tags. Never add, remove or reorder elements. Never wrap the output in markdown code fences. Use ONLY the facts provided — never invent fees, dates, staff, results or contact details."
      : "You write copy for Nigerian school websites. Use ONLY the facts provided — never invent fees, dates, staff, results or contact details. Warm, plain, parent-facing English. Return the body copy only: no preamble, no markdown code fences, no commentary.";

    const prompt = htmlPage
      ? `Rewrite only the visible text of this "${label}" page for ${school.name}, keeping the HTML structure exactly as it is.\n\nSchool facts (JSON):\n${JSON.stringify(facts, null, 2)}\n\nHTML:\n${existing}`
      : type === "page"
      ? `Rewrite the "${label}" page for ${school.name}.\n\nSchool facts (JSON):\n${JSON.stringify(facts, null, 2)}\n\nCurrent content (may be empty or thin):\n"""${existing.slice(0, 4000)}"""\n\nKeep any specifics already present that aren't contradicted by the facts. If a detail isn't in the facts and isn't already written, leave it out rather than guessing.`
      : `Write the "${label}" section for ${school.name}'s homepage.\n\nSchool facts (JSON):\n${JSON.stringify(facts, null, 2)}\n\nKeep it tight — this is one section of a page, not a whole page.`;

    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL, max_tokens: htmlPage ? 8000 : 900,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    });
    let content = resp.choices?.[0]?.message?.content?.trim() || "";
    content = content.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "").trim();

    // Structural guard: the rewrite must still BE the page. A response that
    // lost its markup (or most of it) is a broken layout, not new copy.
    if (htmlPage) {
      const before = tagCount(existing), after = tagCount(content);
      if (!looksLikeHtml(content) || after < before * 0.8) {
        return res.status(422).json({
          error: `The rewrite of "${label}" came back without the page's structure, so it was discarded and the page is unchanged.`,
          code: "STRUCTURE_LOST", key, type, skipped: true,
        });
      }
    }
    if (!content) return res.status(422).json({ error: `The rewrite of "${label}" came back empty; the page is unchanged.`, code: "EMPTY", key, type, skipped: true });

    // Bill the SCHOOL wallet, metered on real usage like every other AI
    // feature. Charged AFTER the call so a failed generation is free.
    let charged = 0;
    try {
      const billTo = await schoolBillTo(req.user.id);
      const r = await chargeForAI({
        userId: req.user.id, feature: "website_ai_sync", model: OPENAI_MODEL,
        usage: resp.usage || {}, ref: `site_${type}_${key}`, billTo,
      });
      charged = r?.charged || 0;
    } catch (e) {
      if (e instanceof InsufficientCoins) {
        return res.status(402).json({ error: "Not enough coins in the school wallet to finish the sync.", code: "INSUFFICIENT_COINS", needed: e.needed, balance: e.balance });
      }
      // Never fail a completed generation over a billing hiccup — log it.
      console.error("[websiteAiSync] charge failed:", e.message);
    }

    if (type === "page") {
      // Snapshot the page as it was BEFORE its first sync, once. Every later
      // sync overwrites `content` but leaves the original recoverable.
      const patch = { content, ai_synced_at: new Date().toISOString() };
      if (backup === null || backup === undefined) patch.content_backup = existing;
      const { error } = await db.schema("mgmt").from("site_pages")
        .update(patch).eq("id", key).eq("school_id", school.id);
      if (error) throw error;
    } else {
      // Sections live in the template's own store; persist as a content
      // override keyed by section so the renderer can pick it up.
      const { data: site } = await db.schema("edu").from("school_website")
        .select("section_content").eq("school_id", school.id).maybeSingle();
      const merged = { ...(site?.section_content || {}), [key]: content };
      const { error } = await db.schema("edu").from("school_website")
        .update({ section_content: merged }).eq("school_id", school.id);
      if (error) throw error;
    }

    res.json({ success: true, key, type, label, content, coinsCharged: charged });
  } catch (e) { serverError(res, e, req); }
});

// ── POST /api/school/website/ai-sync/revert ──────────────────────────────────
// Put every AI-synced page back the way it was, and drop the AI copy written
// over template sections. Free — no model call, so no charge.
router.post("/website/ai-sync/revert", schoolOnly, async (req, res) => {
  try {
    const school = await mySchool(req);
    if (!school) return res.status(404).json({ error: "No school found for this account" });

    const M = db.schema("mgmt");
    const { data: pages } = await M.from("site_pages")
      .select("id, content_backup").eq("school_id", school.id).not("content_backup", "is", null);

    let restored = 0;
    for (const p of pages || []) {
      const { error } = await M.from("site_pages")
        .update({ content: p.content_backup, content_backup: null, ai_synced_at: null }).eq("id", p.id);
      if (error) throw error;
      restored++;
    }

    // Sections fall back to whatever the school typed manually once the AI
    // override is cleared, so emptying it is the revert.
    await db.schema("edu").from("school_website").update({ section_content: {} }).eq("school_id", school.id);

    res.json({ success: true, restored });
  } catch (e) { serverError(res, e, req); }
});

export default router;
