/**
 * lib/tokenPeek.js — read a request's identity without a database round trip.
 *
 * This exists to break a cycle, not to duplicate auth. The rate limiters need
 * to know WHO a request is from in order to key a quota, but they are mounted
 * on the app while authenticateToken lives inside each router — so at limit
 * time req.user does not exist. Importing the auth module into the security
 * middleware creates security → auth → security, and ESM answers that with
 * "Cannot access 'strictLimit' before initialization".
 *
 * So the token-reading primitives live here, importing neither. The auth module
 * remains the only thing that AUTHORISES a request: this answers a narrower
 * question ("whose quota?") and is trusted for nothing else.
 *
 * Config is read from the same environment variables the auth module uses, so
 * the two cannot disagree about which key or issuer is valid.
 */
import jwt from "jsonwebtoken";

const PRIVATE_KEY  = (process.env.JWT_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
const PUBLIC_KEY   = (process.env.JWT_PUBLIC_KEY  || "").replace(/\\n/g, "\n").trim();
const JWT_ISSUER   = process.env.JWT_ISSUER   || "https://api.akoro.app";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "https://akoro.app";
const HS_SECRET    = process.env.JWT_SECRET || null;   // no default: no key → nothing verifies
const USE_RSA      = PRIVATE_KEY.includes("-----BEGIN") && PUBLIC_KEY.includes("-----BEGIN");

// Never HS256 when RSA is configured, and never "none" in either mode — an
// allow-list is what stops an attacker choosing the algorithm for us.
const ALLOWED_ALGS = USE_RSA ? ["RS256"] : ["HS256"];

const PORTAL_IDS = ["student", "instructor", "admin", "school", "site", "agent", "business"];
const accessCookieName = (portal) =>
  `akoro_access_${PORTAL_IDS.includes(portal) ? portal : "student"}`;

function portalOf(req) {
  const p = req.headers?.["x-akoro-portal"];
  return typeof p === "string" ? p.toLowerCase() : "student";
}

/** The raw access token on a request — portal cookie, legacy cookie, or bearer. */
export function readAccessToken(req) {
  const cookieToken =
    req.cookies?.[accessCookieName(portalOf(req))] || req.cookies?.akoro_access;
  if (cookieToken) return cookieToken;
  const h = req.headers?.["authorization"];
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

/**
 * Verify a request's access token and return its claims, or null.
 *
 * Signature, issuer, audience, algorithm and expiry are all checked — the
 * signature is what makes any claim on it, including `internal`, trustworthy.
 * The deny-list is deliberately NOT consulted: that needs a database call, and
 * a revoked token is rejected microseconds later by authenticateToken anyway.
 * Counting one request against its former owner's quota is harmless.
 */
export function peekAccessToken(req) {
  const token = readAccessToken(req);
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, USE_RSA ? PUBLIC_KEY : HS_SECRET, {
      algorithms: ALLOWED_ALGS,
      issuer:     JWT_ISSUER,
      audience:   JWT_AUDIENCE,
    });
    // Only session tokens count: a refresh / 2FA-challenge / hand-off token carries a `type`.
    return decoded?.sub && !decoded.type ? decoded : null;
  } catch {
    return null;
  }
}
