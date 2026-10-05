/**
 * modules/courses/index.js  —  Courses Module Entry Point
 *
 * Registers all course-related routes onto a single Express Router.
 * Imported by app.js as:
 *   import coursesModule from "./modules/courses/index.js";
 *   app.use("/api", coursesModule);
 */

import { Router }               from "express";

import coursesRouter,
  { sessionHandlers }           from "./courses.js";
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

const router = Router();

// Prefixed sub-routers
router.use("/courses",   coursesRouter);
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

// Global sessions list
router.get("/sessions", sessionHandlers.listAll);

export default router;
