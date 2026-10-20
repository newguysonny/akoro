import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, ChevronDown, Calendar, Clock, Link2, FileText, StickyNote, Loader } from 'lucide-react';
import { Modal, Btn, Inp, Sel, FileUploadZone, StatusPill } from './Primitives.jsx';
import { useCoursesAPI } from '../hooks/useCoursesAPI.js';
import { GREEN } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const PLATFORMS = [['zoom', 'Zoom'], ['meet', 'Google Meet'], ['teams', 'Teams']];
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '—';
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
const toLocalParts = (iso) => {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
};

/* ── Materials manager (lazy-loaded per topic) ──────────────────────── */
function Materials({ sessionId, api, onToast }) {
  const [mats, setMats] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ kind: 'file', title: '', url: '', body: '' });

  const load = useCallback(() => {
    api.getMaterials(sessionId).then((r) => setMats(r?.data ?? [])).catch(() => setMats([]));
  }, [sessionId, api]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!draft.title && !draft.url && !draft.body) return;
    try {
      await api.addMaterial(sessionId, draft);
      setDraft({ kind: 'file', title: '', url: '', body: '' });
      setAdding(false);
      load();
    } catch { onToast?.('Could not add material', 'error'); }
  };
  const remove = async (id) => {
    try { await api.deleteMaterial(id); setMats((m) => m.filter((x) => x.id !== id)); }
    catch { onToast?.('Could not remove material', 'error'); }
  };

  const KindIcon = ({ k }) => {
    const I = k === 'link' ? Link2 : k === 'note' ? StickyNote : FileText;
    return <I size={12} color={C.muted} />;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6 }}>
      {mats === null ? (
        <span style={{ fontSize: 11, color: C.muted, display: 'flex', alignItems: 'center', gap: 4 }}><Ico lucide={Loader} ti="ti-loader-2" size={11} className="spinner" /> Loading…</span>
      ) : mats.map((m) => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.ink }}>
          <KindIcon k={m.kind} />
          {m.url ? <a href={m.url} target="_blank" rel="noreferrer" style={{ color: C.brand, textDecoration: 'none', flex: 1 }}>{m.title}</a>
                 : <span style={{ flex: 1 }}>{m.title}</span>}
          <button onClick={() => remove(m.id)} style={iconBtn}><Ico lucide={Trash2} ti="ti-trash" size={12} /></button>
        </div>
      ))}

      {adding ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} style={miniSel}>
              <option value="file">File</option><option value="link">Link</option><option value="note">Note</option>
            </select>
            <input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ ...miniInp, flex: 1 }} />
          </div>
          {draft.kind === 'link' && <input placeholder="https://…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} style={miniInp} />}
          {draft.kind === 'note' && <textarea placeholder="Note…" rows={2} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} style={miniInp} />}
          {draft.kind === 'file' && !draft.url && (
            <FileUploadZone label="Upload file" onUploaded={({ fileUrl, fileName }) => setDraft((d) => ({ ...d, url: fileUrl, title: d.title || fileName }))} />
          )}
          {draft.kind === 'file' && draft.url && <span style={{ fontSize: 11, color: GREEN }}>Uploaded ✓</span>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <Btn size="sm" variant="secondary" onClick={() => setAdding(false)}>Cancel</Btn>
            <Btn size="sm" onClick={save}>Add</Btn>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ ...linkBtn, alignSelf: 'flex-start' }}><Ico lucide={Plus} ti="ti-plus" size={12} /> Add material</button>
      )}
    </div>
  );
}

/* ── A single topic (session) row with inline edit ──────────────────── */
function TopicRow({ session, api, onChanged, onToast }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const init = toLocalParts(session.startTime || session.scheduled_start);
  const [form, setForm] = useState({ title: session.title || '', ...init });

  const save = async () => {
    try {
      const startTime = form.date && form.time ? new Date(`${form.date}T${form.time}`).toISOString() : undefined;
      await api.updateSession(session.id, { title: form.title, ...(startTime ? { startTime } : {}) });
      setEdit(false); onChanged();
    } catch { onToast?.('Could not save topic', 'error'); }
  };
  const del = async () => {
    try { await api.deleteSession(session.id); onChanged(); }
    catch { onToast?.('Could not delete topic', 'error'); }
  };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10 }}>
      {edit ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Inp value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Topic" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Inp type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <Inp type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <Btn size="sm" variant="secondary" onClick={() => setEdit(false)}>Cancel</Btn>
            <Btn size="sm" onClick={save}>Save</Btn>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: C.font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {session.title || 'Untitled topic'}
            </div>
            <div style={{ fontSize: 11, color: C.muted, display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Ico lucide={Calendar} ti="ti-calendar" size={10} /> {fmtDate(session.startTime || session.scheduled_start)}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Ico lucide={Clock} ti="ti-clock" size={10} /> {fmtTime(session.startTime || session.scheduled_start)}</span>
            </div>
          </div>
          <StatusPill status={session.status} />
          <button onClick={() => setOpen((o) => !o)} style={iconBtn} title="Materials">
            <Ico lucide={ChevronDown} ti="ti-chevron-down" size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '.15s' }} />
          </button>
          <button onClick={() => setEdit(true)} style={linkBtn}>Edit</button>
          <button onClick={del} style={iconBtn}><Ico lucide={Trash2} ti="ti-trash" size={13} /></button>
        </div>
      )}
      {open && !edit && <Materials sessionId={session.id} api={api} onToast={onToast} />}
    </div>
  );
}

