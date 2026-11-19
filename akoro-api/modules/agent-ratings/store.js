/**
 * agent-ratings/store.js — the thin wiring for ratings (Phase 18 item 4).
 * Ownership is checked on every write: a learner rates only an agent message
 * in their own chat, or an event of their own workflow run.
 */
import db from "../../db.js";
import { recordsRealTraffic } from "../agent-contract/index.js";
import { humanLabel, labelKeyFor } from "./ratings.js";

const ratings = () => db.schema("edu").from("agent_message_ratings");

/** Is this message the learner's own agent message on that surface? */
export async function ownsMessage({ userId, surface, messageId }) {
  if (surface === "agent_chat") {
    const { data, error } = await db.from("chat_messages").select("id")
      .eq("id", messageId).eq("user_id", userId).eq("role", "agent").maybeSingle();
    if (error) throw error;
    return !!data;
  }
  if (surface === "workflow_summary") {
    const { data: ev, error } = await db.schema("edu").from("workflow_events").select("id, workflow_id")
      .eq("id", messageId).maybeSingle();
    if (error) throw error;
    if (!ev?.workflow_id) return false;
    const { data: wf, error: wfError } = await db.schema("edu").from("workflow_instances").select("id")
      .eq("id", ev.workflow_id).eq("learner_id", userId).maybeSingle();
    if (wfError) throw wfError;
    return !!wf;
  }
  return false;
}

/**
 * The rating as a human label on the episode, when the learner's turns are
 * recorded at all (AGENT_EPISODES mode, consent, an opt-out that always wins
 * — the same rule as the episode). Otherwise any earlier label is removed.
 * Best effort: a failed label never fails the rating.
 * → "labelled" | "cleared" | "no_key" | "failed"
 */
export async function labelEpisode({ user, surface, messageId, rating = null, reason = null, env = process.env }) {
  const key = labelKeyFor(surface, messageId, env);
  if (!key) return "no_key";
  try {
    const allowed = rating ? await recordsRealTraffic(user?.id, env).catch(() => false) : false;
    const label = allowed ? humanLabel({ rating, reason, surface }, { names: [user?.username, user?.fullName, ...String(user?.fullName || "").split(/\s+/), user?.email].filter(Boolean) }) : null;
    const { error } = await db.schema("edu").from("agent_episodes")
      .update({ human_label: label, human_label_at: label ? new Date().toISOString() : null })
      .eq("label_key", key);
    if (error) throw error;
    return label ? "labelled" : "cleared";
  } catch (e) {
    console.warn("[agent-ratings] episode label not written:", String(e?.message || e).slice(0, 160));
    return "failed";
  }
}

/** Set (or change) the learner's rating on one message. */
export async function setRating({ user, surface, messageId, rating, reason }) {
  const now = new Date().toISOString();
  const { data: existing, error: readError } = await ratings().select("id")
    .eq("learner_id", user.id).eq("surface", surface).eq("message_id", messageId).maybeSingle();
  if (readError) throw readError;
  const q = existing
    ? ratings().update({ rating, reason, updated_at: now }).eq("id", existing.id)
    : ratings().insert({ learner_id: user.id, surface, message_id: messageId, rating, reason, created_at: now, updated_at: now });
  const { data, error } = await q.select("surface, message_id, rating, reason, updated_at").single();
  if (error) throw error;
  const episode = await labelEpisode({ user, surface, messageId, rating, reason });
  return { rating: data, episode };
}

/** Clear the learner's rating on one message (and its label on the episode). */
export async function clearRating({ user, surface, messageId }) {
  const { error } = await ratings().delete()
    .eq("learner_id", user.id).eq("surface", surface).eq("message_id", messageId);
  if (error) throw error;
  const episode = await labelEpisode({ user, surface, messageId, rating: null });
  return { cleared: true, episode };
}

/** The learner's own ratings for some of their messages (the UI's read). */
export async function listOwnRatings({ userId, surface, messageIds }) {
  if (!messageIds.length) return [];
  const { data, error } = await ratings().select("surface, message_id, rating, reason, updated_at")
    .eq("learner_id", userId).eq("surface", surface).in("message_id", messageIds);
  if (error) throw error;
  return data || [];
}
