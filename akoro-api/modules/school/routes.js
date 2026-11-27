/**
 * modules/school/routes.js — School partner portal API (thin router layer).
 *
 * Mount: app.use("/api/school", standardLimit, schoolModule);
 *
 * A "school" is a row in school_profiles (admin_user_id = the school account).
 * Schools own their instructors (school_teachers) and students (via
 * classrooms → classroom_students). Those same instructors/students can also
 * use the Instructor / Learner apps.
 *
 * Every handler below delegates to a service; queries live in store*.js and
 * pure normalisers in rules.js. Route order is load-bearing: the audit
 * middleware, the /mgmt and /public mounts and /site/by-host must all be
 * registered before their catch-alls.
 */

import { Router } from "express";
import multerLib from "multer";
import { authenticateToken, requireRole } from "../auth/index.js";
import { strictLimit } from "../../middleware/security.js";
import mgmtRouter from "./mgmt.js";
import publicPortalRouter from "./publicPortal.js";
import { SCHOOL_ROLES } from "./rules.js";
import * as service from "./service.js";
import * as operations from "./service-operations.js";
import * as domains from "./service-domains.js";
import * as billing from "./service-billing.js";
import * as content from "./service-content.js";
import * as site from "./service-site.js";
import * as website from "./service-website.js";

const router = Router();

// Audit trail for every write under /api/school/*. Registered first so
// res.on('finish') fires after the route handler has set req.user.
router.use(service.auditMiddleware);

// Management + Facilities & Services (mgmt schema). Mounted after the audit
// middleware above so every mgmt write is audit-logged too.
router.use("/mgmt", mgmtRouter);

// ── School profile, staff, courses, learners, classrooms ────────────────────
router.get("/", authenticateToken, service.getSchool);
router.get("/stats", authenticateToken, service.getStats);
router.get("/instructors", authenticateToken, service.listInstructors);
router.get("/teacher-requests", authenticateToken, requireRole(SCHOOL_ROLES), service.listTeacherRequests);
router.post("/teacher-requests/:teacherId", authenticateToken, requireRole(SCHOOL_ROLES), service.decideTeacherRequest);
router.post("/instructors/invite", authenticateToken, requireRole(SCHOOL_ROLES), service.inviteInstructor);
router.get("/courses", authenticateToken, service.listCourses);
router.get("/sessions", authenticateToken, service.listSessions);
router.get("/students", authenticateToken, service.listStudents);
router.get("/classrooms", authenticateToken, service.listClassrooms);
router.post("/classrooms", authenticateToken, requireRole(SCHOOL_ROLES), service.createClassroom);
router.post("/classrooms/:id/teacher", authenticateToken, requireRole(SCHOOL_ROLES), service.assignClassroomTeacher);
router.post("/classrooms/:id/students", authenticateToken, requireRole(SCHOOL_ROLES), service.addClassroomStudent);
router.post("/students/enrol", authenticateToken, requireRole(SCHOOL_ROLES), service.enrolStudent);

// ── School agent ─────────────────────────────────────────────────────────────
router.get("/agent", authenticateToken, operations.getAgent);
router.patch("/agent", authenticateToken, requireRole(SCHOOL_ROLES), operations.updateAgent);

// ── Settings, profile branding, integrations ─────────────────────────────────
router.get("/settings", authenticateToken, operations.getSettings);
router.put("/settings/profile", authenticateToken, requireRole(SCHOOL_ROLES), operations.updateProfile);
const brandingUpload = multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }).single("file");
router.post("/settings/profile/upload", authenticateToken, requireRole(SCHOOL_ROLES), (req, res) => {
  brandingUpload(req, res, (uploadErr) => operations.uploadBranding(req, res, uploadErr));
});
router.put("/settings/:category", authenticateToken, requireRole(SCHOOL_ROLES), operations.updateSettingsCategory);

// ── Content hub ─────────────────────────────────────────────────────────────
router.post("/content/generate", authenticateToken, requireRole(SCHOOL_ROLES), content.generateContent);
router.get("/content/creations", authenticateToken, content.listCreations);
router.get("/content/creations/:id", authenticateToken, content.getCreation);
router.post("/content/creations/:id/post", authenticateToken, requireRole(SCHOOL_ROLES), content.postCreation);
const contentMediaUpload = multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } }).single("file");
router.post("/content/creations/:id/media", authenticateToken, requireRole(SCHOOL_ROLES), (req, res) => {
  contentMediaUpload(req, res, (uploadErr) => content.uploadCreationMedia(req, res, uploadErr));
});
router.delete("/content/creations/:id/media", authenticateToken, requireRole(SCHOOL_ROLES), content.deleteCreationMedia);
router.delete("/content/creations/:id", authenticateToken, requireRole(SCHOOL_ROLES), content.deleteCreation);
router.post("/settings/integrations/regenerate-key", authenticateToken, requireRole(SCHOOL_ROLES), operations.regenerateIntegrationKey);

// ── Notification center ─────────────────────────────────────────────────────
router.get("/notifications/alerts", authenticateToken, operations.getNotificationAlerts);
router.put("/notifications/alerts/:alertId", authenticateToken, requireRole(SCHOOL_ROLES), operations.updateNotificationAlert);

