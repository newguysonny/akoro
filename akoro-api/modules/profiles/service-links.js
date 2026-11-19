/**
 * Ownership links: onboarding directories and prefill, teacher↔school and
 * learner↔teacher requests, and both sides' join-request queues.
 */
import { notifyUser } from "../notify.js";
import { res200, res201, res400, res403, res404 } from "./http.js";
import { pickPrefillRoom, readLevel, safeSearchTerm } from "./rules.js";
import { ensureDefaultClassroom, ensureSisRecord, getTeacherApprovedSchoolId } from "./service-roster.js";
import * as schoolStore from "./store-schools.js";
import * as teaching from "./store-teaching.js";
import * as users from "./store-users.js";

/* ── Directories (for onboarding pickers) ─────────────────────────────── */

// GET /api/profiles/directory/schools — active schools a teacher can join.
export async function listDirectorySchools(_req, res) {
  const { data } = await schoolStore.listActiveSchoolsDirectory();
  res200(res, data || []);
}

/**
 * GET /api/profiles/onboarding-prefill
 *
 * What we already know about a learner their teacher added.
 *
 * A teacher who puts a learner in JSS1 has already told us their school, their
 * year, their study level, the subjects they take and who teaches them. Asking
 * the learner to type all of it again is asking them to guess at answers the
 * system holds — and to get them subtly wrong ("JSS1" vs "JSS 1"), which then
 * fails to match anything.
 *
 * So this returns the derived values for the form to fill in. It does NOT skip
 * onboarding: the learner still sees every field, still names their agent, and
 * can change anything. `source` says where each value came from so the UI can
 * tell them, rather than silently pre-filling and hoping they notice.
 *
 * Empty object when they aren't in a class — a self-signing-up learner is
 * unchanged.
 */
export async function getOnboardingPrefill(req, res) {
  const { data: rows } = await teaching.listLearnerClassrooms(req.user.id);

  const rooms = (rows ?? []).map((r) => r.classrooms).filter(Boolean);
  if (!rooms.length) return res200(res, {});

  const room = pickPrefillRoom(rooms);

  const raw = String(room.name || "").trim();
  const { studyLevel = null, yearGroup = null } = readLevel(raw) ?? {};

  const [{ data: school }, { data: teacher }] = await Promise.all([
    room.school_id
      ? schoolStore.getSchoolForPrefill(room.school_id)
      : Promise.resolve({ data: null }),
    room.teacher_id
      ? users.getUserIdentityMaybe(room.teacher_id)
      : Promise.resolve({ data: null }),
  ]);

  // Subjects come from the academic structure, which lines up with the room by
  // school and name — there is no foreign key between them.
  let subjects = [];
  if (room.school_id) {
    const { data: cls } = await schoolStore.listMgmtClassesByName(room.school_id, raw);
    if (cls?.length) {
      const { data: cs } = await schoolStore.listMgmtClassSubjects(cls[0].id);
      subjects = [...new Set((cs ?? []).map((r) => r.subjects?.name).filter(Boolean))];
    }
  }

  res200(res, {
    className:  raw,
    yearGroup, studyLevel,
    schoolName: school?.name ?? null,
    teacherId:  teacher?.id ?? null,
    teacherName: teacher?.full_name ?? null,
    subjects,
    source: school?.name
      ? `your school, ${school.name}`
      : teacher?.full_name ? `your teacher, ${teacher.full_name}` : "your class",
  });
}

/* GET /api/profiles/directory/teachers — instructors a learner can join.
 *
 * Onboarding renders these as browsable profile cards (search + grid), so the
 * payload now carries what a card shows: avatar, guide emoji, subjects,
 * approved school, the default class a learner would join, and how many
 * students/classes the teacher actually has — a learner can compare before
 * committing a request. Optional ?search= does a server-side pre-filter on
 * name/username; the client still narrows locally across school and subjects.
 */
