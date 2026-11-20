/**
 * modules/admin/extended.js  —  Akoro Admin Extended API entry point.
 *
 * Mounted at /api/admin (same prefix as routes.js, registered separately) and
 * all routes require role=admin.
 *
 *   ── Dashboard (/dashboard) ────────────────────────────────────────────────
 *   GET  /dashboard/stats            full platform metrics in one call
 *   GET  /dashboard/login-trends     last 30 days of login activity
 *
 *   ── Course Details (/courses) ─────────────────────────────────────────────
 *   GET  /courses/:id                course + instructor + modules + lessons
 *   GET  /courses/categories         distinct subject values
 *   POST /courses/:id/modules        create module for course
 *   POST /courses/:id/modules/:moduleId/lessons  create lesson in module
 *
 *   ── User Details (/users) ─────────────────────────────────────────────────
 *   GET  /users/:id/enrollments      enrollments for a user
 *   POST /users/invite               invite single user (no password)
 *   POST /users/invite-csv           bulk invite users
 *   POST /users/create               create a ready-to-login account
 *
 *   ── Instructor Payouts (/payouts) ─────────────────────────────────────────
 *   GET   /payouts                   list instructor_earnings with filters
 *   GET   /payouts/summary           per-instructor aggregate summary
 *   PATCH /payouts/:id/mark-paid     mark a payout row as paid
 *
 *   ── Analytics Extended (/analytics) ──────────────────────────────────────
 *   GET  /analytics/engagement       engagement metrics
 *   GET  /analytics/top-instructors  top 10 instructors by earnings
 *
 *   ── Reports (/reports) ────────────────────────────────────────────────────
 *   GET  /reports/revenue-export     payments for period
 *   GET  /reports/enrollments-export enrollments for period
 */
import { Router } from "express";
import extendedRoutes from "./extended-routes.js";

const router = Router();
router.use("/", extendedRoutes);

export default router;
