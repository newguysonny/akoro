/**
 * Private bridge for the canonical adaptive-teaching turn workflow.
 *
 * Python may relay a teaching session through this router, but it never gets to
 * select workflow tools or submit a claimed learner identity. The same bounded,
 * authenticated StudentSessionOrchestrator used by the native adaptive socket
 * executes every turn. The bridge is deliberately session-affine: after Node
 * has accepted a session, a failed follow-up is surfaced to Python rather than
 * switching midway to a local implementation with divergent cognitive state.
 */
import { Router } from "express";

import db from "../../db.js";
import { getOrchestrator } from "../adaptive-learning/agents/registry.js";
import { TEACHING_TURN_WORKFLOW } from "../adaptive-learning/teaching-workflow/runner.js";
import {
  requireAgentToolsCredential,
  verifyAgentToolsCapability,
} from "./capability.js";

const router = Router();
const MAX_SESSIONS = 1_000;
const MAX_TURNS_PER_SESSION = 32;
const MAX_MESSAGE_CHARS = 12_000;
const SESSION_ID = /^[A-Za-z0-9_-]{1,180}$/;
const TURN_ID = /^[A-Za-z0-9_-]{8,180}$/;
const MODES = new Set(["fresh", "continuation", "decay"]);

class WorkflowGatewayError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Process-local by design, matching the service's own live-session store. */
const sessions = new Map();

function ttlMs() {
  const seconds = Number(process.env.AKORO_TEACHING_WORKFLOW_SESSION_TTL_SECONDS || 1_800);
  return Math.max(60, Math.min(86_400, Number.isFinite(seconds) ? seconds : 1_800)) * 1_000;
}

function cleanup() {
  const cutoff = Date.now() - ttlMs();
  for (const [id, entry] of sessions) {
    if (!entry.running && entry.updatedAt < cutoff) sessions.delete(id);
  }
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
}

function text(value, max) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function reference(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowGatewayError(422, "reference is invalid");
  }
  const source = text(value.text, 12_000);
  if (!source) return null;
  return {
    name: text(value.name, 180) || "reference",
    text: source,
    truncated: Boolean(value.truncated) || String(value.text || "").length > source.length,
  };
}

function readCapability(body) {
  const sessionId = text(body?.sessionId, 180);
  const toolContext = typeof body?.toolContext === "string" ? body.toolContext : "";
  if (!SESSION_ID.test(sessionId) || !toolContext || toolContext.length > 4_096) {
    throw new WorkflowGatewayError(422, "sessionId and toolContext are required");
  }
  const claims = verifyAgentToolsCapability(toolContext, sessionId);
  if (!claims || claims.scope !== "student") {
    throw new WorkflowGatewayError(403, "A valid learner teaching-workflow capability is required");
  }
  return { sessionId, claims };
}

async function activeLearner(claims) {
  const { data, error } = await db.from("users")
    .select("id, is_active")
    .eq("id", claims.sub)
    .maybeSingle();
  if (error) throw new WorkflowGatewayError(503, "Learner identity lookup is unavailable");
  if (!data?.is_active) throw new WorkflowGatewayError(403, "Learner account is unavailable");
  return data;
}

function publicWorkflow() {
  return {
    type: TEACHING_TURN_WORKFLOW.type,
    policyVersion: TEACHING_TURN_WORKFLOW.policyVersion,
    authority: "akoro_api",
    sessionAffinity: "required",
  };
}

function publicStart(initial, sessionId) {
  return {
    ...initial,
    sessionId,
    workflow: publicWorkflow(),
  };
}

function publicTurn(turn) {
  return {
    ...turn,
    workflow: turn?.workflow && typeof turn.workflow === "object"
      ? { ...turn.workflow, authority: "akoro_api" }
      : { ...publicWorkflow(), state: "completed" },
  };
}

function entryFor(sessionId, claims) {
  cleanup();
  const entry = sessions.get(sessionId);
  if (!entry) throw new WorkflowGatewayError(404, "No active teaching workflow session with that id");
  if (entry.learnerId !== String(claims.sub)) {
    throw new WorkflowGatewayError(403, "Teaching workflow session does not belong to this learner");
  }
  return entry;
}

function cachedTurn(entry, turnId, message) {
  if (!turnId) return null;
  const cached = entry.turns.get(turnId);
  if (!cached) return null;
  if (cached.message !== message) throw new WorkflowGatewayError(422, "turnId cannot be reused for a different message");
  return cached.response;
}

function cacheTurn(entry, turnId, message, response) {
  if (!turnId) return;
  entry.turns.set(turnId, { message, response });
  while (entry.turns.size > MAX_TURNS_PER_SESSION) entry.turns.delete(entry.turns.keys().next().value);
}

