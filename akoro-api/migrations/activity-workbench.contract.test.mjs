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
const [page, selfStudy, planEditor, routes, migration, manifest, activityApi] = await Promise.all([
  read("../../akoro-instructor/src/pages/ActivitiesPage.jsx"),
  read("../../akoro-instructor/src/pages/SelfStudyPage.jsx"),
  read("../../akoro-instructor/src/components/PlanEditor.jsx"),
  read("../../akoro-api/modules/self-study/routes.js"),
  read("../../akoro-api/migrations/2026-activity-types.sql"),
  read("../../akoro-api/migrations/manifest.json"),
  read("../../akoro-learner/src/services/activityApi.js"),
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
  assert.match(routes, /ACTIVITY_TYPES = Object\.freeze\(\["self_study", "assignment", "project", "live_course"\]\)/);
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
