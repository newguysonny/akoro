/**
 * Learner-facing teacher actions: the instructor's student roll, CSV import,
 * editing a student, and direct messages. Every read and send is scoped to a
 * learner the teacher actually teaches (Phase 15 item 6).
 */
import { res200, res201, res400, res403, res404 } from "./http.js";
import { parseCsvRow, parseCsvRows } from "./rules.js";
import { findOrCreateStudent, sendWelcomeCredentials } from "./service-roster.js";
import * as invites from "./store-invites.js";
import * as schoolStore from "./store-schools.js";
import * as teaching from "./store-teaching.js";
import * as users from "./store-users.js";

/**
 * GET /api/profiles/instructor/students
 * Global student list across ALL courses the teacher owns.
 * Supports ?search=, ?course_id=, ?status=, ?limit=, ?offset=
 */
export async function listInstructorStudents(req, res) {
  const { search, course_id, status, limit = 50, offset = 0 } = req.query;
  const teacherId = req.user.id;

  // Get all courses owned by this teacher
  const { data: courses } = await invites.listOwnedCourses(teacherId);
  const courseIds = (courses ?? []).map((c) => c.id);
  if (!courseIds.length) return res200(res, [], { total: 0 });

  // Filter to specific course if requested — one of the caller's own: any
  // course_id used to be trusted, which listed another course's students with
  // their emails and phones (Phase 15 item 6).
  if (course_id && !courseIds.includes(course_id)) return res403(res, "Not your course");
  const targetIds = course_id ? [course_id] : courseIds;

  const { data, error, count } = await invites.listEnrollmentsForCourses(targetIds, { status, limit, offset });
  if (error) throw new Error(error.message);

  let rows = (data ?? []).map((e) => ({
    enrollment_id: e.id,
    enrollment_status: e.status,
    progress:      e.progress,
    enrolled_at:   e.enrolled_at,
    course_id:     e.courses?.id,
    course_title:  e.courses?.title,
    ...e.users,
    paid: e.status === "active",
  }));

  // Client-side search filter (name or email contains search term)
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter((r) => r.full_name?.toLowerCase().includes(s) || r.email?.toLowerCase().includes(s));
  }

  res200(res, rows, { total: count ?? 0 });
}

/**
 * POST /api/profiles/teacher/students/import
 * Bulk CSV import: parse rows, auto-create accounts, enrol in course.
 * Multipart form: csv file + optional course_id and/or classroom_id
 * CSV format: name, email, phone — the header row is skipped if it contains
 * "name". Extra columns are ignored.
 */
export async function importStudents(req, res) {
  if (!req.file) return res400(res, "CSV file is required");

  // classroom_id is optional but is what the importer usually means: a CSV of
  // a class register. course_id stays optional too — bulk-adding learners to
  // JSS1 shouldn't require inventing a course to hang them off.
  const { course_id, classroom_id: classroomId = null } = req.body;
  if (!course_id && !classroomId)
    return res400(res, "Choose a class, a course, or both — the students have to be added to something");

  // Verify teacher owns the course — only when one was given.
  let course = null;
  if (course_id) {
    const { data } = await invites.getCourseForImport(course_id);
    if (!data || data.instructor_id !== req.user.id) return res403(res, "Not your course");
    course = data;
  }

  // Parse CSV (simple split — handles standard comma-separated CSVs)
  const text = req.file.buffer.toString("utf-8");
  const dataLines = parseCsvRows(text);
  if (!dataLines) return res400(res, "CSV must have a header row and at least one data row");

  // Resolve the class ONCE. This sat inside the per-row loop, re-querying the
  // same classroom for every line of the CSV — a 200-row register meant 200
  // identical lookups.
  let classroom = null;
  if (classroomId) {
    const { data: room } = await teaching.getClassroomForImport(classroomId);
    if (room) {
      let allowed = room.teacher_id === req.user.id || req.user.role === "admin";
      if (!allowed && room.school_id) {
        const { data: school } = await schoolStore.getOwnedSchool(room.school_id, req.user.id);
        allowed = !!school;
      }
      if (!allowed) return res403(res, "You do not teach that class");
      classroom = room;
    } else {
      return res404(res, "Class not found");
    }
  } else {
    const { data: own } = await teaching.getFirstClassroomForTeacher(req.user.id);
    classroom = own ?? null;
  }

  const results = { created: 0, existing: 0, failed: 0, rows: [] };

  for (const line of dataLines) {
    const cols = parseCsvRow(line);
    const [name, email, phone] = cols;
    if (!name || !email) { results.failed++; continue; }

    try {
      const { user, isNew, tempPassword } = await findOrCreateStudent(name, email, phone || null);

      if (classroom) {
        await teaching.upsertClassroomStudent(
          { classroom_id: classroom.id, user_id: user.id, status: "active" },
        );
      }

      // Enrol in course
      if (course) await invites.upsertEnrollment(user.id, course_id);
      if (course) { try { await invites.incrementCourseStudents(course_id); } catch {} }

      // Recipient side — notify the student they were enrolled.
      try {
        const { error: notifErr } = await users.insertNotification({
          user_id:    user.id,
          type:       "enrolled_in_course",
          title:      course ? `You're enrolled in "${course.title}"` : "You've been added to a class",
          content:    course ? "You've been added to this course" : "Your teacher added you to a class.",
          related_id: course_id ?? classroomId,
        });
        if (notifErr) console.warn("[notify] CSV enrol insert failed:", notifErr.message);
      } catch (e) {
        console.warn("[notify] CSV enrol insert threw:", e.message);
      }

      // Send welcome email for new accounts
      if (isNew && tempPassword) {
        const { data: teacher } = await users.getUserFullName(req.user.id);
        await sendWelcomeCredentials({
          user, tempPassword, classroomName: course?.title ?? "your class",
          teacherName: teacher?.full_name ?? "Your teacher", isNew: true,
        });
      }

      results.rows.push({ name, email, status: isNew ? "created" : "existing" });
      if (isNew) results.created++; else results.existing++;
    } catch (e) {
      results.failed++;
      results.rows.push({ name, email, status: "failed", error: e.message });
    }
  }

  res201(res, {
    course_title:   course?.title ?? null,
    total_rows:     dataLines.length,
    accounts_created: results.created,
    already_existed: results.existing,
    failed:          results.failed,
    rows:            results.rows,
  });
}

