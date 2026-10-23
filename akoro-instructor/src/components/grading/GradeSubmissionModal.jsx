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
 *
 * Marking: the PDF tab is a markup surface (ticks, crosses, comment pins,
 * highlights — SubmissionMarkup), autosaved to the API. Publishing the
 * grade sends the learner a marked copy: their PDF with the marks drawn
 * in, opened by the grade page.
 *
 * AI draft: when the activity has AI auto-grade on (or the grader asks),
 * the panel shows the AI's DRAFT marks — per question, per rubric row,
 * with feedback. "Apply" copies them into the panel; nothing is published
 * until the grader publishes.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Download } from 'lucide-react';
import { apiGet, apiPatch, apiPost, apiPut, apiDelete, apiBlob, downloadActivityFile, openActivityFile, fetchSubmissionPdf } from '../../services/api.js';
import SubmissionMarkup from './SubmissionMarkup.jsx';
import QuestionMarker, { QuestionRail, autoMarks, markTotals, pointsOf } from './QuestionMarker.jsx';
import AnswerPaper from '../paper/AnswerPaper.jsx';
import PaperFrame from '../paper/PaperFrame.jsx';
import { openSubmittedFile } from './openFile.js';
import { Sparkles } from 'lucide-react';
import { readChoice } from '../../lib/paper.js';
import { saveDraft, loadDraft, clearDraft } from './gradingDrafts.js';
import { GREEN, PURPLE, BLUE, RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

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
      <div style={{ background: C.bg, border: `1px dashed ${C.border}`, borderRadius: 10, padding: '12px 14px', fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>
        <b style={{ color: C.ink, fontWeight: 800 }}>
          {current.status === 'complete' ? `${current.student.name.split(' ')[0]} finished this activity` : `${current.student.name.split(' ')[0]} is still working on it`}
        </b>
        {current.completedAt && <> — completed {fmtWhen(current.completedAt)}</>}. No written submission was captured — grade against the brief with the panel on the right.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .6, color: C.muted2 }}>WHAT THEY SUBMITTED {current.completedAt && <span style={{ fontWeight: 600 }}>· {fmtWhen(current.completedAt)}</span>}</div>
      {(sub.text || '').trim() && (
        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderLeft: `3px solid ${PURPLE}`, borderRadius: 10, padding: '12px 14px' }}>
          <p style={{ margin: 0, fontSize: 13.5, color: C.ink, lineHeight: 1.65, whiteSpace: 'pre-wrap', fontFamily: C.font }}>{sub.text}</p>
        </div>
      )}
      {answerKeys.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {answerKeys.filter(k => sub.answers[k] !== '' && sub.answers[k] != null).sort((a, b) => Number(a) - Number(b)).map((k) => {
            const q = questions[Number(k)];
            const raw = sub.answers[k];
            const qMcq = !!q && Array.isArray(q.options);
            const pick = qMcq ? readChoice(q, raw) : null;
            const chosen = pick != null ? q.options[pick] : null;
            const correct = qMcq && q.correct != null && pick != null && Number(q.correct) === pick;
            return (
              <div key={k} style={{ background: C.surface, border: `1px solid ${correct === false && qMcq ? 'rgba(239,68,68,.35)' : C.border}`, borderRadius: 10, padding: '10px 13px' }}>
                {q && <div style={{ fontSize: 11, fontWeight: 800, color: C.muted2, marginBottom: 4 }}>Q{Number(k) + 1}. {qText(q)}</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: C.ink, fontFamily: C.font }}>
                  {qMcq && <span style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${correct ? GREEN : C.border}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 9, color: GREEN }}>{correct ? <Ico ti="ti-check" size={10} /> : null}</span>}
                  {chosen != null ? `${letterOf(pick)}. ${chosen}` : String(raw)}
                  {qMcq && correct && <span style={{ fontSize: 10, fontWeight: 800, color: GREEN, background: tint(12, GREEN), borderRadius: 999, padding: '2px 8px' }}>correct</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {files.map((f) => (
            <div key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, fontFamily: C.font }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: `${PURPLE}14`, color: PURPLE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ico ti="ti-file-text" size={13} /></span>
              <span style={{ textAlign: 'left' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: C.ink, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ display: 'block', fontSize: 10, fontWeight: 700, color: C.muted2 }}>{fmtSize(f.size)}</span>
              </span>
              <button onClick={() => openActivityFile(f.id).catch(() => {})} title="Open" aria-label={`Open ${f.name}`}
                style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: PURPLE, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti="ti-external-link" size={13} /></button>
              <button onClick={() => downloadActivityFile(f.id, f.name).catch(() => {})} title="Download" aria-label={`Download ${f.name}`}
                style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti="ti-download" size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* "2 h", "3 days" — how late. */
const fmtLate = (mins) => (mins < 60 ? `${mins} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`);

/* A question paper's answers — the same paper-with-answers the learner
   reviewed and handed in: each answer (typed text, the option it reads as,
   its files) under its question, with the key and the marks so far. The
   question being marked scrolls into view. */
function PaperAnswers({ current, brief, marks, focus }) {
  const sub = current.submission ?? {};
  const questions = brief?.details?.questions || [];
  const files = sub.files?.length ? sub.files : (current.files ?? []);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    document.getElementById(`answer-paper-q${focus + 1}`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [focus]);
  const rows = Object.entries(marks || {})
    .filter(([, m]) => m && m.awarded != null && m.awarded !== '')
    .map(([i, m]) => ({ index: Number(i), awarded: m.awarded, max: pointsOf(questions[Number(i)]), comment: m.comment || '' }));
  const open = openSubmittedFile;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .6, color: C.muted2 }}>WHAT THEY SUBMITTED {current.completedAt && <span style={{ fontWeight: 600 }}>· {fmtWhen(current.completedAt)}</span>}</div>
      {(sub.text || '').trim() && (
        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderLeft: `3px solid ${PURPLE}`, borderRadius: 10, padding: '12px 14px' }}>
          <p style={{ margin: 0, fontSize: 13.5, color: C.ink, lineHeight: 1.65, whiteSpace: 'pre-wrap', fontFamily: C.font }}>{sub.text}</p>
        </div>
      )}
      {sub.late && <div style={{ alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 800, color: '#B45309', background: tint(14, '#F59E0B'), borderRadius: 999, padding: '3px 10px' }}>Handed in late{sub.lateByMinutes ? ` · ${fmtLate(sub.lateByMinutes)} after the due date` : ''}</div>}
      <AnswerPaper details={brief.details} title={brief?.title || ''} answers={sub.answers || {}} files={files} marks={rows} showKey label="Answer" onOpenFile={open} sans={C.font} />
    </div>
  );
}

