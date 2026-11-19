/**
 * adaptive-learning/failureDigest.js — Phase 22, step 5: turn the execution
 * log into reusable lessons. Reads recent failed steps, clusters them by
 * (tool, error_class), writes a digest an admin can read and turn into a
 * prompt/rule change (never auto-applied). Best-effort; never throws into a
 * request.
 */
import db from "../../../db.js";
import { recentFailures } from "./executionLog.js";
import { clusterFailures, digestText } from "./failureDigestCore.js";

const edu = () => db.schema("edu");

/** Compute the digest for a window (no write). */
export async function buildFailureDigest({ sinceMs = 24 * 60 * 60_000, minCount = 3, top = 6 } = {}) {
  const steps = await recentFailures({ sinceMs });
  const clusters = clusterFailures(steps, { minCount, top });
  const end = Date.now();
  return {
    windowStart: new Date(end - sinceMs).toISOString(),
    windowEnd: new Date(end).toISOString(),
    failureCount: steps.length,
    clusters,
    lessons: digestText(clusters),
  };
}

/** Persist one digest. → row id, or null. */
export async function storeFailureDigest(digest) {
  if (!digest) return null;
  try {
    const { data, error } = await edu().from("agent_failure_digests").insert({
      window_start: digest.windowStart,
      window_end: digest.windowEnd,
      failure_count: digest.failureCount,
      clusters: digest.clusters,
      lessons: digest.lessons,
    }).select("id").single();
    if (error) return null;
    return data?.id || null;
  } catch { return null; }
}

/** Build + persist. → digest (with `storedId` when written). Best-effort. */
export async function runFailureDigest(opts = {}) {
  const digest = await buildFailureDigest(opts);
  if (!digest.clusters.length) return { ...digest, storedId: null };
  const storedId = await storeFailureDigest(digest);
  return { ...digest, storedId };
}

/** The most recent stored digests (ops read). */
export async function listFailureDigests({ limit = 10 } = {}) {
  try {
    const { data } = await edu().from("agent_failure_digests").select("*")
      .order("created_at", { ascending: false }).limit(Math.min(Math.max(Number(limit) || 10, 1), 30));
    return data || [];
  } catch { return []; }
}
