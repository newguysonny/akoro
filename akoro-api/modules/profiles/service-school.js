/**
 * School orchestration: school profiles, classrooms, teacher accounts, student
 * adds and the admin listings.
 */
import bcrypt from "bcrypt";
import crypto from "crypto";

import { invalidateCachedUser } from "../auth/index.js";
import { res200, res201, res400, res403, res404 } from "./http.js";
import { DEFAULT_OFF_MODULES, slugBaseFromName, usernameFromEmail } from "./rules.js";
import { findOrCreateStudent, sendWelcomeCredentials } from "./service-roster.js";
import * as schoolStore from "./store-schools.js";
import * as teaching from "./store-teaching.js";
import * as users from "./store-users.js";

/**
 * POST /api/profiles/schools
 * Create a school profile.
 */
export async function create(req, res) {
  const { name, description, logo_url, website, address, phone, country, state, lga, city,
          educationLevels, ownershipType, curriculum, yearEstablished, genderType, boardingType, studentBand } = req.body;

  // Unique URL slug (used by /site/:slug previews and <slug>.akoro.app).
  const slugBase = slugBaseFromName(name);
  let slug = `${slugBase}-${crypto.randomBytes(3).toString("hex")}`;
  for (let i = 0; i < 5; i++) {
    const { data: clash } = await schoolStore.slugExists(slug);
    if (!clash) break;
    slug = `${slugBase}-${crypto.randomBytes(3).toString("hex")}`;
  }

  const { data, error } = await schoolStore.insertSchoolProfile({
    admin_user_id: req.user.id,
    name,
    slug,
    description:   description ?? null,
    logo_url:      logo_url    ?? null,
    website:       website     ?? null,
    address:       address     ?? null,
    phone:         phone       ?? null,
    country:       country     ?? null,
    state:         state       ?? null,
    lga:           lga         ?? null,
    city:          city        ?? null,
    education_levels: Array.isArray(educationLevels) ? educationLevels : [],
    ownership_type:   ownershipType ?? null,
    curriculum:       curriculum    ?? null,
    year_established: yearEstablished || null,
    gender_type:      genderType   ?? null,
    boarding_type:    boardingType ?? null,
    student_band:     studentBand  ?? null,
    is_active:     true,
    verification_status: "pending",   // awaits akoro admin approval
  });

  if (error) throw new Error(error.message);

  // New schools start with ONLY the essential system areas enabled; every
  // optional Management/Facilities module is off until the school turns it
  // on in Settings → Module Settings. Keys must match the sidebar moduleKeys
  // and the frontend TOGGLE_MODULES list.
  const disabledModules = Object.fromEntries(DEFAULT_OFF_MODULES.map((k) => [k, false]));
  const { error: modErr } = await schoolStore.upsertSchoolPortalSettings(data.id, disabledModules);
  if (modErr) console.warn("[new school] could not seed default modules:", modErr.message);

  // Update user role to school_admin
  await users.updateUserById(req.user.id, { role: "school_admin" });
  invalidateCachedUser(req.user.id);   // security field — never serve it stale

  res201(res, data);
}

/**
 * GET /api/profiles/schools/:schoolId
 */
export async function get(req, res) {
  const { data, error } = await schoolStore.getOwnedSchoolProfile(req.params.schoolId, req.user.id);

  if (error || !data) return res404(res, "School not found");

  const totalStudents = (data.classrooms ?? [])
    .reduce((s, c) => s + (c.classroom_students?.length ?? 0), 0);

  res200(res, {
    ...data,
    total_classrooms: data.classrooms?.length ?? 0,
    total_students:   totalStudents,
  });
}

/**
 * POST /api/profiles/schools/:schoolId/classrooms
 * School creates a classroom.
 */
export async function createClassroom(req, res) {
  const { schoolId }              = req.params;
  const { name, description, teacher_id } = req.body;

  const { data: school } = await schoolStore.getSchoolOwner(schoolId);
  if (!school || school.admin_user_id !== req.user.id) return res403(res, "Not authorised");

  const { data, error } = await teaching.insertClassroom({
    school_id:     schoolId,
    teacher_id:    teacher_id ?? req.user.id,
    name,
    description:   description ?? null,
    student_limit: 9999,     // schools get unlimited students
    is_upgraded:   true,
  });

  if (error) throw new Error(error.message);
  res201(res, data);
}

/**
 * POST /api/profiles/schools/:schoolId/teachers
 * School creates a teacher account and optionally links to a classroom.
 * Auto-creates the user account and sends credentials.
 */
