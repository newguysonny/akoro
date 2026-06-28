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
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import {
  initializeTransaction,
  verifyTransaction,
  generateReference,
} from "../adaptive-learning/marketplace/paystackService.js";

const router = Router();
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
