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

/* Same read, but THROWS: lets a page distinguish "no connection" from
   "does not exist" and render a real error state instead of a false
   not-found (a degraded network once showed up as "Community not found"). */
export async function fetchCommunityStrict(id) {
  const d = await apiGet(`/api/communities/${id}`, { cache: false });
  return d?.data ?? null;
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

/* ── Community activities ─────────────────────────────────────────────────── */

/* The community's activity feed, newest first (creator name, submission
   counts, my_submitted flag on each row). Degrades to empty — pages that
   render the feed as a bonus (the profile page) prefer this. */
export async function fetchCommunityActivities(communityId) {
  try {
    const d = await apiGet(`/api/communities/${communityId}/activities`, { cache: false });
    return d?.data ?? [];
  } catch { return []; }
}

/* Same read, but THROWS: the activity page's whole purpose is this feed,
   so a feed that never arrives must show a real error state instead of a
   silent "no activities yet" (and before the request deadlines existed,
   a hung feed request is exactly what kept that page loading forever). */
export async function fetchCommunityActivitiesStrict(communityId) {
  const d = await apiGet(`/api/communities/${communityId}/activities`, { cache: false });
  return d?.data ?? [];
}

/* Creator posts an activity: { name, subject, class, dueAt, instructions }.
   Throws with a user-facing message. */
export async function createCommunityActivity(communityId, payload) {
  const d = await apiPost(`/api/communities/${communityId}/activities`, payload);
  return d?.data ?? null;
}

/* Delete an activity (its creator only). */
export async function deleteCommunityActivity(activityId) {
  const d = await apiDelete(`/api/communities/activities/${activityId}`);
  return d?.data ?? null;
}

/* A member submits work (idempotent). Throws with a user-facing message. */
export async function submitCommunityActivity(activityId) {
  const d = await apiPost(`/api/communities/activities/${activityId}/submit`);
  return d?.data ?? null;
}

/* ── Creator tools ────────────────────────────────────────────────────────── */

/* Member list (owner first): { user_id, role, joined_at, name, avatar_url }. */
export async function fetchCommunityMembers(communityId) {
  try {
    const d = await apiGet(`/api/communities/${communityId}/members`, { cache: false });
    return d?.data ?? [];
  } catch { return []; }
}

/* { members, activities, submissions, avg_per_activity, recent[] }. */
export async function fetchCommunityAnalytics(communityId) {
  try {
    const d = await apiGet(`/api/communities/${communityId}/analytics`, { cache: false });
    return d?.data ?? null;
  } catch { return null; }
}

/* ── Community items (shared materials) ───────────────────────────────────── */

/* The community's shared materials — content members added via the
   "Add to community" page, newest first. Degrades to empty: the rail
   simply doesn't render. */
export async function fetchCommunityItems(communityId) {
  try {
    const d = await apiGet(`/api/communities/${communityId}/items`, { cache: false });
    return d?.data ?? [];
  } catch { return []; }
}

/** Add one thing to N communities (the Add-to-community page
 * multi-selects). item = { itemType, itemRef, title, sub, kind, link }.
 * Idempotent per community. Throws with a user-facing message. */
export async function addCommunityItem({ communityIds, itemType, itemRef, title, sub, kind, link }) {
  const d = await apiPost('/api/communities/items', { communityIds, itemType, itemRef, title, sub, kind, link });
  return d?.data ?? null;
}
