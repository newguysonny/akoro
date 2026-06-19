/**
 * emails.js — Transactional email templates for Akoro auth events.
 *
 * All emails use inline styles + table layouts for maximum email-client
 * compatibility. Fire-and-forget callers should `.catch(() => {})`.
 */

import { createRequire } from "module";

const EMAIL_FROM = process.env.RESEND_FROM_EMAIL || "noreply@akoro.app";
const AMBER      = "#E8884A";
const AMBER_DARK = "#D4651E";
const INK        = "#1A1A2E";
const MUTED      = "#6B6B80";
const SUBTLE     = "#9490A0";
const BORDER     = "#EDE8E1";
const BG         = "#FAF8F5";

// ─── § Shared layout wrapper ──────────────────────────────────────────────────

function layout(bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Akoro</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${BG};min-height:100vh;">
  <tr><td align="center" style="padding:40px 16px;">
    <table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">

      <!-- Logo row -->
      <tr><td align="center" style="padding-bottom:28px;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="background:linear-gradient(135deg,${AMBER},${AMBER_DARK});border-radius:14px;width:44px;height:44px;text-align:center;vertical-align:middle;">
            <span style="font-size:22px;line-height:44px;">🎓</span>
          </td>
          <td style="padding-left:12px;vertical-align:middle;">
            <div style="font-size:22px;font-weight:800;color:${INK};line-height:1.1;">Akoro</div>
            <div style="font-size:11px;color:${SUBTLE};margin-top:1px;">Learning Platform</div>
          </td>
        </tr></table>
      </td></tr>

      <!-- Card -->
      <tr><td style="background:#fff;border-radius:20px;border:1px solid ${BORDER};
                     box-shadow:0 4px 32px rgba(0,0,0,.06);padding:36px 32px;">
        ${bodyContent}
      </td></tr>

      <!-- Footer -->
      <tr><td align="center" style="padding-top:24px;">
        <p style="margin:0;font-size:12px;color:${SUBTLE};">
          You're receiving this because you have an account at
          <a href="https://akoro.app" style="color:${AMBER};text-decoration:none;font-weight:600;">akoro.app</a>.
          &nbsp;·&nbsp;
          <a href="https://akoro.app" style="color:${SUBTLE};text-decoration:none;">Unsubscribe</a>
        </p>
        <p style="margin:8px 0 0;font-size:11px;color:#C4C0CC;">
          © ${new Date().getFullYear()} Akoro Learning Ltd. All rights reserved.
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function btn(label, url, color = AMBER) {
  return `<a href="${url}"
    style="display:inline-block;padding:13px 28px;
           background:linear-gradient(135deg,${color},${AMBER_DARK});
           color:#fff;border-radius:12px;text-decoration:none;
           font-weight:700;font-size:15px;letter-spacing:.01em;
           box-shadow:0 4px 14px ${color}55;">
    ${label}
  </a>`;
}

function infoRow(label, value) {
  return `<tr>
    <td style="padding:8px 14px;font-size:13px;font-weight:600;color:${MUTED};
               background:${BG};border-radius:6px 0 0 6px;white-space:nowrap;">${label}</td>
    <td style="padding:8px 14px;font-size:13px;color:${INK};background:${BG};
               border-radius:0 6px 6px 0;">${value}</td>
  </tr>`;
}

function alertBox(text, color = "#FEF2F2", borderColor = "#FECACA", textColor = "#DC2626") {
  return `<div style="background:${color};border:1px solid ${borderColor};border-radius:10px;
                      padding:12px 16px;margin:20px 0;font-size:13px;color:${textColor};font-weight:600;">
    ${text}
  </div>`;
}

// ─── § Resend helper ─────────────────────────────────────────────────────────

async function sendEmail({ to, subject, text, html }) {
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: `Akoro Learning <${EMAIL_FROM}>`,
    to:   Array.isArray(to) ? to : [to],
    subject,
    text,
    html,
  });
  if (error) throw new Error(`Email send failed: ${error.message}`);
}

