/**
 * auth/session.js — authenticateToken, authenticateSocket, requireRole, and
 * the per-request user cache. This is the only place a request is authorised;
 * tokens.js stays the only place a token is signed or verified.
 */

import { runWithAiContext, featureForRequest } from "../../lib/aiContext.js";
import { schoolBillTo } from "../../lib/coins.js";
import { PORTAL_IDS, portalOf } from "./rules.js";
import { asyncHandler, res401, res403 } from "./service-common.js";
import {
  ALLOWED_ALGS, USE_RSA, AUTH_IO_TIMEOUT_MS,
  DenyList, isSessionToken, verifyToken, withAuthDeadline, accessCookieName,
} from "./tokens.js";
import { findAllSessionUser, findSessionUserFallback, findSocketUser } from "./store.js";

// Portals where AI usage is funded by the SCHOOL, not the individual user.
const SCHOOL_PORTALS = ["school", "school_admin", "site"];

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
const _userCache = new Map(); // userId → { user, expires }
const USER_CACHE_MAX = 5_000;

function cacheUser(user) {
  if (_userCache.size >= USER_CACHE_MAX) _userCache.delete(_userCache.keys().next().value);
  _userCache.set(user.id, { user, expires: Date.now() + USER_CACHE_TTL_MS });
}

export function invalidateCachedUser(userId) {
  if (userId) _userCache.delete(userId);
}

// ─── § JWT MIDDLEWARE ─────────────────────────────────────────────────────────

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

    const { data: user } = await findSocketUser(decoded.sub);
    if (!user || !user.is_active) return null;
    if (user.force_logout_at && decoded.iat && decoded.iat * 1000 < new Date(user.force_logout_at).getTime()) return null;

    return { id: user.id, email: user.email, username: user.username, fullName: user.full_name, avatarUrl: user.avatar_url, role: user.role };
  } catch {
    return null;
  }
}

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
      ({ data: user, error: dbErr } = await withAuthDeadline(findAllSessionUser(decoded.sub), "user-load"));

      if (dbErr) {
        // Column may not exist yet (pending migration) — retry without it
        ({ data: user, error: dbErr } = await withAuthDeadline(findSessionUserFallback(decoded.sub), "user-load-fallback"));
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
