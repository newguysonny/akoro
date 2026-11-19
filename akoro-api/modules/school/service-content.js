/**
 * modules/school/service-content.js — the content hub: AI generation,
 * saved creations, channel publishing and media attachments.
 *
 * Queries live in store-content.js; prompt copy and column lists in rules.js.
 */

import { llmComplete } from "../../lib/aiModel.js";
import { ensureBucket, uploadPublicFile } from "./templateStorage.js";
import * as store from "./store.js";
import * as content from "./store-content.js";
import { CONTENT_GEN_SYSTEM, BLOG_SYSTEM, BLOG_TYPES } from "./rules.js";
import { getMySchool, getPortalSettings } from "./service.js";

// ── POST /api/school/content/generate ────────────────────────────────────────
// Content hub generators: blog posts, social posts and student activities.
// Grounds each in the school's saved content preferences (brand voice, etc.).
export async function generateContent(req, res) {
  try {
    const kind = ["blog", "social", "activity"].includes(req.body?.kind) ? req.body.kind : "blog";
    const topic = String(req.body?.topic || "").trim();
    if (!topic) return res.status(400).json({ error: "Tell me what it's about" });

    const school = await getMySchool(req, res);
    if (!school) return;
    const settings = await getPortalSettings(school.id);
    const prefs = settings?.content ?? {};

    const tone     = String(req.body?.tone || prefs.tone || "warm and professional").trim();
    const platform = String(req.body?.platform || "").trim();
    const audience = String(req.body?.audience || "").trim();
    const extra    = String(req.body?.extra || "").trim();
    const blogType = BLOG_TYPES.includes(req.body?.blogType) ? req.body.blogType : "general";
    const subtype  = kind === "blog" ? blogType : (platform || null);

    const system = kind === "blog" ? BLOG_SYSTEM[blogType] : CONTENT_GEN_SYSTEM[kind];
    const brief = [
      `School: ${school.name || "our school"}.`,
      prefs.voice ? `Brand voice: ${prefs.voice}.` : "",
      `Tone: ${tone}.`,
      platform ? `Target platform: ${platform}.` : "",
      audience ? `Audience: ${audience}.` : "",
      `Topic: ${topic}.`,
      extra ? `Extra instructions: ${extra}.` : "",
      kind === "social" && prefs.hashtags ? `Include these hashtags where natural: ${prefs.hashtags}.` : "",
    ].filter(Boolean).join("\n");

    const contentText = await llmComplete(brief, {
      system,
      maxTokens: kind === "social" ? 700 : 1600,
      temperature: 0.7,
    });

    // Save it so the generator can show a "past creations" row.
    let creation = null;
    const { data: saved } = await content.creationsInsert({
      school_id: school.id, created_by: req.user.id, kind, subtype, topic, content: contentText,
    });
    creation = saved || null;

    res.json({ success: true, data: { kind, subtype, topic, content: contentText, creation } });
  } catch (e) { console.error("[content/generate]", e); res.status(500).json({ error: "Could not generate that. Try again." }); }
}

