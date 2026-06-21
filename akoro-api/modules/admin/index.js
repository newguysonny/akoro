import { Router } from "express";
import coreRouter      from "./routes.js";
import analyticsRouter from "./analytics.js";

const router = Router();
router.use("/", coreRouter);
router.use("/", analyticsRouter);

export default router;
