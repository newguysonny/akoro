/**
 * libraryApi.js — learner library data seam.
 *
 * The Library page (features/library/LibraryPage.jsx) shows what the learner owns,
 * filterable by kind. Each kind is a small fetch + normalizer that returns
 * unified rows:
 *
 *   { id, kind, title, subtitle, details, status, progress, meta..., source }
 *
 * status: 'assigned' | 'started' | 'complete' — mirrors the Activity page
 * so the same status pill reads the same in both places.
 *
 * Today courses (active enrollments) and teaching guides have endpoints.
 * Folders and collections return [] until their endpoints land — the pill
 * renders either way, and the cards appear the day the data exists without
 * any page changes.
 */
import { apiGet } from './api.js';
import { fetchMyBlogs } from './blogApi.js';

/* Courses — my active enrollments, joined with their course record. */
async function fetchCourses() {
  try {
    const d = await apiGet('/api/user/enrollments');
    return (d?.data ?? [])
      .filter(e => e.courses)
      .map(e => {
        const c = e.courses;
        const pct = Math.max(0, Math.min(100, e.progress || 0));
        return {
          id:         e.id || c.id,
          kind:       'course',
          title:      c.title || 'Course',
          subtitle:   [c.users?.full_name, c.total_hours ? `${c.total_hours}h` : null].filter(Boolean).join(' · '),
          details:    null,
          status:     pct === 100 ? 'complete' : pct > 0 ? 'started' : 'assigned',
          progress:   pct,
          courseType: c.course_type || 'video',
          cover:      c.cover_image_url || null,
          slug:       c.slug || null,
          source:     'enrollments',
        };
      });
  } catch { return []; }
}

/* Teaching guides — the platform guides attached to my learning. */
async function fetchGuides() {
  try {
    const d = await apiGet('/api/profiles/teaching-guides');
    const guides = d?.data?.guides ?? d?.guides ?? [];
    return guides.map(g => ({
      id:         g.id || g.name,
      kind:       'guide',
      title:      g.name || 'Guide',
      subtitle:   g.style || null,
      details:    null,
      status:     'complete',
      emoji:      g.emoji || null,
      source:     'teaching-guides',
    }));
  } catch { return []; }
}

/* Blogs — the learner's own posts (drafts + published) from /api/blogs. */
async function fetchBlogs() {
  try {
    const d = await fetchMyBlogs();
    return (d?.data ?? []).map(b => ({
      id:        b.id,
      kind:      'blog',
      title:     b.title || 'Untitled blog',
      subtitle:  b.status === 'published' ? 'Published' : 'Draft',
      details:   b.excerpt || null,
      blogStatus: b.status,
      updatedAt: b.updated_at || null,
      source:    'blogs',
    }));
  } catch { return []; }
}

/* The other kinds have no learner endpoint yet — seams for when they land. */
const fetchFolders     = () => Promise.resolve([]); // TODO: /api/library/folders
const fetchCollections = () => Promise.resolve([]); // TODO: /api/library/collections

/**
 * Everything in the learner's library, merged and ordered: most recently
 * enrolled first (guides keep their catalog order after the courses).
 */
export function fetchMyLibrary() {
  return Promise.all([fetchCourses(), fetchGuides(), fetchBlogs(), fetchFolders(), fetchCollections()])
    .then(groups => groups.flat());
}
