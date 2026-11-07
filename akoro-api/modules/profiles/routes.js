/**
 * modules/profiles/routes.js  —  Akoro Profiles Module
 *
 * Three profile types on the platform:
 *
 *   Teacher profile
 *     - Gets one classroom on signup (default 20 student slots)
 *     - Adding students beyond 20 requires ₦5,000/month upgrade
 *     - Adding a student auto-creates their platform account
 *     - Teacher app users
 *
 *   School profile
 *     - Created by admin or self-registered
 *     - Can create multiple classrooms
 *     - Can create teacher accounts and link to classrooms
 *     - Unlimited students/learners
 *     - Adding a student auto-creates their platform account
 *     - School/enterprise app users
 *
 *   Admin
 *     - Platform-wide access
 *     - Can view/manage all profiles, classrooms, schools
 *
 * Auto-create flow:
 *   Teacher/school adds a student (name + email/phone) →
 *   System checks if account exists →
 *   If not: creates account with temp password →
 *   Sends welcome email/SMS with credentials →
 *   Student logs in and sets permanent password
 *
 * Usage in app.js:
 *   import profilesModule from "./modules/profiles/routes.js";
 *   app.use("/api/profiles", profilesModule);
 */

import { Router }                         from "express";
import { body, validationResult }         from "express-validator";
import bcrypt                             from "bcrypt";
import crypto                             from "crypto";
import db                                 from "../../db.js";
import { notifyUser }                      from "../notify.js";
import { authenticateToken, requireRole, endSession, invalidateCachedUser,
         signCourseInvite, verifyCourseInvite, INVITE_MAX_DAYS } from "../auth/routes.js";
import multerLib                           from "multer";
import { urlFor } from "../../lib/urls.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Optional Management/Facilities modules that new schools start with DISABLED
// (only essential system areas are on by default). Keys mirror the school
// app's sidebar moduleKeys / Module Settings TOGGLE_MODULES.
const DEFAULT_OFF_MODULES = [
  "fees_collection", "accounts_finance", "front_office", "offline_examinations",
  "cbc_academics", "online_examinations", "human_resource", "ptm",
  "lesson_planner", "digital_evaluation", "qr_attendance", "study_center",
  "communications", "library", "inventory", "transport", "hostel",
  "asset_management",
];

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res204 = (res)                  => res.status(204).send();
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const res403 = (res, msg)             => res.status(403).json({ success: false, message: msg });
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

const now = () => new Date().toISOString();

// Keep generic JSON settings from turning an arbitrary display string into a
// timezone used by notifications, tasks, or the learner agent.
const isIanaTimeZone = (value) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) return false;
  try { Intl.DateTimeFormat("en-US", { timeZone: value.trim() }); return true; }
  catch { return false; }
};

// ─── Constants ────────────────────────────────────────────────────────────────

const FREE_STUDENT_LIMIT     = 20;
const UPGRADE_PRICE_KOBO     = 500_000;   // ₦5,000
const UPGRADE_PRICE_NGN      = 5000;
const TEMP_PASSWORD_LENGTH   = 10;

// ─── Auto-create user helper ──────────────────────────────────────────────────

/**
 * findOrCreateStudent
 * Given a name + email (or phone), returns an existing user or creates a new one.
 * New accounts get a temp password and a "must_change_password" flag.
 * Returns { user, isNew, tempPassword }
 */
const findOrCreateStudent = async (name, email, phone = null) => {
  // Check existing
  let query = db.from("users").select("id, email, full_name, role");
  if (email) query = query.eq("email", email.toLowerCase().trim());
  else       query = query.eq("phone", phone);

  const { data: existing } = await query.single();
  if (existing) return { user: existing, isNew: false, tempPassword: null };

  // Generate temp password
  const tempPassword   = crypto.randomBytes(TEMP_PASSWORD_LENGTH).toString("base64").slice(0, TEMP_PASSWORD_LENGTH);
  const passwordHash   = await bcrypt.hash(tempPassword, 10);

  const safeEmail      = email?.toLowerCase().trim() ?? null;
  const username       = (safeEmail?.split("@")[0] ?? `user${Date.now()}`).replace(/[^a-zA-Z0-9_]/g, "_");

  const { data: user, error } = await db.from("users").insert({
    email:                safeEmail,
    username:             `${username}_${Math.floor(Math.random() * 9000) + 1000}`,
    password_hash:        passwordHash,
    full_name:            name,
    phone:                phone ?? null,
    role:                 "student",
    is_active:            true,
    must_change_password: true,
  }).select("id, email, full_name, username, role").single();

  if (error) throw new Error(`Failed to create student account: ${error.message}`);

  return { user, isNew: true, tempPassword };
};

/**
 * getTeacherApprovedSchoolId — the school a teacher has been approved into
 * (or null). Ownership flows from here: a teacher's students belong to it.
 */
const getTeacherApprovedSchoolId = async (teacherId) => {
  const { data } = await db.from("school_teachers")
    .select("school_id").eq("teacher_id", teacherId).eq("status", "approved")
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  return data?.school_id ?? null;
};

/**
 * ensureDefaultClassroom — a teacher's first classroom, created on demand.
 * Carries the teacher's approved school_id so classroom_students are
 * transitively school-owned.
 */
const ensureDefaultClassroom = async (teacherId) => {
  const { data: existing } = await db.from("classrooms")
    .select("id, school_id").eq("teacher_id", teacherId)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  const schoolId = await getTeacherApprovedSchoolId(teacherId);
  if (existing) {
    if (schoolId && !existing.school_id) await db.from("classrooms").update({ school_id: schoolId }).eq("id", existing.id);
    return existing.id;
  }
  const { data: created, error } = await db.from("classrooms")
    .insert({ teacher_id: teacherId, school_id: schoolId, name: "My Class" }).select("id").single();
  if (error) throw new Error(error.message);
  return created.id;
};

/**
 * ensureSisRecord — mirror a platform student into the school's SIS roster
 * (mgmt.students) so teacher-added students also appear in the school's
 * Student Information module. No-op if the teacher has no approved school or
 * the student is already rostered. `created_by` records the teacher.
 */
const ensureSisRecord = async (schoolId, user, teacherId) => {
  if (!schoolId || !user?.id) return;
  const M = db.schema("mgmt");
  const { data: exists } = await M.from("students").select("id").eq("school_id", schoolId).eq("user_id", user.id).maybeSingle();
  if (exists) return;
  const parts = (user.full_name || "").trim().split(/\s+/);
  const first = parts.shift() || (user.email?.split("@")[0] ?? "Student");
  const last = parts.join(" ") || first;
  const admission_no = `T-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
  await M.from("students").insert({
    school_id: schoolId, user_id: user.id, created_by: teacherId,
    admission_no, first_name: first, last_name: last, status: "active",
  });
};

/**
 * sendWelcomeCredentials
 * Sends the new student their login credentials via email/SMS.
 */
const sendWelcomeCredentials = async ({ user, tempPassword, classroomName, teacherName, isNew }) => {
  if (!isNew || !tempPassword) return;

  const loginUrl = `${process.env.APP_URL ?? "https://app.akoro.io"}/login`;

  try {
    if (user.email) {
      const nodemailer = await import("nodemailer");
      const transport  = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT ?? "587"),
        secure: process.env.SMTP_PORT === "465",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transport.sendMail({
        from:    `"Akoro Learning" <${process.env.SMTP_FROM_EMAIL ?? "noreply@akoro.io"}>`,
        to:      user.email,
        subject: `Welcome to Akoro — Your account is ready 🎉`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <h2>Welcome to Akoro Learning, ${user.full_name}! 🎓</h2>
            <p>You've been added to <strong>${classroomName}</strong> by <strong>${teacherName}</strong>.</p>
            <p>Your account has been created. Here are your login details:</p>
            <div style="background:#FAF8F5;border-radius:10px;padding:16px 20px;margin:16px 0">
              <p style="margin:4px 0"><strong>Email:</strong> ${user.email}</p>
              <p style="margin:4px 0"><strong>Temporary password:</strong> <code style="background:#EDE8E1;padding:2px 8px;border-radius:4px">${tempPassword}</code></p>
            </div>
            <p>Please log in and change your password immediately.</p>
            <a href="${loginUrl}" style="display:inline-block;padding:12px 24px;background:#E8884A;color:#fff;border-radius:100px;text-decoration:none;font-weight:700">
              Log in to Akoro →
            </a>
            <p style="color:#999;font-size:12px;margin-top:24px">
              If you weren't expecting this, please ignore this email.
            </p>
          </div>
        `,
      });
    }
  } catch (e) {
    console.warn("[profiles] Welcome email failed:", e.message);
  }
};

// ─── Teacher handlers ─────────────────────────────────────────────────────────

