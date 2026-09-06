import { useState, useEffect, useCallback } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { fetchCommunity, fetchCommunityAnalytics } from '../services/communityApi.js';
import CommunityShell from '../components/communities/CommunityShell.jsx';
import { Icon } from '../components/common/Icons.jsx';
import { BRAND, GREEN, GOLD } from '../constants.js';

function timeAgo(iso) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatTile({ icon, color, value, label }) {
  return (
    <div style={{ flex: 1, minWidth: 120, padding: '14px', background: 'var(--ak-surface)', borderRadius: 14, border: '1px solid var(--ak-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ width: 30, height: 30, borderRadius: 9, background: `${color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={16} color={color}/>
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--ak-text)' }}>{value}</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 1 }}>{label}</div>
      </div>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Stat grid */}
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <StatTile icon="ti-users"       color={BRAND} value={stats?.members ?? 0} label="Members"/>
          <StatTile icon="ti-clipboard"   color={GOLD}  value={stats?.activities ?? 0} label="Activities"/>
          <StatTile icon="ti-inbox"       color={GREEN} value={stats?.submissions ?? 0} label="Submissions"/>
          <StatTile icon="ti-trending-up" color={BRAND} value={stats?.avg_per_activity ?? 0} label="Avg / activity"/>
        </div>

        {/* Recent submissions */}
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 900, color: 'var(--ak-text-muted)', marginBottom: 8 }}>RECENT SUBMISSIONS</div>
          {stats?.recent?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.recent.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: 'var(--ak-surface)', borderRadius: 12, border: '1px solid var(--ak-border)' }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: `${GREEN}14`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="ti-circle-check" size={16} color={GREEN}/>
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
            <div style={{ padding: '22px', borderRadius: 14, border: '1.5px dashed var(--ak-border)', textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
              No submissions yet
            </div>
          )}
        </div>
      </div>
    </CommunityShell>
  );
}
