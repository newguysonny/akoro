/*
 * GradeSubmissionModal — the full-page grading workspace.
 *
 * Mirrors the reference design: a paper on the left (the work being graded,
 * question by question), a grading panel on the right (rubric levels with a
 * running total, manual-score override, written feedback), a student
 * stepper in the topbar, and an autosave label — because every change saves
 * locally until the one deliberate act: Publish grade.
 *
 * The paper has two views of the work:
 *   • Submission PDF — everything the learner handed in as ONE document
 *     (built by the API at submit: their details, written answer, every
 *     question with its answer, attachments merged in). Opens inline.
 *   • Answers — question by question (the activity's real questions; for
 *     briefs without questions, the subtopics and objectives).
 * The rubric is the activity's own (details.rubric) when it has one.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ArrowLeft, ChevronLeft, ChevronRight, X, Check, Loader2, FileText, PenLine, ExternalLink, Download,
} from 'lucide-react';
import { apiPatch, downloadActivityFile, openActivityFile, fetchSubmissionPdf } from '../../services/api.js';
import { saveDraft, loadDraft, clearDraft } from './gradingDrafts.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, RED, FONT } from '../../constants.js';

/* The default rubric — overall judgement of the submission against the brief.
   Levels carry teacher-facing words so a 2 never feels arbitrary. */
const RUBRIC_DEF = [
  { name: 'Understanding of concept', desc: 'Explains the ideas correctly', max: 4, labels: ['Missing', 'Barely', 'Basic', 'Good', 'Excellent'] },
  { name: 'Completeness',             desc: 'Covers what the activity asked for', max: 3, labels: ['Not addressed', 'Partial', 'Mostly', 'Full'] },
  { name: 'Clarity & structure',      desc: 'Organised and easy to follow',       max: 3, labels: ['Unclear', 'Adequate', 'Clear', 'Model'] },
  { name: 'Effort & engagement',      desc: 'Evidence of real engagement',        max: 2, labels: ['Light', 'Solid', 'Thorough'] },
];

/* The activity's own rubric ([{ criterion, points, description? }]) as rows
   the panel can score 0..points — else the default above. */
export function rubricFor(brief) {
  const own = Array.isArray(brief?.details?.rubric) ? brief.details.rubric : [];
  const rows = own
    .map((r) => ({ name: String(r?.criterion ?? r?.name ?? '').trim(), desc: String(r?.description ?? r?.desc ?? ''), max: Math.round(Number(r?.points ?? r?.max)) }))
    .filter((r) => r.name && r.max > 0 && r.max <= 20)
    .slice(0, 12);
  return rows.length ? rows : RUBRIC_DEF;
}

const initialsOf = (name) => (name || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();

/* Questions ride as plain strings or objects (.q = the question text; MCQ
   adds .options/.correct) — read each one per question, never per set. */
const qText = (q) => (typeof q === 'object' && q !== null ? String(q.q ?? '') : String(q ?? ''));
/* Option letters — a pick reads "B. Mesophyll", matching the learner. */
const letterOf = (i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Number(i)] ?? '';

const fmtWhen = (iso) => {
  if (!iso) return null;
  try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return null; }
};

const fmtSize = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/* The submitted work, question by question — the real artifacts the learner
   handed in (text, per-question answers, files), or an honest line when this
   activity predates submission capture. */
