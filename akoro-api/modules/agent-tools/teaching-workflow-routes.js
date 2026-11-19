/**
 * Private bridge for the canonical adaptive-teaching turn workflow.
 *
 * Python may relay a teaching session through this router, but it never gets to
 * select workflow tools or submit a claimed learner identity. The same bounded,
 * authenticated StudentSessionOrchestrator used by the native adaptive socket
 * executes every turn. The bridge is deliberately session-affine: after Node
 * has accepted a session, a failed follow-up is surfaced to Python rather than
 * switching midway to a local implementation with divergent cognitive state.
 *
 * D43: a bridged session is a real session. It is prepared exactly like the
 * app's (teaching-session/start.js — continuation loads the earlier session,
 * decay loads its review context, the gated student session, the lesson
 * ladder), saved to edu.adaptive_sessions (its id comes back as `recordId`),
 * every turn is saved, and ending it completes the row. The live orchestrator
 * stays in this process; if it is lost (restart, TTL), the caller resumes with
 * mode "continuation" and `previousSessionId: recordId`.
 */
import { Router } from "express";

import db from "../../db.js";
import { TEACHING_TURN_WORKFLOW } from "../adaptive-learning/teaching-workflow/runner.js";
import { prepareTeachingSession, TEACHING_MODES } from "../adaptive-learning/teaching-session/start.js";
import {
  createSessionRecord, ensureSessionRecord, appendSessionBlocks, completeSessionRecord,
} from "../adaptive-learning/teaching-session/lifecycle.js";
import { carryForward } from "../adaptive-learning/teaching-session/context.js";
import { resultToTypedBlocks } from "../adaptive-learning/teaching-session/blocks.js";
import { clearStateCache } from "../learner-state/index.js";
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
const MODES = new Set(TEACHING_MODES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// ── The bridge's work, after authentication ─────────────────────────────────
// `claims` are a VERIFIED learner capability (readCapability). Exported as
// teachingBridge so the Verification Gate can drive a real bridged session
// for a test learner without holding the gateway secret.

async function startSession(claims, sessionId, body) {
  cleanup();
  const existing = sessions.get(sessionId);
  if (existing) {
    if (existing.learnerId !== String(claims.sub)) {
      throw new WorkflowGatewayError(403, "Teaching workflow session does not belong to this learner");
    }
    if (existing.running) throw new WorkflowGatewayError(409, "A teaching workflow turn is already running");
    existing.updatedAt = Date.now();
    return { status: 200, session: existing.initial, replayed: true };
  }

  const topic = text(body?.topic, 500);
  const subject = text(body?.subject, 180) || null;
  const mode = text(body?.mode, 24) || "fresh";
  const teacherAgentId = text(body?.teacherAgentId, 180) || null;
  const previousSessionId = text(body?.previousSessionId, 40) || null;
  const notificationId = text(body?.notificationId, 40) || null;
  if (!topic) throw new WorkflowGatewayError(422, "topic is required");
  if (!MODES.has(mode)) throw new WorkflowGatewayError(422, "mode is invalid");
  if (mode === "continuation" && !UUID.test(previousSessionId || "")) {
    throw new WorkflowGatewayError(422, "previousSessionId (the earlier session's recordId) is required to continue");
  }
  if (notificationId && !UUID.test(notificationId)) throw new WorkflowGatewayError(422, "notificationId is invalid");

  // The learner is the capability's subject — never a body field.
  const learnerId = String(claims.sub);
  let prepared;
  try {
    prepared = await prepareTeachingSession({
      studentId: learnerId, caller: learnerId, topic, subject, mode,
      prevSessionId: previousSessionId, notificationId, reference: reference(body?.reference), teacherAgentId,
    });
  } catch (error) {
    if (error?.status) throw new WorkflowGatewayError(error.status, error.message);
    throw error;
  }
  const { orchestrator, init, sessionType, historyBlocks, priorBlocks } = prepared;
  // Saved before the session is offered, so a lost process can be continued.
  const recordId = await createSessionRecord(orchestrator, {
    studentId: learnerId, topic, subject, openingBlocks: carryForward(priorBlocks, init.openingBlocks),
  });
  const initial = {
    ...publicStart(init, sessionId),
    sessionType, recordId: recordId || null, saved: Boolean(recordId),
    // The earlier conversation (continuation / decay), for display only.
    historyBlocks: historyBlocks || [],
  };
  sessions.set(sessionId, {
    learnerId, orchestrator, initial, turns: new Map(), running: false, updatedAt: Date.now(),
  });
  return { status: 201, session: initial, replayed: false };
}

async function runTurn(claims, sessionId, body) {
  const entry = entryFor(sessionId, claims);
  if (entry.running) throw new WorkflowGatewayError(409, "A teaching workflow turn is already running");
  if (typeof body?.message !== "string" || body.message.length > MAX_MESSAGE_CHARS) {
    throw new WorkflowGatewayError(422, "message is invalid");
  }
  const message = text(body.message, MAX_MESSAGE_CHARS);
  const turnId = text(body.turnId, 180) || null;
  if (!message) throw new WorkflowGatewayError(422, "message is required");
  if (body.turnId !== undefined && !TURN_ID.test(turnId || "")) throw new WorkflowGatewayError(422, "turnId is invalid");
  const replayed = cachedTurn(entry, turnId, message);
  if (replayed) return { turn: replayed, replayed: true };

  entry.running = true;
  try {
    const result = await entry.orchestrator.processTeachingMessage(message);
    // Saved like the app's turns: the learner's message, then the typed blocks.
    await appendSessionBlocks(entry.orchestrator, [{ type: "user", text: message }, ...resultToTypedBlocks(result, "student-session")]);
    const turn = publicTurn(result);
    cacheTurn(entry, turnId, message, turn);
    entry.updatedAt = Date.now();
    return { turn, replayed: false };
  } finally {
    entry.running = false;
  }
}

async function summarise(claims, sessionId) {
  const entry = entryFor(sessionId, claims);
  if (entry.running) throw new WorkflowGatewayError(409, "A teaching workflow turn is already running");
  entry.updatedAt = Date.now();
  return { summary: await entry.orchestrator.generateSummary(), workflow: publicWorkflow() };
}

async function endSession(claims, sessionId) {
  const entry = entryFor(sessionId, claims);
  if (entry.running) throw new WorkflowGatewayError(409, "A teaching workflow turn is already running");
  entry.running = true;
  try {
    const summary = await entry.orchestrator.endSession();
    await ensureSessionRecord(entry.orchestrator);
    await completeSessionRecord(entry.orchestrator);   // the row is complete; XP once
    await clearStateCache(entry.orchestrator.session?.agentId || entry.learnerId).catch(() => {});
    sessions.delete(sessionId);
    return { summary, workflow: publicWorkflow(), recordId: entry.orchestrator.dbSessionId || null };
  } finally {
    entry.running = false;
  }
}

export const teachingBridge = Object.freeze({ startSession, runTurn, summarise, endSession, WorkflowGatewayError });

// ── HTTP: the gateway credential + a learner capability, then the work ──────
const authed = (fn) => async (req, res) => {
  try {
    const body = { ...(req.body || {}), ...(req.params.sessionId ? { sessionId: req.params.sessionId } : {}) };
    const { sessionId, claims } = readCapability(body);
    await activeLearner(claims);
    const out = await fn(claims, sessionId, body);
    const { status = 200, ...rest } = out;
    return res.status(status).json({ success: true, ...rest });
  } catch (error) {
    return sendError(res, error);
  }
};

router.post("/sessions", requireAgentToolsCredential, authed(startSession));
router.post("/sessions/:sessionId/turns", requireAgentToolsCredential, authed(runTurn));
router.post("/sessions/:sessionId/summary", requireAgentToolsCredential, authed((claims, sessionId) => summarise(claims, sessionId)));
router.post("/sessions/:sessionId/end", requireAgentToolsCredential, authed((claims, sessionId) => endSession(claims, sessionId)));

export default router;
