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
import { getLearnerProfileContext } from "../adaptive-learning/learner-profile-context.js";
import { isIanaTimeZone, localiseInstant } from "../adaptive-learning/learner-time-context.js";
import { getToolsForTask } from "../tasks/tools/index.js";
import {
  isTeacherRole,
  requireAgentToolsCredential,
  verifyAgentToolsCapability,
  verifyAgentToolsWriteConfirmation,
} from "./capability.js";
import {
  consumeWriteConfirmation,
  requestWriteConfirmation,
} from "./write-confirmations.js";

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
    case "get_learner_context":
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
      only(new Set(["title", "description", "priority", "due", "dueAt", "timezone", "course"]));
      shortText(arguments_.title, "title", true, 180);
      shortText(arguments_.description, "description", false, 800);
      if (!["high", "medium", "low"].includes(arguments_.priority)) {
        throw new GatewayError(422, "priority is invalid");
      }
      shortText(arguments_.due, "due", false, 120);
      if (arguments_.dueAt !== undefined) {
        if (typeof arguments_.dueAt !== "string" || arguments_.dueAt.length > 64 || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/i.test(arguments_.dueAt.trim()) || !Number.isFinite(new Date(arguments_.dueAt).getTime())) {
          throw new GatewayError(422, "dueAt must be an ISO 8601 timestamp with a timezone offset");
        }
      }
      if (arguments_.timezone !== undefined && !isIanaTimeZone(arguments_.timezone)) {
        throw new GatewayError(422, "timezone must be a valid IANA timezone");
      }
      shortText(arguments_.course, "course", false, 120);
      return;
    case "schedule_chat_follow_up":
      only(new Set(["message", "scheduledAt", "timezone", "title"]));
      shortText(arguments_.message, "message", true, 800);
      shortText(arguments_.scheduledAt, "scheduledAt", true, 64);
      if (typeof arguments_.scheduledAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(arguments_.scheduledAt.trim()) || !Number.isFinite(new Date(arguments_.scheduledAt).getTime())) {
        throw new GatewayError(422, "scheduledAt must be an ISO 8601 timestamp with a timezone offset");
      }
      shortText(arguments_.timezone, "timezone", false, 80);
      if (arguments_.timezone !== undefined && !isIanaTimeZone(arguments_.timezone)) {
        throw new GatewayError(422, "timezone must be a valid IANA timezone");
      }
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

function invocationDetails(body, idempotencyField = "idempotencyKey") {
  const name = typeof body.tool === "string" ? body.tool : "";
  const idempotencyKey = typeof body[idempotencyField] === "string" ? body[idempotencyField] : "";
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(name) || !idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
    throw new GatewayError(422, `tool and ${idempotencyField} are invalid`);
  }
  if (!body.arguments || typeof body.arguments !== "object" || Array.isArray(body.arguments)) {
    throw new GatewayError(422, "arguments must be an object");
  }
  return { name, idempotencyKey, arguments_: body.arguments };
}

async function freezeLearnerWriteTimezone(name, arguments_, userId) {
  // The reviewed text and the eventual write must agree even if an account
  // timezone is edited between review and redemption. Copy first so request
  // parsing/model-owned input is never mutated after validation.
  if (!["create_task", "schedule_chat_follow_up"].includes(name) || arguments_.timezone) return arguments_;
  const context = await getLearnerProfileContext(userId);
  return { ...arguments_, timezone: context.timeZone };
}

