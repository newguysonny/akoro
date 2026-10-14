import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Program Courses contract — the admin's programme builder:
 * the migration creates the edu.programmes tree and connects the Pharm.D
 * catalogue as its first programme (linked by source ids, idempotent on
 * re-run), the /api/programmes module is the admin-only CRUD behind it,
 * and akoro-admin's "Program Courses" section (ported 1:1 from the
 * prototype) drives it. The Pharm.D learner tables are read-only sources:
 * nothing here writes to them.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [migration, manifest, routes, app, section, sectionCss, appJsx, layoutJsx] = await Promise.all([
  read("2026-programmes.sql"),
  read("manifest.json"),
  read("../modules/programmes/routes.js"),
  read("../app.js"),
  read("../../akoro-admin/src/pages/programmes-page/index.jsx"),
  read("../../akoro-admin/src/pages/programmes-page/pc.css"),
  read("../../akoro-admin/src/App.jsx"),
  read("../../akoro-admin/src/components/Layout.jsx"),
]);

test("migration: the programme tree, sections, courses, materials and log", () => {
  for (const t of ["programmes", "programme_sections", "programme_courses", "programme_materials", "programme_log"]) {
    assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS edu.${t}`), `table ${t}`);
  }
  // Sections are unique per programme (the prototype's years).
  assert.ok(migration.includes("UNIQUE (programme_id, name)"), "section name unique per programme");
  // The full chain cascades: programme → sections → courses → materials.
  assert.ok((migration.match(/ON DELETE CASCADE/g) || []).length >= 4, "cascade chain");
  // Source links keep the Pharm.D import re-runnable without duplication.
  assert.ok(migration.includes("source_programme_id"), "programme source link");
  assert.ok(migration.includes("source_course_id"), "course source link");
  assert.ok(migration.includes("source_topic_id"), "material source link");
});

test("migration: connects Pharm.D as the first programme, idempotently", () => {
  assert.ok(migration.includes("FROM edu.pharmd_programmes"), "reads the pharmd catalogue");
  assert.ok(migration.includes("source = 'pharmd'"), "marked as sourced");
  assert.ok(migration.includes("instructor"), "carries instructors");
  assert.ok(migration.includes("'Akoro'"), "default instructor");
  // WHERE NOT EXISTS on source ids — re-runs never duplicate.
  assert.ok((migration.match(/WHERE NOT EXISTS/g) || []).length >= 4, "import guarded per row");
  // The learner-facing pharmd tables are never written here.
  assert.ok(!/INSERT\s+INTO\s+edu\.pharmd_/i.test(migration), "pharmd tables untouched");
  // One-time "Programme connected" log line, guarded on an empty log.
  assert.ok(migration.includes("programme_log") && migration.includes("Programme connected"), "first log line");
});

test("manifest: 2026-programmes.sql runs with the every-deploy schema group", () => {
  const m = JSON.parse(manifest);
  const schema = m.schema;
  assert.ok(Array.isArray(schema), "schema group is an array");
  const at = schema.indexOf("2026-programmes.sql");
  assert.ok(at >= 0, "listed");
  const pharmd = schema.indexOf("2026-pharmd-courses.sql");
  assert.ok(pharmd >= 0 && at > pharmd, "runs after the pharmd migration it imports from");
});

test("api: /api/programmes is the admin-only CRUD the section drives", () => {
  // Mounted like the other console modules.
  assert.ok(app.includes('app.use("/api/programmes"'), "mounted in app.js");
  // Admin guard on the whole router.
  assert.ok(routes.includes('requireRole(["admin"])'), "admin-only");
  assert.ok(routes.includes("authenticateToken"), "authenticated");
  // Every screen of the section has its endpoint.
  for (const ep of [
    '"/overview"', '"/programs"', '"/programs/:id"', 'router.post(`/programs/:id/${status}`',
    '"/programs/:id/sections"', '"/programs/:id/sections/reorder"', '"/sections/:id"',
    '"/courses"', '"/courses/:id"', '"/courses/:id/move"',
    '"/materials"', '"/materials/:id"', '"/materials/:id/move"', '"/log"',
  ]) {
    assert.ok(routes.includes(ep), `endpoint ${ep}`);
  }
  assert.ok(routes.includes('log: Array.isArray(logResult?.data) ? logResult.data : []'), "overview exposes log rows as an array");
  // Every write lands in the activity log via the logWrite helper.
  assert.ok(routes.includes('from("programme_log").insert'), "logWrite inserts into programme_log");
  assert.ok((routes.match(/logLine\(/g) || []).length >= 6, "writes append to programme_log");
});

test("admin: the Program Courses section is routed, navigable and 1:1", () => {
  // App.jsx: the section route + its import.
  assert.ok(appJsx.includes('path="/program-courses/*"'), "section route");
  assert.ok(appJsx.includes("pages/programmes-page/index.jsx"), "section import");
  assert.ok(appJsx.includes('<PageLayout title="Program Courses"'), "section uses the shared header/sidebar shell");
  // Layout: the sidebar group with the prototype's four destinations.
  assert.ok(layoutJsx.includes("'Program Courses'"), "nav group");
  for (const to of ["/program-courses", "/program-courses/programs", "/program-courses/courses", "/program-courses/contents"]) {
    assert.ok(layoutJsx.includes(`'${to}'`), `nav child ${to}`);
  }
  // Every page of the prototype exists as its own component (hook-safe).
  for (const c of ["Home", "ProgramsList", "ProgramDetail", "SectionDetail", "CoursesList", "CourseDetail", "ContentsList", "ProgramForm", "CourseForm", "ItemForm"]) {
    assert.ok(section.includes(`function ${c}`), `page ${c}`);
  }
  // The reference's vocabulary: 6 gradients, 6 material types.
  assert.ok((section.match(/linear-gradient\(145deg/g) || []).length === 6, "six card gradients");
  for (const ty of ["pdf", "video", "audio", "note", "link", "slides"]) {
    assert.ok(section.includes(`${ty}:`) || section.includes(`'${ty}'`) || section.includes(`"${ty}"`), `type ${ty}`);
  }
  // It talks to the real API, not mocks.
  assert.ok(section.includes("/api/programmes/overview"), "live overview");
  assert.ok(section.includes("/api/programmes/programs"), "live programs");
  assert.ok(section.includes("/api/programmes/materials"), "live materials");
  // Prototype fidelity: search pills, reorder toggles, status chips.
  assert.ok(sectionCss.includes(".sbox"), "pill search");
  assert.ok(sectionCss.includes(".cnb"), "numbered content");
  assert.ok(sectionCss.includes("width:720px"), "the reference's 720px column");
});

test("admin: section names go through the styled modal, never a browser prompt", () => {
  assert.ok(section.includes("function NameModal"), "styled modal component");
  assert.ok(!section.includes("window.prompt"), "no window.prompt anywhere");
  assert.ok(section.includes("mode: 'rename'"), "rename opens the modal");
  assert.ok(section.includes("setModal({ mode: 'add' })"), "add opens the modal");
  assert.ok(sectionCss.includes(".mroot"), "overlay css");
  assert.ok(sectionCss.includes(".mcard"), "modal card css");
});

test("admin: every read unwraps the { success, data } envelope", () => {
  // apiGet returns the raw envelope; the section funnels ALL reads through
  // the get() helper. A direct read hands React an object where it expects
  // an array — the crash that blanked every page but home.
  assert.ok(section.includes("const get = async (path)"), "unwrap helper");
  const direct = section.split("\n").filter((l) => l.includes("apiGet(") && !l.includes("await apiGet(path)"));
  assert.deepEqual(direct, [], "apiGet is only called inside the helper");
  assert.ok(section.includes("const updates = Array.isArray(ov.log)"), "overview updates tolerate old Supabase result envelopes");
  assert.ok(section.includes("updates.map((l) => ("), "updates render from the normalized array");
  // Phone shell: the section goes full-width below 768px (the header is the mobile surface).
  assert.ok(sectionCss.includes("max-width:768px"), "small-screen adoption");
});

/* ── No-emoji guard: the new section renders drawn SVGs only ────────────── */
const EMOJI = /[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{1F1E6}-\u{1F1FF}]/u;

test("admin+api: the new Program Courses files render no emoji", async () => {
  const files = {
    "section": section,
    "section css": sectionCss,
    "programmes routes": routes,
    "programmes migration": migration,
  };
  for (const [name, src] of Object.entries(files)) {
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Strip JSX entity references before scanning (typographic arrows stay).
      const line = lines[i].replace(/&[a-z]+;|&#\d+;/g, "");
      assert.ok(!EMOJI.test(line), `${name}:${i + 1} contains an emoji: ${line.trim().slice(0, 60)}`);
    }
  }
});

test("admin: hook discipline — every page component declares hooks before any return", () => {
  // The class of crash that bit the dedicated pages: a URL branch that
  // returns before its hooks. Each page here is its own component with
  // hooks at the top; pin that no "return" precedes the first use* in a
  // component body.
  const bodies = section.split(/\n(?=function |const \w+ = \(\) =>|export default function )/);
  for (const body of bodies) {
    const m = body.match(/function (\w+)/);
    if (!m) continue;
    const [, name] = m;
    const firstHook = body.search(/\buse[A-Z]\w*\(/);
    const firstReturn = body.search(/\breturn [<(]/);
    if (firstHook === -1 || firstReturn === -1) continue;
    assert.ok(firstHook < firstReturn, `${name} returns before declaring hooks`);
  }
});
