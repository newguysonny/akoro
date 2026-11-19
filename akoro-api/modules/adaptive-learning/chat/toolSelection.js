/**
 * modules/adaptive-learning/chat/toolSelection.js — runtime area selection
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
import { AREAS, TOOL_EXAMPLES } from "../../agent-capabilities/index.js";

export { AREAS };

/** Always offered, whatever is selected: identity, discovery, and building. */
export const CORE_TOOL_NAMES = Object.freeze([
  "get_learner_context", "get_agent_capabilities",
  "schema_lookup", "create_tool", "save_computation", "await_decision", "submit_tool_request",
  // The instructor identity tool — always on for instructor turns (it is
  // not in the learner catalogue, so listing it here costs learners nothing).
  "get_my_profile",
]);

export const areaSelectionEnabled = () => String(process.env.AKORO_TOOL_AREA_SELECTION ?? "true").toLowerCase() !== "false";

/** A built-in tool's area (curated in TOOL_EXAMPLES; unlisted → "other"). */
export const toolArea = (name) => TOOL_EXAMPLES[name]?.area || "other";

/** Message words that activate an area (generous on purpose: a false positive costs a few defs; a miss has the loader as recovery). */
export const AREA_KEYWORDS = Object.freeze({
  profile: ["school", "class", "teacher", "teachers", "my level", "year group", "subjects does", "subjects offered"],
  progress: ["progress", "weak", "rank", "ranking", "xp", "score", "scores", "overview", "knowledge map", "past question", "past-question", "concept tracker", "insights", "how am i doing", "how did i do", "study time", "due for review"],
  teaching: ["teach", "explain", "study prep", "study plan", "study-plan", "exam in", "waec", "jamb", "guide review", "learn"],
  plans: ["task", "tasks", "todo", "to-do", "goal", "goals", "remind", "reminder", "follow up", "follow-up", "schedule", "check-in", "check in", "email", "mail"],
  files: ["library", "notes", "note", "file", "files", "document", "documents", "material", "materials", "past paper", "past papers", "folder", "upload"],
  uploads: ["uploaded", "attach", "attached", "attachment", "extraction", "extract", "filing", "filed"],
  chats: ["chat", "chats", "conversation", "we said", "remember", "memory", "discussed"],
  network: ["battle", "battles", "challenge", "agent", "agents", "buddy", "league", "inbox", "competitor", "rematch", "revision circle", "daily challenge"],
  blogs: ["blog", "blogs", "publish", "post about", "article"],
  proactive: ["suggestion", "suggestions", "proposed", "you suggested", "while i was away", "auto reply", "autonomy"],
  building: ["tool", "tools", "build me", "make a tool", "save that", "keep that"],
  support: ["bug", "report a bug", "bug report", "broken", "not working", "doesn't work", "glitch", "something's wrong", "something is wrong", "akoro support", "request", "requests"],
  activities: ["activity", "activities", "assignment", "classwork", "homework", "draft", "drafts", "routine", "routines", "roster", "outcomes", "submissions", "class", "classes", "classroom", "student", "students"],
});

// A run verb: the learner is asking for the tool to be USED, not talked
// about ("my X tool is broken" must not fire it; "can you run my X
// tool?" must).
const RUN_VERB = /\b(run|use|using|execute|apply|invoke)\b/i;
// A negated run verb is the opposite instruction ("do not run it",
// "never use my X tool") — live, 2026-11-18: a status question ending
// "do not run it" was forced into a call by the bare verb match.
const NEGATED_RUN = /\b(do not|don't|dont|never|not)\s+(\w+\s+)?(run|use|using|execute|apply|invoke)\b/i;
const normWords = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * PURE: the learner tool a message NAMES with intent to run it, or null.
 * `tools` is [{ name, label }]. A tool is named when its label — or its
 * function name spelled out ("delete_chat_by_title" → "delete chat by
 * title") — appears in the message as whole words, and a run verb
 * appears too. Live, 2026-11-18: the tool was loaded (its area was
 * active) yet the model repeatedly declined to call it and claimed it
 * did not exist; naming a tool with a run verb is the strongest signal
 * a turn can carry, so the caller forces the call. Longest spoken form
 * wins when several tools match. Short forms (<3 words and <14 chars)
 * never match — too collision-prone to force a call on.
 */
export function namedLearnerTool(message, tools) {
  const text = ` ${normWords(message)} `;
  if (!RUN_VERB.test(text) || NEGATED_RUN.test(text)) return null;
  let best = null;
  for (const t of tools || []) {
    if (!t?.name) continue;
    for (const form of [normWords(t.label), normWords(t.name)]) {
      if (!form) continue;
      const words = form.split(" ").length;
      if (words < 3 && form.length < 14) continue;
      if (text.includes(` ${form} `) && (!best || form.length > best.form.length)) best = { name: t.name, form };
    }
  }
  return best?.name || null;
}

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
