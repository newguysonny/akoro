import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchCommunityStrict, fetchCommunityActivities,
  createCommunityActivity, submitCommunityActivity,
} from '../services/communityApi.js';
import CommunityShell, { IconChip, useCommunityToast } from '../components/communities/CommunityShell.jsx';
import { Icon } from '../components/common/Icons.jsx';
import { BRAND, RED, GREEN } from '../constants.js';

/* Community identity avatars (same identity-emoji pattern as agents/guides). */
const EMOJIS = ['🌐', '📚', '🧪', '', '🎧', '💼', '🌱', '🔥', '', '🎯', '🤝', '🚀'];

function timeAgo(iso) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function dueInfo(dueAt) {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  const text = d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return { text, overdue: d.getTime() < Date.now() };
}

function CommunityActivityCard({ a, canSubmit, onSubmit }) {
  const due = dueInfo(a.dueAt);
  const meta = [a.subject, a.class_name].filter(Boolean).join(' · ');
  return (
    <div style={{ padding: '13px 15px', background: 'var(--ak-surface)', borderRadius: 14, border: '1px solid var(--ak-border)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: `${BRAND}14`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="ti-clipboard" size={18} color={BRAND}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.name}
        </div>
        {meta && (
          <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 2 }}>{meta}</div>
        )}
        <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 2 }}>
          {due
            ? <span style={{ color: due.overdue ? RED : 'var(--ak-text-muted)', fontWeight: due.overdue ? 800 : 400 }}>Due {due.text}{due.overdue ? ' · Overdue' : ''}</span>
            : 'No due date'}
          <span>  ·  Posted {timeAgo(a.created_at)}</span>
        </div>
        {a.instructions && (
          <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 3, lineHeight: 1.5 }}>{a.instructions}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, color: BRAND, background: `${BRAND}12`, borderRadius: 100, padding: '2px 9px' }}>
            <Icon name="ti-inbox" size={11}/>
            {a.submissions_count || 0} submission{(a.submissions_count || 0) === 1 ? '' : 's'}
          </span>
          {a.creator_name && (
            <span style={{ fontSize: 11, color: 'var(--ak-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              by {a.creator_name}
            </span>
          )}
          {canSubmit && (
            <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
              {a.my_submitted ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, color: GREEN, background: 'rgba(16,185,129,.10)', borderRadius: 100, padding: '3px 10px' }}>
                  <Icon name="ti-circle-check" size={12}/>
                  Submitted
                </span>
              ) : (
                <button onClick={() => onSubmit(a)}
                  style={{ border: `1.5px solid ${BRAND}`, background: 'transparent', color: BRAND, borderRadius: 100, padding: '3px 12px', fontSize: 10.5, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
                  Submit
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function NewActivitySheet({ community, onClose, onCreated }) {
  const [name, setName]         = useState('');
  const [subject, setSubject]   = useState('');
  const [klass, setKlass]       = useState('');
  const [due, setDue]           = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');

  const create = async () => {
    if (!name.trim() || saving) return;
    setSaving(true); setErr('');
    try {
      const a = await createCommunityActivity(community.id, {
        name: name.trim(),
        subject: subject.trim() || undefined,
        class: klass.trim() || undefined,
        dueAt: due ? new Date(due).toISOString() : undefined,
        instructions: instructions.trim() || undefined,
      });
      onCreated(a);
    } catch (e) {
      setErr(e?.message || 'Something went wrong. Try again.');
    } finally { setSaving(false); }
  };

  const FIELD = {
    width: '100%', boxSizing: 'border-box', borderRadius: 12, padding: '11px 13px',
    border: '1px solid var(--ak-border)', background: 'var(--ak-bg)', color: 'var(--ak-text)',
    fontFamily: "'Nunito',sans-serif", fontSize: 13.5, outline: 'none',
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(17,12,40,.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--ak-surface)', width: '100%', maxWidth: 540, maxHeight: '88vh', overflowY: 'auto', borderRadius: '22px 22px 0 0', fontFamily: "'Nunito',sans-serif", animation: 'sheet-up .28s cubic-bezier(.34,1.4,.6,1)' }}>
        <style>{'@keyframes sheet-up{from{transform:translateY(40px);opacity:.4}to{transform:translateY(0);opacity:1}}'}</style>
        <div style={{ padding: '10px 0 4px', display: 'flex', justifyContent: 'center', position: 'sticky', top: 0, background: 'var(--ak-surface)', zIndex: 1 }}>
          <div style={{ width: 38, height: 4, borderRadius: 4, background: '#E5E0F5' }} />
        </div>
        <div style={{ padding: '6px 18px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 14px' }}>
            <h2 style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>New activity</h2>
            <button onClick={onClose} style={{ background: '#F0EBFF', border: 'none', borderRadius: 100, width: 30, height: 30, cursor: 'pointer', color: 'var(--ak-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="ti-x" size={16}/>
            </button>
          </div>

          <input value={name} onChange={e => { setName(e.target.value); setErr(''); }} placeholder="Activity name" maxLength={120} autoFocus style={{ ...FIELD, marginBottom: 10 }}/>
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" maxLength={80} style={{ ...FIELD, flex: 1.2 }}/>
            <input value={klass} onChange={e => setKlass(e.target.value)} placeholder="Class (e.g. CSC 201)" maxLength={80} style={{ ...FIELD, flex: 1 }}/>
          </div>
          <div style={{ height: 10 }}/>
          <input value={due} onChange={e => setDue(e.target.value)} type="datetime-local" style={{ ...FIELD, marginBottom: 10 }}/>
          <textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Instructions (optional)" maxLength={2000} rows={3} style={{ ...FIELD, resize: 'none', marginBottom: 10 }}/>
          {err && <div style={{ fontSize: 12, fontWeight: 700, color: RED, marginBottom: 10 }}>{err}</div>}

          <button onClick={create} disabled={!name.trim() || saving}
            style={{ width: '100%', padding: '13px', borderRadius: 14, cursor: (!name.trim() || saving) ? 'default' : 'pointer', border: 'none', background: (!name.trim() || saving) ? '#C9BCF7' : BRAND, color: '#fff', fontSize: 14, fontWeight: 900, fontFamily: "'Nunito',sans-serif" }}>
            {saving ? 'Posting…' : 'Post activity'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CommunityActivityPage() {
  const navigate   = useNavigate();
  const { communityId } = useParams();
  const [community, setCommunity]   = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [sheetOpen, setSheetOpen]   = useState(false);
  const [submittingId, setSubmittingId] = useState(null);
  const [showToast, toastNode] = useCommunityToast();
  // null = ok/loading - {kind:'network'} = the request never arrived -
  // {kind:'missing'} = the API answered "no such community / not yours".
  // A degraded connection must never read as "Community not found".
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, list] = await Promise.all([fetchCommunityStrict(communityId), fetchCommunityActivities(communityId)]);
      setCommunity(c);
      setActivities(list);
      setError(null);
    } catch (e) {
      setError(e?.status === 404 || e?.status === 403 ? { kind: 'missing' } : { kind: 'network' });
    } finally { setLoading(false); }
  }, [communityId]);

  useEffect(() => { load(); }, [load]);
  const retry = () => { setLoading(true); setError(null); load(); };

  if (loading) {
    return (
      <CommunityShell title="Community" sub="" backTo="/communities" loading headerLoading
        right={<IconChip icon="ti-info-circle" label="Loading..." disabled />} />
    );
  }

  if (error?.kind === 'network') {
    return (
      <CommunityShell title="Community" backTo="/communities"
        empty={
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10, color: BRAND }}>
              <Icon name="ti-wifi-off" size={40}/>
            </div>
            <p style={{ fontSize: 14, color: 'var(--ak-text)', fontWeight: 800 }}>Couldn't reach this community</p>
            <p style={{ fontSize: 12.5, color: 'var(--ak-text-muted)', marginTop: 4 }}>
              Your connection seems slow or offline - the request never arrived.
            </p>
            <button onClick={retry}
              style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 100, border: 'none', background: BRAND, color: '#fff', fontSize: 12.5, fontWeight: 900, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
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

  /* Creator: settings / people / analytics. Member: profile. — left of the header. */
  const headerRight = isOwner ? (
    <>
      <IconChip icon="ti-settings"  label="Community settings"  onClick={() => navigate(`/communities/${communityId}/settings`)} />
      <IconChip icon="ti-users"     label="Community people"    onClick={() => navigate(`/communities/${communityId}/people`)} />
      <IconChip icon="ti-chart-bar" label="Community analytics" onClick={() => navigate(`/communities/${communityId}/analytics`)} />
    </>
  ) : (
    <IconChip icon="ti-info-circle" label="Community profile" onClick={() => navigate(`/communities/${communityId}/profile`)} />
  );

  const submit = async (a) => {
    setSubmittingId(a.id);
    try {
      await submitCommunityActivity(a.id);
      setActivities(prev => prev.map(x => x.id === a.id
        ? { ...x, my_submitted: true, submissions_count: (x.submissions_count || 0) + 1 }
        : x));
      showToast('Submission recorded');
    } catch (e) {
      showToast(e?.message || 'Could not submit. Try again.');
    } finally { setSubmittingId(null); }
  };

  return (
    <CommunityShell
      title={community.name}
      sub={`${community.member_count || 1} member${(community.member_count || 1) === 1 ? '' : 's'}`}
      backTo="/communities"
      right={headerRight}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {isOwner && (
          <button onClick={() => setSheetOpen(true)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '12px', borderRadius: 14, border: `1.5px dashed ${BRAND}`, background: `${BRAND}08`, color: BRAND, fontSize: 12.5, fontWeight: 900, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
            <Icon name="ti-plus" size={15}/>
            New activity
          </button>
        )}
        {activities.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10, color: BRAND }}>
              <Icon name="ti-clipboard" size={40}/>
            </div>
            <p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>No activities yet</p>
            {isOwner && <p style={{ fontSize: 12.5, color: 'var(--ak-text-muted)', marginTop: 4 }}>Post the first one with “New activity”.</p>}
          </div>
        ) : (
          activities.map(a => <CommunityActivityCard key={a.id} a={a} canSubmit={canSubmit} onSubmit={submit} />)
        )}
      </div>

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
