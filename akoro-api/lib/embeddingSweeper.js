// lib/embeddingSweeper.js
//
// Keeps the vector stores current, without every writer having to remember.
//
// Before this, embeddings were built inline by whichever code path happened to
// write the row — and when that path forgot, or the row arrived from a SQL seed,
// or the embedding call failed, the row simply had no vector and was invisible
// to search forever. The only repair was an admin remembering to press
// /reembed. Nothing ever reported how many rows were missing, so nobody knew to
// press it.
//
// Worse, and quieter: a note EDITED after being embedded kept its old vector.
// Search would keep finding it by wording the learner had already replaced.
// Everything still worked, which is why it would never have been noticed.
//
// So: every store carries embedded_at, and this sweeps for rows where the
// vector is missing or older than the content. Inline embedding at write time
// stays — it is faster and it is what makes a note searchable immediately —
// but it is no longer the only thing standing between a write and a working
// search. This is the floor under it.

import db from "../db.js";
import { openai } from "./aiModel.js";
import { workerTick } from "./workerLog.js";

/**
 * The stores, and how to turn a row into the text that gets embedded.
 *
 * `text` must match what the writer embeds, or a row would flip between two
 * vectors depending on which path touched it last.
 */
const STORES = [
  {
    table: "student_knowledge", schema: "edu",
    select: "id, topic, content, updated_at, embedded_at",
    text: (r) => `${r.content ?? ""} ${r.topic ?? ""}`.trim(),
    stamp: "updated_at",
  },
  {
    table: "agent_knowledge", schema: "edu",
    select: "id, topic, content, updated_at, embedded_at",
    text: (r) => `${r.content ?? ""} ${r.topic ?? ""}`.trim(),
    stamp: "updated_at",
  },
  {
    table: "training_chunks", schema: "edu",
    select: "id, chunk_text, created_at, embedded_at",
    text: (r) => r.chunk_text ?? "",
    stamp: "created_at",
  },
  {
    table: "syllabus_chunks", schema: "edu",
    select: "id, content, embedded_at",
    text: (r) => r.content ?? "",
    stamp: null,
  },
  {
    // Compact learner-owned notes only. Raw chat_messages are deliberately not
    // a vector store: ordered transcript hydration remains relational.
    table: "learner_agent_memories", schema: "edu",
    select: "id, content, topic, subject, updated_at, embedded_at",
    text: (r) => `${r.content ?? ""} ${r.topic ?? ""} ${r.subject ?? ""}`.trim(),
    stamp: "updated_at",
    filter: (query) => query.eq("status", "active"),
  },
  {
    // One compact summary per chat session, also learner-owned and clearable.
    table: "learner_agent_conversation_summaries", schema: "edu",
    key: "chat_session_id",
    select: "chat_session_id, summary, updated_at, embedded_at",
    text: (r) => r.summary ?? "",
    stamp: "updated_at",
  },
];

function applyStoreFilter(query, store) {
  return store.filter ? store.filter(query) : query;
}

function storeKey(store) {
  return store.key || "id";
}

/** Batch size per store per pass. Bounded so a big backlog costs a little each
 *  tick rather than one enormous bill and a rate-limit wall. */
const BATCH = 25;

/** If a store's UPDATE keeps failing, its rows never leave the sweep queue
 *  (supabase-js returns the error instead of throwing), and they would be
 *  re-embedded — re-sent over the wire and re-billed — every 10 minutes
 *  forever. On Render's metered outbound bandwidth that is a silent GB-scale
 *  leak with zero users. A pass whose update failed parks the store for this
 *  long before trying again, and says so in the logs. */
const FAILED_STORE_BACKOFF_MS = 6 * 60 * 60 * 1000;
const storeBackoffUntil = new Map();

export async function embedText(text, feature = "embedding_sweep", userId = null) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: String(text).slice(0, 8000),
    __feature: feature,
    ...(userId ? { __userId: userId } : {}),
  });
  return res.data?.[0]?.embedding ?? null;
}

/**
 * What is missing or stale, per store. Cheap enough to expose on an admin page,
 * which is the point — "nobody knew to press it" was the actual failure.
 */
export async function embeddingHealth() {
  const out = [];
  for (const s of STORES) {
    try {
      const key = storeKey(s);
      const { count: missing } = await applyStoreFilter(
        db.schema(s.schema).from(s.table).select(key, { count: "exact", head: true }), s,
      ).is("embedding", null).is("embedded_at", null);
      const { count: total } = await applyStoreFilter(
        db.schema(s.schema).from(s.table).select(key, { count: "exact", head: true }), s,
      );
      let stale = 0;
      if (s.stamp) {
        // An embedded_at null is a freshness signal left by a writer after it
        // changes its source text. It is separate from a genuinely absent
        // vector so the health response makes the repair state visible.
        const { count } = await applyStoreFilter(
          db.schema(s.schema).from(s.table).select(key, { count: "exact", head: true }), s,
        ).not("embedding", "is", null).is("embedded_at", null);
        stale = count ?? 0;
      }
      out.push({ store: `${s.schema}.${s.table}`, total: total ?? 0, missing: missing ?? 0, unstamped: stale });
    } catch (e) {
      out.push({ store: `${s.schema}.${s.table}`, error: e.message });
    }
  }
  return out;
}

