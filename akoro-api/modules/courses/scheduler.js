/**
 * scheduler.js  —  Piabam Live Session Scheduler
 *
 * Usage in app.js:
 *   import "./scheduler.js";   // self-starts — no return value needed
 *
 * ─── Sections ────────────────────────────────────────────────────────────────
 *  § IMPORTS
 *  § LIVE-LINKS STORE       in-memory table (swap for Postgres/Mongo)
 *  § PLATFORM CLIENTS       Zoom + Google Meet API calls
 *  § CORE LOGIC             createLiveLink / deleteLiveLink / activateSession
 *  § CRON JOBS              three scheduled jobs
 *  § MANUAL TRIGGERS        REST handlers for on-demand scheduling
 *  § ROUTER                 exported and mounted in app.js
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Dependencies to add to package.json:
 *   "node-cron":  "^3.0.3"
 *   "axios":      "^1.7.2"
 *
 * Environment variables required (.env):
 *   ZOOM_ACCOUNT_ID        from Zoom Server-to-Server OAuth app
 *   ZOOM_CLIENT_ID
 *   ZOOM_CLIENT_SECRET
 *   GOOGLE_CLIENT_ID       from Google OAuth2 credentials
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI
 */

// ─── § IMPORTS ────────────────────────────────────────────────────────────────

import { Router }    from "express";
import cron          from "node-cron";
import { meetingsPost, meetingsDelete } from "../../lib/meetingsBreaker.js";
import db            from "../../db.js";
import { createMeeting } from "./meeting-integration.js";
import { authenticateToken, requireRole } from "../auth/routes.js";

// This scheduler is now backed by the `live_sessions` Postgres table — the same
// rows the instructor app and live-sessions router read/write. Status vocabulary
// matches the DB CHECK constraint: scheduled → live → ended (+ cancelled / recorded).

// ─── § PLATFORM CLIENTS ───────────────────────────────────────────────────────

// ── Zoom ──────────────────────────────────────────────────────────────────────

/**
 * Exchange Zoom Server-to-Server OAuth credentials for a short-lived access token.
 * Zoom tokens expire in 1 hour — we request fresh ones per job run.
 */
