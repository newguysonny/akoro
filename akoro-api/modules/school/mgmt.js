/**
 * modules/school/mgmt.js — Management + Facilities & Services entry router.
 *
 * Mounted INSIDE the school router (routes.js → mgmt.js) so the audit-trail
 * middleware in routes.js covers every write here too. All data lives in the
 * `mgmt` schema; every row is scoped by school_id.
 *
 * The custom routes live in mgmt-routes.js (registered first), the generic
 * whitelisted CRUD factory is registered last, and /learning is mounted in
 * between so it is matched before the generic /:resource list.
 */

import { Router } from "express";
import { authenticateToken } from "../auth/index.js";
import { createStrugglesRouter } from "./learnerStruggles.js";
import mgmtRoutes, { requireMgmtWrite } from "./mgmt-routes.js";
import { getMySchool } from "./mgmt-service.js";
import * as generic from "./mgmt-service-generic.js";

const router = Router();

router.use(mgmtRoutes);

// ── Learners' struggles (D39): linked students only; the admin sees every class, a teacher only theirs ──
// GET /api/school/mgmt/learning/struggles · /learning/struggles/:studentId/support (logged)
router.use("/learning", createStrugglesRouter({ getMySchool, authenticate: authenticateToken }));

/* ═══════════════════════ Generic CRUD ════════════════════════════════════ */

router.get("/:resource", authenticateToken, generic.listResource);
router.post("/:resource", authenticateToken, requireMgmtWrite, generic.createResource);
router.put("/:resource/:id", authenticateToken, requireMgmtWrite, generic.updateResource);
router.delete("/:resource/:id", authenticateToken, requireMgmtWrite, generic.deleteResource);

export default router;