const teacherHandlers = {

  /**
   * GET /api/profiles/teacher/me
   * Teacher's own profile + classroom summary.
   */
  getProfile: asyncHandler(async (req, res) => {
    const { data: classrooms } = await db
      .from("classrooms")
      .select(`
        id, name, description, student_limit, is_upgraded, created_at,
        classroom_students ( count )
      `)
      .eq("teacher_id", req.user.id);

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
  }),

  /**
   * GET /api/profiles/teacher/classrooms
   * List teacher's classrooms.
   */
  listClassrooms: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("classrooms")
      .select(`
        id, name, description, student_limit, is_upgraded, created_at,
        classroom_students ( id )
      `)
      .eq("teacher_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const enriched = (data ?? []).map((c) => ({
      ...c,
      student_count: c.classroom_students?.length ?? 0,
      is_full:       (c.classroom_students?.length ?? 0) >= c.student_limit,
      classroom_students: undefined,
    }));

    res200(res, enriched, { total: enriched.length });
  }),

  /**
   * POST /api/profiles/teacher/classrooms
   * Create a new classroom. First classroom is free; additional ones require upgrade.
   */
  createClassroom: asyncHandler(async (req, res) => {
    const { name, description } = req.body;

    const { data: existing } = await db
      .from("classrooms")
      .select("id, is_upgraded")
      .eq("teacher_id", req.user.id);

    // Teachers on free plan get 1 classroom. Upgraded teachers get unlimited.
    const isUpgraded  = (existing ?? []).some((c) => c.is_upgraded);
    if ((existing?.length ?? 0) >= 1 && !isUpgraded)
      return res400(res, `Free plan includes 1 classroom. Upgrade for ₦${UPGRADE_PRICE_NGN} to create more.`);

    const { data, error } = await db
      .from("classrooms")
      .insert({
        teacher_id:    req.user.id,
        name,
        description:   description ?? null,
        student_limit: FREE_STUDENT_LIMIT,
        is_upgraded:   false,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    res201(res, data);
  }),

  /**
   * GET /api/profiles/teacher/classrooms/:classroomId/students
   * List students in a classroom.
   */
  listStudents: asyncHandler(async (req, res) => {
    const { classroomId } = req.params;

    const { data: classroom } = await db
      .from("classrooms").select("teacher_id, name").eq("id", classroomId).single();
    if (!classroom) return res404(res, "Classroom not found");
    if (classroom.teacher_id !== req.user.id) return res403(res, "Not your classroom");

    const { data, error } = await db
      .from("classroom_students")
      .select(`
        id, joined_at, status,
        users ( id, full_name, username, email, phone, avatar_url )
      `)
      .eq("classroom_id", classroomId)
      .order("joined_at", { ascending: false });

    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  /**
   * POST /api/profiles/teacher/classrooms/:classroomId/students
   * Add a student to a classroom.
   * Auto-creates their platform account if they don't have one.
   * Checks the 20-student free limit.
   */
  addStudent: asyncHandler(async (req, res) => {
    const { classroomId }          = req.params;
    const { name, email, phone }   = req.body;

    if (!name)              return res400(res, "Student name is required");
    if (!email && !phone)   return res400(res, "Email or phone number is required");

    // Verify ownership
    const { data: classroom } = await db
      .from("classrooms")
      .select("id, teacher_id, school_id, name, student_limit, is_upgraded")
      .eq("id", classroomId)
      .single();

    if (!classroom)                         return res404(res, "Classroom not found");
    if (classroom.teacher_id !== req.user.id) return res403(res, "Not your classroom");

    // Count current students
    const { count } = await db
      .from("classroom_students")
      .select("id", { count: "exact", head: true })
      .eq("classroom_id", classroomId);

    // Enforce free limit
    if ((count ?? 0) >= FREE_STUDENT_LIMIT && !classroom.is_upgraded) {
      return res400(res, `Free plan allows up to ${FREE_STUDENT_LIMIT} students per classroom. Upgrade for ₦${UPGRADE_PRICE_NGN} to add more.`);
    }

    // Find or create student account
    const { data: teacher } = await db.from("users").select("full_name").eq("id", req.user.id).single();
    const { user, isNew, tempPassword } = await findOrCreateStudent(name, email, phone);

    // Check not already in classroom
    const { data: alreadyIn } = await db
      .from("classroom_students").select("id")
      .eq("classroom_id", classroomId).eq("user_id", user.id).single();

    if (alreadyIn) return res400(res, "Student is already in this classroom");

    // Add to classroom
    await db.from("classroom_students").insert({
      classroom_id: classroomId,
      user_id:      user.id,
      status:       "active",
    });

    // Ownership: if the teacher belongs to a school, mirror the student into
    // the school's SIS roster (mgmt.students) so schools own them too.
    const teacherSchoolId = await getTeacherApprovedSchoolId(req.user.id);
    if (teacherSchoolId) {
      if (!classroom.school_id) await db.from("classrooms").update({ school_id: teacherSchoolId }).eq("id", classroomId);
      await ensureSisRecord(teacherSchoolId, user, req.user.id).catch((e) => console.warn("[profiles] SIS mirror failed:", e.message));
    }

    // Send welcome credentials if new account
    await sendWelcomeCredentials({
      user, tempPassword,
      classroomName: classroom.name,
      teacherName:   teacher?.full_name ?? "Your teacher",
      isNew,
    });

    const { count: newCount } = await db
      .from("classroom_students")
      .select("id", { count: "exact", head: true })
      .eq("classroom_id", classroomId);

    res201(res, {
      student:          { id: user.id, full_name: user.full_name, email: user.email },
      account_created:  isNew,
      message:          isNew ? "Account created and welcome email sent" : "Student added to classroom",
      classroom_count:  newCount ?? 0,
      slots_remaining:  classroom.is_upgraded ? null : Math.max(0, FREE_STUDENT_LIMIT - (newCount ?? 0)),
    });
  }),

  /**
   * DELETE /api/profiles/teacher/classrooms/:classroomId/students/:userId
   * Remove a student from a classroom.
   */
  removeStudent: asyncHandler(async (req, res) => {
    const { classroomId, userId } = req.params;

    const { data: classroom } = await db
      .from("classrooms").select("teacher_id").eq("id", classroomId).single();
    if (!classroom || classroom.teacher_id !== req.user.id) return res403(res, "Not your classroom");

    await db.from("classroom_students")
      .delete()
      .eq("classroom_id", classroomId)
      .eq("user_id", userId);

    res200(res, { removed: true });
  }),

  /**
   * POST /api/profiles/teacher/classrooms/:classroomId/upgrade
   * Upgrade classroom to remove student limit.
   * In production: integrate with Paystack here.
   */
  upgradeClassroom: asyncHandler(async (req, res) => {
    const { classroomId } = req.params;

    const { data: classroom } = await db
      .from("classrooms").select("teacher_id, is_upgraded").eq("id", classroomId).single();
    if (!classroom || classroom.teacher_id !== req.user.id) return res403(res, "Not your classroom");
    if (classroom.is_upgraded) return res400(res, "Classroom is already upgraded");

    // TODO: Integrate Paystack payment for UPGRADE_PRICE_KOBO before setting is_upgraded
    // For now, simulate upgrade (replace with Paystack checkout in production)
    await db.from("classrooms")
      .update({ is_upgraded: true, student_limit: 9999 })
      .eq("id", classroomId);

    res200(res, {
      upgraded:       true,
      message:        `Classroom upgraded. You can now add unlimited students.`,
      amount_paid_ngn: UPGRADE_PRICE_NGN,
    });
  }),
};

// ─── School handlers ──────────────────────────────────────────────────────────

const schoolHandlers = {

  /**
   * POST /api/profiles/schools
   * Create a school profile.
   */
  create: asyncHandler(async (req, res) => {
    const { name, description, logo_url, website, address, phone, country, state, lga, city,
            educationLevels, ownershipType, curriculum, yearEstablished, genderType, boardingType, studentBand } = req.body;

    // Unique URL slug (used by /site/:slug previews and <slug>.akoro.app).
    const slugBase = (name || "school").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "school";
    let slug = `${slugBase}-${crypto.randomBytes(3).toString("hex")}`;
    for (let i = 0; i < 5; i++) {
      const { data: clash } = await db.from("school_profiles").select("id").eq("slug", slug).maybeSingle();
      if (!clash) break;
      slug = `${slugBase}-${crypto.randomBytes(3).toString("hex")}`;
    }

    const { data, error } = await db
      .from("school_profiles")
      .insert({
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
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    // New schools start with ONLY the essential system areas enabled; every
    // optional Management/Facilities module is off until the school turns it
    // on in Settings → Module Settings. Keys must match the sidebar moduleKeys
    // and the frontend TOGGLE_MODULES list.
    const disabledModules = Object.fromEntries(DEFAULT_OFF_MODULES.map((k) => [k, false]));
    const { error: modErr } = await db.schema("edu").from("school_portal_settings")
      .upsert({ school_id: data.id, modules: disabledModules }, { onConflict: "school_id" });
    if (modErr) console.warn("[new school] could not seed default modules:", modErr.message);

    // Update user role to school_admin
    await db.from("users").update({ role: "school_admin" }).eq("id", req.user.id);
    invalidateCachedUser(req.user.id);   // security field — never serve it stale

    res201(res, data);
  }),

  /**
   * GET /api/profiles/schools/:schoolId
   */
  get: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("school_profiles")
      .select(`
        id, name, description, logo_url, website, address, phone, is_active, created_at,
        classrooms ( id, name, student_limit, is_upgraded,
          classroom_students ( id ) )
      `)
      .eq("id", req.params.schoolId)
      .eq("admin_user_id", req.user.id)   // owner-scoped: no cross-tenant reads
      .single();

    if (error || !data) return res404(res, "School not found");

    const totalStudents = (data.classrooms ?? [])
      .reduce((s, c) => s + (c.classroom_students?.length ?? 0), 0);

    res200(res, {
      ...data,
      total_classrooms: data.classrooms?.length ?? 0,
      total_students:   totalStudents,
    });
  }),

  /**
   * POST /api/profiles/schools/:schoolId/classrooms
   * School creates a classroom.
   */
  createClassroom: asyncHandler(async (req, res) => {
    const { schoolId }              = req.params;
    const { name, description, teacher_id } = req.body;

    const { data: school } = await db
      .from("school_profiles").select("admin_user_id").eq("id", schoolId).single();
    if (!school || school.admin_user_id !== req.user.id) return res403(res, "Not authorised");

    const { data, error } = await db
      .from("classrooms")
      .insert({
        school_id:     schoolId,
        teacher_id:    teacher_id ?? req.user.id,
        name,
        description:   description ?? null,
        student_limit: 9999,     // schools get unlimited students
        is_upgraded:   true,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    res201(res, data);
  }),

  /**
   * POST /api/profiles/schools/:schoolId/teachers
   * School creates a teacher account and optionally links to a classroom.
   * Auto-creates the user account and sends credentials.
   */
  createTeacher: asyncHandler(async (req, res) => {
    const { schoolId }                             = req.params;
    const { name, email, phone, classroom_id }     = req.body;

    if (!name)            return res400(res, "Teacher name is required");
    if (!email && !phone) return res400(res, "Email or phone is required");

    const { data: school } = await db
      .from("school_profiles").select("admin_user_id, name").eq("id", schoolId).single();
    if (!school || school.admin_user_id !== req.user.id) return res403(res, "Not authorised");

    // Create teacher account
    const tempPassword   = crypto.randomBytes(8).toString("base64").slice(0, 10);
    const passwordHash   = await bcrypt.hash(tempPassword, 10);
    const safeEmail      = email?.toLowerCase().trim() ?? null;
    const usernameBase   = (safeEmail?.split("@")[0] ?? `teacher${Date.now()}`).replace(/[^a-zA-Z0-9_]/g, "_");

    const { data: existingUser } = await db
      .from("users").select("id").eq("email", safeEmail).single();

    let teacherUser;
    let isNew = false;

    if (existingUser) {
      // Upgrade existing user to instructor role
      await db.from("users").update({ role: "instructor" }).eq("id", existingUser.id);
      invalidateCachedUser(existingUser.id);   // security field — never serve it stale
      const { data: u } = await db.from("users").select("id, full_name, email").eq("id", existingUser.id).single();
      teacherUser = u;
    } else {
      const { data: u, error } = await db.from("users").insert({
        email:                safeEmail,
        username:             `${usernameBase}_${Math.floor(Math.random() * 9000) + 1000}`,
        password_hash:        passwordHash,
        full_name:            name,
        phone:                phone ?? null,
        role:                 "instructor",
        is_active:            true,
        must_change_password: true,
      }).select("id, full_name, email").single();
      if (error) throw new Error(error.message);
      teacherUser = u;
      isNew       = true;
    }

    // Link teacher to school — admin-added teachers are approved immediately.
    await db.from("school_teachers").upsert({
      school_id:  schoolId,
      teacher_id: teacherUser.id,
      status:     "approved",
      decided_at: new Date(),
      decided_by: req.user.id,
    }, { onConflict: "school_id,teacher_id" });

    // Link to classroom if provided
    if (classroom_id) {
      await db.from("classrooms")
        .update({ teacher_id: teacherUser.id })
        .eq("id", classroom_id)
        .eq("school_id", schoolId);
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
  }),

  /**
   * POST /api/profiles/schools/:schoolId/classrooms/:classroomId/students
   * School adds a student to a classroom.
   * Auto-creates account + sends credentials. Unlimited students.
   */
  addStudent: asyncHandler(async (req, res) => {
    const { schoolId, classroomId }  = req.params;
    const { name, email, phone }     = req.body;

    if (!name)              return res400(res, "Student name is required");
    if (!email && !phone)   return res400(res, "Email or phone is required");

    const { data: school }    = await db.from("school_profiles").select("admin_user_id, name").eq("id", schoolId).single();
    const { data: classroom } = await db.from("classrooms").select("name, school_id").eq("id", classroomId).single();

    if (!school || school.admin_user_id !== req.user.id) return res403(res, "Not authorised");
    if (!classroom || classroom.school_id !== schoolId)  return res404(res, "Classroom not found in this school");

    // Find or create student
    const { user, isNew, tempPassword } = await findOrCreateStudent(name, email, phone);

    // Check not already in classroom
    const { data: alreadyIn } = await db
      .from("classroom_students").select("id")
      .eq("classroom_id", classroomId).eq("user_id", user.id).single();

    if (alreadyIn) return res400(res, "Student already in this classroom");

    await db.from("classroom_students").insert({ classroom_id: classroomId, user_id: user.id, status: "active" });

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
  }),

  /**
   * GET /api/profiles/schools/:schoolId/classrooms
   */
  listClassrooms: asyncHandler(async (req, res) => {
    // Owner-scoped: only the school's admin can list its classrooms.
    const { data: sch } = await db.from("school_profiles").select("id")
      .eq("id", req.params.schoolId).eq("admin_user_id", req.user.id).maybeSingle();
    if (!sch) return res404(res, "School not found");
    const { data, error } = await db
      .from("classrooms")
      .select(`
        id, name, description, is_upgraded, created_at,
        users!classrooms_teacher_id_fkey ( id, full_name, username ),
        classroom_students ( id )
      `)
      .eq("school_id", req.params.schoolId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    res200(res, (data ?? []).map((c) => ({
      ...c,
      student_count:      c.classroom_students?.length ?? 0,
      classroom_students: undefined,
    })), { total: data?.length ?? 0 });
  }),
};

// ─── Admin handlers ────────────────────────────────────────────────────────────

const adminHandlers = {

  // GET /api/profiles/admin/schools
  listSchools: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("school_profiles")
      .select("id, name, logo_url, is_active, created_at, users!school_profiles_admin_user_id_fkey(full_name, email)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  // GET /api/profiles/admin/teachers
  listTeachers: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("users")
      .select("id, full_name, username, email, created_at")
      .eq("role", "instructor")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

// Teacher
router.get   ("/teacher/me",                                           authenticateToken, requireRole(["instructor", "admin"]), teacherHandlers.getProfile);
router.get   ("/teacher/classrooms",                                   authenticateToken, requireRole(["instructor", "admin"]), teacherHandlers.listClassrooms);
router.post  ("/teacher/classrooms",                                   authenticateToken, requireRole(["instructor", "admin"]), [body("name").notEmpty()], runValidation, teacherHandlers.createClassroom);
router.get   ("/teacher/classrooms/:classroomId/students",             authenticateToken, requireRole(["instructor", "admin"]), teacherHandlers.listStudents);
router.post  ("/teacher/classrooms/:classroomId/students",             authenticateToken, requireRole(["instructor", "admin"]), [body("name").notEmpty()], runValidation, teacherHandlers.addStudent);
router.delete("/teacher/classrooms/:classroomId/students/:userId",     authenticateToken, requireRole(["instructor", "admin"]), teacherHandlers.removeStudent);
router.post  ("/teacher/classrooms/:classroomId/upgrade",              authenticateToken, requireRole(["instructor", "admin"]), teacherHandlers.upgradeClassroom);

// School
router.post  ("/schools",                                              authenticateToken, [body("name").notEmpty()], runValidation, schoolHandlers.create);
router.get   ("/schools/:schoolId",                                    authenticateToken, schoolHandlers.get);
router.get   ("/schools/:schoolId/classrooms",                         authenticateToken, schoolHandlers.listClassrooms);
router.post  ("/schools/:schoolId/classrooms",                         authenticateToken, [body("name").notEmpty()], runValidation, schoolHandlers.createClassroom);
router.post  ("/schools/:schoolId/teachers",                           authenticateToken, [body("name").notEmpty()], runValidation, schoolHandlers.createTeacher);
router.post  ("/schools/:schoolId/classrooms/:classroomId/students",   authenticateToken, [body("name").notEmpty()], runValidation, schoolHandlers.addStudent);

// Admin
router.get("/admin/schools",                                           authenticateToken, requireRole(["admin"]), adminHandlers.listSchools);
router.get("/admin/teachers",                                          authenticateToken, requireRole(["admin"]), adminHandlers.listTeachers);

// ─── Student / self settings ──────────────────────────────────────────────────

const PROFILE_SELECT = [
  "id","email","username","full_name","avatar_url","avatar_emoji","phone","role",
  "country","city","school_name","school_type","year_group","study_level",
  "language","display_mode","accent_color","teaching_guide","guide_emoji",
  "subjects","two_factor_enabled","onboarding_completed","created_at",
  "password_hash",   // presence only — surfaced as hasPassword, never returned
].join(",");

// Fallback select without columns added by pending migrations
const PROFILE_SELECT_BASE = [
  "id","email","username","full_name","avatar_url","phone","role",
  "country","school_name","school_type","year_group","study_level",
  "language","display_mode","accent_color","teaching_guide","guide_emoji",
  "subjects","two_factor_enabled","created_at","password_hash",
].join(",");

/** GET /api/profiles/me — full profile + agent + notification prefs */
router.get("/me", authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  let [{ data: user, error: userErr }, { data: agent }, { data: notif }, { data: accountSettings }] = await Promise.all([
    db.from("users").select(PROFILE_SELECT).eq("id", userId).maybeSingle(),
    db.from("user_agents").select("*").eq("user_id", userId).eq("is_active", true).maybeSingle(),
    db.from("user_notification_preferences").select("*").eq("user_id", userId).maybeSingle(),
    db.from("user_settings").select("settings").eq("user_id", userId).maybeSingle(),
  ]);

  // If the full select fails (e.g. pending migration columns), retry with base columns
  if (userErr || !user) {
    ({ data: user } = await db.from("users").select(PROFILE_SELECT_BASE).eq("id", userId).maybeSingle());
  }

  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  res200(res, {
    id:              user.id,
    email:           user.email,
    username:        user.username,
    fullName:        user.full_name,
    avatarUrl:       user.avatar_url,
    avatarEmoji:     user.avatar_emoji,
    phone:           user.phone,
    role:            user.role,
    country:         user.country,
    city:            user.city ?? null,
    schoolName:      user.school_name,
    schoolType:      user.school_type,
    yearGroup:       user.year_group,
    studyLevel:      user.study_level,
    language:        user.language        || "English",
    // Stored in generic account settings so the users table needs no new
    // column. It is consumed by learner time-aware task/chat tools.
    timeZone:        isIanaTimeZone(accountSettings?.settings?.timezone) ? accountSettings.settings.timezone.trim() : null,
    displayMode:     user.display_mode    || "system",
    accentColor:     user.accent_color    || "#6C3BFF",
    teachingGuide:   user.teaching_guide,
    guideEmoji:      user.guide_emoji,
    subjects:        user.subjects        || [],
    twoFactorEnabled:user.two_factor_enabled || false,
    // OAuth accounts may have no password on file — the settings page shows
    // "Set password" (new + confirm only) instead of "Change password".
    // Only the presence leaves the API, never the hash.
    hasPassword:     !!user.password_hash,
    onboardingCompleted: user.onboarding_completed ?? false,
    memberSince:     new Date(user.created_at).toLocaleDateString("en-GB",{ month:"long", year:"numeric" }),
    agent: agent ? {
      id:           agent.id,
      name:         agent.agent_name,
      emoji:        agent.agent_emoji,
      photoUrl:     agent.photo_url,
      color:        agent.agent_color,
      bg:           agent.agent_bg,
      personality:  agent.personality,
      studyLevel:   agent.study_level,
      yearGroup:    agent.year_group,
      examBoard:    agent.exam_board,
      subjects:     agent.subjects       || [],
      goal:         agent.goal,
      level:        agent.level          || 1,
      totalSessions:agent.total_sessions || 0,
      totalTurns:   agent.total_turns    || 0,
      knowledgeScore:agent.knowledge_score || 0,
      xpEarned:     agent.total_xp       || 0,
    } : null,
    notif: notif ? {
      email:           notif.email_enabled,
      sms:             notif.sms_enabled,
      push:            notif.push_enabled,
      whatsapp:        notif.whatsapp_enabled,
      whatsappNumber:  notif.whatsapp_number || "",
      sessionReminders:notif.notify_session_reminders,
      sessionStarted:  notif.notify_session_started,
      sessionCancelled:notif.notify_session_cancelled,
      announcements:   notif.notify_new_announcements,
      qaReplies:       notif.notify_qa_replies,
    } : null,
  });
}));

/**
 * GET /api/profiles/me/location — the caller's self-reported location only.
 * This intentionally does not return contact details or infer a timezone.
 */
router.get("/me/location", authenticateToken, asyncHandler(async (req, res) => {
  const { data: location, error } = await db.from("users")
    .select("city, country").eq("id", req.user.id).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: "Failed to load location" });
  if (!location) return res.status(404).json({ success: false, message: "User not found" });
  res200(res, { city: location.city ?? null, country: location.country ?? null });
}));

/**
 * PATCH /api/profiles/me/location — update city and/or country for this user.
 * An IANA timezone remains a separate explicit setting because a place name is
 * not a reliable timezone authority.
 */
router.patch("/me/location", authenticateToken, [
  body("city").optional().isString().trim().isLength({ max: 120 }),
  body("country").optional().isString().trim().isLength({ max: 80 }),
], runValidation, asyncHandler(async (req, res) => {
  const { city, country } = req.body;
  if (city === undefined && country === undefined) return res400(res, "city or country is required");

  const patch = { updated_at: now() };
  if (city !== undefined) patch.city = city.trim() || null;
  if (country !== undefined) patch.country = country.trim() || null;
  const { data: updated, error } = await db.from("users")
    .update(patch).eq("id", req.user.id).select("city, country").maybeSingle();
  if (error) return res.status(500).json({ success: false, message: "Failed to save location" });
  if (!updated) return res.status(404).json({ success: false, message: "User not found" });
  res200(res, { city: updated.city ?? null, country: updated.country ?? null });
}));

/** PATCH /api/profiles/me — update user profile fields */
router.patch("/me", authenticateToken, [
  body("fullName").optional().trim().isLength({ min: 1, max: 120 }),
  body("username").optional().trim().isLength({ min: 3, max: 40 }).matches(/^[a-zA-Z0-9_]+$/),
  body("phone").optional().trim(),
  body("avatarEmoji").optional().trim(),
  body("country").optional().trim(),
  body("city").optional().trim().isLength({ max: 120 }),
  body("schoolName").optional().trim(),
  body("schoolType").optional().trim(),
  body("yearGroup").optional().trim(),
  body("studyLevel").optional().trim(),
  body("language").optional().trim(),
  body("timeZone").optional().trim().isLength({ min: 1, max: 80 }),
  body("displayMode").optional().isIn(["light","dark","system"]),
  body("accentColor").optional().trim(),
  body("teachingGuide").optional().trim(),
  body("guideEmoji").optional().trim(),
  body("subjects").optional().isArray(),
  body("twoFactorEnabled").optional().isBoolean(),
  body("onboardingCompleted").optional().isBoolean(),
], runValidation, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const {
    fullName, username, phone, avatarEmoji, country, city, schoolName, schoolType,
    yearGroup, studyLevel, language, timeZone, displayMode, accentColor,
    teachingGuide, guideEmoji, subjects, twoFactorEnabled, onboardingCompleted,
  } = req.body;

  // Check username uniqueness
  if (username) {
    const { data: taken } = await db.from("users")
      .select("id").eq("username", username).neq("id", userId).maybeSingle();
    if (taken) return res.status(409).json({ success: false, message: "Username already taken" });
  }

  const patch = {};
  if (fullName       !== undefined) patch.full_name        = fullName;
  if (username       !== undefined) patch.username         = username;
  if (phone          !== undefined) patch.phone            = phone;
  if (avatarEmoji    !== undefined) patch.avatar_emoji     = avatarEmoji;
  if (country        !== undefined) patch.country          = country;
  if (city           !== undefined) patch.city             = city || null;
  if (schoolName     !== undefined) patch.school_name      = schoolName;
  if (schoolType     !== undefined) patch.school_type      = schoolType;
  if (yearGroup      !== undefined) patch.year_group       = yearGroup;
  if (studyLevel     !== undefined) patch.study_level      = studyLevel;
  if (language       !== undefined) patch.language         = language;
  if (displayMode    !== undefined) patch.display_mode     = displayMode;
  if (accentColor    !== undefined) patch.accent_color     = accentColor;
  if (teachingGuide  !== undefined) patch.teaching_guide   = teachingGuide;
  if (guideEmoji     !== undefined) patch.guide_emoji      = guideEmoji;
  if (subjects       !== undefined) patch.subjects         = subjects;
  if (timeZone !== undefined && !isIanaTimeZone(timeZone)) {
    return res.status(422).json({ success: false, message: "timeZone must be a valid IANA timezone" });
  }
  // two_factor_enabled is intentionally NOT settable here — it can only be
  // toggled via the code-verified /2fa/enable and /2fa/disable routes, so a
  // session holder can't silently disable 2FA without a TOTP code.
  if (onboardingCompleted !== undefined) patch.onboarding_completed = onboardingCompleted;
  patch.updated_at = new Date().toISOString();

  // Keep the write independent from the read projection. PROFILE_SELECT has
  // additive fields (for example city); a pending read-schema migration must
  // not turn an otherwise valid update to an unrelated profile field into a
  // failed save.
  const { error: updateError } = await db.from("users")
    .update(patch).eq("id", userId);

  if (updateError) {
    console.error("[profiles/me PATCH]", updateError.message);
    return res.status(500).json({ success: false, message: "Failed to update profile" });
  }
  // The auth cache holds full_name and onboarding_completed for 45 s: finishing onboarding and then
  // reloading (or opening a second tab) read the stale "not onboarded" and sent the learner back to it.
  invalidateCachedUser(userId);

  // Match GET /me's compatibility behaviour while additive columns are
  // rolling out. The base projection includes the values returned below,
  // including school_type, so clients can still confirm a persisted setting.
  let { data: updated, error: profileReadError } = await db.from("users")
    .select(PROFILE_SELECT).eq("id", userId).maybeSingle();
  if (profileReadError) {
    ({ data: updated, error: profileReadError } = await db.from("users")
      .select(PROFILE_SELECT_BASE).eq("id", userId).maybeSingle());
  }
  if (profileReadError) {
    console.error("[profiles/me PATCH confirmation]", profileReadError.message);
    return res.status(500).json({ success: false, message: "Profile was updated but could not be confirmed. Please refresh and try again." });
  }
  if (!updated) return res.status(404).json({ success: false, message: "User not found" });

  if (timeZone !== undefined) {
    const canonicalTimeZone = timeZone.trim();
    // Merge rather than replace generic settings: this account setting shares
    // the JSONB row with unrelated integrations/preferences.
    const { data: prior, error: settingsReadError } = await db.from("user_settings")
      .select("settings").eq("user_id", userId).maybeSingle();
    if (settingsReadError) return res.status(500).json({ success: false, message: "Failed to save account time zone" });
    const current = prior?.settings && typeof prior.settings === "object" ? prior.settings : {};
    const { error: settingsError } = await db.from("user_settings").upsert({
      user_id: userId,
      settings: { ...current, timezone: canonicalTimeZone },
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (settingsError) return res.status(500).json({ success: false, message: "Failed to save account time zone" });
  }

  res200(res, {
    fullName: updated.full_name,
    username: updated.username,
    city: updated.city ?? null,
    country: updated.country ?? null,
    schoolType: updated.school_type ?? null,
    // study_level is selected above but was never mapped into the response,
    // so a client confirming a persisted study level (the merged Settings
    // level control) read `undefined` and treated a SUCCESSFUL save as a
    // failed one. Additive, backward-compatible field.
    studyLevel: updated.study_level ?? null,
    accentColor: updated.accent_color,
    timeZone: timeZone !== undefined ? timeZone.trim() : undefined,
    onboardingCompleted: updated.onboarding_completed ?? false,
  });
}));

/** PATCH /api/profiles/me/notifications — update notification preferences */
router.patch("/me/notifications", authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const {
    email, sms, push, whatsapp, whatsappNumber,
    sessionReminders, sessionStarted, sessionCancelled,
    announcements, qaReplies,
  } = req.body;

  const row = {
    user_id:                     userId,
    updated_at:                  new Date().toISOString(),
  };
  if (email           !== undefined) row.email_enabled              = email;
  if (sms             !== undefined) row.sms_enabled                = sms;
  if (push            !== undefined) row.push_enabled               = push;
  if (whatsapp        !== undefined) row.whatsapp_enabled           = whatsapp;
  if (whatsappNumber  !== undefined) row.whatsapp_number            = whatsappNumber;
  if (sessionReminders!== undefined) row.notify_session_reminders   = sessionReminders;
  if (sessionStarted  !== undefined) row.notify_session_started     = sessionStarted;
  if (sessionCancelled!== undefined) row.notify_session_cancelled   = sessionCancelled;
  if (announcements   !== undefined) row.notify_new_announcements   = announcements;
  if (qaReplies       !== undefined) row.notify_qa_replies          = qaReplies;

  await db.from("user_notification_preferences")
    .upsert(row, { onConflict: "user_id" });

  res200(res, { saved: true });
}));

// ─── § MISSING ENDPOINTS — added per frontend audit ──────────────────────────

/**
 * GET /api/profiles/instructor/students
 * Global student list across ALL courses the teacher owns.
 * Supports ?search=, ?course_id=, ?status=, ?limit=, ?offset=
 */
router.get("/instructor/students", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const { search, course_id, status, limit = 50, offset = 0 } = req.query;
  const teacherId = req.user.id;

  // Get all courses owned by this teacher
  const { data: courses } = await db.from("courses").select("id, title").eq("instructor_id", teacherId);
  const courseIds = (courses ?? []).map((c) => c.id);
  if (!courseIds.length) return res200(res, [], { total: 0 });

  // Filter to specific course if requested — one of the caller's own: any
  // course_id used to be trusted, which listed another course's students with
  // their emails and phones (Phase 15 item 6).
  if (course_id && !courseIds.includes(course_id)) return res403(res, "Not your course");
  const targetIds = course_id ? [course_id] : courseIds;

  let q = db.from("enrollments")
    .select(`
      id, status, progress, enrolled_at,
      users!enrollments_user_id_fkey ( id, full_name, username, email, phone, avatar_url, created_at, must_change_password ),
      courses!enrollments_course_id_fkey ( id, title )
    `, { count: "exact" })
    .in("course_id", targetIds)
    .order("enrolled_at", { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (status) q = q.eq("status", status);

  const { data, error, count } = await q;
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
}));

/**
 * POST /api/profiles/teacher/invite
 * A signed invite link into the teacher's own courses (one or several). The
 * learner opens it in the learner app at FRONTEND_URL/join/:token, signs in or
 * up, and redeems it (POST /api/profiles/invite/redeem). The token is a typed
 * `course_invite` signed by the auth module's key — it never signs anyone in.
 */
const LEARNER_APP_URL = () => urlFor("FRONTEND_URL");
const escHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

router.post("/teacher/invite", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const { course_id, course_ids, send_to_emails = [] } = req.body;
  const expires_in_days = Math.min(INVITE_MAX_DAYS, Math.max(1, Math.round(Number(req.body.expires_in_days) || 7)));

  // Accept a single course_id (back-compat) or a course_ids array (multi-course).
  const requestedIds = [...new Set(
    (Array.isArray(course_ids) && course_ids.length ? course_ids : [course_id]).filter(Boolean)
  )];
  if (!requestedIds.length) return res400(res, "course_id or course_ids is required");

  // Verify the teacher owns every requested course.
  const { data: ownedCourses } = await db
    .from("courses")
    .select("id, title, instructor_id")
    .in("id", requestedIds)
    .eq("instructor_id", req.user.id);

  const owned = ownedCourses ?? [];
  if (owned.length !== requestedIds.length)
    return res403(res, "One or more courses are not yours");

  const courseIds   = owned.map((c) => c.id);
  const courseTitle = owned.length === 1 ? owned[0].title : `${owned.length} courses`;

  const token     = signCourseInvite({ teacherId: req.user.id, courseIds }, expires_in_days);
  const inviteUrl = `${LEARNER_APP_URL()}/join/${token}`;

  // Optionally send invite emails
  const emails = (Array.isArray(send_to_emails) ? send_to_emails : [])
    .filter((e) => typeof e === "string" && /^[^\s@]+@[^\s@]+$/.test(e)).slice(0, 50);
  const emailResults = [];
  if (emails.length > 0) {
    try {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT ?? "587"),
        secure: process.env.SMTP_PORT === "465",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      const { data: teacher } = await db.from("users").select("full_name").eq("id", req.user.id).single();
      for (const email of emails) {
        await transport.sendMail({
          from:    `"Akoro Learning" <${process.env.SMTP_FROM_EMAIL ?? "noreply@akoro.app"}>`,
          to:      email,
          subject: `You're invited to join "${courseTitle}" on Akoro`,
          html:    `<div style="font-family:sans-serif;max-width:520px"><h2>You're invited! 🎓</h2><p><strong>${escHtml(teacher?.full_name ?? "A teacher")}</strong> has invited you to join <strong>${escHtml(courseTitle)}</strong> on Akoro Learning.</p><a href="${escHtml(inviteUrl)}" style="display:inline-block;padding:12px 24px;background:#E8884A;color:#fff;border-radius:100px;text-decoration:none;font-weight:700">Join course →</a><p style="color:#999;font-size:12px;margin-top:16px">Link expires in ${expires_in_days} days.</p></div>`,
        });
        emailResults.push({ email, sent: true });
      }
    } catch (e) {
      console.warn("[profiles/invite] Email send failed:", e.message);
    }
  }

  res201(res, {
    invite_url:    inviteUrl,
    course_title:  courseTitle,
    expires_in_days,
    emails_sent:   emailResults.filter((r) => r.sent).length,
  });
}));

