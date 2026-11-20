import express from "express";
import { openai } from "../../../lib/aiModel.js";
import { shapeSuggestions, buildLearnSuggestionMessages, LEARN_LIMITS, buildCitedLearnSuggestionMessages, citedLearnSchema, shapeCitedLearnSuggestions } from "./chatSuggestions.js";
import { resolveAskTargetFor } from "../../records/index.js";
import {
  learnerInsightsEnabled, learnerSoulStateEnabled, conceptTrackerEnabled,
} from "./runtime-state.js";
import { gatherPassages, extractCitations } from "../../records/index.js";
import db from "../../../db.js";
import {
  getLearnerAutonomy,
  setLearnerAutonomy,
} from "../learner/learner-autonomy.js";
import { suggestionsFor } from "./turn-store.js";

const router = express.Router();

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
    if (req.body.enabled) import("../../agent-network/index.js").then((m) => m.wakeInbox(req.user.id, "switched_on")).catch(() => {});
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

export default router;