const getZoomAccessToken = async () => {
  const credentials = Buffer.from(
    `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`
  ).toString("base64");

  const { data } = await meetingsPost(
    "https://zoom.us/oauth/token",
    new URLSearchParams({
      grant_type: "account_credentials",
      account_id: process.env.ZOOM_ACCOUNT_ID,
    }),
    { headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return data.access_token;
};

/**
 * Create a Zoom meeting for a session.
 * Returns { meetingId, joinUrl, startUrl, password }
 */
const createZoomMeeting = async ({ topic, scheduledAt, durationMin, teacherEmail, password }) => {
  const token = await getZoomAccessToken();

  const { data } = await meetingsPost(
    `https://api.zoom.us/v2/users/${teacherEmail}/meetings`,
    {
      topic,
      type:     2,                             // scheduled meeting
      start_time: scheduledAt,                 // ISO 8601
      duration:   durationMin,
      password:   password || Math.random().toString(36).slice(-6).toUpperCase(),
      settings: {
        join_before_host:         false,
        waiting_room:             true,
        auto_recording:           "cloud",
        mute_upon_entry:          true,
        participant_video:        false,
        host_video:               true,
        approval_type:            0,
      },
    },
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
  );

  return {
    meetingId: String(data.id),
    joinUrl:   data.join_url,
    startUrl:  data.start_url,
    password:  data.password,
  };
};

/**
 * Delete a Zoom meeting by its meeting ID.
 */
const deleteZoomMeeting = async (meetingId) => {
  const token = await getZoomAccessToken();
  await meetingsDelete(`https://api.zoom.us/v2/meetings/${meetingId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
};

// ── Google Meet ───────────────────────────────────────────────────────────────

/**
 * Refresh a teacher's Google OAuth2 access token using the stored refresh token.
 * The refresh token lives in the teachers table / teacher profile.
 */
const refreshGoogleToken = async (refreshToken) => {
  const { data } = await meetingsPost("https://oauth2.googleapis.com/token", {
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type:    "refresh_token",
  });
  return data.access_token;
};

/**
 * Create a Google Calendar event with a Meet link.
 * Google Meet links are generated automatically when conferenceDataVersion=1.
 * Returns { meetingId, joinUrl, startUrl }
 */
const createGoogleMeetLink = async ({ topic, scheduledAt, durationMin, teacherRefreshToken, attendeeEmails = [] }) => {
  const accessToken = await refreshGoogleToken(teacherRefreshToken);

  const startTime = new Date(scheduledAt);
  const endTime   = new Date(startTime.getTime() + durationMin * 60 * 1000);

  const { data } = await meetingsPost(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    {
      summary:     topic,
      description: `Piabam live class: ${topic}`,
      start:  { dateTime: startTime.toISOString(), timeZone: "Africa/Lagos" },
      end:    { dateTime: endTime.toISOString(),   timeZone: "Africa/Lagos" },
      attendees: attendeeEmails.map((e) => ({ email: e })),
      conferenceData: {
        createRequest: {
          requestId:             `akoro-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
    {
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  const meetLink = data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;

  return {
    meetingId: data.id,            // Google Calendar event ID
    joinUrl:   meetLink,
    startUrl:  meetLink,           // same link for host and students on Meet
    password:  null,
  };
};

/**
 * Delete a Google Calendar event (removes the Meet link with it).
 */
const deleteGoogleMeetLink = async ({ meetingId, teacherRefreshToken }) => {
  const accessToken = await refreshGoogleToken(teacherRefreshToken);
  await meetingsDelete(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${meetingId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
};


// ─── § CORE LOGIC (DB-backed) ─────────────────────────────────────────────────

const GRACE_MIN = 30;          // keep a session "live" this long past its end
const LINK_LEAD_MIN = 15;      // create the meeting link this long before start

// Fetch enrolled student user-ids for a course (for live-class notifications).
const courseParticipants = async (courseId) => {
  const { data } = await db
    .from("enrollments")
    .select("user_id")
    .eq("course_id", courseId)
    .eq("status", "active");
  return (data ?? []).map((r) => r.user_id);
};

const emitToParticipants = async (courseId, event, payload) => {
  const io = global.io;
  if (!io) return;
  const ids = await courseParticipants(courseId);
  for (const uid of ids) io.to(`user:${uid}`).emit(event, payload);
};

// Persist a bell notification for every enrolled student of a course.
// Best-effort — a notification failure never blocks the session lifecycle.
const notifyParticipantsDB = async (courseId, { type, title, content, relatedId }) => {
  try {
    const ids = await courseParticipants(courseId);
    if (!ids.length) return;
    const nowIso = new Date().toISOString();
    await db.from("notifications").insert(ids.map((uid) => ({
      user_id: uid, type, title, content: content ?? null,
      related_id: relatedId ?? null, is_read: false, created_at: nowIso,
    })));
  } catch (err) {
    console.warn("[scheduler] notification insert failed:", err.message);
  }
};

// Read a teacher's connected platform credentials from user_settings.
// Shape: settings.streaming_platforms[platform] = { connected, meeting_url,
//        host_email, refresh_token, access_token, connected_at }
const getInstructorPlatform = async (instructorId, platform) => {
  const { data } = await db
    .from("user_settings").select("settings").eq("user_id", instructorId).maybeSingle();
  return data?.settings?.streaming_platforms?.[platform] ?? null;
};

const persistLink = async (sessionId, meeting, platform) => {
  const { data: updated } = await db
    .from("live_sessions")
    .update({
      meeting_id:       meeting.meetingId ?? null,
      meeting_password: meeting.password ?? null,
      meeting_url:      meeting.joinUrl,
      join_url:         meeting.joinUrl,
      updated_at:       new Date().toISOString(),
    })
    .eq("id", sessionId)
    .select()
    .single();
  console.log(`[scheduler] ✅ link set session=${sessionId} platform=${platform}`);
  return updated;
};

/**
 * createLiveLink — best-effort meeting provisioning ~15 min before start.
 * Resolution order per the teacher's connected platform settings:
 *   1. OAuth-connected platform (provider_tokens) → createMeeting() — preferred
 *   2. Static personal room URL → stamp directly (works for zoom/meet/teams)
 *   3. Zoom + Server-to-Server env creds → create a scheduled meeting (fallback)
 * Persists onto the live_sessions row. Failures are logged, never fatal.
 */
const createLiveLink = async (session) => {
  if (session.join_url || session.meeting_url) return session;  // already provisioned

  const platform    = session.platform || "zoom";
  const topic       = session.title || "Live class";
  const scheduledAt = session.scheduled_start;
  const durationMin = Math.max(
    15,
    Math.round((new Date(session.scheduled_end || scheduledAt) - new Date(scheduledAt)) / 60000) || 60,
  );

  // 1. OAuth-connected platform — fresh per-session link via stored tokens.
  try {
    const meeting = await createMeeting(session.instructor_id, { topic, startTime: scheduledAt, durationMin, platform });
    if (meeting?.joinUrl || meeting?.meetingUrl) {
      return await persistLink(session.id, { meetingId: meeting.meetingId, password: meeting.password, joinUrl: meeting.joinUrl ?? meeting.meetingUrl }, platform) ?? session;
    }
  } catch (err) {
    // No OAuth connection (or Redis/token error) — fall through to other paths.
    if (!/No active|No meeting platform/.test(err.message)) {
      console.warn(`[scheduler] createMeeting unavailable session=${session.id}: ${err.message}`);
    }
  }

  const conn = await getInstructorPlatform(session.instructor_id, platform);

  // 2. Static personal room link — manual override, no API calls, all platforms.
  if (conn?.meeting_url) {
    return await persistLink(session.id, { joinUrl: conn.meeting_url }, platform) ?? session;
  }

  // 3. Zoom Server-to-Server fallback (account-level creds + host email).
  try {
    if (platform === "zoom" && process.env.ZOOM_CLIENT_ID) {
      const { data: instructor } = await db
        .from("users").select("email").eq("id", session.instructor_id).maybeSingle();
      const hostEmail = conn?.host_email || instructor?.email;
      const meeting = await createZoomMeeting({ topic, scheduledAt, durationMin, teacherEmail: hostEmail });
      return await persistLink(session.id, meeting, platform) ?? session;
    }
  } catch (err) {
    console.error(`[scheduler] ❌ meeting creation failed session=${session.id}`, err.message);
    return session;
  }

  return session; // no usable credentials — leave unprovisioned
};

/** activateSession — scheduled → live at start time. */
const activateSession = async (session) => {
  const { data } = await db
    .from("live_sessions")
    .update({ status: "live", actual_start: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", session.id)
    .eq("status", "scheduled")          // guard against double-activation
    .select()
    .maybeSingle();
  if (!data) return;
  console.log(`[scheduler] 🔴 session live session=${session.id}`);
  await emitToParticipants(session.course_id, "live_class_live", {
    sessionId: session.id, title: session.title, status: "live",
    joinUrl: session.join_url ?? session.meeting_url ?? null,
  });
  await notifyParticipantsDB(session.course_id, {
    type: "live_class", title: "🔴 Live class started",
    content: `${session.title} is live now — tap Join Live to enter.`,
    relatedId: session.id,
  });
};

/** expireSession — live → ended after end time + grace; tears down the meeting. */
const expireSession = async (session) => {
  const { data } = await db
    .from("live_sessions")
    .update({ status: "ended", actual_end: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", session.id)
    .eq("status", "live")
    .select()
    .maybeSingle();
  if (!data) return;

  if (session.platform === "zoom" && session.meeting_id && process.env.ZOOM_CLIENT_ID) {
    try { await deleteZoomMeeting(session.meeting_id); }
    catch (err) { console.error(`[scheduler] ⚠️ meeting delete failed session=${session.id}`, err.message); }
  }
  console.log(`[scheduler] ⏹ session ended session=${session.id}`);
  await emitToParticipants(session.course_id, "live_class_ended", { sessionId: session.id, status: "ended" });
};

// ─── § DEMO SESSION REGENERATOR ───────────────────────────────────────────────
//
// Keeps the seeded demo live courses perpetually testable, so the golden path
// (discover → enrol → receive live update → join) can be exercised any time:
//   · demo-live-rapid  → a session at every 10-minute boundary (next hour)
//   · other demo-*live* → one daily session (17:00 UTC) for the next 7 days
//
// It only ever touches courses seeded with a `demo-` slug, so on a pure prod
// database (no demo data) every query returns nothing and it is a no-op.
// Idempotent: sessions are keyed by their exact scheduled_start, so re-runs
// only insert the gaps.

const RAPID_SLUG    = "demo-live-rapid";
const TEN_MIN_MS    = 10 * 60000;
const HOUR_MS       = 60 * 60000;
const DAY_MS        = 24 * HOUR_MS;
const DAILY_UTC_HR  = 17;              // 17:00 UTC ≈ 18:00 WAT

const existingStarts = async (courseId, sinceMs) => {
  const { data } = await db
    .from("live_sessions")
    .select("scheduled_start")
    .eq("course_id", courseId)
    .in("status", ["scheduled", "live"])
    .gte("scheduled_start", new Date(sinceMs).toISOString());
  return new Set((data ?? []).map((r) => new Date(r.scheduled_start).toISOString()));
};

const ensureDemoSessions = async () => {
  const now = Date.now();

  // ── Rapid course: fill the next hour with 10-minute-spaced sessions. ──
  const { data: rapid } = await db
    .from("courses")
    .select("id, instructor_id, subject")
    .eq("slug", RAPID_SLUG).eq("is_published", true)
    .maybeSingle();

  if (rapid) {
    const first = Math.ceil(now / TEN_MIN_MS) * TEN_MIN_MS;   // next 10-min mark
    const have  = await existingStarts(rapid.id, now - TEN_MIN_MS);
    const rows  = [];
    for (let k = 0; k < 6; k++) {
      const iso = new Date(first + k * TEN_MIN_MS).toISOString();
      if (have.has(iso)) continue;
      rows.push({
        course_id: rapid.id, instructor_id: rapid.instructor_id,
        title: "⚡ Rapid Demo Session", topic: "Live flow test", subject: rapid.subject,
        description: "A fast-turnaround demo session for the live-class flow. Join to see the lobby, the going-live transition, and the in-class experience end to end. We'll run through a short worked example and take questions live.",
        session_type: "class", platform: "meet",
        scheduled_start: iso, scheduled_end: new Date(first + k * TEN_MIN_MS + TEN_MIN_MS).toISOString(),
        max_participants: 50, status: "scheduled",
      });
    }
    if (rows.length) await db.from("live_sessions").insert(rows);
  }

  // ── Daily courses: one session per day (17:00 UTC) for the next 7 days. ──
  const { data: dailies } = await db
    .from("courses")
    .select("id, instructor_id, subject, title, slug")
    .eq("is_published", true).eq("course_type", "live")
    .like("slug", "demo-%").neq("slug", RAPID_SLUG);

  for (const c of dailies ?? []) {
    const base = new Date(now);
    base.setUTCHours(DAILY_UTC_HR, 0, 0, 0);
    const have = await existingStarts(c.id, now - HOUR_MS);
    const rows = [];
    for (let d = 0; d < 7; d++) {
      const t = base.getTime() + d * DAY_MS;
      if (t <= now) continue;                       // only future slots
      const iso = new Date(t).toISOString();
      if (have.has(iso)) continue;
      rows.push({
        course_id: c.id, instructor_id: c.instructor_id,
        title: `${c.title} — Daily Session`, topic: c.subject, subject: c.subject,
        description: `Live ${c.subject} class with your instructor. This session covers the core ideas step by step, works through exam-style problems on the board, and leaves time for live Q&A. Come with your questions — bring a notebook and a calculator.`,
        session_type: "class", platform: "meet",
        scheduled_start: iso, scheduled_end: new Date(t + HOUR_MS).toISOString(),
        max_participants: 50, status: "scheduled",
      });
    }
    if (rows.length) await db.from("live_sessions").insert(rows);
  }
};

// ─── § CRON JOBS ──────────────────────────────────────────────────────────────
//
// One 1-minute tick drives the whole lifecycle off the live_sessions table:
//   · top up the perpetual demo sessions (rapid + daily)
//   · create meeting link ≤15 min before start
//   · scheduled → live at start
//   · live → ended after end + grace
// The status/start index (idx_live_sessions_status_start) keeps these cheap.

let _tickRunning = false;

const tick = async () => {
  if (_tickRunning) return;           // avoid overlap on slow DB
  _tickRunning = true;
  try {
    // Keep the demo courses perpetually live-testable. Never fatal.
    try { await ensureDemoSessions(); }
    catch (err) { console.error("[scheduler] demo regen error:", err.message); }

    const now = Date.now();
    const horizon = new Date(now + LINK_LEAD_MIN * 60000).toISOString();

    // Upcoming sessions within the link-lead window OR already due to start.
    const { data: upcoming } = await db
      .from("live_sessions")
      .select("*")
      .eq("status", "scheduled")
      .lte("scheduled_start", horizon);

    for (const s of upcoming ?? []) {
      const startMs = new Date(s.scheduled_start).getTime();
      if (startMs - now <= LINK_LEAD_MIN * 60000 && startMs - now > 0) {
        const linked = await createLiveLink(s);
        if (linked.join_url) {
          await emitToParticipants(s.course_id, "live_class_starting", {
            sessionId: s.id, title: s.title,
            minutesUntil: Math.round((startMs - now) / 60000),
            joinUrl: linked.join_url,
          });
        }
      }
      if (startMs <= now) await activateSession(s);
    }

    // Live sessions past their end time + grace.
    const { data: liveOnes } = await db
      .from("live_sessions")
      .select("*")
      .eq("status", "live");

    for (const s of liveOnes ?? []) {
      const endMs = new Date(s.scheduled_end || s.scheduled_start).getTime() + GRACE_MIN * 60000;
      if (now >= endMs) await expireSession(s);
    }
  } catch (err) {
    console.error("[scheduler] tick error:", err.message);
  } finally {
    _tickRunning = false;
  }
};

// The dials must reach this cron too: it ticks every minute, queries
// live_sessions, and for OAuth-backed sessions calls Zoom/Google — with
// every BullMQ worker disabled, this still ran around the clock.
import { skipJob } from "../../lib/jobsGate.js";
if (skipJob("live-session scheduler")) {
  console.log("[scheduler] ⏰ live-session cron NOT registered (jobs gate)");
} else {
  cron.schedule("* * * * *", tick);
  console.log("[scheduler] ⏰ DB-backed live-session cron registered (1-min tick)");
}

// ─── § MANUAL TRIGGERS ────────────────────────────────────────────────────────
// REST endpoints so teachers/admins can act without waiting for the tick.

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const loadSession = async (id) => {
  const { data } = await db.from("live_sessions").select("*").eq("id", id).maybeSingle();
  return data;
};

const schedulerHandlers = {
  // POST /api/scheduler/links/:sessionId — provision the meeting link now.
  createLink: wrap(async (req, res) => {
    const s = await loadSession(req.params.sessionId);
    if (!s) return res.status(404).json({ success: false, message: "Session not found" });
    const updated = await createLiveLink(s);
    res.status(201).json({ success: true, data: { joinUrl: updated.join_url ?? updated.meeting_url ?? null } });
  }),

  // GET /api/scheduler/links/:sessionId — read the current link.
  getLinkBySession: wrap(async (req, res) => {
    const s = await loadSession(req.params.sessionId);
    if (!s) return res.status(404).json({ success: false, message: "Session not found" });
    res.json({ success: true, data: { joinUrl: s.join_url ?? s.meeting_url ?? null, meetingId: s.meeting_id ?? null } });
  }),

  // POST /api/scheduler/activate/:sessionId — force scheduled → live.
  activate: wrap(async (req, res) => {
    const s = await loadSession(req.params.sessionId);
    if (!s) return res.status(404).json({ success: false, message: "Session not found" });
    await activateSession(s);
    res.json({ success: true, data: await loadSession(req.params.sessionId) });
  }),

  // POST /api/scheduler/end/:sessionId — force live → ended.
  end: wrap(async (req, res) => {
    const s = await loadSession(req.params.sessionId);
    if (!s) return res.status(404).json({ success: false, message: "Session not found" });
    await expireSession(s);
    res.json({ success: true, data: await loadSession(req.params.sessionId) });
  }),
};

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

// All manual triggers require an authenticated instructor/admin — these can
// force a session live/ended and provision meeting links.
router.use(authenticateToken);
router.get ("/links/:sessionId",    schedulerHandlers.getLinkBySession);
router.post("/links/:sessionId",    requireRole(["instructor", "admin"]), schedulerHandlers.createLink);
router.post("/activate/:sessionId", requireRole(["instructor", "admin"]), schedulerHandlers.activate);
router.post("/end/:sessionId",      requireRole(["instructor", "admin"]), schedulerHandlers.end);

export default router;
