import { chatBridge } from "../../lib/chatBridge.js";
import { getToolsForTask } from "../tasks/index.js";
import { verifyAgentToolsWriteConfirmation } from "./capability.js";
import { consumeWriteConfirmation, requestWriteConfirmation } from "./write-confirmations.js";
import {
  GatewayError,
  MAX_CATALOGUE,
  MAX_IDEMPOTENCY_KEY,
  STUDENT_WRITE_TOOLS,
  TEACHER_DRAFT_TOOLS,
  assertCourseScopedArguments,
  assertStudentScopedArguments,
  confirmationPreview,
  currentPrincipal,
  freezeLearnerWriteTimezone,
  invocationDetails,
  normaliseToolOutcome,
  publicTool,
  readRequest,
  teacherTaskContext,
  validateStudentArguments,
} from "./gateway-rules.js";
import * as invocationStore from "./gateway-store.js";

async function entitledTeacherTools(task) {
  const candidates = await getToolsForTask(task);
  // getToolsForTask applies this normally. Repeat the narrow entitlement filter
  // here so an import or entitlement-service failure cannot accidentally turn
  // a paid instructor tool into an unrestricted gateway function.
  try {
    const { TOOL_GATES, getUnlockedToolKeys } = await import("../../lib/toolAccess.js");
    const unlocked = await getUnlockedToolKeys(task.creator_id);
    return candidates.filter(({ definition }) => {
      const entitlement = TOOL_GATES[definition.name];
      return !entitlement || unlocked.has(entitlement);
    });
  } catch (error) {
    console.error("[agent-tools/entitlements]", error.message);
    const { TOOL_GATES } = await import("../../lib/toolAccess.js").catch(() => ({ TOOL_GATES: {} }));
    return candidates.filter(({ definition }) => !TOOL_GATES[definition.name]);
  }
}

async function catalogueFor(claims, principal) {
  if (claims.scope === "student") {
    // A student capability always operates on its signed principal, even when
    // that principal happens to have an instructor account too.
    return chatBridge().getLearnerChatTools().map((tool) => publicTool(tool, STUDENT_WRITE_TOOLS.has(tool.name)));
  }

  const { task } = await teacherTaskContext(claims, principal);
  const tools = await entitledTeacherTools(task);
  const taskTools = tools.slice(0, MAX_CATALOGUE - chatBridge().INSTRUCTOR_TOOLS.length).map(({ definition }) =>
    publicTool(definition, true), // task tools persist outputs or change platform state
  );
  // The instructor's activity-creation tools ride every teacher task context:
  // the agent may PREPARE activity drafts (private until the instructor
  // previews and assigns them in the instructor app). Same kill-switch as
  // the chat loop.
  if (String(process.env.AKORO_ACTIVITY_DRAFTS_ENABLED || "").toLowerCase() === "false") {
    return taskTools;
  }
  // run_teaching_tool is also a task-engine tool: keep one copy (the task engine's).
  const taken = new Set(taskTools.map((t) => t.name));
  const draftTools = chatBridge().INSTRUCTOR_TOOLS.filter((tool) => !taken.has(tool.name)).map((tool) =>
    publicTool(tool, true), // prepare_activity writes a draft row; the others manage drafts
  );
  return [...taskTools, ...draftTools];
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

/** Execute a previously validated invocation and persist its replay result. */
async function executeInvocation({ claims, principal, name, arguments_, idempotencyKey }) {
  const claim = await invocationStore.claimInvocation({ claims, principal, name, idempotencyKey });
  if (!claim.created) {
    if (!claim.existing || claim.existing.status === "running") {
      throw new GatewayError(409, "An invocation with this idempotency key is already running");
    }
    if (claim.existing.tool_name !== name) {
      throw new GatewayError(409, "An idempotency key cannot be reused for another tool");
    }
    return claim.existing.response;
  }

  let response; const chat = chatBridge();
  try {
    let outcome;
    if (claims.scope === "student") {
      outcome = await chat.executeChatTool(name, arguments_, principal.id);
    } else if (TEACHER_DRAFT_TOOLS.has(name)) {
      // Instructor activity drafts: executed against the principal's own
      // account under the instructor role. No task registration and no
      // course scoping — a draft reaches nobody until a human assigns it.
      // channel: task_run — a draft prepared outside live chat nudges the
      // instructor (bell), since there is no Preview button in a conversation.
      outcome = await chat.executeChatTool(name, arguments_, principal.id, { role: "instructor", channel: "task_run" });
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
  await invocationStore.completeInvocation(claims, idempotencyKey, response);
  return response;
}

/**
 * Stage—not execute—a learner write proposed by the Python model. The returned
 * preview is what the browser must show the learner before confirmation.
 */
export async function prepareConfirmation(req, res) {
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
}

export async function catalog(req, res) {
  try {
    const { claims } = readRequest(req);
    const principal = await currentPrincipal(claims);
    res.json({ tools: await catalogueFor(claims, principal) });
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : 500;
    if (!(error instanceof GatewayError)) console.error("[agent-tools/catalog]", error.message);
    res.status(status).json({ success: false, error: error instanceof GatewayError ? error.message : "Agent tools catalogue could not be loaded" });
  }
}

/**
 * Redeem a browser-reviewed action through the Python-only gateway. The tool
 * arguments come from the durable proposal, so a model cannot alter them after
 * the learner has read and approved the preview.
 */
export async function executeConfirmed(req, res) {
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
    const existing = await invocationStore.priorInvocation(claims.jti, idempotencyKey);
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
}

export async function invoke(req, res) {
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
}
