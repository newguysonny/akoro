/**
 * modules/admin/appCenter.js — App Center catalog administration.
 *
 * Mounted at /api/admin. All routes are admin-only.
 *
 *   GET    /app-center            every listed tool/asset/management item
 *   POST   /app-center            create a listing
 *   PATCH  /app-center/:id        edit price, status, copy, ordering
 *   DELETE /app-center/:id        remove a listing (blocked once purchased)
 *
 * Backed by edu.platform_tools — the same catalog the instructor App Center
 * reads, so a price or status change here is what instructors see.
 *
 * STATUS MODEL (inherited, not invented here): `is_active` controls whether a
 * row is listed at all, while MANAGEMENT items additionally reuse the `tag`
 * column as a lifecycle flag ('active' | 'soon'). That overloading is why the
 * instructor API maps tag -> status for kind='management' only. This admin API
 * exposes both explicitly rather than hiding the quirk.
 */
import { Router } from "express";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { serverError } from "../../lib/httpError.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];

const KINDS = ["tool", "asset", "management"];
const MGMT_STATUS = ["active", "soon"];
// Who the listing is offered to. Enforced in modules/instructor/tools.js —
// both the instructor and school apps read that one endpoint.
const AUDIENCES = ["both", "instructors", "schools"];
const toNaira = (kobo) => Math.round(Number(kobo || 0)) / 100;

