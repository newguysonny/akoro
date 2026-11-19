/**
 * Teacher roster orchestration: the teacher's classrooms, students, the free
 * limits and the paid upgrade.
 */
import { res200, res201, res400, res403, res404 } from "./http.js";
import { FREE_STUDENT_LIMIT, UPGRADE_PRICE_NGN } from "./rules.js";
import {
  ensureSisRecord, findOrCreateStudent, getTeacherApprovedSchoolId, sendWelcomeCredentials,
} from "./service-roster.js";
import * as teaching from "./store-teaching.js";
import * as users from "./store-users.js";

/**
 * GET /api/profiles/teacher/me
 * Teacher's own profile + classroom summary.
 */
export async function getProfile(req, res) {
  const { data: classrooms } = await teaching.listTeacherClassroomsWithCounts(req.user.id);

  const total_students = (classrooms ?? []).reduce((s, c) => s + (c.classroom_students?.[0]?.count ?? 0), 0);

  res200(res, {
    teacher_id:      req.user.id,
    full_name:       req.user.fullName,
    classrooms:      classrooms ?? [],
    total_classrooms: classrooms?.length ?? 0,
    total_students,
    free_limit:      FREE_STUDENT_LIMIT,
    upgrade_price_ngn: UPGRADE_PRICE_NGN,
  });
}

/**
 * GET /api/profiles/teacher/classrooms
 * List teacher's classrooms.
 */
export async function listClassrooms(req, res) {
  const { data, error } = await teaching.listTeacherClassrooms(req.user.id);

  if (error) throw new Error(error.message);

  const enriched = (data ?? []).map((c) => ({
    ...c,
    student_count: c.classroom_students?.length ?? 0,
    is_full:       (c.classroom_students?.length ?? 0) >= c.student_limit,
    classroom_students: undefined,
  }));

  res200(res, enriched, { total: enriched.length });
}

/**
 * POST /api/profiles/teacher/classrooms
 * Create a new classroom. First classroom is free; additional ones require upgrade.
 */
export async function createClassroom(req, res) {
  const { name, description } = req.body;

  const { data: existing } = await teaching.listTeacherClassroomFlags(req.user.id);

  // Teachers on free plan get 1 classroom. Upgraded teachers get unlimited.
  const isUpgraded  = (existing ?? []).some((c) => c.is_upgraded);
  if ((existing?.length ?? 0) >= 1 && !isUpgraded)
    return res400(res, `Free plan includes 1 classroom. Upgrade for ₦${UPGRADE_PRICE_NGN} to create more.`);

  const { data, error } = await teaching.insertClassroom({
    teacher_id:    req.user.id,
    name,
    description:   description ?? null,
    student_limit: FREE_STUDENT_LIMIT,
    is_upgraded:   false,
  });

  if (error) throw new Error(error.message);
  res201(res, data);
}

/**
 * GET /api/profiles/teacher/classrooms/:classroomId/students
 * List students in a classroom.
 */
export async function listStudents(req, res) {
  const { classroomId } = req.params;

  const { data: classroom } = await teaching.getClassroomTeacherName(classroomId);
  if (!classroom) return res404(res, "Classroom not found");
  if (classroom.teacher_id !== req.user.id) return res403(res, "Not your classroom");

  const { data, error } = await teaching.listClassroomStudents(classroomId);

  if (error) throw new Error(error.message);
  res200(res, data ?? [], { total: data?.length ?? 0 });
}

/**
 * POST /api/profiles/teacher/classrooms/:classroomId/students
 * Add a student to a classroom.
 * Auto-creates their platform account if they don't have one.
 * Checks the 20-student free limit.
 */
