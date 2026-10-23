import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Course Creator contract — the instructor's course builder, ported 1:1
 * from reference/Kpemu Course Builder.html: the migration creates the
 * edu.builder_* tree (courses → sections → lessons, live-session
 * scheduling + the JSONB exception map), /api/course-builder is the
 * instructor-scoped CRUD with the draft → review → published flow behind
 * it, and akoro-instructor's "Course Creator" section drives it.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [migration, manifest, routes, app, section, sectionCss, appJsx, layoutJsx,
  adminSection, adminCss, adminAppJsx, adminLayoutJsx] = await Promise.all([
  read("2026-course-builder.sql"),
  read("manifest.json"),
  read("../modules/course-builder/routes.js"),
  read("../app.js"),
  read("../../akoro-instructor/src/pages/course-creator/index.jsx"),
  read("../../akoro-instructor/src/pages/course-creator/cc.css"),
  read("../../akoro-instructor/src/App.jsx"),
  read("../../akoro-instructor/src/components/Layout.jsx"),
  read("../../akoro-admin/src/pages/course-approvals/index.jsx"),
  read("../../akoro-admin/src/pages/course-approvals/ca.css"),
  read("../../akoro-admin/src/App.jsx"),
  read("../../akoro-admin/src/components/Layout.jsx"),
]);

