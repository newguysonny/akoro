// Seam tests for the syllabus resolver over the in-memory fake db.
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { default: db } = await import("../../../db.js");
const { installFakeDb } = await import("../../../lib/testing/fakeDb.mjs");
const { topicSlug, shapeSyllabus, resolveTopics, prerequisiteEdges, learnerEnrollment, currentTerm, resolveClassTopics, resolveSchoolTopics, resolveSyllabusChain, topicsForSource } = await import("./syllabus-resolver.js");

function fakeFor(t, seed = {}, options = {}) {
  const fake = installFakeDb(db, seed, options);
  t.after(() => fake.restore());
  return fake;
}

// ── pure helpers ───────────────────────────────────────────────────────────

test("topicSlug: lowercase, dash-separated, trimmed, ≤120 chars, 'topic' when empty", () => {
  assert.equal(topicSlug("  States of Matter! "), "states-of-matter");
  assert.equal(topicSlug("--Living & Non-living Things--"), "living-non-living-things");
  assert.equal(topicSlug("x".repeat(300)).length, 120);
  assert.equal(topicSlug(""), "topic");
  assert.equal(topicSlug(null), "topic");
  assert.equal(topicSlug("!!!"), "topic");
});

test("shapeSyllabus flattens topics per subject in subject order, skipping subjects without topics", () => {
  const subjects = [{ id: "s1", exam: "WASSCE" }, { id: "s2", exam: "NECO" }, { id: "s3", exam: "WASSCE" }];
  const bySubject = new Map([
    ["s2", [{ title: "Energy" }]],
    ["s1", [{ title: "States of Matter" }, { title: "Living Things" }]],
  ]);
  assert.deepEqual(shapeSyllabus(subjects, bySubject), [
    { id: "states-of-matter", label: "States of Matter", subjectId: "s1", exam: "WASSCE" },
    { id: "living-things", label: "Living Things", subjectId: "s1", exam: "WASSCE" },
    { id: "energy", label: "Energy", subjectId: "s2", exam: "NECO" },
  ]);
  assert.deepEqual(shapeSyllabus(null, new Map()), []);
});

// ── resolveTopics ──────────────────────────────────────────────────────────

const SUBJECTS = "edu.syllabus_subjects";
const TOPICS = "edu.syllabus_topics";

const subjects = [
  { id: "bs-jss1-waec", name: "Basic Science JSS1", code: "BSC", exam: "WASSCE", created_at: "2026-01-01" },
  { id: "bs-jss1-neco", name: "Basic Science", code: "BSC-JSS1", exam: "NECO", created_at: "2026-01-02" },
  { id: "bs-jss2-waec", name: "Basic Science JSS2", code: "BSC2", exam: "WASSCE", created_at: "2026-01-03" },
  { id: "maths", name: "Mathematics JSS1", code: "MTH", exam: "WASSCE", created_at: "2026-01-04" },
];
const topics = [
  { id: "t1", subject_id: "bs-jss1-waec", title: "Living Things", sort_order: 2 },
  { id: "t2", subject_id: "bs-jss1-waec", title: "States of Matter", sort_order: 1 },
  { id: "t3", subject_id: "bs-jss1-neco", title: "Energy", sort_order: 1 },
  { id: "t4", subject_id: "bs-jss2-waec", title: "Machines", sort_order: 1 },
  { id: "t5", subject_id: "maths", title: "Fractions", sort_order: 1 },
];
const ids = (list) => list.map((topic) => topic.id);

test("resolveTopics: class-scoped (name or code) + exam-board match — WAEC maps to WASSCE", async (t) => {
  fakeFor(t, { [SUBJECTS]: subjects, [TOPICS]: topics });
  const out = await resolveTopics({ subject: "basic science", classLevel: "JSS 1", exam: "WAEC" });
  assert.deepEqual(out, [
    { id: "states-of-matter", label: "States of Matter", subjectId: "bs-jss1-waec", exam: "WASSCE" },
    { id: "living-things", label: "Living Things", subjectId: "bs-jss1-waec", exam: "WASSCE" },
  ]);
});

test("resolveTopics: NECO board picks the class-scoped NECO subject (matched via its code)", async (t) => {
  fakeFor(t, { [SUBJECTS]: subjects, [TOPICS]: topics });
  assert.deepEqual(ids(await resolveTopics({ subject: "Basic Science", classLevel: "jss1", exam: "neco" })), ["energy"]);
});

