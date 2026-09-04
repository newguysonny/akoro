/**
 * student-feed.js
 * ───────────────────────────────────────────────────────────────
 * Learner-facing feed endpoints — wires the frontend Learn tab
 * to the backend completely.
 *
 * Routes mounted at /api/student:
 *   GET /api/student/sessions      — all enrolled sessions (live + scheduled + agent)
 *   GET /api/student/live-alerts   — polling fallback: starting-soon sessions only
 *
 * Routes mounted at /api/battle (added here for cross-course queries):
 *   GET /api/battle/my-challenges  — all pending challenges across all courses
 *   GET /api/battle/my-battles     — all battles across all courses
 */

import { Router }         from "express";
import { jsonbArray, jsonbObject } from "../../lib/jsonb.js";
import db                 from "../../db.js";
import { authenticateToken } from "../auth/routes.js";

const router = Router();

/* ─── helpers ────────────────────────────────────────────────────────────────*/

/**
 * Compute scheduleBucket and minutesUntil from a UTC ISO start time.
 * Used to drive the Live Classes sub-tabs on the frontend.
 */
function getScheduleBucket(scheduledStart) {
  if (!scheduledStart) return { bucket: "later", minutesUntil: null };

  const now       = Date.now();
  const startMs   = new Date(scheduledStart).getTime();
  const diffMs    = startMs - now;
  const diffMins  = Math.round(diffMs / 60_000);

  if (diffMs <= 0)                  return { bucket: "live",          minutesUntil: 0 };
  if (diffMins <= 15)               return { bucket: "starting-soon", minutesUntil: diffMins };
  if (diffMins <= 60)               return { bucket: "today",         minutesUntil: diffMins };

  // Compare calendar days in local time
  const startDate = new Date(scheduledStart);
  const nowDate   = new Date();
  const todayDay  = nowDate.toDateString();
  const tomorrowDate = new Date(nowDate);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowDay = tomorrowDate.toDateString();
  const weekDate    = new Date(nowDate);
  weekDate.setDate(weekDate.getDate() + 7);

  if (startDate.toDateString() === todayDay)     return { bucket: "today",    minutesUntil: diffMins };
  if (startDate.toDateString() === tomorrowDay)  return { bucket: "tomorrow", minutesUntil: diffMins };
  if (startDate <= weekDate)                     return { bucket: "week",     minutesUntil: diffMins };

  return { bucket: "later", minutesUntil: diffMins };
}

/**
 * Format a UTC ISO time as "2:00 PM" in server locale.
 */
function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-NG", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

/**
 * Format day label: "Today", "Tomorrow", "Thu", "Jun 12"
 */
