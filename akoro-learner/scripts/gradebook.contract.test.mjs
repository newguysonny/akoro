import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Gradebook contract — the lowerEd report card: the learner's assigned work
 * organised subject by subject in the Activities page's style, with honest
 * marks (✓ submitted · X missed · – pending) until grading exists. Data comes
 * from the real /mine feed, never sample rows.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [seam, page, appRoutes, userTab, en] = await Promise.all([
  read("../src/services/gradebookApi.js"),
  read("../src/pages/GradebookPage.jsx"),
  read("../src/App.jsx"),
  read("../src/pages/settings/userTab.jsx"),
  read("../src/contexts/i18n/en.js"),
]);

test("the gradebook reads real assigned work, grouped by subject", () => {
  assert.match(seam, /apiGet\('\/api\/self-study\/mine'\)/);
  assert.match(seam, /filter\(a => !a\.journey\?\.locked/);
  // Live courses are sessions, not gradable work.
  assert.match(seam, /!== 'live_course'/);
  // Marks are states, not invented numbers.
  assert.match(seam, /a\.status === 'complete' \? '✓' : overdue \? 'X' : '–'/);
  assert.match(seam, /overdue = open && due && new Date\(due\) < new Date\(\)/);
});

test("the page is the Activities style, gradebook edition", () => {
  // Header with back + title + headline chip; subject pills; type pills; sort.
  assert.match(page, /navigate\('\/app'\)/);
  assert.match(page, /Gradebook<\/p>/);
  assert.match(page, /All subjects/);
  assert.match(page, /Date \{sortDir === 'asc' \? '↑' : '↓'\}/);
  // Summary cards: submitted with a progress bar, missed with a red flag.
  assert.match(page, /Submitted<\/div>/);
  assert.match(page, /linear-gradient\(90deg, \$\{BRAND\}, \$\{GREEN\}\)/);
  assert.match(page, /Past due — still open/);
  // Mark badge already knows score bands for when grading lands.
  assert.match(page, /mark >= 80/);
  assert.match(page, /mark >= 60/);
});

test("the page is routed and reachable for lowerEd learners", () => {
  assert.match(appRoutes, /path="\/gradebook"/);
  // The settings card sits beside Activities, lowerEd only.
  assert.match(userTab, /title:'settings\.gradebook'/);
  assert.match(userTab, /navigate\('\/gradebook'\)/);
  const gradebookPos = userTab.indexOf("navigate('/gradebook')");
  const activitiesPos = userTab.indexOf("navigate('/activities')");
  assert.ok(activitiesPos > -1 && gradebookPos > activitiesPos, "gradebook card follows activities");
  assert.ok(en.includes("'settings.gradebook':"), "i18n key exists");
  assert.ok(en.includes("'settings.gradebook_sub':"), "i18n sub key exists");
});
