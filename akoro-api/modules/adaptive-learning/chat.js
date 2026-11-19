// =============================================================
// chat.js  v3.1
// HTTP routes — all session types.
// The legacy knowledge-health (decay) routes live in decay-review/routes.js and
// the student-agent routes in agents/student/routes.js; both are mounted below.
// =============================================================

import express from "express";
import { isDryRun, runDry, runInspected, isInspected } from "../../lib/dryRunContext.js";
import { jsonbArray, jsonbObject } from "../../lib/jsonb.js";
import { authenticateToken } from "../auth/routes.js";
import pkg from "pg";
import { openai } from "../../lib/aiModel.js";
import { shapeSuggestions, buildLearnSuggestionMessages, LEARN_LIMITS, buildCitedLearnSuggestionMessages, citedLearnSchema, shapeCitedLearnSuggestions } from "./chat/chatSuggestions.js";
import { resolveAskTargetFor } from "../records/access.js";
import {
  learnerInsightsEnabled, learnerSoulStateEnabled, conceptTrackerEnabled,
  examPrepConfidenceEnabled, studyPrepEnabled, durableAgentChatContextEnabled,
  warnedUnsavedTurn, CHAT_SESSION_ID, CHAT_TURN_ID, agentSessionId,
  activeTurnStops, turnStopKey, stickyAreasFor,
  activeSessionTurns, decisionContinuations,
} from "./chat/runtime-state.js";
import { protegeDeps } from "./chat/handlers-social.js";
import { gatherPassages, extractCitations } from "../records/askLib.js";
import { getExtraction } from "../records/extractLib.js";
import { publicModelList, pickerInfo, pickerEnabled } from "../../lib/modelCatalogue.js";
import { allowedModelsFor } from "../../lib/modelTiers.js";
const { Pool } = pkg;
import db from "../../db.js";
import config from "../../config/index.js";
import { decayRoutes } from "./decay-review/routes.js";
import studentAgentRoutes from "./agents/student/routes.js";
import { activeSessions } from "./websocket.js";
import {
  getLearnerAutonomy,
  setLearnerAutonomy,
} from "./learner/learner-autonomy.js";
import { prepareTurn, modelPicks, supabaseThreads, tutorSystemPrompt, assembleChatDoctrine } from "./chat/turn-prepare.js";
import { answerTurn, setDecisionContinuationScheduler } from "./chat/turn-answer.js";
import { reportAgentActivity } from "../../lib/agentActivity.js";
import { sessionTitleFrom, safeHistory, saveReplyIdeas, suggestionsFor } from "./chat/turn-store.js";
import { runAgentToolLoop, CHAT_TOOL_LOOP_MAX_ITERATIONS } from "./chat/agent-loop.js";
export { runAgentToolLoop, CHAT_TOOL_LOOP_MAX_ITERATIONS, safeHistory, saveReplyIdeas, suggestionsFor };
export { protegeDeps };
export {
  CHAT_TOOLS, getLearnerChatTools, INSTRUCTOR_TOOLS, openAiInstructorTools,
  SIDE_EFFECT_TOOLS, isSideEffectingAction, isSideEffecting,
  PARALLEL_CALL_BARRIERS, PARALLEL_READ_BATCH, DECIDED_CONFIRM_STATUSES,
  PARALLEL_READS_NOTE, STEP_NARRATION_NOTE, selfToolDeps, chatToolBasis,
  executeChatTool, clarify, shouldPlanFirst,
} from "./chat/tool-runtime.js";

const router     = express.Router();
// Agent console (modules/agentConsole): a turn sent with the console's key in
// x-agent-console-dry runs in DRY mode — tools that change data are simulated.
// x-agent-console-inspect (same key) adds each tool call's arguments and a
// truncated result to toolExecutions — the verification gate asserts on them.
router.use((req, res, next) => {
  const key = process.env.AGENT_CONSOLE_KEY;
  if (!key) return next();
  const dry = safeCompare(req.get("x-agent-console-dry"), key);
  const inspect = safeCompare(req.get("x-agent-console-inspect"), key);
  let go = next;
  if (inspect) { const inner = go; go = () => runInspected(inner); }
  if (dry) { const inner = go; go = () => runDry(inner); }
  return go();
});
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
// LEARNER AGENT AUTONOMY — persistent opt-in, never UI-authorized
// =============================================================

