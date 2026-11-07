/**
 * Phase 11 / D39: a school sees its linked learners' struggles. The admin sees
 * every class, a teacher only the classes (and subjects) they teach, nobody
 * else anything; no data on unlinked students or learners outside the school;
 * sensitive struggles only as a "may need support" flag whose opening is
 * logged first. Pure core + the routes over the in-memory fake db.
 */
process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";

const { default: db } = await import("../../db.js");
const { installFakeDb } = await import("../../lib/testing/fakeDb.mjs");
const S = await import("./learnerStruggles.js");
const { STRUGGLE_TYPES, SENSITIVE_TYPES, STRUGGLE_CATEGORIES } = await import("../adaptive-learning/struggleTypes.js");

const NOW = Date.parse("2026-11-01T12:00:00Z");
const ago = (days) => new Date(NOW - days * 86_400_000).toISOString();

test("the taxonomy: 41 types in 8 categories, six sensitive (§7.15)", () => {
  assert.equal(Object.keys(STRUGGLE_TYPES).length, 41);
  assert.equal(Object.keys(STRUGGLE_CATEGORIES).length, 8);
  assert.deepEqual([...SENSITIVE_TYPES].sort(), ["anxiety", "confidence_collapse", "fixed_mindset", "frustration_giving_up", "health_energy", "test_anxiety"]);
  for (const t of Object.values(STRUGGLE_TYPES)) assert.ok(STRUGGLE_CATEGORIES[t.category], t.id);
});

test("rule types from concept evidence: open, then resolved by the evidence that clears them", () => {
  const ev = (kind, days, q = 0.5, concept = "c1") => ({ learner_id: "u1", concept_id: concept, observation_kind: kind, response_quality: q, observed_at: ago(days) });
  const out = S.deriveEvidenceStruggles([
    ev("misconception_detected", 10), ev("misconception_cleared", 3),
    ev("partial_understanding", 9),
    ev("recall_gap", 20, 0.2, "c2"),                       // a gap before ever knowing it: not decay
    ev("recall_success", 8, 0.9, "c2"), ev("recall_gap", 2, 0.2, "c2"),
    ev("assessment_result", 7, 0.8, "c3"), ev("assessment_result", 1, 0.3, "c3"),
  ]);
  const get = (type, concept) => out.find((s) => s.type === type && s.conceptId === concept);
  assert.equal(get("misconception", "c1").status, "resolved");
  assert.equal(get("partial_understanding", "c1").status, "open");
  assert.equal(get("decay", "c2").status, "open");
  assert.equal(get("decay", "c2").detectedAt, ago(2));
  assert.equal(get("retest_failure", "c3").status, "open");
  assert.equal(out.length, 4);
});

test("recorded struggles: off-list, abandoned and expired drop; sensitive keep type and date only", () => {
  const rows = S.normaliseRecorded([
    { learner_id: "u1", struggle_type: "not_a_type", status: "open", detected_at: ago(1) },
    { learner_id: "u1", struggle_type: "decay", status: "abandoned", detected_at: ago(1) },
    { learner_id: "u1", struggle_type: "health_energy", status: "open", detected_at: ago(40) },
    { learner_id: "u1", struggle_type: "anxiety", status: "open", detected_at: ago(1), expires_at: ago(0.5) },
    { learner_id: "u1", struggle_type: "test_anxiety", status: "open", detected_at: ago(1), struggle_summary: "freezes in tests", what_worked: "x" },
    { learner_id: "u1", struggle_type: "misconception", status: "resolved", detected_at: ago(5), resolved_at: ago(1), what_worked: "a different analogy", what_worked_strategy: "different_analogy" },
  ], NOW);
  assert.deepEqual(rows.map((r) => r.type), ["test_anxiety", "misconception"]);
  assert.equal(rows[0].summary, undefined); assert.equal(rows[0].whatWorked, undefined);
  assert.equal(rows[1].whatWorked, "a different analogy");
});

test("the support flag: 2+ open sensitive struggles within 14 days", () => {
  const s = (type, days, status = "open") => ({ type, status, detectedAt: ago(days) });
  assert.equal(S.supportFlag([s("anxiety", 3)], NOW), null);
  assert.equal(S.supportFlag([s("anxiety", 3), s("fixed_mindset", 20)], NOW), null, "outside the window");
  assert.equal(S.supportFlag([s("anxiety", 3), s("test_anxiety", 5, "resolved")], NOW), null, "resolved ones don't count");
  assert.deepEqual(S.supportFlag([s("anxiety", 3), s("test_anxiety", 5), s("decay", 1)], NOW), { open: 2 });
});

