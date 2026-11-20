import db from "../../db.js";

export const listings = () => db.schema("edu").from("marketplace_listings");

export async function dashboardMetrics(since30d, todayISO) {
  const [
    { count: total_users,       error: e1 },
    { count: total_instructors, error: e2 },
    { count: total_courses,     error: e3 },
    { count: new_users_30d,     error: e4 },
    { data: reviewData,         error: e5 },
    { data: enrollData,         error: e6 },
    { data: dauData,            error: e7 },
    { data: mauData,            error: e8 },
  ] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).eq("role", "instructor"),
    db.from("courses").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).gte("created_at", since30d),
    db.from("reviews").select("rating"),
    db.from("enrollments").select("progress"),
    db.from("refresh_tokens").select("user_id").gte("created_at", todayISO),
    db.from("refresh_tokens").select("user_id").gte("created_at", since30d),
  ]);

  for (const err of [e1, e2, e3, e4, e5, e6, e7, e8]) {
    if (err) throw err;
  }

  return { total_users, total_instructors, total_courses, new_users_30d, reviewData, enrollData, dauData, mauData };
}

export async function loginTrendRows(since) {
  const { data, error } = await db
    .from("refresh_tokens")
    .select("created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function courseCategories() {
  const { data, error } = await listings()
    .select("subject")
    .not("subject", "is", null);
  if (error) throw error;
  return data;
}

export async function listingById(id) {
  const { data, error } = await listings()
    .select("id,title,description,subject,topics_covered,preview_topics,price_kobo,is_active,total_students,total_sessions,teacher_id,teacher_name,style_summary,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function insertCourseModule({ course_id, title, order_index }) {
  const { data, error } = await db
    .from("course_modules")
    .insert({ course_id, title, order_index })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function insertLesson(fields) {
  const { data, error } = await db
    .from("lessons")
    .insert(fields)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function enrollmentsForUser(user_id) {
  const { data, error } = await db
    .from("enrollments")
    .select(
      "id,course_id,progress,enrolled_at,status," +
      "course:courses(title,subject)"
    )
    .eq("user_id", user_id)
    .order("enrolled_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function completedLessonsForUser(user_id) {
  const { data, error } = await db
    .from("lesson_progress")
    .select(
      "completed," +
      "lesson:lessons(module:course_modules(course_id))"
    )
    .eq("user_id", user_id)
    .eq("completed", true);
  if (error) throw error;
  return data;
}

export async function findUserIdByEmail(email) {
  const { data, error } = await db
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findUserIdByEmailSoft(email) {
  const { data } = await db
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  return data;
}

export async function findUserIdByUsername(username) {
  const { data } = await db.from("users").select("id").eq("username", username).maybeSingle();
  return data;
}

export async function insertUser(fields, selectCols) {
  const { data, error } = await db
    .from("users")
    .insert(fields)
    .select(selectCols)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findUserEmails(emailList) {
  const { data, error } = await db
    .from("users")
    .select("email")
    .in("email", emailList);
  if (error) throw error;
  return data;
}

export async function findUsernames(usernames) {
  const { data } = await db.from("users").select("username").in("username", usernames);
  return data;
}

export async function insertUsers(rows) {
  const { data, error } = await db
    .from("users")
    .insert(rows)
    .select("id");
  if (error) throw error;
  return data;
}

export async function createUserSingle(fields) {
  const { data, error } = await db.from("users").insert(fields)
    .select("id,email,full_name,username,role,is_active,created_at").single();
  if (error) throw error;
  return data;
}

export async function allEarnings() {
  const { data, error } = await db
    .from("instructor_earnings")
    .select("instructor_id,net_amount,status");
  if (error) throw error;
  return data;
}

export async function earningsTotals() {
  const { data, error } = await db
    .from("instructor_earnings")
    .select("instructor_id,net_amount");
  if (error) throw error;
  return data;
}

export async function usersByIds(ids) {
  const { data, error } = await db
    .from("users")
    .select("id,full_name,email")
    .in("id", ids);
  if (error) throw error;
  return data;
}

export async function payoutPage({ status, instructor_id, off, lim }) {
  let q = db
    .from("instructor_earnings")
    .select(
      "id,instructor_id,course_id,net_amount,status,payout_id,created_at," +
      "instructor:users!instructor_id(full_name,email)," +
      "course:courses(title)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(off, off + lim - 1);

  if (status)        q = q.eq("status", status);
  if (instructor_id) q = q.eq("instructor_id", instructor_id);

  const { data, count, error } = await q;
  if (error) throw error;
  return { data, count };
}

export async function markPayoutPaid(id, payout_id) {
  const { data, error } = await db
    .from("instructor_earnings")
    .update({ status: "paid", payout_id, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function engagementRows() {
  const [
    { data: enrollData,  error: e1 },
    { data: lpData,      error: e2 },
  ] = await Promise.all([
    db.from("enrollments").select("progress"),
    db.from("lesson_progress").select("completed,last_position_seconds,lesson_id").eq("completed", true),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return { enrollData, lpData };
}

export async function lessonTitles(ids) {
  const { data, error } = await db
    .from("lessons")
    .select("id,title")
    .in("id", ids);
  if (error) throw error;
  return data;
}

export async function paymentsSince(since) {
  const { data, error } = await db
    .from("payments")
    .select(
      "id,amount,currency,status,created_at,payment_method," +
      "user:users!user_id(email,full_name)," +
      "course:courses!course_id(title,subject)"
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function enrollmentsSince(since) {
  const { data, error } = await db
    .from("enrollments")
    .select(
      "id,course_id,progress,enrolled_at,status," +
      "user:users!user_id(email,full_name)," +
      "course:courses!course_id(title,subject)"
    )
    .gte("enrolled_at", since)
    .order("enrolled_at", { ascending: false });
  if (error) throw error;
  return data;
}
