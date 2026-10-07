/**
 * modules/courses/index.js  —  Courses Module Entry Point
 *
 * Registers all course-related routes onto a single Express Router.
 * Imported by app.js as:
 *   import coursesModule from "./modules/courses/index.js";
 *   app.use("/api", coursesModule);
 */

import { Router }               from "express";

import paymentsRouter           from "./payments.js";
import cartRouter               from "./cart.js";
import contentRouter            from "./course-content.js";
import liveSessionsRouter       from "./live-sessions.js";
import peerSessionsRouter       from "./peer-sessions.js";
import chatRouter               from "./chat.js";
import agentsRouter             from "./agents.js";
import qaRouter                 from "./qa-announcements.js";
import notificationsRouter      from "./notifications.js";
import progressRouter           from "./progress.js";
import reviewsRouter            from "./reviews-revisions.js";
import schedulerRouter          from "./scheduler.js";
import streamRouter             from "./stream.js";
import giftsRouter              from "./gifts.js";
import certificatesRouter       from "./certificates.js";
import subtitlesRouter          from "./subtitles.js";
import payoutsRouter            from "./payouts.js";
import bundlesRouter            from "./bundles.js";
import meetingRouter            from "./meeting-integration.js";
import publicCatalogRouter      from "./public-catalog.js";

const router = Router();

// Public landing-page catalogue endpoints. MUST be registered before
// the "/courses" mount below, otherwise GET /courses/published is
// captured by coursesRouter's "/:id" route.
router.use(publicCatalogRouter);   // /courses/published, /live-sessions, /instructors/featured

// NOTE: the legacy in-memory `courses.js` mock router is intentionally NOT
// mounted. Real course CRUD lives in /api/instructor/courses (DB-backed);
// reads come from public-catalog + course-content. Mounting the mock here
// also shadowed the real GET /courses/search (bundles) via its /:id route.

// Prefixed sub-routers
router.use("/meeting",   meetingRouter);
router.use("/payments",  paymentsRouter);
router.use("/stream",    streamRouter);
router.use("/scheduler", schedulerRouter);

// Flat routes (mount directly — paths defined inside each file)
router.use(contentRouter);
router.use(liveSessionsRouter);
router.use(peerSessionsRouter);
router.use(chatRouter);
router.use(agentsRouter);
router.use(qaRouter);
router.use(notificationsRouter);
router.use(progressRouter);
router.use(reviewsRouter);
router.use(paymentsRouter);      // /user/enrollments, /transactions
router.use(giftsRouter);
router.use(certificatesRouter);
router.use(subtitlesRouter);
router.use(payoutsRouter);
router.use(bundlesRouter);       // /courses/search, /user/wishlist, /bundles
router.use(cartRouter);          // /cart, /cart/checkout

export default router;
