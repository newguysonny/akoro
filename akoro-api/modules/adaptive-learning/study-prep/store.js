/**
 * study-prep store — the Supabase-backed implementation of the harness's
 * persistence seam. The harness is the sole writer; this module only knows
 * HOW to write (conditional updates, atomic sequence allocation), never WHEN
 * or WHY. Imports db.js — NOT importable from tests; the in-memory double
 * lives in the contract test.
 */

import db from "../../../db.js";
import { debitCoins, refundCoins } from "../../../lib/coins.js";
import { InsufficientBalanceError } from "./harness.js";

const ACTIVE_STATES = ["planning", "awaiting_confirmation", "topic_active", "replanning", "paused"];

export const supabaseStore = {
  async findActiveSession(learnerId) {
    const { data, error } = await db.schema("edu").from("study_prep_sessions")
      .select("id").eq("learner_id", learnerId).in("status", ACTIVE_STATES).maybeSingle();
    if (error) throw error;
    return data;
  },

  /** List-shaped variant for the chat read tool (bounded). */
  async findActiveSessionsList(learnerId) {
    return db.schema("edu").from("study_prep_sessions")
      .select("id, status, updated_at").eq("learner_id", learnerId).in("status", ACTIVE_STATES)
      .order("updated_at", { ascending: false }).limit(3);
  },

  async createSession(row) {
    const { data, error } = await db.schema("edu").from("study_prep_sessions").insert(row).select("*").single();
    if (error) throw error;
    return data;
  },

  async getSession(sessionId) {
    const { data, error } = await db.schema("edu").from("study_prep_sessions")
      .select("*").eq("id", sessionId).maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Conditional update — the winner is the writer whose expected status still holds. */
  async updateSessionConditional(sessionId, expectedStatus, patch) {
    const { data, error } = await db.schema("edu").from("study_prep_sessions")
      .update(patch).eq("id", sessionId).eq("status", expectedStatus).select("*").maybeSingle();
    if (error) throw error;
    return data;
  },

  async getTopics(sessionId) {
    const { data, error } = await db.schema("edu").from("study_prep_topics")
      .select("*").eq("session_id", sessionId).order("position", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async createTopics(sessionId, plan) {
    const rows = (plan || []).map((topic, index) => ({
      session_id: sessionId, syllabus_topic_id: String(topic.syllabusTopicId).slice(0, 120),
      position: topic.position ?? index + 1, label: String(topic.label).slice(0, 180), status: "queued",
    }));
    if (!rows.length) return [];
    const { data, error } = await db.schema("edu").from("study_prep_topics").insert(rows).select("*");
    if (error) throw error;
    // The first queued topic becomes active — conditional, so a racing
    // duplicate confirm cannot double-activate.
    if (data[0]) {
      await db.schema("edu").from("study_prep_topics")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("id", data[0].id).eq("status", "queued");
    }
    const topics = await this.getTopics(sessionId);
    return topics;
  },

  async getTopicById(topicId) {
    const { data, error } = await db.schema("edu").from("study_prep_topics").select("*").eq("id", topicId).maybeSingle();
    if (error) throw error;
    return data || null;
  },

  /** Score an Agent Check once: only the topic's CURRENT check, only if unscored. → row or null. */
  async claimCheckScore(topicId, battleId, result, at) {
    const { data, error } = await db.schema("edu").from("study_prep_topics")
      .update({ check_scored_at: at, check_result: result, updated_at: at })
      .eq("id", topicId).eq("check_battle_id", battleId).is("check_scored_at", null)
      .select("*").maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async updateTopicConditional(topicId, expectedStatus, patch) {
    const { data, error } = await db.schema("edu").from("study_prep_topics")
      .update(patch).eq("id", topicId).eq("status", expectedStatus).select("*").maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * Append events with atomic sequence allocation: read max(sequence), write
   * max+1; on a unique violation (a concurrent append won the same slot)
   * retry once with a fresh max. The UNIQUE (session_id, sequence) constraint
   * is the referee.
   */
  async appendEvents(sessionId, rows) {
    const written = [];
    for (const row of rows) {
      let placed = null;
      for (let attempt = 0; attempt < 3 && !placed; attempt += 1) {
        const { data: last, error: lastError } = await db.schema("edu").from("study_prep_events")
          .select("sequence").eq("session_id", sessionId).order("sequence", { ascending: false }).limit(1).maybeSingle();
        if (lastError) throw lastError;
        const next = Number(last?.sequence ?? -1) + 1;
        const { data, error } = await db.schema("edu").from("study_prep_events")
          .insert({ ...row, session_id: sessionId, sequence: next }).select("*").single();
        if (error) {
          if (/duplicate key|unique constraint/i.test(error.message || "")) continue; // lost the slot — retry
          throw error;
        }
        placed = data;
      }
      if (!placed) throw new Error("Could not allocate an event sequence — retrying append");
      written.push(placed);
    }
    return written;
  },

  /** The NEWEST `limit` events, in order. (It used to return the oldest, so "recent activity" showed the session's start.) */
  async listEvents(sessionId, { limit = 200 } = {}) {
    const { data, error } = await db.schema("edu").from("study_prep_events")
      .select("*").eq("session_id", sessionId).order("sequence", { ascending: false })
      .limit(Math.max(1, Math.min(Number(limit) || 200, 500)));
    if (error) throw error;
    return (data || []).reverse();
  },

  /**
   * What the session has charged the learner, net of refunds: every charge
   * carrying its ref (its Agent Checks and the agent's wakes).
   */
  async sessionCoinsSpent(sessionId) {
    const { data, error } = await db.from("coin_transactions").select("delta").eq("ref", `study_prep:${sessionId}`).limit(2000);
    if (error) throw error;
    return Math.max(0, -(data || []).reduce((sum, row) => sum + Number(row.delta || 0), 0));
  },

  /** Wallet-first charge (§4.11). Maps lib/coins InsufficientCoins onto the harness error. */
  async chargeCoins({ learnerId, coins, feature, ref }) {
    try {
      return await debitCoins({ userId: learnerId, coins, feature, ref });
    } catch (error) {
      if (error?.name === "InsufficientCoins") {
        throw new InsufficientBalanceError(coins, error?.balance ?? 0);
      }
      throw error;
    }
  },

  async refundCoins({ charge, feature, ref }) {
    if (!charge?.applied?.length) return 0;
    const failed = await refundCoins({ applied: charge.applied, feature, ref });
    return failed;
  },

  /**
   * Mastery write-back (§4.5): best-effort evidence row when an approved
   * concept matches this subject+topic; skipped (never invented) otherwise.
   */
  async recordMasteryEvidence({ learnerId, sessionRef, topicLabel, subject, passed, score, mastery, source = "study_prep" }) {
    // Through the ONE recorder (Phase 4a, learning-events.js). Same row as
    // before: an approved concept for subject + topic or nothing, and
    // "not_checked" — the ledger keeps it, the learner state doesn't move.
    const { recordLearningEvent } = await import("../learning-events.js");
    const turnRef = source === "agent_recall" ? `${sessionRef}:check` : `${sessionRef}:attempt`;
    const pct = Math.round((Number(score) || 0) * 100);
    const r = await recordLearningEvent({
      learnerId, subject, topic: topicLabel, kind: passed ? "assessment_result" : "partial_understanding",
      source: source === "proctored_assessment" ? "proctored" : source === "agent_recall" ? "agent_recall" : "study_prep",
      sessionRef, turnRef, quality: Number(score) || 0, checked: false,
      summary: source === "agent_recall"
        ? `Study-prep Agent Check: the learner's agent answered ${pct}% from their notes (mastery → ${mastery?.next ?? "n/a"})`
        : source === "proctored_assessment"
          ? `Proctored assessment ${passed ? "passed" : "attempt"}: score ${pct}% (mastery → ${mastery?.next ?? "n/a"})`
          : `Study-prep ${passed ? "passed" : "attempt"}: score ${pct}% (mastery → ${mastery?.next ?? "n/a"})`,
      details: { mastery },
    });
    // The matched concept, even if the write itself failed (callers key on the match).
    return r.conceptId || null;
  },
};
