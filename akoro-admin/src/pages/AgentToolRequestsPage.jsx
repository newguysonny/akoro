/**
 * Learner-approved Agent Chat tool / integration requests.
 *
 * This is a product-review queue, not a chat-transcript viewer. The API sends
 * only the compact request the learner approved and the account identity admins
 * already manage; administrators cannot provision an integration from here.
 */
import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, RefreshCw, Search, ShieldCheck, Wrench } from 'lucide-react';

import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Sel, Skeleton, Toast, Txa } from '../components/Primitives.jsx';
import { apiGet, apiPatch } from '../services/api.js';
import { AMBER, BORDER, GREEN, INK, LIGHT, MUTED, MUTED2, RED, WHITE, FONT, PURPLE, BLUE } from '../constants.js';

const STATUS = {
  new:          { label: 'New',          color: AMBER,  bg: '#FFF7ED' },
  under_review: { label: 'Under review', color: BLUE,   bg: '#EFF6FF' },
  planned:      { label: 'Planned',      color: PURPLE, bg: '#F5F3FF' },
  declined:     { label: 'Declined',     color: RED,    bg: '#FEF2F2' },
  implemented:  { label: 'Implemented',  color: GREEN,  bg: '#ECFDF5' },
};

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
      const params = new URLSearchParams({ limit: '100' });
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
  }, [activeStatus, submittedSearch]);

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
            {requests.length === 0 ? <EmptyState activeStatus={activeStatus} hasSearch={!!submittedSearch} /> : <RequestList requests={requests} onOpen={setSelected} />}
          </div>
        )}
      </div>
      <ReviewModal request={selected} busy={busy} onClose={() => setSelected(null)} onSave={saveReview} />
    </PageLayout>
  );
}

function EmptyState({ activeStatus, hasSearch }) {
  const message = hasSearch ? 'No requests match that search.' : activeStatus ? `No ${STATUS[activeStatus]?.label.toLowerCase() || 'matching'} requests.` : 'No learner-approved tool requests yet.';
  return <div style={{ minHeight: 220, display: 'grid', placeItems: 'center', padding: 28, textAlign: 'center' }}>
    <div><div style={{ width: 46, height: 46, display: 'inline-grid', placeItems: 'center', background: '#FFF7ED', borderRadius: 14, marginBottom: 10 }}><Wrench size={21} color={AMBER} /></div>
      <div style={{ fontFamily: FONT, color: INK, fontWeight: 700, fontSize: 14 }}>{message}</div>
      <div style={{ fontFamily: FONT, color: MUTED, fontSize: 12, marginTop: 5 }}>Agent Chat never files these automatically; the learner must ask for submission.</div>
    </div>
  </div>;
}

function RequestList({ requests, onOpen }) {
  return <div>
    {requests.map((request) => {
      const person = request.requester?.fullName || request.requester?.username || request.requester?.email || 'Learner account';
      return <button key={request.id} onClick={() => onOpen(request)} style={{ width: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 16, textAlign: 'left', padding: '16px', border: 'none', borderBottom: `1px solid ${BORDER}`, background: WHITE, cursor: 'pointer', fontFamily: FONT }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: INK, fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{request.title}</div>
          <div style={{ color: MUTED, fontSize: 12.5, lineHeight: 1.45, marginTop: 5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{request.description}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, color: MUTED2, fontSize: 11.5, marginTop: 9 }}>
            <span>{person}</span><span>•</span><span>{formatWhen(request.createdAt)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' }}><CategoryPill category={request.category} /><StatusPill status={request.status} /></div>
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
        {Object.entries(STATUS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
      </Sel>
      <Txa label="Internal review note" value={adminNote} onChange={(event) => setAdminNote(event.target.value.slice(0, 1000))} placeholder="Why this is planned, declined, or needs follow-up…" rows={4} />
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 18 }}>
      <div style={{ color: MUTED, fontFamily: FONT, fontSize: 11.5 }}>Internal notes are not returned to the learner through Agent Chat.</div>
      <div style={{ display: 'flex', gap: 8 }}><Btn variant="secondary" onClick={onClose} disabled={busy}>Cancel</Btn><Btn onClick={() => onSave({ status, adminNote })} disabled={busy}>{busy ? 'Saving…' : 'Save review'}</Btn></div>
    </div>
  </Modal>;
}
