/**
 * teaching-session/start.js — the ONE way a learner's teaching session is
 * prepared, for every transport: the adaptive socket (start_adaptive_session)
 * and the agent bridge (agent-tools/teaching-workflow-routes.js, used by the
 * Python agent). Grand Plan D42/D43.
 *
 *   fresh         a new lesson
 *   continuation  resumes an earlier session of THIS learner (ownership checked
 *                 in the loader): its conversation, position and evidence
 *   decay         a review: the decay payload, the learner's own alert (if
 *                 any, ownership checked), and the last lesson on the topic
 *
 * Always the gated student session (phases move only on evidence, D42), with
 * the lesson ladder resolved before initialize(). The caller persists the
 * session (createSessionRecord) and reports it the way its transport needs.
 */
import { getOrchestrator } from "../agents/registry.js";
import { getOrCreateStudentAgent } from "../agents/student/knowledge.js";
import { decayEngine } from "../agents/student/decayEngine.js";
import { resolveLadder } from "../lessonLadder.js";
import { NaNaEsumai } from "../agents/nana-esumai/guide.js";
import { resolveSessionDocument } from "../documentGrounding.js";
import { loadContinuationContext, loadDecayPriorLesson } from "./context.js";

export const TEACHING_MODES = Object.freeze(["fresh", "continuation", "decay"]);

/**
 * → { orchestrator, init, mode, sessionType, decayPayload, historyBlocks,
 *     priorBlocks, ladder }
 * `studentId` and `caller` must come from an authenticated identity, never
 * from the client. `reference` must already be normalised by the caller.
 */
export async function prepareTeachingSession({
  studentId, caller = studentId, topic, subject = null, mode = "fresh",
  prevSessionId = null, notificationId = null, reference = null, document = null, teacherAgentId = null,
  focus = null,
}) {
  if (!TEACHING_MODES.includes(mode)) throw Object.assign(new Error("mode is invalid"), { status: 422 });
  let historyBlocks = [];
  let decayPayload = null;
  let sessionType = "free_teaching";
  let resumeFrom = null;
  let resumeTeachingEvidence = null;
  // The previous conversation, restored as agent memory (continuation) or as
  // review context (decay). UI chrome is filtered out by the mapper.
  let priorBlocks = [];

  if (mode === "continuation" && prevSessionId) {
    sessionType = "continuation";
    // A missing or foreign history degrades to a fresh start, never a failure.
    const continuation = await loadContinuationContext({ studentId, prevSessionId });
    historyBlocks = continuation.historyBlocks;
    priorBlocks = continuation.priorBlocks;
    resumeFrom = continuation.resumeFrom;
    resumeTeachingEvidence = continuation.resumeTeachingEvidence;
  }

  if (mode === "decay") {
    sessionType = "decay_review";
    const agent = await getOrCreateStudentAgent(studentId);
    decayPayload = await decayEngine.generateDecaySession(agent.id, studentId, subject, topic);
    // An alert id is untrusted: carried only once this learner owns it.
    let ownedNotificationId = null;
    if (notificationId && await decayEngine.markNotificationRead(notificationId, studentId)) ownedNotificationId = notificationId;
    decayPayload = { ...decayPayload, notificationId: ownedNotificationId };
    const priorLesson = await loadDecayPriorLesson({ studentId, topic });
    priorBlocks = priorLesson.priorBlocks;
    historyBlocks = priorLesson.historyBlocks;
  }

  const orchestrator = await getOrchestrator({
    mode: "student",
    studentId,
    userId: caller,
    // Only the guide; the gated student session is the same either way (D42).
    teacherAgentId: typeof teacherAgentId === "string" && teacherAgentId ? teacherAgentId.slice(0, 120) : null,
    sessionType,
    subject,
    priorBlocks,
    decayPayload,
    referenceMaterial: reference,
    teachingEvidence: resumeTeachingEvidence,
  });
  if (!orchestrator?.initialize || !orchestrator?.processTeachingMessage) {
    throw Object.assign(new Error("Canonical teaching workflow is unavailable"), { status: 503 });
  }
  // initialize() starts where the last session stopped, not at step one.
  orchestrator.resumeFrom = resumeFrom;
  // Whole-document grounding, resolved against the AUTHENTICATED learner. A
  // promise, so the opening never waits on it; the first turn does.
  orchestrator.documentTargetPromise = document ? resolveSessionDocument({ userId: caller, document }) : null;

  // The lesson ladder (school scheme of work → exam syllabus → AI), cached per
  // topic and never blocking: a pending-review ladder is served immediately.
  let ladder = null;
  try {
    ladder = await resolveLadder({ studentId, topic, subject, guide: orchestrator.guideOrchestrator?.guide || new NaNaEsumai() });
    if (ladder?.subtopics?.length) {
      // initialize() reads this instead of calling detectMustKnowParts.
      orchestrator.presetMustKnow = ladder.subtopics;
      orchestrator.session = orchestrator.session || {};
      orchestrator.session.objectives = ladder.objectives || {};
      orchestrator.session.knowledgeMap = ladder.map || [];
    }
  } catch (e) { console.warn("[resolveLadder]", e.message); }

  // A session handed over from Study Prep (Phase 6) teaches exactly what the
  // Agent Check missed: those are its parts, in place of the ladder's.
  const parts = Array.isArray(focus) ? focus.map((f) => String(f || "").trim().slice(0, 120)).filter(Boolean).slice(0, 6) : [];
  if (parts.length && mode === "fresh") orchestrator.presetMustKnow = parts;

  const init = await orchestrator.initialize(studentId, topic);
  // Identity for persistence: lifecycle.js saves the session from this.
  orchestrator.sessionMeta = { studentId, topic, subject };
  return { orchestrator, init, mode, sessionType, decayPayload, historyBlocks, priorBlocks, ladder };
}
