/*
 * QuestionMarker — mark an assignment one question at a time.
 *
 *   Q1 → points + comment → "Save mark & next" → Q2 → … → Review → Publish
 *
 * The rail shows every question (marked ✓ / not yet) and the Review step.
 * Each step shows what the learner answered (an MCQ's pick against the
 * key), the points (quick buttons, halves allowed), a comment the learner
 * will see under that question, and the AI's suggestion when there is one.
 * Marks live in the parent (autosaved with the grading draft).
 */
import { Check, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { INK, MUTED, MUTED2, BORDER, WHITE, PURPLE, GREEN, RED, FONT } from '../../constants.js';
import { questionContext } from '../../lib/paper.js';
import { MathText, Figure, PassageBox } from '../paper/PaperView.jsx';

const qText = (q) => (typeof q === 'object' && q !== null ? String(q.q ?? '') : String(q ?? ''));
const isMcq = (q) => typeof q === 'object' && q !== null && Array.isArray(q.options);
const letterOf = (i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Number(i)] ?? '';

/** A question's points (5 when it doesn't say) — the API's rule too. */
export const pointsOf = (q) => {
  const n = Number(typeof q === 'object' && q ? q.max_points ?? q.points : NaN);
  return Number.isFinite(n) && n > 0 ? n : 5;
};

/** Marks pre-filled where the key decides: an MCQ's pick against `correct`. */
export function autoMarks(questions, answers = {}) {
  const out = {};
  (questions || []).forEach((q, i) => {
    if (!isMcq(q) || q.correct == null) return;
    const a = answers?.[i] ?? answers?.[String(i)];
    const answered = a !== undefined && a !== null && String(a) !== '';
    out[i] = { awarded: answered && Number(a) === Number(q.correct) ? pointsOf(q) : 0, comment: '', auto: true };
  });
  return out;
}

/** Total of the marks → { got, max, pct, complete }. */
export function markTotals(questions, marks) {
  let got = 0, max = 0, complete = true;
  (questions || []).forEach((q, i) => {
    max += pointsOf(q);
    const a = marks?.[i]?.awarded;
    if (a == null || a === '') complete = false; else got += Number(a);
  });
  return { got, max, pct: max ? Math.round((got / max) * 100) : 0, complete };
}

export function QuestionRail({ questions, step, setStep, marks }) {
  const n = questions.length;
  return (
    <div role="tablist" aria-label="Questions to mark" style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {questions.map((_, i) => {
        const done = marks?.[i]?.awarded != null && marks[i].awarded !== '';
        const on = step === i;
        return (
          <button key={i} role="tab" aria-selected={on} onClick={() => setStep(i)} title={`Question ${i + 1}${done ? ` · ${marks[i].awarded}/${pointsOf(questions[i])}` : ' · not marked'}`}
            style={{ minWidth: 30, height: 30, padding: '0 7px', borderRadius: 8, cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 900,
              border: `1.5px solid ${on ? PURPLE : done ? `${GREEN}66` : BORDER}`, background: on ? '#F1ECFF' : done ? '#E6F6EE' : WHITE, color: on ? PURPLE : done ? GREEN : MUTED,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            {done && !on ? <Check size={12} /> : i + 1}
          </button>
        );
      })}
      <button role="tab" aria-selected={step === n} onClick={() => setStep(n)}
        style={{ height: 30, padding: '0 11px', borderRadius: 8, cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 900,
          border: `1.5px solid ${step === n ? PURPLE : BORDER}`, background: step === n ? '#F1ECFF' : WHITE, color: step === n ? PURPLE : MUTED }}>
        Review
      </button>
    </div>
  );
}

export default function QuestionMarker({ questions, paper = null, step, setStep, marks, setMark, answers = {}, ai = null }) {
  const n = questions.length;
  const q = questions[step];
  const max = pointsOf(q);
  const mark = marks?.[step] ?? {};
  const raw = answers?.[step] ?? answers?.[String(step)];
  const answered = raw !== undefined && raw !== null && String(raw).trim() !== '';
  const aiQ = ai?.status === 'ready' ? (ai.questions || []).find((x) => x.index === step) : null;
  const marked = mark.awarded != null && mark.awarded !== '';
  const isLast = step === n - 1;
  // The paper around this question: its section's instructions, its passage.
  const ctx = questionContext(paper, step);
  const quick = max <= 10 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 4), Math.round(max / 2), Math.round((3 * max) / 4), max];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: .6, color: MUTED2 }}>QUESTION {step + 1} OF {n}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: MUTED2 }}>{max} pt{max === 1 ? '' : 's'}</span>
        </div>
        {ctx.section?.instructions && <div style={{ fontSize: 12, fontStyle: 'italic', color: MUTED, marginBottom: 6, lineHeight: 1.5 }}>{ctx.section.title ? <b style={{ fontStyle: 'normal' }}>{ctx.section.title}: </b> : null}{ctx.section.instructions}</div>}
        {ctx.passage && (
          <details style={{ marginBottom: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 800, color: PURPLE }}>{ctx.passage.title || 'The passage'} · {ctx.passageRange}</summary>
            <PassageBox passage={ctx.passage} style={{ marginTop: 6, maxHeight: 240, overflowY: 'auto' }} />
          </details>
        )}
        <div style={{ fontSize: 14, fontWeight: 800, color: INK, lineHeight: 1.45, whiteSpace: 'pre-line' }}>{qText(q) ? <MathText text={qText(q)} /> : `Question ${step + 1}`}</div>
        {q?.figure && <Figure figure={q.figure} maxHeight={180} />}
      </div>

      {/* What the learner answered */}
      <div style={{ background: '#FBFAF8', border: `1px solid ${BORDER}`, borderLeft: `3px solid ${PURPLE}`, borderRadius: 10, padding: '10px 12px' }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .5, color: MUTED2, marginBottom: 4 }}>THEIR ANSWER</div>
        {!answered ? <div style={{ fontSize: 13, color: MUTED, fontStyle: 'italic' }}>No answer</div>
          : isMcq(q) ? (() => {
            const right = q.correct != null && Number(q.correct) === Number(raw);
            return (
              <div style={{ fontSize: 13, fontWeight: 800, color: q.correct == null ? INK : right ? GREEN : RED }}>
                {letterOf(raw)}. <MathText text={q.options?.[Number(raw)] ?? ''} />
                {q.correct != null && <span style={{ fontWeight: 700, color: MUTED, marginLeft: 6 }}>{right ? '✓ correct' : `✗ key: ${letterOf(q.correct)}. ${q.options?.[Number(q.correct)] ?? ''}`}</span>}
              </div>
            );
          })()
          : <div style={{ fontSize: 13, color: INK, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>{String(raw)}</div>}
      </div>

      {/* The key for a written answer: a labelling question's parts, or a model answer */}
      {q?.answer && !isMcq(q) && (
        <div style={{ fontSize: 12, color: INK, background: '#F3FBF6', border: `1px solid ${GREEN}33`, borderRadius: 10, padding: '8px 11px', lineHeight: 1.55 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .5, color: GREEN }}>{typeof q.answer === 'object' ? 'KEY' : 'MODEL ANSWER'}</span>
          <div style={{ whiteSpace: 'pre-wrap' }}>{typeof q.answer === 'object' ? Object.entries(q.answer).map(([k, v]) => `${k}: ${v}`).join('\n') : String(q.answer)}</div>
        </div>
      )}

      {/* The AI's suggestion for this question */}
      {aiQ && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: INK, background: '#FBFAFF', border: `1px solid ${PURPLE}33`, borderRadius: 10, padding: '8px 10px' }}>
          <Sparkles size={13} color={PURPLE} style={{ marginTop: 2, flexShrink: 0 }} />
          <span style={{ flex: 1, lineHeight: 1.5 }}><b>AI: {aiQ.awarded}/{aiQ.max}</b> — {aiQ.why}</span>
          <button type="button" onClick={() => setMark(step, { awarded: aiQ.awarded })}
            style={{ fontSize: 11.5, fontWeight: 800, color: PURPLE, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, padding: 0 }}>Use</button>
        </div>
      )}

      {/* Points */}
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, marginBottom: 6 }}>Mark</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {quick.map((v) => {
            const on = marked && Number(mark.awarded) === v;
            return (
              <button key={v} type="button" onClick={() => setMark(step, { awarded: v })} aria-pressed={on}
                style={{ minWidth: 38, height: 34, borderRadius: 8, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 800,
                  border: `1.5px solid ${on ? PURPLE : BORDER}`, background: on ? '#F1ECFF' : WHITE, color: on ? PURPLE : MUTED }}>
                {v}
              </button>
            );
          })}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 6, fontSize: 12, fontWeight: 700, color: MUTED2 }}>
            <input type="number" min={0} max={max} step={0.5} value={marked ? mark.awarded : ''} aria-label={`Mark for question ${step + 1}`}
              onChange={(e) => {
                const v = e.target.value === '' ? null : Math.min(max, Math.max(0, Math.round(Number(e.target.value) * 2) / 2));
                setMark(step, { awarded: v });
              }}
              style={{ width: 64, padding: '7px 8px', borderRadius: 8, border: `1.5px solid ${BORDER}`, fontSize: 13, fontWeight: 800, fontFamily: FONT, color: INK, outline: 'none' }} />
            / {max}
          </label>
        </div>
        {mark.auto && <div style={{ fontSize: 11, color: MUTED2, fontWeight: 700, marginTop: 5 }}>Pre-filled from the answer key — change it if you need to.</div>}
      </div>

      {/* Comment the learner sees under this question */}
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, marginBottom: 6 }}>Comment on this answer <span style={{ color: MUTED2, fontWeight: 700 }}>(optional)</span></div>
        <textarea value={mark.comment || ''} onChange={(e) => setMark(step, { comment: e.target.value })} rows={3} maxLength={1000}
          placeholder="What was right, what's missing…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13, lineHeight: 1.55, fontFamily: FONT, color: INK, resize: 'vertical' }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderRadius: 10, border: `1px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 800, cursor: step === 0 ? 'default' : 'pointer', opacity: step === 0 ? .4 : 1, fontFamily: FONT }}>
          <ChevronLeft size={14} /> Back
        </button>
        <button type="button" onClick={() => setStep(step + 1)}
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 14px', borderRadius: 10, border: marked ? 'none' : `1px solid ${BORDER}`, background: marked ? PURPLE : WHITE, color: marked ? WHITE : MUTED, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          {marked ? (isLast ? 'Save mark & review' : 'Save mark & next') : (isLast ? 'Review' : 'Skip for now')} <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
