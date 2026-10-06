import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseTopicFile, topicPath, PHARMD_BUCKET, DEFAULT_DIR } from "../scripts/upload-pharmd-courses.mjs";

/**
 * PHARM.D courses contract — the pilot programme's storage pipeline:
 * the migration seeds the structure (programme → years → courses),
 * the uploader parses the reference zips into topic rows + Storage
 * objects, and the /api/pharmd module serves the tree the learner
 * app's Pharm D discovery pages render.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [migration, manifest, uploader, routes, app, page, pharmdApi] = await Promise.all([
  read("2026-pharmd-courses.sql"),
  read("manifest.json"),
  read("../scripts/upload-pharmd-courses.mjs"),
  read("../modules/pharmd/routes.js"),
  read("../app.js"),
  read("../../akoro-learner/src/components/pharmd/PharmDProgram.jsx"),
  read("../../akoro-learner/src/services/pharmdApi.js"),
]);

test("migration: the catalogue tables, keyed for idempotent upserts", () => {
  for (const t of ["pharmd_programmes", "pharmd_years", "pharmd_courses", "pharmd_topics", "pharmd_topic_progress"]) {
    assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS edu.${t}`), `table ${t}`);
  }
  // Unique keys the uploader's upserts target.
  assert.ok(migration.includes("code       TEXT NOT NULL UNIQUE"), "course code unique");
  assert.ok(migration.includes("UNIQUE (programme_id, number)"), "year unique per programme");
  assert.ok(migration.includes("UNIQUE (course_id, position)"), "topic position unique per course");
  assert.ok(migration.includes("PRIMARY KEY (user_id, topic_id)"), "progress keyed per learner+topic");
  // Progress dies with its topic; topics die with their course.
  assert.ok((migration.match(/ON DELETE CASCADE/g) || []).length >= 4, "cascade chain");
  // Everything re-runnable.
  assert.ok(!/ON CONFLICT DO UPDATE/.test(migration), "seeds never fight the uploader");
  assert.ok((migration.match(/ON CONFLICT.*DO NOTHING/g) || []).length >= 3, "idempotent seeds");
});

test("migration: seeds the pilot's real structure — 9 First Year courses", () => {
  for (const code of ["BIO 111", "BIO 121", "CSC 111", "GST 111", "GST 113", "GST 121", "ICH 111", "MAT 111", "PHY 111"]) {
    assert.ok(migration.includes(`'${code}'`), `course ${code}`);
  }
  assert.ok(migration.includes("'Nigerian Peoples and Culture'"), "GST 113's real title rides along");
  assert.ok(migration.includes("'First Year'"), "First Year");
  assert.ok(migration.includes("'Second Year'"), "Second Year (empty years are rows, so 'coming soon' renders)");
  assert.ok(migration.includes("'Doctor of Pharmacy'"), "programme subtitle");
});

test("manifest: the migration is registered in the schema group", () => {
  const m = JSON.parse(manifest);
  assert.ok(m.schema.includes("2026-pharmd-courses.sql"), "registered in schema group");
});

test("parser: reads every naming style the pilot zips use", () => {
  // Real file names from the packages — one per style, plus the typo.
  const cases = [
    ["Topic 1_BIO111_Cell_Structure_and_Organization.pdf", { position: 1, title: "Cell Structure and Organization" }],
    ["Toipc 1_BIO121_Parasites_and_Parasitic_Associations.pdf", { position: 1, title: "Parasites and Parasitic Associations" }],
    ["CSC_111_Topic 14_Internet_and_world_wide_web.pdf", { position: 14, title: "Internet and world wide web" }],
    ["GST111_Topic 3 Sentence_in_English_PharmD_Lecture_Note.pdf", { position: 3, title: "Sentence in English" }],
    ["GST_113_Nigerian_Peoples_and_Culture_Topic_1_Precolonial_History_Culture_Arts.pdf", { position: 1, title: "Precolonial History Culture Arts" }],
    ["GST_113_Topic_10_Reorientation_of_Morals.pdf", { position: 10, title: "Reorientation of Morals" }],
    ["MAT111_Topic 10 The_Argand_Diagram.pdf", { position: 10, title: "The Argand Diagram" }],
    ["PHY111_Topic 1 Space_and_Time_PharmD_Lecture_Note.pdf", { position: 1, title: "Space and Time" }],
    ["ICH111_Topic_12_Radioactivity.pdf", { position: 12, title: "Radioactivity" }],
  ];
  for (const [name, want] of cases) {
    assert.deepEqual(parseTopicFile(name), want, name);
  }
  assert.equal(parseTopicFile("intro.pdf"), null, "no Topic N marker → null, never a guess");
  assert.equal(parseTopicFile("Topic 5_.pdf"), null, "number without a title → null");
});

test("uploader: public bucket, readable paths, idempotent writes", () => {
  assert.equal(PHARMD_BUCKET, "pharmd-courses");
  assert.equal(topicPath("BIO 111", 1, "Cell Structure and Organization"),
    "BIO 111/01 - Cell Structure and Organization.pdf");
  assert.ok(DEFAULT_DIR.endsWith("PHARM.D PILOT PROGRAMME COURSES"), "defaults to the reference folder");
  assert.ok(uploader.includes("createBucket(PHARMD_BUCKET, { public: true })"), "public bucket, ensured once");
  assert.ok(uploader.includes("upsert: true"), "storage objects re-upload with upsert");
  assert.ok(uploader.includes('onConflict: "course_id,position"'), "topic rows upsert on (course_id, position)");
  assert.ok(uploader.includes("parseTopicFile"), "parses through the shared, tested parser");
  assert.ok(uploader.includes("import(\"../db.js\")"), "db loads lazily — the parser stays importable without env");
});

test("API: the catalogue is public, completion is per-learner", () => {
  // Public reads — a course catalogue browses like /api/courses/published.
  assert.ok(routes.includes('router.get("/programme"'), "GET /programme");
  assert.ok(routes.includes('router.get("/courses/:code"'), "GET /courses/:code");
  assert.ok(routes.includes("getPublicUrl"), "topics carry public PDF urls");
  // Learner state behind auth, below the public routes.
  const authAt = routes.indexOf("router.use(authenticateToken)");
  const progressAt = routes.indexOf('router.get("/progress"');
  const completeAt = routes.indexOf('router.post("/topics/:id/complete"');
  assert.ok(authAt > -1 && authAt < progressAt && authAt < completeAt, "auth sits above the learner routes");
  assert.ok(routes.includes('onConflict: "user_id,topic_id"'), "progress upserts per learner+topic");
  // Mounted on the app with the standard limit.
  assert.ok(app.includes('import pharmdModule'), "app imports the module");
  assert.ok(app.includes('app.use("/api/pharmd",      standardLimit, pharmdModule)'), "mounted at /api/pharmd");
});

test("frontend: the Pharm D pages read the real catalogue", () => {
  // The service seam hits all four endpoints.
  assert.ok(pharmdApi.includes("'/api/pharmd/programme'"), "programme endpoint");
  assert.ok(pharmdApi.includes("/api/pharmd/courses/"), "course endpoint");
  assert.ok(pharmdApi.includes("'/api/pharmd/progress'"), "progress endpoint");
  assert.ok(pharmdApi.includes("/api/pharmd/topics/"), "complete endpoint");
  // The pages fetch real data instead of placeholders.
  assert.ok(page.includes("fetchPharmdProgramme"), "browse loads the programme tree");
  assert.ok(page.includes("fetchPharmdCourse"), "folder loads the course's topics");
  assert.ok(page.includes("fetchPharmdProgress"), "done-checks load per learner");
  assert.ok(page.includes("completePharmdTopic"), "mark-as-complete persists");
  assert.ok(page.includes("toggleDone"), "optimistic toggle with rollback");
  assert.ok(page.includes("file_url"), "topics carry the bucket PDF url");
  assert.ok(page.includes("<iframe"), "the PDF renders in the topic reader");
  assert.ok(page.includes('target="_blank"'), "an open-in-new-tab escape hatch");
  assert.ok(!page.includes("topicsFor"), "no placeholder topic sets");
  assert.ok(!page.includes("readsFor"), "no mock read counts");
  // The browse card's third line is honest: topic count, not invented reads.
  assert.ok(page.includes("{c.topics} topic"), "cards show real topic counts");
});
