/**
 * modules/autonomy/learnerRoutes.js — the learner's side of the proactive
 * agent (Grand Plan §7.16.4, §7.16.7), mounted at /api/agent:
 *
 *   GET   /settings          Agent Online, the three switches, quiet hours, time zone, this week's budget
 *   PATCH /settings          { agentOnline?, proactive?, learnFromChats?, checkins?, quietStart?, quietEnd?, timeZone? }
 *   GET   /ideas             live ideas, newest first (≤ 6)
 *   POST  /ideas/:id/use     → { brief } — the app sends it as the learner's chat message
 *   POST  /ideas/:id/dismiss → "Not for me"
 *
 * Agent Online keeps going through setLearnerAutonomy (it schedules or pauses
 * the check-ins); the rest are columns on edu.learner_agent_autonomy.
 */
import { Router } from "express";
import db from "../../db.js";
import { authenticateToken } from "../auth/routes.js";
import { setLearnerAutonomy } from "../adaptive-learning/learner-autonomy.js";
import { budgetState } from "./budget.js";
import { quietOf, validHHMM, validTimeZone } from "./quietHours.js";

const router = Router();
// Auth per route: this router is mounted at /api/agent, beside other modules' routes.
const edu = () => db.schema("edu");
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UUID = /^[0-9a-f-]{36}$/i;

async function settingsOf(userId) {
  const [{ data: row }, { data: us }] = await Promise.all([
    edu().from("learner_agent_autonomy").select("enabled, level, proactive, learn_from_chats, checkins, quiet_start, quiet_end, time_zone").eq("user_id", userId).maybeSingle(),
    db.from("user_settings").select("settings").eq("user_id", userId).maybeSingle(),
  ]);
  const quiet = quietOf(row || {}, us?.settings?.timezone);
  const budget = await budgetState(userId, { timeZone: quiet.timeZone }).catch(() => null);
  return {
    agentOnline: !!row?.enabled,
    // D47: on by default with Online; an explicit off stays off.
    proactive: row?.proactive !== false,
    learnFromChats: row?.learn_from_chats !== false,
    checkins: row?.checkins !== false,
    quietStart: quiet.start, quietEnd: quiet.end, timeZone: quiet.timeZone,
    budget: budget ? { usedPct: budget.usedPct, resetsAt: budget.resetsAt, paused: budget.stop } : null,
  };
}

router.get("/settings", authenticateToken, asyncHandler(async (req, res) => res.json({ success: true, data: await settingsOf(req.user.id) })));

router.patch("/settings", authenticateToken, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  const bad = (m) => res.status(422).json({ success: false, error: m });
  for (const [k, col] of [["proactive", "proactive"], ["learnFromChats", "learn_from_chats"], ["checkins", "checkins"]]) {
    if (k in b) { if (typeof b[k] !== "boolean") return bad(`${k} must be a boolean`); patch[col] = b[k]; }
  }
  if ("quietStart" in b) { if (!validHHMM(b.quietStart)) return bad("quietStart must be HH:MM"); patch.quiet_start = b.quietStart; }
  if ("quietEnd" in b) { if (!validHHMM(b.quietEnd)) return bad("quietEnd must be HH:MM"); patch.quiet_end = b.quietEnd; }
  if ("timeZone" in b) { if (!validTimeZone(b.timeZone)) return bad("timeZone must be an IANA time zone, e.g. Africa/Lagos"); patch.time_zone = b.timeZone; }
  if ("agentOnline" in b) {
    if (typeof b.agentOnline !== "boolean") return bad("agentOnline must be a boolean");
    await setLearnerAutonomy({ userId: req.user.id, enabled: b.agentOnline });
  }
  if (Object.keys(patch).length) {
    const { data: row } = await edu().from("learner_agent_autonomy").select("user_id").eq("user_id", req.user.id).maybeSingle();
    const write = row
      ? edu().from("learner_agent_autonomy").update({ ...patch, updated_at: new Date().toISOString() }).eq("user_id", req.user.id)
      : edu().from("learner_agent_autonomy").insert({ user_id: req.user.id, enabled: false, ...patch });
    const { error } = await write;
    if (error) throw error;
    // Check-ins off pauses the ones already scheduled; on again re-schedules them (setLearnerAutonomy does both).
    if ("checkins" in patch) {
      const { data: now } = await edu().from("learner_agent_autonomy").select("enabled").eq("user_id", req.user.id).maybeSingle();
      if (now?.enabled) await setLearnerAutonomy({ userId: req.user.id, enabled: true }).catch(() => {});
      if (!patch.checkins) await edu().from("learner_autonomy_task_reviews").update({ status: "paused", updated_at: new Date().toISOString() }).eq("user_id", req.user.id).eq("status", "scheduled");
    }
  }
  res.json({ success: true, data: await settingsOf(req.user.id) });
}));

const ideaToApi = (r) => ({ id: r.id, title: r.title, why: r.why, brief: r.brief, icon: r.icon || "chat", context: r.context || {}, createdAt: r.created_at, expiresAt: r.expires_at });

router.get("/ideas", authenticateToken, asyncHandler(async (req, res) => {
  const { data } = await edu().from("agent_ideas").select("*").eq("user_id", req.user.id).eq("status", "live")
    .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(6);
  res.json({ success: true, data: (data || []).map(ideaToApi) });
}));

async function decideIdea(req, res, status) {
  if (!UUID.test(String(req.params.id))) return res.status(400).json({ success: false, error: "A valid idea id is required" });
  const { data } = await edu().from("agent_ideas").update({ status, decided_at: new Date().toISOString() })
    .eq("id", req.params.id).eq("user_id", req.user.id).eq("status", "live").select("*").maybeSingle();
  if (!data) return res.status(404).json({ success: false, error: "That idea is gone — it was used, dismissed or expired." });
  return res.json({ success: true, data: { ...ideaToApi(data), status } });
}
router.post("/ideas/:id/use", authenticateToken, asyncHandler((req, res) => decideIdea(req, res, "used")));
router.post("/ideas/:id/dismiss", authenticateToken, asyncHandler((req, res) => decideIdea(req, res, "dismissed")));

export default router;
