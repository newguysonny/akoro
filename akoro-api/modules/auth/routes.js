/**
 * auth/routes.js  —  Production-hardened JWT authentication
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
 * Env vars required:
 *   JWT_PRIVATE_KEY     RSA-2048 private key (PEM, \n-escaped)
 *   JWT_PUBLIC_KEY      RSA-2048 public key  (PEM, \n-escaped)
 *   JWT_ISSUER          e.g. "https://api.akoro.app"
 *   JWT_AUDIENCE        e.g. "https://akoro.app"
 *   COOKIE_SECRET       random string for cookie signing
 *   FRONTEND_URL        e.g. "https://akoro.app"
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL
 */

import { Router }                     from "express";
import jwt                            from "jsonwebtoken";
import bcrypt                         from "bcrypt";
import { body, validationResult }     from "express-validator";
import passport                       from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { randomUUID }                 from "crypto";
import { createHash }                 from "crypto";
import db                             from "../../db.js";
import { runWithAiContext, featureForRequest } from "../../lib/aiContext.js";
import { schoolBillTo } from "../../lib/coins.js";

// Portals where AI usage is funded by the SCHOOL, not the individual user.
const SCHOOL_PORTALS = ["school", "school_admin", "site"];
import { strictLimit, refreshLimit }  from "../../middleware/security.js";
import { generateSecret, otpauthURL, verifyTOTP } from "./totp.js";
import {
  sendWelcomeEmail,
  sendLoginAlertEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
} from "./emails.js";

// ─── § CONSTANTS ──────────────────────────────────────────────────────────────

const PRIVATE_KEY  = (process.env.JWT_PRIVATE_KEY  || "").replace(/\\n/g, "\n").trim();
const PUBLIC_KEY   = (process.env.JWT_PUBLIC_KEY   || "").replace(/\\n/g, "\n").trim();

const JWT_ISSUER   = process.env.JWT_ISSUER   || "https://api.akoro.app";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "https://akoro.app";
const FRONTEND_URL            = process.env.FRONTEND_URL             || "https://akoro.app";
const INSTRUCTOR_FRONTEND_URL = process.env.INSTRUCTOR_FRONTEND_URL  || "https://instructor.akoro.app";
const ADMIN_FRONTEND_URL      = process.env.ADMIN_FRONTEND_URL       || "https://admin.akoro.app";
const SCHOOL_FRONTEND_URL     = process.env.SCHOOL_FRONTEND_URL      || "https://school.akoro.app";
const AGENT_FRONTEND_URL      = process.env.AGENT_FRONTEND_URL       || "https://agent.akoro.app";
const BUSINESS_FRONTEND_URL   = process.env.BUSINESS_FRONTEND_URL    || "https://business.akoro.app";

// Map a portal name to its frontend base URL.
const portalUrl = (portal) =>
  portal === "instructor" ? INSTRUCTOR_FRONTEND_URL
  : portal === "admin"    ? ADMIN_FRONTEND_URL
  : portal === "school"   ? SCHOOL_FRONTEND_URL
  : portal === "agent"    ? AGENT_FRONTEND_URL
  : portal === "business" ? BUSINESS_FRONTEND_URL
  : FRONTEND_URL;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10);

// Access token stays SHORT (stateless, can't be revoked until expiry) — a long
// one is a security downgrade, not better UX. What actually keeps users signed
// in is the REFRESH token: it's server-tracked/revocable, rotates on every use,
// and re-extends, so an ACTIVE user never gets logged out. The refresh TTL is
// therefore the "remember me for inactive users" window — default 30 days.
const ACCESS_TTL_SECS  = Math.max(300,  parseInt(process.env.ACCESS_TTL_SECS  ?? String(15 * 60),        10)); // 15 min
const REFRESH_TTL_SECS = Math.max(3600, parseInt(process.env.REFRESH_TTL_SECS ?? String(30 * 24 * 3600), 10)); // 30 days
const ALLOWED_ALGS     = ["RS256"];       // whitelist — never HS256 / none

// Fall back to HS256 with a secret in dev when no RSA keys provided
const USE_RSA = PRIVATE_KEY.includes("-----BEGIN") && PUBLIC_KEY.includes("-----BEGIN");
const DEV_SECRET = process.env.JWT_SECRET || "akoro-dev-secret-change-in-production";

// ─── § HELPERS ────────────────────────────────────────────────────────────────

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res400 = (res, message)         => res.status(400).json({ success: false, message });
const res401 = (res, message)         => res.status(401).json({ success: false, message });
const res403 = (res, message)         => res.status(403).json({ success: false, message });
const res404 = (res, message)         => res.status(404).json({ success: false, message });

const now = () => new Date().toISOString();

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

// ─── § TOKEN FACTORY ──────────────────────────────────────────────────────────

function signAccess(user) {
  const jti = randomUUID();
  const payload = {
    jti,
    sub:   user.id,
    email: user.email,
    role:  user.role,
    iss:   JWT_ISSUER,
    aud:   JWT_AUDIENCE,
  };
  const token = USE_RSA
    ? jwt.sign(payload, PRIVATE_KEY, { algorithm: "RS256", expiresIn: ACCESS_TTL_SECS })
    : jwt.sign(payload, DEV_SECRET,  { algorithm: "HS256", expiresIn: ACCESS_TTL_SECS });
  return { token, jti };
}

