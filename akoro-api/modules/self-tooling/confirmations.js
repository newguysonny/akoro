/**
 * modules/self-tooling/confirmations.js — confirm-before-write for tools the
 * learner's agent built (plan §7.14, phase S6), in the Node chat.
 *
 * A tool with a write step never writes when it runs. It PROPOSES: the exact
 * rows it would change (by private id) are stored server-side as a pending
 * confirmation, and the learner sees a card listing them. The learner's tap
 * records the decision only; the agent's `await_decision` tool call applies
 * it — each row through its write runner, the owner checked again — and only
 * if the capability is still granted.
 *
 * Stored in edu.agent_tool_write_confirmations (the table the Python gateway
 * path uses), tagged capability_jti 'selftool' and tool_name 'selftool:<cap>'
 * so the two paths never consume each other's rows.
 */
import { createHash, randomUUID } from "node:crypto";
import db from "../../db.js";
import { CAPABILITIES, learnerGrantable } from "./capabilities.js";
import { capabilityStatus, learnerGrants } from "./registry.js";
import { WRITE_RUNNERS } from "./capRuntime.js";
import { agentToolArgumentsDigest } from "../agent-tools/capability.js";
import { basisColumns, basisOfRow, currentActionBasis } from "../agent-runtime/actionBasis.js";

const edu = () => db.schema("edu");
const TABLE = "agent_tool_write_confirmations";
export const CONFIRM_TTL_MS = 10 * 60 * 1000;
// A permission card waits longer: the learner may read it later in the day.
export const PERMISSION_TTL_MS = 24 * 60 * 60 * 1000;
const JTI = "selftool";

