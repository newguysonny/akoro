// Security follow-ups (Grand Plan Phase 15). Read-only: nothing is changed for anyone.

// Item 1: an approved teacher reads their school's classroom records, never its finance, payroll,
// staff, health records, admissions or pupils' locations; the school admin still reads all of it.
export const teacherSchoolReads = {
  name: "security.teacher_school_reads", area: "security", risk: "read",
  description: "A teacher approved into a school can read its classroom records (students, classes, subjects, exams) but gets 403 on payroll, staff loans, health records, bank accounts, fees, admissions, the dashboards and pupils' live transport locations; the school admin still reads them.",
  params: { teacher: { default: "@demo_teacher1" }, admin: { default: "@demo_school_admin" } },
  async run(ctx, p) {
    const get = (who, path) => ctx.http({ as: who, path: `/api/school/mgmt${path}` });
    const first = await get(p.teacher, "/students");
    if (first.status === 404) ctx.expect.blocked(`${p.teacher} isn't approved into a school on this server (${first.body?.error || 404})`);
    for (const path of ["/students", "/classes", "/subjects", "/exams", "/timetable-slots"]) {
      ctx.expect.status(`teacher reads ${path}`, path === "/students" ? first : await get(p.teacher, path), 200);
    }
    for (const path of ["/payroll-records", "/staff-loans", "/salary-templates", "/health-records", "/bank-accounts", "/expenses",
      "/fee-payments", "/admission-applications", "/complaints", "/staff", "/fees/dues", "/dashboard/finance",
      "/hr/attendance/register", "/transport/latest-locations", "/document-templates"]) {
      ctx.expect.status(`teacher is refused ${path}`, await get(p.teacher, path), 403);
    }
    for (const path of ["/payroll-records", "/health-records", "/fees/dues"]) {
      ctx.expect.status(`school admin still reads ${path}`, await get(p.admin, path), 200);
    }
  },
};

