/**
 * auth/service-password.js — forgot-password and reset-password flows
 * (emailed code and link).
 */

import bcrypt from "bcrypt";
import { createHash, randomUUID } from "crypto";
import { BCRYPT_ROUNDS, portalOf } from "./rules.js";
import { asyncHandler, res200, res400 } from "./service-common.js";
import { FRONTEND_URL, INSTRUCTOR_FRONTEND_URL, PORTAL_URLS } from "./service-links.js";
import {
  issueEmailCode, verifyEmailCode, consumeEmailCode,
  emailCodesEnabled, CODE_RESEND_SECONDS,
} from "./emailCodes.js";
import { sendPasswordResetEmail, sendPasswordChangedEmail } from "./emails.js";
import {
  findResetTarget, invalidateResetTokens, insertResetToken, findResetToken,
  markResetTokenUsed, updateUser, revokeUnusedRefreshTokensForUser, findUserEmailProfile,
} from "./store.js";

const RESET_TTL_MS = 60 * 60 * 1000;   // 1 hour

function hashToken(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

/** POST /api/auth/forgot-password */
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  // Always respond 200 — never reveal whether an email is registered
  const { data: user } = await findResetTarget(email);

  if (emailCodesEnabled(portalOf(req))) {
    if (user && user.is_active) {
      await issueEmailCode({
        userId: user.id, email: user.email, purpose: "reset",
        name: user.full_name || user.username || "there",
        ip: req.ip, userAgent: req.headers["user-agent"],
      }).catch(() => {});
    }
    // Same answer whether or not the account exists.
    return res200(res, { codeFlow: true, resendSeconds: CODE_RESEND_SECONDS, message: "If that email is registered, a code has been sent." });
  }

  if (user && user.is_active) {
    // Invalidate any existing unused tokens for this user
    await invalidateResetTokens(user.id, new Date().toISOString());

    const rawToken  = randomUUID();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();

    await insertResetToken({
      user_id:    user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    // Determine which frontend sent the request from its Referer host —
    // matched against every configured portal URL, not just "instructor"
    // (that substring check silently sent school/admin/agent/business users
    // a learner-app reset link that 404'd).
    const referer = req.get("Referer") || "";
    const refererHost = (() => { try { return new URL(referer).host; } catch { return ""; } })();
    const base = PORTAL_URLS.find((u) => { try { return new URL(u).host === refererHost; } catch { return false; } }) || FRONTEND_URL;
    const resetUrl = `${base}/reset-password?token=${rawToken}`;

    sendPasswordResetEmail({ to: user.email, name: user.full_name || user.username || "there", resetUrl })
      .catch(() => {}); // fire-and-forget; don't leak email errors
  }

  res200(res, { message: "If that email is registered, a reset link has been sent." });
});

/** POST /api/auth/reset-password */
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password, email, code } = req.body;

  // Emailed-code reset (no link): verify, update, consume.
  if (!token) {
    if (!email || !code) return res400(res, "Enter the email and the code we sent.");
    const verified = await verifyEmailCode({ email, code, purpose: "reset", consume: false });
    if (!verified.ok || !verified.row.user_id) return res400(res, "Invalid or expired code.");
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await updateUser(verified.row.user_id, { password_hash: passwordHash, must_change_password: false, updated_at: new Date().toISOString() });
    await consumeEmailCode(verified.row.id);
    await revokeUnusedRefreshTokensForUser(verified.row.user_id);
    const { data: resetUser } = await findUserEmailProfile(verified.row.user_id);
    if (resetUser) {
      const signinUrl = resetUser.role === "instructor" ? `${INSTRUCTOR_FRONTEND_URL}/signin` : `${FRONTEND_URL}/signin`;
      sendPasswordChangedEmail({ to: resetUser.email, name: resetUser.full_name || resetUser.username || "there",
        ip: req.ip, signinUrl }).catch(() => {});
    }
    return res200(res, { message: "Password updated. You can now sign in with your new password." });
  }

  const tokenHash = hashToken(token);

  const { data: record } = await findResetToken(tokenHash);

  if (!record)                              return res400(res, "Invalid or expired reset link.");
  if (record.used_at)                       return res400(res, "This reset link has already been used.");
  if (new Date(record.expires_at) < new Date()) return res400(res, "This reset link has expired. Please request a new one.");

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Mark token used + update password in one go
  await Promise.all([
    markResetTokenUsed(record.id, new Date().toISOString()),
    updateUser(record.user_id, { password_hash: passwordHash, must_change_password: false, updated_at: new Date().toISOString() }),
  ]);

  // Revoke all active refresh tokens for this user (force re-login everywhere)
  await revokeUnusedRefreshTokensForUser(record.user_id);

  // Notify the user their password was changed
  const { data: resetUser } = await findUserEmailProfile(record.user_id);
  if (resetUser) {
    const signinUrl = resetUser.role === "instructor"
      ? `${INSTRUCTOR_FRONTEND_URL}/signin`
      : `${FRONTEND_URL}/signin`;
    sendPasswordChangedEmail({
      to: resetUser.email,
      name: resetUser.full_name || resetUser.username || "there",
      ip: req.ip,
      signinUrl,
    }).catch(() => {});
  }

  res200(res, { message: "Password updated. You can now sign in with your new password." });
});
