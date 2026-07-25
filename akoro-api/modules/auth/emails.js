/**
 * emails.js — Transactional email templates for Akoro auth events.
 *
 * All emails use inline styles + table layouts for maximum email-client
 * compatibility. Fire-and-forget callers should `.catch(() => {})`.
 */

const EMAIL_FROM = process.env.RESEND_FROM_EMAIL || "noreply@akoro.app";

// Public base that serves the app's static logo assets (akoro-learner/public).
// Uses the frontend URL (FRONTEND_URL) since that deployment serves /logo/*;
// override with EMAIL_ASSET_BASE if the logo is hosted elsewhere.
const ASSET_BASE = (process.env.EMAIL_ASSET_BASE || process.env.FRONTEND_URL || "https://akoro.app").replace(/\/+$/, "");
const LOGO_URL   = `${ASSET_BASE}/logo/akoro-dark-180.png`; // the app icon (same mark used in-app)

// ─── Design tokens ────────────────────────────────────────────────────────────
const AMBER   = "#E8884A";
const INK     = "#17161C"; // headings
const BODY    = "#4B4956"; // paragraph text
const MUTED   = "#6B6976"; // secondary
const SUBTLE  = "#9A97A3"; // meta / footer
const BORDER  = "#E9E7E2"; // card + divider
const DIVIDER = "#F0EFEC";
const BG      = "#F4F3F1"; // page background
const FONT    = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// ─── § Shared layout wrapper ──────────────────────────────────────────────────

function layout(bodyContent, preheader = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<title>Akoro</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT};-webkit-font-smoothing:antialiased;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};font-size:1px;line-height:1px;">${preheader}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" style="max-width:480px;" cellpadding="0" cellspacing="0">

      <!-- Brand -->
      <tr><td style="padding:4px 4px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;">
            <img src="${LOGO_URL}" width="30" height="30" alt="Akoro"
                 style="display:block;border-radius:8px;width:30px;height:30px;" />
          </td>
          <td style="padding-left:10px;vertical-align:middle;">
            <span style="font-size:16px;font-weight:700;color:${INK};letter-spacing:-.01em;">Akoro</span>
          </td>
        </tr></table>
      </td></tr>

      <!-- Card -->
      <tr><td style="background:#fff;border-radius:16px;border:1px solid ${BORDER};padding:40px 36px;">
        ${bodyContent}
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:24px 8px 4px;">
        <p style="margin:0 0 6px;font-size:12px;color:${SUBTLE};line-height:1.6;">
          You're receiving this because you have an account at
          <a href="https://akoro.app" style="color:${MUTED};text-decoration:none;font-weight:600;">akoro.app</a>.
        </p>
        <p style="margin:0;font-size:12px;color:#C2BFC9;line-height:1.6;">
          © ${new Date().getFullYear()} Akoro Learning Ltd
          &nbsp;·&nbsp;
          <a href="https://akoro.app" style="color:#C2BFC9;text-decoration:underline;">Unsubscribe</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// Small uppercase context label above a heading.
function eyebrow(text, color = AMBER) {
  return `<div style="font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${color};margin:0 0 12px;">${text}</div>`;
}

// Bulletproof, solid CTA button (table-based so Outlook honours the padding).
function btn(label, url, color = AMBER) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
    <td align="center" style="background:${color};border-radius:10px;">
      <a href="${url}" style="display:inline-block;padding:13px 26px;color:#fff;text-decoration:none;
             font-family:${FONT};font-weight:600;font-size:15px;letter-spacing:.01em;border-radius:10px;">${label}</a>
    </td>
  </tr></table>`;
}

// Key/value detail row with a hairline divider (used for sign-in / change meta).
function infoRow(label, value) {
  return `<tr>
    <td style="padding:11px 0;font-size:13px;color:${MUTED};border-bottom:1px solid ${DIVIDER};white-space:nowrap;">${label}</td>
    <td align="right" style="padding:11px 0;font-size:13px;font-weight:600;color:${INK};border-bottom:1px solid ${DIVIDER};">${value}</td>
  </tr>`;
}

// Callout with a left accent bar (neutral, informational, or warning tints).
function alertBox(text, bg = "#FBF6F1", accent = AMBER, textColor = BODY) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;">
    <tr><td style="background:${bg};border-left:3px solid ${accent};border-radius:8px;
                   padding:13px 16px;font-size:13px;line-height:1.6;color:${textColor};">${text}</td></tr>
  </table>`;
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
  const greeting = name && name !== "there" ? `Hi ${name},` : "Welcome aboard,";
  const intro = role === "instructor"
    ? "You've joined as an instructor. Head to your dashboard to create courses, manage students and run live battle quizzes."
    : "Your account is ready. Start exploring courses, practising with your AI tutor and challenging friends to battle quizzes.";

  const feature = (title, desc) => `<tr>
    <td style="padding:12px 0;border-bottom:1px solid ${DIVIDER};">
      <div style="font-size:14px;font-weight:600;color:${INK};margin:0 0 2px;">${title}</div>
      <div style="font-size:13px;color:${MUTED};line-height:1.5;">${desc}</div>
    </td></tr>`;

  const html = layout(`
    ${eyebrow("Welcome to Akoro")}
    <h1 style="margin:0 0 10px;font-size:24px;font-weight:700;color:${INK};letter-spacing:-.02em;">You're all set${name && name !== "there" ? `, ${name}` : ""}.</h1>
    <p style="font-size:15px;color:${BODY};margin:0 0 24px;line-height:1.65;">${intro}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      ${feature("Unlimited courses", "Learn any subject at your own pace.")}
      ${feature("Your personal AI tutor", "Ask questions and get instant explanations.")}
      ${feature("Live battle quizzes", "Compete with friends and climb the ranks.")}
    </table>

    <div style="text-align:center;margin:0 0 8px;">${btn("Get started", loginUrl)}</div>
  `, "Your Akoro account is ready.");

  await sendEmail({
    to,
    subject: "Welcome to Akoro",
    text: `${greeting}\n\nYour Akoro account is ready. Sign in here: ${loginUrl}\n\nQuestions? Just reply to this email.`,
    html,
  });
}

