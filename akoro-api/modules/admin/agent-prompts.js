// modules/admin/agent-prompts.js
//
// Admin-editable prompt parts (Grand Plan Phase 18 item 7). Every route is
// admin only. The parts are exactly the akoro-agent/ files the manifest
// loads; code-enforced rules (gates, policies, verdicts, tool checks) are
// code and are not reachable from here.
//
//   GET  /api/admin/agent-prompts                     every part + its status
//   GET  /api/admin/agent-prompts/sets                the prompt sets (personas, chat roles)
//   GET  /api/admin/agent-prompts/assembled?set=&source=effective|default
//   GET  /api/admin/agent-prompts/part?file=          default, override, and the old default when it moved
//   GET  /api/admin/agent-prompts/history?file=
//   PUT  /api/admin/agent-prompts/part                { file, text, note? }
//   POST /api/admin/agent-prompts/part/reset          { file }
//   POST /api/admin/agent-prompts/part/keep-mine      { file }
//   POST /api/admin/agent-prompts/part/use-new-default { file }

import { Router } from "express";
import { authenticateToken, requireRole } from "../auth/routes.js";
import {
  PromptPartError, assembledPrompt, editPart, keepMine, listParts, partHistory, promptSets, readPart, resetPart, useNewDefault,
} from "../agent-context/override-store.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const handle = (fn) => async (req, res) => {
  try {
    res.json({ success: true, ...(await fn(req)) });
  } catch (e) {
    if (e instanceof PromptPartError) return res.status(e.status).json({ success: false, error: e.message, problems: e.problems });
    console.error("[admin/agent-prompts]", e?.message || e);
    return res.status(500).json({ success: false, error: "Prompt parts are unavailable" });
  }
};
const fileOf = (req) => String(req.query.file ?? req.body?.file ?? "");

router.get("/agent-prompts", adminOnly, handle(async () => ({ parts: await listParts() })));
router.get("/agent-prompts/sets", adminOnly, handle(async () => ({ sets: promptSets() })));
router.get("/agent-prompts/assembled", adminOnly, handle(async (req) => ({
  prompt: await assembledPrompt({ set: String(req.query.set || ""), source: req.query.source === "default" ? "default" : "effective" }),
})));
router.get("/agent-prompts/part", adminOnly, handle(async (req) => ({ part: await readPart(fileOf(req)) })));
router.get("/agent-prompts/history", adminOnly, handle(async (req) => ({ history: await partHistory(fileOf(req)) })));
router.put("/agent-prompts/part", adminOnly, handle(async (req) => ({
  part: await editPart({ file: fileOf(req), text: req.body?.text, note: req.body?.note ?? null, actorId: req.user?.id }),
})));
router.post("/agent-prompts/part/reset", adminOnly, handle(async (req) => ({ part: await resetPart({ file: fileOf(req), actorId: req.user?.id }) })));
router.post("/agent-prompts/part/keep-mine", adminOnly, handle(async (req) => ({ part: await keepMine({ file: fileOf(req), actorId: req.user?.id }) })));
router.post("/agent-prompts/part/use-new-default", adminOnly, handle(async (req) => ({ part: await useNewDefault({ file: fileOf(req), actorId: req.user?.id }) })));

export default router;
