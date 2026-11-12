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
import { urlFor } from "../../lib/urls.js";
import { userFacingMessage } from "../../lib/userFacingError.js";
import {
  issueEmailCode, verifyEmailCode, resendEmailCode, consumeEmailCode,
  emailCodesEnabled, emailCodeBypassed, normaliseEmail, CODE_TTL_MINUTES,
} from "./emailCodes.js";

// ─── § CONSTANTS ──────────────────────────────────────────────────────────────

const PRIVATE_KEY  = (process.env.JWT_PRIVATE_KEY  || "").replace(/\\n/g, "\n").trim();
const PUBLIC_KEY   = (process.env.JWT_PUBLIC_KEY   || "").replace(/\\n/g, "\n").trim();

const JWT_ISSUER   = process.env.JWT_ISSUER   || "https://api.akoro.app";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "https://akoro.app";
const FRONTEND_URL            = urlFor("FRONTEND_URL");
const INSTRUCTOR_FRONTEND_URL = urlFor("INSTRUCTOR_FRONTEND_URL");
const ADMIN_FRONTEND_URL      = urlFor("ADMIN_FRONTEND_URL");
const SCHOOL_FRONTEND_URL     = urlFor("SCHOOL_FRONTEND_URL");
const AGENT_FRONTEND_URL      = urlFor("AGENT_FRONTEND_URL");
const BUSINESS_FRONTEND_URL   = urlFor("BUSINESS_FRONTEND_URL");

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

/**
 * How long after a refresh token is spent a second use of it is still treated
 * as the same client racing itself rather than as a stolen token.
 *
 * Long enough to cover a slow network round-trip and two tabs waking together;
 * short enough that a token lifted from a device is useless by the time anyone
 * could use it. 30 seconds. Set REFRESH_GRACE_SECS=0 to restore the old
 * behaviour of revoking the family on any reuse.
 */
const REFRESH_GRACE_MS = Math.max(0, parseInt(process.env.REFRESH_GRACE_SECS ?? "30", 10)) * 1000;
const ALLOWED_ALGS     = ["RS256"];       // whitelist — never HS256 / none

// RS256 when the keypair is set, else HS256 with JWT_SECRET. There is no
// built-in default: with neither, nothing can be signed or verified (sign-in
// is off), and config/index.js refuses to boot in production.
const USE_RSA = PRIVATE_KEY.includes("-----BEGIN") && PUBLIC_KEY.includes("-----BEGIN");
const HS_SECRET = process.env.JWT_SECRET || null;   // used as-is (never trimmed: that would change a live key)
if (!USE_RSA && !HS_SECRET) console.error("[auth] ❌ No JWT key: set JWT_PRIVATE_KEY + JWT_PUBLIC_KEY or JWT_SECRET. Sign-in is disabled.");

// ─── § HELPERS ────────────────────────────────────────────────────────────────

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const safe = (message) => userFacingMessage(message);
const res400 = (res, message)         => res.status(400).json({ success: false, message: safe(message) });
const res401 = (res, message, code)   => res.status(401).json({ success: false, message: safe(message), ...(code ? { code } : {}) });
const res403 = (res, message)         => res.status(403).json({ success: false, message: safe(message) });
const res404 = (res, message)         => res.status(404).json({ success: false, message: safe(message) });

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
    : jwt.sign(payload, HS_SECRET,  { algorithm: "HS256", expiresIn: ACCESS_TTL_SECS });
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
    : jwt.sign(payload, HS_SECRET,  { algorithm: "HS256", expiresIn: ttlSeconds });
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
    : jwt.sign(payload, HS_SECRET,  { algorithm: "HS256", expiresIn: REFRESH_TTL_SECS });
  return { token, jti };
}

/* Auth I/O deadline — the wedge the watchdog finally caught live
   (REQUEST_STALLED GET /api/communities/:id, age 25s, app otherwise
   healthy: favicon 404 in 1ms during the stall). authenticateToken makes
   up to three network calls BEFORE any route code runs — deny-list check,
   the cold-cache user load, schoolBillTo on school portals — and none of
   them had a deadline. A fetch that lands on a keep-alive socket the
   server has just closed can hang for undici's 300s header timeout:
   past the client's 30s give-up, past the route's own query deadline
   (which never starts), silent in every log. Auth I/O that cannot answer
   in 10s is a 503 the client can retry — never a 401 (that would sign
   the learner out of a perfectly good session), never a silent hang. */
