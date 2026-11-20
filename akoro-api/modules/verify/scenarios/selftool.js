// Self-tooling (plan §7, phase S1): the registry is safe and matches the database.
// The checks themselves live in ./selftool/, split by concern; each scenario stays
// registered here with the same name, area, risk and params.
import { runViewsMatchSchema, runSchemaLookupSafe, runAgentUsesSchemaLookup, runCreateSpecMatchesDb, runCreateRejectsForbidden, runMyLibraryView } from "./selftool/createChecks.js";
import { runAgentBuildsTool, runAgentEscalates, runCodeToolBuilt } from "./selftool/dryRun.js";
import { runRegisterReuseDisable, runEscalateAndResume, runWriteConfirm, runGroupTotal, runDecisionFollowUp } from "./selftool/writes.js";
import { runPromotionCheck, runPromotePlatform, DEFAULT_PROMOTION_TESTERS } from "./selftool/promotion.js";
import { runSandboxContained } from "./selftool/sandbox.js";
import { runInstructorToolMatchesDb, runInstructorScope, runInstructorAgentBuilds } from "./selftool/instructors.js";
import { runPermissionRequestIsReal, runToolJourney, runDeleteTasks } from "./selftool/journeys.js";
import { runComponentRequest, runComponentRequestDelivered, runBugReportDelivered, runRequestStatusLifecycle } from "./selftool/requests.js";

export const viewsMatchSchema = {
  name: "selftool.views_match_schema", area: "self-tooling", risk: "read",
  description: "Every Data View's fields exist on the live database (a view never promises a column that isn't there).",
  async run(ctx, p) {
    return runViewsMatchSchema(ctx, p);
  },
};

export const schemaLookupSafe = {
  name: "selftool.schema_lookup_safe", area: "self-tooling", risk: "read",
  description: "schema_lookup returns only registry views/fields, never tables or secrets, and flags forbidden goals.",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    return runSchemaLookupSafe(ctx, p);
  },
};

export const agentUsesSchemaLookup = {
  name: "selftool.agent_uses_schema_lookup", area: "self-tooling", risk: "dry", repeats: 3,
  description: "Asked something no existing tool answers (session hours per month), the agent checks schema_lookup instead of guessing.",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    return runAgentUsesSchemaLookup(ctx, p);
  },
};

export const createSpecMatchesDb = {
  name: "selftool.create_spec_matches_db", area: "self-tooling", risk: "dry",
  description: "create_tool builds a per-subject past-question summary whose numbers equal a direct database query (dry: nothing saved).",
  params: { learner: { default: "@tester21" } },
  async run(ctx, p) {
    return runCreateSpecMatchesDb(ctx, p);
  },
};

export const createRejectsForbidden = {
  name: "selftool.create_rejects_forbidden", area: "self-tooling", risk: "dry",
  description: "create_tool refuses goals about other learners' private data or secrets — no tool, no rows.",
  params: { learner: { default: "@tester21" } },
  async run(ctx, p) {
    return runCreateRejectsForbidden(ctx, p);
  },
};

export const registerReuseDisable = {
  name: "selftool.register_reuse_disable", area: "self-tooling", risk: "write",
  description: "A built tool is saved for its learner, runs again by name, and stops the moment it's turned off.",
  params: { learner: { default: "@tester22" } },
  async run(ctx, p) {
    return runRegisterReuseDisable(ctx, p);
  },
};

export const agentBuildsTool = {
  name: "selftool.agent_builds_tool", area: "self-tooling", risk: "dry", repeats: 3,
  description: "Asked something no tool answers (learning-session hours per month), the agent builds a tool, it is verified, and the answer comes from its result — in plain words.",
  params: { learner: { default: "@tester21" } },
  async run(ctx, p) {
    return runAgentBuildsTool(ctx, p);
  },
};

export const escalateAndResume = {
  name: "selftool.escalate_and_resume", area: "self-tooling", risk: "write",
  description: "A goal needing a locked capability becomes one admin request (deduped); approval grants it, the build resumes as the learner and the answer lands in the same chat with a notification; revoking stops the saved tool.",
  params: { learner: { default: "@tester24" } },
  async run(ctx, p) {
    return runEscalateAndResume(ctx, p);
  },
};

