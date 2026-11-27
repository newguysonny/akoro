/**
 * modules/self-tooling/inspect.js — akoro_inspect (Plugin Runtime,
 * 2026-11-27): ONE read-only tool that lets the agent discover what the
 * runtime actually offers before it builds or answers — the counterpart
 * of Cordis's cordis_inspect. No query → the provider directory; a query
 * { provider, method? } reads one provider. Everything here is metadata
 * the agent may know; nothing is executed and no learner data is read
 * beyond the learner's own tool rows (the `domains` and `me` providers).
 *
 * Providers:
 *   capabilities  the Data View registry + capabilities, with live status
 *   domains       the domain tools (curated + merged) and the learner's own
 *   me            this learner's tools, cap and grants
 *   runtime       versions, kill switches, the view registry's health
 *   ui            the declarative UI catalogue a presentation may use
 */
import db from "../../db.js";
import { DATA_VIEWS, describeView, audienceOf } from "./views.js";
import { CAPABILITIES, capAudience } from "./capabilities.js";
import { capabilityStatus } from "./registry.js";
import { DOMAINS } from "./domains.js";
import { MERGED_DOMAIN_LIST } from "./mergedDomains.js";
import { LIMITS, toolActions, visibleActions } from "./rules.js";
import { describeCatalogue } from "./uiCatalogue.js";
import { viewRegistryStatus } from "./viewRegistry.js";
import { codeEnabled } from "./sandbox/index.js";

const edu = () => db.schema("edu");

const PROVIDERS = Object.freeze({
  capabilities: "Every Data View a tool may read (fields, operations) and every capability, each with its live status for this learner: available, needs_your_ok (the learner can allow it), needs_approval (an admin), or forbidden.",
  domains: "The domain tools: the curated domains and the merged built-ins, the actions each carries, and which of them this learner has as their own tool (with any actions switched off).",
  me: "This learner's own tools (names, labels, kinds, status), how many they may have, and the permissions currently on for them.",
  runtime: "Runtime facts: the code stage on/off, the database view registry's health, merged-domain switches, and the plugin-runtime version.",
  ui: "The declarative UI catalogue: the slots a tool's presentation may fill, the components, and how bindings work. Read this before authoring a presentation.",
});

async function capabilitiesProvider({ learnerId, audience }) {
  const views = Object.entries(DATA_VIEWS)
    .filter(([, v]) => audienceOf(v) === audience)
    .map(([name, v]) => ({ ...describeView(name, v), status: "available" }));
  const capabilities = [];
  for (const [name, c] of Object.entries(CAPABILITIES)) {
    if (c.hidden || capAudience(c) !== audience) continue;
    const status = await capabilityStatus(name, { learnerId });
    capabilities.push({ name, does: c.description, kind: c.kind,
      status: status === "enabled" ? "available" : status === "locked" ? "needs_approval" : status,
      ...(c.returns ? { returns: c.returns } : {}), ...(c.target ? { target: c.target } : {}) });
  }
  return { views, capabilities };
}

async function domainsProvider({ learnerId, audience }) {
  const curated = Object.values(DOMAINS).map((d) => ({ name: d.name, label: d.label, view: d.view, kind: "curated" }));
  const merged = MERGED_DOMAIN_LIST.map((c) => ({ name: c.name, label: c.label || c.name, view: c.view, kind: "merged", live: !!c.enabled() }));
  let mine = [];
  if (audience === "learner") {
    const { data } = await edu().from("agent_tools").select("name, label, domain, actions, disabled_actions, status, mode")
      .eq("owner_id", learnerId).in("status", ["active", "disabled"]).limit(LIMITS.maxTools + 5);
    mine = (data || []).map((t) => ({ name: t.name, label: t.label, domain: t.domain || null, mode: t.mode, status: t.status,
      actions: toolActions(t), actionsOff: (Array.isArray(t.disabled_actions) ? t.disabled_actions : []), actionsOn: visibleActions(t) }));
  }
  return { domains: [...curated, ...merged], myTools: mine };
}

async function meProvider({ learnerId }) {
  const { data } = await edu().from("agent_tools").select("name, label, mode, status, usage_count")
    .eq("owner_id", learnerId).in("status", ["active", "disabled"]).order("last_used_at", { ascending: false, nullsFirst: false }).limit(50);
  const tools = data || [];
  return {
    tools: tools.map((t) => ({ name: t.name, label: t.label, kind: t.mode, status: t.status, uses: t.usage_count || 0 })),
    toolCount: tools.length, toolCap: LIMITS.maxTools,
    note: "Permissions on for this learner appear in the capabilities provider as status available.",
  };
}

function runtimeProvider() {
  return {
    pluginRuntime: "1.0 (inspect + presentations + mode tools, 2026-11-27)",
    codeStage: codeEnabled() ? "on" : "off",
    viewRegistry: viewRegistryStatus(),
    mergedDomains: MERGED_DOMAIN_LIST.map((c) => ({ name: c.name, live: !!c.enabled() })),
    toolAreaSelection: process.env.AKORO_TOOL_AREA_SELECTION !== "false",
    dbViews: process.env.AKORO_DB_VIEWS !== "false",
  };
}

/**
 * akoro_inspect. `query` omitted → the provider directory.
 * → the provider's declaration, or { providers } / { error }.
 */
export async function akoroInspect({ learnerId, audience = "learner", provider = null } = {}) {
  if (!provider) {
    return { providers: Object.entries(PROVIDERS).map(([name, does]) => ({ name, does })),
      note: "Call akoro_inspect again with one provider's name to read it. This replaces guessing: check capabilities before building, domains before answering about a domain, ui before authoring a presentation." };
  }
  switch (String(provider)) {
    case "capabilities": return { provider, ...(await capabilitiesProvider({ learnerId, audience })) };
    case "domains": return { provider, ...(await domainsProvider({ learnerId, audience })) };
    case "me": return { provider, ...(await meProvider({ learnerId })) };
    case "runtime": return { provider, ...runtimeProvider() };
    case "ui": return { provider, ...describeCatalogue() };
    default: return { error: `No provider called "${provider}". Providers: ${Object.keys(PROVIDERS).join(", ")}.` };
  }
}
