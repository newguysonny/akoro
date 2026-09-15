import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Activity drafts contract — AI activity creation with human-in-the-loop.
 *
 * The instructor's agent PREPARES activity drafts from chat (prepare_activity
 * tool over the bench's own data shapes, all six workbench types, audience
 * required — the agent asks when the instructor didn't say who it's for).
 * Assigning is NEVER a tool: the chat renders a Preview button, the preview
 * opens side-by-side with the conversation, and only the human's Assign —
 * the draft-assign endpoint — replays the payload through the ONE shared
 * create path the activities workbench uses (targets, notifications, ding).
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [migration, manifest, service, drafts, routes, chat, page, panel, chatPage, gateway, studentAgent, routinesMigration, routines, outcomes, appJs, instructorChatPage, classroomsMigration, guide, aiModel] = await Promise.all([
  read("./2026-activity-drafts.sql"),
  read("./manifest.json"),
  read("../../akoro-api/modules/self-study/createAssignment.js"),
  read("../../akoro-api/modules/self-study/drafts.js"),
  read("../../akoro-api/modules/self-study/routes.js"),
  read("../../akoro-api/modules/adaptive-learning/chat.js"),
  read("../../akoro-instructor/src/pages/ActivitiesPage.jsx"),
  read("../../akoro-instructor/src/components/ActivityPreviewPanel.jsx"),
  read("../../akoro-instructor/src/pages/ChatPage.jsx"),
  read("../../akoro-api/modules/agent-tools/routes.js"),
  read("../../akoro-python-agent/src/agent/adaptive/student.py"),
  read("../../akoro-api/migrations/2026-draft-routines.sql"),
  read("../../akoro-api/modules/self-study/routines.js"),
  read("../../akoro-api/modules/self-study/outcomes.js"),
  read("../../akoro-api/app.js"),
  read("../../akoro-instructor/src/pages/ChatPage.jsx"),
  read("../../akoro-api/migrations/2026-classrooms-created-by.sql"),
  read("../../akoro-api/modules/adaptive-learning/agents/nana-esumai/guide.js"),
  read("../../akoro-api/lib/aiModel.js"),
]);

test("the migration keeps drafts private and provenance-carrying", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS activity_drafts/);
  assert.match(migration, /payload\s+JSONB NOT NULL DEFAULT '\{\}'/);
  assert.match(migration, /audience\s+JSONB NOT NULL DEFAULT '\{\}'/);
  assert.match(migration, /status\s+TEXT NOT NULL DEFAULT 'draft'/);
  assert.match(migration, /assignment_id UUID/);
  assert.match(migration, /REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /source\s+TEXT NOT NULL DEFAULT 'ai_chat'/);
  assert.match(manifest, /2026-activity-drafts\.sql/, "manifest registers the migration");
});

