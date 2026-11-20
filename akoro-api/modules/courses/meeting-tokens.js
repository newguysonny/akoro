/**
 * meeting-tokens.js  —  provider token lifecycle for meeting integrations
 *
 * Extracted from meeting-integration.js (Phase 19 step 4). Owns the Redis
 * read cache + refresh lock, the Supabase `provider_tokens` store, the
 * provider OAuth config and `ensureValidToken`. Behaviour is unchanged: the
 * same keys, TTLs, double-checked locking, invalid_grant handling and errors.
 */

import { meetingsPost }              from "../../lib/meetingsBreaker.js";
import { v4 as uuidv4 }              from "uuid";
import Redis                         from "ioredis";
import db                            from "../../db.js";
import { traceRedis } from "../../lib/redisTrace.js";
import { redisConnectionOptions } from "../../lib/redisOptions.js";
import { urlFor }                    from "../../lib/urls.js";

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

/** Drop the cached copy of a user's token (disconnect). */
const forgetTokens = (userId, provider) => redis.del(cacheKey(userId, provider));

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
      redirectUri:  process.env.REDIRECT_URI_YOUTUBE  || `${urlFor("API_URL")}/api/meeting/auth/callback/youtube`,
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
 * Exported — imported by meeting-integration.js (createMeeting/endMeeting and
 * the refresh cron), live-sessions.js, peer-sessions.js, meetingService.js
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

    const response = await meetingsPost(tokenUrl, null, {
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

export { saveTokens, providerConfig, forgetTokens };