const AUTH_IO_TIMEOUT_MS = 10_000;

function withAuthDeadline(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`auth backend stalled on ${label}`);
      err.step = label;
      err.authStall = true;
      reject(err);
    }, AUTH_IO_TIMEOUT_MS);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * A session token is one that signs someone in: an access token (or a job's
 * internal access token). Every other token this module signs carries a `type`
 * — "refresh", "2fa_challenge", "ai_handoff" — and is only good at its own
 * endpoint. Same key, issuer and audience, so the type is the only thing that
 * keeps a 2FA challenge (password, no code yet) from working as a login.
 */
export const isSessionToken = (decoded) => !!decoded && !decoded.type;

function verifyToken(token) {
  const verifyKey = USE_RSA ? PUBLIC_KEY : HS_SECRET;
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
    : jwt.sign(payload, HS_SECRET,  { algorithm: "HS256", expiresIn: 120 });
};
const verifyHandoff = (token) => {
  try {
    const d = verifyToken(token);
    return d && d.type === "ai_handoff" ? d.sub : null;
  } catch { return null; }
};
export { signHandoff, verifyHandoff };

// Course invite — a teacher's link into their own courses (POST
// /api/profiles/teacher/invite, redeemed at /api/profiles/invite/…). Signed by
// the same factory and key as a login, but typed, so authenticateToken and the
// socket check refuse it as a sign-in. Days are clamped to 1–30.
export const INVITE_MAX_DAYS = 30;
export function signCourseInvite({ teacherId, courseIds }, days = 7) {
  const ttl = Math.min(INVITE_MAX_DAYS, Math.max(1, Math.round(Number(days) || 7))) * 86400;
  const payload = { sub: teacherId, courseIds, type: "course_invite", iss: JWT_ISSUER, aud: JWT_AUDIENCE };
  return USE_RSA
    ? jwt.sign(payload, PRIVATE_KEY, { algorithm: "RS256", expiresIn: ttl })
    : jwt.sign(payload, HS_SECRET,  { algorithm: "HS256", expiresIn: ttl });
}
/** → { teacherId, courseIds, expiresAt } for a valid, unexpired invite; null for anything else. */
export function verifyCourseInvite(token) {
  if (typeof token !== "string" || !token || token.length > 4096) return null;
  try {
    const d = verifyToken(token);
    const courseIds = Array.isArray(d?.courseIds) ? [...new Set(d.courseIds.filter((id) => typeof id === "string" && id))] : [];
    if (d?.type !== "course_invite" || !d.sub || !courseIds.length) return null;
    return { teacherId: d.sub, courseIds, expiresAt: new Date(d.exp * 1000).toISOString() };
  } catch { return null; }
}
// For the verification gate only (smoke.session_tokens_only): proves these never sign in.
export { signChallenge as signChallengeForGate, signRefresh as signRefreshForGate };

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
    if (!isSessionToken(decoded)) return null;
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
const _jtiClear = new Map(); // jti → "verified not revoked until" (ms)

// ─── § REQUEST-PATH USER CACHE ────────────────────────────────────────────────
// Every authenticated request used to cost two DB commands before any app
// logic ran: a revoked_tokens check and a full users reload. On a metered
// free tier that alone outran real product usage. Both are now cached:
//   • users row — 45s TTL keyed by user id. Non-security fields (avatar,
//     full_name, onboarding) may lag up to 45s behind an edit.
//   • revoked-token "clear" — 30s TTL keyed by jti (see DenyList.has).
// Anything that changes a SECURITY field (is_active, role, force_logout_at)
// must call invalidateCachedUser(userId) so the change applies immediately.
const USER_CACHE_TTL_MS = 45_000;
const JTI_CLEAR_TTL_MS = 30_000;
const _userCache = new Map(); // userId → { user, expires }
const USER_CACHE_MAX = 5_000;

