/**
 * modules/self-tooling/areas.js — the ONE taxonomy for agent tools (2026-11-14).
 *
 * Areas are the code-curated grouping from agent-capabilities (AREAS /
 * TOOL_EXAMPLES): built-in chat tools carry their area there. A self-built
 * tool's area is DERIVED, never chosen: every Data View has a fixed area
 * below, and a capability's area comes from the chat tool it wraps (reads)
 * or the view it writes (locked writes carry a target view).
 *
 * A built tool gets ONE primary area — from its main read, the LAST view it
 * reads (the view the final answer rows come from). Everything else it
 * touches — earlier reads, and the area of anything it writes — is secondary
 * metadata: shown with the tool, never a second listing, and grouping /
 * runtime selection key on the primary only. Nothing is hidden.
 *
 * Areas are never auto-created: a tool can only be built from registry
 * views/capabilities, which all have areas. A built-in view gets its line
 * below in the same change that adds it; a database-registered view carries
 * its area in its spec (viewAreaOf falls back to it), and a spec without
 * one derives "other" rather than breaking.
 */
import { TOOL_EXAMPLES } from "../agent-capabilities/index.js";
import { CAPABILITIES } from "./capabilities.js";
import { DATA_VIEWS } from "./views.js";

/** Every Data View's area (all 19 — the areas test holds this to DATA_VIEWS). */
export const VIEW_AREA = Object.freeze({
  my_tasks: "plans",
  my_goals: "plans",
  my_weak_topics: "progress",
  my_past_questions: "progress",
  my_xp: "progress",
  my_learning_sessions: "progress",
  my_battles: "network",
  my_buddies: "network",
  my_agent_messages: "network",
  my_library: "files",
  my_study_notes: "files",
  my_chats: "chats",
  my_tools: "building",
  public_blog_posts: "blogs",
  my_courses: "profile",
  my_classes: "activities",
  my_class_students: "activities",
  my_activities: "activities",
  my_activity_results: "activities",
  my_activity_drafts: "activities",
});

/** A view's area: the curated map first; a database-registered view
 *  (data-driven registry) may carry its own `area` in its spec. */
export function viewAreaOf(view) {
  return VIEW_AREA[view] || DATA_VIEWS[view]?.area || null;
}

/** A capability's area: the chat tool it wraps, or the view it writes. */
export function capabilityArea(name) {
  const cap = CAPABILITIES[name];
  if (!cap) return null;
  if (cap.tool) return TOOL_EXAMPLES[cap.tool]?.area || null;
  if (cap.target) return VIEW_AREA[cap.target] || null;
  return null;
}

/**
 * PURE: a built tool's primary + secondary areas from what it touches.
 * `views` in the order the tool reads them; `capabilities` it uses.
 * → { area, secondary_areas }
 */
export function deriveToolArea({ views = [], capabilities = [] } = {}) {
  const readAreas = (views || []).map((v) => viewAreaOf(v)).filter(Boolean);
  const primary = readAreas.length ? readAreas[readAreas.length - 1] : null;
  const secondary = new Set(readAreas.slice(0, -1));
  for (const c of capabilities || []) {
    const a = capabilityArea(c);
    if (a) secondary.add(a);
  }
  const area = primary || [...secondary][0] || "other";
  secondary.delete(area);
  return { area, secondary_areas: [...secondary] };
}
