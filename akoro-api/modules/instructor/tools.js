/**
 * instructor/tools.js — Platform Tools & Assets catalog + purchase flow
 *
 * Mount in app.js (BEFORE the generic /api/instructor mount):
 *   import instructorToolsRouter from "./modules/instructor/tools.js";
 *   app.use("/api/instructor/tools", standardLimit, instructorToolsRouter);
 *
 * These are platform-owned tools/assets. Instructors PAY to unlock them;
 * once unlocked, the instructor's agent gets access. Prices are set by us in
 * edu.platform_tools (DB) — never by the teacher.
 *
 * Routes:
 *   GET  /api/instructor/tools                 — catalog (with `owned` flag)
 *   POST /api/instructor/tools/checkout        — { toolId } → free grant or Paystack init
 *   GET  /api/instructor/tools/verify/:reference — verify Paystack + grant access
 */

import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import {
  initializeTransaction,
  verifyTransaction,
  generateReference,
} from "../adaptive-learning/marketplace/paystackService.js";

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const VALID_TARGETS = ["lesson_plan", "worksheet", "report", "exam_prep", "generic"];
const INSTRUCTOR_APP_URL =
  process.env.INSTRUCTOR_APP_URL || "https://instructor.akoro.app";

const toNaira = (kobo) => Math.round((kobo || 0) / 100);

async function getUserEmail(userId) {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    return data?.user?.email || null;
  } catch {
    return null;
  }
}

// Grant the instructor access to a tool (idempotent).
async function grantToolAccess(instructorId, toolId, { ref, amountKobo } = {}) {
  await db.schema("edu").from("instructor_tool_access").upsert(
    {
      instructor_id:   instructorId,
      tool_id:         toolId,
      amount_kobo:     amountKobo ?? 0,
      paystack_ref:    ref ?? `FREE-${instructorId}-${toolId}`,
      paystack_status: "success",
      access_granted:  true,
      verified_at:     new Date(),
    },
    { onConflict: "instructor_id,tool_id" }
  );
}

// =============================================================
// TEMPLATES — instructor uploads their own material → reusable template
// =============================================================