/**
 * signInternalAccess — a short-lived access token for a background job acting
 * on a user's behalf.
 *
 * The task worker has no request and therefore no cookie, but the endpoints it
 * calls are the user's own. Rather than invent a service account with wider
 * reach than the teacher who scheduled the work, it borrows their identity for
 * two minutes. Signed by the same factory as a real login, so it satisfies
 * authenticateToken without loosening anything.
 */
export function signInternalAccess(user, ttlSeconds = 120) {
  const payload = {
    jti:   randomUUID(),
    sub:   user.id,
    email: user.email ?? null,
    role:  user.role,
    iss:   JWT_ISSUER,
    aud:   JWT_AUDIENCE,
    internal: true,          // visible in logs: this call came from a job
  };
  return USE_RSA
    ? jwt.sign(payload, PRIVATE_KEY, { algorithm: "RS256", expiresIn: ttlSeconds })
    : jwt.sign(payload, DEV_SECRET,  { algorithm: "HS256", expiresIn: ttlSeconds });
}

function signRefresh(userId, family) {
  const jti = randomUUID();
  const payload = {
    jti,
    sub:    userId,
    family,          // family ID ties all rotated tokens together for revocation
    iss:    JWT_ISSUER,
    aud:    JWT_AUDIENCE,
    type:   "refresh",
  };
  const token = USE_RSA
    ? jwt.sign(payload, PRIVATE_KEY, { algorithm: "RS256", expiresIn: REFRESH_TTL_SECS })
    : jwt.sign(payload, DEV_SECRET,  { algorithm: "HS256", expiresIn: REFRESH_TTL_SECS });
  return { token, jti };
}

function verifyToken(token) {
  const verifyKey = USE_RSA ? PUBLIC_KEY : DEV_SECRET;
  const algs      = USE_RSA ? ALLOWED_ALGS : ["HS256"];
  return jwt.verify(token, verifyKey, {
    algorithms: algs,
    issuer:     JWT_ISSUER,
    audience:   JWT_AUDIENCE,
  });
}

// Short-lived (2 min) hand-off token — used to carry an authenticated identity
// across a top-level navigation to a different app domain (e.g. the public
// school site's AI-chat login → the school portal), where a cross-site cookie
// set during the widget fetch may be partitioned/blocked. The destination app
// exchanges it for a real session on its OWN origin. Exported for the school
// module.
const signHandoff = (userId) => {
  const payload = { sub: userId, type: "ai_handoff", iss: JWT_ISSUER, aud: JWT_AUDIENCE };
  return USE_RSA
    ? jwt.sign(payload, PRIVATE_KEY, { algorithm: "RS256", expiresIn: 120 })
    : jwt.sign(payload, DEV_SECRET,  { algorithm: "HS256", expiresIn: 120 });
};
const verifyHandoff = (token) => {
  try {
    const d = verifyToken(token);
    return d && d.type === "ai_handoff" ? d.sub : null;
  } catch { return null; }
};
export { signHandoff, verifyHandoff };

/**
 * authenticateSocket — verify the JWT for a Socket.IO connection.
 * Reads akoro_access from the handshake cookies (or handshake.auth.token /
 * Authorization Bearer) and applies the same checks as authenticateToken:
 * algorithm whitelist, signature/claims, deny-list, active user, force-logout.
 * Returns the safe user object, or null for anonymous/invalid connections —
 * the io.use() middleware attaches the result and each socket module decides
 * whether anonymous is acceptable for its events.
 */
export async function authenticateSocket(socket) {
  try {
    const raw = socket.handshake?.headers?.cookie || "";
    const cookies = {};
    for (const part of raw.split(";")) {
      const i = part.indexOf("=");
      if (i > 0) { try { cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1)); } catch { /* skip bad cookie */ } }
    }
    const headerAuth = socket.handshake?.headers?.authorization;
    // Portal-scoped cookie: prefer the portal the client declares, then any
    // akoro_access_* cookie present, then the legacy shared cookie.
    const declaredPortal = socket.handshake?.auth?.portal || socket.handshake?.query?.portal;
    const scopedName = `akoro_access_${PORTAL_IDS.includes(declaredPortal) ? declaredPortal : "student"}`;
    const anyScoped = Object.keys(cookies).find((k) => k.startsWith("akoro_access_"));
    const token = socket.handshake?.auth?.token
      || cookies[scopedName]
      || (anyScoped ? cookies[anyScoped] : null)
      || cookies.akoro_access
      || (headerAuth?.startsWith("Bearer ") ? headerAuth.slice(7) : null);
    if (!token) return null;

    const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    if (!header.alg || header.alg === "none" || (!USE_RSA && header.alg !== "HS256") || (USE_RSA && !ALLOWED_ALGS.includes(header.alg))) return null;

    const decoded = verifyToken(token);
    if (decoded.jti && await DenyList.has(decoded.jti)) return null;

    const { data: user } = await db.from("users")
      .select("id,email,username,full_name,avatar_url,role,is_active,force_logout_at")
      .eq("id", decoded.sub).maybeSingle();
    if (!user || !user.is_active) return null;
    if (user.force_logout_at && decoded.iat && decoded.iat * 1000 < new Date(user.force_logout_at).getTime()) return null;

    return { id: user.id, email: user.email, username: user.username, fullName: user.full_name, avatarUrl: user.avatar_url, role: user.role };
  } catch {
    return null;
  }
}

