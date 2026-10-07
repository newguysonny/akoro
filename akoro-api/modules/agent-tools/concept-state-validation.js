/** Pure request validation for the private concept-state gateway. */

export const CONCEPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID = /^[A-Za-z0-9_-]{1,180}$/;
const TURN_ID = /^[A-Za-z0-9_-]{1,180}$/;
const KINDS = new Set([
  "demonstrated_understanding", "partial_understanding", "recall_success",
  "recall_gap", "misconception_detected", "misconception_cleared", "assessment_result",
]);
const CLAIM_STATUSES = new Set(["supported", "contradicted", "not_checked"]);

export function boundedText(value, maximum) {
  return typeof value === "string"
    ? value.replace(/\u0000/g, "").replace(/[\r\n]+/g, " ").trim().slice(0, maximum)
    : "";
}

export function canonicalKey(value) {
  return boundedText(value, 180).toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function capability(body) {
  const sessionId = boundedText(body?.sessionId, 180);
  const toolContext = typeof body?.toolContext === "string" ? body.toolContext.trim() : "";
  if (!SESSION_ID.test(sessionId) || !toolContext || toolContext.length > 4096) {
    throw new Error("sessionId and toolContext are required");
  }
  return { sessionId, toolContext };
}

function fraction(value, name) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${name} must be a fraction from 0 to 1`);
  return Math.round(number * 10_000) / 10_000;
}

export function conceptResolutionRequest(body) {
  const { sessionId, toolContext } = capability(body);
  const curriculumKey = canonicalKey(body?.curriculumKey);
  const subject = boundedText(body?.subject, 180).replace(/\s+/g, " ");
  const topicKey = canonicalKey(body?.topicKey);
  if (!curriculumKey || !subject || !topicKey) {
    throw new Error("curriculumKey, subject, and topicKey are required");
  }
  return { sessionId, toolContext, curriculumKey, subject, topicKey };
}

export function conceptSnapshotRequest(body) {
  const { sessionId, toolContext } = capability(body);
  const ids = Array.isArray(body?.conceptIds) ? body.conceptIds : [];
  if (!ids.length || ids.length > 8 || ids.some((id) => !CONCEPT_ID.test(String(id)))) {
    throw new Error("conceptIds must contain 1 to 8 concept UUIDs");
  }
  const conceptIds = [...new Set(ids.map(String))];
  if (conceptIds.length !== ids.length) throw new Error("conceptIds must not contain duplicates");
  return { sessionId, toolContext, conceptIds };
}

export function conceptObservationsRequest(body) {
  const { sessionId, toolContext } = capability(body);
  const turnId = boundedText(body?.turnId, 180);
  const raw = Array.isArray(body?.observations) ? body.observations : [];
  if (!TURN_ID.test(turnId) || !raw.length || raw.length > 4) {
    throw new Error("turnId and 1 to 4 observations are required");
  }
  const observations = raw.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("observation is invalid");
    const conceptId = boundedText(candidate.conceptId, 80);
    const kind = boundedText(candidate.kind, 80).toLowerCase();
    const claimStatus = boundedText(candidate.claimStatus, 80).toLowerCase();
    const evidenceSummary = boundedText(candidate.evidenceSummary, 1200);
    if (!CONCEPT_ID.test(conceptId) || !KINDS.has(kind) || !CLAIM_STATUSES.has(claimStatus) || evidenceSummary.length < 3) {
      throw new Error("observation contains an invalid concept, kind, claim status, or summary");
    }
    return {
      conceptId,
      kind,
      responseQuality: fraction(candidate.responseQuality, "responseQuality"),
      claimValidity: fraction(candidate.claimValidity, "claimValidity"),
      modelConfidence: fraction(candidate.modelConfidence, "modelConfidence"),
      claimStatus,
      evidenceSummary,
    };
  });
  if (new Set(observations.map((item) => item.conceptId)).size !== observations.length) {
    throw new Error("observations must not repeat a concept in one turn");
  }
  return { sessionId, toolContext, turnId, observations };
}

export function publicConcept(row) {
  if (!row || !CONCEPT_ID.test(String(row.id))) return null;
  return {
    id: row.id,
    code: boundedText(row.code, 120),
    title: boundedText(row.title, 300),
    objective: boundedText(row.objective, 1200),
    curriculumKey: boundedText(row.curriculum_key, 180),
    subject: boundedText(row.subject, 180),
    topicKey: canonicalKey(row.topic_key),
    sourceType: boundedText(row.source_type, 80),
  };
}

export function publicState(row, conceptId) {
  return {
    conceptId,
    mastery: Number(row?.mastery ?? 0),
    retention: Number(row?.retention ?? 0),
    evidenceConfidence: Number(row?.evidence_confidence ?? 0),
    misconceptionActive: Boolean(row?.misconception_active),
    evidenceCount: Number(row?.evidence_count ?? 0),
    lastEvidenceAt: row?.last_evidence_at ?? null,
    nextReviewDue: row?.next_review_due ?? null,
    lastRetentionDecayAt: row?.last_retention_decay_at ?? null,
    stateVersion: Number(row?.state_version ?? 1),
  };
}
