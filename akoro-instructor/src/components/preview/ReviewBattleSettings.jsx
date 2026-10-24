/*
 * ReviewBattleSettings — the review battle an assignment or self study comes
 * with (reference/Akoro Activity + Review — Plan.md). On by default; the
 * instructor sets when it runs. Each learner's protégé answers questions
 * written from the activity's topic, concepts and objectives; a mark sheet,
 * not counted toward the grade. A learner who hasn't submitted by then is
 * reviewed at the due date.
 */
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import { Field, Toggle, inputStyle, Section } from './PreviewKit.jsx';

export const REVIEW_DEFAULT = Object.freeze({ on: true, at: '', questions: 8 });

const fmt = (local) => {
  if (!local) return '';
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
};

/** The line the learner's instructions gain. */
export const reviewInstructionLine = (review) => review?.on
  ? `After you submit, teach your agent this topic: your review battle is ${review.at ? `on ${fmt(review.at)}` : 'scheduled'}.`
  : '';

export default function ReviewBattleSettings({ value = REVIEW_DEFAULT, onChange, dueLocal = '', defaultOpen = true }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const when = fmt(value.at);
  return (
    <Section title="Review battle" icon="ti-swords" defaultOpen={defaultOpen}
      badge={<span style={{ fontSize: 9.5, fontWeight: 900, padding: '2px 7px', borderRadius: 20, background: value.on ? 'rgba(16,185,129,.14)' : C.tagBg, color: value.on ? '#047857' : C.muted2, marginRight: 4 }}>{value.on ? 'ON' : 'OFF'}</span>}
      summary={value.on ? `Each learner's agent is reviewed on what they taught it${when ? `, ${when}` : ''}.` : 'No review battle.'}
      chips={value.on ? [`${value.questions} questions`, 'Protégé answers', 'Not graded'] : []}>
      <Field inline label="Pair with a review battle" hint="Suggested for every assignment and self study.">
        <Toggle on={value.on} onChange={(on) => set({ on })} label="Pair with a review battle" />
      </Field>
      {value.on && (
        <>
          <Field label="Runs at" hint="Learners who haven't submitted by then are reviewed at the due date.">
            <input type="datetime-local" value={value.at} onChange={(e) => set({ at: e.target.value })} aria-label="Review runs at" style={inputStyle} />
            {!value.at && dueLocal && (
              <button type="button" onClick={() => set({ at: dueLocal })} style={{ marginTop: 5, border: 'none', background: 'none', padding: 0, color: C.brand, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
                Use the due date ({fmt(dueLocal)})
              </button>
            )}
          </Field>
          <Field inline label="Questions" hint="Written from the topic, concepts and objectives.">
            <select value={value.questions} onChange={(e) => set({ questions: Number(e.target.value) })} aria-label="Review questions" style={{ ...inputStyle, width: 90 }}>
              {[5, 8, 10, 12, 15].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: 8, padding: '9px 11px', borderRadius: 10, background: C.tagBg, border: `1px solid ${C.borderSoft}`, fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>
            <Ico ti="ti-info-circle" size={14} color={C.muted2} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Each learner's protégé answers what the learner taught it; your learners get a mark sheet, and so do you. It doesn't count toward the grade.</span>
          </div>
          <div style={{ marginTop: 9, fontSize: 11, color: C.muted2 }}>Added to the instructions:</div>
          <div style={{ marginTop: 3, fontSize: 12, color: C.ink, fontStyle: 'italic', lineHeight: 1.5 }}>“{reviewInstructionLine(value)}”</div>
        </>
      )}
    </Section>
  );
}
