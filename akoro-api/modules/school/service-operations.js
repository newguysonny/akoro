/**
 * modules/school/service-operations.js — the school's own agent, portal
 * settings, notification toggles, Telegram monitoring, backups and the
 * roles/permissions catalogue.
 *
 * Auth decisions and 400/404/409 semantics live here; queries live in store.js.
 */

import crypto from "crypto";
import { ensureBucket, uploadPublicFile } from "./templateStorage.js";
import * as store from "./store.js";
import {
  AGENT_SELECT, BRANDING_COLUMN, SETTINGS_CATEGORY_COLUMN, DEFAULT_ADMIN_PERMISSIONS,
} from "./rules.js";
import { getMySchool, getPortalSettings, classroomIds } from "./service.js";

// =============================================================
// SCHOOL AGENT — the school's dedicated AI agent (one per school).
// Reuses the user_agents record of the school-admin account, so the whole
// chat / training / tools pipeline works, but it's presented and defaulted
// as the SCHOOL's agent (named after the school).
// =============================================================

// ── GET /api/school/agent ────────────────────────────────────────────────────
export async function getAgent(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;

    let { data: agent } = await store.agentByUser(req.user.id);
    if (!agent) {
      const { data: created, error } = await store.agentInsert({
        user_id:      req.user.id,
        agent_name:   `${school.name} Agent`,
        agent_emoji:  "🏫",
        agent_color:  "#E8884A",
        agent_bg:     "#FEF0E6",
        teacher_agent_id: "nana-sargeant",
        guide_name:   "NaNa Esumai",
        guide_emoji:  "🧠",
        is_active:    true,
      });
      if (error) throw new Error(error.message);
      agent = created;
    }
    res.json({ success: true, data: { agent, school: { id: school.id, name: school.name } } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PATCH /api/school/agent ──────────────────────────────────────────────────
export async function updateAgent(req, res) {
  try {
    const allowed = ["agent_name", "agent_emoji", "agent_color", "agent_bg", "personality"];
    const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(patch).length) return res.status(400).json({ error: "No valid fields (agent_name, agent_emoji, agent_color, agent_bg, personality)" });
    patch.updated_at = new Date();

    const { data, error } = await store.agentUpdate(req.user.id, patch);
    if (error) throw new Error(error.message);
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// =============================================================
// SETTINGS & BILLING — School Profile, System & Formats, Attendance,
// Privacy & Security, Integrations, Personalisation, Notification prefs.
// =============================================================

// ── GET /api/school/settings ─────────────────────────────────────────────────
export async function getSettings(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const settings = await getPortalSettings(school.id);
    res.json({
      success: true,
      data: {
        profile: {
          name: school.name, acronym: school.acronym, email: req.user.email,
          phone: school.phone, principal: school.principal_name, country: school.country,
          state: school.state, lga: school.lga, city: school.city,
          educationLevels: school.education_levels || [], ownershipType: school.ownership_type, curriculum: school.curriculum,
          yearEstablished: school.year_established, genderType: school.gender_type, boardingType: school.boarding_type, studentBand: school.student_band,
          address: school.address, logoUrl: school.logo_url, faviconUrl: school.favicon_url,
          signatureUrl: school.principal_signature_url,
        },
        systemFormats:     settings?.system_formats ?? {},
        attendance:        settings?.attendance ?? {},
        security:          settings?.security ?? {},
        // Mask the biometric API key on load — the full key is only returned
        // once, at generation time (regenerate-key), not on every settings read.
        integrations:      (() => { const i = { ...(settings?.integrations ?? {}) }; if (i.biometricApiKey) i.biometricApiKey = `${String(i.biometricApiKey).slice(0, 10)}…${String(i.biometricApiKey).slice(-4)}`; return i; })(),
        personalisation:   settings?.personalisation ?? {},
        notificationPrefs: settings?.notification_prefs ?? {},
        modules:           settings?.modules ?? {},
        // Which optional modules this school has actually bought. The sidebar
        // needs both: `modules` is the school's own on/off switch, this is
        // entitlement. A module shows only when it is owned AND not switched
        // off, so turning one off never silently loses the purchase.
        moduleAccess:      await ownedModuleKeys(req.user.id),
        backupSchedule:    settings?.backup_schedule ?? { autoBackup: true, frequency: 'daily', retentionDays: 30 },
        content:           settings?.content ?? {},
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/**
 * The optional modules a school owns, as { moduleKey: true }.
 *
 * Optional modules are sold through the same catalog as agent tools
 * (edu.platform_tools, kind='management', key 'module-<moduleKey>'), so
 * ownership is the same instructor_tool_access row a tool purchase writes —
 * there is no second entitlement system to keep in step.
 */
async function ownedModuleKeys(userId) {
  try {
    const { data: rows } = await store.teacherAccessRows(userId);
    const out = {};
    for (const r of rows || []) {
      const key = r.platform_tools?.key || "";
      if (key.startsWith("module-")) out[key.slice(7)] = true;
    }
    return out;
  } catch (e) {
    console.warn("[school] module entitlements failed:", e.message);
    return {};
  }
}

// ── PUT /api/school/settings/profile ─────────────────────────────────────────
export async function updateProfile(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { name, acronym, phone, principal, country, state, lga, city, educationLevels, ownershipType, curriculum,
            yearEstablished, genderType, boardingType, studentBand, address, logoUrl, faviconUrl, signatureUrl } = req.body;
    const patch = {};
    if (name !== undefined)       patch.name = name;
    if (acronym !== undefined)    patch.acronym = acronym;
    if (phone !== undefined)      patch.phone = phone;
    if (principal !== undefined)  patch.principal_name = principal;
    if (country !== undefined)    patch.country = country;
    if (state !== undefined)      patch.state = state;
    if (lga !== undefined)        patch.lga = lga;
    if (city !== undefined)       patch.city = city;
    if (educationLevels !== undefined) patch.education_levels = educationLevels;
    if (ownershipType !== undefined)   patch.ownership_type = ownershipType;
    if (curriculum !== undefined)      patch.curriculum = curriculum;
    if (yearEstablished !== undefined) patch.year_established = yearEstablished === '' ? null : yearEstablished;
    if (genderType !== undefined)      patch.gender_type = genderType;
    if (boardingType !== undefined)    patch.boarding_type = boardingType;
    if (studentBand !== undefined)     patch.student_band = studentBand;
    if (address !== undefined)    patch.address = address;
    if (logoUrl !== undefined)    patch.logo_url = logoUrl;
    if (faviconUrl !== undefined) patch.favicon_url = faviconUrl;
    if (signatureUrl !== undefined) patch.principal_signature_url = signatureUrl;
    const { error } = await store.schoolProfileUpdate(school.id, patch);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/settings/profile/upload ─────────────────────────────────
// Upload a branding image (logo / favicon / principal signature) → storage →
// set the matching school_profiles column. multipart field: "file", body: kind.
export async function uploadBranding(req, res, uploadErr) {
  try {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    const school = await getMySchool(req, res);
    if (!school) return;
    const col = BRANDING_COLUMN[req.body?.kind];
    if (!col) return res.status(400).json({ error: "kind must be logo, favicon or signature" });
    const f = req.file;
    if (!f) return res.status(400).json({ error: "Choose an image" });
    // Raster images only — SVG/HTML would be stored XSS on the public site.
    if (!/^image\/(png|jpe?g|webp|gif|x-icon|vnd\.microsoft\.icon)$/i.test(f.mimetype || "")) return res.status(400).json({ error: "Upload a PNG, JPG, WEBP, GIF or ICO image." });

    await ensureBucket();
    const safe = (f.originalname || "img").replace(/[^a-zA-Z0-9._-]/g, "_");
    const dest = `schools/${school.id}/branding/${req.body.kind}-${Date.now()}-${safe}`;
    const url = await uploadPublicFile(dest, f.buffer, f.mimetype || "application/octet-stream");
    const { error } = await store.schoolProfileUpdate(school.id, { [col]: url, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data: { kind: req.body.kind, url } });
  } catch (e) { console.error("[settings/profile/upload]", e.message); res.status(500).json({ error: "Upload failed. Try again." }); }
}

// ── PUT /api/school/settings/:category ───────────────────────────────────────
// category ∈ system-formats | attendance | security | integrations | personalisation | notification-prefs
export async function updateSettingsCategory(req, res) {
  try {
    const column = SETTINGS_CATEGORY_COLUMN[req.params.category];
    if (!column) return res.status(404).json({ error: "Unknown settings category" });
    const school = await getMySchool(req, res);
    if (!school) return;
    await getPortalSettings(school.id); // ensure row exists
    const { data, error } = await store.portalSettingsSetColumn(school.id, column, req.body || {});
    if (error) throw new Error(error.message);
    res.json({ success: true, data: data[column] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/settings/integrations/regenerate-key ───────────────────
export async function regenerateIntegrationKey(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const settings = await getPortalSettings(school.id);
    const key = `sk_live_${crypto.randomBytes(20).toString("hex")}`;
    const integrations = { ...(settings?.integrations || {}), biometricApiKey: key };
    const { error } = await store.portalSettingsMerge(school.id, { integrations });
    if (error) throw new Error(error.message);
    res.json({ success: true, data: { biometricApiKey: key } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// =============================================================
// NOTIFICATION CENTER — per-alert channel toggles.
// =============================================================

// ── GET /api/school/notifications/alerts ─────────────────────────────────────
export async function getNotificationAlerts(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const settings = await getPortalSettings(school.id);
    res.json({ success: true, data: settings?.notification_alerts ?? {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PUT /api/school/notifications/alerts/:alertId ────────────────────────────
// Body: { push?, email?, sms?, whatsapp? } — merged into the alert's overrides.
export async function updateNotificationAlert(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const settings = await getPortalSettings(school.id);
    const alerts = { ...(settings?.notification_alerts || {}) };
    alerts[req.params.alertId] = { ...(alerts[req.params.alertId] || {}), ...req.body };
    const { error } = await store.portalSettingsMerge(school.id, { notification_alerts: alerts });
    if (error) throw new Error(error.message);
    res.json({ success: true, data: alerts[req.params.alertId] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// =============================================================
// TELEGRAM BOT MONITORING
// =============================================================

// ── GET /api/school/telegram ──────────────────────────────────────────────────
export async function getTelegram(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await store.telegramConfig(school.id);
    res.json({ success: true, data: data
      ? { botToken: data.bot_token ? `${data.bot_token.slice(0, 8)}…` : "", hasToken: !!data.bot_token, chatId: data.chat_id || "", botUsername: data.bot_username, active: data.active }
      : { botToken: "", hasToken: false, chatId: "", botUsername: null, active: false } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/telegram/validate ────────────────────────────────────────
// Body: { botToken }. Calls Telegram's getMe to confirm the token is real.
export async function validateTelegram(req, res) {
  try {
    const { botToken } = req.body;
    if (!botToken) return res.status(400).json({ error: "botToken required" });
    const r = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const json = await r.json();
    if (!json.ok) return res.status(400).json({ success: false, error: json.description || "Invalid bot token" });
    res.json({ success: true, data: { username: json.result.username, name: json.result.first_name } });
  } catch (e) { res.status(502).json({ success: false, error: "Could not reach Telegram. Check the token and try again." }); }
}

// ── PUT /api/school/telegram ───────────────────────────────────────────────────
// Body: { botToken?, chatId?, active? }
export async function saveTelegram(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const patch = { school_id: school.id, updated_at: new Date() };
    if (req.body.chatId !== undefined) patch.chat_id = req.body.chatId;
    if (req.body.active !== undefined) patch.active = !!req.body.active;
    if (req.body.botToken) {
      patch.bot_token = req.body.botToken;
      try {
        const r = await fetch(`https://api.telegram.org/bot${req.body.botToken}/getMe`);
        const json = await r.json();
        if (json.ok) patch.bot_username = json.result.username;
      } catch { /* token saved even if we can't reach Telegram right now */ }
    }
    const { error } = await store.telegramUpsert(patch);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/telegram/test ────────────────────────────────────────────
export async function testTelegram(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await store.telegramTokens(school.id);
    if (!data?.bot_token || !data?.chat_id) return res.status(400).json({ error: "Save a Bot Token and Chat ID first." });
    const r = await fetch(`https://api.telegram.org/bot${data.bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: data.chat_id, text: `✅ Akoro test message — ${school.name} is connected to Telegram monitoring.` }),
    });
    const json = await r.json();
    if (!json.ok) return res.status(400).json({ success: false, error: json.description || "Telegram rejected the message" });
    res.json({ success: true, message: "Test message sent!" });
  } catch (e) { res.status(502).json({ success: false, error: "Could not reach Telegram." }); }
}

// =============================================================
// BACKUP MANAGEMENT — snapshot metadata (label/type/status/size) + schedule.
// The backup_schedule itself is read/written via the generic
// GET/PUT /api/school/settings(/backup) routes above.
// =============================================================

// ── GET /api/school/backups ───────────────────────────────────────────────────
export async function listBackups(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await store.backupsBySchool(school.id);
    res.json({ success: true, data: (data || []).map((b) => ({
      id: b.id, label: b.label, type: b.type, status: b.status,
      sizeBytes: b.size_bytes, recordCount: b.record_count, createdAt: b.created_at,
    })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/backups ──────────────────────────────────────────────────
// Body: { label? }. Snapshots the school's current record counts as a stand-in
// for a real DB export (wire to actual storage/export tooling later).
export async function createBackup(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const cids = await classroomIds(school.id);
    const [{ count: students }, { count: teachers }, { count: classrooms }] = await Promise.all([
      cids.length ? store.classroomStudentCount(cids) : Promise.resolve({ count: 0 }),
      store.teacherCountBySchool(school.id),
      Promise.resolve({ count: cids.length }),
    ]);
    const recordCount = (students || 0) + (teachers || 0) + (classrooms || 0);
    // Rough size estimate — ~2KB/record — until a real export pipeline exists.
    const sizeBytes = Math.max(recordCount, 1) * 2048;

    const { data, error } = await store.backupInsert({
      school_id: school.id,
      label: req.body.label?.trim() || `Manual Backup — ${new Date().toISOString().slice(0, 10)}`,
      type: "manual", status: "completed", size_bytes: sizeBytes, record_count: recordCount,
    });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data: {
      id: data.id, label: data.label, type: data.type, status: data.status,
      sizeBytes: data.size_bytes, recordCount: data.record_count, createdAt: data.created_at,
    } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── DELETE /api/school/backups/:id ────────────────────────────────────────────
export async function deleteBackup(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await store.backupDelete(school.id, req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// =============================================================
// ROLES & PERMISSIONS
// =============================================================

async function ensureAdminRole(schoolId) {
  const { data: existing } = await store.systemRole(schoolId);
  if (existing) return;
  await store.roleInsert({
    school_id: schoolId, name: "Administrator", description: "Full access to every module.",
    is_system: true, permissions: DEFAULT_ADMIN_PERMISSIONS, member_count: 1,
  });
}

// ── GET /api/school/roles ─────────────────────────────────────────────────────
export async function listRoles(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    await ensureAdminRole(school.id);
    const { data } = await store.rolesBySchool(school.id);
    res.json({ success: true, data: (data || []).map((r) => ({
      id: r.id, name: r.name, description: r.description, isSystem: r.is_system,
      permissions: r.permissions || {}, memberCount: r.member_count, updatedAt: r.updated_at,
    })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/roles ────────────────────────────────────────────────────
// Body: { name, description?, permissions? }
export async function createRole(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { name, description = "", permissions = {} } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const { data, error } = await store.roleInsertFull({
      school_id: school.id, name: name.trim(), description, permissions,
    });
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "A role with that name already exists" });
      throw new Error(error.message);
    }
    res.status(201).json({ success: true, data: {
      id: data.id, name: data.name, description: data.description, isSystem: data.is_system,
      permissions: data.permissions || {}, memberCount: data.member_count, updatedAt: data.updated_at,
    } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PUT /api/school/roles/:id ──────────────────────────────────────────────────
// Body: { name?, description?, permissions? }
export async function updateRole(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: existing } = await store.roleById(school.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Role not found" });

    const patch = { updated_at: new Date() };
    if (req.body.description !== undefined) patch.description = req.body.description;
    // The system Administrator role keeps its name and full-access permissions.
    if (!existing.is_system) {
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.permissions !== undefined) patch.permissions = req.body.permissions;
    }
    const { data, error } = await store.roleUpdate(school.id, req.params.id, patch);
    if (error) throw new Error(error.message);
    res.json({ success: true, data: {
      id: data.id, name: data.name, description: data.description, isSystem: data.is_system,
      permissions: data.permissions || {}, memberCount: data.member_count, updatedAt: data.updated_at,
    } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── DELETE /api/school/roles/:id ──────────────────────────────────────────────
export async function deleteRole(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: role } = await store.roleById(school.id, req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (role.is_system) return res.status(400).json({ error: "The Administrator role can't be deleted" });
    const { error } = await store.roleDelete(school.id, req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
