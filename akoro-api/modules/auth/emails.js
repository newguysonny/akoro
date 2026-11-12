/**
 * emails.js — Transactional email templates for Akoro auth events.
 *
 * Inline styles + table layouts for maximum email-client compatibility. A small
 * <style> block adds dark mode (Apple Mail, Gmail apps) and phone tweaks; clients
 * that ignore it show the light design. Each email has a render* function (pure,
 * returns { subject, text, html }) and a send* wrapper. Fire-and-forget callers
 * should `.catch(() => {})`.
 *
 * Images live in akoro-learner/public/email/ and are served from ASSET_BASE.
 */

import { urlFor, displayHost } from "../../lib/urls.js";

const EMAIL_FROM = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || process.env.SENDGRID_FROM_EMAIL || "noreply@akoro.app";

// Public base that serves the app's static assets (akoro-learner/public).
// Uses the frontend URL (FRONTEND_URL) since that deployment serves /logo/* and
// /email/*; override with EMAIL_ASSET_BASE if the assets are hosted elsewhere.
const ASSET_BASE = urlFor("EMAIL_ASSET_BASE", { alias: ["FRONTEND_URL"] });
// Help / Privacy / Terms live on the marketing site, not the learner app.
const SITE_BASE  = urlFor("MAIN_SITE_URL");
const img        = (name) => `${ASSET_BASE}/email/${name}`;
const MARK_URL   = img("mark.png");