/**
 * One pass. Returns what it did, so a caller can loop until it comes back empty
 * or stop when it has spent enough.
 */
export async function sweepOnce({ batch = BATCH } = {}) {
  const done = [];

  for (const s of STORES) {
    let filled = 0, failed = 0;
    try {
      if (Date.now() < (storeBackoffUntil.get(s.table) ?? 0)) continue;
      let selection = db.schema(s.schema).from(s.table).select(s.select);
      selection = applyStoreFilter(selection, s);
      const { data: rows } = await selection.is("embedding", null).is("embedded_at", null).limit(batch);

      for (const r of (rows ?? [])) {
        const text = s.text(r);
        const key = storeKey(s);
        // A row with no text cannot be embedded and must not be retried
        // forever. Stamping it takes it out of the queue without pretending it
        // was indexed.
        if (!text || text.length < 3) {
          let update = db.schema(s.schema).from(s.table)
            .update({ embedded_at: new Date().toISOString() }).eq(key, r[key]);
          update = applyStoreFilter(update, s);
          const { error: stampError } = await update;
          if (stampError) {
            failed++;
            console.warn(`[embeddings] ${s.table}: stamp update failed (${stampError.message}) — store parked ${FAILED_STORE_BACKOFF_MS / 3600000}h`);
            storeBackoffUntil.set(s.table, Date.now() + FAILED_STORE_BACKOFF_MS);
            break;
          }
          continue;
        }
        try {
          const embedding = await embedText(text);
          if (!embedding) { failed++; continue; }
          let update = db.schema(s.schema).from(s.table)
            .update({ embedding, embedded_at: new Date().toISOString() }).eq(key, r[key]);
          update = applyStoreFilter(update, s);
          const { error: updateError } = await update;
          if (updateError) {
            // The embedding was paid for but the row is still queued; without
            // this check it would be re-embedded on every pass, invisibly.
            failed++;
            console.warn(`[embeddings] ${s.table}: update failed after embedding (${updateError.message}) — store parked ${FAILED_STORE_BACKOFF_MS / 3600000}h`);
            storeBackoffUntil.set(s.table, Date.now() + FAILED_STORE_BACKOFF_MS);
            break;
          }
          filled++;
        } catch (e) {
          failed++;
          // Rate limits and outages are the common case, and grinding through
          // the rest of the batch would just collect more of the same.
          if (/rate|429|quota/i.test(e.message)) break;
        }
      }
    } catch (e) {
      console.warn(`[embeddings] ${s.table} sweep failed:`, e.message);
    }
    if (filled || failed) done.push({ store: `${s.schema}.${s.table}`, filled, failed });
  }

  return done;
}

let timer = null;

/**
 * Run it on a schedule.
 *
 * Off outside production unless asked, because in development every sweep is a
 * real embedding bill for rows nobody is going to search.
 */
export function startEmbeddingSweeper() {
  if (timer) return timer;
  const on = process.env.NODE_ENV === "production" || process.env.EMBED_SWEEP === "on";
  if (!on) { console.log("[embeddings] sweeper off (set EMBED_SWEEP=on to enable)"); return null; }

  const runIt = async (reason = "poll") => {
    const start = Date.now();
    let jobsFound = 0, jobsProcessed = 0;
    try {
      const did = await sweepOnce();
      jobsFound = did.reduce((n, d) => n + d.filled + d.failed, 0);
      jobsProcessed = did.reduce((n, d) => n + d.filled, 0);
      if (did.length) console.log("[embeddings] swept:", did.map((d) => `${d.store} +${d.filled}${d.failed ? ` (${d.failed} failed)` : ""}`).join(", "));
    } catch (e) { console.error("[embeddings] sweep error:", e.message); }
    finally {
      // Every pass logs, empty ones included — a sweeper that wakes to find
      // nothing is the optimization signal.
      workerTick("embedding-sweeper", { reason, jobsFound, jobsProcessed, durationMs: Date.now() - start });
    }
  };

  // Ten minutes. Fast enough that a note is searchable within one lesson,
  // slow enough that an idle instance is not paying to ask an empty question.
  timer = setInterval(runIt, 10 * 60 * 1000);
  timer.unref?.();
  setTimeout(() => runIt("boot"), 30_000).unref?.();   // after boot settles
  console.log("[embeddings] sweeper started (every 10m)");
  return timer;
}