function cacheUser(user) {
  if (_userCache.size >= USER_CACHE_MAX) _userCache.delete(_userCache.keys().next().value);
  _userCache.set(user.id, { user, expires: Date.now() + USER_CACHE_TTL_MS });
}

export function invalidateCachedUser(userId) {
  if (userId) _userCache.delete(userId);
}

const DenyList = {
  add: async (jti, expiresAt) => {
    _denyList.set(jti, expiresAt);
    // Persist to DB for multi-instance support
    try {
      await db.from("revoked_tokens").insert({ jti, expires_at: new Date(expiresAt).toISOString() });
    } catch { /* table may not exist yet — in-memory fallback suffices */ }
  },
  has: async (jti) => {
    if (!jti) return false;
    if (_denyList.has(jti)) return true;
    // A cleared jti is trusted for a short window: the alternative is one DB
    // command on EVERY authenticated request, which dominated the platform's
    // command quota. Same-instance revocations stay instant via _denyList;
    // a multi-instance deployment could observe up to this window of delay.
    const clearUntil = _jtiClear.get(jti);
    if (clearUntil) {
      if (clearUntil > Date.now()) return false;
      _jtiClear.delete(jti);
    }
    try {
      const { data } = await db.from("revoked_tokens").select("jti").eq("jti", jti).maybeSingle();
      if (data) { _denyList.set(jti, Date.now() + 24 * 60 * 60 * 1000); return true; } // revocation never expires back to valid
      _jtiClear.set(jti, Date.now() + JTI_CLEAR_TTL_MS);
      return false;
    } catch { return false; }
  },
  sweep: () => {
    const now = Date.now();
    for (const [k, v] of _denyList) if (v < now) _denyList.delete(k);
    for (const [k, v] of _jtiClear) if (v < now) _jtiClear.delete(k);
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
  // Mark a token as used, and record WHEN and by what it was replaced.
  // The timestamp is what separates a concurrent refresh from a replayed
  // token; without it every double-refresh looked like an attack.
  markUsed: async (jti, replacedBy = null) => {
    try {
      await db.from("refresh_tokens")
        .update({ used: true, used_at: new Date().toISOString(), replaced_by: replacedBy })
        .eq("jti", jti);
    } catch { /* ignore */ }
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

// The token-peek helpers live in lib/tokenPeek.js: the rate limiters need them, and
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
    // 401, never 403: an expired or bad token is FAILED AUTHENTICATION
    // (RFC 6750 §3.1), and every client's silent-refresh flow keys on 401.
    // Answering 403 here dressed "session expired, refresh and retry" up as
    // "you are not allowed", so learners got a hard failure where the app
    // should have spent the refresh cookie and replayed the request invisibly.
    // `code` lets clients branch without parsing message text.
    return res401(res,
      err.name === "TokenExpiredError" ? "Access token expired" : "Invalid token",
      err.name === "TokenExpiredError" ? "token_expired" : "token_invalid");
  }

  // 3b. Only a session token signs in — a refresh, 2FA-challenge or hand-off
  // token is good at its own endpoint only.
  if (!isSessionToken(decoded)) return res401(res, "Invalid token", "token_invalid");

  // 4. Check deny-list
  if (decoded.jti && await withAuthDeadline(DenyList.has(decoded.jti), "denylist")) {
    return res401(res, "Token has been revoked");
  }

  // 5. Load user — cache first (saves a DB command on virtually every
  // request), then the query, with a fallback without onboarding_completed
  // if that column is missing.
  try {
    let user, dbErr;
    const cached = _userCache.get(decoded.sub);
    if (cached && cached.expires > Date.now()) {
      user = cached.user;
    } else {
      ({ data: user, error: dbErr } = await withAuthDeadline(db.from("users")
        .select("id,email,username,full_name,avatar_url,role,is_active,onboarding_completed,force_logout_at")
        .eq("id", decoded.sub).maybeSingle(), "user-load"));

      if (dbErr) {
        // Column may not exist yet (pending migration) — retry without it
        ({ data: user, error: dbErr } = await withAuthDeadline(db.from("users")
          .select("id,email,username,full_name,avatar_url,role,is_active")
          .eq("id", decoded.sub).maybeSingle(), "user-load-fallback"));
        if (dbErr) return res401(res, "Could not load user");
      }
      if (user) cacheUser(user);
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
    const billTo = SCHOOL_PORTALS.includes(portalOf(req)) ? await withAuthDeadline(schoolBillTo(user.id), "school-bill-to") : null;
    return runWithAiContext({ userId: user.id, feature: featureForRequest(req), billTo }, () => next());
  } catch (err) {
    if (err?.authStall) {
      // Name the call that stalled and for how long — this is the line that
      // turns the next occurrence from a mystery into a measurement.
      console.error(`[auth] ${err.step} stalled > ${AUTH_IO_TIMEOUT_MS / 1000}s (likely a dead keep-alive socket) — 503`);
      return res.status(503).json({ error: "The sign-in check is not answering. Please retry." });
    }
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
const signChallenge = (userId, type = "2fa_challenge") => {
  const payload = { sub: userId, type, iss: JWT_ISSUER, aud: JWT_AUDIENCE };
  return USE_RSA
    ? jwt.sign(payload, PRIVATE_KEY, { algorithm: "RS256", expiresIn: 300 })
    : jwt.sign(payload, HS_SECRET,  { algorithm: "HS256", expiresIn: 300 });
};
const signSetupChallenge = (userId) => signChallenge(userId, "2fa_setup");

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

const issueTokenPair = async (res, user, portal = "student") => {
  const { token: accessToken, jti: accessJti } = signAccess(user);
  const family = randomUUID();
  const { token: refreshToken, jti: refreshJti } = signRefresh(user.id || user.id, family);
  const refreshExp = Math.floor(Date.now() / 1000) + REFRESH_TTL_SECS;

  await RefreshStore.save(refreshJti, user.id, family, refreshExp);

  setAccessCookie(res, accessToken, portal);
  setRefreshCookie(res, refreshToken, portal);
  clearLegacyCookies(res);

  // Also return tokens in body for mobile clients.
  //
  // accessExpiresAt exists because the access cookie is HttpOnly AND set on the
  // API's own domain, so a browser app on a different origin cannot read it or
  // its expiry. Without knowing when it dies, an app returning after 15 minutes
  // fires its whole first screen of requests, watches every one 401, refreshes
  // once and retries all of them — double the traffic and a wall of red in the
  // logs. Handing back the expiry lets the client refresh first instead.
  return { accessToken, refreshToken, accessExpiresAt: Date.now() + ACCESS_TTL_SECS * 1000, user: safeUser(user) };
};

const authHandlers = {

  // POST /api/auth/register
  register: asyncHandler(async (req, res) => {
    const { email, password, fullName, role = "student" } = req.body;
    let { username } = req.body;
    const portal = portalOf(req);
    const codesOn = emailCodesEnabled(portal);

    const { data: existing } = await db.from("users")
      .select("id, email, email_verified, full_name, username").eq("email", email).maybeSingle();
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
    const { data: existingUser } = await db.from("users").select("id").eq("username", username).maybeSingle();
    if (existingUser) {
      if (req.body.username) return res400(res, "Username already taken");
      username = `${username}_${Math.random().toString(36).slice(2, 6)}`;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const { data: user, error } = await db.from("users").insert({
      email, username,
      password_hash:  passwordHash,
      full_name:      fullName ?? null,
      role,
      is_active:      true,
      email_verified: !codesOn,
    }).select("*").single();
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
          retryAfter: issued.retryAfter ?? null });
      }
      return res201(res, { verificationRequired: true, email: normaliseEmail(email), codeSent: true,
        challengeId: issued.challengeId, expiresInMinutes: CODE_TTL_MINUTES });
    }

    const payload = await issueTokenPair(res, user, portal);
    const loginUrl = role === "instructor" ? `${INSTRUCTOR_FRONTEND_URL}/signin`
      : role === "school_admin" ? `${SCHOOL_FRONTEND_URL}/signin`
      : `${FRONTEND_URL}/signin`;
    sendWelcomeEmail({ to: user.email, name: user.full_name || user.username, loginUrl, role }).catch(() => {});
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

    // Email-code gate (per portal). Passwords alone no longer mint a session
    // when this portal is enabled; the code is emailed and verified next.
    const portal = portalOf(req);
    if (emailCodesEnabled(portal) && !emailCodeBypassed(user.email)) {
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
        email: normaliseEmail(user.email), codeSent: !!issued.ok,
        ...(issued.challengeId ? { challengeId: issued.challengeId, expiresInMinutes: CODE_TTL_MINUTES } : {}),
        ...(issued.ok ? {} : { retryAfter: issued.retryAfter ?? null }),
      });
    }

    // Two-factor gate — admins without 2FA are sent to setup, everyone with
    // 2FA gets the TOTP challenge, learners without it sign in normally.
    {
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
  }),

  // POST /api/auth/verify-email — finish sign-up with the emailed code.
  verifyEmail: asyncHandler(async (req, res) => {
    const { challengeId, code } = req.body;
    const verified = await verifyEmailCode({ challengeId, code, purpose: "signup" });
    if (!verified.ok) return res400(res, "Invalid or expired code.");
    const { data: user } = await db.from("users").select("*").eq("id", verified.row.user_id).maybeSingle();
    if (!user) return res400(res, "Invalid or expired code.");
    await db.from("users").update({ email_verified: true, updated_at: new Date().toISOString() }).eq("id", user.id);
    const payload = await issueTokenPair(res, user, portalOf(req));
    const loginUrl = user.role === "instructor" ? `${INSTRUCTOR_FRONTEND_URL}/signin` : `${FRONTEND_URL}/signin`;
    sendWelcomeEmail({ to: user.email, name: user.full_name || user.username, loginUrl, role: user.role }).catch(() => {});
    res200(res, payload);
  }),

  // POST /api/auth/verify-login — finish sign-in with the emailed code.
  verifyLogin: asyncHandler(async (req, res) => {
    const { challengeId, code } = req.body;
    let verified = await verifyEmailCode({ challengeId, code, purpose: "login" });
    if (!verified.ok) verified = await verifyEmailCode({ challengeId, code, purpose: "signup" });
    if (!verified.ok) return res400(res, "Invalid or expired code.");
    const { data: user } = await db.from("users").select("*").eq("id", verified.row.user_id).maybeSingle();
    if (!user || !user.is_active) return res401(res, "User not found");
    if (verified.row.purpose === "signup" && !user.email_verified) {
      await db.from("users").update({ email_verified: true, updated_at: new Date().toISOString() }).eq("id", user.id);
    }
    {
      const gate = twoFactorGate(user);
      if (gate) return res200(res, gate);
    }
    const payload = await issueTokenPair(res, user, portalOf(req));
    const signinUrl = user.role === "instructor" ? `${INSTRUCTOR_FRONTEND_URL}/signin` : `${FRONTEND_URL}/signin`;
    sendLoginAlertEmail({ to: user.email, name: user.full_name || user.username, ip: req.ip,
      userAgent: req.headers["user-agent"], time: new Date(), signinUrl }).catch(() => {});
    res200(res, payload);
  }),

  // POST /api/auth/resend-code — a fresh code for the same challenge.
  resendCode: asyncHandler(async (req, res) => {
    const { challengeId } = req.body;
    const issued = await resendEmailCode({ challengeId, ip: req.ip, userAgent: req.headers["user-agent"] });
    if (!issued.ok && issued.code === "send_failed") {
      return res.status(503).json({ success: false, message: "Could not send the code. Try again." });
    }
    if (!issued.ok && ["invalid_code"].includes(issued.code)) return res400(res, "Request a new code by signing in again.");
    return res200(res, { codeSent: !!issued.ok,
      ...(issued.challengeId ? { challengeId: issued.challengeId, expiresInMinutes: CODE_TTL_MINUTES } : {}),
      ...(issued.ok ? {} : { retryAfter: issued.retryAfter ?? null }) });
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
    if (req.setupFlow) {
      const { data: full } = await db.from("users").select("*").eq("id", user.id).maybeSingle();
      const payload = await issueTokenPair(res, full, portalOf(req));
      return res200(res, { ...payload, twoFactorEnabled: true });
    }
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
    // Every 401 from here signs somebody out, and until now they were
    // indistinguishable in the logs — "no cookie", "expired", "revoked family"
    // and "user deactivated" all arrived as a bare 401. Name the reason so a
    // logout reported from the field can be diagnosed from the logs instead of
    // guessed at.
    const deny = (reason, message, detail = {}) => {
      console.warn("[auth/refresh] denied", JSON.stringify({
        reason, portal,
        cookies: Object.keys(req.cookies ?? {}).filter((k) => k.startsWith("akoro_")),
        ua: (req.get("user-agent") ?? "").slice(0, 80),
        ...detail,
      }));
      return res401(res, message);
    };
    const refreshToken = req.cookies?.[refreshCookieName(portal)] || req.cookies?.akoro_refresh || req.body?.refreshToken;
    if (!refreshToken) return deny("no_cookie", "Refresh token required");

    let decoded;
    try {
      decoded = verifyToken(refreshToken);
    } catch {
      clearAuthCookies(res, portal);
      return deny("unverifiable", "Invalid or expired refresh token");
    }

    if (decoded.type !== "refresh") return deny("wrong_type", "Not a refresh token");

    const stored = await RefreshStore.find(decoded.jti);
    if (!stored) {
      // Token not found — possible replay after expiry
      clearAuthCookies(res, portal);
      return deny("not_in_store", "Refresh token not found", { jti: decoded.jti });
    }

    if (stored.used) {
      // Reuse of a spent token is either an attack or the app refreshing twice
      // at once — and treating both as an attack is what was signing people
      // out. The app races itself routinely: AuthContext's 13-minute timer and
      // api.js's 401-retry dedupe separately, two tabs each run their own
      // timer, and a retried request resends the same cookie. Each of those
      // revoked the whole family and bounced the user to sign-in, on every
      // device they owned.
      //
      // A token spent SECONDS ago by the legitimate holder is a race. A token
      // spent long ago and presented again is theft. The window tells them
      // apart. Tokens spent before used_at existed have NULL, which reads as
      // long ago — strict behaviour, correctly.
      const spentAt = stored.used_at ? new Date(stored.used_at).getTime() : 0;
      const withinGrace = spentAt > 0 && Date.now() - spentAt <= REFRESH_GRACE_MS;

      if (!withinGrace) {
        // ⚠ REPLAY DETECTED — revoke entire family
        await RefreshStore.revokeFamily(stored.family);
        clearAuthCookies(res, portal);
        return deny("replay", "Refresh token reuse detected — all sessions revoked",
          { jti: decoded.jti, family: stored.family, spentMsAgo: spentAt ? Date.now() - spentAt : null });
      }
      // Fall through: issue this caller a fresh token in the SAME family. The
      // session survives, rotation continues, and the only thing given up is
      // that two tokens in one family are briefly live — bounded by the window.
      console.warn(`[auth] concurrent refresh for family ${stored.family} (${Date.now() - spentAt}ms apart) — issuing a new token rather than revoking`);
    }

    const { data: user } = await db.from("users").select("*").eq("id", stored.user_id).maybeSingle();
    if (!user || !user.is_active) {
      clearAuthCookies(res, portal);
      return deny("user_inactive", "User not found", { userId: stored.user_id });
    }

    // New refresh token inherits the same family
    const { token: accessToken } = signAccess(user);
    const { token: newRefreshToken, jti: newRefreshJti } = signRefresh(user.id, stored.family);
    const newRefreshExp = Math.floor(Date.now() / 1000) + REFRESH_TTL_SECS;

    await RefreshStore.save(newRefreshJti, user.id, stored.family, newRefreshExp);
    // Spend the old token only once the replacement exists, and name the
    // replacement — so a crash between the two cannot leave a family with no
    // live token, which would log the user out just as surely.
    await RefreshStore.markUsed(decoded.jti, newRefreshJti);
    setAccessCookie(res, accessToken, portal);
    setRefreshCookie(res, newRefreshToken, portal);
    clearLegacyCookies(res);

    res200(res, {
      accessToken, refreshToken: newRefreshToken,
      accessExpiresAt: Date.now() + ACCESS_TTL_SECS * 1000,
      user: safeUser(user),
    });
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

  // POST /api/auth/change-password — verify current password, set new one.
  // OAuth accounts may have NO password on file (password_hash is null):
  // for them this is "set password" — no current password exists to verify,
  // so only the new password is required. Once a password exists, the
  // current one must always be supplied and verified.
  changePassword: asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword)
      return res400(res, "newPassword is required");
    if (newPassword.length < 8)
      return res400(res, "New password must be at least 8 characters");

    const { data: user } = await db.from("users")
      .select("id,password_hash").eq("id", req.user.id).maybeSingle();
    if (!user) return res401(res, "User not found");

    const hasPassword = !!user.password_hash;
    if (hasPassword) {
      if (!currentPassword)
        return res400(res, "currentPassword is required");
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) return res.status(403).json({ success: false, message: "Current password is incorrect" });
    }

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

    res200(res, { passwordChanged: true, passwordSet: !hasPassword });
  }),
};

