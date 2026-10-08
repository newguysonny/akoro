import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchCommunityStrict, fetchCommunityActivitiesStrict,
  createCommunityActivity, submitCommunityActivity, joinCommunity, leaveCommunity,
} from '../services/communityApi.js';
import CommunityShell, { IconChip, useCommunityToast, CommunityEmptyState, SectionTitle, ACCENTS } from '../components/communities/CommunityShell.jsx';
import { Icon } from '../components/common/Icons.jsx';
import { BRAND, RED, GREEN } from '../constants.js';
import Spinner from '../components/common/Spinner.jsx';
import { useInFlight } from '../hooks/useInFlight.js';

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
 *     the reference's empty state (per tab), and a "Popular activities"
 *     rail (the reference's "Popular materials" pattern) ranking the
 *     community's activities by submissions.
 *
 * Types carry line icons (the reference replaces emoji throughout); the
 * stored community emoji still renders in the header tile.
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
  return `${Math.floor(h / 24)}d ago`;
}

/* Activity types — the SAME five the instructor workbench drafts
   (ActivitiesPage). Community activities carry their type and, for
   multi_stage journeys, their ordered stages. Icons, not emoji — the
   reference's rule ("replaces emoji throughout"). */
const ACTIVITY_TYPES = [
  { key: 'assignment',  icon: 'ti-clipboard', name: 'Assignment' },
  { key: 'project',     icon: 'ti-folder',    name: 'Project' },
  { key: 'multi_stage', icon: 'ti-puzzle',    name: 'Multi stage' },
  { key: 'self_study',  icon: 'ti-book',      name: 'Self study' },
  { key: 'live_course', icon: 'ti-video',     name: 'Live course' },
];
const typeMeta = (t) => ACTIVITY_TYPES.find((x) => x.key === t) || ACTIVITY_TYPES[0];
const STAGE_KINDS = [
  { key: 'self_study',  icon: 'ti-book',      emoji: '📖', name: 'Self study' },
  { key: 'assignment',  icon: 'ti-clipboard', emoji: '📋', name: 'Assignment' },
  { key: 'project',     icon: 'ti-folder',    emoji: '🗂️', name: 'Project' },
];
const stageKindName = (k) => (STAGE_KINDS.find((x) => x.key === k) || STAGE_KINDS[0]).name;

/* The reference's tab rail: All + the five types, each with its per-tab
   empty-state copy. */
const TABS = [
  { key: 'all',         icon: null,            name: 'All',         emptyTitle: 'No activities yet',          emptySub: 'Post the first one with "New activity".' },
  { key: 'assignment',  icon: 'ti-clipboard',  name: 'Assignment',  emptyTitle: 'No assignments yet' },
  { key: 'project',     icon: 'ti-folder',     name: 'Project',     emptyTitle: 'No projects yet' },
  { key: 'multi_stage', icon: 'ti-puzzle',     name: 'Multi stage', emptyTitle: 'No multi-step activities yet' },
  { key: 'self_study',  icon: 'ti-book',       name: 'Self study',  emptyTitle: 'No self-study activities yet' },
  { key: 'live_course', icon: 'ti-video',      name: 'Live course', emptyTitle: 'No live courses yet' },
];

function dueInfo(dueAt) {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  const text = d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return { text, overdue: d.getTime() < Date.now() };
}

/* One activity, in the reference's row language: a solid accent thumb with
   the type's line icon, then name / meta / due / stages / the submit row. */
