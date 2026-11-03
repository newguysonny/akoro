/*
 * GradingSettings — the assignment draft's "Grading & answers" settings:
 *
 *   AI auto-grading   on → the AI marks each answer against a rubric the teacher can edit (the Rubric tab
 *                     appears, written from the questions); the teacher still approves every mark.
 *   Answer format     how learners may answer: images only · text only · images + text · all types.
 *
 * Both are saved on the draft as they change (PUT /api/self-study/drafts/:id/settings), so the rubric job,
 * chat revisions and Assign all see the same choice.
 */
import { useState } from 'react';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import { RED } from '../../constants.js';
import { apiPut } from '../../services/api.js';
import { Section, Field, Toggle } from './PreviewKit.jsx';

export const ANSWER_FORMATS = [
  { key: 'images', label: 'Images only', hint: 'Up to three answer photos per question', icon: 'ti-camera' },
  { key: 'text', label: 'Text only', hint: 'Typed answers without answer photos', icon: 'ti-file-text' },
  { key: 'images_text', label: 'Images + text', hint: 'Learners may submit both formats', icon: 'ti-photo-edit' },
  { key: 'all', label: 'All types', hint: 'Typed answers, photos, drawings, PDFs and Word documents', icon: 'ti-apps' },
];
export const answerFormatLabel = (key) => (ANSWER_FORMATS.find((f) => f.key === key) || ANSWER_FORMATS[3]).label;

export default function GradingSettings({ draftId, details, version, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const autoGrade = !!details?.ai_auto_grade;
  const instant = details?.ai_release !== 'review';
  const format = ANSWER_FORMATS.some((f) => f.key === details?.answer_format) ? details.answer_format : 'all';

  const save = async (patch) => {
    setBusy(true); setErr('');
    try {
      const r = await apiPut(`/api/self-study/drafts/${draftId}/settings`, { ...patch, ...(version != null ? { version } : {}) });
      onSaved?.(r?.data?.details ?? r?.details ?? { ...details, ...patch }, !!(r?.data?.started ?? r?.started));
    } catch (e) { setErr(e?.message || 'Could not save that setting.'); }
    finally { setBusy(false); }
  };

  return (
    <Section title="Grading & answers" icon="ti-clipboard-check" defaultOpen
      summary={`${autoGrade ? 'AI auto-grading on' : 'AI auto-grading off'} · ${answerFormatLabel(format)}`}>
      <Field inline label="AI auto-grading" hint={autoGrade ? 'The AI marks each answer against the rubric within seconds of hand-in.' : 'Turn on to have the AI draft marks from a rubric you can edit.'}>
        <Toggle on={autoGrade} onChange={(v) => save({ ai_auto_grade: v })} label="AI auto-grading" />
      </Field>
      {autoGrade && (
        <Field inline label="Show learners their score instantly" hint={instant ? 'Learners see the AI score and feedback straight away, marked as AI-marked. You can still adjust it.' : 'The AI marks are held as a draft until you approve them.'}>
          <Toggle on={instant} onChange={(v) => save({ ai_release: v ? 'instant' : 'review' })} label="Show learners their score instantly" />
        </Field>
      )}
      <Field label="Answer submission" hint="What learners may hand in for each question.">
        <div role="radiogroup" aria-label="Answer submission method" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {ANSWER_FORMATS.map((f) => {
            const on = format === f.key;
            return (
              <button key={f.key} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => !on && save({ answer_format: f.key })}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 9, textAlign: 'left', padding: '10px 11px', borderRadius: 12, cursor: busy ? 'wait' : 'pointer', fontFamily: C.font,
                  border: `1.5px solid ${on ? C.brand : C.border}`, background: on ? C.brandSoft : C.surface, boxShadow: on ? '0 0 0 3px color-mix(in srgb, var(--ak-brand) 14%, transparent)' : 'none' }}>
                <Ico ti={f.icon} size={17} color={on ? C.brand : C.muted} style={{ marginTop: 1, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: C.ink }}>{f.label}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: C.muted, marginTop: 2, lineHeight: 1.35 }}>{f.hint}</span>
                </span>
                <span aria-hidden style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1, border: `2px solid ${on ? C.brand : C.border}`, background: on ? C.brand : 'transparent', boxShadow: on ? `inset 0 0 0 3px ${C.surface}` : 'none' }} />
              </button>
            );
          })}
        </div>
      </Field>
      {err && <div role="alert" style={{ fontSize: 11.5, fontWeight: 700, color: RED, marginTop: 4, fontFamily: C.font }}>{err}</div>}
    </Section>
  );
}
