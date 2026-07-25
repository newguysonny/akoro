import { Router } from "express";
import mainRoutes from "./routes.js";
import conciergeRoutes from "./aiConcierge.js";
import socialOAuthRoutes from "./socialOAuth.js";

// All mount under /api/school. Concierge first so its routes (guest-chat,
// ai/concierge) are matched before any catch-alls in the main router.
const router = Router();
router.use(conciergeRoutes);
router.use(socialOAuthRoutes);
router.use(mainRoutes);

export default router;
