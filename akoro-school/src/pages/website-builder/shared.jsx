/**
 * Website Builder — shared constants & UI atoms (table styling, buttons,
 * toast, tab strip, status pill).
 */
import {
  Plus, Pencil, Trash2, RotateCcw, ArrowLeft, Save, Loader2, FileText, X,
  ChevronUp, ChevronDown, Link2, Menu as MenuIcon, Image as ImageIcon, UploadCloud,
  Sparkles, Type, LayoutGrid, Minus, Code, GripVertical,
} from 'lucide-react';
import { INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, AMBER, BLUE, PURPLE, RED, FONT } from '../../constants.js';

const BASE = '/api/school/mgmt';
const slugify = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const pill = (v, map) => {
  const c = map[v] || MUTED2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: `${c}15`, color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{String(v || '—').replace('_', ' ')}</span>;
};

/* ── Shared table styling & buttons ──────────────────────────────────────── */
const th = { textAlign: 'left', padding: '11px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .4 };
const td = { padding: '12px 14px', fontSize: 13, color: INK, borderTop: `1px solid ${BORDER}` };
const iconBtn = (color) => ({ width: 30, height: 30, borderRadius: 7, border: 'none', background: `${color}15`, color, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });
const Tabs = ({ tabs, tab, setTab }) => (
  <div style={{ display: 'inline-flex', background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 3, flexWrap: 'wrap' }}>
    {tabs.map((t) => (
      <button key={t.key} onClick={() => setTab(t.key)} style={{
        padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 800,
        background: tab === t.key ? WHITE : 'transparent', color: tab === t.key ? INK : MUTED2,
        boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,.12)' : 'none',
      }}>{t.label}</button>
    ))}
  </div>
);
const addBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
const backBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT };
const toastEl = (toast) => toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>;

/* ── Small icon button (block editor / toolbar) ──────────────────────────── */
const miniBtn = { width: 26, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: MUTED2, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };

export { BASE, slugify, pill, th, td, iconBtn, Tabs, addBtn, backBtn, toastEl, miniBtn };
