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
import axios                         from "axios";
import { v4 as uuidv4 }              from "uuid";
import Redis                         from "ioredis";
import cron                          from "node-cron";
import jwt                           from "jsonwebtoken";
import db                            from "../../db.js";
import { traceRedis } from "../../lib/redisTrace.js";
import { redisConnectionOptions } from "../../lib/redisOptions.js";
import { authenticateToken,
         requireRole }               from "../auth/routes.js";

// ─── § PROVIDER NAMING + OAUTH STATE ──────────────────────────────────────────
// Frontend speaks { zoom, meet, teams, youtube }.
// OAuth/storage use "google" for Google Meet. YouTube uses its own token slot.
const toOAuth = (p) => (p === "meet" ? "google" : p);
const toUi    = (p) => (p === "google" ? "meet" : p);

const STATE_SECRET   = process.env.OAUTH_STATE_SECRET || process.env.COOKIE_SECRET || "akoro-oauth-state";
const INSTRUCTOR_URL = process.env.INSTRUCTOR_URL || "https://instructor.akoro.app";

const signState = (userId, provider) =>
  jwt.sign({ uid: userId, provider, n: uuidv4() }, STATE_SECRET, { expiresIn: "10m" });
const verifyState = (token) => jwt.verify(token, STATE_SECRET);

// ─── § CONFIG ─────────────────────────────────────────────────────────────────

const redis = traceRedis(new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label: "meetings" })), "meetings");
redis.on("error", (err) => console.error("[Redis] Connection error:", err.message));

const CACHE_TTL   = 60 * 60;           // 1 hour in seconds
const LOCK_TTL_MS = 15_000;            // 15 seconds

const cacheKey = (userId, provider) => `tokens:${userId}:${provider}`;
const lockKey  = (userId, provider) => `lock:token_refresh:${userId}:${provider}`;

// ─── § TOKEN STORE ────────────────────────────────────────────────────────────

/**
 * saveTokens
 * Writes tokens to Supabase (source of truth) and warms Redis cache.
 */
const saveTokens = async (userId, provider, { access_token, refresh_token, expires_at }) => {
  const { error } = await db
    .from("provider_tokens")
    .upsert({
      user_id:           userId,
      provider,
      access_token,
      refresh_token,
      expires_at:        new Date(expires_at).toISOString(),
      last_refreshed_at: new Date().toISOString(),
      refresh_error:     null,
      is_active:         true,
    }, { onConflict: "user_id,provider" });

  if (error) throw new Error(`saveTokens DB error: ${error.message}`);

  // Warm Redis cache — best-effort. Redis being down/over-quota must never
  // break the OAuth flow, since the DB (source of truth) already has the token.
  try {
    await redis.set(
      cacheKey(userId, provider),
      JSON.stringify({ access_token, refresh_token, expires_at }),
      "EX", CACHE_TTL
    );
  } catch (e) {
    console.warn(`[tokens] ⚠️  Redis cache warm failed for ${provider} (non-fatal): ${e.message}`);
  }

  console.log(`[tokens] ✅ Saved ${provider} tokens for user ${userId}`);
};

/**
 * getTokens
 * Redis first → Supabase fallback.
 * Returns { access_token, refresh_token, expires_at } or throws.
 */
const getTokens = async (userId, provider) => {
  // Fast path — Redis cache (best-effort; ignore Redis failures and fall to DB)
  try {
    const cached = await redis.get(cacheKey(userId, provider));
    if (cached) return JSON.parse(cached);
  } catch (e) {
    console.warn(`[tokens] ⚠️  Redis read failed for ${provider} (falling back to DB): ${e.message}`);
  }

  // Cache miss — read from Supabase
  const { data, error } = await db
    .from("provider_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    throw new Error(
      `No active ${provider} connection found. Please reconnect via /api/meeting/auth/${provider}`
    );
  }

  // Warm Redis cache for next request — best-effort
  try {
    await redis.set(cacheKey(userId, provider), JSON.stringify(data), "EX", CACHE_TTL);
  } catch (e) {
    console.warn(`[tokens] ⚠️  Redis cache warm failed for ${provider} (non-fatal): ${e.message}`);
  }
  return data;
};

/**
 * markTokenInactive
 * Called when a refresh token is permanently invalid (invalid_grant error).
 */
const markTokenInactive = async (userId, provider, errorMessage) => {
  await db
    .from("provider_tokens")
    .update({ is_active: false, refresh_error: errorMessage })
    .eq("user_id", userId)
    .eq("provider", provider);

  await redis.del(cacheKey(userId, provider));
  console.warn(`[tokens] ⚠️  Marked ${provider} inactive for user ${userId}: ${errorMessage}`);
};

// ─── § DISTRIBUTED LOCK ───────────────────────────────────────────────────────

const acquireLock = async (userId, provider) => {
  const lockValue = uuidv4();
  const result    = await redis.set(lockKey(userId, provider), lockValue, "NX", "PX", LOCK_TTL_MS);
  return result === "OK" ? lockValue : null;
};

const releaseLock = async (userId, provider, lockValue) => {
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(script, 1, lockKey(userId, provider), lockValue);
};

// ─── § PROVIDER CONFIG ────────────────────────────────────────────────────────