export const agentEscalates = {
  name: "selftool.agent_escalates", area: "self-tooling", risk: "dry", repeats: 3,
  description: "Asked about other players' results in battles they played (a locked capability), the agent goes through create_tool, which comes back escalated, and tells the learner it needs an admin's permission — no request is made in a dry run.",
  params: { learner: { default: "@tester41" } },
  async run(ctx, p) {
    return runAgentEscalates(ctx, p);
  },
};

export const promotionCheck = {
  name: "selftool.promotion_check", area: "self-tooling", risk: "read",
  description: "A learner's tool, before it goes to every learner: it validates, its capabilities are allowed, and its samples run cleanly as three test learners (each sees only their own data) and return data for at least one.",
  params: { toolId: { default: null }, testers: { default: DEFAULT_PROMOTION_TESTERS } },
  async run(ctx, p) {
    return runPromotionCheck(ctx, p);
  },
};

export const promotePlatform = {
  name: "selftool.promote_platform", area: "self-tooling", risk: "write",
  description: "A learner's tool is promoted to every learner only after the promotion check PASSes; another learner then sees it and runs it on THEIR own data; revoking it stops it for them.",
  params: { learner: { default: "@tester25" }, other: { default: "@tester26" } },
  async run(ctx, p) {
    return runPromotePlatform(ctx, p);
  },
};

export const sandboxContained = {
  name: "selftool.sandbox_contained", area: "self-tooling", risk: "read",
  description: "On the deployed server the code sandbox runs plain code and contains escape attempts: no network or host objects, infinite loops and memory bombs stopped, prototype tampering confined to one run.",
  async run(ctx, p) {
    return runSandboxContained(ctx, p);
  },
};

export const codeToolBuilt = {
  name: "selftool.code_tool", area: "self-tooling", risk: "dry", repeats: 3,
  description: "A goal only code can express (spread my weakest topics over the days before an exam, two a day, weakest first, no Sundays) is built as a sandboxed code tool, verified, and its plan obeys every rule on the learner's real topics.",
  params: { learner: { default: "@tester21" } },
  async run(ctx, p) {
    return runCodeToolBuilt(ctx, p);
  },
};

export const writeConfirm = {
  name: "selftool.write_confirm", area: "self-tooling", risk: "write",
  description: "A tool that changes data proposes exactly which rows and changes nothing until the learner confirms; declining changes nothing; another learner can't confirm it; confirming applies it once; a dry run proposes nothing.",
  params: { learner: { default: "@tester27" }, other: { default: "@tester28" } },
  async run(ctx, p) {
    return runWriteConfirm(ctx, p);
  },
};

export const instructorToolMatchesDb = {
  name: "selftool.instructor_tool_matches_db", area: "self-tooling", risk: "dry",
  description: "An instructor's tool (average grade per activity across their classes) is built from instructor views only, and its numbers equal a direct database query.",
  params: { instructor: { default: "@tester51" } },
  async run(ctx, p) {
    return runInstructorToolMatchesDb(ctx, p);
  },
};

export const instructorScope = {
  name: "selftool.instructor_scope", area: "self-tooling", risk: "read",
  description: "Instructor views hold only that instructor's own classes and activities (never another teacher's), show students by name only, and learners can't reach them.",
  params: { a: { default: "@tester51" }, b: { default: "@tester52" }, learner: { default: "@tester01" } },
  async run(ctx, p) {
    return runInstructorScope(ctx, p);
  },
};

export const instructorAgentBuilds = {
  name: "selftool.instructor_agent_builds", area: "self-tooling", risk: "dry", repeats: 3,
  description: "Asked in chat for the average grade on each of their activities, the instructor's agent builds a tool and answers from it — with the database's numbers.",
  params: { instructor: { default: "@tester51" } },
  async run(ctx, p) {
    return runInstructorAgentBuilds(ctx, p);
  },
};