// ─── § COOKIE HELPERS ─────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === "production";

// ─── Portal-scoped session cookies ────────────────────────────────────────────
// Every frontend app (learner/instructor/school/admin) hits the same API, so a
// single shared cookie meant one session for all of them. We scope the cookie
// name per portal so each app holds an INDEPENDENT session in the same browser.
// The portal is declared by the app via the X-Akoro-Portal header (and, for the
// Google redirect which carries no header, via the OAuth `state`).
const PORTAL_IDS = ["student", "instructor", "admin", "school", "site", "agent", "business"];
// The portal is normally declared via the X-Akoro-Portal header. Full-page
// navigations (OAuth "Connect" redirects, file links) can't set headers, so we
// also accept a ?portal= query param — it only selects which scoped cookie to
// read; the token inside is still validated, so it can't be used to escalate.
const portalOf = (req) => {
  const p = req?.headers?.["x-akoro-portal"] || req?.query?.portal;
  return PORTAL_IDS.includes(p) ? p : "student";
};
const accessCookieName  = (portal) => `akoro_access_${PORTAL_IDS.includes(portal) ? portal : "student"}`;
const refreshCookieName = (portal) => `akoro_refresh_${PORTAL_IDS.includes(portal) ? portal : "student"}`;

function setAccessCookie(res, token, portal = "student") {
  res.cookie(accessCookieName(portal), token, {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: IS_PROD ? "None" : "Lax",  // None required for cross-origin (API ↔ Vercel)
    maxAge:   ACCESS_TTL_SECS * 1000,
    path:     "/",
  });
}

function setRefreshCookie(res, token, portal = "student") {
  res.cookie(refreshCookieName(portal), token, {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: IS_PROD ? "None" : "Lax",
    maxAge:   REFRESH_TTL_SECS * 1000,
    path:     "/api/auth/refresh",  // refresh cookie only sent to /refresh endpoint
  });
}

function clearAuthCookies(res, portal = "student") {
  res.clearCookie(accessCookieName(portal),  { path: "/" });
  res.clearCookie(refreshCookieName(portal), { path: "/api/auth/refresh" });
  clearLegacyCookies(res);
}

// The pre-portal-scoping shared cookies. Cleared on every fresh login/refresh so
// a returning user migrates off the shared session (which all apps could read)
// the moment they re-authenticate, instead of waiting for it to expire.
function clearLegacyCookies(res) {
  res.clearCookie("akoro_access",  { path: "/" });
  res.clearCookie("akoro_refresh", { path: "/api/auth/refresh" });
}
export { clearAuthCookies };
// Issue an authenticated session (sets access+refresh cookies). Exported so
// other modules (e.g. the school website's gated AI-chat login) can sign a
// user in without duplicating the cookie/token plumbing. Defined below.
export { issueTokenPair };

/**
 * Revoke the access token on the current request (deny-list its jti) and
 * clear auth cookies. Used by account deactivate/delete to kill the session
 * immediately. Safe to call even if the request had no jti.
 */
export async function endSession(req, res) {
  if (req.tokenJti && req.tokenExp) {
    await DenyList.add(req.tokenJti, req.tokenExp * 1000);
  }
  // Revoke the refresh token too if present
  const portal = portalOf(req);
  const refreshToken = req.cookies?.[refreshCookieName(portal)] || req.cookies?.akoro_refresh;
  if (refreshToken) {
    try {
      const decoded = verifyToken(refreshToken);
      await RefreshStore.delete(decoded.jti);
    } catch { /* expired/invalid — ignore */ }
  }
  clearAuthCookies(res, portal);
}

// ─── § DENY-LIST (jti blacklist) ──────────────────────────────────────────────
// Stores revoked access token jtis until their natural expiry.
// In production swap the in-memory map for Redis: SET jti:${jti} 1 EX ${ttl}

const _denyList = new Map(); // jti → expiresAt (ms)

const DenyList = {
  add: async (jti, expiresAt) => {
    _denyList.set(jti, expiresAt);
    // Persist to DB for multi-instance support
    try {
      await db.from("revoked_tokens").insert({ jti, expires_at: new Date(expiresAt).toISOString() });
    } catch { /* table may not exist yet — in-memory fallback suffices */ }
  },
  has: async (jti) => {
    if (_denyList.has(jti)) return true;
    // Check DB
    try {
      const { data } = await db.from("revoked_tokens").select("jti").eq("jti", jti).maybeSingle();
      return !!data;
    } catch { return false; }
  },
  sweep: () => {
    const now = Date.now();
    for (const [k, v] of _denyList) if (v < now) _denyList.delete(k);
  },
};
setInterval(DenyList.sweep, 60_000); // clean expired entries every minute

