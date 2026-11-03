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
import { apiGet, apiPost, apiPut, apiDelete, API, refreshSession } from './api.js';

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
      draft:      a.draft ?? null,            // answers submitted question by question
      draftFiles: Array.isArray(a.draftFiles) ? a.draftFiles : [],   // files uploaded so far, each with its question
      feedbackQuestions: Array.isArray(a.feedbackQuestions) ? a.feedbackQuestions : [],
      submissionPdf: a.submissionPdf ?? null,   // { ready, pages } — the work as one PDF
      feedbackRubric: Array.isArray(a.feedbackRubric) ? a.feedbackRubric : [],   // [{name, max, level}] once graded
      feedbackAi: !!a.feedbackAi,                // marked by the AI at once (the teacher may still adjust)
      feedbackMarking: Array.isArray(a.feedbackMarking) ? a.feedbackMarking : [],
      aiMarking:  !!a.aiMarking,                // the AI is marking this hand-in right now
      markedPdf:  !!a.markedPdf,                // the teacher's marked copy is available
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

/* A file fetch that survives an expired sign-in: refresh once, then retry. */
async function authFetch(url) {
  let r = await fetch(url, { credentials: 'include' });
  if (r.status === 401) {
    try { await refreshSession(); } catch { return r; }
    r = await fetch(url, { credentials: 'include' });
  }
  return r;
}

/* The written answer of work without questions (autosaved; follows the learner). */
export async function saveActivityText(assignmentId, text) {
  const d = await apiPut(`/api/self-study/${assignmentId}/draft-text`, { text });
  return d?.data ?? null;
}

/* Submit ONE question's answer (saved on the server; null clears it). */
export async function saveActivityAnswer(assignmentId, index, value) {
  const d = await apiPut(`/api/self-study/${assignmentId}/draft/${index}`, { value });
  return d?.data ?? null;
}

/* Upload one attachment for an activity (before submitting). Base64 over
   JSON — the API stores it beside the learner's target. `question` (index)
   makes it part of that question's answer (at most 3 each). Returns the
   file metadata ({id, name, size, mime, question}) for the card. */
export async function uploadActivityFile(assignmentId, file, question = null) {
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
    ...(Number.isInteger(question) ? { question } : {}),
  });
  return d?.data ?? null;
}

/* Remove one of my uploaded files (before submitting). */
export async function removeActivityFile(fileId) {
  await apiDelete(`/api/self-study/files/${fileId}`);
}

/* Save my whole submission as one PDF — the copy my teacher grades, or
   (marked: true) the marked copy they sent back with my grade. */
export async function downloadMySubmissionPdf(targetId, title, { marked = false } = {}) {
  const r = await authFetch(`${API}/api/self-study/targets/${targetId}/${marked ? 'marked' : 'submission'}.pdf?download=1`);
  if (!r.ok) throw new Error('Could not get the PDF — try again in a moment.');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(title || 'submission').replace(/[^\w .-]/g, '').trim() || 'submission'}${marked ? ' (marked)' : ''}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* A finished battle's questions, options and answers as one PDF (the Questions tab's menu). */
export async function downloadBattleQuestionsPdf(battleId, title) {
  const r = await authFetch(`${API}/api/battle/battles/${battleId}/questions.pdf`);
  if (!r.ok) throw new Error(r.status === 409 ? 'The questions can be downloaded once the battle has finished.' : 'Could not get the PDF — try again in a moment.');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(title || 'battle').replace(/[^\w .-]/g, '').trim() || 'battle'} - questions.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* My submission as the paper — the server's template, ready to show or print. */
export async function fetchMySubmissionPaper(targetId) {
  const r = await authFetch(`${API}/api/self-study/targets/${targetId}/submission.html?embed=1`);
  if (!r.ok) throw new Error('Could not load your paper.');
  return r.text();
}

/* Download a submission file. Auth rides the session cookie, so a plain
   <a href> cannot carry it cross-origin — fetch the blob, then hand it to
   the browser as an object URL. */
export async function downloadActivityFile(fileId, name) {
  const r = await authFetch(`${API}/api/self-study/files/${fileId}`);
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

/* One of my files as bytes — the document editor reopens a saved .docx. */
export async function fetchActivityFileBlob(fileId) {
  const r = await authFetch(`${API}/api/self-study/files/${fileId}`);
  if (!r.ok) throw new Error('Could not open that file.');
  return r.blob();
}

/* Save a Blob I made on this device (a copy of my document). */
export function saveBlobAs(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
