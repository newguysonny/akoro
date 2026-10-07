/** Validation and public shaping for bounded learner study insights. */

const SESSION_ID = /^[A-Za-z0-9_-]{1,180}$/;
const TURN_ID = /^[A-Za-z0-9._:-]{1,180}$/;
const CONCEPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STYLES = new Set(["not_observed", "recall", "procedural", "causal", "comparative", "transfer", "mixed"]);
const STATUSES = new Set(["observed", "not_checked"]);
const EPISODE_KINDS = new Set(["verified_progress", "misconception_repaired", "retrieval_practice"]);

export function boundedText(value, maximum = 500) {
  return String(value || "").replace(/[\r\n\x00]+/g, " ").trim().slice(0, maximum);
}

function capability(body) {
  const sessionId = boundedText(body?.sessionId, 180);
  const toolContext = typeof body?.toolContext === "string" ? body.toolContext : "";
  if (!SESSION_ID.test(sessionId) || !toolContext || toolContext.length > 4_096) {
    throw new Error("sessionId and toolContext are required");
  }
  return { sessionId, toolContext };
}

function fraction(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} must be a fraction from 0 to 1`);
  return Math.round(number * 10_000) / 10_000;
}

export function insightSnapshotRequest(body) {
  return capability(body);
}

export function insightMeasurementRequest(body) {
  const { sessionId, toolContext } = capability(body);
  const turnId = boundedText(body?.turnId, 180);
  const source = body?.measurement;
  if (!TURN_ID.test(turnId) || !source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("turnId and one measurement are required");
  }
  const allowedMeasurementKeys = new Set(["attention", "fatigue", "reasoningQuality", "reasoningStyle", "measurementStatus", "policyVersion", "episode"]);
  if (Object.keys(source).some((key) => !allowedMeasurementKeys.has(key))) throw new Error("measurement contains unexpected data");
  const reasoningStyle = boundedText(source.reasoningStyle, 40).toLowerCase();
  const measurementStatus = boundedText(source.measurementStatus, 40).toLowerCase();
  const policyVersion = boundedText(source.policyVersion || "learner-signals-v1", 80);
  if (!STYLES.has(reasoningStyle) || !STATUSES.has(measurementStatus) || !policyVersion) {
    throw new Error("measurement has an invalid style, status, or policy version");
  }
  const measurement = {
    attention: fraction(source.attention, "attention"),
    fatigue: fraction(source.fatigue, "fatigue"),
    reasoningQuality: fraction(source.reasoningQuality, "reasoningQuality"),
    reasoningStyle,
    measurementStatus,
    policyVersion,
  };
  // A safe fallback never turns an unavailable judge into fabricated evidence.
  if (measurementStatus === "not_checked" && (measurement.attention || measurement.fatigue || measurement.reasoningQuality || reasoningStyle !== "not_observed")) {
    throw new Error("not_checked measurements must contain zero scores and no observed style");
  }

  let episode = null;
  if (source.episode !== undefined && source.episode !== null) {
    const candidate = source.episode;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("episode is invalid");
    if (Object.keys(candidate).some((key) => !new Set(["conceptId", "kind"]).has(key))) throw new Error("episode contains unexpected data");
    const conceptId = boundedText(candidate.conceptId, 80);
    const kind = boundedText(candidate.kind, 60).toLowerCase();
    if (!CONCEPT_ID.test(conceptId) || !EPISODE_KINDS.has(kind)) throw new Error("episode concept or kind is invalid");
    episode = { conceptId, kind };
  }
  return { sessionId, toolContext, turnId, measurement, episode };
}

export function publicProfile(row) {
  if (!row) return null;
  return {
    evidenceCount: Math.max(0, Number(row.evidence_count ?? 0)),
    profileConfidence: Number(row.profile_confidence ?? 0),
    meanAttention: Number(row.mean_attention ?? 0),
    meanFatigue: Number(row.mean_fatigue ?? 0),
    meanReasoningQuality: Number(row.mean_reasoning_quality ?? 0),
    reasoningStyle: boundedText(row.reasoning_style, 40) || "not_observed",
    pacingRecommendation: boundedText(row.pacing_recommendation, 40) || "unknown",
    policyVersion: boundedText(row.policy_version, 80) || "learner-signals-v1",
    expiresAt: row.expires_at || null,
  };
}

export function publicEpisode(row) {
  if (!row) return null;
  return {
    conceptId: boundedText(row.concept_id, 80) || null,
    kind: boundedText(row.kind, 60),
    summary: boundedText(row.summary, 420),
    occurredAt: row.occurred_at || null,
  };
}
