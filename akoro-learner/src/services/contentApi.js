/**
 * contentApi.js — public marketing content (Blog + Careers)
 * Backed by /api/content (see akoro-api/modules/content/routes.js).
 */
import { apiGet, apiPost } from './api.js';

const q = (params) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  return s ? `?${s}` : '';
};

// ─── Blog ──────────────────────────────────────────────────────────────────────
export const listPosts     = (opts = {})   => apiGet(`/api/content/blog/posts${q(opts)}`).then(r => r.data);
export const getFeatured   = ()            => apiGet(`/api/content/blog/posts/featured`).then(r => r.data);
export const getCategories = ()            => apiGet(`/api/content/blog/categories`).then(r => r.data);
export const getPost       = (slug)        => apiGet(`/api/content/blog/posts/${slug}`).then(r => r.data);
export const subscribe     = (email, source = 'blog') =>
  apiPost(`/api/content/blog/subscribe`, { email, source }).then(r => r.data);

// ─── Careers ────────────────────────────────────────────────────────────────────
export const listJobs      = (dept)        => apiGet(`/api/content/careers/jobs${q({ dept })}`).then(r => r.data);
export const getJob        = (id)          => apiGet(`/api/content/careers/jobs/${id}`).then(r => r.data);
export const applyToJob    = (id, payload) => apiPost(`/api/content/careers/jobs/${id}/apply`, payload).then(r => r.data);
