import { useState, useEffect, useCallback, useRef } from 'react';
import { TrendingUp, DollarSign, Users, BookOpen, RefreshCw, Clock, CheckSquare, BarChart2 } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Skeleton, Toast } from '../components/Primitives.jsx';
import { apiGet } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../constants.js';

const PERIODS = ['7d', '30d', '90d', '1y'];

function StatCard({ icon: Icon, label, value, sub, color = AMBER, loading }) {
  if (loading) return (
    <div style={{ background: WHITE, borderRadius: 16, padding: 20, border: `1px solid ${BORDER}` }}>
      <Skeleton height={14} width={80} style={{ marginBottom: 12 }} />
      <Skeleton height={32} width={60} style={{ marginBottom: 6 }} />
      <Skeleton height={12} width={100} />
    </div>
  );
  return (
    <div style={{
      background: WHITE, borderRadius: 16, padding: 20,
      border: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${color}15`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={18} color={color} />
        </div>
        <span style={{ fontSize: 12, color: MUTED, fontWeight: 500, fontFamily: FONT }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: INK, fontFamily: FONT, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: MUTED, fontFamily: FONT }}>{sub}</div>}
    </div>
  );
}

function BarChart({ data, loading }) {
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);

  if (loading) return <Skeleton height={200} style={{ borderRadius: 12 }} />;
  if (!data || data.length === 0) return (
    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 13, fontFamily: FONT }}>
      No revenue data available
    </div>
  );

  const maxVal = Math.max(...data.map(d => d.amount || 0), 1);
  const barW = Math.max(4, Math.floor(600 / data.length) - 2);
  const gap = Math.max(2, Math.floor(600 / data.length) - barW);
  const totalW = data.length * (barW + gap);
  const chartH = 160;

  return (
    <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${Math.max(totalW, 600)} ${chartH + 30}`}
        style={{ width: '100%', height: 200, display: 'block' }}
        onMouseLeave={() => setTooltip(null)}
      >
        {data.map((d, i) => {
          const h = Math.max(2, ((d.amount || 0) / maxVal) * chartH);
          const x = i * (barW + gap);
          const y = chartH - h;
          return (
            <g key={i}>
              <rect
                x={x} y={y} width={barW} height={h}
                fill={AMBER} rx={3}
                style={{ cursor: 'pointer', transition: 'opacity .1s' }}
                onMouseEnter={(e) => {
                  const rect = svgRef.current?.getBoundingClientRect();
                  setTooltip({
                    date: d.date,
                    amount: d.amount,
                    x: rect ? (x / Math.max(totalW, 600)) * rect.width + rect.left : e.clientX,
                    y: rect ? rect.top + y - 10 : e.clientY,
                  });
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            </g>
          );
        })}
        {data.filter((_, i) => i % Math.ceil(data.length / 10) === 0).map((d, labelIdx) => {
          const i = data.indexOf(d);
          const x = i * (barW + gap) + barW / 2;
          return (
            <text key={labelIdx} x={x} y={chartH + 18} textAnchor="middle"
              style={{ fontSize: 9, fill: MUTED2, fontFamily: FONT }}>
              {d.date ? d.date.slice(5) : ''}
            </text>
          );
        })}
      </svg>
      {tooltip && (
        <div style={{
          position: 'fixed', top: tooltip.y, left: tooltip.x,
          background: INK, color: WHITE, padding: '6px 10px', borderRadius: 8,
          fontSize: 12, fontFamily: FONT, pointerEvents: 'none', zIndex: 999,
          transform: 'translate(-50%, -100%)',
          whiteSpace: 'nowrap',
        }}>
          <div style={{ fontWeight: 700 }}>{tooltip.date}</div>
          <div>${(tooltip.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('30d');
  const [revenue, setRevenue] = useState(null);
  const [enrollments, setEnrollments] = useState(null);
  const [usersGrowth, setUsersGrowth] = useState(null);
  const [topCourses, setTopCourses] = useState([]);
  const [engagement, setEngagement] = useState(null);
  const [topLessons, setTopLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [engLoading, setEngLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [revRes, enrRes, ugRes, tcRes] = await Promise.all([
        apiGet(`/api/admin/analytics/revenue?period=${period}`),
        apiGet(`/api/admin/analytics/enrollments?period=${period}`),
        apiGet(`/api/admin/analytics/users-growth?period=${period}`),
        apiGet(`/api/admin/analytics/top-courses`),
      ]);
      setRevenue(revRes);
      setEnrollments(enrRes);
      setUsersGrowth(ugRes);
      const tc = Array.isArray(tcRes) ? tcRes : (tcRes?.courses || tcRes?.data || []);
      setTopCourses(tc);
    } catch (err) {
      showToast(err.message || 'Failed to load analytics', 'error');
    } finally {
      setLoading(false);
    }
  }, [period]);

  const loadEngagement = useCallback(async () => {
    setEngLoading(true);
    try {
      const res = await apiGet('/api/admin/analytics/engagement');
      setEngagement(res);
      const lessons = Array.isArray(res?.top_lessons) ? res.top_lessons : (res?.lessons || []);
      setTopLessons(lessons);
    } catch {
      // non-fatal
    } finally {
      setEngLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadEngagement(); }, [loadEngagement]);

  const fmtMoney = (v) => `$${(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNum   = (v) => (v || 0).toLocaleString();

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };

  const CHIP = (active) => ({
    padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
    fontFamily: FONT, fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? AMBER : 'transparent', color: active ? WHITE : MUTED,
    transition: 'all .15s',
  });

  return (
    <PageLayout title="Analytics" subtitle="Platform revenue and growth metrics">
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Period selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24 }}>
          <span style={{ fontSize: 12, color: MUTED, fontFamily: FONT, marginRight: 8 }}>Period:</span>
          {PERIODS.map(p => (
            <button key={p} style={CHIP(period === p)} onClick={() => setPeriod(p)}>{p}</button>
          ))}
        </div>

        {/* Stats cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
          <StatCard
            icon={DollarSign} label="Net Revenue" color={GREEN}
            value={loading ? '—' : fmtMoney(revenue?.total || revenue?.net_revenue || 0)}
            sub={`${period} period`} loading={loading}
          />
          <StatCard
            icon={BookOpen} label="Total Enrollments" color={BLUE}
            value={loading ? '—' : fmtNum(enrollments?.total || enrollments?.count || 0)}
            sub={`${period} period`} loading={loading}
          />
          <StatCard
            icon={Users} label="New Users" color={PURPLE}
            value={loading ? '—' : fmtNum(usersGrowth?.total || usersGrowth?.new_users || 0)}
            sub={`${period} period`} loading={loading}
          />
          <StatCard
            icon={RefreshCw} label="Refunds" color={RED}
            value={loading ? '—' : fmtMoney(revenue?.refunds || 0)}
            sub={`${period} period`} loading={loading}
          />
        </div>

        {/* Revenue bar chart */}
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 24, marginBottom: 28 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 18px', fontFamily: FONT }}>Revenue by Day</h2>
          <BarChart
            data={revenue?.by_day || revenue?.daily || []}
            loading={loading}
          />
        </div>

        {/* Top courses table */}
        <div style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 14px', fontFamily: FONT }}>Top Courses by Enrollments</h2>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[1,2,3,4,5].map(i => <Skeleton key={i} height={44} />)}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: LIGHT }}>
                    <th style={{ ...TH, width: 48 }}>#</th>
                    <th style={TH}>Course Title</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Enrollments</th>
                  </tr>
                </thead>
                <tbody>
                  {topCourses.length === 0 ? (
                    <tr><td colSpan={3} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No data available</td></tr>
                  ) : topCourses.map((c, idx) => (
                    <tr key={c.id || idx}
                      onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                      onMouseLeave={e => e.currentTarget.style.background = WHITE}>
                      <td style={{ ...TD, color: MUTED, fontWeight: 700, width: 48 }}>{idx + 1}</td>
                      <td style={{ ...TD, fontWeight: 600 }}>{c.title || c.course_title || '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', color: AMBER, fontWeight: 700 }}>
                        {fmtNum(c.enrollment_count || c.enrollments || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Engagement Section ── */}
        <div style={{ borderTop: `2px solid ${BORDER}`, paddingTop: 36 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: INK, margin: '0 0 20px', fontFamily: FONT }}>Engagement</h2>

          {/* Engagement stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
            <StatCard
              icon={CheckSquare} label="Avg Completion Rate" color={GREEN}
              value={engLoading ? '—' : engagement?.avg_completion_rate != null ? `${Math.round(engagement.avg_completion_rate)}%` : '—'}
              loading={engLoading}
            />
            <StatCard
              icon={Clock} label="Avg Watch Time" color={BLUE}
              value={engLoading ? '—' : engagement?.avg_watch_time_minutes != null ? `${Math.round(engagement.avg_watch_time_minutes)} min` : '—'}
              loading={engLoading}
            />
            <StatCard
              icon={BarChart2} label="Lessons Completed" color={PURPLE}
              value={engLoading ? '—' : fmtNum(engagement?.lessons_completed || 0)}
              loading={engLoading}
            />
          </div>

          {/* Top Lessons table */}
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 14px', fontFamily: FONT }}>Top Lessons</h3>
            <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden' }}>
              {engLoading ? (
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[1,2,3,4,5].map(i => <Skeleton key={i} height={44} />)}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: LIGHT }}>
                      <th style={{ ...TH, width: 48 }}>Rank</th>
                      <th style={TH}>Lesson Title</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Completions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topLessons.length === 0 ? (
                      <tr><td colSpan={3} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No lesson data available</td></tr>
                    ) : topLessons.map((lesson, idx) => (
                      <tr key={lesson.id || idx}
                        onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                        onMouseLeave={e => e.currentTarget.style.background = WHITE}>
                        <td style={{ ...TD, color: MUTED, fontWeight: 700, width: 48 }}>{idx + 1}</td>
                        <td style={{ ...TD, fontWeight: 600 }}>{lesson.title || lesson.lesson_title || '—'}</td>
                        <td style={{ ...TD, textAlign: 'right', color: GREEN, fontWeight: 700 }}>
                          {fmtNum(lesson.completions || lesson.completion_count || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
