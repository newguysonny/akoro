/**
 * Private Akoro-owned concept-state gateway for the additive Python service.
 *
 * It is intentionally not a model function. The Python agent calls this
 * bounded resource around a teaching turn; Akoro derives the learner from the
 * signed capability and executes the database transition function. Browser
 * identifiers and arbitrary web/RAG facts never become concept evidence.
 */
import { Router } from "express";

import db from "../../db.js";
import {
  requireAgentToolsCredential,
  verifyAgentToolsCapability,
} from "./capability.js";
import {
  conceptObservationsRequest,
  conceptResolutionRequest,
  conceptSnapshotRequest,
  publicConcept,
  publicState,
} from "./concept-state-validation.js";

const router = Router();

class ConceptStateGatewayError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendError(res, error) {
  const status = error instanceof ConceptStateGatewayError ? error.status : 503;
  if (!(error instanceof ConceptStateGatewayError)) {
    console.error("[agent-tools/concept-state]", error?.message || error);
  }
  return res.status(status).json({
    success: false,
    error: error instanceof ConceptStateGatewayError ? error.message : "Concept state is unavailable",
  });
}

function authorised(request, requestedScope = null) {
  const claims = verifyAgentToolsCapability(request.toolContext, request.sessionId);
  const scope = claims?.learningScope;
  if (!claims || claims.scope !== "student" || !scope
      || typeof scope.curriculumKey !== "string" || typeof scope.subject !== "string" || typeof scope.topicKey !== "string") {
    throw new ConceptStateGatewayError(403, "A valid learner concept-state capability is required");
  }
  if (requestedScope && (scope.curriculumKey !== requestedScope.curriculumKey
      || scope.subject !== requestedScope.subject || scope.topicKey !== requestedScope.topicKey)) {
    throw new ConceptStateGatewayError(403, "Concept state request is outside the signed curriculum scope");
  }
  return { claims, scope };
}

async function activePrincipal(claims) {
  const { data, error } = await db.from("users")
    .select("id, is_active")
    .eq("id", claims.sub)
    .maybeSingle();
  if (error) throw new ConceptStateGatewayError(503, "Learner identity lookup is unavailable");
  if (!data?.is_active) throw new ConceptStateGatewayError(403, "Learner account is unavailable");
  return data;
}

async function approvedConcepts(ids, scope) {
  const { data, error } = await db.schema("edu").from("concept_catalog")
    .select("id, code, title, objective, curriculum_key, subject, topic_key, source_type")
    .eq("status", "approved")
    .eq("curriculum_key", scope.curriculumKey)
    .eq("subject", scope.subject)
    .eq("topic_key", scope.topicKey)
    .in("id", ids);
  if (error) throw new ConceptStateGatewayError(503, "Concept catalogue is unavailable");
  const concepts = (data || []).map(publicConcept).filter(Boolean);
  if (concepts.length !== ids.length) {
    throw new ConceptStateGatewayError(422, "Every concept must be an active approved curriculum concept");
  }
  return concepts;
}

router.post("/resolve", requireAgentToolsCredential, async (req, res) => {
  try {
    let request;
    try { request = conceptResolutionRequest(req.body || {}); }
    catch (error) { throw new ConceptStateGatewayError(422, error.message); }
    const { claims } = authorised(request, request);
    await activePrincipal(claims);
    const { data, error } = await db.schema("edu").from("concept_catalog")
      .select("id, code, title, objective, curriculum_key, subject, topic_key, source_type")
      .eq("status", "approved")
      .eq("curriculum_key", request.curriculumKey)
      .eq("subject", request.subject)
      .eq("topic_key", request.topicKey)
      .order("code")
      .limit(8);
    if (error) throw new ConceptStateGatewayError(503, "Concept catalogue is unavailable");
    // An empty answer is valid: it means this scope has not been reviewed and
    // the Python service must run its existing non-canonical evaluation path.
    return res.json({ success: true, concepts: (data || []).map(publicConcept).filter(Boolean) });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/snapshot", requireAgentToolsCredential, async (req, res) => {
  try {
    let request;
    try { request = conceptSnapshotRequest(req.body || {}); }
    catch (error) { throw new ConceptStateGatewayError(422, error.message); }
    const { claims, scope } = authorised(request);
    const principal = await activePrincipal(claims);
    await approvedConcepts(request.conceptIds, scope);
    const { data, error } = await db.schema("edu").from("learner_concept_state")
      .select("concept_id, mastery, retention, evidence_confidence, misconception_active, evidence_count, last_evidence_at, next_review_due, state_version")
      .eq("learner_id", principal.id)
      .in("concept_id", request.conceptIds);
    if (error) throw new ConceptStateGatewayError(503, "Learner concept state is unavailable");
    const byConcept = new Map((data || []).map((row) => [row.concept_id, row]));
    return res.json({
      success: true,
      states: request.conceptIds.map((conceptId) => publicState(byConcept.get(conceptId), conceptId)),
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/observations", requireAgentToolsCredential, async (req, res) => {
  try {
    let request;
    try { request = conceptObservationsRequest(req.body || {}); }
    catch (error) { throw new ConceptStateGatewayError(422, error.message); }
    const { claims, scope } = authorised(request);
    const principal = await activePrincipal(claims);
    await approvedConcepts(request.observations.map((item) => item.conceptId), scope);

    const states = [];
    for (const observation of request.observations) {
      const { data, error } = await db.schema("edu").rpc("record_learner_concept_evidence", {
        p_learner_id: principal.id,
        p_concept_id: observation.conceptId,
        p_source_session_id: request.sessionId,
        p_source_turn_id: request.turnId,
        p_observation_kind: observation.kind,
        p_response_quality: observation.responseQuality,
        p_claim_validity: observation.claimValidity,
        p_model_confidence: observation.modelConfidence,
        p_claim_status: observation.claimStatus,
        p_evidence_summary: observation.evidenceSummary,
        p_provenance: { source: "akoro_python_agent", contract: "concept-state-v1" },
      });
      if (error) throw new ConceptStateGatewayError(503, "Learner concept evidence could not be recorded");
      const state = Array.isArray(data) ? data[0] : data;
      if (!state) throw new ConceptStateGatewayError(503, "Learner concept state was not returned");
      states.push(publicState(state, observation.conceptId));
    }
    return res.json({ success: true, states });
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
