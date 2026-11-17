import { useCallback, useEffect, useRef, useState } from 'react';
import { PageSkeleton } from '../components/Primitives.jsx';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPatch } from '../services/api.js';
import { SubStatusBadge, refId, subPrice, fmtDate, fmtWhen, Pagination, Filters } from './billing/bits.jsx';
import MessageModal from './billing/MessageModal.jsx';

const CHANNEL_LABELS = { email: 'Email', sms: 'SMS', inapp: 'In-app notice' };

/**
 * CustomersPage — the billing identity behind each subscription: the parent or
 * guardian who pays, linked to one or more learners (plan §4.6 Phase 2).
 * Exact conversion of the prototype's Customers panel + detail, backed by:
 *
 *   GET   /api/admin/customers        list (with embedded subscriptions)
 *   GET   /api/admin/customers/:id    detail
 *   PATCH /api/admin/customers/:id    contact details / notes
 *
 * Standing/balance mirror the prototype's custStanding/custBalance rules
 * (contract-tested server-side in lib/billingModel.js). The Messages section
 * arrives with Phase 4 — not rendered as dead UI.
 */

const PAGE_SIZE = 5;

function standing(subs = []) {
  if (subs.some((s) => s.status === 'past_due')) return { key: 'past_due', label: 'Past due' };
  if (subs.some((s) => s.status === 'active' && (s.price ?? 0) > 0)) return { key: 'active', label: 'Good standing' };
  if (subs.some((s) => s.status === 'trial')) return { key: 'trial', label: 'On trial' };
  return { key: 'canceled', label: 'No active paid plan' };
}
const balance = (subs = []) => subs.filter((s) => s.status === 'past_due').reduce((sum, s) => sum + (s.price ?? 0), 0);

