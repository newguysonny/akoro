/**
 * socialOAuth.js — OAuth connect flow for the Content hub's social channels
 * (Meta / Facebook + Instagram, X/Twitter, TikTok). Mirrors the meeting OAuth
 * pattern: a signed-state redirect to the provider, a stateless callback that
 * exchanges the code for a token, and token storage in
 * user_settings.settings.social_platforms (the same place the manual
 * credential flow writes — so the UI shows one unified "connected" status).
 *
 * Each provider is ENV-GATED: if its client id/secret aren't configured the
 * connect button returns a friendly error and the manual option remains.
 *
 * Mounted under /api/school (routes are /social/auth/:provider …).
 */
import { Router } from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import { randomUUID, randomBytes, createHash } from "crypto";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { urlFor } from "../../lib/urls.js";

const router = Router();
const SCHOOL_ROLES = ["instructor", "teacher", "admin"];
const SCHOOL_PORTAL_URL = urlFor("SCHOOL_FRONTEND_URL");
const API_BASE = (process.env.API_URL || "").replace(/\/$/, "");
// No default: with neither set, connecting a social account is off (a known key
// would let anyone forge a state). The callback's jwt.verify then fails → invalid_state.
const STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.COOKIE_SECRET || null;

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// provider → config. redirectUri defaults to the API's own callback.
const callbackUri = (provider) =>
  process.env[`REDIRECT_URI_${provider.toUpperCase()}`] || `${API_BASE}/api/school/social/auth/callback/${provider}`;

const PROVIDERS = {
  facebook: {
    clientId:     () => process.env.FACEBOOK_APP_ID || process.env.META_APP_ID,
    clientSecret: () => process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET,
    authUrl:      "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl:     "https://graph.facebook.com/v19.0/oauth/access_token",
    scope:        "pages_manage_posts,pages_read_engagement,public_profile",
  },
  instagram: {
    // Instagram publishing is done via a linked FB Page / Business account.
    clientId:     () => process.env.FACEBOOK_APP_ID || process.env.META_APP_ID,
    clientSecret: () => process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET,
    authUrl:      "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl:     "https://graph.facebook.com/v19.0/oauth/access_token",
    scope:        "instagram_basic,instagram_content_publish,pages_show_list",
  },
  twitter: {
    clientId:     () => process.env.TWITTER_CLIENT_ID || process.env.X_CLIENT_ID,
    clientSecret: () => process.env.TWITTER_CLIENT_SECRET || process.env.X_CLIENT_SECRET,
    authUrl:      "https://twitter.com/i/oauth2/authorize",
    tokenUrl:     "https://api.twitter.com/2/oauth2/token",
    scope:        "tweet.read tweet.write users.read offline.access",
    pkce:         true,
  },
  tiktok: {
    clientId:     () => process.env.TIKTOK_CLIENT_KEY,
    clientSecret: () => process.env.TIKTOK_CLIENT_SECRET,
    authUrl:      "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl:     "https://open.tiktokapis.com/v2/oauth/token/",
    scope:        "user.info.basic,video.publish",
    clientIdParam: "client_key",   // TikTok uses client_key, not client_id
  },
};

const backTo = (provider, q) => `${SCHOOL_PORTAL_URL}/content/channel/${provider}?${q}`;

// GET /social/auth/:provider — redirect to the provider consent screen.
router.get("/social/auth/:provider", authenticateToken, requireRole(SCHOOL_ROLES), (req, res) => {
  try {
    const provider = req.params.provider;
    const cfg = PROVIDERS[provider];
    if (!cfg) return res.redirect(backTo(provider, "social_error=unknown_provider"));
    const clientId = cfg.clientId();
    if (!clientId || !cfg.clientSecret() || !STATE_SECRET) return res.redirect(backTo(provider, "social_error=not_configured"));

    // PKCE (X) — carry the verifier inside the signed state.
    let codeVerifier = null, codeChallenge = null;
    if (cfg.pkce) {
      codeVerifier = b64url(randomBytes(32));
      codeChallenge = b64url(createHash("sha256").update(codeVerifier).digest());
    }
    const state = jwt.sign({ uid: req.user.id, provider, v: codeVerifier, n: randomUUID() }, STATE_SECRET, { expiresIn: "10m" });

    const params = new URLSearchParams({
      [cfg.clientIdParam || "client_id"]: clientId,
      redirect_uri: callbackUri(provider),
      response_type: "code",
      scope: cfg.scope,
      state,
    });
    if (cfg.pkce) { params.set("code_challenge", codeChallenge); params.set("code_challenge_method", "S256"); }

    res.redirect(`${cfg.authUrl}?${params.toString()}`);
  } catch (e) {
    console.error("[social oauth redirect]", e);
    res.redirect(backTo(req.params.provider, "social_error=redirect_failed"));
  }
});

// GET /social/auth/callback/:provider — exchange code, store token. No auth
// middleware: the user is recovered from the signed state.
router.get("/social/auth/callback/:provider", async (req, res) => {
  const provider = req.params.provider;
  try {
    const cfg = PROVIDERS[provider];
    const { code, state, error } = req.query;
    if (error) return res.redirect(backTo(provider, `social_error=${encodeURIComponent(String(error))}`));
    if (!cfg || !code || !state) return res.redirect(backTo(provider, "social_error=missing_code"));

    let claims;
    try { claims = jwt.verify(String(state), STATE_SECRET); } catch { return res.redirect(backTo(provider, "social_error=invalid_state")); }
    if (claims.provider !== provider) return res.redirect(backTo(provider, "social_error=provider_mismatch"));

    // Exchange authorization code for an access token.
    const body = new URLSearchParams({
      [cfg.clientIdParam || "client_id"]: cfg.clientId(),
      client_secret: cfg.clientSecret(),
      code: String(code),
      grant_type: "authorization_code",
      redirect_uri: callbackUri(provider),
    });
    if (cfg.pkce && claims.v) body.set("code_verifier", claims.v);

    const tokenRes = await axios.post(cfg.tokenUrl, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const t = tokenRes.data || {};
    const accessToken = t.access_token || t.data?.access_token;
    if (!accessToken) return res.redirect(backTo(provider, "social_error=no_token"));

    // Persist alongside the manual creds so the UI shows one status.
    const { data: existing } = await db.from("user_settings").select("settings").eq("user_id", claims.uid).maybeSingle();
    const settings = existing?.settings ?? {};
    const social = settings.social_platforms ?? {};
    social[provider] = {
      ...(social[provider] ?? {}),
      connected: true,
      via: "oauth",
      access_token: accessToken,
      refresh_token: t.refresh_token ?? social[provider]?.refresh_token ?? null,
      account_id: t.open_id ?? t.data?.open_id ?? social[provider]?.account_id ?? null,
      connected_at: new Date().toISOString(),
    };
    await db.from("user_settings").upsert(
      { user_id: claims.uid, settings: { ...settings, social_platforms: social }, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );

    res.redirect(backTo(provider, "connected=1"));
  } catch (e) {
    console.error("[social oauth callback]", e?.response?.data || e.message);
    res.redirect(backTo(provider, "social_error=token_exchange_failed"));
  }
});

export default router;