const CLASSES = [{ id: "jss1", name: "JSS1" }, { id: "jss2", name: "JSS2" }];
const STUDENTS = [
  { id: "s1", user_id: "u1", class_id: "jss1", first_name: "Ada", last_name: "Obi", status: "active", school_id: "sch" },
  { id: "s2", user_id: "u2", class_id: "jss1", first_name: "Bayo", last_name: "Ade", status: "active", school_id: "sch" },
  { id: "s3", user_id: null, class_id: "jss1", first_name: "Chi", last_name: "Eze", status: "active", school_id: "sch" },
  { id: "s4", user_id: "u4", class_id: "jss2", first_name: "Dele", last_name: "Okon", status: "active", school_id: "sch" },
];
const CONCEPTS = new Map([["c-sci", { title: "Evaporation vs transpiration", subject: "Basic Science" }], ["c-math", { title: "Fractions", subject: "Mathematics" }]]);
const st = (learnerId, type, conceptId, status = "open", days = 2) => ({ learnerId, type, conceptId, status, detectedAt: ago(days), resolvedAt: status === "resolved" ? ago(1) : null, source: "evidence" });

test("the view: linked learners only, sensitive hidden behind the flag, class totals, healthy takes no space", () => {
  const view = S.buildStruggleView({
    classes: CLASSES, students: STUDENTS, concepts: CONCEPTS, now: NOW,
    struggles: [
      st("u1", "misconception", "c-sci"), st("u1", "decay", "c-math"), st("u1", "anxiety", null), st("u1", "fixed_mindset", null),
      st("u2", "misconception", "c-sci", "resolved"),
      st("u3-not-in-school", "misconception", "c-sci"),
    ],
  });
  const jss1 = view.classes.find((c) => c.classId === "jss1");
  assert.deepEqual({ linked: jss1.linked, unlinked: jss1.unlinked, open: jss1.open, resolved: jss1.resolved, struggling: jss1.learnersStruggling, flag: jss1.mayNeedSupport },
    { linked: 2, unlinked: 1, open: 2, resolved: 1, struggling: 1, flag: 1 });
  assert.deepEqual(jss1.topTypes.map((t) => [t.type, t.learners]), [["misconception", 1], ["decay", 1]]);
  assert.equal(jss1.sensitiveOpen, 2, "sensitive struggles are counted for the class — never described");
  assert.equal(view.classes.find((c) => c.classId === "jss2").sensitiveOpen, 0);
  assert.ok(!jss1.topTypes.some((t) => SENSITIVE_TYPES.includes(t.type)), "sensitive types never in totals");
  assert.deepEqual(view.learners.map((l) => l.studentId), ["s1", "s2"], "s3 (unlinked) and s4 (nothing) take no space");
  const ada = view.learners[0];
  assert.deepEqual(ada.supportFlag, { mayNeedSupport: true });
  assert.ok(ada.open.every((i) => !SENSITIVE_TYPES.includes(i.type)));
  assert.equal(ada.open.find((i) => i.type === "misconception").topic, "Evaporation vs transpiration");
  assert.ok(!JSON.stringify(view).includes("u3-not-in-school"));
  assert.ok(!JSON.stringify(view).includes("anxiety") && !JSON.stringify(view).includes("fixed_mindset"));
});

test("a subject teacher's scope: only their subject in their class; unknown subjects hidden", () => {
  const scope = new Map([["jss1", new Set(["basic science"])]]);
  const view = S.buildStruggleView({
    classes: CLASSES.filter((c) => scope.has(c.id)), students: STUDENTS, concepts: CONCEPTS, scope, now: NOW,
    struggles: [st("u1", "misconception", "c-sci"), st("u1", "decay", "c-math"), st("u1", "poor_planning", null)],
  });
  assert.deepEqual(view.learners[0].open.map((i) => i.type), ["misconception"]);
  assert.equal(S.inScope(new Map([["jss1", null]]), "jss1", null), true, "the class teacher sees every subject");
  assert.equal(S.inScope(scope, "jss2", "Basic Science"), false);
});