export async function listDirectoryTeachers(req, res) {
  const { data: teachers } = await users.listInstructorDirectory(safeSearchTerm(req.query.search));
  const ids = (teachers || []).map((t) => t.id);

  let schoolByTeacher = {};
  if (ids.length) {
    const { data: links } = await schoolStore.listApprovedSchoolLinks(ids);
    schoolByTeacher = Object.fromEntries((links || []).map((l) => [l.teacher_id, l.school_profiles?.name || null]));
  }

  // Student + class counts in two flat queries (no per-teacher round trips):
  // the teacher's classrooms, then the active roll of those classrooms. A
  // learner sitting in two rooms of the same teacher is counted once.
  // Oldest-first so the first name per teacher is the DEFAULT class — the one
  // /me/teacher-request joins (mirrors ensureDefaultClassroom).
  const statsByTeacher = {};
  const classByTeacher = {};
  if (ids.length) {
    const { data: rooms } = await schoolStore.listDirectoryTeacherClassrooms(ids);
    const roomIds = (rooms || []).map((r) => r.id);
    (rooms || []).forEach((r) => {
      (statsByTeacher[r.teacher_id] ??= { students: new Set(), classes: 0 }).classes += 1;
      if (!classByTeacher[r.teacher_id]) classByTeacher[r.teacher_id] = r.name;
    });
    if (roomIds.length) {
      const { data: rolls } = await schoolStore.listDirectoryClassroomRolls(roomIds);
      const teacherOfRoom = Object.fromEntries((rooms || []).map((r) => [r.id, r.teacher_id]));
      (rolls || []).forEach(({ classroom_id, user_id }) => {
        const tid = teacherOfRoom[classroom_id];
        if (tid) statsByTeacher[tid].students.add(user_id);
      });
    }
  }

  res200(res, (teachers || []).map((t) => ({
    id:             t.id,
    full_name:      t.full_name,
    username:       t.username,
    avatar_url:     t.avatar_url || null,
    guide_emoji:    t.guide_emoji || null,
    subjects:       Array.isArray(t.subjects) ? t.subjects : [],
    school_name:    schoolByTeacher[t.id] || null,
    class_name:     classByTeacher[t.id] || null,
    student_count:  statsByTeacher[t.id]?.students.size || 0,
    classroom_count: statsByTeacher[t.id]?.classes || 0,
  })));
}

/* ── Teacher → school request + link status ───────────────────────────── */

// GET /api/profiles/me/school-link — the caller's school link + status.
export async function getSchoolLink(req, res) {
  const { data } = await teaching.getLatestSchoolLink(req.user.id);
  res200(res, data ? { school_id: data.school_id, status: data.status, name: data.school_profiles?.name, logo_url: data.school_profiles?.logo_url } : null);
}

// POST /api/profiles/me/school-request { school_id } — request to join a school.
export async function requestSchool(req, res) {
  const { school_id } = req.body;
  const { data: school } = await schoolStore.getActiveSchool(school_id);
  if (!school) return res404(res, "School not found");
  const { data, error } = await teaching.upsertSchoolTeacherReturningStatus({
    school_id, teacher_id: req.user.id, status: "pending", requested_at: new Date(),
  });
  if (error) throw new Error(error.message);
  res201(res, { status: data.status, message: "Request sent — awaiting school approval." });
}

/* ── School admin: teacher join requests ──────────────────────────────── */

export const ownsSchool = async (req, schoolId) => {
  const { data } = await schoolStore.getOwnedSchool(schoolId, req.user.id);
  return !!data;
};

// GET /api/profiles/schools/:schoolId/teacher-requests?status=pending
export async function listSchoolTeacherRequests(req, res) {
  if (!(await ownsSchool(req, req.params.schoolId))) return res403(res, "Not your school");
  const status = req.query.status || "pending";
  const { data } = await teaching.listSchoolTeacherRequests(req.params.schoolId, status);
  res200(res, (data || []).map((r) => ({ id: r.id, teacher_id: r.teacher_id, status: r.status, requested_at: r.requested_at, full_name: r.users?.full_name, email: r.users?.email, avatar_url: r.users?.avatar_url })));
}

// POST /api/profiles/schools/:schoolId/teacher-requests/:teacherId  { decision }
export async function decideSchoolTeacherRequest(req, res) {
  const { schoolId, teacherId } = req.params;
  if (!(await ownsSchool(req, schoolId))) return res403(res, "Not your school");
  const status = req.body.decision === "approve" ? "approved" : "rejected";
  const { error } = await teaching.updateSchoolTeacher(schoolId, teacherId, { status, decided_at: new Date(), decided_by: req.user.id });
  if (error) throw new Error(error.message);
  // On approval, carry the school onto the teacher's classrooms so their
  // students become school-owned going forward.
  if (status === "approved") await teaching.updateTeacherClassroomsSchool(teacherId, schoolId);

  const { data: sch } = await schoolStore.getSchoolName(schoolId);
  const { data: t } = await users.getUserFullNameEmailMaybe(teacherId);
  const approvedT = status === "approved";
  notifyUser({
    userId: teacherId, type: "school_membership",
    title: approvedT ? `You've joined ${sch?.name || "the school"}` : `Request to join ${sch?.name || "the school"} declined`,
    content: approvedT ? `${sch?.name || "The school"} approved your request.` : `${sch?.name || "The school"} declined your request.`,
    email: t?.email ? { to: t.email, name: t.full_name, subject: approvedT ? `Approved: you've joined ${sch?.name}` : `Update on your school request`, heading: approvedT ? "Request approved 🎉" : "Request update", body: approvedT ? `<strong>${sch?.name}</strong> approved your request to join.` : `<strong>${sch?.name}</strong> declined your request to join.`, ctaUrl: process.env.INSTRUCTOR_FRONTEND_URL || undefined, ctaLabel: "Open dashboard →" } : null,
  });
  res200(res, { status });
}

/* ── Learner → teacher request + link status ──────────────────────────── */

