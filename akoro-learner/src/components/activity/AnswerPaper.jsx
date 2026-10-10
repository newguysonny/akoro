/*
 * AnswerPaper — the assignment as a printed paper WITH the learner's answers
 * under each question. One layout for everyone who reads the work:
 *
 *   the learner's review    onEdit → "Edit" and "Not answered · Answer it"
 *   the learner's receipt   read-only
 *   the graded copy         showKey + marks (each mark and comment)
 *   the teacher's view      label "Answer", showKey
 *
 *   3. Which gas do plants take in?  [2 marks]
 *      A. Oxygen
 *    • B. Carbon dioxide              ← the option the typed answer names
 *      ┌ Your answer ─────────────── Edit ┐
 *      │ b                                │
 *      │ Read as B · Carbon dioxide       │
 *      │ [leaf.jpg] [drawing-q3.png]      │  ← file cards
 *      └──────────────────────────────────┘
 *
 * Kept byte-identical in akoro-learner/src/components/activity and
 * akoro-instructor/src/components/paper (a contract test checks): it needs
 * nothing but React and lib/paper.js, and each app passes its own sans font.
 * Icons are drawn inline (Tabler outlines) so neither app's icon set is needed.
 */
import { paperBlocks, passageRange, figureSrc, mathRuns, letterOf, readChoice, parseLabelAnswer, isAnswered } from '../../lib/paper.js';

const SERIF = "Georgia, 'Times New Roman', serif";
const INK = '#1A1A2E';
const MUTED = '#6B6B80';
const LINE = '#E7E3EE';
const BRAND = '#6C3BFF';
const GOOD = '#047857';
const BAD = '#B91C1C';

