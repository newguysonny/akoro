/**
 * instructor/service-students.js — the teacher's learners: the merged class +
 * enrolment list, adding a learner to a class (and optionally a course), and
 * removing an enrolment.
 */
import { asyncHandler, created, ok, err400, err403, err404, err500, now, notify } from "./service-core.js";
import {
  schoolAdminOf, schoolAdminForClass, classroomsBasic, classroomStudentsWithUsers,
  upsertClassroomStudent, userByEmail, insertUser,
} from "./store-people.js";
import {
  coursesOfTeacher, enrollmentsForCourses, courseWithTitle,
  enrollmentForUser, reactivateEnrollment, insertEnrollment,
  enrollmentById, courseOwnerSingle, deleteEnrollment,
} from "./store-courses.js";

// ─── § STUDENTS ───────────────────────────────────────────────────────────────

/**
 * listStudents — everyone this teacher teaches.
 *
 * It listed course ENROLMENTS only, and never looked at classroom_students. So
 * a teacher with thirty-eight learners across four classes and no course
 * enrolments saw an empty page — and "2 enrolled learners" when two happened to
 * be on a course. Since a learner is now put in a CLASS first and enrolled on a
 * course only if one is chosen, that made My Students the one place the new
 * arrivals never appeared.
 *
 * Both sources now, merged by learner: a class member who is also enrolled
 * shows once, carrying their class and their courses.
 */
export const listStudents = asyncHandler(async (req, res) => {
  try {
    const { courseId, classroomId, search, status } = req.query;

    // ── Course enrolments ────────────────────────────────────────────────
    const { data: courses, error: cErr } = await coursesOfTeacher(req.user.id, courseId);
    if (cErr) throw new Error(cErr.message);
    const courseIds = (courses ?? []).map((c) => c.id);

    let enrollments = [];
    if (courseIds.length) {
      const { data, error } = await enrollmentsForCourses(courseIds, status);
      if (error) throw new Error(error.message);
      enrollments = data ?? [];
    }

    // ── Class members ────────────────────────────────────────────────────
    // Classes this teacher runs, plus every class in a school they administer —
    // the same reach the rest of the platform grants.
    const { data: school } = await schoolAdminOf(req.user.id);

    const { data: rooms } = await classroomsBasic(req.user.id, school?.id ?? null, classroomId);

    let members = [];
    const roomIds = (rooms ?? []).map((r) => r.id);
    if (roomIds.length) {
      const { data } = await classroomStudentsWithUsers(roomIds);
      // A classroom row exists for the teacher too, and for demo/service
      // accounts parked in a room. This is a list of LEARNERS.
      members = (data ?? []).filter((m) =>
        m.users?.id !== req.user.id && (m.users?.role ?? "student") === "student");
    }
    const roomName = new Map((rooms ?? []).map((r) => [r.id, r.name]));

    // ── Merge, learner by learner ────────────────────────────────────────
    const byUser = new Map();
    const seed = (u) => {
      if (!u?.id) return null;
      if (!byUser.has(u.id)) byUser.set(u.id, {
        id: u.id, fullName: u.full_name, email: u.email,
        avatarUrl: u.avatar_url, phone: u.phone,
        progress: 0, status: "active", joinedAt: null,
        classes: [], className: null, classroomId: null,
        course: null, courseId: null, courses: [], coursesEnrolled: 0,
        enrollmentId: null,
      });
      return byUser.get(u.id);
    };

    for (const m of members) {
      const row = seed(m.users);
      if (!row) continue;
      // A learner can be in several rooms. Overwriting left whichever came last,
      // so JSS1 turned into "Riverside High · Class A" for no reason the teacher
      // could see. Keep them all; className stays as the first for callers that
      // only render one.
      const name = roomName.get(m.classroom_id) ?? null;
      if (name && !row.classes.some((c) => c.id === m.classroom_id)) {
        row.classes.push({ id: m.classroom_id, name });
      }
      row.className   = row.className   ?? name;
      row.classroomId = row.classroomId ?? m.classroom_id;
      row.joinedAt    = row.joinedAt    ?? m.joined_at;
    }

    for (const e of enrollments) {
      const row = seed(e.users);
      if (!row) continue;
      row.enrollmentId = row.enrollmentId ?? e.id;
      row.progress     = Math.max(row.progress, e.progress ?? 0);
      row.joinedAt     = row.joinedAt ?? e.enrolled_at;
      if (e.courses?.title) row.courses.push({ id: e.course_id, title: e.courses.title });
      row.course   = row.course   ?? e.courses?.title ?? null;
      row.courseId = row.courseId ?? e.course_id;
      row.coursesEnrolled = row.courses.length;
      if (e.status && e.status !== "active") row.status = e.status;
    }

    let rows = [...byUser.values()];

    // Filtering by course means "enrolled on it", so class-only learners drop
    // out — which is what the caller asked for.
    if (courseId)    rows = rows.filter((r) => r.courses.some((c) => c.id === courseId));
    if (classroomId) rows = rows.filter((r) => r.classes.some((c) => c.id === classroomId));
    if (status)   rows = rows.filter((r) => r.status === status);

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((r) =>
        (r.fullName ?? "").toLowerCase().includes(s) || (r.email ?? "").toLowerCase().includes(s));
    }

    rows.sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));
    ok(res, rows);
  } catch (e) {
    err500(res, e);
  }
});

