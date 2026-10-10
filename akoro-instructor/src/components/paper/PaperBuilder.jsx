/*
 * PaperBuilder — the workbench's question editor, laid out like an exam
 * paper (reference/question-layout-for-activity — the NCEE papers).
 *
 *   Edit           sections (title + instructions), passages several
 *                  questions share, then the questions in paper order:
 *                  number · text · figure (between the text and the
 *                  options) · options lettered A–E, the key ticked.
 *   Paper preview  the same questions printed the way learners' paper
 *                  reads — PaperView, two columns when there's room.
 *
 * The questions stay one flat list (answers and marks key on the index);
 * a question points at its section and passage by index. Removing a
 * section or passage keeps every reference in step (removeRef).
 */
import { useRef, useState } from 'react';
import { ArrowUp, ArrowDown, ImagePlus, Trash2, Eye, Pencil, Plus } from 'lucide-react';
import { INK, MUTED, MUTED2, BORDER, WHITE, LIGHT, GREEN, PURPLE, BLUE, RED, FONT } from '../../constants.js';
import { letterOf, removeRef, imageFileToDataUrl } from '../../lib/paper.js';
import PaperView, { Figure } from './PaperView.jsx';

export const MAX_OPTIONS = 5;   // A–E, as on the papers

const INP = {
  padding: '7px 10px', borderRadius: 8, border: `1px solid ${BORDER}`,
  fontFamily: FONT, fontSize: 12, fontWeight: 600, color: INK, outline: 'none', background: WHITE, boxSizing: 'border-box',
};
const CHIP = {
  fontSize: 10, fontWeight: 800, color: BLUE, background: '#EFF6FF',
  borderRadius: 100, padding: '2px 8px', fontFamily: FONT, whiteSpace: 'nowrap',
};
const LINK = { border: 'none', background: 'none', color: PURPLE, cursor: 'pointer', fontSize: 11, fontWeight: 800, fontFamily: FONT, padding: '2px 0', display: 'inline-flex', alignItems: 'center', gap: 4 };
const ICON_BTN = { border: 'none', background: 'none', color: MUTED2, cursor: 'pointer', padding: '2px 4px', display: 'inline-flex', alignItems: 'center' };
const sectionName = (i) => `Section ${letterOf(i)}`;

/** The builder's rows → what the paper preview reads. */
export function previewDetails({ questions, sections, passages }) {
  return {
    sections, passages,
    questions: (questions || []).map((r) => ({
      q: r.q, figure: r.figure || undefined, section: r.section, passage: r.passage, max_points: r.max_points,
      ...(r.kind === 'mcq' ? { options: (r.options || []).map((o) => o || '…'), correct: r.correct } : {}),
    })),
  };
}