router.get("/autonomy", async (req, res) => {
  try {
    res.json({ success: true, ...(await getLearnerAutonomy(req.user.id)) });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load agent autonomy" });
  }
});

router.patch("/autonomy", async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") {
    return res.status(422).json({ error: "enabled must be a boolean" });
  }
  try {
    const result = await setLearnerAutonomy({
      userId: req.user.id, enabled: req.body.enabled,
      level: typeof req.body.level === "number" ? req.body.level : undefined,
    });
    // Phase 21: switching the agent Online lets it handle messages that waited.
    if (req.body.enabled) import("../agent-network/autoReply.js").then((m) => m.wakeInbox(req.user.id, "switched_on")).catch(() => {});
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not save agent autonomy" });
  }
});

// =============================================================
// QUALITATIVE CONCEPT TRACKER — curriculum-derived learner projection
// =============================================================

router.get("/concept-tracker", async (req, res) => {
  if (!conceptTrackerEnabled) return res.json({ success: true, enabled: false, concepts: [], resumePoints: [] });
  try {
    const [trackerResult, resumeResult, notesResult] = await Promise.all([
      db.schema("edu").from("learner_concept_tracker")
        .select("concept_id, learning_status, resume_point, last_observation_kind, updated_at, concept_catalog(title, code, subject, topic_key)")
        .eq("learner_id", req.user.id).order("updated_at", { ascending: false }).limit(24),
      db.schema("edu").from("learner_topic_resume_points")
        .select("curriculum_key, subject, topic_key, resume_point, concept_id, updated_at")
        .eq("learner_id", req.user.id).order("updated_at", { ascending: false }).limit(12),
      db.schema("edu").from("learner_concept_confusion_notes")
        .select("concept_id, note, created_at").eq("learner_id", req.user.id)
        .order("created_at", { ascending: false }).limit(24),
    ]);
    if (trackerResult.error || resumeResult.error || notesResult.error) throw trackerResult.error || resumeResult.error || notesResult.error;
    const notesByConcept = new Map();
    for (const note of notesResult.data || []) {
      const entries = notesByConcept.get(note.concept_id) || [];
      if (entries.length < 3) entries.push({ note: String(note.note || "").slice(0, 420), createdAt: note.created_at });
      notesByConcept.set(note.concept_id, entries);
    }
    return res.json({
      success: true, enabled: true,
      concepts: (trackerResult.data || []).map((item) => ({
        conceptId: item.concept_id, status: item.learning_status, resumePoint: item.resume_point,
        lastObservationKind: item.last_observation_kind, updatedAt: item.updated_at,
        concept: item.concept_catalog ? { title: item.concept_catalog.title, code: item.concept_catalog.code, subject: item.concept_catalog.subject, topicKey: item.concept_catalog.topic_key } : null,
        confusionNotes: notesByConcept.get(item.concept_id) || [],
      })),
      resumePoints: (resumeResult.data || []).map((item) => ({
        curriculumKey: item.curriculum_key, subject: item.subject, topicKey: item.topic_key,
        resumePoint: item.resume_point, conceptId: item.concept_id, updatedAt: item.updated_at,
      })),
    });
  } catch {
    return res.status(503).json({ success: false, error: "Concept tracker is unavailable" });
  }
});

router.delete("/concept-tracker/confusion-notes", async (req, res) => {
  if (!conceptTrackerEnabled) return res.status(409).json({ success: false, error: "Concept tracker is not enabled" });
  try {
    const { error } = await db.schema("edu").from("learner_concept_confusion_notes").delete().eq("learner_id", req.user.id);
    if (error) throw error;
    return res.json({ success: true, cleared: "confusion_notes" });
  } catch {
    return res.status(503).json({ success: false, error: "Concept tracker notes could not be cleared" });
  }
});

// =============================================================
// LEARNER-OWNED MEASURED STUDY INSIGHTS — profile + compact episodes
// =============================================================

