/**
 * Learner-approved Agent Chat tool / integration requests.
 *
 * This is a product-review queue, not a chat-transcript viewer. The API sends
 * only the compact request the learner approved and the account identity admins
 * already manage; administrators cannot provision an integration from here.
 */
import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, KeyRound, RefreshCw, Search, ShieldCheck, Wrench } from 'lucide-react';

import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Sel, Skeleton, Toast, Txa } from '../components/Primitives.jsx';
import { apiGet, apiPatch, apiPost } from '../services/api.js';
import { AMBER, BORDER, GREEN, INK, LIGHT, MUTED, MUTED2, RED, WHITE, FONT, PURPLE, BLUE } from '../constants.js';

const STATUS = {
  new:          { label: 'New',          color: AMBER,  bg: '#FFF7ED' },
  under_review: { label: 'Under review', color: BLUE,   bg: '#EFF6FF' },
  planned:      { label: 'Planned',      color: PURPLE, bg: '#F5F3FF' },
  approved:     { label: 'Approved',     color: GREEN,  bg: '#ECFDF5' },
  declined:     { label: 'Declined',     color: RED,    bg: '#FEF2F2' },
  implemented:  { label: 'Implemented',  color: GREEN,  bg: '#ECFDF5' },
  expired:      { label: 'Expired',      color: MUTED,  bg: LIGHT },
};
// Statuses a plain review can set; approved/expired come from Decide and the expiry sweep.
const REVIEW_STATUSES = ['new', 'under_review', 'planned', 'declined', 'implemented'];

const KINDS = [
  { key: 'tool', label: 'Tool ideas' },
  { key: 'capability', label: 'Permissions' },
  { key: 'grants', label: 'Granted' },
];

const RESUME = { waiting: 'Waiting', resuming: 'Resuming…', resumed: 'Answered in chat', failed: 'Resume failed', expired: 'Expired', cancelled: 'Cancelled' };

const CATEGORIES = {
  study_support: 'Study support',
  organisation: 'Organisation',
  integration: 'Integration',
  accessibility: 'Accessibility',
  other: 'Other',
};

const formatWhen = (value) => value ? new Date(value).toLocaleString(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '—';

function StatusPill({ status }) {
  const item = STATUS[status] || STATUS.new;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 999,
    background: item.bg, color: item.color, fontFamily: FONT, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.color }} />{item.label}
  </span>;
}

function CategoryPill({ category }) {
  return <span style={{ display: 'inline-flex', padding: '4px 9px', borderRadius: 999,
    background: LIGHT, border: `1px solid ${BORDER}`, color: MUTED, fontFamily: FONT, fontSize: 11, fontWeight: 600 }}>
    {CATEGORIES[category] || 'Other'}
  </span>;
}