/**
 * addStudent — put a learner in a CLASS, and enrol them on a course only if one
 * was chosen.
 *
 * It used to be the other way round, and got the class wrong twice over:
 *   • courseId was required, so a school teacher who just wanted a learner in
 *     JSS1 had to invent a course to hang them off.
 *   • the classroom was never chosen, it was GUESSED — the teacher's oldest
 *     classroom by created_at. A teacher of both JSS1 and JSS3 put everyone in
 *     whichever room existed first. And school classrooms carry the school's own
 *     teacher_id, so for most school staff the lookup matched nothing at all and
 *     the learner was silently added to no class whatsoever. That is the
 *     reported symptom: enrolled on the course, absent from the class.
 *
 * Now the class is named explicitly and checked, the course is optional, and the
 * response says what actually happened rather than implying it.
 */
export const enrolStudent = asyncHandler(async (req, res) => {
  try {
    const {
      email, fullName, phone,
      courseId = null, classroomId = null, accessLevel = "full",
    } = req.body;

    if (!email) return err400(res, "email is required");
    if (!courseId && !classroomId)
      return err400(res, "Choose a class, a course, or both — a student has to be added to something");

    // ── Course, when one was chosen ──────────────────────────────────────
    let course = null;
    if (courseId) {
      const { data } = await courseWithTitle(courseId);
      if (!data) return err404(res, "Course not found");
      if (data.instructor_id !== req.user.id) return err403(res, "You do not own this course");
      course = data;
    }

    // ── Class, when one was chosen ───────────────────────────────────────
    // Checked, not guessed: you may add to a class you teach, or to any class in
    // a school you administer.
    let classroom = null;
    if (classroomId) {
      const { data: room } = await classroomForEnrolment(classroomId);
      if (!room) return err404(res, "Class not found");

      let allowed = room.teacher_id === req.user.id || req.user.role === "admin";
      if (!allowed && room.school_id) {
        const { data: school } = await schoolAdminForClass(req.user.id, room.school_id);
        allowed = !!school;
      }
      if (!allowed) return err403(res, "You do not teach this class");
      classroom = room;
    }

    // ── Find or create the learner ───────────────────────────────────────
    let { data: user } = await userByEmail(email);

    if (!user) {
      // users.username and users.password_hash are NOT NULL. Invited students
      // get a derived unique username and a sentinel hash (they sign in via the
      // magic/Google flow and set a password later).
      const base  = (email.split("@")[0] || "student").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 30) || "student";
      const uname = `${base}_${Math.random().toString(36).slice(2, 7)}`;
      const { data: newUser, error: createErr } = await insertUser({
        email, username: uname, password_hash: "INVITED",
        full_name: fullName ?? email.split("@")[0],
        phone: phone ?? null, role: "student",
        created_at: now(), updated_at: now(),
      });
      if (createErr) throw new Error(createErr.message);
      user = newUser;
    }

    // ── Class membership ─────────────────────────────────────────────────
    let addedToClass = false;
    if (classroom) {
      const { error: cErr } = await upsertClassroomStudent(
        { classroom_id: classroom.id, user_id: user.id, status: "active", joined_at: now() });
      if (cErr) throw new Error(cErr.message);
      addedToClass = true;
    }

    // ── Enrolment, only when a course was chosen ─────────────────────────
    let enrollment = null;
    let alreadyEnrolled = false;
    if (course) {
      const { data: existing } = await enrollmentForUser(user.id, course.id);

      if (existing?.status === "active") {
        // No longer fatal: the class part may still have been the point of the
        // request, so report it rather than throwing the whole thing away.
        alreadyEnrolled = true;
      } else if (existing) {
        const { data: reactivated, error: reErr } = await reactivateEnrollment(existing.id, { status: "active", enrolled_at: now() });
        if (reErr) throw new Error(reErr.message);
        enrollment = reactivated;
      } else {
        const { data: fresh, error: enrolErr } = await insertEnrollment({
          user_id: user.id, course_id: course.id, status: "active", progress: 0, enrolled_at: now(),
        });
        if (enrolErr) throw new Error(enrolErr.message);
        enrollment = fresh;
      }

      if (enrollment) {
        notify(req.user.id, {
          type: "student_enrolled",
          title: `${user.full_name || user.email} enrolled`,
          content: `Enrolled in "${course.title}"`,
          relatedId: course.id,
        });
        notify(user.id, {
          type: "enrolled_in_course",
          title: `You're enrolled in "${course.title}"`,
          content: "You've been added to this course",
          relatedId: course.id,
        });
      }
    }

    if (classroom && !course) {
      notify(user.id, {
        type: "added_to_class",
        title: `You've been added to ${classroom.name}`,
        content: "Your teacher added you to this class.",
        relatedId: classroom.id,
      });
    }

    if (alreadyEnrolled && !addedToClass)
      return err400(res, "Student is already enrolled in this course");

    created(res, {
      user, enrollment,
      classroomId:   classroom?.id ?? null,
      className:     classroom?.name ?? null,
      addedToClass,
      enrolled:      !!enrollment,
      alreadyEnrolled,
    });
  } catch (e) {
    err500(res, e);
  }
});

export const removeStudent = asyncHandler(async (req, res) => {
  try {
    const { enrollmentId } = req.params;

    // Get enrollment and verify teacher owns the course
    const { data: enrollment } = await enrollmentById(enrollmentId);

    if (!enrollment) return err404(res, "Enrollment not found");

    const { data: course } = await courseOwnerSingle(enrollment.course_id);

    if (!course || course.instructor_id !== req.user.id)
      return err403(res, "You do not own this enrollment's course");

    const { error } = await deleteEnrollment(enrollmentId);
    if (error) throw new Error(error.message);

    notify(req.user.id, { type: "student_removed", title: "Student removed", content: "A student was removed from a course" });
    ok(res, { message: "Enrollment removed" });
  } catch (e) {
    err500(res, e);
  }
});
