/**
 * agents.js — admin view of every AI agent on the platform.
 *
 * The one-per-user personal agent lives in public.user_agents; each is typed by
 * its owner: a school admin/teacher → "school", otherwise the user's role
 * (student / instructor / admin). Mounted under /api/admin.
 */
import { Router } from "express";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/index.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const ok = (res, data, meta = {}) => res.json({ success: true, data, ...meta });

const TYPES = ["student", "instructor", "school", "admin"];

// User ids that belong to a school (its admin, or any of its teachers).
async function schoolUserIds() {
  const [{ data: admins }, { data: teachers }] = await Promise.all([
    db.from("school_profiles").select("admin_user_id"),
    db.from("school_teachers").select("teacher_id"),
  ]);
  return new Set([
    ...(admins || []).map((a) => a.admin_user_id),
    ...(teachers || []).map((t) => t.teacher_id),
  ].filter(Boolean));
}

// GET /api/admin/agents?type=&search=&limit=&offset=
router.get("/agents", adminOnly, async (req, res) => {
  try {
    const { type = "all", search = "", limit = 50, offset = 0 } = req.query;
    const lim = Math.min(Number(limit) || 50, 200);
    const off = Number(offset) || 0;

    const schoolIds = await schoolUserIds();

    // Pull the agents with their owner. Capped generously; the admin filters/
    // searches/paginates over this set. (User-agent counts are modest today; a
    // fully server-side filter can replace this if the platform outgrows it.)
    const { data, error } = await db.from("user_agents")
      .select("id,user_id,agent_name,agent_emoji,agent_color,total_xp,is_active,created_at,updated_at,owner:users!inner(id,full_name,email,role,avatar_url)")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw error;

    const ownerType = (u) => (u && schoolIds.has(u.id) ? "school" : (u?.role || "student"));

    let rows = (data || []).map((a) => ({
      id: a.id,
      name: a.agent_name,
      emoji: a.agent_emoji,
      color: a.agent_color,
      totalXp: a.total_xp ?? 0,
      isActive: !!a.is_active,
      createdAt: a.created_at,
      ownerType: ownerType(a.owner),
      owner: a.owner ? { id: a.owner.id, name: a.owner.full_name, email: a.owner.email, role: a.owner.role, avatarUrl: a.owner.avatar_url } : null,
    }));

    // Counts per type (over the full set, before type/search filtering) for the
    // filter chips.
    const counts = { all: rows.length, student: 0, instructor: 0, school: 0, admin: 0 };
    for (const r of rows) counts[r.ownerType] = (counts[r.ownerType] || 0) + 1;

    if (TYPES.includes(type)) rows = rows.filter((r) => r.ownerType === type);
    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter((r) =>
        (r.name || "").toLowerCase().includes(q) ||
        (r.owner?.name || "").toLowerCase().includes(q) ||
        (r.owner?.email || "").toLowerCase().includes(q));
    }

    const total = rows.length;
    const page = rows.slice(off, off + lim);
    ok(res, page, { total, counts, limit: lim, offset: off });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
