import { urlFor } from "../../lib/urls.js";

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const ok     = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
export const ok201  = (res, data)            => res.status(201).json({ success: true, data });
export const err400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
export const err404 = (res, msg = "Not found") => res.status(404).json({ success: false, message: msg });
export const err409 = (res, msg)             => res.status(409).json({ success: false, message: msg });

/** Returns an ISO string for N days ago. */
export const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

/** Returns 'YYYY-MM-DD' for a Date or ISO string. */
export const toDateStr = (d) => new Date(d).toISOString().slice(0, 10);

/** Returns period start ISO string from query param (7d/30d/90d/1y). */
export const periodStart = (period) => {
  const map = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
  const days = map[period] ?? 30;
  return daysAgo(days);
};

export const CREATE_ROLES = ["student", "instructor", "school_admin", "admin"];
export const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10);
export const FRONTEND_URL            = urlFor("FRONTEND_URL");
export const INSTRUCTOR_FRONTEND_URL = urlFor("INSTRUCTOR_FRONTEND_URL");
export const ADMIN_FRONTEND_URL      = urlFor("ADMIN_FRONTEND_URL");
export const SCHOOL_FRONTEND_URL     = urlFor("SCHOOL_FRONTEND_URL");

export const genPassword = () =>
  Array.from({ length: 12 }, () =>
    "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789".charAt(
      Math.floor(Math.random() * 54))).join("");

export const usernameBase = (email) =>
  (email.split("@")[0] || "user").replace(/[^a-z0-9_]/g, "_").slice(0, 30) || "user";