/* The whole submission as one PDF — fetched as a blob (cookie auth) and
   drawn by SubmissionMarkup, where the grader marks it up. The original
   opens in a tab or downloads; the marked copy can be previewed. */
function SubmissionPdfView({ targetId, version, name, marks, onMarks, markState }) {
  const [state, setState] = useState({ status: 'loading', blob: null, url: null, error: '' });
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    let alive = true, url = null;
    setState({ status: 'loading', blob: null, url: null, error: '' });
    fetchSubmissionPdf(targetId)
      .then((blob) => { url = URL.createObjectURL(blob); if (alive) setState({ status: 'ready', blob, url, error: '' }); })
      .catch((e) => { if (alive) setState({ status: 'error', blob: null, url: null, error: e?.message || 'Could not load the PDF.' }); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [targetId, version]);

  const previewMarked = async () => {
    const tab = window.open('', '_blank');
    setPreviewing(true);
    try {
      const u = URL.createObjectURL(await apiBlob(`/api/self-study/targets/${targetId}/marked.pdf`));
      if (tab) tab.location.href = u; else window.location.assign(u);
      setTimeout(() => URL.revokeObjectURL(u), 60_000);
    } catch { tab?.close(); }
    finally { setPreviewing(false); }
  };

  if (state.status === 'loading') {
    return <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: C.muted, fontSize: 13, fontWeight: 700 }}><Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> Preparing the submission PDF…</div>;
  }
  if (state.status === 'error') {
    return <div style={{ background: C.bg, border: `1px dashed ${C.border}`, borderRadius: 10, padding: '12px 14px', fontSize: 12.5, color: RED, fontWeight: 700 }}>{state.error} — the Answers tab still shows the work.</div>;
  }
  const fileName = `${(name || 'submission').replace(/[^\w .-]/g, '').trim() || 'submission'}.pdf`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 14, justifyContent: 'flex-end' }}>
        <button type="button" onClick={previewMarked} disabled={previewing} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 800, color: PURPLE, background: 'none', border: 'none', cursor: 'pointer', fontFamily: C.font, padding: 0 }}>
          {previewing ? <Ico ti="ti-loader-2" size={12} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-file-text" size={12} />} Preview marked copy
        </button>
        <a href={state.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 800, color: C.muted, textDecoration: 'none' }}><Ico ti="ti-external-link" size={12} /> Original</a>
        <a href={state.url} download={fileName} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 800, color: C.muted, textDecoration: 'none' }}><Ico ti="ti-download" size={12} /> Download</a>
      </div>
      <SubmissionMarkup blob={state.blob} marks={marks} onChange={onMarks} saveState={markState} />
    </div>
  );
}