// ─── § REFRESH TOKEN STORE ────────────────────────────────────────────────────
// Stores valid refresh token metadata.  Supports rotation + family revocation.

const RefreshStore = {
  // Save a newly issued refresh token
  save: async (jti, userId, family, expiresAt) => {
    try {
      await db.from("refresh_tokens").insert({
        jti,
        user_id:    userId,
        family,
        expires_at: new Date(expiresAt * 1000).toISOString(),
        used:       false,
      });
    } catch (e) {
      console.error("RefreshStore.save error:", e.message);
    }
  },
  // Find by jti — returns row or null
  find: async (jti) => {
    try {
      const { data } = await db.from("refresh_tokens").select("*").eq("jti", jti).maybeSingle();
      return data;
    } catch { return null; }
  },
  // Mark a token as used (to detect replay)
  markUsed: async (jti) => {
    try { await db.from("refresh_tokens").update({ used: true }).eq("jti", jti); }
    catch { /* ignore */ }
  },
  // Revoke entire family (replay attack detected)
  revokeFamily: async (family) => {
    try { await db.from("refresh_tokens").delete().eq("family", family); }
    catch { /* ignore */ }
  },
  // Delete a single token (clean logout)
  delete: async (jti) => {
    try { await db.from("refresh_tokens").delete().eq("jti", jti); }
    catch { /* ignore */ }
  },
};

// peekAccessToken lives in lib/tokenPeek.js: the rate limiters need it, and
// importing this module there would close the cycle security → auth → security.
// Re-exported so callers have one obvious place to find it.
export { peekAccessToken, readAccessToken } from "../../lib/tokenPeek.js";

// ─── § JWT MIDDLEWARE ─────────────────────────────────────────────────────────

/**
 * authenticateToken
 * Reads access token from HttpOnly cookie (preferred) or Authorization header.
 * Validates algorithm, issuer, audience, expiry, and deny-list.
 */
export const authenticateToken = asyncHandler(async (req, res, next) => {
  // 1. Extract token — cookie first, then Bearer fallback
  const cookieToken = req.cookies?.[accessCookieName(portalOf(req))] || req.cookies?.akoro_access;
  const headerToken = (() => {
    const h = req.headers["authorization"];
    return h?.startsWith("Bearer ") ? h.slice(7) : null;
  })();
  const token = cookieToken || headerToken;
  if (!token) return res401(res, "Access token required");

  // 2. Reject alg:none proactively — decode header without verifying
  try {
    const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    if (!header.alg || header.alg === "none" || (!USE_RSA && !["HS256"].includes(header.alg)) || (USE_RSA && !ALLOWED_ALGS.includes(header.alg))) {
      return res401(res, "Token algorithm not permitted");
    }
  } catch {
    return res401(res, "Malformed token");
  }

  // 3. Verify signature + standard claims (iss, aud, exp enforced by jsonwebtoken)
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    return res403(res, err.name === "TokenExpiredError" ? "Access token expired" : "Invalid token");
  }

  // 4. Check deny-list
  if (decoded.jti && await DenyList.has(decoded.jti)) {
    return res401(res, "Token has been revoked");
  }

  // 5. Load user — try with onboarding_completed, fall back without if column is missing
  try {
    let user, dbErr;
    ({ data: user, error: dbErr } = await db.from("users")
      .select("id,email,username,full_name,avatar_url,role,is_active,onboarding_completed,force_logout_at")
      .eq("id", decoded.sub).maybeSingle());

    if (dbErr) {
      // Column may not exist yet (pending migration) — retry without it
      ({ data: user, error: dbErr } = await db.from("users")
        .select("id,email,username,full_name,avatar_url,role,is_active")
        .eq("id", decoded.sub).maybeSingle());
      if (dbErr) return res401(res, "Could not load user");
    }

    if (!user) return res401(res, "User not found");
    if (!user.is_active) return res401(res, "Account deactivated");
    if (user.force_logout_at && decoded.iat && decoded.iat * 1000 < new Date(user.force_logout_at).getTime())
      return res401(res, "Session terminated by administrator");
    req.user    = { id: user.id, email: user.email, username: user.username, fullName: user.full_name, avatarUrl: user.avatar_url, role: user.role, onboardingCompleted: user.onboarding_completed ?? false };
    req.tokenJti = decoded.jti;
    req.tokenExp = decoded.exp;
    // Run the rest of the request inside the AI-metering context so any AI call
    // it makes is billed correctly. On a SCHOOL portal the school funds the
    // usage (billTo); the student portal keeps the student-first hybrid.
    const billTo = SCHOOL_PORTALS.includes(portalOf(req)) ? await schoolBillTo(user.id) : null;
    return runWithAiContext({ userId: user.id, feature: featureForRequest(req), billTo }, () => next());
  } catch {
    return res401(res, "Could not load user");
  }
});

export const requireRole = (roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role))
    return res403(res, `Requires one of: ${roles.join(", ")}`);
  next();
};

