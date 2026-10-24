/*
 * AssignmentSimulator — the assignment as a learner works through it, played
 * for the instructor to watch: the learner app's step rail (1 2 3 … Review),
 * one question at a time with the answer typed in, "Submit answer & next",
 * the review of the whole paper, then "Submit assignment" and what happens
 * next (objective questions marked at once, written ones waiting for you).
 *
 * Sample data only: the answers come from the paper itself (its key and
 * marking scheme), one objective answer deliberately wrong so the marking
 * shows. No API calls; nothing is submitted. The look follows the learner
 * app's ActivityDetailPage stepper.
 */
import { useEffect, useMemo, useState } from 'react';
import { Ico } from '../../theme/Ico.jsx';
import { C } from '../../theme/colors.js';
import AnswerPaper from '../paper/AnswerPaper.jsx';
import { MathText, Figure } from '../paper/PaperView.jsx';

const MID = '#6C3BFF', DARK = '#4C1DCC';
const NUNITO = "'Nunito', system-ui, sans-serif";
const LETTERS = 'ABCDEFGHIJ';
const qText = (q) => String(q?.q ?? q?.text ?? '');
const isMcq = (q) => Array.isArray(q?.options) && q.options.length >= 2;
const ptsOf = (q) => (Number(q?.max_points ?? q?.points) > 0 ? Number(q.max_points ?? q.points) : null);
const kindOf = (q) => (q?.format === 'true_false' ? 'True or false' : q?.format === 'label' ? 'Labelling' : q?.format === 'assertion_reason' ? 'Assertion and reason'
  : isMcq(q) ? 'Multiple choice' : String(q?.type || 'Written answer'));

/** PURE: what the sample learner answers, question by question. → [{ text, pick, correct, auto }] */
export function sampleAnswers(paper, { topic = '' } = {}) {
  const qs = paper?.questions || [];
  const objective = qs.map((q, i) => (isMcq(q) ? i : -1)).filter((i) => i >= 0);
  // One objective answer wrong (the second, else the first) so the marking shows; the rest right.
  const wrong = objective.length >= 2 ? objective[1] : objective.length >= 3 ? objective[0] : -1;
  return qs.map((q, i) => {
    if (isMcq(q)) {
      const right = Number.isInteger(q.correct) ? q.correct : 0;
      const pick = i === wrong ? (right + 1) % q.options.length : right;
      return { text: `${LETTERS[pick]}`, pick, correct: pick === right, auto: true };
    }
    if (q?.format === 'label' && Array.isArray(q.labels)) {
      const key = Object.fromEntries((q.label_answers || []).map((x) => [x.label, x.answer]));
      return { text: q.labels.map((l) => `${l}: ${key[l] || '…'}`).join('\n'), labels: q.labels.map((l) => [l, key[l] || '']), auto: false };
    }
    const scheme = String(q?.answer || '').replace(/\s+/g, ' ').trim();
    const first = scheme.split(/(?<=[.!?])\s/)[0] || '';
    return { text: first ? first.slice(0, 220) : `My answer on ${topic || 'this topic'}: I explained it in my own words with an example.`, auto: false };
  });
}

/** PURE: the steps the simulation plays. */
function timeline(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ at: i, phase: 'show', ms: 700 }, { at: i, phase: 'typing', ms: 1300 }, { at: i, phase: 'answered', ms: 700 });
  out.push({ at: n, phase: 'review', ms: 2600 }, { at: n, phase: 'submitting', ms: 1100 }, { at: n, phase: 'submitted', ms: 0 });
  return out;
}

