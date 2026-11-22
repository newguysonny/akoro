/**
 * lib/retrievalTelemetry.js — append-only retrieval/generation telemetry.
 *
 * H5 of the retrieval plan: prove (or disprove) that a retrieval change moved
 * recall, and separate retrieval failure (no useful passage) from generation
 * failure (a weak answer over good passages). Writes are best-effort and
 * fire-and-forget: telemetry must never break a search or an answer.
 *
 * Privacy: query text is normalised, bounded to 300 chars and hashed; answers
 * are never stored. Set RETRIEVAL_TELEMETRY=off to silence it.
 */
import { createHash } from "node:crypto";

const dbLazy = async () => (await import("../db.js")).default;
const MAX_QUERY = 300;
const MAX_META_BYTES = 2000;

export const telemetryEnabled = () => process.env.RETRIEVAL_TELEMETRY !== "off";

export function normaliseQuery(q) {
  const text = String(q || "").replace(/\s+/g, " ").trim();
  return text.length > MAX_QUERY ? text.slice(0, MAX_QUERY) : text;
}

export function queryHash(q) {
  return createHash("sha256").update(normaliseQuery(q).toLowerCase()).digest("hex").slice(0, 32);
}

const int = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : null);
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : null);

/** Trim meta so a malformed event can never blow the row size. */
export function sanitiseMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  try {
    const json = JSON.stringify(meta);
    if (json.length <= MAX_META_BYTES) return meta;
    return { truncated: true };
  } catch { return {}; }
}

/** One event. Never throws, never awaited by callers. */
export async function logRetrieval(event = {}) {
  if (!telemetryEnabled()) return;
  try {
    const db = await dbLazy();
    const row = {
      user_id: event.userId || null,
      surface: String(event.surface || "unknown").slice(0, 40),
      phase: event.phase === "generation" ? "generation" : "retrieval",
      query: event.query ? normaliseQuery(event.query) : null,
      query_hash: event.query ? queryHash(event.query) : null,
      zero_result: typeof event.zeroResult === "boolean" ? event.zeroResult : null,
      candidates: int(event.candidates),
      passages: int(event.passages),
      citations: int(event.citations),
      coverage: num(event.coverage),
      unknown_markers: int(event.unknownMarkers),
      latency_ms: int(event.latencyMs),
      vector: typeof event.vector === "boolean" ? event.vector : null,
      top_score: num(event.topScore),
      model: event.model ? String(event.model).slice(0, 80) : null,
      answer_chars: int(event.answerChars),
      meta: sanitiseMeta(event.meta),
    };
    const { error } = await db.schema("edu").from("retrieval_events").insert(row);
    if (error) console.warn("[retrieval-telemetry] insert failed:", error.message);
  } catch (err) {
    console.warn("[retrieval-telemetry] skipped:", String(err?.message || err).slice(0, 120));
  }
}

/** Fire-and-forget wrapper for hot paths. */
export function recordRetrieval(event) {
  void logRetrieval(event);
}

/** Recent events + aggregates for the admin view. */
export async function readRetrievalEvents({ limit = 200, surface = null, zeroOnly = false } = {}) {
  const db = await dbLazy();
  let q = db.schema("edu").from("retrieval_events")
    .select("surface, phase, query, zero_result, candidates, passages, citations, coverage, unknown_markers, latency_ms, vector, top_score, model, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 200, 1), 500));
  if (surface) q = q.eq("surface", String(surface).slice(0, 40));
  if (zeroOnly) q = q.eq("zero_result", true).eq("phase", "retrieval");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data || [];
  const zeroQueries = new Map();
  let coverageSum = 0;
  let coverageCount = 0;
  for (const r of rows) {
    if (r.zero_result && r.query) zeroQueries.set(r.query, (zeroQueries.get(r.query) || 0) + 1);
    if (r.phase === "generation" && r.coverage != null) { coverageSum += Number(r.coverage); coverageCount += 1; }
  }
  return {
    rows,
    zeroQueries: [...zeroQueries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([query, count]) => ({ query, count })),
    coverageAvg: coverageCount ? Number((coverageSum / coverageCount).toFixed(3)) : null,
    coverageSamples: coverageCount,
  };
}