// ─── § VALIDATION RULES ───────────────────────────────────────────────────────

const rules = {
  register: [
    body("email").trim().isEmail().normalizeEmail(),
    // Username is optional — schools sign up without one (auto-generated below).
    body("username").optional({ checkFalsy: true }).trim().isLength({ min: 3, max: 40 }).matches(/^[a-zA-Z0-9_]+$/),
    body("password").isLength({ min: 8 }),
    body("fullName").optional().trim().isLength({ max: 120 }),
    body("role").optional().isIn(["student", "instructor", "school_admin"]),
  ],
  login: [
    body("email").trim().isEmail().normalizeEmail(),
    body("password").notEmpty(),
  ],
  review: [
    body("rating").isInt({ min: 1, max: 5 }),
    body("comment").optional().trim().isLength({ max: 2000 }),
  ],
  progress: [
    body("videoId").notEmpty(),
    body("courseId").notEmpty(),
    body("position").isInt({ min: 0 }),
    body("completed").optional().isBoolean(),
  ],
};

// ─── § AUTH HANDLERS ──────────────────────────────────────────────────────────

const safeUser = (u) => ({
  id:        u.id,
  email:     u.email,
  username:  u.username,
  fullName:  u.full_name || u.fullName,
  avatarUrl: u.avatar_url || u.avatarUrl,
  role:      u.role,
  onboardingCompleted: u.onboarding_completed ?? u.onboardingCompleted ?? false,
});

// Short-lived (5 min) token proving password step passed, pending TOTP code.
const signChallenge = (userId) => {
  const payload = { sub: userId, type: "2fa_challenge", iss: JWT_ISSUER, aud: JWT_AUDIENCE };
  return USE_RSA
    ? jwt.sign(payload, PRIVATE_KEY, { algorithm: "RS256", expiresIn: 300 })
    : jwt.sign(payload, DEV_SECRET,  { algorithm: "HS256", expiresIn: 300 });
};

const issueTokenPair = async (res, user, portal = "student") => {
  const { token: accessToken, jti: accessJti } = signAccess(user);
  const family = randomUUID();
  const { token: refreshToken, jti: refreshJti } = signRefresh(user.id || user.id, family);
  const refreshExp = Math.floor(Date.now() / 1000) + REFRESH_TTL_SECS;

  await RefreshStore.save(refreshJti, user.id, family, refreshExp);

  setAccessCookie(res, accessToken, portal);
  setRefreshCookie(res, refreshToken, portal);
  clearLegacyCookies(res);

  // Also return tokens in body for mobile clients
  return { accessToken, refreshToken, user: safeUser(user) };
};