function sendError(res, error) {
  const status = error instanceof WorkflowGatewayError ? error.status : 503;
  if (!(error instanceof WorkflowGatewayError)) {
    console.error("[agent-tools/teaching-workflow]", error?.message || error);
  }
  return res.status(status).json({
    success: false,
    error: error instanceof WorkflowGatewayError ? error.message : "Teaching workflow is unavailable",
  });
}

router.post("/sessions", requireAgentToolsCredential, async (req, res) => {
  try {
    cleanup();
    const { sessionId, claims } = readCapability(req.body || {});
    await activeLearner(claims);
    const existing = sessions.get(sessionId);
    if (existing) {
      if (existing.learnerId !== String(claims.sub)) {
        throw new WorkflowGatewayError(403, "Teaching workflow session does not belong to this learner");
      }
      if (existing.running) throw new WorkflowGatewayError(409, "A teaching workflow turn is already running");
      existing.updatedAt = Date.now();
      return res.json({ success: true, session: existing.initial, replayed: true });
    }

    const topic = text(req.body?.topic, 500);
    const subject = text(req.body?.subject, 180) || null;
    const mode = text(req.body?.mode, 24) || "fresh";
    const teacherAgentId = text(req.body?.teacherAgentId, 180) || null;
    if (!topic) throw new WorkflowGatewayError(422, "topic is required");
    if (!MODES.has(mode)) throw new WorkflowGatewayError(422, "mode is invalid");

    const sessionType = mode === "decay" ? "decay_review" : mode === "continuation" ? "continuation" : "free_teaching";
    const orchestrator = await getOrchestrator({
      mode: "student",
      studentId: String(claims.sub),
      userId: String(claims.sub),
      teacherAgentId,
      sessionType,
      subject,
      referenceMaterial: reference(req.body?.reference),
    });
    if (!orchestrator?.initialize || !orchestrator?.processTeachingMessage) {
      throw new WorkflowGatewayError(503, "Canonical teaching workflow is unavailable");
    }
    const initial = publicStart(await orchestrator.initialize(String(claims.sub), topic), sessionId);
    sessions.set(sessionId, {
      learnerId: String(claims.sub), orchestrator, initial, turns: new Map(), running: false, updatedAt: Date.now(),
    });
    return res.status(201).json({ success: true, session: initial, replayed: false });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/sessions/:sessionId/turns", requireAgentToolsCredential, async (req, res) => {
  try {
    const body = { ...(req.body || {}), sessionId: req.params.sessionId };
    const { sessionId, claims } = readCapability(body);
    await activeLearner(claims);
    const entry = entryFor(sessionId, claims);
    if (entry.running) throw new WorkflowGatewayError(409, "A teaching workflow turn is already running");
    if (typeof body.message !== "string" || body.message.length > MAX_MESSAGE_CHARS) {
      throw new WorkflowGatewayError(422, "message is invalid");
    }
    const message = text(body.message, MAX_MESSAGE_CHARS);
    const turnId = text(body.turnId, 180) || null;
    if (!message) throw new WorkflowGatewayError(422, "message is required");
    if (body.turnId !== undefined && !TURN_ID.test(turnId || "")) throw new WorkflowGatewayError(422, "turnId is invalid");
    const replayed = cachedTurn(entry, turnId, message);
    if (replayed) return res.json({ success: true, turn: replayed, replayed: true });

    entry.running = true;
    try {
      const turn = publicTurn(await entry.orchestrator.processTeachingMessage(message));
      cacheTurn(entry, turnId, message, turn);
      entry.updatedAt = Date.now();
      return res.json({ success: true, turn, replayed: false });
    } finally {
      entry.running = false;
    }
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/sessions/:sessionId/summary", requireAgentToolsCredential, async (req, res) => {
  try {
    const { sessionId, claims } = readCapability({ ...(req.body || {}), sessionId: req.params.sessionId });
    await activeLearner(claims);
    const entry = entryFor(sessionId, claims);
    if (entry.running) throw new WorkflowGatewayError(409, "A teaching workflow turn is already running");
    entry.updatedAt = Date.now();
    return res.json({ success: true, summary: await entry.orchestrator.generateSummary(), workflow: publicWorkflow() });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/sessions/:sessionId/end", requireAgentToolsCredential, async (req, res) => {
  try {
    const body = { ...(req.body || {}), sessionId: req.params.sessionId };
    const { sessionId, claims } = readCapability(body);
    await activeLearner(claims);
    const entry = entryFor(sessionId, claims);
    if (entry.running) throw new WorkflowGatewayError(409, "A teaching workflow turn is already running");
    entry.running = true;
    try {
      const summary = await entry.orchestrator.endSession();
      sessions.delete(sessionId);
      return res.json({ success: true, summary, workflow: publicWorkflow() });
    } finally {
      entry.running = false;
    }
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
