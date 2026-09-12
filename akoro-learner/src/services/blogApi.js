/**
 * blogApi.js — learner-authored blog data seam (higherEd library).
 *
 * Blogs live in edu.blogs via /api/blogs. The body is the platform's
 * markdown-subset text — the same subset the chat renders — so the editor
 * writes it, the preview renders it with the shared RichText path, and no
 * HTML exists anywhere in the pipeline.
 */
import { apiGet, apiPost, apiPatch, apiDelete } from './api.js';

export const BLOG_TITLE_MAX = 120;
export const BLOG_BODY_MAX = 50000;

/** My posts, newest edit first — the Library "Blogs" chip feeds on this. */
export function fetchMyBlogs() {
  return apiGet('/api/blogs/mine');
}

/** One post (author: any state; published: readable by anyone signed in). */
export function fetchBlog(id) {
  return apiGet(`/api/blogs/${id}`);
}

/** Create. status 'draft' | 'published'. */
export function createBlog({ title, body, status }) {
  return apiPost('/api/blogs', { title, body, status });
}

/** Edit (author). Same shape as create; status transitions publish/unpublish. */
export function updateBlog(id, { title, body, status }) {
  return apiPatch(`/api/blogs/${id}`, { title, body, status });
}

export function deleteBlog(id) {
  return apiDelete(`/api/blogs/${id}`);
}