const providerConfig = (provider) => {
  const configs = {
    zoom: {
      tokenUrl:     "https://zoom.us/oauth/token",
      clientId:     process.env.ZOOM_CLIENT_ID,
      clientSecret: process.env.ZOOM_CLIENT_SECRET,
      redirectUri:  process.env.REDIRECT_URI_ZOOM,
    },
    google: {
      tokenUrl:     "https://oauth2.googleapis.com/token",
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri:  process.env.REDIRECT_URI_GOOGLE,
    },
    teams: {
      tokenUrl:     "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      clientId:     process.env.TEAMS_CLIENT_ID,
      clientSecret: process.env.TEAMS_CLIENT_SECRET,
      redirectUri:  process.env.REDIRECT_URI_TEAMS,
    },
    youtube: {
      tokenUrl:     "https://oauth2.googleapis.com/token",
      clientId:     process.env.YOUTUBE_CLIENT_ID     || process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
      redirectUri:  process.env.REDIRECT_URI_YOUTUBE  || `${process.env.API_URL || "https://api.akoro.app"}/api/meeting/auth/callback/youtube`,
    },
  };
  const cfg = configs[provider];
  if (!cfg) throw new Error(`Unknown provider: ${provider}`);
  return cfg;
};

// ─── § TOKEN REFRESH ──────────────────────────────────────────────────────────

/**
 * ensureValidToken
 * Returns a valid access token for the given user + provider.
 * Refreshes automatically if within 5 minutes of expiry.
 * Uses a distributed Redis lock to prevent concurrent refreshes.
 *
 * Exported — imported by live-sessions.js, peer-sessions.js, meetingService.js
 */
export const ensureValidToken = async (userId, provider) => {
  const tokens = await getTokens(userId, provider);
  const now    = Date.now();
  const expiry = new Date(tokens.expires_at).getTime();

  // Token is still valid with > 5 min to spare
  if (expiry > now + 5 * 60 * 1000) return tokens.access_token;

  // Token needs refresh — acquire lock
  const lockValue = await acquireLock(userId, provider);

  if (!lockValue) {
    // Another instance is already refreshing — wait for it
    console.log(`[tokens] ⏳ Waiting for ${provider} refresh lock (user ${userId})...`);
    await new Promise((r) => setTimeout(r, LOCK_TTL_MS + 500));
    const refreshed = await getTokens(userId, provider);
    if (new Date(refreshed.expires_at).getTime() > Date.now() + 5 * 60 * 1000) {
      return refreshed.access_token;
    }
    throw new Error(`${provider} token still expired after waiting for refresh lock.`);
  }

  // Track the refresh token we actually used, so a failure only disconnects the
  // integration when that token is still the current one (see catch).
  let usedRefreshToken = tokens.refresh_token;
  try {
    // Double-checked locking: another instance may have refreshed while we were
    // acquiring the lock. Re-read and bail out if the token is now valid — this
    // avoids a second refresh that would consume an already-rotated token.
    const fresh = await getTokens(userId, provider);
    if (new Date(fresh.expires_at).getTime() > Date.now() + 5 * 60 * 1000) {
      return fresh.access_token;
    }
    usedRefreshToken = fresh.refresh_token || tokens.refresh_token;

    console.log(`[tokens] 🔄 Refreshing ${provider} tokens for user ${userId}`);
    const { tokenUrl, clientId, clientSecret, redirectUri } = providerConfig(provider);

    const response = await axios.post(tokenUrl, null, {
      timeout: 10000,   // must complete within LOCK_TTL_MS so the lock can't expire mid-refresh
      params: {
        grant_type:    "refresh_token",
        refresh_token: usedRefreshToken,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
      },
    });

    const { access_token, refresh_token, expires_in } = response.data;
    const newExpiresAt = Date.now() + expires_in * 1000;

    await saveTokens(userId, provider, {
      access_token,
      refresh_token: refresh_token ?? usedRefreshToken,
      expires_at:    newExpiresAt,
    });

    return access_token;

  } catch (err) {
    const msg = err.response?.data?.error_description ?? err.message;
    console.error(`[tokens] ❌ Refresh failed for ${provider} (user ${userId}):`, msg);

    if (err.response?.data?.error === "invalid_grant") {
      // Only disconnect if the stored refresh token is still the one that
      // failed — otherwise another instance already rotated it successfully.
      const current = await getTokens(userId, provider).catch(() => null);
      if (!current || current.refresh_token === usedRefreshToken) {
        await markTokenInactive(userId, provider, msg);
      }
    }
    throw new Error(`Unable to refresh ${provider} token. Please reconnect via /api/meeting/auth/${provider}`);

  } finally {
    await releaseLock(userId, provider, lockValue);
  }
};

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
      const { data } = await axios.post(
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
      const { data } = await axios.post(
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
      const { data } = await axios.post(
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
      const { data: broadcast } = await axios.post(
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
      const { data: stream } = await axios.post(
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
      await axios.post(
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
      await axios.delete(`https://api.zoom.us/v2/meetings/${meetingId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      break;

    case "google":
      await axios.delete(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${meetingId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      break;

    case "teams":
      await axios.delete(
        `https://graph.microsoft.com/v1.0/me/calendar/events/${meetingId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      break;

    case "youtube":
      // Transition broadcast to "complete" — stops the live stream
      await axios.post(
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
        tokenResponse = await axios.post(cfg.tokenUrl, null, {
          params: { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri },
          auth:   { username: cfg.clientId, password: cfg.clientSecret },
        });
      } else {
        tokenResponse = await axios.post(cfg.tokenUrl, new URLSearchParams({
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

    await redis.del(cacheKey(userId, provider));
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

cron.schedule("0 */6 * * *", async () => {
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

export default router;