router.get("/learning-insights", async (req, res) => {
  if (!learnerInsightsEnabled) return res.json({ success: true, enabled: false, profile: null, episodes: [] });
  try {
    const [profileResult, episodesResult] = await Promise.all([
      db.schema("edu").from("learner_teaching_profiles")
        .select("evidence_count, profile_confidence, mean_attention, mean_fatigue, mean_reasoning_quality, reasoning_style, pacing_recommendation, policy_version, expires_at")
        .eq("learner_id", req.user.id).maybeSingle(),
      db.schema("edu").from("learner_learning_episodes")
        .select("concept_id, kind, summary, occurred_at")
        .eq("learner_id", req.user.id).order("occurred_at", { ascending: false }).limit(12),
    ]);
    if (profileResult.error || episodesResult.error) throw profileResult.error || episodesResult.error;
    const profile = profileResult.data ? {
      evidenceCount: Number(profileResult.data.evidence_count || 0),
      profileConfidence: Number(profileResult.data.profile_confidence || 0),
      meanAttention: Number(profileResult.data.mean_attention || 0),
      meanFatigue: Number(profileResult.data.mean_fatigue || 0),
      meanReasoningQuality: Number(profileResult.data.mean_reasoning_quality || 0),
      reasoningStyle: profileResult.data.reasoning_style,
      pacingRecommendation: profileResult.data.pacing_recommendation,
      policyVersion: profileResult.data.policy_version,
      expiresAt: profileResult.data.expires_at,
    } : null;
    const episodes = (episodesResult.data || []).map((episode) => ({
      conceptId: episode.concept_id, kind: episode.kind,
      summary: String(episode.summary || "").slice(0, 420), occurredAt: episode.occurred_at,
    }));
    return res.json({ success: true, enabled: true, profile, episodes });
  } catch (error) {
    return res.status(503).json({ success: false, error: "Learning insights are unavailable" });
  }
});

router.delete("/learning-insights", async (req, res) => {
  if (!learnerInsightsEnabled) return res.status(409).json({ success: false, error: "Learning insights are not enabled" });
  const scope = String(req.body?.scope || "all").toLowerCase();
  if (!["all", "profile", "episodes"].includes(scope)) {
    return res.status(422).json({ success: false, error: "scope must be all, profile, or episodes" });
  }
  try {
    const removals = [];
    // Profile reset includes source measurements; otherwise a later turn would
    // immediately recreate the same profile from retained measurements.
    if (scope === "all" || scope === "profile") {
      removals.push(db.schema("edu").from("learner_turn_measurements").delete().eq("learner_id", req.user.id));
      removals.push(db.schema("edu").from("learner_teaching_profiles").delete().eq("learner_id", req.user.id));
    }
    if (scope === "all" || scope === "episodes") {
      removals.push(db.schema("edu").from("learner_learning_episodes").delete().eq("learner_id", req.user.id));
    }
    const outcomes = await Promise.all(removals);
    if (outcomes.some(({ error }) => error)) throw new Error("clear failed");
    return res.json({ success: true, cleared: scope });
  } catch (error) {
    return res.status(503).json({ success: false, error: "Learning insights could not be cleared" });
  }
});

// =============================================================
// LEARNER-SELECTED SOUL-STATE CONTROLS — no inferred emotion or identity
// =============================================================

const SOUL_VALUES = {
  interactionStyle: new Set(["balanced", "collaborative", "independent", "socratic"]),
  responseTone: new Set(["calm", "curious", "direct", "celebratory"]),
  challengeLevel: new Set(["gentle", "adaptive", "stretch"]),
  encouragementLevel: new Set(["minimal", "balanced", "frequent"]),
  feeling: new Set(["steady", "energised", "tired", "stuck", "celebrating"]),
  studyContext: new Set(["unknown", "quiet", "distracted", "rushed"]),
  studyIntent: new Set(["explore", "practise", "prepare", "recover"]),
  requestedSupport: new Set(["none", "slower_steps", "more_examples", "challenge_me", "celebrate_progress"]),
};
const safeSoulValue = (value, field) => {
  const selected = String(value || "").trim().toLowerCase();
  return SOUL_VALUES[field]?.has(selected) ? selected : null;
};

