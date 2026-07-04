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
import { authenticateToken, requireRole, endSession } from "../auth/routes.js";
import multerLib                           from "multer";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

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
      .select("id, teacher_id, name, student_limit, is_upgraded")
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
            educationLevels, ownershipType, curriculum } = req.body;

    const { data, error } = await db
      .from("school_profiles")
      .insert({
        admin_user_id: req.user.id,
        name,
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
        is_active:     true,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Update user role to school_admin
    await db.from("users").update({ role: "school_admin" }).eq("id", req.user.id);

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

    // Link teacher to school
    await db.from("school_teachers").upsert({
      school_id:  schoolId,
      teacher_id: teacherUser.id,
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
  "id","email","username","full_name","avatar_url","phone","role",
  "country","school_name","school_type","year_group","study_level",
  "language","display_mode","accent_color","teaching_guide","guide_emoji",
  "subjects","two_factor_enabled","onboarding_completed","created_at",
].join(",");

// Fallback select without columns added by pending migrations
const PROFILE_SELECT_BASE = [
  "id","email","username","full_name","avatar_url","phone","role",
  "country","school_name","school_type","year_group","study_level",
  "language","display_mode","accent_color","teaching_guide","guide_emoji",
  "subjects","two_factor_enabled","created_at",
].join(",");

/** GET /api/profiles/me — full profile + agent + notification prefs */
router.get("/me", authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  let [{ data: user, error: userErr }, { data: agent }, { data: notif }] = await Promise.all([
    db.from("users").select(PROFILE_SELECT).eq("id", userId).maybeSingle(),
    db.from("user_agents").select("*").eq("user_id", userId).eq("is_active", true).maybeSingle(),
    db.from("user_notification_preferences").select("*").eq("user_id", userId).maybeSingle(),
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
    phone:           user.phone,
    role:            user.role,
    country:         user.country,
    schoolName:      user.school_name,
    schoolType:      user.school_type,
    yearGroup:       user.year_group,
    studyLevel:      user.study_level,
    language:        user.language        || "English",
    displayMode:     user.display_mode    || "system",
    accentColor:     user.accent_color    || "#6C3BFF",
    teachingGuide:   user.teaching_guide,
    guideEmoji:      user.guide_emoji,
    subjects:        user.subjects        || [],
    twoFactorEnabled:user.two_factor_enabled || false,
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

/** PATCH /api/profiles/me — update user profile fields */
router.patch("/me", authenticateToken, [
  body("fullName").optional().trim().isLength({ min: 1, max: 120 }),
  body("username").optional().trim().isLength({ min: 3, max: 40 }).matches(/^[a-zA-Z0-9_]+$/),
  body("phone").optional().trim(),
  body("country").optional().trim(),
  body("schoolName").optional().trim(),
  body("schoolType").optional().trim(),
  body("yearGroup").optional().trim(),
  body("studyLevel").optional().trim(),
  body("language").optional().trim(),
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
    fullName, username, phone, country, schoolName, schoolType,
    yearGroup, studyLevel, language, displayMode, accentColor,
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
  if (country        !== undefined) patch.country          = country;
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
  if (twoFactorEnabled !== undefined) patch.two_factor_enabled = twoFactorEnabled;
  if (onboardingCompleted !== undefined) patch.onboarding_completed = onboardingCompleted;
  patch.updated_at = new Date().toISOString();

  const { data: updated, error } = await db.from("users")
    .update(patch).eq("id", userId).select(PROFILE_SELECT).maybeSingle();

  if (error) {
    console.error("[profiles/me PATCH]", error.message);
    return res.status(500).json({ success: false, message: "Failed to update profile" });
  }

  res200(res, {
    fullName: updated.full_name,
    username: updated.username,
    accentColor: updated.accent_color,
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

  // Filter to specific course if requested
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
 * Generate a signed invite link for a course.
 * Student opens link → auto-enrolled + account created if needed.
 * URL format: https://akoro.app/join/:token
 */
router.post("/teacher/invite", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const { course_id, course_ids, expires_in_days = 7, send_to_emails = [] } = req.body;

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

  const jwt = await import("jsonwebtoken");
  const token = jwt.default.sign(
    // Encode all course IDs; keep courseId for back-compat with older redeemers.
    { courseIds, courseId: courseIds[0], teacherId: req.user.id, type: "course_invite" },
    process.env.JWT_SECRET ?? "akoro-dev-secret",
    { expiresIn: `${expires_in_days}d` }
  );

  const inviteUrl = `https://akoro.app/join/${token}`;
  const course = { title: courseTitle };

  // Optionally send invite emails
  const emailResults = [];
  if (send_to_emails.length > 0) {
    try {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT ?? "587"),
        secure: process.env.SMTP_PORT === "465",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      const { data: teacher } = await db.from("users").select("full_name").eq("id", req.user.id).single();
      for (const email of send_to_emails) {
        await transport.sendMail({
          from:    `"Akoro Learning" <${process.env.SMTP_FROM_EMAIL ?? "noreply@akoro.app"}>`,
          to:      email,
          subject: `You're invited to join "${course.title}" on Akoro`,
          html:    `<div style="font-family:sans-serif;max-width:520px"><h2>You're invited! 🎓</h2><p><strong>${teacher?.full_name ?? "A teacher"}</strong> has invited you to join <strong>${course.title}</strong> on Akoro Learning.</p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#E8884A;color:#fff;border-radius:100px;text-decoration:none;font-weight:700">Join course →</a><p style="color:#999;font-size:12px;margin-top:16px">Link expires in ${expires_in_days} days.</p></div>`,
        });
        emailResults.push({ email, sent: true });
      }
    } catch (e) {
      console.warn("[profiles/invite] Email send failed:", e.message);
    }
  }

  res201(res, {
    invite_url:    inviteUrl,
    course_title:  course.title,
    expires_in_days,
    emails_sent:   emailResults.filter((r) => r.sent).length,
  });
}));

/**
 * POST /api/auth/invite-redeem
 * Student redeems an invite link token → enrolled in course.
 * Called by the frontend at https://akoro.app/join/:token
 */
router.post("/invite-redeem", authenticateToken, asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) return res400(res, "token is required");

  let payload;
  try {
    const jwt = await import("jsonwebtoken");
    payload = jwt.default.verify(token, process.env.JWT_SECRET ?? "akoro-dev-secret");
  } catch (e) {
    return res400(res, "Invalid or expired invite link");
  }

  if (payload.type !== "course_invite") return res400(res, "Invalid token type");

  const userId    = req.user.id;
  // Support both new multi-course tokens and old single-course tokens.
  const courseIds = [...new Set(
    (Array.isArray(payload.courseIds) && payload.courseIds.length ? payload.courseIds : [payload.courseId]).filter(Boolean)
  )];
  if (!courseIds.length) return res400(res, "Invalid invite link");

  const { data: existingRows } = await db.from("enrollments")
    .select("course_id, status").eq("user_id", userId).in("course_id", courseIds);
  const activeSet = new Set((existingRows ?? []).filter(r => r.status === "active").map(r => r.course_id));

  // Enrol in every course the student isn't already active in.
  const toEnrol = courseIds.filter(id => !activeSet.has(id));
  if (!toEnrol.length) return res400(res, "Already enrolled");

  for (const id of toEnrol) {
    await db.from("enrollments").upsert(
      { user_id: userId, course_id: id, status: "active" },
      { onConflict: "user_id,course_id" }
    );
    try { await db.rpc("increment_course_students", { course_id_input: id }); } catch {}
  }

  const { data: courses } = await db.from("courses").select("id, title").in("id", toEnrol);
  const titles = (courses ?? []).map(c => c.title);
  const label  = titles.length === 1 ? `"${titles[0]}"` : `${titles.length} courses`;

  // Notify the student, and the teacher that someone joined via their link.
  const { data: student } = await db.from("users").select("full_name, email").eq("id", userId).single();
  try {
    const { error: notifErr } = await db.from("notifications").insert([
      {
        user_id:    userId,
        type:       "enrolled_in_course",
        title:      `You're enrolled in ${label}`,
        content:    `You joined via an invite link`,
        related_id: toEnrol[0],
      },
      ...(payload.teacherId ? [{
        user_id:    payload.teacherId,
        type:       "student_enrolled",
        title:      `${student?.full_name || student?.email || "A student"} joined`,
        content:    `Joined ${label} via invite link`,
        related_id: toEnrol[0],
      }] : []),
    ]);
    if (notifErr) console.warn("[notify] invite-redeem insert failed:", notifErr.message);
  } catch (e) {
    console.warn("[notify] invite-redeem insert threw:", e.message);
  }

  res200(res, { enrolled: true, course_ids: toEnrol, course_titles: titles });
}));

/**
 * POST /api/profiles/teacher/students/import
 * Bulk CSV import: parse rows, auto-create accounts, enrol in course.
 * Multipart form: csv file + course_id
 * CSV format: name, email, phone, course (last column optional — overrides course_id param)
 */

router.post("/teacher/students/import", authenticateToken, requireRole(["instructor", "admin"]), (req, res, next) => {
  const upload = multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }).single("csv");
  upload(req, res, async (err) => {
    if (err) return res400(res, `Upload error: ${err.message}`);
    if (!req.file) return res400(res, "CSV file is required");

    const { course_id } = req.body;
    if (!course_id) return res400(res, "course_id is required");

    // Verify teacher owns the course
    const { data: course } = await db.from("courses").select("id, title, instructor_id").eq("id", course_id).single();
    if (!course || course.instructor_id !== req.user.id) return res403(res, "Not your course");

    // Parse CSV (simple split — handles standard comma-separated CSVs)
    const text = req.file.buffer.toString("utf-8");
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return res400(res, "CSV must have a header row and at least one data row");

    // Detect header and skip it
    const header = lines[0].toLowerCase();
    const dataLines = header.includes("name") ? lines.slice(1) : lines;

    const results = { created: 0, existing: 0, failed: 0, rows: [] };

    for (const line of dataLines) {
      const cols = line.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
      const [name, email, phone] = cols;
      if (!name || !email) { results.failed++; continue; }

      try {
        const { user, isNew, tempPassword } = await findOrCreateStudent(name, email, phone || null);

        // Get classroom linked to this course (or add directly to enrollment)
        const { data: classroom } = await db.from("classrooms")
          .select("id").eq("teacher_id", req.user.id).limit(1).single();

        if (classroom) {
          await db.from("classroom_students").upsert(
            { classroom_id: classroom.id, user_id: user.id, status: "active" },
            { onConflict: "classroom_id,user_id" }
          );
        }

        // Enrol in course
        await db.from("enrollments").upsert(
          { user_id: user.id, course_id, status: "active" },
          { onConflict: "user_id,course_id" }
        );
        try { await db.rpc("increment_course_students", { course_id_input: course_id }); } catch {}

        // Recipient side — notify the student they were enrolled.
        try {
          const { error: notifErr } = await db.from("notifications").insert({
            user_id:    user.id,
            type:       "enrolled_in_course",
            title:      `You're enrolled in "${course.title}"`,
            content:    `You've been added to this course`,
            related_id: course_id,
          });
          if (notifErr) console.warn("[notify] CSV enrol insert failed:", notifErr.message);
        } catch (e) {
          console.warn("[notify] CSV enrol insert threw:", e.message);
        }

        // Send welcome email for new accounts
        if (isNew && tempPassword) {
          const { data: teacher } = await db.from("users").select("full_name").eq("id", req.user.id).single();
          await sendWelcomeCredentials({
            user, tempPassword, classroomName: course.title,
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
      course_title:   course.title,
      total_rows:     dataLines.length,
      accounts_created: results.created,
      already_existed: results.existing,
      failed:          results.failed,
      rows:            results.rows,
    });
  });
});

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

export default router;
