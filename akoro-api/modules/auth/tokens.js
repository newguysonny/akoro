/**
 * auth/tokens.js — the single token factory: JWT constants and signing,
 * verification, hand-off/invite/challenge tokens, portal cookies, and the
 * jti deny-list (with its unref'd sweep).
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

import jwt            from "jsonwebtoken";
import { randomUUID } from "crypto";
import { PORTAL_IDS } from "./rules.js";
import { insertRevokedToken, findRevokedToken } from "./store.js";

// ─── § CONSTANTS ──────────────────────────────────────────────────────────────

const PRIVATE_KEY  = (process.env.JWT_PRIVATE_KEY  || "").replace(/\\n/g, "\n").trim();
const PUBLIC_KEY   = (process.env.JWT_PUBLIC_KEY   || "").replace(/\\n/g, "\n").trim();

const JWT_ISSUER   = process.env.JWT_ISSUER   || "https://api.akoro.app";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "https://akoro.app";

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

// Auth I/O deadline — the wedge the watchdog finally caught live
// (REQUEST_STALLED GET /api/communities/:id, age 25s, app otherwise
// healthy: favicon 404 in 1ms during the stall). authenticateToken makes
// up to three network calls BEFORE any route code runs — deny-list check,
// the cold-cache user load, schoolBillTo on school portals — and none of
// them had a deadline. A fetch that lands on a keep-alive socket the
// server has just closed can hang for undici's 300s header timeout:
// past the client's 30s give-up, past the route's own query deadline
// (which never starts), silent in every log. Auth I/O that cannot answer
// in 10s is a 503 the client can retry — never a 401 (that would sign
// the learner out of a perfectly good session), never a silent hang.
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

// Short-lived (5 min) token proving password step passed, pending TOTP code.
const signChallenge = (userId, type = "2fa_challenge") => {
  const payload = { sub: userId, type, iss: JWT_ISSUER, aud: JWT_AUDIENCE };
  return USE_RSA
    ? jwt.sign(payload, PRIVATE_KEY, { algorithm: "RS256", expiresIn: 300 })
    : jwt.sign(payload, HS_SECRET,  { algorithm: "HS256", expiresIn: 300 });
};
const signSetupChallenge = (userId) => signChallenge(userId, "2fa_setup");

// For the verification gate only (smoke.session_tokens_only): proves these never sign in.
export { signChallenge as signChallengeForGate, signRefresh as signRefreshForGate };

// ─── § COOKIE HELPERS ─────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === "production";

// ─── Portal-scoped session cookies ────────────────────────────────────────────
// Every frontend app (learner/instructor/school/admin) hits the same API, so a
// single shared cookie meant one session for all of them. We scope the cookie
// name per portal so each app holds an INDEPENDENT session in the same browser.
// The portal is declared by the app via the X-Akoro-Portal header (and, for the
// Google redirect which carries no header, via the OAuth `state`).
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

// ─── § DENY-LIST (jti blacklist) ──────────────────────────────────────────────
// Stores revoked access token jtis until their natural expiry.
// In production swap the in-memory map for Redis: SET jti:${jti} 1 EX ${ttl}

const _denyList = new Map(); // jti → expiresAt (ms)
const _jtiClear = new Map(); // jti → "verified not revoked until" (ms)
const JTI_CLEAR_TTL_MS = 30_000;

const DenyList = {
  add: async (jti, expiresAt) => {
    _denyList.set(jti, expiresAt);
    // Persist to DB for multi-instance support
    try {
      await insertRevokedToken(jti, new Date(expiresAt).toISOString());
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
      const { data } = await findRevokedToken(jti);
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
setInterval(DenyList.sweep, 60_000).unref?.(); // clean expired entries every minute; unref so a test process can exit

export {
  ACCESS_TTL_SECS, REFRESH_TTL_SECS, REFRESH_GRACE_MS,
  ALLOWED_ALGS, USE_RSA, AUTH_IO_TIMEOUT_MS,
  withAuthDeadline, verifyToken, signAccess, signRefresh,
  signChallenge, signSetupChallenge,
  accessCookieName, refreshCookieName, setAccessCookie, setRefreshCookie,
  clearAuthCookies, clearLegacyCookies, DenyList,
};
