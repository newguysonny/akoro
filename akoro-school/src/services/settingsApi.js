/**
 * settingsApi.js — instructor settings + marketplace publishing.
 *
 * Profile/agent use the instructor module; marketplace publishing uses the
 * adaptive-learning marketplace module (teacherId passed in the body, matching
 * the existing /api/adaptive/marketplace/* contract).
 */

import { apiGet, apiPatch } from './api.js';
import { API } from '../constants.js';

/* ── Profile + agent ─────────────────────────────────────────────── */
export const getProfile  = () => apiGet('/api/instructor/profile');
export const patchProfile = (patch) => apiPatch('/api/instructor/profile', patch);
export const patchNotifications = (prefs) => apiPatch('/api/instructor/profile/notifications', prefs);

export const patchAgent = (agentPatch) => {
  // settings camelCase → API snake_case
  const body = {};
  if (agentPatch.name  != null) body.agent_name  = agentPatch.name;
  if (agentPatch.emoji != null) body.agent_emoji = agentPatch.emoji;
  return apiPatch('/api/school/agent', body);   // the school's dedicated agent
};

/* ── Two-factor authentication ───────────────────────────────────── */
const auth2fa = (path, body) =>
  fetch(`${API}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(async r => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || j.error || `${path} -> ${r.status}`);
    return j.data ?? j;
  });

export const setup2FA   = ()      => auth2fa('/api/auth/2fa/setup');          // → { secret, otpauthUrl }
export const enable2FA  = (code)  => auth2fa('/api/auth/2fa/enable',  { code });
export const disable2FA = (code)  => auth2fa('/api/auth/2fa/disable', { code });

/* ── Marketplace publishing ──────────────────────────────────────── */
// POST /api/adaptive/marketplace/list — publish a trained agent for sale.
export const publishAgentToMarketplace = ({
  teacherId, agentId, title, subject, description,
  priceKobo = 0, teacherName, teacherAvatar, topicsCovered = [],
}) =>
  fetch(`${API}/api/adaptive/marketplace/list`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      teacherId, agentId, title, subject, description,
      priceKobo, currency: 'NGN', teacherName, teacherAvatar, topicsCovered,
    }),
  }).then((r) => r.json());

// DELETE /api/adaptive/marketplace/listings/:id — unpublish (teacherId in body).
export const unpublishListing = (listingId, teacherId) =>
  fetch(`${API}/api/adaptive/marketplace/listings/${listingId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacherId }),
  }).then((r) => r.json());

/* ── Local-only preferences (no server endpoint yet) ─────────────── */
// Notification prefs + marketplace listing id are cached per user so the UI
// stays consistent across reloads until backend persistence exists.
const lsKey = (userId, k) => `akoro_instr_${k}_${userId}`;

export const loadLocalNotif = (userId) => {
  try { return JSON.parse(localStorage.getItem(lsKey(userId, 'notif'))); } catch { return null; }
};
export const saveLocalNotif = (userId, notif) =>
  localStorage.setItem(lsKey(userId, 'notif'), JSON.stringify(notif));

export const loadListingId = (userId) => localStorage.getItem(lsKey(userId, 'listing')) || null;
export const saveListingId = (userId, id) => {
  if (id) localStorage.setItem(lsKey(userId, 'listing'), id);
  else localStorage.removeItem(lsKey(userId, 'listing'));
};
