/**
 * Private read-only soul-state projection for the additive Python agent.
 *
 * Akoro owns learner-selected preferences, session check-ins, and compact
 * episode history. This is never advertised as a model tool and does not
 * authorise actions or expose raw chat text.
 */
import { Router } from "express";

import db from "../../db.js";
import { requireAgentToolsCredential, verifyAgentToolsCapability } from "./capability.js";

const router = Router();
const SESSION_ID = /^[A-Za-z0-9_-]{1,180}$/;

class SoulStateGatewayError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendError(res, error) {
  const status = error instanceof SoulStateGatewayError ? error.status : 503;
  if (!(error instanceof SoulStateGatewayError)) console.error("[agent-tools/soul-state]", error?.message || error);
  return res.status(status).json({ success: false, error: error instanceof SoulStateGatewayError ? error.message : "Learner soul state is unavailable" });
}

function request(body) {
  const sessionId = String(body?.sessionId || "").trim();
  const toolContext = typeof body?.toolContext === "string" ? body.toolContext : "";
  if (!SESSION_ID.test(sessionId) || !toolContext || toolContext.length > 4_096) {
    throw new SoulStateGatewayError(422, "sessionId and toolContext are required");
  }
  const claims = verifyAgentToolsCapability(toolContext, sessionId);
  if (!claims || claims.scope !== "student") throw new SoulStateGatewayError(403, "A valid learner soul-state capability is required");
  return { sessionId, claims };
}

async function activePrincipal(claims) {
  const { data, error } = await db.from("users").select("id, is_active").eq("id", claims.sub).maybeSingle();
  if (error) throw new SoulStateGatewayError(503, "Learner identity lookup is unavailable");
  if (!data?.is_active) throw new SoulStateGatewayError(403, "Learner account is unavailable");
  return data.id;
}

function preference(row) {
  if (!row) return null;
  return {
    interactionStyle: row.interaction_style,
    responseTone: row.response_tone,
    challengeLevel: row.challenge_level,
    encouragementLevel: row.encouragement_level,
    policyVersion: row.policy_version,
  };
}

function checkin(row) {
  if (!row) return null;
  return {
    feeling: row.feeling,
    studyContext: row.study_context,
    studyIntent: row.study_intent,
    requestedSupport: row.requested_support,
    expiresAt: row.expires_at,
    policyVersion: row.policy_version,
  };
}

router.post("/snapshot", requireAgentToolsCredential, async (req, res) => {
  try {
    const { sessionId, claims } = request(req.body || {});
    const learnerId = await activePrincipal(claims);
    const now = new Date().toISOString();
    const [preferenceResult, checkinResult, episodesResult] = await Promise.all([
      db.schema("edu").from("learner_soul_preferences")
        .select("interaction_style, response_tone, challenge_level, encouragement_level, policy_version")
        .eq("learner_id", learnerId).maybeSingle(),
      db.schema("edu").from("learner_soul_checkins")
        .select("feeling, study_context, study_intent, requested_support, expires_at, policy_version")
        .eq("learner_id", learnerId).eq("source_session_id", sessionId).gt("expires_at", now).maybeSingle(),
      // Episodes already exclude raw chat/model content. Return only a few
      // server-created summaries to form a factual learning-thread cue.
      db.schema("edu").from("learner_learning_episodes")
        .select("kind, summary, occurred_at").eq("learner_id", learnerId)
        .order("occurred_at", { ascending: false }).limit(4),
    ]);
    if (preferenceResult.error || checkinResult.error || episodesResult.error) {
      throw new SoulStateGatewayError(503, "Learner soul state is unavailable");
    }
    const episodes = (episodesResult.data || []).map((item) => ({
      kind: String(item.kind || "").slice(0, 60),
      summary: String(item.summary || "").replace(/[\r\n\x00]+/g, " ").trim().slice(0, 420),
      occurredAt: item.occurred_at || null,
    })).filter((item) => item.kind && item.summary);
    return res.json({ success: true, preferences: preference(preferenceResult.data), checkIn: checkin(checkinResult.data), episodes });
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