export default function AssignmentSimulator({ paper, title = '', topic = '', instructions = '', onClose }) {
  const questions = useMemo(() => paper?.questions || [], [paper]);
  const answers = useMemo(() => sampleAnswers(paper, { topic }), [paper, topic]);
  const steps = useMemo(() => timeline(questions.length), [questions.length]);
  const [k, setK] = useState(0);
  const [typed, setTyped] = useState(0);
  const step = steps[Math.min(k, steps.length - 1)];
  useEffect(() => {
    if (!step || step.ms === 0) return undefined;
    const t = setTimeout(() => setK((x) => x + 1), step.ms);
    return () => clearTimeout(t);
  }, [k, step]);
  // The answer types itself in during "typing".
  useEffect(() => {
    if (step?.phase !== 'typing') { setTyped(step?.phase === 'answered' ? Infinity : 0); return undefined; }
    const full = answers[step.at]?.text || '';
    let n = 0;
    const every = Math.max(12, Math.floor(1100 / Math.max(1, full.length)));
    const t = setInterval(() => { n += 1; setTyped(n); if (n >= full.length) clearInterval(t); }, every);
    return () => clearInterval(t);
  }, [step, answers]);

  if (!questions.length) return <div style={{ padding: 20, fontSize: 12.5, color: C.muted }}>No questions to play yet.</div>;
  const idx = Math.min(step.at, questions.length);
  const done = (i) => i < idx || (i === idx && step.phase === 'answered');
  const answeredCount = questions.filter((_, i) => done(i) || idx >= questions.length).length;
  const shownAnswers = Object.fromEntries(answers.map((a, i) => [String(i), a.text]));

  const rail = (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {questions.map((_, i) => {
        const on = i === idx && idx < questions.length;
        const ok = idx >= questions.length || done(i);
        return (
          <span key={i} style={{ minWidth: 30, height: 30, padding: '0 7px', borderRadius: 10, border: `1.5px solid ${on ? MID : ok ? 'rgba(16,185,129,.45)' : C.border}`, background: on ? `${MID}14` : ok ? 'rgba(16,185,129,.14)' : C.surface, color: on ? MID : ok ? '#047857' : C.muted2, fontSize: 12, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: NUNITO }}>
            {ok && !on ? <Ico ti="ti-check" size={12} color="#047857" /> : i + 1}
          </span>
        );
      })}
      <span style={{ height: 30, padding: '0 11px', borderRadius: 10, border: `1.5px solid ${idx >= questions.length ? MID : C.border}`, background: idx >= questions.length ? `${MID}14` : C.surface, color: idx >= questions.length ? MID : C.muted2, fontSize: 12, fontWeight: 900, display: 'inline-flex', alignItems: 'center', fontFamily: NUNITO }}>Review</span>
    </div>
  );

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.05em', padding: '3px 8px', borderRadius: 999, background: 'rgba(16,185,129,.12)', color: '#047857' }}>SIMULATION</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 850, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Assignment'} · as a learner sees it</span>
      <button type="button" onClick={() => { setK(0); setTyped(0); }} title="Play again" aria-label="Play again" style={iconBtn}><Ico ti="ti-reload" size={14} /></button>
      {onClose && <button type="button" onClick={onClose} title="Close" aria-label="Close preview" style={iconBtn}><Ico ti="ti-x" size={14} /></button>}
    </div>
  );

  let body;
  if (step.phase === 'submitted') {
    const auto = answers.filter((a) => a.auto);
    const right = auto.filter((a) => a.correct).length;
    const written = answers.length - auto.length;
    body = (
      <div data-sim-submitted="" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, padding: '26px 14px' }}>
        <div style={{ width: 58, height: 58, borderRadius: '50%', background: 'rgba(16,185,129,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti="ti-circle-check" size={32} color="#047857" /></div>
        <div style={{ fontSize: 17, fontWeight: 900, color: C.ink, fontFamily: NUNITO }}>Assignment submitted</div>
        <div style={{ fontSize: 12.5, color: C.muted, maxWidth: 320, lineHeight: 1.5 }}>The learner's answers come to you; they can't change them now.</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
          {auto.length > 0 && <Stat n={`${right}/${auto.length}`} l="objective · marked at once" c="#047857" />}
          {written > 0 && <Stat n={`${written}`} l={`written · waiting for you`} c="#B45309" />}
        </div>
        <div style={{ fontSize: 11, color: C.muted2, marginTop: 6 }}>A preview with sample answers — nothing was submitted.</div>
      </div>
    );
  } else if (idx >= questions.length) {
    const marks = questions.reduce((n, q) => n + (ptsOf(q) || 0), 0);
    body = (
      <div data-sim-review="">
        {rail}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Stat n={`${questions.length}`} l={`question${questions.length === 1 ? '' : 's'}`} />
          {marks > 0 && <Stat n={`${marks}`} l="marks" />}
          <Stat n={`${answeredCount}/${questions.length}`} l="answered" c="#047857" />
        </div>
        <div style={{ maxHeight: 300, overflowY: 'auto', borderRadius: 12, border: `1px solid ${C.borderSoft}`, padding: 10, background: '#fff' }}>
          <AnswerPaper details={paper} title={title} instructions={instructions} answers={shownAnswers} showLoose={false} sans={NUNITO} />
        </div>
        <div style={{ width: '100%', marginTop: 12, padding: 11, borderRadius: 20, background: `linear-gradient(135deg, ${MID}, ${DARK})`, color: '#fff', fontSize: 13, fontWeight: 900, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 7, fontFamily: NUNITO, boxShadow: step.phase === 'submitting' ? `0 0 0 4px ${MID}33` : 'none', transform: step.phase === 'submitting' ? 'scale(.98)' : 'none', transition: 'all .2s' }}>
          {step.phase === 'submitting' ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-send" size={14} />} Submit assignment
        </div>
      </div>
    );
  } else {
    const q = questions[idx];
    const a = answers[idx];
    const pts = ptsOf(q);
    const typing = step.phase === 'typing';
    const text = (a.text || '').slice(0, typing ? typed : step.phase === 'answered' ? Infinity : 0);
    body = (
      <div data-sim-question={idx + 1}>
        {rail}
        <div style={{ background: C.surface, borderRadius: 16, padding: 14, boxShadow: '0 2px 10px rgba(17,24,39,.06)', border: `1px solid ${C.borderSoft}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: C.muted2, textTransform: 'uppercase', letterSpacing: '.03em' }}>Question {idx + 1} of {questions.length}</span>
            <span style={{ fontSize: 9.5, fontWeight: 900, color: MID, background: `${MID}14`, padding: '2px 8px', borderRadius: 999 }}>{kindOf(q)}</span>
            {pts && <span style={{ fontSize: 9.5, fontWeight: 900, color: C.muted, background: C.bg, padding: '2px 8px', borderRadius: 999 }}>{pts} mark{pts === 1 ? '' : 's'}</span>}
            <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 999, ...(step.phase === 'answered' ? { color: '#047857', background: 'rgba(16,185,129,.14)' } : { color: C.muted2, background: C.bg }) }}>{step.phase === 'answered' ? 'Answered' : 'Not answered'}</span>
          </div>
          <p style={{ fontSize: 14, fontWeight: 800, color: C.ink, lineHeight: 1.5, margin: '0 0 10px', fontFamily: NUNITO, whiteSpace: 'pre-line' }}>
            {q?.format === 'assertion_reason' && q.assertion ? <><b>Assertion:</b> <MathText text={q.assertion} /><br /><b>Reason:</b> <MathText text={q.reason || ''} /></> : <MathText text={qText(q)} />}
          </p>
          {q?.figure && <Figure figure={q.figure} maxHeight={170} style={{ marginBottom: 10 }} />}
          {!q?.figure && q?.figure_note && <div style={{ fontSize: 11.5, color: C.muted, fontStyle: 'italic', marginBottom: 10 }}>[Figure: {q.figure_note}]</div>}
          {isMcq(q) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {q.options.map((o, oi) => (
                <div key={oi} style={{ display: 'flex', gap: 9, padding: '7px 10px', borderRadius: 10, background: C.bg, color: C.ink, fontSize: 13, fontWeight: 600, fontFamily: NUNITO }}>
                  <b style={{ minWidth: 14, color: MID }}>{LETTERS[oi]}.</b><span><MathText text={o} /></span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ marginTop: 10, padding: '10px 12px', border: `1px solid ${typing ? MID : C.border}`, boxShadow: typing ? `0 0 0 3px ${MID}1C` : 'none', borderRadius: 18, background: C.surface }}>
          <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '.05em', textTransform: 'uppercase', color: MID, marginBottom: 5, fontFamily: NUNITO }}>Your answer</div>
          {a.labels ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {a.labels.map(([l, v], j) => {
                const before = a.labels.slice(0, j).reduce((n, [ll, vv]) => n + `${ll}: ${vv}\n`.length, 0);
                const seen = Math.max(0, Math.min(v.length, text.length - before - `${l}: `.length));
                return (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: MID, background: `${MID}12`, border: `1.5px solid ${MID}40` }}>{l}</span>
                    <span style={{ flex: 1, borderRadius: 10, border: `1px solid ${C.border}`, padding: '6px 10px', fontSize: 13, fontWeight: 600, minHeight: 18, color: C.ink, fontFamily: NUNITO }}>{v.slice(0, seen)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ minHeight: isMcq(q) ? 26 : 60, fontSize: 14, fontWeight: 600, lineHeight: 1.55, color: C.ink, fontFamily: NUNITO, whiteSpace: 'pre-wrap' }}>
              {text}{typing && <span style={{ display: 'inline-block', width: 2, height: 16, background: MID, marginLeft: 1, verticalAlign: 'text-bottom', animation: 'blink 1s step-end infinite' }} />}
            </div>
          )}
          {isMcq(q) && step.phase === 'answered' && (
            <div style={{ fontSize: 11.5, fontWeight: 800, marginTop: 4, color: '#047857', fontFamily: NUNITO }}>Read as {LETTERS[a.pick]} · {q.options[a.pick]}</div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            {['ti-paperclip', 'ti-pencil', 'ti-file-type-docx'].map((ti) => <span key={ti} style={{ width: 28, height: 28, borderRadius: '50%', border: `1px solid ${C.border}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#526078' }}><Ico ti={ti} size={14} /></span>)}
            {step.phase === 'answered' && <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 800, color: '#047857', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Saved <Ico ti="ti-check" size={13} /></span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <span style={{ padding: '8px 14px', borderRadius: 20, border: `1px solid ${C.border}`, color: C.muted2, fontSize: 12, fontWeight: 800, opacity: idx === 0 ? 0.4 : 1, fontFamily: NUNITO }}>← Back</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.muted2, fontFamily: NUNITO }}>{answeredCount}/{questions.length} answered</span>
          <span style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 20, background: step.phase === 'answered' ? `linear-gradient(135deg, ${MID}, ${DARK})` : C.surface, border: step.phase === 'answered' ? 'none' : `1px solid ${C.border}`, color: step.phase === 'answered' ? '#fff' : C.ink, fontSize: 12, fontWeight: 900, fontFamily: NUNITO, transform: step.phase === 'answered' ? 'scale(.98)' : 'none', transition: 'all .2s' }}>
            {idx === questions.length - 1 ? 'Submit answer & review' : 'Submit answer & next'} →
          </span>
        </div>
      </div>
    );
  }

  return (
    <div data-assignment-sim="" style={{ fontFamily: C.font }}>
      <style>{'@keyframes blink{50%{opacity:0}}@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      {header}
      {body}
    </div>
  );
}

const iconBtn = { width: 28, height: 28, borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };

function Stat({ n, l, c }) {
  return (
    <div style={{ flex: '1 1 80px', background: C.surface, borderRadius: 14, padding: '9px 11px', boxShadow: '0 2px 10px rgba(17,24,39,.06)', border: `1px solid ${C.borderSoft}`, fontFamily: NUNITO }}>
      <div style={{ fontSize: 16, fontWeight: 900, color: c || C.ink }}>{n}</div>
      <div style={{ fontSize: 10, fontWeight: 800, color: C.muted2, textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
    </div>
  );
}
