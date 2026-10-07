/**
 * Durable, learner-reviewed proposals for Python-agent write tools.
 *
 * A proposal is not an account action. The signed confirmation token minted
 * after review is still checked against this row and atomically consumed by the
 * private gateway before any task or future chat can be changed.
 */
import { randomUUID } from "node:crypto";

import db from "../../db.js";
import {
  agentToolArgumentsDigest,
  issueAgentToolsWriteConfirmation,
} from "./capability.js";

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_SECONDS = 5 * 60;

function asIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function publicConfirmation(row) {
  return {
    confirmationId: row.id,
    tool: row.tool_name,
    preview: row.preview ?? {},
    status: row.status,
    expiresAt: asIso(row.expires_at),
    createdAt: asIso(row.created_at),
    confirmedAt: asIso(row.confirmed_at),
  };
}

function databaseError(error, message) {
  const wrapped = new Error(message);
  wrapped.cause = error;
  return wrapped;
}

/** Store an idempotent, non-executing learner write proposal. */
export async function requestWriteConfirmation({
  claims, principal, sessionId, toolName, arguments_, preview, proposalKey,
}) {
  const now = new Date();
  // A confirmation may never outlive the session-bound capability that
  // authorised the proposal. `exp` is a verified JWT claim at this point.
  const capabilityExpiry = Number(claims.exp) * 1000;
  const expiryMs = Number.isFinite(capabilityExpiry)
    ? Math.min(now.getTime() + CONFIRMATION_TTL_MS, capabilityExpiry)
    : now.getTime() + CONFIRMATION_TTL_MS;
  if (expiryMs <= now.getTime()) throw new Error("Action confirmation has expired");
  const row = {
    id: randomUUID(),
    capability_jti: claims.jti,
    session_id: sessionId,
    principal_id: principal.id,
    tool_name: toolName,
    tool_arguments: arguments_,
    arguments_digest: agentToolArgumentsDigest(arguments_),
    preview,
    proposal_key: proposalKey,
    status: "pending",
    expires_at: new Date(expiryMs).toISOString(),
  };
  const { data, error } = await db.schema("edu").from("agent_tool_write_confirmations")
    .insert(row).select().maybeSingle();
  if (!error && data) return publicConfirmation(data);

  // Retrying the same model tool call must show the original review card, not
  // create duplicate pending actions. The unique constraint enforces this even
  // when two Python requests race.
  if (error?.code === "23505") {
    const { data: existing, error: readError } = await db.schema("edu")
      .from("agent_tool_write_confirmations")
      .select("*")
      .eq("capability_jti", claims.jti)
      .eq("proposal_key", proposalKey)
      .maybeSingle();
    if (readError || !existing) throw databaseError(readError || error, "Could not load the pending confirmation");
    return publicConfirmation(existing);
  }
  throw databaseError(error, "Could not prepare the action for confirmation");
}

/** List reviewable confirmations for their signed-in owner, never raw inputs. */
export async function listWriteConfirmations({ userId, statuses = ["pending", "confirmed"] }) {
  const { data, error } = await db.schema("edu").from("agent_tool_write_confirmations")
    .select("id, tool_name, preview, status, expires_at, created_at, confirmed_at")
    .eq("principal_id", userId)
    .in("status", statuses)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw databaseError(error, "Could not load action confirmations");
  return (data ?? []).map(publicConfirmation);
}

async function ownedConfirmation(id, userId) {
  const { data, error } = await db.schema("edu").from("agent_tool_write_confirmations")
    .select("*").eq("id", id).eq("principal_id", userId).maybeSingle();
  if (error) throw databaseError(error, "Could not load the action confirmation");
  return data;
}

function isExpired(row, now = new Date()) {
  return !row?.expires_at || new Date(row.expires_at).getTime() <= now.getTime();
}

