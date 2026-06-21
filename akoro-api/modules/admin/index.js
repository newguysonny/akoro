import { Router } from "express";
import coreRouter      from "./routes.js";
import analyticsRouter from "./analytics.js";
import extendedRouter  from "./extended.js";

const router = Router();
router.use("/", coreRouter);
router.use("/", analyticsRouter);
router.use("/", extendedRouter);

export default router;
