/**
 * Private, capability-bound storage for measured learner study signals.
 *
 * This resource is intentionally absent from the model tool catalogue. It can
 * read/write only the signed learner's bounded profile and episodes, never raw
 * conversation text, private account data, or autonomous actions.
 */
import { Router } from "express";

import db from "../../db.js";
import { requireAgentToolsCredential, verifyAgentToolsCapability } from "./capability.js";
import {
  insightMeasurementRequest,
  insightSnapshotRequest,
  publicEpisode,
  publicProfile,
} from "./learning-insights-validation.js";

const router = Router();

class InsightsGatewayError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendError(res, error) {
  const status = error instanceof InsightsGatewayError ? error.status : 503;
  if (!(error instanceof InsightsGatewayError)) console.error("[agent-tools/learning-insights]", error?.message || error);
  return res.status(status).json({
    success: false,
    error: error instanceof InsightsGatewayError ? error.message : "Learner study insights are unavailable",
  });
}

function authorised(request) {
  const claims = verifyAgentToolsCapability(request.toolContext, request.sessionId);
  if (!claims || claims.scope !== "student") {
    throw new InsightsGatewayError(403, "A valid learner study-insights capability is required");
  }
  return claims;
}

async function activePrincipal(claims) {
  const { data, error } = await db.from("users").select("id, is_active").eq("id", claims.sub).maybeSingle();
  if (error) throw new InsightsGatewayError(503, "Learner identity lookup is unavailable");
  if (!data?.is_active) throw new InsightsGatewayError(403, "Learner account is unavailable");
  return data;
}

async function approvedEpisodeConcept(claims, conceptId) {
  const scope = claims.learningScope;
  if (!scope || typeof scope.curriculumKey !== "string" || typeof scope.subject !== "string" || typeof scope.topicKey !== "string") {
    throw new InsightsGatewayError(403, "A signed curriculum scope is required for a learning episode");
  }
  const { data, error } = await db.schema("edu").from("concept_catalog")
    .select("id, title")
    .eq("id", conceptId)
    .eq("status", "approved")
    .eq("curriculum_key", scope.curriculumKey)
    .eq("subject", scope.subject)
    .eq("topic_key", scope.topicKey)
    .maybeSingle();
  if (error) throw new InsightsGatewayError(503, "Concept catalogue is unavailable");
  if (!data) throw new InsightsGatewayError(422, "Episode must reference an active approved curriculum concept");
  return data;
}

router.post("/snapshot", requireAgentToolsCredential, async (req, res) => {
  try {
    let request;
    try { request = insightSnapshotRequest(req.body || {}); }
    catch (error) { throw new InsightsGatewayError(422, error.message); }
    const principal = await activePrincipal(authorised(request));
    const [profileResult, episodesResult] = await Promise.all([
      db.schema("edu").from("learner_teaching_profiles")
        .select("evidence_count, profile_confidence, mean_attention, mean_fatigue, mean_reasoning_quality, reasoning_style, pacing_recommendation, policy_version, expires_at")
        .eq("learner_id", principal.id).maybeSingle(),
      db.schema("edu").from("learner_learning_episodes")
        .select("concept_id, kind, summary, occurred_at")
        .eq("learner_id", principal.id).order("occurred_at", { ascending: false }).limit(6),
    ]);
    if (profileResult.error || episodesResult.error) throw new InsightsGatewayError(503, "Learner study insights are unavailable");
    return res.json({
      success: true,
      profile: publicProfile(profileResult.data),
      episodes: (episodesResult.data || []).map(publicEpisode).filter(Boolean),
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/measurements", requireAgentToolsCredential, async (req, res) => {
  try {
    let request;
    try { request = insightMeasurementRequest(req.body || {}); }
    catch (error) { throw new InsightsGatewayError(422, error.message); }
    const claims = authorised(request);
    const principal = await activePrincipal(claims);
    const m = request.measurement;
    const { data, error } = await db.schema("edu").rpc("record_learner_turn_measurement", {
      p_learner_id: principal.id,
      p_source_session_id: request.sessionId,
      p_source_turn_id: request.turnId,
      p_attention: m.attention,
      p_fatigue: m.fatigue,
      p_reasoning_quality: m.reasoningQuality,
      p_reasoning_style: m.reasoningStyle,
      p_measurement_status: m.measurementStatus,
      p_policy_version: m.policyVersion,
    });
    if (error) throw new InsightsGatewayError(503, "Learner measurement could not be recorded");
    const profile = publicProfile(Array.isArray(data) ? data[0] : data);

    if (request.episode) {
      const concept = await approvedEpisodeConcept(claims, request.episode.conceptId);
      // This is intentionally constructed by Akoro from reviewed catalogue
      // metadata, not supplied by a model or copied from the learner's reply.
      const summaries = {
        verified_progress: `Verified progress recorded for ${concept.title}.`,
        misconception_repaired: `A previously confused point was repaired for ${concept.title}.`,
        retrieval_practice: `Retrieval practice recorded for ${concept.title}.`,
      };
      const { error: episodeError } = await db.schema("edu").rpc("record_learner_learning_episode", {
        p_learner_id: principal.id,
        p_source_session_id: request.sessionId,
        p_source_turn_id: request.turnId,
        p_concept_id: concept.id,
        p_kind: request.episode.kind,
        p_summary: summaries[request.episode.kind],
        p_policy_version: m.policyVersion,
      });
      if (episodeError) throw new InsightsGatewayError(503, "Learner episode could not be recorded");
    }
    return res.json({ success: true, profile });
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
