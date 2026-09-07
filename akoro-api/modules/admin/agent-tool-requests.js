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
  boundedText,
  normaliseToolRequestUpdate,
} from "../agent-tool-requests/validation.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const REQUEST_COLUMNS = "id, requester_id, title, description, category, status, admin_note, reviewed_by, last_status_changed_at, created_at, updated_at";

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
  };
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
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (requestedStatus) requestsQuery = requestsQuery.eq("status", requestedStatus);
  if (search) requestsQuery = requestsQuery.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

  const [{ data, count, error }, counts] = await Promise.all([requestsQuery, statusCounts()]);
  if (error) throw error;
  const rows = data || [];
  const requesters = await requesterMap(rows);
  return res.json({
    success: true,
    requests: rows.map((row) => requestWithRequester(row, requesters)),
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

export default router;
