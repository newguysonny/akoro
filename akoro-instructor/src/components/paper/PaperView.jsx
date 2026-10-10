/*
 * PaperView — an assignment laid out like a printed exam paper (reference:
 * the NCEE papers in reference/question-layout-for-activity):
 *
 *   SECTION A                                   ← section heading, once
 *   In each of the questions below, choose…     ← its instructions
 *   ┌ Read the passage — Questions 3–7 ┐        ← a shared passage, once
 *   3. In the diagram below, find x.            ← number + question text
 *        [figure]                               ← between text and options
 *      A. 30°   B. 45° …                        ← options stacked, A–E
 *
 * Two columns when there's room, one when narrow. Also exports the pieces
 * (MathText, Figure, SectionHead, PassageBox) the grading view reuses.
 */
import { paperBlocks, passageRange, figureSrc, mathRuns, letterOf } from '../../lib/paper.js';
import { INK, MUTED, MUTED2, BORDER, GREEN, FONT } from '../../constants.js';

export const PAPER_FONT = "Georgia, 'Times New Roman', serif";

/** Text with x^2 / H_2O written the plain way shown as real powers and subscripts. */
export function MathText({ text }) {
  return mathRuns(text).map((r, i) =>
    r.sup ? <sup key={i} style={{ fontSize: '.72em' }}>{r.text}</sup>
      : r.sub ? <sub key={i} style={{ fontSize: '.72em' }}>{r.text}</sub>
        : <span key={i}>{r.text}</span>);
}

export function Figure({ figure, maxHeight = 220, style }) {
  const src = figureSrc(figure);
  if (!src) return null;
  return (
    <figure style={{ margin: '8px 0 10px', textAlign: 'center', ...style }}>
      <img src={src} alt={figure.caption || 'Figure'} style={{ maxWidth: '100%', maxHeight, objectFit: 'contain', background: '#fff' }} />
      {figure.caption && <figcaption style={{ fontSize: 11.5, color: MUTED, fontStyle: 'italic', marginTop: 3 }}>{figure.caption}</figcaption>}
    </figure>
  );
}

export function SectionHead({ section, style }) {
  if (!section) return null;
  return (
    <div style={{ textAlign: 'center', margin: '4px 0 12px', ...style }}>
      {section.title && <div style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: .6, textTransform: 'uppercase', color: INK }}>{section.title}</div>}
      {section.instructions && <div style={{ fontSize: 13, fontStyle: 'italic', color: INK, marginTop: 4, lineHeight: 1.5 }}>{section.instructions}</div>}
    </div>
  );
}

export function PassageBox({ passage, range, style }) {
  if (!passage) return null;
  return (
    <div style={{ border: `1px solid ${INK}33`, borderRadius: 4, padding: '10px 12px', margin: '0 0 12px', background: '#FFFEFB', ...style }}>
      <div style={{ fontWeight: 700, fontSize: 12.5, color: INK, marginBottom: 6 }}>
        {passage.title || 'Read the passage'}{range && <span style={{ fontWeight: 400, fontStyle: 'italic', color: MUTED }}> — {range}</span>}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: INK, whiteSpace: 'pre-wrap' }}>{passage.text}</div>
    </div>
  );
}

const ptsOf = (q) => {
  const n = Number(q && typeof q === 'object' ? q.max_points ?? q.points : NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function PaperQuestion({ q, i, showKey }) {
  const obj = q && typeof q === 'object' ? q : { q: String(q ?? '') };
  const pts = ptsOf(obj);
  return (
    <div style={{ breakInside: 'avoid', pageBreakInside: 'avoid', margin: '0 0 14px' }}>
      <div style={{ display: 'flex', gap: 7, fontSize: 13.5, lineHeight: 1.5, color: INK }}>
        <b style={{ flexShrink: 0, minWidth: 20 }}>{i + 1}.</b>
        <span style={{ flex: 1 }}>
          <MathText text={obj.q || ''} />
          {pts && <span style={{ fontSize: 11, color: MUTED2, whiteSpace: 'nowrap', fontFamily: FONT }}> [{pts} mark{pts === 1 ? '' : 's'}]</span>}
        </span>
      </div>
      <Figure figure={obj.figure} style={{ marginLeft: 27 }} />
      {Array.isArray(obj.options) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginLeft: 27, marginTop: obj.figure ? 0 : 4 }}>
          {obj.options.map((o, oi) => {
            const key = showKey && obj.correct != null && Number(obj.correct) === oi;
            return (
              <div key={oi} style={{ fontSize: 13.5, lineHeight: 1.45, color: key ? GREEN : INK, fontWeight: key ? 700 : 400 }}>
                <span style={{ display: 'inline-block', minWidth: 22 }}>{letterOf(oi)}.</span><MathText text={o} />{key && ' ✓'}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ marginLeft: 27, marginTop: 6, borderBottom: `1px dashed ${BORDER}`, height: 18 }} aria-hidden />
      )}
    </div>
  );
}

/**
 * The whole paper. `details` is { questions, sections?, passages? } — the
 * shape that rides on the assignment. `showKey` marks the correct options.
 */
export default function PaperView({ details, title, showKey = false, style }) {
  const blocks = paperBlocks(details);
  if (!blocks.length) return null;
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '20px 22px', fontFamily: PAPER_FONT, color: INK, boxShadow: '0 1px 6px rgba(0,0,0,.05)', ...style }}>
      {title && <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, marginBottom: 14, textTransform: 'uppercase', letterSpacing: .5 }}>{title}</div>}
      <div style={{ columns: '2 300px', columnGap: 28, columnRule: `1px solid ${BORDER}` }}>
        {blocks.map((b, bi) => (
          <div key={bi}>
            {b.newSection && <SectionHead section={b.section} style={{ breakInside: 'avoid', marginTop: bi ? 10 : 4 }} />}
            {b.passage && <PassageBox passage={b.passage} range={passageRange(b.items)} />}
            {b.items.map(({ q, i }) => <PaperQuestion key={i} q={q} i={i} showKey={showKey} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