// ─── § Templates ─────────────────────────────────────────────────────────────

/**
 * Welcome email — sent on email/password sign-up.
 */
export async function sendWelcomeEmail({ to, name, loginUrl, role = "student" }) {
  const greeting = name && name !== "there" ? `Hi ${name} 👋` : "Welcome aboard! 👋";
  const portalNote = role === "instructor"
    ? `<p style="font-size:14px;color:${MUTED};margin:0 0 20px;line-height:1.7;">
         You've joined as an <strong>instructor</strong>. Head to your dashboard to create
         courses, manage students, and run live battle quizzes.
       </p>`
    : `<p style="font-size:14px;color:${MUTED};margin:0 0 20px;line-height:1.7;">
         Your account is ready. Start exploring courses, practising with your AI tutor,
         and challenging friends to battle quizzes.
       </p>`;

  const html = layout(`
    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-size:48px;margin-bottom:12px;">🎉</div>
      <h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:${INK};">Welcome to Akoro!</h1>
      <p style="margin:0;font-size:16px;color:${MUTED};">${greeting}</p>
    </div>

    ${portalNote}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="padding:16px;background:${BG};border-radius:12px;border:1px solid ${BORDER};">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:13px;color:${MUTED};padding:6px 0;">
                <span style="font-size:18px;margin-right:8px;">📚</span>
                Access <strong style="color:${INK};">unlimited courses</strong> in your subject
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;color:${MUTED};padding:6px 0;">
                <span style="font-size:18px;margin-right:8px;">🤖</span>
                Chat with your personal <strong style="color:${INK};">AI tutor</strong>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;color:${MUTED};padding:6px 0;">
                <span style="font-size:18px;margin-right:8px;">⚡</span>
                Compete in <strong style="color:${INK};">live battle quizzes</strong>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="text-align:center;margin-bottom:28px;">
      ${btn("Get started →", loginUrl)}
    </div>

    <p style="font-size:13px;color:${SUBTLE};margin:0;text-align:center;line-height:1.6;">
      Questions? Reply to this email and we'll help you out.
    </p>
  `);

  await sendEmail({
    to,
    subject: "Welcome to Akoro 🎓",
    text: `${greeting}\n\nYour Akoro account is ready. Sign in here: ${loginUrl}\n\nQuestions? Just reply to this email.`,
    html,
  });
}

/**
 * Login alert — sent on every successful password or Google sign-in.
 */
export async function sendLoginAlertEmail({ to, name, ip, userAgent, time, signinUrl }) {
  const displayName = name && name !== "there" ? name : "there";
  const timeStr = time
    ? new Date(time).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) + " UTC"
    : new Date().toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) + " UTC";

  const html = layout(`
    <div style="margin-bottom:24px;">
      <div style="display:inline-block;background:#E8F5E9;border-radius:50%;width:52px;height:52px;
                  text-align:center;line-height:52px;font-size:26px;margin-bottom:16px;">🔐</div>
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:${INK};">New sign-in detected</h1>
      <p style="margin:0;font-size:14px;color:${MUTED};">Hi ${displayName}, your Akoro account was just signed into.</p>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0"
           style="border-collapse:separate;border-spacing:0 4px;margin-bottom:24px;">
      ${infoRow("When",    timeStr)}
      ${infoRow("IP",      ip    || "Unknown")}
      ${infoRow("Device",  userAgent ? userAgent.split(" ").slice(0, 4).join(" ") : "Unknown")}
    </table>

    ${alertBox(
      "⚠️  <strong>Wasn't you?</strong> Secure your account immediately — reset your password.",
      "#FFF7ED", "#FED7AA", "#92400E"
    )}

    <div style="text-align:center;margin:24px 0;">
      ${btn("Reset my password", signinUrl)}
    </div>

    <p style="font-size:13px;color:${SUBTLE};margin:0;text-align:center;line-height:1.6;">
      If this was you, no action is needed. You can safely ignore this email.
    </p>
  `);

  await sendEmail({
    to,
    subject: "New sign-in to your Akoro account",
    text: `Hi ${displayName},\n\nYour Akoro account was signed into at ${timeStr} from IP ${ip || "unknown"}.\n\nIf this wasn't you, reset your password: ${signinUrl}\n\nIf this was you, ignore this email.`,
    html,
  });
}

