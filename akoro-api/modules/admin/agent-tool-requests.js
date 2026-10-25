/**
 * Admin review queue for learner-approved Agent Chat tool/integration requests.
 *
 * It is intentionally review-only: changing a status does not provision a
 * tool, call a third party, or expose a learner's chat transcript. Admins see
 * the concise request the learner approved alongside enough account context to
 * assess/respond through ordinary support channels if necessary.
 */
import { Router } from "express";

import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import {
  TOOL_REQUEST_STATUSES,
  DECISION_ONLY_STATUSES,
  boundedText,
  normaliseToolRequestUpdate,
} from "../agent-tool-requests/validation.js";
import { CAPABILITIES } from "../self-tooling/capabilities.js";
import { decideRequest, revokeGrant } from "../self-tooling/escalation.js";
import { enqueueResume } from "../self-tooling/resumeQueue.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const REQUEST_COLUMNS = "id, requester_id, title, description, category, status, admin_note, reviewed_by, last_status_changed_at, created_at, updated_at, kind, requested_capability, goal, proposed_tool, resume_status, resume_result, expires_at, resolved_at";

function queryWindow(value, fallback, maximum) {
  return Math.min(maximum, Math.max(1, Number.parseInt(value, 10) || fallback));
}

function searchTerm(value) {
  return boundedText(value, 120).replace(/[,()%*:\\]/g, " ").trim();
}

function requestWithRequester(row, requesters) {
  const requester = requesters.get(String(row.requester_id));
  return {
    id: row.id,
    requesterId: row.requester_id,
    requester: requester ? {
      fullName: requester.full_name || null,
      username: requester.username || null,
      email: requester.email || null,
    } : null,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    adminNote: row.admin_note || null,
    reviewedBy: row.reviewed_by || null,
    lastStatusChangedAt: row.last_status_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    kind: row.kind || "tool",
    ...(row.kind === "capability" ? { capability: capabilityInfo(row) } : {}),
  };
}

/** What an admin needs to decide a capability request (no chat transcript). */
function capabilityInfo(row) {
  const cap = CAPABILITIES[row.requested_capability];
  return {
    name: row.requested_capability,
    does: cap?.description || null,
    goal: row.goal || null,
    tool: row.proposed_tool ? { name: row.proposed_tool.name || null, label: row.proposed_tool.label || null } : null,
    risk: {
      othersData: cap?.scope === "network",
      writes: cap?.kind === "write",
      grantable: !!cap && cap.status === "locked" && (cap.kind === "read" || !!cap.target),
    },
    askedBy: row.askedBy ?? null,
    resumeStatus: row.resume_status || null,
    resumeResult: row.resume_result || null,
    expiresAt: row.expires_at || null,
    resolvedAt: row.resolved_at || null,
  };
}

/** How many learners asked for each capability (open or approved). */
async function askedCounts(rows) {
  const caps = [...new Set(rows.filter((r) => r.kind === "capability").map((r) => r.requested_capability))];
  if (!caps.length) return new Map();
  const { data } = await db.schema("edu").from("agent_tool_requests").select("requested_capability, requester_id")
    .eq("kind", "capability").in("requested_capability", caps).in("status", ["new", "under_review", "planned", "approved"]).limit(2000);
  const m = new Map();
  for (const r of data || []) { if (!m.has(r.requested_capability)) m.set(r.requested_capability, new Set()); m.get(r.requested_capability).add(r.requester_id); }
  return new Map([...m].map(([k, v]) => [k, v.size]));
}

