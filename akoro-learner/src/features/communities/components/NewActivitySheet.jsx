import { useState } from 'react';
import { Icon } from '../../../components/common/Icons.jsx';
import { BRAND, RED } from '../../../constants.js';
import Spinner from '../../../components/common/Spinner.jsx';
import { useInFlight } from '../../../hooks/useInFlight.js';
import { createCommunityActivity } from '../../../services/communityApi.js';
import { ACTIVITY_TYPES, STAGE_KINDS, FIELD } from './communityActivityMeta.js';

export default function NewActivitySheet({ community, onClose, onCreated }) {
  const [name, setName]         = useState('');
  const [subject, setSubject]   = useState('');
  const [klass, setKlass]       = useState('');
  const [due, setDue]           = useState('');
  const [instructions, setInstructions] = useState('');
  const [type, setType]         = useState('assignment');
  const [stages, setStages]     = useState([]);
  // One request at a time — repeated taps on a bad connection once fired
  // repeated POSTs and created duplicate activities.
  const { busy: saving, run: runSave } = useInFlight();
  const [err, setErr]           = useState('');

  const create = () => runSave(async () => {
    if (!name.trim()) return;
    const cleanStages = stages
      .map((s) => ({ kind: STAGE_KINDS.some((k) => k.key === s.kind) ? s.kind : 'self_study', title: String(s.title || '').trim() }))
      .filter((s) => s.title);
    if (type === 'multi_stage' && !cleanStages.length) {
      setErr('Add at least one stage with a title.');
      return;
    }
    setErr('');
    try {
      const a = await createCommunityActivity(community.id, {
        name: name.trim(),
        type,
        stages: type === 'multi_stage' ? cleanStages : undefined,
        subject: subject.trim() || undefined,
        class: klass.trim() || undefined,
        dueAt: due ? new Date(due).toISOString() : undefined,
        instructions: instructions.trim() || undefined,
      });
      onCreated(a);
    } catch (e) {
      setErr(e?.message || 'Something went wrong. Try again.');
    }
  });

  return (
    <div className="ak-sheet-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'var(--ak-overlay)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div className="ak-sheet-panel" onClick={(e) => e.stopPropagation()} style={{ background: 'var(--ak-surface)', width: '100%', maxWidth: 540, maxHeight: '88vh', overflowY: 'auto', borderRadius: '22px 22px 0 0', fontFamily: "'Nunito',sans-serif", animation: 'sheet-up .28s cubic-bezier(.34,1.4,.6,1)' }}>
        <style>{`
          @keyframes sheet-up{from{transform:translateY(40px);opacity:.4}to{transform:translateY(0);opacity:1}}
          .ak-cm-field:focus{outline:2px solid ${BRAND};outline-offset:1px}
        `}</style>
        <div style={{ padding: '10px 0 4px', display: 'flex', justifyContent: 'center', position: 'sticky', top: 0, background: 'var(--ak-surface)', zIndex: 1 }}>
          <div style={{ width: 38, height: 4, borderRadius: 4, background: 'var(--ak-border2)' }} />
        </div>
        <div style={{ padding: '6px 18px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 14px' }}>
            <h2 style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>New activity</h2>
            <button onClick={onClose} aria-label="Close" style={{ background: `${BRAND}14`, border: 'none', borderRadius: 'var(--r-full)', width: 30, height: 30, cursor: 'pointer', color: 'var(--ak-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="ti-x" size={16}/>
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {ACTIVITY_TYPES.map((t) => {
              const active = type === t.key;
              return (
                <button key={t.key} type="button" onClick={() => { setType(t.key); setErr(''); }}
                  style={{ padding: '7px 12px', borderRadius: 'var(--r-full)', border: `1px solid ${active ? BRAND : 'var(--ak-border2)'}`, background: active ? `${BRAND}10` : 'var(--ak-surface)', color: active ? BRAND : 'var(--ak-text-sub)', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon name={t.icon} size={14}/>{t.name}
                </button>
              );
            })}
          </div>
          <input value={name} onChange={e => { setName(e.target.value); setErr(''); }} placeholder="Activity name" maxLength={120} autoFocus className="ak-cm-field" style={{ ...FIELD, marginBottom: 10 }}/>
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" maxLength={80} className="ak-cm-field" style={{ ...FIELD, flex: 1.2 }}/>
            <input value={klass} onChange={e => setKlass(e.target.value)} placeholder="Class (e.g. CSC 201)" maxLength={80} className="ak-cm-field" style={{ ...FIELD, flex: 1 }}/>
          </div>
          <div style={{ height: 10 }}/>
          <input value={due} onChange={e => setDue(e.target.value)} type="datetime-local" className="ak-cm-field" style={{ ...FIELD, marginBottom: 10 }}/>
          <textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Instructions (optional)" maxLength={2000} rows={3} className="ak-cm-field" style={{ ...FIELD, resize: 'none', marginBottom: 10 }}/>
          {type === 'multi_stage' && (
            <div style={{ marginBottom: 10 }}>
              {stages.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select value={s.kind} onChange={e => setStages(stages.map((x, xi) => xi === i ? { ...x, kind: e.target.value } : x))} className="ak-cm-field" style={{ ...FIELD, flex: '0 0 128px' }}>
                    {STAGE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.emoji} {k.name}</option>)}
                  </select>
                  <input value={s.title} onChange={e => setStages(stages.map((x, xi) => xi === i ? { ...x, title: e.target.value } : x))} placeholder={`Stage ${i + 1} title`} maxLength={120} className="ak-cm-field" style={{ ...FIELD, flex: 1 }}/>
                  <button type="button" onClick={() => setStages(stages.filter((_, xi) => xi !== i))} title="Remove stage"
                    style={{ width: 34, borderRadius: 'var(--r-md)', border: '1px solid var(--ak-border2)', background: 'transparent', color: 'var(--ak-text-muted)', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="ti-x" size={14}/>
                  </button>
                </div>
              ))}
              {stages.length < 6 && (
                <button type="button" onClick={() => setStages([...stages, { kind: 'self_study', title: '' }])}
                  style={{ width: '100%', padding: '10px', borderRadius: 'var(--r-md)', border: `1.5px dashed ${BRAND}`, background: `${BRAND}08`, color: BRAND, fontSize: 12, fontWeight: 900, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Icon name="ti-plus" size={14}/> Add stage {stages.length + 1} of 6
                </button>
              )}
            </div>
          )}
          {err && <div style={{ fontSize: 12, fontWeight: 700, color: RED, marginBottom: 10 }}>{err}</div>}

          <button onClick={create} disabled={!name.trim() || saving}
            style={{ width: '100%', padding: '13px', borderRadius: 'var(--r-full)', cursor: (!name.trim() || saving) ? 'default' : 'pointer', border: 'none', background: (!name.trim() || saving) ? '#C9BCF7' : BRAND, color: '#fff', fontSize: 14, fontWeight: 900, fontFamily: "'Nunito',sans-serif" }}>
            {saving ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Spinner size={13}/> Posting…</span> : 'Post activity'}
          </button>
        </div>
      </div>
    </div>
  );
}