test("one creation path: the bench route and the draft approval share it", () => {
  // The service owns insert + targets + notify + socket ding.
  assert.match(service, /from\("self_study_assignments"\)\.insert\(/);
  assert.match(service, /from\("self_study_targets"\)/);
  assert.match(service, /type: "self_study_assigned"/);
  assert.match(service, /emit\("self_study_assigned"/);
  // The workbench route is a thin wrapper — no second inline create path.
  const postRoot = routes.slice(routes.indexOf('router.post("/", requireRole(TEACHER_ROLES)'), routes.indexOf('router.get("/drafts"') >= 0 ? routes.length : undefined);
  assert.match(routes, /await createAssignment\(req\.user, req\.body\)/);
  assert.doesNotMatch(routes, /self_study_assignments"\)\.insert/);
  // Draft assign replays through the same service.
  assert.match(drafts, /import \{[\s\S]*createAssignment[\s\S]*\} from "\.\/createAssignment\.js"/);
  assert.match(drafts, /await createAssignment\(instructor, payload\)/);
  // Claim-first: status flips before creation; the assignment id links after.
  assert.match(drafts, /update\({ status: "assigned", resolved_at: new Date\(\)\.toISOString\(\) }\)/);
  assert.match(drafts, /update\({ assignment_id: result.assignment.id }\)/);
});

test("the agent prepares but never assigns — tools, gating, and honesty", () => {
  assert.match(chat, /name: "prepare_activity"/);
  assert.match(chat, /name: "list_activity_drafts"/);
  assert.match(chat, /name: "discard_activity_draft"/);
  assert.match(chat, /required: \["type", "topic", "audience"\]/, "audience is a required input");
  // Clarification loop: an unresolved audience returns needsClarification.
  assert.match(chat, /needsClarification: true/);
  assert.match(chat, /audience_required/);
  assert.match(chat, /Ask the instructor the question in `question`/);
  // Role cross-gate: student sessions can never reach the draft tools.
  assert.match(chat, /if \(role !== "instructor"\) return \{ error: "Activity preparation is only available to instructor accounts" \}/);
  assert.match(chat, /role !== "instructor"\) return \{ error: "Activity drafts are only available to instructor accounts" \}/);
  // /agent arms the instructor loop (students keep the learner set untouched).
  // The catalogue resolves once, through the kill-switch guard, so the
  // prepare-force never requires a tool that isn't armed.
  assert.match(chat, /const instructorTools = role === "student" \? \[\] : openAiInstructorTools\(\);/);
  assert.match(chat, /\}\) : instructorTools,/);
  assert.match(chat, /"prepare_activity", "revise_activity_draft"\]\.includes\(tool\)/, "prepare + revise are side-effecting");
  // HITL honesty guide replaces the learner observation guide for instructors.
  assert.match(chat, /INSTRUCTOR_HITL_GUIDE/);
  assert.match(chat, /Never say an activity was assigned, sent, or that learners were notified/);
  // No assign endpoint is reachable from any tool case.
  assert.doesNotMatch(chat, /drafts\/\$\{[^}]+\}\/assign|assignActivityDraft/);
});

