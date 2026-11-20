/**
 * meeting-integration.js  —  Piabam Meeting Platform OAuth & Scheduling
 *
 * Runs on: Railway (API server)
 *
 * Handles the full OAuth + token lifecycle for Zoom, Google Meet, and Teams.
 * Used directly by live-sessions.js and peer-sessions.js via the exported
 * ensureValidToken() and createMeeting() helpers.
 *
 * Token architecture:
 *   Source of truth  →  Supabase `provider_tokens` table
 *   Fast read cache  →  Redis  (1-hour TTL)
 *   Refresh lock     →  Redis SET NX (15s TTL, prevents stampedes)
 *   Cron refresh     →  Every 6 hours, queries Supabase directly (not Redis)
 *
 * Usage in app.js:
 *   import meetingRouter from "./routes/meeting-integration.js";
 *   app.use("/api/meeting", meetingRouter);
 *
 * ─── Sections ────────────────────────────────────────────────────────────────
 *  § IMPORTS
 *  § CONFIG
 *  § TOKEN STORE         Supabase read/write + Redis cache
 *  § DISTRIBUTED LOCK    Redis SET NX prevents concurrent refreshes
 *  § PROVIDER CONFIG     Zoom, Google, Teams OAuth endpoints
 *  § TOKEN REFRESH       ensureValidToken — exported for other route files
 *  § MEETING HELPERS     createMeeting, endMeeting, getMeetingDetails
 *  § HANDLERS            OAuth redirect, callback, schedule, disconnect, status
 *  § CRON                Proactive token refresh every 6 hours
 *  § ROUTER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Environment variables (.env):
 *   ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, REDIRECT_URI_ZOOM
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI_GOOGLE
 *   TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET, REDIRECT_URI_TEAMS
 *   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, REDIRECT_URI_YOUTUBE
 *   REDIS_URL
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

// ─── § IMPORTS ────────────────────────────────────────────────────────────────

import { Router }                    from "express";
import { meetingsPost, meetingsDelete } from "../../lib/meetingsBreaker.js";
import { v4 as uuidv4 }              from "uuid";
import cron                          from "node-cron";
import jwt                           from "jsonwebtoken";
import db                            from "../../db.js";
import { authenticateToken,
         requireRole }               from "../auth/index.js";
import { ensureValidToken, saveTokens, providerConfig, forgetTokens } from "./meeting-tokens.js";

// ─── § PROVIDER NAMING + OAUTH STATE ──────────────────────────────────────────
// Frontend speaks { zoom, meet, teams, youtube }.
// OAuth/storage use "google" for Google Meet. YouTube uses its own token slot.
const toOAuth = (p) => (p === "meet" ? "google" : p);
const toUi    = (p) => (p === "google" ? "meet" : p);

// No default: with neither set, connecting a meeting/streaming account is off (a
// known key would let anyone forge a state and bind their tokens to another user).
const STATE_SECRET   = process.env.OAUTH_STATE_SECRET || process.env.COOKIE_SECRET || null;
const INSTRUCTOR_URL = urlFor("INSTRUCTOR_FRONTEND_URL", { alias: ["INSTRUCTOR_URL"] });

const signState = (userId, provider) =>
  jwt.sign({ uid: userId, provider, n: uuidv4() }, STATE_SECRET, { expiresIn: "10m" });
const verifyState = (token) => jwt.verify(token, STATE_SECRET);

// ─── § TOKEN LAYER ────────────────────────────────────────────────────────────
// Redis cache + refresh lock, the `provider_tokens` store, provider OAuth
// config and ensureValidToken live in meeting-tokens.js (unchanged keys,
// TTLs, double-checked locking and invalid_grant handling).

// ─── § MEETING HELPERS ────────────────────────────────────────────────────────

/**
 * createMeeting
 * Creates a meeting on the given platform using the instructor's stored token.
 * Returns { meetingId, meetingUrl, joinUrl, password, platform }
 *
 * Exported — used by live-sessions.js and peer-sessions.js
 */
