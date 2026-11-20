import db from "../../db.js";
import { getLearnerProfileContext } from "../../lib/learnerProfileContext.js";
import { isIanaTimeZone, localiseInstant } from "../../lib/learnerTime.js";
import { isTeacherRole, verifyAgentToolsCapability } from "./capability.js";
import { normaliseToolRequest } from "../agent-tool-requests/index.js";

export const MAX_IDEMPOTENCY_KEY = 180;
export const MAX_CATALOGUE = 24;
export const STUDENT_WRITE_TOOLS = new Set([
  "create_task",
  "schedule_chat_follow_up",
  "cancel_scheduled_chat_follow_up",
  "submit_tool_request",
  "create_goal",
  "update_goal_progress",
  "save_blog_draft",
  "publish_blog",
]);
// Instructor activity-creation tools (human-in-the-loop): they only PREPARE
// private drafts — assigning is always the instructor's own action in the
// instructor app, so no learner-facing write confirmation applies here.
export const TEACHER_DRAFT_TOOLS = new Set([
  "prepare_activity",
  "list_activity_drafts",
  "get_activity_draft",
  "revise_activity_draft",
  "discard_activity_draft",
  "check_activity_outcomes",
  "get_my_profile",
  "schedule_activity_routine",
  "list_activity_routines",
  "cancel_activity_routine",
]);

export class GatewayError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function boundedText(value, max = 500) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

export function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);
}

