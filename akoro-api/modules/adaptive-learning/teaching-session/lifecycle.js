/**
 * teaching-session/lifecycle.js — the durable session-row lifecycle for
 * adaptive-learning teaching sessions (fresh, continuation, decay).
 *
 * Extracted from the WebSocket shell (2026-10-03) into the study-prep
 * service pattern: the socket layer emits and holds live orchestrators,
 * THIS module owns every edu.adaptive_sessions write — create, per-turn
 * append, ensure-on-disconnect, complete-on-end. The DB row id is stashed
 * on the orchestrator as `dbSessionId`.
 */
import db from "../../../db.js";
import { serialiseTeachingEvidence } from "../teaching-evidence.js";

// Rolling deploys can briefly run this code against a database that has not
// received the compact-evidence migration yet. Retry without the optional
// column so normal teaching/session persistence remains available; never fall
// back to storing transcript text as evidence.
export function isMissingColumn(error, column) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42703" || error?.code === "PGRST204" ||
    (message.includes(column.toLowerCase()) && /column|schema cache|could not find/i.test(message));
}

export async function createSessionRecord(orchestrator, { studentId, topic, subject, openingBlocks }) {
  if (orchestrator?.dbSessionId) return orchestrator.dbSessionId;   // already saved
  const row = {
    student_id:             studentId,
    student_agent_id:       orchestrator.studentAgentRecord?.id || null,
    // topic + subject are NOT NULL — never let a missing value silently drop
    // the whole session row (which is what kept sessions off the list).
    topic:                  topic || "Untitled session",
    subject:                subject || "General",
    // These columns are JSONB — send real arrays/objects. Sending
    // JSON.stringify(...) stored a JSON *string* scalar ("[]") instead of an
    // array, which then read back wrong downstream.
    subtopics:              Array.isArray(orchestrator.session?.mustKnowParts) ? orchestrator.session.mustKnowParts : [],
    objectives:             {},
    current_subtopic_idx:   0,
    current_phase:          "1",
    status:                 "active",
    started_at:             new Date().toISOString(),
    updated_at:             new Date().toISOString(),
    session_history:        [],
    objectives_covered:     {},
    confidence_by_subtopic: {},
    // Compact scores/categories only. The conversation itself remains in the
    // existing transcript column, never duplicated as assessment evidence.
    teaching_evidence:      serialiseTeachingEvidence(orchestrator?.teachingEvidence) || {},
    block_history:          Array.isArray(openingBlocks) ? openingBlocks : [],
  };

  try {
    let insertRow = row;
    let { data, error } = await db.schema("edu").from("adaptive_sessions")
      .insert(insertRow).select("id").single();

    // The new field is intentionally optional during a rolling migration.
    if (error && isMissingColumn(error, "teaching_evidence")) {
      console.warn("[adaptive_sessions create] teaching_evidence migration pending; saving without it");
      const { teaching_evidence: _evidence, ...legacyRow } = row;
      insertRow = legacyRow;
      ({ data, error } = await db.schema("edu").from("adaptive_sessions")
        .insert(insertRow).select("id").single());
    }

    // The session row is what makes a session visible in the Sessions tab, so
    // never let one optional column take the whole row down with it.
    // student_agent_id is a decoration; student_id/topic/subject are the row.
    // (Its FK pointed at public.user_agents while we write edu.student_agents
    // ids — that silently killed EVERY insert.)
    if (error && insertRow.student_agent_id) {
      console.warn("[adaptive_sessions create] retrying without student_agent_id:", error.message);
      ({ data, error } = await db.schema("edu").from("adaptive_sessions")
        .insert({ ...insertRow, student_agent_id: null }).select("id").single());
    }
    if (error) throw error;
    orchestrator.dbSessionId = data.id;
    // Remember the identity so a later fallback save (cancel/disconnect before
    // the row existed) can still persist the session.
    orchestrator.sessionMeta = { studentId, topic, subject };
    return data.id;
  } catch (e) {
    // Loud: a failure here is why a session would never appear in the list.
    console.error("[adaptive_sessions create] FAILED — session will not be listed:",
      e.code || "", e.message, e.details || "");
    orchestrator.saveError = { message: e.message, code: e.code || null };
    return null;
  }
}

