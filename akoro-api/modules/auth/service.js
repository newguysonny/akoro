/**
 * auth/service.js — signup/login/email-code handlers, plus the authHandlers
 * table that wires them to the router. Flows are split by concern:
 * service-2fa, service-session, service-google, service-password.
 */

import bcrypt from "bcrypt";
import { BCRYPT_ROUNDS, portalOf } from "./rules.js";
import { asyncHandler, res200, res201, res400, res401, res403 } from "./service-common.js";
import { FRONTEND_URL, INSTRUCTOR_FRONTEND_URL, SCHOOL_FRONTEND_URL } from "./service-links.js";
import {
  issueEmailCode, verifyEmailCode, resendEmailCode,
  emailCodesEnabled, emailCodeBypassed, normaliseEmail, CODE_TTL_MINUTES, CODE_RESEND_SECONDS,
} from "./emailCodes.js";
import { sendWelcomeEmail, sendLoginAlertEmail } from "./emails.js";
import { issueTokenPair, me, refresh, logout, changePassword } from "./service-session.js";
import {
  twoFactorGate,
  twoFactorLogin, twoFactorSetup, twoFactorEnable, twoFactorDisable,
} from "./service-2fa.js";
import {
  findSignupCandidate, findUserByUsername, insertUser, findUserByEmail,
  findLatestAgent, reactivateAgent, findUserById, updateUser,
} from "./store.js";

// POST /api/auth/register
export const register = asyncHandler(async (req, res) => {
  const { email, password, fullName, role = "student" } = req.body;
  let { username } = req.body;
  const portal = portalOf(req);
  const codesOn = emailCodesEnabled(portal);

  const { data: existing } = await findSignupCandidate(email);
  if (existing) {
    if (!codesOn) return res400(res, "Email already registered");
    // Never confirm the account state to an unknown caller: an unverified
    // account gets a fresh code, a verified one gets only a generic 200.
    if (!existing.email_verified) {
      const issued = await issueEmailCode({
        userId: existing.id, email, purpose: "signup",
        name: existing.full_name || existing.username || "there",
        ip: req.ip, userAgent: req.headers["user-agent"],
      });
      if (!issued.ok && issued.code === "send_failed") return res.status(503).json({ success: false, message: "Could not send the verification email. Try again." });
      return res200(res, {
        verificationRequired: true, email: normaliseEmail(email), codeSent: !!issued.ok,
        ...(issued.challengeId ? { challengeId: issued.challengeId, expiresInMinutes: CODE_TTL_MINUTES } : {}),
        ...(issued.ok ? {} : { retryAfter: issued.retryAfter ?? null }),
      });
    }
    return res200(res, { verificationRequired: false, codeSent: false,
      message: "If this email can sign in, use your password." });
  }

  // Auto-generate a unique username when none is supplied (e.g. schools).
  if (!username) {
    const base = (email.split("@")[0] || "user").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30) || "user";
    username = `${base}_${Date.now().toString(36).slice(-4)}`;
  }
  const { data: existingUser } = await findUserByUsername(username);
  if (existingUser) {
    if (req.body.username) return res400(res, "Username already taken");
    username = `${username}_${Math.random().toString(36).slice(2, 6)}`;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const { data: user, error } = await insertUser({
    email, username,
    password_hash:  passwordHash,
    full_name:      fullName ?? null,
    role,
    is_active:      true,
    email_verified: !codesOn,
  });
  if (error) return res400(res, "Registration failed");

  if (codesOn) {
    const issued = await issueEmailCode({
      userId: user.id, email, purpose: "signup",
      name: user.full_name || user.username || "there",
      ip: req.ip, userAgent: req.headers["user-agent"],
    });
    if (!issued.ok) {
      if (issued.code === "send_failed") {
        return res.status(503).json({ success: false, message: "Could not send the verification email. Try again." });
      }
      return res201(res, { verificationRequired: true, email: normaliseEmail(email), codeSent: false,
        resendSeconds: CODE_RESEND_SECONDS, retryAfter: issued.retryAfter ?? null });
    }
    return res201(res, { verificationRequired: true, email: normaliseEmail(email), codeSent: true,
      resendSeconds: CODE_RESEND_SECONDS, challengeId: issued.challengeId, expiresInMinutes: CODE_TTL_MINUTES });
  }

  const payload = await issueTokenPair(res, user, portal);
  const loginUrl = role === "instructor" ? `${INSTRUCTOR_FRONTEND_URL}/signin`
    : role === "school_admin" ? `${SCHOOL_FRONTEND_URL}/signin`
    : `${FRONTEND_URL}/signin`;
  sendWelcomeEmail({ to: user.email, name: user.full_name || user.username, loginUrl, role }).catch(() => {});
  res201(res, payload);
});

