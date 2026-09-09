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
const [page, selfStudy, planEditor, routes, migration, manifest, activityApi, battleForm, battlesPage, dashboard, learnerActivity, activitySocket] = await Promise.all([
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
  assert.match(activityApi, /stageList\.map\(st => st\.title\)\.join\(' → '\)/);
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
