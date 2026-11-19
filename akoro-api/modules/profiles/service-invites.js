/**
 * Course-invite orchestration: signed invite links, the public preview and the
 * signed-in learner's idempotent redemption.
 */
import { urlFor } from "../../lib/urls.js";
import { INVITE_MAX_DAYS, signCourseInvite, verifyCourseInvite } from "../auth/index.js";
import { res200, res201, res400, res403 } from "./http.js";
import { escHtml, normaliseInviteEmails } from "./rules.js";
import * as invites from "./store-invites.js";
import * as users from "./store-users.js";

const LEARNER_APP_URL = () => urlFor("FRONTEND_URL");

/**
 * POST /api/profiles/teacher/invite
 * A signed invite link into the teacher's own courses (one or several). The
 * learner opens it in the learner app at FRONTEND_URL/join/:token, signs in or
 * up, and redeems it (POST /api/profiles/invite/redeem). The token is a typed
 * `course_invite` signed by the auth module's key — it never signs anyone in.
 */
export async function createInvite(req, res) {
  const { course_id, course_ids, send_to_emails = [] } = req.body;
  const expires_in_days = Math.min(INVITE_MAX_DAYS, Math.max(1, Math.round(Number(req.body.expires_in_days) || 7)));

  // Accept a single course_id (back-compat) or a course_ids array (multi-course).
  const requestedIds = [...new Set(
    (Array.isArray(course_ids) && course_ids.length ? course_ids : [course_id]).filter(Boolean)
  )];
  if (!requestedIds.length) return res400(res, "course_id or course_ids is required");

  // Verify the teacher owns every requested course.
  const { data: ownedCourses } = await invites.listCoursesOwnedByIds(requestedIds, req.user.id);

  const owned = ownedCourses ?? [];
  if (owned.length !== requestedIds.length)
    return res403(res, "One or more courses are not yours");

  const courseIds   = owned.map((c) => c.id);
  const courseTitle = owned.length === 1 ? owned[0].title : `${owned.length} courses`;

  const token     = signCourseInvite({ teacherId: req.user.id, courseIds }, expires_in_days);
  const inviteUrl = `${LEARNER_APP_URL()}/join/${token}`;

  // Optionally send invite emails
  const emails = normaliseInviteEmails(send_to_emails);
  const emailResults = [];
  if (emails.length > 0) {
    try {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT ?? "587"),
        secure: process.env.SMTP_PORT === "465",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      const { data: teacher } = await users.getUserFullName(req.user.id);
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
}

/** The invite's courses still owned by the teacher who signed it (a course handed on since drops out). */
async function inviteCourses(invite) {
  const { data } = await invites.listCoursesOwnedByInvite(invite);
  return data ?? [];
}

/**
 * GET /api/profiles/invite/:token — public: what the join page shows before
 * sign-in (course titles, teacher name, expiry). Only what the teacher put in
 * the link; an invalid, expired or non-invite token is 400.
 */
export async function previewInvite(req, res) {
  const invite = verifyCourseInvite(req.params.token);
  if (!invite) return res400(res, "Invalid or expired invite link");
  const courses = await inviteCourses(invite);
  if (!courses.length) return res400(res, "Invalid or expired invite link");
  const { data: teacher } = await users.getUserFullNameMaybe(invite.teacherId);
  res200(res, { courses, teacher_name: teacher?.full_name ?? null, expires_at: invite.expiresAt });
}

/**
 * POST /api/profiles/invite/redeem  { token }
 * The signed-in learner joins every course in the invite. Idempotent: courses
 * they are already active in are skipped and listed in already_enrolled.
 */
export async function redeemInvite(req, res) {
  const invite = verifyCourseInvite(req.body?.token);
  if (!invite) return res400(res, "Invalid or expired invite link");
  const userId = req.user.id;
  if (userId === invite.teacherId) return res400(res, "This is your own invite link");
  const courses = await inviteCourses(invite);
  if (!courses.length) return res400(res, "Invalid or expired invite link");
  const ids = courses.map((c) => c.id);

  const { data: existingRows } = await invites.listEnrollmentSeats(userId, ids);
  const activeSet = new Set((existingRows ?? []).filter((r) => r.status === "active").map((r) => r.course_id));
  const toEnrol = ids.filter((id) => !activeSet.has(id));

  for (const id of toEnrol) {
    const { error } = await invites.upsertEnrollment(userId, id);
    if (error) throw error;
    try { await invites.incrementCourseStudents(id); } catch {}
  }

  const titles = courses.filter((c) => toEnrol.includes(c.id)).map((c) => c.title);
  if (toEnrol.length) {
    const label = titles.length === 1 ? `"${titles[0]}"` : `${titles.length} courses`;
    const { data: student } = await users.getUserContactMaybe(userId);
    try {
      const { error: notifErr } = await users.insertNotifications([
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
}
