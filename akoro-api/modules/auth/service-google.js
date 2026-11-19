/**
 * auth/service-google.js — Google OAuth strategy registration and callback.
 * The strategy is only registered when both credentials are configured.
 */

import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { urlFor } from "../../lib/urls.js";
import { parseState, safeUser } from "./rules.js";
import { asyncHandler } from "./service-common.js";
import { INSTRUCTOR_FRONTEND_URL, ADMIN_FRONTEND_URL, SCHOOL_FRONTEND_URL, portalUrl } from "./service-links.js";
import { issueTokenPair } from "./service-session.js";
import { findUserByEmail, updateGoogleUser, insertGoogleUser } from "./store.js";
import { sendWelcomeEmail, sendLoginAlertEmail } from "./emails.js";

const CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || `${urlFor("API_URL")}/api/auth/google/callback`;

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) passport.use(new GoogleStrategy(
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

      const { data: existing } = await findUserByEmail(email);

      if (existing) {
        const { data: updated } = await updateGoogleUser(existing.id, { google_id: existing.google_id || googleId, avatar_url: existing.avatar_url || avatar });
        return done(null, updated || existing);
      }

      const username = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "_") + "_" + Date.now().toString().slice(-4);
      const { data: created, error } = await insertGoogleUser({
        email, full_name: fullName, username,
        password_hash:  "",
        avatar_url:     avatar,
        google_id:      googleId,
        role:           "student",
        is_active:      true,
        email_verified: true,
      });

      if (error) return done(error, null);
      return done(null, created);
    } catch (err) {
      return done(err, null);
    }
  }
));

export const googleCallback = asyncHandler(async (req, res) => {
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

  await issueTokenPair(res, user, portal);

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
});