export function readRequest(req) {
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

export async function currentPrincipal(claims) {
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

export async function teacherTaskContext(claims, principal) {
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

export async function assertCourseScopedArguments(arguments_, context, principal) {
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

export async function assertStudentScopedArguments(arguments_, courseId) {
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

export function validateStudentArguments(name, arguments_) {
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
    case "get_agent_capabilities":
    case "get_learner_context":
    case "check_progress":
    case "get_my_school":
    case "list_school_subjects":
    case "list_my_teachers":
    case "get_my_learning_sessions":
    case "list_tasks":
    case "find_battles":
    case "get_ranking":
    case "get_learning_overview":
    case "get_learning_insights_summary":
    case "get_exam_prep_status":
    case "get_chat_memory":
    case "get_agent_preferences":
    case "get_autonomy_status":
      only(new Set());
      return;
    case "get_weak_topics":
    case "get_knowledge_map":
    case "get_concept_tracker_summary":
      only(new Set(["subject"]));
      shortText(arguments_.subject, "subject", false, 180);
      return;
    case "search_my_study_knowledge":
      only(new Set(["query", "subject"]));
      shortText(arguments_.query, "query", true, 300);
      shortText(arguments_.subject, "subject", false, 180);
      if (arguments_.query.trim().length < 3) throw new GatewayError(422, "query must be at least three characters");
      return;
    case "find_teacher":
      only(new Set(["name"]));
      shortText(arguments_.name, "name", true, 120);
      return;
    case "submit_tool_request":
      only(new Set(["title", "description", "category"]));
      try { normaliseToolRequest(arguments_); }
      catch (error) { throw new GatewayError(422, error.message); }
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
    case "consult_peer_agents":
      only(new Set(["question", "topic"]));
      shortText(arguments_.question, "question", true, 300);
      if (arguments_.question.trim().length < 10) throw new GatewayError(422, "question must be at least ten characters");
      if (arguments_.topic !== undefined && !["study_habits", "exam_prep", "streaks", "motivation", "goals", "subjects", "general"].includes(arguments_.topic)) {
        throw new GatewayError(422, "topic is invalid");
      }
      return;
    case "search_blog_posts":
      only(new Set(["query", "category", "limit"]));
      shortText(arguments_.query, "query", false, 120);
      shortText(arguments_.category, "category", false, 60);
      if (arguments_.limit !== undefined && (typeof arguments_.limit !== "number" || arguments_.limit < 1 || arguments_.limit > 8)) {
        throw new GatewayError(422, "limit is invalid");
      }
      return;
    case "read_blog_post":
      only(new Set(["slug"]));
      shortText(arguments_.slug, "slug", true, 200);
      return;
    case "list_my_goals":
    case "list_my_proposals":
    case "list_my_blogs":
      only(new Set());
      return;
    case "create_goal":
      only(new Set(["title", "category", "metric", "exam", "targetDate"]));
      shortText(arguments_.title, "title", true, 120);
      shortText(arguments_.category, "category", false, 40);
      shortText(arguments_.metric, "metric", false, 160);
      shortText(arguments_.exam, "exam", false, 40);
      if (arguments_.targetDate !== undefined && (typeof arguments_.targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(arguments_.targetDate.trim()))) {
        throw new GatewayError(422, "targetDate must be YYYY-MM-DD");
      }
      return;
    case "update_goal_progress":
      only(new Set(["goalId", "status", "progressNote", "targetDate"]));
      if (typeof arguments_.goalId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(arguments_.goalId)) {
        throw new GatewayError(422, "goalId is invalid");
      }
      if (arguments_.status !== undefined && !["active", "paused", "achieved"].includes(arguments_.status)) {
        throw new GatewayError(422, "status is invalid");
      }
      shortText(arguments_.progressNote, "progressNote", false, 500);
      if (arguments_.targetDate !== undefined && (typeof arguments_.targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(arguments_.targetDate.trim()))) {
        throw new GatewayError(422, "targetDate must be YYYY-MM-DD");
      }
      return;
    case "save_blog_draft":
    case "publish_blog":
      only(new Set(["blogId", "title", "body"]));
      if (arguments_.blogId !== undefined && (typeof arguments_.blogId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(arguments_.blogId))) {
        throw new GatewayError(422, "blogId is invalid");
      }
      shortText(arguments_.title, "title", true, 120);
      shortText(arguments_.body, "body", true, 50_000);
      return;
    default:
      throw new GatewayError(404, "Student tool is not available");
  }
}

export function publicTool(definition, sideEffecting) {
  return {
    name: definition.name,
    description: boundedText(definition.description, 800),
    inputSchema: definition.input_schema,
    sideEffecting,
    maxCalls: sideEffecting ? 1 : 2,
  };
}

export function normaliseToolOutcome(outcome) {
  if (outcome && typeof outcome === "object" && outcome.success === false) {
    return { success: false, error: boundedText(outcome.error || "Tool operation was not completed") };
  }
  if (outcome && typeof outcome === "object" && outcome.error) {
    return { success: false, error: boundedText(outcome.error) };
  }
  return { success: true, result: outcome && typeof outcome === "object" ? outcome : { value: outcome ?? null } };
}

export function invocationDetails(body, idempotencyField = "idempotencyKey") {
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

export async function freezeLearnerWriteTimezone(name, arguments_, userId) {
  // The reviewed text and the eventual write must agree even if an account
  // timezone is edited between review and redemption. Copy first so request
  // parsing/model-owned input is never mutated after validation.
  if (!["create_task", "schedule_chat_follow_up"].includes(name) || arguments_.timezone) return arguments_;
  const context = await getLearnerProfileContext(userId);
  return { ...arguments_, timezone: context.timeZone };
}

export async function confirmationPreview(name, arguments_, principalId) {
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
    case "submit_tool_request": {
      const request = normaliseToolRequest(arguments_);
      return {
        kind: "submit_tool_request",
        title: request.title,
        description: request.description,
        category: request.category,
        note: "This sends private product feedback to Akoro admins; it does not perform the requested feature now.",
      };
    }
    case "create_goal":
      return {
        kind: "create_goal",
        title: boundedText(arguments_.title, 120),
        category: boundedText(arguments_.category ?? "", 40),
        targetDate: arguments_.targetDate ?? null,
        note: "This adds a goal to the learner's shelf.",
      };
    case "update_goal_progress":
      return {
        kind: "update_goal_progress",
        goalId: arguments_.goalId,
        status: arguments_.status ?? null,
        progressNote: boundedText(arguments_.progressNote ?? "", 300),
        note: "This updates one of the learner's goals.",
      };
    case "save_blog_draft":
      return {
        kind: "save_blog_draft",
        title: boundedText(arguments_.title, 120),
        blogId: arguments_.blogId ?? null,
        excerpt: boundedText(String(arguments_.body ?? "").split("\n").find(Boolean) ?? "", 140),
        note: "This saves a draft of the learner's blog.",
      };
    case "publish_blog":
      return {
        kind: "publish_blog",
        title: boundedText(arguments_.title, 120),
        blogId: arguments_.blogId ?? null,
        excerpt: boundedText(String(arguments_.body ?? "").split("\n").find(Boolean) ?? "", 140),
        note: "This publishes the learner's blog — it will also appear on the public blog under Community.",
      };
    default:
      return { kind: name };
  }
}
