/**
 * SubmissionsPage — the grading workbench, laid out like its siblings: a left
 * rail of submitted activities, a right card holding the roster, and grading
 * as a full-page workspace on top.
 *
 * Pick an activity → pick (or stepper through) its students → grade. Drafts
 * autosave locally until publish, and the NowGrading strip resumes anything
 * a closed tab or a dead network left behind.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useNowGrading } from '../lib/nowGrading.js';
import { BookOpen, PencilLine, FolderKanban, MonitorPlay, ListChecks, Pin } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Badge } from '../components/Primitives.jsx';
import { apiGet } from '../services/api.js';
import GradeSubmissionModal from '../components/grading/GradeSubmissionModal.jsx';
import NowGrading from '../components/grading/NowGrading.jsx';
import { loadDraft } from '../components/grading/gradingDrafts.js';
import { GREEN, PURPLE, BLUE, RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const TYPE_ICON = { self_study: [BookOpen, 'ti-book'], assignment: [PencilLine, 'ti-pencil'], project: [FolderKanban, 'ti-layout-kanban'], live_course: [MonitorPlay, 'ti-device-desktop'], multi_stage: [ListChecks, 'ti-list-check'] };

const fmtWhen = (iso) => {
  if (!iso) return null;
  try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return null; }
};

export default function SubmissionsPage() {
  const navigate = useNavigate();
  // Deep links: the gradebook (and anything else) can send ?activity=<id>.
  const [params, setParams] = useSearchParams();
  const deepLinked = params.get('activity');
  const resumeStudent = params.get('grade');   // the Now grading bar's Resume: open the workspace on this learner
  const { user } = useAuth();
  const [, nowActs] = useNowGrading(user?.id);
  const [activities, setActivities] = useState(null);
  const [key, setKey] = useState(null);              // selected activity id
  const [detail, setDetail] = useState(null);        // { assignment, targets }
  const [detailLoading, setDetailLoading] = useState(false);
  const [grading, setGrading] = useState(null);      // { index } into the gradeable queue
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    apiGet('/api/self-study')
      .then(d => {
        const rows = (d?.data ?? []).map(a => ({
          ...a,
          submitted: a.progress?.complete ?? 0,
          assigned:  a.progress?.assigned ?? 0,
        })).sort((x, y) => y.submitted - x.submitted || String(y.created_at || '').localeCompare(String(x.created_at || '')));
        setActivities(rows);
        setKey(k => k ?? (deepLinked && rows.find(a => a.id === deepLinked)?.id)
          ?? rows.find(a => a.submitted > 0)?.id ?? rows[0]?.id ?? null);
      })
      .catch(e => setErr(e?.message || 'Could not load the submissions.'));
  }, [deepLinked]);
  useEffect(() => { load(); }, [load]);

  /* Roster for the picked activity — targets carry grade + feedback. */
  useEffect(() => {
    if (!key) { setDetail(null); return; }
    setDetailLoading(true);
    apiGet(`/api/self-study/${key}`)
      .then(d => {
        // GET /:id spreads the assignment at the TOP of data (targets ride
        // beside it) — data IS the brief. There is no data.assignment key.
        const data = d?.data ?? null;
        setDetail({ assignment: data, targets: data?.targets ?? [] });
      })
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [key]);

  const activity = (activities ?? []).find(a => a.id === key) ?? null;

  /* The gradeable queue: everyone with work in flight or done; ungraded first. */
  const queue = (detail?.targets ?? [])
    .filter(t => t.status === 'started' || t.status === 'complete')
    .map(t => ({
      targetId:   t.id,
      student:    { id: t.student_id, name: t.full_name || 'Learner', username: t.username, emoji: t.avatar_emoji || '' },
      status:     t.status,
      completedAt: t.completed_at,
      grade:      t.grade ?? null,
      gradedAt:   t.graded_at ?? null,
      feedbackText: t.feedback?.text || '',
      feedbackMode: t.feedback?.mode || null,          // how the published score was set
      feedbackRubric: t.feedback?.rubric ?? [],
      feedbackQuestions: t.feedback?.questions ?? [],   // marks per question, when published that way
      submission: t.submission ?? null,   // text + answers as handed in
      files:      t.files ?? [],          // attachments (metadata only)
      submissionPdf: t.submissionPdf ?? null,   // the whole submission as one PDF
      markup:     t.markup ?? null,           // the grader's marks on that PDF
      aiGrade:    t.ai_grade ?? null,         // AI draft marks (for approval)
    }))
    .sort((x, y) => (x.grade != null) - (y.grade != null) || String(x.completedAt || '').localeCompare(String(y.completedAt || '')));

  const ungraded = queue.filter(s => s.grade == null).length;

  // Resume from the Now grading bar: once that activity's roster is here, open on the learner and tidy the URL.
  useEffect(() => { if (resumeStudent && deepLinked) setKey(deepLinked); }, [resumeStudent, deepLinked]);
  useEffect(() => {
    if (!resumeStudent || !detail?.assignment?.id || detail.assignment.id !== deepLinked) return;
    if (queue.some(s => s.student.id === resumeStudent)) setGrading({ studentId: resumeStudent, assignmentId: detail.assignment.id });
    const next = new URLSearchParams(params); next.delete('grade'); setParams(next, { replace: true });
  }, [resumeStudent, detail, deepLinked]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The workspace reports what is on screen; closing it leaves this parked (minimized) in the Now grading bar.
  const onSession = (s) => {
    if (s.queue.length && s.queue.every(q => q.graded)) { nowActs.clear(); return; }   // everyone is graded: nothing left to resume
    nowActs.setCurrent(s);
  };

  const onPublished = (studentId, grade, feedback = null) => {
    // Fold the published grade (and what went with it) into the roster without a refetch.
    setDetail(d => d ? {
      ...d,
      targets: d.targets.map(t => t.student_id === studentId
        ? { ...t, grade, graded_at: new Date().toISOString(), ...(feedback ? { feedback } : {}) } : t),
    } : d);
  };
  const onUnpublished = (studentId) => setDetail(d => d ? {
    ...d, targets: d.targets.map(t => (t.student_id === studentId ? { ...t, grade: null, graded_at: null } : t)),
  } : d);

  /* Saved marks and AI drafts fold into the roster, so moving between
     learners in the workspace never shows stale ones. */
  const foldTarget = (studentId, patch) => setDetail(d => d ? {
    ...d, targets: d.targets.map(t => (t.student_id === studentId ? { ...t, ...patch } : t)),
  } : d);

  // Open the workspace on that learner once that activity's roster is loaded
  // (the modal is only drawn when the loaded roster is the right activity).
  const resumeDraft = (d) => {
    setKey(d.assignmentId);
    setGrading({ studentId: d.studentId, assignmentId: d.assignmentId });
  };

  return (
    <PageLayout
      title="Submissions"
      subtitle="Grade submitted work, activity by activity"
      action={<Btn size="sm" variant="secondary" onClick={() => navigate('/chat', { state: { prefill: 'Prepare an assignment on  for my class' } })}><Ico ti="ti-clipboard-check" size={14} /> New activity</Btn>}
    >
      {/* Drafts waiting to be finished — survives closed tabs and dead networks */}
      <NowGrading onResume={resumeDraft} />

      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left rail — the submitted activities */}
        <aside style={{ width: 268, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: C.muted2, padding: '8px 13px 6px', fontFamily: C.font }}>SUBMITTED ACTIVITIES</div>
            {activities === null && <div style={{ padding: '10px 13px', fontSize: 12.5, color: C.muted2, fontFamily: C.font }}>Loading…</div>}
            {activities?.length === 0 && (
              <div style={{ padding: '12px 13px', fontSize: 12.5, color: C.muted2, fontFamily: C.font, lineHeight: 1.5 }}>
                Nothing assigned yet. Create one under Activities.
              </div>
            )}
            {(activities ?? []).map(a => {
              const on = a.id === key;
              return (
                <button key={a.id} onClick={() => setKey(a.id)} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left',
                  padding: '11px 13px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: on ? PURPLE : 'transparent', color: on ? '#fff' : C.muted,
                  fontSize: 13.5, fontWeight: on ? 700 : 600, fontFamily: C.font, transition: 'all .12s',
                }}
                  onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = C.bg; }}
                  onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ display: 'flex', flexShrink: 0, marginTop: 1 }}>{(() => { const [I, ti] = TYPE_ICON[a.type] || [Pin, 'ti-pin']; return <Ico ti={ti} size={14} color="#6B7280" />; })()}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 600, lineHeight: 1.4, marginTop: 2, color: on ? 'rgba(255,255,255,.82)' : C.muted2 }}>
                      {a.subject} · {a.submitted}/{a.assigned} submitted
                    </span>
                  </span>
                  {a.submitted > 0 && (
                    <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 900, background: on ? 'rgba(255,255,255,.22)' : '#E6F6EE', color: on ? '#fff' : GREEN, borderRadius: 999, padding: '2px 8px', marginTop: 1 }}>
                      {a.submitted}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Guidance note, in the workbench's WHEN TO USE IT voice */}
          <div style={{ background: tint(4), border: `1px solid ${tint(20)}`, borderRadius: 14, padding: '13px 15px', fontFamily: C.font }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Ico ti="ti-info-circle" size={13} color={C.brand} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: C.brand }}>WHO TO GRADE FIRST</span>
            </div>
            {activities === null ? (
              <div style={{ fontSize: 12, color: C.muted }}>Counting submissions…</div>
            ) : ungraded > 0 ? (
              <>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, marginBottom: 5 }}>
                  {ungraded} submission{ungraded === 1 ? '' : 's'} waiting in “{activity?.title ?? 'this activity'}”.
                </div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>
                  Grades publish the moment you press Publish — everything before that autosaves on this device,
                  so it is safe to stop and continue later.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, marginBottom: 5 }}>All caught up here.</div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>
                  New submissions appear the moment a learner finishes their work.
                </div>
              </>
            )}
          </div>
        </aside>

        {/* Right card — the roster */}
        <section style={{ flex: 1, minWidth: 300, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '20px 22px', fontFamily: C.font }}>
          {!activity ? (
            <div style={{ color: C.muted2, fontSize: 13 }}>Pick an activity to see its submissions.</div>
          ) : detailLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted2, fontSize: 13 }}>
              <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> Loading the roster…
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: C.ink }}>{activity.title}</div>
                  <div style={{ fontSize: 11.5, color: C.muted }}>{activity.subject} · {activity.topic}</div>
                </div>
                <Badge color={ungraded ? C.brand : GREEN} bg={ungraded ? C.brandSoft : '#DCFCE7'}>
                  <Ico ti="ti-users" size={10} style={{ marginRight: 3 }} />{ungraded} to grade
                </Badge>
              </div>

              {(detail?.targets ?? []).length === 0 && (
                <div style={{ fontSize: 12.5, color: C.muted, padding: '10px 0' }}>Nobody is assigned yet.</div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {(detail?.targets ?? []).map(t => {
                  const gradeable = t.status === 'started' || t.status === 'complete';
                  const graded = t.grade != null;
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px',
                      border: `1px solid ${graded ? '#BBF7D0' : C.border}`, borderRadius: 12,
                      background: graded ? '#F0FDF4' : C.surface, opacity: gradeable ? 1 : .75 }}>
                      <span style={{ fontSize: 14, fontWeight: 900, color: '#6B7280' }}>{(t.full_name || 'L').trim().charAt(0).toUpperCase()}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{t.full_name}</div>
                        <div style={{ fontSize: 11, color: C.muted2 }}>
                          @{t.username || '—'}{t.completed_at ? ` · finished ${fmtWhen(t.completed_at)}` : t.status === 'started' ? ' · working' : ' · not started'}
                          {t.submission?.late && <span style={{ color: C.brand, fontWeight: 800 }}> · late</span>}
                        </div>
                      </div>
                      {graded ? (
                        <Badge color={GREEN} bg="#DCFCE7"><Ico ti="ti-circle-check" size={10} style={{ marginRight: 2 }} />{t.grade}%</Badge>
                      ) : (
                        <Badge color={t.status === 'complete' ? BLUE : t.status === 'started' ? C.brand : C.muted}
                          bg={t.status === 'complete' ? '#EFF6FF' : t.status === 'started' ? C.brandSoft : C.bg}>
                          {t.status === 'complete' ? 'Submitted' : t.status === 'started' ? 'In progress' : 'Not started'}
                        </Badge>
                      )}
                      <Btn size="sm" variant={graded ? 'secondary' : 'default'}
                        disabled={!gradeable}
                        onClick={() => setGrading({ studentId: t.student_id, assignmentId: detail?.assignment?.id })}>
                        {graded ? 'Review' : gradeable ? 'Grade' : '—'}
                      </Btn>
                    </div>
                  );
                })}
              </div>

              {queue.length === 0 && (detail?.targets ?? []).length > 0 && (
                <div style={{ marginTop: 12, fontSize: 12, color: C.muted2, lineHeight: 1.55 }}>
                  No submissions to grade yet — learners appear here as soon as they start working.
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* The full-page grading workspace */}
      {grading && detail && queue.length > 0 && (!grading.assignmentId || detail.assignment?.id === grading.assignmentId) && (
        <GradeSubmissionModal
          key={grading.assignmentId || detail.assignment?.id}
          assignment={detail.assignment}
          students={queue}
          initialIndex={Math.max(0, queue.findIndex(s => s.student.id === grading.studentId))}
          onClose={() => setGrading(null)}
          onPublished={onPublished}
          onUnpublished={onUnpublished}
          onMarkup={(sid, marks) => foldTarget(sid, { markup: { marks, updatedAt: new Date().toISOString() } })}
          onAiGrade={(sid, ai) => foldTarget(sid, { ai_grade: ai })}
          onSession={onSession}
        />
      )}

      {err && <div style={{ color: RED, fontSize: 13.5, fontWeight: 700, fontFamily: C.font }}>{err}</div>}
    </PageLayout>
  );
}
