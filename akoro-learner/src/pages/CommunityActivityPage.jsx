import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchCommunityStrict, fetchCommunityActivitiesStrict,
  createCommunityActivity, submitCommunityActivity,
} from '../services/communityApi.js';
import CommunityShell, { IconChip, useCommunityToast } from '../components/communities/CommunityShell.jsx';
import { Icon } from '../components/common/Icons.jsx';
import { BRAND, RED, GREEN } from '../constants.js';
import Spinner from '../components/common/Spinner.jsx';
import { useInFlight } from '../hooks/useInFlight.js';

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

/* Activity types — the SAME five the instructor workbench drafts
   (ActivitiesPage). Community activities carry their type and, for
   multi_stage journeys, their ordered stages. */
const ACTIVITY_TYPES = [
  { key: 'assignment',  emoji: '\ud83d\udccb', name: 'Assignment' },
  { key: 'project',     emoji: '\ud83d\uddc2\ufe0f', name: 'Project' },
  { key: 'multi_stage', emoji: '\ud83e\udde9', name: 'Multi stage' },
  { key: 'self_study',  emoji: '\ud83d\udcd6', name: 'Self study' },
  { key: 'live_course', emoji: '\ud83d\udcfa', name: 'Live course' },
];
const typeMeta = (t) => ACTIVITY_TYPES.find((x) => x.key === t) || ACTIVITY_TYPES[0];
const STAGE_KINDS = [
  { key: 'self_study', emoji: '\ud83d\udcd6', name: 'Self study' },
  { key: 'assignment', emoji: '\ud83d\udccb', name: 'Assignment' },
  { key: 'project',    emoji: '\ud83d\uddc2\ufe0f', name: 'Project' },
];
const stageKindName = (k) => (STAGE_KINDS.find((x) => x.key === k) || STAGE_KINDS[0]).name;

function dueInfo(dueAt) {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  const text = d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return { text, overdue: d.getTime() < Date.now() };
}

