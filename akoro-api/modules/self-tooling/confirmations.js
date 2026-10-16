/**
 * modules/self-tooling/confirmations.js — confirm-before-write for tools the
 * learner's agent built (plan §7.14, phase S6), in the Node chat.
 *
 * A tool with a write step never writes when it runs. It PROPOSES: the exact
 * rows it would change (by private id) are stored server-side as a pending
 * confirmation, and the learner sees a card listing them. Only the learner's
 * own tap on Confirm executes them — each row through its write runner, the
 * owner checked again — and only if the capability is still granted.
 *
 * Stored in edu.agent_tool_write_confirmations (the table the Python gateway
 * path uses), tagged capability_jti 'selftool' and tool_name 'selftool:<cap>'
 * so the two paths never consume each other's rows.
 */
import { createHash, randomUUID } from "node:crypto";
import db from "../../db.js";
import { CAPABILITIES } from "./capabilities.js";
import { capabilityStatus } from "./registry.js";
import { WRITE_RUNNERS } from "./capRuntime.js";
import { agentToolArgumentsDigest } from "../agent-tools/capability.js";

const edu = () => db.schema("edu");
const TABLE = "agent_tool_write_confirmations";
export const CONFIRM_TTL_MS = 10 * 60 * 1000;
const JTI = "selftool";

const httpError = (status, message) => Object.assign(new Error(message), { status });

const publicConfirmation = (row) => ({
  confirmationId: row.id,
  status: row.status,
  title: row.preview?.title || null,
  action: row.preview?.action || null,
  items: row.preview?.items || [],
  more: row.preview?.more || 0,
  result: row.preview?.result || null,
  expiresAt: row.expires_at,
});

/**
 * Store a proposed write (idempotent per learner + tool + exact targets within
 * the TTL window). → the card the chat shows.
 */
export async function proposeWrite({ learnerId, conversationId = null, tool, write }) {
  if (!write?.targets?.length) return { status: "nothing_to_change", note: "Nothing matched, so nothing would change. Tell the learner plainly." };
  const args = { toolId: tool.id, toolName: tool.name, cap: write.cap, refs: write.targets.map((t) => t.ref).sort() };
  const digest = agentToolArgumentsDigest(args);
  const bucket = Math.floor(Date.now() / CONFIRM_TTL_MS);
  const preview = { title: tool.label, action: write.does, items: write.targets.map((t) => t.label), more: write.more || 0 };
  const row = {
    id: randomUUID(), capability_jti: JTI, session_id: conversationId || "none", principal_id: learnerId,
    tool_name: `selftool:${write.cap}`, tool_arguments: args, arguments_digest: digest, preview,
    proposal_key: createHash("sha256").update(`${learnerId}:${digest}:${bucket}`).digest("hex"),
    status: "pending", expires_at: new Date(Date.now() + CONFIRM_TTL_MS).toISOString(),
  };
  let { data, error } = await edu().from(TABLE).insert(row).select("*").maybeSingle();
  if (error?.code === "23505") {
    // The same proposal is already waiting: show that card again. One the
    // learner already declined or used is final — this is a new proposal.
    ({ data, error } = await edu().from(TABLE).select("*").eq("capability_jti", JTI).eq("proposal_key", row.proposal_key).maybeSingle());
    if (!error && data && data.status !== "pending") {
      ({ data, error } = await edu().from(TABLE).insert({ ...row, id: randomUUID(), proposal_key: `${row.proposal_key}:${randomUUID()}` }).select("*").maybeSingle());
    }
  }
  if (error || !data) throw new Error("couldn't prepare the change for confirmation");
  return {
    status: "needs_confirmation", confirmation: publicConfirmation(data),
    note: `NOTHING HAS CHANGED YET. The learner sees a card listing exactly what would change (${preview.items.length}${preview.more ? `+${preview.more}` : ""} item(s)) and must tap Confirm themselves. Tell them what will change and to confirm on the card. Never say it's done, and never confirm for them.`,
  };
}

async function owned(id, userId) {
  const { data, error } = await edu().from(TABLE).select("*").eq("id", id).eq("principal_id", userId).eq("capability_jti", JTI).maybeSingle();
  if (error) throw new Error("couldn't load the confirmation");
  if (!data) throw httpError(404, "Confirmation not found");
  return data;
}

export async function getConfirmation(id, userId) {
  return publicConfirmation(await owned(id, userId));
}

/**
 * The learner confirmed: claim the row (pending → consumed, atomically, once),
 * re-check the capability, then apply each target as this learner.
 * `callTool(name, args)` runs a learner chat tool as them (for runners that go
 * through an existing write tool).
 */
export async function confirmWrite({ id, userId, callTool }) {
  const row = await owned(id, userId);
  if (row.status !== "pending") throw httpError(409, row.status === "consumed" ? "Already done" : `This change was ${row.status}`);
  if (Date.parse(row.expires_at) <= Date.now()) {
    await edu().from(TABLE).update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
    throw httpError(410, "This confirmation expired — ask your agent again.");
  }
  const { cap, refs } = row.tool_arguments || {};
  const runner = WRITE_RUNNERS[cap];
  // Re-check BEFORE claiming: a revoked grant means nothing is changed.
  if (!runner || !CAPABILITIES[cap]?.target || (await capabilityStatus(cap)) !== "enabled") {
    await edu().from(TABLE).update({ status: "rejected", rejected_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
    throw httpError(403, "This kind of change isn't allowed any more, so nothing was changed.");
  }
  const now = new Date().toISOString();
  const { data: claimed, error } = await edu().from(TABLE).update({ status: "consumed", confirmed_at: now, consumed_at: now, updated_at: now })
    .eq("id", id).eq("principal_id", userId).eq("status", "pending").select("*").maybeSingle();
  if (error) throw new Error("couldn't confirm");
  if (!claimed) throw httpError(409, "Already handled");

  let done = 0;
  const failed = [];
  for (const ref of (Array.isArray(refs) ? refs : []).slice(0, 50)) {
    let r;
    try { r = await runner(userId, String(ref), { callTool }); } catch (e) { r = { ok: false, error: e.message }; }
    if (r?.ok) done++; else failed.push(String(r?.error || "failed").slice(0, 120));
  }
  const result = { done, failed: failed.length, errors: [...new Set(failed)].slice(0, 3), at: new Date().toISOString() };
  await edu().from(TABLE).update({ preview: { ...claimed.preview, result }, updated_at: new Date().toISOString() }).eq("id", id);
  return { ...publicConfirmation({ ...claimed, preview: { ...claimed.preview, result } }) };
}

export async function rejectWrite({ id, userId }) {
  const row = await owned(id, userId);
  if (row.status !== "pending") return publicConfirmation(row);
  const { data } = await edu().from(TABLE).update({ status: "rejected", rejected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id).eq("principal_id", userId).eq("status", "pending").select("*").maybeSingle();
  return publicConfirmation(data || row);
}
