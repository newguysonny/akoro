/**
 * DashboardPage — bachs-style components.
 * Visual language: Inter, primary #4A5CD5, hairline #E8E8EE borders,
 * 10px card radius, 20px/600 page headers. Data-absent metrics render N/A.
 */
import { useState, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { Skeleton } from '../../components/Primitives.jsx';

/* bachs tokens (local — do not touch global constants until section-by-section rollout) */
export const BX = {
  primary: '#4A5CD5',
  primaryDark: '#3E4FC4',
  ink: '#1A1B25',
  muted: '#6B7280',
  line: '#E8E8EE',
  sideBg: '#F7F7F9',
  white: '#FFFFFF',
  red: '#DC2626',
  green: '#0E9F6E',
  amber: '#D97706',
  purple: '#7C3AED',
  blue: '#3B82F6',
  font: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const CARD = {
  background: BX.white,
  border: `1px solid ${BX.line}`,
  borderRadius: 10,
  padding: '18px 20px',
  fontFamily: BX.font,
};

const H2 = { fontSize: 14, fontWeight: 600, color: BX.ink, margin: 0, fontFamily: BX.font };

/* ---------- Metric card ---------- */
export function MetricCard({ label, value, delta, loading }) {
  if (loading) return (
    <div style={CARD}>
      <Skeleton height={12} width={90} style={{ marginBottom: 10 }} />
      <Skeleton height={30} width={70} style={{ marginBottom: 6 }} />
      <Skeleton height={11} width={110} />
    </div>
  );
  return (
    <div style={CARD}>
      <div style={{ fontSize: 12, color: BX.muted, fontWeight: 500, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, color: BX.ink, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11.5, marginTop: 5, color: BX.muted, fontWeight: 500 }}>{delta}</div>
    </div>
  );
}

/* ---------- Review queue banner ---------- */
export function ReviewBanner({ onReview, onRemind }) {
  return (
    <div style={{
      background: 'linear-gradient(115deg, #7C5CFF 0%, #A855F7 38%, #EC4899 68%, #F2994A 105%)',
      borderRadius: 14, padding: '22px 24px', color: '#fff', marginBottom: 16, fontFamily: BX.font,
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Items need your review</div>
      <p style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.93, margin: '0 0 14px', maxWidth: 520 }}>
        Course approvals, payouts and flagged accounts are waiting. Clear them in one place.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={onReview} style={{
          background: '#fff', color: BX.ink, border: 'none', borderRadius: 999,
          padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: BX.font,
        }}>Review queue ›</button>
        <button onClick={onRemind} style={{
          background: 'rgba(255,255,255,.18)', color: '#fff', border: '1px solid rgba(255,255,255,.45)',
          borderRadius: 999, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: BX.font,
        }}>Remind me later</button>
      </div>
    </div>
  );
}

/* ---------- Time-range pills ---------- */
const RANGES = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '14d', label: '14d' },
  { key: '30d', label: '30d' },
];

export function RangePills({ value, onChange }) {
  return (
    <div style={{
      display: 'inline-flex', gap: 2, background: BX.white,
      border: `1px solid ${BX.line}`, borderRadius: 999, padding: 3, fontFamily: BX.font,
    }}>
      {RANGES.map(r => (
        <button key={r.key} onClick={() => onChange(r.key)} style={{
          border: 'none', background: value === r.key ? BX.sideBg : 'none',
          boxShadow: value === r.key ? `inset 0 0 0 1px ${BX.line}` : 'none',
          fontFamily: BX.font, fontSize: 12, fontWeight: value === r.key ? 600 : 500,
          color: value === r.key ? BX.ink : BX.muted,
          padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
        }}>{r.label}</button>
      ))}
    </div>
  );
}

export const RANGE_LABELS = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '14d': 'Last 14 days', '30d': 'Last 30 days' };
export const RANGE_DAYS = { '24h': 1, '7d': 7, '14d': 14, '30d': 30 };

/* ---------- Logins card (number + range + chart) ---------- */
export function LoginsCard({ data, loading, range }) {
  const days = RANGE_DAYS[range] || 7;
  const sliced = (data || []).slice(-days);
  const total = sliced.reduce((s, d) => s + (d.count || d.logins || 0), 0);

  if (loading) return (
    <div style={{ ...CARD, marginBottom: 16 }}>
      <Skeleton height={12} width={60} style={{ marginBottom: 8 }} />
      <Skeleton height={32} width={90} style={{ marginBottom: 12 }} />
      <Skeleton height={150} style={{ borderRadius: 8 }} />
    </div>
  );

  return (
    <div style={{ ...CARD, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 12, color: BX.muted, fontWeight: 500 }}>Logins</div>
          <div style={{ fontSize: 28, fontWeight: 600, color: BX.ink, letterSpacing: '-0.02em' }}>
            {total.toLocaleString()}
          </div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: BX.muted }}>
          {RANGE_LABELS[range]} <ChevronDown size={12} />
        </span>
      </div>
      <LoginTrendsChart data={sliced} loading={false} />
      {sliced.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: BX.muted, marginTop: 6 }}>
          <span>{fmtAxis(sliced[0])}</span>
          <span>{fmtAxis(sliced[sliced.length - 1])}</span>
        </div>
      )}
    </div>
  );
}

