import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Submissions workbench contract — grading mirrors the workbench family
 * (activities rail on one side, roster on the other, grading as a full-page
 * workspace). Drafts autosave locally until publish; the published grade
 * lands on the learner's target row, flows to /mine, and fills the learner
 * gradebook's graded seam.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [routes, migration, manifest, page, modal, drafts, nowGrading, appRoutes, layout, activityApi, gradebookApi] = await Promise.all([
  read("../../akoro-api/modules/self-study/routes.js"),
  read("../../akoro-api/migrations/2026-submission-grading.sql"),
  read("../../akoro-api/migrations/manifest.json"),
  read("../../akoro-instructor/src/pages/SubmissionsPage.jsx"),
  read("../../akoro-instructor/src/components/grading/GradeSubmissionModal.jsx"),
  read("../../akoro-instructor/src/components/grading/gradingDrafts.js"),
  read("../../akoro-instructor/src/components/grading/NowGrading.jsx"),
  read("../../akoro-instructor/src/App.jsx"),
  read("../../akoro-instructor/src/components/NextLayout.jsx"),   // the console frame (the legacy Layout nav is gone)
  read("../../akoro-learner/src/services/activityApi.js"),
  read("../../akoro-learner/src/services/gradebookApi.js"),
]);

test("the workbench mirrors the family: activities rail, roster, guidance note", () => {
  assert.ok(page.includes("SUBMITTED ACTIVITIES"), "left rail of submitted activities");
  assert.ok(page.includes("WHO TO GRADE FIRST"), "guidance note in the workbench voice");
  assert.ok(page.includes("apiGet('/api/self-study')"), "activities come from the real feed");
  assert.ok(page.includes("apiGet(`/api/self-study/${key}`)"), "roster from the activity detail");
  assert.ok(page.includes("<NowGrading"), "the resume strip sits above the workbench");
  assert.ok(page.includes("<GradeSubmissionModal"), "grading opens the full-page workspace");
  // Submitted-first sorting + a submitted-count badge on each rail row.
  assert.ok(page.includes("y.submitted - x.submitted"), "busiest activities first");
  assert.ok(page.includes("{a.submitted}"), "submission badges");
});

test("grading is the reference workspace, honest about the paper", () => {
  // Full-page workspace with student stepper and status pill.
  assert.ok(modal.includes("Grade submission —"), "topbar crumb");
  assert.ok(modal.includes("{index + 1} of {students.length}"), "student stepper");
  assert.ok(modal.includes("Graded ·"), "status pill");
  // Paper = the brief, question by question, plus what the learner handed in.
  assert.ok(modal.includes("WHAT THEY WERE ASKED"), "objectives render as the brief");
  assert.ok(modal.includes("WHAT THEY SUBMITTED"), "the real submission renders in the paper");
  assert.ok(modal.includes("downloadActivityFile"), "attachments download through the authed seam");
  assert.ok(modal.includes("No written submission was captured"), "honest when there is nothing to show");
  // Rubric with worded levels + a total, and a manual override.
  assert.ok(modal.includes("Understanding of concept"), "rubric criteria");
  assert.ok(modal.includes("['manual', 'Manual']") && modal.includes("SCORE FROM"), "manual override in the score-from chooser");
  assert.ok(modal.includes("['questions', 'Question marks']"), "question-by-question marks score the work when there are questions");
  assert.ok(modal.includes("pick a level in every row"), "total nudges completion");
  // Publish is the only server write.
  assert.ok(modal.includes("/grade`"), "publishes to the grade endpoint");
  assert.ok(modal.includes("clearDraft(brief.id, current.student.id)"), "a published draft is consumed");
  assert.ok(modal.includes("st.grade == null"), "advance to the next ungraded student");
});