/** The invite's courses still owned by the teacher who signed it (a course handed on since drops out). */
async function inviteCourses(invite) {
  const { data } = await db.from("courses").select("id, title")
    .in("id", invite.courseIds).eq("instructor_id", invite.teacherId);
  return data ?? [];
}

/**
 * GET /api/profiles/invite/:token — public: what the join page shows before
 * sign-in (course titles, teacher name, expiry). Only what the teacher put in
 * the link; an invalid, expired or non-invite token is 400.
 */
router.get("/invite/:token", asyncHandler(async (req, res) => {
  const invite = verifyCourseInvite(req.params.token);
  if (!invite) return res400(res, "Invalid or expired invite link");
  const courses = await inviteCourses(invite);
  if (!courses.length) return res400(res, "Invalid or expired invite link");
  const { data: teacher } = await db.from("users").select("full_name").eq("id", invite.teacherId).maybeSingle();
  res200(res, { courses, teacher_name: teacher?.full_name ?? null, expires_at: invite.expiresAt });
}));

/**
 * POST /api/profiles/invite/redeem  { token }
 * The signed-in learner joins every course in the invite. Idempotent: courses
 * they are already active in are skipped and listed in already_enrolled.
 */
router.post("/invite/redeem", authenticateToken, asyncHandler(async (req, res) => {
  const invite = verifyCourseInvite(req.body?.token);
  if (!invite) return res400(res, "Invalid or expired invite link");
  const userId = req.user.id;
  if (userId === invite.teacherId) return res400(res, "This is your own invite link");
  const courses = await inviteCourses(invite);
  if (!courses.length) return res400(res, "Invalid or expired invite link");
  const ids = courses.map((c) => c.id);

  const { data: existingRows } = await db.from("enrollments")
    .select("course_id, status").eq("user_id", userId).in("course_id", ids);
  const activeSet = new Set((existingRows ?? []).filter((r) => r.status === "active").map((r) => r.course_id));
  const toEnrol = ids.filter((id) => !activeSet.has(id));

  for (const id of toEnrol) {
    const { error } = await db.from("enrollments").upsert(
      { user_id: userId, course_id: id, status: "active" },
      { onConflict: "user_id,course_id" }
    );
    if (error) throw error;
    try { await db.rpc("increment_course_students", { course_id_input: id }); } catch {}
  }

  const titles = courses.filter((c) => toEnrol.includes(c.id)).map((c) => c.title);
  if (toEnrol.length) {
    const label = titles.length === 1 ? `"${titles[0]}"` : `${titles.length} courses`;
    const { data: student } = await db.from("users").select("full_name, email").eq("id", userId).maybeSingle();
    try {
      const { error: notifErr } = await db.from("notifications").insert([
        { user_id: userId, type: "enrolled_in_course", title: `You're enrolled in ${label}`, content: "You joined via an invite link", related_id: toEnrol[0] },
        { user_id: invite.teacherId, type: "student_enrolled", title: `${student?.full_name || student?.email || "A student"} joined`, content: `Joined ${label} via invite link`, related_id: toEnrol[0] },
      ]);
      if (notifErr) console.warn("[notify] invite-redeem insert failed:", notifErr.message);
    } catch (e) {
      console.warn("[notify] invite-redeem insert threw:", e.message);
    }
  }

  res200(res, {
    enrolled:         toEnrol.length > 0,
    course_ids:       toEnrol,
    course_titles:    titles,
    already_enrolled: courses.filter((c) => activeSet.has(c.id)).map((c) => c.title),
  });
}));