function SubmittedPaper({ current, brief, only = null }) {
  const sub = current.submission ?? {};
  const questions = Array.isArray(brief?.details?.questions) ? brief.details.questions : [];
  // With `only`, the paper shows that one question's answer (the stepper);
  // the written answer and files ride every step.
  const answerKeys = Object.keys(sub.answers ?? {}).filter((k) => only == null || Number(k) === only);
  const files = sub.files?.length ? sub.files : (current.files ?? []);
  const hasWork = (sub.text || '').trim() || answerKeys.length || files.length;
  if (!hasWork) {
    return (
      <div style={{ background: LIGHT, border: `1px dashed ${BORDER}`, borderRadius: 10, padding: '12px 14px', fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>
        <b style={{ color: INK, fontWeight: 800 }}>
          {current.status === 'complete' ? `${current.student.name.split(' ')[0]} finished this activity` : `${current.student.name.split(' ')[0]} is still working on it`}
        </b>
        {current.completedAt && <> — completed {fmtWhen(current.completedAt)}</>}. No written submission was captured — grade against the brief with the panel on the right.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .6, color: MUTED2 }}>WHAT THEY SUBMITTED {current.completedAt && <span style={{ fontWeight: 600 }}>· {fmtWhen(current.completedAt)}</span>}</div>
      {(sub.text || '').trim() && (
        <div style={{ background: '#FBFAF8', border: `1px solid ${BORDER}`, borderLeft: `3px solid ${PURPLE}`, borderRadius: 10, padding: '12px 14px' }}>
          <p style={{ margin: 0, fontSize: 13.5, color: INK, lineHeight: 1.65, whiteSpace: 'pre-wrap', fontFamily: FONT }}>{sub.text}</p>
        </div>
      )}
      {answerKeys.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {answerKeys.filter(k => sub.answers[k] !== '' && sub.answers[k] != null).sort((a, b) => Number(a) - Number(b)).map((k) => {
            const q = questions[Number(k)];
            const raw = sub.answers[k];
            const qMcq = !!q && Array.isArray(q.options);
            const chosen = qMcq ? (q.options[raw] ?? raw) : null;
            const correct = qMcq && q.correct != null && Number(q.correct) === Number(raw);
            return (
              <div key={k} style={{ background: WHITE, border: `1px solid ${correct === false && qMcq ? 'rgba(239,68,68,.35)' : BORDER}`, borderRadius: 10, padding: '10px 13px' }}>
                {q && <div style={{ fontSize: 11, fontWeight: 800, color: MUTED2, marginBottom: 4 }}>Q{Number(k) + 1}. {qText(q)}</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: INK, fontFamily: FONT }}>
                  {qMcq && <span style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${correct ? GREEN : BORDER}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 9, color: GREEN }}>{correct ? '✓' : ''}</span>}
                  {chosen != null ? `${letterOf(raw)}. ${chosen}` : String(raw)}
                  {qMcq && correct && <span style={{ fontSize: 10, fontWeight: 800, color: GREEN, background: '#E6F6EE', borderRadius: 999, padding: '2px 8px' }}>correct</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {files.map((f) => (
            <div key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 12px', borderRadius: 10, border: `1px solid ${BORDER}`, background: WHITE, fontFamily: FONT }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: `${PURPLE}14`, color: PURPLE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><FileText size={13} /></span>
              <span style={{ textAlign: 'left' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: INK, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ display: 'block', fontSize: 10, fontWeight: 700, color: MUTED2 }}>{fmtSize(f.size)}</span>
              </span>
              <button onClick={() => openActivityFile(f.id).catch(() => {})} title="Open" aria-label={`Open ${f.name}`}
                style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: PURPLE, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ExternalLink size={13} /></button>
              <button onClick={() => downloadActivityFile(f.id, f.name).catch(() => {})} title="Download" aria-label={`Download ${f.name}`}
                style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Download size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* The whole submission as one PDF, inline. Fetched as a blob (cookie auth)
   and shown in the browser's own viewer; open-in-tab and download beside. */
function SubmissionPdfView({ targetId, version, name }) {
  const [state, setState] = useState({ status: 'loading', url: null, error: '' });
  useEffect(() => {
    let alive = true, url = null;
    setState({ status: 'loading', url: null, error: '' });
    fetchSubmissionPdf(targetId)
      .then((blob) => { url = URL.createObjectURL(blob); if (alive) setState({ status: 'ready', url, error: '' }); })
      .catch((e) => { if (alive) setState({ status: 'error', url: null, error: e?.message || 'Could not load the PDF.' }); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [targetId, version]);

  if (state.status === 'loading') {
    return <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: MUTED, fontSize: 13, fontWeight: 700 }}><Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> Preparing the submission PDF…</div>;
  }
  if (state.status === 'error') {
    return <div style={{ background: LIGHT, border: `1px dashed ${BORDER}`, borderRadius: 10, padding: '12px 14px', fontSize: 12.5, color: RED, fontWeight: 700 }}>{state.error} — the Answers tab still shows the work.</div>;
  }
  const fileName = `${(name || 'submission').replace(/[^\w .-]/g, '').trim() || 'submission'}.pdf`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <a href={state.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 800, color: PURPLE, textDecoration: 'none' }}><ExternalLink size={12} /> Open in new tab</a>
        <a href={state.url} download={fileName} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 800, color: MUTED, textDecoration: 'none' }}><Download size={12} /> Download</a>
      </div>
      <iframe title="Submission PDF" src={state.url} style={{ width: '100%', height: '78vh', border: `1px solid ${BORDER}`, borderRadius: 10, background: '#525659' }} />
    </div>
  );
}

export default function GradeSubmissionModal({
  assignment, students, initialIndex, onClose, onPublished,
}) {
  /* students: the gradeable queue [{ student:{id,name,username,emoji}, status, completedAt, grade }] */
  const [index, setIndex] = useState(Math.min(Math.max(initialIndex ?? 0, 0), Math.max(students.length - 1, 0)));
  const current = students[index];
  const brief = assignment ?? null;

  // Questions = the activity's real questions when it has them (answers are
  // keyed by their index); else the assigned subtopics and objectives.
  const questions = useMemo(() => {
    const qs = Array.isArray(brief?.details?.questions) ? brief.details.questions : [];
    if (qs.length) {
      return qs.map((q, i) => ({
        title: qText(q) || `Question ${i + 1}`,
        points: typeof q === 'object' && q && Number(q.max_points ?? q.points) > 0 ? [`Worth ${Number(q.max_points ?? q.points)} points`] : [],
        index: i,
      }));
    }
    const sts = brief?.subtopics ?? [];
    if (!sts.length) return [{ title: brief?.topic || 'The work', points: [] }];
    return sts.map(st => ({
      title: st,
      points: (brief?.objectives?.[st] ?? []),
    }));
  }, [brief]);
  const [qIndex, setQIndex] = useState(0);
  const RUBRIC = useMemo(() => rubricFor(brief), [brief]);
  const RUBRIC_MAX = RUBRIC.reduce((s, r) => s + r.max, 0);
  const submitted = !!current?.submission?.submittedAt;
  const [view, setView] = useState('pdf');   // 'pdf' | 'answers'

  /* Grading state — autosaved locally on every change. */
  const [mode, setMode] = useState('rubric');                 // 'rubric' | 'manual'
  const [rubric, setRubric] = useState(() => RUBRIC.map(() => null));
  const [manualScore, setManualScore] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [saveState, setSaveState] = useState('idle');         // idle | saving | saved
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const saveTimer = useRef(null);

  /* Resume a draft (or seed from a published grade being revised). */
  useEffect(() => {
    if (!current) return;
    const draft = loadDraft(brief?.id, current.student.id);
    if (draft) {
      setMode(draft.mode || 'rubric');
      setRubric(RUBRIC.map((r, i) => draft.rubric?.[i]?.level ?? null));
      setManualScore(draft.manualScore ?? '');
      setFeedbackText(draft.feedbackText || '');
    } else if (current.grade != null) {
      // Revising a published grade: start from what was published.
      setManualScore(String(current.grade));
      setMode('manual');
      setFeedbackText(current.feedbackText || '');
    } else {
      setMode('rubric'); setRubric(RUBRIC.map(() => null)); setManualScore(''); setFeedbackText('');
    }
    setQIndex(0); setError(''); setSaveState('idle');
    setView(current?.submission?.submittedAt ? 'pdf' : 'answers');
  }, [current?.student?.id, brief?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* Autosave — debounced, local only. Publish is the server event. */
  const touch = useCallback((next) => {
    if (!current) return;
    setSaveState('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDraft({
        assignmentId: brief?.id,
        assignmentTitle: brief?.title || 'Activity',
        subject: brief?.subject || '',
        studentId: current.student.id,
        studentName: current.student.name,
        emoji: current.student.emoji || '🧑‍🎓',
        status: current.status,
        questionIndex: qIndex,
        mode: next.mode ?? mode,
        rubric: RUBRIC.map((r, i) => ({ name: r.name, max: r.max, level: (next.rubric ?? rubric)[i] })),
        manualScore: next.manualScore ?? manualScore,
        feedbackText: next.feedbackText ?? feedbackText,
      });
      setSaveState('saved');
    }, 600);
  }, [current, brief, qIndex, mode, rubric, manualScore, feedbackText]);

  const setRubricLevel = (ci, level) => {
    const next = rubric.map((v, i) => (i === ci ? level : v));
    setRubric(next); touch({ rubric: next, mode: 'rubric' });
    setMode('rubric');
  };
  const onManual = (v) => {
    const clean = v.replace(/[^0-9]/g, '').slice(0, 3);
    setManualScore(clean); setMode('manual'); touch({ manualScore: clean, mode: 'manual' });
  };
  const onFeedback = (v) => {
    setFeedbackText(v); touch({ feedbackText: v });
  };

  const rubricTotal = rubric.reduce((s, v) => s + (v || 0), 0);
  const rubricPct = Math.round((rubricTotal / RUBRIC_MAX) * 100);
  const finalScore = mode === 'manual'
    ? (manualScore === '' ? null : Math.min(100, Number(manualScore || 0)))
    : (rubric.every(v => v != null) ? rubricPct : null);

  const publish = async () => {
    if (finalScore == null || publishing) return;
    setPublishing(true); setError('');
    try {
      await apiPatch(`/api/self-study/${brief.id}/targets/${current.student.id}/grade`, {
        grade: finalScore,
        feedback: {
          text: feedbackText,
          mode,
          rubric: mode === 'rubric' ? RUBRIC.map((r, i) => ({ name: r.name, max: r.max, level: rubric[i] })) : [],
        },
      });
      clearDraft(brief.id, current.student.id);
      // Advance to the next ungraded student in the queue (the roster state
      // the page folds in keeps everyone else's grade valid here).
      const nextIdx = students.findIndex((st, i) => i > index && st.grade == null);
      if (nextIdx > -1) setIndex(nextIdx);
      onPublished?.(current.student.id, finalScore);
    } catch (e) {
      setError(e?.message || 'Could not publish — the draft is saved, try again.');
    } finally { setPublishing(false); }
  };

  if (!current) return null;
  const q = questions[Math.min(qIndex, questions.length - 1)];
  const published = current.grade != null;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 3600, background: '#F1EFF6', display: 'flex', flexDirection: 'column', fontFamily: FONT }}>
      {/* ── Topbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 22px', background: WHITE, borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <button onClick={onClose} title="Back to the workbench"
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: MUTED2, fontSize: 12.5, fontWeight: 700, fontFamily: FONT, padding: '4px 0' }}>
          <ArrowLeft size={14} /> Workbench
        </button>
        <div style={{ width: 1, height: 24, background: BORDER }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Grade submission — {brief?.title}
          </div>
          <div style={{ fontSize: 11, color: MUTED2, fontWeight: 600 }}>{brief?.subject} · {brief?.topic}</div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {/* Autosave label */}
          <span style={{ fontSize: 11.5, fontWeight: 700, color: saveState === 'saving' ? AMBER : MUTED2, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {saveState === 'saving'
              ? <><Loader2 size={11} style={{ animation: 'spin .8s linear infinite' }} /> Saving…</>
              : saveState === 'saved' ? <><Check size={11} color={GREEN} /> Draft saved</>
              : 'Draft autosaves locally'}
          </span>

          {/* Student stepper */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0}
              style={{ width: 30, height: 30, borderRadius: 999, border: `1px solid ${BORDER}`, background: WHITE, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: index === 0 ? 'not-allowed' : 'pointer', color: MUTED, opacity: index === 0 ? .35 : 1 }}>
              <ChevronLeft size={15} />
            </button>
            <span style={{ fontSize: 12.5, color: MUTED, fontWeight: 700, whiteSpace: 'nowrap' }}>{index + 1} of {students.length}</span>
            <button onClick={() => setIndex(i => Math.min(students.length - 1, i + 1))} disabled={index >= students.length - 1}
              style={{ width: 30, height: 30, borderRadius: 999, border: `1px solid ${BORDER}`, background: WHITE, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: index >= students.length - 1 ? 'not-allowed' : 'pointer', color: MUTED, opacity: index >= students.length - 1 ? .35 : 1 }}>
              <ChevronRight size={15} />
            </button>
          </div>

          <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999, background: published ? '#E6F6EE' : '#FCE9E2', color: published ? GREEN : '#E4572E', whiteSpace: 'nowrap' }}>
            {published ? `Graded · ${current.grade}%` : 'Ungraded'}
          </span>

          <button onClick={publish} disabled={finalScore == null || publishing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: 'none', cursor: finalScore == null ? 'not-allowed' : 'pointer', background: finalScore == null ? BORDER : PURPLE, color: WHITE, fontSize: 13, fontWeight: 800, fontFamily: FONT, opacity: finalScore == null ? .75 : 1 }}>
            {publishing ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Check size={13} />}
            Publish grade
          </button>
        </div>
      </div>

      {/* ── Workspace: paper + grading panel ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 22, maxWidth: 1440, margin: '0 auto', alignItems: 'start' }}>
          {/* Paper — the work, question by question */}
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(33,31,53,.04), 0 12px 28px -12px rgba(33,31,53,.18)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 20px', borderBottom: `1px solid ${BORDER}`, background: '#F7F6F3' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} role="tablist">
                {submitted && [['pdf', 'Submission PDF'], ['answers', 'Answers']].map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}
                    style={{ padding: '5px 12px', borderRadius: 999, border: `1px solid ${view === id ? PURPLE : BORDER}`, background: view === id ? '#F1ECFF' : WHITE, color: view === id ? PURPLE : MUTED, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                    {label}
                  </button>
                ))}
                {(!submitted || view === 'answers') && (
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: MUTED, marginLeft: submitted ? 6 : 0 }}>Question {Math.min(qIndex + 1, questions.length)} of {questions.length}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, visibility: submitted && view === 'pdf' ? 'hidden' : 'visible' }}>
                <button onClick={() => setQIndex(i => Math.max(0, i - 1))} disabled={qIndex === 0}
                  style={{ width: 28, height: 28, borderRadius: 999, border: `1px solid ${BORDER}`, background: WHITE, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: qIndex === 0 ? 'not-allowed' : 'pointer', color: MUTED, opacity: qIndex === 0 ? .35 : 1 }}><ChevronLeft size={14} /></button>
                <button onClick={() => setQIndex(i => Math.min(questions.length - 1, i + 1))} disabled={qIndex >= questions.length - 1}
                  style={{ width: 28, height: 28, borderRadius: 999, border: `1px solid ${BORDER}`, background: WHITE, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: qIndex >= questions.length - 1 ? 'not-allowed' : 'pointer', color: MUTED, opacity: qIndex >= questions.length - 1 ? .35 : 1 }}><ChevronRight size={14} /></button>
              </div>
            </div>
            {submitted && view === 'pdf' ? (
              <div style={{ padding: '14px 16px 18px' }}>
                <SubmissionPdfView targetId={current.targetId} version={current.submission.submittedAt} name={`${current.student.name} — ${brief?.title || 'submission'}`} />
              </div>
            ) : (
            <div style={{ padding: '24px 28px 30px' }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 19, fontWeight: 700, color: INK, fontFamily: 'Lora, Georgia, serif', lineHeight: 1.35 }}>{q.title}</h2>
              {q.points.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .6, color: MUTED2, marginBottom: 6 }}>WHAT THEY WERE ASKED</div>
                  {q.points.map((p, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13.5, color: MUTED, lineHeight: 1.6, marginBottom: 4 }}>
                      <span style={{ color: PURPLE, fontWeight: 900 }}>•</span>{p}
                    </div>
                  ))}
                </div>
              )}
              <SubmittedPaper current={current} brief={brief} only={Number.isInteger(q.index) ? q.index : null} />
            </div>
            )}
          </div>

          {/* Grading panel */}
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(33,31,53,.04), 0 12px 28px -12px rgba(33,31,53,.18)', overflow: 'hidden' }}>
            {/* Student header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 18px', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: `${PURPLE}18`, color: PURPLE, fontWeight: 900, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {initialsOf(current.student.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{current.student.name}</div>
                <div style={{ fontSize: 11, color: MUTED2, fontWeight: 600 }}>
                  @{current.student.username || '—'}{current.completedAt ? ` · finished ${fmtWhen(current.completedAt)}` : ' · still working'}
                </div>
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: current.status === 'complete' ? GREEN : BLUE, background: current.status === 'complete' ? '#E6F6EE' : '#EFF6FF', borderRadius: 999, padding: '4px 10px' }}>
                {current.status === 'complete' ? 'Submitted' : 'In progress'}
              </span>
            </div>

            <div style={{ padding: '16px 18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Mode toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: .6, color: MUTED2 }}>{mode === 'rubric' ? 'RUBRIC' : 'MANUAL SCORE'}</span>
                <button onClick={() => { const m = mode === 'rubric' ? 'manual' : 'rubric'; setMode(m); touch({ mode: m }); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: PURPLE, fontSize: 11.5, fontWeight: 800, fontFamily: FONT }}>
                  <PenLine size={11} /> {mode === 'rubric' ? 'Enter score manually instead' : 'Use rubric instead'}
                </button>
              </div>

              {mode === 'rubric' ? (
                <>
                  {RUBRIC.map((crit, ci) => (
                    <div key={crit.name}>
                      <div style={{ marginBottom: 6 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>{crit.name}</span>
                        <span style={{ fontSize: 11, color: MUTED2, marginLeft: 6 }}>{crit.desc}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 5 }}>
                        {Array.from({ length: crit.max + 1 }, (_, lvl) => (
                          <button key={lvl} onClick={() => setRubricLevel(ci, lvl)}
                            style={{ flex: 1, height: 32, borderRadius: 8, cursor: 'pointer', fontFamily: FONT,
                              border: `1.5px solid ${rubric[ci] === lvl ? PURPLE : BORDER}`,
                              background: rubric[ci] === lvl ? '#F1ECFF' : WHITE, color: rubric[ci] === lvl ? PURPLE : MUTED, fontSize: 12.5, fontWeight: 800 }}>
                            {lvl}
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: rubric[ci] != null ? PURPLE : 'transparent', marginTop: 4 }}>
                        {rubric[ci] != null ? `${rubric[ci]} — ${crit.labels?.[rubric[ci]] ?? `${rubric[ci]} of ${crit.max}`}` : '·'}
                      </div>
                    </div>
                  ))}
                  {/* Total */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, background: '#F7F6F3', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '11px 14px' }}>
                    <span style={{ fontSize: 26, fontWeight: 900, color: rubric.every(v => v != null) ? GREEN : INK, fontFamily: 'Lora, Georgia, serif' }}>
                      {rubricTotal}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: MUTED2 }}>/ {RUBRIC_MAX} {rubric.every(v => v != null) ? `· ${rubricPct}%` : '— pick a level in every row'}</span>
                  </div>
                </>
              ) : (
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, marginBottom: 6 }}>Score (0–100)</div>
                  <input value={manualScore} onChange={e => onManual(e.target.value)} placeholder="e.g. 78" inputMode="numeric"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 16, fontWeight: 800, fontFamily: FONT, color: INK }} />
                </div>
              )}

              {/* Written feedback */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: INK, display: 'inline-flex', alignItems: 'center', gap: 5 }}><FileText size={12} color={MUTED2} /> Written feedback</span>
                  <span style={{ fontSize: 10.5, color: MUTED2, fontWeight: 700 }}>{feedbackText.length}</span>
                </div>
                <textarea value={feedbackText} onChange={e => onFeedback(e.target.value)}
                  placeholder="What they did well, what to fix, what to try next…"
                  rows={5}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13, lineHeight: 1.6, fontFamily: FONT, color: INK, resize: 'vertical' }} />
              </div>

              {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700 }}>{error}</div>}

              <div style={{ fontSize: 11, color: MUTED2, lineHeight: 1.55, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Check size={11} color={GREEN} /> Publishing notifies {current.student.name.split(' ')[0]} and files this under their graded work. Drafts stay on this device until then.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
