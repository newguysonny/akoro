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

// Internal store references — these are the same in-memory arrays
// used in courses.js. In production both files import from a shared
// DB module instead.
import { SessionStore, CourseStore, TeacherStore } from "./store.js";

// ─── § LIVE-LINKS STORE ───────────────────────────────────────────────────────
//
// live_class_links table
// ─────────────────────
// id            uuid  PK
// sessionId     uuid  FK → sessions.id
// courseId      uuid  FK → courses.id
// teacherId     uuid  FK → teachers.id
// platform      "zoom" | "meet"
// meetingId     string   platform's own meeting identifier
// joinUrl       string   the URL students click
// startUrl      string   the URL the teacher uses (Zoom only)
// password      string?  Zoom meeting password
// topic         string   meeting title sent to the platform
// scheduledAt   ISO      when the session is due to start
// expiresAt     ISO      when the link should be deleted (scheduledAt + durationMin)
// createdAt     ISO
// deletedAt     ISO?     soft-delete timestamp

let _liveLinks = [];

const LiveLinkStore = {
  list:          (filters = {}) => {
    let r = _liveLinks.filter((l) => !l.deletedAt);
    if (filters.courseId)  r = r.filter((l) => l.courseId  === filters.courseId);
    if (filters.teacherId) r = r.filter((l) => l.teacherId === filters.teacherId);
    if (filters.sessionId) r = r.filter((l) => l.sessionId === filters.sessionId);
    return r;
  },
  get:           (id)    => _liveLinks.find((l) => l.id === id && !l.deletedAt) ?? null,
  getBySession:  (sid)   => _liveLinks.find((l) => l.sessionId === sid && !l.deletedAt) ?? null,
  create:        (data)  => { _liveLinks.push(data); return data; },
  update:        (id, d) => { const i = _liveLinks.findIndex((l) => l.id === id); if (i === -1) return null; _liveLinks[i] = { ..._liveLinks[i], ...d }; return _liveLinks[i]; },
  softDelete:    (id)    => { const i = _liveLinks.findIndex((l) => l.id === id); if (i === -1) return false; _liveLinks[i].deletedAt = new Date().toISOString(); return true; },
};

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

// ─── § CORE LOGIC ─────────────────────────────────────────────────────────────

/**
 * createLiveLink
 *
 * Called when a session is ~15 min away from starting.
 * 1. Fetches the session + course + teacher from the store
 * 2. Calls Zoom or Google Meet to create the meeting
 * 3. Saves the link record to LiveLinkStore
 * 4. Patches the session with the joinUrl so the frontend can read it
 *
 * Returns the created LiveLink record.
 */