/* The AI's draft marks — shown for approval, never published by itself. */
function AiDraftCard({ ai, onApply, onRequest, requesting }) {
  const box = { border: `1px solid ${PURPLE}33`, background: tint(4), borderRadius: 10, padding: '11px 13px' };
  const head = (extra) => <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 900, letterSpacing: .5, color: PURPLE }}><Ico ti="ti-sparkles" size={12} /> AI DRAFT {extra}</div>;
  if (!ai || ai.status === 'failed') {
    return (
      <div style={box}>
        {head()}
        {ai?.status === 'failed' && <div style={{ fontSize: 12, color: RED, fontWeight: 700, marginTop: 6 }}>{ai.error || 'The draft failed.'}</div>}
        <div style={{ fontSize: 12, color: C.muted, margin: '6px 0 8px', lineHeight: 1.5 }}>Let AI suggest marks per answer, rubric levels and feedback. You approve them before anything is published.</div>
        <button type="button" onClick={onRequest} disabled={requesting}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: 'none', background: PURPLE, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
          {requesting ? <Ico ti="ti-loader-2" size={12} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-sparkles" size={12} />} Draft marks with AI
        </button>
      </div>
    );
  }
  if (ai.status === 'making') {
    return <div style={box}>{head()}<div style={{ fontSize: 12, color: C.muted, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}><Ico ti="ti-loader-2" size={12} style={{ animation: 'spin .8s linear infinite' }} /> Reading the submission and drafting marks…</div></div>;
  }
  return (
    <div style={box}>
      {head(ai.score != null ? <span style={{ marginLeft: 'auto', fontSize: 16, color: C.ink, letterSpacing: 0 }}>{ai.score}%</span> : null)}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
        {(ai.questions || []).map((q) => (
          <div key={q.index} style={{ fontSize: 12, color: C.ink, lineHeight: 1.45 }}>
            <b>Q{q.index + 1}</b> {q.awarded}/{q.max}{q.auto ? <span style={{ color: C.muted2, fontWeight: 700 }}> · auto</span> : null} <span style={{ color: C.muted }}>— {q.why}</span>
          </div>
        ))}
        {(ai.rubric || []).map((r) => (
          <div key={r.name} style={{ fontSize: 12, color: C.ink, lineHeight: 1.45 }}>
            <b>{r.name}</b> {r.level ?? '–'}/{r.max}{r.why ? <span style={{ color: C.muted }}> — {r.why}</span> : null}
          </div>
        ))}
        {ai.feedback && <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic', lineHeight: 1.5 }}>“{ai.feedback}”</div>}
        {(ai.notes || []).map((n, i) => <div key={i} style={{ fontSize: 11, color: '#B45309', fontWeight: 700, display: 'flex', gap: 5, alignItems: 'flex-start' }}><Ico ti="ti-alert-triangle" size={12} style={{ marginTop: 1, flexShrink: 0 }} /> {n}</div>)}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
        <button type="button" onClick={onApply}
          style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: PURPLE, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>Apply to the panel</button>
        <button type="button" onClick={onRequest} disabled={requesting}
          style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>Redraft</button>
      </div>
    </div>
  );
}

export default function GradeSubmissionModal({
  assignment, students, initialIndex, onClose, onPublished, onUnpublished, onMarkup, onAiGrade,
}) {
  /* students: the gradeable queue [{ student:{id,name,username,emoji}, status, completedAt, grade }] */
  // The learner on screen is kept by id, not position: the page re-sorts the
  // queue after each publish (graded last), so a position would drift.
  const [sid, setSid] = useState(() => students[Math.min(Math.max(initialIndex ?? 0, 0), Math.max(students.length - 1, 0))]?.student.id ?? null);
  const found = students.findIndex((st) => st.student.id === sid);
  const index = found > -1 ? found : 0;
  const setIndex = (v) => {
    const i = typeof v === 'function' ? v(index) : v;
    const st = students[Math.max(0, Math.min(students.length - 1, i))];
    if (st) setSid(st.student.id);
  };
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
  const [view, setView] = useState('pdf');   // 'pdf' | 'answers' (the paper, one question at a time)
  // The left paper's question follows the step being marked (and back).
  useEffect(() => { if (Array.isArray(brief?.details?.questions) && brief.details.questions.length && qIndex < brief.details.questions.length) setStep((s) => (s < brief.details.questions.length ? qIndex : s)); }, [qIndex]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* Marks on the submission PDF — autosaved to the API (debounced). */
  const [marks, setMarks] = useState(() => current?.markup?.marks ?? []);
  const [markState, setMarkState] = useState('idle');   // idle | saving | saved | error
  const markTimer = useRef(null);
  const onMarks = useCallback((next) => {
    setMarks(next);
    setMarkState('saving');
    clearTimeout(markTimer.current);
    const sid = current?.student?.id;
    markTimer.current = setTimeout(() => {
      apiPut(`/api/self-study/${brief.id}/targets/${sid}/markup`, { marks: next })
        .then(() => { setMarkState('saved'); onMarkup?.(sid, next); })
        .catch(() => setMarkState('error'));
    }, 900);
  }, [brief?.id, current?.student?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* The AI's draft for this learner (polled while it's being made). */
  const [ai, setAi] = useState(current?.aiGrade ?? null);
  const [aiRequesting, setAiRequesting] = useState(false);
  useEffect(() => {
    if (ai?.status !== 'making' || !brief?.id || !current) return undefined;
    const sid = current.student.id;
    const t = setInterval(() => {
      apiGet(`/api/self-study/${brief.id}`).then((d) => {
        const row = (d?.data?.targets ?? []).find((x) => x.student_id === sid);
        if (row?.ai_grade && row.ai_grade.status !== 'making') { setAi(row.ai_grade); onAiGrade?.(sid, row.ai_grade); }
      }).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [ai?.status, brief?.id, current?.student?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const requestAi = async () => {
    setAiRequesting(true);
    try {
      await apiPost(`/api/self-study/${brief.id}/targets/${current.student.id}/ai-grade`, {});
      setAi({ status: 'making' });
    } catch (e) {
      // 409 = a draft is already on its way (auto-grade after submit): wait for it.
      if (e?.status === 409 || /already being drafted/i.test(e?.message || '')) setAi({ status: 'making' });
      else setAi({ status: 'failed', error: e?.message || 'Could not start the draft.' });
    } finally { setAiRequesting(false); }
  };

  /* Marked question by question (activities with questions): Q1 … Qn, then
     Review. step === questions.length is the Review step. */
  const qList = useMemo(() => (Array.isArray(brief?.details?.questions) ? brief.details.questions : []), [brief]);
  const hasQuestions = qList.length > 0;
  const [qMarks, setQMarks] = useState({});   // index → { awarded, comment, auto? }
  const [step, setStep] = useState(0);
  // The submission as the server's paper template: one question at a time
  // while marking (the step), the whole paper on Review.
  const [paperHtml, setPaperHtml] = useState(null);
  const paperOnly = Array.isArray(brief?.details?.questions) && step < brief.details.questions.length ? step : null;
  useEffect(() => {
    if (!current?.targetId || !current?.submission?.submittedAt || !(brief?.details?.questions || []).length) { setPaperHtml(null); return undefined; }
    let live = true;
    apiBlob(`/api/self-study/targets/${current.targetId}/submission.html?embed=1${paperOnly != null ? `&only=${paperOnly}` : ''}`)
      .then((b) => b.text()).then((t) => { if (live) setPaperHtml(t); })
      .catch(() => { if (live) setPaperHtml(null); });
    return () => { live = false; };
  }, [current?.targetId, current?.submission?.submittedAt, paperOnly, brief]);

  /* Grading state — autosaved locally on every change. */
  const [mode, setMode] = useState('rubric');                 // 'questions' | 'rubric' | 'manual'
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
    const saved = loadDraft(brief?.id, current.student.id);
    // A grade published after this device's draft (another device, the gradebook) wins.
    const draft = saved && current.gradedAt && Date.parse(current.gradedAt) > (saved.savedAt || 0) ? null : saved;
    // Question marks: the draft's, else what was published, else the key's.
    const fromRows = (rows) => Object.fromEntries((rows || []).filter((m) => Number.isInteger(m?.index)).map((m) => [m.index, { awarded: m.awarded ?? null, comment: m.comment || '' }]));
    const seeded = draft?.questions?.length ? fromRows(draft.questions)
      : current.feedbackQuestions?.length ? fromRows(current.feedbackQuestions)
      : autoMarks(qList, current.submission?.answers || {}, current.submission?.files || []);
    setQMarks(seeded);
    setStep(Math.min(draft?.step ?? 0, qList.length));
    if (draft) {
      setMode(draft.mode || (hasQuestions ? 'questions' : 'rubric'));
      setRubric(RUBRIC.map((r, i) => draft.rubric?.[i]?.level ?? null));
      setManualScore(draft.manualScore ?? '');
      setFeedbackText(draft.feedbackText || '');
    } else if (current.grade != null) {
      // Revising a published grade: start from what was published, in the
      // mode it was published in (so re-publishing keeps the same score).
      setManualScore(String(current.grade));
      const was = current.feedbackMode || (current.feedbackQuestions?.some((m) => m.awarded != null) ? 'questions' : 'manual');
      setMode(was === 'rubric' && !(current.feedbackRubric || []).length ? 'manual' : was);
      setRubric(RUBRIC.map((r) => (current.feedbackRubric || []).find((x) => x.name === r.name)?.level ?? null));
      setFeedbackText(current.feedbackText || '');
    } else {
      setMode(hasQuestions ? 'questions' : 'rubric'); setRubric(RUBRIC.map(() => null)); setManualScore(''); setFeedbackText('');
    }
    setQIndex(Math.min(draft?.step ?? 0, Math.max(0, qList.length - 1))); setError(''); setSaveState('idle');
    // Assignments with questions are marked on the paper, one question at a time.
    setView(current?.submission?.submittedAt && !(brief?.details?.questions || []).length ? 'pdf' : 'answers');
    clearTimeout(markTimer.current);
    setMarks(current?.markup?.marks ?? []); setMarkState('idle');
    setAi(current?.aiGrade ?? null);
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
        emoji: current.student.emoji || '',
        status: current.status,
        questionIndex: qIndex,
        mode: next.mode ?? mode,
        rubric: RUBRIC.map((r, i) => ({ name: r.name, max: r.max, level: (next.rubric ?? rubric)[i] })),
        manualScore: next.manualScore ?? manualScore,
        feedbackText: next.feedbackText ?? feedbackText,
        questions: Object.entries(next.qMarks ?? qMarks).map(([i, m]) => ({ index: Number(i), awarded: m.awarded ?? null, comment: m.comment || '' })),
        step: next.step ?? step,
      });
      setSaveState('saved');
    }, 600);
  }, [current, brief, qIndex, mode, rubric, manualScore, feedbackText, qMarks, step]);

  /* One question's mark / comment (and the step the grader is on). */
  const setMark = (i, patch) => {
    const next = { ...qMarks, [i]: { ...(qMarks[i] || {}), ...patch, auto: false } };
    setQMarks(next);
    touch({ qMarks: next });
  };
  const goStep = (i) => {
    const s2 = Math.max(0, Math.min(qList.length, i));
    setStep(s2); touch({ step: s2 });
    if (s2 < qList.length) { setQIndex(s2); }
  };

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

  /* Copy the AI draft into the panel: rubric levels when the draft scored
     every row of THIS rubric, else its score as a manual score; feedback too. */
  const applyAi = () => {
    if (!ai || ai.status !== 'ready') return;
    if (hasQuestions && ai.questions?.length) {
      // Marked question by question: the draft's marks fill each question
      // (comments stay the grader's own); the score follows from them.
      const next = { ...qMarks };
      for (const aq of ai.questions) next[aq.index] = { ...(next[aq.index] || {}), awarded: aq.awarded, auto: false };
      setQMarks(next); setMode('questions');
      if (ai.feedback) setFeedbackText(ai.feedback);
      touch({ qMarks: next, mode: 'questions', feedbackText: ai.feedback || feedbackText });
      return;
    }
    const levels = RUBRIC.map((r) => ai.rubric?.find((x) => x.name.toLowerCase() === r.name.toLowerCase())?.level ?? null);
    if (levels.every((v) => v != null) && ai.rubric?.length) {
      setRubric(levels); setMode('rubric'); touch({ rubric: levels, mode: 'rubric', feedbackText: ai.feedback || feedbackText });
    } else if (ai.score != null) {
      setManualScore(String(ai.score)); setMode('manual'); touch({ manualScore: String(ai.score), mode: 'manual', feedbackText: ai.feedback || feedbackText });
    }
    if (ai.feedback) setFeedbackText(ai.feedback);
  };

  const rubricTotal = rubric.reduce((s, v) => s + (v || 0), 0);
  const rubricPct = Math.round((rubricTotal / RUBRIC_MAX) * 100);
  const totals = markTotals(qList, qMarks);
  const finalScore = mode === 'questions'
    ? (totals.complete ? totals.pct : null)
    : mode === 'manual'
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
          // Each question's mark and comment (the learner sees them under
          // each question, and on the marked copy's grade page).
          // Questions not marked (rubric / score modes) are left out, never sent as 0.
          questions: hasQuestions ? qList.map((qq, i) => ({ index: i, awarded: qMarks[i]?.awarded ?? null, max: pointsOf(qq), comment: qMarks[i]?.comment || '' }))
            .filter((m) => (m.awarded != null && m.awarded !== '') || m.comment.trim()) : [],
        },
      });
      clearDraft(brief.id, current.student.id);
      // Advance to the next ungraded student in the queue (the roster state
      // the page folds in keeps everyone else's grade valid here).
      const nextIdx = students.findIndex((st, i) => i > index && st.grade == null);
      if (nextIdx > -1) setIndex(nextIdx);
      onPublished?.(current.student.id, finalScore, {
        text: feedbackText, mode,
        rubric: mode === 'rubric' ? RUBRIC.map((r, i) => ({ name: r.name, max: r.max, level: rubric[i] })) : [],
        questions: hasQuestions ? qList.map((qq, i) => ({ index: i, awarded: qMarks[i]?.awarded ?? null, max: pointsOf(qq), comment: qMarks[i]?.comment || '' })).filter((m) => m.awarded != null || m.comment) : [],
      });
    } catch (e) {
      setError(e?.message || 'Could not publish — the draft is saved, try again.');
    } finally { setPublishing(false); }
  };

  const unpublish = async () => {
    if (publishing || !window.confirm(`Take back ${current.student.name}'s grade? They stop seeing it; your marks stay here as a draft.`)) return;
    setPublishing(true); setError('');
    try {
      await apiDelete(`/api/self-study/${brief.id}/targets/${current.student.id}/grade`);
      // Keep what was published as this device's draft, to re-publish later.
      touch({});
      onUnpublished?.(current.student.id);
    } catch (e) {
      setError(e?.message || 'Could not unpublish — try again.');
    } finally { setPublishing(false); }
  };

  if (!current) return null;
  const q = questions[Math.min(qIndex, questions.length - 1)];
  const published = current.grade != null;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 3600, background: tint(7), display: 'flex', flexDirection: 'column', fontFamily: C.font }}>
      {/* ── Topbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 22px', background: C.surface, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <button onClick={onClose} title="Back to the workbench"
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: C.muted2, fontSize: 12.5, fontWeight: 700, fontFamily: C.font, padding: '4px 0' }}>
          <Ico ti="ti-arrow-left" size={14} /> Workbench
        </button>
        <div style={{ width: 1, height: 24, background: C.border }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Grade submission — {brief?.title}
          </div>
          <div style={{ fontSize: 11, color: C.muted2, fontWeight: 600 }}>{brief?.subject} · {brief?.topic}</div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {/* Autosave label */}
          <span style={{ fontSize: 11.5, fontWeight: 700, color: saveState === 'saving' ? C.brand : C.muted2, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {saveState === 'saving'
              ? <><Ico ti="ti-loader-2" size={11} style={{ animation: 'spin .8s linear infinite' }} /> Saving…</>
              : saveState === 'saved' ? <><Ico ti="ti-check" size={11} color={GREEN} /> Draft saved</>
              : 'Draft autosaves locally'}
          </span>

          {/* Student stepper */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0}
              style={{ width: 30, height: 30, borderRadius: 999, border: `1px solid ${C.border}`, background: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: index === 0 ? 'not-allowed' : 'pointer', color: C.muted, opacity: index === 0 ? .35 : 1 }}>
              <Ico ti="ti-chevron-left" size={15} />
            </button>
            <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 700, whiteSpace: 'nowrap' }}>{index + 1} of {students.length}</span>
            <button onClick={() => setIndex(i => Math.min(students.length - 1, i + 1))} disabled={index >= students.length - 1}
              style={{ width: 30, height: 30, borderRadius: 999, border: `1px solid ${C.border}`, background: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: index >= students.length - 1 ? 'not-allowed' : 'pointer', color: C.muted, opacity: index >= students.length - 1 ? .35 : 1 }}>
              <Ico ti="ti-chevron-right" size={15} />
            </button>
          </div>

          <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999, background: published ? '#E6F6EE' : '#FCE9E2', color: published ? GREEN : '#E4572E', whiteSpace: 'nowrap' }}>
            {published ? `Graded · ${current.grade}%` : 'Ungraded'}
          </span>

          {published && (
            <button onClick={unpublish} disabled={publishing} title="Take the grade back — the learner stops seeing it; your marks stay as a draft"
              style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12.5, fontWeight: 800, fontFamily: C.font, cursor: publishing ? 'default' : 'pointer' }}>
              Unpublish
            </button>
          )}
          <button onClick={publish} disabled={finalScore == null || publishing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: 'none', cursor: finalScore == null ? 'not-allowed' : 'pointer', background: finalScore == null ? C.border : PURPLE, color: '#fff', fontSize: 13, fontWeight: 800, fontFamily: C.font, opacity: finalScore == null ? .75 : 1 }}>
            {publishing ? <Ico ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-check" size={13} />}
            Publish grade
          </button>
        </div>
      </div>

      {/* ── Workspace: paper + grading panel ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 22, maxWidth: 1440, margin: '0 auto', alignItems: 'start' }}>
          {/* Paper — the work, question by question */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(33,31,53,.04), 0 12px 28px -12px rgba(33,31,53,.18)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 20px', borderBottom: `1px solid ${C.border}`, background: C.bg }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} role="tablist">
                {submitted && [['answers', hasQuestions ? 'Paper' : 'Answers'], ['pdf', 'Submission PDF']].map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}
                    style={{ padding: '5px 12px', borderRadius: 999, border: `1px solid ${view === id ? PURPLE : C.border}`, background: view === id ? '#F1ECFF' : C.surface, color: view === id ? PURPLE : C.muted, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
                    {label}
                  </button>
                ))}
                {(!submitted || view === 'answers') && (
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: C.muted, marginLeft: submitted ? 6 : 0 }}>Question {Math.min(qIndex + 1, questions.length)} of {questions.length}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, visibility: submitted && view === 'pdf' ? 'hidden' : 'visible' }}>
                <button onClick={() => setQIndex(i => Math.max(0, i - 1))} disabled={qIndex === 0}
                  style={{ width: 28, height: 28, borderRadius: 999, border: `1px solid ${C.border}`, background: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: qIndex === 0 ? 'not-allowed' : 'pointer', color: C.muted, opacity: qIndex === 0 ? .35 : 1 }}><Ico ti="ti-chevron-left" size={14} /></button>
                <button onClick={() => setQIndex(i => Math.min(questions.length - 1, i + 1))} disabled={qIndex >= questions.length - 1}
                  style={{ width: 28, height: 28, borderRadius: 999, border: `1px solid ${C.border}`, background: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: qIndex >= questions.length - 1 ? 'not-allowed' : 'pointer', color: C.muted, opacity: qIndex >= questions.length - 1 ? .35 : 1 }}><Ico ti="ti-chevron-right" size={14} /></button>
              </div>
            </div>
            {submitted && view === 'pdf' ? (
              <div style={{ padding: '14px 16px 18px' }}>
                <SubmissionPdfView targetId={current.targetId} version={current.submission.submittedAt} name={`${current.student.name} — ${brief?.title || 'submission'}`}
                  marks={marks} onMarks={onMarks} markState={markState} />
              </div>
            ) : (
            hasQuestions && (Object.keys(current.submission?.answers || {}).length > 0 || (current.submission?.files || current.files || []).length > 0) ? (
              paperHtml ? (
                <PaperFrame html={paperHtml} marks={qMarks} title={`${current.student.name} — paper`} />
              ) : (
              <div style={{ padding: '18px 20px 24px' }}>
                <PaperAnswers current={current} brief={brief} marks={qMarks} focus={qIndex} />
              </div>
              )
            ) : (
            <div style={{ padding: '24px 28px 30px' }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 19, fontWeight: 700, color: C.ink, fontFamily: 'Lora, Georgia, serif', lineHeight: 1.35 }}>{q.title}</h2>
              {q.points.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .6, color: C.muted2, marginBottom: 6 }}>WHAT THEY WERE ASKED</div>
                  {q.points.map((p, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13.5, color: C.muted, lineHeight: 1.6, marginBottom: 4 }}>
                      <span style={{ color: PURPLE, fontWeight: 900 }}>•</span>{p}
                    </div>
                  ))}
                </div>
              )}
              <SubmittedPaper current={current} brief={brief} only={Number.isInteger(q.index) ? q.index : null} />
            </div>
            ))}
          </div>

          {/* Grading panel */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(33,31,53,.04), 0 12px 28px -12px rgba(33,31,53,.18)', overflow: 'hidden' }}>
            {/* Student header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: `${PURPLE}18`, color: PURPLE, fontWeight: 900, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {initialsOf(current.student.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{current.student.name}</div>
                <div style={{ fontSize: 11, color: C.muted2, fontWeight: 600 }}>
                  @{current.student.username || '—'}{current.completedAt ? ` · finished ${fmtWhen(current.completedAt)}` : ' · still working'}
                </div>
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: current.status === 'complete' ? GREEN : BLUE, background: current.status === 'complete' ? '#E6F6EE' : '#EFF6FF', borderRadius: 999, padding: '4px 10px' }}>
                {current.status === 'complete' ? 'Submitted' : 'In progress'}
              </span>
            </div>

            <div style={{ padding: '16px 18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {hasQuestions && <QuestionRail questions={qList} step={step} setStep={goStep} marks={qMarks} />}

              {/* The AI draft is offered on every step, not only Review. */}
              {submitted && <AiDraftCard ai={ai} onApply={applyAi} onRequest={requestAi} requesting={aiRequesting} />}

              {hasQuestions && step < qList.length ? (
                <QuestionMarker questions={qList} paper={brief?.details} step={step} setStep={goStep} marks={qMarks} setMark={setMark}
                  answers={current.submission?.answers || {}} files={current.submission?.files || current.files || []} ai={ai} />
              ) : (<>

              {/* Review: every question's mark at a glance (tap to change one) */}
              {hasQuestions && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .6, color: C.muted2, marginBottom: 6 }}>REVIEW · MARKS BY QUESTION</div>
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
                    {qList.map((qq, i) => {
                      const m = qMarks[i];
                      const done = m?.awarded != null && m.awarded !== '';
                      return (
                        <button key={i} type="button" onClick={() => goStep(i)}
                          style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderTop: i ? `1px solid ${C.border}` : 'none', background: C.surface, cursor: 'pointer', fontFamily: C.font }}>
                          <span style={{ fontSize: 12, fontWeight: 900, color: C.muted2, width: 26, flexShrink: 0 }}>Q{i + 1}</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(typeof qq === 'object' && qq ? qq.q : qq) || `Question ${i + 1}`}</span>
                            {m?.comment && <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>“{m.comment}”</span>}
                          </span>
                          <span style={{ fontSize: 12.5, fontWeight: 900, color: done ? C.ink : '#E4572E', whiteSpace: 'nowrap' }}>{done ? `${m.awarded} / ${pointsOf(qq)}` : 'not marked'}</span>
                        </button>
                      );
                    })}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '10px 12px', background: C.bg, borderTop: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: C.muted2 }}>Total</span>
                      <span style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 900, color: totals.complete ? GREEN : C.ink, fontFamily: 'Lora, Georgia, serif' }}>{totals.got}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted2 }}>/ {totals.max}{totals.complete ? ` · ${totals.pct}%` : ' — mark every question'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* How the score is set */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: .6, color: C.muted2, marginRight: 'auto' }}>SCORE FROM</span>
                {[...(hasQuestions ? [['questions', 'Question marks']] : []), ['rubric', 'Rubric'], ['manual', 'Manual']].map(([id, label]) => (
                  <button key={id} type="button" onClick={() => { setMode(id); touch({ mode: id }); }} aria-pressed={mode === id}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 999, border: `1.5px solid ${mode === id ? PURPLE : C.border}`, background: mode === id ? '#F1ECFF' : C.surface, color: mode === id ? PURPLE : C.muted, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
                    {id === 'manual' && <Ico ti="ti-pencil" size={10} />}{label}
                  </button>
                ))}
              </div>

              {mode === 'questions' ? (
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                  The score is the question marks: {totals.got} of {totals.max}{totals.complete ? ` = ${totals.pct}%` : ' — mark every question to publish'}.
                </div>
              ) : mode === 'rubric' ? (
                <>
                  {RUBRIC.map((crit, ci) => (
                    <div key={crit.name}>
                      <div style={{ marginBottom: 6 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{crit.name}</span>
                        <span style={{ fontSize: 11, color: C.muted2, marginLeft: 6 }}>{crit.desc}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 5 }}>
                        {Array.from({ length: crit.max + 1 }, (_, lvl) => (
                          <button key={lvl} onClick={() => setRubricLevel(ci, lvl)}
                            style={{ flex: 1, height: 32, borderRadius: 8, cursor: 'pointer', fontFamily: C.font,
                              border: `1.5px solid ${rubric[ci] === lvl ? PURPLE : C.border}`,
                              background: rubric[ci] === lvl ? '#F1ECFF' : C.surface, color: rubric[ci] === lvl ? PURPLE : C.muted, fontSize: 12.5, fontWeight: 800 }}>
                            {lvl}
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: rubric[ci] != null ? PURPLE : 'transparent', marginTop: 4 }}>
                        {rubric[ci] != null ? (crit.labels ? `${rubric[ci]} — ${crit.labels[rubric[ci]]}` : `${rubric[ci]} of ${crit.max}`) : '·'}
                      </div>
                    </div>
                  ))}
                  {/* Total */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 14px' }}>
                    <span style={{ fontSize: 26, fontWeight: 900, color: rubric.every(v => v != null) ? GREEN : C.ink, fontFamily: 'Lora, Georgia, serif' }}>
                      {rubricTotal}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.muted2 }}>/ {RUBRIC_MAX} {rubric.every(v => v != null) ? `· ${rubricPct}%` : '— pick a level in every row'}</span>
                  </div>
                </>
              ) : (
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, marginBottom: 6 }}>Score (0–100)</div>
                  <input value={manualScore} onChange={e => onManual(e.target.value)} placeholder="e.g. 78" inputMode="numeric"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${C.border}`, outline: 'none', fontSize: 16, fontWeight: 800, fontFamily: C.font, color: C.ink }} />
                </div>
              )}

              {/* Written feedback */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Ico ti="ti-file-text" size={12} color={C.muted2} /> Written feedback</span>
                  <span style={{ fontSize: 10.5, color: C.muted2, fontWeight: 700 }}>{feedbackText.length}</span>
                </div>
                <textarea value={feedbackText} onChange={e => onFeedback(e.target.value)}
                  placeholder="What they did well, what to fix, what to try next…"
                  rows={5}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${C.border}`, outline: 'none', fontSize: 13, lineHeight: 1.6, fontFamily: C.font, color: C.ink, resize: 'vertical' }} />
              </div>

              {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700 }}>{error}</div>}

              <div style={{ fontSize: 11, color: C.muted2, lineHeight: 1.55, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Ico ti="ti-check" size={11} color={GREEN} /> Publishing notifies {current.student.name.split(' ')[0]} and files this under their graded work. Drafts stay on this device until then.
              </div>
              </>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