async function confirmationPreview(name, arguments_, principalId) {
  switch (name) {
    case "create_task": {
      const dueAt = arguments_.dueAt || null;
      const timezone = arguments_.timezone || null;
      return {
        kind: "create_task",
        title: boundedText(arguments_.title, 180),
        description: arguments_.description ? boundedText(arguments_.description, 800) : null,
        due: arguments_.due ? boundedText(arguments_.due, 120) : null,
        dueAt,
        dueLocal: dueAt && timezone ? localiseInstant(dueAt, timezone) : null,
        timezone,
        course: arguments_.course ? boundedText(arguments_.course, 120) : null,
      };
    }
    case "schedule_chat_follow_up": {
      const scheduledAt = arguments_.scheduledAt;
      const timezone = arguments_.timezone;
      return {
        kind: "schedule_chat_follow_up",
        title: arguments_.title ? boundedText(arguments_.title, 80) : "Scheduled check-in",
        message: boundedText(arguments_.message, 800),
        scheduledAt,
        scheduledLocal: localiseInstant(scheduledAt, timezone),
        timezone,
      };
    }
    case "cancel_scheduled_chat_follow_up": {
      // An opaque id alone is not a meaningful confirmation. Re-read the
      // learner-owned pending delivery so the card says exactly which future
      // message, date/time, and timezone will be cancelled.
      const { data, error } = await db.schema("edu").from("scheduled_chat_follow_ups")
        .select("id, title, message, scheduled_at, timezone")
        .eq("id", arguments_.followUpId)
        .eq("user_id", principalId)
        .eq("status", "scheduled")
        .maybeSingle();
      if (error) throw new GatewayError(503, "Could not prepare the scheduled-message cancellation");
      if (!data) throw new GatewayError(404, "The scheduled message is no longer available to cancel");
      return {
        kind: "cancel_scheduled_chat_follow_up",
        followUpId: data.id,
        title: boundedText(data.title, 80),
        message: boundedText(data.message, 800),
        scheduledAt: data.scheduled_at,
        scheduledLocal: localiseInstant(data.scheduled_at, data.timezone),
        timezone: data.timezone,
      };
    }
    default:
      return { kind: name };
  }
}

