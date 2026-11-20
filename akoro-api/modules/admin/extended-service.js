import bcrypt from "bcrypt";
import { sendWelcomeEmail } from "../auth/index.js";
import {
  ok, ok201, err400, err404, err409,
  daysAgo, toDateStr, periodStart,
  CREATE_ROLES, BCRYPT_ROUNDS,
  FRONTEND_URL, INSTRUCTOR_FRONTEND_URL, ADMIN_FRONTEND_URL, SCHOOL_FRONTEND_URL,
  genPassword, usernameBase,
} from "./extended-rules.js";
import * as store from "./extended-store.js";

export async function dashboardStats(_req, res) {
  const since30d = daysAgo(30);
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayISO = `${todayStr}T00:00:00.000Z`;

  const {
    total_users, total_instructors, total_courses, new_users_30d,
    reviewData, enrollData, dauData, mauData,
  } = await store.dashboardMetrics(since30d, todayISO);

  const avg_course_rating =
    reviewData && reviewData.length > 0
      ? Math.round(
          (reviewData.reduce((sum, r) => sum + (r.rating ?? 0), 0) / reviewData.length) * 10
        ) / 10
      : null;

  const total_enrollments = enrollData ? enrollData.length : 0;
  const total_completions = enrollData
    ? enrollData.filter((e) => e.progress === 100).length
    : 0;
  const completion_rate =
    total_enrollments > 0
      ? Math.round((total_completions / total_enrollments) * 1000) / 10
      : 0;

  const dau = dauData
    ? new Set(dauData.map((r) => r.user_id)).size
    : 0;
  const mau = mauData
    ? new Set(mauData.map((r) => r.user_id)).size
    : 0;

  ok(res, {
    total_users,
    total_instructors,
    total_courses,
    new_users_30d,
    avg_course_rating,
    total_completions,
    completion_rate,
    dau,
    mau,
  });
}

