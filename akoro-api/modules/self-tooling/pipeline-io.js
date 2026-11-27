/**
 * modules/self-tooling/pipeline-io.js — storage and registry reads/writes for
 * tool definitions: the tool catalogue, per-learner and platform lookups, run
 * bookkeeping, one-off computation saves, and the merged-domain view runners.
 * No model calls and no spec building: pipeline-create.js owns that.
 */
import db from "../../db.js";
import { capabilityStatus } from "./registry.js";
import { CAPABILITIES, ownChangeAsked, changeAskedOf } from "./capabilities.js";
import { DATA_VIEWS } from "./views.js";
import { validateDefinition } from "./interpreters.js";
import { goalTokens } from "./toolSimilarity.js";
import { deriveToolArea } from "./areas.js";
import { DOMAINS, genericDomain } from "./domains.js";
import { proposeWrite } from "./confirmations.js";
import { ensureToolState, getToolState } from "./toolState.js";
import { initialModeState } from "./modeSpec.js";
import { basisColumns, currentActionBasis } from "../agent-runtime/index.js";
import { LIMITS, NAME, isDomainTool, asksAboutOthersInBattles, toolActions, toolDef, visibleActions, mergedRowRule, presentMergedToolRow } from "./rules.js";
import { tryRun, verifyTool } from "./pipeline-verify.js";

const edu = () => db.schema("edu");

// The audit row says whether a person asked for this build or the agent went ahead under a rule (Phase 18 item 6).
export async function logEvent(row) {
  const { error } = await edu().from("self_tool_events").insert({ ...row, ...basisColumns(currentActionBasis() || { basis: "explicit" }) });
  if (error) console.warn("[self-tooling] event not logged:", error.message);
}

/** Archive the owner's OTHER domain tools over the same data view — one tool per
 *  domain. Write tools (no `action` enum) are never touched: the split keeps
 *  them separate and Confirm-gated. */
export async function retireSameView(learnerId, view, keepName) {
  if (!view) return [];
  const { data } = await edu().from("agent_tools").select("id, name, views, domain, mode, params_schema")
    .eq("owner_id", learnerId).eq("status", "active");
  const archived = [];
  for (const t of data || []) {
    if (t.name === keepName || !isDomainTool(t)) continue;
    const domain = t.domain || (Array.isArray(t.views) && t.views[0]);
    if (domain === view || (Array.isArray(t.views) && t.views.includes(view))) {
      await edu().from("agent_tools").update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", t.id).eq("owner_id", learnerId);
      archived.push(t.name);
    }
  }
  return archived;
}

export const OWN_COPY_OFFER_WINDOW_MS = 30 * 60 * 1000;
/**
 * The own-copy gate remembers its own question. When it fires it logs an
 * "own_copy_offered" event (the view in detail); a later build for the same
 * view inside the window finds that offer still open and proceeds — the
 * learner already said yes, and the model's follow-up create_tool call does
 * not always carry hint.ownCopy (the re-ask loop seen live 2026-11-15: the
 * agent asked the same question twice and nothing was built). Honouring the
 * offer logs "own_copy_accepted", closing it: one offer, one build. Any
 * lookup failure falls back to asking (the pre-fix behaviour).
 */
export async function ownCopyOfferOpen(learnerId, view) {
  try {
    const since = new Date(Date.now() - OWN_COPY_OFFER_WINDOW_MS).toISOString();
    const { data } = await edu().from("self_tool_events")
      .select("outcome, detail, created_at").eq("user_id", learnerId)
      .in("outcome", ["own_copy_offered", "own_copy_accepted"])
      .gte("created_at", since).order("created_at", { ascending: false }).limit(10);
    const viewOf = (e) => { try { const d = typeof e?.detail === "string" ? JSON.parse(e.detail) : e?.detail; return d?.view; } catch { return undefined; } };
    const latest = (data || []).find((e) => viewOf(e) === view);
    if (!latest || latest.outcome !== "own_copy_offered") return false;
    await logEvent({ user_id: learnerId, goal: "(own-copy offer honoured)", outcome: "own_copy_accepted", detail: { view } });
    return true;
  } catch {
    return false;
  }
}

