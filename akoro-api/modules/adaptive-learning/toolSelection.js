/**
 * modules/adaptive-learning/toolSelection.js — runtime area selection
 * (2026-11-14). Tools are grouped by the ONE taxonomy (agent-capabilities
 * AREAS / TOOL_EXAMPLES for built-ins; a self-built tool's derived primary
 * area). A turn sends the always-on CORE plus the tools of the areas active
 * for the conversation — built-in and learner-built together, in one move.
 *
 * Selection is an optimisation, never a wall:
 *  - areas activate from the learner's message (keyword heuristic below),
 *    from the turn's forced tool, and from the agent loading an area with
 *    get_agent_capabilities { area }; once active, an area sticks for the
 *    conversation;
 *  - when NO area is active (a vague opener), the turn keeps the full list;
 *  - kill switch: AKORO_TOOL_AREA_SELECTION=false restores the full list
 *    for every turn.
 */
import { AREAS, TOOL_EXAMPLES } from "../agent-capabilities/examples.js";

export { AREAS };

/** Always offered, whatever is selected: identity, discovery, and building. */
export const CORE_TOOL_NAMES = Object.freeze([
  "get_learner_context", "get_agent_capabilities",
  "schema_lookup", "create_tool", "save_computation", "submit_tool_request",
]);

export const areaSelectionEnabled = () => String(process.env.AKORO_TOOL_AREA_SELECTION ?? "true").toLowerCase() !== "false";

/** A built-in tool's area (curated in TOOL_EXAMPLES; unlisted → "other"). */
export const toolArea = (name) => TOOL_EXAMPLES[name]?.area || "other";

/** Message words that activate an area (generous on purpose: a false positive costs a few defs; a miss has the loader as recovery). */
export const AREA_KEYWORDS = Object.freeze({
  profile: ["school", "class", "teacher", "teachers", "my level", "year group", "subjects does", "subjects offered"],
  progress: ["progress", "weak", "rank", "ranking", "xp", "score", "scores", "overview", "knowledge map", "past question", "past-question", "concept tracker", "insights", "how am i doing", "how did i do", "study time", "due for review"],
  teaching: ["teach", "explain", "study prep", "study plan", "study-plan", "exam in", "waec", "jamb", "guide review", "learn"],
  plans: ["task", "tasks", "todo", "to-do", "goal", "goals", "remind", "reminder", "follow up", "follow-up", "schedule", "check-in", "check in"],
  files: ["library", "notes", "note", "file", "files", "document", "documents", "material", "materials", "past paper", "past papers", "folder", "upload"],
  chats: ["chat", "chats", "conversation", "we said", "remember", "memory", "discussed"],
  network: ["battle", "battles", "challenge", "agent", "agents", "buddy", "league", "inbox", "competitor", "rematch", "revision circle", "daily challenge"],
  blogs: ["blog", "blogs", "publish", "post about", "article"],
  proactive: ["suggestion", "suggestions", "proposed", "you suggested", "while i was away", "auto reply", "autonomy"],
  building: ["tool", "tools", "build me", "make a tool", "save that", "keep that"],
  support: ["bug", "report a bug", "bug report", "broken", "not working", "doesn't work", "glitch", "something's wrong", "something is wrong", "akoro support"],
  activities: ["activity", "activities", "assignment", "classwork", "homework"],
});

/** PURE: the areas a message points at. */
export function areasForMessage(text) {
  const t = ` ${String(text || "").toLowerCase()} `;
  const found = new Set();
  for (const [area, words] of Object.entries(AREA_KEYWORDS)) {
    if (words.some((w) => t.includes(w))) found.add(area);
  }
  return found;
}

/**
 * PURE: keep the core + the active areas' defs. `areaOf(name)` resolves a
 * tool's area (learner-built tools first, then the built-in map). With no
 * active areas, returns the defs untouched (the vague-turn fallback).
 */
export function filterDefsByAreas(defs, activeAreas, areaOf) {
  if (!activeAreas || !activeAreas.size) return defs;
  const core = new Set(CORE_TOOL_NAMES);
  return (defs || []).filter((d) => {
    const name = d?.function?.name;
    return name && (core.has(name) || activeAreas.has(areaOf(name)));
  });
}
