import { useNavigate, useParams } from 'react-router-dom';
import CommunityShell, { IconChip, CommunityEmptyState, SectionTitle, ACCENTS } from './components/CommunityShell.jsx';
import { Icon } from '../../components/common/Icons.jsx';
import { BRAND, RED, GREEN } from '../../constants.js';
import Spinner from '../../components/common/Spinner.jsx';
import useCommunityHome from './hooks/useCommunityHome.js';
import CommunityActivityCard from './components/CommunityActivityCard.jsx';
import NewActivitySheet from './components/NewActivitySheet.jsx';
import { ERROR_STATES, KIND_ICONS, TABS, initials, timeAgo } from './components/communityActivityMeta.js';

/**
 * CommunityActivityPage — the community home, overhauled to the reference
 * UI (reference/communities pages.md, view "MAIN"):
 *
 *   · sticky header-group: top-bar (back · gradient community tile ·
 *     name + member count · owner's settings/people/analytics chips),
 *     the follow row (member count + Follow/Following, wired to the real
 *     join/leave endpoints) and the type tabs — all three ride sticky;
 *   · the reference's dashed "New activity" button (owner only);
 *   · the activity feed as surface cards in the reference's row language,
 *     the reference's empty state (per tab), and the reference's
 *     "Popular materials" + "Popular folders" rails — always shown, each
 *     with the reference's empty state when empty. Materials are fed by
 *     the content members have shared (the Add-to-community flow);
 *     folders hold their empty state until that feature lands.
 *
 * Types carry line icons (the reference replaces emoji throughout); the
 * stored community emoji still renders in the header tile.
 */

