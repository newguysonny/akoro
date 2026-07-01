import { useState, useMemo } from 'react';
import {
  Search, ArrowRight, Clock, LayoutGrid, GraduationCap, BarChart3,
  Wrench, PieChart, FileText, UserCircle, Grid3x3, PenTool,
  ArrowLeftRight, AlertTriangle, TrendingUp,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, BLUE, PURPLE, FONT } from '../constants.js';

/* ── Categories ──────────────────────────────────────────────────── */
const CATEGORIES = [
  { key: 'all',       label: 'All',       icon: LayoutGrid },
  { key: 'academic',  label: 'Academic',  icon: GraduationCap },
  { key: 'insights',  label: 'Insights',  icon: BarChart3 },
  { key: 'utility',   label: 'Utility',   icon: Wrench },
  { key: 'analytics', label: 'Analytics', icon: PieChart },
];

const CAT_META = {
  academic:  { label: 'Academic',       color: GREEN },
  insights:  { label: 'Insights',       color: BLUE },
  utility:   { label: 'Utility',        color: AMBER },
  analytics: { label: 'Analytics',      color: PURPLE },
  data:      { label: 'data_analytics', color: BLUE },
};

/* ── Mock tools ──────────────────────────────────────────────────── */
const TOOLS = [
  { id: 1, name: 'Question Paper Generator', desc: 'Generate offline exam papers with Excel import, multi-section support, and print-ready PDFs.', category: 'academic', icon: FileText, iconBg: BLUE, badge: 'New', status: 'active' },
  { id: 2, name: 'Student 360 View', desc: 'Unified student profile — attendance, fees, marks, and notes in one page.', category: 'insights', icon: UserCircle, iconBg: GREEN, badge: 'New', status: 'active' },
  { id: 3, name: 'Seating Arrangement Generator', desc: 'Auto-generate exam hall seating with class interleaving and hall tickets.', category: 'utility', icon: Grid3x3, iconBg: AMBER, badge: 'New', status: 'active' },
  { id: 4, name: 'Financial Analytics & Reports', desc: 'Advanced P&L, Cash Flow summaries, and Tally exports.', category: 'data', icon: PieChart, iconBg: INK, badge: 'New', status: 'active' },
  { id: 5, name: 'Digital Whiteboard', desc: 'Create, save, and share digital whiteboards for teaching and planning using Excalidraw.', category: 'academic', icon: PenTool, iconBg: INK, badge: 'New', status: 'active' },
  { id: 6, name: 'At-Risk Student Detector', desc: 'Flag students at academic risk using attendance and marks trends.', category: 'insights', icon: AlertTriangle, iconBg: GREEN, badge: null, status: 'soon' },
  { id: 7, name: 'Data Import/Export Utility', desc: 'Bulk import students via Excel and export class data for any module.', category: 'utility', icon: ArrowLeftRight, iconBg: INK, badge: null, status: 'soon' },
  { id: 8, name: 'Result Analysis Tool', desc: 'Subject-wise averages, pass/fail counts, mark distribution, and rank lists.', category: 'analytics', icon: TrendingUp, iconBg: BLUE, badge: null, status: 'soon' },
];

/* ── Bits ────────────────────────────────────────────────────────── */
function CategoryBadge({ category }) {
  const m = CAT_META[category] || { label: category, color: MUTED };
  const Icon = category === 'analytics' || category === 'data' || category === 'insights' ? BarChart3
    : category === 'utility' ? Wrench : GraduationCap;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: `${m.color}15`, color: m.color, fontSize: 11.5, fontWeight: 700, fontFamily: FONT }}>
      <Icon size={12} /> {m.label}
    </span>
  );
}

