import { useState, useEffect, useCallback } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { fetchCommunity, fetchCommunityMembers } from '../../services/communityApi.js';
import CommunityShell, { useCommunityToast, ACCENTS } from './components/CommunityShell.jsx';
import { Icon } from '../../components/common/Icons.jsx';
import { BRAND } from '../../constants.js';

/**
 * CommunityPeoplePage — the reference UI (reference/communities pages.md,
 * view "PEOPLE"): the purple "Invite members" pill (shares the community
 * link — the app has no invite-token endpoint, so the share sheet /
 * clipboard is the invite path), then the reference's member rows:
 * a coloured-initials avatar, name + "(you)", joined-ago, and the
 * OWNER / MEMBER role badge.
 */

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
  const [showToast, toastNode] = useCommunityToast();

  const load = useCallback(async () => {
    try {
      const [c, list] = await Promise.all([fetchCommunity(communityId), fetchCommunityMembers(communityId)]);
      setCommunity(c);
      setMembers(list);
    } finally { setLoading(false); }
  }, [communityId]);

  useEffect(() => { load(); }, [load]);

  /* Invite = share the community's link (native share sheet where the
     platform has one, clipboard everywhere else). */
  const invite = async () => {
    const url  = `${window.location.origin}/communities/${communityId}`;
    const text = `Join "${community.name}" on Akoro — ${url}`;
    try {
      if (navigator.share) { await navigator.share({ title: community.name, text, url }); return; }
      await navigator.clipboard.writeText(text);
      showToast('Invite link copied to clipboard');
    } catch (e) {
      if (e?.name === 'AbortError') return;   // the share sheet was dismissed
      showToast('Could not share — copy the link from the address bar');
    }
  };

  if (loading) return <CommunityShell title="People" backTo={`/communities/${communityId}`} loading/>;
  if (!community) {
    return (
      <CommunityShell title="People" backTo="/communities"
        empty={<div style={{ textAlign: 'center', padding: '60px 20px' }}><p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>Community not found</p></div>} />
    );
  }
  /* Creator-only page — non-creators land on the community profile. */
  if (community.my_role !== 'owner') return <Navigate to={`/communities/${communityId}/profile`} replace/>;

  const memberCount = members.length || 1;

  return (
    <CommunityShell title="People" sub={`${memberCount} member${memberCount === 1 ? '' : 's'}`} backTo={`/communities/${communityId}`}>
      <style>{`.ak-cm-cta:active{transform:scale(.98)}`}</style>

      {/* Invite members — the reference's .invite-btn pill. */}
      <button onClick={invite} className="ak-cm-cta"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--s-2)', width: '100%', margin: '0 0 var(--s-4)', padding: '13px', borderRadius: 'var(--r-full)', border: 'none', background: BRAND, color: '#fff', fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 14, cursor: 'pointer', transition: 'transform .15s var(--ease-spring)' }}>
        <Icon name="ti-user-plus" size={17}/> Invite members
      </button>

      {/* Member rows — the reference's .member-row. */}
      <div>
        {members.map((m, i) => {
          const isOwner = m.role === 'owner';
          const isMe = m.user_id === user?.id;
          return (
            <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', padding: '11px 0' }}>
              <div style={{ width: 40, height: 40, borderRadius: 'var(--r-full)', flexShrink: 0, overflow: 'hidden', background: ACCENTS[i % ACCENTS.length], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900 }}>
                {m.avatar_url
                  ? <img src={m.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(ev) => { ev.currentTarget.style.display = 'none'; }}/>
                  : initials(m.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name}{isMe ? ' (you)' : ''}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ak-text-sub)', fontWeight: 600, marginTop: 1 }}>
                  joined {timeAgo(m.joined_at)}
                </div>
              </div>
              <span style={{
                padding: '3px 10px', borderRadius: 'var(--r-full)', fontSize: 10, fontWeight: 900, letterSpacing: '.04em', flexShrink: 0,
                background: isOwner ? 'rgba(245,158,11,.14)' : 'var(--ak-border)',
                color: isOwner ? 'var(--ak-warn-text)' : 'var(--ak-text-sub)',
              }}>
                {isOwner ? 'OWNER' : 'MEMBER'}
              </span>
            </div>
          );
        })}
      </div>

      {toastNode}
    </CommunityShell>
  );
}