export async function createTeacher(req, res) {
  const { schoolId }                             = req.params;
  const { name, email, phone, classroom_id }     = req.body;

  if (!name)            return res400(res, "Teacher name is required");
  if (!email && !phone) return res400(res, "Email or phone is required");

  const { data: school } = await schoolStore.getSchoolOwnerWithName(schoolId);
  if (!school || school.admin_user_id !== req.user.id) return res403(res, "Not authorised");

  // Create teacher account
  const tempPassword   = crypto.randomBytes(8).toString("base64").slice(0, 10);
  const passwordHash   = await bcrypt.hash(tempPassword, 10);
  const safeEmail      = email?.toLowerCase().trim() ?? null;
  const usernameBase   = usernameFromEmail(safeEmail, `teacher${Date.now()}`);

  const { data: existingUser } = await users.findUserIdByEmail(safeEmail);

  let teacherUser;
  let isNew = false;

  if (existingUser) {
    // Upgrade existing user to instructor role
    await users.updateUserById(existingUser.id, { role: "instructor" });
    invalidateCachedUser(existingUser.id);   // security field — never serve it stale
    const { data: u } = await users.getUserIdentity(existingUser.id);
    teacherUser = u;
  } else {
    const { data: u, error } = await users.insertTeacherUser({
      email:                safeEmail,
      username:             `${usernameBase}_${Math.floor(Math.random() * 9000) + 1000}`,
      password_hash:        passwordHash,
      full_name:            name,
      phone:                phone ?? null,
      role:                 "instructor",
      is_active:            true,
      must_change_password: true,
    });
    if (error) throw new Error(error.message);
    teacherUser = u;
    isNew       = true;
  }

  // Link teacher to school — admin-added teachers are approved immediately.
  await teaching.upsertSchoolTeacher({
    school_id:  schoolId,
    teacher_id: teacherUser.id,
    status:     "approved",
    decided_at: new Date(),
    decided_by: req.user.id,
  });

  // Link to classroom if provided
  if (classroom_id) {
    await teaching.updateClassroomInSchool(classroom_id, schoolId, { teacher_id: teacherUser.id });
  }

  // Send welcome email
  if (isNew && safeEmail) {
    try {
      const nodemailer = await import("nodemailer");
      const transport  = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT ?? "587"),
        secure: process.env.SMTP_PORT === "465",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transport.sendMail({
        from:    `"Akoro Learning" <${process.env.SMTP_FROM_EMAIL ?? "noreply@akoro.io"}>`,
        to:      safeEmail,
        subject: `Welcome to Akoro — Teacher account created 🎓`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <h2>Welcome to Akoro, ${name}!</h2>
            <p>A teacher account has been created for you by <strong>${school.name}</strong>.</p>
            <div style="background:#FAF8F5;border-radius:10px;padding:16px 20px;margin:16px 0">
              <p style="margin:4px 0"><strong>Email:</strong> ${safeEmail}</p>
              <p style="margin:4px 0"><strong>Temporary password:</strong> <code style="background:#EDE8E1;padding:2px 8px;border-radius:4px">${tempPassword}</code></p>
            </div>
            <p>Please log in and set a new password.</p>
            <a href="${process.env.APP_URL ?? "https://app.akoro.io"}/login" style="display:inline-block;padding:12px 24px;background:#E8884A;color:#fff;border-radius:100px;text-decoration:none;font-weight:700">
              Log in to Akoro →
            </a>
          </div>
        `,
      });
    } catch (e) {
      console.warn("[profiles] Teacher welcome email failed:", e.message);
    }
  }

  res201(res, {
    teacher:         { id: teacherUser.id, full_name: teacherUser.full_name, email: teacherUser.email },
    account_created: isNew,
    linked_classroom: classroom_id ?? null,
    message:          isNew ? "Teacher account created and credentials sent" : "Existing user upgraded to teacher",
  });
}

/**
 * POST /api/profiles/schools/:schoolId/classrooms/:classroomId/students
 * School adds a student to a classroom.
 * Auto-creates account + sends credentials. Unlimited students.
 */
export async function addStudent(req, res) {
  const { schoolId, classroomId }  = req.params;
  const { name, email, phone }     = req.body;

  if (!name)              return res400(res, "Student name is required");
  if (!email && !phone)   return res400(res, "Email or phone is required");

  const { data: school }    = await schoolStore.getSchoolOwnerWithName(schoolId);
  const { data: classroom } = await teaching.getClassroomNameSchool(classroomId);

  if (!school || school.admin_user_id !== req.user.id) return res403(res, "Not authorised");
  if (!classroom || classroom.school_id !== schoolId)  return res404(res, "Classroom not found in this school");

  // Find or create student
  const { user, isNew, tempPassword } = await findOrCreateStudent(name, email, phone);

  // Check not already in classroom
  const { data: alreadyIn } = await teaching.findClassroomStudent(classroomId, user.id);

  if (alreadyIn) return res400(res, "Student already in this classroom");

  await teaching.insertClassroomStudent({ classroom_id: classroomId, user_id: user.id, status: "active" });

  await sendWelcomeCredentials({
    user, tempPassword,
    classroomName: classroom.name,
    teacherName:   school.name,
    isNew,
  });

  res201(res, {
    student:         { id: user.id, full_name: user.full_name, email: user.email },
    account_created: isNew,
    message:         isNew ? "Student account created and credentials sent" : "Student added to classroom",
  });
}

/**
 * GET /api/profiles/schools/:schoolId/classrooms
 */
export async function listClassrooms(req, res) {
  // Owner-scoped: only the school's admin can list its classrooms.
  const { data: sch } = await schoolStore.getOwnedSchool(req.params.schoolId, req.user.id);
  if (!sch) return res404(res, "School not found");
  const { data, error } = await schoolStore.listSchoolClassrooms(req.params.schoolId);

  if (error) throw new Error(error.message);

  res200(res, (data ?? []).map((c) => ({
    ...c,
    student_count:      c.classroom_students?.length ?? 0,
    classroom_students: undefined,
  })), { total: data?.length ?? 0 });
}

// GET /api/profiles/admin/schools
export async function listSchools(_req, res) {
  const { data, error } = await schoolStore.listAdminSchools();
  if (error) throw new Error(error.message);
  res200(res, data ?? [], { total: data?.length ?? 0 });
}

// GET /api/profiles/admin/teachers
export async function listTeachers(_req, res) {
  const { data, error } = await users.listInstructorUsers();
  if (error) throw new Error(error.message);
  res200(res, data ?? [], { total: data?.length ?? 0 });
}