export default function PaperBuilder({ questions, sections, passages, onChange, assignment = false }) {
  const [view, setView] = useState('edit');      // 'edit' | 'paper'
  const [showKey, setShowKey] = useState(true);
  const [figErr, setFigErr] = useState({});      // row → message
  const fileRef = useRef(null);
  const figureFor = useRef(null);                // which row the file picker is for

  const setRow = (qi, patch) => onChange({ questions: questions.map((r, i) => (i === qi ? { ...r, ...patch } : r)) });
  const move = (qi, d) => {
    const j = qi + d;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[qi], next[j]] = [next[j], next[qi]];
    onChange({ questions: next });
  };
  const setSection = (si, patch) => onChange({ sections: sections.map((s, i) => (i === si ? { ...s, ...patch } : s)) });
  const setPassage = (pi, patch) => onChange({ passages: passages.map((p, i) => (i === pi ? { ...p, ...patch } : p)) });
  const dropSection = (si) => onChange({ sections: sections.filter((_, i) => i !== si), questions: removeRef(questions, 'section', si) });
  const dropPassage = (pi) => onChange({ passages: passages.filter((_, i) => i !== pi), questions: removeRef(questions, 'passage', pi) });

  const pickFigure = (qi) => { figureFor.current = qi; fileRef.current?.click(); };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const qi = figureFor.current;
    if (!file || qi == null) return;
    setFigErr((m) => ({ ...m, [qi]: '' }));
    try {
      const src = await imageFileToDataUrl(file);
      setRow(qi, { figure: { src, caption: questions[qi]?.figure?.caption || '' } });
    } catch (err) {
      setFigErr((m) => ({ ...m, [qi]: err?.message || 'Could not add that image.' }));
    }
  };

  const seg = (key, Icon, label) => (
    <button type="button" onClick={() => setView(key)} aria-pressed={view === key}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 11.5, fontWeight: 800,
        background: view === key ? WHITE : 'transparent', color: view === key ? INK : MUTED, boxShadow: view === key ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }}>
      <Icon size={12} /> {label}
    </button>
  );

  return (
    <div style={{ marginTop: 10, fontFamily: FONT }}>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onFile} style={{ display: 'none' }} />

      {/* Toolbar: Edit | Paper preview, and the paper's furniture */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 10, background: LIGHT, border: `1px solid ${BORDER}` }}>
          {seg('edit', Pencil, 'Edit')}
          {seg('paper', Eye, 'Paper preview')}
        </div>
        {view === 'edit' ? (
          <div style={{ display: 'flex', gap: 12, marginLeft: 'auto' }}>
            <button type="button" style={LINK} onClick={() => onChange({ sections: [...sections, { title: sectionName(sections.length), instructions: '' }] })}><Plus size={12} /> Section</button>
            <button type="button" style={LINK} onClick={() => onChange({ passages: [...passages, { title: '', text: '' }] })}><Plus size={12} /> Passage</button>
          </div>
        ) : (
          <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: MUTED, cursor: 'pointer' }}>
            <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} style={{ accentColor: GREEN }} /> Show answer key
          </label>
        )}
      </div>

      {view === 'paper' ? (
        <>
          <PaperView details={previewDetails({ questions, sections, passages })} showKey={showKey} />
          <div style={{ fontSize: 10.5, color: MUTED2, marginTop: 6 }}>How the paper reads. Learners answer one question at a time, each with its section's instructions, passage and figure.</div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Sections */}
          {sections.map((s, si) => (
            <div key={`s${si}`} style={{ border: `1px solid ${BORDER}`, borderLeft: `3px solid ${PURPLE}`, borderRadius: 10, padding: '9px 11px', background: '#FBFAFF' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: .5, color: PURPLE, flexShrink: 0 }}>SECTION {letterOf(si)}</span>
                <input value={s.title} onChange={(e) => setSection(si, { title: e.target.value })} placeholder="Title, e.g. Section A — Multiple choice" style={{ ...INP, flex: 1 }} maxLength={120} />
                <button type="button" style={ICON_BTN} title="Remove section (its questions stay)" onClick={() => dropSection(si)}><Trash2 size={13} /></button>
              </div>
              <textarea value={s.instructions} onChange={(e) => setSection(si, { instructions: e.target.value })} rows={2} maxLength={1200}
                placeholder="Instructions learners see above these questions, e.g. Choose the correct option from A to E."
                style={{ ...INP, width: '100%', resize: 'vertical', fontStyle: s.instructions ? 'italic' : 'normal', lineHeight: 1.5 }} />
            </div>
          ))}

          {/* Passages */}
          {passages.map((p, pi) => (
            <div key={`p${pi}`} style={{ border: `1px solid ${BORDER}`, borderLeft: `3px solid ${BLUE}`, borderRadius: 10, padding: '9px 11px', background: '#F8FBFF' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: .5, color: BLUE, flexShrink: 0 }}>PASSAGE {pi + 1}</span>
                <input value={p.title} onChange={(e) => setPassage(pi, { title: e.target.value })} placeholder="Title (optional)" style={{ ...INP, flex: 1 }} maxLength={160} />
                <span style={{ fontSize: 10.5, color: MUTED2, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {questions.filter((r) => r.passage === pi).length} question{questions.filter((r) => r.passage === pi).length === 1 ? '' : 's'}
                </span>
                <button type="button" style={ICON_BTN} title="Remove passage" onClick={() => dropPassage(pi)}><Trash2 size={13} /></button>
              </div>
              <textarea value={p.text} onChange={(e) => setPassage(pi, { text: e.target.value })} rows={4} maxLength={8000}
                placeholder="The passage the linked questions are about." style={{ ...INP, width: '100%', resize: 'vertical', lineHeight: 1.55, fontWeight: 500 }} />
            </div>
          ))}

          {/* Questions, in paper order */}
          {questions.map((row, qi) => {
            const prev = questions[qi - 1];
            const sectionStarts = Number.isInteger(row.section) && sections[row.section] && (!prev || prev.section !== row.section);
            return (
              <div key={qi}>
                {sectionStarts && (
                  <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: .5, color: PURPLE, margin: '4px 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {(sections[row.section].title || sectionName(row.section)).toUpperCase()}
                    <span style={{ flex: 1, height: 1, background: `${PURPLE}33` }} />
                  </div>
                )}
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 11px', background: WHITE }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 7 }}>
                    <span style={{ fontSize: 13, fontWeight: 900, color: INK, flexShrink: 0, minWidth: 20, paddingTop: 6 }}>{qi + 1}.</span>
                    <textarea value={row.q} rows={2} onChange={(e) => setRow(qi, { q: e.target.value })}
                      placeholder="The question learners will answer" style={{ ...INP, flex: 1, resize: 'vertical', lineHeight: 1.45, fontSize: 12.5 }} />
                    <select value={row.kind} onChange={(e) => setRow(qi, { kind: e.target.value })} style={{ ...INP, width: 140, cursor: 'pointer' }}>
                      <option value="mcq">Multiple choice</option>
                      <option value="open">Open answer</option>
                    </select>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <button type="button" style={{ ...ICON_BTN, opacity: qi === 0 ? .3 : 1 }} disabled={qi === 0} onClick={() => move(qi, -1)} title="Move up"><ArrowUp size={12} /></button>
                      <button type="button" style={{ ...ICON_BTN, opacity: qi === questions.length - 1 ? .3 : 1 }} disabled={qi === questions.length - 1} onClick={() => move(qi, 1)} title="Move down"><ArrowDown size={12} /></button>
                    </div>
                    <button type="button" onClick={() => onChange({ questions: questions.filter((_, i) => i !== qi) })}
                      style={{ ...ICON_BTN, fontSize: 15 }} title="Remove question">×</button>
                  </div>

                  {/* Where it sits on the paper, and what it's worth */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingLeft: 28, marginBottom: 7 }}>
                    {row.type && <span style={CHIP}>{row.type}</span>}
                    {row.difficulty && <span style={CHIP}>{row.difficulty}</span>}
                    {row.cognitive_level && <span style={CHIP}>{row.cognitive_level}</span>}
                    {sections.length > 0 && (
                      <select value={Number.isInteger(row.section) ? row.section : ''} aria-label={`Section for question ${qi + 1}`}
                        onChange={(e) => setRow(qi, { section: e.target.value === '' ? undefined : Number(e.target.value) })}
                        style={{ ...INP, padding: '3px 6px', fontSize: 11, cursor: 'pointer' }}>
                        <option value="">No section</option>
                        {sections.map((s, si) => <option key={si} value={si}>{s.title?.startsWith(sectionName(si)) ? s.title.slice(0, 40) : `${sectionName(si)}${s.title ? ` · ${s.title.slice(0, 28)}` : ''}`}</option>)}
                      </select>
                    )}
                    {passages.length > 0 && (
                      <select value={Number.isInteger(row.passage) ? row.passage : ''} aria-label={`Passage for question ${qi + 1}`}
                        onChange={(e) => setRow(qi, { passage: e.target.value === '' ? undefined : Number(e.target.value) })}
                        style={{ ...INP, padding: '3px 6px', fontSize: 11, cursor: 'pointer' }}>
                        <option value="">No passage</option>
                        {passages.map((p, pi) => <option key={pi} value={pi}>Passage {pi + 1}{p.title ? ` · ${p.title.slice(0, 24)}` : ''}</option>)}
                      </select>
                    )}
                    {assignment && (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: MUTED2, marginLeft: 'auto' }}>
                        Points
                        <input type="number" min={0} value={row.max_points == null ? '' : row.max_points}
                          onChange={(e) => setRow(qi, { max_points: e.target.value === '' ? null : Number(e.target.value) })}
                          title="Points for this question" style={{ ...INP, width: 58, padding: '4px 7px' }} />
                      </label>
                    )}
                  </div>

                  {/* The figure — between the question text and its options */}
                  <div style={{ paddingLeft: 28, marginBottom: row.kind === 'mcq' ? 6 : 0 }}>
                    {row.figure ? (
                      <div style={{ border: `1px dashed ${BORDER}`, borderRadius: 8, padding: '6px 8px', background: LIGHT }}>
                        <Figure figure={row.figure} maxHeight={170} style={{ margin: '2px 0 6px' }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input value={row.figure.caption || ''} maxLength={200} placeholder="Caption (optional), e.g. Fig. 1"
                            onChange={(e) => setRow(qi, { figure: { ...row.figure, caption: e.target.value } })} style={{ ...INP, flex: 1, padding: '4px 8px', fontSize: 11 }} />
                          <button type="button" style={LINK} onClick={() => pickFigure(qi)}><ImagePlus size={12} /> Replace</button>
                          <button type="button" style={{ ...LINK, color: RED }} onClick={() => setRow(qi, { figure: null })}><Trash2 size={12} /> Remove</button>
                        </div>
                        {row.figure.svg && <div style={{ fontSize: 10, color: MUTED2, marginTop: 4 }}>Drawn by the AI — check it matches the question, or replace it with your own image.</div>}
                      </div>
                    ) : (
                      <button type="button" style={{ ...LINK, color: MUTED }} onClick={() => pickFigure(qi)}><ImagePlus size={12} /> Add figure</button>
                    )}
                    {figErr[qi] && <div style={{ fontSize: 10.5, color: RED, fontWeight: 700, marginTop: 3 }}>{figErr[qi]}</div>}
                  </div>

                  {/* Options, lettered A–E and stacked, as on the paper */}
                  {row.kind === 'mcq' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingLeft: 28 }}>
                      {(row.options ?? []).map((opt, oi) => (
                        <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <input type="radio" name={`q-correct-${qi}`} checked={(row.correct ?? 0) === oi}
                            onChange={() => setRow(qi, { correct: oi })}
                            title="Mark as the correct option" style={{ accentColor: GREEN, cursor: 'pointer', flexShrink: 0 }} />
                          <span style={{ fontSize: 12, fontWeight: 900, color: (row.correct ?? 0) === oi ? GREEN : MUTED, width: 14 }}>{letterOf(oi)}.</span>
                          <input value={opt} onChange={(e) => setRow(qi, { options: row.options.map((o, j) => (j === oi ? e.target.value : o)) })}
                            placeholder={`Option ${letterOf(oi)}`} style={{ flex: 1, ...INP }} />
                          {(row.options ?? []).length > 2 && (
                            <button type="button" onClick={() => setRow(qi, { options: row.options.filter((_, j) => j !== oi), correct: Math.min(row.correct ?? 0, row.options.length - 2) })}
                              style={{ ...ICON_BTN, fontSize: 13 }} title="Remove option">×</button>
                          )}
                        </div>
                      ))}
                      {(row.options ?? []).length < MAX_OPTIONS && (
                        <button type="button" onClick={() => setRow(qi, { options: [...(row.options ?? []), ''] })}
                          style={{ ...LINK, paddingLeft: 21 }}>+ option {letterOf((row.options ?? []).length)}</button>
                      )}
                      <div style={{ fontSize: 10, color: MUTED2, paddingLeft: 21 }}>The ticked option is marked correct when grading.</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
