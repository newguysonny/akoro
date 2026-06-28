import { useState, useEffect, useMemo } from 'react';
import { PageLayout } from '../components/Layout.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, GREEN, RED, FONT } from '../constants.js';

const BRAND = AMBER;
const FONTF = FONT;

/* ─── Catalog data ────────────────────────────────────────────────
   Default description + suggested price (₦) per item. The instructor
   can edit the price/description and toggle availability — overrides
   are persisted per-user in localStorage. */
const TOOLS = [
  { id: 'lesson-plan',    emoji: '📝', name: 'Lesson Plan Template Fill',  price: 1500, desc: 'Auto-fill a structured lesson plan from your topic, objectives and year group.' },
  { id: 'worksheets',     emoji: '📄', name: 'Worksheets Template Fill',   price: 1200, desc: 'Generate ready-to-print worksheets with questions tailored to your class level.' },
  { id: 'report-writing', emoji: '🗒️', name: 'Report Writing Template Fill', price: 1500, desc: 'Draft end-of-term student reports and comments from performance notes.' },
  { id: 'grading',        emoji: '✅', name: 'Grading',                    price: 2000, desc: 'Mark submissions against a rubric and return scores with feedback in seconds.' },
  { id: 'attendance',     emoji: '🎙️', name: 'Attendance / Roll Call',     price: 1000, desc: 'Voice agent takes the register hands-free and logs attendance automatically.', tag: 'Voice agent' },
  { id: 'interactive',    emoji: '🎬', name: 'Interactive Material',       price: 2500, desc: 'Turn any lesson into interactive slides and activities (powered by Gamma.app).', tag: 'Gamma.app' },
  { id: 'exam-prep',      emoji: '🎯', name: 'Exam Prep Assessment',       price: 2500, desc: 'Build a proctored exam-prep assessment and track each student\'s readiness.' },
];

const ASSETS = [
  { id: 'jamb-pq',  emoji: '📚', name: 'JAMB Past Questions & Answers',  price: 2000, desc: 'Complete JAMB past questions with worked answers across all subjects.' },
  { id: 'neco-pq',  emoji: '📚', name: 'NECO Past Questions & Answers',  price: 2000, desc: 'NECO past questions and answers, organised by subject and year.' },
  { id: 'waec-pq',  emoji: '📚', name: 'WAEC Past Questions & Answers',  price: 2000, desc: 'WAEC past questions and answers, organised by subject and year.' },
  { id: 'bece-pq',  emoji: '📒', name: 'BECE Past Questions & Answers',  price: 1500, desc: 'Basic Education Certificate Exam past questions with answers.' },
  { id: 'gce-pq',   emoji: '📒', name: 'GCE Past Questions & Answers',   price: 1800, desc: 'GCE past questions and answers across core subjects.' },
  { id: 'putme-pq', emoji: '📒', name: 'Post-UTME Past Questions',       price: 1800, desc: 'Post-UTME screening past questions and answers by institution.' },
  { id: 'nabteb-pq',emoji: '📒', name: 'NABTEB Past Questions & Answers', price: 1500, desc: 'NABTEB past questions and answers for technical & business subjects.' },
  { id: 'waec-syl', emoji: '📑', name: 'WAEC Syllabus',                  price: 1000, desc: 'Full WAEC syllabus and scheme of work for all subjects.' },
  { id: 'jamb-syl', emoji: '📑', name: 'JAMB Syllabus',                  price: 1000, desc: 'Official JAMB syllabus and recommended texts by subject.' },
  { id: 'neco-syl', emoji: '📑', name: 'NECO Syllabus',                  price: 1000, desc: 'Full NECO syllabus and scheme of work for all subjects.' },
  { id: 'bece-syl', emoji: '📑', name: 'BECE Syllabus',                  price: 800,  desc: 'Basic Education Certificate Exam syllabus and topic breakdown.' },
];

const STORAGE_KEY = (uid) => `akoro_instructor_catalog_${uid || 'me'}`;
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;

/* ─── Bottom sheet (shared pattern) ───────────────────────────────── */
function Sheet({ children, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 3100, background: '#fff', borderRadius: '22px 22px 0 0', padding: '0 18px 40px', boxShadow: '0 -8px 40px rgba(0,0,0,.12)', animation: 'sheet-up .3s ease', fontFamily: FONTF, maxHeight: '88vh', overflowY: 'auto', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#D1D5DB', margin: '14px auto 18px' }} />
        {children}
      </div>
    </>
  );
}

/* ─── Edit item sheet (price + description) ───────────────────────── */
function EditItemSheet({ item, onClose, onSave }) {
  const [price, setPrice] = useState(String(item.price ?? 0));
  const [desc, setDesc]   = useState(item.desc || '');
  const inp = { width: '100%', padding: '11px 14px', borderRadius: 12, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 14, fontFamily: FONTF, color: INK, boxSizing: 'border-box', marginTop: 6 };
  return (
    <Sheet onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 26 }}>{item.emoji}</span>
        <p style={{ fontSize: 16, fontWeight: 900, color: INK, margin: 0 }}>{item.name}</p>
      </div>
      <label style={{ fontSize: 12, fontWeight: 800, color: '#374151' }}>Price (₦) — set 0 for free</label>
      <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} style={inp} />
      <label style={{ fontSize: 12, fontWeight: 800, color: '#374151', display: 'block', marginTop: 14 }}>Description</label>
      <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={onClose} style={{ flex: 1, padding: '13px', borderRadius: 14, border: `1.5px solid ${BORDER}`, background: LIGHT, fontSize: 13, fontWeight: 800, color: MUTED, cursor: 'pointer', fontFamily: FONTF }}>Cancel</button>
        <button onClick={() => onSave({ price: Math.max(0, Math.round(Number(price) || 0)), desc: desc.trim() })} style={{ flex: 1.5, padding: '13px', borderRadius: 14, border: 'none', background: `linear-gradient(135deg,${BRAND},#D4651E)`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONTF }}>Save Changes</button>
      </div>
    </Sheet>
  );
}

