/**
 * Private Akoro API gateway for the Python agent's function tools.
 *
 * This router is deliberately not mounted under a browser feature path. Every
 * request needs both the deployed Python service credential and a short-lived,
 * session-bound capability minted by an authenticated Akoro API bridge.
 */
import { Router } from "express";

import db from "../../db.js";
import { CHAT_TOOLS, executeChatTool } from "../adaptive-learning/chat.js";
import { getToolsForTask } from "../tasks/tools/index.js";
import {
  isTeacherRole,
  requireAgentToolsCredential,
  verifyAgentToolsCapability,
} from "./capability.js";

const router = Router();
const MAX_IDEMPOTENCY_KEY = 180;
const MAX_CATALOGUE = 24;
const STUDENT_WRITE_TOOLS = new Set([
  "create_task",
  "schedule_chat_follow_up",
  "cancel_scheduled_chat_follow_up",
]);
class GatewayError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function boundedText(value, max = 500) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);
}

function readRequest(req) {
  const body = req.body || {};
  const sessionId = body.sessionId;
  const toolContext = body.toolContext;
  if (!validId(sessionId) || typeof toolContext !== "string" || toolContext.length > 4_096) {
    throw new GatewayError(422, "sessionId and toolContext are required");
  }
  const claims = verifyAgentToolsCapability(toolContext, sessionId);
  if (!claims) throw new GatewayError(403, "Invalid or expired tool context");
  return { body, sessionId, claims };
}

async function currentPrincipal(claims) {
  const { data, error } = await db.from("users")
    .select("id, role, is_active")
    .eq("id", claims.sub)
    .maybeSingle();
  if (error) throw new GatewayError(503, "Agent tools identity lookup is unavailable");
  if (!data || !data.is_active) throw new GatewayError(403, "Tool context principal is unavailable");
  if (claims.scope === "teacher_task" && !isTeacherRole(data.role)) {
    throw new GatewayError(403, "This tool context no longer has teacher access");
  }
  return data;
}

async function teacherTaskContext(claims, principal) {
  if (claims.scope !== "teacher_task") throw new GatewayError(403, "Teacher task context is required");
  const { data: task, error: taskError } = await db.from("tasks")
    .select("id, creator_id, course_id, status")
    .eq("id", claims.taskId)
    .maybeSingle();
  if (taskError) throw new GatewayError(503, "Agent tools task lookup is unavailable");
  if (!task || String(task.creator_id) !== String(principal.id)) {
    throw new GatewayError(403, "Tool context does not own this task");
  }
  const { data: run, error: runError } = await db.from("task_runs")
    .select("id, task_id, status")
    .eq("id", claims.runId)
    .eq("task_id", task.id)
    .maybeSingle();
  if (runError) throw new GatewayError(503, "Agent tools run lookup is unavailable");
  if (!run || run.status !== "running") {
    throw new GatewayError(409, "The task execution context is no longer running");
  }

  // A capability can narrow a general task to one course, but can never widen
  // a task already attached to a course. Recheck ownership rather than trusting
  // a course id supplied by Python or a model tool argument.
  const courseId = claims.courseId || task.course_id || null;
  if (claims.courseId && task.course_id && String(claims.courseId) !== String(task.course_id)) {
    throw new GatewayError(403, "Tool context course does not match the task");
  }
  if (courseId) {
    const { data: course, error: courseError } = await db.from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("instructor_id", principal.id)
      .maybeSingle();
    if (courseError) throw new GatewayError(503, "Agent tools course lookup is unavailable");
    if (!course) throw new GatewayError(403, "Tool context does not own this course");
  }
  return { task, run, courseId };
}

async function assertCourseScopedArguments(arguments_, context, principal) {
  const requested = [arguments_.courseId, arguments_.course_id]
    .filter((id) => id !== undefined && id !== null);
  if (!requested.length) return context.courseId || null;
  if (requested.some((id) => !validId(String(id)))) {
    throw new GatewayError(422, "courseId is invalid");
  }
  if (context.courseId && requested.some((id) => String(id) !== String(context.courseId))) {
    throw new GatewayError(403, "Tool arguments are outside the task course scope");
  }
  if (context.courseId) return context.courseId;

  // General tasks are permitted to target an explicit course only when it is
  // currently owned by the capability principal. This closes the read path in
  // fetch_student_data as well as write-oriented course tools.
  for (const courseId of new Set(requested.map(String))) {
    const { data: course, error } = await db.from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("instructor_id", principal.id)
      .maybeSingle();
    if (error) throw new GatewayError(503, "Agent tools course lookup is unavailable");
    if (!course) throw new GatewayError(403, "Tool arguments reference an unavailable course");
  }
  return String(requested[0]);
}

