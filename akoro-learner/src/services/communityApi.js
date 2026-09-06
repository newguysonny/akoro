/**
 * communityApi.js — learner communities data seam (higher-ed tier).
 *
 * Backed by the communities module (akoro-api/modules/communities,
 * mounted at /api/communities). The Community page lists the learner's
 * joined communities and creates new ones; each community's Activity
 * page reads its feed via the community activities endpoint.
 *
 * Reads degrade to empty (the page renders either way); writes throw the
 * API's user-facing error message so sheets can show it.
 */
import { apiGet, apiPost, apiPatch, apiDelete } from './api.js';

/* My joined communities, most recently joined first. */
export async function fetchMyCommunities() {
  try {
    const d = await apiGet('/api/communities/mine', { cache: false });
    return d?.data ?? [];
  } catch { return []; }
}

/* One community + the caller's membership (my_role null = not a member). */
export async function fetchCommunity(id) {
  try {
    const d = await apiGet(`/api/communities/${id}`, { cache: false });
    return d?.data ?? null;
  } catch { return null; }
}

/* Create — the caller becomes owner. Throws with a user-facing message. */
export async function createCommunity({ name, description, emoji }) {
  const d = await apiPost('/api/communities', { name, description, emoji });
  return d?.data ?? null;
}

/* Join (idempotent). */
export async function joinCommunity(id) {
  const d = await apiPost(`/api/communities/${id}/join`);
  return d?.data ?? null;
}

/* Edit (owner only). */
export async function editCommunity(id, patch) {
  const d = await apiPatch(`/api/communities/${id}`, patch);
  return d?.data ?? null;
}

/* Leave (members only — owners delete instead). */
export async function leaveCommunity(id) {
  const d = await apiPost(`/api/communities/${id}/leave`);
  return d?.data ?? null;
}

/* Delete (owner only). */
export async function deleteCommunity(id) {
  const d = await apiDelete(`/api/communities/${id}`);
  return d?.data ?? null;
}
