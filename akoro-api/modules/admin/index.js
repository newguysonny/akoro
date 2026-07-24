import { Router } from "express";
import coreRouter      from "./routes.js";
import analyticsRouter from "./analytics.js";
import extendedRouter  from "./extended.js";
import marketingRouter from "./marketing.js";
import websiteTemplatesRouter from "./websiteTemplates.js";

const router = Router();
router.use("/", coreRouter);
router.use("/", analyticsRouter);
router.use("/", extendedRouter);
router.use("/", marketingRouter);
router.use("/", websiteTemplatesRouter);

export default router;