test("drafts autosave locally and resume through NowGrading", () => {
  assert.ok(drafts.includes("localStorage.setItem"), "drafts live in localStorage");
  assert.ok(drafts.includes("listDrafts"), "drafts are enumerable for the strip");
  assert.ok(modal.includes("saveDraft({"), "every change autosaves");
  assert.ok(modal.includes("loadDraft(brief?.id, current.student.id)"), "opening resumes the draft");
  assert.ok(modal.includes("Draft saved"), "the autosave label is visible");
  // NowGrading mirrors NowStudying: who, what, continue, dismiss.
  assert.ok(nowGrading.includes("Now grading —"), "the strip names the session");
  assert.ok(nowGrading.includes("Continue"), "one tap resumes");
  assert.ok(nowGrading.includes("clearDraft(d.assignmentId, d.studentId)"), "dismiss discards");
  // Routed.
  assert.ok(appRoutes.includes('path="/submissions"'), "workbench route");
  assert.ok(layout.includes("label: 'Submissions', to: '/submissions'"), "nav entry");
});

test("the work itself is captured end to end — upload, submit, grade against it", async () => {
  const [captureMigration, learnerPage] = await Promise.all([
    read("2026-activity-submissions.sql"),
    read("../../akoro-learner/src/pages/ActivityDetailPage.jsx"),
  ]);
  // Migration: the submission lives on the target row; files cascade with it.
  assert.ok(captureMigration.includes("ADD COLUMN IF NOT EXISTS submission"), "submission column");
  assert.ok(captureMigration.includes("CREATE TABLE IF NOT EXISTS edu.self_study_files"), "files table");
  assert.ok(manifest.includes('"2026-activity-submissions.sql"'), "migration registered");
  // API: upload, download (learner-or-owning-teacher), immutable after submit.
  assert.ok(routes.includes('router.post("/:id/files"'), "upload endpoint");
  assert.ok(routes.includes('router.get("/files/:fileId"'), "download endpoint");
  assert.ok(routes.includes("ownedAssignment(req, t.assignment_id)"), "teachers reach files through the activity");
  assert.ok(routes.includes("the teacher needs to see this file"), "submitted files are immutable");
  // Complete captures the work: text + answers + fileIds on the target.
  assert.ok(routes.includes("const submission = { text, answers, files, submittedAt, ...(late ? { late: true"), "complete stores the work (and whether it was late)");
  assert.ok(routes.includes("submission:   t.submission ?? null"), "/mine carries the submission");
  // The grading workspace shows it; the learner sees what they handed in.
  assert.ok(modal.includes("current.submission"), "the paper reads the submitted work");
  assert.ok(learnerPage.includes("Your submission"), "the learner's details page shows their submitted work");
  assert.ok(learnerPage.includes("uploadActivityFile"), "files upload for real, not just locally");
});

test("a published grade reaches the learner end to end", () => {
  // Migration: the grade lives on the learner's target row.
  assert.ok(migration.includes("ADD COLUMN IF NOT EXISTS grade"), "grade column");
  assert.ok(migration.includes("ADD COLUMN IF NOT EXISTS feedback"), "feedback column");
  assert.ok(manifest.includes('"2026-submission-grading.sql"'), "migration registered");
  // API: publish route validates, notifies, and emits.
  assert.ok(routes.includes('router.patch("/:id/targets/:studentId/grade"'), "publish endpoint");
  assert.ok(routes.includes('n < 0 || n > 100'), "0–100 validation");
  assert.ok(routes.includes('type: "activity_graded"'), "learner notified");
  assert.ok(routes.includes('emit("activity_graded"'), "learner dinged live");
  // /mine carries the grade, so the graded seams light up.
  assert.ok(routes.includes("graded:       t.grade != null"), "graded flag in /mine");
  assert.ok(activityApi.includes("graded:     !!a.graded"), "learner feed passes the flag");
  // The gradebook's mark becomes the number.
  assert.ok(gradebookApi.includes("a.graded ? a.grade :"), "gradebook shows the published mark");
});