function ToolCard({ tool }) {
  const soon = tool.status === 'soon';
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16,
        padding: '28px 24px 20px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', textAlign: 'center', fontFamily: FONT,
        boxShadow: hover ? '0 10px 30px rgba(26,26,46,.10)' : '0 1px 3px rgba(26,26,46,.04)',
        transform: hover ? 'translateY(-3px)' : 'none', transition: 'all .18s',
      }}
    >
      {/* Icon */}
      <div style={{
        width: 64, height: 64, borderRadius: 16, background: tool.iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 16, boxShadow: `0 6px 16px ${tool.iconBg}44`,
      }}>
        <tool.icon size={30} color={WHITE} strokeWidth={2} />
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 700, color: INK, margin: '0 0 8px' }}>{tool.name}</h3>
      <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, margin: '0 0 16px', minHeight: 40 }}>{tool.desc}</p>

      {/* Meta row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 16, gap: 8 }}>
        <CategoryBadge category={tool.category} />
        {tool.badge && (
          <span style={{ padding: '4px 10px', borderRadius: 999, background: '#FEE2E2', color: '#DC2626', fontSize: 11, fontWeight: 800, letterSpacing: .3 }}>{tool.badge}</span>
        )}
        {soon && !tool.badge && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 999, background: '#F1F0EE', color: MUTED2, fontSize: 11, fontWeight: 700 }}>
            <Clock size={11} /> Coming Soon
          </span>
        )}
      </div>

      {/* CTA */}
      {soon ? (
        <button disabled style={{
          width: '100%', padding: '11px', borderRadius: 10, border: 'none',
          background: '#F1F0EE', color: MUTED2, fontSize: 13.5, fontWeight: 700,
          fontFamily: FONT, cursor: 'not-allowed', display: 'flex',
          alignItems: 'center', justifyContent: 'center', gap: 7,
        }}>
          <Clock size={15} /> Coming Soon
        </button>
      ) : (
        <button style={{
          width: '100%', padding: '11px', borderRadius: 10, border: 'none',
          background: BLUE, color: WHITE, fontSize: 13.5, fontWeight: 700,
          fontFamily: FONT, cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', gap: 7,
        }}>
          <ArrowRight size={15} /> Open Tool
        </button>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */
export default function AppsCenterPage() {
  const [cat, setCat]     = useState('all');
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => TOOLS.filter((t) => {
    const catOk = cat === 'all' || t.category === cat || (cat === 'analytics' && t.category === 'data');
    const qOk = !q || t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q);
    return catOk && qOk;
  }), [cat, q]);

  const active = TOOLS.filter((t) => t.status === 'active').length;
  const soon   = TOOLS.filter((t) => t.status === 'soon').length;
  const total  = TOOLS.length;

  return (
    <PageLayout title="Apps Center" subtitle="Specialized tools for your school">
      {/* Hero */}
      <div style={{
        background: `linear-gradient(120deg, ${INK} 0%, #23233f 100%)`,
        borderRadius: 18, padding: '26px 28px', marginBottom: 22,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 20, fontFamily: FONT,
      }}>
        <div style={{ maxWidth: 460 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <LayoutGrid size={20} color={AMBER} />
            <h2 style={{ fontSize: 21, fontWeight: 800, color: WHITE, margin: 0 }}>Power Tools for Your School</h2>
          </div>
          <p style={{ fontSize: 13.5, color: 'rgba(255,255,255,.7)', margin: 0, lineHeight: 1.6 }}>
            Extend your school management system with specialized tools — generate exam papers, analyze student performance, and automate workflows.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { n: active, l: 'ACTIVE',      c: GREEN },
            { n: soon,   l: 'COMING SOON', c: AMBER },
            { n: total,  l: 'TOTAL',       c: WHITE },
          ].map((s) => (
            <div key={s.l} style={{
              background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
              borderRadius: 12, padding: '12px 18px', textAlign: 'center', minWidth: 74,
            }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.c }}>{s.n}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,.55)' }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Search + filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
        <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
          <Search size={16} color={MUTED2} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools by name or description…"
            style={{
              width: '100%', padding: '11px 14px 11px 40px', borderRadius: 12,
              border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13.5,
              fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CATEGORIES.map((c) => {
            const on = cat === c.key;
            return (
              <button key={c.key} onClick={() => setCat(c.key)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px',
                borderRadius: 999, border: `1.5px solid ${on ? BLUE : BORDER}`, cursor: 'pointer',
                background: on ? BLUE : WHITE, color: on ? WHITE : MUTED,
                fontSize: 13, fontWeight: 700, fontFamily: FONT, transition: 'all .15s',
              }}>
                <c.icon size={14} /> {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: MUTED2, fontFamily: FONT, fontSize: 14 }}>
          No tools match your search.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
          {filtered.map((t) => <ToolCard key={t.id} tool={t} />)}
        </div>
      )}
    </PageLayout>
  );
}
