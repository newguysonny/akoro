/**
 * modules/self-tooling/escalation.js — stage 4 of create_tool and the resume
 * after an admin decides (plan §7.8, §7.11).
 *
 *   escalate()         a goal needs a LOCKED capability → a request in the
 *                      existing Agent requests queue (kind 'capability') with
 *                      a resume ticket (the proposed tool + the chat it came from)
 *   decideRequest()    admin approve | deny | plan. Approve grants the
 *                      capability for EVERYONE (decision S10) and resumes every
 *                      waiting request for it; deny posts the admin's note.
 *   resumeRequest()    re-runs the stored create_tool as the learner and posts
 *                      the outcome into the original chat, plus a notification.
 *   expireRequests()   open requests older than 14 days → expired.
 *
 * The agent only ever reports `escalated` after the row exists (rule: never
 * claim a request that wasn't made).
 */
import { createHash, randomUUID } from "node:crypto";
import db from "../../db.js";
import { CAPABILITIES, FORBIDDEN } from "./capabilities.js";
import { activeGrants } from "./registry.js";
import { notifyUser } from "../notify.js";

const edu = () => db.schema("edu");
export const REQUEST_TTL_DAYS = 14;
const OPEN = ["new", "under_review", "planned"];
const MAX_OPEN_PER_LEARNER = 5;
const COLUMNS = "id, requester_id, kind, requested_capability, goal, proposed_tool, conversation_id, status, resume_status, resume_result, admin_note, expires_at, resolved_at, created_at, updated_at";

