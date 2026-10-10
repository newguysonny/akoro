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
import { apiGet, apiPost, apiDelete, API } from './api.js';

/* Self study — what I, a learner, have been assigned. */
async function fetchSelfStudy() {
  try {
    const d = await apiGet('/api/self-study/mine');
    return (d?.data ?? [])
      // Sequential unlocking: a stage whose turn has not come stays with the
      // journey — it never appears as standalone work.
      .filter(a => !a.journey?.locked)
      .map(a => {
      // A multi-stage row IS the roadmap: the server derived each stage's
      // state (complete / active / locked / open) from this learner's own
      // progress; the subtitle names the step to do now.
      const stageList = a.type === 'multi_stage' ? (a.stages ?? a.details?.stages ?? []) : null;
      const active = stageList?.find(st => st.status === 'active');
      const doneCount = stageList?.filter(st => st.status === 'complete').length ?? 0;
      return {
      id:         a.targetId || `ss-${a.id}`,
      assignmentId: a.id,
      kind:       a.type || 'self_study',   // assignment | project | live_course | self_study | multi_stage | battle-ref
      title:      a.title || a.topic || 'Self study',
      subtitle:   stageList
        ? (active
          ? `Step ${(a.journeyProgress?.done ?? doneCount) + 1} of ${stageList.length} — now: ${active.title}`
          : `All ${stageList.length} stages complete 🎉`)
        : [a.subject, a.topic].filter(Boolean).join(' · '),
      details:    a.instructions || null,
      status:     a.status || 'assigned',
      dueAt:      a.dueAt || a.details?.scheduled_at || null,
      assignedBy: a.assignedBy || null,
      source:     'self-study',
      stages:     stageList,   // [{title, emoji, kind, status}] — the card renders the roadmap
      graded:     !!a.graded,  // teacher published a grade
      grade:      a.grade ?? null,
      feedbackText: a.feedbackText || null,
      // extra context the details page needs (the feed card ignores these)
      instructions: a.instructions || null,
      subject:    a.subject || null,
      topic:      a.topic || null,
      completedAt: a.completedAt || null,
      briefDetails: a.details ?? null,   // brief details object (questions, etc.)
      submission: a.submission ?? null,  // the work the learner turned in
      targetId:   a.targetId || null,
      submissionPdf: a.submissionPdf ?? null,   // { ready, pages } — the work as one PDF
      };
    });
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

/* My activity streak — consecutive days with at least one completed
   activity, computed server-side from real completions. */
export async function fetchMyStreak() {
  try {
    const d = await apiGet('/api/self-study/streak');
    return d?.data?.streak ?? 0;
  } catch { return 0; }
}

/* Submit — mark this activity's target complete AND hand in the work:
   free text, per-question answers, and the ids of files uploaded for it.
   The teacher's class view, the grading workspace and this feed all derive
   from that target row. Throws with a user-facing message. */
export async function completeActivity(assignmentId, work = {}) {
  const d = await apiPost(`/api/self-study/${assignmentId}/complete`, {
    text: work.text ?? '',
    answers: work.answers ?? {},
    fileIds: work.fileIds ?? [],
  });
  return d?.data ?? null;
}

/* Upload one attachment for an activity (before submitting). Base64 over
   JSON — the API stores it beside the learner's target. Returns the file
   metadata ({id, name, size, mime}) for the chip. */
export async function uploadActivityFile(assignmentId, file) {
  const data = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(new Error('Could not read that file.'));
    fr.readAsDataURL(file);
  });
  const d = await apiPost(`/api/self-study/${assignmentId}/files`, {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    data,
  });
  return d?.data ?? null;
}

/* Remove one of my uploaded files (before submitting). */
export async function removeActivityFile(fileId) {
  await apiDelete(`/api/self-study/files/${fileId}`);
}

/* Save my whole submission as one PDF (the copy my teacher grades). */
export async function downloadMySubmissionPdf(targetId, title) {
  const r = await fetch(`${API}/api/self-study/targets/${targetId}/submission.pdf?download=1`, { credentials: 'include' });
  if (!r.ok) throw new Error('Could not get the PDF — try again in a moment.');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(title || 'submission').replace(/[^\w .-]/g, '').trim() || 'submission'}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* Download a submission file. Auth rides the session cookie, so a plain
   <a href> cannot carry it cross-origin — fetch the blob, then hand it to
   the browser as an object URL. */
export async function downloadActivityFile(fileId, name) {
  const r = await fetch(`${API}/api/self-study/files/${fileId}`, { credentials: 'include' });
  if (!r.ok) throw new Error('Could not fetch that file.');
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
