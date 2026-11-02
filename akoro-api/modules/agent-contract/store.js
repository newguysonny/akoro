/**
 * agent-contract/store.js — where episodes go (training/SPEC.md §3, §9).
 *
 * AGENT_EPISODES (env):
 *   off        nothing is stored
 *   synthetic  (default) benchmark and teacher runs only — no learner data
 *   consented  also real traffic, from learners who opted in
 *              (users.agent_training_consent), anonymised first
 *   all        also real traffic from EVERY user except those who opted out
 *              (users.agent_training_opt_out), anonymised first — decided
 *              2026-10-31; needs the privacy policy to say so (SPEC §9)
 * A failed write never fails the turn that produced it.
 */
import db from "../../db.js";
import { anonymiseEpisode } from "./anonymise.js";

export const episodeMode = (env = process.env) => {
  const m = String(env.AGENT_EPISODES || "synthetic").trim().toLowerCase();
  return ["off", "synthetic", "consented", "all"].includes(m) ? m : "synthetic";
};

/** Should this live turn record an episode at all? (cheap: no recorder without consent) */
export async function recordsRealTraffic(userId, env = process.env) {
  const mode = episodeMode(env);
  if (!userId || (mode !== "consented" && mode !== "all")) return false;
  try {
    const { data } = await db.from("users").select("agent_training_consent, agent_training_opt_out").eq("id", userId).maybeSingle();
    if (data?.agent_training_opt_out === true) return false;   // an opt-out always wins
    return mode === "all" ? true : data?.agent_training_consent === true;
  } catch { return false; }
}

/** Store one episode. → "stored" | "skipped" | "dropped" (anonymiser refused) | "failed" */
// `labelKey` (agent-ratings/ratings.js labelKeyFor): a keyed hash of the reply the episode
// produced, so a later rating can join it as a human label — never the message id itself.
export async function saveEpisode(episode, { names = [], model = null, labelKey = null, env = process.env } = {}) {
  const mode = episodeMode(env);
  if (!episode || mode === "off") return "skipped";
  let row = episode;
  if (episode.source === "real") {
    if (mode !== "consented" && mode !== "all") return "skipped";
    row = anonymiseEpisode(episode, { names });
    if (!row) return "dropped";
  }
  try {
    const insert = (extra) => db.schema("edu").from("agent_episodes").insert({
      id: row.id, source: row.source, surface: row.turn_input?.surface || "unknown",
      verdict: row.outcome?.verdict || "fail", failure_class: row.outcome?.failure_class || null,
      capabilities: row.capabilities || [], scenario: row.meta?.scenario || null, model, episode: row, ...extra,
    });
    let { error } = await insert(labelKey ? { label_key: String(labelKey) } : {});
    // Rolling deploy: the label column may not exist yet — keep the episode without it.
    if (error && labelKey && /label_key/i.test(String(error.message || ""))) ({ error } = await insert({}));
    if (error) throw error;
    return "stored";
  } catch (e) {
    console.warn("[agent-episodes] not stored:", String(e?.message || e).slice(0, 160));
    return "failed";
  }
}
