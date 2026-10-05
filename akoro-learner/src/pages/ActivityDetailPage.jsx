import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchMyActivities, completeActivity, uploadActivityFile, removeActivityFile, downloadActivityFile,
} from '../services/activityApi.js';
import { Icon } from '../components/common/Icons.jsx';
import { BRAND, RED, GREEN, GOLD } from '../constants.js';
import Spinner from '../components/common/Spinner.jsx';

/**
 * ActivityDetailPage — the full-screen detail view for one activity, ported
 * from the reference design (reference/activitiesdetails.md) onto the learner
 * app's tokens (--ak-* vars, Nunito, BRAND).
 *
 * Everything except typed answers and file attachments is REAL data from
 * /api/self-study/mine: the hero (type gradient, due/status chips), the
 * description, the stats, the multi-stage roadmap (server-derived per-stage
 * state), the graded banner (published grade + feedback), and the submit
 * action (POST /api/self-study/:id/complete — the same status flip the
 * teacher's class view reads).
 *
 * The reference's question stepper runs whenever the brief actually carries
 * questions (details.questions) — autosaved locally per activity, reviewed,
 * then submitted. The free-text answer box and the file dropzone are the
 * same flow for briefs without questions; answers and file names persist on
 * this device until their server endpoints land.
 */

/* ── Type identity: gradient + icon + label (reference TYPE_META) ───────── */
const TYPE = {
  assignment:  { label: 'Assignment',   icon: 'ti-edit',      light: '#8B5CF6', mid: BRAND,     dark: '#4C1DCC' },
  project:     { label: 'Project',      icon: 'ti-folder',    light: '#34D399', mid: '#10B981', dark: '#047857' },
  self_study:  { label: 'Self study',   icon: 'ti-book-2',    light: '#2DD4BF', mid: '#0D9488', dark: '#0F766E' },
  live_course: { label: 'Live course',  icon: 'ti-device-tv', light: '#FB7185', mid: '#E11D48', dark: '#9F1239' },
  multi_stage: { label: 'Multi-stage activity', icon: 'ti-puzzle', light: '#6D5CE8', mid: '#4338CA', dark: '#34248F' },
  battle:      { label: 'Agent battle', icon: 'ti-swords',    light: '#F87171', mid: '#EF4444', dark: '#B91C1C' },
  quiz:        { label: 'Quiz',         icon: 'ti-help-circle', light: '#60A5FA', mid: '#3B82F6', dark: '#1D4ED8' },
};
const typeOf = (k) => TYPE[k] || { ...TYPE.assignment, label: 'Activity', icon: 'ti-clipboard' };

const STATUS = {
  assigned: { label: 'Not started', color: GOLD },
  started:  { label: 'In progress', color: BRAND },
  complete: { label: 'Done',        color: GREEN },
};

function fmtDue(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/* Local autosave — answers and the attached file name, per activity. */
const storeKey = (id) => `ak_activity_work_${id}`;
function loadWork(id) {
  try { return JSON.parse(localStorage.getItem(storeKey(id)) || 'null') || { answers: {}, text: '', fileId: null, fileName: '', fileSize: 0 }; }
  catch { return { answers: {}, text: '', fileId: null, fileName: '', fileSize: 0 }; }
}
function saveWork(id, w) {
  try { localStorage.setItem(storeKey(id), JSON.stringify(w)); } catch { /* private mode */ }
}
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
const FILE_OK = /\.(pdf|jpe?g|png|docx?)$/i;

/* ── Glass chip (hero meta) ─────────────────────────────────────────────── */
function Chip({ children, dot }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20,
      background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.22)',
      fontSize: 11, fontWeight: 800, color: '#fff', fontFamily: "'Nunito',sans-serif",
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
      {children}
    </span>
  );
}

/* ── Question stepper — one question at a time, autosaved (reference) ───── */
/* ── Question shapes ────────────────────────────────────────────────────────
   A question rides as a plain string (older assignments) or an object:
   .q is the question text and the object may carry marking metadata
   (type, max_points, difficulty, cognitive_level); MCQ adds .options and
   .correct. Mixed sets are normal (AI-drafted assignments mix MCQ with
   short answer, essay, coding…) — decide per question, never per set. */
