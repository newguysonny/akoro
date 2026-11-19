// =============================================================
// chat.js  v3.1
// HTTP routes — all session types + decay system routes.
// New in v3.1:
//   GET  /decay/status/:studentId     — knowledge health dashboard
//   GET  /decay/alerts/:studentId     — unread decay notifications
//   GET  /decay/subjects/:studentId   — all subjects + confidence
//   GET  /decay/topics/:studentId/:subject — topics in a subject
//   POST /decay/session/start         — start a decay review session
//   POST /decay/acknowledge/:notifId  — mark notification read
//   POST /decay/run                   — manually trigger decay check
// =============================================================

import { chatEnvelope } from "../workflows/envelope.js";
import express from "express";
import { isDryRun, runDry, runInspected, isInspected } from "../../lib/dryRunContext.js";
import { jsonbArray, jsonbObject } from "../../lib/jsonb.js";
import { authenticateToken } from "../auth/routes.js";
import pkg from "pg";
import { OPENAI_MODEL, openai } from "../../lib/aiModel.js";
import { buildSuggestionMessages, notTaughtFrom, guideChip, uploadsFrom, uploadChip, shapeSuggestions, buildLearnSuggestionMessages, LEARN_LIMITS, buildCitedLearnSuggestionMessages, citedLearnSchema, shapeCitedLearnSuggestions } from "./chat/chatSuggestions.js";
import { resolveAskTargetFor } from "../records/access.js";
import { materialsFrom, collectMaterials } from "./chat/chat-materials.js";
import { renderRelevantMemory } from "./chat/chat-memory.js";
import { CHAT_TOOLS_CORE } from "./chat/tool-catalogue-core.js";
import { CHAT_TOOLS_REST, buildInstructorTools, peerConsultEnabled, blogResearchEnabled, agentNetworkEnabled } from "./chat/tool-catalogue-rest.js";
import {
  learnerInsightsEnabled, learnerSoulStateEnabled, conceptTrackerEnabled,
  examPrepConfidenceEnabled, studyPrepEnabled, durableAgentChatContextEnabled,
  warnedUnsavedTurn, CHAT_SESSION_ID, CHAT_TURN_ID, agentSessionId,
  activeTurnStops, turnStopKey, stickyAreasFor,
  activeSessionTurns, decisionContinuations,
} from "./chat/runtime-state.js";
import { ensureNotTaughtOpener, promisedTeachTopic, scrubInternalIds, stripDsmlMarkup, hasDsmlMarkup, stripToolCallMarkup, hasToolCallMarkup } from "./reply-scrub.js";
import { recurringTopics } from "../materials/structureCore.js";
import { looksLikeStepNarration, containsDeferral, admitsNonCompletion, looksTruncated, planHasOpenSteps } from "./narration-stall.js";
import { resolveMaterialsFolder } from "../materials/studySource.js";
import { akoroMaterialFor } from "../materials/akoroMaterial.js";
import { gatherPassages, extractCitations } from "../records/askLib.js";
import { searchRecordChunks } from "../records/searchLib.js";
import { getExtraction } from "../records/extractLib.js";
import { loadTaughtKnowledge, renderTaughtContext, buildGuideMessages, shapeGuideAnswer, teachRequest } from "./protege.js";
import { loadDoctrine } from "../agent-context/context-manager.js";

/* Where the protégé's taught knowledge comes from (edu.student_agents / agent_knowledge). */
export const protegeDeps = {
  findAgent: async (studentId) => {
    const { data } = await db.schema("edu").from("student_agents").select("id").eq("student_id", studentId).maybeSingle();
    return data || null;
  },
  retrieve: (agentId, query, limit) => retrieveAgentKnowledge(agentId, query, limit),
  listTopics: async (agentId) => {
    const { data } = await db.schema("edu").from("agent_knowledge").select("topic, subject")
      .eq("agent_id", agentId).order("last_seen_at", { ascending: false }).limit(200);
    return data || [];
  },
};
import { publicModelList, resolveChatChoice, pickerInfo, pickerEnabled } from "../../lib/modelCatalogue.js";
import { modelRegistry } from "../../lib/modelRegistry.js";
import { runtimeFeatureModel } from "../../lib/modelRuntime.js";
import { allowedModelsFor } from "../../lib/modelTiers.js";
import { modelPicks, supabaseThreads } from "../workflows/modelPicks.js";
const { Pool } = pkg;
import db from "../../db.js";
import config from "../../config/index.js";
import { consultPeerAgents, PEER_QUESTION_MIN, PEER_QUESTION_MAX } from "./peerConsult.js";
import { consultBreakthroughs } from "./peerConsult.js";
import { searchAgents, saveSettings as saveAgentNetworkSettings, block as blockAgent, report as reportAgent, logPastQuestions, pastQuestionSummary } from "../agent-network/network.js";
import { challengeAgents, postChallengeRequest, searchChallengeRequests, acceptChallengeRequest, cancelChallengeRequest, rematch } from "../agent-network/challenges.js";
import { requestGuideReview } from "../battle/guideReview.js";
import { classBattleFromChat } from "../battle/chatBattle.js";
import { messageAgent, inbox as agentInbox, replyToAgent, consultOnlineAgents, inboxBrief } from "../agent-network/messaging.js";
import {
  requestBuddy, respondBuddy, listBuddies, buddyCheckin, endBuddy, buddyBrief,
  joinDaily, skipDaily, dailyRanking, dailyStatus, createCircle, searchCircles, joinCircle, leaveCircle, weeklyLeague,
} from "../agent-network/activities.js";
import { searchBlogPosts, readBlogPost } from "./blogResearch.js";
import { listGoals, createGoal, updateGoal } from "../learner-goals/service.js";
import { listMyBlogs, createBlogPost, updateBlogPost } from "../blogs/service.js";
import { newToolRequestId, toolObservation } from "../../utils/toolObservation.js";

import { getOrchestrator } from "./agents/registry.js";
import {
  createActivityDraft, listActivityDrafts, getActivityDraft, discardActivityDraft, reviseDraftPayload,
  instructorClassrooms,
} from "../self-study/drafts.js";
import { TOOLS as TEACHING_TOOLS, ToolError as TeachingToolError } from "../teaching/tools.js";
import { createToolDraft } from "../teaching/toolDrafts.js";
import { activityOutcomeSummary, listRecentActivities } from "../self-study/outcomes.js";
import {
  listRoutines, createRoutine, updateRoutine, deleteRoutine,
} from "../self-study/routines.js";
import { getSyllabusGrounding } from "./syllabus.js";
import { getPastQuestionGrounding } from "../past-questions/routes.js";
import { getCurriculumGrounding } from "../curriculum/routes.js";
import {
  getOrCreateStudentAgent,
  getAgentGrowthHistory,
  getAgentIntelligence,
  retrieveAgentKnowledge,
  getAgentKnowledgeBySubject,
  getTopicsBySubject,
} from "./agents/student/knowledge.js";
import { decayEngine } from "./agents/student/decayEngine.js";
import { subjectMastery } from "./agents/student/knowledge.js";
import { activeSessions } from "./websocket.js";
import {
  cancelChatFollowUp,
  listChatFollowUps,
  scheduleChatFollowUp,
} from "./chat/chat-follow-ups.js";
import { sendNotificationEmail } from "../auth/emails.js";
import {
  getLearnerAutonomy,
  scheduleAutonomyReviewForTask,
  setLearnerAutonomy,
} from "./learner-autonomy.js";
import { adminRequestOf, requestClaimCorrection } from "./requestClaims.js";
// Phase 16: the task ledger, the end-of-turn check, recovery, the context budget and the intent step.
import { UPDATE_PLAN_TOOL, applyPlanUpdate, nextLedger, renderLedger, renderDraftPlan, summaryMarkOf } from "./taskLedger.js";
import { turnCorrections } from "./turnCheck.js";
import { startRun, recordStep, finishRun, stepRow } from "./executionLog.js";
import { failed as toolFailed, shouldRetry, recoveryHint } from "./toolRecovery.js";
import { runWithinLimit } from "./toolLimits.js";
import { createLoopGuard } from "../agent-runtime/loopGuard.js";
import { actionBasis, basisRefusal, currentActionBasis, withActionBasis } from "../agent-runtime/actionBasis.js";
import { fitDialogue, summariseEarlier } from "./contextBudget.js";
import { runIntentStep, renderIntent } from "./intentStep.js";
// Phase 17: a live turn is recorded per AGENT_EPISODES — opted-in learners, or everyone who hasn't opted out (agent-contract/store.js).
import { createEpisodeRecorder } from "../agent-contract/episode.js";
import { recordsRealTraffic, saveEpisode } from "../agent-contract/store.js";
import { labelKeyFor } from "../agent-ratings/ratings.js";
import { requiresAgentCapabilitiesTool, requiresActivityPreparation, isDraftFollowUp, isToolDraftFollowUp, requiredLearnerDataTool, requiredStudyPrepTool, classForExam } from "./agent-chat-intent.js";
import { agentToolActivity, reportAgentActivity } from "../../lib/agentActivity.js";
import { noteChatTurn } from "../agent-memory/quietLearning.js";
import { createChatTrace, decisionNarration, TALK_AFTER_TOOLS, talkAfterTool } from "./chat/chat-trace.js";
import { toResponsesInput, toResponsesTools } from "./responses-input.js";
import { hasExplicitToolRequestConsent } from "./agent-tool-request-intent.js";
import { getLearnerProfileContext } from "./learner-profile-context.js";
import { validateLearnerTaskInput } from "./learner-task-validation.js";
import { listChats, readChat, postToChat, ownedChatId, searchChats } from "./chat/chat-history-tools.js";
import { schemaLookup } from "../self-tooling/registry.js";
import { createTool, runLearnerTool, learnerToolDefs, learnerToolDefsWithAreas, forcedSelfTool, saveComputation, getLibraryToolState, runLibraryViewAction, getChatsToolState, runChatsViewAction, getMergedToolState, runMergedViewAction } from "../self-tooling/pipeline.js";
import { mergedLibraryEnabled, mergedLibraryDef, libraryDeltaActions, LIBRARY_BASE_ACTIONS, LIBRARY_MERGED_ACTIONS } from "../self-tooling/mergedLibrary.js";
import { mergedChatsEnabled, mergedChatsDef, chatsDeltaActions, CHATS_BASE_ACTIONS, CHATS_MERGED_ACTIONS } from "../self-tooling/mergedChats.js";
import { MERGED_DOMAINS, MERGED_DOMAIN_LIST } from "../self-tooling/mergedDomains.js";
import { AREAS, areaSelectionEnabled, areasForMessage, filterDefsByAreas, namedLearnerTool, toolArea } from "./toolSelection.js";
import { agreesToBuild } from "../self-tooling/capabilities.js";
import { selfToolingEnabled, selfToolingAllowedFor } from "../self-tooling/access.js";
import { createLearnerToolRequest } from "../agent-tool-requests/service.js";
import {
  getAgentPreferenceSummary,
  getAutonomyStatus,
  getChatMemory,
  getConceptTrackerSummary,
  getExamPrepStatus,
  getKnowledgeMap,
  getLearningInsightsSummary,
  getLearningOverview,
  searchMyStudyKnowledge,
} from "./learner-chat-read-tools.js";
import { localiseInstant } from "./learner-time-context.js";
import {
  completedLearnerAgentConversationTurn,
  savedTurnReplyId,
  loadLearnerAgentConversationContext,
  persistLearnerAgentConversationTurn,
  persistLearnerAgentUserTurnMessage,
  retrieveLearnerAgentMemory,
} from "../agent-tools/conversation-context-routes.js";

const router     = express.Router();
// Agent console (modules/agentConsole): a turn sent with the console's key in
// x-agent-console-dry runs in DRY mode — tools that change data are simulated.
// x-agent-console-inspect (same key) adds each tool call's arguments and a
// truncated result to toolExecutions — the verification gate asserts on them.
router.use((req, res, next) => {
  const key = process.env.AGENT_CONSOLE_KEY;
  if (!key) return next();
  const dry = safeCompare(req.get("x-agent-console-dry"), key);
  const inspect = safeCompare(req.get("x-agent-console-inspect"), key);
  let go = next;
  if (inspect) { const inner = go; go = () => runInspected(inner); }
  if (dry) { const inner = go; go = () => runDry(inner); }
  return go();
});
// The one direct-Postgres pool in the API. Deliberately small: Supavisor (the
// external proxy in front of Supabase Postgres) absorbs traffic spikes, so a
// big pool here only adds idle connections and context-switch overhead on the
// database. max/idle/connect-timeout come from config (DB_POOL_MAX etc.,
// default max 5) — see config/index.js and lib/dbPool.contract.test.mjs,
// which enforces that every runtime pool stays small and bounded.
const pool       = new Pool({
  connectionString:         process.env.DATABASE_URL,
  max:                     config.db.poolMax,
  idleTimeoutMillis:       config.db.poolIdleMs,
  connectionTimeoutMillis: config.db.poolConnectMs,
});
const query      = (text, params) => pool.query(text, params);
/* ─── reconstructHistoryBlocks ──────────────────────────────────────────────
   Rebuilds the typed block array from a completed teaching session.
   Priority: block_history column (exact) → session_phase_progress (derived).
   Returns faded blocks for the decay session overlay.
─────────────────────────────────────────────────────────────────────────────*/
async function reconstructHistoryBlocks(sessionId, topic, subject, agentName, agentEmoji) {
  try {
    // 1. Try exact block history saved during session
    const { data: session } = await db.schema("edu")
      .from("adaptive_sessions")
      .select("block_history, subtopics, objectives, completed_at, updated_at")
      .eq("id", sessionId)
      .single();

    if (!session) return [];

    const completedAt = session.completed_at || session.updated_at;
    const daysSince   = Math.max(0, Math.round(
      (Date.now() - new Date(completedAt).getTime()) / 86_400_000
    ));

    // If we have the exact block history, fade all blocks and return
    if (session.block_history?.length > 0) {
      const faded = session.block_history.map(b => ({ ...b, faded: true }));
      return [
        { type: "system-divider", label: `Previous session · ${daysSince} days ago` },
        ...faded,
      ];
    }

    // 2. Derive blocks from session_phase_progress
    const subtopics  = jsonbArray(session.subtopics);
    const objectives = jsonbObject(session.objectives);

    const { data: progress } = await db.schema("edu")
      .from("session_phase_progress")
      .select("*")
      .eq("session_id", sessionId)
      .order("subtopic_idx");

    const blocks = [
      { type: "system-divider", label: `Previous session · ${daysSince} days ago` },
    ];

    for (const prog of progress || []) {
      // One header per subtopic, carrying its objectives.
      //
      // This used to emit three blocks: the header, a "NaNa plan" strip listing
      // the four phases, and the objectives as a separate checklist. The plan
      // is machinery the learner does not act on, and the checklist was the
      // header's own progress bar written out longhand — same array, same
      // order. The header pages through them now.
      if (prog.phase === "1") {
        blocks.push({
          type: "subtopic-hdr", faded: true,
          subtopic: prog.subtopic, idx: prog.subtopic_idx,
          // The SUBTOPIC list, not this subtopic's objectives.
          //
          // It was the latter, which conflated two different lists: items came
          // from objectives[subtopic] (three entries for one step) while idx and
          // total counted subtopics (one of six). The header paged through three
          // things while claiming to be on step 4 of 6.
          items: subtopics,
          total: subtopics.length, topic, subject,
        });
        blocks.push({
          type: "guide", agent: "NaNa Esumai", emoji: "🧠", faded: true,
          phase: `Phase 1 — ${prog.subtopic}`,
          text:  `Starting ${prog.subtopic}. ${agentName} confidence: ${prog.confidence_start || 20}%.`,
        });
      }

      // Sargeant assessment result at end of each subtopic
      if (prog.phase === "assessment" && prog.assessment_score !== null) {
        const confPct    = Math.round(prog.assessment_score * 100);
        const confEnd    = Math.round(prog.confidence_end   ?? confPct);
        blocks.push({
          type: "student-agent", agent: agentName, emoji: agentEmoji, faded: true,
          phase: `${agentName} · Phase 4 complete · ${confEnd}%`,
          confidence: confEnd,
          text: `I understand ${prog.subtopic} now. My knowledge has solidified.`,
        });
        blocks.push({
          type:         "assess-result", faded: true,
          subtopic:     prog.subtopic,
          agentName,
          confidence:   confPct,
          passed:       prog.passed,
          nextSubtopic: subtopics[prog.subtopic_idx + 1] || null,
        });
      }
    }

    return blocks;
  } catch (e) {
    console.warn("[reconstructHistoryBlocks]", e.message);
    return [];
  }
}

// ─── Unified Agent Chat tools ────────────────────────────────────────────────
// These execute against the student's real data when the agent needs them.

// A recurring battle (battle/series.js): days of the week + a time, until an end date and time.
// REPEAT_SCHEMA lives in chat/tool-catalogue-core.js with the first half of the tools.

export const CHAT_TOOLS = [...CHAT_TOOLS_CORE, ...CHAT_TOOLS_REST];

/** Hide feature-gated tools from the model catalogue until the matching Akoro slice is enabled. */
export function getLearnerChatTools({ allowToolRequest = true, selfTooling = true } = {}) {
  const enabled = {
    // Off by default; the chat route also checks the learner allow-list
    // (selfTooling) so the tool is never offered to anyone not on it.
    self_tooling: selfToolingEnabled() && selfTooling,
    blog_research: blogResearchEnabled,
    peer_consult: peerConsultEnabled,
    agent_network: agentNetworkEnabled,
    concept_tracker: conceptTrackerEnabled,
    learning_insights: learnerInsightsEnabled,
    exam_prep_confidence: examPrepConfidenceEnabled,
    study_prep: studyPrepEnabled,
    durable_agent_chat_context: durableAgentChatContextEnabled,
  };
  return CHAT_TOOLS.filter((tool) => (!tool.featureGate || enabled[tool.featureGate] === true)
    && (tool.name !== "submit_tool_request" || allowToolRequest));
}

/**
 * Instructor chat tools — activity creation with human-in-the-loop.
 * The agent PREPARES a draft; assigning is a human action on the preview
 * (POST /api/self-study/drafts/:id/assign), never a tool. All six workbench
 * types are draftable; battles assign through their battle form.
 */
/* Every field any teaching tool accepts, taken from the tools' own definitions so
   the model is told about all of them (the vocabulary count, a lesson plan's duration…) and the two can't drift.
   Voices stay at their defaults. */
const TEACHING_FIELD_PROPS = (() => {
  const props = {};
  for (const t of TEACHING_TOOLS) {
    for (const f of t.fields) {
      if (f.name === "voiceA" || f.name === "voiceB") continue;
      const p = (props[f.name] ||= { label: f.label, options: f.options, tools: [], required: [] });
      p.tools.push(t.key);
      if (f.required) p.required.push(t.key);
    }
  }
  return Object.fromEntries(Object.entries(props).map(([name, p]) => [name, {
    type: "string",
    description: `${name === "topic" ? "The topic" : p.label}${p.options ? ` (one of: ${p.options.join(" | ")})` : ""} — used by ${p.tools.join(", ")}${p.required.length ? `; REQUIRED for ${p.required.join(", ")}` : ""}.`,
  }]));
})();

export const INSTRUCTOR_TOOLS = buildInstructorTools(TEACHING_TOOLS, TEACHING_FIELD_PROPS);

export function openAiInstructorTools() {
  // Kill-switch: AKORO_ACTIVITY_DRAFTS_ENABLED=false removes the draft tools
  // everywhere at once (chat loop and gateway catalogue) without a deploy.
  if (String(process.env.AKORO_ACTIVITY_DRAFTS_ENABLED || "").toLowerCase() === "false") return [];
  return INSTRUCTOR_TOOLS.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  }));
}

/* ── Learner school context (P2b directory tools) ─────────────────────────
   The learner's school identity comes from two places: their school-management
   enrolment (mgmt.students — the school's own roster) or their classrooms
   (classrooms.school_id — standalone teachers have none). Read-only and
   public-directory bounded: this answers "which school / which subjects /
   who teaches me", never staff contact details or internal school records. */
async function resolveLearnerSchoolContext(studentId) {
  const ctx = { schoolId: null, school: null, classId: null, className: null, sectionName: null, classrooms: [] };
  const { data: roster } = await db.schema("mgmt").from("students")
    .select("school_id, class_id, section_id").eq("user_id", studentId)
    // The school they're at NOW — not a past school (alumni / inactive).
    .eq("status", "active")
    .not("school_id", "is", null).limit(1).maybeSingle();
  if (roster?.school_id) {
    ctx.schoolId = roster.school_id;
    ctx.classId = roster.class_id || null;
    if (ctx.classId) {
      const { data: classRow } = await db.schema("mgmt").from("classes")
        .select("name").eq("id", ctx.classId).limit(1).maybeSingle();
      ctx.className = classRow?.name || null;
    }
    if (roster.section_id) {
      const { data: sectionRow } = await db.schema("mgmt").from("sections")
        .select("name").eq("id", roster.section_id).limit(1).maybeSingle();
      ctx.sectionName = sectionRow?.name || null;
    }
  }
  const { data: memberships } = await db.from("classroom_students")
    .select("classrooms(id, name, school_id, teacher_id)")
    .eq("user_id", studentId).eq("status", "active").limit(25);
  ctx.classrooms = (memberships ?? []).map((m) => m.classrooms).filter(Boolean);
  if (!ctx.schoolId) ctx.schoolId = ctx.classrooms.map((c) => c.school_id).find(Boolean) || null;
  if (ctx.schoolId) {
    // Public directory fields only — the school's published identity.
    const { data: school } = await db.from("school_profiles")
      .select("name, description, website, logo_url, address, is_active")
      .eq("id", ctx.schoolId).limit(1).maybeSingle();
    if (school) ctx.school = {
      name: school.name,
      description: school.description || null,
      website: school.website || null,
      logoUrl: school.logo_url || null,
      address: school.address || null,
      active: Boolean(school.is_active),
    };
  }
  return ctx;
}

/**
 * Tools that change something (create, send, challenge, publish…). Used to
 * flag the scratchpad, and by the agent console's DRY mode, which answers
 * these with what they WOULD do instead of doing it (lib/dryRunContext.js).
 */
export const SIDE_EFFECT_TOOLS = ["set_agent_auto_reply", "create_task", "suggest_help", "schedule_chat_follow_up", "post_to_chat", "send_email_to_me", "create_tool", "save_computation", "cancel_scheduled_chat_follow_up", "submit_tool_request", "submit_bug_report", "prepare_activity", "revise_activity_draft",
          "create_goal", "update_goal_progress", "save_blog_draft", "publish_blog", "update_agent_network_settings", "block_agent", "log_past_question_practice",
          "challenge_agent", "class_battle", "post_challenge_request", "accept_challenge_request", "cancel_challenge_request", "rematch_battle", "request_guide_review", "message_agent", "reply_to_agent", "start_study_prep_session", "cancel_study_prep_session",
          "consult_peer_agents", "discard_activity_draft", "schedule_activity_routine", "cancel_activity_routine", "run_teaching_tool"];
/** The multi-action tools change things only on their writing actions. */
export const isSideEffectingAction = (tool, input) =>
  ["study_buddy", "daily_challenge", "revision_circle"].includes(tool) && !["list", "status", "ranking", "search", undefined, null, ""].includes(input?.action);
export const isSideEffecting = (tool, input) => SIDE_EFFECT_TOOLS.includes(tool) || isSideEffectingAction(tool, input);

/** Parallel read batches in the chat loop (2026-11-17): a decision's
 *  independent READ calls may run together, but these must always run one at
 *  a time, in the order the model gave them — each either changes something,
 *  depends on an earlier call's result, or changes what the rest of the turn
 *  can do. Side-effecting calls (isSideEffecting above) and tools the learner
 *  built themselves (not in the built-in catalogue) are likewise never
 *  batched. Kill switch: AKORO_PARALLEL_READS=false restores one-at-a-time
 *  execution everywhere, prompt steer included. */
export const PARALLEL_CALL_BARRIERS = new Set([
  UPDATE_PLAN_TOOL.name, // the plan ledger applies against earlier steps, in order
  "await_decision", // waits on the learner's tap, then applies the frozen proposal (a change)
  "create_tool", // its result can add a tool for the rest of the turn (__newTool)
  "get_agent_capabilities", // its result can load an area's tools (__addTools)
  "make_study_material", // the source cascade is a dependent chain; the taught source writes a record
  "read_upload", "retry_extraction", "file_upload", // the upload pipeline is one stateful sequence
  ...TALK_AFTER_TOOLS, // the owed narration line belongs between steps, in order
]);
/** Widest batch the loop runs at once — the reads share the database pool with every other turn. */
export const PARALLEL_READ_BATCH = 4;
// Confirmation statuses that mean the learner has decided: such a card is
// never (re)written into the chat as a message artifact — its outcome is
// the agent's narration only (Matt, 2026-11-17).
export const DECIDED_CONFIRM_STATUSES = ["approved", "consumed", "rejected", "expired"];
const BUILTIN_TOOL_NAMES = new Set([...CHAT_TOOLS, ...INSTRUCTOR_TOOLS].map((t) => t.name));
/** The batching steer: appended to the system prompt per turn (never part of
 *  the golden-pinned static doctrine) and dropped when the kill switch is
 *  off, so the prompt never promises what the loop won't do. */
export const PARALLEL_READS_NOTE = "\n\n## Gathering what you need\nWhen your answer needs several independent lookups (progress, goals, tasks, sessions, weak topics, the Library), ask for them all in ONE reply — put every independent read in the same response instead of one per turn. They run together, and you answer sooner with fewer steps. Call one at a time only when a later call needs an earlier call's result, or when a call changes something: changes always go one by one, in order.";
export const STEP_NARRATION_NOTE = "\n\n## Narrating your work\nKeep the learner informed while you work, in your own words. With every reply that calls tools, include one short sentence saying what you are doing and why — as you start the step, not after the whole job is done. When a step's results come back and you go on to another step, first say in one short sentence what that step found or changed. If a step fails, say that in one short sentence too, with what you are doing about it — never let a step pass in silence. These lines appear between your steps in the chat, so keep each to a single plain sentence, specific to what is actually happening (name the thing you are checking, drafting or changing). Do not narrate a step you are not taking, do not repeat a line you already said, and keep your final answer as the summary of the outcome — it does not need to repeat the step lines. The sentence must ride in the SAME reply as the tool call it describes: a reply with no tool call ends your turn, so never send the sentence on its own. The same goes for deferrals and admissions: do not end a reply by promising to check or run something next, or by reporting that the work was not done and asking to be asked again — if this turn's work can be done, do it in this turn.";

/** A read helper that throws reaches the model as {error} naming what failed,
 *  not the loop's generic "could not be completed". */
const asToolError = (what) => (e) => ({ error: `Couldn't load ${what} just now${e?.message ? ` (${String(e.message).slice(0, 120)})` : ""}.` });

/** What create_tool needs from the chat: built-in names (never shadowed) and a runner for capabilities. */
/** `role`: "student" (learner tools) or "instructor" (instructor tools, S7) — capabilities run as that role. */
export function selfToolDeps(userId, role = "student") {
  return {
    builtIn: new Set([...CHAT_TOOLS, ...INSTRUCTOR_TOOLS].map((t) => t.name)),
    callCapability: (tool, args) => executeChatTool(tool, args, userId, { role, channel: "self_tooling" }),
  };
}
/** Which tools a role's agent builds (S7): instructors build instructor tools; everyone else learner tools. */
const toolAudience = (role) => (role === "instructor" ? "instructor" : "learner");
const SELF_TOOLING_ROLES = new Set(["student", "instructor"]);

/**
 * Asked or inferred (Phase 18 item 6, agent-runtime/actionBasis.js). Every
 * caller of a chat tool acts for a person who asked: a chat message, an
 * Approve / Confirm tap, an admin's check, the agent console — so the default
 * is explicit. Work the agent started itself passes { basis: "inferred", rule };
 * a call made inside other work (a learner's own tool running a capability)
 * inherits that work's basis. An inferred change with no rule is refused.
 */
export function chatToolBasis({ basis = null, rule = null } = {}) {
  const given = basis == null ? null : typeof basis === "string" ? { basis, rule } : { ...basis, ...(rule ? { rule } : {}) };
  return actionBasis(given) || currentActionBasis() || { basis: "explicit", rule: null };
}

/** The library content search (the platform `search` action of the merged
 *  library tool, and the legacy search_my_library tool): the learner's own
 *  records only — chunk search plus a name match, reader-link shaped. */