export default function CustomersPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState('');
  const [customers, setCustomers] = useState([]);
  const [search, setSearch]       = useState('');
  const [page, setPage]           = useState(1);

  const [selected, setSelected]   = useState(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [messages, setMessages]   = useState([]);
  const [msgContext, setMsgContext] = useState(null);

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1400);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const load = useCallback(async () => {
    try {
      setLoadError('');
      const res = await apiGet('/api/admin/customers');
      setCustomers(res.data ?? []);
      return res.data ?? [];
    } catch (e) {
      setLoadError(e.message || 'Could not load customers.');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const list = await load();
      const focusId = params.get('id');
      const found = list.find((c) => c.id === focusId);
      if (found) select(found);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (c) => {
    setSelected(c);
    setEmailDraft(c.email ?? '');
    setPhoneDraft(c.phone ?? '');
    setNotesDraft(c.notes ?? '');
    loadMessages(c.id);
  };

  const loadMessages = async (customerId) => {
    try {
      const res = await apiGet(`/api/admin/messages?customer_id=${customerId}`);
      setMessages(res.data ?? []);
    } catch {
      setMessages([]); // the section simply shows "No messages sent yet."
    }
  };

  /* ── list filtering ─────────────────────────────────────────────────────── */
  const q = search.toLowerCase();
  const filtered = customers.filter((c) =>
    [refId('CUS', c.id), c.name, c.email, ...c.subscriptions.map((s) => s.learner?.name ?? '')]
      .some((v) => v.toLowerCase().includes(q)));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const items = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /* ── detail actions ─────────────────────────────────────────────────────── */
  const saveContact = async () => {
    const email = emailDraft.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Enter a valid email address'); return; }
    try {
      await apiPatch(`/api/admin/customers/${selected.id}`, { email, phone: phoneDraft.trim() });
      await load();
      showToast('Contact details saved');
    } catch (e) {
      showToast(e.message || 'Could not save contact details.');
    }
  };

  const saveNotes = async () => {
    try {
      await apiPatch(`/api/admin/customers/${selected.id}`, { notes: notesDraft });
      await load();
      showToast('Notes saved');
    } catch (e) {
      showToast(e.message || 'Could not save notes.');
    }
  };

  /* ── render ─────────────────────────────────────────────────────────────── */
  const methods = selected
    ? [...new Set(selected.subscriptions.map((s) => s.payment_method_ref).filter(Boolean))]
    : [];

  return (
    <PageLayout title="Customers" subtitle="The billing identity behind each subscription">
      <div className="ak-page">

        {selected ? (
          /* ══════════ CUSTOMER DETAIL ══════════ */
          <>
            <button className="ak-back-link" onClick={() => setSelected(null)}>← Back to Customers</button>
            <div className="ak-detail-head">
              <div>
                <h1 className="ak-h1">{refId('CUS', selected.id)} · {selected.name}</h1>
                <p className="ak-sub !mt-1.5 !mb-0">
                  <SubStatusBadge status={standing(selected.subscriptions).key} />
                </p>
              </div>
            </div>

            <div className="ak-stat-row">
              <div className="ak-stat"><div className="ak-stat-label">Linked learners</div><div className="ak-stat-value">{selected.subscriptions.length}</div></div>
              <div className="ak-stat"><div className="ak-stat-label">Active paid plans</div><div className="ak-stat-value">{selected.subscriptions.filter((s) => s.status === 'active' && (s.price ?? 0) > 0).length}</div></div>
              <div className="ak-stat"><div className="ak-stat-label">Open balance</div><div className="ak-stat-value">{balance(selected.subscriptions) ? `₦${balance(selected.subscriptions).toLocaleString()}` : '—'}</div></div>
            </div>

            <div className="ak-section-title">Contact details</div>
            <div className="ak-settings-card !max-w-[520px]">
              <div className="ak-field-row">
                <div className="ak-field">
                  <label htmlFor="cd-email">Email</label>
                  <input className="ak-input" type="text" id="cd-email" value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} />
                </div>
                <div className="ak-field">
                  <label htmlFor="cd-phone">Phone</label>
                  <input className="ak-input" type="text" id="cd-phone" value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} />
                </div>
              </div>
              <button className="ak-btn ak-btn-small" onClick={saveContact}>Save contact details</button>
            </div>

            <div className="ak-section-title">Linked learners &amp; subscriptions</div>
            <table className="ak-table">
              <thead><tr><th>Subscription</th><th>Learner</th><th>Plan</th><th>Status</th><th>Next date</th></tr></thead>
              <tbody>
                {selected.subscriptions.length ? selected.subscriptions.map((s) => (
                  <tr key={s.id} className="ak-clickable" onClick={() => navigate(`/subscriptions?id=${s.id}`)}>
                    <td>{refId('SUB', s.id)}</td>
                    <td>{s.learner?.name ?? '—'}</td>
                    <td>{s.tier?.name} <small className="text-akoro-dim">{subPrice(s)}</small></td>
                    <td><SubStatusBadge status={s.status} /></td>
                    <td>{fmtDate(s.next_date)}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="text-akoro-dim">No linked subscriptions.</td></tr>}
              </tbody>
            </table>

            <div className="ak-section-title">Payment methods on file</div>
            <div className="ak-tags">
              {methods.length ? methods.map((m) => <span key={m} className="ak-tag">{m}</span>)
                : <span className="ak-tag ak-tag-none">None on file</span>}
            </div>

            <div className="ak-section-title">Messages</div>
            <table className="ak-table">
              <thead><tr><th>When</th><th>Channel</th><th>Message</th><th>Regarding</th></tr></thead>
              <tbody>
                {messages.length ? messages.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap">{fmtWhen(m.sent_at)}</td>
                    <td>{CHANNEL_LABELS[m.channel] ?? m.channel}{m.delivery_status === 'failed' && <span className="text-akoro-coral"> · failed</span>}{m.delivery_status === 'no_recipient' && <span className="text-akoro-dim"> · no recipient</span>}</td>
                    <td>{m.subject || m.body.slice(0, 60)}</td>
                    <td>{m.subscription_id ? refId('SUB', m.subscription_id) : 'Account'}</td>
                  </tr>
                )) : <tr><td colSpan={4} className="text-akoro-dim">No messages sent yet.</td></tr>}
              </tbody>
            </table>

            <div className="ak-section-title">Internal notes</div>
            <textarea
              className="ak-notes-box" rows="3"
              placeholder="Notes visible to admins only"
              value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)}
            />
            <button className="ak-btn ak-btn-ghost ak-btn-small mt-2" onClick={saveNotes}>Save notes</button>
          </>
        ) : (
          /* ══════════ LIST ══════════ */
          <>
            {loading && <PageSkeleton header={false} rows={6} />}
            {loadError && <p className="ak-sub text-akoro-coral">{loadError}</p>}

            {!loading && (
              <>
                <Filters search={{ value: search, placeholder: 'Search customer, email, or learner…' }} onSearch={(v) => { setSearch(v); setPage(1); }} />

                <table className="ak-table">
                  <thead><tr><th>ID</th><th>Customer</th><th>Email</th><th>Learners</th><th>Billing status</th><th>Open balance</th><th></th></tr></thead>
                  <tbody>
                    {items.length ? items.map((c) => {
                      const st = standing(c.subscriptions), bal = balance(c.subscriptions);
                      return (
                        <tr key={c.id} className="ak-clickable" onClick={() => select(c)}>
                          <td>{refId('CUS', c.id)}</td>
                          <td>{c.name}</td>
                          <td>{c.email}</td>
                          <td>{c.subscriptions.map((s) => s.learner?.name ?? '—').join(', ')}</td>
                          <td><SubStatusBadge status={st.key} /></td>
                          <td>{bal ? `₦${bal.toLocaleString()}` : '—'}</td>
                          <td><button className="ak-btn ak-btn-ghost ak-btn-small" onClick={(e) => { e.stopPropagation(); setMsgContext({ kind: 'customer', customer: c, learnerNames: c.subscriptions.map((s) => s.learner?.name).filter(Boolean) }); }}>Message</button></td>
                        </tr>
                      );
                    }) : <tr><td colSpan={7} className="text-akoro-dim">No customers match.</td></tr>}
                  </tbody>
                </table>
                <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />
              </>
            )}
          </>
        )}

        {msgContext && (
          <MessageModal
            context={msgContext}
            onClose={() => setMsgContext(null)}
            onSent={(ok, msg) => { if (msg) showToast(msg); if (ok && selected) loadMessages(selected.id); }}
          />
        )}

        <div className={`ak-save-toast ${toast ? 'ak-save-toast-show' : ''}`} role="status">{toast}</div>
      </div>
    </PageLayout>
  );
}
