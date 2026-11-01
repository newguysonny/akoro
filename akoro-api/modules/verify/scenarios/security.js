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
    const { signCourseInvite, signHandoff } = await import("../../auth/routes.js");
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
