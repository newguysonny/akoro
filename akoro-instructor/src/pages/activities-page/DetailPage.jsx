import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import { Btn, Badge } from '../../components/Primitives.jsx';
import { apiGet, apiDelete, apiBlob } from '../../services/api.js';
import PaperView from '../../components/paper/PaperView.jsx';
import { downloadActivityPdf } from '../../lib/activityPdf.js';
import { printPaperHtml } from '../../components/paper/PaperFrame.jsx';
import { useNavigate } from 'react-router-dom';
import { GREEN, BLUE, RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import { confirmDialog } from '../../components/ConfirmHost.jsx';
import { byKey } from '../../components/activities/ActivityForm.jsx';

/* ── Per-learner progress modal — same brief view the self-study page uses ── */
export default function DetailPage({ activity, onDeleted, onClose }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const meta = byKey(activity?.type || 'self_study');

  useEffect(() => {
    if (!activity?.id) { setData(null); return; }
    apiGet(`/api/self-study/${activity.id}`).then(d => setData(d?.data ?? null)).catch(() => setData(null));
  }, [activity?.id]);

  const STATUS = {
    assigned: { color: C.muted,  bg: C.bg,     label: 'Not started' },
    started:  { color: BLUE,   bg: '#EFF6FF', label: 'In progress' },
    complete: { color: GREEN,  bg: '#DCFCE7', label: 'Complete' },
  };

  const del = async () => {
    if (!await confirmDialog(`Delete “${activity.title}”? Learners keep any session they already started.`)) return;
    try { await apiDelete(`/api/self-study/${activity.id}`); onDeleted(); onClose(); } catch { /* leave it */ }
  };
  const [pdfErr, setPdfErr] = useState(false);
  const questions = data?.details?.questions ?? [];
  const isJourney = (data?.type || activity?.type) === 'multi_stage';
  const canPdf = !!data && (isJourney || questions.length > 0 || (data.subtopics ?? []).length > 0);
  // Same sheet the preview prints: the paper with its answer key, or the
  // plan/stages when the activity never had questions.
  // An activity with questions downloads as the paper (the assignment
  // template): the learners' paper, or the teacher copy with the marking scheme.
  const printPaper = (copy) => {
    setPdfErr(false);
    apiBlob(`/api/self-study/${data.id}/paper.html?copy=${copy}&embed=1`)
      .then((b) => b.text())
      .then((html) => printPaperHtml(html, `${data.title || 'Assignment'}${copy === 'teacher' ? ' — marking scheme' : ''}`))
      .catch(() => setPdfErr(true));
  };
  const downloadPdf = () => {
    if (questions.length) { printPaper('student'); return; }
    try {
      downloadActivityPdf({
        draft: {
          title: data.title,
          type: data.type,
          payload: {
            subject: data.subject,
            topic: data.topic,
            difficulty: data.difficulty,
            due_at: data.due_at,
            instructions: data.instructions,
            subtopics: data.subtopics,
            objectives: data.objectives,
            details: data.details,
          },
        },
        meta: byKey(data.type || activity?.type || 'self_study') || {},
        shown: questions.length ? { status: 'ready', paper: data.details } : null,
        audience: {},
      });
      setPdfErr(false);
    } catch { setPdfErr(true); }
  };
  if (!activity?.id) return (
    <PageLayout title="Activity" subtitle="Details">
      <div style={{ fontFamily: C.font, color: C.muted }}>This activity is no longer available.</div>
      <div style={{ marginTop: 14 }}><Btn onClick={() => onClose()}>Back to activities</Btn></div>
    </PageLayout>
  );

  return (
    <PageLayout title={data?.title || activity?.title || 'Activity'} subtitle="Activity details">
      <div style={{ maxWidth: 640, margin: '0 auto', fontFamily: C.font }}>
        <button onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14, background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontSize: 12.5, fontWeight: 700, fontFamily: C.font, padding: 0 }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to activities
        </button>
      {!data ? (
        <div style={{ fontSize: 13, color: C.muted, fontFamily: C.font, padding: '10px 0' }}>Loading…</div>
      ) : (
        <div style={{ fontFamily: C.font }}>
          {/* The brief — same data the self-study detail shows, whatever the kind. */}
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
            <Ico lucide={meta.icon} ti={meta.ti} size={12} color={meta.color} style={{ verticalAlign: '-2px', marginRight: 4 }} />{data.subject} · {data.topic}
            {data.difficulty ? ` · ${data.difficulty}` : ''}
          </div>

          {data.details?.scheduled_at && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: C.brand, marginBottom: 10 }}>
              <Ico ti="ti-clock" size={12} />
              Holds {new Date(data.details.scheduled_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              {data.details.duration_mins ? ` · ${data.details.duration_mins} minutes` : ''}
            </div>
          )}
          {data.due_at && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 10 }}>
              <Ico ti="ti-clock" size={12} /> Due {new Date(data.due_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}

          {data.instructions && (
            <div style={{ fontSize: 12, color: C.muted, background: C.bg, borderRadius: 10, padding: '9px 12px', marginBottom: 12, lineHeight: 1.55 }}>{data.instructions}</div>
          )}

          {/* Questions riding with the brief — learners answer these on submit. */}
          {(data.details?.questions ?? []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: C.muted2, marginBottom: 7 }}>
                QUESTIONS · {(data.details.questions ?? []).length}
              </div>
              <PaperView details={data.details} showKey style={{ padding: '14px 16px' }} />
            </div>
          )}

          {/* The plan — the subtopics and objectives the teacher approved,
              labelled the way the creation form labelled them. */}
          {(data.subtopics ?? []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: C.muted2, marginBottom: 7 }}>
                {(byKey(data.type || 'self_study')?.planLabel || 'Plan').toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {(data.subtopics ?? []).map((st, i) => (
                  <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 11px', background: C.surface }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, background: tint(9, meta.color), color: meta.color, fontSize: 10.5, fontWeight: 900, textAlign: 'center', lineHeight: '18px' }}>{i + 1}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{st}</span>
                    </div>
                    {(data.objectives?.[st] ?? []).length > 0 && (
                      <div style={{ paddingLeft: 26, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {data.objectives[st].map((o, j) => (
                          <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.muted }}>
                            <span style={{ width: 3.5, height: 3.5, borderRadius: '50%', background: C.muted2, flexShrink: 0 }} />{o}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Who has it, and where each of them stands. */}
          {(() => {
            const targets = data.targets ?? [];
            const done = targets.filter(t => t.status === 'complete').length;
            const pct = targets.length ? Math.round((done / targets.length) * 100) : 0;
            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: C.muted2 }}>ASSIGNED LEARNERS</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{done} of {targets.length} done</div>
                </div>
                {targets.length > 0 && (
                  <div style={{ height: 6, borderRadius: 3, background: C.bg, overflow: 'hidden', marginBottom: 10 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${C.brand}, ${GREEN})`, transition: 'width .3s' }} />
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                  {targets.map(t => {
                    const st = STATUS[t.status] || STATUS.assigned;
                    return (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface }}>
                        <span style={{ fontSize: 13, fontWeight: 900, color: '#6B7280' }}>{(t.full_name || 'L').trim().charAt(0).toUpperCase()}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{t.full_name}</div>
                          <div style={{ fontSize: 11, color: C.muted }}>@{t.username}</div>
                        </div>
                        <Badge color={st.color} bg={st.bg}>{st.label}</Badge>
                      </div>
                    );
                  })}
                  {targets.length === 0 && (
                    <div style={{ fontSize: 12, color: C.muted, padding: '10px 0' }}>Nobody is assigned yet.</div>
                  )}
                </div>
              </div>
            );
          })()}

          {pdfErr && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 11px', borderRadius: 10, background: tint(9, RED), border: `1px solid ${tint(30, RED)}`, fontSize: 12, fontWeight: 700, color: RED, fontFamily: C.font, marginTop: 12 }}>
              <Ico ti="ti-alert-triangle" size={13} /> Couldn't build the PDF — try again.
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn size="sm" variant="secondary" onClick={downloadPdf} disabled={!canPdf}
                title="Download this activity as a PDF">
                <Ico ti="ti-download" size={13} /> {questions.length ? 'Download paper' : 'Download PDF'}
              </Btn>
              {questions.length > 0 && (
                <Btn size="sm" variant="secondary" onClick={() => printPaper('teacher')} title="Download the marking scheme (teacher copy)">
                  <Ico ti="ti-download" size={13} /> Marking scheme
                </Btn>
              )}
              <Btn size="sm" variant="secondary" onClick={del}><Ico ti="ti-trash" size={13} /> Delete activity</Btn>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn size="sm" variant="secondary" onClick={() => navigate(`/self-study/${activity.id}/analytics`)}>
                <Ico ti="ti-chart-bar" size={13} /> Analytics
              </Btn>
              <Btn size="sm" variant="secondary" onClick={onClose}>Close</Btn>
            </div>
          </div>
        </div>
      )}
      </div>
    </PageLayout>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
/* ── AI drafts strip — the human approval surface ────────────────────────────
   Drafts the agent prepared (instructor chat or a python agent task run) sit
   here until a human previews and assigns or discards them. Nothing reaches a
   learner from this strip without the instructor's Preview → Assign. */