// GET /api/profiles/me/teacher-link — the learner's teacher membership.
export async function getTeacherLink(req, res) {
  const { data } = await teaching.getTeacherLink(req.user.id);
  res200(res, data ? { status: data.status, teacher_id: data.classrooms?.teacher_id, teacher_name: data.classrooms?.users?.full_name, classroom_name: data.classrooms?.name } : null);
}

// POST /api/profiles/me/teacher-request { teacher_id } — request to join a teacher.
export async function requestTeacher(req, res) {
  const { teacher_id } = req.body;
  const { data: teacher } = await users.findInstructorForRequest(teacher_id);
  if (!teacher) return res404(res, "Teacher not found");
  const classroomId = await ensureDefaultClassroom(teacher_id);
  const { data: existing } = await teaching.findClassroomStudentStatus(classroomId, req.user.id);
  if (existing) {
    if (existing.status === "removed") {
      await teaching.updateClassroomStudent(existing.id, { status: "pending", requested_at: new Date() });
      // Live badge: the teacher's nav count updates without polling.
      global.io?.to(`user:${teacher_id}`).emit("join-requests-changed", { classroomId });
    }
    return res200(res, { status: existing.status === "removed" ? "pending" : existing.status, message: "Request updated." });
  }
  const { error } = await teaching.insertClassroomStudent({ classroom_id: classroomId, user_id: req.user.id, status: "pending", requested_at: new Date() });
  if (error) throw new Error(error.message);
  global.io?.to(`user:${teacher_id}`).emit("join-requests-changed", { classroomId });
  res201(res, { status: "pending", message: "Request sent — awaiting teacher approval." });
}

/* ── Teacher: student join requests ───────────────────────────────────── */

// GET /api/profiles/teacher/join-requests — pending learners across my classes.
export async function listTeacherJoinRequests(req, res) {
  const { data: classes } = await teaching.listTeacherClassroomsIdName(req.user.id);
  const ids = (classes || []).map((c) => c.id);
  if (!ids.length) return res200(res, []);
  const nameById = Object.fromEntries((classes || []).map((c) => [c.id, c.name]));
  const { data } = await teaching.listPendingJoinRequests(ids);
  res200(res, (data || []).map((r) => ({ id: r.id, classroom_id: r.classroom_id, classroom_name: nameById[r.classroom_id], user_id: r.user_id, requested_at: r.requested_at, full_name: r.users?.full_name, email: r.users?.email, avatar_url: r.users?.avatar_url })));
}

// POST /api/profiles/teacher/join-requests/:id { decision } — approve/reject.
export async function decideTeacherJoinRequest(req, res) {
  // Load the request and verify the classroom is mine.
  const { data: reqRow } = await teaching.getJoinRequest(req.params.id);
  if (!reqRow) return res404(res, "Request not found");
  if (reqRow.classrooms?.teacher_id !== req.user.id) return res403(res, "Not your classroom");

  const { data: me } = await users.getUserFullNameMaybe(req.user.id);
  const { data: student } = await users.getStudentContactMaybe(reqRow.user_id);
  const teacherName = me?.full_name || "Your teacher";

  global.io?.to(`user:${req.user.id}`).emit("join-requests-changed", { classroomId: reqRow.classroom_id });
  if (req.body.decision === "reject") {
    await teaching.updateClassroomStudent(reqRow.id, { status: "removed" });
    notifyUser({
      userId: reqRow.user_id, type: "class_membership",
      title: `Request to join ${teacherName}'s class declined`,
      content: `${teacherName} declined your request to join their class.`,
      email: student?.email ? { to: student.email, name: student.full_name, subject: "Update on your class request", heading: "Request update", body: `${teacherName} declined your request to join their class. You can choose another teacher anytime.`, ctaUrl: process.env.FRONTEND_URL || undefined, ctaLabel: "Open Akoro →" } : null,
    });
    return res200(res, { status: "removed" });
  }
  await teaching.updateClassroomStudent(reqRow.id, { status: "active" });
  // Mirror into the school roster if the teacher has a school.
  const schoolId = reqRow.classrooms?.school_id || (await getTeacherApprovedSchoolId(req.user.id));
  if (schoolId) {
    await ensureSisRecord(schoolId, student, req.user.id).catch((e) => console.warn("[profiles] SIS mirror failed:", e.message));
  }
  notifyUser({
    userId: reqRow.user_id, type: "class_membership",
    title: `You've joined ${teacherName}'s class`,
    content: `${teacherName} approved your request to join their class.`,
    email: student?.email ? { to: student.email, name: student.full_name, subject: `Approved: you've joined ${teacherName}'s class`, heading: "You're in 🎉", body: `${teacherName} approved your request. You can now learn together in Akoro.`, ctaUrl: process.env.FRONTEND_URL || undefined, ctaLabel: "Start learning →" } : null,
  });
  res200(res, { status: "active" });
}
