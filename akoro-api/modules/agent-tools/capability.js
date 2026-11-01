/**
 * Private tool-gateway credentials and short-lived, session-bound capabilities.
 *
 * A Python service credential says only “this is the deployed agent service”.
 * It deliberately does NOT identify a learner. The `toolContext` JWT bridges
 * that gap: Akoro API mints it after authenticating/authorising the user and
 * the gateway verifies it on every catalogue and invocation request.
 */
import jwt from "jsonwebtoken";
import { createHash, randomUUID } from "node:crypto";
import { safeCompare } from "../../lib/safeCompare.js";

const ISSUER = "akoro-api-agent-tools";
const AUDIENCE = "akoro-python-agent-tools";
const CONFIRMATION_AUDIENCE = "akoro-python-agent-write-confirmation";
const SESSION_ID = /^[A-Za-z0-9_-]{1,180}$/;
const TASK_ID = /^[A-Za-z0-9_-]{1,180}$/;
const LEARNING_SCOPE_KEY = /^[a-z0-9][a-z0-9._:-]{0,179}$/;
const TEACHER_ROLES = new Set(["instructor", "teacher", "school", "school_admin", "admin"]);

function gatewaySecret() {
  return (process.env.AKORO_AGENT_TOOLS_SECRET || "").trim();
}

function capabilitySecret() {
  return (process.env.AKORO_AGENT_TOOLS_CAPABILITY_SECRET || "").trim();
}