async function assertStudentScopedArguments(arguments_, courseId) {
  const students = [
    arguments_.studentId,
    arguments_.opponentId,
    ...(Array.isArray(arguments_.studentIds) ? arguments_.studentIds : []),
  ].filter((id) => id !== undefined && id !== null)
    .map(String);
  if (!students.length) return;
  if (!courseId) {
    // A student id alone has no owner relationship. Never let a general task
    // turn it into a cross-course grading or notification operation.
    throw new GatewayError(403, "Student-targeted tools require a course-scoped task or argument");
  }
  if (students.some((id) => !validId(id))) throw new GatewayError(422, "studentId is invalid");
  const requested = [...new Set(students)];
  const { data, error } = await db.from("enrollments")
    .select("user_id")
    .eq("course_id", courseId)
    .in("user_id", requested);
  if (error) throw new GatewayError(503, "Agent tools enrolment lookup is unavailable");
  if (new Set((data || []).map((row) => String(row.user_id))).size !== requested.length) {
    throw new GatewayError(403, "Student arguments are outside the course scope");
  }
}

function validateStudentArguments(name, arguments_) {
  const keys = Object.keys(arguments_);
  const only = (allowed) => {
    if (keys.some((key) => !allowed.has(key))) throw new GatewayError(422, "Unexpected student tool argument");
  };
  const shortText = (value, label, required = false, max = 500) => {
    if (value === undefined && !required) return;
    if (typeof value !== "string" || !value.trim() || value.length > max) {
      throw new GatewayError(422, `${label} is invalid`);
    }
  };

  switch (name) {
    case "check_progress":
    case "list_tasks":
    case "find_battles":
    case "get_ranking":
      only(new Set());
      return;
    case "get_weak_topics":
      only(new Set(["subject"]));
      shortText(arguments_.subject, "subject");
      return;
    case "create_task":
      only(new Set(["title", "priority", "due", "course"]));
      shortText(arguments_.title, "title", true);
      if (!["high", "medium", "low"].includes(arguments_.priority)) {
        throw new GatewayError(422, "priority is invalid");
      }
      shortText(arguments_.due, "due");
      shortText(arguments_.course, "course");
      return;
    case "schedule_chat_follow_up":
      only(new Set(["message", "scheduledAt", "timezone", "title"]));
      shortText(arguments_.message, "message", true, 800);
      shortText(arguments_.scheduledAt, "scheduledAt", true, 64);
      shortText(arguments_.timezone, "timezone", false, 80);
      shortText(arguments_.title, "title", false, 80);
      return;
    case "list_scheduled_chat_follow_ups":
      only(new Set());
      return;
    case "cancel_scheduled_chat_follow_up":
      only(new Set(["followUpId"]));
      if (typeof arguments_.followUpId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(arguments_.followUpId)) {
        throw new GatewayError(422, "followUpId is invalid");
      }
      return;
    default:
      throw new GatewayError(404, "Student tool is not available");
  }
}

function publicTool(definition, sideEffecting) {
  return {
    name: definition.name,
    description: boundedText(definition.description, 800),
    inputSchema: definition.input_schema,
    sideEffecting,
    maxCalls: sideEffecting ? 1 : 2,
  };
}

async function entitledTeacherTools(task) {
  const candidates = await getToolsForTask(task);
  // getToolsForTask applies this normally. Repeat the narrow entitlement filter
  // here so an import or entitlement-service failure cannot accidentally turn
  // a paid instructor tool into an unrestricted gateway function.
  try {
    const { TOOL_GATES, getUnlockedToolKeys } = await import("../instructor/toolAccess.js");
    const unlocked = await getUnlockedToolKeys(task.creator_id);
    return candidates.filter(({ definition }) => {
      const entitlement = TOOL_GATES[definition.name];
      return !entitlement || unlocked.has(entitlement);
    });
  } catch (error) {
    console.error("[agent-tools/entitlements]", error.message);
    const { TOOL_GATES } = await import("../instructor/toolAccess.js").catch(() => ({ TOOL_GATES: {} }));
    return candidates.filter(({ definition }) => !TOOL_GATES[definition.name]);
  }
}

async function catalogueFor(claims, principal) {
  if (claims.scope === "student") {
    // A student capability always operates on its signed principal, even when
    // that principal happens to have an instructor account too.
    return CHAT_TOOLS.map((tool) => publicTool(tool, STUDENT_WRITE_TOOLS.has(tool.name)));
  }

  const { task } = await teacherTaskContext(claims, principal);
  const tools = await entitledTeacherTools(task);
  return tools.slice(0, MAX_CATALOGUE).map(({ definition }) =>
    publicTool(definition, true), // task tools persist outputs or change platform state
  );
}

