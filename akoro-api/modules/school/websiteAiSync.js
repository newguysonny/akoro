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
import { authenticateToken, requireRole } from "../auth/routes.js";
import { chargeForAI, schoolBillTo, InsufficientCoins } from "../../lib/coins.js";
import { serverError } from "../../lib/httpError.js";

const router = Router();
const schoolOnly = [authenticateToken, requireRole(["school", "school_admin", "admin"])];

// School facts a website needs. `field` is the school_profiles column; the UI
// renders `label`/`hint` and PATCHes the field back when the user fills it.
const REQUIRED_INFO = [
  { field: "logo_url",        label: "School logo",        hint: "Shown in the header and on every page." },
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

async function mySchool(req) {
  const { data } = await db.from("school_profiles").select("*")
    .eq("admin_user_id", req.user.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  return data || null;
}

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

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
      .select("id, title, slug, status, content").eq("school_id", school.id)
      .is("deleted_at", null).order("sort_order", { ascending: true });

    // Units = enabled template sections + builder pages.
    const sections = Array.isArray(tpl?.sections) ? tpl.sections : [];
    const units = [
      ...sections.filter((s) => s.on !== false).map((s) => ({
        key: s.key, type: "section", label: s.label || s.key,
      })),
      ...(pages || []).map((p) => ({
        key: p.id, type: "page", label: p.title,
        // A page with almost no body is what the sync is FOR — flag it rather
        // than treating it as done.
        thin: String(p.content || "").trim().length < 120,
      })),
    ];

    const missing = REQUIRED_INFO
      .filter((f) => isBlank(school[f.field]))
      .map((f) => ({ ...f, value: school[f.field] ?? "" }));

    res.json({
      success: true,
      data: {
        schoolName: school.name,
        templateName: tpl?.name || null,
        units,
        total: units.length,
        missing,
        // Everything the UI needs to say "you can't sync yet, and here's why".
        canSync: !!tpl || (pages || []).length > 0,
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
    const allowed = REQUIRED_INFO.find((f) => f.field === field);
    if (!allowed) return res.status(400).json({ error: "Unknown field" });
    if (isBlank(value)) return res.status(400).json({ error: `${allowed.label} cannot be empty` });

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

    let existing = "", label = key;
    if (type === "page") {
      const { data: page } = await db.schema("mgmt").from("site_pages")
        .select("id, title, content").eq("id", key).eq("school_id", school.id).maybeSingle();
      if (!page) return res.status(404).json({ error: "Page not found" });
      existing = page.content || ""; label = page.title;
    }

    const system = "You write copy for Nigerian school websites. Use ONLY the facts provided — never invent fees, dates, staff, results or contact details. Warm, plain, parent-facing English. Return the body copy only: no preamble, no markdown code fences, no commentary.";
    const prompt = type === "page"
      ? `Rewrite the "${label}" page for ${school.name}.\n\nSchool facts (JSON):\n${JSON.stringify(facts, null, 2)}\n\nCurrent content (may be empty or thin):\n"""${existing.slice(0, 4000)}"""\n\nKeep any specifics already present that aren't contradicted by the facts. If a detail isn't in the facts and isn't already written, leave it out rather than guessing.`
      : `Write the "${label}" section for ${school.name}'s homepage.\n\nSchool facts (JSON):\n${JSON.stringify(facts, null, 2)}\n\nKeep it tight — this is one section of a page, not a whole page.`;

    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL, max_tokens: 900,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    });
    const content = resp.choices?.[0]?.message?.content?.trim() || "";

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
      const { error } = await db.schema("mgmt").from("site_pages")
        .update({ content }).eq("id", key).eq("school_id", school.id);
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

export default router;