async function assertLearnerWriteProposal({ claims, principal, name, arguments_ }) {
  if (claims.scope !== "student") {
    throw new GatewayError(403, "Write confirmations are currently available only for learner account tools");
  }
  const catalogue = await catalogueFor(claims, principal);
  const definition = catalogue.find((tool) => tool.name === name);
  if (!definition) throw new GatewayError(404, "Tool is not available for this context");
  if (!definition.sideEffecting || !STUDENT_WRITE_TOOLS.has(name)) {
    throw new GatewayError(422, "Only learner write tools require confirmation");
  }
  validateStudentArguments(name, arguments_);
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

/** Execute a previously validated invocation and persist its replay result. */
async function executeInvocation({ claims, principal, name, arguments_, idempotencyKey }) {
  const claim = await claimInvocation({ claims, principal, name, idempotencyKey });
  if (!claim.created) {
    if (!claim.existing || claim.existing.status === "running") {
      throw new GatewayError(409, "An invocation with this idempotency key is already running");
    }
    if (claim.existing.tool_name !== name) {
      throw new GatewayError(409, "An idempotency key cannot be reused for another tool");
    }
    return claim.existing.response;
  }

  let response;
  try {
    let outcome;
    if (claims.scope === "student") {
      outcome = await executeChatTool(name, arguments_, principal.id);
    } else {
      const teacherTool = await registeredTeacherTool(claims, principal, name);
      const courseId = await assertCourseScopedArguments(arguments_, teacherTool.context, principal);
      await assertStudentScopedArguments(arguments_, courseId);
      outcome = await teacherTool.registered.execute(arguments_, teacherTool.context);
    }
    response = normaliseToolOutcome(outcome);
  } catch (error) {
    console.error("[agent-tools/invoke]", { tool: name, message: error.message });
    response = { success: false, error: "Tool operation could not be completed" };
  }
  await completeInvocation(claims, idempotencyKey, response);
  return response;
}

/**
 * Stage—not execute—a learner write proposed by the Python model. The returned
 * preview is what the browser must show the learner before confirmation.
 */
router.post("/confirmations", requireAgentToolsCredential, async (req, res) => {
  try {
    const { body, claims, sessionId } = readRequest(req);
    const { name, idempotencyKey: proposalKey, arguments_ } = invocationDetails(body, "proposalKey");
    const principal = await currentPrincipal(claims);
    await assertLearnerWriteProposal({ claims, principal, name, arguments_ });
    const reviewedArguments = await freezeLearnerWriteTimezone(name, arguments_, principal.id);
    const confirmation = await requestWriteConfirmation({
      claims, principal, sessionId, toolName: name, arguments_: reviewedArguments,
      preview: await confirmationPreview(name, reviewedArguments, principal.id), proposalKey,
    });
    return res.json({ success: true, result: { requiresConfirmation: true, ...confirmation } });
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : 503;
    if (!(error instanceof GatewayError)) console.error("[agent-tools/confirmations]", error.message);
    return res.status(status).json({
      success: false,
      error: error instanceof GatewayError ? error.message : "Action confirmation could not be prepared",
    });
  }
});

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

/**
 * Redeem a browser-reviewed action through the Python-only gateway. The tool
 * arguments come from the durable proposal, so a model cannot alter them after
 * the learner has read and approved the preview.
 */
router.post("/execute-confirmed", requireAgentToolsCredential, async (req, res) => {
  try {
    const { body, claims, sessionId } = readRequest(req);
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
    if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
      throw new GatewayError(422, "idempotencyKey is invalid");
    }
    const confirmation = verifyAgentToolsWriteConfirmation(body.confirmationToken, { claims, sessionId });
    if (!confirmation) throw new GatewayError(403, "A valid learner write confirmation is required");
    const principal = await currentPrincipal(claims);
    if (claims.scope !== "student") throw new GatewayError(403, "This confirmation is not valid for the current tool scope");
    const catalogue = await catalogueFor(claims, principal);
    if (!catalogue.some((tool) => tool.name === confirmation.toolName && tool.sideEffecting)) {
      throw new GatewayError(403, "The confirmed tool is no longer available for this account");
    }

    // A network retry after successful execution must return its original
    // stored result even though the one-use confirmation has been consumed.
    const existing = await priorInvocation(claims.jti, idempotencyKey);
    if (existing) {
      if (existing.status === "running") throw new GatewayError(409, "An invocation with this idempotency key is already running");
      if (existing.tool_name !== confirmation.toolName) throw new GatewayError(409, "An idempotency key cannot be reused for another tool");
      return res.json(existing.response);
    }

    const approved = await consumeWriteConfirmation({ confirmation, claims, principal, sessionId });
    if (!STUDENT_WRITE_TOOLS.has(approved.toolName)) {
      throw new GatewayError(403, "This confirmation is not valid for a learner write tool");
    }
    validateStudentArguments(approved.toolName, approved.arguments_);
    const response = await executeInvocation({
      claims, principal, name: approved.toolName, arguments_: approved.arguments_, idempotencyKey,
    });
    return res.json({ ...response, confirmedTool: approved.toolName });
  } catch (error) {
    const message = error?.message || "";
    const status = error instanceof GatewayError ? error.status
      : /expired/i.test(message) ? 410
      : /invalid|already used|already being used/i.test(message) ? 409
      : 503;
    if (!(error instanceof GatewayError)) console.error("[agent-tools/execute-confirmed]", message);
    return res.status(status).json({
      success: false,
      error: error instanceof GatewayError ? error.message : "Confirmed action could not be executed",
    });
  }
});

router.post("/invoke", requireAgentToolsCredential, async (req, res) => {
  try {
    const { body, claims } = readRequest(req);
    const { name, idempotencyKey, arguments_ } = invocationDetails(body);
    const principal = await currentPrincipal(claims);
    const catalogue = await catalogueFor(claims, principal);
    if (!catalogue.some((tool) => tool.name === name)) throw new GatewayError(404, "Tool is not available for this context");
    if (claims.scope === "student") {
      validateStudentArguments(name, arguments_);
      if (STUDENT_WRITE_TOOLS.has(name)) {
        throw new GatewayError(403, "Learner write tools require a reviewed confirmation and /execute-confirmed");
      }
    }
    return res.json(await executeInvocation({ claims, principal, name, arguments_, idempotencyKey }));
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : 500;
    if (!(error instanceof GatewayError)) console.error("[agent-tools/invoke]", error.message);
    return res.status(status).json({ success: false, error: error instanceof GatewayError ? error.message : "Agent tools invocation failed" });
  }
});

export default router;