export default function AgentToolRequestsPage() {
  const [requests, setRequests] = useState([]);
  const [statusCounts, setStatusCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [activeStatus, setActiveStatus] = useState('');
  const [kind, setKind] = useState('tool');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (kind === 'grants') { setLoading(false); return; }
      const params = new URLSearchParams({ limit: '100', kind });
      if (activeStatus) params.set('status', activeStatus);
      if (submittedSearch) params.set('search', submittedSearch);
      const result = await apiGet(`/api/admin/agent-tool-requests?${params}`);
      setRequests(result.requests || []);
      setStatusCounts(result.statusCounts || {});
      setTotal(result.total || 0);
      setError('');
    } catch (e) {
      setError(e.message || 'Could not load Agent Chat tool requests.');
    } finally {
      setLoading(false);
    }
  }, [activeStatus, submittedSearch, kind]);

  useEffect(() => { load(); }, [load]);

  async function saveReview({ status, adminNote }) {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await apiPatch(`/api/admin/agent-tool-requests/${selected.id}`, { status, adminNote });
      setSelected(result.request);
      setToast({ type: 'success', message: 'Request review saved.' });
      await load();
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'Could not save this review.' });
    } finally {
      setBusy(false);
    }
  }

  async function decide({ decision, note, expiresInDays }) {
    if (!selected) return;
    setBusy(true);
    try {
      const expiresAt = expiresInDays ? new Date(Date.now() + Number(expiresInDays) * 86_400_000).toISOString() : null;
      const result = await apiPost(`/api/admin/agent-tool-requests/${selected.id}/decide`, { decision, note, expiresAt });
      setToast({ type: 'success', message: decision === 'approve'
        ? `Approved for everyone — resuming ${result.resuming} learner request${result.resuming === 1 ? '' : 's'}.`
        : decision === 'deny' ? 'Declined — the learner was told in their chat.' : 'Marked as planned — the learner was told.' });
      setSelected(null);
      await load();
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'Could not save the decision.' });
    } finally {
      setBusy(false);
    }
  }

  const shownCount = requests.length;
  const filterButton = (key, label) => {
    const selectedFilter = activeStatus === key;
    const count = key ? (statusCounts[key] || 0) : Object.values(statusCounts).reduce((sum, n) => sum + Number(n || 0), total);
    return <button key={key || 'all'} onClick={() => setActiveStatus(key)} style={{
      border: `1px solid ${selectedFilter ? AMBER : BORDER}`, background: selectedFilter ? '#FFF7ED' : WHITE,
      color: selectedFilter ? INK : MUTED, borderRadius: 999, padding: '7px 11px', cursor: 'pointer',
      fontFamily: FONT, fontWeight: selectedFilter ? 700 : 600, fontSize: 12, whiteSpace: 'nowrap',
    }}>{label} <span style={{ color: selectedFilter ? AMBER : MUTED2, marginLeft: 3 }}>{count}</span></button>;
  };

  return (
    <PageLayout
      title="Agent tool requests"
      subtitle="Learner-approved ideas for future tools and integrations"
      action={<Btn variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} /> Refresh</Btn>}
    >
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      <div style={{ maxWidth: 1220, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '13px 15px', marginBottom: 18,
          border: `1px solid ${BORDER}`, borderRadius: 12, background: '#FFFBEB' }}>
          <ShieldCheck size={18} color={AMBER} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontFamily: FONT, color: INK, fontSize: 13, lineHeight: 1.55 }}>
            <strong>Privacy boundary:</strong> this queue contains the concise capability request a learner approved—not their raw Agent Chat message, files, memory, or hidden working context. Updating a review status does not add a tool or connect an integration.
          </div>
        </div>

        <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 14, borderBottom: `1px solid ${BORDER}` }}>
          {KINDS.map((k) => <button key={k.key} role="tab" aria-selected={kind === k.key} onClick={() => { setKind(k.key); setActiveStatus(''); }} style={{
            border: 'none', background: 'none', padding: '9px 12px', cursor: 'pointer', fontFamily: FONT, fontSize: 13,
            fontWeight: kind === k.key ? 700 : 600, color: kind === k.key ? INK : MUTED,
            borderBottom: `2px solid ${kind === k.key ? AMBER : 'transparent'}`, marginBottom: -1,
          }}>{k.label}</button>)}
        </div>
        {kind === 'grants' ? <GrantsPanel onToast={setToast} /> : <>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {filterButton('', 'All')}
            {Object.entries(STATUS).map(([key, item]) => filterButton(key, item.label))}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); setSubmittedSearch(search.trim()); }} style={{ display: 'flex', gap: 8, flex: '1 1 280px', maxWidth: 390 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={15} color={MUTED} style={{ position: 'absolute', top: '50%', left: 11, transform: 'translateY(-50%)' }} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search request text…" aria-label="Search tool requests"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px 9px 33px', borderRadius: 9, border: `1px solid ${BORDER}`, background: WHITE, color: INK, fontFamily: FONT, fontSize: 13, outline: 'none' }} />
            </div>
            <Btn type="submit" variant="secondary" size="sm">Search</Btn>
          </form>
        </div>

        {loading && <Skeleton height={250} />}
        {error && !loading && <div style={{ padding: 18, background: '#FEF2F2', color: RED, borderRadius: 12, fontFamily: FONT, fontSize: 13 }}>{error}</div>}
        {!loading && !error && (
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderBottom: `1px solid ${BORDER}`, background: LIGHT }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT, color: INK, fontSize: 13, fontWeight: 700 }}><ClipboardList size={16} color={AMBER} /> {shownCount} of {total} request{total === 1 ? '' : 's'}</div>
              <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED }}>Newest first</div>
            </div>
            {requests.length === 0 ? <EmptyState kind={kind} activeStatus={activeStatus} hasSearch={!!submittedSearch} /> : <RequestList requests={requests} onOpen={setSelected} />}
          </div>
        )}
        </>}
      </div>
      {selected?.kind === 'capability'
        ? <DecideModal request={selected} busy={busy} onClose={() => setSelected(null)} onDecide={decide} />
        : <ReviewModal request={selected} busy={busy} onClose={() => setSelected(null)} onSave={saveReview} />}
    </PageLayout>
  );
}

