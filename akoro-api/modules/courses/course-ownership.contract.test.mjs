/**
 * Phase 15 item 6 (ownership audit, 2026-11-01): a route that takes a course,
 * module, lesson, session, video or message id checks that it belongs to the
 * caller. The instructor role alone is not ownership — every teacher has it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const access = read("./courseAccess.js");
const content = read("./course-content.js");
const progress = read("./progress.js");
const payments = read("./payments.js");
const live = read("./live-sessions.js");
const chat = read("./chat.js");
const qa = read("./qa-announcements.js");
const subtitles = read("./subtitles.js");
const scheduler = read("./scheduler.js");

/** The body of `name: asyncHandler(async (req, res) => { … })` up to the next handler. */
const handler = (src, name, from = 0) => {
  const start = src.indexOf(`  ${name}: asyncHandler(`, from);
  assert.ok(start >= 0, `${name} handler found`);
  const next = src.indexOf(": asyncHandler(", start + name.length + 20);
  return src.slice(start, next < 0 ? undefined : next);
};

test("courseAccess: managing is the course's instructor or an admin; using adds an active enrolment", () => {
  assert.match(access, /export async function canManageCourse\(user, courseId\)/);
  assert.match(access, /if \(isAdmin\(user\)\) return true;\s*return \(await instructorOf\(courseId\)\) === user\.id;/);
  assert.match(access, /\.eq\("user_id", userId\)\.eq\("course_id", courseId\)\.eq\("status", "active"\)/);
  assert.match(access, /export const requireCourseManager = \(param = "courseId"\)/);
  assert.doesNotMatch(access, /role === "instructor"/, "the instructor role is never ownership");
});

test("course content: modules and lessons change only in the caller's own course", () => {
  const modules = content.slice(content.indexOf("const moduleHandlers"), content.indexOf("const lessonHandlers"));
  const lessons = content.slice(content.indexOf("const lessonHandlers"));
  assert.match(handler(modules, "update"), /guardModuleWrite\(req, res, moduleId\)/);
  assert.match(handler(modules, "delete"), /guardModuleWrite\(req, res, req\.params\.moduleId\)/);
  const create = handler(lessons, "create");
  assert.match(create, /\(await courseOfModule\(moduleId\)\) !== courseId\) return res404/);
  assert.match(create, /canManageCourse\(req\.user, courseId\)/);
  assert.match(handler(lessons, "update"), /guardLessonWrite\(req, res, req\.params\.lessonId\)/);
  assert.match(handler(lessons, "delete"), /guardLessonWrite\(req, res, req\.params\.lessonId\)/);
  for (const g of ["guardModuleWrite", "guardLessonWrite"]) {
    const at = content.indexOf(`async function ${g}`);
    const body = content.slice(at, content.indexOf("\n}\n", at));
    assert.match(body, /canManageCourse\(req\.user, courseId\)/, `${g} checks the course owner`);
  }
});

test("course content: completing a lesson or taking its quiz needs a preview or a place in the course", () => {
  assert.match(content, /const mayOpenLesson = async \(user, lesson\) =>\s*!!lesson\.is_preview \|\| canUseCourse\(user, lesson\.course_modules\?\.course_id\)/);
  const lessons = content.slice(content.indexOf("const lessonHandlers"));
  assert.match(handler(lessons, "complete"), /select\("id, is_preview, course_modules\(course_id\)"\)[\s\S]*mayOpenLesson\(req\.user, lesson\)/);
  assert.match(handler(lessons, "submitQuiz"), /is_preview[\s\S]*mayOpenLesson\(req\.user, lesson\)[\s\S]*correct_answer/);
});