/** Does this teacher teach this learner — an enrolment in one of their courses, or a seat in one of their classes? */
export async function teachesLearner(teacherId, userId) {
  const { data: courses } = await invites.listOwnedCourseIds(teacherId);
  const courseIds = (courses ?? []).map((c) => c.id);
  if (courseIds.length) {
    const { data: enrolled } = await invites.findEnrollmentForLearner(userId, courseIds);
    if (enrolled?.length) return true;
  }
  const { data: rooms } = await teaching.listTeacherClassroomIds(teacherId);
  const roomIds = (rooms ?? []).map((r) => r.id);
  if (!roomIds.length) return false;
  const { data: seat } = await teaching.findActiveSeat(userId, roomIds);
  return !!seat?.length;
}

/**
 * PATCH /api/profiles/students/:userId
 * Teacher edits a student's details (name, phone, access level).
 * Teachers can only edit students enrolled in their courses.
 */
export async function patchStudent(req, res) {
  const { userId } = req.params;
  const teacherId  = req.user.id;

  // Verify this student is in one of the teacher's courses
  const { data: courses } = await invites.listOwnedCourseIds(teacherId);
  const courseIds = (courses ?? []).map((c) => c.id);
  const { data: enrolled } = await invites.findEnrollmentForStudent(userId, courseIds);

  if (!enrolled && req.user.role !== "admin") return res403(res, "This student is not in your courses");

  const allowed = ["full_name", "phone", "avatar_url"];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

  if (!Object.keys(updates).length) return res400(res, "No valid fields to update");

  const { data, error } = await users.updateStudentFields(userId, updates);
  if (error) throw new Error(error.message);

  res200(res, data);
}

/**
 * POST /api/profiles/students/:userId/message
 * Teacher sends a direct message to a student (in-app + email).
 */
export async function sendStudentMessage(req, res) {
  const { userId }  = req.params;
  const { subject, message, channel = "in_app" } = req.body;

  if (!message?.trim()) return res400(res, "message is required");
  // Only a learner this teacher actually teaches (Phase 15 item 6): this used to
  // send an in-app message and a platform email to any account id.
  if (req.user.role !== "admin" && !(await teachesLearner(req.user.id, userId))) return res403(res, "This student is not in your courses or classes");

  const { data: student } = await users.getStudentForMessage(userId);
  if (!student) return res404(res, "Student not found");

  const { data: teacher } = await users.getUserFullName(req.user.id);

  // In-app notification
  await users.insertNotification({
    user_id:    userId,
    type:       "teacher_message",
    title:      subject ?? `Message from ${teacher?.full_name}`,
    content:    message,
    related_id: req.user.id,
  });
  global.io?.to(`user:${userId}`).emit("notification", {
    type:    "teacher_message",
    title:   subject ?? `Message from ${teacher?.full_name}`,
    content: message,
  });

  // Email if requested
  if (channel === "email" || channel === "both") {
    try {
      const nodemailer = await import("nodemailer");
      const transport  = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT ?? "587"),
        secure: process.env.SMTP_PORT === "465",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transport.sendMail({
        from:    `"Akoro Learning" <${process.env.SMTP_FROM_EMAIL ?? "noreply@akoro.app"}>`,
        to:      student.email,
        subject: subject ?? `Message from ${teacher?.full_name}`,
        html:    `<div style="font-family:sans-serif;max-width:520px"><p>Hi ${student.full_name},</p><p>${message.replace(/\n/g, "<br>")}</p><p style="color:#999;font-size:12px">— ${teacher?.full_name} via Akoro Learning</p></div>`,
      });
    } catch (e) {
      console.warn("[profiles/message] Email failed:", e.message);
    }
  }

  res200(res, { sent: true, channel, student_name: student.full_name });
}