/**
 * POST /api/profiles/teacher/students/import
 * Bulk CSV import: parse rows, auto-create accounts, enrol in course.
 * Multipart form: csv file + optional course_id and/or classroom_id
 * CSV format: name, email, phone — the header row is skipped if it contains
 * "name". Extra columns are ignored.
 */

router.post("/teacher/students/import", authenticateToken, requireRole(["instructor", "admin"]), (req, res, next) => {
  const upload = multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }).single("csv");
  upload(req, res, async (err) => {
    if (err) return res400(res, `Upload error: ${err.message}`);
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
      const { data } = await db.from("courses").select("id, title, instructor_id").eq("id", course_id).maybeSingle();
      if (!data || data.instructor_id !== req.user.id) return res403(res, "Not your course");
      course = data;
    }

    // Parse CSV (simple split — handles standard comma-separated CSVs)
    const text = req.file.buffer.toString("utf-8");
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return res400(res, "CSV must have a header row and at least one data row");

    // Detect header and skip it
    const header = lines[0].toLowerCase();
    const dataLines = header.includes("name") ? lines.slice(1) : lines;

    // Resolve the class ONCE. This sat inside the per-row loop, re-querying the
    // same classroom for every line of the CSV — a 200-row register meant 200
    // identical lookups.
    let classroom = null;
    if (classroomId) {
      const { data: room } = await db.from("classrooms")
        .select("id, teacher_id, school_id").eq("id", classroomId).maybeSingle();
      if (room) {
        let allowed = room.teacher_id === req.user.id || req.user.role === "admin";
        if (!allowed && room.school_id) {
          const { data: school } = await db.from("school_profiles")
            .select("id").eq("admin_user_id", req.user.id).eq("id", room.school_id).maybeSingle();
          allowed = !!school;
        }
        if (!allowed) return res403(res, "You do not teach that class");
        classroom = room;
      } else {
        return res404(res, "Class not found");
      }
    } else {
      const { data: own } = await db.from("classrooms")
        .select("id").eq("teacher_id", req.user.id)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      classroom = own ?? null;
    }

    const results = { created: 0, existing: 0, failed: 0, rows: [] };

    for (const line of dataLines) {
      const cols = line.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
      const [name, email, phone] = cols;
      if (!name || !email) { results.failed++; continue; }

      try {
        const { user, isNew, tempPassword } = await findOrCreateStudent(name, email, phone || null);

        if (classroom) {
          await db.from("classroom_students").upsert(
            { classroom_id: classroom.id, user_id: user.id, status: "active" },
            { onConflict: "classroom_id,user_id" }
          );
        }

        // Enrol in course
        if (course) await db.from("enrollments").upsert(
          { user_id: user.id, course_id, status: "active" },
          { onConflict: "user_id,course_id" }
        );
        if (course) { try { await db.rpc("increment_course_students", { course_id_input: course_id }); } catch {} }

        // Recipient side — notify the student they were enrolled.
        try {
          const { error: notifErr } = await db.from("notifications").insert({
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
          const { data: teacher } = await db.from("users").select("full_name").eq("id", req.user.id).single();
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
  });
});

/** Does this teacher teach this learner — an enrolment in one of their courses, or a seat in one of their classes? */
async function teachesLearner(teacherId, userId) {
  const { data: courses } = await db.from("courses").select("id").eq("instructor_id", teacherId);
  const courseIds = (courses ?? []).map((c) => c.id);
  if (courseIds.length) {
    const { data: enrolled } = await db.from("enrollments").select("id")
      .eq("user_id", userId).in("course_id", courseIds).limit(1);
    if (enrolled?.length) return true;
  }
  const { data: rooms } = await db.from("classrooms").select("id").eq("teacher_id", teacherId);
  const roomIds = (rooms ?? []).map((r) => r.id);
  if (!roomIds.length) return false;
  const { data: seat } = await db.from("classroom_students").select("id")
    .eq("user_id", userId).in("classroom_id", roomIds).eq("status", "active").limit(1);
  return !!seat?.length;
}

/**
 * PATCH /api/profiles/students/:userId
 * Teacher edits a student's details (name, phone, access level).
 * Teachers can only edit students enrolled in their courses.
 */
router.patch("/students/:userId", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const teacherId  = req.user.id;

  // Verify this student is in one of the teacher's courses
  const { data: courses } = await db.from("courses").select("id").eq("instructor_id", teacherId);
  const courseIds = (courses ?? []).map((c) => c.id);
  const { data: enrolled } = await db.from("enrollments").select("id")
    .eq("user_id", userId).in("course_id", courseIds).limit(1).single();

  if (!enrolled && req.user.role !== "admin") return res403(res, "This student is not in your courses");

  const allowed = ["full_name", "phone", "avatar_url"];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

  if (!Object.keys(updates).length) return res400(res, "No valid fields to update");

  const { data, error } = await db.from("users").update(updates).eq("id", userId).select("id, full_name, email, phone, avatar_url").single();
  if (error) throw new Error(error.message);

  res200(res, data);
}));