/**
 * The forced first step (iteration 0) for "how did the other players do in my
 * battles?": create_tool, so the agent reaches "this needs an admin's permission"
 * (or builds it, once granted) instead of answering "I can't see that" from
 * unrelated tools — which it did about 1 time in 10–15 on every model tried.
 * Not forced when the learner (or everyone) already has a tool for it: then the
 * agent just calls that tool.
 * → "create_tool" | null
 */
export async function forcedSelfTool(learnerId, message) {
  // A change to their own tasks no tool makes yet: look up what can be built FIRST,
  // so the agent offers to build it — left on auto (with an older "only an admin
  // can" turn in the history) it told the learner to ask an admin instead.
  const change = ownChangeAsked(message);
  if (change) {
    const { data } = await edu().from("agent_tools").select("id").eq("status", "active")
      .or(`owner_id.eq.${learnerId},scope.eq.platform`).contains("capabilities", [change]).limit(1);
    return data?.length ? null : "schema_lookup";
  }
  // Any other change ("rename my chats"): look up first too — it either can be built, or the
  // agent says it can't yet and offers to ask the Akoro team (it used to just give a workaround).
  if (changeAskedOf(message)) return "schema_lookup";
  if (!asksAboutOthersInBattles(message)) return null;
  const { data } = await edu().from("agent_tools").select("id").eq("status", "active")
    .or(`owner_id.eq.${learnerId},scope.eq.platform`).contains("capabilities", ["battles.class_results"]).limit(1);
  return data?.length ? null : "create_tool";
}

/**
 * The catalogue: the learner's own tools (most recently used first) and the
 * tools an admin promoted to everyone (most used first). The learner's own
 * tool wins a name clash; built-in names never reach here (§7.10).
 */
export async function learnerToolDefsWithAreas(learnerId, audience = "learner") {
  const cols = "name, label, goal, params_schema, scope, actions, disabled_actions, views, capabilities, area, mode";
  const [{ data: mine }, { data: platform }] = await Promise.all([
    edu().from("agent_tools").select(cols)
      .eq("owner_id", learnerId).eq("status", "active").order("last_used_at", { ascending: false, nullsFirst: false }).limit(LIMITS.inCatalogue),
    edu().from("agent_tools").select(cols)
      .eq("scope", "platform").eq("audience", audience).eq("status", "active").order("usage_count", { ascending: false }).limit(LIMITS.inCatalogue),
  ]);
  const own = new Set((mine || []).map((t) => t.name));
  const rows = [...(mine || []), ...(platform || []).filter((t) => !own.has(t.name))];
  // Rows built before areas were stored derive theirs on the fly — nothing is area-less.
  const areas = new Map(rows.map((t) => [t.name, t.area || deriveToolArea(t).area]));
  const labels = new Map(rows.map((t) => [t.name, t.label || t.name]));
  // Session (mode) tools: the turn's area selection must never filter one
  // out — a session is resumable from any conversation, whatever area the
  // message points at (their derived area is "other", which no message
  // activates, so without this they vanish mid-session).
  const modes = new Set(rows.filter((t) => t.mode === "mode").map((t) => t.name));
  return { defs: rows.map(toolDef).filter(Boolean), areas, labels, modes };
}

export async function learnerToolDefs(learnerId, audience = "learner") {
  return (await learnerToolDefsWithAreas(learnerId, audience)).defs;
}

/**
 * Turn on a tool the learner kept on its build card (confirmations.confirmBuild):
 * flips a build-consent draft (verification.awaitingBuild) to active and retires
 * same-view domain siblings, exactly as a direct save would have. → the tool
 * row, or null when the draft is gone or was never awaiting consent.
 */