function EmptyState({ kind, activeStatus, hasSearch }) {
  const permissions = kind === 'capability';
  const message = hasSearch ? 'No requests match that search.' : activeStatus ? `No ${STATUS[activeStatus]?.label.toLowerCase() || 'matching'} requests.` : permissions ? 'No permission requests waiting.' : 'No learner-approved tool requests yet.';
  const hint = permissions
    ? "These appear on their own when a learner's agent builds a tool that needs a permission that's off — approve it here and the tool is finished in their chat."
    : 'Agent Chat never files these automatically; the learner must ask for submission.';
  return <div style={{ minHeight: 220, display: 'grid', placeItems: 'center', padding: 28, textAlign: 'center' }}>
    <div><div style={{ width: 46, height: 46, display: 'inline-grid', placeItems: 'center', background: '#FFF7ED', borderRadius: 14, marginBottom: 10 }}><Wrench size={21} color={AMBER} /></div>
      <div style={{ fontFamily: FONT, color: INK, fontWeight: 700, fontSize: 14 }}>{message}</div>
      <div style={{ fontFamily: FONT, color: MUTED, fontSize: 12, marginTop: 5, maxWidth: 460 }}>{hint}</div>
    </div>
  </div>;
}

function RequestList({ requests, onOpen }) {
  return <div>
    {requests.map((request) => {
      const person = request.requester?.fullName || request.requester?.username || request.requester?.email || 'Learner account';
      return <button key={request.id} onClick={() => onOpen(request)} style={{ width: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 16, textAlign: 'left', padding: '16px', border: 'none', borderBottom: `1px solid ${BORDER}`, background: WHITE, cursor: 'pointer', fontFamily: FONT }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: INK, fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{request.capability?.tool?.label || request.title}</div>
          <div style={{ color: MUTED, fontSize: 12.5, lineHeight: 1.45, marginTop: 5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{request.capability ? `${request.capability.goal || ''} — needs: ${request.capability.does || request.capability.name}` : request.description}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, color: MUTED2, fontSize: 11.5, marginTop: 9 }}>
            <span>{person}</span><span>•</span><span>{formatWhen(request.createdAt)}</span>
            {request.capability?.askedBy > 1 && <><span>•</span><span>{request.capability.askedBy} learners asked</span></>}
            {request.capability?.resumeStatus && request.status === 'approved' && <><span>•</span><span>{RESUME[request.capability.resumeStatus] || request.capability.resumeStatus}</span></>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{request.capability ? <RiskPills risk={request.capability.risk} /> : <CategoryPill category={request.category} />}<StatusPill status={request.status} /></div>
      </button>;
    })}
  </div>;
}

function ReviewModal({ request, busy, onClose, onSave }) {
  const [status, setStatus] = useState('new');
  const [adminNote, setAdminNote] = useState('');
  useEffect(() => {
    setStatus(request?.status || 'new');
    setAdminNote(request?.adminNote || '');
  }, [request]);
  if (!request) return null;
  const person = request.requester?.fullName || request.requester?.username || request.requester?.email || 'Learner account';
  return <Modal open={!!request} onClose={busy ? () => {} : onClose} title="Review tool request" width={720}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 15 }}><CategoryPill category={request.category} /><StatusPill status={request.status} /></div>
    <h3 style={{ margin: '0 0 7px', color: INK, fontFamily: FONT, fontSize: 17 }}>{request.title}</h3>
    <p style={{ margin: '0 0 16px', color: MUTED, fontFamily: FONT, fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{request.description}</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, padding: 12, background: LIGHT, borderRadius: 10, marginBottom: 18, fontFamily: FONT, fontSize: 12 }}>
      <div><div style={{ color: MUTED2, marginBottom: 3 }}>Requested by</div><div style={{ color: INK, fontWeight: 600 }}>{person}</div>{request.requester?.email && <div style={{ color: MUTED, marginTop: 2 }}>{request.requester.email}</div>}</div>
      <div><div style={{ color: MUTED2, marginBottom: 3 }}>Submitted</div><div style={{ color: INK, fontWeight: 600 }}>{formatWhen(request.createdAt)}</div></div>
      <div><div style={{ color: MUTED2, marginBottom: 3 }}>Last status change</div><div style={{ color: INK, fontWeight: 600 }}>{formatWhen(request.lastStatusChangedAt)}</div></div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, .55fr) minmax(0, 1.45fr)', gap: 12, alignItems: 'start' }}>
      <Sel label="Review status" value={status} onChange={(event) => setStatus(event.target.value)}>
        {REVIEW_STATUSES.map((key) => <option key={key} value={key}>{STATUS[key].label}</option>)}
      </Sel>
      <Txa label="Internal review note" value={adminNote} onChange={(event) => setAdminNote(event.target.value.slice(0, 1000))} placeholder="Why this is planned, declined, or needs follow-up…" rows={4} />
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 18 }}>
      <div style={{ color: MUTED, fontFamily: FONT, fontSize: 11.5 }}>Internal notes are not returned to the learner through Agent Chat.</div>
      <div style={{ display: 'flex', gap: 8 }}><Btn variant="secondary" onClick={onClose} disabled={busy}>Cancel</Btn><Btn onClick={() => onSave({ status, adminNote })} disabled={busy}>{busy ? 'Saving…' : 'Save review'}</Btn></div>
    </div>
  </Modal>;
}

