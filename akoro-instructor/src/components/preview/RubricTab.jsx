/*
 * RubricTab — the mark scheme the AI marker will follow, for the assignment version on screen.
 *
 * Criteria (each about one question) → marking points → levels from no marks to full marks, with what to
 * look for, the model answer, other answers that earn full marks and answers that earn none. Written from
 * the questions when auto-grading is on (a background job, like the questions themselves); every part is
 * editable, and the marks of a question's marking points always add up to the question's marks (the server
 * re-fits them on save). The AI reads each learner answer and picks the level that fits each marking point.
 *
 *   version.rubric (from GET /drafts/:id): { status: none|drafting|ready|failed, scheme, note, error, edited, stale, summary }
 */
import { useMemo, useState } from 'react';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import { GREEN, RED } from '../../constants.js';
import { apiPost, apiPut } from '../../services/api.js';
import { inputStyle } from './PreviewKit.jsx';

const GREEN_BG = 'rgba(22,163,74,.1)';
const RED_BG = 'rgba(220,38,38,.09)';
const AMBER = '#B45309';
const pts = (n) => `${n} ${Number(n) === 1 ? 'pt' : 'pts'}`;
const half = (n) => Math.round(Number(n) * 2) / 2;

/* A question the AI marks: everything the answer key doesn't. */
const isKeyed = (q) => !!q && typeof q === 'object' && Array.isArray(q.options) && q.correct != null;
const qMarks = (q) => { const n = Number(q?.max_points ?? q?.points); return Number.isFinite(n) && n > 0 ? n : 5; };

/* The levels a marking point of `p` marks can be awarded — the server's own rule. */
const levelPoints = (p) => {
  const v = half(p);
  if (v <= 1) return [0, v];
  return [...new Set([0, half(v / 2), v])].sort((a, b) => a - b);
};

const Label = ({ children }) => (
  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: C.muted2, marginBottom: 4, fontFamily: C.font }}>{children}</div>
);

function Pill({ children, color, bg, border }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, color, background: bg, border: `1px solid ${border || 'transparent'}`, fontFamily: C.font, whiteSpace: 'nowrap' }}>{children}</span>;
}
const Btn = ({ children, onClick, disabled, kind = 'ghost', title }) => (
  <button type="button" onClick={onClick} disabled={disabled} title={title}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: kind === 'primary' ? '7px 13px' : '5px 9px', borderRadius: 9, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1, fontFamily: C.font, fontSize: 11.5, fontWeight: 800,
      border: kind === 'primary' ? 'none' : `1px solid ${C.border}`, background: kind === 'primary' ? C.brand : C.surface, color: kind === 'primary' ? '#fff' : C.ink2 }}>{children}</button>
);

/* ── One marking point, read-only ─────────────────────────────────────── */
function MarkingPoint({ mp, n }) {
  return (
    <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', marginTop: 10, background: C.surface }}>
      <Label>Marking point {n} · {pts(mp.points)}</Label>
      <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.5, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: C.muted2, marginRight: 6 }}>Looks for</span>{mp.looks_for}
      </div>
      {mp.model_answer && (
        <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.5, marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: C.muted2, marginRight: 6 }}>Model answer</span>{mp.model_answer}
        </div>
      )}
      {mp.levels.map((l) => {
        const full = l.points === mp.points; const none = l.points === 0;
        return (
          <div key={l.points} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6 }}>
            <Pill color={none ? RED : full ? GREEN : AMBER} bg={none ? RED_BG : full ? GREEN_BG : 'rgba(245,158,11,.12)'} border={none ? 'rgba(220,38,38,.3)' : full ? 'rgba(22,163,74,.3)' : 'rgba(245,158,11,.4)'}>{pts(l.points)}</Pill>
            <div style={{ fontSize: 12, color: C.ink2, lineHeight: 1.45 }}><strong style={{ color: C.ink }}>{l.label}</strong>{l.descriptor ? ` — ${l.descriptor}` : ''}</div>
          </div>
        );
      })}
      {mp.full_marks_also_for.length > 0 && (
        <div style={{ marginTop: 9 }}><Label>Full marks also for</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{mp.full_marks_also_for.map((t) => <Pill key={t} color="color-mix(in srgb, #16A34A 70%, var(--ak-text))" bg={GREEN_BG} border="rgba(22,163,74,.3)">{t}</Pill>)}</div></div>
      )}
      {mp.no_marks_for.length > 0 && (
        <div style={{ marginTop: 9 }}><Label>No marks for</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{mp.no_marks_for.map((t) => <Pill key={t} color="color-mix(in srgb, #DC2626 70%, var(--ak-text))" bg={RED_BG} border="rgba(220,38,38,.3)">{t}</Pill>)}</div></div>
      )}
    </div>
  );
}