export async function activateBuiltTool(learnerId, toolId) {
  const { data: t } = await edu().from("agent_tools").select("id, name, label, views, params_schema, verification")
    .eq("id", toolId).eq("owner_id", learnerId).eq("status", "disabled").maybeSingle();
  if (!t?.verification?.awaitingBuild) return null;
  const { awaitingBuild, ...kept } = t.verification;
  await edu().from("agent_tools").update({ status: "active", verification: { ...kept, approvedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq("id", t.id);
  if (t.params_schema?.action?.enum && t.views?.[0]) await retireSameView(learnerId, t.views[0], t.name);
  return t;
}

/** The learner's library domain row state for the merged def/dispatch, or
 *  null when they have none. Only the fields the merge reads. */
export async function getLibraryToolState(learnerId) {
  const { data: t } = await edu().from("agent_tools").select("id, status, actions, disabled_actions, params_schema")
    .eq("owner_id", learnerId).eq("name", "library_documents").in("status", ["active", "disabled"]).maybeSingle();
  if (!t) return null;
  const acts = Array.isArray(t.actions) && t.actions.length ? t.actions : (t.params_schema?.action?.enum || []);
  return { id: t.id, status: t.status, actions: acts, disabledActions: Array.isArray(t.disabled_actions) ? t.disabled_actions : [] };
}

/** Serve a BASE library action (count/list/by_kind) platform-side: the real
 *  domain source over the learner's own my_library rows, with NO tool row —
 *  the merged built-in's records read. Same result shape as runLearnerTool. */
export async function runLibraryViewAction(action, input, learnerId) {
  const spec = DOMAINS.library_documents;
  const def = { kind: "code", steps: [{ id: spec.step, view: spec.view }], source: spec.source };
  const r = await tryRun(def, spec.params, { ...(input || {}), action }, { learnerId, callCapability: undefined });
  if (!r.ok) return { error: `The Library couldn't be read just now: ${r.error}` };
  return { tool: spec.label, rows: r.rows, total: r.total, truncated: r.truncated, via: "library records" };
}
export async function getChatsToolState(learnerId) {
  const { data: t } = await edu().from("agent_tools").select("id, status, actions, disabled_actions, params_schema")
    .eq("owner_id", learnerId).eq("name", "my_chats").in("status", ["active", "disabled"]).maybeSingle();
  if (!t) return null;
  const acts = Array.isArray(t.actions) && t.actions.length ? t.actions : (t.params_schema?.action?.enum || []);
  return { id: t.id, status: t.status, actions: acts, disabledActions: Array.isArray(t.disabled_actions) ? t.disabled_actions : [] };
}
export async function runChatsViewAction(action, input, learnerId) {
  const spec = genericDomain("my_chats");
  const def = { kind: "code", steps: [{ id: spec.step, view: spec.view }], source: spec.source };
  const r = await tryRun(def, spec.params, { ...(input || {}), action }, { learnerId, callCapability: undefined });
  if (!r.ok) return { error: `Your chats couldn't be read just now: ${r.error}` };
  return { tool: spec.label, rows: r.rows, total: r.total, truncated: r.truncated, via: "chat records" };
}
function mergedSpecFor(name) {
  return DOMAINS[name] || genericDomain(name);
}
export async function getMergedToolState(learnerId, name) {
  const { data: t } = await edu().from("agent_tools").select("id, status, actions, disabled_actions, params_schema")
    .eq("owner_id", learnerId).eq("name", name).in("status", ["active", "disabled"]).maybeSingle();
  if (!t) return null;
  const acts = Array.isArray(t.actions) && t.actions.length ? t.actions : (t.params_schema?.action?.enum || []);
  return { id: t.id, status: t.status, actions: acts, disabledActions: Array.isArray(t.disabled_actions) ? t.disabled_actions : [] };
}
export async function runMergedViewAction(name, action, input, learnerId) {
  const spec = mergedSpecFor(name);
  if (!spec) return { error: "That tool isn't available right now." };
  const def = { kind: "code", steps: [{ id: spec.step, view: spec.view }], source: spec.source };
  const r = await tryRun(def, spec.params, { ...(input || {}), action }, { learnerId, callCapability: undefined });
  if (!r.ok) return { error: `That couldn't be read just now: ${r.error}` };
  return { tool: spec.label, rows: r.rows, total: r.total, truncated: r.truncated, via: `${spec.label} records` };
}

/** Run a saved tool — the learner's own, else a platform one. → result, or null when there's no such tool. */
export async function runLearnerTool(name, input, learnerId, { callCapability, conversationId = null, dry = false, audience = "learner" }) {
  if (!NAME.test(String(name || ""))) return null;
  let { data: t } = await edu().from("agent_tools").select("*").eq("owner_id", learnerId).eq("name", name).in("status", ["active", "disabled"]).maybeSingle();
  if (!t) ({ data: t } = await edu().from("agent_tools").select("*").eq("scope", "platform").eq("audience", audience).eq("name", name).in("status", ["active", "disabled"]).maybeSingle());
  if (t && (t.audience || "learner") !== audience) return null;   // never run another audience's tool
  if (!t) return null;
  const platform = t.scope === "platform";
  if (t.status !== "active") {
    // A build-consent draft is OFF because its Keep card is still waiting —
    // that is the designed state, not a failure. Saying "turned off, rebuild
    // it" here made the agent narrate a breakdown and tell the learner to
    // fix it in Settings while the card sat waiting (live, 2026-11-27).
    if (t.verification?.awaitingBuild) return { error: "This tool is a draft — its card is still waiting for the learner to tap Keep. It isn't on yet and nothing is wrong: don't treat this as a failure, don't say it was turned off, and don't tell the learner to rebuild it or switch it on in Settings. Just remind them the card is waiting for their Keep tap." };
    return { error: platform ? "This Akoro tool is turned off for now." : "This tool is turned off — rebuild it or turn it back on in Settings → Agent → My tools." };
  }
  // An action the learner switched off (or deleted) must not run even if the
  // model asks for it by name — the catalogue already hides it (toolDef).
  if (input?.action && toolActions(t).length && !visibleActions(t).includes(input.action)) {
    return { error: "That action is turned off for this tool — turn it back on in Settings → Agent → My tools." };
  }
  // Re-check on EVERY call: a revoked grant or removed view takes effect at once (§7.10).
  for (const c of t.capabilities || []) {
    const cap = CAPABILITIES[c];
    if ((await capabilityStatus(c, { learnerId })) !== "enabled" || !(cap?.kind === "read" || cap?.target)) return { error: "This tool uses something that's no longer allowed, so it can't run." };
  }
  for (const v of t.views || []) if (!DATA_VIEWS[v]) return { error: "This tool uses data that's no longer available." };
  // A MODE tool (Plugin Runtime): the session runs in its OWN UI, opened
  // from the learner's dashboard sessions list (2026-11-27) — the chat
  // never hosts it. Calling it by name reports where it has got to, so the
  // agent can answer questions about it and point the learner to it.
  if (t.definition?.kind === "mode") {
    const state = await ensureToolState(learnerId, t, input || {});
    await edu().from("agent_tools").update({
      usage_count: (t.usage_count || 0) + 1, last_used_at: new Date().toISOString(), fail_streak: 0, updated_at: new Date().toISOString(),
    }).eq("id", t.id);
    const s = sessionSummary(state);
    return { tool: t.label, mode: true, phase: s?.phase || null, progress: s ? `${s.done} of ${s.total}` : null,
      note: "This is a session tool: it runs in its own UI, not in this chat. The learner opens it from their sessions list on the dashboard and it picks up exactly where it left off — its current phase and progress are above. Tell them that if they want to start or continue it; never run the session here, never teach its material in chat, and never score answers or recall sent here — anything they paste belongs in the session's own screen." };
  }
  // Always as THIS learner: views are forced to their own rows (viewRuntime).
  const r = await tryRun(t.definition, t.params_schema, input || {}, { learnerId, callCapability });
  const fail = r.ok ? 0 : (t.fail_streak || 0) + 1;
  // A learner's tool turns itself off after 3 failures in a row; a platform tool
  // never does on one learner's failures — admins see its fail streak instead.
  await edu().from("agent_tools").update({
    usage_count: (t.usage_count || 0) + 1, last_used_at: new Date().toISOString(), fail_streak: fail,
    ...(fail >= 3 && !platform ? { status: "disabled" } : {}), updated_at: new Date().toISOString(),
  }).eq("id", t.id);
  if (!r.ok) return { error: fail >= 3 && !platform ? "This tool failed three times in a row and was turned off — rebuild it." : `The tool couldn't run: ${r.error}` };
  if (r.write) return writeOutcome({ learnerId, conversationId, dry, tool: t, write: r.write });
  return { tool: t.label, rows: r.rows, total: r.total, truncated: r.truncated };
}

/**
 * Save a previously ANSWERED one-off computation as a real tool — the
 * learner's explicit "save that", or the message a tool suggestion sends
 * when tapped. The stashed definition is re-verified and saved ACTIVE (the
 * ask itself is the consent); nothing is rebuilt, so the saved tool computes
 * exactly what the learner already saw. `hint` picks among recent one-offs
 * by goal words; without it, the most recent is saved.
 */
export async function saveComputation({ learnerId, hint = null, callCapability }) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: events } = await edu().from("self_tool_events")
    .select("id, goal, detail, created_at").eq("user_id", learnerId).eq("outcome", "answered")
    .gte("created_at", since).order("created_at", { ascending: false }).limit(25);
  const candidates = (events || []).filter((e) => e.detail && e.detail.definition && e.detail.name);
  if (!candidates.length) return { status: "none", note: "No recent one-off computation to save. If the learner still wants the tool, build it with create_tool." };
  let pick = candidates[0];
  if (hint) {
    const hintTokens = goalTokens(hint);
    const scored = candidates.map((e) => ({ e, score: [...hintTokens].filter((t) => goalTokens(e.goal).has(t)).length })).sort((a, b) => b.score - a.score);
    if (scored[0].score > 0) pick = scored[0].e;
  }
  const d = pick.detail;
  const { data: existing } = await edu().from("agent_tools").select("id").eq("owner_id", learnerId).eq("name", d.name).in("status", ["active", "disabled"]).maybeSingle();
  if (existing) return { status: "exists", tool: d.name, label: d.label, note: `"${d.label}" is already in the learner's tools — just call it by name.` };
  const { count } = await edu().from("agent_tools").select("id", { count: "exact", head: true }).eq("owner_id", learnerId).in("status", ["active", "disabled"]);
  if ((count || 0) >= LIMITS.maxTools) return { status: "full", error: `The learner already has ${LIMITS.maxTools} tools — one must be removed in Settings before another can be saved.` };
  const ctx = { learnerId, callCapability, audience: "learner" };
  const v = await validateDefinition(d.definition, d.params_schema || {}, { audience: "learner", learnerId, assume: [] });
  if (!v.ok) return { status: "stale", error: "That computation can no longer be saved — what it reads has changed. Build it again with create_tool." };
  const check = await verifyTool(d.definition, d.params_schema || {}, d.samples || [], ctx);
  if (check.verdict !== "PASS") return { status: "stale", error: "That computation no longer checks out — build it again with create_tool." };
  const def = { name: d.name, label: d.label, goal: d.goal, mode: d.mode || d.definition?.kind || "spec",
    definition: d.definition, params_schema: d.params_schema || {},
    capabilities: v.uses.capabilities, views: [...new Set(v.uses.views)],
    verification: { verdict: check.verdict, at: new Date().toISOString(), assertions: check.assertions.map((a) => ({ name: a.name, passed: a.passed })), samples: d.samples || [] } };
  Object.assign(def, deriveToolArea(def));
  const { data: row, error } = await edu().from("agent_tools").insert({ owner_id: learnerId, scope: "learner", audience: "learner", ...def,
    domain: (def.views || [])[0] || null, actions: def.params_schema?.action?.enum || null,
    usage_count: 1, last_used_at: new Date().toISOString() }).select("id").single();
  if (error) return { status: "failed", error: `Couldn't save the tool: ${error.message}` };
  if (def.params_schema?.action?.enum && def.views?.[0]) await retireSameView(learnerId, def.views[0], d.name);
  await logEvent({ user_id: learnerId, goal: d.goal, outcome: "created", mode: def.mode, stages_tried: [], capabilities: def.capabilities, tool_id: row.id, reason: "saved one-off computation", builder_calls: 0, ms: 0 });
  const run = await tryRun(def.definition, def.params_schema, d.runInput || {}, ctx);
  return { status: "saved", tool: d.name, label: d.label,
    result: run.ok ? { rows: run.rows, total: run.total } : { error: run.error },
    note: `Saved "${d.label}" as the learner's tool — it is in My tools now and can be called by name. Confirm in plain words.`,
    __newTool: toolDef({ ...def, scope: "learner" }) };
}

/**
 * A tool with a write step ran: in a dry run say what WOULD change; otherwise
 * store the proposal and return the confirmation card (nothing written).
 */
export async function writeOutcome({ learnerId, conversationId, dry, tool, write }) {
  const items = write.targets.map((x) => x.label);
  if (dry) return { status: "would_need_confirmation", dryRun: true, tool: tool.label, action: write.does, items, more: write.more || 0,
    note: "DRY RUN — nothing was proposed or changed. Say what would change and that the learner would confirm it on a card." };
  return { tool: tool.label, ...(await proposeWrite({ learnerId, conversationId, tool, write })) };
}

/** Learner tools unused for `days` days are archived (§7.10 health). Platform tools are the admins' call. */
export async function archiveUnusedTools(days = 60) {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const now = new Date().toISOString();
  const { data, error } = await edu().from("agent_tools").update({ status: "archived", updated_at: now })
    .eq("scope", "learner").in("status", ["active", "disabled"])
    .or(`last_used_at.lt.${cutoff},and(last_used_at.is.null,created_at.lt.${cutoff})`).select("id");
  if (error) throw new Error(`archive failed: ${error.message}`);
  return { archived: (data || []).length };
}

/**
 * What the tool's own tab renders (Plugin Runtime): its presentation plus
 * the data the presentation binds to — a mode tool's live state (or its
 * initial state before the first run), a data tool's rows from a dry read.
 * → the view payload, or null when the tool isn't the learner's (or a
 * platform tool) to see.
 */
export async function getToolView(learnerId, toolId) {
  const { data: t } = await edu().from("agent_tools").select("id, name, label, goal, mode, status, definition, presentation, scope")
    .eq("id", toolId).or(`owner_id.eq.${learnerId},scope.eq.platform`).in("status", ["active", "disabled"]).maybeSingle();
  if (!t) return null;
  const base = { id: t.id, name: t.name, label: t.label, goal: t.goal, mode: t.mode, status: t.status, presentation: t.presentation || null };
  if (t.definition?.kind === "mode") {
    const live = await getToolState(learnerId, t.id);
    return { ...base, state: live?.state || initialModeState(t.definition, {}) };
  }
  if (!t.presentation) return base;
  const r = await runLearnerTool(t.name, {}, learnerId, { callCapability: undefined, dry: true });
  return { ...base, ...(r && !r.error ? { rows: r.rows || [], total: r.total ?? null } : {}) };
}

/**
 * A mode tool's progress at a glance, for list rows (the dashboard
 * sessions list renders it through the ordinary session card): the phase
 * plus how many items of the state's main tracked list have been reached
 * (any state other than a not-started one: todo / hidden / pending).
 */
export function sessionSummary(state) {
  if (!state || typeof state !== "object") return null;
  let best = null;
  for (const v of Object.values(state)) {
    if (Array.isArray(v) && v.length && v.every((i) => i && typeof i === "object") && v.some((i) => typeof i.state === "string")) {
      if (!best || v.length > best.length) best = v;
    }
  }
  const notStarted = new Set(["todo", "hidden", "pending", ""]);
  const total = best ? best.length : 0;
  const done = best ? best.filter((i) => !notStarted.has(String(i.state || "").toLowerCase())).length : 0;
  return { phase: typeof state.phase === "string" ? state.phase : null, done, total };
}

export async function listMyTools(learnerId) {
  const { data, error } = await edu().from("agent_tools").select("id, name, label, goal, mode, status, usage_count, last_used_at, created_at, domain, actions, disabled_actions, views, area, secondary_areas, tags, presentation")
    .eq("owner_id", learnerId).in("status", ["active", "disabled"]).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error("Couldn't load your tools");
  const modeIds = (data || []).filter((t) => t.mode === "mode").map((t) => t.id);
  const states = new Map();
  if (modeIds.length) {
    const { data: st } = await edu().from("agent_tool_state").select("tool_id, state").eq("owner_id", learnerId).in("tool_id", modeIds);
    for (const r of st || []) states.set(r.tool_id, r.state);
  }
  return (data || []).map((t) => ({ ...t, hasUi: !!t.presentation, presentation: undefined, session: t.mode === "mode" ? sessionSummary(states.get(t.id)) : undefined, actions: Array.isArray(t.actions) ? t.actions : [], disabled_actions: Array.isArray(t.disabled_actions) ? t.disabled_actions : [],
    area: t.area || deriveToolArea(t).area, secondary_areas: Array.isArray(t.secondary_areas) ? t.secondary_areas : [], tags: Array.isArray(t.tags) ? t.tags : [] }))
    .map(presentMergedToolRow).filter((t) => t !== null);
}

export async function updateMyTool(learnerId, id, patch) {
  const { data: row } = await edu().from("agent_tools")
    .select("id, name, label, status, domain, actions, params_schema, disabled_actions")
    .eq("owner_id", learnerId).eq("id", id).in("status", ["active", "disabled"]).maybeSingle();
  if (!row) throw Object.assign(new Error("Tool not found"), { status: 404 });
  const allowed = {};
  if (typeof patch?.label === "string" && patch.label.trim().length >= 2) allowed.label = patch.label.trim().slice(0, 60);
  if (["active", "disabled"].includes(patch?.status)) allowed.status = patch.status;
  if (Array.isArray(patch?.tags)) {
    allowed.tags = [...new Set(patch.tags.map((x) => String(x || "").trim().slice(0, 24)).filter(Boolean))].slice(0, 8);
  }
  if (patch?.delete === true) allowed.status = "archived";

  // Per-action management (domain tools): switch ONE action off or on, or
  // delete it from the set. Deleting the last action archives the tool — an
  // empty domain is no tool at all.
  const acts = toolActions(row);
  const mRule = mergedRowRule(row);
  const targetedAction = typeof patch?.deleteAction === "string" && patch.deleteAction ? patch.deleteAction
    : (typeof patch?.action === "string" && patch.action ? patch.action : null);
  if (mRule && targetedAction && mRule.mergedActions.includes(targetedAction)) {
    throw Object.assign(new Error("That action is built in — it can't be changed here"), { status: 400 });
  }
  let nextActions = null, nextOff = null;
  if (typeof patch?.deleteAction === "string" && patch.deleteAction) {
    if (!acts.includes(patch.deleteAction)) throw Object.assign(new Error("That action doesn't exist on this tool"), { status: 400 });
    nextActions = acts.filter((a) => a !== patch.deleteAction);
    nextOff = (Array.isArray(row.disabled_actions) ? row.disabled_actions : []).filter((a) => a !== patch.deleteAction);
    if (!nextActions.length) allowed.status = "archived";
    if (mRule && !nextActions.filter((a) => !mRule.mergedActions.includes(a)).length) allowed.status = "archived";
  } else if (typeof patch?.action === "string" && ["active", "disabled"].includes(patch?.actionStatus)) {
    if (!acts.includes(patch.action)) throw Object.assign(new Error("That action doesn't exist on this tool"), { status: 400 });
    const off = new Set(Array.isArray(row.disabled_actions) ? row.disabled_actions : []);
    if (patch.actionStatus === "disabled") off.add(patch.action); else off.delete(patch.action);
    nextOff = [...off];
  }
  if (nextActions) {
    allowed.actions = nextActions;
    allowed.params_schema = { ...(row.params_schema || {}), action: { ...(row.params_schema?.action || {}), enum: nextActions } };
  }
  if (nextOff) allowed.disabled_actions = nextOff;
  if (!Object.keys(allowed).length) throw Object.assign(new Error("Nothing to change"), { status: 400 });
  const { data, error } = await edu().from("agent_tools").update({ ...allowed, updated_at: new Date().toISOString(), ...(allowed.status !== "active" ? { fail_streak: 0 } : {}) })
    .eq("owner_id", learnerId).eq("id", row.id).in("status", ["active", "disabled"]).select("id, name, label, status, domain, actions, disabled_actions, area, secondary_areas, tags").maybeSingle();
  if (error) throw new Error("Couldn't update the tool");
  if (!data) throw Object.assign(new Error("Tool not found"), { status: 404 });
  const presented = { ...data, actions: Array.isArray(data.actions) ? data.actions : [], disabled_actions: Array.isArray(data.disabled_actions) ? data.disabled_actions : [],
    secondary_areas: Array.isArray(data.secondary_areas) ? data.secondary_areas : [], tags: Array.isArray(data.tags) ? data.tags : [] };
  return presentMergedToolRow(presented) || presented;
}
