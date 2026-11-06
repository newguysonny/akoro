// The scenario registry. Add a scenario: export it from an area file and list it here.
import { healthBuild, toolsCatalogue, sessionTokensOnly, r2Live, embeddingsLive, embeddingsCompare, searchTextFallback } from "./smoke.js";
import { scheduleMessageHere, toolErrorHonesty, pastQuestionsTruth, historyTools, readToolsRun, dryRunNoWrites, protegeIdentity, historyPages } from "./chat.js";
import { followUpDeliverIntoChat, taskDueInMinutes, noResidue, sweepStale } from "./writes.js";
import { viewsMatchSchema, schemaLookupSafe, agentUsesSchemaLookup, createSpecMatchesDb, createRejectsForbidden, registerReuseDisable, agentBuildsTool, escalateAndResume, agentEscalates, promotionCheck, promotePlatform, sandboxContained, codeToolBuilt, writeConfirm, instructorToolMatchesDb, instructorScope, instructorAgentBuilds, permissionRequestIsReal, toolJourney, deleteTasks } from "./selftool.js";
import { privacyEdges } from "./network.js";
import { rateLimitCountedOnce, battleEntryGates } from "./platform.js";
import { realUserRun } from "./realuser.js";
import { syllabusCoverage } from "./curriculum.js";
import { planCompletes, practiceChargedOnce, generatedOutline, agentCheckBattle, agentCheckStop, classSyllabusFirst, workflowMirror, agentWakes, replaceAndCancel, teachingHandoff } from "./studyprep.js";
import { eventStream } from "./eventStream.js";
import { bridgePersists } from "./teaching.js";
import { conceptCurve } from "./decay.js";
import { suggestionsAnswer, suggestionsSurviveRefresh, studyToolRouting, untaughtFlashcards } from "./suggestions.js";
import { tailoredChips } from "./tailored.js";
import { chatUploadFiled, pastPaperStructured, sortOwnFolders, materialsMultiFileDiag } from "./materials.js";
import { readyProposal, goalWork, ideasFlow, consentsQuietBudget, instructorProactive } from "./proactiveP13.js";
import { voiceSpeak, voiceLive } from "./voice.js";
import { paperStructured, chatToSubmissionScenarios } from "./activities.js";
import { gradingScenarios } from "./grading.js";
import { authoringVersionsParts, authoringDiagramsEdits } from "./authoring.js";
import { inboxOneList } from "./inbox.js";
import { quietLearningPass } from "./quietLearning.js";
import { MEMORY_RECALL } from "./memoryRecall.js";
import { CHAT_CONTINUITY } from "./chatContinuity.js";
import { NETWORK_AUTO } from "./networkAuto.js";
import { imageExtraction } from "./imageExtraction.js";
import { LEARNING_EVENTS } from "./learningEvents.js";
import { LEARNER_MODEL } from "./learnerModel.js";
import { STUDY_PREP_EXIT } from "./studyPrepExit.js";
import { plannerRichGather } from "./richGather.js";
import { proactiveInChat } from "./proactiveChat.js";
import { kindObserveThenLive, outboxDelivery } from "./proactiveModes.js";
import { readerBackend } from "./reader.js";
import { socketSession, guideIdeasSession } from "./socket.js";
import { SELFTOOL_CHANGES } from "./selftoolChanges.js";
import { courseOneRecord, sessionReminders } from "./courses.js";
import { teachingToolRouting, teachingToolRuns, activityToolRouting, draftLifecycle, routineLifecycle, toolsAllOpen } from "./instructorTools.js";
import { battleFromChat, battleReviewFromChat, selfStudyFull, assignmentPreviewAssign, journeyBattleStage } from "./instructorActivities.js";
import { teachingToolScenarios, teachingToolVersions, teachingToolTry } from "./teachingTools.js";
import { deferredRelease } from "./redisIdle.js";
import { guideReviewRuns } from "./guideReview.js";
import { battleSeriesRuns } from "./battleSeries.js";
import { battleChatScenarios } from "./battleChat.js";
import { activityReviewRuns, activityReviewPlay } from "./activityReview.js";
import { activityChatScenarios } from "./activityChat.js";
import { evalsRun, evalsResult } from "./evals.js";
import { agentTurns, teachingOutcomes } from "./teachingAgent.js";
import { decayReviewFlow } from "./decayReview.js";
import { syllabusImportExample, syllabusImportCost, syllabusImportBatch, syllabusImportSplit, curriculumImportExample } from "./syllabusImport.js";
import { practiceProctoredFlow, practiceIntegrityFlagged } from "./practice.js";
import { dashboardDescriptors, needsYouCategories } from "./dashboard.js";
import { ratingSavedNotInPrompt, promptOverrideFlagged } from "./ratingsPrompts.js";
import { teacherSchoolReads, paymentsSingleMount, courseInviteJoin, sharedSecretsFailClosed, noFallbackSecrets, ownershipReads } from "./security.js";
import { loopGuardTimeLimits, actionBasis } from "./agentHygiene.js";
import { schoolStrugglesScope, modelPickerResolution } from "./schoolStruggles.js";
import { PHASE11_UI } from "./phase11Ui.js";