// POST /api/instructor/tools/templates
// Body: { title, toolTarget, sourceText, sourceUrl? }
// sourceText is the OCR-extracted text of the uploaded image/doc (done client
// side via the existing OCR pipeline). We structure it into a reusable spec.
router.post("/templates", authenticateToken, requireRole(["instructor", "teacher", "admin"]), async (req, res) => {
  try {
    const instructorId = req.user.id;
    const { title, toolTarget = "generic", sourceText = "", sourceUrl = null } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: "title required" });
    if (!sourceText.trim()) return res.status(400).json({ error: "sourceText required (upload a sample first)" });
    const target = VALID_TARGETS.includes(toolTarget) ? toolTarget : "generic";

    // Extract a reusable template spec from the teacher's raw material.
    let structure = {};
    try {
      const resp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{
          role: "user",
          content:
            `A teacher uploaded a sample of their existing ${target.replace("_", " ")} material. ` +
            `Extract a REUSABLE TEMPLATE describing its structure so future AI-generated ` +
            `${target.replace("_", " ")}s match their style.\n\nMaterial:\n"""${sourceText.slice(0, 6000)}"""\n\n` +
            `Return JSON only: { "sections": ["<ordered section/heading>", ...], ` +
            `"style": "<tone & formatting notes>", "conventions": ["<numbering, layout, phrasing rule>", ...] }`,
        }],
      });
      const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim()
        .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      structure = JSON.parse(text);
    } catch (e) {
      console.warn("[templates] structure extraction failed:", e.message);
      structure = { sections: [], style: "", conventions: [], raw: sourceText.slice(0, 2000) };
    }

    const { data, error } = await db.schema("edu").from("instructor_templates").insert({
      instructor_id: instructorId,
      tool_target:   target,
      title:         title.trim(),
      source_text:   sourceText.slice(0, 12000),
      source_url:    sourceUrl,
      structure,
    }).select("id, tool_target, title, structure, created_at").single();
    if (error) throw error;

    res.status(201).json({ success: true, template: data });
  } catch (e) {
    console.error("[templates/create]", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/instructor/tools/templates[?toolTarget=]
router.get("/templates", authenticateToken, async (req, res) => {
  try {
    let q = db.schema("edu").from("instructor_templates")
      .select("id, tool_target, title, structure, created_at")
      .eq("instructor_id", req.user.id)
      .order("created_at", { ascending: false });
    if (req.query.toolTarget) q = q.eq("tool_target", req.query.toolTarget);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ success: true, templates: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/instructor/tools/templates/:id
router.delete("/templates/:id", authenticateToken, async (req, res) => {
  try {
    const { error } = await db.schema("edu").from("instructor_templates")
      .delete()
      .eq("id", req.params.id)
      .eq("instructor_id", req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/instructor/tools/outputs ────────────────────────────────────────
// The instructor's saved tool artifacts (lesson plans, worksheets, etc.).
// Optional ?kind=lesson_plan&limit=20&offset=0
router.get("/outputs", authenticateToken, async (req, res) => {
  try {
    const { kind, limit = 30, offset = 0 } = req.query;
    let q = db
      .schema("edu").from("tool_outputs")
      .select("id, tool, kind, title, subject, created_at")
      .eq("instructor_id", req.user.id)
      .order("created_at", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    if (kind) q = q.eq("kind", kind);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ success: true, outputs: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/instructor/tools/outputs/:id ────────────────────────────────────
router.get("/outputs/:id", authenticateToken, async (req, res) => {
  try {
    const { data, error } = await db
      .schema("edu").from("tool_outputs")
      .select("*")
      .eq("id", req.params.id)
      .eq("instructor_id", req.user.id)
      .single();
    if (error || !data) return res.status(404).json({ error: "Not found" });
    res.json({ success: true, output: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/instructor/tools ────────────────────────────────────────────────
// Returns the full catalog split into tools/assets, each flagged with `owned`.
router.get("/", authenticateToken, async (req, res) => {
  try {
    const instructorId = req.user.id;

    const { data: catalog, error } = await db
      .schema("edu").from("platform_tools")
      .select("id, key, kind, name, description, emoji, tag, price_kobo, currency")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;

    const { data: owned } = await db
      .schema("edu").from("instructor_tool_access")
      .select("tool_id")
      .eq("instructor_id", instructorId)
      .eq("access_granted", true);
    const ownedSet = new Set((owned || []).map((r) => r.tool_id));

    const shape = (r) => ({
      id:          r.id,
      key:         r.key,
      kind:        r.kind,
      name:        r.name,
      description: r.description,
      emoji:       r.emoji,
      tag:         r.tag,
      priceKobo:   r.price_kobo,
      price:       toNaira(r.price_kobo),
      currency:    r.currency,
      owned:       ownedSet.has(r.id),
    });

    const items  = (catalog || []).map(shape);
    res.json({
      success: true,
      tools:   items.filter((i) => i.kind === "tool"),
      assets:  items.filter((i) => i.kind === "asset"),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/instructor/tools/checkout ──────────────────────────────────────
// Body: { toolId }. Free → grant immediately. Paid → Paystack authorization URL.
router.post("/checkout", authenticateToken, requireRole(["instructor", "teacher", "admin"]), async (req, res) => {
  try {
    const instructorId = req.user.id;
    const { toolId } = req.body;
    if (!toolId) return res.status(400).json({ error: "toolId required" });

    const { data: tool, error } = await db
      .schema("edu").from("platform_tools")
      .select("*")
      .eq("id", toolId)
      .eq("is_active", true)
      .single();
    if (error || !tool) return res.status(404).json({ error: "Tool not found" });

    // Already owned?
    const { data: existing } = await db
      .schema("edu").from("instructor_tool_access")
      .select("id, access_granted")
      .eq("instructor_id", instructorId)
      .eq("tool_id", toolId)
      .maybeSingle();
    if (existing?.access_granted) {
      return res.status(409).json({ error: "Already unlocked", owned: true });
    }

    // Free → grant now
    if (!tool.price_kobo || tool.price_kobo === 0) {
      await grantToolAccess(instructorId, toolId, { amountKobo: 0 });
      return res.json({ success: true, free: true, owned: true, message: `${tool.name} unlocked.` });
    }

    // Paid → Paystack init
    const email = req.body.email || (await getUserEmail(instructorId));
    if (!email) return res.status(400).json({ error: "email required for payment" });

    const reference = generateReference("TOOL");
    await db.schema("edu").from("instructor_tool_access").upsert(
      {
        instructor_id:   instructorId,
        tool_id:         toolId,
        amount_kobo:     tool.price_kobo,
        currency:        tool.currency,
        paystack_ref:    reference,
        paystack_status: "pending",
        access_granted:  false,
      },
      { onConflict: "instructor_id,tool_id" }
    );

    const paystack = await initializeTransaction({
      email,
      amount_kobo:  tool.price_kobo,
      reference,
      callback_url: `${INSTRUCTOR_APP_URL}/marketplace?tool_ref=${reference}`,
      metadata: { instructor_id: instructorId, tool_id: toolId, tool_name: tool.name, kind: "platform_tool" },
    });

    res.json({
      success:           true,
      authorization_url: paystack.authorization_url,
      reference,
      priceKobo:         tool.price_kobo,
    });
  } catch (e) {
    console.error("[tools/checkout]", e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/instructor/tools/verify/:reference ──────────────────────────────
// Called by the instructor app after the Paystack redirect.
router.get("/verify/:reference", authenticateToken, async (req, res) => {
  try {
    const { reference } = req.params;
    const { data: row } = await db
      .schema("edu").from("instructor_tool_access")
      .select("id, instructor_id, tool_id, access_granted")
      .eq("paystack_ref", reference)
      .single();

    if (!row) return res.status(404).json({ error: "Purchase not found" });
    if (row.instructor_id !== req.user.id) return res.status(403).json({ error: "Not authorised" });
    if (row.access_granted) return res.json({ success: true, owned: true, alreadyGranted: true });

    const tx = await verifyTransaction(reference);
    if (tx.status === "success") {
      await grantToolAccess(row.instructor_id, row.tool_id, { ref: reference, amountKobo: tx.amount });
      return res.json({ success: true, owned: true, message: "Payment verified — unlocked!" });
    }

    await db.schema("edu").from("instructor_tool_access")
      .update({ paystack_status: tx.status }).eq("id", row.id);
    res.json({ success: false, status: tx.status, message: "Payment not successful" });
  } catch (e) {
    console.error("[tools/verify]", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