const norm = (goal) => String(goal || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const fingerprint = (capability, goal) => createHash("sha256").update(JSON.stringify({ kind: "capability", capability, goal: norm(goal) })).digest("hex");
const plain = (capability) => (CAPABILITIES[capability]?.description || capability).replace(/\.$/, "");

/** The learner-facing line for a request ("Asked for permission to …"). */
export const requestLine = (capability) => `Asked an admin for permission: ${plain(capability).charAt(0).toLowerCase()}${plain(capability).slice(1)}.`;

/**
 * Write (or return the open) capability request. → create_tool result.
 * `proposed`: { name, label, params, hint, run } — enough to re-run create_tool.
 */
export async function escalate({ learnerId, capability, goal, proposed, conversationId = null, dry = false }) {
  const cap = CAPABILITIES[capability];
  if (!cap || FORBIDDEN.some((f) => f.name === capability)) return { status: "rejected", reason: "That isn't something a tool can be allowed to do." };
  if (cap.status !== "locked") return { status: "rejected", reason: "That capability doesn't need a permission." };
  if (cap.kind !== "read" && !cap.target) {
    // A write a built tool can't target yet — no request a grant couldn't satisfy.
    return { status: "rejected", reason: "Tools can't make this kind of change yet — it's on the roadmap." };
  }
  const line = requestLine(capability);
  if (dry) {
    return { status: "escalated", dryRun: true, capability, wouldRequest: line,
      note: "DRY RUN — no request was made. Tell the learner this needs an admin's permission and you could ask for it." };
  }
  const now = new Date();
  const ticket = {
    kind: "capability", requested_capability: capability, goal: String(goal).slice(0, 300),
    proposed_tool: proposed, conversation_id: conversationId || null,
    status: "new", resume_status: "waiting", resume_result: null, resolved_at: null,
    expires_at: new Date(now.getTime() + REQUEST_TTL_DAYS * 86_400_000).toISOString(), updated_at: now.toISOString(), last_status_changed_at: now.toISOString(),
  };
  const fp = fingerprint(capability, goal);

  // A duplicate (same learner, capability, goal) returns the open request — or re-opens a closed one.
  const { data: existing } = await edu().from("agent_tool_requests").select("id, status").eq("requester_id", learnerId).eq("request_fingerprint", fp).maybeSingle();
  if (existing) {
    if (OPEN.includes(existing.status)) {
      // Resume into the chat the learner is in now.
      await edu().from("agent_tool_requests").update({ conversation_id: conversationId || null, proposed_tool: proposed, updated_at: now.toISOString() }).eq("id", existing.id);
      return { status: "escalated", requestId: existing.id, capability, duplicate: true, request: line, note: escalatedNote(capability, true) };
    }
    if (existing.status === "approved" && (await activeGrants({ fresh: true })).has(capability)) {
      return { status: "rejected", reason: "This was already approved — build the tool again now." };
    }
    const { error } = await edu().from("agent_tool_requests").update(ticket).eq("id", existing.id);
    if (error) throw new Error(`couldn't re-open the request: ${error.message}`);
    return { status: "escalated", requestId: existing.id, capability, request: line, note: escalatedNote(capability) };
  }

  const { count } = await edu().from("agent_tool_requests").select("*", { count: "exact", head: true })
    .eq("requester_id", learnerId).eq("kind", "capability").in("status", OPEN);
  if ((count || 0) >= MAX_OPEN_PER_LEARNER) return { status: "rejected", reason: `You already have ${MAX_OPEN_PER_LEARNER} permission requests waiting — wait for an answer first.` };

  const title = `Permission: ${plain(capability)}`.slice(0, 120);
  const description = `The learner's agent needs "${capability}" to build a tool for: ${String(goal).slice(0, 600)}`.padEnd(20, ".").slice(0, 800);
  const { data: row, error } = await edu().from("agent_tool_requests").insert({
    requester_id: learnerId, title, description, category: "other", request_fingerprint: fp, created_at: now.toISOString(), ...ticket,
  }).select("id").single();
  if (error) throw new Error(`couldn't save the request: ${error.message}`);
  return { status: "escalated", requestId: row.id, capability, request: line, note: escalatedNote(capability) };
}

const escalatedNote = (capability, duplicate = false) =>
  `${duplicate ? "This permission was already requested and is waiting." : "A request was sent to an admin."} Tell the learner plainly: you need permission to ${plain(capability).charAt(0).toLowerCase()}${plain(capability).slice(1)}; an admin will decide, and the answer will arrive in this chat. Don't build anything else for it now.`;

// ── admin decisions ─────────────────────────────────────────────────────

async function auditAdmin(admin, action, entityId, before, after) {
  const { error } = await db.from("admin_audit_log").insert({
    actor: admin?.id ?? null, actor_label: admin?.label || "admin",
    action, entity_type: "agent_tool_request", entity_id: entityId, before: before ?? null, after: after ?? null,
  });
  if (error) console.warn("[self-tooling] audit insert failed:", error.message);
}

/**
 * approve | deny | plan a capability request. `admin`: { id, label }.
 * `enqueue(requestId)` schedules a resume (the queue lives in resumeQueue.js).
 * → { request, grant?, resumed: [ids] }
 */
export async function decideRequest({ requestId, decision, note = null, expiresAt = null, admin, enqueue }) {
  const { data: r, error } = await edu().from("agent_tool_requests").select(COLUMNS).eq("id", requestId).maybeSingle();
  if (error) throw new Error("Couldn't load the request");
  if (!r) throw Object.assign(new Error("Request not found"), { status: 404 });
  if (r.kind !== "capability") throw Object.assign(new Error("Only capability requests are decided here"), { status: 422 });
  const cap = CAPABILITIES[r.requested_capability];
  const now = new Date().toISOString();
  const cleanNote = note ? String(note).replace(/\s+/g, " ").trim().slice(0, 500) : null;

  if (decision === "approve") {
    if (!cap || cap.status !== "locked" || !(cap.kind === "read" || cap.target)) throw Object.assign(new Error("This capability can't be granted yet (no tool can target it)."), { status: 422 });
    if (expiresAt && !(Date.parse(expiresAt) > Date.now())) throw Object.assign(new Error("expiresAt must be in the future"), { status: 422 });
    let grant = null;
    const { data: live } = await edu().from("capability_grants").select("id, expires_at").eq("capability", r.requested_capability).is("revoked_at", null);
    grant = (live || []).find((g) => !g.expires_at || g.expires_at > now) || null;
    if (!grant) {
      const ins = await edu().from("capability_grants").insert({ capability: r.requested_capability, granted_by: admin?.id || null, request_id: r.id, note: cleanNote, expires_at: expiresAt || null }).select("id, expires_at").single();
      if (ins.error) throw new Error(`Couldn't save the grant: ${ins.error.message}`);
      grant = ins.data;
    }
    await activeGrants({ fresh: true });
    // Every waiting request for this capability resumes (S10), not only this one.
    const { data: waiting } = await edu().from("agent_tool_requests").select("id")
      .eq("kind", "capability").eq("requested_capability", r.requested_capability).in("status", OPEN);
    const ids = [...new Set([r.id, ...(waiting || []).map((w) => w.id)])];
    await edu().from("agent_tool_requests").update({ status: "approved", resume_status: "waiting", admin_note: cleanNote, reviewed_by: admin?.id || null, updated_at: now, last_status_changed_at: now })
      .in("id", ids).in("status", [...OPEN, "approved"]);
    await auditAdmin(admin, "capability.approve", r.id, { status: r.status }, { capability: r.requested_capability, grantId: grant.id, expiresAt: grant.expires_at, resumes: ids.length });
    const resumed = [];
    for (const id of ids) {
      try { await enqueue(id); resumed.push(id); }
      catch (e) { console.warn("[self-tooling] resume not queued, the sweep will retry:", id, e.message); }
    }
    return { request: { ...r, status: "approved" }, grant, resumed };
  }

  if (decision === "deny" || decision === "plan") {
    const status = decision === "deny" ? "declined" : "planned";
    await edu().from("agent_tool_requests").update({ status, resume_status: decision === "deny" ? "cancelled" : r.resume_status, admin_note: cleanNote, reviewed_by: admin?.id || null,
      resolved_at: decision === "deny" ? now : null, updated_at: now, last_status_changed_at: now }).eq("id", r.id);
    await auditAdmin(admin, `capability.${decision}`, r.id, { status: r.status }, { status, note: cleanNote });
    const label = r.proposed_tool?.label || "your tool";
    const text = decision === "deny"
      ? `I asked for permission to ${plain(r.requested_capability).charAt(0).toLowerCase()}${plain(r.requested_capability).slice(1)} so I could build "${label}", but it wasn't approved${cleanNote ? `: ${cleanNote}` : "."} I can help another way if you like.`
      : `Update on "${label}": the Akoro team has put this on their plan${cleanNote ? ` — ${cleanNote}` : ""}. I'll let you know here when it's possible.`;
    await postIntoChat({ userId: r.requester_id, conversationId: r.conversation_id, title: label, text, kind: decision === "deny" ? "agent_request_declined" : "agent_request_planned" });
    return { request: { ...r, status }, resumed: [] };
  }
  throw Object.assign(new Error("decision must be approve, deny or plan"), { status: 422 });
}

/** Revoke a grant (the capability is off again at once; saved tools using it stop). */
export async function revokeGrant({ grantId, admin }) {
  const now = new Date().toISOString();
  const { data, error } = await edu().from("capability_grants").update({ revoked_at: now, revoked_by: admin?.id || null }).eq("id", grantId).is("revoked_at", null).select("id, capability").maybeSingle();
  if (error) throw new Error("Couldn't revoke the grant");
  if (!data) throw Object.assign(new Error("Grant not found or already revoked"), { status: 404 });
  await activeGrants({ fresh: true });
  await auditAdmin(admin, "capability.revoke", grantId, null, { capability: data.capability });
  return data;
}

// ── delivery into the chat ───────────────────────────────────────────────

/**
 * Post the agent's message into the learner's chat — the request's chat if it
 * still exists and is theirs, else a new chat — and notify. Idempotent per
 * `messageId` when given. `meta` rides the message (a card: { battle }), and
 * `createId` names the chat to create (and reuse) when there is none.
 */
export async function postIntoChat({ userId, conversationId, title, text, kind = "agent_follow_up", messageId = null, meta = null, createId = null }) {
  const now = new Date().toISOString();
  let sessionId = null;
  if (conversationId) {
    const { data } = await db.from("chat_sessions").select("id").eq("id", conversationId).eq("user_id", userId).maybeSingle();
    sessionId = data?.id || null;
  }
  if (!sessionId && createId) {
    // A thread kept for one purpose (a Study Prep session's chat): reuse it by id.
    const { data } = await db.from("chat_sessions").select("id").eq("id", createId).eq("user_id", userId).maybeSingle();
    sessionId = data?.id || null;
  }
  if (!sessionId) {
    sessionId = createId || randomUUID();
    const { error } = await db.from("chat_sessions").insert({ id: sessionId, user_id: userId, title: String(title || "Your agent").slice(0, 80), created_at: now, updated_at: now, last_message_at: now });
    if (error) throw new Error("couldn't create the chat");
  }
  const { error } = await db.from("chat_messages").upsert({ id: messageId || randomUUID(), session_id: sessionId, user_id: userId, role: "agent", text, created_at: now, ...(meta ? { meta } : {}) }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error("couldn't post into the chat");
  await db.from("chat_sessions").update({ updated_at: now, last_message_at: now }).eq("id", sessionId).eq("user_id", userId).then(() => {}, () => {});
  const link = `/app?tab=agent&sessionId=${encodeURIComponent(sessionId)}`;
  await notifyUser({ userId, type: kind, title: String(title || "Your agent").slice(0, 120), content: text.slice(0, 300), relatedId: sessionId, link }).catch(() => {});
  try { global.io?.to(`user:${userId}`).emit("chat_follow_up_ready", { sessionId, title }); } catch { /* the notification is the durable path */ }
  return { sessionId };
}

// ── resume ───────────────────────────────────────────────────────────────

const fmt = (v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)) : String(v ?? "—"));
/** A short plain-text table of the first rows, for the posted message. */
export function rowsText(rows = [], max = 10) {
  if (!rows.length) return "There's nothing to show yet.";
  const keys = Object.keys(rows[0]).slice(0, 6);
  return rows.slice(0, max).map((r) => `• ${keys.map((k) => `${k.replace(/_/g, " ")}: ${fmt(r[k])}`).join(", ")}`).join("\n")
    + (rows.length > max ? `\n…and ${rows.length - max} more.` : "");
}