const ALL = [healthBuild, toolsCatalogue, sessionTokensOnly, r2Live, embeddingsLive, embeddingsCompare, searchTextFallback, scheduleMessageHere, toolErrorHonesty, pastQuestionsTruth, historyTools, readToolsRun, dryRunNoWrites, protegeIdentity,
  privacyEdges, rateLimitCountedOnce, battleEntryGates, followUpDeliverIntoChat, taskDueInMinutes, noResidue,
  viewsMatchSchema, schemaLookupSafe, agentUsesSchemaLookup, createSpecMatchesDb, createRejectsForbidden, registerReuseDisable, agentBuildsTool, escalateAndResume, agentEscalates, promotionCheck, promotePlatform, sandboxContained, codeToolBuilt, writeConfirm, instructorToolMatchesDb, instructorScope, instructorAgentBuilds, realUserRun, syllabusCoverage, planCompletes, practiceChargedOnce, generatedOutline, bridgePersists, conceptCurve, suggestionsAnswer, suggestionsSurviveRefresh, studyToolRouting, untaughtFlashcards, tailoredChips, chatUploadFiled, pastPaperStructured, sortOwnFolders, materialsMultiFileDiag, readyProposal, goalWork, ideasFlow, consentsQuietBudget, instructorProactive, voiceSpeak, voiceLive, sweepStale, agentCheckBattle, agentCheckStop, classSyllabusFirst, historyPages, workflowMirror, agentWakes, replaceAndCancel, teachingHandoff, eventStream, paperStructured, ...chatToSubmissionScenarios, ...gradingScenarios, authoringVersionsParts, authoringDiagramsEdits, inboxOneList, quietLearningPass, plannerRichGather, proactiveInChat, readerBackend, socketSession, guideIdeasSession, courseOneRecord,
  teachingToolRouting, teachingToolRuns, activityToolRouting, draftLifecycle, routineLifecycle,
  battleFromChat, battleReviewFromChat, selfStudyFull, assignmentPreviewAssign, journeyBattleStage, ...teachingToolScenarios, teachingToolVersions, teachingToolTry, toolsAllOpen, deferredRelease, sessionReminders, guideReviewRuns, battleSeriesRuns, ...battleChatScenarios, activityReviewRuns, activityReviewPlay, ...activityChatScenarios, permissionRequestIsReal, toolJourney, deleteTasks, ...SELFTOOL_CHANGES, evalsRun, evalsResult, teacherSchoolReads, paymentsSingleMount, courseInviteJoin, agentTurns, teachingOutcomes, sharedSecretsFailClosed, noFallbackSecrets, ownershipReads, decayReviewFlow, practiceProctoredFlow, practiceIntegrityFlagged, dashboardDescriptors, needsYouCategories, loopGuardTimeLimits, actionBasis, schoolStrugglesScope, modelPickerResolution, kindObserveThenLive, outboxDelivery, ratingSavedNotInPrompt, promptOverrideFlagged, syllabusImportExample, syllabusImportCost, syllabusImportBatch, syllabusImportSplit, curriculumImportExample, ...MEMORY_RECALL, ...CHAT_CONTINUITY, ...NETWORK_AUTO, imageExtraction, ...LEARNING_EVENTS, ...LEARNER_MODEL, ...STUDY_PREP_EXIT, ...PHASE11_UI];