test("migration: the builder tree — courses, sections, lessons", () => {
  for (const t of ["builder_courses", "builder_sections", "builder_lessons"]) {
    assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS edu.${t}`), `table ${t}`);
  }
  // The chain cascades: course → sections → lessons.
  assert.ok((migration.match(/ON DELETE CASCADE/g) || []).length >= 2, "cascade chain");
  // Courses are instructor-owned and walk the prototype's review flow.
  assert.ok(migration.includes("owner_id"), "owner column");
  assert.ok(migration.includes("CHECK (status IN ('draft','review','published'))"), "status flow");
  assert.ok(migration.includes("CHECK (type IN ('video','live'))"), "course types");
  // Lessons carry the full content-type + live-session vocabulary.
  assert.ok(migration.includes("CHECK (type IN ('live','video','pdf','audio','article','link','slides'))"), "lesson types");
  for (const col of ["when_at", "end_time", "rep", "rep_until", "t2s", "t2e"]) {
    assert.ok(migration.includes(col), `live column ${col}`);
  }
  // The per-occurrence exception map is stored exactly as the prototype keeps it.
  assert.ok(/ex\s+JSONB NOT NULL DEFAULT '{}'::jsonb/.test(migration), "ex exception map as JSONB");
});

test("manifest: 2026-course-builder.sql runs with the every-deploy schema group", () => {
  const m = JSON.parse(manifest);
  assert.ok(Array.isArray(m.schema), "schema group is an array");
  assert.ok(m.schema.includes("2026-course-builder.sql"), "listed");
});

test("api: /api/course-builder is the instructor-scoped CRUD the section drives", () => {
  assert.ok(app.includes('app.use("/api/course-builder"'), "mounted in app.js");
  // Instructor guard on the whole router; admins keep the review queue.
  assert.ok(routes.includes('requireRole(["instructor", "admin"])'), "instructor+admin only");
  assert.ok(routes.includes("authenticateToken"), "authenticated");
  // Instructors only ever see and touch their own courses.
  assert.ok(routes.includes('q = q.eq("owner_id", req.user.id)'), "list scoped to owner");
  assert.ok(routes.includes("c.owner_id !== req.user.id"), "write guard per course");
  // Only admins publish, and only admins attach the review note.
  assert.ok(routes.includes('status === "published" && !isAdmin(req)'), "publish is admin-only");
  // Every screen of the section has its endpoint.
  for (const ep of [
    '"/courses"', '"/courses/:id"', '"/courses/:id/status"',
    '"/courses/:id/sections"', '"/courses/:id/sections/reorder"',
    '"/sections/:id"', '"/sections/:id/lessons"', '"/sections/:id/lessons/reorder"',
    '"/lessons/:id"',
  ]) {
    assert.ok(routes.includes(ep), `endpoint ${ep}`);
  }
  // Responses keep the prototype's field names so the ported UI runs unchanged.
  for (const k of ["sub:", "cat:", "pm:", "learn:", "when:", "rep:", "until:", "t2s:", "t2e:", "ex:"]) {
    assert.ok(routes.includes(k), `prototype field ${k}`);
  }
});

test("instructor app: the Course Creator section is wired in", () => {
  assert.ok(appJsx.includes('path="/course-creator/*"'), "route registered");
  assert.ok(appJsx.includes("course-creator/index.jsx"), "section imported");
  // The reference's sidebar pages, as an expandable group — the same
  // pattern as Student Information / the admin app's Program Courses.
  assert.ok(layoutJsx.includes("'Course Creator'"), "sidebar group label");
  assert.ok(layoutJsx.includes("to: '/course-creator', end: true"), "Home child");
  assert.ok(layoutJsx.includes("'/course-creator/courses'"), "My Courses child");
  assert.ok(layoutJsx.includes("'/course-creator/library'"), "Content Library child");
  // Review Queue only ever appears for admin sessions.
  assert.ok(layoutJsx.includes("'/course-creator/review'"), "Review Queue child");
  assert.ok(/user\?\.role === 'admin'[\s\S]{0,300}Review Queue/.test(layoutJsx), "review queue is admin-only");
});

test("section: every page of the prototype is ported", () => {
  for (const page of ["function Home", "function CoursesList", "function NewCourse", "function Builder",
    "function TabSections", "function TabDetails", "function TabPricing", "function TabPublish",
    "function SectionPage", "function LessonForm", "function Library", "function ReviewQueue",
    "function PreviewModal"]) {
    assert.ok(section.includes(page), page);
  }
  // The live-session vocabulary made it across.
  for (const fn of ["const occ =", "const eff =", "const repLabel =", "const exTxt =", "const checksOf ="]) {
    assert.ok(section.includes(fn), fn);
  }
  // Expand-into-sessions and the exception actions exist.
  assert.ok(section.includes("Expand into separate sessions"), "expand button");
  assert.ok(section.includes("Reschedule"), "reschedule action");
  // The six gradients, exactly.
  assert.equal((section.match(/linear-gradient\(145deg/g) || []).length, 6, "six gradients");
  // Live data, styled dialogs — never localStorage state or browser prompts.
  assert.ok(section.includes("/api/course-builder/courses"), "live API");
  assert.ok(!section.includes("localStorage.setItem"), "no localStorage state");
  assert.ok(!/window\.(prompt|confirm|alert)/.test(section), "no browser prompts");
  assert.ok(section.includes("confirmDialog"), "styled confirm");
  // No emoji in the ported UI (the reference uses drawn SVGs).
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(section.replace(/[\u2713\u2715\u2039\u203A\u2191\u2193]/g, "")), "no emoji");
});

test("admin app: the Course Approvals section is wired in", () => {
  assert.ok(adminAppJsx.includes('path="/course-approvals/*"'), "route registered");
  assert.ok(adminAppJsx.includes("course-approvals/index.jsx"), "section imported");
  assert.ok(adminAppJsx.includes("<AdminRoute>"), "behind the admin guard");
  assert.ok(adminLayoutJsx.includes("'/course-approvals'"), "sidebar nav entry");
  assert.ok(adminLayoutJsx.includes("'Course Approvals'"), "sidebar label");
});

test("admin approvals: queue, all-courses and inspection drive the same flow", () => {
  for (const page of ["function Queue", "function AllCourses", "function CourseView", "function PreviewModal"]) {
    assert.ok(adminSection.includes(page), page);
  }
  // Same live API and the one shared status endpoint — no second flow.
  assert.ok(adminSection.includes("/api/course-builder/courses"), "live API");
  assert.ok(adminSection.includes("/status"), "status endpoint");
  // The prototype's admin actions all exist.
  for (const a of ["Approve and publish", "Request changes", "Unpublish", "Tell the instructor what to fix"]) {
    assert.ok(adminSection.includes(a), `action ${a}`);
  }
  // The publish checklist travels with the course to the admin side.
  assert.ok(adminSection.includes("const checksOf ="), "checklist ported");
  assert.ok(adminSection.includes("Ready to publish?"), "checklist rendered");
  // Styled dialogs only; approvals are read-only inspection, never a prompt.
  assert.ok(adminSection.includes("confirmDialog"), "styled confirm");
  assert.ok(!/window\.(prompt|confirm|alert)/.test(adminSection), "no browser prompts");
  assert.ok(!adminSection.includes("localStorage.setItem"), "no localStorage state");
  // The six gradients, exactly.
  assert.equal((adminSection.match(/linear-gradient\(145deg/g) || []).length, 6, "six gradients");
});

test("admin approvals css: scoped under .caroot so nothing leaks into the shell", () => {
  const rules = adminCss.split("\n").filter((l) => /^[.a-zA-Z@\[]/.test(l.trim()) && l.includes("{"));
  for (const r of rules) {
    assert.ok(r.startsWith(".caroot") || r.startsWith("@"), `scoped: ${r.slice(0, 48)}`);
  }
  assert.ok(adminCss.includes(".caroot{"), "root block");
  for (const cls of [".pv", ".ps", ".pr", ".chk", ".ck", ".note", ".facts"]) {
    assert.ok(adminCss.includes(`.caroot ${cls}`), `class ${cls}`);
  }
});

test("section css: scoped under .ccroot so nothing leaks into the shell", () => {
  const rules = sectionCss.split("\n").filter((l) => /^[.a-zA-Z@\[]/.test(l.trim()) && l.includes("{"));
  for (const r of rules) {
    assert.ok(r.startsWith(".ccroot") || r.startsWith("@") || r.startsWith("/*"), `scoped: ${r.slice(0, 48)}`);
  }
  assert.ok(sectionCss.includes(".ccroot{"), "root block");
  // The prototype's phone-preview classes survive.
  for (const cls of [".pv", ".ps", ".pn", ".pf", ".chv", ".pr", ".pb", ".pbc"]) {
    assert.ok(sectionCss.includes(`.ccroot ${cls}`), `preview class ${cls}`);
  }
  // Same components, on the console theme: accent and text are the theme's
  // brand and text tokens (amber on ink on ?ui=legacy, purple on ?ui=next,
  // see src/theme/legacyVars.js) — no hard-coded Kpemu purple anywhere.
  assert.ok(sectionCss.includes("--fg:var(--ak-brand)"), "brand accent");
  assert.ok(sectionCss.includes("--text:var(--ak-text)"), "theme text");
  assert.ok(sectionCss.includes("'DM Sans'"), "brand font");
  for (const purple of ["#6c3cff", "#9a7dff", "#4b1fd1", "#a78bfa"]) {
    assert.ok(!sectionCss.includes(purple), `no reference purple ${purple}`);
  }
  // Navigation lives in the dashboard sidebar now — no in-page pill nav.
  assert.ok(!sectionCss.includes(".ccnav"), "pill nav gone");
});
