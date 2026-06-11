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
import axios         from "axios";
import db            from "../../db.js";

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

  const { data } = await axios.post(
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

  const { data } = await axios.post(
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
  await axios.delete(`https://api.zoom.us/v2/meetings/${meetingId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
};

// ── Google Meet ───────────────────────────────────────────────────────────────

/**
 * Refresh a teacher's Google OAuth2 access token using the stored refresh token.
 * The refresh token lives in the teachers table / teacher profile.
 */
const refreshGoogleToken = async (refreshToken) => {
  const { data } = await axios.post("https://oauth2.googleapis.com/token", {
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

  const { data } = await axios.post(
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
  await axios.delete(
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

/**
 * createLiveLink — best-effort meeting provisioning ~15 min before start.
 * Persists meeting_url / join_url / meeting_id / meeting_password onto the
 * live_sessions row. Failures are logged, never fatal (status flow still runs).
 */
const createLiveLink = async (session) => {
  if (session.join_url || session.meeting_url) return session;  // already provisioned

  // Load the instructor's email (Zoom S2S needs a host email).
  const { data: instructor } = await db
    .from("users").select("email").eq("id", session.instructor_id).maybeSingle();

  const platform    = session.platform || "zoom";
  const topic       = session.title || "Live class";
  const scheduledAt = session.scheduled_start;
  const durationMin = Math.max(
    15,
    Math.round((new Date(session.scheduled_end || scheduledAt) - new Date(scheduledAt)) / 60000) || 60,
  );

  let meeting;
  try {
    if (platform === "zoom" && process.env.ZOOM_CLIENT_ID) {
      meeting = await createZoomMeeting({ topic, scheduledAt, durationMin, teacherEmail: instructor?.email });
    } else {
      return session; // meet/teams need per-teacher OAuth tokens (not yet stored)
    }
  } catch (err) {
    console.error(`[scheduler] ❌ meeting creation failed session=${session.id}`, err.message);
    return session;
  }

  const { data: updated } = await db
    .from("live_sessions")
    .update({
      meeting_id:       meeting.meetingId,
      meeting_password: meeting.password ?? null,
      meeting_url:      meeting.joinUrl,
      join_url:         meeting.joinUrl,
      updated_at:       new Date().toISOString(),
    })
    .eq("id", session.id)
    .select()
    .single();

  console.log(`[scheduler] ✅ link created session=${session.id} platform=${platform}`);
  return updated ?? session;
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

// ─── § CRON JOBS ──────────────────────────────────────────────────────────────
//
// One 1-minute tick drives the whole lifecycle off the live_sessions table:
//   · create meeting link ≤15 min before start
//   · scheduled → live at start
//   · live → ended after end + grace
// The status/start index (idx_live_sessions_status_start) keeps these cheap.

let _tickRunning = false;

const tick = async () => {
  if (_tickRunning) return;           // avoid overlap on slow DB
  _tickRunning = true;
  try {
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

cron.schedule("* * * * *", tick);
console.log("[scheduler] ⏰ DB-backed live-session cron registered (1-min tick)");

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

router.get ("/links/:sessionId",    schedulerHandlers.getLinkBySession);
router.post("/links/:sessionId",    schedulerHandlers.createLink);
router.post("/activate/:sessionId", schedulerHandlers.activate);
router.post("/end/:sessionId",      schedulerHandlers.end);

export default router;
