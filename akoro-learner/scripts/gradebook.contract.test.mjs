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

test("the page mirrors the StudentGradebook reference, Akoro-branded", () => {
  // Header stays the Notifications/Activities style.
  assert.match(page, /navigate\('\/app'\)/);
  assert.match(page, /Gradebook<\/p>/);
  // Subject dropdown with per-subject mini averages + outside-click close.
  assert.match(page, /aria-haspopup="listbox"/);
  assert.match(page, /subjectMiniAvg/);
  assert.match(page, /addEventListener\('mousedown', onClickOutside\)/);
  // Reference sections: type filter, date sort, average/completed/missed cards.
  assert.match(page, /Date \{sortDir === 'asc' \? '↑' : '↓'\}/);
  assert.match(page, />Average</);
  assert.match(page, />Submitted</);
  assert.match(page, />Missed</);
  assert.match(page, /Assignment<\/span><span>Score<\/span>/);
  // Averages come from published numeric grades only — never invented.
  assert.match(page, /filter\(v => typeof v === 'number'\)/);
  // Mark badge knows the reference score bands.
  assert.match(page, /val >= 80/);
  assert.match(page, /val >= 60/);
});

test("the page is routed and reachable for lowerEd learners", () => {
  assert.match(appRoutes, /path="\/gradebook"/);
  // The settings card sits beside Activities, lowerEd only.
  assert.match(userTab, /title:'settings\.gradebook'/);
  // REGRESSION: the lowerEd branch returns TWO cards as an array — the list
  // must be flattened before .map, or the array itself renders as one blank
  // card and Activities/Gradebook vanish from Settings.
  assert.match(userTab, /\]\.flat\(\)\.map\(card =>/);
  assert.match(userTab, /navigate\('\/gradebook'\)/);
  const gradebookPos = userTab.indexOf("navigate('/gradebook')");
  const activitiesPos = userTab.indexOf("navigate('/activities')");
  assert.ok(activitiesPos > -1 && gradebookPos > activitiesPos, "gradebook card follows activities");
  assert.ok(en.includes("'settings.gradebook':"), "i18n key exists");
  assert.ok(en.includes("'settings.gradebook_sub':"), "i18n sub key exists");
});
