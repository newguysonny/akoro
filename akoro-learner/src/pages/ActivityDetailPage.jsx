import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchMyActivities, completeActivity, uploadActivityFile, removeActivityFile, downloadActivityFile, downloadMySubmissionPdf, fetchMySubmissionDocument,
  saveActivityAnswer, saveActivityText, fetchActivityFileBlob, saveBlobAs,
} from '../services/activityApi.js';
import { onActivityGraded } from '../services/activitySocket.js';
import { Icon } from '../components/common/Icons.jsx';
import { BRAND, RED, GREEN, GOLD } from '../constants.js';
import Spinner from '../components/common/Spinner.jsx';
import { hasAnswer, stepStatuses, resumeStep, openingAnswers, shownAnswer, lastCheck } from '../lib/questionSteps.js';
import { MathText, QuestionFigure, QuestionContext } from '../components/activity/QuestionPaper.jsx';
import AnswerPaper, { FileCard } from '../components/activity/AnswerPaper.jsx';
import { SubmissionSheet } from '../components/activity/PaperSheets.jsx';
import { printSheet } from '../lib/printSheet.js';
import WhiteboardModal from '../components/teaching/WhiteboardModal.jsx';
// The document editor (TipTap + the .docx writer) loads only when opened.
const WordEditor = lazy(() => import('../components/docs/WordEditor.jsx'));
import { labelAnswerText, parseLabelAnswer, letterOf, readChoice, isAnswered, FORMAT_NAMES } from '../lib/paper.js';

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
 * The question stepper runs whenever the brief actually carries questions
 * (details.questions): each question read-only on top, an answer box below
 * (type, attach up to 3 files, draw on the whiteboard), autosaved to the
 * server; then a review laid out like the paper with every answer under its
 * question, a last check, and the receipt. Briefs without questions keep the
 * free-text box and one attachment.
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

/* A question's document draft on this device — { json, page, saved }. */
const docKey = (assignmentId, i) => `ak_doc_${assignmentId}_q${i}`;
const DRAWING_RE = /^drawing-q\d+\.png$/i;
const DOC_RE = /^document-q\d+\.docx$/i;
function loadDoc(assignmentId, i) {
  try { return JSON.parse(localStorage.getItem(docKey(assignmentId, i)) || 'null'); } catch { return null; }
}
function storeDoc(assignmentId, i, doc) {
  try { if (doc) localStorage.setItem(docKey(assignmentId, i), JSON.stringify(doc)); else localStorage.removeItem(docKey(assignmentId, i)); }
  catch { /* too big for this device's storage — the attached .docx still has it */ }
}

/* Local autosave — answers and the attached file name, per activity. */
const storeKey = (id) => `ak_activity_work_${id}`;
function loadWork(id) {
  try { return JSON.parse(localStorage.getItem(storeKey(id)) || 'null') || { answers: {}, text: '' }; }
  catch { return { answers: {}, text: '' }; }
}
function saveWork(id, w) {
  try { localStorage.setItem(storeKey(id), JSON.stringify(w)); }
  catch {
    // Too big with the drawings' strokes — keep the answers at least.
    try { localStorage.setItem(storeKey(id), JSON.stringify({ ...w, drawings: {} })); } catch { /* private mode */ }
  }
}
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
// What the API accepts (it checks the bytes too): PDF, photos, Word .docx, text.
const FILE_OK = /\.(pdf|jpe?g|png|docx|txt)$/i;

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

/* ── Question shapes ────────────────────────────────────────────────────────
   A question rides as a plain string (older assignments) or an object:
   .q is the question text and the object may carry marking metadata
   (type, max_points, difficulty, cognitive_level); MCQ adds .options and
   .correct. Mixed sets are normal (AI-drafted assignments mix MCQ with
   short answer, essay, coding…) — decide per question, never per set. */
const qText = (q) => (typeof q === 'object' && q !== null ? String(q.q ?? '') : String(q ?? ''));
const isMcq = (q) => typeof q === 'object' && q !== null && Array.isArray(q.options);
/* A question's type as a chip label — MCQs without a stored type still
   say what they are. */