/* Tabler outline icons, inline. */
const ICONS = {
  pencil: ['M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4', 'M13.5 6.5l4 4'],
  photo: ['M15 8h.01', 'M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z', 'M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5', 'M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3'],
  pdf: ['M14 3v4a1 1 0 0 0 1 1h4', 'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z', 'M9 13h6', 'M9 17h6'],
  file: ['M14 3v4a1 1 0 0 0 1 1h4', 'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z'],
  doc: ['M14 3v4a1 1 0 0 0 1 1h4', 'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z', 'M9 9h1', 'M9 13h6', 'M9 17h6'],
  message: ['M8 9h8', 'M8 13h6', 'M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z'],
  x: ['M18 6l-12 12', 'M6 6l12 12'],
  check: ['M5 12l5 5l10 -10'],
  point: ['M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0'],
};
export function PaperIcon({ name, size = 14, color = 'currentColor', fill = 'none', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ display: 'inline-block', verticalAlign: '-0.15em', flexShrink: 0, ...style }}>
      {(ICONS[name] || []).map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

function MathText({ text }) {
  return mathRuns(text).map((r, i) =>
    r.sup ? <sup key={i} style={{ fontSize: '.72em' }}>{r.text}</sup>
      : r.sub ? <sub key={i} style={{ fontSize: '.72em' }}>{r.text}</sub>
        : <span key={i}>{r.text}</span>);
}

const ptsOf = (q) => {
  const n = Number(q && typeof q === 'object' ? q.max_points ?? q.points : NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const fmtSize = (b) => (!b ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`);
const isDrawing = (f) => /^drawing-q\d+\.png$/i.test(String(f?.name || ''));
const isDocument = (f) => /^document-q\d+\.docx$/i.test(String(f?.name || ''));

/** One attached file as a card — a drawing says so. */
export function FileCard({ file, onOpen, onRemove, sans, busy = false }) {
  const drawing = isDrawing(file);
  const docFile = isDocument(file);
  const glyph = drawing ? 'pencil' : docFile || file.kind === 'docx' || /\.docx$/i.test(file.name || '') ? 'doc' : file.kind === 'image' || /\.(png|jpe?g)$/i.test(file.name || '') ? 'photo' : file.kind === 'pdf' || /\.pdf$/i.test(file.name || '') ? 'pdf' : 'file';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, maxWidth: '100%', padding: '6px 8px 6px 9px', borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', fontFamily: sans, opacity: busy ? 0.55 : 1 }}>
      <button type="button" onClick={onOpen ? () => onOpen(file) : undefined} disabled={!onOpen}
        title={onOpen ? (drawing ? 'Open the drawing' : docFile ? 'Open the document' : 'Open the file') : undefined}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0, padding: 0, border: 'none', background: 'none', cursor: onOpen ? 'pointer' : 'default', fontFamily: sans, textAlign: 'left' }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(108,59,255,.09)', color: BRAND, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><PaperIcon name={glyph} size={14} /></span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: INK, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{drawing ? 'Drawing' : docFile ? 'Document' : file.name}</span>
          <span style={{ display: 'block', fontSize: 10, fontWeight: 600, color: MUTED }}>{drawing || docFile ? file.name : fmtSize(file.size)}</span>
        </span>
      </button>
      {onRemove && (
        <button type="button" onClick={() => onRemove(file)} aria-label={`Remove ${file.name}`} disabled={busy}
          style={{ width: 20, height: 20, padding: 0, border: 'none', borderRadius: 6, background: '#F3F1F7', color: MUTED, cursor: busy ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><PaperIcon name="x" size={12} /></button>
      )}
    </span>
  );
}

function AnswerBlock({ q, i, value, files, mark, label, onEdit, onOpenFile, sans, showKey }) {
  const answered = isAnswered(value, files.length);
  const typed = value === undefined || value === null ? '' : typeof value === 'number' ? letterOf(value) : String(value).trim();
  const mcq = Array.isArray(q?.options);
  const pick = mcq ? readChoice(q, value) : null;
  const labelling = q?.format === 'label' && Array.isArray(q?.labels);
  if (!answered) {
    return (
      <div style={{ marginTop: 8, padding: '8px 11px', borderRadius: 9, border: '1px dashed #F3B4B4', background: '#FFF6F6', fontFamily: sans }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: BAD }}>Not answered</span>
          {mark && mark.awarded != null && <span style={{ fontSize: 11, fontWeight: 900, padding: '1px 8px', borderRadius: 999, color: '#B45309', background: 'rgba(245,158,11,.14)' }}>{mark.awarded} / {mark.max}</span>}
          {onEdit && (
            <button type="button" onClick={() => onEdit(i)}
              style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 8, border: 'none', background: BAD, color: '#fff', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: sans }}>
              Answer it
            </button>
          )}
        </div>
        {mark?.comment && (
          <div style={{ marginTop: 7, padding: '7px 9px', borderRadius: 8, background: 'rgba(108,59,255,.07)', fontSize: 12, fontWeight: 600, color: INK, lineHeight: 1.5, display: 'flex', gap: 7, alignItems: 'flex-start' }}><PaperIcon name="message" size={14} color={BRAND} style={{ marginTop: 2 }} /><span>{mark.comment}</span></div>
        )}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8, padding: '9px 11px', borderRadius: 9, border: `1px solid ${LINE}`, borderLeft: `3px solid ${BRAND}`, background: '#FAF8FF', fontFamily: sans }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: typed || files.length ? 4 : 0 }}>
        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.05em', textTransform: 'uppercase', color: BRAND }}>{label}</span>
        {mark && mark.awarded != null && (
          <span style={{ fontSize: 11, fontWeight: 900, padding: '1px 8px', borderRadius: 999, color: Number(mark.awarded) >= Number(mark.max) ? GOOD : '#B45309', background: Number(mark.awarded) >= Number(mark.max) ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.14)' }}>
            {mark.awarded} / {mark.max}
          </span>
        )}
        {onEdit && (
          <button type="button" onClick={() => onEdit(i)}
            style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: INK, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: sans }}>
            Edit
          </button>
        )}
      </div>
      {labelling && typed ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {Object.entries(parseLabelAnswer(q.labels, typed)).map(([l, v]) => (
            <div key={l} style={{ fontSize: 13, color: v ? INK : BAD, fontWeight: 600 }}><b style={{ display: 'inline-block', minWidth: 22 }}>{l}</b>{v || 'blank'}</div>
          ))}
        </div>
      ) : typed ? (
        <div style={{ fontSize: 13.5, fontWeight: 600, color: INK, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><MathText text={typed} /></div>
      ) : null}
      {mcq && typed && (
        <div style={{ fontSize: 11.5, fontWeight: 700, color: pick != null ? (showKey ? MUTED : GOOD) : '#B45309', marginTop: 3 }}>
          {pick != null ? `Read as ${letterOf(pick)} · ${q.options[pick] ?? ''}` : 'Not one of the options — the teacher reads it'}
        </div>
      )}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: typed ? 7 : 2 }}>
          {files.map((f) => <FileCard key={f.id} file={f} onOpen={onOpenFile} sans={sans} />)}
        </div>
      )}
      {mark?.comment && (
        <div style={{ marginTop: 7, padding: '7px 9px', borderRadius: 8, background: 'rgba(108,59,255,.07)', fontSize: 12, fontWeight: 600, color: INK, lineHeight: 1.5, display: 'flex', gap: 7, alignItems: 'flex-start' }}><PaperIcon name="message" size={14} color={BRAND} style={{ marginTop: 2 }} /><span>{mark.comment}</span></div>
      )}
    </div>
  );
}

function PaperQuestion({ q, i, value, files, mark, showKey, label, onEdit, onOpenFile, sans }) {
  const obj = q && typeof q === 'object' ? q : { q: String(q ?? '') };
  const pts = ptsOf(obj);
  const pick = Array.isArray(obj.options) ? readChoice(obj, value) : null;
  const src = figureSrc(obj.figure);
  return (
    <div id={`answer-paper-q${i + 1}`} style={{ margin: '0 0 18px', breakInside: 'avoid' }}>
      <div style={{ display: 'flex', gap: 7, fontSize: 14, lineHeight: 1.5, color: INK }}>
        <b style={{ flexShrink: 0, minWidth: 20 }}>{i + 1}.</b>
        <span style={{ flex: 1, minWidth: 0 }}>
          {obj.format === 'assertion_reason' && obj.assertion
            ? <><b>Assertion:</b> <MathText text={obj.assertion} /><br /><b>Reason:</b> <MathText text={obj.reason || ''} /></>
            : <span style={{ whiteSpace: 'pre-line' }}><MathText text={obj.q || ''} /></span>}
          {pts && <span style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap', fontFamily: sans }}> [{pts} mark{pts === 1 ? '' : 's'}]</span>}
        </span>
      </div>
      {src && (
        <figure style={{ margin: '8px 0 8px 27px', textAlign: 'center' }}>
          <img src={src} alt={obj.figure.alt || obj.figure.caption || 'Figure'} style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', background: '#fff' }} />
          {obj.figure.caption && <figcaption style={{ fontSize: 11.5, color: MUTED, fontStyle: 'italic', marginTop: 3 }}>{obj.figure.caption}</figcaption>}
        </figure>
      )}
      {Array.isArray(obj.options) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginLeft: 27, marginTop: 4 }}>
          {obj.options.map((o, oi) => {
            const key = showKey && obj.correct != null && Number(obj.correct) === oi;
            const picked = pick === oi;
            const color = key ? GOOD : picked && showKey ? BAD : picked ? BRAND : INK;
            return (
              <div key={oi} style={{ fontSize: 13.5, lineHeight: 1.45, color, fontWeight: key || picked ? 700 : 400, position: 'relative' }}>
                {picked && <span aria-label="their answer" style={{ position: 'absolute', left: -17, top: 1 }}><PaperIcon name="point" size={11} fill="currentColor" /></span>}
                <span style={{ display: 'inline-block', minWidth: 22 }}>{letterOf(oi)}.</span><MathText text={o} />{key && <PaperIcon name="check" size={14} style={{ marginLeft: 4 }} />}
              </div>
            );
          })}
        </div>
      )}
      {showKey && obj.format === 'label' && obj.answer && typeof obj.answer === 'object' && (
        <div style={{ marginLeft: 27, marginTop: 4, fontSize: 12.5, color: GOOD, fontFamily: sans, fontWeight: 700 }}>
          Key: {Object.entries(obj.answer).map(([l, v]) => `${l} ${v}`).join(' · ')}
        </div>
      )}
      <div style={{ marginLeft: 27 }}>
        <AnswerBlock q={obj} i={i} value={value} files={files} mark={mark} label={label} onEdit={onEdit} onOpenFile={onOpenFile} sans={sans} showKey={showKey} />
      </div>
    </div>
  );
}

/**
 * details   { questions, sections?, passages? }
 * answers   { [index]: typed text (or an older option number) }
 * files     [{ id, name, size, kind, question }] — each shows under its question
 * marks     [{ index, awarded, max, comment }]
 */
export default function AnswerPaper({ details, title = '', instructions = '', answers = {}, files = [], marks = [], showKey = false, label = 'Your answer', onEdit = null, onOpenFile = null, showLoose = true, sans = 'system-ui, sans-serif', style }) {
  const blocks = paperBlocks(details);
  if (!blocks.length) return null;
  const markOf = new Map((marks || []).map((m) => [Number(m.index), m]));
  const filesOf = (i) => (files || []).filter((f) => f && f.question != null && Number(f.question) === i);
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, padding: '20px 18px 6px 22px', fontFamily: SERIF, color: INK, boxShadow: '0 1px 6px rgba(0,0,0,.05)', ...style }}>
      {title && <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, marginBottom: instructions ? 4 : 16, textTransform: 'uppercase', letterSpacing: .5 }}>{title}</div>}
      {instructions && <div style={{ textAlign: 'center', fontStyle: 'italic', fontSize: 13, color: '#333', marginBottom: 18 }}>{instructions}</div>}
      {blocks.map((b, bi) => (
        <div key={bi}>
          {b.newSection && b.section && (
            <div style={{ textAlign: 'center', margin: `${bi ? 10 : 2}px 0 12px` }}>
              {b.section.title && <div style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: .6, textTransform: 'uppercase' }}>{b.section.title}</div>}
              {b.section.instructions && <div style={{ fontSize: 13, fontStyle: 'italic', marginTop: 4, lineHeight: 1.5 }}>{b.section.instructions}</div>}
            </div>
          )}
          {b.passage && (
            <div style={{ border: `1px solid ${INK}33`, borderRadius: 4, padding: '10px 12px', margin: '0 0 14px', background: '#FFFEFB' }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>
                {b.passage.title || 'Read the passage'}<span style={{ fontWeight: 400, fontStyle: 'italic', color: MUTED }}> — {passageRange(b.items)}</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{b.passage.text}</div>
            </div>
          )}
          {b.items.map(({ q, i }) => (
            <PaperQuestion key={i} q={q} i={i} value={answers?.[i] ?? answers?.[String(i)]} files={filesOf(i)} mark={markOf.get(i)}
              showKey={showKey} label={label} onEdit={onEdit} onOpenFile={onOpenFile} sans={sans} />
          ))}
        </div>
      ))}
      {/* Files handed in for the whole assignment, not one question. */}
      {showLoose && (files || []).some((f) => f && f.question == null) && (
        <div style={{ borderTop: `1px solid ${LINE}`, padding: '12px 0 14px', fontFamily: sans }}>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.05em', textTransform: 'uppercase', color: MUTED, marginBottom: 6 }}>Attached to the whole assignment</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {files.filter((f) => f && f.question == null).map((f) => <FileCard key={f.id} file={f} onOpen={onOpenFile} sans={sans} />)}
          </div>
        </div>
      )}
    </div>
  );
}
