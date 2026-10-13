/**
 * AgentsPage — every AI agent on the platform, filterable by owner type
 * (student / instructor / school / admin). Reads GET /api/admin/agents.
 */
import { useState, useEffect, useCallback } from 'react';
import { Bot, Search, GraduationCap, Users, Building2, Shield } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Toast, Skeleton } from '../components/Primitives.jsx';
import { apiGet } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, FONT } from '../constants.js';

const TYPE_META = {
  student:    { label: 'Student',    color: BLUE,   Icon: Users },
  instructor: { label: 'Instructor', color: PURPLE, Icon: GraduationCap },
  school:     { label: 'School',     color: GREEN,  Icon: Building2 },
  admin:      { label: 'Admin',      color: AMBER,  Icon: Shield },
};

const FILTERS = [
  { key: 'all',        label: 'All' },
  { key: 'student',    label: 'Students' },
  { key: 'instructor', label: 'Instructors' },
  { key: 'school',     label: 'Schools' },
  { key: 'admin',      label: 'Admins' },
];

export default function AgentsPage() {
  const [rows, setRows]       = useState(null);
  const [counts, setCounts]   = useState({});
  const [filter, setFilter]   = useState('all');
  const [search, setSearch]   = useState('');
  const [toast, setToast]     = useState(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const params = new URLSearchParams({ type: filter, limit: '200' });
      if (search.trim()) params.set('search', search.trim());
      const r = await apiGet(`/api/admin/agents?${params}`);
      setRows(r?.data || []);
      if (r?.counts) setCounts(r.counts);
    } catch (e) {
      setRows([]);
      setToast({ message: e.message || 'Failed to load agents', type: 'error' });
      setTimeout(() => setToast(null), 3500);
    }
  }, [filter, search]);

  // Debounce search; refetch on filter change.
  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };
  const CHIP = (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
    fontFamily: FONT, fontSize: 12.5, fontWeight: active ? 700 : 500,
    background: active ? AMBER : WHITE, color: active ? WHITE : MUTED, transition: 'all .15s',
    boxShadow: active ? 'none' : `inset 0 0 0 1px ${BORDER}`,
  });

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const TypeBadge = ({ t }) => {
    const m = TYPE_META[t] || TYPE_META.student;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 20, background: `${m.color}18`, color: m.color }}>
        <m.Icon size={11} />{m.label}
      </span>
    );
  };

  return (
    <PageLayout title="Agents" subtitle="Every AI agent on the platform, by owner">
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        {/* Filters + search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FILTERS.map((f) => (
              <button key={f.key} style={CHIP(filter === f.key)} onClick={() => setFilter(f.key)}>
                {f.label}
                {counts[f.key] != null && <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.85 }}>{counts[f.key]}</span>}
              </button>
            ))}
          </div>
          <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 340, marginLeft: 'auto' }}>
            <Search size={15} color={MUTED} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agent or owner…"
              style={{ width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* Table */}
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', overflowX: 'auto' }}>
          {rows === null ? (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={46} />)}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead><tr style={{ background: LIGHT }}>
                <th style={TH}>Agent</th><th style={TH}>Owner</th><th style={TH}>Type</th><th style={TH}>XP</th><th style={TH}>Status</th><th style={TH}>Created</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none', padding: '40px 14px' }}>
                    <Bot size={30} style={{ opacity: 0.4, marginBottom: 8 }} /><div>No agents found.</div>
                  </td></tr>
                ) : rows.map((a) => (
                  <tr key={a.id}>
                    <td style={{ ...TD, fontWeight: 700 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ width: 30, height: 30, borderRadius: 8, background: `${a.color || AMBER}1F`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}><Bot size={16} color={a.color || AMBER} /></span>
                        {a.name || 'Unnamed agent'}
                      </span>
                    </td>
                    <td style={{ ...TD }}>
                      <div style={{ fontWeight: 600 }}>{a.owner?.name || '—'}</div>
                      <div style={{ fontSize: 11.5, color: MUTED2 }}>{a.owner?.email || ''}</div>
                    </td>
                    <td style={TD}><TypeBadge t={a.ownerType} /></td>
                    <td style={{ ...TD, color: MUTED, fontWeight: 600 }}>{(a.totalXp ?? 0).toLocaleString()}</td>
                    <td style={TD}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: a.isActive ? GREEN : MUTED2 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: a.isActive ? GREEN : MUTED2 }} />{a.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ ...TD, color: MUTED }}>{fmtDate(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