function RiskPills({ risk = {} }) {
  const pill = (text, color, bg) => <span key={text} style={{ display: 'inline-flex', padding: '4px 9px', borderRadius: 999, background: bg, color, fontFamily: FONT, fontSize: 11, fontWeight: 700 }}>{text}</span>;
  return <>
    {risk.othersData && pill("Other learners' data", AMBER, '#FFF7ED')}
    {risk.writes && pill('Changes data', RED, '#FEF2F2')}
    {!risk.othersData && !risk.writes && pill('Own data, read-only', GREEN, '#ECFDF5')}
  </>;
}

/** A permission the learner's agent asked for: approve turns it on for EVERYONE. */
function DecideModal({ request, busy, onClose, onDecide }) {
  const [note, setNote] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  useEffect(() => { setNote(''); setExpiresInDays(''); }, [request]);
  const c = request.capability || {};
  const open = ['new', 'under_review', 'planned'].includes(request.status);
  const person = request.requester?.fullName || request.requester?.username || request.requester?.email || 'Learner account';
  const cell = (label, value) => <div><div style={{ color: MUTED2, marginBottom: 3 }}>{label}</div><div style={{ color: INK, fontWeight: 600 }}>{value}</div></div>;
  return <Modal open={!!request} onClose={busy ? () => {} : onClose} title="Permission request" width={720}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 15 }}><RiskPills risk={c.risk} /><StatusPill status={request.status} /></div>
    <h3 style={{ margin: '0 0 7px', color: INK, fontFamily: FONT, fontSize: 17 }}>{c.tool?.label || request.title}</h3>
    <p style={{ margin: '0 0 6px', color: INK, fontFamily: FONT, fontSize: 13.5, lineHeight: 1.6 }}><strong>Learner's goal:</strong> {c.goal || '—'}</p>
    <p style={{ margin: '0 0 16px', color: MUTED, fontFamily: FONT, fontSize: 13.5, lineHeight: 1.6 }}><strong>Needs:</strong> {c.does || c.name} <code style={{ fontSize: 12 }}>{c.name}</code></p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, padding: 12, background: LIGHT, borderRadius: 10, marginBottom: 18, fontFamily: FONT, fontSize: 12 }}>
      {cell('Requested by', person)}
      {cell('Learners asking', c.askedBy ?? 1)}
      {cell('Submitted', formatWhen(request.createdAt))}
      {cell('Expires', formatWhen(c.expiresAt))}
      {c.resumeStatus && cell('Resume', RESUME[c.resumeStatus] || c.resumeStatus)}
    </div>
    {c.resumeResult?.reason && <div style={{ padding: 10, background: '#FEF2F2', color: RED, borderRadius: 9, fontFamily: FONT, fontSize: 12, marginBottom: 14 }}>Last resume: {c.resumeResult.reason}</div>}
    {open ? <>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, .5fr) minmax(0, 1.5fr)', gap: 12, alignItems: 'start' }}>
        <Sel label="Approval lasts" value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)} disabled={!c.risk?.grantable}>
          <option value="">Until revoked</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
        </Sel>
        <Txa label="Note (shown to the learner if you decline or plan it)" value={note} onChange={(event) => setNote(event.target.value.slice(0, 500))} placeholder="e.g. We'll add this after the privacy review." rows={3} />
      </div>
      <div style={{ padding: '10px 12px', background: '#FFFBEB', border: `1px solid ${BORDER}`, borderRadius: 9, marginTop: 14, fontFamily: FONT, fontSize: 12, color: INK, lineHeight: 1.5 }}>
        <KeyRound size={13} color={AMBER} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        Approving turns this on for <strong>every learner</strong> and finishes every waiting request for it — each learner gets the answer in their chat.
        {c.risk?.writes && c.risk?.grantable && <> Tools using it can change learners' data — every change still waits for the learner to confirm it on a card.</>}
        {!c.risk?.grantable && <> This one can't be approved yet (no tool can make this kind of change) — plan or decline it.</>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <Btn variant="secondary" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="secondary" onClick={() => onDecide({ decision: 'deny', note })} disabled={busy}>Decline</Btn>
        <Btn variant="secondary" onClick={() => onDecide({ decision: 'plan', note })} disabled={busy}>Plan it</Btn>
        <Btn onClick={() => onDecide({ decision: 'approve', note, expiresInDays })} disabled={busy || !c.risk?.grantable}>{busy ? 'Saving…' : 'Approve for everyone'}</Btn>
      </div>
    </> : <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Btn variant="secondary" onClick={onClose}>Close</Btn></div>}
  </Modal>;
}

