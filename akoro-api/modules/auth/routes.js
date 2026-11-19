/**
 * auth/routes.js  —  Router wiring for production-hardened JWT authentication.
 *
 * Security layers implemented:
 *  1. RS256 asymmetric signing  — private key signs, public key verifies
 *  2. Short-lived access tokens (15 min) + long refresh tokens (7 days)
 *  3. Refresh token rotation   — new pair on every /refresh; replay = family revoke
 *  4. jti deny-list            — logout/password-change blacklists the access jti
 *  5. Strict claim validation  — alg whitelist, iss + aud required
 *  6. HttpOnly cookies         — tokens never readable by JS
 *  7. Algorithm hardening      — rejects alg:none and HS256 downgrade
 *
 * Layering: this router wires rate limiters, validation chains and thin
 * handlers; the flows live in service*.js, pure rules in rules.js, every
 * Supabase query in store.js, and all signing/cookies in tokens.js.
 *
 * Env vars required:
 *   JWT_PRIVATE_KEY     RSA-2048 private key (PEM, \n-escaped)
 *   JWT_PUBLIC_KEY      RSA-2048 public key  (PEM, \n-escaped)
 *   JWT_ISSUER          e.g. "https://api.akoro.app"
 *   JWT_AUDIENCE        e.g. "https://akoro.app"
 *   COOKIE_SECRET       random string for cookie signing
 *   FRONTEND_URL        e.g. "https://akoro.app"
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL
 */

import { Router }         from "express";
import { body }           from "express-validator";
import passport           from "passport";
import { randomUUID }     from "crypto";
import { strictLimit, refreshLimit } from "../../middleware/security.js";
import { rules, runValidation, PORTALS, parseState } from "./rules.js";
import { authHandlers } from "./service.js";
import { authenticateToken } from "./session.js";
import { authenticateSetup } from "./service-2fa.js";
import { googleCallback } from "./service-google.js";
import { forgotPassword, resetPassword } from "./service-password.js";
import { portalUrl } from "./service-links.js";

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

router.post("/register", strictLimit,  rules.register, runValidation, authHandlers.register);
router.post("/login",    strictLimit,  rules.login,    runValidation, authHandlers.login);
router.post("/verify-email", strictLimit, body("challengeId").isUUID(), body("code").isLength({ min: 6, max: 6 }), runValidation, authHandlers.verifyEmail);
router.post("/verify-login", strictLimit, body("challengeId").isUUID(), body("code").isLength({ min: 6, max: 6 }), runValidation, authHandlers.verifyLogin);
router.post("/resend-code",  strictLimit, body("challengeId").optional().isUUID(), body("email").optional().isEmail(), body("purpose").optional().isIn(["signup", "login", "reset"]), runValidation, authHandlers.resendCode);
router.post("/refresh",  refreshLimit, authHandlers.refresh);
router.post("/logout",   authenticateToken, authHandlers.logout);
router.get ("/me",       authenticateToken, authHandlers.me);

// Two-factor authentication
router.post("/2fa/login",   strictLimit, authHandlers.twoFactorLogin);
router.post("/2fa/setup",   authenticateSetup, authHandlers.twoFactorSetup);
router.post("/2fa/enable",  strictLimit, authenticateSetup, authHandlers.twoFactorEnable);
router.post("/2fa/disable", strictLimit, authenticateToken, authHandlers.twoFactorDisable);

router.post("/change-password", authenticateToken, authHandlers.changePassword);

// Google OAuth
// ?portal=instructor | admin  →  signals which portal the login came from
router.get("/google", (req, res, next) => {
  const portal = PORTALS.includes(req.query.portal) ? req.query.portal : "student";
  const nonce = randomUUID();
  res.cookie("oauth_state", nonce, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 10 * 60 * 1000, path: "/" });
  passport.authenticate("google", {
    scope:   ["profile", "email"],
    session: false,
    state:   `${portal}.${nonce}`,   // carried through to callback
  })(req, res, next);
});

router.get("/google/callback",
  (req, res, next) => {
    const { portal, nonce } = parseState(req.query.state);
    // Verify the CSRF nonce against the cookie set at /google.
    if (!nonce || nonce !== req.cookies?.oauth_state) {
      res.clearCookie("oauth_state", { path: "/" });
      return res.redirect(`${portalUrl(portal)}/signin?error=google_failed`);
    }
    res.clearCookie("oauth_state", { path: "/" });
    const failUrl = `${portalUrl(portal)}/signin?error=google_failed`;
    passport.authenticate("google", { session: false, failureRedirect: failUrl })(req, res, next);
  },
  googleCallback
);

// ─── § FORGOT / RESET PASSWORD ────────────────────────────────────────────────

/** POST /api/auth/forgot-password */
router.post("/forgot-password", strictLimit,
  body("email").isEmail().normalizeEmail(),
  runValidation,
  forgotPassword
);

/** POST /api/auth/reset-password */
router.post("/reset-password", strictLimit,
  body("token").optional({ values: "falsy" }),
  body("email").optional({ values: "falsy" }).isEmail().normalizeEmail(),
  body("code").optional({ values: "falsy" }).isLength({ min: 6, max: 6 }),
  body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
  runValidation,
  resetPassword
);

export default router;

// ─── § RE-EXPORTS ─────────────────────────────────────────────────────────────
// The barrel (`modules/auth/index.js`) and the verification gate import these
// from this file; they keep the module's public surface unchanged.

export {
  authenticateToken, requireRole, authenticateSocket, invalidateCachedUser,
} from "./session.js";
export { issueTokenPair, endSession } from "./service-session.js";
export {
  signInternalAccess, signHandoff, verifyHandoff,
  signCourseInvite, verifyCourseInvite, INVITE_MAX_DAYS,
  isSessionToken,
} from "./tokens.js";
// For the verification gate only (smoke.session_tokens_only): proves these never sign in.
export { signChallenge as signChallengeForGate, signRefresh as signRefreshForGate } from "./tokens.js";
// The token-peek helpers live in lib/tokenPeek.js: the rate limiters need them, and
// importing this module there would close the cycle security → auth → security.
// Re-exported so callers have one obvious place to find it.
export { peekAccessToken, readAccessToken } from "../../lib/tokenPeek.js";

/*
 * ── Required DB migrations ────────────────────────────────────────────────────
 *
 * CREATE TABLE IF NOT EXISTS refresh_tokens (
 *   jti        UUID PRIMARY KEY,
 *   user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *   family     UUID NOT NULL,
 *   used       BOOLEAN NOT NULL DEFAULT false,
 *   expires_at TIMESTAMPTZ NOT NULL,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 * );
 * CREATE INDEX ON refresh_tokens (user_id);
 * CREATE INDEX ON refresh_tokens (family);
 *
 * CREATE TABLE IF NOT EXISTS revoked_tokens (
 *   jti        UUID PRIMARY KEY,
 *   expires_at TIMESTAMPTZ NOT NULL,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 * );
 *
 * ── Env vars ──────────────────────────────────────────────────────────────────
 *   JWT_PRIVATE_KEY     (RSA-2048 private PEM, \n-escaped)
 *   JWT_PUBLIC_KEY      (RSA-2048 public  PEM, \n-escaped)
 *   JWT_ISSUER          https://api.akoro.app
 *   JWT_AUDIENCE        https://akoro.app
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_CALLBACK_URL https://api.akoro.app/api/auth/google/callback
 *   FRONTEND_URL        https://akoro.app
 */