router.get("/soul-state", async (req, res) => {
  if (!learnerSoulStateEnabled) return res.json({ success: true, enabled: false, preferences: null, checkIns: [] });
  try {
    const [preferenceResult, checkinsResult] = await Promise.all([
      db.schema("edu").from("learner_soul_preferences")
        .select("interaction_style, response_tone, challenge_level, encouragement_level, policy_version")
        .eq("learner_id", req.user.id).maybeSingle(),
      db.schema("edu").from("learner_soul_checkins")
        .select("source_session_id, feeling, study_context, study_intent, requested_support, expires_at")
        .eq("learner_id", req.user.id).gt("expires_at", new Date().toISOString())
        .order("checked_in_at", { ascending: false }).limit(4),
    ]);
    if (preferenceResult.error || checkinsResult.error) throw preferenceResult.error || checkinsResult.error;
    const preferences = preferenceResult.data ? {
      interactionStyle: preferenceResult.data.interaction_style, responseTone: preferenceResult.data.response_tone,
      challengeLevel: preferenceResult.data.challenge_level, encouragementLevel: preferenceResult.data.encouragement_level,
      policyVersion: preferenceResult.data.policy_version,
    } : null;
    const checkIns = (checkinsResult.data || []).map((item) => ({
      sessionId: item.source_session_id, feeling: item.feeling, studyContext: item.study_context,
      studyIntent: item.study_intent, requestedSupport: item.requested_support, expiresAt: item.expires_at,
    }));
    return res.json({ success: true, enabled: true, preferences, checkIns });
  } catch {
    return res.status(503).json({ success: false, error: "Soul-state controls are unavailable" });
  }
});

router.put("/soul-state/preferences", async (req, res) => {
  if (!learnerSoulStateEnabled) return res.status(409).json({ success: false, error: "Soul-state controls are not enabled" });
  const values = Object.fromEntries(Object.keys(SOUL_VALUES).slice(0, 4).map((key) => [key, safeSoulValue(req.body?.[key], key)]));
  if (Object.values(values).some((value) => !value)) return res.status(422).json({ success: false, error: "All preference values must be recognised options" });
  try {
    const { error } = await db.schema("edu").from("learner_soul_preferences").upsert({
      learner_id: req.user.id,
      interaction_style: values.interactionStyle, response_tone: values.responseTone,
      challenge_level: values.challengeLevel, encouragement_level: values.encouragementLevel,
      policy_version: "learner-soul-v1", updated_at: new Date().toISOString(),
    }, { onConflict: "learner_id" });
    if (error) throw error;
    return res.json({ success: true, preferences: values });
  } catch {
    return res.status(503).json({ success: false, error: "Soul preferences could not be saved" });
  }
});

router.delete("/soul-state", async (req, res) => {
  if (!learnerSoulStateEnabled) return res.status(409).json({ success: false, error: "Soul-state controls are not enabled" });
  const scope = String(req.body?.scope || "all").toLowerCase();
  if (!["all", "preferences", "checkins"].includes(scope)) return res.status(422).json({ success: false, error: "scope must be all, preferences, or checkins" });
  try {
    const removals = [];
    if (scope === "all" || scope === "preferences") removals.push(db.schema("edu").from("learner_soul_preferences").delete().eq("learner_id", req.user.id));
    if (scope === "all" || scope === "checkins") removals.push(db.schema("edu").from("learner_soul_checkins").delete().eq("learner_id", req.user.id));
    const results = await Promise.all(removals);
    if (results.some(({ error }) => error)) throw new Error("clear failed");
    return res.json({ success: true, cleared: scope });
  } catch {
    return res.status(503).json({ success: false, error: "Soul-state controls could not be cleared" });
  }
});

// =============================================================
// AGENT PAIR ROUTES
// =============================================================

// =============================================================
// DECAY ROUTES  (v3.1) — handlers live in decay-review/routes.js, mounted
// here after the dry-run/inspect middleware so it still applies.
// =============================================================

router.use("/decay", decayRoutes);

// =============================================================
// STUDENT AGENT ROUTES — handlers live in agents/student/routes.js.
// =============================================================

router.use("/student/agent", studentAgentRoutes);

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

// ─── /chat/tutor — educational AI chat with modes + attachments ──────────────
// Used by the "Agent Chat" tab in both the learner and instructor apps.
//
// body: { message, history[], agentName, role,
//         mode: "default" | "think" | "research",
//         attachments: [{ name, type, dataUrl }] }
//
// Modes:
//   default   — the classic tutor: fast, grounded in syllabus + past questions.
//   think     — a reasoning model reasons first. Its summary streams to the UI
//               as `thinking` events (rendered as a collapsible "Thought
//               process" above the answer), then the answer streams as usual.
//               Falls back gpt-4o → gpt-4o-mini when the reasoning model or the
//               Responses API surface isn't available on the key.
//   research  — a deeper pass: more syllabus refs, more past questions, a
//               structured study-guide answer and both ref sets on the reply.
//               Progress streams as `status` steps the UI can show.
//
// Attachments (any mode): images go straight to vision; text files are
// inlined into the prompt; PDFs are text-extracted — and a scanned PDF with
// no text layer is rasterised to page images for vision OCR (renderPdfToImages).
// A bad file never fails the request; it becomes a note appended to the message.