/** Granted permissions — revoke turns one off for everyone at once. */
function GrantsPanel({ onToast }) {
  const [grants, setGrants] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const load = useCallback(async () => {
    try { setGrants((await apiGet('/api/admin/capability-grants')).grants || []); }
    catch (e) { onToast({ type: 'error', message: e.message || 'Could not load grants.' }); setGrants([]); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);
  async function revoke(g) {
    const who = g.forLearner ? (g.forLearner.username ? `@${g.forLearner.username}` : 'this learner') : 'everyone';
    if (!window.confirm(`Turn off "${g.does || g.capability}" for ${who}? Tools that use it stop at once.`)) return;
    setBusyId(g.id);
    try { await apiPost(`/api/admin/capability-grants/${g.id}/revoke`, {}); onToast({ type: 'success', message: 'Revoked.' }); await load(); }
    catch (e) { onToast({ type: 'error', message: e.message || 'Could not revoke.' }); }
    finally { setBusyId(null); }
  }
  if (!grants) return <Skeleton height={200} />;
  const shown = grants.filter((g) => g.active || g.revoked_at);
  if (!shown.length) return <div style={{ padding: 28, textAlign: 'center', fontFamily: FONT, color: MUTED, fontSize: 13, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14 }}>No permissions have been granted yet.</div>;
  return <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
    {shown.map((g) => <div key={g.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, padding: 16, borderBottom: `1px solid ${BORDER}`, fontFamily: FONT }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: INK, fontWeight: 700, fontSize: 14 }}>{g.does || g.capability}</div>
        <div style={{ color: MUTED2, fontSize: 11.5, marginTop: 6 }}><code>{g.capability}</code> · {g.forLearner ? `only ${g.forLearner.username ? `@${g.forLearner.username}` : g.forLearner.name || 'one learner'} (they approved it in their chat)` : 'everyone'} · granted {formatWhen(g.created_at)}{g.expires_at ? ` · until ${formatWhen(g.expires_at)}` : ''}{g.revoked_at ? ` · revoked ${formatWhen(g.revoked_at)}` : ''}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {g.active ? <><StatusPill status="approved" /><Btn variant="secondary" size="sm" onClick={() => revoke(g)} disabled={busyId === g.id}>{busyId === g.id ? 'Revoking…' : 'Revoke'}</Btn></> : <StatusPill status="expired" />}
      </div>
    </div>)}
  </div>;
}
