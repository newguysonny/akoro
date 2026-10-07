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

/* ── folders, Pharm.D and the shelf: everything parks, the bar shows
   everywhere the learner browses ─────────────────────────────────────── */

const read2 = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [bar, folderPage, pharmd, hub] = await Promise.all([
  read2("../../akoro-learner/src/components/dashboard/NowStudyingBar.jsx"),
  read2("../../akoro-learner/src/components/library/LibraryFolderPage.jsx"),
  read2("../../akoro-learner/src/components/pharmd/PharmDProgram.jsx"),
  read2("../../akoro-learner/src/components/tabs/DiscoverHub.jsx"),
]);

test("the bar itself renders inside full-screen pages (sticky variant)", () => {
  assert.ok(bar.includes("sticky = false"), "a sticky mode exists");
  assert.ok(bar.includes("position: 'sticky'"), "pinned inside the page column, not the viewport");
  assert.ok(bar.includes("zIndex: 30"), "stacked under those pages' sheets (z 40)");
});

test("the Library page shows the bar on both layouts", () => {
  assert.ok(lib.includes("nowStudying={{ ...now,"), "AppShell gets the store (the tablet bar)");
  assert.ok(lib.includes("ak-lib-nowbar"), "a mobile bar renders on the page itself");
  assert.ok(lib.includes("@media (min-width:769px){.ak-lib-nowbar{display:none}}"), "mobile only — the tablet bar covers desktop");
  assert.ok(lib.includes("openNowFromLibrary"), "with its own resume handler");
  assert.ok(lib.includes("type: 'library'"), "shelf opens park with their route");
  assert.ok(lib.includes("snapshot: { path }"), "the snapshot carries the route");
});

test("folder items park when they open, and the folder page shows the bar", () => {
  assert.ok(folderPage.includes("nowItem, onNowOpen, onNowDismiss"), "the folder page takes the bar props");
  assert.ok(folderPage.includes("<NowStudyingBar sticky"), "and renders the sticky bar");
  assert.ok(folderPage.includes("nowItem && !sheet &&"), "hidden while a sheet is up");
  assert.ok(lib.includes("type: 'pharmd'"), "a parked Pharm.D topic from a folder");
  assert.ok(lib.includes("FILE_TYPE_META[it.kind]?.icon || getMeta(it.kind).icon"), "folder links park with their kind's glyph");
});

test("Pharm.D topics park, and the programme page shows the bar", () => {
  assert.ok(pharmd.includes("useNowStudying(STUDENT_ID)"), "the programme subscribes to the store");
  assert.ok(pharmd.includes("type: 'pharmd'"), "opening a topic parks it");
  assert.ok(pharmd.includes("emoji: 'ti-stethoscope'"), "with the Pharm.D glyph");
  assert.ok(pharmd.includes("snapshot: { code, topicId: String(t.id) }"), "carrying where to reopen");
  assert.ok(pharmd.includes("<NowStudyingBar sticky"), "the bar renders in the phone column");
  assert.ok(pharmd.includes("sessionTopic === null && !sheet"), "hidden while the topic session or a sheet is up");
});

test("the dashboard resumes the new types", () => {
  assert.ok(dash.includes("type === 'library'"), "library: navigate the parked route");
  assert.ok(dash.includes("navigate(now.item.snapshot.path)"), "straight back to the content");
  assert.ok(dash.includes("type === 'pharmd'"), "pharmd: straight to the programme page");
  assert.ok(dash.includes("setPharmdFocus({ ...now.item.snapshot, ts: Date.now() })"), "with a fresh focus timestamp");
  assert.ok(dash.includes("view=pharmd"), "landing on the programme's URL — course included");
  assert.ok(dash.includes("focus={pharmdFocus}"), "the dashboard threads the focus into PharmDProgram");
  assert.ok(dash.includes("courseRoute={pharmdCourseFromUrl()}"), "with the URL's course");
  assert.ok(hub.includes("onOpenPharmd?.()"), "the hub's Pharm D card routes through the shell");
  assert.ok(pharmd.includes("focusedRef"), "the programme opens the parked topic once its list lands");
});
