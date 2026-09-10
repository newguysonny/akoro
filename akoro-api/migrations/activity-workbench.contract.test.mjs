import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Activities workbench contract — the instructor's "create activity" page
 * mirrors Tools & Assets exactly: activity types on the left with a WHEN TO
 * USE IT note, the creation form on the right, past activities underneath.
 * All four kinds ride the self-study machinery, separated by `type`.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [page, selfStudy, planEditor, routes, migration, manifest, activityApi, battleForm, battlesPage, dashboard, learnerActivity, activitySocket, selfStudyList, guide, analyticsPage, appRoutes, activityFeed] = await Promise.all([
  read("../../akoro-instructor/src/pages/ActivitiesPage.jsx"),
  read("../../akoro-instructor/src/pages/SelfStudyPage.jsx"),
  read("../../akoro-instructor/src/components/PlanEditor.jsx"),
  read("../../akoro-api/modules/self-study/routes.js"),
  read("../../akoro-api/migrations/2026-activity-types.sql"),
  read("../../akoro-api/migrations/manifest.json"),
  read("../../akoro-learner/src/services/activityApi.js"),
  read("../../akoro-instructor/src/components/battles/BattleForm.jsx"),
  read("../../akoro-instructor/src/pages/BattlesPage.jsx"),
  read("../../akoro-learner/src/pages/LearnerDashboard.jsx"),
  read("../../akoro-learner/src/pages/ActivityPage.jsx"),
  read("../../akoro-learner/src/services/activitySocket.js"),
  read("../../akoro-learner/src/components/sessions/SelfStudyList.jsx"),
  read("../../akoro-api/modules/adaptive-learning/agents/nana-esumai/guide.js"),
  read("../../akoro-instructor/src/pages/SelfStudyAnalyticsPage.jsx"),
  read("../../akoro-instructor/src/App.jsx"),
  read("../../akoro-learner/src/pages/ActivityPage.jsx"),
]);

test("the page mirrors the workbench: rail + WHEN TO USE IT + form + past activities", () => {
  assert.match(page, /ACTIVITY TYPES/);
  assert.match(page, /WHEN TO USE IT/);
  assert.match(page, /Past \{meta\.name\.toLowerCase\(\)\} activities/);
  assert.match(page, /AudiencePicker/);
  assert.match(page, /PlanEditor/);
  // The four kinds the instructor assigns, each with its own guidance.
  for (const kind of ["self_study", "assignment", "project", "live_course"]) {
    assert.match(page, new RegExp(`key: '${kind}'`));
  }
});

test("all kinds ride the self-study machinery, separated by type", () => {
  // API accepts and persists the type, and validates it.
  assert.match(routes, /ACTIVITY_TYPES = Object\.freeze\(\["self_study", "assignment", "project", "live_course", "multi_stage"\]\)/);
  assert.match(routes, /Unknown activity type/);
  assert.match(routes, /due_at, type,/);
  // Learner /mine passes the kind through so cards file under the right pill.
  assert.match(routes, /type:\s+a\.type \?\? "self_study"/);
  // Migration adds the columns with self_study as the default.
  assert.match(migration, /ADD COLUMN IF NOT EXISTS type\s+TEXT NOT NULL DEFAULT 'self_study'/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '\{\}'/);
  assert.match(manifest, /"2026-activity-types\.sql"/);
});

