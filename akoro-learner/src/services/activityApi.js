/**
 * activityApi.js — learner activity feed data seam.
 *
 * The Activity page (pages/ActivityPage.jsx) shows the work assigned to the
 * learner, filterable by kind. Each kind is a small fetch + normalizer that
 * returns unified rows:
 *
 *   { id, kind, title, subtitle, details, status, dueAt, assignedBy, source }
 *
 * status: 'assigned' | 'started' | 'complete' — open means not complete.
 *
 * Today only self study has a learner endpoint. Assignments, projects and
 * multi-stage activities return [] until their endpoints land — the pill
 * renders either way, and the cards appear the day the data exists without
 * any page changes.
 */
import { apiGet } from './api.js';

/* Self study — what I, a learner, have been assigned. */
async function fetchSelfStudy() {
  try {
    const d = await apiGet('/api/self-study/mine');
    return (d?.data ?? []).map(a => ({
      id:         a.targetId || `ss-${a.id}`,
      kind:       a.type || 'self_study',   // assignment | project | live_course | self_study
      title:      a.title || a.topic || 'Self study',
      subtitle:   [a.subject, a.topic].filter(Boolean).join(' · '),
      details:    a.instructions || null,
      status:     a.status || 'assigned',
      dueAt:      a.dueAt || a.details?.scheduled_at || null,
      assignedBy: a.assignedBy || null,
      source:     'self-study',
    }));
  } catch { return []; }
}

/* Assignments, projects and live courses are created as self-study briefs
   with a `type` (modules/self-study), so fetchSelfStudy already carries them;
   these stay open for kinds that ever grow their own endpoints. */
const fetchAssignments = () => Promise.resolve([]);
const fetchProjects    = () => Promise.resolve([]);
const fetchMultiStage  = () => Promise.resolve([]);

/**
 * All of the learner's activities, merged and ordered: open work first,
 * soonest due on top, no-due-date last.
 */
export function fetchMyActivities() {
  return Promise.all([fetchAssignments(), fetchProjects(), fetchMultiStage(), fetchSelfStudy()])
    .then(groups => {
      const due = (a) => (a.dueAt ? new Date(a.dueAt).getTime() : Infinity);
      return groups.flat().sort((a, b) => {
        const aOpen = a.status !== 'complete', bOpen = b.status !== 'complete';
        if (aOpen !== bOpen) return aOpen ? -1 : 1;
        return due(a) - due(b);
      });
    });
}