async function registeredTeacherTool(claims, principal, name) {
  const { task, run, courseId } = await teacherTaskContext(claims, principal);
  const registered = (await entitledTeacherTools(task)).find((item) => item.definition.name === name);
  if (!registered) throw new GatewayError(404, "Tool is not available for this task context");
  return {
    registered,
    context: {
      taskId: task.id,
      runId: run.id,
      teacherId: principal.id,
      courseId,
    },
  };
}

function normaliseToolOutcome(outcome) {
  if (outcome && typeof outcome === "object" && outcome.success === false) {
    return { success: false, error: boundedText(outcome.error || "Tool operation was not completed") };
  }
  if (outcome && typeof outcome === "object" && outcome.error) {
    return { success: false, error: boundedText(outcome.error) };
  }
  return { success: true, result: outcome && typeof outcome === "object" ? outcome : { value: outcome ?? null } };
}

async function priorInvocation(capabilityJti, idempotencyKey) {
  const { data, error } = await db.schema("edu").from("agent_tool_invocations")
    .select("status, response, tool_name")
    .eq("capability_jti", capabilityJti)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw new GatewayError(503, "Agent tools idempotency store is unavailable");
  return data;
}

async function claimInvocation({ claims, principal, name, idempotencyKey }) {
  const existing = await priorInvocation(claims.jti, idempotencyKey);
  if (existing) return { existing, created: false };
  const { error } = await db.schema("edu").from("agent_tool_invocations").insert({
    capability_jti: claims.jti,
    idempotency_key: idempotencyKey,
    principal_id: principal.id,
    tool_name: name,
    status: "running",
  });
  if (!error) return { existing: null, created: true };
  // A simultaneous retry is normal under network failures. Read the winner
  // rather than performing a second write-capable invocation.
  if (error.code === "23505") return { existing: await priorInvocation(claims.jti, idempotencyKey), created: false };
  throw new GatewayError(503, "Agent tools idempotency store is unavailable");
}

async function completeInvocation(claims, idempotencyKey, response) {
  const { error } = await db.schema("edu").from("agent_tool_invocations")
    .update({ status: "completed", response, completed_at: new Date().toISOString() })
    .eq("capability_jti", claims.jti)
    .eq("idempotency_key", idempotencyKey);
  if (error) throw new GatewayError(503, "Agent tools idempotency store is unavailable");
}

router.post("/catalog", requireAgentToolsCredential, async (req, res) => {
  try {
    const { claims } = readRequest(req);
    const principal = await currentPrincipal(claims);
    res.json({ tools: await catalogueFor(claims, principal) });
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : 500;
    if (!(error instanceof GatewayError)) console.error("[agent-tools/catalog]", error.message);
    res.status(status).json({ success: false, error: error instanceof GatewayError ? error.message : "Agent tools catalogue could not be loaded" });
  }
});

router.post("/invoke", requireAgentToolsCredential, async (req, res) => {
  try {
    const { body, claims } = readRequest(req);
    const name = typeof body.tool === "string" ? body.tool : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(name) || !idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
      throw new GatewayError(422, "tool and idempotencyKey are invalid");
    }
    if (!body.arguments || typeof body.arguments !== "object" || Array.isArray(body.arguments)) {
      throw new GatewayError(422, "arguments must be an object");
    }
    const principal = await currentPrincipal(claims);
    const catalogue = await catalogueFor(claims, principal);
    if (!catalogue.some((tool) => tool.name === name)) throw new GatewayError(404, "Tool is not available for this context");
    if (claims.scope === "student") validateStudentArguments(name, body.arguments);

    const claim = await claimInvocation({ claims, principal, name, idempotencyKey });
    if (!claim.created) {
      if (!claim.existing || claim.existing.status === "running") {
        throw new GatewayError(409, "An invocation with this idempotency key is already running");
      }
      if (claim.existing.tool_name !== name) {
        throw new GatewayError(409, "An idempotency key cannot be reused for another tool");
      }
      return res.json(claim.existing.response);
    }

    let response;
    try {
      let outcome;
      if (claims.scope === "student") {
        outcome = await executeChatTool(name, body.arguments, principal.id);
      } else {
        const teacherTool = await registeredTeacherTool(claims, principal, name);
        const courseId = await assertCourseScopedArguments(body.arguments, teacherTool.context, principal);
        await assertStudentScopedArguments(body.arguments, courseId);
        outcome = await teacherTool.registered.execute(body.arguments, teacherTool.context);
      }
      response = normaliseToolOutcome(outcome);
    } catch (error) {
      console.error("[agent-tools/invoke]", { tool: name, message: error.message });
      response = { success: false, error: "Tool operation could not be completed" };
    }
    await completeInvocation(claims, idempotencyKey, response);
    return res.json(response);
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : 500;
    if (!(error instanceof GatewayError)) console.error("[agent-tools/invoke]", error.message);
    return res.status(status).json({ success: false, error: error instanceof GatewayError ? error.message : "Agent tools invocation failed" });
  }
});

export default router;
