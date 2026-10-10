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
import { INK, MUTED, MUTED2, BORDER, GREEN, PURPLE, AMBER, FONT } from '../../constants.js';

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
      <img src={src} alt={figure.alt || figure.caption || 'Figure'} style={{ maxWidth: '100%', maxHeight, objectFit: 'contain', background: '#fff' }} />
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

/** Where the AI wanted a figure it couldn't draw well: the teacher adds one. */
export function FigureSlot({ note, style }) {
  if (!note) return null;
  return (
    <div style={{ margin: '8px 0 10px', padding: '10px 12px', border: `1.5px dashed ${AMBER}`, borderRadius: 8, background: '#FFF8F1', fontFamily: FONT, ...style }}>
      <div style={{ fontSize: 11, fontWeight: 900, color: AMBER, letterSpacing: .3 }}>ADD A FIGURE</div>
      <div style={{ fontSize: 12, color: INK, marginTop: 2, lineHeight: 1.45 }}>{note}</div>
    </div>
  );
}

const CHANGE_LOOK = {
  new: { bg: '#FFF8E6', chip: 'NEW', fg: '#B45309', chipBg: '#FDECC8' },
  changed: { bg: '#F4F0FF', chip: 'CHANGED', fg: PURPLE, chipBg: '#EDE5FF' },
};

function PaperQuestion({ q, i, showKey, change, versionLabel }) {
  const obj = q && typeof q === 'object' ? q : { q: String(q ?? '') };
  const pts = ptsOf(obj);
  const look = CHANGE_LOOK[change];
  return (
    <div style={{ breakInside: 'avoid', pageBreakInside: 'avoid', margin: look ? '0 -8px 14px' : '0 0 14px', ...(look ? { background: look.bg, borderRadius: 6, padding: '6px 8px' } : {}) }}>
      <div style={{ display: 'flex', gap: 7, fontSize: 13.5, lineHeight: 1.5, color: INK }}>
        <b style={{ flexShrink: 0, minWidth: 20 }}>{i + 1}.</b>
        <span style={{ flex: 1 }}>
          <MathText text={obj.q || ''} />
          {pts && <span style={{ fontSize: 11, color: MUTED2, whiteSpace: 'nowrap', fontFamily: FONT }}> [{pts} mark{pts === 1 ? '' : 's'}]</span>}
          {look && <span style={{ fontFamily: FONT, fontSize: 9.5, fontWeight: 900, color: look.fg, background: look.chipBg, borderRadius: 5, padding: '1px 6px', marginLeft: 6, whiteSpace: 'nowrap' }}>{look.chip}{versionLabel ? ` IN ${versionLabel}` : ''}</span>}
        </span>
      </div>
      <Figure figure={obj.figure} style={{ marginLeft: 27 }} />
      {!obj.figure && <FigureSlot note={obj.figure_note} style={{ marginLeft: 27 }} />}
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
export default function PaperView({ details, title, instructions, showKey = false, changes = null, versionLabel = '', style }) {
  const blocks = paperBlocks(details);
  if (!blocks.length) return null;
  // One column for a short plain list (it reads like the mock-up); two when
  // the paper is long or has sections, like the printed papers.
  const twoCols = (details?.questions?.length || 0) > 8 || blocks.some((b) => b.section || b.passage);
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '20px 22px', fontFamily: PAPER_FONT, color: INK, boxShadow: '0 1px 6px rgba(0,0,0,.05)', ...style }}>
      {title && <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, marginBottom: instructions ? 4 : 14, textTransform: 'uppercase', letterSpacing: .5 }}>{title}</div>}
      {instructions && <div style={{ textAlign: 'center', fontStyle: 'italic', fontSize: 13, color: '#333', marginBottom: 16 }}>{instructions}</div>}
      <div style={twoCols ? { columns: '2 300px', columnGap: 28, columnRule: `1px solid ${BORDER}` } : undefined}>
        {blocks.map((b, bi) => (
          <div key={bi}>
            {b.newSection && <SectionHead section={b.section} style={{ breakInside: 'avoid', marginTop: bi ? 10 : 4 }} />}
            {b.passage && <PassageBox passage={b.passage} range={passageRange(b.items)} />}
            {b.items.map(({ q, i }) => <PaperQuestion key={i} q={q} i={i} showKey={showKey} change={changes?.[i]} versionLabel={versionLabel} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