/**
 * POST /api/profiles/students/:userId/message
 * Teacher sends a direct message to a student (in-app + email).
 */
router.post("/students/:userId/message", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const { userId }  = req.params;
  const { subject, message, channel = "in_app" } = req.body;

  if (!message?.trim()) return res400(res, "message is required");
  // Only a learner this teacher actually teaches (Phase 15 item 6): this used to
  // send an in-app message and a platform email to any account id.
  if (req.user.role !== "admin" && !(await teachesLearner(req.user.id, userId))) return res403(res, "This student is not in your courses or classes");

  const { data: student } = await db.from("users").select("id, full_name, email").eq("id", userId).single();
  if (!student) return res404(res, "Student not found");

  const { data: teacher } = await db.from("users").select("full_name").eq("id", req.user.id).single();

  // In-app notification
  await db.from("notifications").insert({
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
}));

// ─── GET /api/profiles/teaching-guides ───────────────────────────────────────
router.get("/teaching-guides", authenticateToken, asyncHandler(async (req, res) => {
  const guides = [
    { id: "nana-esumai",      name: "NaNa Esumai",    emoji: "🧠", style: "Adaptive & encouraging" },
    { id: "akobi-strict",     name: "Akobi",          emoji: "🧑🏫", style: "Strict & structured" },
    { id: "sade-warm",        name: "Sade",            emoji: "🌸", style: "Warm & nurturing" },
    { id: "emeka-fasttrack",  name: "Emeka",           emoji: "⚡", style: "Fast-track & intensive" },
  ];
  res200(res, { guides });
}));