/* ─── Item card ───────────────────────────────────────────────────── */
function ItemCard({ item, available, onToggle, onEdit }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, border: `1px solid ${BORDER}`, boxShadow: '0 1px 4px rgba(0,0,0,.05)', padding: '14px 16px', display: 'flex', gap: 13, alignItems: 'flex-start' }}>
      <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, background: `${BRAND}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{item.emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: INK, margin: 0 }}>{item.name}</p>
          {item.tag && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: `${BRAND}12`, color: BRAND }}>{item.tag}</span>}
        </div>
        <p style={{ fontSize: 12.5, color: MUTED, margin: '5px 0 10px', lineHeight: 1.55 }}>{item.desc}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 900, color: item.price === 0 ? GREEN : INK }}>{item.price === 0 ? 'Free' : naira(item.price)}</span>
          <button onClick={onEdit} style={{ fontSize: 12, fontWeight: 800, color: BRAND, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONTF, padding: 0 }}>Edit</button>
        </div>
      </div>
      {/* Availability toggle */}
      <div onClick={onToggle} title={available ? 'Listed — tap to unlist' : 'Unlisted — tap to list'}
        style={{ width: 42, height: 23, borderRadius: 12, position: 'relative', background: available ? BRAND : '#E5E7EB', transition: 'background .25s', cursor: 'pointer', flexShrink: 0, marginTop: 2 }}>
        <div style={{ position: 'absolute', top: 2.5, left: available ? 21 : 2.5, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .25s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
      </div>
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────────── */
export default function MarketplacePage() {
  const { user } = useAuth();
  const [tab, setTab]       = useState('tools');
  const [overrides, setOv]  = useState({});   // id → { price, desc, available }
  const [editing, setEditing] = useState(null);
  const [toast, setToast]   = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2200); };

  /* Load saved overrides */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY(user?.id));
      if (raw) setOv(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [user?.id]);

  const persist = (next) => {
    setOv(next);
    try { localStorage.setItem(STORAGE_KEY(user?.id), JSON.stringify(next)); } catch { /* ignore */ }
  };

  /* Merge catalog defaults with per-item overrides */
  const merge = (list) => list.map((it) => {
    const o = overrides[it.id] || {};
    return {
      ...it,
      price:     o.price !== undefined ? o.price : it.price,
      desc:      o.desc  !== undefined ? o.desc  : it.desc,
      available: o.available !== undefined ? o.available : true,
    };
  });

  const tools  = useMemo(() => merge(TOOLS),  [overrides]);
  const assets = useMemo(() => merge(ASSETS), [overrides]);
  const items  = tab === 'tools' ? tools : assets;

  const toggle = (id) => {
    const cur = overrides[id] || {};
    const nextAvail = !(cur.available !== undefined ? cur.available : true);
    persist({ ...overrides, [id]: { ...cur, available: nextAvail } });
    showToast(nextAvail ? 'Listed ✓' : 'Unlisted');
  };

  const saveEdit = (id, patch) => {
    persist({ ...overrides, [id]: { ...(overrides[id] || {}), ...patch } });
    setEditing(null);
    showToast('Saved ✓');
  };

  const liveCount = items.filter((i) => i.available).length;

  return (
    <PageLayout title="Marketplace" subtitle="List your tools & assets for sale">
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', background: '#fff', borderRadius: 12, padding: 4, marginBottom: 18, border: `1px solid ${BORDER}`, gap: 4 }}>
          {[['tools', `🛠️ Tools (${TOOLS.length})`], ['assets', `📚 Assets (${ASSETS.length})`]].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '9px 0', borderRadius: 9, border: 'none',
              background: tab === t ? BRAND : 'transparent',
              color: tab === t ? '#fff' : MUTED2,
              fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONTF, transition: 'all .2s',
            }}>{label}</button>
          ))}
        </div>

        {/* Summary strip */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, padding: '0 2px' }}>
          <p style={{ fontSize: 11, fontWeight: 900, color: BRAND, letterSpacing: 1.5, textTransform: 'uppercase', margin: 0 }}>
            {tab === 'tools' ? 'Teaching Tools' : 'Exam Resources'}
          </p>
          <span style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>{liveCount} of {items.length} listed</span>
        </div>

        {/* List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              available={item.available}
              onToggle={() => toggle(item.id)}
              onEdit={() => setEditing(item)}
            />
          ))}
        </div>
      </div>

      {editing && (
        <EditItemSheet
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => saveEdit(editing.id, patch)}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