test("all six workbench types are draftable; journeys stage through the shared path", () => {
  assert.match(chat, /enum: \["self_study", "assignment", "project", "live_course", "multi_stage", "battle"\]/);
  assert.match(drafts, /DRAFT_TYPES = Object\.freeze\(\[\.\.\.ACTIVITY_TYPES, "battle"\]\)/);
  // Journey assign: each stage becomes real work via createAssignment, then the parent.
  const journey = drafts.slice(drafts.indexOf('type === "multi_stage"'), drafts.indexOf("return { ...result, announce"));
  assert.match(journey, /for \(const st of stages\)/);
  assert.match(journey, /createAssignment\(instructor, \{[\s\S]*?type: st\. kind|type: st\.kind/);
  assert.match(journey, /details: \{ stages: refs \}/);
  // Battles assign through their battle form, never the bench path.
  assert.match(drafts, /Battles are assigned from their battle form in the preview/);
});

test("the chat hands the human a Preview button and a side-by-side panel", () => {
  // The button rides the real toolExecutions echo, not the model's prose.
  assert.match(chatPage, /x\.tool === 'prepare_activity' && x\.success \|\| x\.tool === 'revise_activity_draft' && x\.revised/);
  assert.match(chatPage, /\{msg\.previews\.length > 1 \? `Preview \$\{pi \+ 1\}` : 'Preview'\} — \{d\.title\}/);
  assert.match(chatPage, /Assigned ✓/);
  // Side-by-side: the container widens and hosts the panel next to the chat.
  assert.match(chatPage, /previewDraft \? 'min\(1180px, 97vw\)' : 720/);
  assert.match(chatPage, /<ActivityPreviewPanel/);
  // Fortizo split parity with the learner's reader + session view: the panel
  // docks beside the chat from 768px up (a 125%-zoom laptop included) and
  // only phones take over the full screen; maxWidth keeps the pane inside
  // narrow desktops while the chat column shrinks.
  assert.match(chatPage, /@media \(max-width: 767px\)/);
  assert.doesNotMatch(chatPage, /max-width: 1100px/);
  assert.match(chatPage, /width: 430, maxWidth: '46vw', flexShrink: 0/);
});

test("the preview reuses the workbench's own forms — no forked editors", () => {
  // ActivityForm grew prefill + save-override seams; the panel points it at
  // the draft-assign approval instead of the bench.
  assert.match(page, /function ActivityForm\(\{ type, onAssigned, initial = null, savePayload = null \}\)/);
  assert.match(page, /savePayload \? await savePayload\(payload\) : await apiPost\('\/api\/self-study', payload\)/);
  assert.match(panel, /<ActivityForm[\s\S]*?initial=\{prefillFrom\(payload\)\}[\s\S]*?savePayload=/);
  assert.match(panel, /\/api\/self-study\/drafts\/\$\{draftId\}\/assign/);
  // Battles go through the one shared BattleForm, embedded.
  assert.match(panel, /<BattleForm onSubmit=\{battleSubmit\}[^>]*embedded/);
  // The approval states exist, and the panel says what is true.
  assert.match(panel, /phase === 'assigning'/);
  assert.match(panel, /nothing is sent until you assign/);
  assert.match(panel, /apiDelete\(`\/api\/self-study\/drafts\/\$\{draftId\}`\)/);
});

test("the no-guess rule is universal: every tool asks before it guesses", () => {
  // One shared clarification shape, exported for any tool or workflow.
  assert.match(chat, /export function clarify\(field, question, extra = \{\}\)/);
  assert.match(chat, /needsClarification: true, missing: field, question/);
  // The base prompt (both roles) carries the missing-details rule.
  assert.match(chat, /Missing details rule: before calling any Akoro tool, check you hold every input the user actually stated/);
  assert.match(chat, /ask one clear clarifying question and wait/);
  // Side-effecting tools clarify instead of failing or inventing.
  assert.match(chat, /return clarify\("title", "What should the task be called\?"/);
  assert.match(chat, /return clarify\("message", "What should the future chat message say\?"/);
  assert.match(chat, /return clarify\("scheduledAt", "When exactly should it be sent\? Please give the date and time\."/);
  assert.match(chat, /return clarify\("followUpId", "Which scheduled message should be cancelled\?/);
  assert.match(chat, /clarify\("details", error\.message,/);
  // The capability inventory admits the behaviour.
  assert.match(chat, /Asks a clarifying question when a tool needs a detail you did not give — it never guesses values/);
  // The python teaching agent carries the same rule.
  assert.match(studentAgent, /Never guess a tool input\. If a tool needs a detail the learner has not given/);
});

test("the python agent inherits the activities tools through the gateway", () => {
  // teacher_task scope: task tools first (with room reserved), then the drafts.
  assert.match(gateway, /import \{ executeChatTool, getLearnerChatTools, INSTRUCTOR_TOOLS \} from "\.\.\/adaptive-learning\/chat\.js";/);
  const teacherSet = gateway.slice(
    gateway.indexOf("TEACHER_DRAFT_TOOLS"),
    gateway.indexOf("]);", gateway.indexOf("TEACHER_DRAFT_TOOLS")),
  );
  for (const tool of ["prepare_activity", "list_activity_drafts", "get_activity_draft", "revise_activity_draft", "discard_activity_draft", "check_activity_outcomes", "schedule_activity_routine", "list_activity_routines", "cancel_activity_routine"]) {
    assert.ok(teacherSet.includes(`"${tool}"`), `gateway serves ${tool}`);
  }
  assert.match(gateway, /MAX_CATALOGUE - INSTRUCTOR_TOOLS\.length/);
  assert.match(gateway, /\.\.\.taskTools, \.\.\.draftTools/);
  // Invocation routes draft tools to the instructor role — drafts touch the
  // principal's own account, never the task's course scope.
  assert.match(gateway, /TEACHER_DRAFT_TOOLS\.has\(name\)/);
  assert.match(gateway, /executeChatTool\(name, arguments_, principal\.id, \{ role: "instructor", channel: "task_run" \}\)/);
  // The student branch is untouched — learner capabilities never widen.
  assert.match(gateway, /outcome = await executeChatTool\(name, arguments_, principal\.id\);/);
  const studentWrites = gateway.slice(
    gateway.indexOf("STUDENT_WRITE_TOOLS"),
    gateway.indexOf("]);", gateway.indexOf("STUDENT_WRITE_TOOLS")),
  );
  assert.ok(!studentWrites.includes("prepare_activity"), "drafts never become learner write-confirmable tools");
  // Drafts are private: no learner write confirmation path involves them.
  assert.match(gateway, /no learner-facing write confirmation applies here/);
});

test("the agent can read and revise its drafts — and the loop closes in chat", () => {
  assert.match(chat, /name: "get_activity_draft"/);
  assert.match(chat, /name: "revise_activity_draft"/);
  // Revise builds on reality: read first, then write.
  assert.match(chat, /Use it before revising a draft/);
  // The topic is identity — changing it means a new draft, never a silent edit.
  assert.match(chat, /The topic cannot change \(discard and prepare again instead\)/);
  // Revision is validated server-side and only ever touches pending drafts.
  assert.match(drafts, /export async function reviseDraftPayload/);
  assert.match(drafts, /if \(draft\.status !== "draft"\) throw invalid\("Only pending drafts can be revised", 409\)/);
  assert.match(drafts, /The plan needs at least one entry/);
  // The revise echo re-renders the Preview affordance with the same draft id.
  assert.match(chat, /tool === "revise_activity_draft" && toolResult\?\.revised/);
  assert.match(chat, /still not assigned/);
  // The python gateway serves the revision pair to teacher task runs too.
  assert.match(gateway, /"get_activity_draft",\s*"revise_activity_draft",/);
});

test("assignment feedback reaches the conversation; previews stay live", () => {
  // Q1: resolving a draft is pushed into the chat, so the transcript — and
  // next turn's history — carry the outcome the agent can speak about.
  assert.match(chatPage, /'✅ Assigned — the learners on this draft have been notified and it is on their Activities feed\.'/);
  assert.match(chatPage, /'🗑️ Draft discarded — nothing was sent to anyone\.'/);
  // Q2: a revise echo bumps the draft's revision counter and re-renders Preview.
  assert.match(chatPage, /x\.tool === 'revise_activity_draft' && x\.revised/);
  assert.match(chatPage, /setDraftRevisions\(\(prev\) => \(\{ \.\.\.prev, \[x\.draft\.id\]: \(prev\[x\.draft\.id\] \|\| 0\) \+ 1 \}\)\)/);
  assert.match(chatPage, /revision=\{draftRevisions\[previewDraft\] \|\| 0\}/);
  // An open side-by-side panel refetches when its draft is revised.
  assert.match(panel, /\[load, revision\]/);
});

test("production hardening: races, expiry, cost, deadlines, visibility", () => {
  // Assign claims the draft atomically before creating anything — double taps
  // and chat-vs-workbench races resolve to one 409, never two assignments.
  // assignActivityDraft is the module's last export — slice it to the end.
  const assign = drafts.slice(drafts.indexOf("export async function assignActivityDraft"));
  const claimPos = assign.indexOf('eq("id", draft.id).eq("status", "draft")');
  const createPos = assign.indexOf("createAssignment(instructor, ");
  assert.ok(claimPos >= 0 && createPos > claimPos, "claim happens before creation");
  assert.match(drafts, /This draft was already resolved", 409/);
  assert.match(drafts, /release it so the human can fix the/, "failed creations release the claim");
  // Lazy TTL — stale pending drafts expire on read, no cron.
  assert.match(drafts, /DRAFT_TTL_DAYS = 7/);
  assert.match(drafts, /expireStaleDrafts/);
  // Soft hourly cap on prepare (a background plan fill rides on each call).
  assert.match(drafts, /PREPARE_HOURLY_CAP = 10/);
  assert.match(drafts, /Prepare limit reached/);
  // Precise due times follow the create_task convention: ISO or hint, never invented.
  assert.match(chat, /Resolve relative phrases \('tomorrow at 8pm'\) against the Current date and time/);
  assert.match(drafts, /The exact due time could not be parsed/);
  assert.match(drafts, /The stated due time is already past/);
  // Task-run drafts nudge the instructor — a draft no one sees is a draft lost.
  assert.match(gateway, /channel: "task_run"/);
  assert.match(drafts, /activity_draft_prepared/);
  assert.match(drafts, /Draft ready for review/);
  // Kill-switch removes the tools from chat loop and gateway catalogue alike.
  assert.match(chat, /AKORO_ACTIVITY_DRAFTS_ENABLED/);
  assert.match(gateway, /AKORO_ACTIVITY_DRAFTS_ENABLED/);
});

test("premium seams: classes by name, real audience names, live status", () => {
  // The agent confirms classes instead of fuzzy-guessing them.
  assert.match(chat, /name: "list_my_classrooms"/);
  assert.match(chat, /never guess a class/);
  assert.match(chat, /case "list_my_classrooms": \{[\s\S]*?classroom_students/);
  // The preview shows WHO, not just how many.
  assert.match(drafts, /names = \(people \?\? \[\]\)\.map/);
  assert.match(drafts, /names: audience\.names \?\? null/);
  assert.match(panel, /\+\{audience\.resolved_count - audience\.names\.length\} more/);
  // Revision chips: the panel says what the agent changed.
  assert.match(drafts, /payload\.last_change = \{ note:/);
  assert.match(panel, /payload\.last_change\?\.note/);
  // Streaming status: SSE first, JSON fallback, identical handling after.
  assert.match(chatPage, /sendStreaming/);
  assert.match(chatPage, /api\/adaptive\/chat\/agent\?stream=1/);
  assert.match(chatPage, /return await apiPost\('\/api\/adaptive\/chat\/agent', \{ message: bodyText, history, agentName, role: 'instructor', conversationId: sid, turnId, mode: chatMode \}\)/);
  assert.match(chatPage, /\{!trainingInChat && aiStatus && \(/);
});

test("bigger bets: weekly routines prepare drafts — assignment stays human", () => {
  assert.match(routinesMigration, /CREATE TABLE IF NOT EXISTS draft_routines/);
  assert.match(routinesMigration, /last_run_at   TIMESTAMPTZ/);
  assert.match(manifest, /2026-draft-routines\.sql/);
  // The agent schedules conversationally — but never without an audience.
  assert.match(chat, /name: "schedule_activity_routine"/);
  assert.match(chat, /clarify\("audience", "Who is this weekly activity for/);
  assert.match(routines, /hasAudience/);
  assert.match(routines, /throw invalid\("audience_required"\)/);
  // The scheduler claims the slot before preparing (multi-instance safe) and
  // only ever PREPARES: it rides the draft flow with the task_run channel.
  assert.match(routines, /\.is\("last_run_at", null\)/);
  assert.match(routines, /\.eq\("last_run_at", routine\.last_run_at\)/);
  assert.match(routines, /channel: "task_run"/);
  assert.match(routines, /startRoutineScheduler/);
  assert.match(appJs, /startRoutineScheduler\(\)/);
  // Honesty: the guide forbids claiming a routine assigned anything.
  assert.match(chat, /Routines only ever prepare drafts at their weekly slot/);
  // Managed from the workbench strip: pause/resume/cancel chips.
  assert.match(page, /\/api\/self-study\/routines/);
  assert.match(page, /Weekly routines/);
});

test("bigger bets: outcomes close the loop — data in, decision human", () => {
  assert.match(chat, /name: "check_activity_outcomes"/);
  // Owned summaries only, and never per-learner rows.
  assert.match(outcomes, /export async function activityOutcomeSummary/);
  assert.match(outcomes, /if \(data\.created_by !== instructor\.id && instructor\.role !== "admin"\) return null/);
  assert.ok(!outcomes.includes("learners:"), "no per-learner rows to the model");
  // Pick-one flow when no id is given.
  assert.match(chat, /pickOne: true/);
  assert.match(chat, /then call again with its assignmentId/);
  // Weak results suggest a revision draft — the instructor still decides.
  assert.match(chat, /suggest a revision draft and let the instructor decide/);
});

test("bigger bets: batch preparation is first-class", () => {
  assert.match(chat, /For a batch request/);
  assert.match(chat, /call this once per activity in the same reply/);
  // Each draft in a batch gets its own numbered Preview button.
  assert.match(instructorChatPage, /msg\.previews\.map\(\(d, pi\) =>/);
  assert.match(instructorChatPage, /\{msg\.previews\.length > 1 \? `Preview \$\{pi \+ 1\}` : 'Preview'/);
});

test("the agent sees the instructor's real classes (teacher_id, not just created_by)", () => {
  // Regression: classrooms are owned via teacher_id (bench + seeds) — the
  // created_by-only filter made every seeded class invisible, so the agent
  // claimed "there are no classes listed in my system for you".
  assert.match(drafts, /export async function instructorClassrooms/);
  assert.match(drafts, /\.or\(`teacher_id\.eq\.\$\{instructorId\},created_by\.eq\.\$\{instructorId\}`\)/);
  assert.match(chat, /teacher_id\.eq\.\$\{studentId\},created_by\.eq\.\$\{studentId\}/);
  assert.match(drafts, /resolveClassroomByName[\s\S]*?teacher_id\.eq/);
});

test("whole-class audiences resolve to a real class — never to zero learners", () => {
  // "The entire class" with no class id: one class → auto-pick; several →
  // ask which (named); none → tell them to create one.
  assert.match(drafts, /if \(whole_class && !classroom_id\) \{/);
  assert.match(drafts, /Which class\? You have: \$\{rooms\.map\(r => r\.name\)\.join\(", "\)\}/);
  assert.match(drafts, /You don't have a class yet — create one in Classes first/);
  // The prepare executor relays the SPECIFIC clarify question, not a generic re-ask.
  assert.match(chat, /clarify\("details", error\.message,/);
  // Routines reject an unresolvable audience at schedule time — not silently
  // at every weekly run.
  assert.match(routines, /create one in Classes first/);
  // And the agent guide forbids asking for a class that does not exist.
  assert.match(chat, /Never ask them to name a class that does not exist/);
});

test("classroom ownership: created_by exists, backfilled, and agent queries never answer empty on error", () => {
  // The schema truth: created_by was missing entirely — the original
  // "you have no classes" was an error swallowed into an empty list.
  assert.match(classroomsMigration, /ADD COLUMN IF NOT EXISTS created_by uuid/);
  assert.match(classroomsMigration, /SET created_by = teacher_id WHERE created_by IS NULL/);
  assert.match(classroomsMigration, /trg_classrooms_sync_created_by/);
  assert.match(manifest, /2026-classrooms-created-by\.sql/);
  // Both ownership filters degrade to teacher_id when the column lags.
  assert.match(drafts, /export async function instructorClassrooms/);
  assert.match(chat, /\.eq\("teacher_id", studentId\)\.order\("created_at"/);
});

test("the agent can inspect class details and the instructor's own details", () => {
  // list_my_classrooms returns roster + meta, not a bare count.
  assert.match(chat, /students: active\.slice\(0, 40\)\.map/);
  assert.match(chat, /studentLimit: c\.student_limit/);
  // get_my_profile: the teacher-details tool, routed through the gateway too.
  assert.match(chat, /name: "get_my_profile"/);
  assert.match(chat, /case "get_my_profile"/);
  assert.match(chat, /school_teachers/);
  assert.ok(teacherSetIncludes(gateway, "get_my_profile"));
});

function teacherSetIncludes(source, tool) {
  const start = source.indexOf("TEACHER_DRAFT_TOOLS");
  const slice = source.slice(start, source.indexOf("]);", start));
  return slice.includes(`"${tool}"`);
}

test("prepare mirrors the assignments API: field gaps ask questions, never read as faults", () => {
  // subject/topic are required by createAssignment — missing ones come back
  // as clarify QUESTIONS so the model asks instead of reporting a
  // "technical problem" (the live transcript failure).
  assert.match(drafts, /What exactly should the work cover — name the topic\?/, "clarify");
  assert.match(drafts, /Which subject is this for — e\.g\. Social Studies, Mathematics\?/, "clarify");
  // The executor relays the server's question verbatim under a neutral key.
  assert.match(chat, /clarify\("details", error\.message,/);
  // The schema teaches the real contract: subject required; the plan is
  // server-drafted; due_at resolves against the injected clock.
  assert.match(chat, /REQUIRED for every type except battle — ask when the instructor did not name one/);
  assert.match(chat, /The server drafts the study plan itself/);
  assert.match(chat, /Resolve relative phrases \('tomorrow at 8pm'\) against the Current date and time/);
});

test("the node agent knows what day it is (due-date resolution)", () => {
  // "due tomorrow 8pm" was unresolvable without a clock — the python agent
  // injects current_utc; the node prompt now does the same at request time.
  assert.match(chat, /Current date and time: \$\{nowLagos\} \(Africa\/Lagos\)/);
  assert.match(chat, /timeZone: "Africa\/Lagos"/);
  assert.match(chat, /Never state a due date you could not compute from this/);
});

test("prepare failures are diagnosable and survivable — no more silent thrash", () => {
  // The plan generator is 1 + N live model calls; awaiting it inline once
  // hung the whole chat turn (SDK default: a 10-minute timeout) until the
  // browser gave up — the instructor just saw "trouble responding". Prepare
  // now carries the topic instantly and the plan fills in the BACKGROUND.
  assert.match(drafts, /payload\.plan_status = "pending"/);
  assert.doesNotMatch(drafts, /await generatePlan\(/, "the chat turn must never wait on the plan generator");
  assert.match(drafts, /if \(payload\.plan_status === "pending"\) enrichDraftPlan\(/);
  // The background fill is deadline-bounded, read-modify-write, never
  // touches a draft that left `draft` status, and marks total failure.
  assert.match(drafts, /PLAN_ENRICH_TIMEOUT_MS = 150_000/);
  assert.match(drafts, /plan_status: "ready"/);
  assert.match(drafts, /plan_status: "fallback"/);
  assert.match(drafts, /row\.status !== "draft"\) return/);
  assert.match(drafts, /\.\.\.row\.payload,/);
  assert.match(drafts, /console\.error\("\[prepare_activity\] plan generator failed:/);
  // A broken machine due_at degrades to the human hint, never a dead end.
  assert.match(drafts, /dueAtNotice = "The exact due time could not be parsed/);
  assert.match(drafts, /payload\.due_notice = dueAtNotice/);
  // Server-side log + verbatim relay: the REAL reason reaches Render logs
  // and the instructor — "technical problem" is forbidden in the guide.
  assert.match(chat, /console\.error\("\[prepare_activity\] failed:/);
  assert.match(chat, /repeat that reason to the instructor and fix that one thing together\. NEVER call it a technical problem/);
  // One class + "the whole class" → no name-confirmation round trip.
  assert.match(chat, /list_my_classrooms shows exactly ONE class, use it without asking/);
  // A bare "Yes" once landed as "what do you mean?" — confirmation must
  // fire the tool, not restart the interview.
  assert.match(chat, /call prepare_activity immediately — every detail they gave is already in this conversation/);
  // The model once wrote sample questions as chat prose and invented a
  // "how many questions?" requirement — so the route FORCES prepare_activity
  // on an activity request (or a confirmation continuing one), and the guide
  // forbids the detours outright.
  assert.match(chat, /requiresActivityPreparation\(userMessage, dialogue\)/);
  assert.match(chat, /\? "prepare_activity" : null/);
  assert.match(chat, /prepare_activity is the ONLY way an activity comes into existence/);
  assert.match(chat, /never ask for them; inventing extra requirements/);
  // The tool result says the plan is on its way (it no longer awaits it).
  assert.match(chat, /plan_status === "pending"\) result\.planNote/);
});

test("the plan generator's model calls are individually bounded — no 10-minute stalls", () => {
  // The SDK's defaults (timeout 10 min, 2 retries) let one stalled provider
  // call hold a chat turn far past any client's patience. The two plan
  // calls opt into tighter bounds via the metered client's dunder options.
  assert.equal((guide.match(/__timeoutMs: 45_000, __maxRetries: 1/g) || []).length, 2,
    "generateSubtopics and generateObjectives both bounded");
  // ...and the metered client actually forwards them as SDK request options.
  assert.match(aiModel, /clean\.__timeoutMs != null \|\| clean\.__maxRetries != null/);
  assert.match(aiModel, /create\(clean, reqOpts\)/);
});

test("classroom name resolution never chains .catch on a Supabase builder", () => {
  // LIVE transcript catch: db.from(...).or(...).ilike(...).limit(...).catch
  // is not a function — Supabase builders are thenables WITHOUT .catch, and
  // that TypeError killed every prepare that named a class. Errors are
  // handled by try/catch around the await, then the teacher_id fallback.
  const fnStart = drafts.indexOf("async function resolveClassroomByName");
  const fnBody = drafts.slice(fnStart, drafts.indexOf("}", drafts.indexOf("return data[0]", fnStart)));
  assert.ok(!/\.catch\(/.test(fnBody), "no .catch chained on the builder");
  assert.match(fnBody, /Supabase builders are thenables WITHOUT \.catch/);
  assert.match(fnBody, /\.eq\("teacher_id", instructorId\)/);
});