// ─── POST /api/profiles/me/deactivate ────────────────────────────────────────
// Suspends the account: login is blocked (is_active=false) but data is kept,
// so the user can reactivate within the grace period by signing back in.
router.post("/me/deactivate", authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const { error } = await db.from("users").update({
    is_active:       false,
    deactivated_at:  new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  }).eq("id", userId);
  if (error) {
    console.error("[profiles/me/deactivate]", error.message);
    return res.status(500).json({ success: false, message: "Failed to deactivate account" });
  }

  // Mark all user_agents inactive
  await db.from("user_agents").update({ is_active: false }).eq("user_id", userId);

  // Kill the current session so the user is signed out everywhere
  await endSession(req, res);

  res200(res, { deactivated: true });
}));

// ─── POST /api/profiles/me/avatar ────────────────────────────────────────────
const avatarUpload = multerLib({
  storage: multerLib.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG, WebP or GIF allowed"));
  },
}).single("file");

router.post("/me/avatar", authenticateToken, (req, res, next) => {
  avatarUpload(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}, asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
  const userId = req.user.id;
  const mime   = req.file.mimetype;
  const b64    = req.file.buffer.toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;

  const { error } = await db.from("users")
    .update({ avatar_url: dataUrl, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return res.status(500).json({ success: false, message: "Failed to save avatar" });

  res200(res, { url: dataUrl });
}));

// ─── DELETE /api/profiles/me ──────────────────────────────────────────────────
// Right-to-erasure delete: blocks login, anonymizes all PII, scrubs credentials
// and 2FA, and removes the user's learning data. The row is retained (anonymized)
// to preserve referential integrity for aggregate records.
router.delete("/me", authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const anon = `deleted_${userId.slice(0, 8)}_${Date.now()}`;

  const { error } = await db.from("users").update({
    email:             `${anon}@deleted.akoro.app`,
    full_name:         "Deleted User",
    username:          anon,
    phone:             null,
    avatar_url:        null,
    password_hash:     "",            // scrub credentials
    two_factor_secret: null,
    two_factor_enabled:false,
    is_active:         false,         // block any further login
    deleted_at:        new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  }).eq("id", userId);
  if (error) {
    console.error("[profiles/me DELETE]", error.message);
    return res.status(500).json({ success: false, message: "Failed to delete account" });
  }

  // Remove the user's owned learning data (best-effort — ignore missing tables)
  await Promise.allSettled([
    db.from("user_agents").delete().eq("user_id", userId),
    db.from("user_notification_preferences").delete().eq("user_id", userId),
  ]);

  // Kill the current session
  await endSession(req, res);

  res200(res, { deleted: true });
}));

