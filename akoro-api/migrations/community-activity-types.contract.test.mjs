import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Community activities speak the workbench's language — the SAME five
 * types, and multi_stage journeys carry their ordered stages. Live catch:
 * the community details page showed a flat list with no type or stages,
 * unlike the instructor Activities page.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [migration, routes, page] = await Promise.all([
  read("./2026-community-activity-types.sql"),
  read("../../akoro-api/modules/communities/routes.js"),
  read("../../akoro-learner/src/pages/CommunityActivityPage.jsx"),
]);

test("the migration adds a checked type and a stage list to community activities", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS type\s+TEXT\s+NOT NULL DEFAULT 'assignment'/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS stages JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(migration, /community_activities_type_check/);
  assert.match(migration, /'assignment', 'project', 'multi_stage', 'self_study', 'live_course'/);
});

test("the API validates type and stages with workbench rules", () => {
  assert.match(routes, /const TYPE_KEYS   = \["assignment", "project", "multi_stage", "self_study", "live_course"\];/);
  assert.match(routes, /const STAGE_KINDS = \["self_study", "assignment", "project"\];/);
  // multi_stage needs at least one titled stage; never more than six.
  assert.match(routes, /\.slice\(0, 6\)/);
  assert.match(routes, /A multi-stage journey needs at least one stage with a title\./);
  // Unknown types fall back to assignment — and both columns persist.
  assert.match(routes, /TYPE_KEYS\.includes\(req\.body\?\.type\) \? req\.body\.type : "assignment"/);
  assert.match(routes, /type, stages,/);
});

test("the learner page filters by type and renders stage roadmaps", () => {
  // Filter chips: All + the five workbench types, with counts.
  for (const key of ["'all'", "'assignment'", "'project'", "'multi_stage'", "'self_study'", "'live_course'"]) {
    assert.match(page, new RegExp(key.replace(/'/g, "'")));
  }
  assert.match(page, /const visible = typeFilter === 'all'/);
  assert.match(page, /visible\.map\(\(a, i\) =>/);
  assert.match(page, /<CommunityActivityCard key=\{a\.id\}/);
  // Cards carry the type label and multi_stage cards their numbered stages.
  assert.match(page, /typeMeta\(a\.type\)/);
  assert.match(page, /a\.stages\.map\(\(s, i\) =>/);
  // The create sheet offers the five types and caps the stage builder at six.
  assert.match(page, /Add stage \{stages\.length \+ 1\} of 6/);
  assert.match(page, /Add at least one stage with a title\./);
});
