/**
 * modules/self-tooling/toolSuggestions.js — the repeated-computation sweep
 * (option 2's companion, 2026-11-14). Pure computed reads are answer-only, so
 * a question a learner keeps asking leaves 'answered' traces in
 * self_tool_events. Once a day this sweep clusters those traces per learner;
 * a computation worked out 3+ times in 14 days becomes a tool suggestion on
 * the Suggestions surface — an agent_suggestions row, kind "conversation",
 * whose title IS the prompt: accepting hands the prompt back, the app opens
 * a chat with it as the learner's message, and the agent saves the stashed
 * computation in that chat (save_computation). It skips computations already
 * saved as tools and any suggested within the last 30 days — a suggestion
 * must never nag.
 */
import db from "../../db.js";
import { similarGoal } from "./toolSimilarity.js";

export const REPEAT_THRESHOLD = 3;
export const REPEAT_WINDOW_DAYS = 14;
export const SUGGESTION_COOLDOWN_DAYS = 30;
export const MAX_SUGGESTIONS_PER_SWEEP = 2;

const edu = () => db.schema("edu");

/** PURE: cluster one learner's answered events into repeated computations (newest seed first). */
export function clusterAnswered(events, threshold = REPEAT_THRESHOLD) {
  const sorted = [...(events || [])].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const used = new Set();
  const clusters = [];
  for (const seed of sorted) {
    if (used.has(seed.id) || !seed.goal) continue;
    const members = [seed];
    used.add(seed.id);
    for (const e of sorted) {
      if (used.has(e.id)) continue;
      const sameTool = seed.detail?.name && e.detail?.name === seed.detail.name;
      if (sameTool || similarGoal(seed.goal, e.goal)) { members.push(e); used.add(e.id); }
    }
    if (members.length >= threshold) clusters.push({ seed, members, count: members.length });
  }
  return clusters.sort((a, b) => b.count - a.count);
}

/** The suggestion's title: what the learner sees, and the message they send when they tap it. */
export const suggestionPrompt = (label) => `Please save my "${label}" tool so I can reuse it.`;
export const suggestionRationale = (count) => `You've worked this out ${count} times in the last two weeks. Saved as a tool, your agent answers it straight away instead of working it out each time.`;

/** One daily pass over every learner's recent one-off computations. → { suggested } */
export async function sweepRepeatedComputations({ now = new Date() } = {}) {
  const since = new Date(now.getTime() - REPEAT_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const { data: events, error } = await edu().from("self_tool_events")
    .select("id, user_id, goal, detail, created_at")
    .eq("outcome", "answered").gte("created_at", since)
    .order("created_at", { ascending: false }).limit(2000);
  if (error) throw new Error(`sweep read failed: ${error.message}`);
  const byUser = new Map();
  for (const e of events || []) {
    if (!e.detail?.name || !e.detail?.label) continue;
    if (!byUser.has(e.user_id)) byUser.set(e.user_id, []);
    byUser.get(e.user_id).push(e);
  }
  let suggested = 0;
  for (const [userId, userEvents] of byUser) {
    let made = 0;
    for (const c of clusterAnswered(userEvents)) {
      if (made >= MAX_SUGGESTIONS_PER_SWEEP) break;
      const { name, label } = c.seed.detail;
      // Already saved as a tool? Nothing to suggest.
      const { data: tool } = await edu().from("agent_tools").select("id")
        .eq("owner_id", userId).eq("name", name).in("status", ["active", "disabled"]).maybeSingle();
      if (tool) continue;
      // Suggested (open, accepted or dismissed) within the cooldown? Never nag.
      const title = suggestionPrompt(label);
      const coolSince = new Date(now.getTime() - SUGGESTION_COOLDOWN_DAYS * 24 * 3600 * 1000).toISOString();
      const { data: prior } = await db.from("agent_suggestions").select("id")
        .eq("user_id", userId).eq("source", "proactive").eq("title", title).gte("created_at", coolSince).limit(1);
      if (prior?.length) continue;
      const { data: agentRow } = await db.from("user_agents").select("id").eq("user_id", userId).maybeSingle();
      const { data: sg, error: insErr } = await db.from("agent_suggestions").insert({
        user_id: userId, agent_id: agentRow?.id ?? null,
        kind: "conversation", title, rationale: suggestionRationale(c.count), source: "proactive",
      }).select().single();
      if (insErr) { console.warn("[tool-suggestions] insert failed:", insErr.message); continue; }
      global.io?.to(`user:${userId}`).emit("agent:suggestion", sg);
      suggested++; made++;
    }
  }
  return { suggested };
}
