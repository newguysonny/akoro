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