/**
 * Password reset request — rich replacement for the basic one in routes.js.
 */
export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const displayName = name && name !== "there" ? name : "there";

  const html = layout(`
    <div style="margin-bottom:24px;">
      <div style="display:inline-block;background:#FFF7ED;border-radius:50%;width:52px;height:52px;
                  text-align:center;line-height:52px;font-size:26px;margin-bottom:16px;">🔑</div>
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:${INK};">Reset your password</h1>
      <p style="margin:0;font-size:14px;color:${MUTED};">Hi ${displayName}, we received a request to reset your Akoro password.</p>
    </div>

    <p style="font-size:14px;color:${MUTED};margin:0 0 24px;line-height:1.7;">
      Click the button below to choose a new password. This link is valid for
      <strong style="color:${INK};">1 hour</strong> and can only be used once.
    </p>

    <div style="text-align:center;margin-bottom:28px;">
      ${btn("Reset my password", resetUrl)}
    </div>

    <p style="font-size:12px;color:${SUBTLE};margin:0 0 8px;">
      Or copy and paste this URL into your browser:
    </p>
    <p style="font-size:12px;color:${AMBER};word-break:break-all;margin:0 0 24px;">
      <a href="${resetUrl}" style="color:${AMBER};text-decoration:none;">${resetUrl}</a>
    </p>

    ${alertBox(
      "🔒 <strong>Didn't request this?</strong> Your password is safe — simply ignore this email and nothing will change.",
      "#F0FDF4", "#BBF7D0", "#15803D"
    )}
  `);

  await sendEmail({
    to,
    subject: "Reset your Akoro password",
    text: `Hi ${displayName},\n\nReset your Akoro password here (valid 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email — your password won't change.`,
    html,
  });
}

/**
 * Password changed confirmation — sent after a successful reset or change.
 */
export async function sendPasswordChangedEmail({ to, name, ip, signinUrl }) {
  const displayName = name && name !== "there" ? name : "there";
  const timeStr = new Date().toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) + " UTC";

  const html = layout(`
    <div style="margin-bottom:24px;">
      <div style="display:inline-block;background:#F0FDF4;border-radius:50%;width:52px;height:52px;
                  text-align:center;line-height:52px;font-size:26px;margin-bottom:16px;">✅</div>
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:${INK};">Password changed</h1>
      <p style="margin:0;font-size:14px;color:${MUTED};">Hi ${displayName}, your Akoro password was successfully updated.</p>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0"
           style="border-collapse:separate;border-spacing:0 4px;margin-bottom:24px;">
      ${infoRow("When", timeStr)}
      ${ip ? infoRow("IP",   ip) : ""}
    </table>

    <p style="font-size:14px;color:${MUTED};margin:0 0 24px;line-height:1.7;">
      You've been signed out on all devices. Sign back in with your new password whenever you're ready.
    </p>

    <div style="text-align:center;margin-bottom:28px;">
      ${btn("Sign in now", signinUrl)}
    </div>

    ${alertBox(
      "⚠️ <strong>Didn't make this change?</strong> Contact us immediately — reply to this email.",
      "#FFF7ED", "#FED7AA", "#92400E"
    )}
  `);

  await sendEmail({
    to,
    subject: "Your Akoro password has been changed",
    text: `Hi ${displayName},\n\nYour Akoro password was changed at ${timeStr}${ip ? ` from IP ${ip}` : ""}.\n\nIf this was you, sign in here: ${signinUrl}\n\nIf this wasn't you, reply to this email immediately.`,
    html,
  });
}
