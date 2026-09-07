/**
 * Shared persistence for learner-approved Agent Chat tool requests.
 *
 * This deliberately stores a compact capability need rather than the original
 * conversation. A request is product feedback for Akoro admins, not a support
 * transcript, an execution queue, or permission for an agent to obtain a new
 * integration by itself.
 */
import { createHash } from "node:crypto";

import db from "../../db.js";
import { normaliseToolRequest } from "./validation.js";

function fingerprint({ title, description, category }) {
  return createHash("sha256")
    .update(JSON.stringify({
      title: title.toLocaleLowerCase("en-US"),
      description: description.toLocaleLowerCase("en-US"),
      category,
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
      request_fingerprint: requestFingerprint,
      status: "new",
      created_at: now,
      updated_at: now,
      last_status_changed_at: now,
    })
    .select("id, title, category, status, created_at")
    .maybeSingle();

  if (!inserted.error && inserted.data) {
    return publicLearnerToolRequest({ ...inserted.data, createdNew: true });
  }
  if (inserted.error?.code !== "23505") {
    throw new Error("Tool request could not be saved");
  }

  const existing = await db.schema("edu").from("agent_tool_requests")
    .select("id, title, category, status, created_at")
    .eq("requester_id", learnerId)
    .eq("request_fingerprint", requestFingerprint)
    .maybeSingle();
  if (existing.error || !existing.data) throw new Error("Tool request could not be saved");
  return publicLearnerToolRequest({ ...existing.data, createdNew: false });
}
