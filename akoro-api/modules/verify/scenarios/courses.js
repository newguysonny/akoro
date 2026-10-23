/**
 * One course record (2026-10-20), on a test instructor: a course made in
 * Course Creator has its courses row at once, so Schedule sessions lists it
 * and a session can be put on it; a course made on the old Courses page joins
 * My Courses with its modules as sections and its price kept. Everything is
 * deleted.
 */

export const courseOneRecord = {
  name: "courses.one_record", area: "courses", risk: "write",
  description: "Course Creator makes the courses row (listed by Schedule sessions, a session can be scheduled on it, edits follow); an old Courses-page course is adopted into My Courses once, modules → sections, price kept.",
  params: { instructor: { default: "@tester51" } },
  async run(ctx, p) {
    const me = await ctx.as(p.instructor);
    if (me.role !== "instructor") ctx.expect.blocked(`${p.instructor} isn't an instructor (seed 2026-seed-instructor-testers.sql)`);
    const as = p.instructor;
    const builderCourses = async () => (await ctx.http({ as, path: "/api/course-builder/courses" })).body?.data || [];
    const platformCourses = async () => (await ctx.http({ as, path: "/api/instructor/courses" })).body?.data || [];

    // 1. Made in Course Creator → linked courses row, unpublished.
    const made = await ctx.http({ as, method: "POST", path: "/api/course-builder/courses", body: { title: `${ctx.marker} Live algebra`, type: "live", platform: "Zoom" } });
    ctx.expect.status("Course Creator makes the course", made, 200);
    const b = made.body?.data;
    if (!b?.id) return;
    const sessionIds = [];
    ctx.cleanup(async () => {
      for (const id of sessionIds) await ctx.http({ as, method: "DELETE", path: `/api/instructor/sessions/${id}` });
      await ctx.http({ as, method: "DELETE", path: `/api/course-builder/courses/${b.id}` });
    });
    ctx.expect.ok("it is linked to a courses row", !!b.courseId, b);
    const row = (await ctx.db.rows("courses", { id: b.courseId }))[0];
    ctx.expect.eq("…owned by the instructor", row?.instructor_id, me.id);
    ctx.expect.eq("…unpublished until review", row?.is_published, false);
    ctx.expect.eq("…a live course on Zoom", `${row?.course_type}/${row?.platform}`, "live/zoom");

    // 2. Schedule sessions' picker reads /api/instructor/courses.
    ctx.expect.ok("Schedule sessions lists it", (await platformCourses()).some((c) => c.id === b.courseId));
    const start = new Date(Date.now() + 3 * 86400_000).toISOString();
    const s = await ctx.http({ as, method: "POST", path: "/api/instructor/sessions", body: { courseId: b.courseId, title: `${ctx.marker} Week 1`, startTime: start, duration: 45, platform: "zoom" } });
    ctx.expect.ok("a session can be scheduled on it", s.status === 200 || s.status === 201, s.body);
    const sid = s.body?.data?.id;
    if (sid) sessionIds.push(sid);

    // 3. Edits in Course Creator follow on the courses row (price: naira text → kobo).
    const ed = await ctx.http({ as, method: "PATCH", path: `/api/course-builder/courses/${b.id}`, body: { title: `${ctx.marker} Live algebra II`, price: "4500", level: "Advanced" } });
    ctx.expect.status("the edit is saved", ed, 200);
    const after = (await ctx.db.rows("courses", { id: b.courseId }))[0];
    ctx.expect.eq("title follows", after?.title, `${ctx.marker} Live algebra II`);
    ctx.expect.eq("price follows in kobo", Number(after?.price), 450000);
    ctx.expect.eq("level follows", after?.level, "advanced");

    // 4. An old Courses-page course with a module + lesson → adopted into My Courses.
    const old = await ctx.http({ as, method: "POST", path: "/api/instructor/courses", body: { title: `${ctx.marker} Old biology`, type: "ondemand", price: 250000, isFree: false } });
    ctx.expect.ok("an old course is made", old.status === 200 || old.status === 201, old.body);
    const oldId = old.body?.data?.id;
    if (!oldId) return;
    let adoptedId = null;
    ctx.cleanup(async () => {
      if (adoptedId) await ctx.http({ as, method: "DELETE", path: `/api/course-builder/courses/${adoptedId}` });
      await ctx.http({ as, method: "DELETE", path: `/api/instructor/courses/${oldId}` });
    });
    const cur = await ctx.http({ as, method: "POST", path: `/api/instructor/courses/${oldId}/curriculum`, body: { sections: [{ title: "Cells", lessons: [{ title: "The cell membrane", duration: 12 }] }] } });
    ctx.expect.ok("its curriculum is saved", cur.status === 200 || cur.status === 201, cur.body);

    const mine = await builderCourses();
    const adopted = mine.filter((c) => c.courseId === oldId);
    ctx.expect.eq("it shows once in My Courses", adopted.length, 1);
    adoptedId = adopted[0]?.id || null;
    const a = adopted[0];
    ctx.expect.eq("…with its price kept (naira)", a?.price, "2500");
    ctx.expect.eq("…its module is a section", a?.sections?.map((x) => x.title).join("|"), "Cells");
    ctx.expect.eq("…with its lesson", a?.sections?.[0]?.lessons?.map((l) => l.title).join("|"), "The cell membrane");
    ctx.expect.eq("a second visit adds nothing", (await builderCourses()).filter((c) => c.courseId === oldId).length, 1);
  },
};