/**
 * Login alert — sent on every successful password or Google sign-in.
 */
export async function sendLoginAlertEmail({ to, name, ip, userAgent, time, signinUrl }) {
  const displayName = name && name !== "there" ? name : "there";
  const timeStr = (time ? new Date(time) : new Date())
    .toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) + " UTC";

  const html = layout(`
    ${eyebrow("Security")}
    <h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:${INK};letter-spacing:-.02em;">New sign-in to your account</h1>
    <p style="font-size:15px;color:${BODY};margin:0 0 22px;line-height:1.65;">Hi ${displayName}, your Akoro account was just signed into. Here are the details:</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;">
      ${infoRow("When",   timeStr)}
      ${infoRow("IP",     ip || "Unknown")}
      ${infoRow("Device", userAgent ? userAgent.split(" ").slice(0, 4).join(" ") : "Unknown")}
    </table>

    ${alertBox(
      "<strong style='color:#92400E;'>Wasn't you?</strong> Secure your account now by resetting your password.",
      "#FEF9F1", "#F0A94E", BODY
    )}

    <div style="text-align:center;margin:22px 0 8px;">${btn("Reset my password", signinUrl)}</div>
    <p style="font-size:13px;color:${SUBTLE};margin:16px 0 0;line-height:1.6;">If this was you, no action is needed — you can safely ignore this email.</p>
  `, "New sign-in to your Akoro account.");

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
    ${eyebrow("Password reset")}
    <h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:${INK};letter-spacing:-.02em;">Reset your password</h1>
    <p style="font-size:15px;color:${BODY};margin:0 0 24px;line-height:1.65;">
      Hi ${displayName}, we received a request to reset your Akoro password. Choose a new one below — this link is valid for
      <strong style="color:${INK};">1 hour</strong> and can only be used once.
    </p>

    <div style="text-align:center;margin:0 0 24px;">${btn("Reset my password", resetUrl)}</div>

    <p style="font-size:12px;color:${SUBTLE};margin:0 0 6px;">Or paste this link into your browser:</p>
    <p style="font-size:12px;margin:0 0 4px;word-break:break-all;"><a href="${resetUrl}" style="color:${AMBER};text-decoration:none;">${resetUrl}</a></p>

    ${alertBox(
      `<strong style='color:${INK};'>Didn't request this?</strong> Your password is safe — just ignore this email and nothing will change.`,
      "#F5F4F2", "#D8D5CF", MUTED
    )}
  `, "Reset your Akoro password.");

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
    ${eyebrow("Password changed", "#16A34A")}
    <h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:${INK};letter-spacing:-.02em;">Your password was changed</h1>
    <p style="font-size:15px;color:${BODY};margin:0 0 22px;line-height:1.65;">Hi ${displayName}, this confirms your Akoro password was successfully updated. You've been signed out on all devices.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;">
      ${infoRow("When", timeStr)}
      ${ip ? infoRow("IP", ip) : ""}
    </table>

    <div style="text-align:center;margin:24px 0 8px;">${btn("Sign in", signinUrl)}</div>

    ${alertBox(
      "<strong style='color:#92400E;'>Didn't make this change?</strong> Contact us immediately by replying to this email.",
      "#FEF9F1", "#F0A94E", BODY
    )}
  `, "Your Akoro password has been changed.");

  await sendEmail({
    to,
    subject: "Your Akoro password has been changed",
    text: `Hi ${displayName},\n\nYour Akoro password was changed at ${timeStr}${ip ? ` from IP ${ip}` : ""}.\n\nIf this was you, sign in here: ${signinUrl}\n\nIf this wasn't you, reply to this email immediately.`,
    html,
  });
}

/**
 * Generic notification email — used for approval decisions and similar
 * one-off messages. Optional CTA button.
 */
export async function sendNotificationEmail({ to, name, subject, heading, body, ctaUrl, ctaLabel }) {
  const greeting = name && name !== "there" ? `Hi ${name},` : "Hi,";
  const html = layout(`
    ${eyebrow("Notification")}
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${INK};letter-spacing:-.02em;">${heading}</h1>
    <p style="font-size:14px;color:${MUTED};margin:0 0 10px;">${greeting}</p>
    <p style="font-size:15px;color:${BODY};margin:0 0 24px;line-height:1.65;">${body}</p>
    ${ctaUrl ? `<div style="text-align:center;margin:0 0 8px;">${btn(ctaLabel || "Open Akoro", ctaUrl)}</div>` : ""}
  `, heading);
  await sendEmail({ to, subject, text: `${greeting}\n\n${body}${ctaUrl ? `\n\n${ctaLabel || "Open"}: ${ctaUrl}` : ""}`, html });
}
