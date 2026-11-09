/**
 * Shared persistence for learner-approved Agent Chat tool requests.
 *
 * This deliberately stores a compact capability need rather than the original
 * conversation. A request is product feedback for Akoro admins, not a support
 * transcript, an execution queue, or permission for an agent to obtain a new
 * integration by itself.
 */
import { createHash, randomUUID } from "node:crypto";

import db from "../../db.js";
import { normaliseToolRequest } from "./validation.js";

/** A request in one of these is closed: asking again re-opens it. */
export const CLOSED_STATUSES = new Set(["declined", "implemented", "expired"]);

function fingerprint({ title, description, category, kind }) {
  return createHash("sha256")
    .update(JSON.stringify({
      title: title.toLocaleLowerCase("en-US"),
      description: description.toLocaleLowerCase("en-US"),
      category,
      kind,
    }))
    .digest("hex");
}

export function publicLearnerToolRequest(row = {}) {
  return {
    id: row.id,
    created: row.created_at || row.createdAt || null,
    createdNew: row.createdNew === true,
    status: row.status,
    title: row.title,
    category: row.category,
    kind: row.kind || "tool",
  };
}

/**
 * Create one durable feature request for its authenticated owner.
 * A unique fingerprint means a retry or repeated model call does not create a
 * pile of identical requests. The existing row is returned truthfully instead.
 */
export async function createLearnerToolRequest({ learnerId, body }) {
  if (!learnerId) throw new Error("An authenticated learner is required");
  const request = normaliseToolRequest(body);
  const requestFingerprint = fingerprint(request);
  const now = new Date().toISOString();
  const inserted = await db.schema("edu").from("agent_tool_requests")
    .insert({
      requester_id: learnerId,
      title: request.title,
      description: request.description,
      category: request.category,
      kind: request.kind,
      request_fingerprint: requestFingerprint,
      status: "new",
      created_at: now,
      updated_at: now,
      last_status_changed_at: now,
    })
    .select("id, title, category, kind, status, created_at")
    .maybeSingle();

  if (!inserted.error && inserted.data) {
    return publicLearnerToolRequest({ ...inserted.data, createdNew: true });
  }
  if (inserted.error?.code !== "23505") {
    throw new Error("Tool request could not be saved");
  }

  const existing = await db.schema("edu").from("agent_tool_requests")
    .select("id, title, category, kind, status, created_at")
    .eq("requester_id", learnerId)
    .eq("request_fingerprint", requestFingerprint)
    .maybeSingle();
  if (existing.error || !existing.data) throw new Error("Tool request could not be saved");
  // Asked again after it was closed (declined, implemented, expired): it is a live ask
  // again — re-opened as new, so it is back on the admins' Agent requests page.
  if (CLOSED_STATUSES.has(existing.data.status)) {
    const reopened = await db.schema("edu").from("agent_tool_requests")
      .update({ status: "new", updated_at: now, last_status_changed_at: now })
      .eq("id", existing.data.id)
      .select("id, title, category, kind, status, created_at")
      .maybeSingle();
    if (reopened.error || !reopened.data) throw new Error("Tool request could not be re-opened");
    return { ...publicLearnerToolRequest({ ...reopened.data, createdNew: false }), reopened: true, previousStatus: existing.data.status };
  }
  return publicLearnerToolRequest({ ...existing.data, createdNew: false });
}

/** Admins move a tool/component request through these; capability requests use the decide/grant flow. */
const REVIEW_STATUSES = new Set(["new", "under_review", "planned", "declined", "implemented"]);
/** Moving to one of these tells the requester (closing the loop). */
const NOTIFY_STATUSES = new Set(["planned", "implemented"]);

/** Post a proactive agent message into the learner's chat so the agent tells
 *  them directly — not only a notifications-bell entry. Best-effort by callers. */
async function informLearnerInChat({ userId, title, text }) {
  const now = new Date().toISOString();
  const sessionId = randomUUID();
  const { error: sessionError } = await db.from("chat_sessions").insert({
    id: sessionId, user_id: userId, title, created_at: now, updated_at: now, last_message_at: now,
  });
  if (sessionError) throw new Error(sessionError.message);
  const { data: msg, error: messageError } = await db.from("chat_messages").insert({
    session_id: sessionId, user_id: userId, role: "agent", text,
  }).select("id").single();
  if (messageError) throw new Error(messageError.message);
  try { global.io?.to(`user:${userId}`).emit("chat_follow_up_ready", { sessionId, title }); } catch { /* best effort */ }
  return { sessionId, messageId: msg?.id };
}

/**
 * Review a tool/component request: set its status (and optional note) and, when it
 * moves to planned or implemented, notify the requester so the learner (and their
 * agent, via check_my_requests) learns it is on its way or ready. When it ships,
 * the agent also posts a message in their chat. Capability requests are left to
 * the decide/grant flow, which already resumes the build.
 */
export async function reviewToolRequest({ requestId, status, adminNote = null, admin = null }) {
  if (!requestId) throw Object.assign(new Error("requestId is required"), { status: 422 });
  if (!REVIEW_STATUSES.has(status)) throw Object.assign(new Error("status is invalid"), { status: 422 });
  const now = new Date().toISOString();

  const { data: current, error: readError } = await db.schema("edu").from("agent_tool_requests")
    .select("id, requester_id, kind, title, status").eq("id", requestId).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) throw Object.assign(new Error("Tool request was not found"), { status: 404 });

  const { data: updated, error: updateError } = await db.schema("edu").from("agent_tool_requests")
    .update({ status, admin_note: adminNote, reviewed_by: admin?.id ?? null, updated_at: now, last_status_changed_at: now })
    .eq("id", requestId)
    .select("id, requester_id, kind, title, description, category, status, admin_note, reviewed_by, last_status_changed_at, created_at, updated_at")
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);

  let notified = false;
  if (NOTIFY_STATUSES.has(status) && status !== current.status && current.kind !== "capability" && updated?.requester_id) {
    const ready = status === "implemented";
    const { error: notifyError } = await db.from("notifications").insert({
      user_id: updated.requester_id,
      type: "agent_tool_request",
      title: ready ? "Your requested feature is ready" : "Your requested feature is planned",
      content: ready
        ? `"${updated.title}" is ready${updated.admin_note ? `: ${updated.admin_note}` : ". Ask your agent to use it."}`
        : `"${updated.title}" is planned${updated.admin_note ? `: ${updated.admin_note}` : "."}`,
      related_id: requestId,
    });
    notified = !notifyError;
    if (notifyError) console.warn("[agent-tool-requests] notify failed:", notifyError.message);

    // Shipped: the agent also tells the learner in their chat, not only the bell.
    if (ready) {
      try {
        await informLearnerInChat({
          userId: updated.requester_id,
          title: "Your feature is ready",
          text: `Good news — the feature you asked for, "${updated.title}", is ready${updated.admin_note ? `: ${updated.admin_note}` : "."} Ask me to use it any time.`,
        });
      } catch (e) { console.warn("[agent-tool-requests] chat message failed:", e?.message || e); }
    }
  }

  return { request: updated, notified };
}
