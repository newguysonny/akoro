import { Router } from "express";
import coreRouter      from "./routes.js";
import analyticsRouter from "./analytics.js";
import extendedRouter  from "./extended.js";
import marketingRouter from "./marketing.js";
import websiteTemplatesRouter from "./websiteTemplates.js";
import agentsRouter from "./agents.js";
import appCenterRouter from "./appCenter.js";
import aiSpendRouter from "./aiSpend.js";
import evalsRouter from "./evals.js";

const router = Router();
router.use("/", coreRouter);
router.use("/", analyticsRouter);
router.use("/", extendedRouter);
router.use("/", marketingRouter);
router.use("/", websiteTemplatesRouter);
router.use("/", agentsRouter);
router.use("/", appCenterRouter);
router.use("/", aiSpendRouter);
router.use("/", evalsRouter);

export default router;