test("the creation form is the self-study form generalised", () => {
  // Shared plan editor, one implementation used by both pages.
  assert.match(selfStudy, /import PlanEditor from '\.\.\/components\/PlanEditor\.jsx';/);
  assert.match(page, /import PlanEditor from '\.\.\/components\/PlanEditor\.jsx';/);
  // Live course swaps the plan for a schedule; the others draft one with AI.
  assert.match(page, /scheduled_at: new Date\(form\.scheduledAt\)\.toISOString\(\)/);
  assert.match(page, /!isLive && \(/);
  // Per-type plan labels.
  assert.match(page, /planLabel: 'Study plan'/);
  assert.match(page, /planLabel: 'Task breakdown'/);
  assert.match(page, /planLabel: 'Milestones & requirements'/);
});

test("the learner feed files the new kinds", () => {
  assert.match(activityApi, /kind:\s+a\.type \|\| 'self_study'/);
  assert.match(activityApi, /a\.details\?\.scheduled_at/);
});

test("a learner receives every assigned kind on their Activity page", async () => {
  const list = await read("../../akoro-learner/src/components/sessions/SelfStudyList.jsx");
  const pageLearner = await read("../../akoro-learner/src/pages/ActivityPage.jsx");
  // The feed reads /mine, which returns every type with its details.
  assert.ok(routes.includes('router.get("/mine"'), "/mine serves assigned work");
  assert.match(activityApi, /apiGet\('\/api\/self-study\/mine'\)/);
  // The announcement deep-links the learner to the feed.
  assert.match(routes, /link: "\/activities"/);
  // Live courses are not agent sessions — they surface only in the feed.
  assert.match(list, /!== 'live_course'/);
  // The page offers a pill per kind, including live courses.
  assert.match(pageLearner, /live_course/);
});

test("past activities carry the same data as self study, for every kind", () => {
  // Cards: assigned / started / done badges plus the self-study progress bar.
  assert.match(page, /\{p\.started\} started/);
  assert.match(page, /p\.assigned \? Math\.round\(\(p\.complete \/ p\.assigned\) \* 100\) : 0/);
  assert.match(page, /linear-gradient\(90deg, \$\{AMBER\}, \$\{GREEN\}\)/);
  // Detail: the full brief — schedule or due line, the approved plan with its
  // objectives, and the per-learner roster with statuses.
  assert.match(page, /Holds \{new Date\(data\.details\.scheduled_at\)/);
  assert.match(page, /planLabel \|\| 'Plan'/);
  assert.match(page, /data\.objectives\?\.\[st\]/);
  assert.match(page, /ASSIGNED LEARNERS/);
  assert.match(page, /\{done\} of \{targets\.length\} done/);
});

test("BattleForm is self-contained — no identifiers from its old modal host", () => {
  // Regression: the extracted form once called onClose(), which only existed
  // in the Battles page modal — clicking battles in the workbench crashed.
  assert.ok(!battleForm.includes("onClose"), "BattleForm must not reference onClose");
  assert.match(battleForm, /onCancel\?\.\(\)/);
  assert.match(battleForm, /submitLabel \|\| \(editing \? 'Save changes' : 'Create Battle'\)/);
  // Cancel only renders when the host offers a way back.
  assert.match(battleForm, /\{onCancel && <Btn variant="secondary" type="button" onClick=\{onCancel\}>Cancel<\/Btn>\}/);
});

test("battles use the same creation form everywhere", () => {
  // One BattleForm implementation; the Battles page wraps it in a modal, the
  // workbench renders it inline.
  assert.match(battlesPage, /import BattleForm from '\.\.\/components\/battles\/BattleForm\.jsx';/);
  assert.match(battlesPage, /<BattleForm/);
  assert.match(page, /import BattleForm from '\.\.\/components\/battles\/BattleForm\.jsx';/);
  assert.match(page, /key === 'battle'\s*\?/);
  assert.match(page, /BattlePastStrip/);
  // Battle creation calls the same invite endpoint the Battles page uses.
  assert.match(page, /createBattle\(/);
  assert.match(page, /question_source: form\.questionSource/);
});

test("multi-stage activities chain real work into one journey", () => {
  // The composer: ordered stages, all four kinds, shared audience, battle
  // stages created through the same battle form.
  assert.match(page, /function MultiStageForm/);
  for (const k of ["'self_study'", "'assignment'", "'project'", "'battle'"]) {
    assert.ok(page.includes(`key: ${k}`), `stage kind ${k}`);
  }
  assert.match(page, /type: 'multi_stage'/);
  assert.match(page, /details: \{ stages: refs \}/);
  assert.match(page, /BattleStageModal/);
  // The backend knows the type and announces it.
  assert.match(routes, /"multi_stage"/);
  assert.match(migration, /'multi_stage'/);
  // Learners see the journey as a roadmap.
  assert.ok(activityApi.includes("a.stages ?? a.details?.stages"), "roadmap reads the derived stages");
});

test("a new assignment dings the learner in real time", () => {
  // Backend: the create path AND the add-learners-later path both emit.
  const emitCount = (routes.match(/emit\("self_study_assigned"/g) || []).length;
  assert.ok(emitCount >= 2, `both assign paths emit (found ${emitCount})`);
  // Learner: one ambient socket listening for it.
  assert.match(activitySocket, /socket\.on\('self_study_assigned'/);
  assert.match(dashboard, /onActivityEvent/);
  assert.match(dashboard, /New \$\{label\.toLowerCase\(\)\}/);
  // The chime is best-effort; the toast still lands without audio.
  assert.match(dashboard, /AudioContext/);
  // A mounted Activity page refetches when the ding fires.
  assert.match(learnerActivity, /ak:activity-changed/);
});

test("journey stages unlock sequentially, derived from real progress", () => {
  // The learner's /mine derives stage state server-side — never from the client:
  // study stages from the learner's target status, battle stages from their
  // participant row in a FINISHED battle.
  assert.match(routes, /battle_participants/);
  assert.ok(routes.includes('status === "completed" ? "complete" : "started"'), "battle stage completes with a finished battle");
  assert.ok(routes.includes('myTargetByAssignment.get(ref.refId)?.status'), "study stage uses the learner's own target status");
  // The active stage is the first resolvable, unfinished one; untracked
  // stages are skipped by the gate so a legacy journey cannot dead-end.
  assert.ok(routes.includes('findIndex((st) => st === "assigned" || st === "started")'), "active stage = first resolvable unfinished");
  assert.ok(routes.includes('? "complete" : i === activeIndex ? "active" : "locked"'), "ordered states");
  // Children know their journey, position, and whether their turn has come.
  assert.ok(routes.includes('journeyInfoById.set(ref.refId'), "children tagged with their journey");
  assert.ok(routes.includes('locked: i > activeIndex'), "later stages start locked");
});

test("learner surfaces honour the lock", () => {
  // Locked stages never appear as standalone work in the feed…
  assert.ok(activityApi.includes("!a.journey?.locked"), "locked stages never appear standalone");
  // …nor as startable sessions in the agent-session list.
  assert.ok(selfStudyList.includes("!a.journey?.locked"), "locked stages are not startable");
  assert.ok(learnerActivity.includes("st.status === 'complete' ? '✓'"), "done stages are checked");
});

test("the journey card shows the roadmap with each stage's state", () => {
  assert.ok(learnerActivity.includes("a.stages?.length > 0"), "journey cards render the roadmap");
  assert.match(learnerActivity, /'🔒'/);
  assert.match(learnerActivity, /NOW<\/span>/);
  // The subtitle names the step to do now.
  assert.ok(activityApi.includes("Step ${(a.journeyProgress?.done ?? doneCount) + 1} of ${stageList.length}"), "subtitle names the current step");
});

test("stage battles are captured with their id so completion can be derived", () => {
  assert.ok(page.includes("res?.battle_id ?? res?.data?.battle_id"), "battle id captured from the invite response");
  assert.ok(page.includes("battleId: battleId ?? null"), "the stage ref keeps the battle id");
});

test("every activity has a per-class analytics page with an AI report", () => {
  // API: aggregate class rows from real progress + agent cognitive state.
  assert.ok(routes.includes('router.get("/:id/analytics"'), "analytics endpoint");
  assert.ok(routes.includes('router.post("/:id/report"'), "report generation endpoint");
  assert.ok(routes.includes("classRows(assignment)"), "per-learner rows");
  assert.ok(routes.includes("getStudentState(agent.id)"), "reads live cognitive state");
  assert.ok(routes.includes("ai_report: { report, generatedAt }"), "the report is saved with the activity");
  // The report generator consumes signals, never transcripts (first names only).
  assert.ok(guide.includes("async classAnalytics(brief, learners)"), "NaNa classAnalytics");
  assert.ok(routes.includes('name: (r.student.name || "Learner").split(" ")[0]'), "first names only");
  // Instructor surface: a routed page consuming both endpoints.
  assert.ok(appRoutes.includes('path="/self-study/:id/analytics"'), "analytics route");
  assert.ok(analyticsPage.includes("`/api/self-study/${id}/analytics`"), "page loads the aggregate");
  assert.ok(analyticsPage.includes("`/api/self-study/${id}/report`"), "page generates the report");
  assert.ok(analyticsPage.includes("LIKELY MISCONCEPTIONS"), "misconceptions section");
  assert.ok(analyticsPage.includes("Difficulty: {r.difficulty.rating}"), "difficulty verdict");
  // Reachable from both surfaces: the self-study card and the activity detail.
  assert.ok(selfStudy.includes("onAnalytics(a)"), "card analytics button");
  assert.ok(selfStudy.includes("navigate(`/self-study/${x.id}/analytics`)"), "card navigates");
  assert.ok(page.includes("`/self-study/${activity.id}/analytics`"), "activity detail links out");
});

test("the Activities header shows a real streak and the feed splits by stage", () => {
  // Streak: computed server-side from the learner's own completion days —
  // never a stored number the learner did not earn — and registered before
  // /:id so "streak" is never parsed as an id.
  const streakPos = routes.indexOf('router.get("/streak"');
  const idPos = routes.indexOf('router.get("/:id"');
  assert.ok(streakPos > -1 && idPos > -1 && streakPos < idPos, "streak endpoint precedes /:id");
  assert.ok(routes.includes('filter((t) => t.completed_at)'), "derived from real completions");
  assert.ok(routes.includes("cursor.setUTCDate(cursor.getUTCDate() - 1)"), "yesterday grace");
  assert.ok(activityFeed.includes("fetchMyStreak"), "the page loads the streak");
  // 🔥 chip sits on the header's right, beside the title.
  assert.ok(activityFeed.includes("marginLeft: 'auto'"), "chip pinned right");
  assert.ok(activityFeed.includes("🔥"), "fire icon");
  // Stage pills: pending (default) → awaiting grading → graded, before the
  // cards, combining with the kind filter.
  assert.ok(activityFeed.includes("Pending submissions"), "pending pill");
  assert.ok(activityFeed.includes("Awaiting grading"), "awaiting pill");
  assert.ok(activityFeed.includes("Graded activity"), "graded pill");
  assert.ok(activityFeed.includes("useState('pending')"), "pending is the default");
  assert.ok(activityFeed.includes(".filter(a => stageOf(a) === stage)"), "cards respect the stage");
  assert.ok(activityFeed.indexOf("STAGES.map") > -1 && activityFeed.indexOf("STAGES.map") < activityFeed.indexOf("{displayed.map"), "pills render before the cards");
});