// ── Telegram bot monitoring ─────────────────────────────────────────────────
router.get("/telegram", authenticateToken, operations.getTelegram);
router.post("/telegram/validate", authenticateToken, requireRole(SCHOOL_ROLES), operations.validateTelegram);
router.put("/telegram", authenticateToken, requireRole(SCHOOL_ROLES), operations.saveTelegram);
router.post("/telegram/test", authenticateToken, requireRole(SCHOOL_ROLES), operations.testTelegram);

// ── Domains and social accounts ─────────────────────────────────────────────
router.get("/domains", authenticateToken, domains.listDomains);
router.post("/domains", authenticateToken, requireRole(SCHOOL_ROLES), domains.createDomain);
router.post("/domains/:id/verify", authenticateToken, requireRole(SCHOOL_ROLES), domains.verifyDomain);
router.delete("/domains/:id", authenticateToken, requireRole(SCHOOL_ROLES), domains.deleteDomain);
router.get("/social-accounts", authenticateToken, domains.listSocialAccounts);
router.patch("/social-accounts/:id", authenticateToken, requireRole(SCHOOL_ROLES), domains.updateSocialAccount);

// Public portal — /apply, /pay, /results served on each tenant's own domain.
router.use("/public", publicPortalRouter);

// ── Authenticated website previews ──────────────────────────────────────────
router.post("/website/preview-page", authenticateToken, requireRole(SCHOOL_ROLES), website.previewPage);
router.post("/website/preview-site", authenticateToken, requireRole(SCHOOL_ROLES), website.previewSite);

// ── Public tenant site (by hostname, then by slug) ──────────────────────────
// /site/by-host must be registered BEFORE /site/:slug.
router.get("/site/by-host", site.siteByHost);
router.post("/site/ai-login", strictLimit, site.aiLogin);
router.post("/site/ai-login/exchange", site.aiLoginExchange);
router.get("/site/:slug", site.siteBySlug);

// ── Website settings and templates ──────────────────────────────────────────
router.get("/website", authenticateToken, website.getWebsite);
router.put("/website", authenticateToken, requireRole(SCHOOL_ROLES), website.updateWebsite);
router.get("/website/templates", authenticateToken, website.listTemplates);
router.get("/website/templates/:id", authenticateToken, website.getTemplate);
router.post("/website/templates", authenticateToken, requireRole(SCHOOL_ROLES), website.createTemplate);
const templateUpload = multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }).single("file");
router.post("/website/templates/upload", authenticateToken, requireRole(SCHOOL_ROLES), (req, res) => {
  templateUpload(req, res, (uploadErr) => website.uploadTemplate(req, res, uploadErr));
});
router.put("/website/templates/:id", authenticateToken, requireRole(SCHOOL_ROLES), website.updateTemplate);
router.post("/website/templates/:id/activate", authenticateToken, requireRole(SCHOOL_ROLES), website.activateTemplate);
router.post("/website/templates/:id/import", authenticateToken, requireRole(SCHOOL_ROLES), website.importTemplate);
router.delete("/website/templates/:id", authenticateToken, requireRole(SCHOOL_ROLES), website.deleteTemplate);

// ── Backups ─────────────────────────────────────────────────────────────────
router.get("/backups", authenticateToken, operations.listBackups);
router.post("/backups", authenticateToken, requireRole(SCHOOL_ROLES), operations.createBackup);
router.delete("/backups/:id", authenticateToken, requireRole(SCHOOL_ROLES), operations.deleteBackup);

// ── Roles & permissions ─────────────────────────────────────────────────────
router.get("/roles", authenticateToken, operations.listRoles);
router.post("/roles", authenticateToken, requireRole(SCHOOL_ROLES), operations.createRole);
router.put("/roles/:id", authenticateToken, requireRole(SCHOOL_ROLES), operations.updateRole);
router.delete("/roles/:id", authenticateToken, requireRole(SCHOOL_ROLES), operations.deleteRole);

// ── Payment gateway, admission and subscription ─────────────────────────────
router.get("/payment-gateway", authenticateToken, billing.getPaymentGateway);
router.put("/payment-gateway", authenticateToken, requireRole(SCHOOL_ROLES), billing.updatePaymentGateway);
router.get("/admission", authenticateToken, billing.getAdmission);
router.put("/admission/settings", authenticateToken, requireRole(SCHOOL_ROLES), billing.updateAdmissionSettings);
router.post("/admission/fields", authenticateToken, requireRole(SCHOOL_ROLES), billing.createAdmissionField);
router.put("/admission/fields/:id", authenticateToken, requireRole(SCHOOL_ROLES), billing.updateAdmissionField);
router.delete("/admission/fields/:id", authenticateToken, requireRole(SCHOOL_ROLES), billing.deleteAdmissionField);
router.get("/subscription", authenticateToken, billing.getSubscription);
router.post("/subscription/checkout", authenticateToken, requireRole(SCHOOL_ROLES), billing.checkoutSubscription);
router.get("/subscription/verify/:reference", authenticateToken, billing.verifySubscription);
router.get("/subscription/payments", authenticateToken, billing.listSubscriptionPayments);

// ── Audit trail (read) ──────────────────────────────────────────────────────
router.get("/audit-logs", authenticateToken, service.listAuditLogs);

export default router;