async function getMyLearningSessionsTool(studentId) {
      try {
        // The learner's own learning agent (one per learner, edu.student_agents).
        const { data: agentRow } = await db.schema("edu").from("student_agents")
          .select("id, name, level, total_sessions, total_turns, knowledge_score, subjects_learned")
          .eq("student_id", studentId).limit(1).maybeSingle();
        if (!agentRow?.id) return {
          agent: null, subjects: [], recentSessions: [], recentLearning: [],
          note: "This learner has no learning agent yet — it grows when they teach it in a learning session. Say exactly that; never invent subjects or topics.",
        };
        // What the learner has actually taught their agent, grouped by subject.
        const { data: knowledge, error: kErr } = await db.schema("edu").from("agent_knowledge")
          .select("subject, topic, confidence").eq("agent_id", agentRow.id).limit(400);
        if (kErr) return { error: "Could not load your learning history: " + kErr.message };
        const rowsBySubject = new Map();
        for (const row of knowledge ?? []) {
          const subject = row.subject || "General";
          if (!rowsBySubject.has(subject)) rowsBySubject.set(subject, []);
          rowsBySubject.get(subject).push(row);
        }
        const subjects = [];
        for (const [subject, rows] of [...rowsBySubject.entries()].slice(0, 10)) {
          const avg = rows.length ? rows.reduce((s, r) => s + (Number(r.confidence) || 0), 0) / rows.length : 0;
          const mastery = await subjectMastery(agentRow.id, subject).catch(() => null);
          const topics = [...new Map(rows.map((r) => [(r.topic || "").toLowerCase().trim(), r])).values()]
            .slice(0, 6)
            .map((r) => ({ topic: r.topic, confidence: Math.round((Number(r.confidence) || 0) * 100) + "%" }));
          subjects.push({
            subject, level: mastery?.level ?? null,
            knowledgeItems: rows.length, avgConfidence: Math.round(avg * 100) + "%",
            topics,
          });
        }
        // The learning sessions themselves (the protégé teaching sessions).
        const { data: sessions, error: sErr } = await db.schema("edu").from("adaptive_sessions")
          .select("subject, topic, status, current_phase, started_at, completed_at")
          // Never-started sessions have no started_at — nulls last, or they
          // fill every "recent" slot ahead of the real ones.
          .eq("student_id", studentId).order("started_at", { ascending: false, nullsFirst: false }).limit(8);
        if (sErr) return { error: "Could not load your learning sessions: " + sErr.message };
        // What the most recent sessions actually achieved.
        const { data: deltas } = await db.schema("edu").from("session_knowledge_delta")
          .select("subject, topic, concepts_learned, xp_earned, started_at")
          .eq("agent_id", agentRow.id).order("started_at", { ascending: false }).limit(5);
        return {
          agent: {
            name: agentRow.name || "My Learning Agent",
            level: agentRow.level ?? 1,
            totalSessions: agentRow.total_sessions ?? 0,
            totalTurns: agentRow.total_turns ?? 0,
            knowledgeScore: Number(agentRow.knowledge_score) || 0,
            subjectsLearned: agentRow.subjects_learned ?? [],
          },
          subjects,
          recentSessions: (sessions ?? []).map((s) => ({
            subject: s.subject, topic: s.topic, status: s.status,
            phase: s.current_phase, startedAt: s.started_at, completedAt: s.completed_at,
          })),
          recentLearning: (deltas ?? []).map((d) => ({
            subject: d.subject, topic: d.topic,
            conceptsLearned: Array.isArray(d.concepts_learned) ? d.concepts_learned.length : 0,
            xpEarned: Number(d.xp_earned) || 0, at: d.started_at,
          })),
          note: "This is what the learner has actually learnt by teaching their agent — the school's subject CATALOGUE is a different question (list_school_subjects).",
        };
      } catch (error) { return { error: error.message || "Could not load your learning sessions right now" }; }
}
async function getPastQuestionPracticeTool(studentId, input) {
      try {
        let q = db.schema("edu").from("past_question_attempts")
          .select("exam, subject, year, attempted, correct, created_at").eq("user_id", studentId)
          .order("created_at", { ascending: false }).limit(1000);
        if (input?.subject) q = q.ilike("subject", String(input.subject).trim());
        if (input?.exam) q = q.ilike("exam", String(input.exam).trim());
        const days = Number(input?.days);
        if (Number.isFinite(days) && days > 0) q = q.gte("created_at", new Date(Date.now() - days * 86_400_000).toISOString());
        const { data, error } = await q;
        if (error) return { error: "Couldn't load your past-question practice just now." };
        const groups = new Map();
        for (const r0 of data ?? []) {
          const k = `${r0.exam}|${r0.subject || "—"}`;
          const g = groups.get(k) || { exam: r0.exam, subject: r0.subject || null, attempted: 0, correct: 0, years: new Set(), lastPractised: r0.created_at };
          g.attempted += Number(r0.attempted) || 0; g.correct += Number(r0.correct) || 0;
          if (r0.year) g.years.add(r0.year);
          if (r0.created_at > g.lastPractised) g.lastPractised = r0.created_at;
          groups.set(k, g);
        }
        const bySubject = [...groups.values()].map((g) => ({
          exam: g.exam, subject: g.subject, attempted: g.attempted, correct: g.correct,
          accuracy: g.attempted ? `${Math.round((g.correct / g.attempted) * 100)}%` : null,
          years: [...g.years].sort(), lastPractised: g.lastPractised,
        })).sort((a, b) => b.attempted - a.attempted);
        const attempted = bySubject.reduce((n, g) => n + g.attempted, 0);
        const correct = bySubject.reduce((n, g) => n + g.correct, 0);
        return bySubject.length
          ? { bySubject, totals: { attempted, correct, accuracy: attempted ? `${Math.round((correct / attempted) * 100)}%` : null, sessions: (data ?? []).length } }
          : { bySubject: [], totals: { attempted: 0, correct: 0 }, message: "No past-question practice recorded yet." };
      } catch (error) { return asToolError("your past-question practice")(error); }
}
async function getWeakTopicsTool(studentId, input) {
      const { data: agentRow } = await db.schema("edu").from("student_agents")
        .select("id").eq("student_id", studentId).single();
      if (!agentRow) return { weak_topics: [], message: "No knowledge profile yet — start a session!" };
      // What the learner has taught their agent (agent_knowledge — the same
      // store as the knowledge map and learning sessions), weakest first. It
      // read the learner's saved notes instead, where confidence defaults to
      // 60%, so "my weak topics" came back empty next to a map showing some.
      let q = db.schema("edu").from("agent_knowledge")
        .select("topic, subject, confidence")
        .eq("agent_id", agentRow.id).order("confidence", { ascending: true }).limit(60);
      if (input.subject) q = q.ilike("subject", String(input.subject).trim());
      const { data, error } = await q;
      if (error) return { error: "Couldn't load your topics just now." };
      const seen = new Set();
      const weak = (data ?? []).filter((t) => (Number(t.confidence) || 0) < 0.6)
        .filter((t) => { const k = `${t.subject}|${String(t.topic || "").toLowerCase().trim()}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, 8)
        .map((t) => ({ topic: t.topic, subject: t.subject, confidence: Math.round((Number(t.confidence) || 0) * 100) + "%" }));
      return weak.length ? { weak_topics: weak } : { weak_topics: [], message: (data ?? []).length ? "Nothing weak right now — every topic you've taught is above 60%." : "Nothing taught yet in that subject." };
}
async function listMyGoalsTool(studentId) {
  try {
    const { goals, error } = await listGoals(studentId);
    if (error) return { error };
    return {
      count: (goals ?? []).length,
      goals: (goals ?? []).map((g) => ({
        goalId: g.id, title: g.title, status: g.status, category: g.category,
        metric: g.metric, exam: g.exam, targetDate: g.target_date,
        progressNote: g.progress_note, updatedAt: g.updated_at,
      })),
    };
  } catch (error) {
    return { error: error.message || "Could not load the goals" };
  }
}
async function listTasksTool(studentId) {
  const { data, error } = await db.from("tasks")
    .select("id, title, priority, status, payload, due_at, created_at")
    .eq("creator_id", studentId).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(50);
  if (error) return { error: "Couldn't load your tasks just now." };
  // Sorted by priority (as described), then soonest due — over all pending
  // tasks, not just the 10 newest.
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 };
  const tasks = (data ?? []).sort((a, b) => (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2)
    || String(a.due_at || "9999").localeCompare(String(b.due_at || "9999"))).slice(0, 10);
  return { tasks, count: data?.length ?? 0 };
}
async function searchMyLibraryTool(studentId, input) {      // The learner's own records only (searchRecordChunks is user-scoped), plus a name match.
      const q = String(input?.query || "").trim().slice(0, 200);
      if (q.length < 3) return { records: [], note: "Give a topic or document name to look for." };
      try {
        const [hits, named] = await Promise.all([
          searchRecordChunks({ userId: studentId, q, limit: 12 }).catch(() => []),
          db.schema("edu").from("records").select("id, name").eq("user_id", studentId).is("deleted_at", null).ilike("name", `%${q.replace(/[%_]/g, "")}%`).limit(5)
            .then((r) => r.data || []).catch(() => []),
        ]);
        const byId = new Map();
        for (const n of named) byId.set(n.id, { recordId: n.id, name: n.name, snippet: null });
        // A passage for a document also found by name fills it in (it used to be dropped as a
        // duplicate, so "what do my Cell notes say about…" came back with no passage at all).
        for (const h of hits) {
          if (!h.recordId) continue;
          const known = byId.get(h.recordId);
          if (!known) byId.set(h.recordId, { recordId: h.recordId, name: h.name, snippet: h.snippet || null, page: h.pageNumber ?? null });
          else if (!known.snippet && h.snippet) Object.assign(known, { snippet: h.snippet, page: h.pageNumber ?? null });
        }
        // Found by name only: look inside it for the question (works without embeddings too — lexical).
        const words = q.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3).slice(0, 8).join(" ");
        await Promise.all([...byId.values()].filter((r) => !r.snippet && words).slice(0, 2).map(async (r) => {
          const inside = await searchRecordChunks({ userId: studentId, q: words, limit: 2, recordId: r.recordId }).catch(() => []);
          if (inside[0]?.snippet) Object.assign(r, { snippet: inside[0].snippet, page: inside[0].pageNumber ?? null });
        }));
        const tool = ["quiz", "flashcards", "summary", "notes", "podcast"].includes(input?.tool) ? input.tool : null;
        const records = [...byId.values()].slice(0, 5).map((r) => (tool ? { ...r, tool } : r));
        return records.length
          ? { records, ...(!tool && records.every((r) => !r.snippet) ? { note: "None of their passages matched the question — say that, and offer to open the document in the reader (it reads all of it). Never say you can't read or see inside their documents." } : {}),
            ...(tool ? { note: `Each link opens the document in the reader on its ${tool} tool, which builds it from the whole document — point them there in one line; don't write the ${tool} in chat, don't comment on the document's title or contents, and don't say what you can or can't see inside it (the reader reads all of it).` } : {}) }
          : { records: [], note: "Nothing in their Library matches — say so; don't invent a document." };
      } catch (error) { return { error: "Their Library is unavailable right now" }; }
}

export async function executeChatTool(name, input, studentId, options = {}) {
  const b = chatToolBasis(options);
  const refused = isSideEffecting(name, input) ? basisRefusal(b, { action: name }) : null;
  if (refused) return { success: false, code: refused.code, error: refused.message };
  // The writers below (the self-tooling audit, change cards) read it from the scope.
  return withActionBasis(b, () => runChatTool(name, input, studentId, options));
}

async function runChatTool(name, input, studentId, { conversationId = null, role = "student", channel = "ai_chat" } = {}) {
  // Agent console, DRY mode: anything that would change data is answered with
  // what it would have done — read-only tools still run for real.
  // create_tool handles dry mode itself: it builds and verifies, but doesn't save.
  if (isDryRun() && isSideEffecting(name, input) && name !== "create_tool") {
    return { dryRun: true, wouldDo: name, input, note: "DRY RUN — nothing was changed. Tell the learner exactly what you would have done." };
  }
  switch (name) {
    // ── Instructor: activity creation, human-in-the-loop ──────────────────
    // These prepare drafts only. Assigning is the instructor's tap on the
    // preview (POST /api/self-study/drafts/:id/assign) — no tool reaches it.
    case "run_teaching_tool": {
      if (role !== "instructor") return { error: "Teaching tools are only available to instructor accounts" };
      const { tool, ...body } = input || {};
      try {
        // A draft first: the instructor previews it, asks for changes (each becomes the next
        // version) and saves it to the Library when they are happy — see teaching/toolDrafts.js.
        const { draft, tool: def } = await createToolDraft({ instructor: { id: studentId, role }, key: tool, body, sessionId: conversationId, channel });
        return {
          prepared: true, draftId: draft.id, title: draft.title, type: "teaching_tool", tool: def.key, name: def.name,
          audience: "Saved to your Library when you approve it", version: 1,
          previewHint: "Awaiting the instructor's preview — it is NOT in the Library yet. Never say it is saved or share a link.",
          questionsNote: "Version 1 is being written now — it appears on the Preview card in a minute. Reply with one short line saying what you are making; don't write the resource out or invent its content.",
        };
      } catch (e) {
        if (e?.status === "clarify") {
          return clarify("details", e.message, { prepared: false, error: "details_required",
            message: "Ask the instructor the question in `question`, then call run_teaching_tool again with their answer." });
        }
        if (e instanceof TeachingToolError) {
          return { prepared: false, error: e.message, code: e.code,
            guidance: e.code === "INSUFFICIENT_COINS" ? "Tell the instructor they need to top up coins."
              : "Tell the instructor exactly what is missing and ask for it." };
        }
        console.error("[run_teaching_tool] failed:", e.message);
        return { prepared: false, error: e.message || "Could not start that just now", guidance: "Say it did not work and offer to try again." };
      }
    }
    case "prepare_activity": {
      if (role !== "instructor") return { error: "Activity preparation is only available to instructor accounts" };
      try {
        const { draft, audienceLabel } = await createActivityDraft({
          instructor: { id: studentId, role }, input, sessionId: conversationId, channel,
        });
        const result = {
          prepared: true, draftId: draft.id, title: draft.title, type: draft.type,
          audience: audienceLabel, status: draft.status,
          previewHint: "Awaiting the instructor's preview — do not claim it was assigned.",
        };
        if (Array.isArray(draft.payload?.versions) && draft.payload.versions.length) {
          result.version = 1;
          result.questionsNote = "Version 1 of the questions is being written now — it appears on the Preview card in a minute. Reply with one short line; don't list or invent the questions.";
        }
        if (draft.payload?.plan_status === "pending") result.planNote = "The full study plan is being generated right now — it lands in the preview moments after this reply; the objectives stay editable there.";
        if (draft.payload?.due_notice) result.dueNote = draft.payload.due_notice;
        return result;
      } catch (error) {
        if (error.status === "clarify") {
          // The message carries a SPECIFIC question (missing audience,
          // subject, topic, or an ambiguous class) — relay it verbatim and
          // wait for the instructor's answer, never retry blind.
          return clarify("details", error.message,
            { prepared: false, error: "details_required",
              message: "Ask the instructor the question in `question`, then call prepare_activity again with their answer." });
        }
        console.error("[prepare_activity] failed:", error.status || "", error.message);
        return { prepared: false, error: error.message || "Could not prepare the draft",
          guidance: "Tell the instructor exactly what the error says and ask for that missing detail. Never call it a technical problem and never retry unchanged." };
      }
    }
    case "list_activity_drafts": {
      if (role !== "instructor") return { error: "Activity drafts are only available to instructor accounts" };
      try {
        const drafts = await listActivityDrafts({ id: studentId, role });
        return { drafts: drafts.map((d) => ({ draftId: d.id, title: d.title, type: d.type, preparedAt: d.created_at })) };
      } catch (error) { return { error: error.message || "Could not list drafts" }; }
    }
    case "discard_activity_draft": {
      if (role !== "instructor") return { error: "Activity drafts are only available to instructor accounts" };
      try {
        const draft = await discardActivityDraft({ id: studentId, role }, String(input?.draftId || ""));
        return { discarded: true, draftId: draft.id, title: draft.title };
      } catch (error) { return { discarded: false, error: error.message || "Could not discard the draft" }; }
    }
    case "list_my_classrooms": {
      if (role !== "instructor") return { error: "Class lists are only available to instructor accounts" };
      try {
        // Ownership is teacher_id (bench + seeds) or created_by. On an env
        // where the created_by column has not migrated in yet, the combined
        // filter would ERROR — fall back to teacher_id rather than reporting
        // an empty list (that fallback bug is exactly what once told an
        // instructor with six seeded classes they had none).
        let owned, ownedErr;
        ({ data: owned, error: ownedErr } = await db.from("classrooms")
          .select("id, name, description, student_limit, classroom_students(status, users ( full_name, username ))")
          .or(`teacher_id.eq.${studentId},created_by.eq.${studentId}`).order("created_at", { ascending: true }).limit(25));
        if (ownedErr) {
          ({ data: owned, error: ownedErr } = await db.from("classrooms")
            .select("id, name, description, student_limit, classroom_students(status, users ( full_name, username ))")
            .eq("teacher_id", studentId).order("created_at", { ascending: true }).limit(25));
        }
        if (ownedErr) return { error: "Could not read your classes: " + ownedErr.message };
        const shape = (c) => {
          const active = (c.classroom_students ?? []).filter((r) => r.status === "active");
          return {
            id: c.id, name: c.name,
            description: c.description || null,
            studentLimit: c.student_limit ?? null,
            learners: active.length,
            students: active.slice(0, 40).map((r) => ({ fullName: r.users?.full_name || null, username: r.users?.username || null })),
          };
        };
        if ((owned ?? []).length) return { classrooms: owned.map(shape) };
        // School admins may not own classrooms directly — try the school scope.
        const { data: school } = await db.from("school_profiles")
          .select("id").eq("admin_user_id", studentId).limit(1).maybeSingle();
        if (school?.id) {
          const { data: scoped, error: scopedErr } = await db.from("classrooms")
            .select("id, name, description, student_limit, classroom_students(status, users ( full_name, username ))")
            .eq("school_id", school.id).order("created_at", { ascending: true }).limit(25);
          if (scopedErr) return { error: "Could not read your school's classes: " + scopedErr.message };
          return { classrooms: (scoped ?? []).map(shape) };
        }
        return { classrooms: [] };
      } catch (error) { return { error: error.message || "Could not list the classes" }; }
    }
    case "get_my_profile": {
      if (role !== "instructor") return { error: "Your profile is only available to instructor accounts" };
      try {
        const { data: me, error: meErr } = await db.from("users")
          .select("full_name, email, username, role").eq("id", studentId).maybeSingle();
        if (meErr) return { error: "Could not load your profile: " + meErr.message };
        let classes = null;
        try {
          const rooms = await instructorClassrooms(studentId);
          classes = rooms.length;
        } catch { /* the count is cosmetic — never fail the profile on it */ }
        const { data: schoolRow } = await db.from("school_teachers")
          .select("school_profiles ( name )").eq("teacher_id", studentId).limit(1).maybeSingle();
        return {
          profile: {
            fullName: me?.full_name || null, email: me?.email || null,
            username: me?.username || null, role: me?.role || null,
            school: schoolRow?.school_profiles?.name || null,
            classes,
          },
        };
      } catch (error) { return { error: error.message || "Could not load your profile" }; }
    }
    case "check_activity_outcomes": {
      if (role !== "instructor") return { error: "Activity outcomes are only available to instructor accounts" };
      try {
        if (input?.assignmentId) {
          const summary = await activityOutcomeSummary({ id: studentId, role }, String(input.assignmentId));
          if (!summary) return { error: "Activity not found among your activities" };
          return summary;
        }
        const recent = await listRecentActivities({ id: studentId, role }, 5);
        return { pickOne: true, recent: recent.map((a) => ({ assignmentId: a.id, title: a.title, type: a.type, createdAt: a.created_at })),
          hint: "Ask the instructor which one to look at, then call again with its assignmentId." };
      } catch (error) { return { error: error.message || "Could not read the outcomes" }; }
    }
    case "schedule_activity_routine": {
      if (role !== "instructor") return { error: "Routines are only available to instructor accounts" };
      try {
        const routine = await createRoutine({ id: studentId, role }, input);
        return { scheduled: true, routineId: routine.id, title: routine.title, day: input?.day, hourUtc: routine.hour,
          note: "Each occurrence prepares a DRAFT for review - never an automatic assignment." };
      } catch (error) {
        if (error.message === "audience_required") {
          return clarify("audience", "Who is this weekly activity for - the whole class, or specific learners?",
            { scheduled: false, error: "audience_required",
              message: "Ask the instructor who each occurrence is for, then schedule with their answer." });
        }
        return { scheduled: false, error: error.message || "Could not schedule the routine" };
      }
    }
    case "list_activity_routines": {
      if (role !== "instructor") return { error: "Routines are only available to instructor accounts" };
      try {
        const routines = await listRoutines({ id: studentId, role });
        return { routines: routines.map((r) => ({ routineId: r.id, title: r.title, day: r.day_of_week, hourUtc: r.hour, status: r.status, briefType: r.brief?.type })) };
      } catch (error) { return { error: error.message || "Could not list routines" }; }
    }
    case "cancel_activity_routine": {
      if (role !== "instructor") return { error: "Routines are only available to instructor accounts" };
      try {
        const out = await deleteRoutine({ id: studentId, role }, String(input?.routineId || ""));
        return { cancelled: true, routineId: out.id };
      } catch (error) { return { cancelled: false, error: error.message || "Could not cancel the routine" }; }
    }
    case "get_activity_draft": {
      if (role !== "instructor") return { error: "Activity drafts are only available to instructor accounts" };
      try {
        const draft = await getActivityDraft({ id: studentId, role }, String(input?.draftId || ""));
        return {
          draftId: draft.id, status: draft.status, title: draft.title, type: draft.type,
          subject: draft.subject, topic: draft.topic,
          instructions: draft.payload?.instructions ?? null,
          difficulty: draft.payload?.difficulty ?? null,
          subtopics: draft.payload?.subtopics ?? null,
          objectives: draft.payload?.objectives ?? null,
          stages: draft.payload?.details?.stages ?? null,
          scheduledHint: draft.payload?.details?.scheduled_hint ?? null,
          // An assignment's question versions: what each is, and the newest's questions.
          versions: Array.isArray(draft.payload?.versions) ? draft.payload.versions.map((v) => ({
            version: v.n, status: v.status, note: v.note ?? null, edited: !!v.edited, summary: v.summary?.line ?? null,
          })) : null,
          latestQuestions: (() => {
            const v = [...(draft.payload?.versions || [])].reverse().find((x) => x.status === "ready");
            return v ? (v.paper?.questions || []).map((q, i) => `Q${i + 1} [${q.type || (q.options ? "MCQ" : "open")}${q.figure ? ", diagram" : ""}] ${String(q.q).slice(0, 140)}`) : null;
          })(),
          audience: draft.audience ?? null,
          ...(draft.type === "teaching_tool" ? {
            tool: draft.payload?.tool ?? null,
            latestResult: (() => {
              const v = [...(draft.payload?.versions || [])].reverse().find((x) => x.status === "ready");
              return v?.result ? v.result.entries.map((e) => e.title).filter(Boolean).slice(0, 12) : null;
            })(),
          } : {}),
        };
      } catch (error) { return { error: error.message || "Could not read the draft" }; }
    }
    case "revise_activity_draft": {
      if (role !== "instructor") return { error: "Activity drafts are only available to instructor accounts" };
      try {
        const { draft, applied, version } = await reviseDraftPayload({ id: studentId, role }, String(input?.draftId || ""), input);
        return {
          revised: true, draftId: draft.id, title: draft.title, type: draft.type,
          audience: draft.audience?.label ?? null, applied,
          ...(version ? { version, questionsNote: `Version ${version} is being written now from the instructor's follow-up — it appears as a new tab in the preview. Reply with one short line.` } : {}),
          changeNote: String(input?.changeNote || "").slice(0, 200) || null,
          previewHint: "The updated draft is awaiting the instructor's preview again — still not assigned.",
        };
      } catch (error) { return { revised: false, error: error.message || "Could not revise the draft" }; }
    }
    case "get_agent_capabilities": {
      // Area loading (runtime selection): with { area }, load that area's
      // tools into this conversation and hand their defs back (__addTools)
      // so this same turn can use them.
      const wantArea = String(input?.area || "").trim().toLowerCase();
      if (wantArea) {
        if (!AREAS[wantArea]) return { error: `Unknown area "${wantArea}". Areas: ${Object.keys(AREAS).join(", ")}.` };
        stickyAreasFor(conversationId).add(wantArea);
        const builtIns = openAiChatTools().filter((t) => toolArea(t.function.name) === wantArea);
        const { defs: ownDefs, areas: ownAreas } = await learnerToolDefsWithAreas(studentId, role === "instructor" ? "instructor" : "learner").catch(() => ({ defs: [], areas: new Map() }));
        let adds = [...builtIns, ...ownDefs.filter((d) => ownAreas.get(d.function.name) === wantArea)];
        if (role === "instructor") {
          // Instructor catalogue: their built-ins in the area (the learner
          // builtIns above are not theirs), plus their own tools, with the
          // merged instructor domains assembled when activities load.
          adds = [...openAiInstructorTools().filter((t) => toolArea(t.function.name) === wantArea),
            ...ownDefs.filter((d) => ownAreas.get(d.function.name) === wantArea)];
          if (wantArea === "activities") {
            adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_classes, ["list_my_classrooms"], true);
            adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_class_students, [], true);
            adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_activities, [], true);
            adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_activity_results, ["check_activity_outcomes"], true);
            adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_activity_drafts, ["list_activity_drafts", "get_activity_draft"], true);
          }
        }
        else if (wantArea === "files" && role !== "instructor") adds = await applyLibraryMerge(adds, studentId, true);
        else if (wantArea === "chats" && role !== "instructor") adds = await applyChatsMerge(adds, studentId, true);
        else if (wantArea === "plans" && role !== "instructor") { adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_tasks, ["list_tasks"], true); adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_goals, ["list_my_goals"], true); }
        else if (wantArea === "teaching" && role !== "instructor") { adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_study_notes, ["search_my_study_knowledge"], true); adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_study_sessions, ["get_my_learning_sessions"], true); }
        else if (wantArea === "progress" && role !== "instructor") { adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_past_questions, ["get_past_question_practice"], true); adds = await applyMergedDomain(adds, studentId, MERGED_DOMAINS.my_weak_topics, ["get_weak_topics"], true); }
        return { loaded: wantArea, areaLabel: AREAS[wantArea], tools: adds.map((d) => d.function.name),
          note: `The ${AREAS[wantArea]} tools are loaded for this conversation now — continue the learner's request with them.`,
          __addTools: adds };
      }
      // Default-on keys consult the kill-switch semantics, not strict equality,
      // so the card must never deny an ability the runtime has.
      const enabled = (key) => ["AKORO_EXAM_PREP_CONFIDENCE_ENABLED", "AKORO_ADAPTIVE_WORKFLOWS_ENABLED", "AKORO_STUDY_PREP_ENABLED"].includes(key)
        ? String(process.env[key] ?? "true").toLowerCase() !== "false"
        : String(process.env[key] || "").toLowerCase() === "true";
      return {
        areas: Object.entries(AREAS).map(([id, label]) => ({ id, label })),
        sections: [
          { title: "Study support", items: ["Explain and quiz you on what you have taught it — it is your protégé", "Tell you honestly what you haven\u2019t taught it yet, point you to sources and ask you to teach it", "Ask NaNa, its teaching guide, when you insist on something it wasn\u2019t taught (and say so)", "Help draft and improve study notes, essays, and revision plans", "Show safe study profile, learning overview, knowledge-map, saved-study-knowledge, guide-preference, and Online/Offline status when asked",
            // same default-on semantics as the tool's featureGate
            ...(String(process.env.AKORO_AGENT_PEER_CONSULT_ENABLED ?? "true").toLowerCase() !== "false"
              ? ["Ask other learners\u2019 study agents for fresh ideas when you\u2019re stuck \u2014 only your question travels, never your data"] : [])] },
          { title: "School", items: ["Show your school and class, its subjects, and your teachers — and find a teacher by name or subject"] },
          ...(agentNetworkEnabled ? [{ title: "Battles and other agents", items: [
            "Find your battles and the daily battle, and show your XP and rank",
            "Search for other learners' agents (online now, by subject, school, exam…) and their challenge requests",
            "Challenge agents, post or accept a challenge request, rematch — only when you ask",
            "Message or consult other agents, check your agent's inbox, and reply — only when you ask",
            "Study buddies, the daily battle, revision circles and the weekly league",
          ] }] : []),
          { title: "Organisation", items: ["Create learner-owned study tasks when explicitly asked", "Schedule a future chat message when explicitly asked", "Show due tasks and recorded learning progress", "Save, update and track study goals when explicitly asked", "Show the suggestions from its background reviews waiting in the inbox", "Draft, save and publish the learner\u2019s blog posts when explicitly asked"] },
          { title: "Learning tools", items: [
            ...(enabled("AKORO_STUDY_PREP_ENABLED") ? ["Plan a study-prep session for a test or exam — a plan card you approve before anything starts"] : []),
            "Show your past and recent learning sessions",
            ...(enabled("AKORO_EXAM_PREP_CONFIDENCE_ENABLED") ? ["Show generated exam-style practice and workflow status; these are not historical past papers"] : []),
            ...(enabled("AKORO_CONCEPT_TRACKER_ENABLED") ? ["Show approved-concept progress, resume points, and clearable confusion notes"] : []),
            ...(enabled("AKORO_LEARNER_INSIGHTS_ENABLED") ? ["Explain a bounded, expiry-aware learning-insights summary"] : []),
            // Consult the REAL gate (default-on), not a strict env-equality
            // check — the card must never deny an ability the runtime has.
            ...(durableAgentChatContextEnabled ? ["Remember across chats — this conversation and the learner\u2019s saved study context are available to you (they can clear it any time)"] : []),
          ] },
          { title: "Limits", items: ["Asks a clarifying question when a tool needs a detail you did not give — it never guesses values", "Read supported files attached to this chat", "Generated questions are not historical past papers", "Can submit an admin feature request only after you explicitly ask", "Research from Akoro\u2019s own blog (search_blog_posts / read_blog_post) \u2014 do not browse the live web, access private account secrets, or take unrequested actions"] },
        ].filter((section) => section.items.length),
      };
    }
    case "get_learner_context":
      return getLearnerProfileContext(studentId).catch(asToolError("your profile"));
    case "check_progress": {
      const { data: enrollments } = await db.from("enrollments")
        .select("course_id, progress, courses!inner(title, subject, slug)")
        .eq("user_id", studentId).eq("status", "active");
      // The OVERALL row — the table has one per scope (global/course/classroom).
      const { data: xpRow } = await db.from("xp_leaderboard")
        .select("total_xp, rank").eq("user_id", studentId).eq("scope", "global").limit(1);
      return {
        courses:  (enrollments ?? []).map(e => ({ title: e.courses?.title, subject: e.courses?.subject, progress: e.progress ?? 0, slug: e.courses?.slug || null })),
        total_xp: xpRow?.[0]?.total_xp ?? 0,
        rank:     xpRow?.[0]?.rank ?? "—",
      };
    }
    case "get_progress_overview": {
      // The progress bundle in ONE call (2026-11-17): the four reads a
      // "how am I doing?" answer needs, run together server-side. Each part
      // keeps the shape its own tool returns; a part that fails carries its
      // error in place so the rest still answer.
      const part = async (tool) => {
        try { return await runChatTool(tool, {}, studentId, { conversationId, role, channel }); }
        catch { return { error: "Couldn't load this part just now." }; }
      };
      const [progress, overview, ranking, knowledgeMap] = await Promise.all([
        part("check_progress"), part("get_learning_overview"), part("get_ranking"), part("get_knowledge_map"),
      ]);
      return { progress, overview, ranking, knowledgeMap };
    }
    case "get_my_school": {
      try {
        const ctx = await resolveLearnerSchoolContext(studentId);
        // No school anywhere: the honest answer is "none is linked" — the
        // agent says exactly that instead of inventing a school.
        return {
          school: ctx.school,
          className: ctx.className,
          sectionName: ctx.sectionName,
          classrooms: ctx.classrooms.map((c) => c.name),
        };
      } catch (error) { return { error: error.message || "Could not load your school right now" }; }
    }
    case "list_school_subjects": {
      try {
        const ctx = await resolveLearnerSchoolContext(studentId);
        if (!ctx.schoolId) {
          // No school link: the only honest subject signal is what the
          // learner's own classroom teachers declare.
          const subjects = [];
          const teacherIds = [...new Set(ctx.classrooms.map((c) => c.teacher_id).filter(Boolean))];
          if (teacherIds.length) {
            const { data: profiles } = await db.schema("edu").from("teacher_profiles")
              .select("teacher_id, teacher_name, subject").in("teacher_id", teacherIds);
            const byTeacher = new Map((profiles ?? []).map((p) => [p.teacher_id, p]));
            for (const room of ctx.classrooms) {
              const profile = room.teacher_id ? byTeacher.get(room.teacher_id) : null;
              if (profile?.subject) subjects.push({ name: profile.subject, teacher: profile.teacher_name || null, class: room.name });
            }
          }
          return { subjects, source: "classroom teachers",
            note: "No school is linked to this learner, so this list comes from their classroom teachers only — say that when you use it." };
        }
        const { data: schoolSubjects, error: subjErr } = await db.schema("mgmt").from("subjects")
          .select("id, name, code, subject_type").eq("school_id", ctx.schoolId).order("name").limit(60);
        if (subjErr) return { error: "Could not load the school's subjects: " + subjErr.message };
        let classSubjects = null;
        if (ctx.classId) {
          const { data: assigned, error: assignedErr } = await db.schema("mgmt").from("class_subjects")
            .select("subject_id, teacher_id, is_elective").eq("class_id", ctx.classId).limit(60);
          if (!assignedErr && (assigned ?? []).length) {
            const subjById = new Map((schoolSubjects ?? []).map((s) => [s.id, s]));
            const teacherIds = [...new Set(assigned.map((r) => r.teacher_id).filter(Boolean))];
            // An empty .in() is not a valid PostgREST filter — guard it.
            const teacherRows = teacherIds.length
              ? (await db.from("users").select("id, full_name").in("id", teacherIds)).data
              : [];
            const nameById = new Map((teacherRows ?? []).map((u) => [u.id, u.full_name]));
            classSubjects = assigned
              .map((r) => ({
                subject: subjById.get(r.subject_id)?.name || null,
                elective: Boolean(r.is_elective),
                teacher: r.teacher_id ? (nameById.get(r.teacher_id) || null) : null,
              }))
              .filter((s) => s.subject);
          }
        }
        return {
          school: ctx.school?.name || null,
          class: ctx.className ? (ctx.sectionName ? `${ctx.className} ${ctx.sectionName}` : ctx.className) : null,
          subjects: (schoolSubjects ?? []).map((s) => ({ name: s.name, code: s.code || null, type: s.subject_type || "core" })),
          classSubjects,
          note: classSubjects ? "subjects = the whole school; classSubjects = the learner's own class." : null,
        };
      } catch (error) { return { error: error.message || "Could not load the school's subjects right now" }; }
    }
    case "list_my_teachers": {
      try {
        const ctx = await resolveLearnerSchoolContext(studentId);
        const teachers = [];
        const seen = new Set();
        const push = (fullName, subject, teaches) => {
          if (!fullName) return;
          const key = `${fullName}|${subject || ""}`;
          if (seen.has(key)) return;
          seen.add(key);
          teachers.push({ fullName, subject: subject || null, teaches: teaches || null });
        };
        const classroomTeacherIds = [...new Set(ctx.classrooms.map((c) => c.teacher_id).filter(Boolean))];
        if (classroomTeacherIds.length) {
          const { data: rows } = await db.from("users").select("id, full_name").in("id", classroomTeacherIds);
          const { data: profiles } = await db.schema("edu").from("teacher_profiles")
            .select("teacher_id, teacher_name, subject").in("teacher_id", classroomTeacherIds);
          const profileBy = new Map((profiles ?? []).map((p) => [p.teacher_id, p]));
          const nameBy = new Map((rows ?? []).map((u) => [u.id, u.full_name]));
          for (const room of ctx.classrooms) {
            const profile = room.teacher_id ? profileBy.get(room.teacher_id) : null;
            push(nameBy.get(room.teacher_id) || profile?.teacher_name || null, profile?.subject || null, room.name);
          }
        }
        if (ctx.classId && ctx.schoolId) {
          const { data: assigned } = await db.schema("mgmt").from("class_subjects")
            .select("subject_id, teacher_id").eq("class_id", ctx.classId).limit(60);
          const rows = (assigned ?? []).filter((r) => r.teacher_id);
          if (rows.length) {
            const { data: subjRows } = await db.schema("mgmt").from("subjects")
              .select("id, name").eq("school_id", ctx.schoolId).limit(100);
            const subjBy = new Map((subjRows ?? []).map((s) => [s.id, s.name]));
            const { data: users } = await db.from("users")
              .select("id, full_name").in("id", [...new Set(rows.map((r) => r.teacher_id))]);
            const nameBy = new Map((users ?? []).map((u) => [u.id, u.full_name]));
            const classLabel = ctx.className ? (ctx.sectionName ? `${ctx.className} ${ctx.sectionName}` : ctx.className) : null;
            for (const r of rows) push(nameBy.get(r.teacher_id), subjBy.get(r.subject_id) || null, classLabel);
          }
        }
        return { teachers };
      } catch (error) { return { error: error.message || "Could not load your teachers right now" }; }
    }
    case "find_teacher": {
      try {
        const name = String(input?.name || "").trim().replace(/[%_\\]/g, " ");
        if (name.length < 2) {
          return clarify("name", "Which teacher would you like me to find? Tell me their name — for example 'Mrs Adeyemi'.", { action: "find_teacher" });
        }
        const ctx = await resolveLearnerSchoolContext(studentId);
        // Scope: the learner's school staff plus their own classroom teachers.
        const ids = new Set(ctx.classrooms.map((c) => c.teacher_id).filter(Boolean));
        if (ctx.schoolId) {
          const { data: staff } = await db.from("school_teachers")
            .select("teacher_id").eq("school_id", ctx.schoolId).limit(200);
          for (const r of staff ?? []) if (r.teacher_id) ids.add(r.teacher_id);
        }
        if (!ids.size) return { matches: [], searchedFor: name,
          note: "No teachers are linked to this learner's school or classrooms yet." };
        const { data: users, error: usersErr } = await db.from("users")
          .select("id, full_name").eq("role", "instructor")
          .in("id", [...ids]).ilike("full_name", `%${name}%`).limit(5);
        if (usersErr) return { error: "Could not search for that teacher: " + usersErr.message };
        const matches = [];
        for (const u of users ?? []) {
          const { data: profile } = await db.schema("edu").from("teacher_profiles")
            .select("teacher_name, subject").eq("teacher_id", u.id).limit(1).maybeSingle();
          const { data: rooms } = await db.from("classrooms")
            .select("name").eq("teacher_id", u.id).limit(10);
          matches.push({
            fullName: u.full_name || profile?.teacher_name || null,
            subject: profile?.subject || null,
            classes: (rooms ?? []).map((r) => r.name),
            school: ctx.school?.name || null,
          });
        }
        return { matches: matches.filter((m) => m.fullName), searchedFor: name };
      } catch (error) { return { error: error.message || "Could not look up that teacher right now" }; }
    }
    case "get_my_learning_sessions":
      return getMyLearningSessionsTool(studentId);
    case "create_task": {
      if (!input?.title || !String(input.title).trim()) {
        return clarify("title", "What should the task be called?", { action: "create_task" });
      }
      try {
        const context = await getLearnerProfileContext(studentId);
        const taskInput = validateLearnerTaskInput(input, { defaultTimezone: context.timeZone });
        if (taskInput.recurrenceEverySeconds && !taskInput.dueAt) {
          return clarify("dueAt", "A repeating task needs a due time to anchor it — when should the first one be due (a date/time, or 'in 2 hours')?", { action: "create_task" });
        }
        const { data: agentRow } = await db.from("user_agents").select("id").eq("user_id", studentId).maybeSingle();
        // tasks.agent_id is required — a learner who hasn't made their agent yet
        // got a raw database error here.
        if (!agentRow?.id) return { error: "Create your agent first (Agent tab) — tasks are kept by your agent." };
        const { data: task, error } = await db.from("tasks").insert({
          creator_id: studentId, agent_id: agentRow?.id,
          title: taskInput.title, description: taskInput.description, priority: taskInput.priority,
          status: "pending", task_type: "general",
          payload: {
            due: taskInput.due,
            course: taskInput.course,
            ...(taskInput.recurrenceEverySeconds ? { recurrence: { everySeconds: taskInput.recurrenceEverySeconds } } : {}),
          },
          due_at: taskInput.dueAt,
          timezone: taskInput.timezone,
        }).select().single();
        if (error) return { error: error.message };
        // This is intentionally best-effort: creating a learner-requested task
        // never depends on Redis, and the worker re-checks the persisted opt-in.
        try { await scheduleAutonomyReviewForTask(task); }
        catch (autonomyError) { console.warn("[chat/create-task] autonomy schedule skipped:", autonomyError.message); }
        global.io?.to(`user:${studentId}`).emit("task:created", task);
        return {
          created: true, taskId: task.id, title: task.title, description: task.description,
          priority: task.priority, dueAt: task.due_at ?? null, timezone: task.timezone,
          dueLocal: task.due_at ? localiseInstant(task.due_at, taskInput.timezone) : null,
          repeatsEveryDays: taskInput.recurrenceEveryDays || null,
          repeatsEverySeconds: taskInput.recurrenceEverySeconds || null,
          autonomyEligible: Boolean(task.due_at && !task.is_recurring),
        };
      } catch (error) {
        return { error: error.message || "Could not create the task" };
      }
    }
    case "consult_peer_agents": {
      const question = String(input?.question || "").trim();
      if (question.length < PEER_QUESTION_MIN || question.length > PEER_QUESTION_MAX) {
        return clarify("question", `Keep the peer question between ${PEER_QUESTION_MIN} and ${PEER_QUESTION_MAX} characters — one focused, general ask.`, { action: "consult_peer_agents" });
      }
      if (/[\w.+-]+@[\w-]+\.[\w.-]{2,}/.test(question) || /\+?\d[\d\s().-]{7,}\d/.test(question)) {
        return clarify("question", "Keep peer questions general — no contact details (emails, phone numbers or invite links) travel to other agents.", { action: "consult_peer_agents" });
      }
      try {
        // §7.13: a named struggle first asks what worked for learners who got past the
        // same one (their breakthroughs, opt-in stories + anonymous totals) — no model call.
        if (input?.struggleType) {
          const help = await consultBreakthroughs({ userId: studentId, struggleType: String(input.struggleType).slice(0, 60),
            concept: input?.concept ? String(input.concept).slice(0, 120) : null, subject: input?.subject ? String(input.subject).slice(0, 80) : null });
          if (help?.stories?.length || help?.pattern) {
            return { ...help, note: "These are real breakthroughs from other learners who had the same struggle. Share one story's what-worked move, naming the agent (never a learner), and offer to try it; a pattern is totals only. Never treat them as evidence." };
          }
        }
        // Real agents first: up to two ONLINE agents answer from what their
        // own learners taught them (the asker pays). Nobody online → the
        // simulated peer ideas, as before.
        if (agentNetworkEnabled) {
          const live = await consultOnlineAgents(studentId, question, { topic: input?.topic || null, deps: protegeDeps }).catch(() => null);
          if (live?.consulted) return { ...live, note: "These are real learners' agents online now — say each reply comes from that learner's agent, by name." };
        }
        const consult = await consultPeerAgents({
          userId: studentId, question,
          topic: input?.topic,
        });
        if (!consult.consulted) {
          return {
            consulted: 0, replies: [],
            note: consult.note === "no_peers_yet"
              ? "No other agents are active on the network yet — answer from your own knowledge instead."
              : consult.note === "contact_details"
              ? "The question was rejected by the privacy guard — rephrase it generally."
              : "No peer agent could answer just now — answer from your own knowledge instead.",
          };
        }
        return consult; // { consulted, replies: [{agent, emoji, reply}], topic }
      } catch (error) {
        return { error: error.message || "The agent network is unavailable right now" };
      }
    }
    // ── The protégé (protege.js, policies/PROTEGE.md) ─────────────────────
    case "ask_to_be_taught": {
      const teach = teachRequest(input);
      if (!teach) return clarify("topic", "Which topic should the learner teach you?", { error: "topic_required" });
      // Somewhere to read about it first: Akoro's own courses and posts on the topic (D52), shown as links.
      const materials = await akoroMaterialFor(teach.topic).catch(() => []);
      return {
        asked: true, ...teach, ...(materials.length ? { materials } : {}),
        note: materials.length
          ? "The learner now sees a Teach me button for this topic, and Akoro's material on it as links under your reply. Say you haven't been taught it, suggest they open one of those to learn it, then teach you — don't explain it or write study material (flashcards, notes, a quiz) on it yourself. Don't list the links; they're shown."
          : "The learner now sees a Teach me button for this topic. Say you haven't been taught it, point to where they can read about it first (the syllabus topics shown, their Library), and wait — don't explain it or write study material (flashcards, notes, a quiz) on it yourself.",
      };
    }
    case "consult_teaching_guide": {
      const question = String(input?.question || "").trim();
      if (!question) return clarify("question", "What should I ask my teaching guide?", { error: "question_required" });
      try {
        const query = [input?.topic, question].filter(Boolean).join(" — ");
        const [taught, { context: syllabus }] = await Promise.all([
          loadTaughtKnowledge({ studentId, query, deps: protegeDeps }).catch(() => ({ chunks: [] })),
          getSyllabusGrounding(query, { limit: 3 }).catch(() => ({ context: "" })),
        ]);
        const completion = await openai.chat.completions.create({
          __role: "persona", temperature: 0.3, max_tokens: 700,
          __timeoutMs: 30_000, __maxRetries: 1,
          response_format: { type: "json_object" },
          messages: buildGuideMessages({ question, topic: input?.topic, subject: input?.subject, taught: taught.chunks || [], syllabus }),
          __userId: studentId, __feature: "teaching_guide",
        });
        const answer = shapeGuideAnswer(completion.choices?.[0]?.message?.content);
        if (!answer.explanation) return { consulted: false, error: "The teaching guide had no answer this time." };
        return {
          consulted: true, guide: "NaNa Esumai", explanation: answer.explanation, teachNext: answer.teachNext,
          ...(teachRequest(input) ? { teach: teachRequest(input) } : {}),
          rule: "Open with \"From NaNa, my teaching guide (you haven't taught me this):\", pass the explanation on in your own voice, then invite them to teach it back to you.",
        };
      } catch (error) {
        return { consulted: false, error: error.message || "The teaching guide is unavailable right now." };
      }
    }
    case "search_blog_posts": {
      try {
        return await searchBlogPosts({
          query: input?.query,
          category: input?.category,
          limit: input?.limit,
        });
      } catch (error) {
        return { error: error.message || "The blog search is unavailable right now" };
      }
    }
    case "read_blog_post": {
      if (!input?.slug || !String(input.slug).trim()) {
        return clarify("slug", "Which post should I read? Pass the slug from a blog search.", { action: "read_blog_post" });
      }
      try {
        return await readBlogPost({ slug: input.slug });
      } catch (error) {
        return { error: error.message || "The blog is unavailable right now" };
      }
    }
    case "list_my_goals":
      return listMyGoalsTool(studentId);
    case "create_goal": {
      if (!input?.title || !String(input.title).trim()) {
        return clarify("title", "What goal should I save? One clear line, e.g. 'Score 80% in Further Maths'.", { action: "create_goal" });
      }
      try {
        // The learner explicitly asked, so provenance is 'learner' — the agent
        // never self-inserts goals (autonomous ideas go via proposals).
        const { goal, error } = await createGoal(studentId, {
          title: input.title, category: input.category, metric: input.metric,
          exam: input.exam, target_date: input.targetDate,
        });
        if (error) return { error };
        return { created: true, goalId: goal.id, title: goal.title, category: goal.category, targetDate: goal.target_date, status: goal.status };
      } catch (error) {
        return { error: error.message || "Could not save the goal" };
      }
    }
    case "update_goal_progress": {
      if (!input?.goalId) {
        return clarify("goalId", "Which goal? Call list_my_goals first and match the one they mean.", { action: "update_goal_progress" });
      }
      try {
        const { goal, error, notFound } = await updateGoal(studentId, input.goalId, {
          status: input.status, progress_note: input.progressNote, target_date: input.targetDate,
        });
        if (notFound) return { error: "That goalId doesn't match one of the learner's goals — call list_my_goals." };
        if (error) return { error };
        return { updated: true, goalId: goal.id, title: goal.title, status: goal.status, progressNote: goal.progress_note };
      } catch (error) {
        return { error: error.message || "Could not update the goal" };
      }
    }
    case "list_my_proposals": {
      try {
        const { data, error } = await db.schema("edu").from("agent_proposals")
          .select("id, kind, title, rationale, status, created_at, decided_at")
          .eq("user_id", studentId)
          .order("created_at", { ascending: false })
          .limit(12);
        if (error) return { error: "Could not load the proposals" };
        const rows = data ?? [];
        const pending = rows.filter((r) => r.status === "proposed");
        return {
          pendingCount: pending.length,
          proposals: [...pending, ...rows.filter((r) => r.status !== "proposed")].map((r) => ({
            proposalId: r.id, kind: r.kind, title: r.title, rationale: r.rationale,
            status: r.status, createdAt: r.created_at, decidedAt: r.decided_at,
          })),
          note: "The learner approves or dismisses each proposal in the Suggestions tab — you can discuss them, never execute them.",
        };
      } catch (error) {
        return { error: error.message || "Could not load the proposals" };
      }
    }
    case "list_my_blogs": {
      try {
        const { blogs, error } = await listMyBlogs(studentId);
        if (error) return { error };
        return {
          count: (blogs ?? []).length,
          blogs: (blogs ?? []).map((b) => ({
            blogId: b.id, title: b.title, status: b.status, excerpt: b.excerpt, updatedAt: b.updatedAt,
          })),
        };
      } catch (error) {
        return { error: error.message || "Could not load the blogs" };
      }
    }
    case "save_blog_draft": {
      if (!input?.title || !String(input.title).trim()) {
        return clarify("title", "What should the blog be titled?", { action: "save_blog_draft" });
      }
      if (input?.body === undefined || !String(input.body).trim()) {
        return clarify("body", "Give me the blog text to save — draft the wording with me first if you like.", { action: "save_blog_draft" });
      }
      try {
        // Editing a PUBLISHED post would put the edit live at once — this tool
        // promises a draft, so it refuses and points at publish_blog.
        if (input?.blogId) {
          const { data: existing } = await db.schema("edu").from("blogs").select("status").eq("id", input.blogId).eq("user_id", studentId).maybeSingle();
          if (existing?.status === "published") {
            return { error: "That post is already published — saving would put the edit live. Ask the learner whether to publish the change (publish_blog) or save it as a new draft (no blogId)." };
          }
        }
        const result = input?.blogId
          ? await updateBlogPost(studentId, input.blogId, { title: input.title, body: input.body })
          : await createBlogPost(studentId, { title: input.title, body: input.body, status: "draft" });
        if (result.error) return { error: result.error };
        if (result.notFound) return { error: "That blogId doesn't match one of the learner's posts — call list_my_blogs." };
        return { saved: true, blogId: result.blog.id, title: result.blog.title, status: result.blog.status };
      } catch (error) {
        return { error: error.message || "Could not save the draft" };
      }
    }
    case "publish_blog": {
      if (!input?.title || !String(input.title).trim()) {
        return clarify("title", "What should the blog be titled?", { action: "publish_blog" });
      }
      if (input?.body === undefined || !String(input.body).trim()) {
        return clarify("body", "Give me the full blog text — an empty post can't be published.", { action: "publish_blog" });
      }
      try {
        const result = input?.blogId
          ? await updateBlogPost(studentId, input.blogId, { title: input.title, body: input.body, status: "published" })
          : await createBlogPost(studentId, { title: input.title, body: input.body, status: "published" });
        if (result.error) return { error: result.error };
        if (result.notFound) return { error: "That blogId doesn't match one of the learner's posts — call list_my_blogs." };
        return { published: true, blogId: result.blog.id, title: result.blog.title, publishedAt: result.blog.published_at };
      } catch (error) {
        return { error: error.message || "Could not publish the blog" };
      }
    }
    case "suggest_help": {
      try {
        const kind = ["task", "goal", "conversation"].includes(input?.kind) ? input.kind : "conversation";
        const title = String(input?.title || "").trim().slice(0, 140);
        const rationale = String(input?.rationale || "").trim().slice(0, 400);
        if (!title) return { error: "A suggestion needs a title" };
        // A suggest_help filing is a special suggestion: it lands as a NEW
        // CHAT at the top of their chats (priority), never in the Suggestions
        // list — see modules/agent-proposals/suggestHelp.js (dedupe lives there).
        const { openSuggestHelpChat } = await import("../agent-proposals/suggestHelp.js");
        const out = await openSuggestHelpChat(studentId, { kind, title, rationale });
        if (out.duplicate) return { saved: false, duplicate: true, title, note: "This idea is already open for them — mention it instead of filing it again." };
        if (!out.delivered) return { error: out.error || "Could not open the chat" };
        return { saved: true, delivered: "new_chat", chatId: out.chatId, kind, title,
          note: `Tell the learner in one line that you've opened a new chat titled "${title}" — it's at the top of their chats.` };
      } catch (error) {
        return { error: error.message || "Could not save the suggestion" };
      }
    }
    case "schedule_chat_follow_up": {
      if (!input?.message || !String(input.message).trim()) {
        return clarify("message", "What should the future chat message say?", { action: "schedule_chat_follow_up" });
      }
      if (!input?.scheduledAt && !(Number(input?.inMinutes) > 0)) {
        return clarify("scheduledAt", "When should it be sent? Say e.g. 'in 10 minutes' or give the date and time.", { action: "schedule_chat_follow_up" });
      }
      try {
        // "remind me" with no destination → THIS chat, where the learner will
        // actually see it. Defaulting to a new chat hid reminders in a separate
        // thread ("Scheduled check-in") the learner never opened. A separate
        // chat must be asked for explicitly (where='new').
        const where = (input.where === "here" || input.where === "chat" || input.where === "new")
          ? input.where
          : (input.chatId ? "chat" : (conversationId ? "here" : "new"));
        let targetSessionId = null;
        if (where === "here") {
          if (!conversationId) return { error: "This chat is not saved yet, so a message can't be scheduled into it — send it to a new chat instead (where='new')." };
          targetSessionId = conversationId;
        } else if (where === "chat") {
          targetSessionId = await ownedChatId(studentId, input.chatId);
          if (!targetSessionId) return { error: "That chat wasn't found among the learner's chats — call list_chats for a valid chatId." };
        }
        // runTool must be one of THIS learner's own tools (it runs as them, read-only, at each send).
        if (input.runTool) {
          const { listMyTools } = await import("../self-tooling/pipeline.js");
          const mine = await listMyTools(studentId).catch(() => []);
          if (!mine.some((t) => t.name === input.runTool && t.status === "active")) {
            return { error: `"${input.runTool}" isn't one of the learner's active tools — build it first with create_tool, or schedule the reminder without runTool.` };
          }
        }
        const context = await getLearnerProfileContext(studentId);
        const schedule = await scheduleChatFollowUp({
          userId: studentId,
          input,
          defaultTimezone: context.timeZone,
          targetSessionId,
        });
        return {
          scheduled: true,
          ...schedule,
          deliversTo: where === "new" ? "a new chat" : where === "here" ? "this chat" : "the chosen chat",
          timezoneSource: input.timezone ? "explicit_request" : context.timeZoneSource,
          localScheduledAt: localiseInstant(schedule.scheduledAt, schedule.timezone),
        };
      } catch (error) {
        return { error: error.message || "Could not schedule the chat follow-up" };
      }
    }
    case "get_past_question_practice":
      return getPastQuestionPracticeTool(studentId, input);
    case "schema_lookup": {
      if (!SELF_TOOLING_ROLES.has(role)) return { error: "Building tools is for learners and instructors." };
      if (!(await selfToolingAllowedFor(studentId))) return { error: "Building new tools isn't turned on for this account yet." };
      if (!input?.goal || !String(input.goal).trim()) return clarify("goal", "What would you like the new tool to find out or do?", { action: "schema_lookup" });
      try { return await schemaLookup(String(input.goal).slice(0, 300), { audience: toolAudience(role), learnerId: studentId }); }
      catch (error) { return { error: error.message || "Couldn't check what's available right now" }; }
    }
    case "create_tool": {
      if (!SELF_TOOLING_ROLES.has(role)) return { error: "Building tools is for learners and instructors." };
      if (!(await selfToolingAllowedFor(studentId))) return { error: "Building new tools isn't turned on for this account yet." };
      try {
        return await createTool({ learnerId: studentId, input: input || {}, dry: isDryRun(), conversationId,
          audience: toolAudience(role), ...selfToolDeps(studentId, role === "instructor" ? "instructor" : "student") });
      } catch (error) {
        console.warn("[self-tooling] create_tool failed:", error?.stack || error?.message || error);
        return { status: "rejected", reason: "Building the tool failed unexpectedly — try again." };
      }
    }
    case "save_computation": {
      if (!SELF_TOOLING_ROLES.has(role)) return { error: "Saving tools is for learners and instructors." };
      if (!(await selfToolingAllowedFor(studentId))) return { error: "Building new tools isn't turned on for this account yet." };
      try {
        return await saveComputation({ learnerId: studentId, hint: input?.hint || null, conversationId, ...selfToolDeps(studentId, role === "instructor" ? "instructor" : "student") });
      } catch (error) {
        console.warn("[self-tooling] save_computation failed:", error?.stack || error?.message || error);
        return { status: "rejected", reason: "Saving the tool failed unexpectedly — try again." };
      }
    }
    case "await_decision": {
      if (!SELF_TOOLING_ROLES.has(role)) return { error: "Card decisions are for learners and instructors." };
      if (!(await selfToolingAllowedFor(studentId))) return { error: "Self-tooling isn't turned on for this account yet." };
      if (!input?.confirmationId) return { error: "confirmationId is required — use the one from the card's tool result." };
      try {
        const { awaitDecision } = await import("../self-tooling/confirmations.js");
        return await awaitDecision({ id: String(input.confirmationId), userId: studentId,
          callTool: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling_confirmed" }),
          buildTool: (args) => createTool({ ...args, ...selfToolDeps(studentId, role === "instructor" ? "instructor" : "student") }),
          toolDeps: selfToolDeps(studentId, role === "instructor" ? "instructor" : "student") });
      } catch (error) {
        console.warn("[self-tooling] await_decision failed:", error?.stack || error?.message || error);
        return { status: "error", error: "Waiting for the decision failed — the card is still live; the learner's tap will be picked up in the next turn." };
      }
    }
    case "list_chats": {
      try { return await listChats(studentId, { search: input?.search, limit: input?.limit, currentChatId: conversationId }); }
      catch (error) { return { error: error.message || "Could not load your chats" }; }
    }
    case "read_chat": {
      if (!input?.chatId) return clarify("chatId", "Which chat should I read? I can list your chats.", { action: "read_chat" });
      try { return await readChat(studentId, input.chatId, { limit: input.limit, around: input.around }); }
      catch (error) { return { error: error.message || "Could not read that chat" }; }
    }
    case "search_chats": {
      if (!input?.query || !String(input.query).trim()) return clarify("query", "What should I look for in your past chats?", { action: "search_chats" });
      try { return await searchChats(studentId, { query: input.query, limit: input.limit, currentChatId: conversationId }); }
      catch (error) { return { error: error.message || "Could not search your chats" }; }
    }
    case "post_to_chat": {
      if (!input?.chatId) return clarify("chatId", "Which chat should I post it in? I can list your chats.", { action: "post_to_chat" });
      if (!input?.message || !String(input.message).trim()) return clarify("message", "What should the message say?", { action: "post_to_chat" });
      try { return await postToChat(studentId, { chatId: input.chatId, message: input.message, currentChatId: conversationId }); }
      catch (error) { return { error: error.message || "Could not post the message" }; }
    }
    case "list_scheduled_chat_follow_ups": {
      try {
        return await listChatFollowUps({ userId: studentId });
      } catch (error) {
        return { error: error.message || "Could not load scheduled chat follow-ups" };
      }
    }
    case "cancel_scheduled_chat_follow_up": {
      if (!input?.followUpId) {
        return clarify("followUpId", "Which scheduled message should be cancelled? Here are the pending ones — or ask me to list them.", { action: "cancel_scheduled_chat_follow_up" });
      }
      try {
        return await cancelChatFollowUp({ userId: studentId, followUpId: input.followUpId });
      } catch (error) {
        return { error: error.message || "Could not cancel the chat follow-up" };
      }
    }
    case "send_email_to_me": {
      const subject = String(input?.subject || "").trim();
      const body = String(input?.body || "").trim();
      if (!subject) return clarify("subject", "What should the email's subject be?", { action: "send_email_to_me" });
      if (!body) return clarify("body", "What should the email say?", { action: "send_email_to_me" });
      try {
        const [{ data: user }, { data: prefs }] = await Promise.all([
          db.from("users").select("email, full_name, username").eq("id", studentId).maybeSingle(),
          db.from("user_notification_preferences").select("email_enabled").eq("user_id", studentId).maybeSingle(),
        ]);
        if (!user?.email) return { error: "There's no email address on this account, so an email can't be sent." };
        if (prefs?.email_enabled === false) return { error: "Email is turned off in this account's notification settings, so the email wasn't sent." };
        await sendNotificationEmail({
          to: user.email,
          name: user.full_name || user.username || undefined,
          subject: subject.slice(0, 120),
          heading: subject.slice(0, 120),
          body: body.slice(0, 4000),
          ctaUrl: appLink("tab=agent"),
          ctaLabel: "Open in Akoro",
        });
        return { sent: true, to: user.email };
      } catch (error) {
        return { error: error.message || "Could not send the email" };
      }
    }
    case "list_tasks":
      return listTasksTool(studentId);
    case "search_agents": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      const r = await searchAgents(studentId, input || {});
      return {
        agents: r.agents.map((a) => ({
          userId: a.userId, name: a.name, username: `@${a.username}`, agent: `${a.agentEmoji} ${a.agentName}`, level: a.level, xp: a.xp,
          rank: a.rank, winRate: a.winRate, presence: a.presence, available: a.available, school: a.school, yearGroup: a.yearGroup,
          exam: a.exam, subjects: a.subjects, shared: a.shared, matches: a.matches, openToChallenges: a.openToChallenges, battleTimes: a.battleTimes,
        })),
        total: r.total, page: r.page,
        note: r.total ? "Use the names exactly as given. Offer to message, consult or challenge one of them." : "No agents match — try fewer filters or a wider scope.",
      };
    }
    case "update_agent_network_settings": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      try { return { saved: true, settings: await saveAgentNetworkSettings(studentId, input || {}) }; }
      catch (e) { return { saved: false, error: e.message }; }
    }
    case "block_agent": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      if (!input?.userId) return clarify("userId", "Which agent should I block? Find them with search_agents first.");
      try {
        if (input.report_reason) await reportAgent(studentId, input.userId, input.report_reason, { via: "agent_chat" });
        else await blockAgent(studentId, input.userId);
        return { blocked: true, reported: !!input.report_reason };
      } catch (e) { return { blocked: false, error: e.message }; }
    }
    case "log_past_question_practice": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      try {
        const logged = await logPastQuestions(studentId, { ...input, source: "agent" });
        return { logged: true, entry: logged, summary: await pastQuestionSummary(studentId) };
      } catch (e) { return { logged: false, error: e.message }; }
    }
    case "find_competitors": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      const { source, ...rest } = input || {};
      const r = await searchAgents(studentId, { ...rest, scope: source || "everyone", open_to_challenges: true, fair_match: rest.fair_match ?? (rest.min_xp == null && rest.max_xp == null && rest.rank_max == null), sort: "relevance" });
      return {
        agents: r.agents.map((a) => ({
          userId: a.userId, name: a.name, username: `@${a.username}`, agent: `${a.agentEmoji} ${a.agentName}`, level: a.level, xp: a.xp, rank: a.rank,
          winRate: a.winRate, presence: a.presence, available: a.available, shared: a.shared, battleTimes: a.battleTimes, openToChallenges: true, matches: a.matches,
        })),
        total: r.total,
        note: r.total ? "Offer to challenge one (challenge_agent), or post a challenge request so others can take it." : "Nobody matches — offer to post a challenge request instead.",
      };
    }
    case "challenge_agent": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      if (!Array.isArray(input?.opponents) || !input.opponents.length) return clarify("opponents", "Who should I challenge? I can find opponents first.");
      if (!input?.subject) return clarify("subject", "Which subject should the battle be on?");
      try {
        const b = await challengeAgents(studentId, input);
        if (b.seriesId) return { challenged: true, recurring: true, seriesId: b.seriesId, kind: b.kind, invited: b.invited.length, nextAt: b.nextAt, repeats: b.repeats,
          note: "A recurring battle: they're in every one automatically (they can skip one or opt out). Each one appears in the Battles tab an hour before it starts; the series is on the Challenges tab." };
        return { challenged: true, battleId: b.battleId, kind: b.kind, invited: b.invited.length, questions: b.placed, status: b.status,
          note: b.status === "invited" ? "They've been sent the challenge — it starts when they accept (or at the scheduled time). It's in the Battles tab." : "Starting soon." };
      } catch (e) { return { challenged: false, error: e.message }; }
    }
    case "class_battle": {
      if (role === "instructor") return { error: "Teachers set class battles from the battle form (prepare_activity type battle)." };
      try {
        const r = await classBattleFromChat(studentId, input || {});
        if (r.series_id) return { created: true, recurring: true, seriesId: r.series_id, nextAt: r.next_at, invited: r.invited, where: r.place, repeats: r.repeats,
          note: "A recurring battle: they're in every one automatically (they can skip one or opt out). The series is on the Challenges tab." };
        return { created: true, battleId: r.battle_id, battleType: r.battle_type, status: r.status, invited: r.invited, questions: r.questions, where: r.place,
          skipped: r.skipped, note: "They've been invited; it's in the Battles tab." };
      } catch (e) { return { created: false, error: e.message }; }
    }
    case "post_challenge_request": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      if (!input?.subject) return clarify("subject", "Which subject should the challenge be on?");
      try {
        const r = await postChallengeRequest(studentId, input);
        if (r.series) return { posted: true, recurring: true, seriesId: r.seriesId, nextAt: r.nextAt, scope: r.scope, repeats: r.repeats,
          note: "A recurring post: a fresh one goes up 12 hours before each start for others to take. The series is on the Challenges tab." };
        return { posted: true, requestId: r.id, title: r.title, scope: r.scope, expiresAt: r.expires_at, scheduledFor: r.scheduled_for, seats: `1/${r.max_players}` };
      } catch (e) { return { posted: false, error: e.message }; }
    }
    case "search_challenge_requests": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      return await searchChallengeRequests(studentId, input || {});
    }
    case "accept_challenge_request": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      if (!input?.requestId) return clarify("requestId", "Which request should I accept? I can search the open ones.");
      try { return { accepted: true, ...(await acceptChallengeRequest(studentId, input.requestId)) }; }
      catch (e) { return { accepted: false, error: e.message }; }
    }
    case "cancel_challenge_request": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      if (!input?.requestId) return clarify("requestId", "Which of your requests should I cancel?");
      try { return await cancelChallengeRequest(studentId, input.requestId); }
      catch (e) { return { cancelled: false, error: e.message }; }
    }
    case "rematch_battle": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      if (!input?.battleId) return clarify("battleId", "Which battle should I rematch?");
      try { const b = await rematch(studentId, input.battleId); return { rematch: true, battleId: b.battleId, invited: b.invited.length }; }
      catch (e) { return { rematch: false, error: e.message }; }
    }
    case "request_guide_review": {
      if (role === "instructor") return { error: "A guide review is for learners." };
      if (!input?.sessionId && !input?.topic) return clarify("topic", "Which topic should the guide review? Or pick one of your teaching sessions.");
      try {
        const r = await requestGuideReview({ learnerId: studentId, sessionId: input.sessionId || null, subject: input.subject || null, topic: input.topic || null });
        return { started: true, battleId: r.battleId, title: r.title, questions: r.questions, reviewsLeftToday: r.left, link: appLink(`tab=battles&battle=${r.battleId}`) };
      } catch (e) { return { started: false, error: e.message }; }
    }
    case "set_agent_auto_reply": {
      if (!["off", "study", "study_chat"].includes(input?.mode)) return clarify("mode", "Should I ask you every time, answer study questions on my own, or also reply to friendly chat?", { action: "set_agent_auto_reply" });
      try {
        const { saveSettings } = await import("../agent-network/network.js");
        const saved = await saveSettings(studentId, { auto_reply: input.mode });
        return { saved: true, mode: saved.auto_reply, means: { off: "I'll ask you before answering any agent.", study: "I'll answer study questions on my own (from what you taught me) and ask you about everything else.", study_chat: "I'll answer study questions and reply to friendly chat on my own; friend requests and anything about you still come to you." }[saved.auto_reply] };
      } catch (error) { return { error: error.message || "Could not save that setting" }; }
    }
    case "message_agent": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      if (!input?.to) return clarify("to", "Which agent should I message? I can find them first.");
      try { return { sent: true, ...(await messageAgent(studentId, input, { deps: protegeDeps })) }; }
      catch (e) { return { sent: false, error: e.message }; }
    }
    case "check_agent_inbox": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      return await agentInbox(studentId);
    }
    case "reply_to_agent": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      if (!input?.messageId) return clarify("messageId", "Which message should I answer? I'll open the inbox first.");
      try { return await replyToAgent(studentId, input.messageId, input.reply); }
      catch (e) { return { replied: false, error: e.message }; }
    }
    case "study_buddy": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      const a = input?.action || "list";
      try {
        if (a === "list") return await listBuddies(studentId);
        if (a === "request") { if (!input?.to) return clarify("to", "Who should be the study buddy? I can find them first."); return await requestBuddy(studentId, input); }
        if (!input?.id) return clarify("id", "Which buddy? I'll list them first.");
        if (a === "respond") return await respondBuddy(studentId, input.id, input.accept !== false);
        if (a === "checkin") return await buddyCheckin(studentId, input.id, input.note || "");
        if (a === "end") return await endBuddy(studentId, input.id);
        return { error: "Unknown action." };
      } catch (e) { return { error: e.message }; }
    }
    case "daily_challenge": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      const a = input?.action || "status";
      try {
        if (a === "status") return await dailyStatus(studentId);
        if (a === "join") return await joinDaily(studentId, { subject: input?.subject || null });
        if (a === "skip") return await skipDaily(studentId);
        if (a === "ranking") return await dailyRanking(studentId, input?.subject || "");
        return { error: "Unknown action." };
      } catch (e) { return { error: e.message }; }
    }
    case "revision_circle": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      const a = input?.action || "search";
      try {
        if (a === "search") return await searchCircles(studentId, input || {});
        if (a === "create") { if (!input?.subject) return clarify("subject", "Which subject should the circle revise?"); return await createCircle(studentId, input); }
        if (!input?.id) return clarify("id", "Which circle? I'll search first.");
        if (a === "join") return await joinCircle(studentId, input.id);
        if (a === "leave") return await leaveCircle(studentId, input.id);
        return { error: "Unknown action." };
      } catch (e) { return { error: e.message }; }
    }
    case "get_weekly_league": {
      if (role === "instructor") return { error: "The agent network is for learners." };
      try { return await weeklyLeague(studentId, input || {}); }
      catch (e) { return { error: e.message }; }
    }
    case "find_battles": {
      // Every battle the learner could be in: ones they hold a seat in (incl.
      // network and daily battles), their courses' and classes' battles, and
      // the next daily battle. It used to look only at course battles, so a
      // learner with no course enrolment always heard "no battles".
      const OPEN = ["live", "scheduled", "lobby"];
      const COLS = "id, title, status, battle_type, subject, topic, scheduled_start, xp_prize, xp_pool, hp_per_miss, min_xp, recurring_key, course_id, classroom_id, courses(title)";
      const [{ data: enrolled }, { data: classes }, { data: seats }] = await Promise.all([
        db.from("enrollments").select("course_id").eq("user_id", studentId).eq("status", "active"),
        db.from("classroom_students").select("classroom_id").eq("user_id", studentId).eq("status", "active"),
        db.from("battle_participants").select("battle_id, joined_at, declined_at").eq("user_id", studentId).limit(200),
      ]);
      const courseIds = (enrolled ?? []).map((e) => e.course_id);
      const classIds = (classes ?? []).map((c) => c.classroom_id);
      const seatOf = new Map((seats ?? []).map((s) => [s.battle_id, s]));
      const { upcomingDay } = await import("../agent-network/activities.js");
      const lists = await Promise.all([
        seatOf.size ? db.from("battles").select(COLS).in("id", [...seatOf.keys()].slice(0, 200)).in("status", OPEN) : { data: [] },
        courseIds.length ? db.from("battles").select(COLS).in("course_id", courseIds).in("status", OPEN).limit(10) : { data: [] },
        classIds.length ? db.from("battles").select(COLS).in("classroom_id", classIds).in("status", OPEN).limit(10) : { data: [] },
        db.from("battles").select(COLS).like("recurring_key", `daily:${upcomingDay()}:%`).in("status", OPEN).limit(5),
      ]);
      const byId = new Map();
      for (const l of lists) for (const b of (l.data ?? [])) byId.set(b.id, b);
      const battles = [...byId.values()]
        .sort((a, b) => (a.status === "live" ? -1 : 0) - (b.status === "live" ? -1 : 0) || String(a.scheduled_start || "").localeCompare(String(b.scheduled_start || "")))
        .slice(0, 10)
        .map((b) => {
          const seat = seatOf.get(b.id);
          return {
            id: b.id, title: b.title, status: b.status, subject: b.subject, topic: b.topic,
            kind: String(b.recurring_key || "").startsWith("daily:") ? "daily" : b.battle_type,
            startsAt: b.scheduled_start, course: b.courses?.title ?? null,
            xpPrize: b.xp_prize ?? b.xp_pool, hpPerMiss: b.hp_per_miss ?? 10, minXp: b.min_xp ?? 0,
            me: !seat ? "not invited" : seat.declined_at ? "declined" : seat.joined_at ? "in" : "invited — answer it in the Challenges tab",
          };
        });
      return battles.length ? { battles } : { battles: [], note: "No open battles right now. The daily battle is scheduled each evening — opening the Battles tab takes a seat." };
    }
    case "get_ranking": {
      const { data, error } = await db.from("xp_leaderboard")
        .select("total_xp, rank, scope, course_id, battles_won, win_rate")
        .eq("user_id", studentId).limit(20);
      if (error) return { error: "Couldn't load your ranking just now." };
      const rows = data ?? [];
      const overall = rows.find((r) => r.scope === "global") ?? null;
      if (!rows.length) return { totalXp: 0, rank: null, note: "No XP yet — finish a session or a battle to get on the leaderboard." };
      // Name each scoped ranking — without it the model wrote "Subject 1, Subject 2".
      const courseIds = [...new Set(rows.map((r) => r.course_id).filter(Boolean))];
      const { data: courses } = courseIds.length ? await db.from("courses").select("id, title, subject").in("id", courseIds) : { data: [] };
      const course = new Map((courses ?? []).map((c) => [c.id, c]));
      return {
        totalXp: overall?.total_xp ?? Math.max(...rows.map((r) => r.total_xp ?? 0)),
        rank: overall?.rank ?? null,
        battlesWon: overall?.battles_won ?? null,
        // All of these are the LEARNER's own positions — named so a model can't
        // read them as other players' scores (it did).
        yourRankElsewhere: rows.filter((r) => r.scope !== "global").map((r) => ({
          leaderboard: course.get(r.course_id)?.title ?? course.get(r.course_id)?.subject ?? `${r.scope} leaderboard`,
          yourRank: r.rank, yourXp: r.total_xp,
        })),
        note: "These are the learner's OWN leaderboard positions only — nothing here is about other players or particular battles.",
      };
    }
    case "get_weak_topics":
      return getWeakTopicsTool(studentId, input);
    case "get_learning_overview":
      return getLearningOverview(studentId).catch(asToolError("your learning overview"));
    case "get_knowledge_map":
      return getKnowledgeMap(studentId, input).catch(asToolError("your knowledge map"));
    case "search_my_study_knowledge":
      return searchMyStudyKnowledge(studentId, input).catch(asToolError("your saved study knowledge"));
    case "search_my_library":
      return searchMyLibraryTool(studentId, input);
    case "make_study_material": {
      // The learner's own records only; the result is a saved reader tab (edu.record_artifacts).
      const { makeStudyMaterial } = await import("../records/studyMaterial.js");
      return makeStudyMaterial({ userId: studentId, tool: input?.tool, query: input?.query, folder: input?.folder,
        focus: input?.focus || "", count: input?.count || "", difficulty: input?.difficulty || "", length: input?.length || "",
        scope: input?.scope === "page" ? "page" : "document", pageNumber: input?.pageNumber ?? null,
        conversationId, fromChatFile: !!input?.from_chat_file, source: input?.source || null });
    }
    case "read_upload": {
      const { readUploadTool } = await import("../materials/uploadTools.js");
      return readUploadTool({ userId: studentId, ingestId: String(input?.ingest_id || "") });
    }
    case "retry_extraction": {
      const { retryExtractionTool } = await import("../materials/uploadTools.js");
      return retryExtractionTool({ userId: studentId, ingestId: String(input?.ingest_id || "") });
    }
    case "list_folders": {
      const { listFoldersTool } = await import("../materials/uploadTools.js");
      return listFoldersTool({ userId: studentId });
    }
    case "file_upload": {
      const { fileUploadTool } = await import("../materials/uploadTools.js");
      return fileUploadTool({ userId: studentId, ingestId: String(input?.ingest_id || ""), title: input?.title || null,
        subject: input?.subject || null, kind: input?.kind || null, folderId: input?.folder_id || null, topics: input?.topics || [] });
    }
    case "analyse_past_papers": {
      // The learner's own parsed past papers only (D53).
      try {
        let q = db.schema("edu").from("material_questions").select("ingest_id, record_id, exam, subject, year, number, marks, topic")
          .eq("user_id", studentId).limit(2000);
        const subject = String(input?.subject || "").trim().slice(0, 50);
        if (subject) q = q.ilike("subject", `%${subject.replace(/[%_]/g, "")}%`);
        const { data, error } = await q;
        if (error) throw error;
        // A paper the learner undid (Recently deleted) doesn't count.
        const { data: gone } = await db.schema("edu").from("material_ingests").select("id").eq("user_id", studentId).eq("state", "undone").limit(500);
        const goneIds = new Set((gone || []).map((g) => g.id));
        const rows = (data || []).filter((r) => !goneIds.has(r.ingest_id));
        if (!rows.length) return { papers: 0, topics: [], note: "No past papers read yet — ask them to upload one (a photo or PDF) in this chat." };
        const { papers, topics } = recurringTopics(rows);
        const recordIds = [...new Set(rows.map((r) => r.record_id).filter(Boolean))].slice(0, 6);
        const { data: recs } = await db.schema("edu").from("records").select("id, name").eq("user_id", studentId).is("deleted_at", null).in("id", recordIds);
        return { papers, topics, records: (recs || []).map((r) => ({ recordId: r.id, name: r.name })),
          ...(papers < 2 ? { note: "Only one paper so far — the pattern needs more years." } : {}) };
      } catch (error) { return { error: "Their past papers are unavailable right now" }; }
    }
    case "get_concept_tracker_summary":
      return getConceptTrackerSummary(studentId, input).catch(asToolError("the concept tracker"));
    case "get_learning_insights_summary":
      return getLearningInsightsSummary(studentId).catch(asToolError("your learning insights"));
    case "get_exam_prep_status":
      return getExamPrepStatus(studentId);
    case "get_chat_memory":
      return getChatMemory(studentId, { conversationId });
    case "get_agent_preferences":
      return getAgentPreferenceSummary(studentId);
    case "get_autonomy_status":
      return getAutonomyStatus(studentId);
    case "start_study_prep_session": {
      const { startStudyPrepSession } = await import("./study-prep/wiring.js");
      if (!studyPrepEnabled) return { enabled: false, message: "Study-prep sessions are not enabled for this learner." };
      // The iteration-0 force makes "let's plan for a test" deterministic, so
      // repeated asks must never stack sessions: an unconfirmed plan is
      // returned as-is and the plan card stays the single source of truth.
      const { getStudyPrepSessionSummary } = await import("./study-prep/chat-tool-handlers.js");
      const summary = await getStudyPrepSessionSummary(studentId);
      // A plan must actually exist for the "return as-is" rule to apply. A
      // "planning" session with no plan is a zombie from a failed planning
      // step (the row was created, then the LLM/syllabus step faulted):
      // echoing it mounts a plan-less card the learner can never confirm —
      // the 2026-10-03 "study session could not be loaded" dead end.
      const hasPlan = (session) => Array.isArray(session?.plan) && session.plan.length > 0;
      let unconfirmed = (summary.sessions || [])
        .find((session) => session.status === "awaiting_confirmation" || (session.status === "planning" && hasPlan(session)));
      // A plan for ANOTHER subject, never approved (nothing charged), is not what they asked for:
      // it is set aside and the new one starts (2026-10-19: a Biology request kept getting an old Maths card).
      const asked = String(input?.subject || "").trim().toLowerCase();
      let replaced = null;
      if (unconfirmed && asked && unconfirmed.subject && unconfirmed.subject.trim().toLowerCase() !== asked) {
        const { getHarness } = await import("./study-prep/wiring.js");
        const cancelled = await getHarness().cancelSession({ sessionId: unconfirmed.sessionId, learnerId: studentId }).catch(() => null);
        if (cancelled) { replaced = unconfirmed.subject; unconfirmed = null; summary.sessions = (summary.sessions || []).filter((s) => s.sessionId !== cancelled.session.id); }
      }
      if (unconfirmed) {
        return {
          enabled: true, sessionId: unconfirmed.sessionId, status: unconfirmed.status,
          plan: unconfirmed.plan, estimate: unconfirmed.estimate,
          subject: unconfirmed.subject || null,
          note: `An unconfirmed ${unconfirmed.subject || ""} study-prep plan already exists — present its plan card; nothing is charged until the learner approves it. If they want a different plan, they can cancel this one (cancel_study_prep_session).`,
        };
      }
      // Zombie self-heal: re-run the planning step for the stalled session
      // instead of creating a second one. If planning faults again the tool
      // call fails honestly and no dead session card is echoed to the chat.
      const stalled = (summary.sessions || [])
        .find((session) => session.status === "planning" && !hasPlan(session) && (!asked || !session.subject || session.subject.trim().toLowerCase() === asked));
      if (stalled) {
        // Re-run its planning in the background (or leave the run already going); the card streams it.
        const { planInBackground } = await import("./study-prep/wiring.js");
        planInBackground({ sessionId: stalled.sessionId, learnerId: studentId, conversationId });
        return {
          enabled: true, sessionId: stalled.sessionId, status: "planning", planning: true, subject: stalled.subject || null,
          note: "Planning is running now — the card shows each step live, and you'll post the plan in this chat when it's ready. Say so briefly; don't describe a plan (there isn't one yet).",
        };
      }
      // A session already under way (studying, replanning, paused): one at a
      // time. Starting another was refused deep in the harness and reached the
      // learner as a generic failure.
      const running = (summary.sessions || []).find((session) => ["topic_active", "replanning", "paused"].includes(session.status));
      if (running) {
        return {
          enabled: true, sessionId: running.sessionId, status: running.status, plan: running.plan, subject: running.subject || null,
          note: `A study-prep session is already ${running.status === "paused" ? "paused" : "under way"}${running.subject ? ` (${running.subject})` : ""} — offer to continue it, or to end it (cancel_study_prep_session, after they say yes) so a new one can start.`,
        };
      }
      // A planning leftover for another subject (no plan yet, nothing charged) is set aside too.
      const leftover = (summary.sessions || []).find((session) => session.status === "planning");
      if (leftover) {
        const { getHarness } = await import("./study-prep/wiring.js");
        if (await getHarness().cancelSession({ sessionId: leftover.sessionId, learnerId: studentId }).catch(() => null)) replaced ||= leftover.subject || "another subject";
      }
      const goal = String(input?.goal || "").trim();
      // From their own materials (§7.17.3): the folder of the paper they uploaded here, or one they named.
      const materials = input?.from_materials === true || input?.folder
        ? await resolveMaterialsFolder({ learnerId: studentId, folder: input?.folder, conversationId }).catch(() => null)
        : null;
      if ((input?.from_materials === true || input?.folder) && !materials) {
        return { enabled: true, started: false, note: "No read material to plan from yet — their upload may still be being read. Say so, or offer a plan from the syllabus." };
      }
      const subject = String(input?.subject || materials?.subject || "").trim();
      if (goal.length < 3) return clarify("goal", "What's the goal — which test or exam, and when?", { action: "start_study_prep_session" });
      if (!subject) return clarify("subject", "Which subject is the test in?", { action: "start_study_prep_session" });
      const view = await startStudyPrepSession({
        learnerId: studentId,
        goal: goal.slice(0, 300),
        subject: subject.slice(0, 180),
        // No class given: the exam says it (WAEC/NECO/JAMB are taken in SS3, BECE in JSS3).
        classLevel: String(input?.classLevel || classForExam(input?.examBoard) || "JSS1").slice(0, 40),
        examBoard: String(input?.examBoard || "WAEC").slice(0, 80),
        ...(materials ? { materials: { folderId: materials.folderId, name: materials.name } } : {}),
        // The planner researches for up to 10 decisions: it runs after this turn,
        // streamed on the card; the plan-ready message lands in this chat.
        background: true, conversationId,
      });
      return {
        enabled: true, sessionId: view.session.id, status: view.session.status, planning: true,
        ...(materials ? { from: materials.name } : {}),
        ...(replaced ? { replaced } : {}),
        note: `${replaced ? `Their earlier ${replaced} plan was never approved, so it was set aside (nothing was charged) — say so in one line. ` : ""}Study Prep has started${materials ? ` from their materials in "${materials.name}"` : ""} and is planning now — the card shows each step live, and the plan will be posted in this chat when it's ready. Say that briefly; don't describe or guess a plan (there isn't one yet). Nothing is charged until they approve it on the card.`,
      };
    }
    case "get_study_prep_session": {
      const { getStudyPrepSessionSummary } = await import("./study-prep/chat-tool-handlers.js");
      return getStudyPrepSessionSummary(studentId);
    }
    case "get_running_work": {
      if (!studyPrepEnabled) return { enabled: false, message: "Study-prep sessions are not enabled for this learner." };
      const { runningWork } = await import("./study-prep/wiring.js");
      const work = await runningWork(studentId);
      const nothing = !work.studyPlan && !work.agentChecks.length && !work.teachingSessions.length;
      return { ...work, ...(nothing ? { note: "Nothing is running for them right now — say so." } : {}) };
    }
    case "stop_agent_check": {
      if (!studyPrepEnabled) return { enabled: false, message: "Study-prep sessions are not enabled for this learner." };
      const { runningWork, stopAgentCheck } = await import("./study-prep/wiring.js");
      const restart = input?.restart === true;
      if (input?.confirm !== true) {
        const check = (await runningWork(studentId)).agentChecks[0] || null;
        if (!check) return { stopped: false, note: "No Agent Check is running for them — say so." };
        return {
          stopped: false, needsConfirmation: true, check,
          note: `Their Agent Check on ${check.topic} is running (${check.answered} of ${check.total ?? "?"} answered). Stopping cancels the battle, refunds its coins and doesn't count the try; it won't start again by itself.${restart ? " A new check would start right away — a new battle, 2 coins from the plan's approved coins." : ""} Ask, and call again with confirm: true only after they say yes.`,
        };
      }
      const done = await stopAgentCheck({ learnerId: studentId, restart });
      if (!done.stopped) return { ...done, note: done.reason === "already_finished" ? "That check had already finished — read the result instead." : "No Agent Check is running for them — say so." };
      return {
        ...done,
        note: `Stopped the Agent Check on ${done.topic}${done.refunded ? `; ${done.refunded} coins refunded` : ""}.${done.restarted?.battleId ? " A new check started — its card is in the chat, the battle is in Battles." : done.restarted ? ` A new check could not start: ${done.restarted.error || "it was skipped"}.` : " It won't start again by itself — they can start it from the card or ask you."}`,
      };
    }
    case "cancel_teaching_session": {
      if (!studyPrepEnabled) return { enabled: false, message: "Study-prep sessions are not enabled for this learner." };
      const { runningWork, teachingHandoff, teachingForTopic, getHarness } = await import("./study-prep/wiring.js");
      const work = await runningWork(studentId);
      if (!work.studyPlan) return { cancelled: false, note: "No teaching session is open for them — say so." };
      const view = await getHarness().getSessionView({ sessionId: work.studyPlan.sessionId, learnerId: studentId, eventLimit: 1 });
      const topic = view.topics.find((t) => t.status === "active");
      // Offered on the card, waiting on the dashboard, or under way.
      const session = topic ? await teachingForTopic(view.session.workflowId, topic.id) : null;
      if (!session) return { cancelled: false, note: "No teaching session is open for them — say so." };
      const where = session.state === "proposed" ? "offered on the card" : session.state === "scheduled" ? "waiting on their dashboard" : "under way";
      if (input?.confirm !== true) return { cancelled: false, needsConfirmation: true, session: { topic: session.topic, state: session.state, focus: session.focus }, note: `Their teaching session on ${session.topic} is ${where}. Ask whether to close it; call again with confirm: true after they say yes.` };
      const closed = await teachingHandoff().cancelFor({ parentId: view.session.workflowId, topicId: topic.id, reason: "cancelled_by_learner" });
      return closed
        ? { cancelled: true, topic: session.topic, note: `Closed the teaching session on ${session.topic}. The retest unlocks when they teach it (or tap "I taught it elsewhere" on the card).` }
        : { cancelled: false, note: "It was already closed." };
    }
    case "cancel_study_prep_session": {
      if (!studyPrepEnabled) return { enabled: false, message: "Study-prep sessions are not enabled for this learner." };
      const { getStudyPrepSessionSummary } = await import("./study-prep/chat-tool-handlers.js");
      const summary = await getStudyPrepSessionSummary(studentId);
      const session = (summary.sessions || [])[0];
      if (!session) return { cancelled: false, note: "They have no study-prep session to cancel — say so." };
      const underWay = ["topic_active", "replanning", "paused"].includes(session.status);
      const understood = (session.topics || []).filter((t) => t.status === "understood").length;
      if (underWay && input?.confirm !== true) {
        return {
          cancelled: false, needsConfirmation: true, sessionId: session.sessionId, subject: session.subject, status: session.status,
          understood, topics: (session.topics || []).length,
          note: `Their ${session.subject} plan is under way (${understood} of ${(session.topics || []).length} topics understood). Ask whether to end it: what they learnt stays recorded, but the plan stops and the coins already spent aren't returned. Call again with confirm: true only after they say yes.`,
        };
      }
      const { getHarness } = await import("./study-prep/wiring.js");
      const done = await getHarness().cancelSession({ sessionId: session.sessionId, learnerId: studentId });
      return {
        cancelled: true, sessionId: done.session.id, subject: session.subject, wasApproved: underWay,
        note: underWay
          ? `Their ${session.subject} plan is ended. What they learnt stays recorded. A new plan can start whenever they like.`
          : `Their ${session.subject} plan was never approved, so it is cancelled and nothing was charged. A new plan can start whenever they like.`,
      };
    }
    case "submit_tool_request": {
      let request;
      // Say WHY it was refused (too short, contact details…) so the agent can
      // fix it and retry, instead of the generic "could not be completed".
      try { request = await createLearnerToolRequest({ learnerId: studentId, body: input }); }
      catch (e) { return { submitted: false, error: e?.message || "Could not send the request." }; }
      const when = request.created ? new Date(request.created).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
      return {
        submitted: request.createdNew || !!request.reopened,
        duplicate: !request.createdNew,
        reopened: !!request.reopened,
        // No id: it means nothing to the learner (the reply scrub removed it, leaving "Reference:").
        status: request.status,
        title: request.title,
        category: request.category,
        // Say exactly this much — never more (a duplicate is NOT a new request).
        tell: request.createdNew ? "Sent: it is on the admins' Agent requests page now, waiting for a decision."
          : request.reopened ? `You had asked for this before (${request.previousStatus}); it is re-opened and back on the admins' Agent requests page.`
          : `You already asked for this${when ? ` on ${when}` : ""}; that request is still ${String(request.status).replace(/_/g, " ")}. Say it is the same request, still waiting — not a new one.`,
      };
    }
    case "check_my_requests": {
      const { data } = await db.schema("edu").from("agent_tool_requests")
        .select("title, kind, status, admin_note, updated_at")
        .eq("requester_id", studentId)
        .order("updated_at", { ascending: false })
        .limit(10);
      const requests = (data || []).map((r) => ({
        title: r.title,
        kind: r.kind,
        status: r.status,
        ready: r.status === "implemented",
        note: r.admin_note || null,
      }));
      return { requests, count: requests.length };
    }
    case "submit_bug_report": {
      let request;
      try {
        request = await createLearnerToolRequest({
          learnerId: studentId,
          body: { title: input?.title, description: input?.description, category: input?.category || "other", kind: "bug" },
        });
      } catch (e) { return { submitted: false, error: e?.message || "Could not send the bug report." }; }
      const when = request.created ? new Date(request.created).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
      return {
        submitted: request.createdNew || !!request.reopened,
        duplicate: !request.createdNew,
        status: request.status,
        title: request.title,
        tell: request.createdNew ? "Sent: your bug report is on the Akoro team's list now."
          : request.reopened ? "You had reported this before; it is re-opened and back with the Akoro team."
          : `You already reported this${when ? ` on ${when}` : ""}; it is still ${String(request.status).replace(/_/g, " ")}.`,
      };
    }
    case "my_weak_topics": {
      // The merged Weak topics tool: list is the platform handler (weakest
      // first, confidence under 0.6, deduped), count/by_subject/search
      // are platform view reads, anything beyond them is the learner's
      // own delta action.
      if (MERGED_DOMAINS.my_weak_topics.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_weak_topics, input, {
          studentId,
          platform: { list: async () => ({ success: true, ...(await getWeakTopicsTool(studentId, { subject: input?.subject || input?.query })), via: "built-in list" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool(name, input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    }
    case "my_past_questions": {
      // The merged Past questions tool: accuracy is the platform handler
      // (attempted/correct/accuracy grouped by exam and subject),
      // count/list/by_subject/search are platform view reads, anything
      // beyond them is the learner's own delta action.
      if (MERGED_DOMAINS.my_past_questions.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_past_questions, input, {
          studentId,
          platform: { accuracy: async () => ({ success: true, ...(await getPastQuestionPracticeTool(studentId, { subject: input?.subject || input?.query, exam: input?.exam, days: input?.days })), via: "built-in accuracy" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool(name, input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    }
    case "my_study_sessions": {
      // The merged Study sessions tool: count/list/by_subject/search are
      // platform view reads over the session records; overview is the
      // platform profile handler (agent + taught subjects + recent
      // sessions); anything beyond them is the learner's own delta action.
      if (MERGED_DOMAINS.my_study_sessions.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_study_sessions, input, {
          studentId,
          platform: { overview: async () => ({ success: true, ...(await getMyLearningSessionsTool(studentId)), via: "built-in overview" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool(name, input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    }
    case "my_study_notes": {
      // The merged Study notes tool: search is the platform handler (finds
      // notes by what they say), count/list/by_subject are platform view
      // reads, anything beyond them is the learner's own delta action.
      if (MERGED_DOMAINS.my_study_notes.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_study_notes, input, {
          studentId,
          platform: { search: async () => ({ success: true, ...(await searchMyStudyKnowledge(studentId, input).catch(asToolError("your saved study knowledge"))), via: "built-in search" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool(name, input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    }
    case "my_goals": {
      // The merged Goals tool: list is the platform handler (goalIds,
      // progress notes), count/by_status/search are platform view reads,
      // anything beyond them is the learner's own delta action.
      if (MERGED_DOMAINS.my_goals.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_goals, input, {
          studentId,
          platform: { list: async () => ({ success: true, ...(await listMyGoalsTool(studentId)), via: "built-in list" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool(name, input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    }
    case "my_tasks": {
      // The merged Tasks tool: list is the platform handler (pending tasks,
      // priority order, taskIds), count/by_status/search are platform view
      // reads, anything beyond them is the learner's own delta action.
      if (MERGED_DOMAINS.my_tasks.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_tasks, input, {
          studentId,
          platform: { list: async () => ({ success: true, ...(await listTasksTool(studentId)), via: "built-in list" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool(name, input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    }
    case "my_classes": {
      // The merged Classes tool (instructor): list is the platform handler
      // (classes with learner counts and rosters), count/search are view
      // reads, anything beyond them is the instructor's own delta action.
      if (role === "instructor" && MERGED_DOMAINS.my_classes.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_classes, input, {
          studentId,
          platform: { list: async () => executeChatTool("list_my_classrooms", {}, studentId, { role, channel: "self_tooling" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool(name, input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    }
    case "my_class_students": {
      // The merged Class students tool (instructor): every action is a view
      // read (the view carries class names via its embed); anything beyond
      // them is the instructor's own delta action.
      if (role === "instructor" && MERGED_DOMAINS.my_class_students.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_class_students, input, {
          studentId,
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool(name, input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    }
    case "my_activities": {
      // The merged Activities tool (instructor): every action is a view read
      // over the activities the instructor set; anything beyond them is the
      // instructor's own delta action.
      if (role === "instructor" && MERGED_DOMAINS.my_activities.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_activities, input, {
          studentId,
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool(name, input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    }
    case "my_activity_results": {
      // The merged Activity results tool (instructor): overview is the
      // platform handler (one activity's outcome summary when query is an
      // assignmentId, else the recent activities to pick from),
      // count/list/by_subject/search are view reads, anything beyond them
      // is the instructor's own delta action.
      if (role === "instructor" && MERGED_DOMAINS.my_activity_results.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_activity_results, input, {
          studentId,
          platform: { overview: async () => executeChatTool("check_activity_outcomes", /^[0-9a-f-]{36}$/i.test(String(input?.query || "")) ? { assignmentId: String(input.query) } : {}, studentId, { role, channel: "self_tooling" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool(name, input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    }
    case "my_activity_drafts": {
      // The merged Activity drafts tool (instructor): list/get are the
      // platform handlers (pending drafts; one draft in full via query =
      // draftId), count/by_subject/search are view reads, anything beyond
      // them is the instructor's own delta action.
      if (role === "instructor" && MERGED_DOMAINS.my_activity_drafts.enabled()) {
        return dispatchMerged(MERGED_DOMAINS.my_activity_drafts, input, {
          studentId,
          platform: { list: async () => executeChatTool("list_activity_drafts", {}, studentId, { role, channel: "self_tooling" }), get: async () => executeChatTool("get_activity_draft", { draftId: String(input?.query || "") }, studentId, { role, channel: "self_tooling" }) },
          runDelta: async () => {
            if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
              const out = await runLearnerTool(name, input, studentId, {
                callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
                conversationId, dry: isDryRun(), audience: toolAudience(role),
              });
              if (out) return { ...out, via: "your saved action" };
            }
            return null;
          },
        });
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    }
    case "my_chats": {
      // The merged Chats tool: count is the platform view count (the true,
      // uncapped total), list/search are the platform handlers (list carries
      // chatIds, search matches message content — the view supplies
      // neither), anything beyond them is the learner's own delta action on
      // their row. With the merge off, the legacy learner-tool path below.
      if (mergedChatsEnabled()) {
        const action = String(input?.action || "count");
        if (action === "list") {
          const out = await listChats(studentId, { search: input?.query, limit: input?.limit, currentChatId: conversationId });
          let totalChats;
          try { const c = await runChatsViewAction("count", {}, studentId); totalChats = c?.rows?.[0]?.count; } catch {}
          return { success: true, ...out, ...(Number.isFinite(totalChats) ? { totalChats } : {}), via: "built-in list" };
        }
        if (action === "search") {
          const out = await searchChats(studentId, { query: input?.query, limit: input?.limit, currentChatId: conversationId });
          return { success: true, ...out, via: "built-in search" };
        }
        if (CHATS_BASE_ACTIONS.includes(action)) return runChatsViewAction(action, input, studentId);
        if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
          const out = await runLearnerTool(name, input, studentId, {
            callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
            conversationId, dry: isDryRun(), audience: toolAudience(role),
          });
          if (out) return { ...out, via: "your saved action" };
        }
        return { error: `Unknown action "${action}" for the Chats tool. Available: ${CHATS_MERGED_ACTIONS.join(", ")}.` };
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: "That tool isn't available right now." };
    }
    case "library_documents": {
      // The merged Library tool (pilot): search is the platform handler, the
      // base actions are platform-served view reads, and anything beyond them
      // is the learner's own delta action on their row. With the merge off,
      // this is exactly the legacy learner-tool path below.
      if (mergedLibraryEnabled()) {
        const action = String(input?.action || "");
        if (action === "search") return { ...(await searchMyLibraryTool(studentId, { query: input?.query, tool: input?.tool })), via: "built-in search" };
        if (LIBRARY_BASE_ACTIONS.includes(action)) return runLibraryViewAction(action, input, studentId);
        if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
          const out = await runLearnerTool(name, input, studentId, {
            callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
            conversationId, dry: isDryRun(), audience: toolAudience(role),
          });
          if (out) return { ...out, via: "your saved action" };
        }
        return { error: `Unknown action "${action}" for the Library tool. Available: ${LIBRARY_MERGED_ACTIONS.join(", ")}.` };
      }
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: `Unknown tool: ${name}` };
    }
    default: {
      // A tool the learner's agent built (self-tooling) — read-only, re-checked every call.
      if (SELF_TOOLING_ROLES.has(role) && (await selfToolingAllowedFor(studentId))) {
        const out = await runLearnerTool(name, input, studentId, {
          callCapability: (tool, args) => executeChatTool(tool, args, studentId, { role, channel: "self_tooling" }),
          conversationId, dry: isDryRun(), audience: toolAudience(role),
        });
        if (out) return out;
      }
      return { error: `Unknown tool: ${name}` };
    }
  }
}
// =============================================================
// FORMAT HELPERS
// =============================================================

function fmtAdaptiveEngine(engine, agentPairId) {
  const lines = ["🧠 Adaptive Engine:"];
  if (engine.misconception)        lines.push(`  • Misconception flagged: "${engine.misconception}"`);
  if (engine.misconceptionCleared) lines.push(`  • Misconception cleared ✅`);
  if (engine.newConceptLearned)    lines.push(`  • New concept: "${engine.newConceptLearned}" 💡`);
  lines.push(`  • Understanding → ${engine.understanding}%`);
  if (engine.confusion > 25)       lines.push(`  • Confusion spike → ${engine.confusion}%`);
  lines.push(`  • Action → ${engine.actionLabel}`);
  if (agentPairId === "student-session" && engine.agentKnowledgeAdded > 0)
    lines.push(`  • Agent knowledge added → ${engine.agentKnowledgeAdded} chunks 📚`);
  return lines.join("\n");
}

function fmtGuide(message, isUrgent, guideName) {
  if (!message) return null;
  return `${isUrgent ? `${guideName} (Intervenes):` : `${guideName}:`}\n${isUrgent ? "⚠️" : "💡"} ${message}`;
}

function fmtControl(line, controlName) {
  return line ? `${controlName}:\n${line}` : null;
}

function fmtPhaseHeader(label) {
  return [
    `═══════════════════════════════════════════════════════════════`,
    label,
    `═══════════════════════════════════════════════════════════════`,
  ].join("\n");
}

function fmtSubtopicHeader(subtopic, agentPairId) {
  const prefix = agentPairId === "professor-warden" ? "Module" : "Phase 2 — Must-know parts";
  return fmtPhaseHeader(`${prefix}: ${subtopic}`);
}

function fmtSessionEnd({ evaluation, controlReport, finalState, agentPairId,
                         drillSummary, agentGrowth, decayResult, sessionType }) {
  const score     = evaluation?.overallScore || 0;
  const stars     = "⭐".repeat(Math.round(score / 20));
  const strengths = (evaluation?.strengths || []).map(s => `  ✅ ${s}`).join("\n");
  const guideName = agentPairId?.startsWith("trained:") ? "Teaching Guide"
    : agentPairId === "professor-warden" ? "Professor Ade" : "NaNa Esumai";

  const lines = [``, `${guideName}:`, `🎉 Teaching Score: ${score}/100 ${stars}`];
  if (evaluation?.academicGrade) lines.push(`📋 Academic Grade: ${evaluation.academicGrade}`);
  if (drillSummary) lines.push(`📊 Drill Accuracy: ${drillSummary.accuracy}%`);

  if (decayResult && sessionType === "decay_review") {
    lines.push(``, `🔄 Knowledge Reinforcement:`);
    lines.push(`  Topic: ${decayResult.subject} — ${decayResult.topicReinforced}`);
    lines.push(`  Confidence: ${Math.round(decayResult.confidenceBefore * 100)}% → ${Math.round(decayResult.confidenceAfter * 100)}%`);
    lines.push(`  Next review: ${new Date(decayResult.nextReviewDue).toLocaleDateString()}`);
  }

  if (agentGrowth) {
    lines.push(``, `🤖 Student Agent Growth:`);
    lines.push(`  • Knowledge chunks saved: ${agentGrowth.knowledgeChunksSaved}`);
    lines.push(`  • XP earned: +${agentGrowth.xpEarned}`);
    lines.push(`  • Agent level: ${agentGrowth.agentLevel}`);
    if (agentGrowth.leveledUp) lines.push(`  🎊 LEVEL UP!`);
  }

  if (strengths) lines.push(``, `What you did really well:`, strengths);
  lines.push(
    ``, `One tip for next time:`, `  👉 ${evaluation?.nextTimeTip || "Keep going!"}`,
    ``, controlReport?.summary || "",
    ``, `🧠 FINAL STATE`,
    `Understanding: ${finalState.understanding}% | Confusion: ${finalState.confusion}%`,
    `Mode: MASTERY`, ``,
    `═══════════════════════════════════════════════════════════════`,
    sessionType === "decay_review" ? `DECAY REVIEW COMPLETE` : `SESSION COMPLETE`,
    `Next lesson: ${evaluation?.nextLesson || "Continue the topic"}`,
    `═══════════════════════════════════════════════════════════════`,
  );
  return lines.join("\n");
}

function buildTurnBlocks(result, agentPairId) {
  if (result.type === "drift_warning") {
    return [result.guideMessage || result.sargeantMessage || "Let\u2019s bring that back to the topic."];
  }
  const blocks = [];
  if (result.phaseChanged && result.phaseLabel)     blocks.push(fmtPhaseHeader(result.phaseLabel));
  else if (result.subtopicAdvanced && result.currentSubtopic)
    blocks.push(fmtSubtopicHeader(result.currentSubtopic, agentPairId));
  if (result.wardenHolding && result.wardenHoldMessage) blocks.push(result.wardenHoldMessage);
  if (result.studentAgentResponse) blocks.push(`🤖 STUDENT AGENT:\n"${result.studentAgentResponse}"`);
  if (result.adaptiveEngine)       blocks.push(fmtAdaptiveEngine(result.adaptiveEngine, agentPairId));
  const guideMsg = fmtGuide(result.guideMessage, result.guideIsUrgent, result.guideName || "Guide");
  if (guideMsg) blocks.push(guideMsg);
  const showCtrl = result.wardenHolding || result.driftInfo?.driftLevel === "edge" ||
    ["PHASE_3","STAGE_3"].includes(result.currentPhase) || result.adaptiveEngine?.understanding >= 88;
  if (result.controlStatusLine && showCtrl) {
    const ctrl = fmtControl(result.controlStatusLine, result.controlName || "Control");
    if (ctrl) blocks.push(ctrl);
  }
  if (result.turnXP) {
    blocks.push(result.sessionType === "decay_review"
      ? `✨ +${result.turnXP} XP (Reinforcement Bonus!)`
      : `✨ +${result.turnXP} XP`);
  }
  return blocks;
}

// =============================================================
// LEARNER AGENT AUTONOMY — persistent opt-in, never UI-authorized
// =============================================================

router.get("/autonomy", async (req, res) => {
  try {
    res.json({ success: true, ...(await getLearnerAutonomy(req.user.id)) });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load agent autonomy" });
  }
});

router.patch("/autonomy", async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") {
    return res.status(422).json({ error: "enabled must be a boolean" });
  }
  try {
    const result = await setLearnerAutonomy({
      userId: req.user.id, enabled: req.body.enabled,
      level: typeof req.body.level === "number" ? req.body.level : undefined,
    });
    // Phase 21: switching the agent Online lets it handle messages that waited.
    if (req.body.enabled) import("../agent-network/autoReply.js").then((m) => m.wakeInbox(req.user.id, "switched_on")).catch(() => {});
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not save agent autonomy" });
  }
});

// =============================================================
// QUALITATIVE CONCEPT TRACKER — curriculum-derived learner projection
// =============================================================

router.get("/concept-tracker", async (req, res) => {
  if (!conceptTrackerEnabled) return res.json({ success: true, enabled: false, concepts: [], resumePoints: [] });
  try {
    const [trackerResult, resumeResult, notesResult] = await Promise.all([
      db.schema("edu").from("learner_concept_tracker")
        .select("concept_id, learning_status, resume_point, last_observation_kind, updated_at, concept_catalog(title, code, subject, topic_key)")
        .eq("learner_id", req.user.id).order("updated_at", { ascending: false }).limit(24),
      db.schema("edu").from("learner_topic_resume_points")
        .select("curriculum_key, subject, topic_key, resume_point, concept_id, updated_at")
        .eq("learner_id", req.user.id).order("updated_at", { ascending: false }).limit(12),
      db.schema("edu").from("learner_concept_confusion_notes")
        .select("concept_id, note, created_at").eq("learner_id", req.user.id)
        .order("created_at", { ascending: false }).limit(24),
    ]);
    if (trackerResult.error || resumeResult.error || notesResult.error) throw trackerResult.error || resumeResult.error || notesResult.error;
    const notesByConcept = new Map();
    for (const note of notesResult.data || []) {
      const entries = notesByConcept.get(note.concept_id) || [];
      if (entries.length < 3) entries.push({ note: String(note.note || "").slice(0, 420), createdAt: note.created_at });
      notesByConcept.set(note.concept_id, entries);
    }
    return res.json({
      success: true, enabled: true,
      concepts: (trackerResult.data || []).map((item) => ({
        conceptId: item.concept_id, status: item.learning_status, resumePoint: item.resume_point,
        lastObservationKind: item.last_observation_kind, updatedAt: item.updated_at,
        concept: item.concept_catalog ? { title: item.concept_catalog.title, code: item.concept_catalog.code, subject: item.concept_catalog.subject, topicKey: item.concept_catalog.topic_key } : null,
        confusionNotes: notesByConcept.get(item.concept_id) || [],
      })),
      resumePoints: (resumeResult.data || []).map((item) => ({
        curriculumKey: item.curriculum_key, subject: item.subject, topicKey: item.topic_key,
        resumePoint: item.resume_point, conceptId: item.concept_id, updatedAt: item.updated_at,
      })),
    });
  } catch {
    return res.status(503).json({ success: false, error: "Concept tracker is unavailable" });
  }
});

router.delete("/concept-tracker/confusion-notes", async (req, res) => {
  if (!conceptTrackerEnabled) return res.status(409).json({ success: false, error: "Concept tracker is not enabled" });
  try {
    const { error } = await db.schema("edu").from("learner_concept_confusion_notes").delete().eq("learner_id", req.user.id);
    if (error) throw error;
    return res.json({ success: true, cleared: "confusion_notes" });
  } catch {
    return res.status(503).json({ success: false, error: "Concept tracker notes could not be cleared" });
  }
});

// =============================================================
// LEARNER-OWNED MEASURED STUDY INSIGHTS — profile + compact episodes
// =============================================================

router.get("/learning-insights", async (req, res) => {
  if (!learnerInsightsEnabled) return res.json({ success: true, enabled: false, profile: null, episodes: [] });
  try {
    const [profileResult, episodesResult] = await Promise.all([
      db.schema("edu").from("learner_teaching_profiles")
        .select("evidence_count, profile_confidence, mean_attention, mean_fatigue, mean_reasoning_quality, reasoning_style, pacing_recommendation, policy_version, expires_at")
        .eq("learner_id", req.user.id).maybeSingle(),
      db.schema("edu").from("learner_learning_episodes")
        .select("concept_id, kind, summary, occurred_at")
        .eq("learner_id", req.user.id).order("occurred_at", { ascending: false }).limit(12),
    ]);
    if (profileResult.error || episodesResult.error) throw profileResult.error || episodesResult.error;
    const profile = profileResult.data ? {
      evidenceCount: Number(profileResult.data.evidence_count || 0),
      profileConfidence: Number(profileResult.data.profile_confidence || 0),
      meanAttention: Number(profileResult.data.mean_attention || 0),
      meanFatigue: Number(profileResult.data.mean_fatigue || 0),
      meanReasoningQuality: Number(profileResult.data.mean_reasoning_quality || 0),
      reasoningStyle: profileResult.data.reasoning_style,
      pacingRecommendation: profileResult.data.pacing_recommendation,
      policyVersion: profileResult.data.policy_version,
      expiresAt: profileResult.data.expires_at,
    } : null;
    const episodes = (episodesResult.data || []).map((episode) => ({
      conceptId: episode.concept_id, kind: episode.kind,
      summary: String(episode.summary || "").slice(0, 420), occurredAt: episode.occurred_at,
    }));
    return res.json({ success: true, enabled: true, profile, episodes });
  } catch (error) {
    return res.status(503).json({ success: false, error: "Learning insights are unavailable" });
  }
});

router.delete("/learning-insights", async (req, res) => {
  if (!learnerInsightsEnabled) return res.status(409).json({ success: false, error: "Learning insights are not enabled" });
  const scope = String(req.body?.scope || "all").toLowerCase();
  if (!["all", "profile", "episodes"].includes(scope)) {
    return res.status(422).json({ success: false, error: "scope must be all, profile, or episodes" });
  }
  try {
    const removals = [];
    // Profile reset includes source measurements; otherwise a later turn would
    // immediately recreate the same profile from retained measurements.
    if (scope === "all" || scope === "profile") {
      removals.push(db.schema("edu").from("learner_turn_measurements").delete().eq("learner_id", req.user.id));
      removals.push(db.schema("edu").from("learner_teaching_profiles").delete().eq("learner_id", req.user.id));
    }
    if (scope === "all" || scope === "episodes") {
      removals.push(db.schema("edu").from("learner_learning_episodes").delete().eq("learner_id", req.user.id));
    }
    const outcomes = await Promise.all(removals);
    if (outcomes.some(({ error }) => error)) throw new Error("clear failed");
    return res.json({ success: true, cleared: scope });
  } catch (error) {
    return res.status(503).json({ success: false, error: "Learning insights could not be cleared" });
  }
});

// =============================================================
// LEARNER-SELECTED SOUL-STATE CONTROLS — no inferred emotion or identity
// =============================================================

const SOUL_VALUES = {
  interactionStyle: new Set(["balanced", "collaborative", "independent", "socratic"]),
  responseTone: new Set(["calm", "curious", "direct", "celebratory"]),
  challengeLevel: new Set(["gentle", "adaptive", "stretch"]),
  encouragementLevel: new Set(["minimal", "balanced", "frequent"]),
  feeling: new Set(["steady", "energised", "tired", "stuck", "celebrating"]),
  studyContext: new Set(["unknown", "quiet", "distracted", "rushed"]),
  studyIntent: new Set(["explore", "practise", "prepare", "recover"]),
  requestedSupport: new Set(["none", "slower_steps", "more_examples", "challenge_me", "celebrate_progress"]),
};
const safeSoulValue = (value, field) => {
  const selected = String(value || "").trim().toLowerCase();
  return SOUL_VALUES[field]?.has(selected) ? selected : null;
};

router.get("/soul-state", async (req, res) => {
  if (!learnerSoulStateEnabled) return res.json({ success: true, enabled: false, preferences: null, checkIns: [] });
  try {
    const [preferenceResult, checkinsResult] = await Promise.all([
      db.schema("edu").from("learner_soul_preferences")
        .select("interaction_style, response_tone, challenge_level, encouragement_level, policy_version")
        .eq("learner_id", req.user.id).maybeSingle(),
      db.schema("edu").from("learner_soul_checkins")
        .select("source_session_id, feeling, study_context, study_intent, requested_support, expires_at")
        .eq("learner_id", req.user.id).gt("expires_at", new Date().toISOString())
        .order("checked_in_at", { ascending: false }).limit(4),
    ]);
    if (preferenceResult.error || checkinsResult.error) throw preferenceResult.error || checkinsResult.error;
    const preferences = preferenceResult.data ? {
      interactionStyle: preferenceResult.data.interaction_style, responseTone: preferenceResult.data.response_tone,
      challengeLevel: preferenceResult.data.challenge_level, encouragementLevel: preferenceResult.data.encouragement_level,
      policyVersion: preferenceResult.data.policy_version,
    } : null;
    const checkIns = (checkinsResult.data || []).map((item) => ({
      sessionId: item.source_session_id, feeling: item.feeling, studyContext: item.study_context,
      studyIntent: item.study_intent, requestedSupport: item.requested_support, expiresAt: item.expires_at,
    }));
    return res.json({ success: true, enabled: true, preferences, checkIns });
  } catch {
    return res.status(503).json({ success: false, error: "Soul-state controls are unavailable" });
  }
});

router.put("/soul-state/preferences", async (req, res) => {
  if (!learnerSoulStateEnabled) return res.status(409).json({ success: false, error: "Soul-state controls are not enabled" });
  const values = Object.fromEntries(Object.keys(SOUL_VALUES).slice(0, 4).map((key) => [key, safeSoulValue(req.body?.[key], key)]));
  if (Object.values(values).some((value) => !value)) return res.status(422).json({ success: false, error: "All preference values must be recognised options" });
  try {
    const { error } = await db.schema("edu").from("learner_soul_preferences").upsert({
      learner_id: req.user.id,
      interaction_style: values.interactionStyle, response_tone: values.responseTone,
      challenge_level: values.challengeLevel, encouragement_level: values.encouragementLevel,
      policy_version: "learner-soul-v1", updated_at: new Date().toISOString(),
    }, { onConflict: "learner_id" });
    if (error) throw error;
    return res.json({ success: true, preferences: values });
  } catch {
    return res.status(503).json({ success: false, error: "Soul preferences could not be saved" });
  }
});

router.delete("/soul-state", async (req, res) => {
  if (!learnerSoulStateEnabled) return res.status(409).json({ success: false, error: "Soul-state controls are not enabled" });
  const scope = String(req.body?.scope || "all").toLowerCase();
  if (!["all", "preferences", "checkins"].includes(scope)) return res.status(422).json({ success: false, error: "scope must be all, preferences, or checkins" });
  try {
    const removals = [];
    if (scope === "all" || scope === "preferences") removals.push(db.schema("edu").from("learner_soul_preferences").delete().eq("learner_id", req.user.id));
    if (scope === "all" || scope === "checkins") removals.push(db.schema("edu").from("learner_soul_checkins").delete().eq("learner_id", req.user.id));
    const results = await Promise.all(removals);
    if (results.some(({ error }) => error)) throw new Error("clear failed");
    return res.json({ success: true, cleared: scope });
  } catch {
    return res.status(503).json({ success: false, error: "Soul-state controls could not be cleared" });
  }
});

// =============================================================
// AGENT PAIR ROUTES
// =============================================================

// =============================================================
// DECAY ROUTES  (v3.1)
// =============================================================

// GET /decay/status/:studentId — full knowledge health dashboard
router.get("/decay/status/:studentId", async (req, res) => {
  try {
    const agent     = await getOrCreateStudentAgent(req.user.id);
    const dashboard = await decayEngine.getKnowledgeDashboard(req.user.id, agent.id);
    res.json({ success: true, agentId: agent.id, dashboard });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /decay/alerts/:studentId — unread decay notifications + subtopic alerts
router.get("/decay/alerts/:studentId", async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const studentId = req.user.id;

    // Original topic-level notifications
    const notifications = await decayEngine.getUnreadNotifications(
      studentId, Number(limit)
    );

    // Subtopic-level alerts from knowledge_confidence table
    const subtopicAlerts = await decayEngine.getSubtopicAlerts(studentId);

    // Merge: subtopic alerts take priority, deduplicate by sessionId
    const seenSessions = new Set();
    const alerts = [];

    for (const a of subtopicAlerts) {
      // Only dedupe by a REAL sessionId — subtopic alerts without a session
      // (session_id null) are distinct rows and must all be kept, else they
      // all collapse onto the single `null` key.
      if (a.sessionId && seenSessions.has(a.sessionId)) continue;
      if (a.sessionId) seenSessions.add(a.sessionId);
      alerts.push(a);
    }

    // Add topic-level notifications not already covered by subtopic alerts
    for (const n of notifications) {
      const sessionMatch = subtopicAlerts.find(a =>
        a.topic === n.topic && a.subject === n.subject
      );
      if (!sessionMatch) {
        alerts.push({
          id:              n.id,
          sessionId:       n.session_id || null,
          topic:           n.topic,
          subtopic:        n.subtopic || n.topic,
          subject:         n.subject,
          confidence:      Math.round((n.confidence ?? 0.5) * 100),
          prevConfidence:  Math.round((n.prev_confidence ?? 0.7) * 100),
          daysSince:       n.days_since_review || 0,
          misconceptions:  n.misconceptions || [],
        });
      }
    }

    res.json({
      success: true,
      alerts,                       // ← frontend uses this shape
      notifications,                // keep for backward compat
      count: alerts.length,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /decay/subjects/:studentId — all subjects + confidence summary
router.get("/decay/subjects/:studentId", async (req, res) => {
  try {
    const agent    = await getOrCreateStudentAgent(req.user.id);
    const subjects = await getAgentKnowledgeBySubject(agent.id);
    res.json({ success: true, subjects, agentId: agent.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /decay/topics/:studentId/:subject — topics in a subject with health
router.get("/decay/topics/:studentId/:subject", async (req, res) => {
  try {
    const agent  = await getOrCreateStudentAgent(req.user.id);
    const topics = await getTopicsBySubject(agent.id, req.params.subject);
    res.json({ success: true, subject: req.params.subject, topics, agentId: agent.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /decay/acknowledge/:notifId — mark notification as read
router.post("/decay/acknowledge/:notifId", async (req, res) => {
  try {
    // A notification UUID is not authorization. The decay engine scopes the
    // update to the authenticated learner so one learner cannot acknowledge
    // another learner's alert.
    const acknowledged = await decayEngine.markNotificationRead(req.params.notifId, req.user.id);
    res.json({ success: true, acknowledged, notificationId: req.params.notifId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /decay/run — manually trigger decay check for a student (admin/dev use)
router.post("/decay/run", async (req, res) => {
  try {
    const runAll = req.body?.all === true;
    if (runAll) {
      // Full scheduler across every agent — admin only.
      if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
      const result = await decayEngine.runDecayScheduler(null);
      return res.json({ success: true, ...result });
    }
    // Otherwise run decay for the authenticated caller's own agent.
    const agent       = await getOrCreateStudentAgent(req.user.id);
    const alertTopics = await decayEngine.applyDecay(agent.id);
    res.json({ success: true, agentId: agent.id, alertTopics, count: alertTopics.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================
// STUDENT AGENT ROUTES
// =============================================================

router.get("/student/agent/:studentId", async (req, res) => {
  try { res.json({ success: true, agent: await getOrCreateStudentAgent(req.user.id) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/student/agent/:studentId/intelligence", async (req, res) => {
  try {
    const agent = await getOrCreateStudentAgent(req.user.id);
    const intel = await getAgentIntelligence(agent.id);
    res.json({ success: true, intelligence: intel, agent });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/student/agent/:studentId/growth", async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const agent   = await getOrCreateStudentAgent(req.user.id);
    const history = await getAgentGrowthHistory(agent.id, Number(limit));
    res.json({ success: true, agent, history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================
// STANDARD CHAT
// =============================================================

// ─── Persistent chat sessions ────────────────────────────────────────────────
// Per-user conversations for the Agent Chat tab, browsable + resumable from
// the sessions drawer. All routes are already behind authenticateToken.

const sessionTitleFrom = (text) => {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 48 ? clean.slice(0, 48).trimEnd() + "…" : clean;
};

// GET /sessions — the user's sessions, newest activity first.
router.get("/sessions", async (req, res) => {
  try {
    // Paged mode (the drawer's scroll-to-fetch-more, 2026-11-17): ?limit /
    // ?cursor switch the response to { sessions, total, nextCursor };
    // legacy callers keep the bare list capped at 100. Cursor = the last
    // row's (last_message_at, id); nulls sort last in paged mode, and a
    // null-timestamp tail row ends paging (empty sessions sit last).
    const paged = req.query.limit !== undefined || req.query.cursor !== undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    let cursor = null;
    if (req.query.cursor) {
      try { cursor = JSON.parse(Buffer.from(String(req.query.cursor), "base64url").toString("utf8")); } catch { cursor = null; }
    }
    let query = db
      .from("chat_sessions")
      .select("id, title, created_at, updated_at, last_message_at")
      .eq("user_id", req.user.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
    if (cursor?.t) {
      query = query.or(`last_message_at.lt.${cursor.t},and(last_message_at.eq.${cursor.t},id.lt.${cursor.id})`);
    }
    const { data, error } = await query.limit(paged ? limit : 100);
    if (error) throw new Error(error.message);
    const sessions = data ?? [];
    if (!paged) return res.json({ success: true, sessions });
    const { count } = await db
      .from("chat_sessions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.user.id);
    const last = sessions[sessions.length - 1];
    return res.json({
      success: true,
      sessions,
      total: count ?? sessions.length,
      nextCursor: sessions.length === limit && last?.last_message_at
        ? Buffer.from(JSON.stringify({ t: last.last_message_at, id: last.id }), "utf8").toString("base64url")
        : null,
    });
  } catch (err) {
    console.error("[/chat/sessions GET]", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /sessions — create a new (empty) session.
router.post("/sessions", async (req, res) => {
  try {
    const title = sessionTitleFrom(req.body?.title);
    const { data, error } = await db
      .from("chat_sessions")
      .insert({ user_id: req.user.id, title })
      .select("id, title, created_at, updated_at, last_message_at")
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, session: data });
  } catch (err) {
    console.error("[/chat/sessions POST]", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /sessions/:id/messages — messages for one owned session, oldest first.
// Without `limit`: the whole transcript (copy, other apps). With `limit`
// (1-100): only the newest `limit` messages — older than `before` (an ISO
// time, the oldest one already loaded) when given — plus `hasMore`, so the
// chat loads its history a page at a time as the learner scrolls up.
export function historyPage(query = {}) {
  const raw = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(100, raw)) : null;
  const before = limit && query.before && !Number.isNaN(Date.parse(query.before)) ? new Date(query.before).toISOString() : null;
  return { limit, before };
}

router.get("/sessions/:id/messages", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const { data: session } = await db
      .from("chat_sessions").select("id")
      .eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
    if (!session) return res.status(404).json({ error: "Session not found" });

    const { limit, before } = historyPage(req.query);
    const loadMessages = (columns) => {
      let q = db.from("chat_messages").select(columns).eq("session_id", req.params.id);
      if (!limit) return q.order("created_at", { ascending: true });
      if (before) q = q.lt("created_at", before);
      // Newest first to take the page (one extra says whether more exist).
      return q.order("created_at", { ascending: false }).limit(limit + 1);
    };
    // The reply trace column may not exist yet during a rolling deploy —
    // fall back to the plain transcript rather than failing the history load.
    let { data, error } = await loadMessages("id, role, text, created_at, trace, meta");
    // Rolling-deploy fallbacks: an older build may pre-date the meta column,
    // and either column may pre-date trace.
    if (error && /meta/i.test(String(error.message || ""))) ({ data, error } = await loadMessages("id, role, text, created_at, trace"));
    if (error && /trace/i.test(String(error.message || ""))) ({ data, error } = await loadMessages("id, role, text, created_at"));
    if (error) throw new Error(error.message);
    if (!limit) return res.json({ success: true, messages: data ?? [] });
    const rows = data ?? [];
    res.json({ success: true, messages: rows.slice(0, limit).reverse(), hasMore: rows.length > limit });
  } catch (err) {
    console.error("[/chat/sessions messages GET]", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /sessions/:id/messages — append a message and bump session activity.
router.post("/sessions/:id/messages", async (req, res) => {
  try {
    const { role, text } = req.body || {};
    if (role !== "user" && role !== "agent") return res.status(400).json({ error: "role must be user or agent" });
    if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required" });

    const { data: session } = await db
      .from("chat_sessions").select("id, title")
      .eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
    if (!session) return res.status(404).json({ error: "Session not found" });

    const { data: message, error } = await db
      .from("chat_messages")
      .insert({ session_id: session.id, user_id: req.user.id, role, text: String(text) })
      .select("id, role, text, created_at")
      .single();
    if (error) throw new Error(error.message);

    // Auto-title from the first user message; always bump activity.
    const patch = { last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (role === "user" && (!session.title || session.title === "New chat")) {
      patch.title = sessionTitleFrom(text);
    }
    await db.from("chat_sessions").update(patch).eq("id", session.id);

    res.status(201).json({ success: true, message, title: patch.title });
  } catch (err) {
    console.error("[/chat/sessions messages POST]", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /sessions/:id — rename a session.
router.patch("/sessions/:id", async (req, res) => {
  try {
    const title = sessionTitleFrom(req.body?.title);
    const { data, error } = await db
      .from("chat_sessions")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", req.params.id).eq("user_id", req.user.id)
      .select("id, title").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: "Session not found" });
    res.json({ success: true, session: data });
  } catch (err) {
    console.error("[/chat/sessions PATCH]", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sessions/:id — remove a session and its messages (cascade).
router.delete("/sessions/:id", async (req, res) => {
  try {
    const { data, error } = await db
      .from("chat_sessions")
      .delete()
      .eq("id", req.params.id).eq("user_id", req.user.id)
      .select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: "Session not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[/chat/sessions DELETE]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── /chat/tutor — educational AI chat with modes + attachments ──────────────
// Used by the "Agent Chat" tab in both the learner and instructor apps.
//
// body: { message, history[], agentName, role,
//         mode: "default" | "think" | "research",
//         attachments: [{ name, type, dataUrl }] }
//
// Modes:
//   default   — the classic tutor: fast, grounded in syllabus + past questions.
//   think     — a reasoning model reasons first. Its summary streams to the UI
//               as `thinking` events (rendered as a collapsible "Thought
//               process" above the answer), then the answer streams as usual.
//               Falls back gpt-4o → gpt-4o-mini when the reasoning model or the
//               Responses API surface isn't available on the key.
//   research  — a deeper pass: more syllabus refs, more past questions, a
//               structured study-guide answer and both ref sets on the reply.
//               Progress streams as `status` steps the UI can show.
//
// Attachments (any mode): images go straight to vision; text files are
// inlined into the prompt; PDFs are text-extracted — and a scanned PDF with
// no text layer is rasterised to page images for vision OCR (renderPdfToImages).
// A bad file never fails the request; it becomes a note appended to the message.

const THINK_MODEL    = process.env.OPENAI_THINK_MODEL    || "o4-mini";
// Think mode reasons at every tool-loop decision too (each "Thought for Ns"
// row is the model's real reasoning summary). Decisions run at a lighter
// effort than the final answer to keep a multi-step turn affordable.
const THINK_DECISION_EFFORT = process.env.OPENAI_THINK_DECISION_EFFORT || "low";
const THINK_ANSWER_EFFORT   = process.env.OPENAI_THINK_ANSWER_EFFORT   || "medium";
const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || "gpt-4o";

const MAX_FILES       = 4;
const MAX_FILE_BYTES  = 5 * 1024 * 1024;    // 5 MB per file
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;   // 12 MB per message
const DOC_TEXT_CAP    = 12_000;             // chars of extracted doc text in the prompt
const SCAN_PDF_PAGES  = 4;                  // pages rasterised when a PDF has no text layer

import { renderPdfToImages } from "./pdfRender.js";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TEXT_TYPES  = new Set(["text/plain", "text/markdown", "text/csv"]);

function dataUrlToBuffer(dataUrl) {
  const m = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!m) return null;
  try { return m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8"); }
  catch { return null; }
}

// pdf-parse's index.js runs a self-test file read when nothing requires it,
// which crashes under ESM import — import the internals directly.
async function extractPdfText(buffer) {
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = mod.default || mod;
  const out = await pdfParse(buffer);
  return String(out?.text || "");
}

/* Turn the client's attachment list into { visionParts, docContext, notes }.
   visionParts are chat.completions image parts; docContext is prompt text;
   notes are human-facing "what happened to your file" lines (also appended to
   the message so the model knows what it is looking at). */
async function processAttachments(attachments = []) {
  const visionParts = [];
  const docChunks   = [];
  const notes       = [];
  let total = 0;

  for (const [i, a] of attachments.entries()) {
    const name = String(a?.name || `file-${i + 1}`);
    try {
      if (i >= MAX_FILES) { notes.push(`Only the first ${MAX_FILES} attachments were read.`); break; }
      const type = String(a?.type || "").toLowerCase();
      const buf  = dataUrlToBuffer(a?.dataUrl);
      if (!buf) { notes.push(`Couldn't read ${name}.`); continue; }
      total += buf.length;
      if (buf.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) { notes.push(`${name} was too large and was skipped.`); continue; }

      if (IMAGE_TYPES.has(type)) {
        visionParts.push({ type: "image_url", image_url: { url: a.dataUrl } });
        notes.push(`🖼 ${name} attached.`);
        continue;
      }
      if (type === "application/pdf" || /\.pdf$/i.test(name)) {
        const text = await extractPdfText(buf).catch(() => "");
        if (text && text.replace(/\s+/g, "").length >= 200) {
          docChunks.push(`### Attached file: ${name}\n${text.slice(0, DOC_TEXT_CAP)}`);
          notes.push(`📄 ${name} read.`);
        } else {
          // No usable text layer → scanned pages. Render for vision OCR.
          const pages = await renderPdfToImages(buf, { maxPages: SCAN_PDF_PAGES, scale: 1.6 }).catch(() => []);
          pages.forEach((url) => visionParts.push({ type: "image_url", image_url: { url, detail: "auto" } }));
          notes.push(pages.length
            ? `🔍 ${name} has no text layer — ${pages.length} page(s) read as images.`
            : `Couldn't read ${name}.`);
        }
        continue;
      }
      if (TEXT_TYPES.has(type) || /\.(txt|md|csv)$/i.test(name)) {
        docChunks.push(`### Attached file: ${name}\n${buf.toString("utf8").slice(0, DOC_TEXT_CAP)}`);
        notes.push(`📄 ${name} read.`);
        continue;
      }
      notes.push(`${name} isn't a supported file type and was skipped.`);
    } catch {
      notes.push(`Couldn't read ${name}.`);
    }
  }
  return { visionParts, docContext: docChunks.join("\n\n"), notes };
}

/**
 * Base system prompt for the live agent — shared by the HTTP /agent route
 * and the voice session bootstrap (modules/voice/routes.js). Role-aware:
 * students get an exam-focused study tutor, instructors a teaching copilot.
 * The Think/Research addenda and syllabus/past-question grounding are
 * appended by the caller, not baked in here.
 */
// P1 (Context Layer Adoption): the STATIC chat doctrine — persona, formatting
// contract, role/mode addenda, agent-chat operating rules, tool-observation
// and HITL guides — lives in modules/agent-context/chat-doctrine.js and loads
// VERBATIM from the akoro-agent/ workspace, byte-identical to the
// pre-migration literals (pinned by agentContext.golden.chat.test.mjs).
// Imported (not just re-exported): `export { x } from` does NOT create a
// local binding, and this module's /agent route calls assembleChatDoctrine
// directly — a re-export-only line made every chat turn throw
// ReferenceError: assembleChatDoctrine is not defined.
import { tutorSystemPrompt, assembleChatDoctrine } from "../agent-context/chat-doctrine.js";
import { safeCompare } from "../../lib/safeCompare.js";
import { appLink } from "../../lib/urls.js";
export { tutorSystemPrompt, assembleChatDoctrine };

/* chat.completions streaming → `delta` events. Returns the full text. */
async function streamChat({ send, messages, model, max_tokens = 700, temperature = 0.6, tools = null, toolChoice = undefined, isAborted = () => false }) {
  const stream = await openai.chat.completions.create({
    model, temperature, max_tokens, stream: true, messages,
    ...(tools ? { tools, ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}) } : {}),
  });
  let full = "";
  let muted = false;   // DSML markup started: keep collecting, stop painting (the final reply is scrubbed)
  let tail = "";
  for await (const chunk of stream) {
    // The learner pressed stop (the connection closed): leaving the loop ends
    // the upstream stream; usage so far is still metered by meteredCreate.
    if (isAborted()) break;
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      full += delta;
      if (!muted) {
        if (hasDsmlMarkup(tail + delta) || hasToolCallMarkup(tail + delta)) muted = true;
        else send("delta", { text: delta });
        tail = (tail + delta).slice(-16);
      }
    }
  }
  return full;
}

/*
 * One tool-loop DECISION on the standard model, streamed: text the model
 * writes streams to onText as it arrives (the words between steps), tool
 * calls are assembled from their deltas. Returns the assistant message in
 * the chat-completions shape, or { aborted } when the learner stopped.
 */
async function streamDecision({ messages, tools, toolChoice, onText = null, isAborted = () => false, model = null, meta = null }) {
  const stream = await openai.chat.completions.create({
    ...(meta || {}),   // e.g. the eval runner's { __feature: "eval", __userId }
    model: model || OPENAI_MODEL,
    temperature: 0.6,
    max_tokens: 900,
    messages,
    tools,
    tool_choice: toolChoice,
    stream: true,
  });
  let content = "";
  let dsmlMuted = false, dsmlTail = "";
  const calls = [];
  for await (const chunk of stream) {
    if (isAborted()) return { aborted: true, assistant: { role: "assistant", content } };
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      // Same DSML guard as streamChat: once tool-call markup starts, stop
      // painting it live; the composed reply is scrubbed before it is saved.
      if (!dsmlMuted && (hasDsmlMarkup(dsmlTail + delta.content) || hasToolCallMarkup(dsmlTail + delta.content))) dsmlMuted = true;
      if (!dsmlMuted) { onText?.(delta.content); dsmlTail = (dsmlTail + delta.content).slice(-16); }
    }
    for (const part of delta.tool_calls || []) {
      const index = part.index ?? calls.length;
      calls[index] ||= { id: "", type: "function", function: { name: "", arguments: "" } };
      if (part.id) calls[index].id = part.id;
      if (part.function?.name) calls[index].function.name += part.function.name;
      if (part.function?.arguments) calls[index].function.arguments += part.function.arguments;
    }
  }
  const toolCalls = calls.filter((call) => call?.function?.name);
  return { assistant: { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } };
}

/*
 * Think mode: one tool-loop DECISION on the reasoning model. Its reasoning
 * summary streams into the step's "Thought for Ns" row (onReasoning); the
 * result comes back in the chat-completions assistant shape the loop already
 * uses. Throws when the model or API surface is unavailable so the loop can
 * fall back to the standard model.
 */
async function thinkDecision({ systemContent, transcript, tailContent = null, tools, toolChoice, onReasoning = () => {}, onText = null, isAborted = () => false }) {
  const stream = await openai.responses.create({
    model: THINK_MODEL,
    input: toResponsesInput([{ role: "system", content: systemContent }, ...transcript, ...(tailContent ? [{ role: "system", content: tailContent }] : [])], { native: true }),
    tools: toResponsesTools(tools),
    tool_choice: toolChoice?.function?.name ? { type: "function", name: toolChoice.function.name } : "auto",
    reasoning: { effort: THINK_DECISION_EFFORT, summary: "auto" },
    max_output_tokens: 4000,
    stream: true,
  });
  let content = "";
  const toolCalls = [];
  for await (const ev of stream) {
    if (isAborted()) return { aborted: true, assistant: { role: "assistant", content } };
    if (ev.type === "response.reasoning_summary_part.added" && ev.summary_index > 0) onReasoning("\n\n");
    else if (ev.type === "response.reasoning_summary_text.delta" && ev.delta) onReasoning(ev.delta);
    else if (ev.type === "response.output_text.delta" && ev.delta) { content += ev.delta; onText?.(ev.delta); }
    else if (ev.type === "response.output_item.done" && ev.item?.type === "function_call") {
      toolCalls.push({ id: ev.item.call_id, type: "function", function: { name: ev.item.name, arguments: ev.item.arguments || "{}" } });
    }
    else if (ev.type === "response.failed") throw new Error(ev.response?.error?.message || "reasoning model failed");
    else if (ev.type === "error") throw new Error(ev.message || "reasoning model error");
  }
  return { assistant: { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } };
}

/*
 * Reasoning model via the Responses API — the Think-mode ANSWER, including
 * after tools ran (their results arrive as developer notes). The reasoning
 * summary streams into its own "Thought for Ns" trace row, which closes as
 * the answer starts streaming as `delta`. Returns { reply, thinking }. Throws
 * when the model or API surface is unavailable so the caller can fall back.
 */
async function streamThinkWithResponses({ send, messages, model, trace = null, isAborted = () => false }) {
  const useReasoning = model !== "gpt-4o";   // gpt-4o has no reasoning surface
  const stream = await openai.responses.create({
    model,
    input: toResponsesInput(messages),
    ...(useReasoning ? { reasoning: { effort: THINK_ANSWER_EFFORT, summary: "auto" } } : {}),
    max_output_tokens: 4000,
    stream: true,
  });
  let full = "";
  let thinking = "";
  let thinkId = useReasoning ? trace?.thinkStart() : null;
  const closeThink = () => { if (thinkId) { trace.thinkEnd(thinkId, ""); thinkId = null; } };
  const reason = (text) => { thinking += text; if (thinkId) trace.thinkDelta(thinkId, text); };
  try {
    for await (const ev of stream) {
      if (isAborted()) break;
      if (ev.type === "response.reasoning_summary_part.added" && ev.summary_index > 0) reason("\n\n");
      else if (ev.type === "response.reasoning_summary_text.delta" && ev.delta) reason(ev.delta);
      else if (ev.type === "response.output_text.delta" && ev.delta) { closeThink(); full += ev.delta; send("delta", { text: ev.delta }); }
      else if (ev.type === "response.failed") throw new Error(ev.response?.error?.message || "reasoning model failed");
      else if (ev.type === "error") throw new Error(ev.message || "reasoning model error");
    }
  } finally {
    closeThink();
  }
  return { reply: full, thinking: thinking.trim() };
}

/*
 * Thinking on a chat-completions model (DeepSeek/GLM/Qwen/GPT Luna/Grok):
 * request reasoning where the provider accepts a hint, stream any exposed
 * reasoning text into the "Thought for Ns" row, and answer from the same
 * selected model — no hidden switch to o4-mini.
 */
async function thinkChatOnce({ messages, model, trace = null }) {
  const thinkId = trace?.thinkStart();
  const call = (extra) => openai.chat.completions.create({
    model, temperature: 0.4, max_tokens: 2200, messages, ...extra,
  });
  let resp;
  try { resp = await call({ reasoning_effort: "medium" }); }
  catch (e) {
    if (e?.status === 400 || /reasoning/i.test(String(e?.message || ""))) resp = await call({});
    else { if (thinkId) trace.thinkEnd(thinkId, ""); throw e; }
  }
  const m = resp?.choices?.[0]?.message || {};
  const thinking = String(m.reasoning_content || m.reasoning || "").trim();
  const reply = String(m.content || "").trim();
  if (thinkId) { if (thinking) trace.thinkDelta(thinkId, thinking); trace.thinkEnd(thinkId, ""); }
  return { reply, thinking };
}

async function streamThinkChat({ send, messages, model, trace = null, isAborted = () => false }) {
  let thinkId = trace?.thinkStart() || null;
  const call = (extra) => openai.chat.completions.create({
    model, temperature: 0.4, max_tokens: 2200, stream: true, messages, ...extra,
  });
  let stream;
  try { stream = await call({ reasoning_effort: "medium" }); }
  catch (e) {
    if (e?.status === 400 || /reasoning/i.test(String(e?.message || ""))) stream = await call({});
    else { if (thinkId) trace.thinkEnd(thinkId, ""); throw e; }
  }
  let full = "";
  let thinking = "";
  const close = () => { if (thinkId) { trace.thinkEnd(thinkId, ""); thinkId = null; } };
  try {
    for await (const chunk of stream) {
      if (isAborted()) break;
      const d = chunk.choices?.[0]?.delta || {};
      const r = d.reasoning_content ?? d.reasoning ?? d.thinking;
      if (r) { thinking += r; if (thinkId) trace.thinkDelta(thinkId, r); }
      if (d.content) { if (thinkId) close(); full += d.content; send("delta", { text: d.content }); }
    }
  } finally { close(); }
  return { reply: full, thinking: thinking.trim() };
}

/* Non-streaming reasoning call → { reply, thinking }; the summary is also a trace row. */
async function thinkOnce({ messages, model, trace = null }) {
  const useReasoning = model !== "gpt-4o";
  const thinkId = useReasoning ? trace?.thinkStart() : null;
  let resp;
  try {
    resp = await openai.responses.create({
      model,
      input: toResponsesInput(messages),
      ...(useReasoning ? { reasoning: { effort: THINK_ANSWER_EFFORT, summary: "auto" } } : {}),
      max_output_tokens: 4000,
    });
  } catch (error) {
    if (thinkId) trace.thinkEnd(thinkId, "");
    throw error;
  }
  const thinking = (Array.isArray(resp?.output) ? resp.output : [])
    .filter((o) => o?.type === "reasoning")
    .flatMap((o) => (o.summary || []).map((s) => s?.text || ""))
    .join("\n\n")
    .trim();
  if (thinkId) { if (thinking) trace.thinkDelta(thinkId, thinking); trace.thinkEnd(thinkId, ""); }
  return { reply: String(resp?.output_text || "").trim(), thinking };
}

// Grounding is best-effort by design (an embeddings/RAG hiccup must never
// take the chat down), but a SILENTLY broken pipeline reads to users as
// "the agent hallucinates". One line a minute keeps the failure visible in
// the logs without flooding them — the same discipline as the redis tracer.
let lastGroundingWarn = 0;
function warnGrounding(kind, error) {
  if (Date.now() - lastGroundingWarn > 60_000) {
    lastGroundingWarn = Date.now();
    console.warn(`[agent-chat] ${kind} grounding unavailable — teaching WITHOUT it:`, error?.message || error);
  }
}

export function safeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 12_000) }))
    .filter((item) => item.content)
    .slice(-24);
}

// The agent receives its memory as context but historically DENIED having it
// ("I can't remember past chats") because nothing in the prompt owned the
// ability — the guide in memory/DURABLE_MEMORY.md is appended (via
// assembleChatDoctrine) only when durable memory actually loaded.

function compactAgentSummary(previous, userMessage, assistantMessage) {
  const clean = (value, maximum) => String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
  const latest = `Latest learner request: ${clean(userMessage, 900)}\nLatest Akoro response: ${clean(assistantMessage, 1_600)}`;
  const prior = clean(previous, 2_200);
  return `${prior ? `${prior}\n` : ""}${latest}`.slice(-4_000);
}

function safeMemoryUpdates(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  // Durable memory is opt-in by wording, study-only, and never stores raw tool
  // output. General chat and potentially sensitive requests remain in the exact
  // transcript and compact session summary only.
  const preference = text.match(/\b(?:i (?:prefer|learn best with|like)|please use)\s+(.{3,220})/i);
  if (preference && /\b(?:study|learn|revision|quiz|question|example|explain|lesson)\b/i.test(preference[1])) {
    return [{ kind: "study_preference", content: preference[1].trim(), topic: null, subject: null }];
  }
  const goal = text.match(/\b(?:my goal is|i want to (?:learn|revise|practise|practice|improve))\s+(.{3,220})/i);
  if (goal && /\b(?:math|mathematics|english|biology|chemistry|physics|science|history|geography|economics|literature|exam|waec|neco|jamb|revision|study)\b/i.test(goal[1])) {
    return [{ kind: "learner_goal", content: goal[1].trim(), topic: null, subject: null }];
  }
  return [];
}

/**
 * Write the user + reply rows immediately, before the slow durable context
 * work. Rows carry agent_session_id/agent_turn_id, so persistLearnerAgent…
 * finds them by (session, turn, role) and enriches instead of duplicating.
 * Returns the assistant message id, or null when the write failed.
 */
async function appendFastChatTurn({ conversationId, userId, sessionId, turnId, userMessage, assistantMessage, agentOnly = false }) {
  const { data: session, error: sessionError } = await db.from("chat_sessions")
    .select("id, title").eq("id", conversationId).eq("user_id", userId).maybeSingle();
  if (sessionError || !session) return null;
  const ensure = async (role, text, createdAt) => {
    const find = () => db.from("chat_messages").select("id, text")
      .eq("session_id", conversationId).eq("user_id", userId)
      .eq("agent_session_id", sessionId).eq("agent_turn_id", turnId).eq("role", role).maybeSingle();
    const existing = await find();
    if (existing.data) return existing.data.id;
    const inserted = await db.from("chat_messages").insert({
      session_id: conversationId, user_id: userId, role, text,
      agent_session_id: sessionId, agent_turn_id: turnId, created_at: createdAt,
    }).select("id").single();
    if (!inserted.error) return inserted.data?.id || null;
    if (inserted.error.code === "23505") { const again = await find(); return again.data?.id || null; }
    return null;
  };
  const now = Date.now();
  const userIdRow = agentOnly ? null : await ensure("user", userMessage, new Date(now).toISOString());
  const assistantId = await ensure("agent", assistantMessage, new Date(now + 1).toISOString());
  const patch = { last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (!agentOnly && (!session.title || session.title === "New chat")) patch.title = sessionTitleFrom(userMessage);
  try { await db.from("chat_sessions").update(patch).eq("id", conversationId).eq("user_id", userId); } catch { /* best effort */ }
  return agentOnly ? assistantId : (userIdRow && assistantId ? assistantId : null);
}

async function appendBasicChatTurn({ conversationId, userId, userMessage, assistantMessage, agentOnly = false }) {
  const { data: session, error: sessionError } = await db.from("chat_sessions")
    .select("id, title").eq("id", conversationId).eq("user_id", userId).maybeSingle();
  if (sessionError || !session) throw new Error("Agent Chat session was not found");
  const now = new Date().toISOString();
  const { data: inserted, error } = await db.from("chat_messages").insert([
    ...(agentOnly ? [] : [{ session_id: conversationId, user_id: userId, role: "user", text: userMessage }]),
    { session_id: conversationId, user_id: userId, role: "agent", text: assistantMessage },
  ]).select("id, role");
  if (error) throw error;
  const patch = { last_message_at: now, updated_at: now };
  if (!agentOnly && (!session.title || session.title === "New chat")) patch.title = sessionTitleFrom(userMessage);
  const { error: updateError } = await db.from("chat_sessions").update(patch).eq("id", conversationId).eq("user_id", userId);
  if (updateError) throw updateError;
  return { assistantMessageId: (inserted || []).find((row) => row.role === "agent")?.id ?? null };
}

/** The running-work rules + what runs now, for the turn's context — empty when nothing runs. */
async function runningWorkBrief(learnerId) {
  const { runningWork } = await import("./study-prep/wiring.js");
  const work = await runningWork(learnerId);
  const live = [
    ...work.agentChecks.map((c) => `- Agent Check on ${c.topic} running in Battles: ${c.answered} of ${c.total ?? "?"} answered. Link: ${c.markdown || c.link}`),
    ...work.teachingSessions.map((t) => `- Teaching session on ${t.topic} (${t.state === "scheduled" ? "waiting on their dashboard" : "under way"}${t.progress?.of ? `, ${t.progress.done || 0} of ${t.progress.of} parts taught` : ""}). Link: ${t.markdown || t.link}`),
  ];
  if (!live.length) return "";
  const doctrine = await loadDoctrine("reasoning/RUNNING_WORK.md").catch(() => "");
  return `\n\n${doctrine.trim()}\n\n## Running now\n${live.join("\n")}`;
}

/**
 * The preview affordances a reload must rebuild: drafts the tools created
 * during this reply (topic previews, assignment/quiz draft cards) plus which
 * tools ran. Null when the reply executed nothing preview-worthy — the same
 * shape the live reply attaches client-side.
 */
function previewMetaFrom(toolExecutions) {
  const execs = Array.isArray(toolExecutions) ? toolExecutions : [];
  const previews = execs
    .filter((x) => (x.tool === "prepare_activity" || x.tool === "run_teaching_tool" || x.tool === "revise_activity_draft") && x.success && x.draft)
    .map((x) => x.draft);
  // The reply's material links come back on reload too.
  const materials = collectMaterials(execs.map((x) => x.materials || []));
  // The Study Prep card the reply carries (the live chat reads it from the tool's session): a
  // reload — or the server after a restart, looking for the plan's chat — finds it here.
  const studyPrepSessionId = execs.find((x) => x.success && x.session?.id && ["start_study_prep_session", "get_study_prep_session"].includes(x.tool))?.session?.id || null;
  if (!previews.length && !materials.length && !studyPrepSessionId) return null;
  return { ...(previews.length ? { previews } : {}), ...(materials.length ? { materials } : {}), ...(studyPrepSessionId ? { studyPrepSessionId } : {}), tools: execs.map((x) => x.tool) };
}

/**
 * Store a reply's bounded trace (thinking / tool / activity blocks) and its
 * preview meta (draft cards) so a reloaded chat shows the same steps AND the
 * same cards. Best effort: a missing column during a rolling deploy or a
 * write hiccup never touches the saved reply itself.
 */
/**
 * Merge a reply-meta patch atomically. Materials (the turn) and ideas (the
 * parallel suggestions call) used to read-modify-write the same jsonb, so one
 * could overwrite the other — the card vanished on refresh. The SQL function
 * merges in one UPDATE; a read-merge-write fallback keeps old deploys working.
 */
async function mergeChatMeta(messageId, patch) {
  if (!messageId || !patch || !Object.keys(patch).length) return;
  try {
    const { error } = await db.rpc("merge_chat_message_meta", { p_id: messageId, p_patch: patch });
    if (!error) return;
  } catch { /* fall through to the portable merge */ }
  try {
    const { data } = await db.from("chat_messages").select("meta").eq("id", messageId).maybeSingle();
    await db.from("chat_messages").update({ meta: { ...(data?.meta || {}), ...patch } }).eq("id", messageId);
  } catch (e) { console.warn("[agent-chat] meta merge failed:", e?.message || e); }
}

let warnedTraceColumn = false;
async function saveMessageTrace({ messageId, userId, trace, meta = null }) {
  const hasTrace = Array.isArray(trace) && trace.length > 0;
  if (!messageId || (!hasTrace && !meta)) return;
  try {
    if (hasTrace) {
      const { error } = await db.from("chat_messages").update({ trace })
        .eq("id", messageId).eq("user_id", userId).eq("role", "agent");
      if (error) throw error;
    }
    if (meta) await mergeChatMeta(messageId, meta);
  } catch (error) {
    if (!warnedTraceColumn) {
      warnedTraceColumn = true;
      console.warn("[agent-chat] reply trace not saved (migration 2026-chat-message-trace pending?):", error?.message || error);
    }
  }
}

// One Agent Chat turn may interleave decisions, tool calls and text many
// times (Grand Plan §13.4). Bounded by code, never by the model.
export const CHAT_TOOL_LOOP_MAX_ITERATIONS = 8;
const STOPPED_REPLY = "(Stopped before finishing.)";

/** The library merge at def-assembly time: drop the legacy search_my_library
 *  def and the learner's own library_documents def, and put ONE merged def in
 *  their place — base + platform actions, plus the learner's visible delta
 *  actions, minus any merged-set action they switched off. No-op when the
 *  kill switch is off. */
async function applyMergedDomain(defs, learnerId, cfg, builtinNames, withDelta = true) {
  if (!cfg.enabled()) return defs;
  const st = withDelta ? await getMergedToolState(learnerId, cfg.name).catch(() => null) : null;
  const delta = st && st.status === "active" ? cfg.deltaActions(st) : [];
  const kept = (defs || []).filter((d) => ![...builtinNames, cfg.name].includes(d?.function?.name));
  kept.push(cfg.def({ delta }));
  return kept;
}
async function dispatchMerged(cfg, input, { studentId, platform, runDelta }) {
  const action = String(input?.action || cfg.actionOrder[0]);
  if (platform && platform[action]) return platform[action]();
  if (cfg.baseActions.includes(action)) return runMergedViewAction(cfg.name, action, input, studentId);
  const out = await runDelta();
  if (out) return out;
  return { error: `Unknown action "${action}" for this tool. Available: ${cfg.mergedActions.join(", ")}.` };
}
async function applyChatsMerge(defs, learnerId, withDelta = true) {
  if (!mergedChatsEnabled()) return defs;
  const st = withDelta ? await getChatsToolState(learnerId).catch(() => null) : null;
  const delta = st && st.status === "active" ? chatsDeltaActions(st) : [];
  const kept = (defs || []).filter((d) => !["list_chats", "search_chats", "my_chats"].includes(d?.function?.name));
  kept.push(mergedChatsDef({ delta }));
  return kept;
}
async function applyLibraryMerge(defs, learnerId, withDelta = true) {
  if (!mergedLibraryEnabled()) return defs;
  const st = withDelta ? await getLibraryToolState(learnerId).catch(() => null) : null;
  const delta = st && st.status === "active" ? libraryDeltaActions(st) : [];
  const disabled = []; // base actions are platform-owned now (My tools shows delta only); stored base toggles no longer apply
  const kept = (defs || []).filter((d) => !["search_my_library", "library_documents"].includes(d?.function?.name));
  kept.push(mergedLibraryDef({ delta, disabled }));
  return kept;
}

function openAiChatTools({ allowToolRequest = true, selfTooling = true } = {}) {
  return getLearnerChatTools({ allowToolRequest, selfTooling }).map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  }));
}

// Every tool message the model sees is a structured observation
// (utils/toolObservation.js): REASON → ACT → OBSERVE → LLM. The guide that
// keeps confirmations grounded lives in policies/TOOL_OBSERVATIONS.md
// (student) / policies/HITL_DRAFTS.md (instructor) — loaded by
// assembleChatDoctrine.

/**
 * clarify — the ONE no-guess shape every tool returns when a required input
 * was never stated by the user. The model must ask the question and wait,
 * not call the tool again with an invented value. Used across every tool
 * and workflow, both roles.
 */
/** A tool result, size-capped, for an inspected (gate/console) request. */
function inspectResult(value) {
  try {
    const text = JSON.stringify(value ?? null);
    return text.length <= 4000 ? JSON.parse(text) : { truncated: true, preview: text.slice(0, 4000) };
  } catch { return { unserializable: true }; }
}

/** Before an activity tool runs from the instructor's chat: what the teacher never said → a clarify result, else null. */
/** The learner's latest message in this turn's transcript (text parts only). */
/** The agent's last reply in the kept dialogue ("" if none). */
function lastAgentText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "assistant") continue;
    return typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter((x) => x?.type === "text").map((x) => x.text).join(" ") : "";
  }
  return "";
}

function latestUserText(transcript = []) {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m?.role !== "user") continue;
    return typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter((x) => x?.type === "text").map((x) => x.text).join(" ") : "";
  }
  return "";
}

async function unsaidActivityFields(tool, input, transcript) {
  const { unnamedFields, askFor, teacherTextOf, knownNames, currentRequest, TYPE_LABEL } = await import("./activityFields.js");
  let fields = null, check;
  if (tool === "prepare_activity") { fields = input; check = ["topic", "subject", "audience"]; }
  else if (tool === "schedule_activity_routine" && input?.brief) { fields = input.brief; check = ["topic", "subject", "audience"]; }
  else if (tool === "revise_activity_draft" && input?.audience) { fields = { audience: input.audience }; check = ["audience"]; }
  if (!fields) return null;
  // The activity asked for NOW, and only what was said since asking for it: a battle's
  // topic and class don't silently become the new assignment's (unless they say "the same").
  const req = tool === "prepare_activity" ? currentRequest(transcript) : { type: null, text: teacherTextOf(transcript), earlier: "" };
  if (req.type && input?.type && req.type !== input.type && !(req.type === "self_study" && input.type === "project")) {
    return { prepared: false, error: "wrong_type", asked: req.type,
      message: `The instructor asked for a ${TYPE_LABEL[req.type] || req.type}, not a ${TYPE_LABEL[input.type] || input.type}. Call prepare_activity with type "${req.type}" (asking first for anything they haven't said for it). Don't re-send or mention the earlier draft.` };
  }
  const missing = unnamedFields(fields, req.text, { known: await knownNames(db, fields), check });
  if (!missing.length) return null;
  // Said for an earlier activity: ask whether it's the same, rather than reuse it silently.
  const earlier = req.earlier ? unnamedFields(fields, req.earlier, { known: await knownNames(db, fields), check: missing.map((m) => m.field) }) : missing;
  const fromBefore = missing.filter((m) => !earlier.some((e) => e.field === m.field));
  const value = { topic: fields.topic, subject: fields.subject, audience: fields.audience?.classroom_name || (fields.audience?.whole_class ? "the whole class" : null) };
  const asks = missing.map((m) => (fromBefore.includes(m) && value[m.field]
    ? { ...m, question: `Same ${m.field === "audience" ? "class" : m.field} as before (${value[m.field]}), or a different one?` } : m));
  return clarify(missing.map((m) => m.field).join(","), askFor(asks), {
    prepared: false, error: "details_required", unsaid: missing.map((m) => m.field),
    message: "The instructor didn't say this. Ask them the question in `question` (in your own short words) and wait for their answer — never fill it in yourself, even when it seems obvious. Then call the tool again with what they said.",
  });
}

export function clarify(field, question, extra = {}) {
  return { needsClarification: true, missing: field, question, ...extra };
}

/** Phase 22 Part E: plan first when the request takes several steps and the agent is to act now (not ask, not stop). */
export const shouldPlanFirst = (intent) => !!(intent?.multiStep && intent.next === "proceed" && ["action", "change"].includes(intent.kind));

// Exported (below) for the benchmark (lib/evals/benchmark.js), which runs this same loop with stub tools.
// `callTool` is the one seam: production executes the real tools; the benchmark passes stubs.
// `recorder`: an agent-contract/episode.js recorder when the turn is recorded.
// `basis` (Phase 18 item 6): a turn a person's message started is explicit; a turn
// started for them (a proactive kind, a workflow) passes { basis: "inferred", rule }.
// `toolLimitMs`: one time limit for every call (tests, the benchmark); else each tool's own (toolLimits.js).
async function runAgentToolLoop({ systemContent, messages, studentId, conversationId = null, turnId = null, status, tools = openAiChatTools(), requiredTool = null, role = "student", trace = null, isAborted = () => false, think = false, streamText = true, model = null, teacherWords = null, ledger = null, callTool = null, recorder = null, meta = null, basis = "explicit", toolLimitMs = null, planFirst = false, tailContent = null }) {
  const turnBasis = actionBasis(basis, { basis: "explicit" });
  const runTool = callTool || ((name, input) => executeChatTool(name, input, studentId, { conversationId, role, basis: turnBasis }));
  // The loop guard (loopGuard.js): the same call again in a row gets a reminder in its observation.
  const guard = createLoopGuard();
  // The task ledger (taskLedger.js): the agent keeps its goal and steps with update_plan; offered every turn.
  let ledgerNow = ledger;
  if (!tools.some((t) => t.function?.name === UPDATE_PLAN_TOOL.name)) {
    tools = [...tools, { type: "function", function: { name: UPDATE_PLAN_TOOL.name, description: UPDATE_PLAN_TOOL.description, parameters: UPDATE_PLAN_TOOL.input_schema } }];
  }
  const executions = [];
  const transcript = [...messages];
  if (requiredTool && !tools.some((tool) => tool.function?.name === requiredTool)) {
    throw new Error("The required Agent Chat tool is unavailable");
  }
  // The unified endpoint serves instructor/school tutoring too, but learner
  // account tools are never authorised for those roles.
  if (!tools.length) return { messages: transcript, toolExecutions: executions, ledger: ledgerNow };
  // Phase 22: the durable execution trace. One run per turn; a step per tool
  // call below. Best-effort — startRun never throws, so logging can't break a turn.
  const runId = await startRun({ sessionId: conversationId, userId: studentId, model, turnId });
  // Think mode decides every step on the reasoning model; if that model is
  // unavailable the rest of the turn decides on the standard model.
  let reasonDecisions = think;
  // After a Library search, a reader tool or the past papers, the agent says what it found
  // before its next step (2026-10-19); if it goes straight on to a tool, this line is said.
  let owedLine = null;
  // One continuation per turn for a step narration that lost its tool call.
  let narrationContinuationUsed = false;
  for (let iteration = 0; iteration < CHAT_TOOL_LOOP_MAX_ITERATIONS; iteration += 1) {
    // Stop pressed between steps: end here, before spending another call.
    if (isAborted()) return { messages: transcript, toolExecutions: executions, ledger: ledgerNow, aborted: true };
    // Each decision is a "Thought for Ns" row; its text is harness narration
    // of what the agent chose (D10), never model reasoning.
    // In Think mode the row carries the model's real reasoning summary.
    const thinkId = trace?.thinkStart();
    // This force is limited to capability questions: it guarantees the
    // response is based on the live Akoro inventory, but does not choose an
    // endpoint, shape learner-facing prose, or invent a feature.
    // Phase 22 Part E: a multi-step request the agent is to act on starts by writing its plan
    // (update_plan with steps and done_when) — enforced on the first step, not left to a prompt hint.
    const planStep = iteration === 0 && !requiredTool && planFirst && !(Array.isArray(ledgerNow?.plan) && ledgerNow.plan.some((st) => st && !["done", "completed"].includes(st.status)));
    // Final iteration (2026-11-17): a streamed, non-think turn still calling
    // tools on its last step answers with what it has — tool_choice "none"
    // makes this decision the reply, so the handler never pays for a
    // separate full-context answer call after the loop. (Think and Research
    // turns keep their designed answer passes; a forced tool or plan step
    // only ever occupies iteration 0, so they never collide with this.)
    const lastChance = iteration === CHAT_TOOL_LOOP_MAX_ITERATIONS - 1 && streamText && !think && !requiredTool && !planStep;
    const toolChoice = iteration === 0 && requiredTool
      ? { type: "function", function: { name: requiredTool } }
      : planStep ? { type: "function", function: { name: UPDATE_PLAN_TOOL.name } } : lastChance ? "none" : "auto";
    // Words the model writes stream live as an activity block. The step's
    // thinking row closes when they start (they narrate the step themselves).
    // Research mode buffers instead: its answer is regenerated on the
    // research model, so live text would show twice.
    let thinkOpen = Boolean(thinkId);
    const closeThink = (text) => { if (thinkOpen) { trace.thinkEnd(thinkId, text); thinkOpen = false; } };
    let liveId = null;
    const onText = streamText && trace
      ? (text) => { closeThink(""); if (!liveId) liveId = trace.activityStart(); trace.activityDelta(liveId, text); }
      : null;
    const stoppedHere = (assistantSoFar) => {
      closeThink("");
      if (liveId) trace.activityEnd(liveId, assistantSoFar?.content || "");
      return { messages: transcript, toolExecutions: executions, ledger: ledgerNow, aborted: true };
    };
    let assistant = null;
    let reasoned = false;
    if (reasonDecisions) {
      try {
        const decision = await thinkDecision({
          systemContent, transcript, tailContent, tools, toolChoice, isAborted, onText,
          onReasoning: (text) => { if (thinkOpen) trace.thinkDelta(thinkId, text); },
        });
        if (decision.aborted) return stoppedHere(decision.assistant);
        assistant = decision.assistant;
        reasoned = true;
      } catch (error) {
        console.warn("[agent-chat] think decision unavailable — standard model for the rest of this turn:", error?.message || error);
        reasonDecisions = false;
        // Any words already shown came from the failed call; the retry rewrites them.
        if (liveId) { trace.activityDrop(liveId); liveId = null; }
      }
    }
    if (!assistant) {
      const decision = await streamDecision({
        // Cache layout (2026-11-17): the volatile tail rides AFTER the
        // transcript, so the static system + history stay a stable prefix.
        messages: [{ role: "system", content: systemContent }, ...transcript, ...(tailContent ? [{ role: "system", content: tailContent }] : [])],
        tools, toolChoice, onText, isAborted, model, meta,
      });
      if (decision.aborted) return stoppedHere(decision.assistant);
      assistant = decision.assistant;
    }
    const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    closeThink(decisionNarration(calls));
    if (recorder && calls.length) {
      recorder.decision({ tool_calls: calls.map((c) => { let args = {}; try { args = JSON.parse(c?.function?.arguments || "{}"); } catch { args = {}; } return { name: c?.function?.name, arguments: args }; }),
        intent: typeof assistant.content === "string" ? assistant.content.trim().slice(0, 300) : null });
    }
    const content = typeof assistant.content === "string" ? assistant.content.trim() : "";
    if (!calls.length) {
      // A step narration that lost its tool call is not an answer
      // (2026-11-17): the model sometimes sends the one-sentence step line
      // alone, and accepting it would end the turn on a promise, recorded
      // as a success. When the turn still owes work — its own plan has
      // open steps, or nothing has run yet and the text only announces a
      // step — keep the line as the activity block it is, steer once, and
      // let the model actually take the step. A second text-only reply is
      // accepted unconditionally, so a genuine answer costs at most one
      // extra decision. Kill switch: AKORO_NARRATION_CONTINUATION=false.
      const owesWork = planHasOpenSteps(ledgerNow) || (executions.length === 0 && (looksLikeStepNarration(content) || containsDeferral(content) || admitsNonCompletion(content)));
      if (!narrationContinuationUsed && streamText && !think && !lastChance
        && iteration <= CHAT_TOOL_LOOP_MAX_ITERATIONS - 3
        && process.env.AKORO_NARRATION_CONTINUATION !== "false" && owesWork) {
        narrationContinuationUsed = true;
        if (liveId) trace.activityEnd(liveId, content);
        else if (content) trace?.activity(content);
        transcript.push(assistant);
        transcript.push({ role: "system", content: "Loop note (not from the learner): your last reply called no tool — it described a step, deferred it, or said the work wasn't done — and a reply with no tool call ends the turn with the work NOT done. If the learner's request needs a tool, call it now, with its one-sentence narration in the same reply. If you genuinely cannot do it, name the concrete blocker plainly. If you have genuinely finished, give the complete final answer instead; do not repeat the same reply." });
        continue;
      }
      // A decision that calls no tool IS the answer: what already streamed
      // becomes the reply (promoted out of the trace), so no second model
      // call is paid for. Research mode still regenerates on its own model.
      const finalText = (reasoned || streamText) ? content : "";
      if (liveId) {
        if (finalText) trace.activityPromote(liveId);
        else trace.activityDrop(liveId);
      }
      // Phase 22: this is the common completion path (the model's final answer,
      // no more tool calls) — close the run here too, not only at the max-iteration exit.
      await finishRun(runId, { status: "ok" });
      return { messages: transcript, toolExecutions: executions, ledger: ledgerNow, ...(finalText ? { finalText, promoted: Boolean(liveId) } : {}) };
    }
    // Text written alongside tool calls stays between the steps.
    if (liveId) trace.activityEnd(liveId, content);
    else if (content) trace?.activity(content);
    else if (owedLine) trace?.activity(owedLine);
    owedLine = null;
    transcript.push(assistant);
    // ── Executing the decision's calls (parallel reads, 2026-11-17).
    // Independent READ calls in one decision run together; everything else —
    // and every call when AKORO_PARALLEL_READS=false — runs one at a time, in
    // the order the model gave, exactly as before. Either way the outcomes are
    // APPLIED in the model's order (trace, observations, executions,
    // transcript), so the rest of the turn cannot tell the difference.
    // prepareCall does the pure per-call work (parse, the two input massages,
    // the basis check); runPrepared executes one call; applyPrepared records
    // its outcome, in order.
    const prepareCall = (call) => {
      const tool = call?.function?.name;
      let input = {};
      try { input = JSON.parse(call?.function?.arguments || "{}"); } catch { input = {}; }
      // A follow-up on a draft's questions goes to the paper writer in the
      // teacher's own words: the model rewrote "Remove question 3" as the
      // whole question list, and the revision changed other questions too.
      if (tool === "revise_activity_draft" && teacherWords && input?.question_request) input = { ...input, question_request: teacherWords };
      // A permission card only after the learner said yes to building it (their latest message, never the model's say-so).
      if (tool === "create_tool" && input && typeof input === "object") {
        const { __agreed, ...rest } = input;
        input = role === "student" && agreesToBuild(latestUserText(transcript)) ? { ...rest, __agreed: true } : rest;
      }
      const changes = isSideEffecting(tool, input);
      // Asked or inferred (actionBasis.js): an inferred change with no rule allowing it is refused, not run.
      const refused = changes ? basisRefusal(turnBasis, { action: tool }) : null;
      return { call, tool, input, changes, refused };
    };
    const runPrepared = async (p) => {
      const { tool, input, changes, refused } = p;
      const callStarted = Date.now();
      status?.("tool", "Checking your Akoro study data…");
      // The header stream too - the same labels the background workers send,
      // so the agent's subtitle shows live work during active chats as well.
      agentToolActivity(studentId, tool);
      const traceRow = trace?.toolStart(tool, input);
      let toolResult;
      // The important fields come from the TEACHER (activityFields.js): a subject, an audience or a
      // topic they never said is asked for, not filled in — nothing is prepared until they answer.
      const unsaid = role === "instructor" ? await unsaidActivityFields(tool, input, transcript).catch(() => null) : null;
      // Each call within its time limit (toolLimits.js): past it, a `timeout` observation, never a stalled turn.
      const timed = () => runWithinLimit(() => runTool(tool, input), tool, { sideEffecting: changes, limitMs: toolLimitMs });
      if (tool === UPDATE_PLAN_TOOL.name) {
        // The ledger: checked here (a step is done only when a successful call this turn backs it), saved after the turn.
        const applied = applyPlanUpdate(ledgerNow, input, executions);
        ledgerNow = applied.ledger;
        toolResult = applied.result;
      } else if (unsaid) toolResult = unsaid;
      else if (refused) toolResult = { success: false, code: refused.code, error: refused.message };
      else try {
        toolResult = await timed();
        // Recovery (toolRecovery.js): a temporary failure (a time-out included) is tried once more before the agent sees it.
        if (shouldRetry(tool, toolResult, { sideEffecting: changes })) {
          console.log(`[agent-chat] tool ${tool} failed temporarily — retrying once`);
          const again = await timed().catch(() => null);
          if (again != null) toolResult = toolFailed(again) ? { ...(typeof again === "object" ? again : {}), retried: true } : again;
        }
      }
      catch (error) {
        // The observation stays generic (internal detail never reaches the
        // learner), but the log carries the real cause — the 2026-10-01
        // study-prep outage was invisible here while every call failed with
        // "relation study_prep_sessions does not exist".
        console.warn(`[agent-chat] tool ${tool} error:`, error?.message || error);
        toolResult = { success: false, error: "The requested Akoro action could not be completed." };
      }
      return { p, toolResult, traceRow, durationMs: Date.now() - callStarted };
    };
    const applyPrepared = async ({ p, toolResult, traceRow, durationMs }) => {
      const { call, tool, input, changes } = p;
      const who = role === "instructor" ? "the instructor" : "the learner";
      if (traceRow) trace.toolEnd(traceRow, toolResult);
      if (TALK_AFTER_TOOLS.includes(tool)) {
        owedLine = talkAfterTool(tool, input, toolResult);
        if (toolResult && typeof toolResult === "object" && !Array.isArray(toolResult) && !toolFailed(toolResult)) {
          toolResult = { ...toolResult, sayFirst: `Before your next step, tell ${who} in one short sentence what this found.` };
        }
      }
      // Step narration (Matt, 2026-11-17): after EVERY step, not just the
      // Library/past-paper pair above, the agent tells the user in its own
      // words what the step did or found before going on — the line streams
      // as an activity block between the steps, so the user is never left
      // watching silent tool rows until one final wall of text. A FAILED
      // step is narrated too (extended 2026-11-17 late): one short line
      // saying it didn't work and what happens next, alongside the recovery
      // steer below — never a silent retry the user can't follow.
      if (process.env.AKORO_STEP_NARRATION !== "false"
        && toolResult && typeof toolResult === "object" && !Array.isArray(toolResult)
        && !toolResult.sayFirst) {
        toolResult = toolFailed(toolResult)
          ? { ...toolResult, sayFirst: `Before your next step, tell ${who} in one short sentence that this step didn't work and what you're doing about it, in your own words — no internal details.` }
          : { ...toolResult, sayFirst: `Before your next step, tell ${who} in one short sentence what this step did or found, in your own words.` };
      }
      // Structured observation: the tool's real backend outcome becomes the
      // model's next input, so the reply confirms facts, not intent.
      // create_tool built a tool: offer it for the rest of this turn.
      if (toolResult && typeof toolResult === "object" && toolResult.__newTool) {
        const def = toolResult.__newTool;
        delete toolResult.__newTool;
        if (!tools.some((t) => t.function?.name === def.function.name)) tools.push(def);
      }
      // get_agent_capabilities loaded an area: offer its tools for the rest of this turn.
      if (toolResult && typeof toolResult === "object" && Array.isArray(toolResult.__addTools)) {
        const adds = toolResult.__addTools;
        delete toolResult.__addTools;
        for (const def of adds) {
          if (def?.function?.name && !tools.some((t) => t.function?.name === def.function.name)) tools.push(def);
        }
      }
      // A failure says what to do next: the documented alternative for the job, else tell the learner plainly.
      if (tool !== UPDATE_PLAN_TOOL.name && toolFailed(toolResult) && toolResult && typeof toolResult === "object" && !Array.isArray(toolResult)) {
        const hint = recoveryHint(tool, toolResult, { retried: toolResult.retried === true, offered: tools.map((t) => t.function?.name) });
        if (hint) toolResult = { ...toolResult, recovery: hint.next };
      }
      // The same tool with the same arguments again in a row: a reminder rides on this observation (the ledger is bookkeeping, not counted).
      const repeat = tool === UPDATE_PLAN_TOOL.name ? null : guard.note(tool, input);
      if (repeat) console.log(`[agent-chat] tool ${tool} repeated ${repeat.count}× in a row — ${repeat.level} added`);
      const observation = toolObservation({ action: tool, result: toolResult, requestId: newToolRequestId(), extra: repeat ? { reminder: repeat.text } : null });
      recorder?.observation(observation);
      // Every tool call is logged: with nothing here, "the agent ignores my
      // data" is undiagnosable from server logs — zero lines means the model
      // never called a tool; a failed line points at the tool's backend.
      console.log(`[agent-chat] tool ${tool} → ${observation.success ? "ok" : "FAILED"} (request ${observation.request_id})`);
      const failNote = observation.success ? null
        : (String(toolResult?.error || toolResult?.message || "").trim().slice(0, 160) || null);
      executions.push({
        tool,
        success: observation.success,
        requestId: observation.request_id,
        // The real failure reason, so the end-of-turn correction can quote the
        // API response instead of a generic "nothing was saved".
        ...(failNote ? { error: failNote } : {}),
        sideEffecting: SIDE_EFFECT_TOOLS.includes(tool)
          || isSideEffectingAction(tool, input),
        // Asked or inferred, on every change (Phase 18 item 6) — shown in developer mode.
        ...(changes ? { basis: turnBasis.basis, rule: turnBasis.rule } : {}),
        ...(repeat ? { repeated: repeat.count } : {}),
        // Did this turn really put a request in front of an admin? (requestClaims.js checks the reply against it.)
        ...(tool === "submit_tool_request" || tool === "create_tool" ? { adminRequest: adminRequestOf(tool, toolResult) } : {}),
        ...(isInspected() ? { input, result: inspectResult(toolResult) } : {}),
        // A small echo so the chat UI can render the Preview affordance for
        // the human-in-the-loop approval without parsing the model's prose.
        // The protégé's two moves ride the reply so the app can show them:
        // a Teach me button, and the teaching guide's mark on the answer.
        ...(tool === "ask_to_be_taught" && toolResult?.asked ? { teach: { topic: toolResult.topic, subject: toolResult.subject } } : {}),
        // A tool that would change data (S6): the confirmation card — only the learner's tap runs it.
        // Only a card still WAITING for its tap rides the reply: a decided
        // card (an await_decision outcome) is never written into the chat —
        // the agent's narration is the outcome (Matt, 2026-11-17).
        ...(toolResult?.confirmation?.confirmationId && !DECIDED_CONFIRM_STATUSES.includes(toolResult.confirmation.status) ? { confirm: toolResult.confirmation }
          : toolResult?.result?.confirmation?.confirmationId && !DECIDED_CONFIRM_STATUSES.includes(toolResult.result.confirmation.status) ? { confirm: toolResult.result.confirmation } : {}),
        // await_decision APPLIED a card this turn — its result also carries
        // the decided card as `confirmation`, which on its own would read to
        // the end-of-turn check as "only a card was made" and append a false
        // "nothing has changed yet" note under a truthful outcome report.
        ...(tool === "await_decision" && toolResult?.executed ? { appliedDecision: true } : {}),
        // Materials the tool returned (courses, blog posts, Library documents, weak topics)
        // ride as clickable links — built from ids/slugs, never from the model's prose.
        ...(() => { const mats = collectMaterials([materialsFrom(tool, toolResult)]); return mats.length ? { materials: mats } : {}; })(),
        // Agent search results ride as cards the app can show (Challenge / Message buttons).
        ...((tool === "search_agents" || tool === "find_competitors") && Array.isArray(toolResult?.agents) ? { agents: toolResult.agents.slice(0, 6) } : {}),
        // `requestsMine`: the learner's OWN requests get Cancel, not Accept.
        ...(tool === "search_challenge_requests" && Array.isArray(toolResult?.requests) ? { requests: toolResult.requests.slice(0, 6), requestsMine: !!input?.mine } : {}),
        ...(tool === "consult_teaching_guide" && toolResult?.consulted ? { guide: { name: toolResult.guide, ...(toolResult.teach ? { teach: toolResult.teach } : {}) } } : {}),
        ...(((tool === "prepare_activity" || tool === "run_teaching_tool") && toolResult?.prepared
            || tool === "revise_activity_draft" && toolResult?.revised)
          && toolResult?.draftId
          ? { draft: { id: toolResult.draftId, title: toolResult.title, type: toolResult.type, audience: toolResult.audience, ...(toolResult.version ? { version: toolResult.version } : {}) } }
          : {}),
        // Study-prep sessions ride the same way: a session echo lets the chat
        // tab render the interactive session card (plan card, human gates)
        // without parsing the model's prose. Plan-only — the card's buttons
        // hit the harness REST endpoints, never the model.
        // Only a session with a plan to show and still going — not a plan-less
        // "planning" leftover or a finished one (the card would load nothing).
        ...(() => {
          const live = (x) => x && Array.isArray(x.plan) && x.plan.length > 0 && !["completed", "abandoned", "cancelled", "ended", "failed"].includes(x.status);
          // A session being planned in the background shows its card at once: it streams the planning.
          if (tool === "start_study_prep_session" && toolResult?.sessionId && (live(toolResult) || toolResult.planning)) return { session: { id: toolResult.sessionId } };
          if (tool === "get_study_prep_session") { const s0 = (toolResult?.sessions || []).find(live); if (s0) return { session: { id: s0.sessionId } }; }
          return {};
        })(),
      });
      // A card the learner must act on goes out NOW, not with "done": it used to
      // appear only after the whole reply had been written (2026-11-06).
      if (executions.at(-1)?.confirm) trace?.card?.({ tool, confirm: executions.at(-1).confirm });
      // A result can carry a FOLLOW-UP proposal as `next`: since the
      // build/permission approval now applies the change it listed, `next`
      // normally arrives already decided and is NOT shown — the agent
      // narrates it. A still-pending one (a path that could not apply it)
      // is shown, or the agent would wait on a card nobody can tap.
      if (toolResult?.next?.confirmationId && !DECIDED_CONFIRM_STATUSES.includes(toolResult.next.status)) trace?.card?.({ tool, confirm: toolResult.next });
      // Phase 22: persist this step (redacted, capped) so the full path — tool,
      // real error class/message, duration, retry — survives the turn.
      await recordStep(runId, stepRow({ runId, iteration, tool, input, success: observation.success,
        result: toolResult, durationMs, retries: toolResult?.retried ? 1 : 0, requestId: observation.request_id,
        sideEffecting: changes }));
      transcript.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(observation) });
    };
    const preparedCalls = calls.map(prepareCall);
    const parallelReadsOn = process.env.AKORO_PARALLEL_READS !== "false";
    const isParallelRead = (p) => parallelReadsOn && !p.changes && !PARALLEL_CALL_BARRIERS.has(p.tool) && BUILTIN_TOOL_NAMES.has(p.tool);
    let callIndex = 0;
    while (callIndex < preparedCalls.length) {
      if (isAborted()) return { messages: transcript, toolExecutions: executions, ledger: ledgerNow, aborted: true };
      let runEnd = callIndex;
      while (runEnd < preparedCalls.length && runEnd - callIndex < PARALLEL_READ_BATCH && isParallelRead(preparedCalls[runEnd])) runEnd += 1;
      if (runEnd - callIndex >= 2) {
        const ranBatch = await Promise.all(preparedCalls.slice(callIndex, runEnd).map((p) => runPrepared(p)));
        for (const ran of ranBatch) {
          if (isAborted()) return { messages: transcript, toolExecutions: executions, ledger: ledgerNow, aborted: true };
          await applyPrepared(ran);
        }
        callIndex = runEnd;
      } else {
        await applyPrepared(await runPrepared(preparedCalls[callIndex]));
        callIndex += 1;
      }
    }
  }
  // Phase 22: close the run. An aborted/excepted turn never reaches here, so it
  // stays 'running' and the stale sweep marks it 'incomplete' (a visible crash).
  await finishRun(runId, { status: "ok" });
  return { messages: transcript, toolExecutions: executions, ledger: ledgerNow };
}

// Exported for the Think-mode loop test (think-loop.contract.test.mjs).
export { runAgentToolLoop };

// ■ Stop for a running Agent Chat turn — owner-scoped by the token identity.
router.post("/agent/stop", (req, res) => {
  const turnId = String(req.body?.turnId ?? "");
  if (!CHAT_TURN_ID.test(turnId)) return res.status(422).json({ error: "turnId is invalid" });
  const entry = activeTurnStops.get(turnStopKey(req.user.id, turnId));
  if (entry) entry.stop = true;
  return res.json({ success: true, stopping: Boolean(entry) });
});

// The one learner Agent Chat response authority. It owns direct tutoring,
// attachments/grounding/modes and the authorised tool loop; the browser never
// selects a response endpoint based on its own intent detection.
/**
 * GET /api/adaptive/chat/models — the model behind each chat mode, for the
 * Agent Chat's model switch. Read-only: the app still sends a MODE
 * ("default" | "think" | "research"), never a model id, so a browser can't
 * ask for a model this deployment doesn't route. Names come from this
 * server's own configuration (OPENAI_MODEL / _THINK_ / _RESEARCH_).
 */
// Modes run on the learner's chosen model now; no model is advertised per
// mode. `model` is kept null for older clients that still render it.
export const chatModelMenu = () => ([
  { id: "default",  model: null, kind: "Default",  description: "Quick, grounded answers for everyday study." },
  { id: "think",    model: null, kind: "Thinking", description: "Reasons step by step before answering — best for hard problems." },
  { id: "research", model: null, kind: "Research", description: "A deeper pass with more syllabus and past-question references." },
]);
router.get("/models", async (req, res) => {
  res.set("Cache-Control", "private, max-age=300");
  // modes: the chat's modes and their models; models: the catalogue a
  // learner may pick for the standard mode (Grand Plan §7.11) — each says
  // whether this server can use it, or why not ("coming soon"), and its cost
  // against the default; picker: whether the §7.11.5 picker is on here and,
  // when it is, the payer's tier (§7.11.5a) — a model outside its list is
  // listed as locked to a plan.
  const tier = pickerEnabled() && req.user?.id ? await allowedModelsFor(req.user.id).catch(() => null) : null;
  // saved: the learner's latest pick on any of their chats (Scenario K) — the
  // app opens on it on every device, so it is never cached when there is one.
  const saved = pickerEnabled() && req.user?.id ? await savedPickFor(req.user.id) : null;
  if (saved) res.set("Cache-Control", "private, no-cache");
  res.json({
    modes: chatModelMenu(),
    models: publicModelList(process.env, { allowedModels: tier?.allowedModels ?? null }),
    picker: { ...pickerInfo(), ...(tier ? { tier: tier.tier?.name || null, tierSource: tier.source, allowedModels: tier.allowedModels } : {}), ...(saved ? { saved } : {}) },
  });
});

/** The learner's latest saved pick → { modelId, label, conversationId, changedAt } | null. Never throws. */
async function savedPickFor(learnerId) {
  try {
    const pick = await (await modelPicks()).learnerPick(learnerId);
    return pick?.changedAt ? { modelId: pick.modelId ?? null, label: pick.label || null, conversationId: pick.conversationId || null, changedAt: pick.changedAt } : null;
  } catch { return null; }
}

// GET /sessions/:id/model — the pick saved on this chat ({} when never set).
router.get("/sessions/:id/model", async (req, res) => {
  try {
    if (!CHAT_SESSION_ID.test(String(req.params.id))) return res.status(422).json({ error: "id is invalid" });
    const thread = await supabaseThreads(db).get(req.params.id, req.user.id);
    if (!thread) return res.status(404).json({ error: "Session not found" });
    res.set("Cache-Control", "no-store");
    res.json({ success: true, modelSelection: thread.selection || {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /sessions/:id/model { modelId } — save the chat's pick (null = the
// default). It applies from the next message and also reaches the learner's
// open Study Prep / Teaching workflows (a model.changed event on each).
router.put("/sessions/:id/model", async (req, res) => {
  try {
    if (!CHAT_SESSION_ID.test(String(req.params.id))) return res.status(422).json({ error: "id is invalid" });
    if (!pickerEnabled()) return res.status(409).json({ code: "picker_off", error: "Model choice is off on this server" });
    const result = await (await modelPicks()).saveThreadPick({ learnerId: req.user.id, conversationId: req.params.id, modelId: req.body?.modelId ?? null });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err?.code && err.status) return res.status(err.status).json({ code: err.code, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/adaptive/chat/suggestions — three short follow-ups for the
 * reply the user just got (chips under it). Called by the app AFTER the
 * reply arrives, so the reply never waits; any failure returns none.
 * Body: { ask, reply, role?, context? }
 */
/**
 * The chips under a reply survive a refresh: saved on the reply's meta (meta.ideas,
 * which a reopened chat reads). Only the learner's own latest agent message in
 * that chat, and only when it is the reply the chips were made for. Never throws.
 */
export async function saveReplyIdeas({ userId, conversationId, reply, ideas }) {
  try {
    if (!userId || !/^[0-9a-f-]{36}$/i.test(String(conversationId || "")) || !Array.isArray(ideas) || !ideas.length) return false;
    const { data: last } = await db.from("chat_messages").select("id, text").eq("session_id", conversationId).eq("user_id", userId)
      .eq("role", "agent").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
    if (!last || norm(last.text) !== norm(reply)) return false;
    await mergeChatMeta(last.id, { ideas: ideas.slice(0, 3) });
    return true;
  } catch { return false; }
}

/**
 * The three follow-up chips for a reply. Shared by POST /suggestions and the
 * Agent Chat stream, which now sends them as a "suggestions" event right after
 * "done" — no second round trip from the app (2026-11-06). Never throws.
 */
export async function suggestionsFor({ user, body }) {
  const reply = String(body?.reply || "").trim();
  if (!reply) return [];
  // The teacher's ideas only for a non-learner account that asks for them.
  const role = body?.role === "instructor" && user?.role !== "student" ? "instructor" : "student";
  const tools = Array.isArray(body?.tools) ? body.tools.slice(0, 12) : [];
  const notTaught = role === "student" ? notTaughtFrom({ reply, tools }) : null;
  const uploads = role === "student" ? uploadsFrom(body?.attachments) : [];
  // Fixed chips first: the guide when it wasn't taught, the study step after an upload.
  const fixed = [guideChip(notTaught), uploadChip(uploads)].filter(Boolean);
  const isFixed = (x) => /teaching guide/i.test(x) || fixed.some((f) => f.toLowerCase() === String(x).toLowerCase());
  try {
    const capabilities = [];
    if (role === "student") {
      // Both lookups at once (they used to run one after the other before the model call).
      const [card, own] = await Promise.all([
        executeChatTool("get_agent_capabilities", {}, user.id, { role: "student" }).catch(() => null),
        learnerToolDefs(user.id).catch(() => []),
      ]);
      for (const sec of card?.sections || []) if (sec.title !== "Limits") capabilities.push(...(sec.items || []));
      for (const t of own) {
        const d = t?.function?.description || t?.function?.name;
        if (d) capabilities.push(`Your own tool: ${String(d).slice(0, 120)}`);
      }
    }
    const completion = await openai.chat.completions.create({
      __role: "suggestions", temperature: 0.5, max_tokens: 160,
      __timeoutMs: 12_000, __maxRetries: 0,
      response_format: { type: "json_object" },
      messages: buildSuggestionMessages({ role, ask: body?.ask, reply, context: body?.context, capabilities, notTaught, uploads }),
      __userId: user?.id, __feature: "chat_suggestions",
    });
    const ideas = shapeSuggestions(completion.choices?.[0]?.message?.content);
    const suggestions = fixed.length ? [...fixed, ...ideas.filter((x) => !isFixed(x))].slice(0, 3) : ideas;
    void saveReplyIdeas({ userId: user?.id, conversationId: body?.conversationId, reply, ideas: suggestions });
    return suggestions;
  } catch (e) {
    console.warn("[chat/suggestions] none this time:", String(e?.message || e).slice(0, 120));
    if (fixed.length) void saveReplyIdeas({ userId: user?.id, conversationId: body?.conversationId, reply, ideas: fixed });
    return fixed;
  }
}

router.post("/suggestions", async (req, res) => {
  res.json({ success: true, suggestions: await suggestionsFor({ user: req.user, body: req.body }) });
});

/**
 * POST /api/adaptive/chat/learn-suggestions — the guide chat's "Learn
 * suggestions", grounded in the session's material (or its topic).
 * Body: { topic, subject?, title?, excerpt?, subtopics? }. The app shows its
 * own material-derived suggestions at once; these replace them when they
 * arrive. Any failure returns none.
 */
router.post("/learn-suggestions", async (req, res) => {
  const b = req.body || {};
  if (!String(b.topic || b.title || b.excerpt || "").trim()) return res.json({ success: true, suggestions: [] });
  // The open document: suggestions built from its passages, each pointing at its page.
  const doc = b.document && typeof b.document === "object" ? b.document : null;
  if (doc && (doc.recordId || doc.contentKey)) {
    try {
      const target = await resolveAskTargetFor({ userId: req.user.id, recordId: doc.recordId, contentKey: doc.contentKey });
      if (target && !target.status) {
        const { passages } = await gatherPassages({ target, question: `${b.title || ""} ${b.topic || ""} key ideas summary`.slice(0, 400), search: searchRecordChunks });
        if (passages?.length) {
          const completion = await openai.chat.completions.create({
            __role: "suggestions", temperature: 0.4, max_tokens: 320,
            __timeoutMs: 15_000, __maxRetries: 0,
            response_format: citedLearnSchema(),
            messages: buildCitedLearnSuggestionMessages({ topic: b.topic, subject: b.subject, title: b.title, passages }),
            __userId: req.user?.id, __feature: "learn_suggestions",
          });
          const toCitation = (n) => extractCitations(`[${n}]`, passages).citations[0] || null;
          const cited = shapeCitedLearnSuggestions(completion.choices?.[0]?.message?.content, { toCitation });
          if (cited.length) return res.json({ success: true, suggestions: cited.map((x) => x.text), cited });
        }
      }
    } catch (e) {
      console.warn("[chat/learn-suggestions] cited suggestions failed, plain ones instead:", String(e?.message || e).slice(0, 120));
    }
  }
  try {
    const completion = await openai.chat.completions.create({
      __role: "suggestions", temperature: 0.4, max_tokens: 220,
      __timeoutMs: 12_000, __maxRetries: 0,
      response_format: { type: "json_object" },
      messages: buildLearnSuggestionMessages({ topic: b.topic, subject: b.subject, title: b.title, excerpt: b.excerpt, subtopics: b.subtopics }),
      __userId: req.user?.id, __feature: "learn_suggestions",
    });
    res.json({ success: true, suggestions: shapeSuggestions(completion.choices?.[0]?.message?.content, { count: LEARN_LIMITS.count, chars: LEARN_LIMITS.chars }) });
  } catch (e) {
    console.warn("[chat/learn-suggestions] none this time:", String(e?.message || e).slice(0, 120));
    res.json({ success: true, suggestions: [] });
  }
});

async function agentChatHandler(req, res) {
  const t0 = Date.now();
  const wantsStream = req.query.stream === "1" || req.query.stream === "true"
    || (req.headers.accept || "").includes("text/event-stream");
  let headersSent = false;
  // Heartbeat: a long tool loop (blog research, multi-turn tool calls) can run
  // silent for minutes. Cloudflare's proxy drops connections idle ~100s, the
  // client then falls back to a NON-STREAMING retry — and the whole agent
  // loop, every prompt and tool call, is billed to the outbound budget a
  // second time. A 20s comment frame costs nothing and keeps the pipe open.
  // SSE comments (": ping") are ignored by every EventSource parser — and by
  // this API's own client, which skips blocks without a data line.
  let heartbeat = null;
  let turnCtx = null;          // conversation/turn/message, for the error path
  let sessionTrackId = null;   // this turn's chat, for the tap-continuation recheck
  let streamedAnswer = "";     // deltas of the final answer, for a partial save
  const stopHeartbeat = () => { if (heartbeat) { clearInterval(heartbeat); heartbeat = null; } };
  res.on("close", stopHeartbeat);
  const beginStream = () => {
    if (headersSent) return;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    headersSent = true;
    heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n");
    }, 20_000);
    heartbeat.unref?.();
  };
  // Every live event also carries the v3 envelope (§7.9.7) under `envelope`;
  // the event names and fields stay exactly as they were.
  const turnId = `turn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let liveSequence = 0;
  // Timings (realtime work, 2026-11-07): each preparation step and the first thing the
  // learner sees, returned in metadata.timings and logged once per turn.
  const timings = {};
  let lastMark = t0;
  const mark = (name) => { const now = Date.now(); timings[name] = (timings[name] || 0) + (now - lastMark); lastMark = now; };
  // One lookup's own time (they overlap; the slowest is what the turn waits for).
  const timed = (name, promise) => { const s0 = Date.now(); return Promise.resolve(promise).finally(() => { (timings.parts ||= {})[name] = Date.now() - s0; }); };
  const send = (event, data) => {
    if (event === "delta" && data?.text) streamedAnswer += data.text;
    if (timings.firstVisibleMs == null && event !== "status") timings.firstVisibleMs = Date.now() - t0;
    if (res.destroyed || res.writableEnded) return;
    const envelope = data && typeof data === "object" ? chatEnvelope(event, data, { turnId, sequence: liveSequence++ }) : null;
    res.write(`event: ${event}\ndata: ${JSON.stringify(envelope ? { ...data, envelope } : data)}\n\n`);
  };
  const status = (step, label) => send("status", { step, label });
  // Stop (■): set by POST /agent/stop for this learner's turn; checked
  // between tool-loop steps and while the answer streams.
  let stopEntry = null;
  const isAborted = () => Boolean(stopEntry?.stop);
  // Developer view (opt-in from the app): raw tool I/O on the live stream only.
  const trace = createChatTrace({ send: wantsStream ? send : null, developer: req.body?.developer === true });
  // A tap continuation resumes the SAME flow (scheduleDecisionContinuation):
  // its body text is an internal event cue for the model only — no user
  // message is saved for it, so the chat gains only the agent's outcome
  // narration under the card (Matt, 2026-11-17).
  const isContinuation = req.internalContinuation === true;

  try {
    const {
      message, history = [], agentName, mode: rawMode, attachments: rawAttachments,
      conversationId: rawConversationId, turnId: rawTurnId,
    } = req.body || {};
    const userMessage = typeof message === "string" ? message.trim() : "";
    if (!userMessage) return res.status(400).json({ error: "message is required" });
    if (userMessage.length > 12_000) return res.status(400).json({ error: "message is too long" });
    if (Array.isArray(rawAttachments) && rawAttachments.length > MAX_FILES) {
      return res.status(400).json({ error: `Too many attachments (max ${MAX_FILES}).` });
    }
    const conversationId = rawConversationId == null ? null : String(rawConversationId);
    turnCtx = { conversationId, turnId: rawTurnId == null ? null : String(rawTurnId), userMessage };
    if (conversationId && !CHAT_SESSION_ID.test(conversationId)) {
      return res.status(422).json({ error: "conversationId is invalid" });
    }
    const turnId = rawTurnId == null ? null : String(rawTurnId);
    if (conversationId && durableAgentChatContextEnabled && !CHAT_TURN_ID.test(turnId || "")) {
      return res.status(422).json({ error: "turnId is required for durable Agent Chat" });
    }
    if (turnId && !CHAT_TURN_ID.test(turnId)) return res.status(422).json({ error: "turnId is invalid" });
    if (turnId) {
      const key = turnStopKey(req.user.id, turnId);
      stopEntry = { stop: false };
      activeTurnStops.set(key, stopEntry);
      res.on("close", () => { if (activeTurnStops.get(key) === stopEntry) activeTurnStops.delete(key); });
    }

    let mode = ["think", "research"].includes(rawMode) ? rawMode : "default";
    const isResearch = mode === "research";
    // The learner's model pick applies to EVERY mode now. An unknown or
    // unavailable pick is ignored — the default answers. With the §7.11.5
    // picker on, the pick must also be in the payer's tier list.
    const picked = typeof req.body?.model === "string" && req.body.model ? req.body.model : null;
    const tierModels = picked && pickerEnabled() ? await allowedModelsFor(req.user.id).catch(() => null) : null;
    const { apiModel: chatModel, notice: pickedNotice } = picked
      ? resolveChatChoice(picked, process.env, { allowedModels: tierModels?.allowedModels ?? null })
      : { apiModel: null, notice: null };
    const pickedEntry = (picked && modelRegistry.get(picked))
      || (chatModel && modelRegistry.catalogue.find((e) => e.apiModel === chatModel))
      || null;
    const selectedEntry = pickedEntry || modelRegistry.get(modelRegistry.defaultId) || null;
    const canThinkResponses = !!selectedEntry?.caps?.responses;
    const canThinkChat = !!selectedEntry?.caps?.reasoning;
    const canResearch = !!selectedEntry?.caps?.tools;
    // The browser disables unavailable modes; the server enforces it anyway.
    let modeNotice = pickedNotice;
    if (mode === "think" && !canThinkResponses && !canThinkChat) {
      mode = "default";
      modeNotice = `Thinking isn't available for ${selectedEntry?.label || "this model"} — answering normally.`;
    }
    if (mode === "research" && !canResearch) {
      mode = "default";
      modeNotice = `Research isn't available for ${selectedEntry?.label || "this model"} — answering normally.`;
    }
    const isThink = mode === "think";
    const role = ["instructor", "teacher", "school", "school_admin", "admin"].includes(req.user?.role)
      ? "instructor" : "student";
    if (role === "student" && conversationId) {
      sessionTrackId = conversationId;
      activeSessionTurns.set(conversationId, (activeSessionTurns.get(conversationId) || 0) + 1);
    }
    // The instructor app asked, but the session is a learner's: a request that
    // reached the server without the instructor portal header reads the
    // learner cookie. Refuse it loudly rather than run learner tools for a
    // teacher (it drafted a study plan for "prepare an assignment").
    if (req.body?.role === "instructor" && role !== "instructor") {
      return res.status(409).json({ code: "portal_mismatch",
        error: "You're signed in as a learner here. Sign in to the instructor app again to use your teaching tools." });
    }
    const safeAgentName = typeof agentName === "string" ? agentName.replace(/[\r\n]+/g, " ").trim().slice(0, 80) : "Akoro";
    const durableRequested = Boolean(conversationId && durableAgentChatContextEnabled);
    let durable = durableRequested;
    let conversation = null;
    let relevantMemories = [];
    let retrieval = "skipped";
    let dialogue = safeHistory(history);

    if (wantsStream) beginStream();
    if (modeNotice && wantsStream) status("model", modeNotice);
    // The pick is remembered on the chat (Scenario K): a send that names its
    // model — a catalogue id, or null for the default — saves it on the thread
    // and the learner's open workflows; a change is a model_changed event.
    if (conversationId && mode === "default" && Object.prototype.hasOwnProperty.call(req.body || {}, "model") && pickerEnabled()) {
      const remembered = await (await modelPicks()).saveThreadPick({ learnerId: req.user.id, conversationId, modelId: typeof req.body.model === "string" && req.body.model ? req.body.model : null })
        .catch((e) => { if (!/not found|isn't a model/i.test(String(e?.message))) console.warn("[/chat/agent] model pick not saved:", e?.message || e); return null; });
      if (remembered?.changed && wantsStream) send("model_changed", { modelId: remembered.selection.modelId, label: remembered.selection.label, previous: remembered.previous, workflows: remembered.workflows.length });
    }
    if (durable) {
      // A durable-context failure (pending migration, transient DB error)
      // must never take the chat down: degrade to the plain-transcript path,
      // which still saves every turn to the session.
      try {
        if (wantsStream) status("memory", "Loading your saved study context…");
        // The transcript, the memories and the retry check are independent: one wait, not three
        // (realtime, 2026-11-07). A completed retry must return the original durable answer
        // without re-running an action tool — the session-bound turn key covers the visible
        // response as well as transcript persistence.
        const [loaded, retrieved, completedReply] = await Promise.all([
          timed("transcript", loadLearnerAgentConversationContext({ conversationId, userId: req.user.id })),
          timed("memories", retrieveLearnerAgentMemory({ query: userMessage, userId: req.user.id })),
          timed("retryCheck", completedLearnerAgentConversationTurn({ conversationId, userId: req.user.id, sessionId: agentSessionId(conversationId), turnId })),
        ]);
        conversation = loaded;
        // The server-owned exact transcript is authoritative for durable Agent
        // Chat. Browser history is only a compatibility fallback for callers
        // without a session (for example, the instructor assistant).
        dialogue = conversation.messages;
        retrieval = retrieved.mode;
        relevantMemories = retrieved.memories;
        if (completedReply) {
          const metadata = { responseTimeMs: Date.now() - t0, retrieval, durableContext: true, replayed: true, toolExecutions: [] };
          if (!wantsStream) return res.json({ success: true, reply: completedReply, response: completedReply, thinking: "", syllabus: [], pastQuestions: [], curriculum: [], mode, metadata, toolExecutions: [] });
          send("done", { reply: completedReply, thinking: "", syllabus: [], pastQuestions: [], curriculum: [], mode, metadata, toolExecutions: [] });
          return res.end();
        }
        // Phase 22: keep the learner's message even if the turn crashes below.
        // Idempotent per turnId — the end-of-turn persist reuses this row.
        // A tap continuation has no learner message to keep (its cue is an
        // internal event) — saving it would write a prompt the learner
        // never sent into their chat (Matt, 2026-11-17).
        if (!isContinuation) await persistLearnerAgentUserTurnMessage({ conversationId, userId: req.user.id, sessionId: agentSessionId(conversationId), turnId, userMessage }).catch(() => {});
      } catch (durableError) {
        console.error("[/chat/agent] durable context unavailable — continuing with basic transcript:", durableError.message);
        durable = false;
        conversation = null;
        relevantMemories = [];
        retrieval = "skipped";
        dialogue = safeHistory(history);
      }
    }

    const wantsCurriculum = role === "instructor";
    const sylLimit = isResearch ? 8 : 5;
    const pastLimit = isResearch ? 5 : 3;
    mark("contextAndMemory");
    if (isResearch && wantsStream) status("grounding", "Searching the syllabus and practice sources…");

    // The learner's active goals steer everything the agent says and (once
    // Full Autonomy ships) everything it proposes. Cheap indexed read, best
    // effort — a goals hiccup must never dim the chat.
    // Realtime (2026-11-07): every lookup below is independent — they all start now and the
    // turn waits once, for the slowest, instead of one after another (3–5 s on the sandbox).
    const goalsP = role === "student" ? (async () => {
      try {
        const { data: goalRows } = await db.schema("edu").from("learner_goals")
          .select("title, category, exam, target_date, metric")
          .eq("user_id", req.user.id).eq("status", "active")
          .order("updated_at", { ascending: false }).limit(5);
        if (!goalRows?.length) return "";
        return "\n\n## The learner's active goals (align advice and suggestions with these)\n" +
          goalRows.map((g) => {
            const bits = [g.category, g.exam, g.target_date ? `by ${g.target_date}` : g.metric].filter(Boolean).join(" · ");
            return `- ${g.title}${bits ? ` (${bits})` : ""}`;
          }).join("\n");
      } catch { return ""; /* table not migrated yet — the chat works without goals */ }
    })() : Promise.resolve("");
    const groundingP = Promise.all([
      timed("syllabus", getSyllabusGrounding(userMessage, { limit: sylLimit }).catch(() => ({ context: "", refs: [] }))),
      timed("pastQuestions", getPastQuestionGrounding(userMessage, { limit: pastLimit }).catch(() => ({ context: "", refs: [] }))),
      wantsCurriculum
        ? getCurriculumGrounding(userMessage, { limit: 3 }).catch(() => ({ context: "", refs: [] }))
        : Promise.resolve({ context: "", refs: [] }),
      // The learner's agent is their protégé: what they taught it is all it
      // knows of the subject (protege.js). A lookup failure must not dim the
      // chat — it reads as "nothing taught on this".
      role === "student"
        ? timed("taught", loadTaughtKnowledge({ studentId: req.user.id, query: userMessage, deps: protegeDeps })
          .catch((e) => { console.warn("[/chat/agent] taught knowledge unavailable:", e.message); return { chunks: [], topics: [], taughtAnything: false }; }))
        : Promise.resolve(null),
    ]);
    // Messages from other learners' agents waiting for this one.
    // Files this turn is saving to the Library (§7.17, D51): the reply says so, in one clause — never where (Stage 4: the read decides that later).
    // (A query builder is a thenable, not a promise: no .catch on it — await it inside try.)
    // One message's files can be sorted into several uploads (one per folder): ingestIds, or the older ingestId.
    const ingestIds = [...new Set([...(Array.isArray(req.body?.ingestIds) ? req.body.ingestIds : []), req.body?.ingestId].map(String))]
      .filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 5);
    const ingestsP = role === "student" && ingestIds.length ? (async () => {
      try {
        const { data } = await db.schema("edu").from("material_ingests").select("id, state")
          .eq("user_id", req.user.id).in("id", ingestIds);
        return ingestIds.map((id) => (data || []).find((r) => r.id === id)).filter(Boolean);
      } catch { return []; }
    })() : Promise.resolve([]);
    // Uploads waiting on the agent (Matt, 2026-11-16): this turn's payload
    // ingests plus the session's unfiled ones — the agent reads and files
    // them with its upload tools; the server posts nothing.
    const pendingUploadsP = role === "student" ? (async () => {
      try {
        const byId = new Map();
        if (conversationId) {
          const { data } = await db.schema("edu").from("material_ingests")
            .select("id, names, state, folder_id, structure")
            .eq("user_id", req.user.id).eq("chat_session_id", conversationId)
            .neq("state", "undone").order("created_at", { ascending: true }).limit(10);
          for (const r of data || []) byId.set(r.id, r);
        }
        if (ingestIds.length) {
          const { data } = await db.schema("edu").from("material_ingests")
            .select("id, names, state, folder_id, structure")
            .eq("user_id", req.user.id).in("id", ingestIds);
          for (const r of data || []) byId.set(r.id, r);
        }
        return [...byId.values()].filter((r) => !(r.structure && r.folder_id)).slice(0, 5);
      } catch { return []; }
    })() : Promise.resolve([]);
    // Card decisions the learner made after an earlier turn ended: approved
    // but not yet applied. This turn finishes them — the model calls
    // await_decision itself (nothing is applied or posted by the server).
    const decisionsP = role === "student" && conversationId ? (async () => {
      try {
        const { listConfirmedDecisions } = await import("../self-tooling/confirmations.js");
        return await listConfirmedDecisions(req.user.id, conversationId);
      } catch { return []; }
    })() : Promise.resolve([]);
    const chatFilesP = role === "student" && conversationId ? (async () => {
      try {
        const { data } = await db.schema("edu").from("material_ingests").select("names, state, structure")
          .eq("user_id", req.user.id).eq("chat_session_id", conversationId).neq("state", "undone").order("created_at", { ascending: true }).limit(10);
        const { chatFilesBrief } = await import("../materials/ingestCore.js");
        return chatFilesBrief(data || []);
      } catch { return ""; }
    })() : Promise.resolve("");
    const inboxP = role === "student" && agentNetworkEnabled
      ? Promise.all([inboxBrief(req.user.id).catch(() => ""), buddyBrief(req.user.id).catch(() => "")]).then(([a, b]) => a + b)
      : Promise.resolve("");
    // Something is running outside the chat (an Agent Check battle, a teaching session): the
    // rules for talking about it and changing it (akoro-agent/reasoning/RUNNING_WORK.md), and what it is.
    const runningP = role === "student" && studyPrepEnabled ? runningWorkBrief(req.user.id).catch(() => "") : Promise.resolve("");
    const hasAttachments = Array.isArray(rawAttachments) && rawAttachments.length > 0;
    if ((hasAttachments || ingestIds.length) && wantsStream) status("attachments", "Reading your files…");
    const attP = (async () => {
      // Uploads sent as ingest references no longer inject their text here:
      // the agent reads them itself with read_upload (Matt, 2026-11-16).
      return hasAttachments ? await processAttachments(rawAttachments) : { visionParts: [], docContext: "", notes: [] };
    })();
    // Self-tooling: without this the model tours unrelated tools and says
    // "I don't have that data" instead of building the tool (verify run
    // 1a8cb552, 2 of 3 repeats).
    const selfToolP = (async () => {
      const on = (role === "student" || role === "instructor") && await selfToolingAllowedFor(req.user.id);
      const forced = on && role === "student" ? await forcedSelfTool(req.user.id, userMessage).catch(() => null) : null;
      return { on, forced };
    })();
    // Who this learner's agent is (their protégé): its name, level and
    // sessions from edu.student_agents, and the learner's first name.
    const protegeP = role === "student" ? (async () => {
      const [{ data: a }, { data: u }] = await Promise.all([
        db.schema("edu").from("student_agents").select("name, level, total_sessions").eq("student_id", req.user.id).limit(1).maybeSingle(),
        db.from("users").select("full_name, username").eq("id", req.user.id).maybeSingle(),
      ]);
      return {
        agentName: (a?.name || safeAgentName || "Akoro").replace(/[\r\n]+/g, " ").slice(0, 80),
        learnerName: String(u?.full_name || u?.username || "your learner").split(" ")[0].slice(0, 40),
        level: Number(a?.level) || 1, sessions: Number(a?.total_sessions) || 0,
      };
    })().catch(() => null) : Promise.resolve(null);
    // The instructor's pending drafts: follow-ups ("add a part", "make Q2
    // harder", "go back to version 1") revise the newest one — without its id
    // here the model could only start another draft.
    const draftsP = role === "instructor" && openAiInstructorTools().length
      ? listActivityDrafts({ id: req.user.id, role }).then((d) => d.slice(0, 3)).catch(() => []) : Promise.resolve([]);
    const [
      goalsCtx,
      [{ context: syllabusCtx, refs: syllabusRefs }, { context: pastCtx, refs: pastRefs }, { context: curriculumCtx, refs: curriculumRefs }, taught],
      ingests, pendingUploads, chatFilesCtx, inboxCtx, runningCtx, att, { on: selfToolOn, forced: forceSelfTool }, protege, pendingDrafts, approvedDecisions,
    ] = await Promise.all([goalsP, groundingP, ingestsP, pendingUploadsP, chatFilesP, inboxP, runningP, attP, selfToolP, protegeP, draftsP, decisionsP]
      .map((pr, i) => timed(["goals", "grounding", "ingests", "pendingUploads", "chatFiles", "inbox", "running", "attachments", "selfTool", "protege", "drafts", "decisions"][i], pr)));
    // The learner's own tool defs (turnTools assembly, far below) depend on
    // nothing between here and there — launch now, await there, so their
    // database time overlaps the prompt assembly and the intent step
    // (turn-prep overlap, 2026-11-17).
    const learnerDefsP = role === "student" && selfToolOn
      ? learnerToolDefsWithAreas(req.user.id).catch(() => ({ defs: [], areas: new Map(), labels: new Map() }))
      : null;
    const protegeCtx = taught ? `\n\n${await loadDoctrine("policies/PROTEGE.md")}${renderTaughtContext(taught)}` : "";
    // The reply's trace and meta (previews, materials, the uploads' cards), and the uploads pointed at it.
    let savedReplyId = null;   // the stored reply's id: the episode's label key comes from it
    const saveTurn = async (messageId) => {
      savedReplyId = messageId || null;
      const meta = { ...(previewMetaFrom(prepared.toolExecutions) || {}),
        ...(ingests.length ? { ingest: { id: ingests[0].id }, ingests: ingests.map((r) => ({ id: r.id })) } : {}) };
      await saveMessageTrace({ messageId, userId: req.user.id, trace: traceBlocks, meta: Object.keys(meta).length ? meta : null });
      if (ingests.length && messageId) {
        try {
          await db.schema("edu").from("material_ingests").update({ chat_message_id: messageId, chat_session_id: conversationId, updated_at: new Date().toISOString() })
            .eq("user_id", req.user.id).in("id", ingests.map((r) => r.id));
        } catch { /* the cards still show; they won't reopen with the chat */ }
      }
    };
    // Agent-driven uploads (Matt, 2026-11-16; supersedes the Stage 4 server
    // post): the agent reads and files waiting uploads with its own tools
    // and narrates the filing itself — the server posts nothing.
    const decisionsCtx = approvedDecisions.length
      ? `\n\n## A decision is waiting for you to finish\nBefore this turn, the learner tapped a card in this chat and approved it. Their tap only recorded the decision — nothing has been applied yet, and they have not been told the outcome. FIRST, before answering anything else, call await_decision for each of these and report its outcome in your own words:\n` +
        approvedDecisions.map((c) => `- confirmationId ${c.confirmationId} · ${c.kind} · "${c.title || "Your tool"}"${(c.items || []).length ? ` · would change: ${c.items.slice(0, 5).join("; ")}` : ""}`).join("\n")
      : "";
    const ingestCtx = pendingUploads.length
      ? `\n\n## Uploads waiting on you\nThe learner sent file(s) that are saved in their Library but not read or filed yet. YOU drive that in this turn, with your upload tools — no one else files them:\n` +
        pendingUploads.map((r) => `- upload id ${r.id} · ${(Array.isArray(r.names) ? r.names : []).join(", ") || "a file"} · state: ${r.state}`).join("\n") +
        `\nFor each one: call read_upload (your first call is forced to it). If it says extracting, tell them briefly it's still being read and don't guess at its content. If it says failed, call retry_extraction, then read_upload again. When you have the content, decide a short title, the subject, the kind and up to 6 topics from the content and this conversation, then call file_upload with your decision. Say briefly what each file is and where you filed it — never name a folder before file_upload returns it, and don't repeat the card's details or any ids. If they asked to make something from the file (a quiz, flashcards, a summary), file it first, then make it with make_study_material (source 'upload').`
      : "";
    // The files already in this chat and what their reads found: chatFilesCtx (above).

    // The model cannot resolve "due tomorrow at 8pm" without knowing today.
    // Compute at request time; Africa/Lagos is the platform timezone.
    const nowLagos = new Date().toLocaleString("en-NG", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos",
    });
    const CURRENT_TIME_CONTEXT =
      `\n\nCurrent date and time: ${nowLagos} (Africa/Lagos). ` +
      `Use it to resolve relative dates — "tomorrow at 8pm" becomes an exact due_at ISO instant in +01:00. Never state a due date you could not compute from this.` +
      `\n\nReminders / scheduled messages — verify from the tool result, never assume. When you schedule, cancel or list one, call the tool and report exactly what its RESULT says: where it will send (deliversTo — "this chat", "the chosen chat" or "a new chat") and when (localScheduledAt). A reminder with no stated destination belongs in THIS chat (where='here', the default); use where='new' only if the learner explicitly asks for a separate chat. Never say a reminder is set unless the tool returned success this turn; if it returned an error, say the actual error. When asked whether a reminder sent, read it back with list_scheduled_chat_follow_ups (status / deliveredAt / missed) and answer from that, not from memory.`;
    const selfToolCtx = selfToolOn && role === "instructor"
      ? "\n\n## Building tools (preview)\nWhen the instructor asks for something none of your tools gives directly — a total, average, count, ranking or breakdown over THEIR OWN classes and activities (average grade per activity, who hasn't started, completion by class, students below a mark) — call create_tool (schema_lookup first if unsure what it can use) and answer from its result; don't say you don't have the data. check_activity_outcomes is for ONE activity's summary — a question across several activities (each activity's average, who hasn't started anything) is a create_tool question. Tools only ever see this instructor's own classes and the work set in them — students by name only, never another teacher's class or a learner's private chats or notes. Only say it can't be done after create_tool is rejected, and say why."
      : selfToolOn
      ? "\n\n## Building tools (preview)\nWhen the learner asks for something none of your tools gives directly — a total, average, count or breakdown over their own data (hours of sessions per month, tasks finished per week, accuracy by year) — don't say you don't have the data and don't piece it together from unrelated tools. Call create_tool (schema_lookup first if unsure what it can use), then answer from its result. The same goes for comparisons with other learners (how others scored in battles they played together): create_tool either builds it or, if it needs a permission, asks an admin and the answer comes back in this chat — tell the learner that plainly. Only say it can't be done after create_tool is rejected, and say why.\nWhen the learner asks you to CHANGE their own things and no tool does it (delete or complete their tasks, end a study buddy) — don't just say you can't. Call schema_lookup: if it lists that change as needs_your_ok, call create_tool with it in hint.capabilities in this same turn — don't ask 'shall I build it?' first. The tool is drafted (off) and they get a card showing what it would change; Allow on the card is their yes. Say briefly that you've drafted it and they can tap Allow on the card. Never file submit_tool_request for these.\nWhen their message says they approved a tool, or asks you to run one of your tools by name (after the Akoro team approved it), run that tool now — a read: explain what it found in plain words; a change: it finds what to change and shows the Allow card — say what it would change (the app tells you when they confirm; don't ask them to tell you). When their message says they confirmed a change, look again (run the same tool, or list the items) to check it went through: say what changed and whether anything is still left. Nothing is done until you've checked."
      : "";
    const draftsCtx = pendingDrafts.length
      ? "\n\n## Pending drafts (newest first)\n" + pendingDrafts.map((d) => {
        const vs = Array.isArray(d.payload?.versions) ? d.payload.versions : [];
        const topic = String(d.payload?.topic || d.topic || "").replace(/[\r\n]+/g, " ").slice(0, 80);
        return `- draftId ${d.id} · ${String(d.title || "").replace(/[\r\n]+/g, " ").slice(0, 80)} · ${d.type}${topic ? ` · ${topic}` : ""}${vs.length ? ` · latest Version ${vs.at(-1).n}` : ""}`;
      }).join("\n") + "\nThe instructor's follow-ups about a draft — questions, parts, diagrams, marks, types, versions, title, instructions — change the NEWEST draft: call revise_activity_draft with its draftId (their words about the questions verbatim in question_request, or about a teaching resource verbatim in change_request; base_version when they name a version). Call prepare_activity only for a new activity, run_teaching_tool only for a new resource."
      : "";
    mark("prework");
    // Prompt-cache layout (2026-11-17): providers cache the longest matching
    // token PREFIX of a request, so anything volatile inside the system
    // message poisons the match for the whole conversation history behind
    // it. With the tail layout on (default), the prompt splits: systemStatic
    // (the doctrine with NO clock in it, plus the parallel-reads note —
    // byte-stable across turns) leads, the transcript follows, and
    // systemDynamic (the clock + every per-turn context) rides as a trailing
    // message the loop appends after the transcript. systemContent keeps the
    // combined text for the consumers that want it whole (the budget count,
    // the episode record, the flag-off path). AKORO_PROMPT_TAIL=false
    // restores the single combined system message, byte-identical to before.
    const promptTailOn = process.env.AKORO_PROMPT_TAIL !== "false";
    const systemStatic = (await assembleChatDoctrine({
      agentName: safeAgentName || "Akoro",
      protege,
      role,
      think: isThink,
      research: isResearch,
      durableMemory: durable,
      currentTimeContext: promptTailOn ? "" : CURRENT_TIME_CONTEXT,
    })) +
      (process.env.AKORO_PARALLEL_READS !== "false" ? PARALLEL_READS_NOTE : "")
      + (process.env.AKORO_STEP_NARRATION !== "false" ? STEP_NARRATION_NOTE : "");
    const systemDynamic = (promptTailOn ? CURRENT_TIME_CONTEXT : "") +
      (conversation?.summary ? `\n\n## Compact conversation summary\n${conversation.summary}` : "") +
      renderRelevantMemory(relevantMemories) +
      renderLedger(conversation?.scratchpad ? { ...conversation.scratchpad, progressSummary: "" } : null) +
      (goalsCtx || "") +
      protegeCtx + inboxCtx + runningCtx + ingestCtx + decisionsCtx + chatFilesCtx + selfToolCtx + draftsCtx +
      (syllabusCtx ? `\n\n${syllabusCtx}` : "") +
      (pastCtx ? `\n\n${pastCtx}` : "") +
      (curriculumCtx ? `\n\n${curriculumCtx}` : "") +
      (att.docContext ? `\n\n${att.docContext}` : "");
    const systemContent = systemStatic + systemDynamic;

    const userText = userMessage + (att.notes.length ? `\n\n(Attachments: ${att.notes.join(" ")})` : "");
    const userContent = att.visionParts.length
      ? [{ type: "text", text: userText }, ...att.visionParts]
      : userText;
    // Draft tools can be kill-switched off entirely; a required tool that
    // isn't in the catalogue would throw inside the loop — so the prepare
    // force below only arms when the instructor catalogue is non-empty.
    // Instructors' agents build tools too (S7): their two self-tooling tools and their saved tools join the list.
    const instructorTools = role === "student" ? [] : openAiInstructorTools().concat(role === "instructor" && selfToolOn
      ? [...openAiChatTools({ allowToolRequest: false, selfTooling: true }).filter((t) => t.function.name === "schema_lookup" || t.function.name === "create_tool" || t.function.name === "get_agent_capabilities"),
        ...await learnerToolDefs(req.user.id, "instructor").catch(() => [])]
      : []);
    const draftFollowUp = instructorTools.length > 0 && pendingDrafts.length > 0
      && (isDraftFollowUp(userMessage) || (pendingDrafts[0]?.type === "teaching_tool" && isToolDraftFollowUp(userMessage)));
    // Context budget (contextBudget.js): the whole prompt is counted; what falls out is summarised once.
    mark("doctrine");
    const fit = fitDialogue(dialogue, { systemText: systemContent, current: { role: "user", content: userText } });
    let summaryNow = conversation?.scratchpad?.progressSummary || "";
    let summaryMark = summaryMarkOf(conversation?.scratchpad);
    // Launched, not awaited (turn-prep overlap, 2026-11-17): the merge runs
    // during the tool assembly below and is awaited at first use, just
    // before turnSystem is built. Same inputs, same result.
    const summaryP = durable && fit.dropped.length ? summariseEarlier({
      previous: summaryNow, mark: summaryMark, dropped: fit.dropped,
      create: (body) => openai.chat.completions.create({ ...body, __role: "background", __payer: "platform", __feature: "chat_summary", __userId: req.user.id, __timeoutMs: 45_000, __maxRetries: 0 }),   // the turn waits 8 s (contextBudget.js); a slow answer is ignored, never counted against the shared breaker
    }).catch(() => null) : null;
    mark("summary");
    // The intent step (intentStep.js): what the learner wants, read before tool choice. Fail-open.
    // Launched, not awaited (turn-prep overlap, 2026-11-17): it runs during
    // the forced-tool and tool-list assembly below and is awaited at first
    // use, just before turnSystem is built. The catch guard keeps a
    // rejection from surfacing unhandled if the turn fails before the await.
    const intentP = process.env.AGENT_INTENT_STEP === "off" ? Promise.resolve(null) : runIntentStep({
      message: userMessage, recent: fit.kept,
      create: (body) => openai.chat.completions.create({ ...body, __role: "background", __payer: "platform", __feature: "chat_intent", __userId: req.user.id, __timeoutMs: 45_000, __maxRetries: 0 }),   // the turn waits 4 s (intentStep.js); a slow answer is ignored, never counted against the shared breaker
    }).catch(() => null);
    // The turn's forced tool, computed before the tool list: runtime area
    // selection must include the forced tool's area (the loop refuses a
    // required tool it cannot see). Learners: capability questions are
    // answered from the live catalogue. Instructors: an activity request (or
    // a confirmation continuing one) MUST produce a prepare_activity call —
    // left on "auto" the model detours into writing sample questions as
    // prose or re-asking for details the conversation already has. The force
    // covers iteration 0 only; the tool's own clarify() handles anything
    // genuinely missing.
    let forcedTool = role === "student"
      ? (pendingUploads.length ? "read_upload"
        : approvedDecisions.length ? "await_decision"
        : requiresAgentCapabilitiesTool(userMessage) ? "get_agent_capabilities"
        // Other players' results in the learner's battles: go through
        // create_tool (it builds, or asks an admin for the permission) —
        // left on auto the model sometimes said "I can't see that" instead.
        // A change to their own tasks: schema_lookup first, so the agent offers to build it.
        : forceSelfTool ? forceSelfTool
        // Identity questions about the learner's OWN school/class/subjects/
        // teachers/progress are fact questions about data the model cannot
        // see — the live 2026-10-01 transcript had tools=0 and an invented
        // subject list. Force the matching read tool on iteration 0.
        : (requiredLearnerDataTool(userMessage)
          // Test/exam preparation is the study-prep session workflow; left
          // on auto the model interviews the learner for topics/format/
          // duration instead of starting it (live 2026-10-01 transcript:
          // "let's plan for a test" twice, tools=0 both times). Only while
          // the feature gate keeps the study-prep tools in the list.
          ?? (studyPrepEnabled ? requiredStudyPrepTool(userMessage, dialogue) : null)))
      : draftFollowUp ? "revise_activity_draft"
      : ((instructorTools.length && requiresActivityPreparation(userMessage, dialogue))
        ? "prepare_activity" : null);
    // Sessions merge: the learning-history force names the retired built-in.
    // Point it at the merged tool — the loop refuses a required tool it
    // cannot see (live battery 2026-11-15: "my learning sessions" asks
    // errored with "The required Agent Chat tool is unavailable").
    if (forcedTool === "get_my_learning_sessions" && MERGED_DOMAINS.my_study_sessions.enabled()) forcedTool = "my_study_sessions";
    // Runtime area selection (toolSelection.js): the always-on core plus the
    // areas active for this conversation — the message's areas, areas loaded
    // earlier in the conversation, and the forced tool's area. Built-in and
    // learner-built tools are selected together, in one move. No active area
    // (a vague opener) → the full list: selection narrows only when
    // something points at an area.
    let turnTools = instructorTools;
    let selectionNote = "";
    if (role === "student") {
      const { defs: learnerDefs, areas: learnerAreas, labels: learnerLabels } = selfToolOn
        ? await learnerDefsP
        : { defs: [], areas: new Map(), labels: new Map() };
      // Named-tool force (2026-11-18): "run my Delete a chat by title
      // tool" names one of the learner's own tools with a run verb —
      // force that call. The tool was already being LOADED (its area
      // was active); the model still declined it and claimed it did
      // not exist. Forcing rides the existing required-tool machinery:
      // the area-add and the survival net below see it too. A write
      // still lands on its confirmation card, so a forced run cannot
      // change anything unconfirmed.
      if (!forcedTool && learnerLabels?.size) {
        const named = namedLearnerTool(userMessage, [...learnerLabels].map(([name, label]) => ({ name, label })));
        if (named) forcedTool = named;
      }
      let allTools = openAiChatTools({
        allowToolRequest: hasExplicitToolRequestConsent(userMessage, { previousAgentText: lastAgentText(fit.kept) }),
        selfTooling: selfToolOn,
      }).concat(learnerDefs);
      allTools = await applyLibraryMerge(allTools, req.user.id, selfToolOn);
      allTools = await applyChatsMerge(allTools, req.user.id, selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_tasks, ["list_tasks"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_goals, ["list_my_goals"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_study_notes, ["search_my_study_knowledge"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_study_sessions, ["get_my_learning_sessions"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_past_questions, ["get_past_question_practice"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_weak_topics, ["get_weak_topics"], selfToolOn);
      turnTools = allTools;
      if (areaSelectionEnabled()) {
        const active = new Set([...stickyAreasFor(conversationId), ...areasForMessage(userMessage)]);
        if (forcedTool) active.add(toolArea(forcedTool));
        if (forcedTool === "my_study_sessions") active.add("teaching");
        if (active.size) {
          const sticky = stickyAreasFor(conversationId);
          for (const a of active) sticky.add(a);
          turnTools = filterDefsByAreas(allTools, active, (name) => learnerAreas.get(name) || (mergedLibraryEnabled() && name === "library_documents" ? "files" : undefined) || (mergedChatsEnabled() && name === "my_chats" ? "chats" : undefined) || (MERGED_DOMAINS.my_tasks.enabled() && name === "my_tasks" ? "plans" : undefined) || (MERGED_DOMAINS.my_goals.enabled() && name === "my_goals" ? "plans" : undefined) || (MERGED_DOMAINS.my_study_notes.enabled() && name === "my_study_notes" ? "teaching" : undefined) || (MERGED_DOMAINS.my_study_sessions.enabled() && name === "my_study_sessions" ? "teaching" : undefined) || (MERGED_DOMAINS.my_past_questions.enabled() && name === "my_past_questions" ? "progress" : undefined) || (MERGED_DOMAINS.my_weak_topics.enabled() && name === "my_weak_topics" ? "progress" : undefined) || toolArea(name));
          // A forced (required) tool must survive area selection — the loop
          // refuses a required tool it cannot see. A merged def can resolve
          // to the learner tool's own derived area instead of its built-in
          // area (sessions: progress, not teaching), so the forced area-add
          // alone does not guarantee it survives the filter.
          if (forcedTool && !turnTools.some((t) => t.function?.name === forcedTool)) {
            const needed = allTools.find((t) => t.function?.name === forcedTool);
            if (needed) turnTools = [...turnTools, needed];
          }
          selectionNote = `\n\n## Tools loaded for this conversation\nLoaded areas: ${[...active].join(", ")}, plus the always-on core. Your other tools exist but are not loaded in this conversation. If the learner's request needs a tool you do not have, call get_agent_capabilities with { area: "<area id>" } to load that area's tools, then continue the request. Area ids: ${Object.keys(AREAS).join(", ")}.`;
        }
      }
    }
    else if (role === "instructor") {
      // Instructor turns get the same treatment as learner turns (Matt's
      // order 2026-11-16): the merged instructor domains assemble over the
      // catalogue first, then runtime area selection narrows the turn to
      // the core + the active areas — built-in and instructor-built tools
      // filtered together. No active area → the full list, as for learners.
      let allTools = instructorTools;
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_classes, ["list_my_classrooms"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_class_students, [], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_activities, [], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_activity_results, ["check_activity_outcomes"], selfToolOn);
      allTools = await applyMergedDomain(allTools, req.user.id, MERGED_DOMAINS.my_activity_drafts, ["list_activity_drafts", "get_activity_draft"], selfToolOn);
      turnTools = allTools;
      if (areaSelectionEnabled()) {
        const { areas: ownAreas } = await learnerToolDefsWithAreas(req.user.id, "instructor").catch(() => ({ areas: new Map() }));
        const active = new Set([...stickyAreasFor(conversationId), ...areasForMessage(userMessage)]);
        if (forcedTool) active.add(toolArea(forcedTool));
        if (active.size) {
          const sticky = stickyAreasFor(conversationId);
          for (const a of active) sticky.add(a);
          const mergedAreaOf = (name) => MERGED_DOMAIN_LIST.find((c) => c.name === name && c.enabled())?.area;
          turnTools = filterDefsByAreas(allTools, active, (name) => ownAreas.get(name) || mergedAreaOf(name) || toolArea(name));
          // A forced (required) tool must survive area selection — the loop
          // refuses a required tool it cannot see (same net as learners).
          if (forcedTool && !turnTools.some((t) => t.function?.name === forcedTool)) {
            const needed = allTools.find((t) => t.function?.name === forcedTool);
            if (needed) turnTools = [...turnTools, needed];
          }
          selectionNote = `\n\n## Tools loaded for this conversation\nLoaded areas: ${[...active].join(", ")}, plus the always-on core. Your other tools exist but are not loaded in this conversation. If the instructor's request needs a tool you do not have, call get_agent_capabilities with { area: "<area id>" } to load that area's tools, then continue the request. Area ids: ${Object.keys(AREAS).join(", ")}.`;
        }
      }
    }
    // Prep overlap, awaited at first use (2026-11-17): the summary merge and
    // the intent step, launched above, ran during the tool assembly.
    if (summaryP) { const merged = await summaryP; if (merged) { summaryNow = merged.summary; summaryMark = merged.mark; } }
    const intent = await intentP;
    mark("intent");
    const turnSystem = systemContent
      + (summaryNow ? `\n\n## Earlier in this chat (summary)\n${summaryNow}` : "")
      + renderIntent(intent)
      // Phase 22 Part E: a multi-step request gets a starting plan to adopt (kept only if the agent adopts it).
      + (intent?.multiStep ? renderDraftPlan(intent.steps, conversation?.scratchpad || null) : "")
      + selectionNote;
    // The loop's volatile tail in the cache layout: the dynamic context plus
    // this turn's summary/intent/selection notes (turnSystem above keeps the
    // combined text for the episode record). Null when the layout is off —
    // the loop then receives turnSystem whole, exactly as before.
    const loopTail = promptTailOn
      ? systemDynamic
        + (summaryNow ? `\n\n## Earlier in this chat (summary)\n${summaryNow}` : "")
        + renderIntent(intent)
        + (intent?.multiStep ? renderDraftPlan(intent.steps, conversation?.scratchpad || null) : "")
        + selectionNote
      : null;
    const ledgerIn = conversation?.scratchpad ? { ...conversation.scratchpad, progressSummary: summaryNow, summaryMark } : (summaryNow ? { progressSummary: summaryNow, summaryMark } : null);
    const recorder = (await recordsRealTraffic(req.user.id).catch(() => false))
      ? createEpisodeRecorder({ surface: "agent_chat", role, system: turnSystem, source: "real",
        state: { ledger: ledgerIn, intent, summary: summaryNow || null }, messages: [...fit.kept, { role: "user", content: userText }] })
      : null;
    mark("recorder");
    const prepared = await runAgentToolLoop({
      recorder,
      ledger: ledgerIn,
      planFirst: shouldPlanFirst(intent),
      teacherWords: draftFollowUp ? userMessage.slice(0, 1500) : null,
      systemContent: promptTailOn ? systemStatic : turnSystem,
      tailContent: loopTail,
      messages: [...fit.kept, { role: "user", content: userContent }],
      studentId: req.user.id,
      conversationId,
      turnId,
      status: wantsStream ? status : null,
      tools: turnTools,
      // Learners: capability questions are answered from the live catalogue.
      // Instructors: an activity request (or a confirmation continuing one)
      // MUST produce a prepare_activity call — left on "auto" the model
      // detours into writing sample questions as prose or re-asking for
      // details the conversation already has. The force covers iteration 0
      // only; the tool's own clarify() handles anything genuinely missing.
      requiredTool: forcedTool,
      role,
      trace,
      isAborted,
      think: isThink && canThinkResponses,
      // A chat-reasoning Think turn answers in the reasoning pass below, so the
      // preflight decision must not stream (or become) the final answer.
      streamText: !isResearch && !(isThink && canThinkChat),
      // A mode with no learner pick uses its runtime feature override, then env.
      model: chatModel || (isThink ? runtimeFeatureModel("think_mode") : isResearch ? runtimeFeatureModel("research_mode") : null),
    });
    mark("agentLoop");
    const stopped = () => Boolean(prepared.aborted) || isAborted();
    // Post-loop calls (the fallback answer call, the think passes) keep the
    // SINGLE-system shape, deliberately: with the volatile context trailing
    // the transcript, the model tried to continue the tool pattern as DSML
    // text in the no-tools answer call and the reply scrubbed to empty —
    // live-verified 2026-11-17, 3 of 3 fallback turns ended on the
    // empty-reply line while the same layout answers fine inside the loop
    // (where tools are offered). The loop's decisions — the token volume —
    // keep the tail layout; these once-per-turn calls use the proven shape.
    const finalMessages = [{ role: "system", content: systemContent }, ...prepared.messages];
    // The closing instruction for an answer-call retry (below): a transcript
    // full of tool calls can pull the model into imitating another call as
    // DSML text (which the scrubber then removes, leaving an empty reply),
    // and on reasoning models the whole token budget can go to hidden
    // reasoning — both ended live turns on the empty-reply line (2026-11-17).
    const answerClosing = { role: "user", content: "Write your reply to the learner now, in plain words, from the results above. Do not call any tool and do not describe tools — just answer. This is the last call of the turn and nothing runs after you, so do not defer: no promising to check, look up or run something next, and no reporting that work was not done while asking to be asked again. Give the complete answer the conversation and the results support; if something the learner asked for could not be done, say so plainly, with the reason — do not offer a later turn as the remedy." };
    const tools = turnTools;   // declared (with tool_choice "none") so the answer call's history — assistant tool calls and their results — references tools the request actually defines; sending that history with NO tools declared made the default model return empty/markup answers (live, 2026-11-17). The preflight loop above remains the only executor: "none" forbids new calls.
    let reply = "";
    let thinking = "";
    let usedModel = OPENAI_MODEL;

    if (!wantsStream) {
      // A final function-disabled call makes the model explain completed tool
      // results in learner language, while the preflight loop above remains
      // the only authority that may invoke an Akoro tool.
      // Think mode: the reasoned last decision already is the answer; else
      // reason over the tool results (if any) for the answer.
      const thinkTarget = chatModel || runtimeFeatureModel("think_mode") || THINK_MODEL;
      if (prepared.finalText && !(isThink && canThinkChat)) { reply = prepared.finalText; usedModel = isThink ? (canThinkResponses ? thinkTarget : (chatModel || OPENAI_MODEL)) : (chatModel || OPENAI_MODEL); }
      else if (isThink && canThinkResponses) {
        try { ({ reply, thinking } = await thinkOnce({ messages: finalMessages, model: thinkTarget, trace })); usedModel = thinkTarget; } catch { /* fallback below */ }
      } else if (isThink && canThinkChat) {
        try { ({ reply, thinking } = await thinkChatOnce({ messages: finalMessages, model: chatModel || OPENAI_MODEL, trace })); usedModel = chatModel || OPENAI_MODEL; } catch { /* fallback below */ }
      }
      if (!reply) {
        usedModel = isResearch ? (chatModel || runtimeFeatureModel("research_mode") || RESEARCH_MODEL) : (chatModel || OPENAI_MODEL);
        const completion = await openai.chat.completions.create({
          model: usedModel,
          temperature: 0.6,
          max_tokens: isResearch ? 2200 : 900,
          messages: [...finalMessages, answerClosing],
          ...(tools ? { tools, tool_choice: "none" } : {}),
        });
        reply = completion.choices?.[0]?.message?.content?.trim() || "";
        if (!reply) {
          // Empty answer — one retry with the closing instruction and room
          // to answer (see answerClosing above).
          const retry = await openai.chat.completions.create({
            model: usedModel,
            temperature: 0.6,
            max_tokens: 2000,
            messages: [...finalMessages, answerClosing],
          }).catch(() => null);
          reply = retry?.choices?.[0]?.message?.content?.trim() || "";
        }
      }
    } else {
      if (!stopped() && prepared.finalText && !(isThink && canThinkChat)) {
        // Already on screen when it streamed as the last step's words.
        reply = prepared.finalText;
        usedModel = chatModel || (isThink ? runtimeFeatureModel("think_mode") : isResearch ? runtimeFeatureModel("research_mode") : null) || OPENAI_MODEL;
        if (!prepared.promoted) send("delta", { text: reply });
      } else if (!stopped() && isThink && canThinkResponses) {
        status("thinking", "Thinking…");
        try { ({ reply, thinking } = await streamThinkWithResponses({ send, messages: finalMessages, model: chatModel || THINK_MODEL, trace, isAborted })); usedModel = chatModel || THINK_MODEL; } catch { /* fall through */ }
      } else if (!stopped() && isThink && canThinkChat) {
        status("thinking", "Thinking…");
        try { ({ reply, thinking } = await streamThinkChat({ send, messages: finalMessages, model: chatModel || OPENAI_MODEL, trace, isAborted })); usedModel = chatModel || OPENAI_MODEL; } catch { /* fall through */ }
      }
      if (!reply && !stopped()) {
        if (isResearch) status("synthesis", "Writing it up…");
        usedModel = isResearch ? (chatModel || runtimeFeatureModel("research_mode") || RESEARCH_MODEL) : (chatModel || OPENAI_MODEL);
        try {
          reply = await streamChat({
            send,
            messages: [...finalMessages, answerClosing],
            model: usedModel,
            max_tokens: isResearch ? 2200 : 900,
            tools,
            toolChoice: "none",
            isAborted,
          });
        } catch (error) {
          if (!isResearch && !chatModel) throw error;
          usedModel = OPENAI_MODEL;   // the chosen / research model failed — the default answers
          reply = await streamChat({ send, messages: finalMessages, model: usedModel, max_tokens: 900, tools, toolChoice: "none", isAborted });
        }
        if (!reply.trim() && !stopped()) {
          // Empty answer — one retry with the closing instruction and room
          // to answer (see answerClosing above).
          reply = await streamChat({
            send,
            messages: [...finalMessages, answerClosing],
            model: usedModel,
            max_tokens: 2000,
            tools,
            toolChoice: "none",
            isAborted,
          }).catch(() => "");
        }
      }
    }
    // Fragment answer (2026-11-18): the answer call can end mid-sentence
    // ("Nothing was rebuilt and nothing was run — this turn produced") on
    // a turn where nothing ran, and the empty-reply retries above never
    // see it — the reply is not empty. One non-streamed retry with the
    // closing instruction; only when the turn did no work, since after
    // real executions the corrections below append rather than replace.
    if (!stopped() && reply.trim() && looksTruncated(reply) && !prepared.toolExecutions.length) {
      const retry = await openai.chat.completions.create({
        model: usedModel, temperature: 0.6, max_tokens: 2000,
        messages: [...finalMessages, answerClosing],
      }).catch(() => null);
      const retryText = retry?.choices?.[0]?.message?.content?.trim() || "";
      if (retryText) reply = retryText;
    }
    // A stopped turn keeps whatever streamed so far, marked as stopped, so the
    // saved transcript matches what the learner saw.
    if (stopped()) reply = reply.trim() ? `${reply.trim()}\n\n${STOPPED_REPLY}` : STOPPED_REPLY;
    // Internal ids the model saw in tool results never reach the learner (reply-scrub.js).
    reply = scrubInternalIds(stripToolCallMarkup(stripDsmlMarkup(reply)));
    if (!stopped()) reply = ensureNotTaughtOpener(reply, prepared.toolExecutions);
    // …and a reply that promises the Teach me button without having called the
    // tool gets the button it promised (the same topic, the same links).
    if (role === "student" && !stopped() && !prepared.toolExecutions.some((x) => x.tool === "ask_to_be_taught")) {
      const teach = teachRequest({ topic: promisedTeachTopic(reply) });
      if (teach) {
        const found = await akoroMaterialFor(teach.topic).catch(() => []);
        const mats = collectMaterials([materialsFrom("ask_to_be_taught", { materials: found })]);
        prepared.toolExecutions.push({ tool: "ask_to_be_taught", success: true, backfilled: true, input: { topic: teach.topic }, teach, ...(mats.length ? { materials: mats } : {}) });
      }
    }
    // A reply that says a request went to an admin when none did this turn is corrected, not left standing.
    if (!stopped()) {
      const fix = requestClaimCorrection(reply, prepared.toolExecutions);
      if (fix) { reply = `${reply.trim()}\n\n${fix}`; if (wantsStream) send("delta", { text: `\n\n${fix}` }); }
      // The end-of-turn check (turnCheck.js): claimed actions against real changes, "all done" against the ledger.
      for (const line of turnCorrections(reply, { executions: prepared.toolExecutions, ledger: prepared.ledger || ledgerIn })) {
        reply = `${reply.trim()}\n\n${line}`;
        if (wantsStream) send("delta", { text: `\n\n${line}` });
      }
    }
    if (!reply.trim()) reply = "I'm here to help with your studies — ask me anything about your subjects!";
    // The episode (per AGENT_EPISODES; never for an opted-out user): the reply as shown, code-computed checks,
    // stored anonymised; never holds up the reply.
    // Stored once the reply is saved, keyed to it (labelKeyFor) so a later rating joins it as a human label.
    let episode = null;
    if (recorder && !stopped()) {
      recorder.decision({ reply });
      episode = recorder.finish({ ledger: prepared.ledger || ledgerIn, sideEffecting: (t) => isSideEffecting(t, {}), capabilities: intent?.multiStep ? ["planning"] : [] });
    }
    const traceBlocks = trace.blocks();

    // Persist EVERY completed turn. The previous gate — skip the save when
    // req/res looks destroyed ("client stream abandoned") — meant that behind
    // Cloudflare + Render, where the socket routinely reads destroyed the
    // instant the last delta flushes, NO turn ever persisted: every learner's
    // history was silently lost (observed live: 4/4 turns saved=false with the
    // turn line firing 2ms after the stream — no DB round-trip ever ran).
    // Saving is always correct here: the reply is fully generated by this
    // point, and the durable write is turn-keyed idempotent — an abandoned
    // stream that is retried with the same turnId resumes/dedupes by design.
    mark("answer");
    // The chips start now, beside the save, not after it (realtime, 2026-11-07).
    const suggestionsP = role === "student" && reply && wantsStream && req.body?.inlineSuggestions === true
      ? suggestionsFor({ user: req.user, body: { reply, ask: userMessage, role: "student", conversationId,
        tools: prepared.toolExecutions.map((x) => ({ tool: x?.tool, topic: x?.teach?.topic || x?.guide?.teach?.topic || null })) } }).catch(() => [])
      : null;
    // The reply is final: the learner gets "done" now (cards, chips, approvals settle) and
    // saving follows; the saved message's id comes after as "saved" (realtime, 2026-11-07:
    // the save took 3–35 s on the sandbox and held everything back).
    // The visible reply is persisted BEFORE the client is told it is done: a
    // refresh in the next seconds (or an instance crash) can no longer lose
    // what the learner just saw. The slow durable context work still follows.
    let fastSavedId = null;
    if (conversationId && turnId) {
      try {
        fastSavedId = await timed("fastSave", appendFastChatTurn({
          conversationId, userId: req.user.id, sessionId: agentSessionId(conversationId), turnId,
          userMessage, assistantMessage: reply, agentOnly: isContinuation,
        }));
      } catch (e) { console.warn("[/chat/agent] fast save failed:", e?.message || e); }
    }
    let doneSent = false;
    if (wantsStream) {
      timings.doneMs = Date.now() - t0;
      send("done", { reply, thinking, syllabus: syllabusRefs, pastQuestions: pastRefs, curriculum: curriculumRefs, mode,
        ...(fastSavedId ? { messageId: fastSavedId } : {}),
        metadata: { model: usedModel, responseTimeMs: Date.now() - t0, timings, retrieval, toolExecutions: prepared.toolExecutions, ...(durable ? { durableContext: true } : {}), ...(modeNotice ? { modeNotice } : {}) },
        toolExecutions: prepared.toolExecutions, trace: traceBlocks, stopped: stopped() });
      doneSent = true;
      if (suggestionsP && !stopped()) suggestionsP.then((suggestions) => send("suggestions", { suggestions }));
    }
    let turnSaved = false;   // one outcome line per turn — see the log below
    if (conversationId) {
      if (durable) {
        if (wantsStream) status("saving", "Saving this study context…");
        try {
          const persisted = await timed("persistTurn", persistLearnerAgentConversationTurn({
            conversationId,
            userId: req.user.id,
            sessionId: agentSessionId(conversationId),
            turnId,
            userMessage,
            assistantMessage: reply,
            agentOnly: isContinuation,
            summary: compactAgentSummary(conversation?.summary, isContinuation ? "The learner tapped Allow on the pending card." : userMessage, reply),
            scratchpad: nextLedger(ledgerIn, prepared.ledger || null, isContinuation ? "The learner tapped Allow on the pending card." : userMessage, prepared.toolExecutions),
            memories: isContinuation ? [] : safeMemoryUpdates(userMessage),
          }));
          turnSaved = true;
          await timed("saveTrace", saveTurn(persisted?.assistantMessageId || fastSavedId));
        } catch (persistError) {
          // The reply already happened — never lose the transcript to a
          // durable-write hiccup. Fall back to the plain two-row append.
          console.error("[/chat/agent] durable persist failed — appending basic transcript:", persistError.message);
          // Never write the turn twice: if its messages were saved before the
          // failure, keep those (a second append duplicated every turn).
          const already = await savedTurnReplyId({ conversationId, userId: req.user.id, turnId }).catch(() => null);
          if (already) { turnSaved = true; await saveTurn(already).catch(() => {}); }
          else if (fastSavedId) { turnSaved = true; savedReplyId = fastSavedId; await saveTurn(fastSavedId).catch(() => {}); }
          else if (turnId) {
            const retried = await appendFastChatTurn({ conversationId, userId: req.user.id,
              sessionId: agentSessionId(conversationId), turnId, userMessage, assistantMessage: reply, agentOnly: isContinuation }).catch(() => null);
            if (retried) { turnSaved = true; savedReplyId = retried; await saveTurn(retried).catch(() => {}); }
            else await appendBasicChatTurn({ conversationId, userId: req.user.id, userMessage, assistantMessage: reply, agentOnly: isContinuation })
              .then(async (saved) => { turnSaved = true; savedReplyId = saved?.assistantMessageId; await saveTurn(saved?.assistantMessageId); })
              .catch((e) => console.error("[/chat/agent] basic transcript append failed:", e.message));
          }
          else await appendBasicChatTurn({ conversationId, userId: req.user.id, userMessage, assistantMessage: reply, agentOnly: isContinuation })
            .then(async (saved) => { turnSaved = true; await saveTurn(saved?.assistantMessageId); })
            .catch((e) => console.error("[/chat/agent] basic transcript append failed:", e.message));
        }
      } else if (fastSavedId) {
        turnSaved = true;
        savedReplyId = fastSavedId;
        await saveTurn(fastSavedId).catch(() => {});
      } else if (turnId) {
        const retried = await appendFastChatTurn({ conversationId, userId: req.user.id,
          sessionId: agentSessionId(conversationId), turnId, userMessage, assistantMessage: reply, agentOnly: isContinuation }).catch(() => null);
        if (retried) { turnSaved = true; savedReplyId = retried; await saveTurn(retried).catch(() => {}); }
        else await appendBasicChatTurn({ conversationId, userId: req.user.id, userMessage, assistantMessage: reply, agentOnly: isContinuation })
          .then(async (saved) => { turnSaved = true; savedReplyId = saved?.assistantMessageId; await saveTurn(saved?.assistantMessageId); })
          .catch((e) => console.error("[/chat/agent] basic transcript append failed:", e.message));
      } else {
        await appendBasicChatTurn({ conversationId, userId: req.user.id, userMessage, assistantMessage: reply, agentOnly: isContinuation })
          .then(async (saved) => { turnSaved = true; savedReplyId = saved?.assistantMessageId; await saveTurn(saved?.assistantMessageId); })
          .catch((e) => console.error("[/chat/agent] basic transcript append failed:", e.message));
      }
    } else if (!warnedUnsavedTurn.warned) {
      warnedUnsavedTurn.warned = true;
      console.warn("[/chat/agent] a completed turn was NOT saved (client sent no conversationId) — that reply cannot be restored on reload");
    }
    if (episode) {
      void saveEpisode(episode, { names: [req.user.username, req.user.fullName, req.user.email].filter(Boolean),
        labelKey: labelKeyFor("agent_chat", savedReplyId) }).catch(() => {});
    }
    // One line per completed turn, success or failure: with this, "my history
    // is empty" is diagnosable from the logs alone — saved=false names the
    // failing write above, saved=true with an empty reload points at the read
    // side (GET /sessions, GET /sessions/:id/messages) or the client.
    console.log(`[agent-chat] turn user=${String(req.user.id).slice(0, 8)} conv=${conversationId ?? "-"} `
      + `turn=${turnId ?? "-"} durable=${durable} tools=${prepared.toolExecutions.length} stopped=${stopped()} `
      + `saved=${turnSaved} ${Date.now() - t0}ms`);
    // Quiet learning (§7.16.6): once this chat settles, one background pass
    // writes its summary and merges the learner's memories. Never blocks the reply.
    if (turnSaved && conversationId && role === "student") noteChatTurn({ userId: req.user.id, chatSessionId: conversationId }).catch(() => {});

    mark("save");
    timings.totalMs = Date.now() - t0;
    console.log(`[chat-timing] ${JSON.stringify(timings)}`);
    const metadata = {
      model: usedModel,
      responseTimeMs: Date.now() - t0,
      timings,
      retrieval,
      toolExecutions: prepared.toolExecutions,
      ...(durable ? { durableContext: true } : {}),
      ...(modeNotice ? { modeNotice } : {}),
    };
    if (!wantsStream) {
      return res.json({ success: true, reply, response: reply, thinking, syllabus: syllabusRefs, pastQuestions: pastRefs, curriculum: curriculumRefs, mode, metadata, toolExecutions: prepared.toolExecutions, trace: traceBlocks, messageId: savedReplyId });
    }
    if (!doneSent) send("done", { reply, thinking, syllabus: syllabusRefs, pastQuestions: pastRefs, curriculum: curriculumRefs, mode, metadata, toolExecutions: prepared.toolExecutions, trace: traceBlocks, stopped: stopped(), messageId: savedReplyId });
    // The stored reply's id (ratings attach to it), once the save is done — plus the turn's full timings.
    send("saved", { messageId: savedReplyId, saved: turnSaved, timings });
    // The chips (started with the answer) — wait for them before closing the stream.
    if (suggestionsP) await suggestionsP.catch(() => []);
    return res.end();
  } catch (error) {
    console.error("[/chat/agent]", error);
    if (wantsStream && headersSent) {
      // Persist what the learner already saw (or an honest note when the
      // failure happened during tool work), so a refresh is never empty.
      const partial = streamedAnswer.trim();
      if (turnCtx?.conversationId && turnCtx.turnId) {
        try {
          await appendFastChatTurn({
            conversationId: turnCtx.conversationId, userId: req.user.id,
            sessionId: agentSessionId(turnCtx.conversationId), turnId: turnCtx.turnId,
            userMessage: turnCtx.userMessage, agentOnly: isContinuation,
            assistantMessage: partial
              ? `${partial}\n\n_The connection dropped while the agent was working. Please try again._`
              : "_The connection dropped while the agent was working before it could answer. Please try again._",
          });
        } catch (e) { console.warn("[/chat/agent] could not save the interrupted turn:", e?.message || e); }
      }
      send("error", { error: "The connection dropped while the agent was working. Reopening this chat in a moment will show what was saved." });
      return res.end();
    }
    return res.status(error?.status || 500).json({ error: error?.message || "Agent Chat is unavailable" });
  } finally {
    if (sessionTrackId) {
      const left = (activeSessionTurns.get(sessionTrackId) || 1) - 1;
      if (left > 0) activeSessionTurns.set(sessionTrackId, left); else activeSessionTurns.delete(sessionTrackId);
      // A card tap that landed while this turn was running could not start
      // its own continuation then (a turn was live); if an approved decision
      // is still unapplied now this turn has ended, start it here.
      if (!req.internalContinuation) scheduleDecisionContinuation({ userId: req.user?.id, user: req.user, sessionId: sessionTrackId });
    }
  }
}

router.post("/agent", agentChatHandler);

// ── Tap-triggered continuation (Option A — Matt, 2026-11-17) ───────────────
// A card tap records the decision only. When no turn is live in that chat,
// the tap itself resumes the SAME flow (headless, below): the turn opens
// with the decision already injected, the agent applies it with
// await_decision and narrates the outcome. The cue is an internal event for
// the model only — no user message is created or saved for the tap, so the
// chat gains only the agent's narration, appended under the card (Matt,
// 2026-11-17: "the tap should not send a new prompt"). The learner sends
// nothing, and the server posts nothing of its own into the chat. A tap that lands
// mid-turn is caught by the live turn's await_decision poll, or by the
// end-of-turn recheck in the handler's finally above.
// Kill switch: AKORO_TAP_CONTINUATION=false restores the old behaviour
// (a late tap waits for the learner's next message in that chat).

/** A sink response for a headless turn: the handler runs in full (prompt,
 * tools, persist) and its stream events go nowhere; the saved reply — the
 * agent's own narration — is the outcome the learner reads. */
function headlessRes() {
  const res = { statusCode: 200, destroyed: false, writableEnded: false, body: null,
    on: () => res, once: () => res, writeHead: () => res, write: () => true,
    end: () => { res.writableEnded = true; return res; },
    status: (code) => { res.statusCode = code; return res; },
    json: (payload) => { res.body = payload; res.writableEnded = true; return res; } };
  return res;
}

export function scheduleDecisionContinuation({ userId, user = null, sessionId } = {}) {
  if (process.env.AKORO_TAP_CONTINUATION === "false") return;
  if (!userId || !sessionId || !CHAT_SESSION_ID.test(sessionId)) return;
  if (decisionContinuations.has(sessionId) || activeSessionTurns.get(sessionId)) return;
  const run = (async () => {
    try {
      const { listConfirmedDecisions } = await import("../self-tooling/confirmations.js");
      const waiting = await listConfirmedDecisions(userId, sessionId).catch(() => []);
      if (!waiting.length) return;
      reportAgentActivity(userId, "Finishing what you approved…");
      const req = {
        user: user || { id: userId, role: "student" },
        body: { message: "[Card tap] The learner tapped Allow on the pending card in this chat — the decision is already recorded. Apply it now and narrate the outcome.", conversationId: sessionId, turnId: `tap${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}` },
        query: {}, headers: {}, internalContinuation: true,
      };
      await agentChatHandler(req, headlessRes());
      // Nudge the app: the outcome message is saved — show it now.
      try { global.io?.to(`user:${userId}`).emit("agent_chat_updated", { sessionId }); } catch { /* saved either way */ }
    } catch (e) {
      console.warn("[decision-continuation] failed:", e?.message || e);
    } finally {
      reportAgentActivity(userId, null);
      decisionContinuations.delete(sessionId);
    }
  })();
  decisionContinuations.set(sessionId, run);
}

// =============================================================
// HISTORY
// =============================================================

router.get("/history/:ownerId", async (req, res) => {
  try {
    const ownerId = req.user.id;   // token-scoped — ignore any :ownerId in the URL
    const { limit = 50, offset = 0, mode } = req.query;
    const params = mode ? [ownerId, mode, Number(limit), Number(offset)] : [ownerId, Number(limit), Number(offset)];
    const sql = mode
      ? `SELECT id, user_message, assistant_response, metadata, mode, created_at FROM chat_history WHERE agent_id=$1 AND mode=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`
      : `SELECT id, user_message, assistant_response, metadata, mode, created_at FROM chat_history WHERE agent_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
    const result = await query(sql, params);
    res.json({ success: true, history: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================
// DB MIGRATION
// =============================================================
async function runMigration() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID,
        user_message TEXT NOT NULL,
        assistant_response TEXT NOT NULL,
        metadata JSONB,
        mode TEXT DEFAULT 'standard',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_agent ON chat_history(agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_mode  ON chat_history(mode);
    `);
    console.log("✅ chat_history table ready");
  } catch (err) { console.error("[Chat] Migration error:", err.message); }
}
runMigration();

export default router;
