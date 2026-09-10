/*
 * gradebookApi.js — the lowerEd Gradebook's data seam.
 *
 * The gradebook reads the learner's REAL assigned work (/api/self-study/mine —
 * the same rows the Activities page shows) and organises it the way a school
 * report does: subject by subject, one row per piece of work, with its state.
 *
 * Scores are the honest seam: nothing grades activities yet, so a row shows
 *   '✓' submitted (status complete)
 *   'X' missed    (its due date passed and it is still open)
 *   '–' pending   (open, not yet due)
 * When grading lands on an activity, a number can replace the mark with no
 * page change — the badge already knows how to render scores in bands.
 */
import { apiGet } from './api.js';

/* Platform kind → gradebook work type. */
const TYPE_LABEL = {
  self_study:  'Self study',
  assignment:  'Assignment',
  project:     'Project',
  multi_stage: 'Journey',
};

const TYPE_DOT = {
  self_study:  '#E8A33D',   // GOLD
  assignment:  '#6C3BFF',   // BRAND
  project:     '#10B981',
  multi_stage: '#A855F7',
};

export { TYPE_LABEL, TYPE_DOT };

/** One subject's worth of rows, plus its derived stats. */
function summarise(rows) {
  const submitted = rows.filter(r => r.status === 'complete').length;
  const missed    = rows.filter(r => r.mark === 'X').length;
  return { submitted, missed, total: rows.length };
}

/**
 * The learner's gradebook, grouped by subject.
 * Locked journey stages never appear (their turn has not come); live courses
 * are sessions, not gradable work, so they stay out too.
 */
export async function fetchMyGradebook() {
  try {
    const d = await apiGet('/api/self-study/mine');
    const rows = (d?.data ?? [])
      .filter(a => !a.journey?.locked && (a.type || 'self_study') !== 'live_course')
      .map(a => {
        const due = a.dueAt || a.details?.scheduled_at || null;
        const open = a.status !== 'complete';
        const overdue = open && due && new Date(due) < new Date();
        return {
          id:      a.targetId || `gb-${a.id}`,
          name:    a.title || a.topic || 'Activity',
          type:    a.type || 'self_study',
          subject: a.subject || 'General',
          date:    due,                       // when it was due / holds
          status:  a.status || 'assigned',
          // A published grade IS the mark; states fill in until grading lands.
          mark:    a.graded ? a.grade : a.status === 'complete' ? '✓' : overdue ? 'X' : '–',
        };
      });

    const bySubject = new Map();
    for (const r of rows) {
      if (!bySubject.has(r.subject)) bySubject.set(r.subject, []);
      bySubject.get(r.subject).push(r);
    }

    const subjects = [...bySubject.entries()]
      .map(([name, list]) => ({
        id: name,
        name,
        assignments: list.sort((x, y) => String(x.date || '').localeCompare(String(y.date || ''))),
        ...summarise(list),
      }))
      .sort((x, y) => y.assignments.length - x.assignments.length);

    return { subjects, totals: summarise(rows) };
  } catch {
    return { subjects: [], totals: { submitted: 0, missed: 0, total: 0 } };
  }
}

export default { fetchMyGradebook, TYPE_LABEL, TYPE_DOT };