// ─── Design tokens (light; dark overrides live in the <style> block) ──────────
const PURPLE  = "#6C3BFF";
const INK     = "#16122B"; // headings
const BODY    = "#4A4660"; // paragraph text
const MUTED   = "#7A7692"; // secondary
const LINE    = "#E7E1FB"; // card border + dividers
const PANEL   = "#F7F5FF"; // tinted panels
const PILL    = "#EFEAFF"; // label pill / icon tiles
const BG      = "#F4F1FF"; // page background
const FONT    = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const STYLE = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
  .bg{background:#0B0818!important}
  .card{background:#15112B!important;border-color:#2A2347!important}
  .h{color:#FFFFFF!important}.t{color:#C9C4E6!important}.m{color:#9A94BD!important}
  .panel{background:#1D1838!important}.row{border-color:#2A2347!important}
  .pill{background:#2A2150!important;color:#B6A3FF!important}
  .lnk{color:#B6A3FF!important}
  .btn-main{background:#7C55FF!important}
  .btn-ghost{background:#2A2150!important;color:#B6A3FF!important}
}
@media (max-width:520px){
  .wrap{padding:20px 10px!important}.pad{padding:22px 20px 30px!important}
  .btn-main a,.btn-ghost a{display:block!important}
}`;

// ─── § Shared layout wrapper ──────────────────────────────────────────────────

/** hero: file name in akoro-learner/public/email/ (optional). */
function layout(bodyContent, preheader = "", hero = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>Akoro</title>
<style>${STYLE}</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${BG};font-family:${FONT};-webkit-font-smoothing:antialiased;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};font-size:1px;line-height:1px;">${esc(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:${BG};">
  <tr><td class="wrap" align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">

      <!-- Brand -->
      <tr><td style="padding:0 6px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td>
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:middle;"><img src="${MARK_URL}" width="30" height="30" alt="Akoro" style="display:block;width:30px;height:30px;" /></td>
              <td class="h" style="padding-left:9px;vertical-align:middle;font-size:19px;font-weight:800;letter-spacing:-.03em;color:${INK};">akoro</td>
            </tr></table>
          </td>
          <td align="right" style="vertical-align:middle;"><a class="lnk" href="${ASSET_BASE}" style="font-size:13px;font-weight:600;color:${PURPLE};text-decoration:none;">Open Akoro ›</a></td>
        </tr></table>
      </td></tr>

      <!-- Card -->
      <tr><td class="card pad" style="background:#FFFFFF;border:1px solid ${LINE};border-radius:20px;padding:28px 32px 36px;">
        ${hero ? `<img src="${img(hero)}" width="496" alt="" style="display:block;width:100%;height:auto;border-radius:14px;margin:0 0 28px;" />` : ""}
        ${bodyContent}
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:22px 12px 0;text-align:center;">
        <p class="m" style="margin:0 0 8px;font-size:12px;color:${MUTED};line-height:1.6;">Need help? Just reply to this email.</p>
        <p style="margin:0;font-size:12px;line-height:1.6;">
          <a class="lnk" href="${SITE_BASE}/contact" style="color:${PURPLE};text-decoration:none;font-weight:600;">Help</a>
          <span class="m" style="color:${MUTED};">&nbsp;·&nbsp;</span>
          <a class="lnk" href="${SITE_BASE}/privacy" style="color:${PURPLE};text-decoration:none;font-weight:600;">Privacy</a>
          <span class="m" style="color:${MUTED};">&nbsp;·&nbsp;</span>
          <a class="lnk" href="${SITE_BASE}/terms" style="color:${PURPLE};text-decoration:none;font-weight:600;">Terms</a>
        </p>
        <p class="m" style="margin:10px 0 0;font-size:11px;color:${MUTED};opacity:.8;line-height:1.6;">
          You're receiving this because you have an account at ${displayHost(urlFor("MAIN_SITE_URL"))}.<br />© ${new Date().getFullYear()} Akoro Learning Ltd
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// Small label pill above the heading.
function pill(text, color = PURPLE, bg = PILL, cls = "pill") {
  return `<span class="${cls}" style="display:inline-block;padding:5px 12px;border-radius:999px;background:${bg};color:${color};font-size:12px;font-weight:700;letter-spacing:.02em;">${text}</span>`;
}

const heading = (text) => `<h1 class="h" style="margin:16px 0 12px;font-size:28px;line-height:1.2;font-weight:800;color:${INK};letter-spacing:-.03em;">${text}</h1>`;
const para = (text, mb = 24) => `<p class="t" style="margin:0 0 ${mb}px;font-size:16px;line-height:1.65;color:${BODY};">${text}</p>`;

// Bulletproof CTA (table-based so Outlook honours the padding). ghost = quiet secondary.
function btn(label, url, { ghost = false } = {}) {
  const cls = ghost ? "btn-ghost" : "btn-main";
  const bg = ghost ? PILL : PURPLE;
  const fg = ghost ? PURPLE : "#FFFFFF";
  return `<table role="presentation" cellpadding="0" cellspacing="0" class="${cls}" style="background:${bg};border-radius:12px;"><tr>
    <td align="center" style="border-radius:12px;">
      <a href="${url}" style="display:inline-block;padding:14px 28px;color:${fg};text-decoration:none;font-family:${FONT};font-weight:700;font-size:15px;border-radius:12px;">${label}</a>
    </td>
  </tr></table>`;
}

// Tinted panel of label / value rows (sign-in and change details).
function panel(rows) {
  const list = rows.filter(Boolean);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="panel" style="background:${PANEL};border-radius:14px;margin:0 0 26px;"><tr><td style="padding:6px 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list.map(([label, value], i) => {
      const bd = i < list.length - 1 ? `border-bottom:1px solid ${LINE};` : "";
      return `<tr>
      <td class="m row" style="padding:13px 0;font-size:13px;color:${MUTED};white-space:nowrap;${bd}">${label}</td>
      <td class="h row" align="right" style="padding:13px 0 13px 16px;font-size:13px;font-weight:700;color:${INK};${bd}">${value}</td>
    </tr>`;
    }).join("")}</table>
  </td></tr></table>`;
}

// Soft note box (reassurance / warnings).
function note(text) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 0;"><tr>
    <td class="panel m" style="background:${PANEL};border-radius:12px;padding:14px 16px;font-size:13px;line-height:1.6;color:${MUTED};">${text}</td>
  </tr></table>`;
}

// Numbered step card (welcome checklist); the whole card is a link.
function step(n, title, desc, url) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:14px;margin:0 0 10px;" class="row"><tr>
    <td style="padding:14px 0 14px 16px;width:44px;vertical-align:middle;">
      <div class="pill" style="width:32px;height:32px;border-radius:10px;background:${PILL};color:${PURPLE};font-weight:800;font-size:14px;line-height:32px;text-align:center;">${n}</div>
    </td>
    <td style="padding:14px 0;vertical-align:middle;">
      <a href="${url}" style="text-decoration:none;">
        <div class="h" style="font-size:15px;font-weight:700;color:${INK};">${title}</div>
        <div class="m" style="font-size:13px;color:${MUTED};line-height:1.5;">${desc}</div>
      </a>
    </td>
    <td class="lnk" align="right" style="padding:14px 18px;color:${PURPLE};font-weight:700;font-size:18px;vertical-align:middle;">›</td>
  </tr></table>`;
}

// "Chrome on Android" from a raw user-agent; falls back to the first few tokens.
function deviceName(ua) {
  if (!ua) return "Unknown";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || ua.split(" ").slice(0, 4).join(" ");
}

const cleanName = (name) => (name && name !== "there" ? esc(name) : "there");

// ─── § Resend helper ─────────────────────────────────────────────────────────

async function sendViaResend({ to, subject, text, html, fromValue }) {
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: fromValue,
    to:   Array.isArray(to) ? to : [to],
    subject,
    text,
    html,
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}

async function sendViaSendGrid({ to, subject, text, html, fromValue }) {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: (Array.isArray(to) ? to : [to]).map((email) => ({ email })) }],
      from: (() => {
        const m = String(fromValue).match(/^(.*)<([^>]+)>$/);
        return m ? { name: m[1].trim() || "Akoro Learning", email: m[2].trim() } : { name: "Akoro Learning", email: String(fromValue).trim() };
      })(),
      subject,
      content: [
        { type: "text/plain", value: text || String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() },
        { type: "text/html", value: html || `<p>${String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>` },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SendGrid send failed (${res.status}): ${body.slice(0, 300)}`);
  }
}

async function sendEmail({ to, subject, text, html, from }) {
  const fromValue = from ?? `Akoro Learning <${EMAIL_FROM}>`;
  // Resend is the primary transport; SendGrid is the fallback when Resend is
  // not configured or rejects the send.
  if (process.env.RESEND_API_KEY) {
    try {
      await sendViaResend({ to, subject, text, html, fromValue });
      return;
    } catch (e) {
      if (!process.env.SENDGRID_API_KEY) throw e;
      console.warn(`[auth:email] Resend failed (${e?.message || e}); falling back to SendGrid`);
    }
  }
  if (process.env.SENDGRID_API_KEY) {
    await sendViaSendGrid({ to, subject, text, html, fromValue });
    return;
  }
  throw new Error("No email transport is configured (RESEND_API_KEY / SENDGRID_API_KEY)");
}

/**
 * Emailed verification code (signup / login / password reset). A code, not a
 * link: it must be typed into the screen that asked for it.
 */
export function renderVerificationCodeEmail({ code, purpose = "login", expiresMinutes = 10, name = "there" }) {
  const what = purpose === "signup" ? "finish creating your account"
    : purpose === "reset" ? "reset your password"
    : "finish signing in";
  const subject = `Your Akoro code to ${what}`;
  const pretty = String(code || "").replace(/(\d{3})(\d{3})/, "$1 $2");
  const text = `Hi ${name},\n\nYour Akoro verification code is ${code}. It expires in ${expiresMinutes} minutes and can be used once.\n\nUse it to ${what}. If this wasn't you, ignore this email and consider changing your password.`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${BG};font-family:${FONT}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px">
   <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border:1px solid ${LINE};border-radius:18px;overflow:hidden">
     <tr><td style="padding:26px 26px 6px">
       <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${PURPLE}">Akoro Learning</div>
       <h1 style="margin:10px 0 6px;font-size:21px;line-height:1.3;color:${INK}">Your verification code</h1>
       <p style="margin:0;color:${BODY};font-size:14px;line-height:1.6">Use this code to ${esc(what)}. It expires in ${expiresMinutes} minutes and works once.</p>
     </td></tr>
     <tr><td style="padding:18px 26px">
       <div style="background:${PANEL};border:1px solid ${LINE};border-radius:14px;padding:18px;text-align:center">
         <div style="font-size:34px;font-weight:900;letter-spacing:.22em;color:${INK};font-family:ui-monospace,Menlo,Consolas,monospace">${esc(pretty || code)}</div>
       </div>
     </td></tr>
     <tr><td style="padding:0 26px 24px">
       <p style="margin:0;color:${MUTED};font-size:12px;line-height:1.6">If you didn't request this, ignore the email. Never share this code — Akoro will never ask for it.</p>
     </td></tr>
    </table>
   </td></tr>
  </table>
</body></html>`;
  return { subject, text, html };
}

export async function sendVerificationCodeEmail({ to, code, purpose, expiresMinutes, name }) {
  await sendEmail({ to, ...renderVerificationCodeEmail({ code, purpose, expiresMinutes, name }) });
}

/**
 * Generic outbound email — plan §4.6 Phase 4 messaging. Used by the billing
 * message-delivery job for admin-composed messages (no fixed template): the
 * subject/body are the admin's own words. `fromName`/`fromAddress` override
 * the default sender with the billing_settings branding when provided.
 * Throws on failure so the delivery job can record delivery_status.
 */
export async function sendGenericEmail({ to, subject, text, html, fromName, fromAddress }) {
  const from = (fromName && fromAddress)
    ? `${fromName} <${fromAddress}>`
    : (fromAddress ? `Akoro Learning <${fromAddress}>` : undefined);
  await sendEmail({ to, subject, text, html, from });
}

// ─── § Templates ─────────────────────────────────────────────────────────────

/**
 * Welcome email — sent on email/password sign-up.
 */
export function renderWelcomeEmail({ name, loginUrl, role = "student" }) {
  const named = name && name !== "there";
  const greeting = named ? `Hi ${name},` : "Welcome aboard,";
  const intro = role === "instructor"
    ? "You've joined as an instructor. Head to your dashboard to create courses, manage students and run live battle quizzes."
    : "Your account is ready. Three quick steps and your AI tutor knows exactly what to teach you.";
  const steps = role === "instructor"
    ? [["Create your first course", "Build it with the AI course builder."],
       ["Invite your students", "Share a class link or add them by email."],
       ["Run a live battle quiz", "Make revision something they look forward to."]]
    : [["Tell your tutor your exam", "JAMB, WAEC, IGCSE or your own topic."],
       ["Take a 5-minute check-in", "So we start at the right level."],
       ["Challenge a friend", "Climb the ranks in live quiz battles."]];

  const html = layout(`
    ${pill("Welcome to Akoro")}
    ${heading(`You're all set${named ? `, ${esc(name)}` : ""}.`)}
    ${para(intro, 20)}
    ${steps.map(([t, d], i) => step(i + 1, t, d, loginUrl)).join("")}
    <div style="margin:24px 0 0;">${btn("Get started", loginUrl)}</div>
  `, "Your Akoro account is ready.", "hero-welcome.jpg");

  return {
    subject: "Welcome to Akoro",
    text: `${greeting}\n\nYour Akoro account is ready. Sign in here: ${loginUrl}\n\nQuestions? Just reply to this email.`,
    html,
  };
}

export async function sendWelcomeEmail({ to, name, loginUrl, role = "student" }) {
  await sendEmail({ to, ...renderWelcomeEmail({ name, loginUrl, role }) });
}

/**
 * Login alert — sent on every successful password or Google sign-in.
 */
export function renderLoginAlertEmail({ name, ip, userAgent, time, signinUrl }) {
  const displayName = cleanName(name);
  const timeStr = (time ? new Date(time) : new Date())
    .toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) + " UTC";
  const device = deviceName(userAgent);

  const html = layout(`
    ${pill("Security", "#B45309", "#FEF3C7", "")}
    ${heading("New sign-in to your account")}
    ${para(`Hi ${displayName}, your Akoro account was just signed into.`, 22)}
    ${panel([["When", timeStr], ["IP", esc(ip || "Unknown")], ["Device", esc(device)]])}
    ${btn("Wasn't me — reset password", signinUrl)}
    ${note("If this was you, no action is needed — you can safely ignore this email.")}
  `, "New sign-in to your Akoro account.", "hero-security.jpg");

  return {
    subject: "New sign-in to your Akoro account",
    text: `Hi ${name && name !== "there" ? name : "there"},\n\nYour Akoro account was signed into at ${timeStr} from IP ${ip || "unknown"}.\n\nIf this wasn't you, reset your password: ${signinUrl}\n\nIf this was you, ignore this email.`,
    html,
  };
}

export async function sendLoginAlertEmail({ to, name, ip, userAgent, time, signinUrl }) {
  await sendEmail({ to, ...renderLoginAlertEmail({ name, ip, userAgent, time, signinUrl }) });
}

/**
 * Password reset request — rich replacement for the basic one in routes.js.
 */
export function renderPasswordResetEmail({ name, resetUrl }) {
  const displayName = cleanName(name);

  const html = layout(`
    ${pill("Password reset")}
    ${heading("Reset your password")}
    ${para(`Hi ${displayName}, we received a request to reset your Akoro password. This link is valid for <strong class="h" style="color:${INK};">1 hour</strong> and works once.`)}
    ${btn("Reset my password", resetUrl)}
    <p class="m" style="margin:24px 0 4px;font-size:12px;color:${MUTED};">Button not working? Paste this link into your browser:</p>
    <p style="margin:0;font-size:12px;word-break:break-all;"><a class="lnk" href="${resetUrl}" style="color:${PURPLE};text-decoration:none;">${resetUrl}</a></p>
    ${note(`<strong class="h" style="color:${INK};">Didn't request this?</strong> Your password is safe. Ignore this email and nothing changes.`)}
  `, "Reset your Akoro password.", "hero-reset.jpg");

  return {
    subject: "Reset your Akoro password",
    text: `Hi ${name && name !== "there" ? name : "there"},\n\nReset your Akoro password here (valid 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email — your password won't change.`,
    html,
  };
}

export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  await sendEmail({ to, ...renderPasswordResetEmail({ name, resetUrl }) });
}

/**
 * Password changed confirmation — sent after a successful reset or change.
 */
export function renderPasswordChangedEmail({ name, ip, signinUrl }) {
  const displayName = cleanName(name);
  const timeStr = new Date().toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) + " UTC";

  const html = layout(`
    ${pill("Password changed", "#15803D", "#DCFCE7", "")}
    ${heading("Your password was changed")}
    ${para(`Hi ${displayName}, this confirms your Akoro password was successfully updated. You've been signed out on all devices.`, 22)}
    ${panel([["When", timeStr], ip ? ["IP", esc(ip)] : null])}
    ${btn("Sign in", signinUrl)}
    ${note(`<strong class="h" style="color:${INK};">Didn't make this change?</strong> Contact us immediately by replying to this email.`)}
  `, "Your Akoro password has been changed.", "hero-security.jpg");

  return {
    subject: "Your Akoro password has been changed",
    text: `Hi ${name && name !== "there" ? name : "there"},\n\nYour Akoro password was changed at ${timeStr}${ip ? ` from IP ${ip}` : ""}.\n\nIf this was you, sign in here: ${signinUrl}\n\nIf this wasn't you, reply to this email immediately.`,
    html,
  };
}

export async function sendPasswordChangedEmail({ to, name, ip, signinUrl }) {
  await sendEmail({ to, ...renderPasswordChangedEmail({ name, ip, signinUrl }) });
}

/**
 * Generic notification email — used for approval decisions and similar
 * one-off messages. Optional CTA button.
 */
export async function sendNotificationEmail({ to, name, subject, heading: title, body, ctaUrl, ctaLabel }) {
  const greeting = name && name !== "there" ? `Hi ${name},` : "Hi,";
  const html = layout(`
    ${pill("Notification")}
    ${heading(title)}
    <p class="m" style="margin:0 0 10px;font-size:14px;color:${MUTED};">${esc(greeting)}</p>
    ${para(body)}
    ${ctaUrl ? btn(ctaLabel || "Open Akoro", ctaUrl) : ""}
  `, title);
  await sendEmail({ to, subject, text: `${greeting}\n\n${body}${ctaUrl ? `\n\n${ctaLabel || "Open"}: ${ctaUrl}` : ""}`, html });
}

/**
 * Ops alert — sent to whoever is on ALERT_EMAIL_TO when a rule fires or clears.
 *
 * Deliberately plain, and deliberately different from a learner-facing email:
 * this is read at speed, possibly on a phone, by someone deciding whether to
 * stop what they are doing. The subject carries the verdict, the body carries
 * the number, and there is no call to action pretending it is marketing.
 */
export async function sendOpsAlertEmail({ to, subject, title, detail, kind, severity }) {
  const resolved = kind === "resolved";
  const label  = resolved ? "Resolved" : kind === "reminder" ? "Still firing" : "Alert";
  const [pillColor, pillBg] = resolved ? ["#15803D", "#DCFCE7"]
    : severity === "critical" ? ["#B91C1C", "#FEE2E2"] : ["#B45309", "#FEF3C7"];

  const html = layout(`
    ${pill(label, pillColor, pillBg, "")}
    ${heading(title)}
    ${panel([["Detail", detail]])}
    <p class="m" style="font-size:13px;color:${MUTED};margin:0;line-height:1.6;">
      Checked automatically every few minutes. You will get one more message when it clears —
      not one per check.
    </p>
  `, title);

  await sendEmail({ to, subject, text: `${label}: ${title}\n\n${detail}`, html });
}
