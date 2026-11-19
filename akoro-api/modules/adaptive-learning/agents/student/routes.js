// agents/student/routes.js — the learner's student-agent HTTP surface.
//
// Mounted by chat.js at /student/agent. Every route is token-scoped: the
// :studentId in the path is ignored and the authenticated learner's own
// agent is read, exactly as the routes did inline in chat.js.
import { Router } from "express";
import {
  getOrCreateStudentAgent,
  getAgentGrowthHistory,
  getAgentIntelligence,
} from "./knowledge.js";

const router = Router();

router.get("/:studentId", async (req, res) => {
  try { res.json({ success: true, agent: await getOrCreateStudentAgent(req.user.id) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/:studentId/intelligence", async (req, res) => {
  try {
    const agent = await getOrCreateStudentAgent(req.user.id);
    const intel = await getAgentIntelligence(agent.id);
    res.json({ success: true, intelligence: intel, agent });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/:studentId/growth", async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const agent   = await getOrCreateStudentAgent(req.user.id);
    const history = await getAgentGrowthHistory(agent.id, Number(limit));
    res.json({ success: true, agent, history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