function CommunityActivityCard({ a, canSubmit, onSubmit, submitting = false, accent }) {
  const due = dueInfo(a.dueAt);
  const tm = typeMeta(a.type);
  const meta = [tm.name, a.subject, a.class_name].filter(Boolean).join(' · ');
  return (
    <div style={{ padding: '13px 15px', background: 'var(--ak-surface)', borderRadius: 'var(--r-lg)', border: '1px solid var(--ak-border2)', display: 'flex', gap: 'var(--s-3)', alignItems: 'flex-start' }}>
      <div style={{ width: 42, height: 42, borderRadius: 'var(--r-sm)', flexShrink: 0, background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={tm.icon} size={18}/>
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
        {Array.isArray(a.stages) && a.stages.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {a.stages.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: `${BRAND}14`, color: BRAND, fontSize: 9.5, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--ak-text-muted)', background: 'var(--ak-border)', padding: '1px 6px', borderRadius: 5, flexShrink: 0 }}>{stageKindName(s.kind)}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, color: BRAND, background: `${BRAND}12`, borderRadius: 'var(--r-full)', padding: '2px 9px' }}>
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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, color: GREEN, background: 'rgba(16,185,129,.10)', borderRadius: 'var(--r-full)', padding: '3px 10px' }}>
                  <Icon name="ti-circle-check" size={12}/>
                  Submitted
                </span>
              ) : (
                <button onClick={() => onSubmit(a)} disabled={submitting}
                  style={{ border: `1.5px solid ${BRAND}`, background: 'transparent', color: BRAND, borderRadius: 'var(--r-full)', padding: '3px 12px', fontSize: 10.5, fontWeight: 800, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? .7 : 1, fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  {submitting ? <Spinner size={11} color={BRAND}/> : 'Submit'}
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* The reference's field style, shared by the sheet. */
const FIELD = {
  width: '100%', boxSizing: 'border-box', borderRadius: 'var(--r-md)', padding: '12px 14px',
  border: '1.5px solid var(--ak-border2)', background: 'var(--ak-surface)', color: 'var(--ak-text)',
  fontFamily: "'Nunito',sans-serif", fontSize: 14, outline: 'none',
};

function NewActivitySheet({ community, onClose, onCreated }) {
  const [name, setName]         = useState('');
  const [subject, setSubject]   = useState('');
  const [klass, setKlass]       = useState('');
  const [due, setDue]           = useState('');
  const [instructions, setInstructions] = useState('');
  const [type, setType]         = useState('assignment');
  const [stages, setStages]     = useState([]);
  // One request at a time — repeated taps on a bad connection once fired
  // repeated POSTs and created duplicate activities.
  const { busy: saving, run: runSave } = useInFlight();
  const [err, setErr]           = useState('');

  const create = () => runSave(async () => {
    if (!name.trim()) return;
    const cleanStages = stages
      .map((s) => ({ kind: STAGE_KINDS.some((k) => k.key === s.kind) ? s.kind : 'self_study', title: String(s.title || '').trim() }))
      .filter((s) => s.title);
    if (type === 'multi_stage' && !cleanStages.length) {
      setErr('Add at least one stage with a title.');
      return;
    }
    setErr('');
    try {
      const a = await createCommunityActivity(community.id, {
        name: name.trim(),
        type,
        stages: type === 'multi_stage' ? cleanStages : undefined,
        subject: subject.trim() || undefined,
        class: klass.trim() || undefined,
        dueAt: due ? new Date(due).toISOString() : undefined,
        instructions: instructions.trim() || undefined,
      });
      onCreated(a);
    } catch (e) {
      setErr(e?.message || 'Something went wrong. Try again.');
    }
  });

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'var(--ak-overlay)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--ak-surface)', width: '100%', maxWidth: 540, maxHeight: '88vh', overflowY: 'auto', borderRadius: '22px 22px 0 0', fontFamily: "'Nunito',sans-serif", animation: 'sheet-up .28s cubic-bezier(.34,1.4,.6,1)' }}>
        <style>{`
          @keyframes sheet-up{from{transform:translateY(40px);opacity:.4}to{transform:translateY(0);opacity:1}}
          .ak-cm-field:focus{outline:2px solid ${BRAND};outline-offset:1px}
        `}</style>
        <div style={{ padding: '10px 0 4px', display: 'flex', justifyContent: 'center', position: 'sticky', top: 0, background: 'var(--ak-surface)', zIndex: 1 }}>
          <div style={{ width: 38, height: 4, borderRadius: 4, background: 'var(--ak-border2)' }} />
        </div>
        <div style={{ padding: '6px 18px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 14px' }}>
            <h2 style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>New activity</h2>
            <button onClick={onClose} aria-label="Close" style={{ background: `${BRAND}14`, border: 'none', borderRadius: 'var(--r-full)', width: 30, height: 30, cursor: 'pointer', color: 'var(--ak-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="ti-x" size={16}/>
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {ACTIVITY_TYPES.map((t) => {
              const active = type === t.key;
              return (
                <button key={t.key} type="button" onClick={() => { setType(t.key); setErr(''); }}
                  style={{ padding: '7px 12px', borderRadius: 'var(--r-full)', border: `1px solid ${active ? BRAND : 'var(--ak-border2)'}`, background: active ? `${BRAND}10` : 'var(--ak-surface)', color: active ? BRAND : 'var(--ak-text-sub)', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon name={t.icon} size={14}/>{t.name}
                </button>
              );
            })}
          </div>
          <input value={name} onChange={e => { setName(e.target.value); setErr(''); }} placeholder="Activity name" maxLength={120} autoFocus className="ak-cm-field" style={{ ...FIELD, marginBottom: 10 }}/>
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" maxLength={80} className="ak-cm-field" style={{ ...FIELD, flex: 1.2 }}/>
            <input value={klass} onChange={e => setKlass(e.target.value)} placeholder="Class (e.g. CSC 201)" maxLength={80} className="ak-cm-field" style={{ ...FIELD, flex: 1 }}/>
          </div>
          <div style={{ height: 10 }}/>
          <input value={due} onChange={e => setDue(e.target.value)} type="datetime-local" className="ak-cm-field" style={{ ...FIELD, marginBottom: 10 }}/>
          <textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Instructions (optional)" maxLength={2000} rows={3} className="ak-cm-field" style={{ ...FIELD, resize: 'none', marginBottom: 10 }}/>
          {type === 'multi_stage' && (
            <div style={{ marginBottom: 10 }}>
              {stages.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select value={s.kind} onChange={e => setStages(stages.map((x, xi) => xi === i ? { ...x, kind: e.target.value } : x))} className="ak-cm-field" style={{ ...FIELD, flex: '0 0 128px' }}>
                    {STAGE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.emoji} {k.name}</option>)}
                  </select>
                  <input value={s.title} onChange={e => setStages(stages.map((x, xi) => xi === i ? { ...x, title: e.target.value } : x))} placeholder={`Stage ${i + 1} title`} maxLength={120} className="ak-cm-field" style={{ ...FIELD, flex: 1 }}/>
                  <button type="button" onClick={() => setStages(stages.filter((_, xi) => xi !== i))} title="Remove stage"
                    style={{ width: 34, borderRadius: 'var(--r-md)', border: '1px solid var(--ak-border2)', background: 'transparent', color: 'var(--ak-text-muted)', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="ti-x" size={14}/>
                  </button>
                </div>
              ))}
              {stages.length < 6 && (
                <button type="button" onClick={() => setStages([...stages, { kind: 'self_study', title: '' }])}
                  style={{ width: '100%', padding: '10px', borderRadius: 'var(--r-md)', border: `1.5px dashed ${BRAND}`, background: `${BRAND}08`, color: BRAND, fontSize: 12, fontWeight: 900, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Icon name="ti-plus" size={14}/> Add stage {stages.length + 1} of 6
                </button>
              )}
            </div>
          )}
          {err && <div style={{ fontSize: 12, fontWeight: 700, color: RED, marginBottom: 10 }}>{err}</div>}

          <button onClick={create} disabled={!name.trim() || saving}
            style={{ width: '100%', padding: '13px', borderRadius: 'var(--r-full)', cursor: (!name.trim() || saving) ? 'default' : 'pointer', border: 'none', background: (!name.trim() || saving) ? '#C9BCF7' : BRAND, color: '#fff', fontSize: 14, fontWeight: 900, fontFamily: "'Nunito',sans-serif" }}>
            {saving ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Spinner size={13}/> Posting…</span> : 'Post activity'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* The error state tells the truth about WHY nothing arrived. "Your
   connection" is one cause of four — a learner on a perfectly good
   connection was told to blame their network while a server-side stall
   was the real culprit. Kinds:
     slow    the request was dropped after waiting too long (our client
             deadline, or the server's own 504 — which names the query
             step it gave up waiting on)
     setup   the server answered 503: communities are still being set up
     server  any other server-side answer — the API writes user-facing
             copy, so its message is shown
     network the request never arrived at all (offline / dropped) */
const ERROR_STATES = {
  slow: {
    icon: 'ti-hourglass', title: 'This community is taking too long to load',
    body: "The request waited too long and was dropped - that's on our side, not your connection.",
  },
  setup: {
    icon: 'ti-settings', title: 'Communities are still being set up',
    body: 'The server is finishing a setup step. Please try again in a minute.',
  },
  server: {
    icon: 'ti-server', title: 'Something went wrong on our side',
    body: 'Please try again in a moment.',
  },
  network: {
    icon: 'ti-wifi-off', title: "Couldn't reach this community",
    body: 'Your connection seems slow or offline - the request never arrived.',
  },
};

function classifyError(e) {
  if (e?.status === 404 || e?.status === 403) return { kind: 'missing' };
  if (e?.timedOut || e?.status === 504) return { kind: 'slow', step: e?.step, timeoutMs: e?.timeoutMs };
  if (e?.status === 503) return { kind: 'setup' };
  if (e?.status) return { kind: 'server', message: e?.message };
  return { kind: 'network' };
}

export default function CommunityActivityPage() {
  const navigate   = useNavigate();
  const { communityId } = useParams();
  const [community, setCommunity]   = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [sheetOpen, setSheetOpen]   = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [submittingId, setSubmittingId] = useState(null);
  const [showToast, toastNode] = useCommunityToast();
  // null = ok/loading; otherwise classifyError's verdict — 'missing' (the
  // API answered "no such community / not yours") falls through to the
  // not-found card below, every other kind gets its honest error card.
  // A degraded connection must never read as "Community not found".
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, list] = await Promise.all([fetchCommunityStrict(communityId), fetchCommunityActivitiesStrict(communityId)]);
      setCommunity(c);
      setActivities(list);
      setError(null);
    } catch (e) {
      setError(classifyError(e));
    } finally { setLoading(false); }
  }, [communityId]);

  useEffect(() => { load(); }, [load]);
  const retry = () => { setLoading(true); setError(null); load(); };

  // ALL hooks must run before the early returns below — this one used to sit
  // after them, so the moment loading flipped to false the component rendered
  // MORE hooks than its previous pass and React threw ("Rendered more hooks
  // than during the previous render"), killing the page right as data landed.
  // One submission in the air at a time — a double-tapped Submit on a slow
  // connection used to fire the request twice.
  const { busy: submitBusy, run: runSubmit } = useInFlight();
  const submit = (a) => runSubmit(async () => {
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
  });

  /* Follow / Following — wired to the real join + leave endpoints, with an
     optimistic flip that rolls back if the request fails. Owners never see
     the button (they delete the community instead). */
  const { busy: followBusy, run: runFollow } = useInFlight();
  const toggleFollow = () => runFollow(async () => {
    const wasMember = !!community.my_role;
    setCommunity(c => c && ({
      ...c,
      my_role: wasMember ? null : 'member',
      member_count: Math.max(0, (c.member_count || 1) + (wasMember ? -1 : 1)),
    }));
    try {
      if (wasMember) await leaveCommunity(communityId);
      else await joinCommunity(communityId);
    } catch (e) {
      setCommunity(c => c && ({
        ...c,
        my_role: wasMember ? 'member' : null,
        member_count: Math.max(0, (c.member_count || 1) + (wasMember ? 1 : -1)),
      }));
      showToast(e?.message || 'Could not update your membership. Try again.');
    }
  });

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

      {/* Popular activities — the reference's "Popular materials" rail
          (ranked rows), fed by the community's real submission counts. */}
      {activities.length > 4 && (
        <>
          <SectionTitle>Popular activities</SectionTitle>
          {[...activities]
            .sort((x, y) => (y.submissions_count || 0) - (x.submissions_count || 0))
            .slice(0, 4)
            .map((a, i) => {
              const tm = typeMeta(a.type);
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', padding: '9px 0' }}>
                  <div style={{ width: 18, textAlign: 'center', color: 'var(--ak-text-muted)', fontWeight: 800, fontSize: 13.5, flexShrink: 0 }}>{i + 1}</div>
                  <div style={{ width: 42, height: 42, borderRadius: 'var(--r-sm)', flexShrink: 0, background: ACCENTS[i % ACCENTS.length], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={tm.icon} size={18}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ak-text-sub)', fontWeight: 600, marginTop: 1 }}>
                      {a.submissions_count || 0} submission{(a.submissions_count || 0) === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              );
            })}
        </>
      )}

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