/* ── Chips you can add to and remove from ─────────────────────────────── */
function ChipsEditor({ label, values, onChange, tone }) {
  const [text, setText] = useState('');
  const col = tone === 'green' ? { c: 'color-mix(in srgb, #16A34A 70%, var(--ak-text))', bg: GREEN_BG, b: 'rgba(22,163,74,.3)' } : { c: 'color-mix(in srgb, #DC2626 70%, var(--ak-text))', bg: RED_BG, b: 'rgba(220,38,38,.3)' };
  const add = () => { const t = text.trim(); if (t && !values.includes(t) && values.length < 6) onChange([...values, t]); setText(''); };
  return (
    <div style={{ marginTop: 9 }}>
      <Label>{label}</Label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 5 }}>
        {values.map((t) => (
          <Pill key={t} color={col.c} bg={col.bg} border={col.b}>{t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(values.filter((x) => x !== t))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: col.c, padding: 0, display: 'inline-flex' }}><Ico ti="ti-x" size={11} color={col.c} /></button>
          </Pill>
        ))}
      </div>
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add}
        placeholder={values.length >= 6 ? 'Up to six' : 'Type one and press Enter'} disabled={values.length >= 6} aria-label={label} style={{ ...inputStyle, fontSize: 12 }} />
    </div>
  );
}

/* ── Editing a criterion ──────────────────────────────────────────────── */
const blankPoint = () => ({ looks_for: '', model_answer: '', points: 1, levels: levelPoints(1).map((p, i, a) => ({ points: p, label: i === 0 ? 'No credit' : i === a.length - 1 ? 'Full credit' : 'Partial credit', descriptor: '' })), full_marks_also_for: [], no_marks_for: [] });