const shape = (r, counts = {}) => ({
  id: r.id,
  key: r.key,
  kind: r.kind,
  name: r.name,
  description: r.description,
  emoji: r.emoji,
  tag: r.tag,
  // For management items `tag` IS the lifecycle status; surfaced separately so
  // the UI doesn't have to know about the overloading.
  status: r.kind === "management" ? (r.tag || "active") : null,
  priceKobo: r.price_kobo,
  priceNaira: toNaira(r.price_kobo),
  currency: r.currency,
  audience: r.audience || 'both',
  isActive: r.is_active,
  sortOrder: r.sort_order,
  purchases: counts[r.id] || 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ── GET /api/admin/app-center ────────────────────────────────────────────────
router.get("/app-center", adminOnly, async (req, res) => {
  try {
    const { data: rows, error } = await db.schema("edu").from("platform_tools")
      .select("*").order("sort_order", { ascending: true }).order("name", { ascending: true });
    if (error) throw error;

    // How many instructors actually hold each item — the number that tells you
    // whether a listing can safely be repriced or pulled.
    const { data: access } = await db.schema("edu").from("instructor_tool_access")
      .select("tool_id").eq("access_granted", true);
    const counts = {};
    (access || []).forEach((a) => { counts[a.tool_id] = (counts[a.tool_id] || 0) + 1; });

    res.json({ success: true, items: (rows || []).map((r) => shape(r, counts)) });
  } catch (e) { serverError(res, e, req); }
});

// ── POST /api/admin/app-center ───────────────────────────────────────────────
router.post("/app-center", adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const key = String(b.key || "").trim().toLowerCase();
    const name = String(b.name || "").trim();
    const kind = b.kind || "tool";
    if (!key) return res.status(400).json({ error: "key is required (stable slug, e.g. lesson-plan)" });
    if (!name) return res.status(400).json({ error: "name is required" });
    if (!KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of: ${KINDS.join(", ")}` });

    const priceKobo = Math.round(Number(b.priceKobo ?? 0));
    if (!Number.isFinite(priceKobo) || priceKobo < 0) return res.status(400).json({ error: "priceKobo must be 0 or a positive number" });
    if (kind === "management" && b.status && !MGMT_STATUS.includes(b.status))
      return res.status(400).json({ error: `status must be one of: ${MGMT_STATUS.join(", ")}` });
    if (b.audience && !AUDIENCES.includes(b.audience))
      return res.status(400).json({ error: `audience must be one of: ${AUDIENCES.join(", ")}` });

    const { data: clash } = await db.schema("edu").from("platform_tools").select("id").eq("key", key).maybeSingle();
    if (clash) return res.status(409).json({ error: `A listing with key "${key}" already exists` });

    const { data, error } = await db.schema("edu").from("platform_tools").insert({
      key, kind, name,
      description: String(b.description || "").trim(),
      emoji: b.emoji || "🛠️",
      tag: kind === "management" ? (b.status || "active") : (b.tag || null),
      price_kobo: priceKobo,
      currency: b.currency || "NGN",
      audience: b.audience || "both",
      is_active: b.isActive !== false,
      sort_order: Math.round(Number(b.sortOrder ?? 0)) || 0,
    }).select("*").single();
    if (error) throw error;
    res.status(201).json({ success: true, item: shape(data) });
  } catch (e) { serverError(res, e, req); }
});

// ── PATCH /api/admin/app-center/:id ──────────────────────────────────────────
router.patch("/app-center/:id", adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const { data: existing } = await db.schema("edu").from("platform_tools")
      .select("id, kind").eq("id", req.params.id).maybeSingle();
    if (!existing) return res.status(404).json({ error: "Listing not found" });

    const patch = {};
    if (b.name !== undefined) { const v = String(b.name).trim(); if (!v) return res.status(400).json({ error: "name cannot be empty" }); patch.name = v; }
    if (b.description !== undefined) patch.description = String(b.description || "").trim();
    if (b.emoji !== undefined) patch.emoji = b.emoji || "🛠️";
    if (b.currency !== undefined) patch.currency = b.currency || "NGN";
    if (b.isActive !== undefined) patch.is_active = !!b.isActive;
    if (b.audience !== undefined) {
      if (!AUDIENCES.includes(b.audience)) return res.status(400).json({ error: `audience must be one of: ${AUDIENCES.join(", ")}` });
      patch.audience = b.audience;
    }
    if (b.sortOrder !== undefined) {
      const n = Math.round(Number(b.sortOrder));
      if (!Number.isFinite(n)) return res.status(400).json({ error: "sortOrder must be a number" });
      patch.sort_order = n;
    }
    if (b.priceKobo !== undefined) {
      const n = Math.round(Number(b.priceKobo));
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "priceKobo must be 0 or a positive number" });
      patch.price_kobo = n;
    }
    if (b.kind !== undefined) {
      if (!KINDS.includes(b.kind)) return res.status(400).json({ error: `kind must be one of: ${KINDS.join(", ")}` });
      patch.kind = b.kind;
    }
    // `status` only means anything for management items (where it IS `tag`).
    const effectiveKind = patch.kind || existing.kind;
    if (b.status !== undefined && effectiveKind === "management") {
      if (!MGMT_STATUS.includes(b.status)) return res.status(400).json({ error: `status must be one of: ${MGMT_STATUS.join(", ")}` });
      patch.tag = b.status;
    } else if (b.tag !== undefined && effectiveKind !== "management") {
      patch.tag = b.tag || null;
    }

    if (!Object.keys(patch).length) return res.status(400).json({ error: "No valid fields" });
    patch.updated_at = new Date().toISOString();

    const { data, error } = await db.schema("edu").from("platform_tools")
      .update(patch).eq("id", req.params.id).select("*").single();
    if (error) throw error;
    res.json({ success: true, item: shape(data) });
  } catch (e) { serverError(res, e, req); }
});

// ── DELETE /api/admin/app-center/:id ─────────────────────────────────────────
// Refused once anyone owns it — deleting would revoke paid access and orphan
// the purchase record. Deactivate (isActive=false) to unlist instead.
router.delete("/app-center/:id", adminOnly, async (req, res) => {
  try {
    const { count } = await db.schema("edu").from("instructor_tool_access")
      .select("id", { count: "exact", head: true }).eq("tool_id", req.params.id);
    if (count > 0) {
      return res.status(409).json({ error: `${count} instructor(s) already have this — unlist it (set inactive) instead of deleting.` });
    }
    const { error } = await db.schema("edu").from("platform_tools").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { serverError(res, e, req); }
});

export default router;
