// The scenario registry. Add a scenario: export it from an area file and list it here.
import { healthBuild, toolsCatalogue } from "./smoke.js";
import { scheduleMessageHere, toolErrorHonesty, pastQuestionsTruth, historyTools, readToolsRun, dryRunNoWrites, protegeIdentity, historyPages } from "./chat.js";
import { followUpDeliverIntoChat, taskDueInMinutes, noResidue } from "./writes.js";
import { viewsMatchSchema, schemaLookupSafe, agentUsesSchemaLookup, createSpecMatchesDb, createRejectsForbidden, registerReuseDisable, agentBuildsTool, escalateAndResume, agentEscalates, promotionCheck, promotePlatform, sandboxContained, codeToolBuilt, writeConfirm, instructorToolMatchesDb, instructorScope, instructorAgentBuilds } from "./selftool.js";
import { privacyEdges } from "./network.js";
import { rateLimitCountedOnce, battleEntryGates } from "./platform.js";
import { realUserRun } from "./realuser.js";
import { syllabusCoverage } from "./curriculum.js";
import { planCompletes, practiceChargedOnce, generatedOutline, agentCheckBattle, classSyllabusFirst, workflowMirror } from "./studyprep.js";
import { bridgePersists } from "./teaching.js";
import { conceptCurve } from "./decay.js";
import { suggestionsAnswer } from "./suggestions.js";
import { paperStructured, chatToSubmissionScenarios } from "./activities.js";
import { authoringVersionsParts, authoringDiagramsEdits } from "./authoring.js";
import { inboxOneList } from "./inbox.js";
import { quietLearningPass } from "./quietLearning.js";
import { plannerRichGather } from "./richGather.js";
import { readerBackend } from "./reader.js";
import { socketSession } from "./socket.js";

const ALL = [healthBuild, toolsCatalogue, scheduleMessageHere, toolErrorHonesty, pastQuestionsTruth, historyTools, readToolsRun, dryRunNoWrites, protegeIdentity,
  privacyEdges, rateLimitCountedOnce, battleEntryGates, followUpDeliverIntoChat, taskDueInMinutes, noResidue,
  viewsMatchSchema, schemaLookupSafe, agentUsesSchemaLookup, createSpecMatchesDb, createRejectsForbidden, registerReuseDisable, agentBuildsTool, escalateAndResume, agentEscalates, promotionCheck, promotePlatform, sandboxContained, codeToolBuilt, writeConfirm, instructorToolMatchesDb, instructorScope, instructorAgentBuilds, realUserRun, syllabusCoverage, planCompletes, practiceChargedOnce, generatedOutline, bridgePersists, conceptCurve, suggestionsAnswer, agentCheckBattle, classSyllabusFirst, historyPages, workflowMirror, paperStructured, ...chatToSubmissionScenarios, authoringVersionsParts, authoringDiagramsEdits, inboxOneList, quietLearningPass, plannerRichGather, readerBackend, socketSession];

export const SCENARIOS = Object.fromEntries(ALL.map((s) => [s.name, s]));

export const SUITES = {
  smoke: ["smoke.health_build", "smoke.tools_catalogue", "ratelimit.counted_once"],
  "agent-chat": ["chat.schedule_message_here", "chat.tool_error_honesty", "chat.past_questions_truth", "chat.history_tools", "chat.read_tools_run", "chat.dry_run_no_writes", "chat.protege_identity"],
  "chat-history": ["chat.history_pages", "writes.no_residue"],
  // Assignments on paper: structured AI output, cropped drawings, the submission template.
  // The reader's backend: extraction, the guide, the study tools, kept items.
  reader: ["reader.backend", "teaching.socket_session", "writes.no_residue"],
  activities: ["activity.paper_structured", "activity.chat_maths_equations", "activity.chat_science_photosynthesis",
    "activity.chat_economics_case_study", "activity.chat_biology_cell", "writes.no_residue"],
  // Teachers' follow-ups in one conversation: versions, parts, edits to specific questions, diagrams.
  authoring: ["activity.authoring_versions_parts", "activity.authoring_diagrams_edits", "writes.no_residue"],
  // The proactive agent (Grand Plan §7.16): one inbox, by-kind accept, dismiss reasons.
  proactive: ["agent.inbox_one_list", "agent.quiet_learning", "agent.planner_rich_gather", "writes.no_residue"],
  // Real changes on test learners, then proof nothing was left behind.
  writes: ["tasks.create_due_in_minutes", "followups.deliver_into_chat", "writes.no_residue"],
  // Phase V4 end to end (sandbox only: BLOCKED on production).
  "real-user": ["verify.real_user_run", "writes.no_residue"],
  curriculum: ["curriculum.syllabus_coverage"],
  teaching: ["teaching.bridge_persists"],
  decay: ["decay.concept_curve"],
  suggestions: ["chat.suggestions_answer"],
  "study-prep": ["studyprep.plan_completes", "studyprep.practice_charged_once", "studyprep.generated_outline", "studyprep.class_syllabus_first", "studyprep.workflow_mirror", "writes.no_residue"],
  "agent-check": ["studyprep.agent_check_battle", "writes.no_residue"],
  "agent-network": ["network.privacy_edges"],
  battles: ["battles.entry_gates"],
  "self-tooling": ["selftool.views_match_schema", "selftool.schema_lookup_safe", "selftool.create_spec_matches_db", "selftool.create_rejects_forbidden",
    "selftool.agent_builds_tool", "selftool.agent_uses_schema_lookup", "selftool.agent_escalates", "selftool.sandbox_contained", "selftool.code_tool",
    "selftool.instructor_scope", "selftool.instructor_tool_matches_db", "selftool.instructor_agent_builds"],
  "self-tooling-writes": ["selftool.register_reuse_disable", "selftool.escalate_and_resume", "selftool.promote_platform", "selftool.write_confirm", "writes.no_residue"],
  // Self-tooling scenarios that need the feature on stay in their own suite
  // (BLOCKED while the flag is off); the schema check runs everywhere.
  // One dry build (create_spec_matches_db) exercises the whole create_tool
  // path — a broken save path once slipped past every other scenario.
  regression: ALL.filter((s) => s.risk !== "write" && s.regression !== false && (!s.name.startsWith("selftool.") || ["selftool.views_match_schema", "selftool.create_spec_matches_db", "selftool.sandbox_contained"].includes(s.name))).map((s) => s.name),
};
