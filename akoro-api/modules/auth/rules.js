/**
 * auth/rules.js — pure validation rules, request normalisers and response
 * shapes. No database, no Express response objects.
 */

import { body, validationResult } from "express-validator";

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10);

const FIELD_MESSAGE = {
  email: "Enter a valid email address.",
  password: "Password must be at least 8 characters.",
  username: "Username must be 3-40 characters: letters, numbers or underscore.",
  fullName: "That name is too long.",
  role: "That account type isn't available.",
};

export const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  // Structured and user-readable: {field, message}; never echo the raw value.
  const fields = errors.array({ onlyFirstError: true }).map((e) => {
    const field = e.path || e.param || "request";
    const msg = e.msg && e.msg !== "Invalid value" ? e.msg : (FIELD_MESSAGE[field] || "This value isn't valid.");
    return { field, message: msg };
  });
  return res.status(422).json({
    success: false,
    code: "validation_failed",
    message: fields.length === 1 ? fields[0].message : "Please check the highlighted fields and try again.",
    errors: fields,
  });
};

export const rules = {
  register: [
    body("email").trim().isEmail().withMessage("Enter a valid email address.").normalizeEmail(),
    // Username is optional — schools sign up without one (auto-generated below).
    body("username").optional({ checkFalsy: true }).trim().isLength({ min: 3, max: 40 })
      .withMessage("Username must be 3-40 characters.").matches(/^[a-zA-Z0-9_]+$/)
      .withMessage("Username can only use letters, numbers and underscore."),
    body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters."),
    body("fullName").optional().trim().isLength({ max: 120 }).withMessage("That name is too long."),
    body("role").optional().isIn(["student", "instructor", "school_admin"]).withMessage("That account type isn't available."),
  ],
  login: [
    body("email").trim().isEmail().withMessage("Enter a valid email address.").normalizeEmail(),
    body("password").notEmpty().withMessage("Enter your password."),
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

export const safeUser = (u) => ({
  id:        u.id,
  email:     u.email,
  username:  u.username,
  fullName:  u.full_name || u.fullName,
  avatarUrl: u.avatar_url || u.avatarUrl,
  role:      u.role,
  onboardingCompleted: u.onboarding_completed ?? u.onboardingCompleted ?? false,
});

// ─── § PORTAL NORMALISERS ─────────────────────────────────────────────────────

export const PORTAL_IDS = ["student", "instructor", "admin", "school", "site", "agent", "business"];

// The portal is normally declared via the X-Akoro-Portal header. Full-page
// navigations (OAuth "Connect" redirects, file links) can't set headers, so we
// also accept a ?portal= query param — it only selects which scoped cookie to
// read; the token inside is still validated, so it can't be used to escalate.
export const portalOf = (req) => {
  const p = req?.headers?.["x-akoro-portal"] || req?.query?.portal;
  return PORTAL_IDS.includes(p) ? p : "student";
};

// Portals that may start a Google sign-in. Must stay in sync with PORTAL_IDS —
// a portal missing here silently degrades to "student", which would drop the
// user's session into the learner cookie and bounce them to the learner app.
export const PORTALS = ["instructor", "admin", "student", "school", "agent", "business"];

// state = "<portal>.<nonce>"; the nonce is mirrored in an httpOnly cookie and
// re-checked on callback so an attacker can't stitch a victim's browser to the
// attacker's Google identity (login CSRF).
export const parseState = (s) => { const [portal, nonce] = String(s || "").split("."); return { portal: PORTALS.includes(portal) ? portal : "student", nonce: nonce || "" }; };

export { BCRYPT_ROUNDS };
