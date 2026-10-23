// One course record (2026-10-20): Course Creator edits the platform's course row.
import assert from "node:assert/strict";
import test from "node:test";
import { builderFieldsFrom, courseFieldsFrom, lagosWallClock, lessonFromOld, lessonFromSession, priceFromDb, priceToDb } from "./link-map.js";

test("price: Course Creator's naira text ↔ courses.price in kobo; free and unset stay apart", () => {
  assert.deepEqual(priceToDb("4500"), { price: 450000, is_free: false });
  assert.deepEqual(priceToDb("free"), { price: 0, is_free: true });
  assert.deepEqual(priceToDb(""), { price: 0, is_free: false });
  assert.deepEqual(priceToDb("abc"), { price: 0, is_free: false });
  assert.equal(priceFromDb({ price: 450000, is_free: false }), "4500");
  assert.equal(priceFromDb({ price: 0, is_free: true }), "free");
  assert.equal(priceFromDb({ price: 0, is_free: false }), "");
  assert.equal(priceFromDb({ price: 12350, is_free: false }), "123.50");
  for (const p of ["4500", "free", ""]) assert.equal(priceFromDb(priceToDb(p)), p, `round trip ${p}`);
});

test("a Course Creator course → its courses columns (level, platform, type, cover)", () => {
  const c = courseFieldsFrom({ title: "Cells", subtitle: "Basics", description: "", category: "Biology", level: "All levels", language: "English", type: "live", platform: "Google Meet", price: "2000", cover_url: "blob:x" });
  assert.deepEqual(c, { title: "Cells", description: "Basics", cover_image_url: null, course_type: "live", subject: "Biology", level: "all", language: "English", platform: "meet", price: 200000, is_free: false });
  const v = courseFieldsFrom({ title: "Osmosis", category: "Other", level: "Beginner", type: "video", platform: "YouTube Live", price: "free" });
  assert.equal(v.platform, null, "video courses have no live platform");
  assert.equal(v.subject, null);
  assert.equal(v.is_free, true);
});

test("an old course → My Courses: its price, status, type and level kept", () => {
  const b = builderFieldsFrom({ id: "c1", instructor_id: "u1", title: "Old course", subject: "Chemistry", level: "intermediate", language: "English", course_type: "video", platform: null, is_published: true, price: 300000, is_free: false, description: "d", cover_image_url: "https://x/y.png" });
  assert.equal(b.owner_id, "u1");
  assert.equal(b.course_id, "c1");
  assert.equal(b.price, "3000");
  assert.equal(b.status, "published");
  assert.equal(b.level, "Intermediate");
  assert.equal(b.type, "video");
  assert.ok(b.color >= 0 && b.color <= 5);
});

test("old lessons and live sessions → builder lessons (Lagos wall clock)", () => {
  assert.deepEqual(lagosWallClock("2026-10-22T15:00:00Z"), { date: "2026-10-22", time: "16:00" });
  const v = lessonFromOld({ title: "Intro", duration_seconds: 600, video_url: "https://v", is_preview: true, description: null, thumbnail_url: null }, 0);
  assert.equal(v.type, "video"); assert.equal(v.meta, "10 min"); assert.equal(v.free, true); assert.equal(v.src, "https://v");
  const s = lessonFromSession({ title: "Live 1", scheduled_start: "2026-10-22T15:00:00Z", scheduled_end: "2026-10-22T16:30:00Z", platform: "zoom", join_url: "https://z" }, 1);
  assert.equal(s.type, "live"); assert.equal(s.when_at, "2026-10-22T16:00"); assert.equal(s.end_time, "17:30"); assert.equal(s.platform, "Zoom"); assert.equal(s.position, 1);
});