/* ── A module (week) card ───────────────────────────────────────────── */
function ModuleCard({ module: mod, courseId, api, onChanged, onToast }) {
  const [open, setOpen] = useState(true);
  const [addingTopic, setAddingTopic] = useState(false);
  const [t, setT] = useState({ title: '', date: '', time: '16:00', duration: 60, platform: 'zoom' });

  const addTopic = async () => {
    if (!t.title || !t.date || !t.time) { onToast?.('Topic needs a title, date and time', 'error'); return; }
    try {
      await api.createSession({
        courseId, moduleId: mod.id, title: t.title,
        startTime: new Date(`${t.date}T${t.time}`).toISOString(),
        duration: Number(t.duration), platform: t.platform,
        orderIndex: mod.sessions.length,
      });
      setT({ title: '', date: '', time: '16:00', duration: 60, platform: 'zoom' });
      setAddingTopic(false); onChanged();
    } catch { onToast?.('Could not add topic', 'error'); }
  };
  const delModule = async () => {
    try { await api.deleteModule(mod.id); onChanged(); }
    catch { onToast?.('Could not delete module', 'error'); }
  };

  return (
    <div style={{ background: C.bg, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => setOpen((o) => !o)} style={iconBtn}>
          <Ico lucide={ChevronDown} ti="ti-chevron-down" size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '.15s' }} />
        </button>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 800, color: C.ink, fontFamily: C.font }}>{mod.title}</span>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: C.font }}>{mod.sessions.length} topic{mod.sessions.length !== 1 ? 's' : ''}</span>
        <button onClick={delModule} style={iconBtn}><Ico lucide={Trash2} ti="ti-trash" size={14} /></button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mod.sessions.map((s) => (
            <TopicRow key={s.id} session={s} api={api} onChanged={onChanged} onToast={onToast} />
          ))}
          {addingTopic ? (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Inp value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} placeholder="Topic / lesson focus" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Inp type="date" value={t.date} onChange={(e) => setT({ ...t, date: e.target.value })} />
                <Inp type="time" value={t.time} onChange={(e) => setT({ ...t, time: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Inp type="number" value={t.duration} onChange={(e) => setT({ ...t, duration: e.target.value })} />
                <Sel value={t.platform} onChange={(e) => setT({ ...t, platform: e.target.value })}>
                  {PLATFORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Sel>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <Btn size="sm" variant="secondary" onClick={() => setAddingTopic(false)}>Cancel</Btn>
                <Btn size="sm" onClick={addTopic}>Add topic</Btn>
              </div>
            </div>
          ) : (
            <Btn size="sm" variant="secondary" onClick={() => setAddingTopic(true)}><Ico lucide={Plus} ti="ti-plus" size={13} /> Add topic</Btn>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main curriculum modal ──────────────────────────────────────────── */
export default function CourseCurriculum({ open, course, onClose, onToast , asPage = false }) {
  const api = useCoursesAPI();
  const [modules, setModules] = useState(null);
  const [newModule, setNewModule] = useState('');

  const load = useCallback(() => {
    if (!course?.id) return;
    api.getModules(course.id).then((r) => setModules(r?.data ?? [])).catch(() => setModules([]));
  }, [course?.id, api]);
  useEffect(() => { if (open) { setModules(null); load(); } }, [open, load]);

  const addModule = async () => {
    const title = newModule.trim() || `Module ${(modules?.length ?? 0) + 1}`;
    try {
      await api.createModule(course.id, { title, orderIndex: modules?.length ?? 0 });
      setNewModule(''); load();
    } catch { onToast?.('Could not add module', 'error'); }
  };

  const totalTopics = (modules ?? []).reduce((n, m) => n + m.sessions.length, 0);

  return (
    <Modal open={open} onClose={onClose} title={course ? `${course.title} — Curriculum` : 'Curriculum'} width={640} asPage={asPage}>
      {modules === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 70, borderRadius: 12 }} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 12, color: C.muted, fontFamily: C.font }}>{modules.length} modules · {totalTopics} topics</span>

          {modules.map((m) => (
            <ModuleCard key={m.id} module={m} courseId={course.id} api={api} onChanged={load} onToast={onToast} />
          ))}

          {modules.length === 0 && (
            <div style={{ border: `1px dashed ${C.border}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.muted, fontSize: 13, fontFamily: C.font }}>
              No modules yet. Add the first one below.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <Inp value={newModule} onChange={(e) => setNewModule(e.target.value)} placeholder="New module name (e.g. Week 5)" style={{ flex: 1 }} />
            <Btn onClick={addModule}><Ico lucide={Plus} ti="ti-plus" size={14} /> Add module</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ── styles ──────────────────────────────────────────────────────────── */
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex', alignItems: 'center', padding: 2 };
const linkBtn = { background: 'none', border: 'none', cursor: 'pointer', color: C.brand, fontSize: 12, fontWeight: 700, fontFamily: C.font, display: 'flex', alignItems: 'center', gap: 4 };
const miniInp = { fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 6px', fontFamily: C.font, color: C.ink, boxSizing: 'border-box', width: '100%' };
const miniSel = { fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 4px', fontFamily: C.font };