// ═══════════════ OWNERSHIP: school ↔ teacher ↔ student links ═══════════════

/* ── Directories (for onboarding pickers) ─────────────────────────────── */

// GET /api/profiles/directory/schools — active schools a teacher can join.
router.get("/directory/schools", authenticateToken, asyncHandler(async (req, res) => {
  const { data } = await db.from("school_profiles")
    .select("id, name, logo_url, address").eq("is_active", true).order("name", { ascending: true }).limit(500);
  res200(res, data || []);
}));

// GET /api/profiles/directory/teachers — instructors a learner can join.
// Includes the school each teacher is approved into (for grouping).
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
router.get("/onboarding-prefill", authenticateToken, asyncHandler(async (req, res) => {
  const { data: rows } = await db.from("classroom_students")
    .select("classroom_id, classrooms!inner(id, name, teacher_id, school_id)")
    .eq("user_id", req.user.id).eq("status", "active").limit(20);

  const rooms = (rows ?? []).map((r) => r.classrooms).filter(Boolean);
  if (!rooms.length) return res200(res, {});

  // "JSS1", "JSS 1", "Primary 4", "SSS 2" → the level and the form's own label.
  const readLevel = (name) => {
    const m = String(name || "").trim().match(/^\s*(primary|pry|jss|js|sss|ss)\s*([0-9]+)/i);
    if (!m) return null;
    const kind = m[1].toLowerCase(), n = m[2];
    if (kind === "primary" || kind === "pry") return { studyLevel: "Primary",          yearGroup: `Primary ${n}` };
    if (kind === "jss" || kind === "js")      return { studyLevel: "Junior Secondary", yearGroup: `JSS ${n}` };
    return { studyLevel: "Senior Secondary", yearGroup: `SSS ${n}` };
  };

  // A learner can be in several rooms — a real class like JSS1 alongside a
  // catch-all like "Westwood Academy · Class A". Taking whichever came back
  // first filled the form from the one that says nothing. Prefer the room that
  // actually names a year, then one attached to a school.
  const room = rooms.find((r) => readLevel(r.name) && r.school_id)
            ?? rooms.find((r) => readLevel(r.name))
            ?? rooms.find((r) => r.school_id)
            ?? rooms[0];

  const raw = String(room.name || "").trim();
  const { studyLevel = null, yearGroup = null } = readLevel(raw) ?? {};

  const [{ data: school }, { data: teacher }] = await Promise.all([
    room.school_id
      ? db.from("school_profiles").select("id, name").eq("id", room.school_id).maybeSingle()
      : Promise.resolve({ data: null }),
    room.teacher_id
      ? db.from("users").select("id, full_name").eq("id", room.teacher_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Subjects come from the academic structure, which lines up with the room by
  // school and name — there is no foreign key between them.
  let subjects = [];
  if (room.school_id) {
    const { data: cls } = await db.schema("mgmt").from("classes")
      .select("id").eq("school_id", room.school_id).ilike("name", raw).limit(1);
    if (cls?.length) {
      const { data: cs } = await db.schema("mgmt").from("class_subjects")
        .select("subjects:subject_id(name)").eq("class_id", cls[0].id);
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
}));

/* GET /api/profiles/directory/teachers — instructors a learner can join.
 *
 * Onboarding renders these as browsable profile cards (search + grid), so the
 * payload now carries what a card shows: avatar, guide emoji, subjects,
 * approved school, the default class a learner would join, and how many
 * students/classes the teacher actually has — a learner can compare before
 * committing a request. Optional ?search= does a server-side pre-filter on
 * name/username; the client still narrows locally across school and subjects.
 */
router.get("/directory/teachers", authenticateToken, asyncHandler(async (req, res) => {
  let query = db.from("users")
    .select("id, full_name, username, avatar_url, guide_emoji, subjects")
    .eq("role", "instructor").eq("is_active", true)
    .order("full_name", { ascending: true }).limit(500);
  // .or() takes a comma-separated filter string, so strip characters that
  // would let a search term inject extra filters or wildcards of its own.
  const q = String(req.query.search || "").replace(/[%_,()]/g, " ").trim();
  if (q) query = query.or(`full_name.ilike.%${q}%,username.ilike.%${q}%`);

  const { data: teachers } = await query;
  const ids = (teachers || []).map((t) => t.id);

  let schoolByTeacher = {};
  if (ids.length) {
    const { data: links } = await db.from("school_teachers")
      .select("teacher_id, school_profiles ( name )").in("teacher_id", ids).eq("status", "approved");
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
    const { data: rooms } = await db.from("classrooms")
      .select("id, teacher_id, name, created_at").in("teacher_id", ids)
      .order("created_at", { ascending: true });
    const roomIds = (rooms || []).map((r) => r.id);
    (rooms || []).forEach((r) => {
      (statsByTeacher[r.teacher_id] ??= { students: new Set(), classes: 0 }).classes += 1;
      if (!classByTeacher[r.teacher_id]) classByTeacher[r.teacher_id] = r.name;
    });
    if (roomIds.length) {
      const { data: rolls } = await db.from("classroom_students")
        .select("classroom_id, user_id").in("classroom_id", roomIds).eq("status", "active");
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
}));

/* ── Teacher → school request + link status ───────────────────────────── */

// GET /api/profiles/me/school-link — the caller's school link + status.
router.get("/me/school-link", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const { data } = await db.from("school_teachers")
    .select("school_id, status, school_profiles ( name, logo_url )").eq("teacher_id", req.user.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  res200(res, data ? { school_id: data.school_id, status: data.status, name: data.school_profiles?.name, logo_url: data.school_profiles?.logo_url } : null);
}));

// POST /api/profiles/me/school-request { school_id } — request to join a school.
router.post("/me/school-request", authenticateToken, requireRole(["instructor", "admin"]), [body("school_id").notEmpty()], runValidation, asyncHandler(async (req, res) => {
  const { school_id } = req.body;
  const { data: school } = await db.from("school_profiles").select("id").eq("id", school_id).eq("is_active", true).maybeSingle();
  if (!school) return res404(res, "School not found");
  const { data, error } = await db.from("school_teachers").upsert({
    school_id, teacher_id: req.user.id, status: "pending", requested_at: new Date(),
  }, { onConflict: "school_id,teacher_id" }).select("status").single();
  if (error) throw new Error(error.message);
  res201(res, { status: data.status, message: "Request sent — awaiting school approval." });
}));

/* ── School admin: teacher join requests ──────────────────────────────── */

const ownsSchool = async (req, schoolId) => {
  const { data } = await db.from("school_profiles").select("id").eq("id", schoolId).eq("admin_user_id", req.user.id).maybeSingle();
  return !!data;
};

// GET /api/profiles/schools/:schoolId/teacher-requests?status=pending
router.get("/schools/:schoolId/teacher-requests", authenticateToken, requireRole(["school_admin", "admin"]), asyncHandler(async (req, res) => {
  if (!(await ownsSchool(req, req.params.schoolId))) return res403(res, "Not your school");
  const status = req.query.status || "pending";
  const { data } = await db.from("school_teachers")
    .select("id, teacher_id, status, requested_at, users ( full_name, email, avatar_url )")
    .eq("school_id", req.params.schoolId).eq("status", status).order("requested_at", { ascending: true });
  res200(res, (data || []).map((r) => ({ id: r.id, teacher_id: r.teacher_id, status: r.status, requested_at: r.requested_at, full_name: r.users?.full_name, email: r.users?.email, avatar_url: r.users?.avatar_url })));
}));

// POST /api/profiles/schools/:schoolId/teacher-requests/:teacherId  { decision }
router.post("/schools/:schoolId/teacher-requests/:teacherId", authenticateToken, requireRole(["school_admin", "admin"]), [body("decision").isIn(["approve", "reject"])], runValidation, asyncHandler(async (req, res) => {
  const { schoolId, teacherId } = req.params;
  if (!(await ownsSchool(req, schoolId))) return res403(res, "Not your school");
  const status = req.body.decision === "approve" ? "approved" : "rejected";
  const { error } = await db.from("school_teachers").update({ status, decided_at: new Date(), decided_by: req.user.id })
    .eq("school_id", schoolId).eq("teacher_id", teacherId);
  if (error) throw new Error(error.message);
  // On approval, carry the school onto the teacher's classrooms so their
  // students become school-owned going forward.
  if (status === "approved") await db.from("classrooms").update({ school_id: schoolId }).eq("teacher_id", teacherId).is("school_id", null);

  const { data: sch } = await db.from("school_profiles").select("name").eq("id", schoolId).maybeSingle();
  const { data: t } = await db.from("users").select("full_name, email").eq("id", teacherId).maybeSingle();
  const approvedT = status === "approved";
  notifyUser({
    userId: teacherId, type: "school_membership",
    title: approvedT ? `You've joined ${sch?.name || "the school"}` : `Request to join ${sch?.name || "the school"} declined`,
    content: approvedT ? `${sch?.name || "The school"} approved your request.` : `${sch?.name || "The school"} declined your request.`,
    email: t?.email ? { to: t.email, name: t.full_name, subject: approvedT ? `Approved: you've joined ${sch?.name}` : `Update on your school request`, heading: approvedT ? "Request approved 🎉" : "Request update", body: approvedT ? `<strong>${sch?.name}</strong> approved your request to join.` : `<strong>${sch?.name}</strong> declined your request to join.`, ctaUrl: process.env.INSTRUCTOR_FRONTEND_URL || undefined, ctaLabel: "Open dashboard →" } : null,
  });
  res200(res, { status });
}));

/* ── Learner → teacher request + link status ──────────────────────────── */

// GET /api/profiles/me/teacher-link — the learner's teacher membership.
router.get("/me/teacher-link", authenticateToken, asyncHandler(async (req, res) => {
  const { data } = await db.from("classroom_students")
    .select("status, classrooms ( teacher_id, name, users:teacher_id ( full_name ) )")
    .eq("user_id", req.user.id).in("status", ["pending", "active"])
    .order("requested_at", { ascending: false }).limit(1).maybeSingle();
  res200(res, data ? { status: data.status, teacher_id: data.classrooms?.teacher_id, teacher_name: data.classrooms?.users?.full_name, classroom_name: data.classrooms?.name } : null);
}));

// POST /api/profiles/me/teacher-request { teacher_id } — request to join a teacher.
router.post("/me/teacher-request", authenticateToken, [body("teacher_id").notEmpty()], runValidation, asyncHandler(async (req, res) => {
  const { teacher_id } = req.body;
  const { data: teacher } = await db.from("users").select("id").eq("id", teacher_id).eq("role", "instructor").maybeSingle();
  if (!teacher) return res404(res, "Teacher not found");
  const classroomId = await ensureDefaultClassroom(teacher_id);
  const { data: existing } = await db.from("classroom_students").select("id, status").eq("classroom_id", classroomId).eq("user_id", req.user.id).maybeSingle();
  if (existing) {
    if (existing.status === "removed") {
      await db.from("classroom_students").update({ status: "pending", requested_at: new Date() }).eq("id", existing.id);
      // Live badge: the teacher's nav count updates without polling.
      global.io?.to(`user:${teacher_id}`).emit("join-requests-changed", { classroomId });
    }
    return res200(res, { status: existing.status === "removed" ? "pending" : existing.status, message: "Request updated." });
  }
  const { error } = await db.from("classroom_students").insert({ classroom_id: classroomId, user_id: req.user.id, status: "pending", requested_at: new Date() });
  if (error) throw new Error(error.message);
  global.io?.to(`user:${teacher_id}`).emit("join-requests-changed", { classroomId });
  res201(res, { status: "pending", message: "Request sent — awaiting teacher approval." });
}));

/* ── Teacher: student join requests ───────────────────────────────────── */

// GET /api/profiles/teacher/join-requests — pending learners across my classes.
router.get("/teacher/join-requests", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const { data: classes } = await db.from("classrooms").select("id, name").eq("teacher_id", req.user.id);
  const ids = (classes || []).map((c) => c.id);
  if (!ids.length) return res200(res, []);
  const nameById = Object.fromEntries((classes || []).map((c) => [c.id, c.name]));
  const { data } = await db.from("classroom_students")
    .select("id, classroom_id, user_id, requested_at, users ( full_name, email, avatar_url )")
    .in("classroom_id", ids).eq("status", "pending").order("requested_at", { ascending: true });
  res200(res, (data || []).map((r) => ({ id: r.id, classroom_id: r.classroom_id, classroom_name: nameById[r.classroom_id], user_id: r.user_id, requested_at: r.requested_at, full_name: r.users?.full_name, email: r.users?.email, avatar_url: r.users?.avatar_url })));
}));

// POST /api/profiles/teacher/join-requests/:id { decision } — approve/reject.
router.post("/teacher/join-requests/:id", authenticateToken, requireRole(["instructor", "admin"]), [body("decision").isIn(["approve", "reject"])], runValidation, asyncHandler(async (req, res) => {
  // Load the request and verify the classroom is mine.
  const { data: reqRow } = await db.from("classroom_students")
    .select("id, classroom_id, user_id, classrooms ( teacher_id, school_id )").eq("id", req.params.id).maybeSingle();
  if (!reqRow) return res404(res, "Request not found");
  if (reqRow.classrooms?.teacher_id !== req.user.id) return res403(res, "Not your classroom");

  const { data: me } = await db.from("users").select("full_name").eq("id", req.user.id).maybeSingle();
  const { data: student } = await db.from("users").select("id, full_name, email").eq("id", reqRow.user_id).maybeSingle();
  const teacherName = me?.full_name || "Your teacher";

  global.io?.to(`user:${req.user.id}`).emit("join-requests-changed", { classroomId: reqRow.classroom_id });
  if (req.body.decision === "reject") {
    await db.from("classroom_students").update({ status: "removed" }).eq("id", reqRow.id);
    notifyUser({
      userId: reqRow.user_id, type: "class_membership",
      title: `Request to join ${teacherName}'s class declined`,
      content: `${teacherName} declined your request to join their class.`,
      email: student?.email ? { to: student.email, name: student.full_name, subject: "Update on your class request", heading: "Request update", body: `${teacherName} declined your request to join their class. You can choose another teacher anytime.`, ctaUrl: process.env.FRONTEND_URL || undefined, ctaLabel: "Open Akoro →" } : null,
    });
    return res200(res, { status: "removed" });
  }
  await db.from("classroom_students").update({ status: "active" }).eq("id", reqRow.id);
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
}));

export default router;
