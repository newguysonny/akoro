import { useState } from 'react';
import { Plus, Trash2, Calendar, Clock, Link2, FileText, StickyNote, ChevronDown, Wand2, Pencil, Users } from 'lucide-react';
import { Btn, Modal, Inp, Txa, Sel, WizardSteps, FileUploadZone } from './Primitives.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, FONT } from '../constants.js';
import { generateSchedule, recomputeSession, FREQ_DEFAULT_DAYS, FREQ_MAX_DAYS, DAY_LABELS } from '../utils/schedule.js';
import { fileToDataUrl } from '../utils/image.js';

const FREQ = [
  { key: 'weekly',     label: 'Weekly' },
  { key: 'biweekly',   label: 'Bi-weekly' },
  { key: '3x_weekly',  label: '3× Weekly' },
  { key: 'custom',     label: 'Custom' },
];
const PLATFORMS = [['zoom', 'Zoom'], ['meet', 'Google Meet'], ['teams', 'Teams'], ['youtube', 'YouTube Live']];
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '—';

/* ── Schedule builder (Step 1) ──────────────────────────────────────── */
function ScheduleStep({ spec, setSpec, onGenerate, onManual }) {
  const set = (k, v) => setSpec((s) => ({ ...s, [k]: v }));
  const maxDays = FREQ_MAX_DAYS[spec.frequency];   // undefined => unlimited (custom)
  const toggleDay = (d) =>
    setSpec((s) => {
      const max = FREQ_MAX_DAYS[s.frequency];
      if (s.daysOfWeek.includes(d)) {                       // deselect
        return { ...s, daysOfWeek: s.daysOfWeek.filter((x) => x !== d) };
      }
      if (max === 1) {                                      // single-select: replace
        return { ...s, daysOfWeek: [d] };
      }
      if (max && s.daysOfWeek.length >= max) {              // at cap: block
        return s;
      }
      return { ...s, daysOfWeek: [...s.daysOfWeek, d].sort((a, b) => a - b) };
    });
  const pickFreq = (key) => setSpec((s) => {
    const max = FREQ_MAX_DAYS[key];
    let days = FREQ_DEFAULT_DAYS[key] || s.daysOfWeek;
    if (max) days = days.slice(0, max);
    return { ...s, frequency: key, daysOfWeek: [...days].sort((a, b) => a - b) };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={lbl}>Frequency</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FREQ.map(({ key, label }) => (
            <button key={key} onClick={() => pickFreq(key)} style={pill(spec.frequency === key)}>{label}</button>
          ))}
        </div>
      </div>

      <div>
        <label style={lbl}>Days of week{maxDays ? ` · pick ${maxDays}` : ''}</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DAY_LABELS.map((d, i) => {
            const selected = spec.daysOfWeek.includes(i);
            const atCap = !!maxDays && !selected && spec.daysOfWeek.length >= maxDays;
            return (
              <button key={i} onClick={() => toggleDay(i)} style={{ ...dayPill(selected), ...(atCap && maxDays > 1 ? { opacity: 0.4 } : {}) }}>{d}</button>
            );
          })}
        </div>
        {maxDays && (
          <p style={{ fontSize: 11.5, color: MUTED2, margin: '6px 0 0', fontFamily: FONT }}>
            {spec.frequency === 'weekly' ? 'Weekly — pick 1 day (choosing another replaces it).'
              : `${spec.frequency === 'biweekly' ? 'Bi-weekly' : '3× Weekly'} — pick up to ${maxDays} days.`}
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Inp label="Start date" type="date" value={spec.startDate} onChange={(e) => set('startDate', e.target.value)} />
        <Inp label="Time" type="time" value={spec.time} onChange={(e) => set('time', e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Inp label="Duration (min)" type="number" value={spec.durationMin} onChange={(e) => set('durationMin', e.target.value)} />
        <Inp label="Weeks (modules)" type="number" value={spec.weeks} onChange={(e) => set('weeks', e.target.value)} />
        <Sel label="Platform" value={spec.platform} onChange={(e) => set('platform', e.target.value)}>
          {PLATFORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Sel>
      </div>

      <div style={{ background: LIGHT, borderRadius: 10, padding: '10px 12px', fontSize: 12, color: MUTED, fontFamily: FONT }}>
        Generates <b>{spec.weeks || 0}</b> module-weeks × <b>{spec.daysOfWeek.length}</b> day(s) ={' '}
        <b>{(Number(spec.weeks) || 0) * spec.daysOfWeek.length}</b> sessions. You can edit everything next.
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
        <Btn variant="secondary" onClick={onManual}>Skip — build manually</Btn>
        <Btn onClick={onGenerate} disabled={!spec.startDate || !spec.daysOfWeek.length || !spec.weeks}>
          <Wand2 size={14} /> Generate
        </Btn>
      </div>
    </div>
  );
}

/* ── Material editor row ────────────────────────────────────────────── */
function MaterialRow({ mat, onChange, onRemove }) {
  const Icon = mat.kind === 'link' ? Link2 : mat.kind === 'note' ? StickyNote : FileText;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon size={13} color={MUTED} />
        <select value={mat.kind} onChange={(e) => onChange({ ...mat, kind: e.target.value })}
          style={{ fontSize: 11, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '2px 4px', fontFamily: FONT }}>
          <option value="file">File</option><option value="link">Link</option><option value="note">Note</option>
        </select>
        <input placeholder="Title" value={mat.title} onChange={(e) => onChange({ ...mat, title: e.target.value })}
          style={{ flex: 1, fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 6px', fontFamily: FONT }} />
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><Trash2 size={13} /></button>
      </div>
      {mat.kind === 'link' && (
        <input placeholder="https://…" value={mat.url || ''} onChange={(e) => onChange({ ...mat, url: e.target.value })}
          style={{ fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 6px', fontFamily: FONT }} />
      )}
      {mat.kind === 'note' && (
        <textarea placeholder="Note…" value={mat.body || ''} onChange={(e) => onChange({ ...mat, body: e.target.value })} rows={2}
          style={{ fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 6px', fontFamily: FONT, resize: 'vertical' }} />
      )}
      {mat.kind === 'file' && !mat.url && (
        <FileUploadZone label="Upload file" onUploaded={({ fileUrl, fileName }) => onChange({ ...mat, url: fileUrl, title: mat.title || fileName })} />
      )}
      {mat.kind === 'file' && mat.url && <span style={{ fontSize: 11, color: GREEN }}>Uploaded ✓</span>}
    </div>
  );
}

/* ── One session (topic) editor ─────────────────────────────────────── */
function TopicRow({ topic, idx, onChange, onRemove }) {
  const [open, setOpen] = useState(false);
  const upd = (patch) => onChange(recomputeSession({ ...topic, ...patch }));
  const mats = topic.materials || [];

  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: AMBER, fontFamily: FONT, minWidth: 18 }}>{idx + 1}</span>
        <input placeholder="Topic / lesson focus" value={topic.title} onChange={(e) => upd({ title: e.target.value })}
          style={{ flex: 1, fontSize: 13, fontWeight: 600, border: 'none', outline: 'none', fontFamily: FONT, color: INK }} />
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><Trash2 size={14} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr .9fr .8fr', gap: 8 }}>
        <input type="date" value={topic.date || ''} onChange={(e) => upd({ date: e.target.value })} style={miniInp} />
        <input type="time" value={topic.time || ''} onChange={(e) => upd({ time: e.target.value })} style={miniInp} />
        <input type="number" value={topic.duration_min} onChange={(e) => upd({ duration_min: e.target.value })} style={miniInp} title="Duration (min)" />
      </div>
      <button onClick={() => setOpen((o) => !o)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', color: MUTED2, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, fontFamily: FONT }}>
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '.15s' }} />
        Materials {mats.length > 0 && `(${mats.length})`}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {mats.map((m, i) => (
            <MaterialRow key={i} mat={m}
              onChange={(nm) => upd({ materials: mats.map((x, j) => j === i ? nm : x) })}
              onRemove={() => upd({ materials: mats.filter((_, j) => j !== i) })} />
          ))}
          <Btn variant="secondary" size="sm" onClick={() => upd({ materials: [...mats, { kind: 'file', title: '' }] })}>
            <Plus size={12} /> Add material
          </Btn>
        </div>
      )}
    </div>
  );
}

/* ── Module (week) accordion ────────────────────────────────────────── */
function ModuleCard({ mod, mi, onChange, onRemove }) {
  const [open, setOpen] = useState(mi === 0);
  const setSession = (si, s) => onChange({ ...mod, sessions: mod.sessions.map((x, j) => j === si ? s : x) });
  const addTopic = () => onChange({ ...mod, sessions: [...mod.sessions, recomputeSession({ title: '', date: '', time: mod.sessions[0]?.time || '16:00', duration_min: mod.sessions[0]?.duration_min || 60, platform: mod.sessions[0]?.platform || 'zoom', order_index: mod.sessions.length, materials: [] })] });
  const removeTopic = (si) => onChange({ ...mod, sessions: mod.sessions.filter((_, j) => j !== si) });

  return (
    <div style={{ background: LIGHT, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}>
          <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '.15s' }} />
        </button>
        <input value={mod.title} onChange={(e) => onChange({ ...mod, title: e.target.value })} placeholder={`Module ${mi + 1}`}
          style={{ flex: 1, fontSize: 14, fontWeight: 800, border: 'none', background: 'transparent', outline: 'none', fontFamily: FONT, color: INK }} />
        <span style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>
          {mod.sessions.length} topic{mod.sessions.length !== 1 ? 's' : ''}
          {mod.sessions[0]?.scheduled_start && ` · ${fmtDate(mod.sessions[0].scheduled_start)}`}
        </span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><Trash2 size={14} /></button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mod.sessions.map((s, si) => (
            <TopicRow key={si} topic={s} idx={si} onChange={(ns) => setSession(si, ns)} onRemove={() => removeTopic(si)} />
          ))}
          <Btn variant="secondary" size="sm" onClick={addTopic}><Plus size={13} /> Add topic</Btn>
        </div>
      )}
    </div>
  );
}