function CriterionEditor({ criterion, questions, onSave, onCancel, busy }) {
  const [c, setC] = useState(() => structuredClone(criterion));
  const q = questions.find((x) => x.i === c.question);
  const setMp = (i, patch) => setC((cur) => ({ ...cur, marking_points: cur.marking_points.map((m, k) => (k === i ? { ...m, ...patch } : m)) }));
  const setPoints = (i, raw) => setC((cur) => ({
    ...cur,
    marking_points: cur.marking_points.map((m, k) => {
      if (k !== i) return m;
      const p = Math.max(0.5, half(raw) || 0.5);
      const want = levelPoints(p);
      // Keep each rung's words by its role (none · partial · full) as the marks change.
      const old = m.levels;
      const levels = want.map((lp, j) => {
        const role = j === 0 ? 0 : j === want.length - 1 ? old.length - 1 : Math.min(1, old.length - 1);
        return { points: lp, label: old[role]?.label || '', descriptor: old[role]?.descriptor || '' };
      });
      return { ...m, points: p, levels };
    }),
  }));
  const total = c.marking_points.reduce((s, m) => s + (Number(m.points) || 0), 0);
  const valid = c.marking_points.length > 0 && c.marking_points.every((m) => m.looks_for.trim());
  return (
    <div style={{ border: `1.5px solid ${C.brand}`, borderRadius: 12, padding: 14, marginTop: 10, background: C.surface }}>
      <Label>Question</Label>
      <select value={c.question} onChange={(e) => setC({ ...c, question: Number(e.target.value) })} aria-label="Question" style={{ ...inputStyle, marginBottom: 9 }}>
        {questions.map((x) => <option key={x.i} value={x.i}>Q{x.i + 1} · {x.marks} marks — {String(x.q?.q || '').slice(0, 70)}</option>)}
      </select>
      <Label>Criterion</Label>
      <input value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} placeholder="Short name, e.g. Octal decoding" aria-label="Criterion title" style={{ ...inputStyle, marginBottom: 6 }} />
      <textarea value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} rows={2} placeholder="What a correct answer does" aria-label="Criterion description" style={{ ...inputStyle, resize: 'vertical' }} />
      {c.marking_points.map((m, i) => (
        <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 11, marginTop: 10, background: C.bg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Label>Marking point {i + 1}</Label>
            <span style={{ flex: 1 }} />
            <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, display: 'inline-flex', alignItems: 'center', gap: 5 }}>Marks
              <input type="number" min={0.5} step={0.5} value={m.points} onChange={(e) => setPoints(i, e.target.value)} aria-label={`Marks for marking point ${i + 1}`} style={{ ...inputStyle, width: 64, padding: '5px 7px' }} /></label>
            {c.marking_points.length > 1 && <button type="button" aria-label={`Remove marking point ${i + 1}`} onClick={() => setC({ ...c, marking_points: c.marking_points.filter((_, k) => k !== i) })} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><Ico ti="ti-trash" size={14} color={C.muted2} /></button>}
          </div>
          <textarea value={m.looks_for} onChange={(e) => setMp(i, { looks_for: e.target.value })} rows={2} placeholder="What to look for — e.g. Does the answer show how each digit is worked out?" aria-label={`Looks for, marking point ${i + 1}`} style={{ ...inputStyle, resize: 'vertical', marginBottom: 6 }} />
          <textarea value={m.model_answer} onChange={(e) => setMp(i, { model_answer: e.target.value })} rows={2} placeholder="Model answer" aria-label={`Model answer, marking point ${i + 1}`} style={{ ...inputStyle, resize: 'vertical' }} />
          <div style={{ marginTop: 8 }}>
            {m.levels.map((l, k) => (
              <div key={l.points} style={{ display: 'grid', gridTemplateColumns: '56px 1fr 2fr', gap: 6, marginTop: 5, alignItems: 'center' }}>
                <Pill color={l.points === 0 ? RED : l.points === m.points ? GREEN : AMBER} bg={l.points === 0 ? RED_BG : l.points === m.points ? GREEN_BG : 'rgba(245,158,11,.12)'}>{pts(l.points)}</Pill>
                <input value={l.label} onChange={(e) => setMp(i, { levels: m.levels.map((x, y) => (y === k ? { ...x, label: e.target.value } : x)) })} aria-label={`Level ${l.points} label`} style={{ ...inputStyle, padding: '5px 7px', fontSize: 11.5 }} />
                <input value={l.descriptor} onChange={(e) => setMp(i, { levels: m.levels.map((x, y) => (y === k ? { ...x, descriptor: e.target.value } : x)) })} placeholder="What this level looks like" aria-label={`Level ${l.points} descriptor`} style={{ ...inputStyle, padding: '5px 7px', fontSize: 11.5 }} />
              </div>
            ))}
          </div>
          <ChipsEditor label="Full marks also for" tone="green" values={m.full_marks_also_for} onChange={(v) => setMp(i, { full_marks_also_for: v })} />
          <ChipsEditor label="No marks for" tone="red" values={m.no_marks_for} onChange={(v) => setMp(i, { no_marks_for: v })} />
        </div>
      ))}
      {c.marking_points.length < 6 && <div style={{ marginTop: 8 }}><Btn onClick={() => setC({ ...c, marking_points: [...c.marking_points, blankPoint()] })}><Ico ti="ti-plus" size={12} /> Add marking point</Btn></div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <span style={{ flex: 1, fontSize: 11, color: C.muted, lineHeight: 1.4 }}>
          {q ? `Q${q.i + 1} is worth ${pts(q.marks)}; its marking points are re-fitted to add up to that.` : ''}{Math.abs(total - (q?.marks ?? total)) > 0.01 ? ` (these add up to ${total}.)` : ''}
        </span>
        <Btn onClick={onCancel} disabled={busy}>Cancel</Btn>
        <Btn kind="primary" onClick={() => onSave(c)} disabled={busy || !valid}>{busy ? 'Saving…' : 'Save'}</Btn>
      </div>
    </div>
  );
}

