import { Router } from "express";
import { authenticateToken, requireRole } from "../auth/index.js";
import { asyncHandler } from "./extended-rules.js";
import * as service from "./extended-service.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];

// ── Dashboard ────────────────────────────────────────────────────────────────
router.get("/dashboard/stats", adminOnly, asyncHandler(service.dashboardStats));
router.get("/dashboard/login-trends", adminOnly, asyncHandler(service.loginTrends));

// ── Course Details ───────────────────────────────────────────────────────────
// /courses/categories must be defined BEFORE /courses/:id.
router.get("/courses/categories", adminOnly, asyncHandler(service.courseCategories));
router.get("/courses/:id", adminOnly, asyncHandler(service.courseDetail));
router.post("/courses/:id/modules", adminOnly, asyncHandler(service.createModule));
router.post("/courses/:id/modules/:moduleId/lessons", adminOnly, asyncHandler(service.createLesson));

// ── User Details ─────────────────────────────────────────────────────────────
router.get("/users/:id/enrollments", adminOnly, asyncHandler(service.userEnrollments));
// /users/invite must come BEFORE /users/:id routes if the router is separate.
router.post("/users/invite", adminOnly, asyncHandler(service.inviteUser));
router.post("/users/invite-csv", adminOnly, asyncHandler(service.inviteCsv));
router.post("/users/create", adminOnly, asyncHandler(service.createUser));

// ── Instructor Payouts ───────────────────────────────────────────────────────
// /payouts/summary must be defined BEFORE /payouts/:id.
router.get("/payouts/summary", adminOnly, asyncHandler(service.payoutsSummary));
router.get("/payouts", adminOnly, asyncHandler(service.payoutsList));
router.patch("/payouts/:id/mark-paid", adminOnly, asyncHandler(service.markPayoutPaid));

// ── Analytics Extended ───────────────────────────────────────────────────────
router.get("/analytics/engagement", adminOnly, asyncHandler(service.engagement));
router.get("/analytics/top-instructors", adminOnly, asyncHandler(service.topInstructors));

// ── Reports ──────────────────────────────────────────────────────────────────
router.get("/reports/revenue-export", adminOnly, asyncHandler(service.revenueExport));
router.get("/reports/enrollments-export", adminOnly, asyncHandler(service.enrollmentsExport));

export default router;