function normaliseLearningKey(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function learningScope(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("learningScope is invalid");
  const curriculumKey = normaliseLearningKey(value.curriculumKey);
  const topicKey = normaliseLearningKey(value.topicKey);
  const subject = String(value.subject || "").trim().replace(/\s+/g, " ");
  if (!LEARNING_SCOPE_KEY.test(curriculumKey) || !LEARNING_SCOPE_KEY.test(topicKey) || !subject || subject.length > 180) {
    throw new Error("learningScope needs a curriculumKey, subject, and topicKey");
  }
  return { curriculumKey, subject, topicKey };
}

export function requireAgentToolsCredential(req, res, next) {
  const expected = gatewaySecret();
  if (!expected) {
    return res.status(503).json({ success: false, error: "Agent tools gateway is not configured" });
  }
  if (!safeCompare(req.get("X-Akoro-Tools-Secret"), expected)) {
    return res.status(401).json({ success: false, error: "Invalid agent tools credential" });
  }
  next();
}

/**
 * Create an opaque toolContext for an already authenticated Akoro user.
 *
 * The Node → Python bridge calls this helper directly after it has derived the
 * principal from its authenticated request. It must never be exposed through a
 * browser endpoint. Teacher task tools additionally need an owned task and run
 * id; both are re-checked by the gateway before every execution.
 */
export function issueAgentToolsCapability({
  user, sessionId, taskId = null, runId = null, courseId = null, learningScope: requestedLearningScope = null, ttlSeconds = 600,
}) {
  const secret = capabilitySecret();
  if (!secret) throw new Error("AKORO_AGENT_TOOLS_CAPABILITY_SECRET is required to issue a tool context");
  if (!user?.id || !SESSION_ID.test(String(sessionId))) throw new Error("A valid user and sessionId are required");

  const isTeacher = TEACHER_ROLES.has(user.role);
  const hasTaskContext = taskId !== null || runId !== null;
  const scopeBinding = learningScope(requestedLearningScope);
  if (scopeBinding && (isTeacher || hasTaskContext)) {
    throw new Error("learningScope is available only for learner capabilities");
  }
  if (hasTaskContext && (!isTeacher || !TASK_ID.test(String(taskId || "")) || !TASK_ID.test(String(runId || "")))) {
    throw new Error("Teacher task tool contexts require a valid taskId and runId");
  }
  const scope = hasTaskContext ? "teacher_task" : "student";
  const boundedTtl = Math.max(60, Math.min(Number(ttlSeconds) || 600, 900));
  const payload = {
    sub: String(user.id),
    role: String(user.role || "student"),
    sid: String(sessionId),
    scope,
    jti: randomUUID(),
    ...(hasTaskContext ? { taskId: String(taskId), runId: String(runId), courseId: courseId ? String(courseId) : null } : {}),
    ...(scopeBinding ? { learningScope: scopeBinding } : {}),
  };
  return jwt.sign(payload, secret, { algorithm: "HS256", issuer: ISSUER, audience: AUDIENCE, expiresIn: boundedTtl });
}

export function verifyAgentToolsCapability(token, sessionId) {
  const secret = capabilitySecret();
  if (!secret || !token || !SESSION_ID.test(String(sessionId))) return null;
  try {
    const claims = jwt.verify(token, secret, { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
    if (!claims || !SESSION_ID.test(String(claims.sid || "")) || claims.sid !== sessionId) return null;
    if (!claims.sub || !claims.jti || !["student", "teacher_task"].includes(claims.scope)) return null;
    if (claims.scope === "teacher_task" && (!TASK_ID.test(String(claims.taskId || "")) || !TASK_ID.test(String(claims.runId || "")))) return null;
    return claims;
  } catch {
    return null;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((normalised, key) => {
      // JSON request bodies cannot normally contain undefined, but dropping it
      // matches JSON.stringify and prevents different representations hashing
      // as different approved actions.
      if (value[key] !== undefined) normalised[key] = canonicalJson(value[key]);
      return normalised;
    }, {});
  }
  return value;
}

/** Stable digest binding a confirmation to one exact validated tool payload. */
export function agentToolArgumentsDigest(arguments_) {
  return createHash("sha256").update(JSON.stringify(canonicalJson(arguments_))).digest("hex");
}

/**
 * A short-lived, one-use candidate token delivered only after the authenticated
 * learner reviews a pending operation. The database confirmation row remains
 * authoritative and is consumed by the private gateway before it executes.
 */
export function issueAgentToolsWriteConfirmation({
  userId, sessionId, capabilityJti, confirmationId, toolName, argumentsDigest, ttlSeconds = 300,
}) {
  const secret = capabilitySecret();
  if (!secret) throw new Error("AKORO_AGENT_TOOLS_CAPABILITY_SECRET is required to issue a write confirmation");
  if (!userId || !SESSION_ID.test(String(sessionId)) || !capabilityJti || !confirmationId
      || !/^[a-z][a-z0-9_]{0,79}$/.test(String(toolName)) || !/^[a-f0-9]{64}$/i.test(String(argumentsDigest))) {
    throw new Error("A valid confirmed action is required");
  }
  const boundedTtl = Math.max(60, Math.min(Number(ttlSeconds) || 300, 600));
  return jwt.sign({
    sub: String(userId),
    sid: String(sessionId),
    scope: "student_write_confirmation",
    capabilityJti: String(capabilityJti),
    confirmationId: String(confirmationId),
    toolName: String(toolName),
    argumentsDigest: String(argumentsDigest),
    jti: randomUUID(),
  }, secret, { algorithm: "HS256", issuer: ISSUER, audience: CONFIRMATION_AUDIENCE, expiresIn: boundedTtl });
}

export function verifyAgentToolsWriteConfirmation(token, { claims, sessionId } = {}) {
  const secret = capabilitySecret();
  if (!secret || !token || !claims || !SESSION_ID.test(String(sessionId))) return null;
  try {
    const confirmation = jwt.verify(token, secret, {
      algorithms: ["HS256"], issuer: ISSUER, audience: CONFIRMATION_AUDIENCE,
    });
    if (!confirmation || confirmation.scope !== "student_write_confirmation"
        || confirmation.sub !== claims.sub || confirmation.sid !== sessionId
        || confirmation.capabilityJti !== claims.jti || !confirmation.confirmationId
        || !/^[a-z][a-z0-9_]{0,79}$/.test(String(confirmation.toolName || ""))
        || !/^[a-f0-9]{64}$/i.test(String(confirmation.argumentsDigest || ""))) return null;
    return confirmation;
  } catch {
    return null;
  }
}

export function isTeacherRole(role) {
  return TEACHER_ROLES.has(role);
}
