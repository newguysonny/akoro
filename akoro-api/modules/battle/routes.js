/**
 * modules/battle/routes.js  —  Akoro Battle System (Phase 19 split)
 *
 * Router and middleware only. Every handler is a thin reference to
 * battle/service.js, which orchestrates the request:
 *
 *   routes.js → service.js → rules.js → store.js
 *
 *   service.js         request orchestration (matchmaking, challenges, turns, rewards)
 *   service-*.js       the same, split by resource so no file outgrows the size gate
 *   rules.js           pure decisions: deadlines, windows, seat counts, edit fields
 *   store*.js          every Supabase query, grouped by table
 *
 * Mounted in app.js:
 *   app.use("/api/battle", standardLimit, battleModule);
 *
 * Battle types:
 *   1v1 Challenge  — student or teacher challenges a specific opponent
 *   Open Lobby     — anyone enrolled can join up to max_participants
 *   Classroom      — teacher starts, all invited students must accept
 *
 * Endpoints (43):
 *   GET    /api/battle/health
 *   POST   /api/battle/guide-reviews
 *   POST   /api/battle/courses/:courseId/battles/open
 *   GET    /api/battle/my-classes
 *   GET    /api/battle/classes/:id/roster
 *   POST   /api/battle/classes/:classroomId/battles/invite
 *   GET    /api/battle/my-battles
 *   GET    /api/battle/my-challenges
 *   POST   /api/battle/series/:seriesId/skip
 *   POST   /api/battle/series/:seriesId/opt-out
 *   POST   /api/battle/series/:seriesId/end
 *   GET    /api/battle/battles/:battleId/participants
 *   GET    /api/battle/courses/:courseId/roster
 *   POST   /api/battle/courses/:courseId/battles/invite
 *   GET    /api/battle/courses/:courseId/challenges
 *   GET    /api/battle/challenges/:challengeId
 *   GET    /api/battle/battles/:battleId/entry
 *   POST   /api/battle/challenges/:challengeId/accept
 *   POST   /api/battle/challenges/:challengeId/decline
 *   DELETE /api/battle/challenges/:challengeId
 *   GET    /api/battle/courses/:courseId/battles/open
 *   POST   /api/battle/battles/:battleId/join
 *   GET    /api/battle/courses/:courseId/battles
 *   GET    /api/battle/battles/:battleId
 *   POST   /api/battle/battles/:battleId/answer          ← agents answer; the human watches
 *   POST   /api/battle/battles/:battleId/heartbeat
 *   GET    /api/battle/battles/:battleId/state
 *   POST   /api/battle/battles/:battleId/start
 *   POST   /api/battle/battles/:battleId/end
 *   GET    /api/battle/battles/:battleId/results
 *   GET    /api/battle/battles/:battleId/questions.pdf
 *   GET    /api/battle/battles/:battleId/questions
 *   GET    /api/battle/battles/:battleId/log
 *   GET    /api/battle/courses/:courseId/questions-bank
 *   POST   /api/battle/courses/:courseId/questions-bank
 *   PUT    /api/battle/questions-bank/:questionId
 *   DELETE /api/battle/questions-bank/:questionId
 *   POST   /api/battle/courses/:courseId/questions-bank/generate
 *   PUT    /api/battle/battles/:battleId
 *   DELETE /api/battle/battles/:battleId
 *   GET    /api/battle/instructor/stats
 *   GET    /api/battle/courses/:courseId/battles/session/:sessionId
 *   POST   /api/battle/courses/:courseId/battles/session
 */
import { Router }                         from "express";
import { authenticateToken, requireRole } from "../auth/index.js";
import {
  canRunCourseBattles, res403,
} from "./service-core.js";
import * as service from "./service.js";

const router = Router();

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ─── Health check (public) ────────────────────────────────────────────────────
router.get("/health", asyncHandler(service.battleHealth));

// ─── CREATION ROUTES ─────────────────────────────────────────────────────────

// POST /api/battle/guide-reviews
router.post("/guide-reviews", authenticateToken, asyncHandler(service.guideReview));

// POST /api/courses/:courseId/battles/open
router.post("/courses/:courseId/battles/open", authenticateToken, asyncHandler(service.createOpenBattle));

// ─── CLASS BATTLES ───────────────────────────────────────────────────────────
router.get("/my-classes", authenticateToken, asyncHandler(service.myClasses));
router.get("/classes/:id/roster", authenticateToken, asyncHandler(service.classRoster));
router.post("/classes/:classroomId/battles/invite", authenticateToken, asyncHandler(service.classInvite));

// ─── MY BATTLES / MY CHALLENGES ──────────────────────────────────────────────
router.get("/my-battles", authenticateToken, asyncHandler(service.myBattles));
router.get("/my-challenges", authenticateToken, asyncHandler(service.myChallenges));

