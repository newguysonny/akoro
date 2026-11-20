import { useEffect, useRef, useState } from 'react';
import Spinner from '../../../components/common/Spinner.jsx';
import { Icon } from '../../../components/common/Icons.jsx';
import { BRAND, RED } from '../../../constants.js';
import { fetchMyDraftPaper } from '../../../services/activityApi.js';
import { stepStatuses, resumeStep } from '../../../lib/questionSteps.js';
import { letterOf } from '../../../lib/paper.js';
import { MathText, QuestionFigure, QuestionContext } from '../../../components/activity/QuestionPaper.jsx';
import AnswerPaper, { FileCard } from '../../../components/activity/AnswerPaper.jsx';
import PaperFrame from '../../../components/activity/PaperFrame.jsx';
import AnswerBox from './AnswerBox.jsx';
import { STEP_LOOK, qText, isMcq, kindOf, ptsOf } from './activityDetailModel.js';

export default function Stepper({ questions, paper, work, saved, files, fileCounts, onType, onFlush, saveErrs, onPick, onRemove, onOpenFile, onDraw, onWrite, uploading, removing, fileErr, pending, onCancelPending, mid, dark, onHandIn, submitting, jumpRef, targetId }) {
  const total = questions.length;
  const [idx, setIdx] = useState(() => resumeStep(questions, work.answers, saved, fileCounts));
  const [moving, setMoving] = useState(false);
  const [stepErr, setStepErr] = useState('');
  const topRef = useRef(null);
  const dockRef = useRef(null);
  const [dockH, setDockH] = useState(220);
  const statuses = stepStatuses(questions, work.answers, saved, fileCounts);
  const answeredCount = statuses.filter((st) => st !== 'empty').length;
  const reviewing = idx >= total;
  // The Review step shows my answers on the server's paper template (same as the handed-in copy).
  const [draftHtml, setDraftHtml] = useState(null);
  useEffect(() => {
    if (!reviewing || !targetId) return undefined;
    let live = true;
    setDraftHtml(null);
    fetchMyDraftPaper(targetId).then((h) => { if (live) setDraftHtml(h); }).catch(() => {});
    return () => { live = false; };
  }, [reviewing, targetId]);
  // Keep the question clear of the fixed dock, whatever height the answer box grows to.
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return undefined;
    const measure = () => setDockH(el.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [reviewing, idx]);

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
        {draftHtml
          ? <PaperFrame html={draftHtml} title="My answers"/>
          : <AnswerPaper details={paper} answers={work.answers} files={files} onEdit={go} onOpenFile={onOpenFile} showLoose={false} sans="'Nunito',sans-serif"/>}
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

      {/* the dock: answer box + Back/Next are fixed to the bottom of the screen while the question scrolls above;
          the spacer keeps the last of the question clear of it */}
      <div aria-hidden style={{ height: dockH + 16 }}/>
      <div ref={dockRef} data-testid="answer-dock" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, background: 'var(--ak-bg)', boxShadow: '0 -10px 22px -10px rgba(17,24,39,.22)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '2px 20px 12px' }}>
      <div style={{ maxHeight: '44vh', overflowY: 'auto', padding: '0 2px' }}>
      <AnswerBox format={paper?.answer_format} q={q} idx={idx} value={work.answers[idx]} onType={(v) => onType(idx, v)}
        files={qFiles} pending={(pending || []).filter((x) => x.question === idx)} onCancelPending={onCancelPending} onPick={(list) => onPick(idx, list)} onRemove={onRemove} onOpenFile={onOpenFile} onDraw={() => onDraw(idx)} onWrite={() => onWrite(idx)}
        uploading={uploading === idx} removing={removing} status={status} saveErr={saveErrs[idx]} onRetry={() => onFlush(idx).catch(() => {})}
        fileErr={fileErr?.index === idx ? fileErr.message : ''}/>

      </div>
      {stepErr && <div style={{ fontSize: 12, fontWeight: 700, color: RED, marginTop: 10 }}>{stepErr}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
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
      </div>
    </div>
  );
}
