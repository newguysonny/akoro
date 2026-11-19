/**
 * auth/service-2fa.js — the 2FA gate, setup-token middleware and the four
 * TOTP endpoints.
 */

import { generateSecret, otpauthURL, verifyTOTP } from "./totp.js";
import { portalOf } from "./rules.js";
import { asyncHandler, res200, res401 } from "./service-common.js";
import { INSTRUCTOR_FRONTEND_URL, FRONTEND_URL } from "./service-links.js";
import { verifyToken, signChallenge, signSetupChallenge } from "./tokens.js";
import { authenticateToken } from "./session.js";
import { issueTokenPair } from "./service-session.js";
import { findUserById, findTwoFactorProfile, findTwoFactorState, updateUser } from "./store.js";
import { sendLoginAlertEmail } from "./emails.js";

/** Admins must have 2FA. Learners keep it optional. */
const twoFactorGate = (user) => {
  if (user.two_factor_enabled && user.two_factor_secret) {
    return { twoFactorRequired: true, challengeToken: signChallenge(user.id) };
  }
  if (user.role === "admin") {
    return { twoFactorSetupRequired: true, setupToken: signSetupChallenge(user.id) };
  }
  return null;
};

/** 2FA setup/enable may be called with a setup challenge instead of a session. */
const authenticateSetup = (req, res, next) => {
  const token = req.body?.setupToken;
  if (!token) return authenticateToken(req, res, next);
  try {
    const decoded = verifyToken(token);
    if (decoded.type !== "2fa_setup") return res401(res, "Invalid or expired setup challenge");
    req.user = { id: decoded.sub };
    req.setupFlow = true;
    return next();
  } catch {
    return res401(res, "Invalid or expired setup challenge");
  }
};

// POST /api/auth/2fa/login — complete a 2FA-gated login with a TOTP code.
export const twoFactorLogin = asyncHandler(async (req, res) => {
  const { challengeToken, code } = req.body;
  if (!challengeToken || !code) return res401(res, "Challenge token and code required");

  let decoded;
  try { decoded = verifyToken(challengeToken); }
  catch { return res401(res, "Invalid or expired challenge"); }
  if (decoded.type !== "2fa_challenge") return res401(res, "Not a 2FA challenge token");

  const { data: user } = await findUserById(decoded.sub);
  if (!user || !user.is_active) return res401(res, "User not found");
  if (!user.two_factor_enabled || !user.two_factor_secret) return res401(res, "2FA not enabled");

  if (!verifyTOTP(user.two_factor_secret, code)) return res401(res, "Invalid authentication code");

  const payload = await issueTokenPair(res, user, portalOf(req));

  const signinUrl2fa = user.role === "instructor" ? `${INSTRUCTOR_FRONTEND_URL}/signin` : `${FRONTEND_URL}/signin`;
  sendLoginAlertEmail({
    to: user.email, name: user.full_name || user.username,
    ip: req.ip, userAgent: req.headers["user-agent"],
    time: new Date(), signinUrl: signinUrl2fa,
  }).catch(() => {});

  res200(res, payload);
});

// ─── § 2FA management (authenticated) ───────────────────────────────────────

// POST /api/auth/2fa/setup — generate a pending secret + provisioning URI.
export const twoFactorSetup = asyncHandler(async (req, res) => {
  const { data: user } = await findTwoFactorProfile(req.user.id);
  if (!user) return res401(res, "User not found");
  if (user.two_factor_enabled) return res.status(400).json({ success: false, message: "2FA already enabled" });

  const secret = generateSecret();
  await updateUser(user.id, { two_factor_secret: secret });

  res200(res, {
    secret,
    otpauthUrl: otpauthURL(secret, user.email, "Akoro"),
  });
});

// POST /api/auth/2fa/enable — verify the first code, then turn 2FA on.
export const twoFactorEnable = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ success: false, message: "Code required" });

  const { data: user } = await findTwoFactorState(req.user.id);
  if (!user || !user.two_factor_secret) return res.status(400).json({ success: false, message: "Run 2FA setup first" });
  if (!verifyTOTP(user.two_factor_secret, code)) return res.status(400).json({ success: false, message: "Invalid authentication code" });

  await updateUser(user.id, { two_factor_enabled: true });
  if (req.setupFlow) {
    const { data: full } = await findUserById(user.id);
    const payload = await issueTokenPair(res, full, portalOf(req));
    return res200(res, { ...payload, twoFactorEnabled: true });
  }
  res200(res, { twoFactorEnabled: true });
});

// POST /api/auth/2fa/disable — verify a current code, then turn 2FA off.
export const twoFactorDisable = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const { data: user } = await findTwoFactorState(req.user.id);
  if (!user || !user.two_factor_enabled) return res.status(400).json({ success: false, message: "2FA not enabled" });
  if (!code || !verifyTOTP(user.two_factor_secret, code)) return res.status(400).json({ success: false, message: "Invalid authentication code" });

  await updateUser(user.id, { two_factor_enabled: false, two_factor_secret: null });
  res200(res, { twoFactorEnabled: false });
});

export { twoFactorGate, authenticateSetup };