test("resolveTopics: class-scoped but no subject for the exam board → all class-scoped subjects", async (t) => {
  fakeFor(t, { [SUBJECTS]: subjects, [TOPICS]: topics });
  const out = await resolveTopics({ subject: "Basic Science", classLevel: "JSS1", exam: "JAMB" });
  assert.deepEqual(ids(out), ["states-of-matter", "living-things", "energy"]);
});

test("resolveTopics: no class-scoped subject → falls back to the exam board's subjects", async (t) => {
  fakeFor(t, { [SUBJECTS]: subjects, [TOPICS]: topics });
  const out = await resolveTopics({ subject: "Basic Science", classLevel: "JSS3", exam: "NECO" });
  assert.deepEqual(ids(out), ["energy"]);
});

test("resolveTopics: no class or exam match → every subject matching the name", async (t) => {
  fakeFor(t, { [SUBJECTS]: subjects, [TOPICS]: topics });
  const out = await resolveTopics({ subject: "Basic Science", classLevel: "JSS3", exam: "NCEE" });
  assert.deepEqual(ids(out), ["states-of-matter", "living-things", "energy", "machines"]);
});

test("resolveTopics: defaults are JSS1 + WAEC", async (t) => {
  fakeFor(t, { [SUBJECTS]: subjects, [TOPICS]: topics });
  assert.deepEqual(ids(await resolveTopics({ subject: "Basic Science" })), ["states-of-matter", "living-things"]);
});

test("resolveTopics: no matching subject → [] without querying topics", async (t) => {
  const fake = fakeFor(t, { [SUBJECTS]: subjects, [TOPICS]: topics });
  assert.deepEqual(await resolveTopics({ subject: "Chemistry", classLevel: "JSS1", exam: "WAEC" }), []);
  assert.equal(fake.calls.filter((c) => c.table === TOPICS).length, 0);
});

test("resolveTopics: a subject with no topic rows resolves to []", async (t) => {
  fakeFor(t, { [SUBJECTS]: [{ id: "empty", name: "Basic Science JSS1", exam: "WASSCE", created_at: "x" }], [TOPICS]: [] });
  assert.deepEqual(await resolveTopics({ subject: "Basic Science" }), []);
});

test("resolveTopics: db errors propagate", async (t) => {
  const fake = fakeFor(t, { [SUBJECTS]: subjects, [TOPICS]: topics });
  fake.failNext(SUBJECTS, "select", { message: "subjects down" });
  await assert.rejects(resolveTopics({ subject: "Basic Science" }), { message: "subjects down" });
  fake.failNext(TOPICS, "select", { message: "topics down" });
  await assert.rejects(resolveTopics({ subject: "Basic Science" }), { message: "topics down" });
});

test("resolveTopics: an SS1 learner does not get the JSS1 syllabus", async (t) => {
  fakeFor(t, {
    [SUBJECTS]: [
      { id: "m-jss1", name: "Mathematics JSS1", code: "MTH-JSS1", exam: "WASSCE", created_at: "1" },
      { id: "m-ss1", name: "Mathematics SS1", code: "MTH-SS1", exam: "WASSCE", created_at: "2" },
    ],
    [TOPICS]: [
      { id: "a", subject_id: "m-jss1", title: "Whole Numbers", sort_order: 1 },
      { id: "b", subject_id: "m-ss1", title: "Indices", sort_order: 1 },
    ],
  });
  assert.deepEqual(ids(await resolveTopics({ subject: "Mathematics", classLevel: "SS1", exam: "WAEC" })), ["indices"]);
});

// ── prerequisiteEdges ──────────────────────────────────────────────────────