// POST /api/auth/login
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const { data: user } = await findUserByEmail(email);
  if (!user) return res401(res, "Invalid credentials");

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res401(res, "Invalid credentials");

  // Deleted accounts are permanently blocked.
  if (user.deleted_at) return res403(res, "This account has been deleted");

  // Deactivated accounts auto-reactivate on successful login within the
  // 30-day grace period; after that they stay blocked.
  if (!user.is_active) {
    const graceMs = 30 * 24 * 60 * 60 * 1000;
    const deactivatedAt = user.deactivated_at ? new Date(user.deactivated_at).getTime() : 0;
    if (deactivatedAt && Date.now() - deactivatedAt <= graceMs) {
      await updateUser(user.id, {
        is_active: true, deactivated_at: null, updated_at: new Date().toISOString(),
      });
      // Reactivate only the most recent agent to preserve the single-active-agent invariant
      const { data: lastAgent } = await findLatestAgent(user.id);
      if (lastAgent) await reactivateAgent(lastAgent.id);
      user.is_active = true;
    } else {
      return res403(res, "Account deactivated");
    }
  }

  // Email-code gate (per portal). Passwords alone no longer mint a session
  // when this portal is enabled; the code is emailed and verified next.
  const portal = portalOf(req);
  // Seeded demo accounts cannot receive email and are used by our testers;
  // the same bypass env now skips the email code AND 2FA (including the
  // mandatory admin setup gate). Never applies to a real domain.
  const bypassAuth = emailCodeBypassed(user.email);
  if (emailCodesEnabled(portal) && !bypassAuth) {
    const purpose = user.email_verified ? "login" : "signup";
    const issued = await issueEmailCode({
      userId: user.id, email: user.email, purpose,
      name: user.full_name || user.username || "there",
      ip: req.ip, userAgent: req.headers["user-agent"],
    });
    if (!issued.ok && issued.code === "send_failed") {
      return res.status(503).json({ success: false, message: "Could not send the sign-in code. Try again." });
    }
    return res200(res, {
      ...(purpose === "signup" ? { verificationRequired: true } : { codeRequired: true }),
      email: normaliseEmail(user.email), codeSent: !!issued.ok, resendSeconds: CODE_RESEND_SECONDS,
      ...(issued.challengeId ? { challengeId: issued.challengeId, expiresInMinutes: CODE_TTL_MINUTES } : {}),
      ...(issued.ok ? {} : { retryAfter: issued.retryAfter ?? null }),
    });
  }

  // Two-factor gate — admins without 2FA are sent to setup, everyone with
  // 2FA gets the TOTP challenge, learners without it sign in normally.
  // Demo-domain accounts skip this too (same bypass env).
  if (!bypassAuth) {
    const gate = twoFactorGate(user);
    if (gate) return res200(res, gate);
  }

  const payload = await issueTokenPair(res, user, portalOf(req));

  const signinUrl = user.role === "instructor" ? `${INSTRUCTOR_FRONTEND_URL}/signin` : `${FRONTEND_URL}/signin`;
  sendLoginAlertEmail({
    to: user.email, name: user.full_name || user.username,
    ip: req.ip, userAgent: req.headers["user-agent"],
    time: new Date(), signinUrl,
  }).catch(() => {});

  res200(res, payload);
});