const authHandlers = {

  // POST /api/auth/register
  register: asyncHandler(async (req, res) => {
    const { email, password, fullName, role = "student" } = req.body;
    let { username } = req.body;

    const { data: existing } = await db.from("users").select("id").eq("email", email).maybeSingle();
    if (existing) return res400(res, "Email already registered");

    // Auto-generate a unique username when none is supplied (e.g. schools).
    if (!username) {
      const base = (email.split("@")[0] || "user").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30) || "user";
      username = `${base}_${Date.now().toString(36).slice(-4)}`;
    }
    const { data: existingUser } = await db.from("users").select("id").eq("username", username).maybeSingle();
    if (existingUser) {
      if (req.body.username) return res400(res, "Username already taken");
      username = `${username}_${Math.random().toString(36).slice(2, 6)}`; // collision → nudge
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const { data: user, error } = await db.from("users").insert({
      email, username,
      password_hash:  passwordHash,
      full_name:      fullName ?? null,
      role,
      is_active:      true,
      email_verified: false,
    }).select("*").single();

    if (error) return res400(res, "Registration failed");

    const payload = await issueTokenPair(res, user, portalOf(req));

    const loginUrl = role === "instructor" ? `${INSTRUCTOR_FRONTEND_URL}/signin`
      : role === "school_admin" ? `${SCHOOL_FRONTEND_URL}/signin`
      : `${FRONTEND_URL}/signin`;
    sendWelcomeEmail({ to: user.email, name: user.full_name || user.username, loginUrl, role })
      .catch(() => {});

    res201(res, payload);
  }),

  // POST /api/auth/login
  login: asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const { data: user } = await db.from("users").select("*").eq("email", email).maybeSingle();
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
        await db.from("users").update({
          is_active: true, deactivated_at: null, updated_at: new Date().toISOString(),
        }).eq("id", user.id);
        // Reactivate only the most recent agent to preserve the single-active-agent invariant
        const { data: lastAgent } = await db.from("user_agents")
          .select("id").eq("user_id", user.id)
          .order("updated_at", { ascending: false }).limit(1).maybeSingle();
        if (lastAgent) await db.from("user_agents").update({ is_active: true }).eq("id", lastAgent.id);
        user.is_active = true;
      } else {
        return res403(res, "Account deactivated");
      }
    }

    // Two-factor gate — issue a short-lived challenge token instead of a session.
    if (user.two_factor_enabled && user.two_factor_secret) {
      const challengeToken = signChallenge(user.id);
      return res200(res, { twoFactorRequired: true, challengeToken });
    }

    const payload = await issueTokenPair(res, user, portalOf(req));

    const signinUrl = user.role === "instructor" ? `${INSTRUCTOR_FRONTEND_URL}/signin` : `${FRONTEND_URL}/signin`;
    sendLoginAlertEmail({
      to: user.email, name: user.full_name || user.username,
      ip: req.ip, userAgent: req.headers["user-agent"],
      time: new Date(), signinUrl,
    }).catch(() => {});

    res200(res, payload);
  }),

  // POST /api/auth/2fa/login — complete a 2FA-gated login with a TOTP code.
  twoFactorLogin: asyncHandler(async (req, res) => {
    const { challengeToken, code } = req.body;
    if (!challengeToken || !code) return res401(res, "Challenge token and code required");

    let decoded;
    try { decoded = verifyToken(challengeToken); }
    catch { return res401(res, "Invalid or expired challenge"); }
    if (decoded.type !== "2fa_challenge") return res401(res, "Not a 2FA challenge token");

    const { data: user } = await db.from("users").select("*").eq("id", decoded.sub).maybeSingle();
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
  }),

  // ─── § 2FA management (authenticated) ───────────────────────────────────────

  // POST /api/auth/2fa/setup — generate a pending secret + provisioning URI.
  twoFactorSetup: asyncHandler(async (req, res) => {
    const { data: user } = await db.from("users").select("id,email,two_factor_enabled").eq("id", req.user.id).maybeSingle();
    if (!user) return res401(res, "User not found");
    if (user.two_factor_enabled) return res.status(400).json({ success: false, message: "2FA already enabled" });

    const secret = generateSecret();
    await db.from("users").update({ two_factor_secret: secret }).eq("id", user.id);

    res200(res, {
      secret,
      otpauthUrl: otpauthURL(secret, user.email, "Akoro"),
    });
  }),

  // POST /api/auth/2fa/enable — verify the first code, then turn 2FA on.
  twoFactorEnable: asyncHandler(async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: "Code required" });

    const { data: user } = await db.from("users").select("id,two_factor_secret,two_factor_enabled").eq("id", req.user.id).maybeSingle();
    if (!user || !user.two_factor_secret) return res.status(400).json({ success: false, message: "Run 2FA setup first" });
    if (!verifyTOTP(user.two_factor_secret, code)) return res.status(400).json({ success: false, message: "Invalid authentication code" });

    await db.from("users").update({ two_factor_enabled: true }).eq("id", user.id);
    res200(res, { twoFactorEnabled: true });
  }),

  // POST /api/auth/2fa/disable — verify a current code, then turn 2FA off.
  twoFactorDisable: asyncHandler(async (req, res) => {
    const { code } = req.body;
    const { data: user } = await db.from("users").select("id,two_factor_secret,two_factor_enabled").eq("id", req.user.id).maybeSingle();
    if (!user || !user.two_factor_enabled) return res.status(400).json({ success: false, message: "2FA not enabled" });
    if (!code || !verifyTOTP(user.two_factor_secret, code)) return res.status(400).json({ success: false, message: "Invalid authentication code" });

    await db.from("users").update({ two_factor_enabled: false, two_factor_secret: null }).eq("id", user.id);
    res200(res, { twoFactorEnabled: false });
  }),

  // POST /api/auth/refresh  — rotate refresh token
  refresh: asyncHandler(async (req, res) => {
    const portal = portalOf(req);
    const refreshToken = req.cookies?.[refreshCookieName(portal)] || req.cookies?.akoro_refresh || req.body?.refreshToken;
    if (!refreshToken) return res401(res, "Refresh token required");

    let decoded;
    try {
      decoded = verifyToken(refreshToken);
    } catch {
      clearAuthCookies(res, portal);
      return res401(res, "Invalid or expired refresh token");
    }

    if (decoded.type !== "refresh") return res401(res, "Not a refresh token");

    const stored = await RefreshStore.find(decoded.jti);
    if (!stored) {
      // Token not found — possible replay after expiry
      clearAuthCookies(res, portal);
      return res401(res, "Refresh token not found");
    }

    if (stored.used) {
      // ⚠ REPLAY DETECTED — revoke entire family
      await RefreshStore.revokeFamily(stored.family);
      clearAuthCookies(res, portal);
      return res401(res, "Refresh token reuse detected — all sessions revoked");
    }

    // Mark old token as used, then issue new pair
    await RefreshStore.markUsed(decoded.jti);

    const { data: user } = await db.from("users").select("*").eq("id", stored.user_id).maybeSingle();
    if (!user || !user.is_active) {
      clearAuthCookies(res, portal);
      return res401(res, "User not found");
    }

    // New refresh token inherits the same family
    const { token: accessToken } = signAccess(user);
    const { token: newRefreshToken, jti: newRefreshJti } = signRefresh(user.id, stored.family);
    const newRefreshExp = Math.floor(Date.now() / 1000) + REFRESH_TTL_SECS;

    await RefreshStore.save(newRefreshJti, user.id, stored.family, newRefreshExp);
    setAccessCookie(res, accessToken, portal);
    setRefreshCookie(res, newRefreshToken, portal);
    clearLegacyCookies(res);

    res200(res, { accessToken, refreshToken: newRefreshToken, user: safeUser(user) });
  }),

  // POST /api/auth/logout
  logout: asyncHandler(async (req, res) => {
    // Deny-list the current access token's jti
    if (req.tokenJti && req.tokenExp) {
      await DenyList.add(req.tokenJti, req.tokenExp * 1000);
    }
    // Remove the refresh token if sent
    const portal = portalOf(req);
    const refreshToken = req.cookies?.[refreshCookieName(portal)] || req.cookies?.akoro_refresh;
    if (refreshToken) {
      try {
        const decoded = verifyToken(refreshToken);
        await RefreshStore.delete(decoded.jti);
      } catch { /* expired or invalid — ignore */ }
    }
    clearAuthCookies(res, portal);
    res200(res, { message: "Logged out" });
  }),

  // GET /api/auth/me
  me: asyncHandler(async (req, res) => {
    res200(res, req.user);
  }),

  // POST /api/auth/change-password — verify current password, set new one
  changePassword: asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res400(res, "currentPassword and newPassword are required");
    if (newPassword.length < 8)
      return res400(res, "New password must be at least 8 characters");

    const { data: user } = await db.from("users")
      .select("id,password_hash").eq("id", req.user.id).maybeSingle();
    if (!user) return res401(res, "User not found");

    const valid = await bcrypt.compare(currentPassword, user.password_hash || "");
    if (!valid) return res.status(403).json({ success: false, message: "Current password is incorrect" });

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.from("users").update({ password_hash: newHash, updated_at: new Date().toISOString() }).eq("id", user.id);

    // Invalidate current access token so the client must re-authenticate
    if (req.tokenJti && req.tokenExp) {
      await DenyList.add(req.tokenJti, req.tokenExp * 1000);
    }
    clearAuthCookies(res);

    const signinUrlChg = req.user.role === "instructor"
      ? `${INSTRUCTOR_FRONTEND_URL}/signin`
      : `${FRONTEND_URL}/signin`;
    sendPasswordChangedEmail({
      to: req.user.email,
      name: req.user.fullName || req.user.username || "there",
      ip: req.ip,
      signinUrl: signinUrlChg,
    }).catch(() => {});

    res200(res, { passwordChanged: true });
  }),
};