/**
 * Resume one approved request: claim it (approved/waiting → resuming), rebuild
 * the proposed tool as the learner, and tell their chat it's on, with a Run it
 * now button (meta.runTool). The learner is usually not there when an admin
 * decides, so nothing is run for them in the background: their tap starts a
 * normal agent turn — thinking, the tool, an explained answer, or ONE Confirm
 * card for a change, then a check. `createTool` is injected (pipeline.js imports this module).
 */
export async function resumeRequest(requestId, { createTool }) {
  const now = new Date().toISOString();
  const { data: claimed, error } = await edu().from("agent_tool_requests").update({ resume_status: "resuming", updated_at: now })
    .eq("id", requestId).eq("status", "approved").in("resume_status", ["waiting", "failed"]).select(COLUMNS).maybeSingle();
  if (error) throw new Error("couldn't claim the request");
  if (!claimed) return { skipped: true };
  const p = claimed.proposed_tool || {};
  const label = p.label || "your tool";
  await activeGrants({ fresh: true });   // the grant may have been made on another instance
  let out;
  try {
    out = await createTool({ learnerId: claimed.requester_id, resumed: true, conversationId: claimed.conversation_id, audience: p.audience || "learner",
      input: { goal: claimed.goal, name: p.name, label, params: p.params || {}, run: p.run || {}, hint: { ...(p.hint || {}), capabilities: [...new Set([...[].concat(p.hint?.capabilities || []), claimed.requested_capability])] } } });
  } catch (e) {
    out = { status: "failed", reason: e.message };
  }
  const messageId = `00000000-0000-4000-8000-${createHash("sha256").update(requestId).digest("hex").slice(0, 12)}`;
  // The build's own check run made a change card: that card would wait in the chat with no turn behind it,
  // and running the tool from the chat would make a second one. The learner's Run it now makes the one card.
  const stray = out.result?.confirmation?.confirmationId;
  if (stray) await edu().from("agent_tool_write_confirmations").delete().eq("id", stray).eq("principal_id", claimed.requester_id).eq("status", "pending").then(() => {}, () => {});
  let text;
  let meta = null;
  if (out.status === "created") {
    const changes = !!out.result?.confirmation;
    text = `Good news — the Akoro team gave me permission, so I built "${out.label || label}" for you. ${changes ? "Nothing has changed yet: tap **Run it now** and I'll show you exactly what it would change, and you confirm it." : "Tap **Run it now** and I'll run it here and walk you through what it finds."} It's saved in your tools for next time.`;
    meta = { runTool: { name: out.tool || p.name, label: out.label || label, changes } };
  } else if (out.status === "escalated") {
    text = `I was given permission for "${label}", but it turned out to need one more permission, so I've asked for that too. I'll come back here when it's decided.`;
  } else {
    text = `I was given permission for "${label}", but I couldn't build it safely: ${String(out.reason || "something went wrong").slice(0, 200)} Ask me again and I'll try a different way.`;
  }
  const delivered = await postIntoChat({ userId: claimed.requester_id, conversationId: claimed.conversation_id, title: label, text, kind: "agent_request_resumed", messageId, ...(meta ? { meta } : {}) }).catch((e) => ({ error: e.message }));
  const ok = out.status === "created" && !delivered.error;
  await edu().from("agent_tool_requests").update({
    resume_status: delivered.error ? "failed" : ok ? "resumed" : "failed",
    status: ok ? "implemented" : "approved",
    resume_result: { status: out.status, reason: out.reason || null, ...(out.tried?.length ? { tried: out.tried } : {}), tool: out.tool || null, sessionId: delivered.sessionId || null, at: new Date().toISOString() },
    resolved_at: ok ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  }).eq("id", requestId);
  return { resumed: ok, status: out.status, sessionId: delivered.sessionId || null };
}

