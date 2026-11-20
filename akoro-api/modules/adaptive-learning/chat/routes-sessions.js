import express from "express";
import { jsonbArray, jsonbObject } from "../../../lib/jsonb.js";
import pkg from "pg";
const { Pool } = pkg;
import db from "../../../db.js";
import config from "../../../config/index.js";
import { sessionTitleFrom } from "./turn-store.js";

const router = express.Router();

// The one direct-Postgres pool in the API. Deliberately small: Supavisor (the
// external proxy in front of Supabase Postgres) absorbs traffic spikes, so a
// big pool here only adds idle connections and context-switch overhead on the
// database. max/idle/connect-timeout come from config (DB_POOL_MAX etc.,
// default max 5) — see config/index.js and lib/dbPool.contract.test.mjs,
// which enforces that every runtime pool stays small and bounded.
const pool       = new Pool({
  connectionString:         process.env.DATABASE_URL,
  max:                     config.db.poolMax,
  idleTimeoutMillis:       config.db.poolIdleMs,
  connectionTimeoutMillis: config.db.poolConnectMs,
});
const query      = (text, params) => pool.query(text, params);
/* ─── reconstructHistoryBlocks ──────────────────────────────────────────────
   Rebuilds the typed block array from a completed teaching session.
   Priority: block_history column (exact) → session_phase_progress (derived).
   Returns faded blocks for the decay session overlay.
─────────────────────────────────────────────────────────────────────────────*/
async function reconstructHistoryBlocks(sessionId, topic, subject, agentName, agentEmoji) {
  try {
    // 1. Try exact block history saved during session
    const { data: session } = await db.schema("edu")
      .from("adaptive_sessions")
      .select("block_history, subtopics, objectives, completed_at, updated_at")
      .eq("id", sessionId)
      .single();

    if (!session) return [];

    const completedAt = session.completed_at || session.updated_at;
    const daysSince   = Math.max(0, Math.round(
      (Date.now() - new Date(completedAt).getTime()) / 86_400_000
    ));

    // If we have the exact block history, fade all blocks and return
    if (session.block_history?.length > 0) {
      const faded = session.block_history.map(b => ({ ...b, faded: true }));
      return [
        { type: "system-divider", label: `Previous session · ${daysSince} days ago` },
        ...faded,
      ];
    }

    // 2. Derive blocks from session_phase_progress
    const subtopics  = jsonbArray(session.subtopics);
    const objectives = jsonbObject(session.objectives);

    const { data: progress } = await db.schema("edu")
      .from("session_phase_progress")
      .select("*")
      .eq("session_id", sessionId)
      .order("subtopic_idx");

    const blocks = [
      { type: "system-divider", label: `Previous session · ${daysSince} days ago` },
    ];

    for (const prog of progress || []) {
      // One header per subtopic, carrying its objectives.
      //
      // This used to emit three blocks: the header, a "NaNa plan" strip listing
      // the four phases, and the objectives as a separate checklist. The plan
      // is machinery the learner does not act on, and the checklist was the
      // header's own progress bar written out longhand — same array, same
      // order. The header pages through them now.
      if (prog.phase === "1") {
        blocks.push({
          type: "subtopic-hdr", faded: true,
          subtopic: prog.subtopic, idx: prog.subtopic_idx,
          // The SUBTOPIC list, not this subtopic's objectives.
          //
          // It was the latter, which conflated two different lists: items came
          // from objectives[subtopic] (three entries for one step) while idx and
          // total counted subtopics (one of six). The header paged through three
          // things while claiming to be on step 4 of 6.
          items: subtopics,
          total: subtopics.length, topic, subject,
        });
        blocks.push({
          type: "guide", agent: "NaNa Esumai", emoji: "🧠", faded: true,
          phase: `Phase 1 — ${prog.subtopic}`,
          text:  `Starting ${prog.subtopic}. ${agentName} confidence: ${prog.confidence_start || 20}%.`,
        });
      }

      // Sargeant assessment result at end of each subtopic
      if (prog.phase === "assessment" && prog.assessment_score !== null) {
        const confPct    = Math.round(prog.assessment_score * 100);
        const confEnd    = Math.round(prog.confidence_end   ?? confPct);
        blocks.push({
          type: "student-agent", agent: agentName, emoji: agentEmoji, faded: true,
          phase: `${agentName} · Phase 4 complete · ${confEnd}%`,
          confidence: confEnd,
          text: `I understand ${prog.subtopic} now. My knowledge has solidified.`,
        });
        blocks.push({
          type:         "assess-result", faded: true,
          subtopic:     prog.subtopic,
          agentName,
          confidence:   confPct,
          passed:       prog.passed,
          nextSubtopic: subtopics[prog.subtopic_idx + 1] || null,
        });
      }
    }

    return blocks;
  } catch (e) {
    console.warn("[reconstructHistoryBlocks]", e.message);
    return [];
  }
}