export async function addStudent(req, res) {
  const { classroomId }          = req.params;
  const { name, email, phone }   = req.body;

  if (!name)              return res400(res, "Student name is required");
  if (!email && !phone)   return res400(res, "Email or phone number is required");

  // Verify ownership
  const { data: classroom } = await teaching.getClassroomForTeacher(classroomId);

  if (!classroom)                         return res404(res, "Classroom not found");
  if (classroom.teacher_id !== req.user.id) return res403(res, "Not your classroom");

  // Count current students
  const { count } = await teaching.countClassroomStudents(classroomId);

  // Enforce free limit
  if ((count ?? 0) >= FREE_STUDENT_LIMIT && !classroom.is_upgraded) {
    return res400(res, `Free plan allows up to ${FREE_STUDENT_LIMIT} students per classroom. Upgrade for ₦${UPGRADE_PRICE_NGN} to add more.`);
  }

  // Find or create student account
  const { data: teacher } = await users.getUserFullName(req.user.id);
  const { user, isNew, tempPassword } = await findOrCreateStudent(name, email, phone);

  // Check not already in classroom
  const { data: alreadyIn } = await teaching.findClassroomStudent(classroomId, user.id);

  if (alreadyIn) return res400(res, "Student is already in this classroom");

  // Add to classroom
  await teaching.insertClassroomStudent({
    classroom_id: classroomId,
    user_id:      user.id,
    status:       "active",
  });

  // Ownership: if the teacher belongs to a school, mirror the student into
  // the school's SIS roster (mgmt.students) so schools own them too.
  const teacherSchoolId = await getTeacherApprovedSchoolId(req.user.id);
  if (teacherSchoolId) {
    if (!classroom.school_id) await teaching.updateClassroom(classroomId, { school_id: teacherSchoolId });
    await ensureSisRecord(teacherSchoolId, user, req.user.id).catch((e) => console.warn("[profiles] SIS mirror failed:", e.message));
  }

  // Send welcome credentials if new account
  await sendWelcomeCredentials({
    user, tempPassword,
    classroomName: classroom.name,
    teacherName:   teacher?.full_name ?? "Your teacher",
    isNew,
  });

  const { count: newCount } = await teaching.countClassroomStudents(classroomId);

  res201(res, {
    student:          { id: user.id, full_name: user.full_name, email: user.email },
    account_created:  isNew,
    message:          isNew ? "Account created and welcome email sent" : "Student added to classroom",
    classroom_count:  newCount ?? 0,
    slots_remaining:  classroom.is_upgraded ? null : Math.max(0, FREE_STUDENT_LIMIT - (newCount ?? 0)),
  });
}

/**
 * DELETE /api/profiles/teacher/classrooms/:classroomId/students/:userId
 * Remove a student from a classroom.
 */
export async function removeStudent(req, res) {
  const { classroomId, userId } = req.params;

  const { data: classroom } = await teaching.getClassroomTeacher(classroomId);
  if (!classroom || classroom.teacher_id !== req.user.id) return res403(res, "Not your classroom");

  await teaching.deleteClassroomStudent(classroomId, userId);

  res200(res, { removed: true });
}

/**
 * POST /api/profiles/teacher/classrooms/:classroomId/upgrade
 * Upgrade classroom to remove student limit.
 * In production: integrate with Paystack here.
 */
export async function upgradeClassroom(req, res) {
  const { classroomId } = req.params;

  const { data: classroom } = await teaching.getClassroomTeacherUpgrade(classroomId);
  if (!classroom || classroom.teacher_id !== req.user.id) return res403(res, "Not your classroom");
  if (classroom.is_upgraded) return res400(res, "Classroom is already upgraded");

  // TODO: Integrate Paystack payment for UPGRADE_PRICE_KOBO before setting is_upgraded
  // For now, simulate upgrade (replace with Paystack checkout in production)
  await teaching.updateClassroom(classroomId, { is_upgraded: true, student_limit: 9999 });

  res200(res, {
    upgraded:       true,
    message:        `Classroom upgraded. You can now add unlimited students.`,
    amount_paid_ngn: UPGRADE_PRICE_NGN,
  });
}
