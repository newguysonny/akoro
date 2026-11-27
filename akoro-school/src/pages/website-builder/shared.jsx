/**
 * Website Builder — shared constants & UI atoms (table styling, buttons,
 * toast, tab strip, status pill).
 */
import { GREEN, BLUE, PURPLE, RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';

const BASE = '/api/school/mgmt';
const slugify = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const pill = (v, map) => {
  const c = map[v] || C.muted2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: tint(8, c), color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{String(v || '—').replace('_', ' ')}</span>;
};

/* ── Shared table styling & buttons ──────────────────────────────────────── */
const th = { textAlign: 'left', padding: '11px 14px', fontSize: 10.5, fontWeight: 800, color: C.muted2, letterSpacing: .4 };
const td = { padding: '12px 14px', fontSize: 13, color: C.ink, borderTop: `1px solid ${C.border}` };
const iconBtn = (color) => ({ width: 30, height: 30, borderRadius: 7, border: 'none', background: tint(8, color), color, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });
const Tabs = ({ tabs, tab, setTab }) => (
  <div style={{ display: 'inline-flex', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 3, flexWrap: 'wrap' }}>
    {tabs.map((t) => (
      <button key={t.key} onClick={() => setTab(t.key)} style={{
        padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: C.font, fontSize: 12.5, fontWeight: 800,
        background: tab === t.key ? C.surface : 'transparent', color: tab === t.key ? C.ink : C.muted2,
        boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,.12)' : 'none',
      }}>{t.label}</button>
    ))}
  </div>
);
const addBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font };
const backBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: C.font };
const toastEl = (toast) => toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>;

/* ── Small icon button (block editor / toolbar) ──────────────────────────── */
const miniBtn = { width: 26, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: C.muted2, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };

export { BASE, slugify, pill, th, td, iconBtn, Tabs, addBtn, backBtn, toastEl, miniBtn };