/**
 * Base system prompt for the live agent — shared by the HTTP /agent route
 * and the voice session bootstrap (modules/voice/routes.js). Role-aware:
 * students get an exam-focused study tutor, instructors a teaching copilot.
 * The Think/Research addenda and syllabus/past-question grounding are
 * appended by the caller, not baked in here.
 */
// P1 (Context Layer Adoption): the STATIC chat doctrine — persona, formatting
// contract, role/mode addenda, agent-chat operating rules, tool-observation
// and HITL guides — lives in modules/agent-context/chat-doctrine.js and loads
// VERBATIM from the akoro-agent/ workspace, byte-identical to the
// pre-migration literals (pinned by agentContext.golden.chat.test.mjs).
// chat/turn-prepare.js imports the seam LOCALLY (`export { x } from` creates
// no local binding, and its /agent route calls assembleChatDoctrine
// directly — a re-export-only line made every chat turn throw
// ReferenceError: assembleChatDoctrine is not defined). This module re-exports
// the seam for the voice bootstrap.
import { safeCompare } from "../../lib/safeCompare.js";
import { appLink } from "../../lib/urls.js";
export { tutorSystemPrompt, assembleChatDoctrine };








// Grounding is best-effort by design (an embeddings/RAG hiccup must never
// take the chat down), but a SILENTLY broken pipeline reads to users as
// "the agent hallucinates". One line a minute keeps the failure visible in
// the logs without flooding them — the same discipline as the redis tracer.
let lastGroundingWarn = 0;
function warnGrounding(kind, error) {
  if (Date.now() - lastGroundingWarn > 60_000) {
    lastGroundingWarn = Date.now();
    console.warn(`[agent-chat] ${kind} grounding unavailable — teaching WITHOUT it:`, error?.message || error);
  }
}








// ■ Stop for a running Agent Chat turn — owner-scoped by the token identity.
router.post("/agent/stop", (req, res) => {
  const turnId = String(req.body?.turnId ?? "");
  if (!CHAT_TURN_ID.test(turnId)) return res.status(422).json({ error: "turnId is invalid" });
  const entry = activeTurnStops.get(turnStopKey(req.user.id, turnId));
  if (entry) entry.stop = true;
  return res.json({ success: true, stopping: Boolean(entry) });
});

// The one learner Agent Chat response authority. It owns direct tutoring,
// attachments/grounding/modes and the authorised tool loop; the browser never
// selects a response endpoint based on its own intent detection.
/**
 * GET /api/adaptive/chat/models — the model behind each chat mode, for the
 * Agent Chat's model switch. Read-only: the app still sends a MODE
 * ("default" | "think" | "research"), never a model id, so a browser can't
 * ask for a model this deployment doesn't route. Names come from this
 * server's own configuration (OPENAI_MODEL / _THINK_ / _RESEARCH_).
 */
// Modes run on the learner's chosen model now; no model is advertised per
// mode. `model` is kept null for older clients that still render it.
export const chatModelMenu = () => ([
  { id: "default",  model: null, kind: "Default",  description: "Quick, grounded answers for everyday study." },
  { id: "think",    model: null, kind: "Thinking", description: "Reasons step by step before answering — best for hard problems." },
  { id: "research", model: null, kind: "Research", description: "A deeper pass with more syllabus and past-question references." },
]);
router.get("/models", async (req, res) => {
  res.set("Cache-Control", "private, max-age=300");
  // modes: the chat's modes and their models; models: the catalogue a
  // learner may pick for the standard mode (Grand Plan §7.11) — each says
  // whether this server can use it, or why not ("coming soon"), and its cost
  // against the default; picker: whether the §7.11.5 picker is on here and,
  // when it is, the payer's tier (§7.11.5a) — a model outside its list is
  // listed as locked to a plan.
  const tier = pickerEnabled() && req.user?.id ? await allowedModelsFor(req.user.id).catch(() => null) : null;
  // saved: the learner's latest pick on any of their chats (Scenario K) — the
  // app opens on it on every device, so it is never cached when there is one.
  const saved = pickerEnabled() && req.user?.id ? await savedPickFor(req.user.id) : null;
  if (saved) res.set("Cache-Control", "private, no-cache");
  res.json({
    modes: chatModelMenu(),
    models: publicModelList(process.env, { allowedModels: tier?.allowedModels ?? null }),
    picker: { ...pickerInfo(), ...(tier ? { tier: tier.tier?.name || null, tierSource: tier.source, allowedModels: tier.allowedModels } : {}), ...(saved ? { saved } : {}) },
  });
});