// Item 6: ownership. A signed-in user changing an id in the URL must not reach someone else's row.
// As one test learner, ask for another test learner's task runs, course chat and community member
// list (and, as a test instructor, for other teachers' class rosters and course students) — each a
// 403/404 — while the owners still read their own with a 200. Ids come from the database; GETs only.
export const ownershipReads = {
  name: "security.ownership_reads", area: "security", risk: "read",
  description: "As @tester01, another learner's task runs/outputs, a course chat they're not in and a community member list/analytics they don't belong to answer 403/404 while @tester02 reads its own (200); /api/transactions holds only the caller's payments; as instructor @tester51, another teacher's class roster, course student list and ?course_id= filter answer 403/404 while its own class roster is 200.",
  params: { learner: { default: "@tester01" }, other: { default: "@tester02" }, instructor: { default: "@tester51" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const other = await ctx.as(p.other);
    const refused = [403, 404];
    let checked = 0;

    // Tasks: runs and outputs are the creator's.
    const [otherTask] = await ctx.db.rows("tasks", { creator_id: other.id }, { columns: "id", limit: 1 });
    if (otherTask) {
      for (const leaf of ["runs", "outputs"]) {
        ctx.expect.status(`${p.learner} is refused ${p.other}'s task ${leaf}`, await ctx.http({ as: p.learner, path: `/api/tasks/${otherTask.id}/${leaf}` }), refused);
        ctx.expect.status(`${p.other} reads its own task ${leaf}`, await ctx.http({ as: p.other, path: `/api/tasks/${otherTask.id}/${leaf}` }), 200);
      }
      checked += 1;
    } else ctx.note(`${p.other} has no task — task checks skipped`);

    // Course chat: for the course's people only.
    const mine = new Set((await ctx.db.rows("enrollments", { user_id: me.id, status: "active" }, { columns: "course_id", limit: 200 })).map((r) => r.course_id));
    const theirs = await ctx.db.rows("enrollments", { user_id: other.id, status: "active" }, { columns: "course_id", limit: 50 });
    const courseId = theirs.map((r) => r.course_id).find((id) => id && !mine.has(id));
    if (courseId) {
      ctx.expect.status(`${p.learner} is refused a course chat it isn't in`, await ctx.http({ as: p.learner, path: `/api/courses/${courseId}/messages` }), 403);
      ctx.expect.status(`${p.other} reads its own course chat`, await ctx.http({ as: p.other, path: `/api/courses/${courseId}/messages` }), 200);
      checked += 1;
    } else ctx.note(`no course ${p.other} is enrolled in without ${p.learner} — course chat check skipped`);

    // Communities: members for members, analytics for the creator.
    const joined = new Set((await ctx.db.rows("edu.community_members", { user_id: me.id }, { columns: "community_id", limit: 200 })).map((r) => r.community_id));
    const owned = await ctx.db.rows("edu.communities", { owner_id: other.id }, { columns: "id", limit: 20 });
    const community = owned.find((c) => !joined.has(c.id));
    if (community) {
      for (const leaf of ["members", "analytics"]) {
        ctx.expect.status(`${p.learner} is refused the community ${leaf}`, await ctx.http({ as: p.learner, path: `/api/communities/${community.id}/${leaf}` }), 403);
        ctx.expect.status(`${p.other} reads its own community ${leaf}`, await ctx.http({ as: p.other, path: `/api/communities/${community.id}/${leaf}` }), 200);
      }
      checked += 1;
    } else ctx.note(`${p.other} owns no community ${p.learner} is outside — community checks skipped`);

    // Transactions: a learner's list is their own payments only.
    const tx = await ctx.http({ as: p.learner, path: "/api/transactions?limit=50" });
    ctx.expect.status(`${p.learner} reads /api/transactions`, tx, 200);
    const payers = [...new Set((tx.body?.data || []).map((r) => r.users?.id).filter(Boolean))];
    ctx.expect.ok(`every transaction ${p.learner} sees is its own`, payers.every((id) => id === me.id), payers);

    // Instructor: another teacher's class roster and course students.
    const teacher = await ctx.as(p.instructor).catch(() => null);
    if (teacher?.role === "instructor") {
      // A class with no school, so the school-admin path can't apply.
      const rooms = await ctx.db.rows("classrooms", {}, { columns: "id, teacher_id, school_id", limit: 200 });
      const foreignRoom = rooms.find((r) => r.teacher_id && r.teacher_id !== teacher.id && !r.school_id);
      if (foreignRoom) {
        ctx.expect.status(`${p.instructor} is refused another teacher's class roster`, await ctx.http({ as: p.instructor, path: `/api/instructor/classrooms/${foreignRoom.id}/students` }), refused);
        checked += 1;
      }
      const ownRoom = (await ctx.db.rows("classrooms", { teacher_id: teacher.id }, { columns: "id", limit: 1 }))[0];
      if (ownRoom) ctx.expect.status(`${p.instructor} reads its own class roster`, await ctx.http({ as: p.instructor, path: `/api/instructor/classrooms/${ownRoom.id}/students` }), 200);
      const courses = await ctx.db.rows("courses", {}, { columns: "id, instructor_id", limit: 100 });
      const foreignCourse = courses.find((c) => c.instructor_id && c.instructor_id !== teacher.id);
      if (foreignCourse) {
        ctx.expect.status(`${p.instructor} is refused another teacher's course students`, await ctx.http({ as: p.instructor, path: `/api/courses/${foreignCourse.id}/students` }), 403);
        const filtered = await ctx.http({ as: p.instructor, path: `/api/profiles/instructor/students?course_id=${foreignCourse.id}` });
        // A teacher with no courses gets an empty list before the filter is read; either way, no one else's learners.
        ctx.expect.ok(`${p.instructor} gets none of another course's learners through ?course_id=`,
          filtered.status === 403 || (filtered.status === 200 && (filtered.body?.data || []).length === 0), { status: filtered.status, rows: (filtered.body?.data || []).length });
        checked += 1;
      }
    } else ctx.note(`${p.instructor} isn't an instructor on this server — instructor checks skipped`);

    if (!checked) ctx.expect.blocked("no fixture rows to test ownership against (tasks, enrolments, communities, classes, courses)");
  },
};

// Item 2: the payments router is mounted once — its paths answer at /api/payments/…, the doubled
// /api/payments/payments/… copies are gone (the old webhook path is kept as a logged alias only).
export const paymentsSingleMount = {
  name: "security.payments_single_mount", area: "security", risk: "read",
  description: "Payment routes answer once at /api/payments/… (history, enrollments, transactions); the doubled /api/payments/payments/…, /api/payments/user/… and /api/payments/transactions copies are 404.",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    ctx.expect.status("payment history at /api/payments/history", await ctx.http({ as: p.learner, path: "/api/payments/history" }), 200);
    ctx.expect.status("enrollments at /api/user/enrollments", await ctx.http({ as: p.learner, path: "/api/user/enrollments" }), 200);
    for (const path of ["/api/payments/payments/history", "/api/payments/user/enrollments", "/api/payments/transactions"]) {
      ctx.expect.status(`no copy at ${path}`, await ctx.http({ as: p.learner, path }), 404);
    }
  },
};

