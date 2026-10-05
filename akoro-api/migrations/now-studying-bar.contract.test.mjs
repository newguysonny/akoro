import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Now-Studying bar contract — one bar, every session, no detours.
 *
 * 1. The course Agent session PARKS on the bar (title/course/video emoji,
 *    progress following the video, snapshot for reopening) and the course
 *    page reopens it from ?agent=<lessonId>.
 * 2. Records opened from the LIBRARY page park too — same shape and same
 *    live progress the dashboard shelf gives them.
 * 3. Clicking a parked SESSION continues STRAIGHT into it — the details
 *    sheet is gone from this path. Minimized teach/decay sessions ride
 *    along as snapshots and restore their own modal.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [viewer, page, dash, lib] = await Promise.all([
  read("../../akoro-learner/src/components/courses/AgentSessionViewer.jsx"),
  read("../../akoro-learner/src/pages/course-details/CourseDetailsPage.jsx"),
  read("../../akoro-learner/src/pages/LearnerDashboard.jsx"),
  read("../../akoro-learner/src/pages/LibraryPage.jsx"),
]);

test("the agent session parks on the Now-Studying bar", () => {
  assert.ok(viewer.includes("setNowStudying(uid, {"), "parks via the store's set seam");
  assert.ok(viewer.includes("type: 'course'"), "with its own type");
  assert.ok(viewer.includes("emoji: 'ti-video'"), "and a video glyph");
  assert.ok(viewer.includes("snapshot: { slug: course?.slug, lessonId: lesson?.id }"), "carrying where to reopen");
  assert.ok(viewer.includes("updateNowProgress(uid, barId,"), "progress follows the video");
  assert.ok(viewer.includes("uid && barId"), "guests don't park");
});

test("the bar reopens the agent session on the exact lesson", () => {
  assert.ok(dash.includes("type === 'course'"), "the dashboard knows the course type");
  assert.ok(dash.includes("?agent=${snap.lessonId}"), "and navigates with the lesson id");
  assert.ok(page.includes("get('agent')"), "the course page consumes the param");
  assert.ok(page.includes("replaceState"), "consumed once — no reopen loop on refresh");
  assert.ok(page.includes("l?.id === agentParam"), "reopening targets the exact lesson");
});

test("records opened from the Library park like dashboard records", () => {
  assert.ok(lib.includes("useNowStudying(STUDENT_ID)"), "the page subscribes to the store");
  assert.ok(lib.includes("nowActs.setCurrent({"), "opening parks the record");
  assert.ok(lib.includes("type: 'record', id: r.id, title: r.name"), "in the dashboard's exact shape");
  assert.ok(/handleRecordProgress[\s\S]*nowActs\.setProgress\(r\.id, pct\)/.test(lib), "watch milestones reach the bar");
  assert.ok(/handleRecordOpened[\s\S]*nowActs\.setProgress\(r\.id, 10\)/.test(lib), "first open gives it the 10% stamp");
});

test("continuing from the bar skips the details sheet", () => {
  const openNow = dash.slice(dash.indexOf("const openNowItem"));
  assert.ok(!openNow.slice(0, 2600).includes("openSessionTracked"), "no re-park via the sheet path");
  assert.ok(!openNow.slice(0, 2600).includes("setSelectedSession"), "the session branch never opens the sheet");
  assert.ok(openNow.includes("snap?.__restore === 'teach'"), "minimized teach sessions restore directly");
  assert.ok(openNow.includes("snap?.__restore === 'decay'"), "minimized decay sessions restore directly");
  assert.ok(openNow.includes("joinLive(live)"), "live classes join directly");
  assert.ok(openNow.includes('mode: "continuation"') || openNow.includes("mode: 'continuation'"), "agent sessions continue directly");
  assert.ok(openNow.includes("setConfigOpen(true)"), "fresh sessions go straight to teaching config");
  assert.ok(openNow.includes("now.session_ended"), "a vanished session says so honestly");
});

test("minimized sessions ride along as snapshots", () => {
  // The live session id rides in the snapshot so restoring reopens THE
  // session — resume inside the grace window, continuation from the saved
  // history after it — instead of a config lookalike with no conversation.
  assert.ok(dash.includes("snapshot: { __restore: 'teach', teach: { ...ts, sessionId: liveId } }"), "teach minimize parks its payload + live id");
  assert.ok(dash.includes("resumeSessionId: ts.sessionId || ts.id"), "teach restore resumes the parked session first");
  assert.ok(dash.includes("snapshot: { __restore: 'decay', decay: { ...d, ...(parked?.sessionId ? { resumeSessionId: parked.sessionId } : {}) } }"), "decay minimize parks its payload + live id");
});

test("the honesty toast exists in every locale", async () => {
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(new URL("../../akoro-learner/src/contexts/i18n", import.meta.url))).filter((f) => f.endsWith(".js") && f !== "index.js");
  assert.ok(files.length === 9, `expected 9 locales, found ${files.length}`);
  for (const f of files) {
    const txt = await read(`../../akoro-learner/src/contexts/i18n/${f}`);
    assert.ok(txt.includes("'now.session_ended'"), `${f} carries now.session_ended`);
  }
});