export const permissionRequestIsReal = {
  name: "selftool.permission_request_is_real", area: "self-tooling", risk: "write",
  description: "Asked to delete tasks, then to ask for permission, the agent makes a real request — a permission card the learner approves (own data) or one on the admins' Agent requests page — and only ever says a request was made when one exists.",
  params: { learner: { default: "@tester25" }, first: { default: "Delete my old tasks please." }, prompt: { default: "Ask for permission to delete task" } },
  async run(ctx, p) {
    return runPermissionRequestIsReal(ctx, p);
  },
};

export const toolJourney = {
  name: "selftool.tool_journey", area: "self-tooling", risk: "write",
  description: "Create a tool that needs a permission, approve it as the admin, then use it as the learner in Agent Chat; revoking stops it.",
  params: { learner: { default: "@tester26" } },
  async run(ctx, p) {
    return runToolJourney(ctx, p);
  },
};

export const deleteTasks = {
  name: "selftool.delete_tasks", area: "self-tooling", risk: "write",
  description: "No tool deletes tasks: the agent drafts one and shows the permission card in the same reply (no admin, no offer round); after Approve its next turn runs the tool and shows one change card; it deletes only what the learner confirms, then looks again; admins see the new tool.",
  params: { learner: { default: "@tester29" }, first: { default: "Delete my old tasks please." } },
  async run(ctx, p) {
    return runDeleteTasks(ctx, p);
  },
};

export const componentRequest = {
  name: "selftool.component_request", area: "self-tooling", risk: "write",
  description: "A learner asks for a missing learning COMPONENT (a study method), not a tool: submit_tool_request stores it with kind='component' in the admins' queue (deduped), and the conversation transcript is kept in the run evidence.",
  params: { learner: { default: "@tester26" }, prompt: { default: "Please send the admins a feature request for a new learning method — an active-recall component that hides my notes and asks me to recall them from memory. Submit it as a component request." } },
  async run(ctx, p) {
    return runComponentRequest(ctx, p);
  },
};

export const componentRequestDelivered = {
  name: "selftool.component_request_delivered", area: "self-tooling", risk: "write",
  description: "The full learner → admin → learner circle for a component request: filed (kind=component) → admin marks it implemented with a note → the learner is notified → the learner's agent confirms it is ready via check_my_requests (transcript kept in evidence).",
  params: { learner: { default: "@tester27" } },
  async run(ctx, p) {
    return runComponentRequestDelivered(ctx, p);
  },
};

export const myLibraryView = {
  name: "selftool.my_library_view", area: "self-tooling", risk: "read",
  description: "The Library has a Data View over edu.records (uploaded documents), scoped to the learner and excluding soft-deleted rows — not the taught study notes, and with no subject breakdown.",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    return runMyLibraryView(ctx, p);
  },
};

export const groupTotal = {
  name: "selftool.group_total", area: "self-tooling", risk: "write",
  description: "A grouped query's total equals the sum of the group counts (records), not the number of groups.",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    return runGroupTotal(ctx, p);
  },
};

export const bugReportDelivered = {
  name: "selftool.bug_report_delivered", area: "self-tooling", risk: "write",
  description: "The full bug-report circle: submit_bug_report (kind=bug) → admin marks it fixed → the learner is notified → the agent also messages them in chat → check_my_requests shows it.",
  params: { learner: { default: "@tester28" } },
  async run(ctx, p) {
    return runBugReportDelivered(ctx, p);
  },
};

export const requestStatusLifecycle = {
  name: "selftool.request_status_lifecycle", area: "self-tooling", risk: "write", timeoutMs: 240_000,
  description: "A tool request moved through EVERY review status (under review, planned, declined, implemented) notifies the learner and posts an agent chat update each time; on a real agent turn the learner asks for the status and the agent checks and reports it.",
  params: { learner: { default: "@tester29" } },
  async run(ctx, p) {
    return runRequestStatusLifecycle(ctx, p);
  },
};

export const decisionFollowUp = {
  name: "selftool.decision_followup", area: "self-tooling", risk: "write", timeoutMs: 120_000,
  description: "After a confirm, the server runs an agent turn and posts its reply — asserted by the deterministic follow-up message id (sha256 of the confirmation id).",
  params: { learner: { default: "@tester27" } },
  async run(ctx, p) {
    return runDecisionFollowUp(ctx, p);
  },
};
