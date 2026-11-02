/**
 * modules/autonomy/kindModes.js — the proactive kinds' modes, from the db
 * (Grand Plan Phase 18 item 1). The rules are in kindModesCore.js.
 *
 *   modesFor(userId)                       → (kind) → "off" | "observe" | "live"
 *   recordObservations(items, ctx)         write the "would have proposed" rows (never throws)
 *   listKindModes()                        admin: every kind, its mode, scope and counts
 *   listObservations(kind, { limit })      admin: observe records with real outcomes beside them
 *   setKindMode(kind, body, actor)         admin: switch a kind (history + audit log)
 *
 * Failure-tolerant: when the modes can't be read, every kind falls back to its
 * code default (existing kinds live — exactly the behaviour before modes).
 */
import db from "../../db.js";
import {
  audienceOf, defaultModeFor, EXISTING_KINDS, INSTRUCTOR_PROACTIVE_KINDS, LEARNER_PROACTIVE_KINDS,
  laterAccepted, modeResolver, needsSchool, observationRows, validateModeChange,
} from "./kindModesCore.js";

const edu = () => db.schema("edu");
const CACHE_MS = 30_000;
let cache = { at: 0, rows: null };

/** The mode rows, cached 30 s (a switch shows within half a minute everywhere). */
export async function kindModeRows({ fresh = false } = {}) {
  if (!fresh && cache.rows && Date.now() - cache.at < CACHE_MS) return cache.rows;
  try {
    const { data, error } = await edu().from("agent_kind_modes").select("*");
    if (error) throw new Error(error.message);
    cache = { at: Date.now(), rows: data || [] };
  } catch (e) {
    console.warn("[autonomy/modes] read failed — code defaults:", e.message);
    cache = { at: Date.now(), rows: cache.rows || [] };
  }
  return cache.rows;
}

export const forgetKindModes = () => { cache = { at: 0, rows: null }; };

/** kind → mode for this person (their school read only when some kind scopes by school). */
export async function modesFor(userId, { fresh = false } = {}) {
  const rows = await kindModeRows({ fresh });
  let schoolId = null;
  if (needsSchool(rows)) {
    try { schoolId = await (await import("../../lib/coins.js")).schoolIdForUser(userId); } catch { /* no school */ }
  }
  return modeResolver(rows, { userId, schoolId });
}

/** The observe records for one pass. Never throws; → how many were written. */
export async function recordObservations(items, { userId, runId = null, audience = "learner" } = {}) {
  const rows = observationRows(items, { userId, runId, audience });
  if (!rows.length) return 0;
  try {
    const { error } = await edu().from("agent_observations").insert(rows);
    if (error) throw new Error(error.message);
    return rows.length;
  } catch (e) {
    console.warn("[autonomy/modes] observations not recorded:", e.message);
    return 0;
  }
}

/** Admin: every kind (known or with a row), its mode and scope, and what it did in the last 30 days. */
export async function listKindModes() {
  const rows = await kindModeRows({ fresh: true });
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const kinds = [...new Set([...LEARNER_PROACTIVE_KINDS, ...INSTRUCTOR_PROACTIVE_KINDS, ...rows.map((r) => r.kind)])];
  const [obs, props] = await Promise.all([
    edu().from("agent_observations").select("kind").gte("created_at", since).limit(20000).then((r) => r.data || []).catch(() => []),
    edu().from("agent_proposals").select("kind, status").gte("created_at", since).limit(20000).then((r) => r.data || []).catch(() => []),
  ]);
  const count = (list, kind, pred = () => true) => list.filter((x) => x.kind === kind && pred(x)).length;
  return kinds.map((kind) => {
    const r = rows.find((x) => x.kind === kind) || null;
    return {
      kind, audience: r?.audience || audienceOf(kind), mode: r?.mode || defaultModeFor(kind), stored: !!r, existing: EXISTING_KINDS.has(kind),
      scope: r?.scope_mode ? { mode: r.scope_mode, userIds: r.scope_user_ids || [], schoolIds: r.scope_school_ids || [] } : null,
      note: r?.note || null, updatedBy: r?.updated_by_label || null, updatedAt: r?.updated_at || null,
      counts: {
        observed30d: count(obs, kind),
        proposed30d: count(props, kind),
        accepted30d: count(props, kind, (p) => p.status === "approved" || p.status === "executed"),
        dismissed30d: count(props, kind, (p) => p.status === "dismissed"),
      },
    };
  });
}

/** Admin: the observe records of one kind, newest first, with whether a similar live one was later accepted. */
export async function listObservations(kind, { limit = 50 } = {}) {
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  const { data, error } = await edu().from("agent_observations").select("id, kind, audience, user_id, run_id, title, reason, preview, payload, created_at")
    .eq("kind", kind).order("created_at", { ascending: false }).limit(n);
  if (error) throw new Error(error.message);
  const rows = data || [];
  if (!rows.length) return [];
  const users = [...new Set(rows.map((r) => r.user_id))];
  const oldest = rows[rows.length - 1].created_at;
  const [{ data: props }, { data: people }] = await Promise.all([
    edu().from("agent_proposals").select("user_id, kind, title, payload, status, created_at").eq("kind", kind).in("user_id", users).gte("created_at", oldest).limit(2000),
    db.from("users").select("id, username, full_name").in("id", users),
  ]);
  const who = new Map((people || []).map((u) => [u.id, u.username || u.full_name || null]));
  return laterAccepted(rows, props || []).map((o) => ({ ...o, who: who.get(o.user_id) || null }));
}

/** Admin: switch a kind. Recorded with who and when (history row + admin_audit_log). → the new row */
export async function setKindMode(kind, body, actor = {}) {
  const v = validateModeChange(kind, body);
  if (!v.ok) throw Object.assign(new Error(v.error), { status: 422 });
  const { data: before } = await edu().from("agent_kind_modes").select("*").eq("kind", kind).maybeSingle();
  const row = {
    kind, audience: before?.audience || audienceOf(kind), ...v.change,
    updated_by: actor.id || null, updated_by_label: actor.label || "admin", updated_at: new Date().toISOString(),
  };
  const { data, error } = await edu().from("agent_kind_modes").upsert(row, { onConflict: "kind" }).select("*").single();
  if (error) throw new Error(error.message);
  const snap = (r) => (r ? { mode: r.mode, scope_mode: r.scope_mode, scope_user_ids: r.scope_user_ids, scope_school_ids: r.scope_school_ids } : null);
  await edu().from("agent_kind_mode_changes").insert({
    kind, before: snap(before), after: snap(data), changed_by: actor.id || null, changed_by_label: actor.label || "admin", note: v.change.note,
  }).then(({ error: e }) => e && console.warn("[autonomy/modes] history insert failed:", e.message), () => {});
  await db.from("admin_audit_log").insert({
    actor: actor.id || null, actor_label: actor.label || "admin", action: "proactive_kind.mode_changed",
    entity_type: "proactive_kind", entity_id: kind, before: snap(before), after: snap(data),
  }).then(({ error: e }) => e && console.warn("[autonomy/modes] audit insert failed:", e.message), () => {});
  forgetKindModes();
  return data;
}

/** Admin: a kind's switch history. */
export async function kindModeHistory(kind, { limit = 20 } = {}) {
  const { data } = await edu().from("agent_kind_mode_changes").select("before, after, changed_by_label, note, changed_at")
    .eq("kind", kind).order("changed_at", { ascending: false }).limit(Math.max(1, Math.min(100, Number(limit) || 20)));
  return data || [];
}