function formatDayLabel(iso) {
  if (!iso) return "";
  const d         = new Date(iso);
  const now       = new Date();
  const tomorrow  = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (d.toDateString() === now.toDateString())      return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";

  return d.toLocaleDateString("en-NG", { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Map a DB live_session row → frontend SessionCard shape.
 */
function mapLiveSession(row, participantStatus) {
  const { bucket, minutesUntil } = getScheduleBucket(row.scheduled_start);
  const isLive       = row.status === "live";
  const startingSoon = bucket === "starting-soon";

  return {
    // identity
    id:             row.id,
    type:           "live",
    status:         isLive ? "live" : startingSoon ? "starting-soon" : "upcoming",

    // display
    title:          row.title,
    description:    row.description ?? "",
    topic:          row.topic       ?? row.courses?.title ?? "",
    subject:        row.subject     ?? "science",
    avatar:         row.users?.avatar_url  ?? null,
    tutor:          row.users?.full_name   ?? "Instructor",
    level:          row.level ?? "All levels",

    // schedule
    startsAt:       row.scheduled_start,
    time:           formatTime(row.scheduled_start),
    dayLabel:       formatDayLabel(row.scheduled_start),
    minutesUntil,
    scheduleBucket: bucket,
    nextSession:    isLive ? "LIVE" : startingSoon ? `in ${minutesUntil} min` : formatDayLabel(row.scheduled_start),

    // join
    joinUrl:        row.join_url ?? null,
    canJoin:        isLive && participantStatus === "registered",
    platform:       row.platform ?? null,

    // stats (defaults — enriched by enrollments later)
    topics:         row.topic_count   ?? 5,
    revisions:      row.revision_count ?? 0,
    reviews:        row.review_count   ?? 0,
    progress:       row.progress       ?? 0,
    unread:         row.unread_count   ?? 0,

    // priority dot
    priority:       isLive ? "live" : startingSoon ? "high" : "medium",

    // course
    courseId:       row.courses?.id    ?? null,
    courseTitle:    row.courses?.title ?? "",
  };
}

/* ═══════════════════════════════════════════════════════════════
   GET /api/student/sessions
   Returns all enrolled sessions — live, scheduled, and agent —
   with scheduleBucket so the frontend can drive all sub-tabs
   from a single call.
═══════════════════════════════════════════════════════════════ */
router.get("/sessions", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`[sessions] userId=${userId}`);

    // ── 1. Live / scheduled classes ──────────────────────────────────────────
    // A student should see a session if they either (a) explicitly registered as
    // a participant, OR (b) are enrolled in the course it belongs to. Live-class
    // NOTIFICATIONS go to every enrolled student, so the tab must match that
    // audience — otherwise an enrolled-but-unregistered student gets the alert
    // but sees an empty tab.
    const [{ data: participantRows, error: partErr }, { data: enrollRows, error: enrErr }] = await Promise.all([
      db.from("session_participants").select("session_id").eq("user_id", userId),
      db.from("enrollments").select("course_id").eq("user_id", userId).eq("status", "active"),
    ]);
    if (partErr) throw new Error(partErr.message);
    if (enrErr)  throw new Error(enrErr.message);

    const sessionIds       = (participantRows ?? []).map(r => r.session_id);
    const enrolledCourseIds = (enrollRows ?? []).map(r => r.course_id);
    console.log(`[sessions] sessionIds=${sessionIds.length} enrolledCourses=${enrolledCourseIds.length}`);

    const SESSION_SELECT = `
      id, title, description, topic, subject, status,
      scheduled_start, join_url, platform, course_id,
      courses ( id, title ),
      users!live_sessions_instructor_id_fkey ( full_name, avatar_url )
    `;

    // Two queries (registered-by-id + enrolled-by-course) merged & de-duped —
    // simpler and more reliable than a cross-column PostgREST .or().
    const [byId, byCourse] = await Promise.all([
      sessionIds.length
        ? db.from("live_sessions").select(SESSION_SELECT).in("id", sessionIds).in("status", ["scheduled", "live"])
        : Promise.resolve({ data: [] }),
      enrolledCourseIds.length
        ? db.from("live_sessions").select(SESSION_SELECT).in("course_id", enrolledCourseIds).in("status", ["scheduled", "live"])
        : Promise.resolve({ data: [] }),
    ]);
    if (byId.error)     throw new Error(byId.error.message);
    if (byCourse.error) throw new Error(byCourse.error.message);

    const registeredIds = new Set(sessionIds);
    const seen = new Map();
    for (const s of [...(byId.data ?? []), ...(byCourse.data ?? [])]) {
      if (!seen.has(s.id)) seen.set(s.id, s);
    }
    const liveSessions = [...seen.values()]
      .sort((a, b) => new Date(a.scheduled_start || 0) - new Date(b.scheduled_start || 0))
      .map(s => mapLiveSession(s, registeredIds.has(s.id) ? "registered" : "enrolled"));
    console.log(`[sessions] live_sessions merged=${liveSessions.length}`);

    // ── 2. Agent sessions from edu.adaptive_sessions ─────────────────────────
    const { data: agentRows, error: agentErr } = await db
      .schema("edu")
      .from("adaptive_sessions")
      .select("id, topic, subject, status, updated_at, subtopics, objectives")
      .eq("student_id", userId)
      .in("status", ["active", "complete"])
      .order("updated_at", { ascending: false })
      .limit(20);
    // NOTE: the PostgREST builder is a thenable without .catch — calling
    // .catch() on it threw synchronously and 500'd this endpoint. Errors are
    // reported in agentErr below instead.

    console.log(`[sessions] agent rows=${agentRows?.length ?? 0} agentErr=${agentErr?.message ?? null}`);

    const agentSessions = (agentRows ?? []).map((row, i) => {
      const subtopics  = jsonbArray(row.subtopics);
      const isComplete = row.status === "complete";
      return {
        id:             row.id,
        type:           "agent",
        status:         isComplete ? "complete" : "active",
        title:          row.topic   ?? "Untitled Session",
        description:    "",
        topic:          row.topic   ?? "",
        subject:        row.subject ?? "science",
        avatar:         null,
        tutor:          "AI Agent",
        level:          "Adaptive",
        startsAt:       row.updated_at,
        time:           formatTime(row.updated_at),
        dayLabel:       formatDayLabel(row.updated_at),
        minutesUntil:   null,
        scheduleBucket: "later",
        nextSession:    isComplete ? "Complete" : "Active",
        topics:         subtopics.length || 3,
        revisions:      0,
        reviews:        0,
        progress:       isComplete ? 100 : 40,
        unread:         0,
        priority:       isComplete ? "low" : "medium",
        courseId:       null,
        courseTitle:    "",
      };
    });

    // ── 3. Merge and sort ─────────────────────────────────────────────────────
    // Live → Starting soon → Today → Tomorrow → Week → Agent → Later
    const bucketOrder = {
      "live": 0, "starting-soon": 1, "today": 2,
      "tomorrow": 3, "week": 4, "later": 5,
    };

    const all = [...liveSessions, ...agentSessions].sort((a, b) => {
      const ao = bucketOrder[a.scheduleBucket] ?? 5;
      const bo = bucketOrder[b.scheduleBucket] ?? 5;
      if (ao !== bo) return ao - bo;
      if (a.startsAt && b.startsAt)
        return new Date(a.startsAt) - new Date(b.startsAt);
      return 0;
    });

    console.log(`[sessions] final: live=${liveSessions.length} agent=${agentSessions.length} total=${all.length}`);
    res.json({ success: true, sessions: all, total: all.length });

  } catch (err) {
    console.error("[student/sessions]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   GET /api/student/live-alerts
   Lightweight polling fallback — only starting-soon + live.
   Frontend polls this every 60 s when WebSocket is offline.
═══════════════════════════════════════════════════════════════ */
router.get("/live-alerts", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: partRows } = await db
      .from("session_participants")
      .select("session_id")
      .eq("user_id", userId);

    const sIds = (partRows ?? []).map(r => r.session_id);
    let alerts = [];

    if (sIds.length > 0) {
      const { data: sessionRows } = await db
        .from("live_sessions")
        .select("id, title, subject, status, scheduled_start, join_url")
        .in("id", sIds)
        .in("status", ["scheduled", "live"]);

      alerts = (sessionRows ?? [])
        .map(s => {
          const { bucket, minutesUntil } = getScheduleBucket(s.scheduled_start);
          return { sessionId: s.id, title: s.title, subject: s.subject,
            status: s.status, bucket, minutesUntil, joinUrl: s.join_url };
        })
        .filter(a => a.status === "live" || a.bucket === "starting-soon")
        .sort((a, b) => (a.minutesUntil ?? 0) - (b.minutesUntil ?? 0));
    }

    res.json({ success: true, alerts, count: alerts.length });

  } catch (err) {
    console.error("[student/live-alerts]", err.message);
    res.status(500).json({ error: err.message });
  }
});

export { router as studentFeedRouter };

/* ═══════════════════════════════════════════════════════════════
   BATTLE FEED — cross-course queries
   These extend the battle module for the frontend Learn tab.
═══════════════════════════════════════════════════════════════ */

const battleFeedRouter = Router();

/**
 * Difficulty config — maps DB string to frontend label/colors.
 */
const DIFF = {
  beginner:     { label: "🟢 Beginner",     color: "#10B981" },
  intermediate: { label: "🟡 Intermediate",  color: "#F59E0B" },
  advanced:     { label: "🔴 Advanced",      color: "#EF4444" },
};

/**
 * Map a DB battle row → frontend ChallengeRow shape.
 */
function mapChallenge(battle, myUserId, challengerUser) {
  const isImmediate  = battle.status === "lobby" && !battle.scheduled_start;
  const isScheduled  = !!battle.scheduled_start;
  const isClassroom  = battle.battle_type === "classroom";

  const expiresAt  = battle.expires_at ? new Date(battle.expires_at) : null;
  const expiresIn  = expiresAt
    ? `${Math.max(0, Math.round((expiresAt - Date.now()) / 60_000))} min`
    : "—";

  return {
    id:           battle.id,
    challenger:   challengerUser?.full_name  ?? "Opponent",
    avatar:       challengerUser?.avatar_url ?? null,
    title:        battle.title,
    subject:      battle.subject  ?? "science",
    topic:        battle.topic    ?? battle.title,
    difficulty:   battle.difficulty ?? "intermediate",
    battleType:   isClassroom ? "classroom" : isScheduled ? "scheduled" : "immediate",
    xpPrize:      `+${battle.xp_prize ?? 200} XP`,
    timeLimit:    `${Math.round((battle.time_limit_seconds ?? 900) / 60)} min`,
    expiresIn,
    scheduledFor: battle.scheduled_start
      ? new Date(battle.scheduled_start).toLocaleString("en-NG", { weekday:"short", hour:"2-digit", minute:"2-digit" })
      : null,
    participants: [],   // populated for classroom battles
    courseId:     battle.course_id,
    status:       battle.status,
  };
}

/* ─── GET /api/battle/my-challenges ─────────────────────────────────────────
   All pending challenges directed at the current student,
   across every course they're enrolled in.
─────────────────────────────────────────────────────────────────────────────*/
battleFeedRouter.get("/my-challenges", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Find all battles where this user is an opponent in lobby/scheduled status
    const { data: rows, error } = await db
      .from("battle_participants")
      .select(`
        role,
        battles (
          id, title, topic, subject, difficulty, battle_type,
          status, xp_prize, time_limit_seconds, expires_at,
          scheduled_start, course_id, created_by
        )
      `)
      .eq("user_id", userId)
      .eq("role", "opponent")
      .in("battles.status", ["lobby", "scheduled"]);

    if (error) throw new Error(error.message);

    const battles = (rows ?? []).filter(r => r.battles);

    // Fetch challenger user details in one query
    const challengerIds = [...new Set(battles.map(r => r.battles.created_by))];
    const { data: users } = await db
      .from("users")
      .select("id, full_name, avatar_url")
      .in("id", challengerIds);

    const userMap = Object.fromEntries((users ?? []).map(u => [u.id, u]));

    const challenges = battles.map(r =>
      mapChallenge(r.battles, userId, userMap[r.battles.created_by])
    );

    res.json({ success: true, challenges, count: challenges.length });

  } catch (err) {
    console.error("[battle/my-challenges]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─── GET /api/battle/my-battles ─────────────────────────────────────────────
   All battles the student is participating in across all courses.
─────────────────────────────────────────────────────────────────────────────*/
battleFeedRouter.get("/my-battles", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: rows, error } = await db
      .from("battle_participants")
      .select(`
        role,
        battles (
          id, title, topic, subject, difficulty, battle_type,
          status, xp_prize, time_limit_seconds, scheduled_start,
          course_id, created_by, created_at
        )
      `)
      .eq("user_id", userId)
      .in("battles.status", ["lobby", "scheduled", "live", "completed"])
      .order("joined_at", { ascending: false })
      .limit(30);

    if (error) throw new Error(error.message);

    const battles = (rows ?? []).filter(r => r.battles);

    // Fetch all participant users
    const allBattleIds   = battles.map(r => r.battles.id);
    const { data: parts } = await db
      .from("battle_participants")
      .select("battle_id, user_id, role, score, hp, is_winner, users ( full_name, avatar_url ), user_agents ( agent_name, agent_emoji, agent_color, agent_bg )")
      .in("battle_id", allBattleIds);

    const partsByBattle = {};
    for (const p of parts ?? []) {
      if (!partsByBattle[p.battle_id]) partsByBattle[p.battle_id] = [];
      partsByBattle[p.battle_id].push(p);
    }

    const mapped = battles.map(r => {
      const b     = r.battles;
      const parts = partsByBattle[b.id] || [];
      const me    = parts.find(p => p.user_id === userId);
      const opp   = parts.find(p => p.user_id !== userId);

      const COLORS   = ["#6C3BFF", "#E8884A", "#10B981", "#EF4444", "#F59E0B"];
      const myColor  = COLORS[0];
      const oppColor = COLORS[1];

      return {
        id:           b.id,
        title:        b.title,
        subject:      b.subject ?? "science",
        topic:        b.topic   ?? b.title,
        difficulty:   b.difficulty ?? "intermediate",
        battleType:   b.battle_type ?? "1v1",
        status:       b.status,
        xpPrize:      `+${b.xp_prize ?? 200} XP`,
        timeLimit:    `${Math.round((b.time_limit_seconds ?? 900) / 60)} min`,
        challenger:   opp?.users?.full_name ?? "Opponent",
        avatar:       opp?.users?.avatar_url ?? null,
        startedAgo:   b.status === "live" && b.scheduled_start
          ? Math.round((Date.now() - new Date(b.scheduled_start)) / 60_000)
          : null,
        startsIn:     b.scheduled_start
          ? new Date(b.scheduled_start).toLocaleString("en-NG", { weekday:"short", hour:"2-digit", minute:"2-digit" })
          : null,
        agentA: {
          id:     me?.user_id  ?? userId,
          name:   me?.user_agents?.agent_name  ?? "Your agent",
          emoji:  me?.user_agents?.agent_emoji ?? "🤖",
          bg:     me?.user_agents?.agent_bg    ?? "#FEF0E6",
          color:  me?.user_agents?.agent_color ?? myColor,
          isYou:  true,
          score:  me?.score ?? 0,
          hp:     me?.hp ?? 100,
        },
        agentB: {
          id:     opp?.user_id ?? "opp",
          name:   opp?.user_agents?.agent_name ?? ((opp?.users?.full_name?.split(" ")[0] ?? "Opponent") + "'s Agent"),
          emoji:  opp?.user_agents?.agent_emoji ?? "⚡",
          bg:     opp?.user_agents?.agent_bg    ?? "#C8D8E8",
          color:  opp?.user_agents?.agent_color ?? oppColor,
          score:  opp?.score ?? 0,
          hp:     opp?.hp ?? 100,
        },
        winner:       me?.is_winner ? "agentA" : opp?.is_winner ? "agentB" : null,
        courseId:     b.course_id,
      };
    });

    res.json({ success: true, battles: mapped, count: mapped.length });

  } catch (err) {
    console.error("[battle/my-battles]", err.message);
    res.status(500).json({ error: err.message });
  }
});

export { battleFeedRouter };
