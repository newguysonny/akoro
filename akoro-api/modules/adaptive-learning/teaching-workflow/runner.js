/**
 * Fixed, server-owned workflow runner for a learner teaching a protege.
 *
 * The model is never offered this tool catalogue for free selection. The
 * authenticated adaptive-session server invokes this fixed sequence, so a
 * generated reply, browser payload, or guide suggestion cannot skip evidence
 * observation or the deterministic progression gate.
 */
import { TEACHING_TURN_TOOL_CATALOG } from "./catalog.js";

export const TEACHING_TURN_WORKFLOW = Object.freeze({
  type: "adaptive_teaching_turn",
  policyVersion: "adaptive-teaching-workflow-v1",
  tools: Object.freeze([
    "load_session_state",
    "observe_teaching_evidence",
    "generate_protege_discussion",
    "assess_protege_understanding",
    "persist_cognitive_state",
    "record_verified_learning",
    "coach_teaching_dialogue",
    "gate_teaching_progress",
  ]),
});

const TOOL_BY_NAME = new Map(TEACHING_TURN_TOOL_CATALOG.map((tool) => [tool.name, tool]));

function publicStep(name, status) {
  const tool = TOOL_BY_NAME.get(name);
  return {
    workflow: TEACHING_TURN_WORKFLOW.type,
    policyVersion: TEACHING_TURN_WORKFLOW.policyVersion,
    step: name,
    label: tool?.label || "Updating teaching session",
    status,
  };
}

/**
 * Runs an explicitly supplied tool registry in the only permitted order.
 * Exported for deterministic tests; production uses executeTeachingTurnWorkflow
 * below. Outputs are deliberately not surfaced—only public step labels are.
 */
export async function runTeachingWorkflowTools({ context, tools, onStep = null }) {
  for (const name of TEACHING_TURN_WORKFLOW.tools) {
    const tool = tools?.[name];
    if (!tool || typeof tool.execute !== "function") {
      throw new Error(`Adaptive teaching workflow tool is unavailable: ${name}`);
    }
    onStep?.(publicStep(name, "started"));
    try {
      await tool.execute(context);
      context.completedTools.push(name);
      onStep?.(publicStep(name, "completed"));
    } catch (error) {
      // This is observable operational state, not a model rationale or the
      // learner's message. Let the owning socket handler report the error.
      onStep?.(publicStep(name, "failed"));
      throw error;
    }
  }
  return context;
}

/** Execute one complete learner-teaches-protege turn. */
export async function executeTeachingTurnWorkflow({
  orchestrator,
  humanMessage,
  callbacks = {},
  phaseLabels,
  actionForDialogueMove,
}) {
  const session = orchestrator?.session;
  if (!orchestrator?.studentAgent || !orchestrator?.studentAgentRecord || !session?.topic) {
    throw new Error("Adaptive teaching workflow requires an initialized session");
  }

  const context = {
    orchestrator,
    humanMessage,
    callbacks,
    phaseLabels,
    actionForDialogueMove,
    topic: session.topic,
    phase: session.phase,
    mustKnowParts: Array.isArray(session.mustKnowParts) ? session.mustKnowParts : [],
    mustKnowIndex: Number.isInteger(session.mustKnowIndex) ? session.mustKnowIndex : 0,
    history: Array.isArray(session.history) ? session.history : [],
    subject: orchestrator.decayPayload?.subject || null,
    agentId: orchestrator.studentAgentRecord.id,
    studentId: orchestrator.studentId,
    completedTools: [],
  };
  // Keep this import inside the production path. The workflow contract and its
  // deterministic ordering remain dependency-free and directly testable.
  const { createTeachingTurnTools } = await import("./tools.js");
  const tools = createTeachingTurnTools();
  await runTeachingWorkflowTools({
    context,
    tools,
    onStep: callbacks.onWorkflowStep || null,
  });
  context.publicWorkflow = {
    type: TEACHING_TURN_WORKFLOW.type,
    policyVersion: TEACHING_TURN_WORKFLOW.policyVersion,
    state: "completed",
    completedTools: [...context.completedTools],
  };
  return context;
}