async function expireIfNeeded(row) {
  if (!isExpired(row) || !["pending", "confirmed"].includes(row.status)) return false;
  await db.schema("edu").from("agent_tool_write_confirmations")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("id", row.id).in("status", ["pending", "confirmed"]);
  return true;
}

/** Approve one reviewed proposal and issue a token only Python can redeem. */
export async function confirmWriteConfirmation({ confirmationId, userId }) {
  let row = await ownedConfirmation(confirmationId, userId);
  if (!row) throw new Error("Action confirmation was not found");
  if (await expireIfNeeded(row)) throw new Error("Action confirmation has expired");
  if (row.status === "rejected") throw new Error("Action confirmation was declined");
  if (row.status === "consumed") throw new Error("Action confirmation was already used");

  if (row.status === "pending") {
    const { data: confirmed, error } = await db.schema("edu").from("agent_tool_write_confirmations")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("principal_id", userId).eq("status", "pending")
      .select().maybeSingle();
    if (error) throw databaseError(error, "Could not confirm the action");
    if (!confirmed) throw new Error("Action confirmation is no longer available");
    row = confirmed;
  }

  const token = issueAgentToolsWriteConfirmation({
    userId,
    sessionId: row.session_id,
    capabilityJti: row.capability_jti,
    confirmationId: row.id,
    toolName: row.tool_name,
    argumentsDigest: row.arguments_digest,
    ttlSeconds: TOKEN_TTL_SECONDS,
  });
  // sessionId is for the trusted Node → Python relay only. The browser route
  // strips it together with the token before responding to the learner.
  return { ...publicConfirmation(row), confirmationToken: token, sessionId: row.session_id };
}

/** Decline a proposal before it can be redeemed. It cannot be reactivated. */
export async function rejectWriteConfirmation({ confirmationId, userId }) {
  const row = await ownedConfirmation(confirmationId, userId);
  if (!row) throw new Error("Action confirmation was not found");
  if (await expireIfNeeded(row)) throw new Error("Action confirmation has expired");
  if (row.status === "consumed") throw new Error("Action confirmation was already used");
  if (row.status === "rejected") return publicConfirmation(row);

  const { data: rejected, error } = await db.schema("edu").from("agent_tool_write_confirmations")
    .update({ status: "rejected", rejected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", row.id).eq("principal_id", userId).in("status", ["pending", "confirmed"])
    .select().maybeSingle();
  if (error) throw databaseError(error, "Could not decline the action");
  if (!rejected) throw new Error("Action confirmation is no longer available");
  return publicConfirmation(rejected);
}

/**
 * Atomically claim a reviewed write immediately before gateway execution.
 * Return the server-stored, already-validated input—not a model-provided copy.
 */
export async function consumeWriteConfirmation({ confirmation, claims, principal, sessionId }) {
  const { data: row, error } = await db.schema("edu").from("agent_tool_write_confirmations")
    .select("*")
    .eq("id", confirmation.confirmationId)
    .eq("principal_id", principal.id)
    .eq("capability_jti", claims.jti)
    .eq("session_id", sessionId)
    .eq("tool_name", confirmation.toolName)
    .eq("arguments_digest", confirmation.argumentsDigest)
    .eq("status", "confirmed")
    .maybeSingle();
  if (error) throw databaseError(error, "Could not validate action confirmation");
  if (!row) throw new Error("Action confirmation is invalid, expired, or already used");
  if (await expireIfNeeded(row)) throw new Error("Action confirmation has expired");

  const { data: consumed, error: consumeError } = await db.schema("edu")
    .from("agent_tool_write_confirmations")
    .update({ status: "consumed", consumed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", row.id).eq("status", "confirmed")
    .select().maybeSingle();
  if (consumeError) throw databaseError(consumeError, "Could not consume action confirmation");
  if (!consumed) throw new Error("Action confirmation is already being used");
  return { toolName: consumed.tool_name, arguments_: consumed.tool_arguments };
}