const EDGES = "edu.concept_edges";
const CONCEPTS = "edu.concept_catalog";
const concepts = [
  { id: "c-matter", title: "States of Matter", subject: "Basic Science", topic_key: "states-of-matter", status: "approved" },
  { id: "c-heat", title: "Heat Energy", subject: "Basic Science", topic_key: null, status: "approved" },
  { id: "c-matter-dup", title: "Matter (revision)", subject: "Basic Science", topic_key: "states-of-matter", status: "approved" },
  { id: "c-frac", title: "Fractions", subject: "Mathematics", topic_key: "fractions", status: "approved" },
  { id: "c-dec", title: "Decimals", subject: "Mathematics", topic_key: "decimals", status: "approved" },
  { id: "c-draft", title: "Atoms", subject: "Basic Science", topic_key: "atoms", status: "draft" },
];
const edges = [
  { from_concept_id: "c-matter", to_concept_id: "c-heat", relation: "prerequisite_for", status: "approved" },
  { from_concept_id: "c-frac", to_concept_id: "c-dec", relation: "prerequisite_for", status: "approved" },
  { from_concept_id: "c-matter", to_concept_id: "c-matter-dup", relation: "prerequisite_for", status: "approved" }, // self after slugging
  { from_concept_id: "c-heat", to_concept_id: "c-frac", relation: "related_to", status: "approved" },
  { from_concept_id: "c-heat", to_concept_id: "c-dec", relation: "prerequisite_for", status: "proposed" },
  { from_concept_id: "c-draft", to_concept_id: "c-heat", relation: "prerequisite_for", status: "approved" }, // endpoint not approved
  { from_concept_id: "c-gone", to_concept_id: "c-heat", relation: "prerequisite_for", status: "approved" }, // endpoint missing
];

test("prerequisiteEdges: approved prerequisite_for edges between approved concepts, mapped to slugs", async (t) => {
  fakeFor(t, { [EDGES]: edges, [CONCEPTS]: concepts });
  assert.deepEqual(await prerequisiteEdges({ subject: "" }), [
    { before: "states-of-matter", after: "heat-energy", beforeLabel: "States of Matter", afterLabel: "Heat Energy" },
    { before: "fractions", after: "decimals", beforeLabel: "Fractions", afterLabel: "Decimals" },
  ]);
});

test("prerequisiteEdges: subject filter (case-insensitive, either endpoint)", async (t) => {
  fakeFor(t, { [EDGES]: edges, [CONCEPTS]: concepts });
  assert.deepEqual((await prerequisiteEdges({ subject: " mathematics " })).map((e) => `${e.before}>${e.after}`), ["fractions>decimals"]);
  assert.deepEqual((await prerequisiteEdges({ subject: "Basic Science" })).map((e) => `${e.before}>${e.after}`), ["states-of-matter>heat-energy"]);
  assert.deepEqual(await prerequisiteEdges({ subject: "Chemistry" }), []);
});

test("prerequisiteEdges: no edges → [] without reading the catalog; errors propagate", async (t) => {
  const fake = fakeFor(t, { [EDGES]: [], [CONCEPTS]: concepts });
  assert.deepEqual(await prerequisiteEdges({ subject: "Basic Science" }), []);
  assert.equal(fake.calls.filter((c) => c.table === CONCEPTS).length, 0);
  fake.failNext(EDGES, "select", { message: "edges down" });
  await assert.rejects(prerequisiteEdges({ subject: "x" }), { message: "edges down" });
  fake.rows(EDGES).push(edges[0]);
  fake.failNext(CONCEPTS, "select", { message: "catalog down" });
  await assert.rejects(prerequisiteEdges({ subject: "x" }), { message: "catalog down" });
});

// ── the learner's own class and school syllabus (§8.7) ─────────────────────

