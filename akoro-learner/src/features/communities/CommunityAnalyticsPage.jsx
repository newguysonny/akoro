import { useState, useEffect, useCallback } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { fetchCommunity, fetchCommunityAnalytics } from '../../services/communityApi.js';
import CommunityShell, { CommunityEmptyState, SectionTitle } from './components/CommunityShell.jsx';
import { Icon } from '../../components/common/Icons.jsx';
import { BRAND, GREEN } from '../../constants.js';

/**
 * CommunityAnalyticsPage — the reference UI (reference/communities pages.md,
 * view "ANALYTICS"): the reference's stat-card grid (the exact four cards
 * and accent colours — members purple, activities amber, submissions
 * green, average sky) and the "Recent submissions" rail. The grid is
 * 2-up on mobile like the reference and 4-up from the tablet breakpoint
 * up, where the page fills the app shell's content area.
 */

function timeAgo(iso) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* The reference's .stat-card — surface tile, soft icon square, big value. */
function StatCard({ icon, bg, color, value, label }) {
  return (
    <div style={{ background: 'var(--ak-surface)', border: '1px solid var(--ak-border2)', borderRadius: 'var(--r-lg)', padding: 'var(--s-4)' }}>
      <div style={{ width: 36, height: 36, borderRadius: 'var(--r-md)', background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--s-3)' }}>
        <Icon name={icon} size={18}/>
      </div>
      <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.02em', color: 'var(--ak-text)' }}>{value}</div>
      <div style={{ fontSize: 12.5, color: 'var(--ak-text-sub)', fontWeight: 700, marginTop: 2 }}>{label}</div>
    </div>
  );
}

export default function CommunityAnalyticsPage() {
  const { communityId } = useParams();
  const [community, setCommunity] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([fetchCommunity(communityId), fetchCommunityAnalytics(communityId)]);
      setCommunity(c);
      setStats(s);
    } finally { setLoading(false); }
  }, [communityId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <CommunityShell title="Analytics" backTo={`/communities/${communityId}`} loading/>;
  if (!community) {
    return (
      <CommunityShell title="Analytics" backTo="/communities"
        empty={<div style={{ textAlign: 'center', padding: '60px 20px' }}><p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>Community not found</p></div>} />
    );
  }
  /* Creator-only page — non-creators land on the community profile. */
  if (community.my_role !== 'owner') return <Navigate to={`/communities/${communityId}/profile`} replace/>;

  return (
    <CommunityShell title="Analytics" sub={community.name} backTo={`/communities/${communityId}`}>
      <style>{`
        .ak-cm-stats{display:grid;grid-template-columns:1fr 1fr;gap:var(--s-3)}
        @media (min-width:768px){.ak-cm-stats{grid-template-columns:repeat(4,1fr)}}
      `}</style>

      {/* Stat grid — the reference's .stat-grid, 2-up mobile / 4-up tablet+. */}
      <div className="ak-cm-stats">
        <StatCard icon="ti-users"       bg={`${BRAND}14`}              color={BRAND}               value={stats?.members ?? 0}        label="Members"/>
        <StatCard icon="ti-clipboard"   bg="rgba(245,158,11,.14)"      color="var(--ak-warn-text)"  value={stats?.activities ?? 0}     label="Activities"/>
        <StatCard icon="ti-inbox"       bg="rgba(16,185,129,.12)"      color={GREEN}               value={stats?.submissions ?? 0}    label="Submissions"/>
        <StatCard icon="ti-trending-up" bg="rgba(59,167,224,.14)"      color="#3BA7E0"              value={stats?.avg_per_activity ?? 0} label="Avg / activity"/>
      </div>

      {/* Recent submissions */}
      <SectionTitle>Recent submissions</SectionTitle>
      {stats?.recent?.length ? (
        <div>
          {stats.recent.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', padding: '9px 0' }}>
              <div style={{ width: 34, height: 34, borderRadius: 'var(--r-full)', flexShrink: 0, background: 'rgba(16,185,129,.12)', color: GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="ti-circle-check" size={16}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.user_name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ak-text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.activity_name}
                </div>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--ak-text-muted)', flexShrink: 0 }}>{timeAgo(r.submitted_at)}</div>
            </div>
          ))}
        </div>
      ) : (
        <CommunityEmptyState icon="ti-inbox" title="No submissions yet." />
      )}
    </CommunityShell>
  );
}