/* ── Main wizard ────────────────────────────────────────────────────── */
export default function LiveClassWizard({ open, onClose, onSubmit }) {
  const [step, setStep] = useState(0);
  const [info, setInfo] = useState({ title: '', description: '', maxStudents: '30', thumbnail: null });
  const [spec, setSpec] = useState({ frequency: '3x_weekly', daysOfWeek: [1, 3, 5], time: '16:00', durationMin: 60, startDate: '', weeks: 4, platform: 'zoom' });
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(false);

  const reset = () => { setStep(0); setInfo({ title: '', description: '', maxStudents: '30', thumbnail: null }); setModules([]); };

  const doGenerate = () => { setModules(generateSchedule(spec).modules); setStep(2); };
  const doManual = () => { setModules([{ title: 'Module 1', orderIndex: 0, sessions: [] }]); setStep(2); };

  const setModule = (mi, m) => setModules((ms) => ms.map((x, j) => j === mi ? m : x));
  const addModule = () => setModules((ms) => [...ms, { title: `Module ${ms.length + 1}`, orderIndex: ms.length, sessions: [] }]);
  const removeModule = (mi) => setModules((ms) => ms.filter((_, j) => j !== mi));

  const totalSessions = modules.reduce((n, m) => n + m.sessions.length, 0);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onSubmit({ info, spec, modules });
      onClose(); reset();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Live Course" width={620}>
      <WizardSteps steps={['Course Info', 'Schedule', 'Modules & Topics', 'Review']} current={step} />

      {step === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Inp label="Course Title" value={info.title} onChange={(e) => setInfo({ ...info, title: e.target.value })} placeholder="e.g. JSS1 Mathematics — First Term" />
          <Txa label="Description" value={info.description} onChange={(e) => setInfo({ ...info, description: e.target.value })} placeholder="What will students learn?" />
          <Inp label="Max Students" type="number" value={info.maxStudents} onChange={(e) => setInfo({ ...info, maxStudents: e.target.value })} />
          <div>
            <label style={lbl}>Thumbnail (optional)</label>
            <FileUploadZone label="Upload course thumbnail" accept="image/*" upload={false}
              onFile={async (f) => { try { const url = await fileToDataUrl(f); setInfo((p) => ({ ...p, thumbnail: url })); } catch { /* ignore */ } }} />
            {info.thumbnail && <img src={info.thumbnail} alt="" style={{ marginTop: 10, width: '100%', maxHeight: 150, objectFit: 'cover', borderRadius: 10, border: `1px solid ${BORDER}` }} />}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
            <Btn onClick={() => setStep(1)} disabled={!info.title.trim()}>Next: Schedule</Btn>
          </div>
        </div>
      )}

      {step === 1 && (
        <>
          <ScheduleStep spec={spec} setSpec={setSpec} onGenerate={doGenerate} onManual={doManual} />
          <div style={{ marginTop: 12 }}><Btn variant="secondary" onClick={() => setStep(0)}>Back</Btn></div>
        </>
      )}

      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: MUTED, fontFamily: FONT }}>{modules.length} modules · {totalSessions} sessions</span>
            <Btn variant="secondary" size="sm" onClick={() => setStep(1)}><Pencil size={12} /> Edit schedule</Btn>
          </div>
          {modules.map((m, mi) => (
            <ModuleCard key={mi} mod={m} mi={mi} onChange={(nm) => setModule(mi, nm)} onRemove={() => removeModule(mi)} />
          ))}
          <Btn variant="secondary" size="sm" onClick={addModule}><Plus size={13} /> Add module</Btn>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <Btn variant="secondary" onClick={() => setStep(1)}>Back</Btn>
            <Btn onClick={() => setStep(3)} disabled={totalSessions === 0}>Review</Btn>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: LIGHT, borderRadius: 12, padding: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: INK, margin: '0 0 4px', fontFamily: FONT }}>{info.title}</h3>
            <p style={{ fontSize: 13, color: MUTED, margin: '0 0 10px', fontFamily: FONT }}>{info.description}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: MUTED }}>
              <span style={tag}><Users size={10} /> Max {info.maxStudents}</span>
              <span style={tag}><Calendar size={10} /> {modules.length} modules</span>
              <span style={tag}><Clock size={10} /> {totalSessions} sessions</span>
            </div>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {modules.map((m, mi) => (
              <div key={mi} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK, fontFamily: FONT, marginBottom: 4 }}>{m.title}</div>
                {m.sessions.map((s, si) => (
                  <div key={si} style={{ fontSize: 12, color: MUTED, fontFamily: FONT, display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                    <span>{s.title || `Topic ${si + 1}`}</span>
                    <span>{fmtDate(s.scheduled_start)} · {s.time}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Btn variant="secondary" onClick={() => setStep(2)}>Back</Btn>
            <Btn onClick={handleSubmit} disabled={loading || !info.title.trim()}>{loading ? 'Creating…' : 'Create Course'}</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ── styles ──────────────────────────────────────────────────────────── */
const lbl = { fontSize: 12, fontWeight: 700, color: INK, display: 'block', marginBottom: 6, fontFamily: FONT };
const miniInp = { fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '5px 6px', fontFamily: FONT, color: INK, width: '100%', boxSizing: 'border-box' };
const tag = { background: WHITE, padding: '3px 10px', borderRadius: 20, border: `1px solid ${BORDER}`, display: 'inline-flex', alignItems: 'center', gap: 4 };
const pill = (active) => ({ padding: '7px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, background: active ? AMBER : WHITE, color: active ? WHITE : MUTED, border: `1.5px solid ${active ? AMBER : BORDER}` });
const dayPill = (active) => ({ width: 42, padding: '7px 0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, background: active ? AMBER : WHITE, color: active ? WHITE : MUTED, border: `1.5px solid ${active ? AMBER : BORDER}` });
