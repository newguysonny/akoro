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
 *   REDIS_URL
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

// ─── § IMPORTS ────────────────────────────────────────────────────────────────

import { Router }                    from "express";
import axios                         from "axios";
import { v4 as uuidv4 }              from "uuid";
import Redis                         from "ioredis";
import cron                          from "node-cron";
import db                            from "../../db.js";
import { authenticateToken,
         requireRole }               from "../auth/routes.js";

// ─── § CONFIG ─────────────────────────────────────────────────────────────────

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
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

  // Warm Redis cache
  await redis.set(
    cacheKey(userId, provider),
    JSON.stringify({ access_token, refresh_token, expires_at }),
    "EX", CACHE_TTL
  );

  console.log(`[tokens] ✅ Saved ${provider} tokens for user ${userId}`);
};

/**
 * getTokens
 * Redis first → Supabase fallback.
 * Returns { access_token, refresh_token, expires_at } or throws.
 */
const getTokens = async (userId, provider) => {
  // Fast path — Redis cache
  const cached = await redis.get(cacheKey(userId, provider));
  if (cached) return JSON.parse(cached);

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

  // Warm Redis cache for next request
  await redis.set(cacheKey(userId, provider), JSON.stringify(data), "EX", CACHE_TTL);
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

  try {
    console.log(`[tokens] 🔄 Refreshing ${provider} tokens for user ${userId}`);
    const { tokenUrl, clientId, clientSecret, redirectUri } = providerConfig(provider);

    const response = await axios.post(tokenUrl, null, {
      params: {
        grant_type:    "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
      },
    });

    const { access_token, refresh_token, expires_in } = response.data;
    const newExpiresAt = Date.now() + expires_in * 1000;

    await saveTokens(userId, provider, {
      access_token,
      refresh_token: refresh_token ?? tokens.refresh_token,
      expires_at:    newExpiresAt,
    });

    return access_token;

  } catch (err) {
    const msg = err.response?.data?.error_description ?? err.message;
    console.error(`[tokens] ❌ Refresh failed for ${provider} (user ${userId}):`, msg);

    if (err.response?.data?.error === "invalid_grant") {
      await markTokenInactive(userId, provider, msg);
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
  }
};

// ─── § HANDLERS ───────────────────────────────────────────────────────────────

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const meetingHandlers = {

  // GET /api/meeting/auth/:provider
  // Redirects instructor to the OAuth consent page
  oauthRedirect: (req, res) => {
    const { provider } = req.params;
    const cfg          = providerConfig(provider);
    let authUrl;

    switch (provider) {
      case "zoom":
        authUrl = `https://zoom.us/oauth/authorize?response_type=code&client_id=${cfg.clientId}&redirect_uri=${encodeURIComponent(cfg.redirectUri)}`;
        break;
      case "google":
        authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${cfg.clientId}&redirect_uri=${encodeURIComponent(cfg.redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/calendar.events&access_type=offline&prompt=consent`;
        break;
      case "teams":
        authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${cfg.clientId}&response_type=code&redirect_uri=${encodeURIComponent(cfg.redirectUri)}&scope=offline_access%20Calendars.ReadWrite&prompt=consent`;
        break;
      default:
        return res.status(400).json({ success: false, message: "Invalid provider" });
    }

    res.redirect(authUrl);
  },

  // GET /api/meeting/auth/callback/:provider
  // Exchanges auth code for tokens, saves to Supabase + Redis
  oauthCallback: asyncHandler(async (req, res) => {
    const { provider } = req.params;
    const { code }     = req.query;
    const userId       = req.user?.id;

    if (!userId) return res.status(401).json({ success: false, message: "Not authenticated" });
    if (!code)   return res.status(400).json({ success: false, message: "Missing auth code" });

    const cfg = providerConfig(provider);
    let tokenResponse;

    try {
      if (provider === "zoom") {
        tokenResponse = await axios.post(cfg.tokenUrl, null, {
          params:  { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri },
          auth:    { username: cfg.clientId, password: cfg.clientSecret },
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
        expires_at: Date.now() + expires_in * 1000,
      });

      // In production: redirect to frontend settings page
      res.json({ success: true, message: `${provider} connected successfully` });

    } catch (err) {
      console.error(`[meeting] OAuth callback error for ${provider}:`, err.response?.data ?? err.message);
      res.status(500).json({ success: false, message: `Failed to connect ${provider}` });
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
    const { provider } = req.params;
    const userId       = req.user.id;

    const { error } = await db
      .from("provider_tokens")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider);

    if (error) throw new Error(error.message);

    await redis.del(cacheKey(userId, provider));
    res.json({ success: true, message: `${provider} disconnected` });
  }),

  // GET /api/meeting/status
  // Returns which platforms the instructor has connected
  status: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("provider_tokens")
      .select("provider, is_active, connected_at, last_refreshed_at, refresh_error")
      .eq("user_id", req.user.id);

    if (error) throw new Error(error.message);

    const status = { zoom: null, google: null, teams: null };
    for (const row of (data ?? [])) {
      status[row.provider] = {
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

// OAuth flows — instructor only
router.get   ("/auth/:provider",            authenticateToken, requireRole(["instructor", "admin"]), meetingHandlers.oauthRedirect);
router.get   ("/auth/callback/:provider",   authenticateToken, meetingHandlers.oauthCallback);

// Meeting management
router.post  ("/schedule",                  authenticateToken, requireRole(["instructor", "admin"]), meetingHandlers.schedule);
router.delete("/disconnect/:provider",      authenticateToken, requireRole(["instructor", "admin"]), meetingHandlers.disconnect);
router.get   ("/status",                    authenticateToken, meetingHandlers.status);

export default router;