test("course analytics and the student list (with emails) are the course owner's", () => {
  assert.match(progress, /analytics\/engagement",\s+authenticateToken, requireRole\(\["instructor", "admin"\]\), requireCourseManager\(\)/);
  assert.match(progress, /analytics\/sessions",\s+authenticateToken, requireRole\(\["instructor", "admin"\]\), requireCourseManager\(\)/);
  assert.match(payments, /"\/courses\/:courseId\/students",\s+authenticateToken, requireRole\(\["instructor", "admin"\]\), requireCourseManager\(\)/);
});

test("transactions: an admin sees all, an instructor their courses, every other role only their own", () => {
  const scope = payments.slice(payments.indexOf("async function scopeToCaller"), payments.indexOf("const transactionHandlers"));
  assert.match(scope, /if \(user\.role === "admin"\) return q;/);
  assert.match(scope, /if \(user\.role === "instructor"\)/);
  assert.match(scope, /return q\.eq\("user_id", user\.id\);\s*\}$/m, "the fall-through is the caller's own payments");
  const tx = payments.slice(payments.indexOf("const transactionHandlers"), payments.indexOf("// ─── Router"));
  assert.equal((tx.match(/await scopeToCaller\(/g) || []).length, 2, "list and summary both scope");
  assert.doesNotMatch(tx, /role === "student"/, "no list of roles that get filtered — everyone else is filtered");
});

test("live sessions: the participant list (emails) and analytics are the session host's", () => {
  assert.match(live, /const requireSessionHost = asyncHandler[\s\S]*?session\.instructor_id !== req\.user\.id && req\.user\.role !== "admin"/);
  assert.match(live, /\/participants",\s+authenticateToken, requireRole\(\["instructor", "admin"\]\), requireSessionHost,/);
  assert.match(live, /\/analytics",\s+authenticateToken, requireRole\(\["instructor", "admin"\]\), requireSessionHost,/);
});

test("course chat: members read and post; the course's teacher pins and moderates", () => {
  for (const p of ["/courses/:courseId/messages\"", "/courses/:courseId/messages/pinned\"", "/courses/:courseId/messages/agent\""]) {
    const at = chat.indexOf(p);
    assert.ok(at > 0, p);
    assert.match(chat.slice(at, chat.indexOf("\n", at)), /authenticateToken, requireCourseMember,/, p);
  }
  assert.match(chat, /requireCourseMember = asyncHandler[\s\S]*?canUseCourse\(req\.user, req\.params\.courseId\)/);
  assert.match(handler(chat, "togglePin"), /canManageCourse\(req\.user, msg\.course_id\)/);
  assert.match(handler(chat, "delete"), /!isOwner && !\(await canManageCourse\(req\.user, msg\.course_id\)\)/);
  assert.match(handler(chat, "toggleLike"), /canUseCourse\(req\.user, target\.course_id\)/);
  assert.doesNotMatch(chat, /\["instructor", "admin"\]\.includes\(req\.user\.role\)\)\s*return res403/, "no role-only pin gate");
});

test("Q&A: the author or the course's teacher resolves and deletes a question", () => {
  for (const name of ["resolveQuestion", "deleteQuestion"]) {
    const h = handler(qa, name);
    assert.match(h, /select\("user_id, course_id/);
    assert.match(h, /question\.user_id === req\.user\.id \|\| await canManageCourse\(req\.user, question\.course_id\)/);
  }
});

test("subtitles: changing or deleting a track needs the video's course, like the upload", () => {
  assert.match(subtitles, /async function guardVideoOwner[\s\S]*?video\.courses\?\.instructor_id !== req\.user\.id/);
  assert.match(handler(subtitles, "setDefault"), /guardVideoOwner\(req, res, videoId\)/);
  assert.match(handler(subtitles, "delete"), /guardVideoOwner\(req, res, videoId\)/);
});

test("scheduler: only the host provisions or forces a session; enrolled learners may read the link", () => {
  assert.match(scheduler, /async function sessionFor\(req, res, \{ learners = false \} = \{\}\)/);
  assert.match(scheduler, /s\.instructor_id === req\.user\.id \|\| req\.user\.role === "admin"/);
  assert.match(scheduler, /if \(learners && await isEnrolled\(req\.user\.id, s\.course_id\)\) return s;/);
  const handlers = scheduler.slice(scheduler.indexOf("const schedulerHandlers"));
  assert.equal((handlers.match(/await sessionFor\(req, res\)/g) || []).length, 3, "createLink, activate, end");
  assert.match(handlers, /getLinkBySession: wrap[\s\S]*?sessionFor\(req, res, \{ learners: true \}\)/);
  assert.doesNotMatch(handlers, /await loadSession\(req\.params\.sessionId\);\s*if \(!s\)/, "no handler loads a session by id alone");
});