async function requesterMap(rows) {
  const ids = [...new Set(rows.map((row) => row.requester_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await db.from("users")
    .select("id, full_name, username, email")
    .in("id", ids);
  if (error) throw error;
  return new Map((data || []).map((user) => [String(user.id), user]));
}

async function statusCounts() {
  const pairs = await Promise.all([...TOOL_REQUEST_STATUSES].map(async (status) => {
    const { count, error } = await db.schema("edu").from("agent_tool_requests")
      .select("*", { count: "exact", head: true }).eq("status", status);
    if (error) throw error;
    return [status, count || 0];
  }));
  return Object.fromEntries(pairs);
}

/** GET /api/admin/agent-tool-requests?status=&search=&limit=&offset= */
router.get("/agent-tool-requests", adminOnly, asyncHandler(async (req, res) => {
  const requestedStatus = boundedText(req.query.status, 40).toLowerCase();
  if (requestedStatus && !TOOL_REQUEST_STATUSES.has(requestedStatus)) {
    return res.status(422).json({ success: false, error: "status is invalid" });
  }
  const limit = queryWindow(req.query.limit, 50, 100);
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const search = searchTerm(req.query.search);
  let requestsQuery = db.schema("edu").from("agent_tool_requests")
    .select(REQUEST_COLUMNS, { count: "exact" })
    // Latest activity first: a request asked again (re-opened) comes back to the top.
    .order("last_status_changed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (requestedStatus) requestsQuery = requestsQuery.eq("status", requestedStatus);
  const kind = boundedText(req.query.kind, 20).toLowerCase();
  if (kind === "tool" || kind === "capability") requestsQuery = requestsQuery.eq("kind", kind);
  if (search) requestsQuery = requestsQuery.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

  const [{ data, count, error }, counts] = await Promise.all([requestsQuery, statusCounts()]);
  if (error) throw error;
  const rows = data || [];
  const [requesters, asked] = await Promise.all([requesterMap(rows), askedCounts(rows)]);
  return res.json({
    success: true,
    requests: rows.map((row) => requestWithRequester({ ...row, askedBy: asked.get(row.requested_capability) ?? null }, requesters)),
    total: count || 0,
    limit,
    offset,
    statusCounts: counts,
  });
}));

/** PATCH /api/admin/agent-tool-requests/:id — review status/note only. */
router.patch("/agent-tool-requests/:requestId", adminOnly, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.requestId)) {
    return res.status(422).json({ success: false, error: "requestId is invalid" });
  }
  let update;
  try { update = normaliseToolRequestUpdate(req.body || {}); }
  catch (error) { return res.status(422).json({ success: false, error: error.message }); }
  if (update.status && DECISION_ONLY_STATUSES.has(update.status)) {
    return res.status(422).json({ success: false, error: "Approve a capability request with Decide — it grants the capability and resumes the learner's build." });
  }
  const now = new Date().toISOString();
  const patch = { ...update, reviewed_by: req.user.id, updated_at: now };
  if (update.status) patch.last_status_changed_at = now;
  const { data, error } = await db.schema("edu").from("agent_tool_requests")
    .update(patch).eq("id", req.params.requestId)
    .select(REQUEST_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, error: "Tool request was not found" });
  const requesters = await requesterMap([data]);
  return res.json({ success: true, request: requestWithRequester(data, requesters) });
}));

const adminActor = (req) => ({ id: req.user?.id ?? null, label: req.user?.full_name || req.user?.email || "admin" });

/**
 * POST /api/admin/agent-tool-requests/:id/decide { decision: approve|deny|plan, note?, expiresAt? }
 * Approve grants the capability for EVERYONE and resumes every waiting request
 * for it in its learner's chat; deny/plan post the note to the learner.
 */
router.post("/agent-tool-requests/:requestId/decide", adminOnly, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.requestId)) return res.status(422).json({ success: false, error: "requestId is invalid" });
  const decision = boundedText(req.body?.decision, 20).toLowerCase();
  const note = typeof req.body?.note === "string" ? req.body.note : null;
  const expiresAt = req.body?.expiresAt ? String(req.body.expiresAt) : null;
  try {
    const out = await decideRequest({ requestId: req.params.requestId, decision, note, expiresAt, admin: adminActor(req), enqueue: enqueueResume });
    return res.json({ success: true, decision, status: out.request.status, grant: out.grant || null, resuming: out.resumed.length });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
}));

/** GET /api/admin/capability-grants — every grant (active first). */
router.get("/capability-grants", adminOnly, asyncHandler(async (_req, res) => {
  const { data, error } = await db.schema("edu").from("capability_grants")
    .select("id, capability, granted_by, request_id, note, expires_at, revoked_at, created_at").order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  const now = new Date().toISOString();
  return res.json({ success: true, grants: (data || []).map((g) => ({
    ...g, does: CAPABILITIES[g.capability]?.description || null, active: !g.revoked_at && (!g.expires_at || g.expires_at > now),
  })) });
}));

/** POST /api/admin/capability-grants/:id/revoke — the capability is off for everyone at once. */
router.post("/capability-grants/:grantId/revoke", adminOnly, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.grantId)) return res.status(422).json({ success: false, error: "grantId is invalid" });
  try {
    const g = await revokeGrant({ grantId: req.params.grantId, admin: adminActor(req) });
    return res.json({ success: true, grant: g });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
}));

export default router;