const qText = (q) => (typeof q === 'object' && q !== null ? String(q.q ?? '') : String(q ?? ''));
const isMcq = (q) => typeof q === 'object' && q !== null && Array.isArray(q.options);

function Stepper({ questions, work, setWork, mid, dark, onSubmit, submitting }) {
  const total = questions.length;
  const [idx, setIdx] = useState(() => {
    const firstUn = questions.findIndex((_, i) => !(isMcq(questions[i]) ? work.answers[i] != null : (work.answers[i] || '').trim()));
    return firstUn === -1 ? total - 1 : firstUn;
  });
  const [reviewing, setReviewing] = useState(false);

  const answered = (i) => (isMcq(questions[i]) ? work.answers[i] != null : !!(work.answers[i] || '').trim());
  const answeredCount = questions.reduce((n, _, i) => n + (answered(i) ? 1 : 0), 0);

  if (reviewing) {
    return (
      <div style={{ background: 'var(--ak-surface)', borderRadius: 16, padding: 18, boxShadow: '0 2px 10px rgba(17,24,39,.06)' }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: `${mid}14`, color: mid, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
          <Icon name="ti-circle-check" size={22}/>
        </div>
        <h3 style={{ fontSize: 15.5, fontWeight: 900, margin: '0 0 4px', color: 'var(--ak-text)', textAlign: 'center', fontFamily: "'Nunito',sans-serif" }}>Answers complete</h3>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '0 0 16px', textAlign: 'center', fontFamily: "'Nunito',sans-serif" }}>
          You answered {answeredCount} / {total} questions.
        </p>
        <div style={{ marginBottom: 16 }}>
          {questions.map((q, i) => {
            const text = qText(q);
            const short = text.length > 56 ? `${text.slice(0, 56)}…` : text;
            return (
              <button key={i} onClick={() => { setReviewing(false); setIdx(i); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 6px', border: 'none', borderBottom: '1px solid var(--ak-border)', background: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: 8 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: answered(i) ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.12)', color: answered(i) ? '#047857' : '#B45309' }}>
                  <Icon name={answered(i) ? 'ti-check' : 'ti-help'} size={11}/>
                </span>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--ak-text)', fontFamily: "'Nunito',sans-serif" }}>{i + 1}. {short}</span>
                <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-muted)', fontFamily: "'Nunito',sans-serif" }}>{answered(i) ? 'Answered' : 'Not answered'}</span>
              </button>
            );
          })}
        </div>
        <button onClick={onSubmit} disabled={submitting}
          style={{ width: '100%', padding: 12, borderRadius: 20, border: 'none', cursor: submitting ? 'default' : 'pointer', background: `linear-gradient(135deg, ${mid}, ${dark})`, color: '#fff', fontSize: 13, fontWeight: 900, fontFamily: "'Nunito',sans-serif", display: 'flex', justifyContent: 'center' }}>
          {submitting ? <Spinner size={13}/> : 'Submit answers'}
        </button>
      </div>
    );
  }

  const q = questions[idx];
  const qMcq = isMcq(q);
  const isLast = idx === total - 1;
  const pct = Math.round((answeredCount / total) * 100);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text-muted)', whiteSpace: 'nowrap', fontFamily: "'Nunito',sans-serif" }}>Question {idx + 1} of {total}</span>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--ak-border)', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 3, background: mid, width: `${pct}%`, transition: 'width .25s ease' }}/>
        </div>
      </div>
      <div style={{ background: 'var(--ak-surface)', borderRadius: 16, padding: 16, boxShadow: '0 2px 10px rgba(17,24,39,.06)' }}>
        <p style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ak-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '0 0 7px', fontFamily: "'Nunito',sans-serif" }}>Question {idx + 1}</p>
        <p style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--ak-text)', lineHeight: 1.4, margin: '0 0 14px', fontFamily: "'Nunito',sans-serif" }}>
          {qText(q)}
        </p>
        {qMcq ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {q.options.map((opt, oi) => (
              <button key={oi} onClick={() => setWork((w) => ({ ...w, answers: { ...w.answers, [idx]: oi } }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 12,
                  border: `1.5px solid ${work.answers[idx] === oi ? mid : 'var(--ak-border)'}`,
                  background: work.answers[idx] === oi ? `${mid}0C` : 'var(--ak-surface)',
                  color: work.answers[idx] === oi ? 'var(--ak-text)' : 'var(--ak-text-muted)',
                  fontSize: 12.5, fontWeight: work.answers[idx] === oi ? 800 : 700, cursor: 'pointer', textAlign: 'left',
                  fontFamily: "'Nunito',sans-serif",
                }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${work.answers[idx] === oi ? mid : 'var(--ak-border)'}`, flexShrink: 0, position: 'relative' }}>
                  {work.answers[idx] === oi && <span style={{ position: 'absolute', inset: 3, borderRadius: '50%', background: mid }}/>}
                </span>
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <textarea value={work.answers[idx] || ''} onChange={(e) => setWork((w) => ({ ...w, answers: { ...w.answers, [idx]: e.target.value } }))}
            placeholder="Type your answer…" maxLength={4000}
            style={{ width: '100%', minHeight: 96, borderRadius: 12, border: '1.5px solid var(--ak-border)', padding: '11px 13px', fontFamily: "'Nunito',sans-serif", fontSize: 12.5, fontWeight: 600, color: 'var(--ak-text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}/>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
          style={{ padding: '9px 18px', borderRadius: 20, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text-muted)', fontSize: 12.5, fontWeight: 800, cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.4 : 1, fontFamily: "'Nunito',sans-serif" }}>
          ← Back
        </button>
        <button onClick={() => (isLast ? setReviewing(true) : setIdx((i) => i + 1))}
          style={{ marginLeft: 'auto', padding: '9px 18px', borderRadius: 20, border: 'none', background: `linear-gradient(135deg, ${mid}, ${dark})`, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
          {isLast ? 'Review answers' : 'Next →'}
        </button>
      </div>
    </div>
  );
}

/* Read-only question list — how a graded activity shows its questions:
   the published correct option is marked, nothing is editable. */
function StaticQuestions({ questions }) {
  return (
    <>
      <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', margin: '0 0 12px', fontFamily: "'Nunito',sans-serif" }}>Questions</p>
      {questions.map((q, i) => (
        <div key={i} style={{ background: 'var(--ak-surface)', borderRadius: 16, padding: 16, boxShadow: '0 2px 10px rgba(17,24,39,.06)', marginBottom: 10 }}>
          <p style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ak-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '0 0 6px', fontFamily: "'Nunito',sans-serif" }}>Question {i + 1}</p>
          <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--ak-text)', lineHeight: 1.4, margin: '0 0 10px', fontFamily: "'Nunito',sans-serif" }}>{qText(q)}</p>
          {isMcq(q) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {q.options.map((opt, oi) => {
                const correct = q.correct === oi;
                return (
                  <div key={oi} style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 11,
                    border: `1.5px solid ${correct ? 'rgba(16,185,129,.4)' : 'var(--ak-border)'}`,
                    background: correct ? 'rgba(16,185,129,.07)' : 'var(--ak-surface)',
                    fontSize: 12.5, fontWeight: 700, color: correct ? '#047857' : 'var(--ak-text-muted)',
                    fontFamily: "'Nunito',sans-serif",
                  }}>
                    <span style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${correct ? '#10B981' : 'var(--ak-border)'}`, flexShrink: 0, position: 'relative' }}>
                      {correct && <span style={{ position: 'absolute', inset: 3, borderRadius: '50%', background: '#10B981' }}/>}
                    </span>
                    {opt}
                    {correct && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: '#047857' }}>correct</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/* The submitted work, read-only — what the learner actually handed in.
   Shown after submit and after grading; the server copy is the source. */
function SubmittedWork({ submission, questions }) {
  if (!submission) return null;
  // Mixed sets: only MCQ questions render a chosen-option row; open
  // questions' typed answers ride in the text block below.
  const hasMcq = Array.isArray(questions) && questions.some((q) => typeof q === 'object' && Array.isArray(q.options));
  const text = (submission.text || '').trim();
  const answerKeys = Object.keys(submission.answers ?? {});
  const files = submission.files ?? [];
  if (!text && !answerKeys.length && !files.length) return null;
  return (
    <>
      <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', margin: '0 0 12px', fontFamily: "'Nunito',sans-serif" }}>Your submission</p>
      {text && (
        <div style={{ background: 'var(--ak-surface)', borderRadius: 16, padding: '13px 15px', boxShadow: '0 2px 10px rgba(17,24,39,.06)', marginBottom: 10, borderLeft: '3px solid rgba(107,59,255,.4)' }}>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ak-text)', whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.6, fontFamily: "'Nunito',sans-serif" }}>{text}</p>
        </div>
      )}
      {hasMcq && answerKeys.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          {questions.map((q, i) => {
            const ans = submission.answers?.[String(i)];
            if (ans === undefined || ans === null || ans === '') return null;
            const chosen = Array.isArray(q.options) ? q.options[ans] : null;
            return (
              <div key={i} style={{ background: 'var(--ak-surface)', borderRadius: 14, padding: '11px 13px', boxShadow: '0 2px 10px rgba(17,24,39,.06)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ak-text-muted)', marginBottom: 3, fontFamily: "'Nunito',sans-serif" }}>Q{i + 1}. {qText(q)}</div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', fontFamily: "'Nunito',sans-serif" }}>
                  {chosen != null ? chosen : String(ans)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {files.map((f) => (
            <button key={f.id} onClick={() => downloadActivityFile(f.id, f.name)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 12, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: `${BRAND}14`, color: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="ti-file" size={13}/>
              </span>
              <span style={{ textAlign: 'left' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: 'var(--ak-text)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--ak-text-muted)' }}>{fmtSize(f.size || 0)} · tap to download</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */
export default function ActivityDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState('');
  const [work, setWork] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    let dead = false;
    fetchMyActivities()
      .then((rows) => {
        if (dead) return;
        const found = rows.find((r) => r.id === id || r.assignmentId === id || `ss-${r.assignmentId}` === id);
        setRow(found || null);
        if (found) setWork(loadWork(found.assignmentId));
      })
      .catch(() => { if (!dead) setRow(null); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [id]);

  const t = row ? typeOf(row.kind) : typeOf();
  const isDone = row?.status === 'complete';
  const questions = useMemo(() => {
    const q = row?.briefDetails?.questions;
    return Array.isArray(q) && q.length ? q : null;
  }, [row]);
  const useStepper = !!questions && !row?.graded;

  // Autosave only while there is outstanding work — once submitted, the
  // server copy owns the record and the local draft stays cleared.
  useEffect(() => {
    if (row && work && row.status !== 'complete') saveWork(row.assignmentId, work);
  }, [row, work]);

  const submit = async () => {
    setSubmitting(true);
    setSubmitErr('');
    try {
      const payload = {
        text: work?.text ?? '',
        answers: questions ? (work?.answers ?? {}) : {},
        fileIds: work?.fileId ? [work.fileId] : [],
      };
      const target = await completeActivity(row.assignmentId, payload);
      const files = target?.submission?.files
        ?? [{ id: work?.fileId, name: work?.fileName, size: work?.fileSize, mime: null }].filter((f) => f.id);
      setRow((r) => ({ ...r, status: 'complete', submission: { text: payload.text, answers: payload.answers, files } }));
      // The server now owns the work — the local draft is spent.
      try { localStorage.removeItem(storeKey(row.assignmentId)); } catch { /* private mode */ }
    } catch (e) {
      setSubmitErr(e?.message || 'Could not submit. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const dropFile = async (fileId) => {
    try { await removeActivityFile(fileId); } catch { /* server copy dies with the target */ }
    setWork((w) => ({ ...w, fileId: null, fileName: '', fileSize: 0 }));
  };

  const pickFile = async (file) => {
    if (!file || uploading) return;
    if (!FILE_OK.test(file.name)) { setSubmitErr('Only PDF, JPG, PNG or DOCX files.'); return; }
    if (file.size > 5 * 1024 * 1024) { setSubmitErr('That file is larger than 5MB.'); return; }
    setSubmitErr('');
    setUploading(true);
    try {
      const meta = await uploadActivityFile(row.assignmentId, file);
      if (!meta?.id) throw new Error('Upload failed.');
      setWork((w) => ({ ...w, fileId: meta.id, fileName: meta.name || file.name, fileSize: meta.size || file.size }));
    } catch (e) {
      setSubmitErr(e?.message || 'Could not upload that file. Try again.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /* ── loading / not found ── */
  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--ak-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
        <Spinner size={26} color={BRAND}/>
      </div>
    );
  }
  if (!row) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--ak-bg)', zIndex: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20, fontFamily: "'Nunito',sans-serif" }}>
        <div style={{ fontSize: 40 }}>📭</div>
        <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--ak-text)', margin: 0 }}>Activity not found</p>
        <p style={{ fontSize: 12.5, color: 'var(--ak-text-muted)', margin: 0 }}>It may have been removed.</p>
        <button onClick={() => navigate('/activities')}
          style={{ marginTop: 10, padding: '9px 20px', borderRadius: 100, border: 'none', background: BRAND, color: '#fff', fontSize: 12.5, fontWeight: 900, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
          Back to activities
        </button>
      </div>
    );
  }

  const st = STATUS[row.status] || STATUS.assigned;
  const due = fmtDue(row.dueAt);
  const stageList = row.kind === 'multi_stage' ? (row.stages ?? []) : null;
  const doneCount = stageList?.filter((s) => s.status === 'complete').length ?? 0;
  const sub = row.submission ?? {};
  const hasSubmittedContent = !!(sub.text || '').trim()
    || Object.keys(sub.answers ?? {}).length > 0
    || (sub.files ?? []).length > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', fontFamily: "'Nunito',sans-serif" }}>
      {/* ── Hero ── */}
      <div style={{
        position: 'relative', flexShrink: 0, padding: '46px 22px 46px', color: '#fff', overflow: 'hidden',
        background: `radial-gradient(130% 170% at 15% -15%, ${t.light} 0%, ${t.mid} 55%, ${t.dark} 100%)`,
      }}>
        <div style={{ position: 'absolute', top: -26, right: -26, width: 170, height: 170, opacity: 0.14, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={t.icon} size={150} color="#fff"/>
        </div>
        <button onClick={() => navigate('/activities')} aria-label="Back"
          style={{ position: 'absolute', top: 14, left: 16, width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.26)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer', zIndex: 2 }}>
          <Icon name="ti-chevron-left" size={16}/>
        </button>
        <div style={{ position: 'relative', zIndex: 1, maxWidth: 760, margin: '0 auto' }}>
          <div style={{ width: 50, height: 50, borderRadius: 16, background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.26)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, boxShadow: '0 10px 22px -8px rgba(0,0,0,.3)' }}>
            <Icon name={t.icon} size={23} color="#fff"/>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 11px', borderRadius: 20, background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.26)', fontSize: 10.5, fontWeight: 800, marginBottom: 10 }}>
            {t.label}
          </div>
          <h2 style={{ fontSize: 19, fontWeight: 900, margin: '0 0 12px', letterSpacing: '-0.01em', lineHeight: 1.3 }}>{row.title}</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {due && <Chip dot="#F59E0B">Due {due}</Chip>}
            <Chip dot={st.color}>{st.label}</Chip>
            {row.subject && <Chip>{row.subject}</Chip>}
            {row.assignedBy && <Chip>Set by {row.assignedBy}</Chip>}
          </div>
        </div>
      </div>

      {/* ── Sheet ── */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--ak-bg)', borderRadius: '24px 24px 0 0', marginTop: -18, position: 'relative', zIndex: 2 }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '22px 20px 24px' }}>
          {(row.instructions || row.details) && (
            <p style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ak-text-muted)', lineHeight: 1.6, margin: '0 0 20px' }}>
              {row.instructions || row.details}
            </p>
          )}

          {/* graded banner — the published grade + feedback */}
          {row.graded && (
            <div style={{ background: 'rgba(16,185,129,.10)', border: '1px solid rgba(16,185,129,.25)', borderRadius: 14, padding: '12px 14px', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(16,185,129,.18)', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="ti-circle-check" size={16}/>
                </span>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: '#047857' }}>Graded · {row.grade}%</div>
                  {row.completedAt && (
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: '#047857', opacity: 0.75, marginTop: 1 }}>
                      Submitted {new Date(row.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  )}
                </div>
              </div>
              {row.feedbackText && (
                <p style={{ fontSize: 12, fontWeight: 600, color: '#065F46', margin: '10px 0 0', lineHeight: 1.5 }}>{row.feedbackText}</p>
              )}
            </div>
          )}

          {/* multi-stage roadmap — server-derived per-stage state */}
          {stageList?.length > 0 && (
            <>
              <div style={{ background: 'var(--ak-surface)', borderRadius: 16, padding: '14px 15px', boxShadow: '0 2px 10px rgba(17,24,39,.06)', marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12, fontWeight: 800, color: 'var(--ak-text)', marginBottom: 8, fontFamily: "'Nunito',sans-serif" }}>
                  <span>Overall progress</span>
                  <span style={{ color: '#4338CA' }}>{doneCount} of {stageList.length} stages</span>
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {stageList.map((s, i) => (
                    <i key={i} style={{ flex: 1, height: 8, borderRadius: 4, background: s.status === 'complete' ? 'linear-gradient(135deg, #4338CA, #6D5CE8)' : 'var(--ak-border)' }}/>
                  ))}
                </div>
              </div>
              <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', margin: '0 0 12px', fontFamily: "'Nunito',sans-serif" }}>Stages</p>
              <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 20 }}>
                {stageList.map((s, i) => {
                  const stageT = typeOf(s.kind === 'battle' ? 'battle' : s.kind);
                  const stMap = {
                    complete: { label: 'Done', color: GREEN },
                    active:   { label: 'In progress', color: BRAND },
                    locked:   { label: 'Locked', color: 'var(--ak-text-muted)' },
                    passed:   { label: 'Complete', color: GREEN },
                    open:     { label: 'Ready', color: GOLD },
                  };
                  const ss = stMap[s.status] || stMap.open;
                  return (
                    <div key={i}>
                      {i > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 20, color: 'var(--ak-text-muted)' }}>
                          <Icon name="ti-chevron-down" size={14}/>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 12, background: 'var(--ak-surface)', borderRadius: 18, padding: '14px 15px', boxShadow: '0 2px 10px rgba(17,24,39,.06)', opacity: s.status === 'locked' ? 0.55 : 1 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 11, background: `${stageT.mid}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Icon name={stageT.icon} size={15} color={stageT.mid}/>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', fontFamily: "'Nunito',sans-serif" }}>
                              Stage {i + 1} · {s.title || stageT.label}
                            </span>
                            <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3.5px 10px', borderRadius: 20, background: `${ss.color === 'var(--ak-text-muted)' ? '#9CA3AF' : ss.color}14`, color: ss.color === 'var(--ak-text-muted)' ? '#6B7280' : ss.color, fontFamily: "'Nunito',sans-serif" }}>
                              {ss.label}
                            </span>
                          </div>
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ak-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', fontFamily: "'Nunito',sans-serif" }}>{stageT.label}</span>
                          {s.status === 'locked' && (
                            <p style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '6px 0 0', fontFamily: "'Nunito',sans-serif" }}>Unlocks after the stage before it</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* graded activities show their questions read-only, correct option marked */}
          {row.graded && questions?.length > 0 && <StaticQuestions questions={questions} />}

          {/* the work the learner handed in — server copy */}
          {(isDone || row.graded) && <div style={{ marginBottom: 20 }}><SubmittedWork submission={row.submission} questions={questions}/></div>}

          {/* submitted before capture, or with nothing written: say so
              instead of showing a silent page */}
          {(isDone || row.graded) && !hasSubmittedContent && !questions?.length
            && row.kind !== 'multi_stage' && row.kind !== 'live_course' && (
            <div style={{ background: 'var(--ak-surface)', borderRadius: 14, padding: '12px 14px', marginBottom: 20, border: '1px dashed var(--ak-border)' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0, fontFamily: "'Nunito',sans-serif" }}>
                No written answer was captured for this submission — only the completion was recorded.
              </p>
            </div>
          )}

          {/* submitted confirmation */}
          {isDone && !row.graded && (
            <div style={{ textAlign: 'center', padding: '10px 6px' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(16,185,129,.12)', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <Icon name="ti-circle-check" size={24}/>
              </div>
              <h3 style={{ fontSize: 15.5, fontWeight: 900, margin: '0 0 4px', color: 'var(--ak-text)' }}>Work submitted</h3>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0 }}>
                Your teacher will review it{row.submission?.files?.length ? ` and your attached file (${row.submission.files[0].name})` : ''}.
              </p>
            </div>
          )}

          {/* answer box + submission — open work only */}
          {!isDone && !row.graded && (
            <>
              <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', margin: '0 0 12px', fontFamily: "'Nunito',sans-serif" }}>
                {useStepper ? 'Questions' : 'Your answer'}
              </p>
              {useStepper ? (
                <Stepper questions={questions} work={work} setWork={setWork} mid={t.mid} dark={t.dark} onSubmit={submit} submitting={submitting}/>
              ) : (
                <>
                  <textarea
                    value={work?.text || ''} onChange={(e) => setWork((w) => ({ ...w, text: e.target.value }))}
                    placeholder="Type your answer or working…"
                    maxLength={4000}
                    style={{ width: '100%', minHeight: 110, borderRadius: 12, border: '1.5px solid var(--ak-border)', padding: '11px 13px', fontFamily: "'Nunito',sans-serif", fontSize: 12.5, fontWeight: 600, color: 'var(--ak-text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', background: 'var(--ak-surface)' }}/>
                  {/* file dropzone — validated locally; uploads land with the API update */}
                  {work?.fileId ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--ak-surface)', borderRadius: 14, padding: '10px 12px', boxShadow: '0 2px 10px rgba(17,24,39,.06)', marginTop: 8, border: '1px solid rgba(16,185,129,.3)' }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(16,185,129,.12)', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name="ti-file" size={15}/>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{work.fileName || 'Attachment'}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: '#047857', marginTop: 1 }}>{fmtSize(work.fileSize || 0)} · uploaded</div>
                      </div>
                      <button onClick={() => dropFile(work.fileId)} aria-label="Remove file"
                        style={{ border: 'none', background: 'none', color: 'var(--ak-text-muted)', cursor: 'pointer', width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name="ti-x" size={13}/>
                      </button>
                    </div>
                  ) : uploading ? (
                    <div style={{ marginTop: 8, border: '1.5px dashed var(--ak-border)', borderRadius: 14, padding: '22px 14px', textAlign: 'center', background: 'var(--ak-surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
                      <Spinner size={15} color={BRAND}/>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>Uploading…</div>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
                      style={{
                        marginTop: 8, border: `1.5px dashed ${dragOver ? BRAND : 'var(--ak-border)'}`, borderRadius: 14,
                        padding: '22px 14px', textAlign: 'center', cursor: 'pointer',
                        background: dragOver ? `${BRAND}0A` : 'var(--ak-surface)',
                      }}>
                      <input ref={fileRef} type="file" style={{ display: 'none' }}
                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                        onChange={(e) => pickFile(e.target.files?.[0])}/>
                      <div style={{ width: 34, height: 34, borderRadius: 10, background: `${BRAND}14`, color: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                        <Icon name="ti-cloud-upload" size={16}/>
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>Click to upload or drag and drop</div>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ak-text-muted)', marginTop: 3 }}>PDF, JPG, PNG, DOCX up to 5MB</div>
                    </div>
                  )}
                </>
              )}
              {submitErr && <div style={{ fontSize: 12, fontWeight: 700, color: RED, marginTop: 10 }}>{submitErr}</div>}
            </>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      {(!useStepper || isDone) && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', background: 'var(--ak-surface)', boxShadow: '0 -8px 20px rgba(17,24,39,.07)' }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-muted)', fontFamily: "'Nunito',sans-serif" }}>
            {row.graded ? `Graded · ${row.grade}%` : isDone ? 'Submitted' : row.subject || row.topic || t.label}
          </span>
          {!isDone && !row.graded ? (
            <button onClick={submit} disabled={submitting}
              style={{ marginLeft: 'auto', padding: '12px 22px', borderRadius: 20, border: 'none', cursor: submitting ? 'default' : 'pointer', background: `linear-gradient(135deg, ${t.mid}, ${t.dark})`, color: '#fff', fontSize: 13.5, fontWeight: 800, boxShadow: '0 10px 20px -8px rgba(17,24,39,.4)', fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              {submitting ? <Spinner size={13}/> : <><Icon name="ti-send" size={14}/> Submit work</>}
            </button>
          ) : (
            <button onClick={() => navigate('/activities')}
              style={{ marginLeft: 'auto', padding: '12px 22px', borderRadius: 20, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
              Back to activities
            </button>
          )}
        </div>
      )}
    </div>
  );
}