/* ── The tab ──────────────────────────────────────────────────────────── */
export default function RubricTab({ draftId, version, onChanged }) {
  const r = version?.rubric || null;
  const scheme = r?.scheme || null;
  const [open, setOpen] = useState(() => new Set());
  const [editing, setEditing] = useState(null);       // criterion id, or 'new'
  const [improving, setImproving] = useState(false);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const questions = useMemo(() => (version?.paper?.questions || []).map((q, i) => ({ q, i, marks: qMarks(q) })).filter((x) => !isKeyed(x.q)), [version]);
  const writing = r?.status === 'drafting';
  const criteria = scheme?.criteria || [];

  if (!version || version.status !== 'ready') {
    return <div style={{ padding: '30px 16px', textAlign: 'center', fontSize: 12.5, color: C.muted, fontFamily: C.font }}>The questions are still being written — the rubric is made from them.</div>;
  }

  const run = async (fn, fallback) => {
    setBusy(true); setErr('');
    try { await fn(); await onChanged?.(); } catch (e) { setErr(e?.message || fallback); } finally { setBusy(false); }
  };
  const generate = (request) => run(() => apiPost(`/api/self-study/drafts/${draftId}/versions/${version.n}/rubric`, request ? { request } : {}), 'Could not write the rubric.');
  const saveScheme = (next) => run(async () => { await apiPut(`/api/self-study/drafts/${draftId}/versions/${version.n}/rubric`, { scheme: next }); setEditing(null); }, 'Could not save the rubric.');
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const maxPoints = Math.max(1, ...criteria.map((c) => c.points || 0));   // the bar beside each criterion: its marks against the biggest
  const allOpen = criteria.length > 0 && criteria.every((c) => open.has(c.id));

  const saveCriterion = (edited) => {
    const next = editing === 'new'
      ? [...criteria, edited]
      : criteria.map((c) => (c.id === editing ? edited : c));
    return saveScheme({ ...scheme, criteria: next });
  };
  const remove = (id) => saveScheme({ ...scheme, criteria: criteria.filter((c) => c.id !== id) });

  /* ── nothing yet / failed / all multiple choice ── */
  if (!scheme && !writing) {
    const failed = r?.status === 'failed';
    return (
      <div style={{ padding: '28px 16px', textAlign: 'center', fontFamily: C.font }}>
        <Ico ti={failed ? 'ti-alert-triangle' : 'ti-clipboard-text'} size={22} color={failed ? RED : C.muted2} />
        <div style={{ fontSize: 13.5, fontWeight: 850, color: C.ink, margin: '8px 0 4px' }}>{failed ? "The rubric couldn't be written" : 'No rubric yet'}</div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, maxWidth: 340, margin: '0 auto 12px' }}>{failed ? (r.error || 'Something went wrong.') : 'The AI will write it from this version’s questions — what to look for, the model answer and the levels — and you can edit all of it.'}</div>
        <Btn kind="primary" onClick={() => generate()} disabled={busy}><Ico ti="ti-sparkles" size={13} /> {failed ? 'Try again' : 'Write the rubric'}</Btn>
        {err && <div role="alert" style={{ fontSize: 11.5, fontWeight: 700, color: RED, marginTop: 8 }}>{err}</div>}
      </div>
    );
  }
  if (writing && !scheme) {
    return (
      <div style={{ padding: '34px 16px', textAlign: 'center', fontFamily: C.font }}>
        <Ico ti="ti-loader-2" size={20} color={C.brand} style={{ animation: 'spin .8s linear infinite' }} />
        <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginTop: 8 }}>Writing the rubric…</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Splitting each question into marking points — usually under a minute.</div>
      </div>
    );
  }
  if (!criteria.length) {
    return <div style={{ padding: '26px 16px', textAlign: 'center', fontSize: 12.5, color: C.muted, lineHeight: 1.5, fontFamily: C.font }}>{r?.note || 'Every question is multiple choice, marked from the answer key — there is nothing for a rubric to cover.'}</div>;
  }

  return (
    <div data-rubric-tab="" style={{ fontFamily: C.font }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: GREEN_BG, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti="ti-clipboard-check" size={17} color={GREEN} /></span>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 14, fontWeight: 850, color: C.ink }}>Grading Rubric</div>
          <div style={{ fontSize: 11.5, color: C.muted }}>{r.summary?.criteria ?? criteria.length} criteria · {pts(r.summary?.totalPoints ?? scheme.total_points)}</div>
        </div>
        {writing
          ? <Pill color={C.brand} bg={C.brandSoft}><Ico ti="ti-loader-2" size={11} color={C.brand} style={{ animation: 'spin .8s linear infinite' }} /> Improving…</Pill>
          : <Pill color="color-mix(in srgb, #16A34A 70%, var(--ak-text))" bg={GREEN_BG} border="rgba(22,163,74,.35)"><Ico ti="ti-check" size={11} color="color-mix(in srgb, #16A34A 70%, var(--ak-text))" /> {r.edited ? 'Rubric ready · edited' : 'Rubric ready'}</Pill>}
        <Btn onClick={() => setImproving((v) => !v)} disabled={busy || writing}><Ico ti="ti-sparkles" size={12} color={C.brand} /> Improve with AI</Btn>
      </div>

      {r.stale && !writing && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 10, background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.4)', marginBottom: 10, fontSize: 12, color: C.ink, lineHeight: 1.4 }}>
          <Ico ti="ti-alert-triangle" size={15} color={AMBER} />
          <span style={{ flex: 1 }}>The questions changed after this rubric was written. It may not match them any more.</span>
          <Btn onClick={() => generate('The questions have changed. Update the rubric to match them, keeping whatever still applies.')} disabled={busy}>Update to match</Btn>
        </div>
      )}
      {r.status === 'failed' && (
        <div role="alert" style={{ padding: '9px 12px', borderRadius: 10, background: RED_BG, border: '1px solid rgba(220,38,38,.3)', marginBottom: 10, fontSize: 12, color: 'color-mix(in srgb, #DC2626 70%, var(--ak-text))' }}>{r.error || "That didn't work."} <button type="button" onClick={() => generate(ask.trim() || 'Improve this rubric.')} style={{ border: 'none', background: 'none', color: 'color-mix(in srgb, #DC2626 70%, var(--ak-text))', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline', fontFamily: C.font }}>Try again</button></div>
      )}
      {improving && !writing && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { generate(ask.trim() || 'Improve this rubric.'); setImproving(false); setAsk(''); } }}
            placeholder="What should change? (optional) — e.g. be stricter about units" aria-label="How should the rubric improve" style={{ ...inputStyle, flex: 1 }} />
          <Btn kind="primary" onClick={() => { generate(ask.trim() || 'Improve this rubric.'); setImproving(false); setAsk(''); }} disabled={busy}>Improve</Btn>
        </div>
      )}

      {/* criteria */}
      <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', background: C.surface, opacity: writing ? .6 : 1 }}>
        {criteria.map((c, idx) => {
          const on = open.has(c.id);
          const only = criteria.filter((x) => x.question === c.question).length === 1;
          return (
            <div key={c.id} style={{ borderTop: idx ? `1px solid ${C.border}` : 'none' }}>
              <button type="button" onClick={() => toggle(c.id)} aria-expanded={on}
                style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 14px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: C.font }}>
                <span style={{ minWidth: 22, height: 22, borderRadius: '50%', background: C.bg, border: `1px solid ${C.border}`, fontSize: 10.5, fontWeight: 800, color: C.muted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>{idx + 1}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.ink, lineHeight: 1.45 }}>
                  <strong>{c.title}</strong><span style={{ color: C.muted }}> · Q{c.question + 1}</span>{c.description ? <span style={{ color: C.ink2 }}> — {c.description}</span> : null}
                </span>
                <span aria-hidden style={{ width: 34, height: 4, borderRadius: 3, background: C.border, marginTop: 8, flexShrink: 0, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${Math.round((c.points / maxPoints) * 100)}%`, background: C.brand }} /></span>
                <span style={{ fontSize: 12, fontWeight: 800, color: C.ink, minWidth: 46, textAlign: 'right', flexShrink: 0 }}>{pts(c.points)}</span>
                <Ico ti={on ? 'ti-chevron-up' : 'ti-chevron-down'} size={15} color={C.muted2} style={{ marginTop: 2, flexShrink: 0 }} />
              </button>
              {on && (editing === c.id ? (
                <div style={{ padding: '0 14px 14px' }}><CriterionEditor criterion={c} questions={questions} busy={busy} onCancel={() => setEditing(null)} onSave={saveCriterion} /></div>
              ) : (
                <div style={{ padding: '0 14px 14px' }}>
                  {c.marking_points.map((m, i) => <MarkingPoint key={m.id} mp={m} n={i + 1} />)}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                    <Btn onClick={() => setEditing(c.id)} disabled={busy || writing}><Ico ti="ti-pencil" size={12} /> Edit</Btn>
                    <Btn onClick={() => remove(c.id)} disabled={busy || writing || only} title={only ? 'Every question the AI marks needs a criterion — edit this one instead.' : 'Remove this criterion'}><Ico ti="ti-trash" size={12} /> Remove</Btn>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        {editing === 'new' && (
          <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${C.border}` }}>
            <CriterionEditor criterion={{ title: '', description: '', question: questions[0]?.i ?? 0, marking_points: [blankPoint()] }} questions={questions} busy={busy} onCancel={() => setEditing(null)} onSave={saveCriterion} />
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', padding: '9px 14px', borderTop: `1px solid ${C.border}`, background: C.bg }}>
          <button type="button" onClick={() => setEditing('new')} disabled={busy || writing || editing === 'new' || !questions.length}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.brand, fontWeight: 800, fontSize: 12, fontFamily: C.font, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Ico ti="ti-plus" size={13} color={C.brand} /> Add criterion</button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(criteria.map((c) => c.id)))}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.muted, fontWeight: 700, fontSize: 12, fontFamily: C.font }}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
        </div>
      </div>
      {r.note && <div style={{ fontSize: 11, color: C.muted2, marginTop: 8 }}>{r.note} The AI picks the level that fits each marking point for every answer, and you approve the marks before learners see them.</div>}
      {err && <div role="alert" style={{ fontSize: 11.5, fontWeight: 700, color: RED, marginTop: 8 }}>{err}</div>}
    </div>
  );
}