// Item 3: a teacher's course invite links to the learner app's /join/:token page. The token is
// signed with the auth key (no fallback secret), previews publicly, never signs in, and redeeming
// needs a signed-in learner. Read-only: the invite is signed in-process and only previewed.
export const courseInviteJoin = {
  name: "security.course_invite_join", area: "security", risk: "read",
  description: "An invite for a teacher's own course previews at GET /api/profiles/invite/:token (200, the course title); the same token is 401 as a login on /api/auth/me; tokens signed with the old fallback secret or of another type are 400; redeeming signed-out is 401.",
  params: { teacher: { default: "@demo_teacher1" } },
  async run(ctx, p) {
    const jwt = (await import("jsonwebtoken")).default;
    const { signCourseInvite, signHandoff } = await import("../../auth/index.js");
    const teacher = await ctx.as(p.teacher);
    const course = (await ctx.db.rows("courses", { instructor_id: teacher.id }, { columns: "id, title", limit: 1 }))[0];
    if (!course) ctx.expect.blocked(`${p.teacher} has no course on this server to invite to`);
    const token = signCourseInvite({ teacherId: teacher.id, courseIds: [course.id] }, 1);
    const preview = await ctx.http({ path: `/api/profiles/invite/${token}` });
    ctx.expect.status("the invite previews signed-out", preview, 200);
    ctx.expect.eq("…with the course's title", preview.body?.data?.courses?.[0]?.title, course.title);
    const me = await ctx.http({ path: "/api/auth/me", headers: { Authorization: `Bearer ${token}` } });
    ctx.expect.status("the invite does not sign in", me, 401);
    const old = jwt.sign({ courseIds: [course.id], courseId: course.id, teacherId: teacher.id, type: "course_invite" }, "akoro-dev-secret", { expiresIn: "1d" });
    ctx.expect.status("an invite signed with the old fallback secret is refused", await ctx.http({ path: `/api/profiles/invite/${old}` }), 400);
    ctx.expect.status("a hand-off token is not an invite", await ctx.http({ path: `/api/profiles/invite/${signHandoff(teacher.id)}` }), 400);
    ctx.expect.status("redeeming signed-out is refused", await ctx.http({ method: "POST", path: "/api/profiles/invite/redeem", body: { token } }), 401);
  },
};

// Item 4: shared-secret routes refuse without the secret (403 when it is set, 503 when it isn't —
// never open), and Paystack webhooks refuse a forged signature. Signed-out probes only; every one is
// refused before any work, so nothing changes. (/api/webhooks/paystack is left out: it records
// even a refused attempt.)
export const sharedSecretsFailClosed = {
  name: "security.shared_secrets_fail_closed", area: "security", risk: "read",
  description: "The video-worker routes, scheduler ticks and /internal/{preflight,egress} answer 403/503 to a missing or wrong x-internal-secret; the course-payment, payout and marketplace Paystack webhooks answer 400 to a missing or forged x-paystack-signature (including one keyed with an empty secret).",
  async run(ctx) {
    const crypto = (await import("node:crypto")).default;
    const refused = [403, 503];
    const probes = [
      ["GET", "/api/stream/internal/source-url/gate-probe"],
      ["POST", "/api/stream/internal/update", { videoId: "gate-probe", encodingStatus: "failed" }],
      ["GET", "/api/internal/ticks"],
      ["GET", "/internal/preflight"],
      ["GET", "/internal/egress"],
    ];
    for (const [method, path, body] of probes) {
      ctx.expect.status(`${method} ${path} without the secret is refused`, await ctx.http({ method, path, body }), refused);
      ctx.expect.status(`${method} ${path} with a wrong secret is refused`, await ctx.http({ method, path, body, headers: { "x-internal-secret": "gate-wrong-secret" } }), refused);
    }
    const event = { event: "charge.success", data: { reference: `gate-forged-${ctx.marker}` } };
    const raw = JSON.stringify(event);
    const emptyKeySig = crypto.createHmac("sha512", "").update(raw).digest("hex");
    for (const path of ["/api/payments/verify", "/api/payouts/webhook", "/api/adaptive/marketplace/webhook"]) {
      ctx.expect.status(`${path} without a signature is refused`, await ctx.http({ method: "POST", path, body: event }), 400);
      ctx.expect.status(`${path} with a forged signature is refused`, await ctx.http({ method: "POST", path, body: event, headers: { "x-paystack-signature": "0".repeat(128) } }), 400);
      ctx.expect.status(`${path} with an empty-key signature is refused`, await ctx.http({ method: "POST", path, body: event, headers: { "x-paystack-signature": emptyKeySig } }), 400);
    }
  },
};

// Item 5: no hard-coded fallback secrets. A session token signed with the default that used to be in
// the code (HS256, right issuer and audience, a real test learner) does not sign in — whatever keys
// this server has. Read-only.
export const noFallbackSecrets = {
  name: "security.no_fallback_secrets", area: "security", risk: "read",
  description: "A session token signed with the old built-in default (\"akoro-dev-secret-change-in-production\" or \"akoro-dev-secret\") gets 401 on /api/auth/me; a real access token for the same learner still gets 200.",
  params: { learner: { default: "@tester30" } },
  async run(ctx, p) {
    const jwt = (await import("jsonwebtoken")).default;
    const { signInternalAccess } = await import("../../auth/index.js");
    const me = await ctx.as(p.learner);
    const asBearer = (token) => ctx.http({ path: "/api/auth/me", headers: { Authorization: `Bearer ${token}` } });
    ctx.expect.status("a real access token signs in", await asBearer(signInternalAccess({ id: me.id, role: me.role }, 120)), 200);
    const iss = process.env.JWT_ISSUER || "https://api.akoro.app";
    const aud = process.env.JWT_AUDIENCE || "https://akoro.app";
    for (const key of ["akoro-dev-secret-change-in-production", "akoro-dev-secret"]) {
      const forged = jwt.sign({ sub: me.id, email: me.email ?? null, role: me.role, jti: `gate-${Date.now()}`, iss, aud }, key, { algorithm: "HS256", expiresIn: 120 });
      ctx.expect.status(`a token signed with "${key}" does not sign in`, await asBearer(forged), 401);
    }
  },
};