const createLiveLink = async (sessionId) => {
  const session = SessionStore.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  // Don't double-create
  const existing = LiveLinkStore.getBySession(sessionId);
  if (existing) return existing;

  const course  = CourseStore.get(session.courseId);
  if (!course)  throw new Error(`Course ${session.courseId} not found`);

  const teacher = TeacherStore.get(course.teacherId);
  if (!teacher) throw new Error(`Teacher ${course.teacherId} not found`);

  const platform    = session.platform || course.platform || "zoom";
  const topic       = `${course.title} — ${session.title}`;
  const scheduledAt = buildISO(session.date, session.time);
  const durationMin = session.durationMin || course.sessionLengthMin || 90;

  let meetingData;

  if (platform === "zoom") {
    meetingData = await createZoomMeeting({
      topic,
      scheduledAt,
      durationMin,
      teacherEmail: teacher.email,
    });
  } else if (platform === "meet") {
    if (!teacher.googleRefreshToken)
      throw new Error(`Teacher ${teacher.id} has no Google refresh token stored`);
    meetingData = await createGoogleMeetLink({
      topic,
      scheduledAt,
      durationMin,
      teacherRefreshToken: teacher.googleRefreshToken,
    });
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const expiresAt = new Date(
    new Date(scheduledAt).getTime() + (durationMin + 30) * 60 * 1000  // +30 min buffer
  ).toISOString();

  const link = LiveLinkStore.create({
    id:          crypto.randomUUID(),
    sessionId,
    courseId:    course.id,
    teacherId:   teacher.id,
    platform,
    meetingId:   meetingData.meetingId,
    joinUrl:     meetingData.joinUrl,
    startUrl:    meetingData.startUrl,
    password:    meetingData.password,
    topic,
    scheduledAt,
    expiresAt,
    createdAt:   new Date().toISOString(),
    deletedAt:   null,
  });

  // Patch the session so the frontend can surface the join URL immediately
  SessionStore.update(sessionId, { joinUrl: link.joinUrl, startUrl: link.startUrl });

  console.log(`[scheduler] ✅ Live link created  session=${sessionId}  platform=${platform}  url=${link.joinUrl}`);
  return link;
};

/**
 * activateSession
 *
 * Flips a session's status from "upcoming" → "live".
 * Called right at the session's scheduled start time.
 */
const activateSession = (sessionId) => {
  const session = SessionStore.get(sessionId);
  if (!session) return;
  if (session.status !== "upcoming") return;       // already live or cancelled

  SessionStore.update(sessionId, { status: "live" });
  console.log(`[scheduler] 🔴 Session activated  session=${sessionId}`);
};

/**
 * expireSession
 *
 * Flips a live session → "recorded" and deletes the platform meeting + link record.
 * Called after session end time + buffer.
 */
const expireSession = async (sessionId) => {
  const session = SessionStore.get(sessionId);
  if (!session) return;

  // Update status
  SessionStore.update(sessionId, { status: "recorded", joinUrl: null, startUrl: null });

  // Find and delete the live link
  const link = LiveLinkStore.getBySession(sessionId);
  if (!link) return;

  try {
    if (link.platform === "zoom") {
      await deleteZoomMeeting(link.meetingId);
    } else if (link.platform === "meet") {
      const course  = CourseStore.get(link.courseId);
      const teacher = TeacherStore.get(link.teacherId);
      if (teacher?.googleRefreshToken) {
        await deleteGoogleMeetLink({ meetingId: link.meetingId, teacherRefreshToken: teacher.googleRefreshToken });
      }
    }
    LiveLinkStore.softDelete(link.id);
    console.log(`[scheduler] 🗑  Live link deleted  session=${sessionId}  meetingId=${link.meetingId}`);
  } catch (err) {
    console.error(`[scheduler] ⚠️  Failed to delete meeting  session=${sessionId}`, err.message);
  }
};

// ─── § CRON JOBS ──────────────────────────────────────────────────────────────
//
// Job 1 — every minute: find upcoming sessions starting in ≤15 min → createLiveLink
// Job 2 — every minute: find upcoming sessions starting now (±1 min) → activateSession
// Job 3 — every minute: find live sessions past their end time → expireSession
//
// All three run on the same 1-minute tick. In production you might
// run jobs 1+3 every 5 min and job 2 every 30 seconds.

cron.schedule("* * * * *", async () => {
  const now       = Date.now();
  const sessions  = SessionStore.list();
  const io        = global.io;

  for (const session of sessions) {
    if (!session.date || !session.time) continue;

    const startMs    = new Date(buildISO(session.date, session.time)).getTime();
    const durationMs = (session.durationMin || 90) * 60 * 1000;
    const endMs      = startMs + durationMs + 30 * 60 * 1000;   // +30 min buffer
    const diffMins   = Math.round((startMs - now) / 60_000);

    // ── Job 1: create link 15 minutes before start ───────────────────────────
    if (
      session.status === "upcoming" &&
      !LiveLinkStore.getBySession(session.id) &&
      startMs - now <= 15 * 60 * 1000 &&
      startMs - now >  0
    ) {
      try {
        await createLiveLink(session.id);

        // ── WS: notify enrolled students the class is starting soon ──────────
        if (io && session.participants?.length) {
          const payload = {
            sessionId:    session.id,
            title:        session.title,
            subject:      session.subject ?? "science",
            minutesUntil: diffMins,
            scheduleBucket: "starting-soon",
            joinUrl:      LiveLinkStore.getBySession(session.id)?.joinUrl ?? null,
          };
          for (const uid of session.participants) {
            io.to(`user:${uid}`).emit("live_class_starting", payload);
          }
        }
      } catch (err) {
        console.error(`[scheduler] ❌ createLiveLink failed  session=${session.id}`, err.message);
      }
    }

    // ── Job 2: activate session at start time ────────────────────────────────
    if (
      session.status === "upcoming" &&
      startMs <= now &&
      now < startMs + 60 * 1000    // within the first 60 s of start time
    ) {
      activateSession(session.id);

      // ── WS: notify enrolled students the class is now live ───────────────
      if (io && session.participants?.length) {
        const link = LiveLinkStore.getBySession(session.id);
        const payload = {
          sessionId: session.id,
          title:     session.title,
          subject:   session.subject ?? "science",
          joinUrl:   link?.joinUrl ?? null,
          status:    "live",
        };
        for (const uid of session.participants) {
          io.to(`user:${uid}`).emit("live_class_live", payload);
        }
      }
    }

    // ── Job 3: expire session after end time ─────────────────────────────────
    if (session.status === "live" && now >= endMs) {
      await expireSession(session.id);
    }

    // ── Attach scheduleBucket to each session for REST polling fallback ──────
    let bucket = "later";
    if (session.status === "live")             bucket = "live";
    else if (diffMins <= 15 && diffMins > 0)   bucket = "starting-soon";
    else if (diffMins <= 60)                   bucket = "today";
    else {
      const startDate = new Date(startMs);
      const todayEnd  = new Date(); todayEnd.setHours(23, 59, 59, 999);
      const tomorrowEnd = new Date(todayEnd); tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
      const weekEnd   = new Date(todayEnd); weekEnd.setDate(weekEnd.getDate() + 7);
      if (startDate <= todayEnd)    bucket = "today";
      else if (startDate <= tomorrowEnd) bucket = "tomorrow";
      else if (startDate <= weekEnd)     bucket = "week";
    }
    SessionStore.update(session.id, { scheduleBucket: bucket, minutesUntil: diffMins });
  }
});

console.log("[scheduler] ⏰ Cron jobs registered (1-min tick)");

// ─── § MANUAL TRIGGERS ────────────────────────────────────────────────────────
// REST endpoints so admins / teachers can trigger actions on-demand
// without waiting for the cron tick.

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const schedulerHandlers = {

  // GET /api/scheduler/links
  // List all active live links (optionally filter by courseId or teacherId)
  listLinks: wrap(async (req, res) => {
    const links = LiveLinkStore.list(req.query);
    res.json({ success: true, data: links, total: links.length });
  }),

  // GET /api/scheduler/links/:sessionId
  // Get the live link for a specific session
  getLinkBySession: wrap(async (req, res) => {
    const link = LiveLinkStore.getBySession(req.params.sessionId);
    if (!link) return res.status(404).json({ success: false, message: "No active link for this session" });
    res.json({ success: true, data: link });
  }),

  // POST /api/scheduler/links/:sessionId
  // Manually trigger link creation for a session (skips the 15-min window check)
  createLink: wrap(async (req, res) => {
    const link = await createLiveLink(req.params.sessionId);
    res.status(201).json({ success: true, data: link });
  }),

  // POST /api/scheduler/activate/:sessionId
  // Manually flip a session to "live"
  activate: wrap(async (req, res) => {
    activateSession(req.params.sessionId);
    const session = SessionStore.get(req.params.sessionId);
    res.json({ success: true, data: session });
  }),

  // DELETE /api/scheduler/links/:sessionId
  // Manually expire a session and delete its meeting link
  deleteLink: wrap(async (req, res) => {
    await expireSession(req.params.sessionId);
    res.json({ success: true, message: "Session expired and link deleted" });
  }),
};

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

router.get   ("/links",                    schedulerHandlers.listLinks);
router.get   ("/links/:sessionId",         schedulerHandlers.getLinkBySession);
router.post  ("/links/:sessionId",         schedulerHandlers.createLink);
router.post  ("/activate/:sessionId",      schedulerHandlers.activate);
router.delete("/links/:sessionId",         schedulerHandlers.deleteLink);

export default router;

// ─── § UTILITIES ──────────────────────────────────────────────────────────────

/**
 * Build an ISO 8601 datetime string from a session's date + time fields.
 * Handles both "2025-06-19" + "14:00" style and display strings like "Thu 19 Jun".
 * In production your sessions should always store proper ISO dates.
 */
function buildISO(date, time) {
  // Already a full ISO string
  if (date?.includes("T")) return date;

  // "2025-06-19" + "14:00"
  if (date?.match(/^\d{4}-\d{2}-\d{2}$/) && time) {
    return new Date(`${date}T${time}:00.000+01:00`).toISOString(); // WAT (UTC+1)
  }

  // Fallback — return now so the cron doesn't crash on bad data
  console.warn(`[scheduler] ⚠️  Could not parse date="${date}" time="${time}" — using now`);
  return new Date().toISOString();
}

/**
 * ── app.js wiring (for reference) ────────────────────────────────────────────
 *
 * import coursesRouter,   { sessionHandlers } from "./routes/courses.js";
 * import schedulerRouter                      from "./routes/scheduler.js";
 * import "./routes/scheduler.js";   // self-starts the cron jobs on import
 *
 * app.use("/api/courses",   coursesRouter);
 * app.use("/api/sessions",  sessionHandlers.listAll);
 * app.use("/api/scheduler", schedulerRouter);
 *
 * ── Database tables needed (Postgres example) ────────────────────────────────
 *
 * -- Teachers table must store OAuth tokens
 * ALTER TABLE teachers ADD COLUMN IF NOT EXISTS zoom_email          TEXT;
 * ALTER TABLE teachers ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;
 *
 * -- Live links table
 * CREATE TABLE live_class_links (
 *   id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 *   course_id     UUID NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
 *   teacher_id    UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
 *   platform      TEXT NOT NULL CHECK (platform IN ('zoom','meet')),
 *   meeting_id    TEXT NOT NULL,
 *   join_url      TEXT NOT NULL,
 *   start_url     TEXT,
 *   password      TEXT,
 *   topic         TEXT,
 *   scheduled_at  TIMESTAMPTZ NOT NULL,
 *   expires_at    TIMESTAMPTZ NOT NULL,
 *   created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   deleted_at    TIMESTAMPTZ
 * );
 *
 * CREATE INDEX ON live_class_links (session_id);
 * CREATE INDEX ON live_class_links (course_id);
 * CREATE INDEX ON live_class_links (teacher_id);
 * CREATE INDEX ON live_class_links (expires_at) WHERE deleted_at IS NULL;
 */