// POST /api/auth/verify-email — finish sign-up with the emailed code.
export const verifyEmail = asyncHandler(async (req, res) => {
  const { challengeId, code } = req.body;
  const verified = await verifyEmailCode({ challengeId, code, purpose: "signup" });
  if (!verified.ok) return res400(res, "Invalid or expired code.");
  const { data: user } = await findUserById(verified.row.user_id);
  if (!user) return res400(res, "Invalid or expired code.");
  await updateUser(user.id, { email_verified: true, updated_at: new Date().toISOString() });
  const payload = await issueTokenPair(res, user, portalOf(req));
  const loginUrl = user.role === "instructor" ? `${INSTRUCTOR_FRONTEND_URL}/signin` : `${FRONTEND_URL}/signin`;
  sendWelcomeEmail({ to: user.email, name: user.full_name || user.username, loginUrl, role: user.role }).catch(() => {});
  res200(res, payload);
});

// POST /api/auth/verify-login — finish sign-in with the emailed code.
export const verifyLogin = asyncHandler(async (req, res) => {
  const { challengeId, code } = req.body;
  let verified = await verifyEmailCode({ challengeId, code, purpose: "login" });
  if (!verified.ok) verified = await verifyEmailCode({ challengeId, code, purpose: "signup" });
  if (!verified.ok) return res400(res, "Invalid or expired code.");
  const { data: user } = await findUserById(verified.row.user_id);
  if (!user || !user.is_active) return res401(res, "User not found");
  if (verified.row.purpose === "signup" && !user.email_verified) {
    await updateUser(user.id, { email_verified: true, updated_at: new Date().toISOString() });
  }
  if (!emailCodeBypassed(user.email)) {
    const gate = twoFactorGate(user);
    if (gate) return res200(res, gate);
  }
  const payload = await issueTokenPair(res, user, portalOf(req));
  const signinUrl = user.role === "instructor" ? `${INSTRUCTOR_FRONTEND_URL}/signin` : `${FRONTEND_URL}/signin`;
  sendLoginAlertEmail({ to: user.email, name: user.full_name || user.username, ip: req.ip,
    userAgent: req.headers["user-agent"], time: new Date(), signinUrl }).catch(() => {});
  res200(res, payload);
});

// POST /api/auth/resend-code — a fresh code for the same challenge.
export const resendCode = asyncHandler(async (req, res) => {
  const { challengeId, email, purpose } = req.body;
  if (!challengeId && !email) return res400(res, "Request a new code by signing in again.");
  const issued = await resendEmailCode({ challengeId, email, purpose, ip: req.ip, userAgent: req.headers["user-agent"] });
  if (!issued.ok && issued.code === "send_failed") {
    return res.status(503).json({ success: false, message: "Could not send the code. Try again." });
  }
  // Reset resends must not reveal whether an account or a live code exists:
  // answer exactly like forgot-password does (generic success). A send that
  // genuinely failed (503 above) is the only thing we surface.
  if (purpose === "reset") {
    return res200(res, { codeSent: true, resendSeconds: CODE_RESEND_SECONDS });
  }
  if (!issued.ok && ["invalid_code"].includes(issued.code)) return res400(res, "Request a new code by signing in again.");
  return res200(res, { codeSent: !!issued.ok, resendSeconds: CODE_RESEND_SECONDS,
    ...(issued.challengeId ? { challengeId: issued.challengeId, expiresInMinutes: CODE_TTL_MINUTES } : {}),
    ...(issued.ok ? {} : { retryAfter: issued.retryAfter ?? null }) });
});

const authHandlers = {
  register,
  login,
  verifyEmail,
  verifyLogin,
  resendCode,
  twoFactorLogin,
  twoFactorSetup,
  twoFactorEnable,
  twoFactorDisable,
  refresh,
  logout,
  me,
  changePassword,
};

export { authHandlers };
