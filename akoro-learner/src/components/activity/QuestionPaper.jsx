/*
 * QuestionPaper — the exam-paper pieces around one assignment question
 * (reference/question-layout-for-activity, the NCEE papers): the section's
 * instructions above it, the passage it shares with other questions, its
 * figure between the question text and the options, and maths written
 * x^2 / H_2O shown as real powers and subscripts.
 */
import { useState } from 'react';
import { Icon } from '../common/Icons.jsx';
import { questionContext, figureSrc, mathRuns } from '../../lib/paper.js';

const NUNITO = "'Nunito',sans-serif";

export function MathText({ text }) {
  return mathRuns(text).map((r, i) =>
    r.sup ? <sup key={i} style={{ fontSize: '.72em' }}>{r.text}</sup>
      : r.sub ? <sub key={i} style={{ fontSize: '.72em' }}>{r.text}</sub>
        : <span key={i}>{r.text}</span>);
}

/** The question's figure — drawn as an image, white behind it in dark mode too. */
export function QuestionFigure({ figure, maxHeight = 260, compact = false }) {
  const src = figureSrc(figure);
  if (!src) return null;
  return (
    <figure style={{ margin: compact ? '6px 0 8px' : '0 0 14px', textAlign: 'center' }}>
      <img src={src} alt={figure.caption || 'Figure for this question'}
        style={{ maxWidth: '100%', maxHeight: compact ? 140 : maxHeight, objectFit: 'contain', background: '#fff', borderRadius: 10, padding: 6, border: '1px solid var(--ak-border)' }} />
      {figure.caption && <figcaption style={{ fontSize: 11, fontWeight: 700, fontStyle: 'italic', color: 'var(--ak-text-muted)', marginTop: 4, fontFamily: NUNITO }}>{figure.caption}</figcaption>}
    </figure>
  );
}

/**
 * What sits above the question: its section's instructions and, when it
 * shares one, the passage (open by default; tap to fold it away).
 */
export function QuestionContext({ details, index, mid }) {
  const { section, passage, passageRange } = questionContext(details, index);
  const [open, setOpen] = useState(true);
  if (!section && !passage) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      {section && (section.title || section.instructions) && (
        <div style={{ padding: '9px 12px', borderRadius: 12, background: `${mid}0D`, border: `1px solid ${mid}26`, marginBottom: passage ? 8 : 0, fontFamily: NUNITO }}>
          {section.title && <p style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '0.04em', textTransform: 'uppercase', color: mid, margin: 0 }}>{section.title}</p>}
          {section.instructions && <p style={{ fontSize: 12.5, fontWeight: 700, fontStyle: 'italic', color: 'var(--ak-text)', margin: section.title ? '3px 0 0' : 0, lineHeight: 1.5 }}>{section.instructions}</p>}
        </div>
      )}
      {passage && (
        <div style={{ borderRadius: 12, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', fontFamily: NUNITO }}>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
            style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '9px 12px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: NUNITO }}>
            <Icon name="ti-file-text" size={14} color={mid}/>
            <span style={{ fontSize: 12.5, fontWeight: 900, color: 'var(--ak-text)' }}>{passage.title || 'Read the passage'}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)' }}>· {passageRange}</span>
            <Icon name={open ? 'ti-chevron-up' : 'ti-chevron-down'} size={14} style={{ marginLeft: 'auto' }}/>
          </button>
          {open && (
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ak-text)', lineHeight: 1.65, margin: 0, padding: '0 12px 12px', whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto' }}>{passage.text}</p>
          )}
        </div>
      )}
    </div>
  );
}