// Ensure a DB row exists for this orchestrator — used by the cancel/disconnect
// path so a session started but never "completed" is still saved.
export async function ensureSessionRecord(orchestrator) {
  if (orchestrator?.dbSessionId) return orchestrator.dbSessionId;
  const meta = orchestrator?.sessionMeta;
  if (!meta?.studentId) return null;
  return createSessionRecord(orchestrator, { ...meta, openingBlocks: [] });
}

export async function appendSessionBlocks(orchestrator, newBlocks) {
  const id = orchestrator?.dbSessionId || await ensureSessionRecord(orchestrator);
  if (!id || !newBlocks?.length) return;
  try {
    const { data } = await db.schema("edu").from("adaptive_sessions")
      .select("block_history").eq("id", id).single();
    const existing = Array.isArray(data?.block_history) ? data.block_history : [];

    // WHERE THEY GOT TO, not just what was said.
    //
    // current_phase and current_subtopic_idx were written once at creation as
    // "1" and 0 and never touched again, so the stored row always claimed the
    // learner was on the first phase of the first subtopic no matter how far
    // they had come. Continuing a session read that back and restarted them at
    // the beginning — the transcript was there, the progress was not.
    //
    // subtopics is refreshed too: the ladder is resolved after the row is
    // created, so the row was written with whatever was known at insert time,
    // which for a resolved-later ladder is an empty array.
    const sess = orchestrator?.session ?? {};
    const update = {
      block_history:        [...existing, ...newBlocks],
      current_phase:        String(sess.phase ?? "1").replace(/^PHASE_/, ""),
      current_subtopic_idx: Number.isInteger(sess.mustKnowIndex) ? sess.mustKnowIndex : 0,
      ...(Array.isArray(sess.mustKnowParts) && sess.mustKnowParts.length
        ? { subtopics: sess.mustKnowParts }
        : {}),
      teaching_evidence: serialiseTeachingEvidence(orchestrator?.teachingEvidence) || {},
      updated_at:           new Date().toISOString(),
    };
    let { error } = await db.schema("edu").from("adaptive_sessions").update(update).eq("id", id);
    if (error && isMissingColumn(error, "teaching_evidence")) {
      const { teaching_evidence: _evidence, ...legacyUpdate } = update;
      ({ error } = await db.schema("edu").from("adaptive_sessions").update(legacyUpdate).eq("id", id));
    }
    if (error) throw error;
  } catch (e) {
    console.warn("[adaptive_sessions append]", e.message);
  }
}

export async function completeSessionRecord(orchestrator) {
  const id = orchestrator?.dbSessionId;
  if (!id) return;
  try {
    // Read prior status + student so ranking XP is awarded exactly once.
    const { data: prior } = await db.schema("edu").from("adaptive_sessions")
      .select("status, student_id, subject").eq("id", id).maybeSingle();

    const completion = {
      status:       "complete",
      completed_at: new Date().toISOString(),
      teaching_evidence: serialiseTeachingEvidence(orchestrator?.teachingEvidence) || {},
      updated_at:   new Date().toISOString(),
    };
    let { error } = await db.schema("edu").from("adaptive_sessions").update(completion).eq("id", id);
    if (error && isMissingColumn(error, "teaching_evidence")) {
      const { teaching_evidence: _evidence, ...legacyCompletion } = completion;
      ({ error } = await db.schema("edu").from("adaptive_sessions").update(legacyCompletion).eq("id", id));
    }
    if (error) throw error;

    if (prior && prior.status !== "complete" && prior.student_id) {
      try {
        const { awardXP, XP } = await import("../../ranking/routes.js");
        awardXP({ userId: prior.student_id, reason: "teaching_session", amount: XP.SESSION_ATTEND, subject: prior.subject || null }).catch(() => {});
      } catch { /* ranking module unavailable — non-fatal */ }
    }
  } catch (e) {
    console.warn("[adaptive_sessions complete]", e.message);
  }
}