const ME = "11111111-1111-4111-8111-111111111111";
const SCHOOL = "school-a", OTHER_SCHOOL = "school-b", JSS1 = "class-jss1", JSS2 = "class-jss2";
const schoolSeed = (extra = {}) => ({
  "mgmt.students": [
    { id: "st1", school_id: SCHOOL, class_id: JSS1, user_id: ME, status: "active", first_name: "Ada", last_name: "Okafor" },
    // Same name at another school, not linked to this learner: never used.
    { id: "st2", school_id: OTHER_SCHOOL, class_id: "class-x", user_id: null, status: "active", first_name: "Ada", last_name: "Okafor" },
  ],
  "mgmt.classes": [{ id: JSS1, school_id: SCHOOL, name: "JSS1" }, { id: JSS2, school_id: SCHOOL, name: "JSS2" }],
  "mgmt.subjects": [{ id: "sub-bs", school_id: SCHOOL, name: "Basic Science" }, { id: "sub-other", school_id: OTHER_SCHOOL, name: "Basic Science" }],
  "mgmt.academic_calendar": [
    { school_id: SCHOOL, term: "First", event_type: "resumption", starts_on: "2026-09-08" },
    { school_id: SCHOOL, term: "First", event_type: "vacation", starts_on: "2026-12-11" },
  ],
  "mgmt.syllabus_items": [
    { school_id: SCHOOL, class_id: JSS1, subject_id: "sub-bs", term: "Second", topic: "Energy", status: "pending" },
    { school_id: SCHOOL, class_id: JSS1, subject_id: "sub-bs", term: "First", topic: "Living Things", status: "covered" },
    { school_id: SCHOOL, class_id: JSS1, subject_id: "sub-bs", term: "First", topic: "States of Matter", status: "pending" },
    { school_id: SCHOOL, class_id: JSS2, subject_id: "sub-bs", term: "First", topic: "Machines", status: "pending" },
    { school_id: OTHER_SCHOOL, class_id: "class-x", subject_id: "sub-other", term: "First", topic: "Secret Topic", status: "pending" },
  ],
  ...extra,
});

test("enrollment comes only from the linked, active student row — never a name match", async (t) => {
  fakeFor(t, schoolSeed());
  assert.deepEqual(await learnerEnrollment(ME), { schoolId: SCHOOL, classId: JSS1, className: "JSS1" });
  assert.equal(await learnerEnrollment("22222222-2222-4222-8222-222222222222"), null);
  assert.equal(await learnerEnrollment(null), null);
});

test("two active linked enrollments are ambiguous: neither is used", async (t) => {
  const seed = schoolSeed();
  seed["mgmt.students"].push({ id: "st3", school_id: OTHER_SCHOOL, class_id: "class-x", user_id: ME, status: "active" });
  fakeFor(t, seed);
  assert.equal(await learnerEnrollment(ME), null);
});

test("current term: the latest resumption, none once that term's vacation began", async (t) => {
  fakeFor(t, schoolSeed());
  assert.equal(await currentTerm(SCHOOL, "2026-10-17"), "First");
  assert.equal(await currentTerm(SCHOOL, "2026-12-20"), null);
  assert.equal(await currentTerm(SCHOOL, "2026-08-01"), null);
});

test("resolve_class: this term's topics for the learner's class, with covered status", async (t) => {
  fakeFor(t, schoolSeed());
  const out = await resolveClassTopics({ learnerId: ME, subject: "Basic Science", today: "2026-10-17" });
  assert.equal(out.term, "First");
  assert.deepEqual(out.topics, [
    { id: "living-things", label: "Living Things", term: "First", covered: true, source: "class" },
    { id: "states-of-matter", label: "States of Matter", term: "First", covered: false, source: "class" },
  ]);
  // Between terms: every term's topics, in term order.
  const holiday = await resolveClassTopics({ learnerId: ME, subject: "Basic Science", today: "2026-12-20" });
  assert.equal(holiday.term, null);
  assert.deepEqual(holiday.topics.map((x) => x.id), ["living-things", "states-of-matter", "energy"]);
});

test("resolve_school: the school's topics for the subject, any class — never another school's", async (t) => {
  fakeFor(t, schoolSeed());
  const out = await resolveSchoolTopics({ learnerId: ME, subject: "Basic Science" });
  assert.deepEqual(out.topics.map((x) => x.id).sort(), ["energy", "living-things", "machines", "states-of-matter"]);
  assert.ok(out.topics.every((x) => x.source === "school"));
  assert.ok(!out.topics.some((x) => x.label === "Secret Topic"));
});

