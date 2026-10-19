/**
 * modules/agent-capabilities/catalogue.js — Admin → Agent capabilities.
 *
 * Read from the same lists the chat uses, so a new tool shows up on its next
 * deploy with no page edit:
 *   · learner tools (CHAT_TOOLS) — on/off from the same feature switches the
 *     chat applies (getLearnerChatTools)
 *   · instructor tools (INSTRUCTOR_TOOLS) — off with AKORO_ACTIVITY_DRAFTS_ENABLED
 *   · shared: the self-tooling pair both roles get
 *   · tools promoted to everyone (edu.agent_tools, scope platform)
 *   · features that aren't tools (features.js)
 * Example prompts come from examples.js; edu.agent_capability_seen remembers
 * when each key was first seen, for "New".
 */
import db from "../../db.js";
import { AREAS, TOOL_EXAMPLES } from "./examples.js";
import { AGENT_FEATURES } from "./features.js";

const edu = () => db.schema("edu");
const NEW_DAYS = 7;
/** Tools both roles' agents get (instructors join them in chat.js when self-tooling is on). */
export const SHARED_TOOLS = Object.freeze(["schema_lookup", "create_tool"]);
const GATE_LABEL = {
  self_tooling: "Self-tooling (allow-list)", blog_research: "Blog research", peer_consult: "Peer consult",
  agent_network: "Agent network", concept_tracker: "Concept Tracker", learning_insights: "Learning Insights",
  exam_prep_confidence: "Exam practice", study_prep: "Study Prep", durable_agent_chat_context: "Chat memory",
};

const firstSentence = (s) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  const m = t.match(/^(.{20,220}?[.!?])(\s|$)/);
  return (m ? m[1] : t.slice(0, 200)).trim();
};
const titleOf = (name) => {
  const s = String(name).replace(/^(get|list)_(my_)?/, "").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Pure: the built-in rows from the chat's lists. Exported for the contract test. */
export function builtInRows({ learnerTools, learnerOn, instructorTools, instructorOn }) {
  const onNames = new Set(learnerOn.map((t) => t.name));
  const row = (t, who, on, gate) => {
    const ex = TOOL_EXAMPLES[t.name];
    return {
      key: `tool:${t.name}`, kind: "tool", name: titleOf(t.name), ref: t.name, who,
      area: ex?.area || "other", what: firstSentence(t.description), examples: ex?.examples || [],
      status: on ? "on" : "off", switch: gate ? GATE_LABEL[gate] || gate : null,
    };
  };
  return [
    ...learnerTools.map((t) => row(t, SHARED_TOOLS.includes(t.name) ? "shared" : "learner", onNames.has(t.name), t.featureGate)),
    ...instructorTools.map((t) => row(t, "instructor", instructorOn, instructorOn ? null : "AKORO_ACTIVITY_DRAFTS_ENABLED")),
  ];
}

async function markSeen(keys) {
  if (!keys.length) return new Map();
  await edu().from("agent_capability_seen").upsert(keys.map((key) => ({ key })), { onConflict: "key", ignoreDuplicates: true });
  const { data } = await edu().from("agent_capability_seen").select("key, first_seen_at").in("key", keys);
  return new Map((data || []).map((r) => [r.key, r.first_seen_at]));
}

const withNew = (rows, seen) => {
  const since = Date.now() - NEW_DAYS * 86_400_000;
  // The very first look sees everything at once: only mark New once there's an older baseline.
  const times = [...seen.values()].map((v) => new Date(v).getTime());
  const baseline = times.length ? Math.min(...times) : Date.now();
  return rows.map((r) => {
    const at = r.firstSeenAt || seen.get(r.key) || null;
    const t = at ? new Date(at).getTime() : 0;
    return { ...r, firstSeenAt: at, isNew: t > since && t - baseline > 3_600_000 };
  });
};

export async function agentToolsCatalogue() {
  const chat = await import("../adaptive-learning/chat.js");
  const rows = builtInRows({
    learnerTools: chat.CHAT_TOOLS,
    learnerOn: chat.getLearnerChatTools({ allowToolRequest: true, selfTooling: true }),
    instructorTools: chat.INSTRUCTOR_TOOLS,
    instructorOn: chat.openAiInstructorTools().length > 0,
  });
  const { data: platform } = await edu().from("agent_tools")
    .select("id, name, label, goal, audience, status, usage_count, created_at, updated_at, verification")
    .eq("scope", "platform").neq("status", "archived").order("created_at", { ascending: false }).limit(200);
  for (const t of platform || []) {
    rows.push({
      key: `platform:${t.id}`, kind: "platform", id: t.id, name: t.label || titleOf(t.name), ref: t.name,
      who: t.audience === "instructor" ? "instructor" : "learner", area: "building", what: firstSentence(t.goal),
      examples: Array.isArray(t.verification?.examples) ? t.verification.examples.slice(0, 3) : [],
      status: t.status === "active" ? "on" : "off", switch: t.status === "active" ? null : t.status,
      uses: t.usage_count ?? 0, firstSeenAt: t.created_at,
    });
  }
  const seen = await markSeen(rows.filter((r) => r.kind === "tool").map((r) => r.key)).catch(() => new Map());
  return { areas: AREAS, rows: withNew(rows, seen) };
}

export async function agentFeaturesCatalogue() {
  const rows = AGENT_FEATURES.map((f) => ({
    key: `feature:${f.key}`, kind: "feature", name: f.name, ref: f.key, who: f.who, area: f.area, what: f.what,
    examples: f.examples || [], status: !f.isOn || f.isOn() ? "on" : "off", switch: f.switch || null, since: f.since || null,
  }));
  const seen = await markSeen(rows.map((r) => r.key)).catch(() => new Map());
  return { areas: AREAS, rows: withNew(rows, seen) };
}