// ─── § GOOGLE OAUTH ───────────────────────────────────────────────────────────

const CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || `${urlFor("API_URL")}/api/auth/google/callback`;

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
router.post("/verify-email", strictLimit, body("challengeId").isUUID(), body("code").isLength({ min: 6, max: 6 }), runValidation, authHandlers.verifyEmail);
router.post("/verify-login", strictLimit, body("challengeId").isUUID(), body("code").isLength({ min: 6, max: 6 }), runValidation, authHandlers.verifyLogin);
router.post("/resend-code",  strictLimit, body("challengeId").isUUID(), runValidation, authHandlers.resendCode);
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
    if (portal === "admin") {
      // Admin sessions require password + email code + TOTP. A Google redirect
      // cannot show the TOTP step, so never mint an admin session here.
      return res.redirect(`${ADMIN_FRONTEND_URL}/signin?error=admin_2fa_required`);
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
      .select("id, full_name, username, email, is_active")
      .eq("email", email)
      .maybeSingle();

    if (emailCodesEnabled(portalOf(req))) {
      if (user && user.is_active) {
        await issueEmailCode({
          userId: user.id, email: user.email, purpose: "reset",
          name: user.full_name || user.username || "there",
          ip: req.ip, userAgent: req.headers["user-agent"],
        }).catch(() => {});
      }
      // Same answer whether or not the account exists.
      return res200(res, { codeFlow: true, message: "If that email is registered, a code has been sent." });
    }

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
  body("token").optional({ values: "falsy" }),
  body("email").optional({ values: "falsy" }).isEmail().normalizeEmail(),
  body("code").optional({ values: "falsy" }).isLength({ min: 6, max: 6 }),
  body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
  runValidation,
  asyncHandler(async (req, res) => {
    const { token, password, email, code } = req.body;

    // Emailed-code reset (no link): verify, update, consume.
    if (!token) {
      if (!email || !code) return res400(res, "Enter the email and the code we sent.");
      const verified = await verifyEmailCode({ email, code, purpose: "reset", consume: false });
      if (!verified.ok || !verified.row.user_id) return res400(res, "Invalid or expired code.");
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await db.from("users")
        .update({ password_hash: passwordHash, must_change_password: false, updated_at: new Date().toISOString() })
        .eq("id", verified.row.user_id);
      await consumeEmailCode(verified.row.id);
      await db.from("refresh_tokens").update({ used: true }).eq("user_id", verified.row.user_id).eq("used", false);
      const { data: resetUser } = await db.from("users")
        .select("email, full_name, username, role").eq("id", verified.row.user_id).maybeSingle();
      if (resetUser) {
        const signinUrl = resetUser.role === "instructor" ? `${INSTRUCTOR_FRONTEND_URL}/signin` : `${FRONTEND_URL}/signin`;
        sendPasswordChangedEmail({ to: resetUser.email, name: resetUser.full_name || resetUser.username || "there",
          ip: req.ip, signinUrl }).catch(() => {});
      }
      return res200(res, { message: "Password updated. You can now sign in with your new password." });
    }

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
        .update({ password_hash: passwordHash, must_change_password: false, updated_at: new Date().toISOString() })
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
