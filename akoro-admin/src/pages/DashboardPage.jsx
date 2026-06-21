import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Users, GraduationCap, BookOpen, Activity, TrendingUp, FileText, Briefcase } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Skeleton, Toast } from '../components/Primitives.jsx';
import useAdminAPI from '../hooks/useAdminAPI.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../constants.js';

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

function RolePill({ role }) {
  const map = {
    student:    { bg: '#EDE9FF', color: PURPLE },
    instructor: { bg: '#FFF3DC', color: AMBER },
    admin:      { bg: '#FFE4E4', color: RED },
  };
  const cfg = map[role] || map.student;
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: cfg.bg, color: cfg.color,
    }}>
      {role}
    </span>
  );
}

function StatusDot({ active }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 600,
      color: active ? GREEN : MUTED,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? GREEN : MUTED, display: 'inline-block' }} />
      {active ? 'Active' : 'Suspended'}
    </span>
  );
}

export default function DashboardPage() {
  const api = useAdminAPI();

  const [stats, setStats]     = useState(null);
  const [users, setUsers]     = useState([]);
  const [posts, setPosts]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, usersRes, postsRes] = await Promise.allSettled([
        api.getStats(),
        api.getUsers({ limit: 10, sort: 'newest' }),
        api.getBlogPosts(),
      ]);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
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

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };

  return (
    <PageLayout title="Dashboard" subtitle="Platform overview at a glance">
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
          <StatCard icon={Users}        label="Total Users"        value={(stats?.total_users ?? 0).toLocaleString()}       sub="registered accounts"    color={BLUE}   loading={loading} />
          <StatCard icon={GraduationCap} label="Total Instructors" value={(stats?.total_instructors ?? 0).toLocaleString()}  sub="teaching on platform"   color={AMBER}  loading={loading} />
          <StatCard icon={BookOpen}     label="Total Courses"      value={(stats?.total_courses ?? 0).toLocaleString()}      sub="published & draft"      color={PURPLE} loading={loading} />
          <StatCard icon={FileText}     label="Blog Posts"         value={(stats?.total_blog_posts ?? posts.length ?? 0).toLocaleString()} sub="content articles" color={GREEN} loading={loading} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'start' }}>

          {/* Recent users table */}
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: INK, margin: '0 0 14px', fontFamily: FONT }}>Recent Users</h2>
            <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden' }}>
              {loading ? (
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[1,2,3,4,5].map(i => <Skeleton key={i} height={40} />)}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                      <tr key={u.id} style={{ cursor: 'default' }}
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