export const SCENARIOS = Object.fromEntries(ALL.map((s) => [s.name, s]));

export const SUITES = {
  smoke: ["smoke.health_build", "smoke.tools_catalogue", "smoke.session_tokens_only", "ratelimit.counted_once"],
  storage: ["smoke.r2_live"],
  embeddings: ["smoke.embeddings_live"],
  "embeddings-compare": ["smoke.embeddings_compare"],
  search: ["smoke.search_text_fallback"],
  "agent-chat": ["chat.schedule_message_here", "chat.tool_error_honesty", "chat.past_questions_truth", "chat.history_tools", "chat.read_tools_run", "chat.dry_run_no_writes", "chat.protege_identity"],
  "chat-history": ["chat.history_pages", "writes.no_residue"],
  // Assignments on paper: structured AI output, cropped drawings, the submission template.
  // The reader's backend: extraction, the guide, the study tools, kept items.
  reader: ["reader.backend", "teaching.socket_session", "writes.no_residue"],
  activities: ["activity.paper_structured", "activity.chat_maths_equations", "activity.chat_science_photosynthesis",
    "activity.chat_economics_case_study", "activity.chat_biology_cell", "writes.no_residue"],
  // Grading settings and instant scores: answer format, private mark scheme, score in seconds, the Review paper.
  grading: ["grading.answer_format_enforced", "grading.mark_scheme_private", "grading.instant_score", "grading.draft_paper_review", "writes.no_residue"],
  // The model path: rubric written by the AI, answers marked against it, score in seconds (costs AI credit).
  "grading-ai": ["grading.rubric_to_instant_score", "writes.no_residue"],
  // Teachers' follow-ups in one conversation: versions, parts, edits to specific questions, diagrams.
  authoring: ["activity.authoring_versions_parts", "activity.authoring_diagrams_edits", "writes.no_residue"],
  // The proactive agent (Grand Plan §7.16): one inbox, by-kind accept, dismiss reasons.
  proactive: ["agent.inbox_one_list", "agent.quiet_learning", "agent.planner_rich_gather", "agent.proactive_in_chat", "agent.ready_proposal", "agent.goal_work", "agent.ideas", "agent.consents_quiet", "agent.instructor_proactive", "agent.kind_observe_then_live", "writes.no_residue"],
  // Real changes on test learners, then proof nothing was left behind.
  writes: ["tasks.create_due_in_minutes", "followups.deliver_into_chat", "writes.no_residue"],
  // Phase V4 end to end (sandbox only: BLOCKED on production).
  "real-user": ["verify.real_user_run", "writes.no_residue"],
  // One course record: Course Creator edits the courses row learners and schedules read.
  courses: ["courses.one_record", "courses.session_reminders"],
  // Redis idle cost: far-off jobs in Postgres, one background worker, drained old queues.
  redis: ["ops.deferred_release"],
  // Reviews with the teaching guide (and, next, recurring battles).
  "battle-model": ["battles.guide_review", "battles.recurring", "activity.review_battle", "activity.review_battle_play"],
  "activity-chat": ["activity_chat.ask_missing", "activity_chat.battle_self_study_ask", "activity_chat.switch_type_asks", "activity_chat.assignment_parts_instructions", "activity_chat.assignment_versions", "activity_chat.assignment_assign", "activity_chat.self_study_assign"],
  "battle-chat": ["battles.chat_network", "battles.chat_posts", "battles.chat_class", "battles.chat_instructor"],
  curriculum: ["curriculum.syllabus_coverage"],
  // The instructor's agent tools from chat: teaching tools (Library) and activity tools (drafts, routines, results).
  "instructor-chat": ["instructor.teaching_tool_routing", "instructor.activity_tool_routing", "instructor.teaching_tool_runs", "instructor.draft_lifecycle", "instructor.routine_lifecycle", "writes.no_residue"],
  // Each activity type from chat to assigned (battle, study review, self study, assignment), then every teaching tool from chat to the Library.
  "instructor-activities": ["instructor.battle_from_chat", "instructor.battle_review_from_chat", "instructor.self_study_full", "instructor.assignment_preview_assign", "instructor.journey_battle_stage", "writes.no_residue"],
  "instructor-teaching-tools": ["instructor.tools_all_open", ...teachingToolScenarios.map((t) => t.name), "instructor.teaching_tool_versions", "writes.no_residue"],
  teaching: ["teaching.bridge_persists"],
  decay: ["decay.concept_curve"],
  // Phase 11 / Phase 18 item 2: dashboard descriptors with deterministic routes, and the one "needs you" list.
  dashboard: ["workflow.dashboard_descriptors", "workflow.needs_you_categories"],
  suggestions: ["chat.suggestions_answer", "chat.tailored_chips", "chat.suggestions_survive_refresh", "chat.study_tool_routing", "chat.untaught_flashcards", "writes.no_residue"],
  // Materials to study (§7.17): chat uploads filed in a Library folder, Undo.
  voice: ["voice.speak_deepgram", "voice.live_deepgram"],
  // Clear what cut-short runs left on the test learners, then prove it is gone.
  sweep: ["writes.sweep_stale", "writes.no_residue"],
  materials: ["materials.chat_upload_filed", "materials.past_paper_structured", "materials.sort_own_folders", "writes.no_residue"],
  "study-prep": ["studyprep.plan_completes", "studyprep.practice_charged_once", "studyprep.generated_outline", "studyprep.class_syllabus_first", "studyprep.workflow_mirror", "studyprep.agent_wakes", "studyprep.replace_and_cancel", "studyprep.teaching_handoff", "workflow.event_stream", "writes.no_residue"],
  // Grand Plan Phase 4 + 5 exit: the operation → context set mapping, and Study Prep end to end without Teaching.
  "study-prep-exit": ["context.sets_per_operation", "studyprep.inline_full", "studyprep.plan_rejection", "studyprep.budget_ceiling", "studyprep.cap_out", "writes.no_residue"],
  "agent-check": ["studyprep.agent_check_battle", "studyprep.agent_check_stop", "writes.no_residue"],
  "agent-network": ["network.privacy_edges"],
  // Phase 18 items 3 and 6: the loop guard, tool time limits, asked or inferred;
  // items 4 and 7: ratings on agent replies, admin-editable prompts.
  "agent-hygiene": ["agent.loop_guard_time_limits", "agent.action_basis", "ratings.saved_not_in_prompt", "prompts.override_flagged", "writes.no_residue"],
  battles: ["battles.entry_gates"],
  // Phase 11 UI backends: the school's struggles view (D39) and the chat's model picker (§7.11.5).
  "phase11-ui": ["school.struggles_scope", "models.picker_resolution", "models.tier_lists", "teaching.direct_workflow", "school.struggles_recorded"],
  "self-tooling": ["selftool.views_match_schema", "selftool.schema_lookup_safe", "selftool.create_spec_matches_db", "selftool.create_rejects_forbidden",
    "selftool.agent_builds_tool", "selftool.agent_uses_schema_lookup", "selftool.agent_escalates", "selftool.sandbox_contained", "selftool.code_tool",
    "selftool.instructor_scope", "selftool.instructor_tool_matches_db", "selftool.instructor_agent_builds"],
  "self-tooling-writes": ["selftool.register_reuse_disable", "selftool.escalate_and_resume", "selftool.tool_journey", "selftool.promote_platform", "selftool.write_confirm", "selftool.delete_tasks", "selftool.change_tasks_reschedule", "selftool.change_tasks_priority", "selftool.change_goals", "selftool.change_inbox_read", "selftool.change_chats_delete", "selftool.change_unsupported", "writes.no_residue"],
  // Self-tooling scenarios that need the feature on stay in their own suite
  // (BLOCKED while the flag is off); the schema check runs everywhere.
  // One dry build (create_spec_matches_db) exercises the whole create_tool
  // path — a broken save path once slipped past every other scenario.
  regression: ALL.filter((s) => s.risk !== "write" && s.regression !== false && (!s.name.startsWith("selftool.") || ["selftool.views_match_schema", "selftool.create_spec_matches_db", "selftool.sandbox_contained"].includes(s.name))).map((s) => s.name),
};