export async function loginTrends(_req, res) {
  const since = daysAgo(30);

  const data = await store.loginTrendRows(since);

  const counts = {};
  for (const row of data ?? []) {
    const d = toDateStr(row.created_at);
    counts[d] = (counts[d] ?? 0) + 1;
  }

  const result = [];
  for (let i = 29; i >= 0; i--) {
    const d = toDateStr(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
    result.push({ date: d, logins: counts[d] ?? 0 });
  }

  ok(res, result);
}

export async function courseCategories(_req, res) {
  const data = await store.courseCategories();

  const categories = [...new Set((data ?? []).map((r) => r.subject).filter(Boolean))].sort();
  ok(res, categories);
}

export async function courseDetail(req, res) {
  const { id } = req.params;

  const l = await store.listingById(id);
  if (!l) return err404(res, "Course not found");

  const topics = (l.topics_covered && l.topics_covered.length ? l.topics_covered : l.preview_topics) || [];
  const modules = topics.length
    ? [{ id: "topics", title: "Topics covered", lessons: topics.map((t, i) => ({ id: `t${i}`, title: t })) }]
    : [];

  ok(res, {
    id: l.id,
    title: l.title,
    description: l.description,
    subject: l.subject,
    topic: l.subject,
    status: l.is_active ? "published" : "archived",
    is_published: !!l.is_active,
    price: (l.price_kobo ?? 0) / 100,
    enrolled_count: l.total_students ?? 0,
    total_sessions: l.total_sessions ?? 0,
    instructor: { id: l.teacher_id, full_name: l.teacher_name || null },
    instructor_name: l.teacher_name || null,
    style_summary: l.style_summary || null,
    created_at: l.created_at,
    updated_at: l.updated_at,
    modules,
  });
}

export async function createModule(req, res) {
  const { id: course_id } = req.params;
  const { title, order_index } = req.body;

  if (!title) return err400(res, "title is required");

  const data = await store.insertCourseModule({ course_id, title, order_index: order_index ?? 0 });
  ok201(res, data);
}

export async function createLesson(req, res) {
  const { moduleId: module_id } = req.params;
  const { title, lesson_type, duration_seconds, order_index, content_json } = req.body;

  if (!title) return err400(res, "title is required");

  const data = await store.insertLesson({
    module_id,
    title,
    lesson_type:       lesson_type       ?? null,
    duration_seconds:  duration_seconds  ?? null,
    order_index:       order_index       ?? 0,
    content_json:      content_json      ?? null,
  });
  ok201(res, data);
}

export async function userEnrollments(req, res) {
  const { id: user_id } = req.params;

  const enrollments = await store.enrollmentsForUser(user_id);

  const courseIds = (enrollments ?? []).map((e) => e.course_id);
  let completedMap = {};

  if (courseIds.length > 0) {
    const lpData = await store.completedLessonsForUser(user_id);

    for (const lp of lpData ?? []) {
      const cid = lp.lesson?.module?.course_id;
      if (cid) completedMap[cid] = (completedMap[cid] ?? 0) + 1;
    }
  }

  const result = (enrollments ?? []).map((e) => ({
    course_id:          e.course_id,
    title:              e.course?.title   ?? null,
    subject:            e.course?.subject ?? null,
    progress:           e.progress,
    enrolled_at:        e.enrolled_at,
    status:             e.status,
    lessons_completed:  completedMap[e.course_id] ?? 0,
  }));

  ok(res, result);
}

export async function inviteUser(req, res) {
  const { email, role, full_name } = req.body;

  if (!email)     return err400(res, "email is required");
  if (!role)      return err400(res, "role is required");
  if (!full_name) return err400(res, "full_name is required");
  if (!["student", "instructor"].includes(role))
    return err400(res, "role must be student or instructor");

  const existing = await store.findUserIdByEmail(email.toLowerCase().trim());
  if (existing) return err409(res, "User already exists");

  const cleanEmail = email.toLowerCase().trim();
  const base = usernameBase(cleanEmail);
  let username = `${base}_${Date.now().toString(36).slice(-4)}`;
  const clash = await store.findUserIdByUsername(username);
  if (clash) username = `${username}_${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash(genPassword() + genPassword(), BCRYPT_ROUNDS);

  const data = await store.insertUser({
    email:                 cleanEmail,
    username,
    password_hash:         passwordHash,
    full_name,
    role,
    is_active:             true,
    onboarding_completed:  false,
    created_at:            new Date().toISOString(),
  }, "id,email,full_name,role,is_active,onboarding_completed,created_at");

  ok201(res, data);
}

export async function inviteCsv(req, res) {
  const { rows } = req.body;

  if (!Array.isArray(rows) || rows.length === 0)
    return err400(res, "rows must be a non-empty array");

  const errors  = [];
  const valid   = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.email) {
      errors.push({ index: i, reason: "missing email", row });
      continue;
    }
    if (row.role && !["student", "instructor", "school_admin"].includes(row.role)) {
      errors.push({ index: i, reason: "invalid role", row });
      continue;
    }
    valid.push({
      email:     row.email.toLowerCase().trim(),
      full_name: row.full_name ?? null,
      role:      row.role ?? "student",
    });
  }

  if (valid.length === 0) {
    return ok(res, { invited: 0, skipped: 0, errors });
  }

  const emailList = valid.map((r) => r.email);
  const existingUsers = await store.findUserEmails(emailList);

  const existingEmails = new Set((existingUsers ?? []).map((u) => u.email));
  const toInsert = valid.filter((r) => !existingEmails.has(r.email));
  const skipped  = valid.length - toInsert.length;

  let invited = 0;
  if (toInsert.length > 0) {
    const now = new Date().toISOString();
    const stamp = Date.now().toString(36).slice(-4);
    const rows = await Promise.all(toInsert.map(async (r, i) => {
      const base = usernameBase(r.email);
      return {
        email:                r.email,
        username:             `${base}_${stamp}${i}`,
        password_hash:        await bcrypt.hash(genPassword() + genPassword(), BCRYPT_ROUNDS),
        full_name:            r.full_name,
        role:                 r.role,
        is_active:            true,
        onboarding_completed: false,
        created_at:           now,
      };
    }));
    const clashRows = await store.findUsernames(rows.map((r) => r.username));
    if (clashRows?.length) {
      const taken = new Set(clashRows.map((u) => u.username));
      for (const r of rows) if (taken.has(r.username)) r.username = `${r.username}_${Math.random().toString(36).slice(2, 6)}`;
    }

    const inserted = await store.insertUsers(rows);
    invited = inserted?.length ?? 0;
  }

  ok(res, { invited, skipped, errors });
}

export async function createUser(req, res) {
  const email     = String(req.body.email || "").toLowerCase().trim();
  const fullName  = String(req.body.full_name || "").trim();
  const role      = req.body.role || "student";
  const provided  = req.body.password ? String(req.body.password) : "";

  if (!email)    return err400(res, "email is required");
  if (!fullName) return err400(res, "full_name is required");
  if (!CREATE_ROLES.includes(role))
    return err400(res, "role must be student, instructor, school_admin or admin");
  if (provided && provided.length < 8)
    return err400(res, "password must be at least 8 characters");

  const existing = await store.findUserIdByEmailSoft(email);
  if (existing) return err409(res, "A user with this email already exists");

  const base = usernameBase(email);
  let username = `${base}_${Date.now().toString(36).slice(-4)}`;
  const clash = await store.findUserIdByUsername(username);
  if (clash) username = `${username}_${Math.random().toString(36).slice(2, 6)}`;

  const password     = provided || genPassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await store.createUserSingle({
    email, username,
    password_hash:        passwordHash,
    full_name:            fullName,
    role,
    is_active:            true,
    email_verified:       false,
    onboarding_completed: false,
    created_at:           new Date().toISOString(),
  });

  const loginUrl = role === "instructor"   ? `${INSTRUCTOR_FRONTEND_URL}/signin`
    : role === "school_admin"              ? `${SCHOOL_FRONTEND_URL}/signin`
    : role === "admin"                     ? `${ADMIN_FRONTEND_URL}/signin`
    : `${FRONTEND_URL}/signin`;
  sendWelcomeEmail({ to: user.email, name: user.full_name || user.username, loginUrl, role }).catch(() => {});

  ok201(res, { ...user, tempPassword: provided ? undefined : password, loginUrl });
}

export async function payoutsSummary(_req, res) {
  const earnings = await store.allEarnings();

  const groupMap = {};
  for (const row of earnings ?? []) {
    const iid = row.instructor_id;
    if (!groupMap[iid]) {
      groupMap[iid] = { instructor_id: iid, total_earned: 0, pending_amount: 0, paid_amount: 0, course_count: 0 };
    }
    const amt = Number(row.net_amount) || 0;
    groupMap[iid].total_earned += amt;
    if (row.status === "pending" || row.status === "on_hold") groupMap[iid].pending_amount += amt;
    if (row.status === "paid")                               groupMap[iid].paid_amount   += amt;
    groupMap[iid].course_count += 1;
  }

  const instructorIds = Object.keys(groupMap);
  if (instructorIds.length === 0) return ok(res, []);

  const users = await store.usersByIds(instructorIds);

  const userMap = Object.fromEntries((users ?? []).map((u) => [u.id, u]));

  const result = Object.values(groupMap)
    .map((g) => ({
      ...g,
      full_name: userMap[g.instructor_id]?.full_name ?? null,
      email:     userMap[g.instructor_id]?.email     ?? null,
      total_earned:   Math.round(g.total_earned   * 100) / 100,
      pending_amount: Math.round(g.pending_amount * 100) / 100,
      paid_amount:    Math.round(g.paid_amount    * 100) / 100,
    }))
    .sort((a, b) => b.total_earned - a.total_earned);

  ok(res, result);
}

export async function payoutsList(req, res) {
  const { status, instructor_id, limit = 50, offset = 0 } = req.query;
  const lim = Math.min(Number(limit) || 50, 200);
  const off = Number(offset) || 0;

  const { data, count } = await store.payoutPage({ status, instructor_id, off, lim });
  ok(res, data, { total: count, limit: lim, offset: off });
}

export async function markPayoutPaid(req, res) {
  const { id } = req.params;
  const { payout_id } = req.body;

  const data = await store.markPayoutPaid(id, payout_id ?? null);

  if (!data) return err404(res, "Payout not found");
  ok(res, data);
}

export async function engagement(_req, res) {
  const { enrollData, lpData } = await store.engagementRows();

  const avg_completion_rate =
    enrollData && enrollData.length > 0
      ? Math.round(
          (enrollData.reduce((s, r) => s + (r.progress ?? 0), 0) / enrollData.length) * 10
        ) / 10
      : 0;

  const allLp = lpData ?? [];
  const lessons_completed = allLp.length;
  const avg_watch_time_minutes =
    allLp.length > 0
      ? Math.round(
          (allLp.reduce((s, r) => s + (r.last_position_seconds ?? 0), 0) / allLp.length / 60) * 10
        ) / 10
      : 0;

  const lessonCounts = {};
  for (const lp of allLp) {
    lessonCounts[lp.lesson_id] = (lessonCounts[lp.lesson_id] ?? 0) + 1;
  }

  const topLessonIds = Object.entries(lessonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  let top_lessons = [];
  if (topLessonIds.length > 0) {
    const lessonRows = await store.lessonTitles(topLessonIds);

    const lessonTitleMap = Object.fromEntries((lessonRows ?? []).map((l) => [l.id, l.title]));
    top_lessons = topLessonIds.map((id) => ({
      lesson_id:   id,
      title:       lessonTitleMap[id] ?? null,
      completions: lessonCounts[id],
    }));
  }

  ok(res, { avg_completion_rate, avg_watch_time_minutes, lessons_completed, top_lessons });
}

export async function topInstructors(_req, res) {
  const earnings = await store.earningsTotals();

  const totals = {};
  for (const row of earnings ?? []) {
    const iid = row.instructor_id;
    totals[iid] = (totals[iid] ?? 0) + (Number(row.net_amount) || 0);
  }

  const topIds = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);

  if (topIds.length === 0) return ok(res, []);

  const users = await store.usersByIds(topIds);

  const userMap = Object.fromEntries((users ?? []).map((u) => [u.id, u]));

  const result = topIds.map((id) => ({
    instructor_id: id,
    full_name:     userMap[id]?.full_name ?? null,
    email:         userMap[id]?.email     ?? null,
    total_earned:  Math.round(totals[id] * 100) / 100,
  }));

  ok(res, result);
}

export async function revenueExport(req, res) {
  const { period = "30d" } = req.query;
  const since = periodStart(period);

  const data = await store.paymentsSince(since);

  const result = (data ?? []).map((p) => ({
    id:             p.id,
    amount:         p.amount,
    currency:       p.currency,
    status:         p.status,
    payment_method: p.payment_method,
    created_at:     p.created_at,
    user_email:     p.user?.email     ?? null,
    user_name:      p.user?.full_name ?? null,
    course_title:   p.course?.title   ?? null,
    course_subject: p.course?.subject ?? null,
  }));

  ok(res, result, { period, since });
}

export async function enrollmentsExport(req, res) {
  const { period = "30d" } = req.query;
  const since = periodStart(period);

  const data = await store.enrollmentsSince(since);

  const result = (data ?? []).map((e) => ({
    id:             e.id,
    course_id:      e.course_id,
    progress:       e.progress,
    enrolled_at:    e.enrolled_at,
    status:         e.status,
    user_email:     e.user?.email     ?? null,
    user_name:      e.user?.full_name ?? null,
    course_title:   e.course?.title   ?? null,
    course_subject: e.course?.subject ?? null,
  }));

  ok(res, result, { period, since });
}
