/**
 * pharmdApi.js — the PHARM.D programme catalogue seam.
 *
 * Thin wrappers over the /api/pharmd endpoints (akoro-api
 * modules/pharmd/routes.js). The catalogue is public; progress and
 * completion ride the signed-in learner's session like every other
 * authed call. GETs benefit from the api.js offline cache, so the
 * browse view still renders the last-known programme offline.
 */
import { apiGet, apiPost } from './api.js';

/* The programme tree: { programme:{code,name,subtitle}, years:[{ number,
   label, courses:[{ id, code, title, topics }] }] } */
export async function fetchPharmdProgramme() {
  const d = await apiGet('/api/pharmd/programme');
  return d?.data ?? null;
}

/* One course with its topics: { course:{id,code,title}, topics:[{ id,
   position, title, read_minutes, mime, size, file_url }] } */
export async function fetchPharmdCourse(code) {
  const d = await apiGet(`/api/pharmd/courses/${encodeURIComponent(code)}`);
  return d?.data ?? null;
}

/* My completed topic ids — the folder's done-checks. Throws when the
   learner isn't signed in; callers treat progress as optional. */
export async function fetchPharmdProgress() {
  const d = await apiGet('/api/pharmd/progress', { cache: false });
  return d?.data?.done ?? [];
}

/* Mark a topic done/undone. Returns { topic_id, done }. */
export async function completePharmdTopic(topicId, done) {
  const d = await apiPost(`/api/pharmd/topics/${topicId}/complete`, { done });
  return d?.data ?? null;
}