function fmtAxis(d) {
  const raw = d?.date || d?.day || '';
  if (!raw) return '';
  const dt = new Date(raw);
  if (isNaN(dt)) return raw.slice(5);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* ---------- Login trends chart (indigo) ---------- */
export function LoginTrendsChart({ data, loading }) {
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);

  if (loading) return <Skeleton height={160} style={{ borderRadius: 8 }} />;
  if (!data || data.length === 0) return (
    <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: BX.muted, fontSize: 13, fontFamily: BX.font }}>
      No login trend data available
    </div>
  );

  const W = 600, H = 140, PAD = 8;
  const maxVal = Math.max(...data.map(d => d.count || d.logins || 0), 1);
  const pts = data.map((d, i) => ({
    x: PAD + (i / Math.max(data.length - 1, 1)) * (W - PAD * 2),
    y: H - PAD - ((d.count || d.logins || 0) / maxVal) * (H - PAD * 2),
    d,
  }));
  const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `M${pts[0].x},${H - PAD} ` + pts.map(p => `L${p.x},${p.y}`).join(' ') + ` L${pts[pts.length - 1].x},${H - PAD} Z`;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 150, display: 'block' }}
        onMouseLeave={() => setTooltip(null)}>
        <defs>
          <linearGradient id="bxLoginGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BX.primary} stopOpacity="0.22" />
            <stop offset="100%" stopColor={BX.primary} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[40, 80, 120].map(y => <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="#F1F1F5" strokeWidth="1" />)}
        <path d={area} fill="url(#bxLoginGrad)" />
        <polyline points={line} fill="none" stroke={BX.primary} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.length > 1 && (
          <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="4" fill={BX.primary} stroke="#fff" strokeWidth="2" />
        )}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={10} fill="transparent" style={{ cursor: 'pointer' }}
            onMouseEnter={(e) => {
              const rect = svgRef.current?.getBoundingClientRect();
              setTooltip({
                label: p.d.date || p.d.day || '',
                value: p.d.count || p.d.logins || 0,
                x: rect ? (p.x / W) * rect.width + rect.left : e.clientX,
                y: rect ? (p.y / H) * rect.height + rect.top : e.clientY,
              });
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}
      </svg>
      {tooltip && (
        <div style={{
          position: 'fixed', top: tooltip.y, left: tooltip.x, zIndex: 999,
          background: BX.ink, color: '#fff', padding: '6px 10px', borderRadius: 8,
          fontSize: 12, fontFamily: BX.font, pointerEvents: 'none',
          transform: 'translate(-50%, -110%)', whiteSpace: 'nowrap',
        }}>
          <div style={{ fontWeight: 700 }}>{tooltip.label}</div>
          <div>{Number(tooltip.value).toLocaleString()} logins</div>
        </div>
      )}
    </div>
  );
}

/* ---------- Balance + payment breakdown ---------- */
export function BalanceCard() {
  return (
    <div style={{ ...CARD, marginBottom: 0 }}>
      <div style={{ fontSize: 12, color: BX.muted, fontWeight: 500 }}>Akoro Balance</div>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: '2px 0', color: BX.ink }}>N/A</div>
      <div style={{ height: 6, borderRadius: 3, background: '#F1F1F5', margin: '14px 0 10px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: '0%', background: BX.primary, borderRadius: 3 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11.5, color: BX.muted }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <i style={{ width: 7, height: 7, borderRadius: '50%', background: BX.primary }} />Available
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <i style={{ width: 7, height: 7, borderRadius: '50%', background: '#D8D8E0' }} />Pending
        </span>
        <span style={{ marginLeft: 'auto', fontWeight: 600, color: BX.ink }}>N/A available</span>
      </div>
    </div>
  );
}

const BREAKDOWN = [
  { label: 'Succeeded', color: '#0E9F6E' },
  { label: 'Pending', color: '#D97706' },
  { label: 'Refunded', color: '#4A5CD5' },
  { label: 'Failed', color: '#DC2626' },
];

export function PaymentBreakdown() {
  return (
    <div style={{ ...CARD, marginBottom: 0 }}>
      <h2 style={{ ...H2, marginBottom: 4 }}>Payment breakdown</h2>
      {BREAKDOWN.map((b, i) => (
        <div key={b.label} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
          borderBottom: i < BREAKDOWN.length - 1 ? '1px solid #F5F5F8' : 'none',
          fontSize: 12.5, color: BX.ink,
        }}>
          <i style={{ width: 8, height: 8, borderRadius: '50%', background: b.color, flexShrink: 0 }} />
          {b.label}
          <b style={{ marginLeft: 'auto', fontWeight: 600, color: BX.muted }}>N/A</b>
        </div>
      ))}
    </div>
  );
}

