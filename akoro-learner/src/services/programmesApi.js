/**
 * programmesApi.js — the published programme catalogue seam.
 *
 * Thin wrappers over the public /api/programmes/catalogue endpoints
 * (akoro-api modules/programmes/routes.js): the programmes the admin
 * console publishes, filtered to published-only at every level —
 * programmes, courses and materials. Public like /api/pharmd/programme;
 * GETs benefit from the api.js offline cache.
 */
import { apiGet } from './api.js';

/* Published programmes: [{ id, name, code, description, duration_label,
   cover_url, source, course_count }] — course_count is published courses. */
export async function fetchProgrammeCatalogue() {
  const d = await apiGet('/api/programmes/catalogue');
  return Array.isArray(d?.data) ? d.data : [];
}

/* One published programme: { id, name, …, published_courses, sections:
   [{ id, name, position, courses:[{ id, code, title, instructor, color,
   cover_url, materials_count }] }] } — courses are published-only. */
export async function fetchProgramme(id) {
  const d = await apiGet(`/api/programmes/catalogue/${encodeURIComponent(id)}`);
  return d?.data ?? null;
}

/* One published course: { id, code, title, …, programme:{id,name},
   section:{id,name}|null, materials:[{ id, title, type, meta, url,
   thumb_url, position }] } — materials are published-only. */
export async function fetchProgrammeCourse(id) {
  const d = await apiGet(`/api/programmes/catalogue/courses/${encodeURIComponent(id)}`);
  return d?.data ?? null;
}
