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
import { ClipboardCheck, Users, CheckCircle2, Loader2, Info } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Badge } from '../components/Primitives.jsx';
import { apiGet } from '../services/api.js';
import GradeSubmissionModal from '../components/grading/GradeSubmissionModal.jsx';
import NowGrading from '../components/grading/NowGrading.jsx';
import { loadDraft } from '../components/grading/gradingDrafts.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, RED, FONT } from '../constants.js';

const TYPE_EMOJI = { self_study: '📖', assignment: '✏️', project: '🗂️', live_course: '📺', multi_stage: '🧩' };

const fmtWhen = (iso) => {
  if (!iso) return null;
  try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return null; }
};

export default function SubmissionsPage() {
  const navigate = useNavigate();
  // Deep links: the gradebook (and anything else) can send ?activity=<id>.
  const [params] = useSearchParams();
  const deepLinked = params.get('activity');
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
      .then(d => setDetail({ assignment: d?.data?.assignment ?? null, targets: d?.data?.targets ?? [] }))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [key]);

  const activity = (activities ?? []).find(a => a.id === key) ?? null;

  /* The gradeable queue: everyone with work in flight or done; ungraded first. */
  const queue = (detail?.targets ?? [])
    .filter(t => t.status === 'started' || t.status === 'complete')
    .map(t => ({
      student:    { id: t.student_id, name: t.full_name || 'Learner', username: t.username, emoji: t.avatar_emoji || '🧑‍🎓' },
      status:     t.status,
      completedAt: t.completed_at,
      grade:      t.grade ?? null,
      feedbackText: t.feedback?.text || '',
      submission: t.submission ?? null,   // text + answers as handed in
      files:      t.files ?? [],          // attachments (metadata only)
    }))
    .sort((x, y) => (x.grade != null) - (y.grade != null) || String(x.completedAt || '').localeCompare(String(y.completedAt || '')));

  const ungraded = queue.filter(s => s.grade == null).length;

  const onPublished = (studentId, grade) => {
    // Fold the published grade into the roster without a refetch.
    setDetail(d => d ? {
      ...d,
      targets: d.targets.map(t => t.student_id === studentId
        ? { ...t, grade, graded_at: new Date().toISOString() } : t),
    } : d);
  };

  const resumeDraft = (d) => {
    setKey(d.assignmentId);
    // Open the modal once the roster lands; seed the queue index by student.
    const openWhenLoaded = setInterval(() => {
      setDetail(cur => {
        if (!cur || cur.assignment?.id !== d.assignmentId) return cur;
        clearInterval(openWhenLoaded);
        const idx = queue.findIndex(s => s.student.id === d.studentId);
        setGrading({ index: idx > -1 ? idx : 0 });
        return cur;
      });
    }, 150);
    setTimeout(() => clearInterval(openWhenLoaded), 4000);
  };

  return (
    <PageLayout
      title="Submissions"
      subtitle="Grade submitted work, activity by activity"
      action={<Btn size="sm" variant="secondary" onClick={() => navigate('/activities')}><ClipboardCheck size={14} /> New activity</Btn>}
    >
      {/* Drafts waiting to be finished — survives closed tabs and dead networks */}
      <NowGrading onResume={resumeDraft} />

      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left rail — the submitted activities */}
        <aside style={{ width: 268, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: MUTED2, padding: '8px 13px 6px', fontFamily: FONT }}>SUBMITTED ACTIVITIES</div>
            {activities === null && <div style={{ padding: '10px 13px', fontSize: 12.5, color: MUTED2, fontFamily: FONT }}>Loading…</div>}
            {activities?.length === 0 && (
              <div style={{ padding: '12px 13px', fontSize: 12.5, color: MUTED2, fontFamily: FONT, lineHeight: 1.5 }}>
                Nothing assigned yet. Create one under Activities.
              </div>
            )}
            {(activities ?? []).map(a => {
              const on = a.id === key;
              return (
                <button key={a.id} onClick={() => setKey(a.id)} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left',
                  padding: '11px 13px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: on ? PURPLE : 'transparent', color: on ? WHITE : MUTED,
                  fontSize: 13.5, fontWeight: on ? 700 : 600, fontFamily: FONT, transition: 'all .12s',
                }}
                  onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = LIGHT; }}
                  onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{TYPE_EMOJI[a.type] || '📌'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 600, lineHeight: 1.4, marginTop: 2, color: on ? 'rgba(255,255,255,.82)' : MUTED2 }}>
                      {a.subject} · {a.submitted}/{a.assigned} submitted
                    </span>
                  </span>
                  {a.submitted > 0 && (
                    <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 900, background: on ? 'rgba(255,255,255,.22)' : '#E6F6EE', color: on ? WHITE : GREEN, borderRadius: 999, padding: '2px 8px', marginTop: 1 }}>
                      {a.submitted}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Guidance note, in the workbench's WHEN TO USE IT voice */}
          <div style={{ background: `${AMBER}0A`, border: `1px solid ${AMBER}33`, borderRadius: 14, padding: '13px 15px', fontFamily: FONT }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Info size={13} color={AMBER} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: AMBER }}>WHO TO GRADE FIRST</span>
            </div>
            {activities === null ? (
              <div style={{ fontSize: 12, color: MUTED }}>Counting submissions…</div>
            ) : ungraded > 0 ? (
              <>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, marginBottom: 5 }}>
                  {ungraded} submission{ungraded === 1 ? '' : 's'} waiting in “{activity?.title ?? 'this activity'}”.
                </div>
                <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.55 }}>
                  Grades publish the moment you press Publish — everything before that autosaves on this device,
                  so it is safe to stop and continue later.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, marginBottom: 5 }}>All caught up here.</div>
                <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.55 }}>
                  New submissions appear the moment a learner finishes their work.
                </div>
              </>
            )}
          </div>
        </aside>

        {/* Right card — the roster */}
        <section style={{ flex: 1, minWidth: 300, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '20px 22px', fontFamily: FONT }}>
          {!activity ? (
            <div style={{ color: MUTED2, fontSize: 13 }}>Pick an activity to see its submissions.</div>
          ) : detailLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: MUTED2, fontSize: 13 }}>
              <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> Loading the roster…
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: INK }}>{activity.title}</div>
                  <div style={{ fontSize: 11.5, color: MUTED }}>{activity.subject} · {activity.topic}</div>
                </div>
                <Badge color={ungraded ? AMBER : GREEN} bg={ungraded ? '#FFF7ED' : '#DCFCE7'}>
                  <Users size={10} style={{ marginRight: 3 }} />{ungraded} to grade
                </Badge>
              </div>

              {(detail?.targets ?? []).length === 0 && (
                <div style={{ fontSize: 12.5, color: MUTED, padding: '10px 0' }}>Nobody is assigned yet.</div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {(detail?.targets ?? []).map(t => {
                  const gradeable = t.status === 'started' || t.status === 'complete';
                  const graded = t.grade != null;
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px',
                      border: `1px solid ${graded ? '#BBF7D0' : BORDER}`, borderRadius: 12,
                      background: graded ? '#F0FDF4' : WHITE, opacity: gradeable ? 1 : .75 }}>
                      <span style={{ fontSize: 18 }}>{t.avatar_emoji || '🧑‍🎓'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>{t.full_name}</div>
                        <div style={{ fontSize: 11, color: MUTED2 }}>
                          @{t.username || '—'}{t.completed_at ? ` · finished ${fmtWhen(t.completed_at)}` : t.status === 'started' ? ' · working' : ' · not started'}
                        </div>
                      </div>
                      {graded ? (
                        <Badge color={GREEN} bg="#DCFCE7"><CheckCircle2 size={10} style={{ marginRight: 2 }} />{t.grade}%</Badge>
                      ) : (
                        <Badge color={t.status === 'complete' ? BLUE : t.status === 'started' ? AMBER : MUTED}
                          bg={t.status === 'complete' ? '#EFF6FF' : t.status === 'started' ? '#FFF7ED' : LIGHT}>
                          {t.status === 'complete' ? 'Submitted' : t.status === 'started' ? 'In progress' : 'Not started'}
                        </Badge>
                      )}
                      <Btn size="sm" variant={graded ? 'secondary' : 'default'}
                        disabled={!gradeable}
                        onClick={() => {
                          const idx = queue.findIndex(s => s.student.id === t.student_id);
                          setGrading({ index: idx > -1 ? idx : 0 });
                        }}>
                        {graded ? 'Review' : gradeable ? 'Grade' : '—'}
                      </Btn>
                    </div>
                  );
                })}
              </div>

              {queue.length === 0 && (detail?.targets ?? []).length > 0 && (
                <div style={{ marginTop: 12, fontSize: 12, color: MUTED2, lineHeight: 1.55 }}>
                  No submissions to grade yet — learners appear here as soon as they start working.
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* The full-page grading workspace */}
      {grading && detail && queue.length > 0 && (
        <GradeSubmissionModal
          assignment={detail.assignment}
          students={queue}
          initialIndex={Math.min(grading.index ?? 0, queue.length - 1)}
          onClose={() => setGrading(null)}
          onPublished={onPublished}
        />
      )}

      {err && <div style={{ color: RED, fontSize: 13.5, fontWeight: 700, fontFamily: FONT }}>{err}</div>}
    </PageLayout>
  );
}