function CommunityActivityCard({ a, canSubmit, onSubmit, submitting = false }) {
  const due = dueInfo(a.dueAt);
  const tm = typeMeta(a.type);
  const meta = [`${tm.emoji} ${tm.name}`, a.subject, a.class_name].filter(Boolean).join(' · ');
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
                <button onClick={() => onSubmit(a)} disabled={submitting}
                  style={{ border: `1.5px solid ${BRAND}`, background: 'transparent', color: BRAND, borderRadius: 100, padding: '3px 12px', fontSize: 10.5, fontWeight: 800, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? .7 : 1, fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5 }}>
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

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {ACTIVITY_TYPES.map((t) => {
              const active = type === t.key;
              return (
                <button key={t.key} type="button" onClick={() => { setType(t.key); setErr(''); }}
                  style={{ padding: '7px 11px', borderRadius: 12, border: `1.5px solid ${active ? BRAND : 'var(--ak-border)'}`, background: active ? `${BRAND}10` : 'transparent', color: active ? BRAND : 'var(--ak-text-muted)', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span>{t.emoji}</span>{t.name}
                </button>
              );
            })}
          </div>
          <input value={name} onChange={e => { setName(e.target.value); setErr(''); }} placeholder="Activity name" maxLength={120} autoFocus style={{ ...FIELD, marginBottom: 10 }}/>
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" maxLength={80} style={{ ...FIELD, flex: 1.2 }}/>
            <input value={klass} onChange={e => setKlass(e.target.value)} placeholder="Class (e.g. CSC 201)" maxLength={80} style={{ ...FIELD, flex: 1 }}/>
          </div>
          <div style={{ height: 10 }}/>
          <input value={due} onChange={e => setDue(e.target.value)} type="datetime-local" style={{ ...FIELD, marginBottom: 10 }}/>
          <textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Instructions (optional)" maxLength={2000} rows={3} style={{ ...FIELD, resize: 'none', marginBottom: 10 }}/>
          {type === 'multi_stage' && (
            <div style={{ marginBottom: 10 }}>
              {stages.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select value={s.kind} onChange={e => setStages(stages.map((x, xi) => xi === i ? { ...x, kind: e.target.value } : x))} style={{ ...FIELD, flex: '0 0 128px' }}>
                    {STAGE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.emoji} {k.name}</option>)}
                  </select>
                  <input value={s.title} onChange={e => setStages(stages.map((x, xi) => xi === i ? { ...x, title: e.target.value } : x))} placeholder={`Stage ${i + 1} title`} maxLength={120} style={{ ...FIELD, flex: 1 }}/>
                  <button type="button" onClick={() => setStages(stages.filter((_, xi) => xi !== i))} title="Remove stage"
                    style={{ width: 34, borderRadius: 12, border: '1px solid var(--ak-border)', background: 'transparent', color: 'var(--ak-text-muted)', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="ti-x" size={14}/>
                  </button>
                </div>
              ))}
              {stages.length < 6 && (
                <button type="button" onClick={() => setStages([...stages, { kind: 'self_study', title: '' }])}
                  style={{ width: '100%', padding: '10px', borderRadius: 12, border: `1.5px dashed ${BRAND}`, background: `${BRAND}08`, color: BRAND, fontSize: 12, fontWeight: 900, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Icon name="ti-plus" size={14}/> Add stage {stages.length + 1} of 6
                </button>
              )}
            </div>
          )}
          {err && <div style={{ fontSize: 12, fontWeight: 700, color: RED, marginBottom: 10 }}>{err}</div>}

          <button onClick={create} disabled={!name.trim() || saving}
            style={{ width: '100%', padding: '13px', borderRadius: 14, cursor: (!name.trim() || saving) ? 'default' : 'pointer', border: 'none', background: (!name.trim() || saving) ? '#C9BCF7' : BRAND, color: '#fff', fontSize: 14, fontWeight: 900, fontFamily: "'Nunito',sans-serif" }}>
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
  const [typeFilter, setTypeFilter] = useState('all');   // workbench-type filter chip
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
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10, color: BRAND }}>
              <Icon name={meta.icon} size={40}/>
            </div>
            <p style={{ fontSize: 14, color: 'var(--ak-text)', fontWeight: 800 }}>{meta.title}</p>
            <p style={{ fontSize: 12.5, color: 'var(--ak-text-muted)', marginTop: 4 }}>
              {error.kind === 'server' ? (error.message || meta.body) : meta.body}
            </p>
            {error.step ? (
              <p style={{ fontSize: 11, color: 'var(--ak-text-muted)', marginTop: 6, opacity: .85 }}>
                The server gave up waiting on: {error.step}
              </p>
            ) : error.timeoutMs ? (
              <p style={{ fontSize: 11, color: 'var(--ak-text-muted)', marginTop: 6, opacity: .85 }}>
                No answer at all within {Math.round(error.timeoutMs / 1000)} seconds - the request may not have reached our server.
              </p>
            ) : null}
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

  // Type filter — 'all' shows everything; others mirror the workbench tabs.
  const visible = typeFilter === 'all' ? activities : activities.filter((a) => (a.type || 'assignment') === typeFilter);

  return (
    <CommunityShell
      title={community.name}
      sub={`${community.member_count || 1} member${(community.member_count || 1) === 1 ? '' : 's'}`}
      backTo="/communities"
      right={headerRight}
    >
      {/* Workbench-type filter chips — same five types, counts included. */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', padding: '10px 18px', borderBottom: '1px solid var(--ak-border)', background: 'var(--ak-surface)', flexShrink: 0 }}>
        {[{ key: 'all', emoji: '', name: 'All' }, ...ACTIVITY_TYPES].map((t) => {
          const active = typeFilter === t.key;
          const n = t.key === 'all'
            ? activities.length
            : activities.filter((a) => (a.type || 'assignment') === t.key).length;
          return (
            <button key={t.key} onClick={() => setTypeFilter(t.key)}
              style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 20, border: `1px solid ${active ? BRAND : 'var(--ak-border)'}`, background: active ? `${BRAND}12` : 'var(--ak-surface)', color: active ? BRAND : 'var(--ak-text-muted)', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {t.emoji && <span>{t.emoji}</span>}{t.name}{n > 0 && <span style={{ opacity: .65 }}>{n}</span>}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {isOwner && (
          <button onClick={() => setSheetOpen(true)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '12px', borderRadius: 14, border: `1.5px dashed ${BRAND}`, background: `${BRAND}08`, color: BRAND, fontSize: 12.5, fontWeight: 900, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
            <Icon name="ti-plus" size={15}/>
            New activity
          </button>
        )}
        {visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10, color: BRAND }}>
              <Icon name="ti-clipboard" size={40}/>
            </div>
            <p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>No activities yet</p>
            {isOwner && <p style={{ fontSize: 12.5, color: 'var(--ak-text-muted)', marginTop: 4 }}>Post the first one with “New activity”.</p>}
          </div>
        ) : (
          visible.map(a => <CommunityActivityCard key={a.id} a={a} canSubmit={canSubmit} onSubmit={submit} submitting={submitBusy} />)
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