// GET /api/school/content/creations?kind=blog|social|activity — recent outputs.
export async function listCreations(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const kind = ["blog", "social", "activity"].includes(req.query.kind) ? req.query.kind : null;
    const { data, error } = await content.creationsBySchool(school.id, kind);
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// GET /api/school/content/creations/:id — one creation (for the detail page).
export async function getCreation(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data, error } = await content.creationById(school.id, req.params.id);
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Best-effort publish to a connected channel using the caller's stored social
// credentials and (optionally) an attached media URL.
//  - Facebook: photo post if an image is attached, else a text feed post.
//  - Instagram: real 2-step publish (needs an image + IG business account id).
//  - X: text tweet (media on X needs OAuth1 upload — not attached here).
//  - TikTok: video publish is a multi-step upload flow — recorded for manual finish.
async function publishToChannel(platform, creds, text, media) {
  if (!creds?.connected) return { ok: false, reason: "not_connected" };
  const token = creds.access_token;
  const isImage = media?.url && media.type === "image";
  try {
    if (platform === "facebook") {
      if (!token || !creds.account_id) return { ok: false, reason: "missing_page_token" };
      if (isImage) {
        const r = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(creds.account_id)}/photos`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: media.url, caption: text, access_token: token }),
        });
        const j = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, id: j.post_id || j.id } : { ok: false, reason: j.error?.message || "post_failed" };
      }
      const r = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(creds.account_id)}/feed`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, access_token: token }),
      });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, id: j.id } : { ok: false, reason: j.error?.message || "post_failed" };
    }

    if (platform === "instagram") {
      if (!token || !creds.account_id) return { ok: false, reason: "missing_ig_account" };
      if (!isImage) return { ok: false, reason: "needs_image" };
      // 1) create a media container, 2) publish it.
      const c = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(creds.account_id)}/media`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: media.url, caption: text, access_token: token }),
      });
      const cj = await c.json().catch(() => ({}));
      if (!c.ok || !cj.id) return { ok: false, reason: cj.error?.message || "container_failed" };
      const p = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(creds.account_id)}/media_publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: cj.id, access_token: token }),
      });
      const pj = await p.json().catch(() => ({}));
      return p.ok ? { ok: true, id: pj.id } : { ok: false, reason: pj.error?.message || "publish_failed" };
    }

    if (platform === "twitter") {
      if (!token) return { ok: false, reason: "missing_token" };
      const r = await fetch("https://api.twitter.com/2/tweets", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 280) }),
      });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, id: j.data?.id, note: media?.url ? "media not attached on X" : undefined } : { ok: false, reason: j.detail || j.title || "post_failed" };
    }

    if (platform === "tiktok") {
      if (media?.type !== "video") return { ok: false, reason: "needs_video" };
      return { ok: true, manual: true, note: "TikTok video publish must be finished in the TikTok app" };
    }

    return { ok: false, reason: "unsupported" };
  } catch (e) { return { ok: false, reason: e.message }; }
}

// POST /api/school/content/creations/:id/post  { channels: [...] }
export async function postCreation(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: creation } = await content.creationById(school.id, req.params.id);
    if (!creation) return res.status(404).json({ error: "Not found" });

    const channels = Array.isArray(req.body?.channels) ? req.body.channels.filter((c) => ["facebook", "instagram", "twitter", "tiktok"].includes(c)) : [];
    if (!channels.length) return res.status(400).json({ error: "Pick at least one channel to post to." });

    const { data: us } = await store.userSettings(req.user.id);
    const social = us?.settings?.social_platforms ?? {};

    const media = creation.media_url ? { url: creation.media_url, type: creation.media_type || "image" } : null;
    const results = {};
    const posted = new Set(creation.posted_channels || []);
    for (const ch of channels) {
      const r = await publishToChannel(ch, social[ch], creation.content || "", media);
      results[ch] = r;
      if (r.ok) posted.add(ch);
    }

    const postedArr = [...posted];
    const { data: updated } = await content.creationUpdate(creation.id, {
      posted_channels: postedArr, posted_at: postedArr.length ? new Date().toISOString() : creation.posted_at,
    });

    res.json({ success: true, data: { creation: updated || creation, results } });
  } catch (e) { console.error("[content/post]", e); res.status(500).json({ error: "Could not post. Try again." }); }
}

// POST /api/school/content/creations/:id/media — attach an image/video (used
// when posting, required for Instagram/TikTok). multipart field: "file".
export async function uploadCreationMedia(req, res, uploadErr) {
  try {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: creation } = await content.creationIdById(school.id, req.params.id);
    if (!creation) return res.status(404).json({ error: "Not found" });

    const f = req.file;
    if (!f) return res.status(400).json({ error: "Choose an image or video" });
    const mime = f.mimetype || "";
    // Raster images / video only — reject SVG/HTML (stored-XSS risk).
    const mediaType = /^video\//.test(mime) ? "video" : /^image\/(png|jpe?g|webp|gif)$/i.test(mime) ? "image" : null;
    if (!mediaType) return res.status(400).json({ error: "Upload a PNG/JPG/WEBP/GIF image or a video." });

    await ensureBucket();
    const safe = (f.originalname || "media").replace(/[^a-zA-Z0-9._-]/g, "_");
    const dest = `content/${school.id}/${creation.id}-${Date.now()}-${safe}`;
    const url = await uploadPublicFile(dest, f.buffer, mime || "application/octet-stream");

    const { data, error } = await content.creationUpdate(creation.id, { media_url: url, media_type: mediaType });
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (e) { console.error("[content/media]", e.message); res.status(500).json({ error: "Could not upload media. Try again." }); }
}

// DELETE /api/school/content/creations/:id/media — remove the attachment.
export async function deleteCreationMedia(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data, error } = await content.creationUpdateBySchool(school.id, req.params.id, { media_url: null, media_type: null });
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// DELETE /api/school/content/creations/:id
export async function deleteCreation(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await content.creationDelete(school.id, req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
