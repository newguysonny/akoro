import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchCommunity, fetchCommunityActivities } from '../services/communityApi.js';
import CommunityShell, { IconChip } from '../components/communities/CommunityShell.jsx';
import { Icon } from '../components/common/Icons.jsx';
import { BRAND, RED } from '../constants.js';

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

function dueInfo(dueAt) {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  const text = d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return { text, overdue: d.getTime() < Date.now() };
}

/* The community's profile view — what a member (non-creator) gets from
   the profile icon: overview + read-only activity list. */
export default function CommunityProfilePage() {
  const navigate    = useNavigate();
  const { communityId } = useParams();
  const [community, setCommunity]   = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading]       = useState(true);

  const load = useCallback(async () => {
    try {
      const [c, list] = await Promise.all([fetchCommunity(communityId), fetchCommunityActivities(communityId)]);
      setCommunity(c);
      setActivities(list);
    } finally { setLoading(false); }
  }, [communityId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <CommunityShell title="Profile" backTo={`/communities/${communityId}`} loading/>;
  if (!community) {
    return (
      <CommunityShell title="Profile" backTo="/communities"
        empty={<div style={{ textAlign: 'center', padding: '60px 20px' }}><p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>Community not found</p></div>} />
    );
  }

  const isOwner = community.my_role === 'owner';
  const created = community.created_at ? new Date(community.created_at).toLocaleDateString() : '';

  return (
    <CommunityShell
      title="Community profile"
      sub={community.name}
      backTo={`/communities/${communityId}`}
      right={
        isOwner
          ? (
            <>
              <IconChip icon="ti-settings"  label="Community settings"  onClick={() => navigate(`/communities/${communityId}/settings`)} />
              <IconChip icon="ti-users"     label="Community people"    onClick={() => navigate(`/communities/${communityId}/people`)} />
              <IconChip icon="ti-chart-bar" label="Community analytics" onClick={() => navigate(`/communities/${communityId}/analytics`)} />
            </>
          )
          : null
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Hero */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, overflow: 'hidden', background: `linear-gradient(135deg, ${BRAND}18, ${BRAND}08)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }}>
            {community.emoji || <span style={{ fontSize: 22, fontWeight: 900, color: BRAND }}>{initials(community.name)}</span>}
          </div>
          <div style={{ fontSize: 19, fontWeight: 900, color: 'var(--ak-text)', marginTop: 10 }}>{community.name}</div>
          {community.description && (
            <div style={{ fontSize: 12.5, color: 'var(--ak-text-muted)', marginTop: 4, lineHeight: 1.55, maxWidth: 380 }}>{community.description}</div>
          )}
          {/* Meta chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
            {community.owner_name && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: 'var(--ak-text-muted)', background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 100, padding: '4px 11px' }}>
                <Icon name="ti-user" size={12}/>
                by {community.owner_name}
              </span>
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: BRAND, background: `${BRAND}10`, border: `1px solid ${BRAND}22`, borderRadius: 100, padding: '4px 11px' }}>
              <Icon name="ti-users" size={12}/>
              {community.member_count || 1} member{(community.member_count || 1) === 1 ? '' : 's'}
            </span>
            {created && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: 'var(--ak-text-muted)', background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 100, padding: '4px 11px' }}>
                <Icon name="ti-calendar" size={12}/>
                created {created}
              </span>
            )}
          </div>
        </div>

        {/* Activities — read-only overview */}
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 900, color: 'var(--ak-text-muted)', marginBottom: 8 }}>ACTIVITIES</div>
          {activities.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activities.map(a => {
                const due = dueInfo(a.dueAt);
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: 'var(--ak-surface)', borderRadius: 12, border: '1px solid var(--ak-border)' }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: `${BRAND}14`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="ti-clipboard" size={16} color={BRAND}/>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ak-text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[a.subject, a.class_name].filter(Boolean).join(' · ')}
                        {due ? ` · due ${due.text}` : ''}
                      </div>
                    </div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, color: due?.overdue ? RED : 'var(--ak-text-muted)', flexShrink: 0 }}>
                      <Icon name="ti-inbox" size={11}/>
                      {a.submissions_count || 0}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '22px', borderRadius: 14, border: '1.5px dashed var(--ak-border)', textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
              No activities yet
            </div>
          )}
        </div>
      </div>
    </CommunityShell>
  );
}