const httpError = (status, message) => Object.assign(new Error(message), { status });
/** A capability's description, said to the learner: "Delete the learner's tasks." → "Delete your tasks". */
const toLearner = (description) => String(description || "").replace(/\bthe learner's\b/gi, "your").replace(/\bthe learner\b/gi, "you").replace(/\.$/, "");

const publicConfirmation = (row) => ({
  confirmationId: row.id,
  kind: row.tool_arguments?.kind === "permission" ? "permission" : row.tool_arguments?.kind === "build" ? "build" : "change",
  // The chat it was made in: the app shows a waiting change only there.
  sessionId: row.session_id && row.session_id !== "none" ? row.session_id : null,
  // A permission card for a drafted tool: its goal, and the items are what it would change right now.
  ...((row.tool_arguments?.kind === "permission" || row.tool_arguments?.kind === "build") ? { goal: row.preview?.goal || null, drafted: !!row.tool_arguments?.toolId, ...(row.tool_arguments?.kind === "build" ? { writes: !!row.preview?.writes } : {}) } : {}),
  // The table's word for a recorded approval is 'confirmed'; the app calls it 'approved'.
  status: row.status === "confirmed" ? "approved" : row.status,
  title: row.preview?.title || null,
  action: row.preview?.action || null,
  items: row.preview?.items || [],
  more: row.preview?.more || 0,
  result: row.preview?.result || null,
  expiresAt: row.expires_at,
  // Asked or inferred (Phase 18 item 6).
  ...basisOfRow(row),
});

/**
 * Store a proposed write (idempotent per learner + tool + exact targets within
 * the TTL window). → the card the chat shows.
 */
export async function proposeWrite({ learnerId, conversationId = null, tool, write }) {
  if (!write?.targets?.length) return { status: "nothing_to_change", note: "Nothing matched, so nothing would change. Tell the learner plainly." };
  const args = { toolId: tool.id, toolName: tool.name, cap: write.cap, refs: write.targets.map((t) => t.ref).sort(), ...(write.args ? { args: write.args } : {}) };
  const digest = agentToolArgumentsDigest(args);
  const bucket = Math.floor(Date.now() / CONFIRM_TTL_MS);
  const said = toLearner(write.does);
  const preview = { title: tool.label, action: said.charAt(0).toUpperCase() + said.slice(1), items: write.targets.map((t) => t.label), more: write.more || 0 };
  const row = {
    id: randomUUID(), capability_jti: JTI, session_id: conversationId || "none", principal_id: learnerId,
    tool_name: `selftool:${write.cap}`, tool_arguments: args, arguments_digest: digest, preview,
    proposal_key: createHash("sha256").update(`${learnerId}:${digest}:${bucket}`).digest("hex"),
    status: "pending", expires_at: new Date(Date.now() + CONFIRM_TTL_MS).toISOString(),
    // Asked or inferred (Phase 18 item 6): the card is the audit row of the change it proposes.
    ...basisColumns(currentActionBasis() || { basis: "explicit" }),
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
    note: `NOTHING HAS CHANGED YET. The learner sees a card listing exactly what would change (${preview.items.length}${preview.more ? `+${preview.more}` : ""} item(s)) and must tap Allow themselves. Tell them what will change, then call await_decision with this confirmationId and WAIT for their tap inside this same turn — if it returns "waiting", call it again (up to 3 calls) instead of ending your turn. When it returns the outcome, report exactly what it says and continue with what they asked. Never say it's done before await_decision returns it, and never confirm for them.`,
  };
}

/**
 * The learner's agent needs a change capability the LEARNER can turn on for
 * themselves (learnerGrantable). Nothing is built or granted yet: the card asks
 * them; only their tap on Approve grants it (to them alone) and builds the tool
 * (confirmPermission). One card per learner + capability + goal while it waits.
 */
export async function proposePermission({ learnerId, conversationId = null, capability, proposed, toolId = null, changes = null }) {
  const cap = CAPABILITIES[capability];
  if (!learnerGrantable(capability)) throw new Error("only an admin can allow this");
  const args = { kind: "permission", cap: capability, proposed, ...(toolId ? { toolId } : {}) };
  const digest = agentToolArgumentsDigest({ kind: "permission", cap: capability, goal: proposed.goal, name: proposed.name, toolId });
  const bucket = Math.floor(Date.now() / PERMISSION_TTL_MS);
  // Said to the learner: "delete your tasks (…)".
  const action = toLearner(cap.description);
  // A drafted tool shows exactly what it would change right now; otherwise the goal.
  const preview = { title: proposed.label, action: action.charAt(0).toLowerCase() + action.slice(1), goal: proposed.goal,
    items: changes ? changes.items.slice(0, 20) : [proposed.goal], more: changes ? Math.max(0, changes.items.length - 20) + (changes.more || 0) : 0 };
  const row = {
    id: randomUUID(), capability_jti: JTI, session_id: conversationId || "none", principal_id: learnerId,
    tool_name: `selftool:permission:${capability}`, tool_arguments: args, arguments_digest: digest, preview,
    proposal_key: createHash("sha256").update(`${learnerId}:permission:${digest}:${bucket}`).digest("hex"),
    status: "pending", expires_at: new Date(Date.now() + PERMISSION_TTL_MS).toISOString(),
    ...basisColumns(currentActionBasis() || { basis: "explicit" }),
  };
  let { data, error } = await edu().from(TABLE).insert(row).select("*").maybeSingle();
  if (error?.code === "23505") {
    ({ data, error } = await edu().from(TABLE).select("*").eq("capability_jti", JTI).eq("proposal_key", row.proposal_key).maybeSingle());
    if (!error && data && data.status !== "pending") {
      ({ data, error } = await edu().from(TABLE).insert({ ...row, id: randomUUID(), proposal_key: `${row.proposal_key}:${randomUUID()}` }).select("*").maybeSingle());
    }
  }
  if (error || !data) throw new Error("couldn't prepare the permission card");
  return {
    status: "needs_permission", confirmation: publicConfirmation(data),
    note: (toolId
      ? `The tool "${proposed.label}" is drafted but OFF, and nothing has changed. The learner sees a card asking them to allow it (${cap.description}), listing what it would change right now (${preview.items.length}${preview.more ? `+${preview.more}` : ""} item(s)). Only their Allow turns it on — for them alone — and even then each change waits for their Confirm. In your own words: you've drafted it, here's what it would do, tap Allow on the card if they want it. Never say it's on or that anything changed, and never approve for them.`
      : `NOTHING IS BUILT YET. You don't have this ability yet, but you can build a tool for it: the learner sees a card asking them to allow it (${cap.description}) and only their tap on Allow turns it on — for them alone — and builds "${proposed.label}". Even then, every change it makes waits for their Confirm. Tell them that in plain words and to tap Allow on the card. Never say it's built or done, and never approve for them.`)
      + ` Then call await_decision with this confirmationId and WAIT for their tap inside this same turn — if it returns "waiting", call it again (up to 3 calls) instead of ending your turn. When it returns the outcome, report exactly what it says and continue.`,
  };
}

async function owned(id, userId) {
  const { data, error } = await edu().from(TABLE).select("*").eq("id", id).eq("principal_id", userId).eq("capability_jti", JTI).maybeSingle();
  if (error) throw new Error("couldn't load the confirmation");
  if (!data) throw httpError(404, "Confirmation not found");
  return data;
}

/** The learner's changes still waiting for their tap — the chat shows them again after a reload. */
export async function listPendingConfirmations(userId) {
  const { data, error } = await edu().from(TABLE).select("*").eq("principal_id", userId).eq("capability_jti", JTI)
    .eq("status", "pending").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(5);
  if (error) throw new Error("couldn't load waiting changes");
  return (data || []).map(publicConfirmation);
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
/**
 * A brand-new tool the agent built is saved OFF (pipeline's build-consent
 * gate): this card is where the learner commits it. The tool was already
 * built and verified — the dry run behind the card is what it answered with —
 * so the preview shows the goal and real sample lines, and Keep simply turns
 * the draft on. Nothing about the learner's data changes by keeping a reader;
 * a tool that can write still proposes every change on its own card.
 */
export async function proposeBuild({ learnerId, conversationId = null, proposed, toolId, does = null, writes = false, items = [], more = 0 }) {
  if (!toolId) throw new Error("a build card needs its drafted tool");
  const args = { kind: "build", toolId, proposed };
  const digest = agentToolArgumentsDigest({ kind: "build", name: proposed.name, goal: proposed.goal, toolId });
  const bucket = Math.floor(Date.now() / PERMISSION_TTL_MS);
  const preview = { title: proposed.label, action: does || "It only reads your own data.", goal: proposed.goal, writes: !!writes,
    items: (items || []).slice(0, 20), more: Math.max(0, (items || []).length - 20) + (more || 0) };
  const row = {
    id: randomUUID(), capability_jti: JTI, session_id: conversationId || "none", principal_id: learnerId,
    tool_name: `selftool:build:${proposed.name}`, tool_arguments: args, arguments_digest: digest, preview,
    proposal_key: createHash("sha256").update(`${learnerId}:build:${digest}:${bucket}`).digest("hex"),
    status: "pending", expires_at: new Date(Date.now() + PERMISSION_TTL_MS).toISOString(),
    ...basisColumns(currentActionBasis() || { basis: "explicit" }),
  };
  let { data, error } = await edu().from(TABLE).insert(row).select("*").maybeSingle();
  if (error?.code === "23505") {
    ({ data, error } = await edu().from(TABLE).select("*").eq("capability_jti", JTI).eq("proposal_key", row.proposal_key).maybeSingle());
    if (!error && data && data.status !== "pending") {
      ({ data, error } = await edu().from(TABLE).insert({ ...row, id: randomUUID(), proposal_key: `${row.proposal_key}:${randomUUID()}` }).select("*").maybeSingle());
    }
  }
  if (error || !data) throw new Error("couldn't prepare the build card");
  return {
    status: "needs_consent", confirmation: publicConfirmation(data),
    note: `The tool "${proposed.label}" is built and checked but OFF — the learner sees a card asking them to Keep it, and only their tap saves it in their tools. In your own words: you've built it, here's what it does, tap Keep on the card to save it. Then call await_decision with this confirmationId and WAIT for their tap inside this same turn — if it returns "waiting", call it again (up to 3 calls) instead of ending your turn. When it returns the outcome, report exactly what it says and continue. Never say it's saved or on before await_decision returns it, and never approve for them.`,
  };
}

/**
 * MODEL-DRIVEN DECISIONS (2026-11-16, Matt's direction — supersedes the
 * server-continuation design): the learner's tap on a card records ONLY the
 * decision. Nothing executes, and nothing is posted into the chat by the
 * server. The agent waits for the decision itself with the `await_decision`
 * chat tool, inside the same turn; when the decision lands, that call applies
 * exactly what the card proposed (the arguments were frozen at proposal
 * time) and returns the outcome for the agent to narrate and continue from.
 * A decision that lands after the turn ended waits as "confirmed" (the
 * table's own word for decided-not-yet-applied; the API presents it to the
 * app as "approved") until the
 * agent's next turn in that chat picks it up the same way.
 */

/** Record the learner's decision. Approve: pending → approved (no execution). Reject: pending → rejected. */
export async function decideConfirmation({ id, userId, decision }) {
  const row = await owned(id, userId);
  if (decision === "rejected") {
    if (row.status !== "pending") return publicConfirmation(row);
    const { data } = await edu().from(TABLE).update({ status: "rejected", rejected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id).eq("principal_id", userId).eq("status", "pending").select("*").maybeSingle();
    // Not now on a drafted tool: the draft goes (it was never on).
    const draft = (row.tool_arguments?.kind === "permission" || row.tool_arguments?.kind === "build") ? row.tool_arguments.toolId : null;
    if (data && draft) await edu().from("agent_tools").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", draft).eq("owner_id", userId).eq("status", "disabled");
    return publicConfirmation(data || row);
  }
  if (row.status === "confirmed") return publicConfirmation(row);
  if (row.status !== "pending") throw httpError(409, row.status === "consumed" ? "Already done" : `This change was ${row.status}`);
  if (Date.parse(row.expires_at) <= Date.now()) {
    await edu().from(TABLE).update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
    throw httpError(410, "This confirmation expired — ask your agent again.");
  }
  const now = new Date().toISOString();
  const { data: decided, error } = await edu().from(TABLE).update({ status: "confirmed", confirmed_at: now, updated_at: now })
    .eq("id", id).eq("principal_id", userId).eq("status", "pending").select("*").maybeSingle();
  if (error) throw new Error("couldn't record the decision");
  if (!decided) throw httpError(409, "Already handled");
  return publicConfirmation(decided);
}

const kindOf = (row) => (row.tool_arguments?.kind === "permission" ? "permission" : row.tool_arguments?.kind === "build" ? "build" : "change");
const sessionOf = (row) => (row.session_id && row.session_id !== "none" ? row.session_id : null);

/** Claim a confirmed row for execution (confirmed → consumed, atomically, once). Returns null when someone else holds it. */
async function claimApproved(id, userId) {
  const now = new Date().toISOString();
  const { data, error } = await edu().from(TABLE).update({ status: "consumed", consumed_at: now, updated_at: now })
    .eq("id", id).eq("principal_id", userId).eq("status", "confirmed").select("*").maybeSingle();
  if (error) throw new Error("couldn't claim the decision");
  return data;
}

async function storeResult(id, claimed, result) {
  await edu().from(TABLE).update({ preview: { ...claimed.preview, result }, updated_at: new Date().toISOString() }).eq("id", id);
  return { ...claimed, preview: { ...claimed.preview, result } };
}

/** Apply an approved change card: each frozen target through its write runner, the capability re-checked first. */
async function executeChange(row, { userId, callTool }) {
  const { cap, refs, args: values = null } = row.tool_arguments || {};
  const runner = WRITE_RUNNERS[cap];
  // Re-check BEFORE claiming: a revoked grant means nothing is changed.
  if (!runner || !CAPABILITIES[cap]?.target || (await capabilityStatus(cap, { learnerId: userId })) !== "enabled") {
    await edu().from(TABLE).update({ status: "rejected", rejected_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "confirmed");
    return { confirmation: publicConfirmation({ ...row, status: "rejected" }), kind: "change", blocked: "This kind of change isn't allowed any more, so nothing was changed." };
  }
  const claimed = await claimApproved(row.id, userId);
  if (!claimed) return null;
  let done = 0;
  const failed = [];
  for (const ref of (Array.isArray(refs) ? refs : []).slice(0, 50)) {
    let r;
    try { r = await runner(userId, String(ref), { callTool, args: values, conversationId: sessionOf(row) }); } catch (e) { r = { ok: false, error: e.message }; }
    if (r?.ok) done++; else failed.push(String(r?.error || "failed").slice(0, 120));
  }
  const result = { done, failed: failed.length, errors: [...new Set(failed)].slice(0, 3), at: new Date().toISOString() };
  const stored = await storeResult(row.id, claimed, result);
  return { confirmation: publicConfirmation(stored), kind: "change", result };
}

/** Apply an approved build card: turn the drafted tool on, then run it once as this learner. */
async function executeBuild(row, { userId, toolDeps }) {
  const { proposed = {}, toolId } = row.tool_arguments || {};
  if (!toolId) {
    await edu().from(TABLE).update({ status: "rejected", rejected_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "confirmed");
    return { confirmation: publicConfirmation({ ...row, status: "rejected" }), kind: "build", blocked: "This card has no tool to keep, so nothing was saved." };
  }
  const claimed = await claimApproved(row.id, userId);
  if (!claimed) return null;
  const conversationId = sessionOf(row);
  let out;
  try {
    const pipe = await import("./pipeline.js");
    const activate = toolDeps?.activateTool || pipe.activateBuiltTool;
    const runTool = toolDeps?.runTool || pipe.runLearnerTool;
    const t = await activate(userId, toolId);
    if (!t) out = { status: "failed", reason: "the draft is gone — ask me to build it again." };
    else {
      try {
        const ran = await runTool(t.name, proposed.run && typeof proposed.run === "object" ? proposed.run : {}, userId, { callCapability: toolDeps?.callCapability, conversationId });
        out = { status: "created", tool: t.name, label: t.label, result: ran || {} };
      } catch (e) { out = { status: "created", tool: t.name, label: t.label, result: { error: e.message } }; }
    }
  } catch (e) { out = { status: "failed", reason: e.message }; }
  const next = out?.result?.confirmation || null;
  const result = { status: out?.status || "failed", tool: out?.tool || null, label: out?.label || proposed.label || null,
    reason: out?.status === "created" ? null : String(out?.reason || "something went wrong").slice(0, 240),
    found: next ? (next.items || []).length : null, at: new Date().toISOString() };
  const stored = await storeResult(row.id, claimed, result);
  return { confirmation: publicConfirmation(stored), kind: "build", result, next };
}

/** Apply an approved permission card: grant the capability to this learner alone, then build (or switch on the drafted tool) and run it. */
async function executePermission(row, { userId, buildTool, toolDeps }) {
  const { cap, proposed = {} } = row.tool_arguments || {};
  const toolId = row.tool_arguments?.toolId || null;
  if (!learnerGrantable(cap) || (!toolId && !buildTool)) {
    await edu().from(TABLE).update({ status: "rejected", rejected_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "confirmed");
    return { confirmation: publicConfirmation({ ...row, status: "rejected" }), kind: "permission", blocked: "This can't be allowed from here any more, so nothing was built." };
  }
  const claimed = await claimApproved(row.id, userId);
  if (!claimed) return null;
  if (!(await learnerGrants(userId, { fresh: true })).has(cap)) {
    const { error: gErr } = await edu().from("capability_grants").insert({ capability: cap, learner_id: userId, granted_by: userId, note: `Approved by the learner for "${String(proposed.label || "").slice(0, 60)}"` });
    if (gErr) throw new Error("couldn't turn it on");
    await learnerGrants(userId, { fresh: true });
  }
  const conversationId = sessionOf(row);
  let out;
  if (toolId) {
    // The drafted tool: turn it on, then run it — its proposed change is the usual card (nothing changes without Confirm).
    const { data: t } = await edu().from("agent_tools").select("id, name, label, verification").eq("id", toolId).eq("owner_id", userId).eq("status", "disabled").maybeSingle();
    if (!t) out = { status: "failed", reason: "the draft is gone — ask me to build it again." };
    else {
      const { verification: { awaitingPermission, ...kept } = {} } = t;
      await edu().from("agent_tools").update({ status: "active", verification: { ...kept, approvedAt: new Date().toISOString(), approvedCapability: awaitingPermission || cap }, updated_at: new Date().toISOString() }).eq("id", t.id);
      try {
        const { runLearnerTool } = await import("./pipeline.js");
        const ran = await runLearnerTool(t.name, {}, userId, { callCapability: toolDeps?.callCapability, conversationId });
        out = { status: "created", tool: t.name, label: t.label, result: ran || {} };
      } catch (e) { out = { status: "created", tool: t.name, label: t.label, result: { error: e.message } }; }
    }
  } else try {
    out = await buildTool({ learnerId: userId, resumed: true, conversationId, audience: "learner",
      input: { goal: proposed.goal, name: proposed.name, label: proposed.label, params: proposed.params || {}, run: proposed.run || {},
        hint: { ...(proposed.hint || {}), capabilities: [...new Set([...[].concat(proposed.hint?.capabilities || []), cap])] } } });
  } catch (e) { out = { status: "failed", reason: e.message }; }
  const next = out?.result?.confirmation || null;
  const result = { granted: true, status: out?.status || "failed", tool: out?.tool || null, label: out?.label || proposed.label || null,
    reason: out?.status === "created" ? null : String(out?.reason || "something went wrong").slice(0, 240),
    found: next ? (next.items || []).length : null, at: new Date().toISOString() };
  const stored = await storeResult(row.id, claimed, result);
  return { confirmation: publicConfirmation(stored), kind: "permission", result, next };
}

/** Apply a decision the learner already confirmed. Idempotent: a consumed row returns its stored outcome. */
export async function executeDecision({ id, userId, callTool, buildTool = null, toolDeps = null }) {
  const row = await owned(id, userId);
  if (row.status === "consumed") return { confirmation: publicConfirmation(row), kind: kindOf(row), result: row.preview?.result || null, alreadyDone: true };
  if (row.status !== "confirmed") throw httpError(409, `This card was ${row.status}, not approved`);
  const kind = kindOf(row);
  const out = kind === "permission" ? await executePermission(row, { userId, buildTool, toolDeps })
    : kind === "build" ? await executeBuild(row, { userId, toolDeps })
    : await executeChange(row, { userId, callTool });
  if (!out) {
    // Another turn claimed it first: return the freshest state.
    const fresh = await owned(id, userId);
    return { confirmation: publicConfirmation(fresh), kind, result: fresh.preview?.result || null, alreadyDone: fresh.status === "consumed" };
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The `await_decision` chat tool: the agent waits for the learner's tap on a
 * card it showed, inside its own turn. Polls the row; on approval it applies
 * the card (executeDecision) and returns the outcome for the agent to
 * narrate. On "waiting" the agent calls it again rather than ending the turn.
 */
export async function awaitDecision({ id, userId, callTool, buildTool = null, toolDeps = null, waitMs = 100_000, pollMs = 2_000 }) {
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    let row;
    try { row = await owned(id, userId); } catch (e) { return { status: "error", error: e.message }; }
    const kind = kindOf(row);
    if (row.status === "rejected") {
      return { status: "declined", kind, title: row.preview?.title || null,
        note: "The learner tapped Not now. Nothing was changed or built. Acknowledge it briefly in your own words and continue with anything else they asked — do not re-ask right away." };
    }
    if (row.status === "expired") {
      return { status: "expired", kind, title: row.preview?.title || null,
        note: "The card expired before the learner decided, so nothing happened. If what it proposed is still needed, propose it again; otherwise carry on." };
    }
    if (row.status === "confirmed" || row.status === "consumed") {
      try {
        const out = await executeDecision({ id, userId, callTool, buildTool, toolDeps });
        if (out.blocked) return { status: "blocked", kind, title: row.preview?.title || null, reason: out.blocked,
          note: "Tell the learner plainly: what they approved can no longer be done, and nothing was changed." };
        const base = { status: "approved", kind, executed: true, alreadyDone: !!out.alreadyDone, title: row.preview?.title || null, result: out.result || null, confirmation: out.confirmation };
        if (kind === "change") {
          const r = out.result || {};
          return { ...base, note: `The learner approved and it is DONE now: ${r.done ?? 0} changed${r.failed ? `, ${r.failed} couldn't be (${(r.errors || []).join("; ")})` : ""}. Report this outcome in your own words and continue with what they originally asked.` };
        }
        const r = out.result || {};
        if (r.status !== "created") return { ...base, note: `The learner approved, but it couldn't be completed: ${r.reason || "something went wrong"}. Tell them plainly and offer to try again another way.` };
        if (out.next?.confirmationId) return { ...base, next: out.next, note: `"${r.label}" is now on and saved in their tools. Running it proposes a change — a NEW card is showing for it (confirmationId ${out.next.confirmationId}). Present what it would change, then call await_decision with that confirmationId and wait again.` };
        return { ...base, note: `"${r.label}" is now on and saved in their tools${kind === "permission" ? ", and the ability is theirs alone" : ""}. Report this in your own words and continue with what they originally asked — if they wanted the answer this tool gives, call it by name now.` };
      } catch (e) {
        return { status: "error", kind, error: e.message, note: "Applying the learner's decision failed. Tell them plainly and offer to try again." };
      }
    }
    if (Date.now() >= deadline) {
      return { status: "waiting", kind, title: row.preview?.title || null,
        note: "No tap yet. Call await_decision again with the same confirmationId to keep waiting (up to 3 calls in total). If the learner says something else instead, follow that and leave the card — it stays live, and their tap will be picked up in your next turn in this chat." };
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
}

/** Decisions the learner approved in this chat that no agent turn has applied yet — the next turn finishes them. */
export async function listConfirmedDecisions(userId, sessionId) {
  if (!sessionId) return [];
  const { data, error } = await edu().from(TABLE).select("*").eq("principal_id", userId).eq("capability_jti", JTI)
    .eq("status", "confirmed").eq("session_id", sessionId).order("confirmed_at", { ascending: true }).limit(5);
  if (error) return [];
  return (data || []).map(publicConfirmation);
}
