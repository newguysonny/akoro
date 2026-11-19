/**
 * Roster orchestration: auto-created learner accounts, the teacher's default
 * classroom, the school SIS mirror and welcome credentials.
 */
import bcrypt from "bcrypt";
import crypto from "crypto";

import { TEMP_PASSWORD_LENGTH } from "./rules.js";
import * as teaching from "./store-teaching.js";
import * as users from "./store-users.js";

/**
 * getTeacherApprovedSchoolId — the school a teacher has been approved into
 * (or null). Ownership flows from here: a teacher's students belong to it.
 */
export const getTeacherApprovedSchoolId = async (teacherId) => {
  const { data } = await teaching.getApprovedSchoolId(teacherId);
  return data?.school_id ?? null;
};

/**
 * findOrCreateStudent
 * Given a name + email (or phone), returns an existing user or creates a new one.
 * New accounts get a temp password and a "must_change_password" flag.
 * Returns { user, isNew, tempPassword }
 */
export const findOrCreateStudent = async (name, email, phone = null) => {
  // Check existing
  const { data: existing } = await users.findUserForStudent(email, phone);
  if (existing) return { user: existing, isNew: false, tempPassword: null };

  // Generate temp password
  const tempPassword   = crypto.randomBytes(TEMP_PASSWORD_LENGTH).toString("base64").slice(0, TEMP_PASSWORD_LENGTH);
  const passwordHash   = await bcrypt.hash(tempPassword, 10);

  const safeEmail      = email?.toLowerCase().trim() ?? null;
  const username       = (safeEmail?.split("@")[0] ?? `user${Date.now()}`).replace(/[^a-zA-Z0-9_]/g, "_");

  const { data: user, error } = await users.insertStudentUser({
    email:                safeEmail,
    username:             `${username}_${Math.floor(Math.random() * 9000) + 1000}`,
    password_hash:        passwordHash,
    full_name:            name,
    phone:                phone ?? null,
    role:                 "student",
    is_active:            true,
    must_change_password: true,
  });

  if (error) throw new Error(`Failed to create student account: ${error.message}`);

  return { user, isNew: true, tempPassword };
};

/**
 * ensureDefaultClassroom — a teacher's first classroom, created on demand.
 * Carries the teacher's approved school_id so classroom_students are
 * transitively school-owned.
 */
export const ensureDefaultClassroom = async (teacherId) => {
  const { data: existing } = await teaching.getFirstClassroomWithSchool(teacherId);
  const schoolId = await getTeacherApprovedSchoolId(teacherId);
  if (existing) {
    if (schoolId && !existing.school_id) await teaching.updateClassroom(existing.id, { school_id: schoolId });
    return existing.id;
  }
  const { data: created, error } = await teaching.insertClassroom({ teacher_id: teacherId, school_id: schoolId, name: "My Class" });
  if (error) throw new Error(error.message);
  return created.id;
};

/**
 * ensureSisRecord — mirror a platform student into the school's SIS roster
 * (mgmt.students) so teacher-added students also appear in the school's
 * Student Information module. No-op if the teacher has no approved school or
 * the student is already rostered. `created_by` records the teacher.
 */
export const ensureSisRecord = async (schoolId, user, teacherId) => {
  if (!schoolId || !user?.id) return;
  const { data: exists } = await teaching.findSisStudent(schoolId, user.id);
  if (exists) return;
  const parts = (user.full_name || "").trim().split(/\s+/);
  const first = parts.shift() || (user.email?.split("@")[0] ?? "Student");
  const last = parts.join(" ") || first;
  const admission_no = `T-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
  await teaching.insertSisStudent({
    school_id: schoolId, user_id: user.id, created_by: teacherId,
    admission_no, first_name: first, last_name: last, status: "active",
  });
};

/**
 * sendWelcomeCredentials
 * Sends the new student their login credentials via email/SMS.
 */
export const sendWelcomeCredentials = async ({ user, tempPassword, classroomName, teacherName, isNew }) => {
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
