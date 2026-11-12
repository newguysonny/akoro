/**
 * DashboardPage — bachs-style dashboard.
 * Data hooks preserved; UI rebuilt per approved preview.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../../components/Layout.jsx';
import { Toast } from '../../components/Primitives.jsx';
import useAdminAPI from '../../hooks/useAdminAPI.js';
import { apiGet } from '../../services/api.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import {
  MetricCard, ReviewBanner, RangePills, LoginsCard,
  PopularFeatures, PaymentBreakdown, NewestUsers, BlogPosts,
} from './parts.jsx';

const fmtCount = (n) => (n == null ? 'N/A' : Number(n).toLocaleString());
const fmtNaira = (n) => (n == null ? 'N/A' : `₦${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const fmtUsd = (n) => (n == null ? 'N/A' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtPct = (v) => (v == null ? 'N/A' : `${v > 0 ? '+' : ''}${v}%`);

export default function DashboardPage() {
  const api = useAdminAPI();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [stats,       setStats]       = useState(null);
  const [loginTrends, setLoginTrends] = useState([]);
  const [users,       setUsers]       = useState([]);
  const [posts,       setPosts]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [toast,       setToast]       = useState(null);
  const [range,       setRange]       = useState('7d');

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, usersRes, postsRes, trendsRes] = await Promise.allSettled([
        api.getStats(),
        api.getUsers({ limit: 10, sort: 'newest' }),
        api.getBlogPosts(),
        apiGet('/api/admin/dashboard/login-trends'),
      ]);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
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

  const totalUsers  = stats?.totalUsers ?? null;
  const revenue     = stats?.revenue_mtd ?? null;
  const aiSpend     = stats?.ai_spend_today_usd ?? null;
  const approvals   = stats?.course_approvals ?? null;
  const online      = stats?.active_users_online ?? null;
  const visitsToday = stats?.visits_today ?? null;
  const totalVisits = stats?.total_visits ?? null;
  const payments    = stats?.payments_by_status ?? null;
  const firstName = (user?.fullName || user?.name || '').split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const grid2 = {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
    marginBottom: 16, alignItems: 'start',
  };

  return (
    <PageLayout
      title={`${greeting}, ${firstName}`}
      action={<RangePills value={range} onChange={setRange} />}
      contentMaxWidth={1120}
    >
      <ReviewBanner
        onReview={() => navigate('/course-approvals')}
        onRemind={() => showToast('We\'ll remind you later')}
      />

      {/* Metrics */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 12, marginBottom: 16,
      }}>
        <MetricCard label="Total users"
          value={loading ? '—' : fmtCount(totalUsers)}
          delta={stats?.new_users_7d != null ? `+${fmtCount(stats.new_users_7d)} this week` : 'N/A'}
          loading={loading} />
        <MetricCard label="Revenue · MTD" value={loading ? '—' : fmtNaira(revenue)}
          delta={stats?.revenue_change_pct != null ? `${fmtPct(stats.revenue_change_pct)} vs last month` : 'N/A'}
          loading={loading} />
        <MetricCard label="AI spend · today" value={loading ? '—' : fmtUsd(aiSpend)}
          delta={stats?.ai_spend_change_pct != null ? `${fmtPct(stats.ai_spend_change_pct)} vs yesterday` : 'N/A'}
          loading={loading} />
        <MetricCard label="Course approvals" value={loading ? '—' : fmtCount(approvals)}
          delta="Pending review" loading={loading} />
        <MetricCard label="Active users (online)" value={loading ? '—' : fmtCount(online)}
          delta="Last 15 min" loading={loading} />
        <MetricCard label="Visits today" value={loading ? '—' : fmtCount(visitsToday)}
          delta="N/A" loading={loading} />
        <MetricCard label="Total visits" value={loading ? '—' : fmtCount(totalVisits)}
          delta="N/A" loading={loading} />
      </div>

      {/* Logins */}
      <LoginsCard data={loginTrends} loading={loading} range={range} />

      {/* Popular features + breakdown */}
      <div style={grid2} className="bx-duo">
        <PopularFeatures data={stats?.top_features} loading={loading} />
        <PaymentBreakdown data={payments} loading={loading} />
      </div>

      {/* Users + blog */}
      <div style={{ ...grid2, gridTemplateColumns: '1fr 360px' }} className="bx-duo-wide">
        <NewestUsers users={users} loading={loading} />
        <BlogPosts posts={posts} loading={loading} />
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <style>{`
        @media (max-width: 900px) {
          .bx-duo, .bx-duo-wide { grid-template-columns: 1fr !important; }
          .bx-duo > *, .bx-duo-wide > * { min-width: 0; }
        }
      `}</style>
    </PageLayout>
  );
}
