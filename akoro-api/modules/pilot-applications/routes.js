/**
 * modules/pilot-applications/routes.js — public pilot-school application form
 *
 * Mounted at /api/public/pilot-applications (see app.js). This is the ONE
 * unauthenticated write endpoint of the Tiers & Credits plan (§4.2) — it
 * exists so school leaders can apply to the pilot from the marketing site
 * /apply page without an account.
 *
 *   POST /api/public/pilot-applications   submit an application
 *
 * Validation mirrors the /apply form exactly (reference/Pilot application.md)
 * and lives in lib/tiersModel.js (contract-tested):
 * school name, state/city, estimated students (>=1), contact name, contact
 * email, contact phone (>=7 chars); message optional. Duplicate submissions
 * (same email + school within 24h) get a friendly 409 instead of a new row.
 */

import { Router } from "express";
import db from "../../db.js";
import { validatePilotApplication } from "../../lib/tiersModel.js";

const router = Router();

router.post("/", async (req, res) => {
  const { errors, values } = validatePilotApplication(req.body ?? {});
  if (Object.keys(errors).length) {
    return res.status(422).json({
      success: false,
      message: "Please check the highlighted fields and try again.",
      fields: errors,
    });
  }

  // Friendly duplicate guard: same school + email within 24h.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await db.from("pilot_applications")
    .select("id").eq("contact_email", values.contact_email)
    .eq("school_name", values.school_name).gte("created_at", since).limit(1);
  if (recent && recent.length) {
    return res.status(409).json({
      success: false,
      code: "duplicate_application",
      message: "We already received an application for this school recently — our team will reach out soon.",
    });
  }

  const { error } = await db.from("pilot_applications").insert(values);
  if (error) {
    console.error("[pilot-applications] insert failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not submit your application. Please try again." });
  }
  return res.status(201).json({ success: true, message: "Application received." });
});

export default router;
