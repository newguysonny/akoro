/**
 * instructor/service-credentials.js — streaming and social credentials stored
 * in the caller's user_settings (settings.streaming_platforms /
 * settings.social_platforms). Tokens/secrets are never returned to the client.
 */
import { STREAMING_PLATFORMS, SOCIAL_PLATFORMS } from "./rules.js";
import { asyncHandler, ok, err400, err404, err500, now, notify } from "./service-core.js";
import { settingsOf, upsertSettings, upsertSettingsNoRow, updateSettings } from "./store-credentials.js";

// ─── § STREAMING ──────────────────────────────────────────────────────────────

export const getStreaming = asyncHandler(async (req, res) => {
  try {
    const { data: settings } = await settingsOf(req.user.id);

    const stored   = settings?.settings?.streaming_platforms ?? {};
    const platforms = STREAMING_PLATFORMS.map((p) => ({
      platform:     p,
      connected:    !!stored[p]?.connected,
      meeting_url:  stored[p]?.meeting_url  ?? null,
      connected_at: stored[p]?.connected_at ?? null,
    }));

    ok(res, platforms);
  } catch (e) {
    err500(res, e);
  }
});

export const connectStreaming = asyncHandler(async (req, res) => {
  try {
    const { platform, accessToken, meetingUrl, hostEmail, refreshToken } = req.body;

    if (!platform)    return err400(res, "platform is required");
    if (!STREAMING_PLATFORMS.includes(platform))
      return err400(res, `platform must be one of: ${STREAMING_PLATFORMS.join(", ")}`);

    // Get current settings
    const { data: existing } = await settingsOf(req.user.id);

    const currentSettings = existing?.settings ?? {};
    const streamingPlatforms = currentSettings.streaming_platforms ?? {};

    streamingPlatforms[platform] = {
      ...(streamingPlatforms[platform] ?? {}),   // preserve existing creds on re-connect
      connected:     true,
      access_token:  accessToken  ?? streamingPlatforms[platform]?.access_token  ?? null,
      refresh_token: refreshToken ?? streamingPlatforms[platform]?.refresh_token ?? null,
      host_email:    hostEmail    ?? streamingPlatforms[platform]?.host_email    ?? null,
      meeting_url:   meetingUrl   ?? streamingPlatforms[platform]?.meeting_url   ?? null,
      connected_at:  now(),
    };

    const newSettings = { ...currentSettings, streaming_platforms: streamingPlatforms };

    const { error } = await upsertSettings(
      { user_id: req.user.id, settings: newSettings, updated_at: now() },
    );

    if (error) throw new Error(error.message);

    notify(req.user.id, { type: "streaming_connected", title: `${platform} connected`, content: "Streaming platform connected" });
    ok(res, {
      platform,
      connected:   true,
      meeting_url: meetingUrl ?? null,
    });
  } catch (e) {
    err500(res, e);
  }
});

export const disconnectStreaming = asyncHandler(async (req, res) => {
  try {
    const { platform } = req.params;

    if (!STREAMING_PLATFORMS.includes(platform))
      return err400(res, `platform must be one of: ${STREAMING_PLATFORMS.join(", ")}`);

    const { data: existing } = await settingsOf(req.user.id);

    if (!existing) return err404(res, "No settings found");

    const currentSettings    = existing.settings ?? {};
    const streamingPlatforms = currentSettings.streaming_platforms ?? {};

    delete streamingPlatforms[platform];
    const newSettings = { ...currentSettings, streaming_platforms: streamingPlatforms };

    const { error } = await updateSettings(req.user.id, { settings: newSettings, updated_at: now() });

    if (error) throw new Error(error.message);

    notify(req.user.id, { type: "streaming_disconnected", title: `${platform} disconnected`, content: "Streaming platform disconnected" });
    ok(res, { platform, connected: false, message: `${platform} disconnected` });
  } catch (e) {
    err500(res, e);
  }
});

// ─── § SOCIAL PLATFORMS ───────────────────────────────────────────────────────
// Stored credentials for the school's social accounts (used later for posting /
// content auto-generation). Kept in user_settings.settings.social_platforms,
// mirroring streaming_platforms. Tokens/secrets are NEVER returned to the client.

export const getSocial = asyncHandler(async (req, res) => {
  try {
    const { data: settings } = await settingsOf(req.user.id);

    const stored = settings?.settings?.social_platforms ?? {};
    const platforms = SOCIAL_PLATFORMS.map((p) => {
      const s = stored[p] ?? {};
      return {
        platform:        p,
        connected:       !!s.connected,
        profile_url:     s.profile_url ?? null,
        account_id:      s.account_id ?? null,
        has_credentials: !!(s.access_token || s.api_key),
        connected_at:    s.connected_at ?? null,
      };
    });

    ok(res, platforms);
  } catch (e) { err500(res, e); }
});

export const connectSocial = asyncHandler(async (req, res) => {
  try {
    const { platform, profileUrl, accessToken, apiKey, apiSecret, accountId } = req.body;

    if (!platform) return err400(res, "platform is required");
    if (!SOCIAL_PLATFORMS.includes(platform))
      return err400(res, `platform must be one of: ${SOCIAL_PLATFORMS.join(", ")}`);

    const { data: existing } = await settingsOf(req.user.id);

    const currentSettings = existing?.settings ?? {};
    const socialPlatforms = currentSettings.social_platforms ?? {};
    const prev = socialPlatforms[platform] ?? {};

    socialPlatforms[platform] = {
      ...prev,   // preserve existing creds on re-connect (only overwrite provided fields)
      connected:     true,
      profile_url:   profileUrl  ?? prev.profile_url  ?? null,
      access_token:  accessToken ?? prev.access_token ?? null,
      api_key:       apiKey      ?? prev.api_key       ?? null,
      api_secret:    apiSecret   ?? prev.api_secret    ?? null,
      account_id:    accountId   ?? prev.account_id    ?? null,
      connected_at:  now(),
    };

    const newSettings = { ...currentSettings, social_platforms: socialPlatforms };

    const { error } = await upsertSettingsNoRow({ user_id: req.user.id, settings: newSettings, updated_at: now() });
    if (error) throw new Error(error.message);

    notify(req.user.id, { type: "social_connected", title: `${platform} connected`, content: "Social account connected" });
    ok(res, { platform, connected: true, profile_url: profileUrl ?? null });
  } catch (e) { err500(res, e); }
});

export const disconnectSocial = asyncHandler(async (req, res) => {
  try {
    const { platform } = req.params;
    if (!SOCIAL_PLATFORMS.includes(platform))
      return err400(res, `platform must be one of: ${SOCIAL_PLATFORMS.join(", ")}`);

    const { data: existing } = await settingsOf(req.user.id);
    if (!existing) return err404(res, "No settings found");

    const currentSettings = existing.settings ?? {};
    const socialPlatforms = currentSettings.social_platforms ?? {};
    delete socialPlatforms[platform];

    const { error } = await updateSettings(req.user.id, { settings: { ...currentSettings, social_platforms: socialPlatforms }, updated_at: now() });
    if (error) throw new Error(error.message);

    notify(req.user.id, { type: "social_disconnected", title: `${platform} disconnected`, content: "Social account disconnected" });
    ok(res, { platform, connected: false, message: `${platform} disconnected` });
  } catch (e) { err500(res, e); }
});