// ─── § GOOGLE OAUTH ───────────────────────────────────────────────────────────

const CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || "https://api.akoro.app/api/auth/google/callback";

passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID     || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    callbackURL:  CALLBACK_URL,
  },
  async (_accessToken, _refreshToken, profile, done) => {
    try {
      const email    = profile.emails?.[0]?.value;
      const fullName = profile.displayName || "";
      const avatar   = profile.photos?.[0]?.value || null;
      const googleId = profile.id;

      if (!email) return done(new Error("Google did not return an email"), null);

      const { data: existing } = await db.from("users").select("*").eq("email", email).maybeSingle();

      if (existing) {
        const { data: updated } = await db.from("users")
          .update({ google_id: existing.google_id || googleId, avatar_url: existing.avatar_url || avatar })
          .eq("id", existing.id).select("*").single();
        return done(null, updated || existing);
      }

      const username = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "_") + "_" + Date.now().toString().slice(-4);
      const { data: created, error } = await db.from("users").insert({
        email, full_name: fullName, username,
        password_hash:  "",
        avatar_url:     avatar,
        google_id:      googleId,
        role:           "student",
        is_active:      true,
        email_verified: true,
      }).select("*").single();

      if (error) return done(error, null);
      return done(null, created);
    } catch (err) {
      return done(err, null);
    }
  }
));

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

router.post("/register", strictLimit,  rules.register, runValidation, authHandlers.register);
router.post("/login",    strictLimit,  rules.login,    runValidation, authHandlers.login);
router.post("/refresh",  refreshLimit, authHandlers.refresh);
router.post("/logout",   authenticateToken, authHandlers.logout);
router.get ("/me",       authenticateToken, authHandlers.me);

// Two-factor authentication
router.post("/2fa/login",   strictLimit, authHandlers.twoFactorLogin);
router.post("/2fa/setup",   authenticateToken, authHandlers.twoFactorSetup);
router.post("/2fa/enable",  strictLimit, authenticateToken, authHandlers.twoFactorEnable);
router.post("/2fa/disable", strictLimit, authenticateToken, authHandlers.twoFactorDisable);

router.post("/change-password", authenticateToken, authHandlers.changePassword);