/** Approved requests still waiting (a lost job) — the sweep re-queues them. */
export async function waitingResumes(limit = 20) {
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data } = await edu().from("agent_tool_requests").select("id, resume_status, updated_at").eq("kind", "capability").eq("status", "approved")
    .or(`resume_status.eq.waiting,and(resume_status.eq.resuming,updated_at.lt.${stale})`).limit(limit);
  return data || [];
}

/** Open requests past their expiry → expired; the learner is told once. */
export async function expireRequests() {
  const now = new Date().toISOString();
  const { data } = await edu().from("agent_tool_requests").update({ status: "expired", resume_status: "expired", resolved_at: now, updated_at: now, last_status_changed_at: now })
    .eq("kind", "capability").in("status", OPEN).lt("expires_at", now).select("id, requester_id, conversation_id, proposed_tool, requested_capability");
  for (const r of data || []) {
    await postIntoChat({ userId: r.requester_id, conversationId: r.conversation_id, title: r.proposed_tool?.label || "Your request",
      text: `No decision came on my request for permission to ${plain(r.requested_capability).charAt(0).toLowerCase()}${plain(r.requested_capability).slice(1)}, so it has expired. Ask me again if you still want "${r.proposed_tool?.label || "that tool"}".`,
      kind: "agent_request_expired" }).catch(() => {});
  }
  return { expired: (data || []).length };
}