export default function CommunityActivityPage() {
  const navigate   = useNavigate();
  const { communityId } = useParams();
  const {
    community, activities, setActivities, items, loading, sheetOpen, setSheetOpen,
    typeFilter, setTypeFilter, submittingId, submitBusy, followBusy, showToast,
    toastNode, error, retry, submit, toggleFollow,
  } = useCommunityHome(communityId);

  if (loading) {
    return (
      <CommunityShell title="Community" sub="" backTo="/communities" loading headerLoading
        right={<IconChip icon="ti-info-circle" label="Loading..." disabled />} />
    );
  }

  if (error && error.kind !== 'missing') {
    const meta = ERROR_STATES[error.kind] || ERROR_STATES.network;
    return (
      <CommunityShell title="Community" backTo="/communities"
        empty={
          <div style={{ textAlign: 'center', padding: '36px 30px 60px', color: 'var(--ak-text-sub)' }}>
            <div style={{ width: 52, height: 52, borderRadius: 'var(--r-lg)', background: 'var(--ak-border)', color: 'var(--ak-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <Icon name={meta.icon} size={24}/>
            </div>
            <div style={{ fontWeight: 800, color: 'var(--ak-text)', fontSize: 15, marginBottom: 3 }}>{meta.title}</div>
            <div style={{ fontSize: 13 }}>{error.kind === 'server' ? (error.message || meta.body) : meta.body}</div>
            {error.step ? (
              <div style={{ fontSize: 11, color: 'var(--ak-text-muted)', marginTop: 6, opacity: .85 }}>
                The server gave up waiting on: {error.step}
              </div>
            ) : error.timeoutMs ? (
              <div style={{ fontSize: 11, color: 'var(--ak-text-muted)', marginTop: 6, opacity: .85 }}>
                No answer at all within {Math.round(error.timeoutMs / 1000)} seconds - the request may not have reached our server.
              </div>
            ) : null}
            <button onClick={retry}
              style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 'var(--r-full)', border: 'none', background: BRAND, color: '#fff', fontSize: 12.5, fontWeight: 900, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
              <Icon name="ti-refresh" size={14}/> Try again
            </button>
          </div>
        }
      />
    );
  }

  if (!community) {
    return (
      <CommunityShell
        title="Community"
        backTo="/communities"
        empty={
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>Community not found</p>
          </div>
        }
      />
    );
  }

  const isOwner = community.my_role === 'owner';
  const canSubmit = !!community.my_role && !isOwner;
  const memberCount = community.member_count || 1;
  const following = !!community.my_role;

  /* Creator: settings / people / analytics. Member: profile. */
  const headerRight = isOwner ? (
    <>
      <IconChip icon="ti-settings"  label="Community settings"  onClick={() => navigate(`/communities/${communityId}/settings`)} />
      <IconChip icon="ti-users"     label="Community people"    onClick={() => navigate(`/communities/${communityId}/people`)} />
      <IconChip icon="ti-chart-bar" label="Community analytics" onClick={() => navigate(`/communities/${communityId}/analytics`)} />
    </>
  ) : (
    <IconChip icon="ti-info-circle" label="Community profile" onClick={() => navigate(`/communities/${communityId}/profile`)} />
  );

  // Type filter — 'all' shows everything; others mirror the workbench tabs.
  const visible = typeFilter === 'all' ? activities : activities.filter((a) => (a.type || 'assignment') === typeFilter);
  const activeTab = TABS.find((t) => t.key === typeFilter) || TABS[0];

  return (
    <CommunityShell
      title={community.name}
      sub={`${memberCount} member${memberCount === 1 ? '' : 's'}`}
      backTo="/communities"
      icon={
        <div style={{ width: 42, height: 42, borderRadius: 'var(--r-lg)', background: `linear-gradient(145deg, ${BRAND}, #5A2FE0)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0, fontSize: 20 }}>
          {community.emoji || <span style={{ fontSize: 13, fontWeight: 900 }}>{initials(community.name)}</span>}
        </div>
      }
      headerExtras={
        <>
          {/* Follow row — the reference's .follow-row, wired to join/leave. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--s-4) var(--s-4) 0' }}>
            <span style={{ fontSize: 13, color: 'var(--ak-text-sub)', fontWeight: 700 }}>
              {memberCount} member{memberCount === 1 ? '' : 's'}
            </span>
            {!isOwner && (
              <button onClick={toggleFollow} disabled={followBusy}
                style={{
                  padding: '9px 20px', borderRadius: 'var(--r-full)', fontFamily: "'Nunito',sans-serif",
                  border: `1.5px solid ${following ? 'var(--ak-text)' : 'var(--ak-border3)'}`,
                  background: following ? 'var(--ak-text)' : 'transparent',
                  color: following ? 'var(--ak-bg)' : 'var(--ak-text)',
                  fontWeight: 800, fontSize: 13.5, cursor: followBusy ? 'default' : 'pointer',
                  opacity: followBusy ? .7 : 1, transition: 'all .15s var(--ease-spring)',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                {followBusy ? <Spinner size={12} color={following ? 'var(--ak-bg)' : BRAND}/> : following ? 'Following' : 'Follow'}
              </button>
            )}
          </div>
          {/* Type tabs — the reference's .tabs pill rail. */}
          <div className="ak-cm-noscr" style={{ display: 'flex', gap: 'var(--s-2)', overflowX: 'auto', padding: 'var(--s-4)' }}>
            {TABS.map((t) => {
              const active = typeFilter === t.key;
              return (
                <button key={t.key} onClick={() => setTypeFilter(t.key)}
                  style={{
                    flexShrink: 0, padding: '9px 16px', borderRadius: 'var(--r-full)',
                    border: `1px solid ${active ? 'var(--ak-text)' : 'var(--ak-border2)'}`,
                    background: active ? 'var(--ak-text)' : 'var(--ak-surface)',
                    color: active ? 'var(--ak-bg)' : 'var(--ak-text-sub)',
                    fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: "'Nunito',sans-serif",
                    display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'all .15s', whiteSpace: 'nowrap',
                  }}>
                  {t.icon && <Icon name={t.icon} size={15}/>}
                  <span>{t.name}</span>
                </button>
              );
            })}
          </div>
        </>
      }
      right={headerRight}
    >
      <style>{`.ak-cm-new:hover{border-color:${BRAND};color:${BRAND};background:${BRAND}0D}`}</style>

      {/* New activity — the reference's dashed .new-activity-btn (owner). */}
      {isOwner && (
        <button onClick={() => setSheetOpen(true)} className="ak-cm-new"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--s-2)', width: '100%', margin: '4px 0 24px', padding: '13px', borderRadius: 'var(--r-lg)', border: '1.5px dashed var(--ak-border3)', background: 'transparent', color: 'var(--ak-text-sec)', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: 14, cursor: 'pointer', transition: 'all .15s' }}>
          <Icon name="ti-plus" size={17}/> New activity
        </button>
      )}

      {/* The feed */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {visible.length === 0 ? (
          <CommunityEmptyState
            icon="ti-clipboard"
            title={activeTab.emptyTitle}
            sub={typeFilter === 'all' && isOwner ? activeTab.emptySub : undefined}
          />
        ) : (
          visible.map((a, i) => (
            <CommunityActivityCard key={a.id} a={a} canSubmit={canSubmit} onSubmit={submit}
              submitting={submitBusy && submittingId === a.id} accent={ACCENTS[i % ACCENTS.length]} />
          ))
        )}
      </div>

      {/* Popular materials — the reference's rail, fed by the content
          members have shared into this community (newest first). Rows
          with an in-app link reopen their source. The section always
          shows: an empty rail gets the reference's empty state, not
          silence. */}
      <SectionTitle>Popular materials</SectionTitle>
      {items.length > 0 ? (
        items.slice(0, 4).map((it, i) => (
          <button key={it.id} onClick={() => it.link && navigate(it.link)} disabled={!it.link}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', padding: '9px 0', background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: it.link ? 'pointer' : 'default', fontFamily: "'Nunito',sans-serif" }}>
            <div style={{ width: 18, textAlign: 'center', color: 'var(--ak-text-muted)', fontWeight: 800, fontSize: 13.5, flexShrink: 0 }}>{i + 1}</div>
            <div style={{ width: 42, height: 42, borderRadius: 'var(--r-sm)', flexShrink: 0, background: ACCENTS[i % ACCENTS.length], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={KIND_ICONS[it.kind] || 'ti-file-text'} size={18}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</div>
              <div style={{ fontSize: 12, color: 'var(--ak-text-sub)', fontWeight: 600, marginTop: 1 }}>
                {it.addedBy ? `Shared by ${it.addedBy} · ` : ''}added {timeAgo(it.createdAt)}
              </div>
            </div>
          </button>
        ))
      ) : (
        <CommunityEmptyState compact
          icon="ti-file-text"
          title="No materials yet"
          sub="Tap ⋯ on any content and choose “Add to community” to share it here."
        />
      )}

      {/* Popular folders — the reference's second rail. Communities have
          no folders feature yet, so the section holds its empty state
          until one lands; the structure is already in place. */}
      <SectionTitle>Popular folders</SectionTitle>
      <CommunityEmptyState compact
        icon="ti-folder"
        title="No folders yet"
        sub="Folders shared in this community will appear here."
      />

      {toastNode}
      {sheetOpen && (
        <NewActivitySheet
          community={community}
          onClose={() => setSheetOpen(false)}
          onCreated={(a) => {
            setSheetOpen(false);
            setActivities(prev => [a, ...prev]);
            showToast('Activity posted');
          }}
        />
      )}
    </CommunityShell>
  );
}
