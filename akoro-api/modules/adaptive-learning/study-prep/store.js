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
  async recordMasteryEvidence({ learnerId, sessionRef, topicLabel, subject, passed, score, mastery }) {
    try {
      const slug = String(topicLabel || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      // Two plain filters, not an or() string: a label with a comma or
      // parenthesis ("Forces, Motion and Energy") broke the or() syntax and
      // the evidence was silently dropped.
      const approved = () => db.schema("edu").from("concept_catalog")
        .select("id").eq("status", "approved").ilike("subject", `%${String(subject || "").trim()}%`);
      let { data: concepts, error } = await approved().ilike("topic_key", `%${slug}%`).limit(1);
      if (!error && !concepts?.length) ({ data: concepts, error } = await approved().ilike("title", `%${String(topicLabel || "").trim()}%`).limit(1));
      if (error || !concepts?.length) return null;
      const turnRef = `${sessionRef}:attempt`;
      const { error: evidenceError } = await db.schema("edu").from("learner_concept_evidence").upsert({
        learner_id: learnerId, concept_id: concepts[0].id,
        source_session_id: sessionRef.slice(0, 180), source_turn_id: turnRef.slice(0, 180),
        observation_kind: passed ? "assessment_result" : "partial_understanding",
        response_quality: Number(score) || 0, claim_validity: 1, model_confidence: 1,
        claim_status: "not_checked",
        evidence_summary: `Study-prep ${passed ? "passed" : "attempt"}: score ${Math.round((Number(score) || 0) * 100)}% (mastery → ${mastery?.next ?? "n/a"})`.slice(0, 1200),
        provenance: { source: "study_prep", mastery },
      }, { onConflict: "learner_id,source_session_id,source_turn_id,concept_id" });
      if (evidenceError) console.error("[study-prep-store/mastery-evidence]", evidenceError.message);
      return concepts[0].id;
    } catch (error) {
      console.error("[study-prep-store/mastery-evidence]", error?.message || error);
      return null;
    }
  },
};