/* ---------- Role pill (bachs) ---------- */
export function RolePill({ role }) {
  const map = {
    student:    { bg: '#EEF0FE', color: BX.primary },
    learner:    { bg: '#EEF0FE', color: BX.primary },
    instructor: { bg: '#E9F7F0', color: BX.green },
    admin:      { bg: '#FDECEC', color: BX.red },
    school:     { bg: '#FFF4E0', color: BX.amber },
  };
  const key = (role || '').toLowerCase().replace(/[^a-z]/g, '');
  const cfg = map[key] || map.student;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: cfg.bg, color: cfg.color, fontFamily: BX.font, whiteSpace: 'nowrap',
    }}>
      <i style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
      {role || '—'}
    </span>
  );
}

/* ---------- Newest users (tabs: All / Learners / Instructors / Schools) ---------- */
const USER_TABS = ['All', 'Learners', 'Instructors', 'Schools'];

function userMatchesTab(u, tab) {
  if (tab === 'All') return true;
  const r = (u.role || '').toLowerCase();
  if (tab === 'Learners') return r.includes('learn') || r.includes('student');
  if (tab === 'Instructors') return r.includes('instruct');
  if (tab === 'Schools') return r.includes('school');
  return true;
}

export function NewestUsers({ users, loading }) {
  const [tab, setTab] = useState('All');
  const rows = (users || []).filter(u => userMatchesTab(u, tab));
  const TH = { fontSize: 10.5, fontWeight: 600, color: BX.muted, textTransform: 'uppercase', letterSpacing: '.04em', padding: '10px 14px', textAlign: 'left', fontFamily: BX.font };
  const TD = { fontSize: 13, color: BX.ink, padding: '12px 14px', fontFamily: BX.font, borderBottom: '1px solid #F5F5F8', verticalAlign: 'middle' };

  return (
    <div style={{ ...CARD, marginBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={H2}>Newest users</h2>
        <div style={{ display: 'flex', gap: 2, background: BX.sideBg, borderRadius: 8, padding: 3, maxWidth: '100%', overflowX: 'auto' }}>
          {USER_TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              border: 'none', background: tab === t ? '#fff' : 'none', fontFamily: BX.font,
              fontSize: 12, fontWeight: tab === t ? 600 : 500, color: tab === t ? BX.ink : BX.muted,
              padding: '6px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
              boxShadow: tab === t ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
            }}>{t}</button>
          ))}
        </div>
      </div>
      <div style={{ overflowX: 'auto', margin: '0 -20px', padding: '0 20px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' }}>
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} height={40} />)}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={TH}>Name</th><th style={TH}>Email</th><th style={TH}>Role</th><th style={TH}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} style={{ ...TD, textAlign: 'center', color: BX.muted }}>No users found</td></tr>
              ) : rows.map(u => {
                const name = u.full_name || u.fullName || u.username || '—';
                return (
                  <tr key={u.id || u.email}>
                    <td style={TD}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                          background: `${BX.primary}14`, color: BX.primary,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700,
                        }}>{name[0].toUpperCase()}</div>
                        <span style={{ fontWeight: 600 }}>{name}</span>
                      </div>
                    </td>
                    <td style={{ ...TD, color: BX.muted }}>{u.email || '—'}</td>
                    <td style={TD}><RolePill role={u.role} /></td>
                    <td style={{ ...TD, color: BX.muted }}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ---------- Recent blog posts ---------- */
export function BlogPosts({ posts, loading }) {
  const pill = (status) => {
    if (status === 'published') return { bg: '#E9F7F0', color: BX.green };
    if (status === 'archived') return { bg: '#EEF0FE', color: BX.purple };
    return { bg: '#FFF4E0', color: BX.amber };
  };
  return (
    <div style={{ ...CARD, marginBottom: 0 }}>
      <h2 style={{ ...H2, marginBottom: 6 }}>Recent Blog Posts</h2>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3, 4].map(i => <Skeleton key={i} height={52} />)}
        </div>
      ) : (posts || []).length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: BX.muted, fontSize: 13, fontFamily: BX.font }}>No posts yet</div>
      ) : (
        <div>
          {(posts || []).map((p, idx, arr) => {
            const pc = pill(p.status);
            return (
              <div key={p.id || idx} style={{
                padding: '11px 0',
                borderBottom: idx < arr.length - 1 ? '1px solid #F5F5F8' : 'none',
                display: 'flex', flexDirection: 'column', gap: 3,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: BX.ink, fontFamily: BX.font, lineHeight: 1.4, flex: 1, minWidth: 0 }}>{p.title}</span>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '2px 9px', borderRadius: 20, fontSize: 10.5, fontWeight: 600,
                    background: pc.bg, color: pc.color, flexShrink: 0, fontFamily: BX.font,
                  }}>
                    <i style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                    {p.status || 'draft'}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: BX.muted, fontFamily: BX.font }}>
                  {p.published_at ? new Date(p.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not published'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