/* ── Routes over the fake db ─────────────────────────────────────────────── */

const ADMIN = "admin-user"; const T_CLASS = "teacher-class"; const T_MATH = "teacher-math"; const T_NONE = "teacher-none"; const OTHER_ADMIN = "admin-other";
function seed() {
  return {
    school_profiles: [{ id: "sch", name: "Demo", admin_user_id: ADMIN, created_at: ago(100) }, { id: "sch2", name: "Other", admin_user_id: OTHER_ADMIN, created_at: ago(100) }],
    school_teachers: [T_CLASS, T_MATH, T_NONE].map((t) => ({ school_id: "sch", teacher_id: t, status: "approved", created_at: ago(50) })),
    "mgmt.classes": CLASSES.map((c) => ({ ...c, school_id: "sch" })),
    "mgmt.students": STUDENTS,
    "mgmt.subjects": [{ id: "sub-math", school_id: "sch", name: "Mathematics", code: "MTH" }],
    "mgmt.class_teachers": [{ school_id: "sch", class_id: "jss1", teacher_id: T_CLASS }],
    "mgmt.class_subjects": [{ school_id: "sch", class_id: "jss1", subject_id: "sub-math", teacher_id: T_MATH }],
    "mgmt.struggle_support_views": [],
    "edu.concept_catalog": [...CONCEPTS].map(([id, c]) => ({ id, ...c })),
    "edu.learner_concept_evidence": [
      { learner_id: "u1", concept_id: "c-sci", observation_kind: "misconception_detected", response_quality: 0.2, observed_at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
      { learner_id: "u1", concept_id: "c-math", observation_kind: "partial_understanding", response_quality: 0.5, observed_at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
      { learner_id: "u4", concept_id: "c-sci", observation_kind: "misconception_detected", response_quality: 0.2, observed_at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
      { learner_id: "outsider", concept_id: "c-sci", observation_kind: "misconception_detected", response_quality: 0.2, observed_at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
    ],
    "edu.learning_struggles": [
      { learner_id: "u1", struggle_type: "anxiety", status: "open", detected_at: new Date(Date.now() - 86_400_000).toISOString(), sensitive: true },
      { learner_id: "u1", struggle_type: "confidence_collapse", status: "open", concept_id: "c-sci", detected_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), sensitive: true },
    ],
  };
}

// The same school resolution as mgmt.js getMySchool: an admin owns it; an approved teacher works in it.
async function getMySchool(req, res) {
  const { data: owned } = await db.from("school_profiles").select("id, name").eq("admin_user_id", req.user.id).limit(1).maybeSingle();
  if (owned) return owned;
  const { data: link } = await db.from("school_teachers").select("school_id").eq("teacher_id", req.user.id).eq("status", "approved").limit(1).maybeSingle();
  if (link) return (await db.from("school_profiles").select("id, name").eq("id", link.school_id).maybeSingle()).data;
  res.status(404).json({ error: "No school is linked to this account." }); return null;
}

async function withServer(t, seedRows, fn) {
  const fake = installFakeDb(db, seedRows);
  const app = express();
  const authenticate = (req, _res, next) => { const [id, role] = String(req.headers["x-user"] || "").split(":"); req.user = { id, role }; next(); };
  app.use("/learning", S.createStrugglesRouter({ getMySchool, authenticate }));
  const server = app.listen(0);
  t.after(() => { server.close(); fake.restore(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (who, path) => { const r = await fetch(base + path, { headers: { "x-user": who } }); return { status: r.status, body: await r.json() }; };
  await fn({ get, fake });
}

test("routes: the school admin sees every class; the flag opens with a logged view", async (t) => {
  await withServer(t, seed(), async ({ get, fake }) => {
    const r = await get(`${ADMIN}:school_admin`, "/learning/struggles");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.classes.map((c) => c.classId).sort(), ["jss1", "jss2"]);
    const ada = r.body.data.learners.find((l) => l.studentId === "s1");
    assert.deepEqual(ada.open.map((i) => i.type).sort(), ["misconception", "partial_understanding"]);
    assert.deepEqual(ada.supportFlag, { mayNeedSupport: true });
    assert.ok(!JSON.stringify(r.body).match(/anxiety|confidence_collapse|outsider/), "no sensitive type, no outside learner");

    const open = await get(`${ADMIN}:school_admin`, "/learning/struggles/s1/support");
    assert.equal(open.status, 200);
    assert.deepEqual(open.body.data.struggles.map((s) => s.type).sort(), ["anxiety", "confidence_collapse"]);
    const log = fake.rows("mgmt.struggle_support_views");
    assert.equal(log.length, 1);
    assert.deepEqual({ school: log[0].school_id, viewer: log[0].viewer_user_id, student: log[0].student_id }, { school: "sch", viewer: ADMIN, student: "s1" });

    assert.equal((await get(`${ADMIN}:school_admin`, "/learning/struggles/s2/support")).status, 404, "no flag, nothing to open");
    assert.equal((await get(`${ADMIN}:school_admin`, "/learning/struggles/s3/support")).status, 404, "an unlinked student has no data");
  });
});

test("routes: no log, no detail", async (t) => {
  await withServer(t, seed(), async ({ get, fake }) => {
    fake.failNext("mgmt.struggle_support_views", "insert", { message: "log down" });
    const r = await get(`${ADMIN}:school_admin`, "/learning/struggles/s1/support");
    assert.equal(r.status, 500);
    assert.equal(r.body.data, undefined);
  });
});

test("routes: teachers see only their classes and subjects; others are refused", async (t) => {
  await withServer(t, seed(), async ({ get }) => {
    const classT = await get(`${T_CLASS}:instructor`, "/learning/struggles");
    assert.equal(classT.status, 200);
    assert.deepEqual(classT.body.data.classes.map((c) => c.classId), ["jss1"]);
    assert.ok(!classT.body.data.learners.some((l) => l.studentId === "s4"), "JSS2 is not theirs");
    assert.equal((await get(`${T_CLASS}:instructor`, "/learning/struggles?class_id=jss2")).status, 403);
    assert.equal((await get(`${T_CLASS}:instructor`, "/learning/struggles/s4/support")).status, 404);
    assert.equal((await get(`${T_CLASS}:instructor`, "/learning/struggles/s1/support")).status, 200, "the class teacher may open the flag");

    const math = await get(`${T_MATH}:instructor`, "/learning/struggles");
    const ada = math.body.data.learners.find((l) => l.studentId === "s1");
    assert.deepEqual(ada.open.map((i) => i.type), ["partial_understanding"], "Mathematics only");
    assert.equal(ada.supportFlag, null, "general sensitive types are not a subject teacher's");

    const none = await get(`${T_NONE}:instructor`, "/learning/struggles");
    assert.equal(none.status, 200);
    assert.deepEqual(none.body.data, { version: 1, classes: [], learners: [], teaches: false });

    assert.equal((await get("u1:student", "/learning/struggles")).status, 403, "a learner is refused");
    const other = await get(`${OTHER_ADMIN}:school_admin`, "/learning/struggles");
    assert.equal(other.status, 200);
    assert.deepEqual(other.body.data.learners, [], "another school sees none of these learners");
    assert.equal((await get(`${OTHER_ADMIN}:school_admin`, "/learning/struggles/s1/support")).status, 404);
  });
});

test("routes: without edu.learning_struggles deployed, evidence still answers", async (t) => {
  await withServer(t, seed(), async ({ get, fake }) => {
    fake.failNext("edu.learning_struggles", "select", { code: "PGRST205", message: "Could not find the table in the schema cache" });
    const r = await get(`${ADMIN}:school_admin`, "/learning/struggles");
    assert.equal(r.status, 200);
    assert.ok(r.body.data.learners.find((l) => l.studentId === "s1").open.length === 2);
  });
});

test("mgmt.js mounts the routes before the generic list, behind auth", () => {
  const src = readFileSync(new URL("./mgmt.js", import.meta.url), "utf8");
  const mount = src.indexOf('router.use("/learning", createStrugglesRouter({ getMySchool, authenticate: authenticateToken }))');
  assert.ok(mount > 0);
  assert.ok(mount < src.indexOf('router.get("/:resource", authenticateToken'));
  const manifest = JSON.parse(readFileSync(new URL("../../migrations/manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.schema.includes("2026-school-struggle-support-views.sql"));
});
