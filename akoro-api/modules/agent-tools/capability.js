/**
 * Private tool-gateway credentials and short-lived, session-bound capabilities.
 *
 * A Python service credential says only “this is the deployed agent service”.
 * It deliberately does NOT identify a learner. The `toolContext` JWT bridges
 * that gap: Akoro API mints it after authenticating/authorising the user and
 * the gateway verifies it on every catalogue and invocation request.
 */
import jwt from "jsonwebtoken";
import { randomUUID, timingSafeEqual } from "node:crypto";

const ISSUER = "akoro-api-agent-tools";
const AUDIENCE = "akoro-python-agent-tools";
const SESSION_ID = /^[A-Za-z0-9_-]{1,180}$/;
const TASK_ID = /^[A-Za-z0-9_-]{1,180}$/;
const TEACHER_ROLES = new Set(["instructor", "teacher", "school", "school_admin", "admin"]);

function gatewaySecret() {
  return (process.env.AKORO_AGENT_TOOLS_SECRET || "").trim();
}

function capabilitySecret() {
  return (process.env.AKORO_AGENT_TOOLS_CAPABILITY_SECRET || "").trim();
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireAgentToolsCredential(req, res, next) {
  const expected = gatewaySecret();
  if (!expected) {
    return res.status(503).json({ success: false, error: "Agent tools gateway is not configured" });
  }
  if (!safeEqual(req.get("X-Akoro-Tools-Secret"), expected)) {
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
export function issueAgentToolsCapability({ user, sessionId, taskId = null, runId = null, courseId = null, ttlSeconds = 600 }) {
  const secret = capabilitySecret();
  if (!secret) throw new Error("AKORO_AGENT_TOOLS_CAPABILITY_SECRET is required to issue a tool context");
  if (!user?.id || !SESSION_ID.test(String(sessionId))) throw new Error("A valid user and sessionId are required");

  const isTeacher = TEACHER_ROLES.has(user.role);
  const hasTaskContext = taskId !== null || runId !== null;
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

export function isTeacherRole(role) {
  return TEACHER_ROLES.has(role);
}