const typeLabel = (t) => { const s = String(t ?? '').replace(/[_-]+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : ''; };
const kindOf = (q) => FORMAT_NAMES[q?.format] || (isMcq(q) ? 'Multiple choice' : typeLabel(q?.type) || 'Written answer');
const ptsOf = (q) => (typeof q === 'object' && q && Number(q.max_points ?? q.points) > 0 ? Number(q.max_points ?? q.points) : null);
const PER_QUESTION_FILES = 3;

/* ── The assignment, one question at a time ─────────────────────────────
   Q1 → "Submit answer & next" → Q2 → … → Review → "Submit assignment".
   The question sits on top, read-only; below it an answer box like the
   Agent Chat composer: type, attach (up to 3 files), draw on the
   whiteboard. What's typed autosaves to the server as the learner types
   (so it follows them across devices); files upload as they're attached.
   The review lays the whole paper out with every answer under its question. */
const STEP_LOOK = {
  saved:  { bg: 'rgba(16,185,129,.14)', fg: '#047857', border: 'rgba(16,185,129,.45)', label: 'Answered' },
  edited: { bg: 'rgba(245,158,11,.14)', fg: '#B45309', border: 'rgba(245,158,11,.5)', label: 'Saving…' },
  empty:  { bg: 'var(--ak-surface)',    fg: 'var(--ak-text-muted)', border: 'var(--ak-border)', label: 'Not answered' },
};

/* A round tool button — the chat composer's look. */
function BoxTool({ icon, label, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}
      style={{ width: 32, height: 32, padding: 0, borderRadius: '50%', border: '1px solid var(--ak-border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#526078', background: 'var(--ak-surface)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 }}>
      <Icon name={icon} size={16}/>
    </button>
  );
}

/* The answer box under the question. */
function AnswerBox({ q, idx, value, onType, files, onPick, onRemove, onOpenFile, onDraw, onWrite, uploading, removing, status, saveErr, onRetry, fileErr }) {
  const fileRef = useRef(null);
  const [focus, setFocus] = useState(false);
  const full = files.length >= PER_QUESTION_FILES;
  const mcq = isMcq(q);
  const labelling = q?.format === 'label' && Array.isArray(q.labels);
  const typed = typeof value === 'string' ? value.trim() : '';
  const pick = mcq && typed ? readChoice(q, typed) : null;
  const placeholder = q?.format === 'true_false' ? 'Type True or False'
    : mcq ? `Type your answer — the letter (${letterOf(0)}–${letterOf(q.options.length - 1)}) or the option` : 'Type your answer…';
  return (
    <div style={{ marginTop: 14, padding: '12px 12px 10px', border: `1px solid ${focus ? BRAND : 'var(--ak-border)'}`, boxShadow: focus ? `0 0 0 3px ${BRAND}1C` : '0 4px 14px rgba(30,41,59,.055)', borderRadius: 22, background: 'var(--ak-surface)', transition: 'border-color .16s, box-shadow .16s' }}>
      <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '.05em', textTransform: 'uppercase', color: BRAND, margin: '0 3px 6px', fontFamily: "'Nunito',sans-serif" }}>Your answer</div>
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '0 0 8px' }}>
          {files.map((f) => <FileCard key={f.id} file={f} onOpen={onOpenFile} onRemove={onRemove} busy={removing === f.id} sans="'Nunito',sans-serif"/>)}
        </div>
      )}
      {labelling ? (
        /* Labelling: name each marked part of the diagram. */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          {(() => {
            const vals = parseLabelAnswer(q.labels, value);
            return q.labels.map((l) => (
              <label key={l} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: "'Nunito',sans-serif" }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 900, color: BRAND, background: `${BRAND}12`, border: `1.5px solid ${BRAND}40` }}>{l}</span>
                <input value={vals[l]} maxLength={200} aria-label={`Part ${l}`} placeholder={`What is ${l}?`}
                  onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
                  onChange={(e) => onType(labelAnswerText(q.labels, { ...vals, [l]: e.target.value.replace(/\n/g, ' ') }) || '')}
                  style={{ flex: 1, minWidth: 0, borderRadius: 11, border: '1px solid var(--ak-border)', padding: '9px 11px', fontFamily: "'Nunito',sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--ak-text)', outline: 'none', background: 'var(--ak-bg)' }}/>
              </label>
            ));
          })()}
        </div>
      ) : (
        <textarea value={value ?? ''} onChange={(e) => onType(e.target.value)} aria-label={`Answer to question ${idx + 1}`}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          placeholder={placeholder} maxLength={4000} rows={mcq ? 2 : 4}
          style={{ display: 'block', width: '100%', minHeight: mcq ? 52 : 96, padding: '2px 3px 8px', border: 0, outline: 'none', resize: 'vertical', background: 'transparent', color: 'var(--ak-text)', fontSize: 15, lineHeight: 1.55, fontWeight: 600, fontFamily: "'Nunito',sans-serif", boxSizing: 'border-box' }}/>
      )}
      {mcq && typed && (
        <div style={{ fontSize: 11.5, fontWeight: 800, margin: '0 3px 8px', color: pick != null ? '#047857' : '#B45309', fontFamily: "'Nunito',sans-serif" }}>
          {pick != null ? `Read as ${letterOf(pick)} · ${q.options[pick]}` : 'Not one of the options — your teacher will read it. Type a letter to be marked straight away.'}
        </div>
      )}
      <input ref={fileRef} type="file" multiple style={{ display: 'none' }} accept=".pdf,.jpg,.jpeg,.png,.docx,.txt"
        onChange={(e) => { onPick(e.target.files); e.target.value = ''; }}/>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <BoxTool icon="ti-paperclip" label={full ? 'Up to 3 files per question' : 'Attach a file (PDF, photo, Word, text · 5MB)'} onClick={() => fileRef.current?.click()} disabled={full || uploading}/>
        <BoxTool icon="ti-pencil" label="Draw it on the whiteboard" onClick={onDraw} disabled={uploading}/>
        <BoxTool icon="ti-file-type-docx" label="Write it in a document (like Word)" onClick={onWrite} disabled={uploading}/>
        {uploading
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text-muted)', fontFamily: "'Nunito',sans-serif" }}><Spinner size={11}/> Uploading…</span>
          : files.length > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ak-text-muted)', fontFamily: "'Nunito',sans-serif" }}>{files.length}/{PER_QUESTION_FILES} files</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 800, fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {saveErr ? (
            <button type="button" onClick={onRetry} style={{ border: 'none', background: 'none', padding: 0, color: RED, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>Not saved · Retry</button>
          ) : status === 'edited' ? (
            <span style={{ color: 'var(--ak-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Spinner size={10}/> Saving…</span>
          ) : status === 'saved' ? (
            <span style={{ color: '#047857', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Saved <Icon name="ti-check" size={13}/></span>
          ) : null}
        </span>
      </div>
      {fileErr && <div style={{ fontSize: 11.5, fontWeight: 700, color: RED, margin: '8px 3px 0', fontFamily: "'Nunito',sans-serif" }}>{fileErr}</div>}
    </div>
  );
}

function Stepper({ questions, paper, work, saved, files, fileCounts, onType, onFlush, saveErrs, onPick, onRemove, onOpenFile, onDraw, onWrite, uploading, removing, fileErr, mid, dark, onHandIn, submitting, jumpRef }) {
  const total = questions.length;
  const [idx, setIdx] = useState(() => resumeStep(questions, work.answers, saved, fileCounts));
  const [moving, setMoving] = useState(false);
  const [stepErr, setStepErr] = useState('');
  const topRef = useRef(null);
  const statuses = stepStatuses(questions, work.answers, saved, fileCounts);
  const answeredCount = statuses.filter((st) => st !== 'empty').length;
  const reviewing = idx >= total;

  const go = (i) => {
    setStepErr('');
    setIdx(Math.max(0, Math.min(total, i)));
    topRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  };
  // The last-check sheet's "Answer it" jumps here.
  useEffect(() => { if (jumpRef) jumpRef.current = go; });

  /* Save what's typed now (not waiting for the pause), then move on. */
  const submitAndNext = async () => {
    if (statuses[idx] === 'edited') {
      setMoving(true); setStepErr('');
      try { await onFlush(idx); }
      catch (e) { setStepErr(e?.message || 'Could not save this answer — try again.'); setMoving(false); return; }
      setMoving(false);
    }
    go(idx + 1);
  };

  /* The step rail: 1 2 3 … Review — tap any step. */
  const rail = (
    <div ref={topRef} role="tablist" aria-label="Questions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, scrollMarginTop: 12 }}>
      {questions.map((_, i) => {
        const look = STEP_LOOK[statuses[i]];
        const on = i === idx;
        return (
          <button key={i} role="tab" aria-selected={on} onClick={() => go(i)} title={`Question ${i + 1} · ${look.label}`}
            style={{ minWidth: 32, height: 32, padding: '0 8px', borderRadius: 10, border: `1.5px solid ${on ? mid : look.border}`, background: on ? `${mid}14` : look.bg, color: on ? mid : look.fg, fontSize: 12, fontWeight: 900, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
            {statuses[i] === 'saved' && !on ? <Icon name="ti-check" size={12}/> : i + 1}
          </button>
        );
      })}
      <button role="tab" aria-selected={reviewing} onClick={() => go(total)}
        style={{ height: 32, padding: '0 12px', borderRadius: 10, border: `1.5px solid ${reviewing ? mid : 'var(--ak-border)'}`, background: reviewing ? `${mid}14` : 'var(--ak-surface)', color: reviewing ? mid : 'var(--ak-text-muted)', fontSize: 12, fontWeight: 900, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
        Review
      </button>
    </div>
  );

  if (reviewing) {
    /* The whole paper, laid out like the teacher's preview, with every
       answer under its question. */
    const marks = questions.reduce((n, q) => n + (ptsOf(q) || 0), 0);
    const loose = files.filter((f) => f.question == null);
    const allDone = answeredCount === total;
    return (
      <div>
        {rail}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 14px' }}>
          {[
            [`${total}`, `question${total === 1 ? '' : 's'}`],
            ...(marks ? [[`${marks}`, 'marks']] : []),
            [`${answeredCount}/${total}`, 'answered', allDone ? '#047857' : '#B45309'],
            [`${files.length}`, `file${files.length === 1 ? '' : 's'}`],
          ].map(([n, l, c]) => (
            <div key={l} style={{ flex: '1 1 70px', background: 'var(--ak-surface)', borderRadius: 14, padding: '10px 12px', boxShadow: '0 2px 10px rgba(17,24,39,.06)', fontFamily: "'Nunito',sans-serif" }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: c || 'var(--ak-text)' }}>{n}</div>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ak-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
            </div>
          ))}
        </div>
        <AnswerPaper details={paper} answers={work.answers} files={files} onEdit={go} onOpenFile={onOpenFile} showLoose={false} sans="'Nunito',sans-serif"/>
        {loose.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text-muted)', margin: '0 0 6px', fontFamily: "'Nunito',sans-serif" }}>Attached to the whole assignment</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {loose.map((f) => <FileCard key={f.id} file={f} onOpen={onOpenFile} onRemove={onRemove} busy={removing === f.id} sans="'Nunito',sans-serif"/>)}
            </div>
          </div>
        )}
        {stepErr && <div style={{ fontSize: 12, fontWeight: 700, color: RED, margin: '10px 0' }}>{stepErr}</div>}
        <button onClick={onHandIn} disabled={submitting || uploading !== null}
          style={{ width: '100%', marginTop: 16, padding: 12, borderRadius: 20, border: 'none', cursor: submitting ? 'default' : 'pointer', background: `linear-gradient(135deg, ${mid}, ${dark})`, color: '#fff', fontSize: 13, fontWeight: 900, fontFamily: "'Nunito',sans-serif", display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 7 }}>
          {submitting ? <Spinner size={13}/> : uploading !== null ? <><Spinner size={13}/> Uploading…</> : <><Icon name="ti-send" size={14}/> Submit assignment</>}
        </button>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', textAlign: 'center', margin: '8px 0 0' }}>
          Once you submit, your answers go to your teacher and can't be changed.
        </p>
      </div>
    );
  }

  const q = questions[idx];
  const qMcq = isMcq(q);
  const isLast = idx === total - 1;
  const status = statuses[idx];
  const look = STEP_LOOK[status];
  const pts = ptsOf(q);
  const qFiles = files.filter((f) => f.question != null && Number(f.question) === idx);
  const primary = status === 'empty' ? (isLast ? 'Review answers' : 'Skip for now') : (isLast ? 'Submit answer & review' : 'Submit answer & next');
  return (
    <div>
      {rail}
      {/* The question — read-only, the whole of it. */}
      <div style={{ background: 'var(--ak-surface)', borderRadius: 16, padding: 16, boxShadow: '0 2px 10px rgba(17,24,39,.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 7px', flexWrap: 'wrap' }}>
          <p style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ak-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', margin: 0, fontFamily: "'Nunito',sans-serif" }}>Question {idx + 1} of {total}</p>
          <span style={{ fontSize: 9.5, fontWeight: 900, color: mid, background: `${mid}14`, padding: '2px 8px', borderRadius: 999 }}>{kindOf(q)}</span>
          {pts && <span style={{ fontSize: 9.5, fontWeight: 900, color: 'var(--ak-text-muted)', background: 'var(--ak-bg, rgba(0,0,0,.04))', padding: '2px 8px', borderRadius: 999 }}>{pts} mark{pts === 1 ? '' : 's'}</span>}
          <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 900, color: look.fg, background: look.bg, padding: '2px 8px', borderRadius: 999 }}>{look.label}</span>
        </div>
        <QuestionContext key={idx} details={paper} index={idx} mid={mid}/>
        <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--ak-text)', lineHeight: 1.5, margin: '0 0 14px', fontFamily: "'Nunito',sans-serif", whiteSpace: 'pre-line' }}>
          {q?.format === 'assertion_reason' && q.assertion
            ? <><b>Assertion:</b> <MathText text={q.assertion}/><br/><b>Reason:</b> <MathText text={q.reason || ''}/></>
            : <MathText text={qText(q)}/>}
        </p>
        {/* The figure sits between the question and its options, as on the paper. */}
        <QuestionFigure figure={q?.figure}/>
        {qMcq && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {q.options.map((opt, oi) => (
              <div key={oi} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 11px', borderRadius: 11, background: 'var(--ak-bg)', color: 'var(--ak-text)', fontSize: 14, fontWeight: 600, lineHeight: 1.45, fontFamily: "'Nunito',sans-serif" }}>
                <b style={{ minWidth: 16, color: mid }}>{letterOf(oi)}.</b>
                <span><MathText text={opt}/></span>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnswerBox q={q} idx={idx} value={work.answers[idx]} onType={(v) => onType(idx, v)}
        files={qFiles} onPick={(list) => onPick(idx, list)} onRemove={onRemove} onOpenFile={onOpenFile} onDraw={() => onDraw(idx)} onWrite={() => onWrite(idx)}
        uploading={uploading === idx} removing={removing} status={status} saveErr={saveErrs[idx]} onRetry={() => onFlush(idx).catch(() => {})}
        fileErr={fileErr?.index === idx ? fileErr.message : ''}/>

      {stepErr && <div style={{ fontSize: 12, fontWeight: 700, color: RED, marginTop: 10 }}>{stepErr}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <button onClick={() => go(idx - 1)} disabled={idx === 0 || moving}
          style={{ padding: '10px 18px', borderRadius: 20, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text-muted)', fontSize: 12.5, fontWeight: 800, cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.4 : 1, fontFamily: "'Nunito',sans-serif" }}>
          ← Back
        </button>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ak-text-muted)', fontFamily: "'Nunito',sans-serif" }}>{answeredCount}/{total} answered</span>
        <button onClick={submitAndNext} disabled={moving}
          style={{ marginLeft: 'auto', padding: '10px 18px', borderRadius: 20, border: status === 'empty' ? '1px solid var(--ak-border)' : 'none', background: status === 'empty' ? 'var(--ak-surface)' : `linear-gradient(135deg, ${mid}, ${dark})`, color: status === 'empty' ? 'var(--ak-text)' : '#fff', fontSize: 12.5, fontWeight: 900, cursor: moving ? 'default' : 'pointer', fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {moving ? <Spinner size={12}/> : <>{primary} →</>}
        </button>
      </div>
    </div>
  );
}

/* The last check before handing in — what's missing, what's attached. */
function LastCheck({ check, total, questions, onAnswer, onSubmit, onClose, submitting, err, mid, dark }) {
  const issues = check.unanswered.length + check.blanks.length;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(10,10,25,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Hand in your assignment"
        style={{ width: '100%', maxWidth: 520, background: 'var(--ak-surface)', borderRadius: '22px 22px 0 0', padding: '10px 20px calc(env(safe-area-inset-bottom, 0px) + 18px)', boxShadow: '0 -12px 32px rgba(17,24,39,.18)', fontFamily: "'Nunito',sans-serif", maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--ak-border)', margin: '0 auto 14px' }}/>
        <h3 style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 4px' }}>{issues ? 'Before you hand it in' : 'Ready to hand it in?'}</h3>
        <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '0 0 14px' }}>
          {total - check.unanswered.length} of {total} answered · {check.files} file{check.files === 1 ? '' : 's'} attached
          {check.pending.length ? ` · ${check.pending.length} answer${check.pending.length === 1 ? '' : 's'} still saving — we'll save ${check.pending.length === 1 ? 'it' : 'them'} first` : ''}
        </p>
        {check.unanswered.map((i) => (
          <div key={`u${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.25)', marginBottom: 8 }}>
            <Icon name="ti-alert-circle" size={15} color={RED}/>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Question {i + 1} · not answered <span style={{ fontWeight: 600, color: 'var(--ak-text-muted)' }}>— {qText(questions[i]).slice(0, 60)}</span></span>
            <button type="button" onClick={() => onAnswer(i)} style={{ border: 'none', background: RED, color: '#fff', borderRadius: 9, padding: '5px 10px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>Answer it</button>
          </div>
        ))}
        {check.blanks.map((b) => (
          <div key={`b${b.index}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', marginBottom: 8 }}>
            <Icon name="ti-tag" size={15} color="#B45309"/>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>Question {b.index + 1} · part{b.parts.length === 1 ? '' : 's'} {b.parts.join(', ')} left blank</span>
            <button type="button" onClick={() => onAnswer(b.index)} style={{ border: '1px solid rgba(245,158,11,.5)', background: 'transparent', color: '#B45309', borderRadius: 9, padding: '5px 10px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>Fill in</button>
          </div>
        ))}
        {!issues && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.3)', marginBottom: 8 }}>
            <Icon name="ti-circle-check" size={16} color="#047857"/>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#047857' }}>Every question has an answer.</span>
          </div>
        )}
        <p style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '10px 0 14px' }}>Once you submit, your answers go to your teacher and can't be changed.</p>
        {err && <div style={{ fontSize: 12, fontWeight: 700, color: RED, margin: '-6px 0 12px' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={submitting}
            style={{ flex: 1, padding: 12, borderRadius: 20, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
            Keep working
          </button>
          <button type="button" onClick={onSubmit} disabled={submitting}
            style={{ flex: 1.3, padding: 12, borderRadius: 20, border: 'none', background: `linear-gradient(135deg, ${mid}, ${dark})`, color: '#fff', fontSize: 13, fontWeight: 900, cursor: submitting ? 'default' : 'pointer', fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            {submitting ? <Spinner size={13}/> : <><Icon name="ti-send" size={14}/> {issues ? 'Submit anyway' : 'Submit'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* After handing in: what went in, and the paper with the answers. */
function Receipt({ questions, submission, completedAt }) {
  const answers = submission?.answers || {};
  const files = submission?.files || [];
  const counts = {};
  files.forEach((f) => { if (f.question != null) counts[f.question] = (counts[f.question] || 0) + 1; });
  const answered = questions.filter((q, i) => isAnswered(answers[i] ?? answers[String(i)], counts[i] || 0)).length;
  const when = completedAt ? new Date(completedAt) : null;
  return (
    <div style={{ background: 'var(--ak-surface)', borderRadius: 16, padding: '18px 16px', boxShadow: '0 2px 10px rgba(17,24,39,.06)', marginBottom: 16, textAlign: 'center', fontFamily: "'Nunito',sans-serif" }}>
      <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(16,185,129,.12)', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
        <Icon name="ti-circle-check" size={24}/>
      </div>
      <h3 style={{ fontSize: 16, fontWeight: 900, margin: '0 0 3px', color: 'var(--ak-text)' }}>Handed in</h3>
      {submission?.late && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 900, color: '#B45309', background: 'rgba(245,158,11,.14)', padding: '2px 9px', borderRadius: 999, marginBottom: 6 }}>
          <Icon name="ti-clock-exclamation" size={12}/> Late — after the due date
        </span>
      )}
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '0 0 14px' }}>
        {when && !Number.isNaN(when.getTime()) ? `${when.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ` : ''}your teacher is marking it
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        {[[`${answered}/${questions.length}`, 'answered'], [`${files.length}`, `file${files.length === 1 ? '' : 's'}`], ['—', 'marks · waiting']].map(([n, l]) => (
          <div key={l} style={{ flex: 1, background: 'var(--ak-bg)', borderRadius: 12, padding: '9px 6px' }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)' }}>{n}</div>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
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
                  {chosen != null ? `${letterOf(ans)}. ${chosen}` : String(ans)}
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
  const [pdfBusy, setPdfBusy] = useState(false);
  const [paperDoc, setPaperDoc] = useState(null);   // my handed-in work as the submission paper
  const [saved, setSaved] = useState({});   // answers the server holds per question (autosaved)
  const [files, setFiles] = useState([]);   // uploaded so far — each with its question
  const [uploadingQ, setUploadingQ] = useState(null);
  const [textSave, setTextSave] = useState('');   // the written answer's autosave: saving | saved | error
  const [removing, setRemoving] = useState(null);
  const [fileErr, setFileErr] = useState(null);   // { index, message }
  const [saveErrs, setSaveErrs] = useState({});
  const [board, setBoard] = useState(null);       // the question the whiteboard draws for
  const [doc, setDoc] = useState(null);           // the document being written: { index, initial, dirty } | { index, loading }
  const [checking, setChecking] = useState(false);
  const fileRef = useRef(null);
  // Autosave runs on timers, so it reads the latest row and answers here.
  const rowRef = useRef(null); rowRef.current = row;
  const stepperJump = useRef(null);
  const sheetRef = useRef(null);
  const workRef = useRef(null); workRef.current = work;
  const timers = useRef({});
  const chains = useRef({});
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  useEffect(() => {
    let dead = false;
    fetchMyActivities()
      .then((rows) => {
        if (dead) return;
        const found = rows.find((r) => r.id === id || r.assignmentId === id || `ss-${r.assignmentId}` === id);
        setRow(found || null);
        if (found) {
          // The server's submitted answers, plus this browser's unsent edits
          // unless the server copy is newer (another device moved on).
          const local = loadWork(found.assignmentId);
          const server = found.draft?.answers || {};
          const qs = found.briefDetails?.questions || [];
          const opened = openingAnswers({ saved: server, savedAt: found.draft?.savedAt, local: local.answers, editedAt: local.editedAt });
          // An older pick (option number) shows as its letter, as if typed.
          const answers = Object.fromEntries(Object.entries(opened).map(([k, v]) => [k, shownAnswer(qs[k], v)]));
          setSaved(server);
          setFiles(found.draftFiles || []);
          // The written answer (work without questions): this browser's, unless the server's is newer.
          const serverText = typeof found.draft?.text === 'string' ? found.draft.text : null;
          const localNewer = local.editedAt && (!found.draft?.savedAt || Date.parse(local.editedAt) > Date.parse(found.draft.savedAt));
          setWork({ ...local, answers, text: localNewer || serverText == null ? (local.text || '') : serverText });
          // Typing this browser never got to save — save it now.
          if (found.status !== 'complete' && Array.isArray(qs) && qs.length) {
            const pending = stepStatuses(qs, answers, server).map((st, i) => (st === 'edited' ? i : -1)).filter((i) => i > -1);
            if (pending.length) setTimeout(() => pending.forEach((i) => flushAnswer(i).catch(() => {})), 50);
          }
        }
      })
      .catch(() => { if (!dead) setRow(null); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [id]);

  // A teacher publishes the grade while this page is open: show it.
  useEffect(() => onActivityGraded((evt) => {
    const mine = rowRef.current;
    if (!mine || String(evt?.assignmentId) !== String(mine.assignmentId)) return;
    fetchMyActivities()
      .then((rows) => { const fresh = rows.find((r) => r.assignmentId === mine.assignmentId); if (fresh) setRow(fresh); })
      .catch(() => {});
  }), []);

  const t = row ? typeOf(row.kind) : typeOf();
  const isDone = row?.status === 'complete';
  const questions = useMemo(() => {
    const q = row?.briefDetails?.questions;
    return Array.isArray(q) && q.length ? q : null;
  }, [row]);
  const useStepper = !!questions && !row?.graded;
  const fileCounts = useMemo(() => {
    const out = {};
    files.forEach((f) => { if (f.question != null) out[f.question] = (out[f.question] || 0) + 1; });
    return out;
  }, [files]);

  // Autosave only while there is outstanding work — once submitted, the
  // server copy owns the record and the local draft stays cleared.
  useEffect(() => {
    if (row && work && row.status !== 'complete') saveWork(row.assignmentId, work);
  }, [row, work]);

  const submit = async () => {
    setSubmitting(true);
    setSubmitErr('');
    try {
      const typed = Object.fromEntries(Object.entries(workRef.current?.answers ?? {}).filter(([i, v]) => hasAnswer(questions?.[i], v)));
      const payload = {
        text: questions ? '' : (workRef.current?.text ?? ''),
        answers: questions ? typed : {},
        // Every file uploaded for this work is handed in (each with its question).
        fileIds: [],
      };
      const target = await completeActivity(row.assignmentId, payload);
      const handed = target?.submission?.files
        ?? files;
      setRow((r) => ({ ...r, status: 'complete', completedAt: r.completedAt || new Date().toISOString(), submission: { text: payload.text, answers: target?.submission?.answers ?? payload.answers, files: handed, submittedAt: target?.submission?.submittedAt || new Date().toISOString() } }));
      sheetRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' });
      // The server now owns the work — the local draft is spent.
      try { localStorage.removeItem(storeKey(row.assignmentId)); } catch { /* private mode */ }
    } catch (e) {
      setSubmitErr(e?.message || 'Could not submit. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  /* Save one question's answer on the server (null clears it). */
  const saveAnswer = async (index, value) => {
    const r = rowRef.current;
    const q = r?.briefDetails?.questions?.[index];
    const out = await saveActivityAnswer(r.assignmentId, index, hasAnswer(q, value) ? value : null);
    setSaved((s) => {
      const next = { ...s };
      if (out?.value === null || out?.value === undefined) delete next[index]; else next[index] = out.value;
      return next;
    });
  };

  /* Save what's typed for question i now — one save at a time per question,
     always the latest text. */
  function flushAnswer(i) {
    clearTimeout(timers.current[i]);
    delete timers.current[i];
    const run = () => saveAnswer(i, workRef.current?.answers?.[i]).then(
      () => setSaveErrs((e) => ({ ...e, [i]: '' })),
      (e) => { setSaveErrs((x) => ({ ...x, [i]: e?.message || 'Not saved' })); throw e; });
    const p = (chains.current[i] || Promise.resolve()).catch(() => {}).then(run);
    chains.current[i] = p;
    return p;
  }

  /* Typing autosaves after a short pause. */
  const typeAnswer = (i, v) => {
    setWork((w) => ({ ...w, answers: { ...w.answers, [i]: v }, editedAt: new Date().toISOString() }));
    clearTimeout(timers.current[i]);
    timers.current[i] = setTimeout(() => { flushAnswer(i).catch(() => {}); }, 900);
  };

  /* Files belong to a question — up to 3 each, 5MB, uploaded straight away. */
  const pickFiles = async (i, list) => {
    const picked = Array.from(list || []);
    if (!picked.length || uploadingQ !== null) return;
    setFileErr(null);
    let count = files.filter((f) => f.question != null && Number(f.question) === i).length;
    for (const file of picked) {
      if (count >= PER_QUESTION_FILES) { setFileErr({ index: i, message: `Up to ${PER_QUESTION_FILES} files per question.` }); break; }
      if (!FILE_OK.test(file.name)) { setFileErr({ index: i, message: `${file.name}: only PDF, JPG, PNG, Word (.docx) or text files.` }); continue; }
      if (file.size > 5 * 1024 * 1024) { setFileErr({ index: i, message: `${file.name} is larger than 5MB.` }); continue; }
      setUploadingQ(i);
      try {
        const meta = await uploadActivityFile(row.assignmentId, file, i);
        if (!meta?.id) throw new Error('Upload failed.');
        setFiles((fs) => [...fs, { ...meta, name: meta.name || file.name, size: meta.size || file.size, question: i }]);
        count += 1;
      } catch (e) {
        setFileErr({ index: i, message: e?.message || 'Could not upload that file. Try again.' });
      }
    }
    setUploadingQ(null);
  };

  const removeFile = async (f) => {
    setRemoving(f.id); setFileErr(null);
    try {
      await removeActivityFile(f.id);
      setFiles((fs) => fs.filter((x) => x.id !== f.id));
      if (DRAWING_RE.test(f.name || '') && f.question != null) {
        setWork((w) => { const d = { ...(w.drawings || {}) }; delete d[f.question]; return { ...w, drawings: d }; });
      }
      if (DOC_RE.test(f.name || '') && f.question != null) storeDoc(row.assignmentId, Number(f.question), null);
    } catch (e) {
      setFileErr({ index: f.question, message: e?.message || 'Could not remove that file.' });
    } finally {
      setRemoving(null);
    }
  };

  /* A drawing reopens on the whiteboard while the work is open; anything else downloads. */
  // Handed in: my work as the submission paper (shown until it's marked, and downloaded).
  const submittedAt = row?.submission?.submittedAt || null;
  const hasPaper = Array.isArray(row?.briefDetails?.questions) && row.briefDetails.questions.length > 0;
  useEffect(() => {
    setPaperDoc(null);
    if (!submittedAt || !row?.targetId || !hasPaper) return undefined;
    let live = true;
    fetchMySubmissionDocument(row.targetId).then((d) => { if (live) setPaperDoc(d); }).catch(() => {});
    return () => { live = false; };
  }, [row?.targetId, submittedAt, hasPaper]);   // eslint-disable-line react-hooks/exhaustive-deps
  const loadPaperFile = (f) => fetchActivityFileBlob(f.id);
  const downloadSubmission = () => {
    setPdfBusy(true); setSubmitErr('');
    const done = paperDoc
      ? printSheet(<SubmissionSheet doc={paperDoc} printable={false} loadFile={loadPaperFile} />, { title: `${row.title || 'Submission'} — my submission` })
      : downloadMySubmissionPdf(row.targetId, row.title);
    Promise.resolve(done).catch((e) => setSubmitErr(e?.message || 'Could not get the PDF.')).finally(() => setPdfBusy(false));
  };

  const openFile = (f) => {
    const editable = row?.status !== 'complete' && !row?.graded && f.question != null;
    if (editable && DRAWING_RE.test(f.name || '')) { setBoard(Number(f.question)); return; }
    if (editable && DOC_RE.test(f.name || '')) { openDoc(Number(f.question)); return; }
    downloadActivityFile(f.id, f.name).catch((e) => setSubmitErr(e?.message || 'Could not open that file.'));
  };

  /* A file this page made (a drawing, a document) becomes question i's file,
     replacing the one it made before — that one doesn't count toward the 3. */
  const replaceOwnFile = async (i, file) => {
    const old = files.find((f) => f.question != null && Number(f.question) === i && f.name === file.name);
    const others = files.filter((f) => f.question != null && Number(f.question) === i && f.id !== old?.id).length;
    if (others >= PER_QUESTION_FILES) throw new Error(`Up to ${PER_QUESTION_FILES} files per question — remove one first.`);
    if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} is larger than 5MB — use smaller pictures.`);
    // At the cap, the old copy goes first so the server has room for the new one.
    const atCap = old && others + 1 >= PER_QUESTION_FILES;
    if (atCap) {
      await removeActivityFile(old.id);
      setFiles((fs) => fs.filter((f) => f.id !== old.id));
    }
    const meta = await uploadActivityFile(row.assignmentId, file, i);
    if (!meta?.id) throw new Error('Upload failed.');
    if (old && !atCap) await removeActivityFile(old.id).catch(() => {});
    setFiles((fs) => [...fs.filter((f) => f.id !== old?.id), { ...meta, name: meta.name || file.name, size: meta.size || file.size, question: i }]);
  };

  /* "Attach to answer": the drawing becomes that question's file — re-attaching replaces it. */
  const attachDrawing = async (blob, strokes) => {
    const i = board;
    setFileErr(null); setUploadingQ(i);
    try {
      await replaceOwnFile(i, new File([blob], `drawing-q${i + 1}.png`, { type: 'image/png' }));
      setWork((w) => ({ ...w, drawings: { ...(w.drawings || {}), [i]: strokes } }));
    } catch (e) {
      setFileErr({ index: i, message: e?.message || 'Could not attach the drawing. Try again.' });
    } finally {
      setUploadingQ(null);
      setBoard(null);
    }
  };

  /* The document editor: this device's draft first, else the attached .docx read back, else a blank page. */
  const openDoc = async (i) => {
    setFileErr(null);
    const local = loadDoc(row.assignmentId, i);
    if (local?.json) { setDoc({ index: i, initial: { json: local.json, page: local.page }, dirty: !local.saved }); return; }
    const attached = files.find((f) => f.question != null && Number(f.question) === i && DOC_RE.test(f.name || ''));
    if (!attached) { setDoc({ index: i, initial: {}, dirty: false }); return; }
    setDoc({ index: i, loading: true });
    try {
      const [blob, mammoth] = await Promise.all([fetchActivityFileBlob(attached.id), import('mammoth')]);
      const { value } = await (mammoth.default || mammoth).convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
      setDoc({ index: i, initial: { html: value }, dirty: false });
    } catch (e) {
      setDoc(null);
      setFileErr({ index: i, message: e?.message || 'Could not open the document.' });
    }
  };
  const docFileName = (i) => `document-q${i + 1}.docx`;
  /* "Save to answer": a real Word file, attached to the question. */
  const saveDoc = async (json, page) => {
    const i = doc.index;
    const { docxBlob } = await import('../lib/wordDoc.js');
    const blob = await docxBlob(json, page, { title: `${row.title} — Question ${i + 1}` });
    setUploadingQ(i);
    try {
      await replaceOwnFile(i, new File([blob], docFileName(i), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      storeDoc(row.assignmentId, i, { json, page, saved: true });
    } finally {
      setUploadingQ(null);
    }
  };
  const downloadDoc = async (json, page) => {
    const { docxBlob } = await import('../lib/wordDoc.js');
    saveBlobAs(await docxBlob(json, page, { title: row.title }), docFileName(doc.index));
  };

  /* Hand in: answers still saving go first. */
  const handIn = async () => {
    setSubmitErr('');
    const pending = lastCheck(questions, workRef.current?.answers, saved, fileCounts).pending;
    if (pending.length) {
      setSubmitting(true);
      try { for (const i of pending) await flushAnswer(i); }
      catch { setSubmitErr('Some answers could not be saved — check your connection and try again.'); setSubmitting(false); return; }
    }
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    await submit();
    setChecking(false);
  };

  /* Work without questions: the written answer autosaves to the server, and
     up to 5 files ride with it (uploaded straight away; removing deletes). */
  const LOOSE_MAX = 5;
  const looseFiles = files.filter((f) => f.question == null);
  const typeText = (text) => {
    setWork((w) => ({ ...w, text, editedAt: new Date().toISOString() }));
    setTextSave('saving');
    clearTimeout(timers.current.text);
    timers.current.text = setTimeout(() => {
      saveActivityText(rowRef.current.assignmentId, workRef.current?.text ?? '')
        .then(() => setTextSave('saved'), () => setTextSave('error'));
    }, 900);
  };

  const pickLoose = async (list) => {
    const picked = Array.from(list || []);
    if (!picked.length || uploading) return;
    setSubmitErr('');
    let count = looseFiles.length;
    setUploading(true);
    for (const file of picked) {
      if (count >= LOOSE_MAX) { setSubmitErr(`Up to ${LOOSE_MAX} files.`); break; }
      if (!FILE_OK.test(file.name)) { setSubmitErr(`${file.name}: only PDF, JPG, PNG, Word (.docx) or text files.`); continue; }
      if (file.size > 5 * 1024 * 1024) { setSubmitErr(`${file.name} is larger than 5MB.`); continue; }
      try {
        const meta = await uploadActivityFile(row.assignmentId, file);
        if (!meta?.id) throw new Error('Upload failed.');
        setFiles((fs) => [...fs, { ...meta, name: meta.name || file.name, size: meta.size || file.size }]);
        count += 1;
      } catch (e) {
        setSubmitErr(e?.message || 'Could not upload that file. Try again.');
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  /* The attachment area for work without questions — the files, then a drop zone. */
  const attachArea = (
    <>
      {looseFiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {looseFiles.map((f) => <FileCard key={f.id} file={f} onOpen={openFile} onRemove={removeFile} busy={removing === f.id} sans="'Nunito',sans-serif"/>)}
        </div>
      )}
      {fileErr?.index == null && fileErr?.message && <div style={{ fontSize: 12, fontWeight: 700, color: RED, marginTop: 8 }}>{fileErr.message}</div>}
      {uploading ? (
        <div style={{ marginTop: 8, border: '1.5px dashed var(--ak-border)', borderRadius: 14, padding: '22px 14px', textAlign: 'center', background: 'var(--ak-surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
          <Spinner size={15} color={BRAND}/>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>Uploading…</div>
        </div>
      ) : looseFiles.length < LOOSE_MAX && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); pickLoose(e.dataTransfer.files); }}
          style={{
            marginTop: 8, border: `1.5px dashed ${dragOver ? BRAND : 'var(--ak-border)'}`, borderRadius: 14,
            padding: '22px 14px', textAlign: 'center', cursor: 'pointer',
            background: dragOver ? `${BRAND}0A` : 'var(--ak-surface)',
          }}>
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
            accept=".pdf,.jpg,.jpeg,.png,.docx,.txt"
            onChange={(e) => pickLoose(e.target.files)}/>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: `${BRAND}14`, color: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
            <Icon name="ti-cloud-upload" size={16}/>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>Click to upload or drag and drop</div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ak-text-muted)', marginTop: 3 }}>PDF, JPG, PNG, DOCX or TXT up to 5MB · {looseFiles.length}/{LOOSE_MAX} files</div>
        </div>
      )}
    </>
  );

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
        <div style={{ width: 56, height: 56, borderRadius: 18, background: `${BRAND}14`, color: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="ti-inbox" size={28}/></div>
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
      <div ref={sheetRef} style={{ flex: 1, overflowY: 'auto', background: 'var(--ak-bg)', borderRadius: '24px 24px 0 0', marginTop: -18, position: 'relative', zIndex: 2 }}>
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
              {/* the rubric behind the score */}
              {row.feedbackRubric?.some((r) => r?.name) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
                  {row.feedbackRubric.filter((r) => r?.name).map((r) => (
                    <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, fontWeight: 700, color: '#065F46' }}>
                      <span style={{ flex: 1, minWidth: 0 }}>{r.name}</span>
                      <span style={{ width: 70, height: 5, borderRadius: 3, background: 'rgba(16,185,129,.18)', overflow: 'hidden', flexShrink: 0 }}>
                        <span style={{ display: 'block', height: '100%', width: `${r.max ? Math.min(100, ((r.level ?? 0) / r.max) * 100) : 0}%`, background: '#10B981' }}/>
                      </span>
                      <span style={{ width: 34, textAlign: 'right', flexShrink: 0 }}>{r.level ?? '–'}/{r.max}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* the marked copy — the work with the teacher's ticks, crosses and comments */}
              {row.markedPdf && row.targetId && (
                <button type="button" disabled={pdfBusy}
                  onClick={() => { setPdfBusy(true); setSubmitErr(''); downloadMySubmissionPdf(row.targetId, row.title, { marked: true }).catch((e) => setSubmitErr(e?.message || 'Could not get the marked copy.')).finally(() => setPdfBusy(false)); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 12, padding: '8px 14px', borderRadius: 20, border: 'none', background: '#047857', color: '#fff', fontSize: 12, fontWeight: 800, cursor: pdfBusy ? 'default' : 'pointer', fontFamily: "'Nunito',sans-serif" }}>
                  {pdfBusy ? <Spinner size={12}/> : <Icon name="ti-file-check" size={14}/>} Download marked copy (PDF)
                </button>
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

          {/* handed in, not marked yet: the receipt */}
          {isDone && !row.graded && questions?.length > 0 && <Receipt questions={questions} submission={row.submission} completedAt={row.completedAt || row.submission?.submittedAt}/>}

          {/* a question paper once handed in: the paper with every answer under
              its question — marked (key, each mark and comment) once graded */}
          {(isDone || row.graded) && questions?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', margin: '0 0 12px', fontFamily: "'Nunito',sans-serif" }}>{row.graded ? 'Your marked paper' : 'Your submission'}</p>
              {!row.graded && paperDoc
                ? <SubmissionSheet doc={paperDoc} embedded printable={false} loadFile={loadPaperFile} onOpenFile={openFile}/>
                : <AnswerPaper details={row.briefDetails} answers={row.submission?.answers || {}} files={row.submission?.files || []}
                    marks={row.graded ? row.feedbackQuestions || [] : []} showKey={!!row.graded} onOpenFile={openFile} sans="'Nunito',sans-serif"/>}
            </div>
          )}

          {/* the work the learner handed in — server copy (work without questions) */}
          {(isDone || row.graded) && !questions?.length && <div style={{ marginBottom: 20 }}><SubmittedWork submission={row.submission} questions={questions}/></div>}

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

          {/* the whole submission as one PDF — the copy the teacher grades */}
          {row.submission?.submittedAt && row.targetId && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <button type="button" disabled={pdfBusy}
                onClick={downloadSubmission}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 20, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 12.5, fontWeight: 800, cursor: pdfBusy ? 'default' : 'pointer', fontFamily: "'Nunito',sans-serif" }}>
                {pdfBusy ? <Spinner size={12}/> : <Icon name="ti-file-type-pdf" size={14} color={RED}/>} Download my submission (PDF)
              </button>
            </div>
          )}
          {row.submission?.submittedAt && submitErr && isDone && (
            <div style={{ fontSize: 12, fontWeight: 700, color: RED, textAlign: 'center', marginBottom: 10 }}>{submitErr}</div>
          )}

          {/* submitted confirmation (work without questions — a paper gets the receipt above) */}
          {isDone && !row.graded && !questions?.length && (
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
                {useStepper ? `Questions · ${questions.length}` : 'Your answer'}
              </p>
              {useStepper ? (
                <Stepper questions={questions} paper={row.briefDetails} work={work} saved={saved} files={files} fileCounts={fileCounts}
                  onType={typeAnswer} onFlush={flushAnswer} saveErrs={saveErrs}
                  onPick={pickFiles} onRemove={removeFile} onOpenFile={openFile} onDraw={(i) => { setFileErr(null); setBoard(i); }} onWrite={openDoc}
                  uploading={uploadingQ} removing={removing} fileErr={fileErr}
                  mid={t.mid} dark={t.dark} onHandIn={() => { setSubmitErr(''); setChecking(true); }} submitting={submitting} jumpRef={stepperJump}/>
              ) : (
                <>
                  <textarea
                    value={work?.text || ''} onChange={(e) => typeText(e.target.value)}
                    placeholder="Type your answer or working…"
                    maxLength={8000}
                    style={{ width: '100%', minHeight: 110, borderRadius: 12, border: '1.5px solid var(--ak-border)', padding: '11px 13px', fontFamily: "'Nunito',sans-serif", fontSize: 12.5, fontWeight: 600, color: 'var(--ak-text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box', background: 'var(--ak-surface)' }}/>
                  <div style={{ fontSize: 11, fontWeight: 800, textAlign: 'right', marginTop: 4, color: textSave === 'error' ? RED : textSave === 'saved' ? '#047857' : 'var(--ak-text-muted)' }}>
                    {textSave === 'saving' ? 'Saving…' : textSave === 'saved' ? 'Saved' : textSave === 'error' ? 'Not saved — check your connection' : ''}
                  </div>
                  {attachArea}
                </>
              )}
              {submitErr && <div style={{ fontSize: 12, fontWeight: 700, color: RED, marginTop: 10 }}>{submitErr}</div>}
            </>
          )}
        </div>
      </div>

      {/* the last check before handing in */}
      {checking && useStepper && !isDone && (
        <LastCheck check={lastCheck(questions, work.answers, saved, fileCounts)} total={questions.length} questions={questions}
          onAnswer={(i) => { setChecking(false); stepperJump.current?.(i); }}
          onSubmit={handIn} onClose={() => !submitting && setChecking(false)} submitting={submitting || uploadingQ !== null} err={submitErr} mid={t.mid} dark={t.dark}/>
      )}

      {/* the document editor, writing one question's answer */}
      {doc && (doc.loading ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3500, background: '#E6E6E6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: "'Nunito',sans-serif" }}>
          <Spinner size={22} color="#2B579A"/><span style={{ fontSize: 13, fontWeight: 700, color: '#444' }}>Opening {docFileName(doc.index)}…</span>
        </div>
      ) : (
        <Suspense fallback={<div style={{ position: 'fixed', inset: 0, zIndex: 3500, background: '#E6E6E6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={22} color="#2B579A"/></div>}>
          <WordEditor key={doc.index} fileName={docFileName(doc.index)} subtitle={`Question ${doc.index + 1}`} initial={doc.initial} dirty={doc.dirty}
            onSave={saveDoc} onDownload={downloadDoc} onClose={() => setDoc(null)}
            onDraft={(json, page) => storeDoc(row.assignmentId, doc.index, { json, page, saved: false })}/>
        </Suspense>
      ))}

      {/* the whiteboard, drawing for one question's answer */}
      {board !== null && (
        <WhiteboardModal title={`Draw your answer · Question ${board + 1}`} topic={qText(questions?.[board]).slice(0, 90)} subject={row.subject || ''}
          initialStrokes={work?.drawings?.[board] || null} onAttach={attachDrawing} onClose={() => setBoard(null)}/>
      )}

      {/* ── Footer ── */}
      {(!useStepper || isDone) && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', background: 'var(--ak-surface)', boxShadow: '0 -8px 20px rgba(17,24,39,.07)' }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-muted)', fontFamily: "'Nunito',sans-serif" }}>
            {row.graded ? `Graded · ${row.grade}%` : isDone ? 'Submitted' : row.subject || row.topic || t.label}
          </span>
          {!isDone && !row.graded ? (
            <button onClick={submit} disabled={submitting || uploading}
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
