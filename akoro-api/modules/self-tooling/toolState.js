/**
 * modules/self-tooling/toolState.js — the live state of a MODE tool
 * (Plugin Runtime, 2026-11-27). One state document per learner + tool in
 * edu.agent_tool_state: created from the definition's initial state (with
 * the run's params substituted) the first time the tool runs, then moved
 * only by the tool's declared actions (modeSpec.applyModeAction). The
 * tool's tab renders this document through its presentation.
 */
import db from "../../db.js";
import { applyModeAction, initialModeState } from "./modeSpec.js";

const edu = () => db.schema("edu");
const NAME = /^[a-z][a-z0-9_]{2,47}$/;

/** The learner's tool row (their own first, then a platform one), or null. */
export async function loadToolRow(learnerId, name, audience = "learner") {
  if (!NAME.test(String(name || ""))) return null;
  let { data: t } = await edu().from("agent_tools").select("*").eq("owner_id", learnerId).eq("name", name).in("status", ["active", "disabled"]).maybeSingle();
  if (!t) ({ data: t } = await edu().from("agent_tools").select("*").eq("scope", "platform").eq("audience", audience).eq("name", name).in("status", ["active", "disabled"]).maybeSingle());
  if (t && (t.audience || "learner") !== audience) return null;
  return t || null;
}

/** The tool's current state for this learner, or null when it has never run. */
export async function getToolState(learnerId, toolId) {
  const { data } = await edu().from("agent_tool_state").select("state, updated_at").eq("tool_id", toolId).eq("owner_id", learnerId).maybeSingle();
  return data ? { state: data.state || {}, updatedAt: data.updated_at } : null;
}

/** The state, creating it from the definition's initial state when missing. */
export async function ensureToolState(learnerId, tool, runInput = {}) {
  const existing = await getToolState(learnerId, tool.id);
  if (existing) return existing.state;
  const state = initialModeState(tool.definition || {}, runInput || {});
  const { error } = await edu().from("agent_tool_state").insert({ tool_id: tool.id, owner_id: learnerId, state });
  if (error) {
    // A concurrent first run won the insert: read theirs.
    const again = await getToolState(learnerId, tool.id);
    if (again) return again.state;
    throw new Error(`Couldn't start the tool's state: ${error.message}`);
  }
  return state;
}

/**
 * Run one declared action of a mode tool (the run_mode_action chat tool).
 * → { tool, label, action, state } | { error }
 */
export async function runModeAction({ learnerId, toolName, action, args = {}, audience = "learner" }) {
  const t = await loadToolRow(learnerId, toolName, audience);
  if (!t) return { error: `No tool called "${toolName}" is available.` };
  if (t.status !== "active") return { error: "This tool is turned off — turn it back on in Settings → Agent → My tools." };
  if (t.definition?.kind !== "mode") return { error: `"${t.label}" is not a session tool — it has no state to update. Call it by name to run it.` };
  const current = await ensureToolState(learnerId, t, {});
  const out = applyModeAction(t.definition, current, String(action || ""), args || {});
  if (!out.ok) return { error: out.error };
  const { error } = await edu().from("agent_tool_state").update({ state: out.state, updated_at: new Date().toISOString() })
    .eq("tool_id", t.id).eq("owner_id", learnerId);
  if (error) return { error: `Couldn't save the update: ${error.message}` };
  await edu().from("agent_tools").update({ usage_count: (t.usage_count || 0) + 1, last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", t.id);
  return { tool: t.name, label: t.label, action, state: out.state,
    note: "State updated — the tool's tab now shows this. Continue the session from the new state, in your own words." };
}