/** The learner's latest saved pick → { modelId, label, conversationId, changedAt } | null. Never throws. */
async function savedPickFor(learnerId) {
  try {
    const pick = await (await modelPicks()).learnerPick(learnerId);
    return pick?.changedAt ? { modelId: pick.modelId ?? null, label: pick.label || null, conversationId: pick.conversationId || null, changedAt: pick.changedAt } : null;
  } catch { return null; }
}

// GET /sessions/:id/model — the pick saved on this chat ({} when never set).
router.get("/sessions/:id/model", async (req, res) => {
  try {
    if (!CHAT_SESSION_ID.test(String(req.params.id))) return res.status(422).json({ error: "id is invalid" });
    const thread = await supabaseThreads(db).get(req.params.id, req.user.id);
    if (!thread) return res.status(404).json({ error: "Session not found" });
    res.set("Cache-Control", "no-store");
    res.json({ success: true, modelSelection: thread.selection || {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /sessions/:id/model { modelId } — save the chat's pick (null = the
// default). It applies from the next message and also reaches the learner's
// open Study Prep / Teaching workflows (a model.changed event on each).
router.put("/sessions/:id/model", async (req, res) => {
  try {
    if (!CHAT_SESSION_ID.test(String(req.params.id))) return res.status(422).json({ error: "id is invalid" });
    if (!pickerEnabled()) return res.status(409).json({ code: "picker_off", error: "Model choice is off on this server" });
    const result = await (await modelPicks()).saveThreadPick({ learnerId: req.user.id, conversationId: req.params.id, modelId: req.body?.modelId ?? null });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err?.code && err.status) return res.status(err.status).json({ code: err.code, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/adaptive/chat/suggestions — three short follow-ups for the
 * reply the user just got (chips under it). Called by the app AFTER the
 * reply arrives, so the reply never waits; any failure returns none.
 * Body: { ask, reply, role?, context? }
 */
router.post("/suggestions", async (req, res) => {
  res.json({ success: true, suggestions: await suggestionsFor({ user: req.user, body: req.body }) });
});

/**
 * POST /api/adaptive/chat/learn-suggestions — the guide chat's "Learn
 * suggestions", grounded in the session's material (or its topic).
 * Body: { topic, subject?, title?, excerpt?, subtopics? }. The app shows its
 * own material-derived suggestions at once; these replace them when they
 * arrive. Any failure returns none.
 */
router.post("/learn-suggestions", async (req, res) => {
  const b = req.body || {};
  if (!String(b.topic || b.title || b.excerpt || "").trim()) return res.json({ success: true, suggestions: [] });
  // The open document: suggestions built from its passages, each pointing at its page.
  const doc = b.document && typeof b.document === "object" ? b.document : null;
  if (doc && (doc.recordId || doc.contentKey)) {
    try {
      const target = await resolveAskTargetFor({ userId: req.user.id, recordId: doc.recordId, contentKey: doc.contentKey });
      if (target && !target.status) {
        const { passages } = await gatherPassages({ target, question: `${b.title || ""} ${b.topic || ""} key ideas summary`.slice(0, 400), search: searchRecordChunks });
        if (passages?.length) {
          const completion = await openai.chat.completions.create({
            __role: "suggestions", temperature: 0.4, max_tokens: 320,
            __timeoutMs: 15_000, __maxRetries: 0,
            response_format: citedLearnSchema(),
            messages: buildCitedLearnSuggestionMessages({ topic: b.topic, subject: b.subject, title: b.title, passages }),
            __userId: req.user?.id, __feature: "learn_suggestions",
          });
          const toCitation = (n) => extractCitations(`[${n}]`, passages).citations[0] || null;
          const cited = shapeCitedLearnSuggestions(completion.choices?.[0]?.message?.content, { toCitation });
          if (cited.length) return res.json({ success: true, suggestions: cited.map((x) => x.text), cited });
        }
      }
    } catch (e) {
      console.warn("[chat/learn-suggestions] cited suggestions failed, plain ones instead:", String(e?.message || e).slice(0, 120));
    }
  }
  try {
    const completion = await openai.chat.completions.create({
      __role: "suggestions", temperature: 0.4, max_tokens: 220,
      __timeoutMs: 12_000, __maxRetries: 0,
      response_format: { type: "json_object" },
      messages: buildLearnSuggestionMessages({ topic: b.topic, subject: b.subject, title: b.title, excerpt: b.excerpt, subtopics: b.subtopics }),
      __userId: req.user?.id, __feature: "learn_suggestions",
    });
    res.json({ success: true, suggestions: shapeSuggestions(completion.choices?.[0]?.message?.content, { count: LEARN_LIMITS.count, chars: LEARN_LIMITS.chars }) });
  } catch (e) {
    console.warn("[chat/learn-suggestions] none this time:", String(e?.message || e).slice(0, 120));
    res.json({ success: true, suggestions: [] });
  }
});

// The /agent turn is two halves: prepareTurn validates the request, loads the
// context and assembles the prompt; answerTurn runs the tool loop and writes
// the reply. chat.js keeps the route registration and the tap continuation.
async function agentChatHandler(req, res) {
  const ctx = await prepareTurn(req, res);
  await answerTurn(ctx);
}

router.post("/agent", agentChatHandler);
setDecisionContinuationScheduler(scheduleDecisionContinuation);

// ── Tap-triggered continuation (Option A — Matt, 2026-11-17) ───────────────
// A card tap records the decision only. When no turn is live in that chat,
// the tap itself resumes the SAME flow (headless, below): the turn opens
// with the decision already injected, the agent applies it with
// await_decision and narrates the outcome. The cue is an internal event for
// the model only — no user message is created or saved for the tap, so the
// chat gains only the agent's narration, appended under the card (Matt,
// 2026-11-17: "the tap should not send a new prompt"). The learner sends
// nothing, and the server posts nothing of its own into the chat. A tap that lands
// mid-turn is caught by the live turn's await_decision poll, or by the
// end-of-turn recheck in the handler's finally above.
// Kill switch: AKORO_TAP_CONTINUATION=false restores the old behaviour
// (a late tap waits for the learner's next message in that chat).

/** A sink response for a headless turn: the handler runs in full (prompt,
 * tools, persist) and its stream events go nowhere; the saved reply — the
 * agent's own narration — is the outcome the learner reads. */
function headlessRes() {
  const res = { statusCode: 200, destroyed: false, writableEnded: false, body: null,
    on: () => res, once: () => res, writeHead: () => res, write: () => true,
    end: () => { res.writableEnded = true; return res; },
    status: (code) => { res.statusCode = code; return res; },
    json: (payload) => { res.body = payload; res.writableEnded = true; return res; } };
  return res;
}

export function scheduleDecisionContinuation({ userId, user = null, sessionId } = {}) {
  if (process.env.AKORO_TAP_CONTINUATION === "false") return;
  if (!userId || !sessionId || !CHAT_SESSION_ID.test(sessionId)) return;
  if (decisionContinuations.has(sessionId) || activeSessionTurns.get(sessionId)) return;
  const run = (async () => {
    try {
      const { listConfirmedDecisions } = await import("./chat/handlers-merged.js");
      const waiting = await listConfirmedDecisions(userId, sessionId).catch(() => []);
      if (!waiting.length) return;
      reportAgentActivity(userId, "Finishing what you approved…");
      const req = {
        user: user || { id: userId, role: "student" },
        body: { message: "[Card tap] The learner tapped Allow on the pending card in this chat — the decision is already recorded. Apply it now and narrate the outcome.", conversationId: sessionId, turnId: `tap${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}` },
        query: {}, headers: {}, internalContinuation: true,
      };
      await agentChatHandler(req, headlessRes());
      // Nudge the app: the outcome message is saved — show it now.
      try { global.io?.to(`user:${userId}`).emit("agent_chat_updated", { sessionId }); } catch { /* saved either way */ }
    } catch (e) {
      console.warn("[decision-continuation] failed:", e?.message || e);
    } finally {
      reportAgentActivity(userId, null);
      decisionContinuations.delete(sessionId);
    }
  })();
  decisionContinuations.set(sessionId, run);
}

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