test("the chain: class first, school when the class has none, then the platform, else nothing", async (t) => {
  const fake = fakeFor(t, schoolSeed({ [SUBJECTS]: subjects, [TOPICS]: topics }));
  const cls = await resolveSyllabusChain({ learnerId: ME, subject: "Basic Science", classLevel: "JSS1", exam: "WAEC", today: "2026-10-17" });
  assert.equal(cls.source, "class");
  assert.equal(cls.ref, JSS1);
  assert.equal(cls.className, "JSS1");

  // This class has no Basic Science items: the school's.
  const items = fake.rows("mgmt.syllabus_items");
  for (let i = items.length - 1; i >= 0; i--) if (items[i].class_id === JSS1) items.splice(i, 1);
  const school = await resolveSyllabusChain({ learnerId: ME, subject: "Basic Science", classLevel: "JSS1", exam: "WAEC" });
  assert.equal(school.source, "school");
  assert.equal(school.ref, SCHOOL);
  assert.deepEqual(school.topics.map((x) => x.id), ["machines"]);

  // No enrollment: straight to the platform syllabus.
  const platform = await resolveSyllabusChain({ learnerId: "22222222-2222-4222-8222-222222222222", subject: "Basic Science", classLevel: "JSS1", exam: "WAEC" });
  assert.equal(platform.source, "platform");
  assert.ok(platform.topics.length > 0);

  const none = await resolveSyllabusChain({ learnerId: "22222222-2222-4222-8222-222222222222", subject: "Latin", classLevel: "JSS1", exam: "WAEC" });
  assert.deepEqual(none, { source: null, ref: null, topics: [], term: null });
});

test("a session's class source stops applying once the learner's enrollment changes", async (t) => {
  const fake = fakeFor(t, schoolSeed());
  const args = { source: "class", ref: JSS1, learnerId: ME, subject: "Basic Science", classLevel: "JSS1", exam: "WAEC" };
  assert.ok((await topicsForSource(args)).length > 0);
  fake.rows("mgmt.students").find((row) => row.id === "st1").class_id = JSS2;
  assert.deepEqual(await topicsForSource(args), []);
});

// ── exam for a learner's board and class (BECE / IGCSE) ────────────────────

test("examForBoard: JSS classes sit the BECE (WAEC is everyone's default board); senior classes take the board", async () => {
  const { examForBoard, isJuniorSecondary } = await import("./syllabus-resolver.js");
  assert.equal(examForBoard("WAEC", "JSS2"), "BECE");
  assert.equal(examForBoard("NECO", "JSS 3"), "BECE");
  assert.equal(examForBoard(null, "Basic 8"), "BECE");
  assert.equal(examForBoard("JAMB", "JSS2"), "JAMB", "a board that names another exam wins");
  assert.equal(examForBoard("WAEC", "SS2"), "WASSCE");
  assert.equal(examForBoard("SSCE", "SS3"), "WASSCE");
  assert.equal(examForBoard("NECO", "SS1"), "NECO");
  assert.equal(examForBoard("UTME", "SS3"), "JAMB");
  assert.equal(examForBoard("Cambridge IGCSE", "SS1"), "IGCSE");
  assert.equal(examForBoard("BECE", null), "BECE");
  assert.equal(isJuniorSecondary("SS1"), false);
});

test("resolveTopics: a JSS learner on the default WAEC board gets the BECE syllabus; a senior learner gets WASSCE", async (t) => {
  fakeFor(t, {
    [SUBJECTS]: [
      { id: "bst-bece", name: "Basic Science and Technology", code: null, exam: "BECE", created_at: "2026-01-01" },
      { id: "bio-wassce", name: "Biology", code: null, exam: "WASSCE", created_at: "2026-01-02" },
      { id: "bio-igcse", name: "Biology", code: "0610", exam: "IGCSE", created_at: "2026-01-03" },
      { id: "bsc-wassce", name: "Basic Science", code: null, exam: "WASSCE", created_at: "2026-01-04" },
    ],
    [TOPICS]: [
      { id: "a", subject_id: "bst-bece", title: "Materials", sort_order: 1 },
      { id: "b", subject_id: "bio-wassce", title: "Concept of Living", sort_order: 1 },
      { id: "c", subject_id: "bio-igcse", title: "Enzymes", sort_order: 1 },
      { id: "d", subject_id: "bsc-wassce", title: "Old outline", sort_order: 1 },
    ],
  });
  assert.deepEqual((await resolveTopics({ subject: "Basic Science", classLevel: "JSS2", exam: "WAEC" })).map((x) => x.label), ["Materials"]);
  assert.deepEqual((await resolveTopics({ subject: "Biology", classLevel: "SS2", exam: "WAEC" })).map((x) => x.label), ["Concept of Living"]);
  assert.deepEqual((await resolveTopics({ subject: "Biology", classLevel: "SS1", exam: "IGCSE" })).map((x) => x.label), ["Enzymes"]);
});
