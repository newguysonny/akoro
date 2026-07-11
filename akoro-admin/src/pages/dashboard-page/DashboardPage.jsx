/**
 * DashboardPage — composes the components from ./parts.jsx.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Users, GraduationCap, BookOpen, FileText, Star, Activity, CheckSquare, TrendingUp } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import { Skeleton, Toast } from '../../components/Primitives.jsx';
import useAdminAPI from '../../hooks/useAdminAPI.js';
import { apiGet } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';

import { StatCard, RolePill, LoginTrendsChart } from './parts.jsx';

export default function DashboardPage() {
  const api = useAdminAPI();

  const [stats,       setStats]       = useState(null);
  const [extraStats,  setExtraStats]  = useState(null);
  const [loginTrends, setLoginTrends] = useState([]);
  const [users,       setUsers]       = useState([]);
  const [posts,       setPosts]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [toast,       setToast]       = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, usersRes, postsRes, extraRes, trendsRes] = await Promise.allSettled([
        api.getStats(),
        api.getUsers({ limit: 10, sort: 'newest' }),
        api.getBlogPosts(),
        apiGet('/api/admin/dashboard/stats'),
        apiGet('/api/admin/dashboard/login-trends'),
      ]);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
      if (extraRes.status === 'fulfilled') setExtraStats(extraRes.value);
      if (trendsRes.status === 'fulfilled') {
        const d = trendsRes.value;
        setLoginTrends(Array.isArray(d) ? d : (d?.data || d?.trends || []));
      }
      if (usersRes.status === 'fulfilled') {
        const d = usersRes.value;
        setUsers(Array.isArray(d) ? d : (d?.users || d?.data || []));
      }
      if (postsRes.status === 'fulfilled') {
        const d = postsRes.value;
        setPosts(Array.isArray(d) ? d.slice(0, 8) : (d?.posts || d?.data || []).slice(0, 8));
      }
      if (statsRes.status === 'rejected') showToast('Could not load stats', 'error');
    } catch {
      showToast('Failed to load dashboard', 'error');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const pillColor = (status) => {
    if (status === 'published') return { bg: '#DCFCE7', color: GREEN };
    if (status === 'archived')  return { bg: '#EDE9FE', color: PURPLE };
    return { bg: '#F3F4F6', color: MUTED };
  };

  const avgRating = extraStats?.avg_course_rating ?? stats?.avg_course_rating;
  const completionRate = extraStats?.completion_rate ?? stats?.completion_rate;
  const dau = extraStats?.dau ?? stats?.dau;
  const totalCompletions = extraStats?.total_completions ?? stats?.total_completions;
  const totalUsers = stats?.total_users ?? 0;

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };

  return (
    <PageLayout title="Dashboard" subtitle="Platform overview at a glance">
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
          <StatCard
            icon={Users} label="Total Users" color={BLUE}
            value={loading ? '—' : totalUsers.toLocaleString()}
            sub="registered accounts"
            loading={loading}
          />
          <StatCard
            icon={Star} label="Avg Rating" color={AMBER}
            value={loading ? '—' : avgRating != null ? `★ ${Number(avgRating).toFixed(1)}` : '—'}
            sub="avg course rating"
            loading={loading}
          />
          <StatCard
            icon={CheckSquare} label="Completion Rate" color={GREEN}
            value={loading ? '—' : completionRate != null ? `${Math.round(completionRate)}%` : '—'}
            sub="course completions"
            loading={loading}
          />
          <StatCard
            icon={Activity} label="DAU" color={PURPLE}
            value={loading ? '—' : dau != null ? Number(dau).toLocaleString() : '—'}
            sub="daily active users"
            loading={loading}
          />
          <StatCard
            icon={TrendingUp} label="Course Completions" color={RED}
            value={loading ? '—' : totalCompletions != null ? Number(totalCompletions).toLocaleString() : '—'}
            sub="total completions"
            loading={loading}
          />
        </div>

        {/* Login Trends sparkline */}
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 24, marginBottom: 32 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 18px', fontFamily: FONT }}>Login Trends (30 days)</h2>
          <LoginTrendsChart data={loginTrends} loading={loading} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'start' }}>

          {/* Recent users table */}
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: INK, margin: '0 0 14px', fontFamily: FONT }}>Recent Users</h2>
            <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', overflowX: 'auto' }}>
              {loading ? (
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[1,2,3,4,5].map(i => <Skeleton key={i} height={40} />)}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: LIGHT }}>
                      <th style={TH}>Name</th>
                      <th style={TH}>Email</th>
                      <th style={TH}>Role</th>
                      <th style={TH}>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr><td colSpan={4} style={{ ...TD, textAlign: 'center', color: MUTED }}>No users found</td></tr>
                    ) : users.map(u => (
                      <tr key={u.id}
                        onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                        onMouseLeave={e => e.currentTarget.style.background = WHITE}>
                        <td style={TD}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: '50%',
                              background: `${AMBER}20`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 12, fontWeight: 700, color: AMBER, flexShrink: 0,
                            }}>
                              {(u.full_name || u.fullName || u.username || '?')[0].toUpperCase()}
                            </div>
                            <span style={{ fontWeight: 600 }}>{u.full_name || u.fullName || u.username || '—'}</span>
                          </div>
                        </td>
                        <td style={{ ...TD, color: MUTED }}>{u.email}</td>
                        <td style={TD}><RolePill role={u.role} /></td>
                        <td style={{ ...TD, color: MUTED }}>{fmtDate(u.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Recent blog posts */}
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: INK, margin: '0 0 14px', fontFamily: FONT }}>Recent Blog Posts</h2>
            <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden' }}>
              {loading ? (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[1,2,3,4].map(i => <Skeleton key={i} height={52} />)}
                </div>
              ) : posts.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: MUTED, fontSize: 13, fontFamily: FONT }}>No posts yet</div>
              ) : (
                <div>
                  {posts.map((p, idx) => {
                    const pc = pillColor(p.status);
                    return (
                      <div key={p.id} style={{
                        padding: '12px 16px',
                        borderBottom: idx < posts.length - 1 ? `1px solid ${BORDER}` : 'none',
                        display: 'flex', flexDirection: 'column', gap: 4,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT, lineHeight: 1.4, flex: 1 }}>
                            {p.title}
                          </span>
                          <span style={{
                            padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                            background: pc.bg, color: pc.color, flexShrink: 0,
                          }}>
                            {p.status || 'draft'}
                          </span>
                        </div>
                        <span style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>
                          {p.published_at ? fmtDate(p.published_at) : 'Not published'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