export const createMeeting = async (userId, { topic, startTime, durationMin = 60, timezone = "Africa/Lagos", platform }) => {
  // If platform not specified, use instructor's first connected platform
  if (!platform) {
    const { data } = await db
      .from("provider_tokens")
      .select("provider")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("last_refreshed_at", { ascending: false })
      .limit(1)
      .single();
    if (!data) throw new Error("No meeting platform connected. Please connect Zoom, Google Meet, or Teams.");
    platform = data.provider;
  }

  // Normalise the UI/session value ("meet") to the OAuth/token provider
  // ("google") so token lookup and the switch below both resolve.
  platform = toOAuth(platform);

  const accessToken = await ensureValidToken(userId, platform);
  const endTime     = new Date(new Date(startTime).getTime() + durationMin * 60_000).toISOString();

  switch (platform) {
    case "zoom": {
      const { data } = await meetingsPost(
        "https://api.zoom.us/v2/users/me/meetings",
        {
          topic,
          type:       2,       // scheduled meeting
          start_time: startTime,
          duration:   durationMin,
          timezone,
          settings: {
            join_before_host:  false,
            waiting_room:      true,
            auto_recording:    "cloud",
            mute_upon_entry:   true,
          },
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return {
        platform,
        meetingId:  String(data.id),
        meetingUrl: data.join_url,
        joinUrl:    data.join_url,
        startUrl:   data.start_url,
        password:   data.password ?? null,
      };
    }

    case "google": {
      const { data } = await meetingsPost(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
        {
          summary: topic,
          start:   { dateTime: startTime, timeZone: timezone },
          end:     { dateTime: endTime,   timeZone: timezone },
          conferenceData: {
            createRequest: {
              requestId:             uuidv4(),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const joinUrl = data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
      return {
        platform,
        meetingId:  data.id,
        meetingUrl: joinUrl,
        joinUrl,
        startUrl:   joinUrl,
        password:   null,
      };
    }

    case "teams": {
      const { data } = await meetingsPost(
        "https://graph.microsoft.com/v1.0/me/calendar/events",
        {
          subject:                  topic,
          start:                    { dateTime: startTime, timeZone: timezone },
          end:                      { dateTime: endTime,   timeZone: timezone },
          isOnlineMeeting:          true,
          onlineMeetingProvider:    "teamsForBusiness",
        },
        { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
      );
      const joinUrl = data.onlineMeeting?.joinUrl;
      return {
        platform,
        meetingId:  data.id,
        meetingUrl: joinUrl,
        joinUrl,
        startUrl:   joinUrl,
        password:   null,
      };
    }

    case "youtube": {
      // Create a scheduled live broadcast
      const scheduledStartTime = new Date(startTime).toISOString();
      const { data: broadcast } = await meetingsPost(
        "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails",
        {
          snippet: {
            title:              topic,
            scheduledStartTime,
            description:        `Live class on Akoro: ${topic}`,
          },
          status: {
            privacyStatus:       "unlisted",   // share link directly; not public by default
            selfDeclaredMadeForKids: false,
          },
          contentDetails: {
            enableAutoStart: false,
            enableAutoStop:  true,
            recordFromStart: true,
            enableDvr:       true,
          },
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      // Create a live stream (RTMP ingestion point)
      const { data: stream } = await meetingsPost(
        "https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn,status",
        {
          snippet: { title: `${topic} — stream` },
          cdn: {
            frameRate:     "variable",
            ingestionType: "rtmp",
            resolution:    "variable",
          },
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      // Bind the stream to the broadcast
      await meetingsPost(
        `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=${broadcast.id}&part=id,contentDetails&streamId=${stream.id}`,
        {},
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const rtmpUrl    = stream.cdn?.ingestionInfo?.ingestionAddress;
      const streamKey  = stream.cdn?.ingestionInfo?.streamName;
      const watchUrl   = `https://www.youtube.com/watch?v=${broadcast.id}`;

      return {
        platform,
        meetingId:  broadcast.id,
        streamId:   stream.id,
        meetingUrl: watchUrl,
        joinUrl:    watchUrl,
        startUrl:   `https://studio.youtube.com/video/${broadcast.id}/livestreaming`,
        password:   null,
        rtmpUrl,
        streamKey,
      };
    }

    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
};

/**
 * endMeeting
 * Ends/deletes a meeting on the platform.
 * Exported — used by live-sessions.js
 */
export const endMeeting = async (userId, platform, meetingId) => {
  const accessToken = await ensureValidToken(userId, platform);

  switch (platform) {
    case "zoom":
      await meetingsDelete(`https://api.zoom.us/v2/meetings/${meetingId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      break;

    case "google":
      await meetingsDelete(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${meetingId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      break;

    case "teams":
      await meetingsDelete(
        `https://graph.microsoft.com/v1.0/me/calendar/events/${meetingId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      break;

    case "youtube":
      // Transition broadcast to "complete" — stops the live stream
      await meetingsPost(
        `https://www.googleapis.com/youtube/v3/liveBroadcasts/transition?broadcastStatus=complete&id=${meetingId}&part=status`,
        {},
        { headers: { Authorization: `Bearer ${accessToken}` } }
      ).catch(() => {
        // Broadcast may already be complete or never started; ignore the error
      });
      break;
  }
};

// ─── § HANDLERS ───────────────────────────────────────────────────────────────

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const meetingHandlers = {

  // GET /api/meeting/auth/:provider
  // Redirects instructor to the OAuth consent page
  oauthRedirect: (req, res) => {
    const provider = toOAuth(req.params.provider);
    let cfg;
    try { cfg = providerConfig(provider); }
    catch { return res.status(400).json({ success: false, message: "Invalid provider" }); }

    // CSRF + identity binding: the callback authenticates from this signed state,
    // not the session cookie (which may not survive the provider round-trip).
    if (!STATE_SECRET) return res.status(503).json({ success: false, message: "Account connection is not configured — set OAUTH_STATE_SECRET" });
    const state = encodeURIComponent(signState(req.user.id, provider));
    const redir = encodeURIComponent(cfg.redirectUri);
    let authUrl;

    switch (provider) {
      case "zoom":
        authUrl = `https://zoom.us/oauth/authorize?response_type=code&client_id=${cfg.clientId}&redirect_uri=${redir}&state=${state}`;
        break;
      case "google":
        authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${cfg.clientId}&redirect_uri=${redir}&response_type=code&scope=${encodeURIComponent("https://www.googleapis.com/auth/calendar.events")}&access_type=offline&prompt=consent&state=${state}`;
        break;
      case "teams":
        authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${cfg.clientId}&response_type=code&redirect_uri=${redir}&scope=${encodeURIComponent("offline_access Calendars.ReadWrite OnlineMeetings.ReadWrite")}&prompt=consent&state=${state}`;
        break;
      case "youtube": {
        const youtubeScopes = [
          "https://www.googleapis.com/auth/youtube",
          "https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.readonly",
        ].join(" ");
        authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${cfg.clientId}&redirect_uri=${redir}&response_type=code&scope=${encodeURIComponent(youtubeScopes)}&access_type=offline&prompt=consent&state=${state}`;
        break;
      }
      default:
        return res.status(400).json({ success: false, message: "Invalid provider" });
    }

    res.redirect(authUrl);
  },

  // GET /api/meeting/auth/callback/:provider
  // Exchanges auth code for tokens, saves to Supabase + Redis
  oauthCallback: asyncHandler(async (req, res) => {
    const provider          = toOAuth(req.params.provider);
    const { code, state }   = req.query;
    const settingsUrl       = `${INSTRUCTOR_URL}/`;
    const fail = (reason) => res.redirect(`${settingsUrl}?streaming_error=${encodeURIComponent(reason)}`);

    if (!code)  return fail("missing_code");
    if (!state) return fail("missing_state");

    // Authenticate via the signed state (CSRF-safe; no session cookie needed).
    let userId;
    try {
      const claims = verifyState(decodeURIComponent(state));
      if (claims.provider !== provider) return fail("provider_mismatch");
      userId = claims.uid;
    } catch {
      return fail("invalid_state");
    }

    let cfg;
    try { cfg = providerConfig(provider); }
    catch { return fail("invalid_provider"); }

    try {
      let tokenResponse;
      if (provider === "zoom") {
        tokenResponse = await meetingsPost(cfg.tokenUrl, null, {
          params: { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri },
          auth:   { username: cfg.clientId, password: cfg.clientSecret },
        });
      } else {
        tokenResponse = await meetingsPost(cfg.tokenUrl, new URLSearchParams({
          grant_type:    "authorization_code",
          code,
          redirect_uri:  cfg.redirectUri,
          client_id:     cfg.clientId,
          client_secret: cfg.clientSecret,
        }));
      }

      const { access_token, refresh_token, expires_in } = tokenResponse.data;
      await saveTokens(userId, provider, {
        access_token,
        refresh_token,
        expires_at: Date.now() + (expires_in ?? 3600) * 1000,
      });

      res.redirect(`${settingsUrl}?connected=${toUi(provider)}`);
    } catch (err) {
      const googleError = err.response?.data;
      console.error(`[meeting] OAuth callback error for ${provider}:`, googleError ?? err.message);
      const reason = googleError?.error ?? "token_exchange_failed";
      const desc   = googleError?.error_description ?? err.message ?? "";
      console.error(`[meeting] Google error: ${reason} — ${desc}`);
      fail(`token_exchange_failed:${reason}`);
    }
  }),

  // POST /api/meeting/schedule
  // Manually schedule a meeting (used for one-off meeting creation)
  schedule: asyncHandler(async (req, res) => {
    const { provider, topic, start_time, duration_min = 60, timezone = "Africa/Lagos" } = req.body;

    if (!topic || !start_time) {
      return res.status(400).json({ success: false, message: "topic and start_time are required" });
    }

    const meeting = await createMeeting(req.user.id, { topic, startTime: start_time, durationMin: duration_min, timezone, platform: provider });
    res.status(201).json({ success: true, data: meeting });
  }),

  // DELETE /api/meeting/disconnect/:provider
  // Removes tokens from Supabase + Redis cache
  disconnect: asyncHandler(async (req, res) => {
    const provider = toOAuth(req.params.provider);
    const userId   = req.user.id;

    const { error } = await db
      .from("provider_tokens")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider);

    if (error) throw new Error(error.message);

    await forgetTokens(userId, provider);
    res.json({ success: true, message: `${toUi(provider)} disconnected` });
  }),

  // GET /api/meeting/status
  // Returns which platforms the instructor has connected
  status: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("provider_tokens")
      .select("provider, is_active, connected_at, last_refreshed_at, refresh_error")
      .eq("user_id", req.user.id);

    if (error) throw new Error(error.message);

    const status = { zoom: null, meet: null, teams: null, youtube: null };
    for (const row of (data ?? [])) {
      status[toUi(row.provider)] = {
        connected:         row.is_active,
        connected_at:      row.connected_at,
        last_refreshed_at: row.last_refreshed_at,
        error:             row.is_active ? null : row.refresh_error,
      };
    }

    res.json({ success: true, data: status });
  }),
};

// ─── § CRON ───────────────────────────────────────────────────────────────────
// Proactively refreshes tokens expiring within 30 minutes.
// Queries Supabase directly (not Redis) so no token is missed due to cache eviction.

// Behind the shared jobs gate like every recurring job — a 6-hourly token
// refresh is not something to run with the rest deliberately stood down.
import { skipJob } from "../../lib/jobsGate.js";
import { urlFor } from "../../lib/urls.js";
if (skipJob("provider token refresh")) {
  console.log("[cron] provider-token refresh NOT registered (jobs gate)");
} else cron.schedule("0 */6 * * *", async () => {
  console.log("[cron] 🔄 Checking for expiring provider tokens...");

  const thirtyMinFromNow = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const { data: expiring, error } = await db
    .from("provider_tokens")
    .select("user_id, provider")
    .eq("is_active", true)
    .lt("expires_at", thirtyMinFromNow);

  if (error) {
    console.error("[cron] ❌ Failed to query provider_tokens:", error.message);
    return;
  }

  console.log(`[cron] Found ${expiring?.length ?? 0} token(s) expiring within 30 minutes`);

  await Promise.allSettled(
    (expiring ?? []).map(async ({ user_id, provider }) => {
      try {
        await ensureValidToken(user_id, provider);
        console.log(`[cron] ✅ Refreshed ${provider} for user ${user_id}`);
      } catch (err) {
        console.error(`[cron] ❌ Failed to refresh ${provider} for user ${user_id}:`, err.message);
      }
    })
  );
});

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

// OAuth flows — instructors AND schools (both connect streaming platforms).
const MEETING_ROLES = ["instructor", "admin", "school", "school_admin", "teacher"];
router.get   ("/auth/:provider",            authenticateToken, requireRole(MEETING_ROLES), meetingHandlers.oauthRedirect);
// No authenticateToken: the provider's redirect won't carry our session cookie.
// Identity comes from the signed `state` param verified inside the handler.
router.get   ("/auth/callback/:provider",   meetingHandlers.oauthCallback);

// Meeting management
router.post  ("/schedule",                  authenticateToken, requireRole(MEETING_ROLES), meetingHandlers.schedule);
router.delete("/disconnect/:provider",      authenticateToken, requireRole(MEETING_ROLES), meetingHandlers.disconnect);
router.get   ("/status",                    authenticateToken, meetingHandlers.status);

// Token helper re-exported for callers that imported it from this router
// (services/meetingService.js); implementation lives in meeting-tokens.js.
export { ensureValidToken };
export default router;