/** The learner's own capability requests (Settings → Agent → My tools). */
export async function listMyRequests(learnerId) {
  const { data, error } = await edu().from("agent_tool_requests").select("id, requested_capability, goal, proposed_tool, status, resume_status, admin_note, expires_at, created_at, resolved_at")
    .eq("requester_id", learnerId).eq("kind", "capability").order("created_at", { ascending: false }).limit(30);
  if (error) throw new Error("Couldn't load your requests");
  return (data || []).map((r) => ({ id: r.id, permission: plain(r.requested_capability), goal: r.goal, label: r.proposed_tool?.label || null,
    status: r.status, resumeStatus: r.resume_status, note: r.status === "declined" || r.status === "planned" ? r.admin_note : null,
    expiresAt: r.expires_at, createdAt: r.created_at, resolvedAt: r.resolved_at }));
}

/** Learner withdraws a waiting request. */
export async function cancelMyRequest(learnerId, id) {
  const now = new Date().toISOString();
  const { data, error } = await edu().from("agent_tool_requests").update({ status: "declined", resume_status: "cancelled", admin_note: "Withdrawn by the learner", resolved_at: now, updated_at: now })
    .eq("id", id).eq("requester_id", learnerId).eq("kind", "capability").in("status", OPEN).select("id").maybeSingle();
  if (error) throw new Error("Couldn't withdraw the request");
  if (!data) throw Object.assign(new Error("Request not found or already decided"), { status: 404 });
  return data;
}