// ─── RECURRING SERIES (battle/series.js) ─────────────────────────────────────
router.post("/series/:seriesId/skip", authenticateToken, asyncHandler(service.skipSeriesOccurrence));
router.post("/series/:seriesId/opt-out", authenticateToken, asyncHandler(service.optOutOfSeries));
router.post("/series/:seriesId/end", authenticateToken, asyncHandler(service.endRecurringSeries));

// ─── ROSTER + TARGETED INVITE ────────────────────────────────────────────────
router.get("/battles/:battleId/participants", authenticateToken, asyncHandler(service.battleParticipants));
router.get("/courses/:courseId/roster", authenticateToken, asyncHandler(service.courseRoster));
router.post("/courses/:courseId/battles/invite", authenticateToken, asyncHandler(service.courseInvite));

// ─── CHALLENGE RESPONSES ──────────────────────────────────────────────────────
router.get("/courses/:courseId/challenges", authenticateToken, asyncHandler(service.courseChallenges));
router.get("/challenges/:challengeId", authenticateToken, asyncHandler(service.challengeDetail));
router.get("/battles/:battleId/entry", authenticateToken, asyncHandler(service.battleEntry));
router.post("/challenges/:challengeId/accept", authenticateToken, asyncHandler(service.acceptChallenge));
router.post("/challenges/:challengeId/decline", authenticateToken, asyncHandler(service.declineChallenge));
router.delete("/challenges/:challengeId", authenticateToken, asyncHandler(service.cancelChallenge));

// ─── OPEN BATTLE LOBBY ────────────────────────────────────────────────────────
router.get("/courses/:courseId/battles/open", authenticateToken, asyncHandler(service.openBattleLobby));
router.post("/battles/:battleId/join", authenticateToken, asyncHandler(service.joinBattle));

// ─── BATTLE LIFECYCLE ─────────────────────────────────────────────────────────
router.get("/courses/:courseId/battles", authenticateToken, asyncHandler(service.courseBattles));
router.get("/battles/:battleId", authenticateToken, asyncHandler(service.battleDetail));
router.post("/battles/:battleId/answer", authenticateToken, asyncHandler(service.answerNotAccepted));
router.post("/battles/:battleId/heartbeat", authenticateToken, asyncHandler(service.battleHeartbeat));
router.get("/battles/:battleId/state", authenticateToken, asyncHandler(service.battleState));
router.post("/battles/:battleId/start", authenticateToken, asyncHandler(service.startBattleNow));
router.post("/battles/:battleId/end", authenticateToken, asyncHandler(service.endBattleNow));

// ─── RESULTS & REVIEW ─────────────────────────────────────────────────────────
router.get("/battles/:battleId/results", authenticateToken, asyncHandler(service.battleResults));
router.get("/battles/:battleId/questions.pdf", authenticateToken, asyncHandler(service.battleQuestionsPdf));
router.get("/battles/:battleId/questions", authenticateToken, asyncHandler(service.battleQuestions));
router.get("/battles/:battleId/log", authenticateToken, asyncHandler(service.battleLog));

// ─── QUESTION BANK ────────────────────────────────────────────────────────────
// A course's bank (answers included) is its own teacher's: the instructor role
// alone used to read and write any course's bank (Phase 15 item 6).
const requireBankOwner = asyncHandler(async (req, res, next) => {
  const { isInstructor } = await canRunCourseBattles(req.user.id, req.user.role, req.params.courseId);
  if (!isInstructor) return res403(res, "Not your course");
  next();
});

router.get("/courses/:courseId/questions-bank", authenticateToken, requireRole(["instructor", "admin"]), requireBankOwner, asyncHandler(service.listBankQuestions));
router.post("/courses/:courseId/questions-bank", authenticateToken, requireRole(["instructor", "admin"]), requireBankOwner, asyncHandler(service.createBankQuestion));
router.put("/questions-bank/:questionId", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(service.updateBankQuestion));
router.delete("/questions-bank/:questionId", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(service.retireBankQuestion));
// POST /api/courses/:courseId/questions-bank/generate
router.post("/courses/:courseId/questions-bank/generate", authenticateToken, requireRole(["instructor", "admin"]), requireBankOwner, asyncHandler(service.generateBankQuestions));

// ─── § MISSING ENDPOINTS — added per frontend audit ──────────────────────────
router.put("/battles/:battleId", authenticateToken, asyncHandler(service.editBattle));
router.delete("/battles/:battleId", authenticateToken, asyncHandler(service.deleteBattle));
router.get("/instructor/stats", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(service.instructorStats));
router.get("/courses/:courseId/battles/session/:sessionId", authenticateToken, asyncHandler(service.sessionBattles));
router.post("/courses/:courseId/battles/session", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(service.createSessionBattle));

// The routes a recurring series runs in-process (battle/series.js).
export const occurrenceHandlers = {
  classInvite: service.classInvite,
  courseInvite: service.courseInvite,
  declineChallenge: service.declineChallenge,
};

export default router;