// Google OAuth
// ?portal=instructor | admin  →  signals which portal the login came from
// Portals that may start a Google sign-in. Must stay in sync with PORTAL_IDS —
// a portal missing here silently degrades to "student", which would drop the
// user's session into the learner cookie and bounce them to the learner app.
const PORTALS = ["instructor", "admin", "student", "school", "agent", "business"];
// state = "<portal>.<nonce>"; the nonce is mirrored in an httpOnly cookie and
// re-checked on callback so an attacker can't stitch a victim's browser to the
// attacker's Google identity (login CSRF).
const parseState = (s) => { const [portal, nonce] = String(s || "").split("."); return { portal: PORTALS.includes(portal) ? portal : "student", nonce: nonce || "" }; };
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
  asyncHandler(async (req, res) => {
    const user   = req.user;
    const { portal } = parseState(req.query.state);

    // Role enforcement per portal
    if (portal === "instructor" && user.role !== "instructor" && user.role !== "admin") {
      return res.redirect(`${INSTRUCTOR_FRONTEND_URL}/signin?error=not_instructor`);
    }
    if (portal === "admin" && user.role !== "admin") {
      return res.redirect(`${ADMIN_FRONTEND_URL}/signin?error=not_admin`);
    }
    if (portal === "school" && !["school", "school_admin", "admin"].includes(user.role)) {
      return res.redirect(`${SCHOOL_FRONTEND_URL}/signin?error=not_instructor`);
    }

    const { token: accessToken } = signAccess(user);
    const family = randomUUID();
    const { token: refreshToken, jti: refreshJti } = signRefresh(user.id, family);
    const refreshExp = Math.floor(Date.now() / 1000) + REFRESH_TTL_SECS;

    await RefreshStore.save(refreshJti, user.id, family, refreshExp);

    // `portal` here comes from the OAuth state (set on /google?portal=…), so the
    // cookie is scoped to the app that started the Google sign-in.
    setAccessCookie(res, accessToken, portal);
    setRefreshCookie(res, refreshToken, portal);
    clearLegacyCookies(res);

    const safe = safeUser(user);
    const userParam = encodeURIComponent(JSON.stringify(safe));
    const target = portalUrl(portal);

    // Send welcome for brand-new Google accounts, login alert for returning users
    const isNew = !user.password_hash && !user.created_at_was_existing; // heuristic: no PW set = new
    const emailName = user.full_name || user.username;
    const signinUrlOauth = `${target}/signin`;
    if (isNew) {
      sendWelcomeEmail({ to: user.email, name: emailName, loginUrl: signinUrlOauth, role: user.role })
        .catch(() => {});
    } else {
      sendLoginAlertEmail({
        to: user.email, name: emailName,
        ip: req.ip, userAgent: req.headers["user-agent"],
        time: new Date(), signinUrl: signinUrlOauth,
      }).catch(() => {});
    }

    res.redirect(`${target}/auth/callback?user=${userParam}`);
  })
);

// ─── § FORGOT / RESET PASSWORD ────────────────────────────────────────────────

const RESET_TTL_MS = 60 * 60 * 1000;   // 1 hour

function hashToken(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

/** POST /api/auth/forgot-password */
router.post("/forgot-password", strictLimit,
  body("email").isEmail().normalizeEmail(),
  runValidation,
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    // Always respond 200 — never reveal whether an email is registered
    const { data: user } = await db.from("users")
      .select("id, full_name, email, is_active")
      .eq("email", email)
      .maybeSingle();

    if (user && user.is_active) {
      // Invalidate any existing unused tokens for this user
      await db.from("password_reset_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("used_at", null);

      const rawToken  = randomUUID();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();

      await db.from("password_reset_tokens").insert({
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
      const PORTAL_URLS = [FRONTEND_URL, INSTRUCTOR_FRONTEND_URL, ADMIN_FRONTEND_URL, SCHOOL_FRONTEND_URL, AGENT_FRONTEND_URL, BUSINESS_FRONTEND_URL];
      const base = PORTAL_URLS.find((u) => { try { return new URL(u).host === refererHost; } catch { return false; } }) || FRONTEND_URL;
      const resetUrl = `${base}/reset-password?token=${rawToken}`;

      sendPasswordResetEmail({ to: user.email, name: user.full_name || user.username || "there", resetUrl })
        .catch(() => {}); // fire-and-forget; don't leak email errors
    }

    res200(res, { message: "If that email is registered, a reset link has been sent." });
  })
);

/** POST /api/auth/reset-password */
router.post("/reset-password", strictLimit,
  body("token").notEmpty(),
  body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
  runValidation,
  asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    const tokenHash = hashToken(token);

    const { data: record } = await db.from("password_reset_tokens")
      .select("id, user_id, expires_at, used_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!record)                              return res400(res, "Invalid or expired reset link.");
    if (record.used_at)                       return res400(res, "This reset link has already been used.");
    if (new Date(record.expires_at) < new Date()) return res400(res, "This reset link has expired. Please request a new one.");

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Mark token used + update password in one go
    await Promise.all([
      db.from("password_reset_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("id", record.id),
      db.from("users")
        .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
        .eq("id", record.user_id),
    ]);

    // Revoke all active refresh tokens for this user (force re-login everywhere)
    await db.from("refresh_tokens")
      .update({ used: true })
      .eq("user_id", record.user_id)
      .eq("used", false);

    // Notify the user their password was changed
    const { data: resetUser } = await db.from("users")
      .select("email, full_name, username, role")
      .eq("id", record.user_id)
      .maybeSingle();
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
  })
);

export default router;

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
