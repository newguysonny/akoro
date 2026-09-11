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
const [migration, manifest, service, drafts, routes, chat, page, panel, chatPage, gateway, studentAgent] = await Promise.all([
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
  assert.match(drafts, /status: "assigned", assignment_id: result\.assignment\.id/);
});

test("the agent prepares but never assigns — tools, gating, and honesty", () => {
  assert.match(chat, /name: "prepare_activity"/);
  assert.match(chat, /name: "list_activity_drafts"/);
  assert.match(chat, /name: "discard_activity_draft"/);
  assert.match(chat, /required: \["type", "topic", "audience"\]/, "audience is a required input");
  // Clarification loop: an unresolved audience returns needsClarification.
  assert.match(chat, /needsClarification: true/);
  assert.match(chat, /audience_required/);
  assert.match(chat, /Ask the instructor who this activity is for/);
  // Role cross-gate: student sessions can never reach the draft tools.
  assert.match(chat, /if \(role !== "instructor"\) return \{ error: "Activity preparation is only available to instructor accounts" \}/);
  assert.match(chat, /role !== "instructor"\) return \{ error: "Activity drafts are only available to instructor accounts" \}/);
  // /agent arms the instructor loop (students keep the learner set untouched).
  assert.match(chat, /\}\) : openAiInstructorTools\(\)/);
  assert.match(chat, /prepare_activity"\]\.includes\(tool\)/, "prepare_activity is side-effecting");
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
  assert.match(chatPage, /e\.tool === 'prepare_activity' && e\.success && e\.draft/);
  assert.match(chatPage, /Preview — \{d\.title\}/);
  assert.match(chatPage, /Assigned ✓/);
  // Side-by-side: the container widens and hosts the panel next to the chat.
  assert.match(chatPage, /previewDraft \? 'min\(1180px, 97vw\)' : 720/);
  assert.match(chatPage, /<ActivityPreviewPanel/);
  assert.match(chatPage, /@media \(max-width: 1100px\)/);
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
  assert.match(chat, /clarify\("audience", "Who is this activity for/);
  // The capability inventory admits the behaviour.
  assert.match(chat, /Asks a clarifying question when a tool needs a detail you did not give — it never guesses values/);
  // The python teaching agent carries the same rule.
  assert.match(studentAgent, /Never guess a tool input\. If a tool needs a detail the learner has not given/);
});

test("the python agent inherits the activities tools through the gateway", () => {
  // teacher_task scope: task tools first (with room reserved), then the drafts.
  assert.match(gateway, /import \{ executeChatTool, getLearnerChatTools, INSTRUCTOR_TOOLS \} from "\.\.\/adaptive-learning\/chat\.js";/);
  assert.match(gateway, /TEACHER_DRAFT_TOOLS = new Set\(\[\s*"prepare_activity",\s*"list_activity_drafts",\s*"discard_activity_draft",\s*\]\)/);
  assert.match(gateway, /MAX_CATALOGUE - INSTRUCTOR_TOOLS\.length/);
  assert.match(gateway, /\.\.\.taskTools, \.\.\.draftTools/);
  // Invocation routes draft tools to the instructor role — drafts touch the
  // principal's own account, never the task's course scope.
  assert.match(gateway, /TEACHER_DRAFT_TOOLS\.has\(name\)/);
  assert.match(gateway, /executeChatTool\(name, arguments_, principal\.id, \{ role: "instructor" \}\)/);
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
