/**
 * auth/service-session.js — session issuance and the refresh/logout/me/
 * change-password flows. The only place a refresh token is created or rotated.
 */

import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { BCRYPT_ROUNDS, safeUser, portalOf } from "./rules.js";
import { asyncHandler, res200, res400, res401 } from "./service-common.js";
import { INSTRUCTOR_FRONTEND_URL, FRONTEND_URL } from "./service-links.js";
import {
  ACCESS_TTL_SECS, REFRESH_TTL_SECS, REFRESH_GRACE_MS,
  DenyList, verifyToken, signAccess, signRefresh,
  refreshCookieName, setAccessCookie, setRefreshCookie,
  clearAuthCookies, clearLegacyCookies,
} from "./tokens.js";
import { RefreshStore, findUserById, findPasswordState, updateUser } from "./store.js";
import { sendPasswordChangedEmail } from "./emails.js";

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

// POST /api/auth/refresh  — rotate refresh token
export const refresh = asyncHandler(async (req, res) => {
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

  const { data: user } = await findUserById(stored.user_id);
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
});

// POST /api/auth/logout
export const logout = asyncHandler(async (req, res) => {
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
});

// GET /api/auth/me
export const me = asyncHandler(async (req, res) => {
  res200(res, req.user);
});

// POST /api/auth/change-password — verify current password, set new one.
// OAuth accounts may have NO password on file (password_hash is null):
// for them this is "set password" — no current password exists to verify,
// so only the new password is required. Once a password exists, the
// current one must always be supplied and verified.
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword)
    return res400(res, "newPassword is required");
  if (newPassword.length < 8)
    return res400(res, "New password must be at least 8 characters");

  const { data: user } = await findPasswordState(req.user.id);
  if (!user) return res401(res, "User not found");

  const hasPassword = !!user.password_hash;
  if (hasPassword) {
    if (!currentPassword)
      return res400(res, "currentPassword is required");
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(403).json({ success: false, message: "Current password is incorrect" });
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await updateUser(user.id, { password_hash: newHash, updated_at: new Date().toISOString() });

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
});

export { issueTokenPair };