// =============================================================
// STANDARD CHAT
// =============================================================

// ─── Persistent chat sessions ────────────────────────────────────────────────
// Per-user conversations for the Agent Chat tab, browsable + resumable from
// the sessions drawer. All routes are already behind authenticateToken.

// GET /sessions — the user's sessions, newest activity first.
router.get("/sessions", async (req, res) => {
  try {
    // Paged mode (the drawer's scroll-to-fetch-more, 2026-11-17): ?limit /
    // ?cursor switch the response to { sessions, total, nextCursor };
    // legacy callers keep the bare list capped at 100. Cursor = the last
    // row's (last_message_at, id); nulls sort last in paged mode, and a
    // null-timestamp tail row ends paging (empty sessions sit last).
    const paged = req.query.limit !== undefined || req.query.cursor !== undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    let cursor = null;
    if (req.query.cursor) {
      try { cursor = JSON.parse(Buffer.from(String(req.query.cursor), "base64url").toString("utf8")); } catch { cursor = null; }
    }
    let query = db
      .from("chat_sessions")
      .select("id, title, created_at, updated_at, last_message_at")
      .eq("user_id", req.user.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
    if (cursor?.t) {
      query = query.or(`last_message_at.lt.${cursor.t},and(last_message_at.eq.${cursor.t},id.lt.${cursor.id})`);
    }
    const { data, error } = await query.limit(paged ? limit : 100);
    if (error) throw new Error(error.message);
    const sessions = data ?? [];
    if (!paged) return res.json({ success: true, sessions });
    const { count } = await db
      .from("chat_sessions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.user.id);
    const last = sessions[sessions.length - 1];
    return res.json({
      success: true,
      sessions,
      total: count ?? sessions.length,
      nextCursor: sessions.length === limit && last?.last_message_at
        ? Buffer.from(JSON.stringify({ t: last.last_message_at, id: last.id }), "utf8").toString("base64url")
        : null,
    });
  } catch (err) {
    console.error("[/chat/sessions GET]", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /sessions — create a new (empty) session.
router.post("/sessions", async (req, res) => {
  try {
    const title = sessionTitleFrom(req.body?.title);
    const { data, error } = await db
      .from("chat_sessions")
      .insert({ user_id: req.user.id, title })
      .select("id, title, created_at, updated_at, last_message_at")
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, session: data });
  } catch (err) {
    console.error("[/chat/sessions POST]", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /sessions/:id/messages — messages for one owned session, oldest first.
// Without `limit`: the whole transcript (copy, other apps). With `limit`
// (1-100): only the newest `limit` messages — older than `before` (an ISO
// time, the oldest one already loaded) when given — plus `hasMore`, so the
// chat loads its history a page at a time as the learner scrolls up.
export function historyPage(query = {}) {
  const raw = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(100, raw)) : null;
  const before = limit && query.before && !Number.isNaN(Date.parse(query.before)) ? new Date(query.before).toISOString() : null;
  return { limit, before };
}

router.get("/sessions/:id/messages", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const { data: session } = await db
      .from("chat_sessions").select("id")
      .eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
    if (!session) return res.status(404).json({ error: "Session not found" });

    const { limit, before } = historyPage(req.query);
    const loadMessages = (columns) => {
      let q = db.from("chat_messages").select(columns).eq("session_id", req.params.id);
      if (!limit) return q.order("created_at", { ascending: true });
      if (before) q = q.lt("created_at", before);
      // Newest first to take the page (one extra says whether more exist).
      return q.order("created_at", { ascending: false }).limit(limit + 1);
    };
    // The reply trace column may not exist yet during a rolling deploy —
    // fall back to the plain transcript rather than failing the history load.
    let { data, error } = await loadMessages("id, role, text, created_at, trace, meta");
    // Rolling-deploy fallbacks: an older build may pre-date the meta column,
    // and either column may pre-date trace.
    if (error && /meta/i.test(String(error.message || ""))) ({ data, error } = await loadMessages("id, role, text, created_at, trace"));
    if (error && /trace/i.test(String(error.message || ""))) ({ data, error } = await loadMessages("id, role, text, created_at"));
    if (error) throw new Error(error.message);
    if (!limit) return res.json({ success: true, messages: data ?? [] });
    const rows = data ?? [];
    res.json({ success: true, messages: rows.slice(0, limit).reverse(), hasMore: rows.length > limit });
  } catch (err) {
    console.error("[/chat/sessions messages GET]", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /sessions/:id/messages — append a message and bump session activity.
router.post("/sessions/:id/messages", async (req, res) => {
  try {
    const { role, text } = req.body || {};
    if (role !== "user" && role !== "agent") return res.status(400).json({ error: "role must be user or agent" });
    if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required" });

    const { data: session } = await db
      .from("chat_sessions").select("id, title")
      .eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
    if (!session) return res.status(404).json({ error: "Session not found" });

    const { data: message, error } = await db
      .from("chat_messages")
      .insert({ session_id: session.id, user_id: req.user.id, role, text: String(text) })
      .select("id, role, text, created_at")
      .single();
    if (error) throw new Error(error.message);

    // Auto-title from the first user message; always bump activity.
    const patch = { last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (role === "user" && (!session.title || session.title === "New chat")) {
      patch.title = sessionTitleFrom(text);
    }
    await db.from("chat_sessions").update(patch).eq("id", session.id);

    res.status(201).json({ success: true, message, title: patch.title });
  } catch (err) {
    console.error("[/chat/sessions messages POST]", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /sessions/:id — rename a session.
router.patch("/sessions/:id", async (req, res) => {
  try {
    const title = sessionTitleFrom(req.body?.title);
    const { data, error } = await db
      .from("chat_sessions")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", req.params.id).eq("user_id", req.user.id)
      .select("id, title").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: "Session not found" });
    res.json({ success: true, session: data });
  } catch (err) {
    console.error("[/chat/sessions PATCH]", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sessions/:id — remove a session and its messages (cascade).
router.delete("/sessions/:id", async (req, res) => {
  try {
    const { data, error } = await db
      .from("chat_sessions")
      .delete()
      .eq("id", req.params.id).eq("user_id", req.user.id)
      .select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: "Session not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[/chat/sessions DELETE]", err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// HISTORY
// =============================================================

router.get("/history/:ownerId", async (req, res) => {
  try {
    const ownerId = req.user.id;   // token-scoped — ignore any :ownerId in the URL
    const { limit = 50, offset = 0, mode } = req.query;
    const params = mode ? [ownerId, mode, Number(limit), Number(offset)] : [ownerId, Number(limit), Number(offset)];
    const sql = mode
      ? `SELECT id, user_message, assistant_response, metadata, mode, created_at FROM chat_history WHERE agent_id=$1 AND mode=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`
      : `SELECT id, user_message, assistant_response, metadata, mode, created_at FROM chat_history WHERE agent_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
    const result = await query(sql, params);
    res.json({ success: true, history: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================
// DB MIGRATION
// =============================================================
async function runMigration() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID,
        user_message TEXT NOT NULL,
        assistant_response TEXT NOT NULL,
        metadata JSONB,
        mode TEXT DEFAULT 'standard',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_agent ON chat_history(agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_mode  ON chat_history(mode);
    `);
    console.log("✅ chat_history table ready");
  } catch (err) { console.error("[Chat] Migration error:", err.message); }
}
runMigration();

export default router;
