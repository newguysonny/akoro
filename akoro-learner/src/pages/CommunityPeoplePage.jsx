import { useState, useEffect, useCallback } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { fetchCommunity, fetchCommunityMembers } from '../services/communityApi.js';
import CommunityShell from '../components/communities/CommunityShell.jsx';
import { BRAND } from '../constants.js';

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

function timeAgo(iso) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function CommunityPeoplePage() {
  const { communityId } = useParams();
  const { user }        = useAuth();
  const [community, setCommunity] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    try {
      const [c, list] = await Promise.all([fetchCommunity(communityId), fetchCommunityMembers(communityId)]);
      setCommunity(c);
      setMembers(list);
    } finally { setLoading(false); }
  }, [communityId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <CommunityShell title="People" backTo={`/communities/${communityId}`} loading/>;
  if (!community) {
    return (
      <CommunityShell title="People" backTo="/communities"
        empty={<div style={{ textAlign: 'center', padding: '60px 20px' }}><p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>Community not found</p></div>} />
    );
  }
  /* Creator-only page — non-creators land on the community profile. */
  if (community.my_role !== 'owner') return <Navigate to={`/communities/${communityId}/profile`} replace/>;

  return (
    <CommunityShell title="People" sub={`${members.length || 1} member${(members.length || 1) === 1 ? '' : 's'}`} backTo={`/communities/${communityId}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {members.map(m => {
          const isOwner = m.role === 'owner';
          const isMe = m.user_id === user?.id;
          return (
            <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 15px', background: 'var(--ak-surface)', borderRadius: 14, border: '1px solid var(--ak-border)' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: `${BRAND}14`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {m.avatar_url
                  ? <img src={m.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(ev) => { ev.currentTarget.style.display = 'none'; }}/>
                  : <span style={{ fontSize: 13, fontWeight: 900, color: BRAND }}>{initials(m.name)}</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name}{isMe ? ' (you)' : ''}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ak-text-muted)', marginTop: 2 }}>
                  joined {timeAgo(m.joined_at)}
                </div>
              </div>
              <span style={{ fontSize: 9, fontWeight: 900, color: isOwner ? '#B45309' : 'var(--ak-text-muted)', background: isOwner ? 'rgba(245,158,11,.14)' : 'rgba(107,114,128,.10)', borderRadius: 100, padding: '3px 10px', flexShrink: 0 }}>
                {isOwner ? 'OWNER' : 'MEMBER'}
              </span>
            </div>
          );
        })}
      </div>
    </CommunityShell>
  );
}
