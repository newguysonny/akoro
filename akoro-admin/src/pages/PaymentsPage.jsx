import { useState, useEffect, useCallback } from 'react';
import { DollarSign, Search, RefreshCw, CheckCircle, XCircle, FileSearch } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton } from '../components/Primitives.jsx';
import { apiGet, apiPatch } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../constants.js';

const STATUS_FILTERS = ['all', 'success', 'processing', 'pending', 'refunded', 'failed'];

const STATUS_MAP = {
  success:    { bg: '#DCFCE7', color: GREEN },
  processing: { bg: '#DBEAFE', color: BLUE },
  failed:     { bg: '#FEE2E2', color: RED },
  refunded:   { bg: '#FFF3DC', color: AMBER },
  pending:    { bg: '#F3F4F6', color: MUTED },
  abandoned:  { bg: '#FEE2E2', color: RED },
};

function StatusPill({ status }) {
  const cfg = STATUS_MAP[status] || STATUS_MAP.pending;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: cfg.bg, color: cfg.color, fontFamily: FONT,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color, display: 'inline-block' }} />
      {status}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, color = AMBER, loading }) {
  if (loading) return (
    <div style={{ background: WHITE, borderRadius: 16, padding: 20, border: `1px solid ${BORDER}` }}>
      <Skeleton height={14} width={80} style={{ marginBottom: 12 }} />
      <Skeleton height={32} width={60} />
    </div>
  );
  return (
    <div style={{ background: WHITE, borderRadius: 16, padding: 20, border: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} color={color} />
        </div>
        <span style={{ fontSize: 12, color: MUTED, fontWeight: 500, fontFamily: FONT }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: INK, fontFamily: FONT, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

const PAGE_SIZE = 20;
const ngn = (n) => `₦${Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// ── Audit trace modal ──────────────────────────────────────────────────────
function TraceModal({ reference, onClose, onRefunded }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    apiGet(`/api/admin/payments/${encodeURIComponent(reference)}/trace`)
      .then((r) => { if (alive) setData(r?.data ?? r); })
      .catch((e) => { if (alive) setError(e?.message || 'Failed to load trace'); });
    return () => { alive = false; };
  }, [reference]);

  const Row = ({ label, children }) => (
    <div style={{ display: 'flex', gap: 10, fontSize: 13, fontFamily: FONT, padding: '4px 0' }}>
      <span style={{ color: MUTED, minWidth: 120 }}>{label}</span>
      <span style={{ color: INK, fontWeight: 600, wordBreak: 'break-word' }}>{children}</span>
    </div>
  );

  const p = data?.payment;
  const ps = data?.paystack;

  return (
    <Modal open onClose={onClose} title="Payment trace" width={640}>
      {error ? (
        <div style={{ color: RED, fontFamily: FONT, fontSize: 14 }}>{error}</div>
      ) : !data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[1,2,3,4].map(i => <Skeleton key={i} height={40} />)}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Reconciliation banner */}
          <div style={{
            padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: FONT,
            background: data.reconciled ? '#DCFCE7' : '#FFF3DC', color: data.reconciled ? GREEN : AMBER,
          }}>
            {data.reconciled
              ? '✓ Reconciled — our record and Paystack both show success'
              : 'Not reconciled — verify DB status against Paystack below'}
          </div>

          {/* Reference + Paystack live */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 800, color: MUTED, textTransform: 'uppercase', marginBottom: 8, fontFamily: FONT }}>Reference</div>
            <div style={{ fontSize: 13, fontFamily: 'monospace', color: INK, wordBreak: 'break-all', marginBottom: 10 }}>{data.reference}</div>
            <div style={{ background: LIGHT, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: MUTED, marginBottom: 6, fontFamily: FONT }}>LIVE from Paystack</div>
              {ps?.error ? (
                <div style={{ color: RED, fontSize: 13, fontFamily: FONT }}>{ps.error}</div>
              ) : (
                <>
                  <Row label="Status"><StatusPill status={ps?.status || 'unknown'} /></Row>
                  <Row label="Amount">{ngn((ps?.amount || 0) / 100)}</Row>
                  <Row label="Paid at">{fmtDateTime(ps?.paid_at)}</Row>
                  <Row label="Email">{ps?.email || '—'}</Row>
                </>
              )}
            </div>
          </section>

          {/* Our payment row */}
          {p && (
            <section>
              <div style={{ fontSize: 12, fontWeight: 800, color: MUTED, textTransform: 'uppercase', marginBottom: 8, fontFamily: FONT }}>Our record</div>
              <Row label="Status"><StatusPill status={p.status} /></Row>
              <Row label="Amount">{ngn((p.amount_paid || 0) / 100)} {p.currency}</Row>
              <Row label="Provider">{p.payment_provider}</Row>
              <Row label="Buyer">{p.users?.full_name} ({p.users?.email})</Row>
              <Row label="Created">{fmtDateTime(p.created_at)}</Row>
              {p.refunded_at && <Row label="Refunded">{fmtDateTime(p.refunded_at)} — {p.refund_reason || 'no reason'}</Row>}
            </section>
          )}

          {/* Line items */}
          {data.items?.length > 0 && (
            <section>
              <div style={{ fontSize: 12, fontWeight: 800, color: MUTED, textTransform: 'uppercase', marginBottom: 8, fontFamily: FONT }}>Items ({data.items.length})</div>
              {data.items.map((it) => (
                <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontFamily: FONT, padding: '5px 0', borderBottom: `1px solid ${BORDER}` }}>
                  <span style={{ color: INK }}>{it.title || (it.item_type === 'agent' ? 'Teaching guide' : 'Course')}
                    <span style={{ color: MUTED, fontSize: 11, marginLeft: 6 }}>{it.item_type}</span></span>
                  <span style={{ color: INK, fontWeight: 700 }}>{ngn((it.unit_price_kobo || 0) / 100)}</span>
                </div>
              ))}
            </section>
          )}

          {/* Agent purchase (marketplace) */}
          {data.agent_purchase && (
            <section>
              <div style={{ fontSize: 12, fontWeight: 800, color: MUTED, textTransform: 'uppercase', marginBottom: 8, fontFamily: FONT }}>Agent purchase</div>
              <Row label="Access granted">{data.agent_purchase.access_granted ? 'Yes' : 'No'}</Row>
              <Row label="Status">{data.agent_purchase.paystack_status || '—'}</Row>
              <Row label="Amount">{ngn((data.agent_purchase.amount_kobo || 0) / 100)}</Row>
            </section>
          )}

          {/* Event timeline */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 800, color: MUTED, textTransform: 'uppercase', marginBottom: 8, fontFamily: FONT }}>Event timeline ({data.events?.length || 0})</div>
            {(!data.events || data.events.length === 0) ? (
              <div style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>No events recorded for this reference.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.events.map((ev) => (
                  <div key={ev.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, fontFamily: FONT }}>
                    <span style={{ color: MUTED, minWidth: 96, fontSize: 11 }}>{fmtDateTime(ev.created_at)}</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 700, color: INK }}>{ev.event_type}</span>
                      {ev.outcome && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: ev.outcome === 'error' ? RED : ev.outcome === 'fulfilled' ? GREEN : MUTED }}>{ev.outcome}</span>}
                      {ev.signature_valid === false && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: RED }}>bad signature</span>}
                      <span style={{ marginLeft: 8, fontSize: 11, color: MUTED }}>{ev.source}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {p && p.status === 'success' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
              <Btn variant="secondary" onClick={() => onRefunded(p.id)}>Refund this payment</Btn>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function PaymentsPage() {
  const [stats, setStats]           = useState(null);
  const [payments, setPayments]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage]             = useState(1);
  const [refundModal, setRefundModal] = useState({ open: false, id: null, label: '' });
  const [traceRef, setTraceRef]     = useState(null);
  const [busy, setBusy]             = useState(false);
  const [toast, setToast]           = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await apiGet('/api/admin/payments/stats');
      setStats(res?.data ?? res);
    } catch { /* non-fatal */ } finally { setStatsLoading(false); }
  }, []);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 300 });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (search.trim()) params.set('email', search.trim());
      const res = await apiGet(`/api/admin/payments?${params}`);
      const arr = Array.isArray(res) ? res : (res?.data || res?.payments || []);
      setPayments(arr);
    } catch (err) {
      showToast(err.message || 'Failed to load payments', 'error');
    } finally { setLoading(false); }
  }, [statusFilter, search]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadPayments(); setPage(1); }, [loadPayments]);

  const doRefund = async (id) => {
    setBusy(true);
    try {
      await apiPatch(`/api/admin/payments/${id}/refund`, { reason: 'Admin refund' });
      setPayments(prev => prev.map(p => p.id === id ? { ...p, status: 'refunded' } : p));
      setRefundModal({ open: false, id: null, label: '' });
      setTraceRef(null);
      showToast('Payment refunded successfully');
      loadStats();
    } catch (err) {
      showToast(err.message || 'Refund failed', 'error');
    } finally { setBusy(false); }
  };

  const paged   = payments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasMore = page * PAGE_SIZE < payments.length;

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };
  const CHIP = (active) => ({
    padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
    fontFamily: FONT, fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? AMBER : 'transparent', color: active ? WHITE : MUTED, transition: 'all .15s',
  });

  return (
    <PageLayout title="Payments & Transactions" subtitle="All payment records, refunds and audit trail">
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
          <StatCard icon={DollarSign}  label="Total Revenue" color={GREEN} value={ngn(stats?.total_revenue)} loading={statsLoading} />
          <StatCard icon={CheckCircle} label="Successful"    color={BLUE}  value={(stats?.total_success ?? 0).toLocaleString()} loading={statsLoading} />
          <StatCard icon={RefreshCw}   label="Refunded"      color={AMBER} value={ngn(stats?.total_refunded)} loading={statsLoading} />
          <StatCard icon={XCircle}     label="Failed"        color={RED}   value={(stats?.total_failed ?? 0).toLocaleString()} loading={statsLoading} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} color={MUTED} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by buyer email…"
              style={{ width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STATUS_FILTERS.map(s => (
              <button key={s} style={CHIP(statusFilter === s)} onClick={() => { setStatusFilter(s); setPage(1); }}>
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', marginBottom: 20, overflowX: 'auto' }}>
          {loading ? (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1,2,3,4,5,6].map(i => <Skeleton key={i} height={48} />)}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr style={{ background: LIGHT }}>
                  <th style={TH}>Date</th>
                  <th style={TH}>Buyer</th>
                  <th style={TH}>Item</th>
                  <th style={TH}>Amount</th>
                  <th style={TH}>Provider</th>
                  <th style={TH}>Status</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No payments found</td></tr>
                ) : paged.map(p => (
                  <tr key={p.id}
                    onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                    onMouseLeave={e => e.currentTarget.style.background = WHITE}>
                    <td style={{ ...TD, color: MUTED, whiteSpace: 'nowrap' }}>{fmtDate(p.created_at)}</td>
                    <td style={TD}>
                      <div style={{ fontWeight: 600 }}>{p.user_name || '—'}</div>
                      <div style={{ fontSize: 11, color: MUTED }}>{p.user_email || ''}</div>
                    </td>
                    <td style={{ ...TD, maxWidth: 220 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.course_title || '—'}</span>
                    </td>
                    <td style={{ ...TD, fontWeight: 700, whiteSpace: 'nowrap' }}>{p.amount === 0 ? 'Free' : ngn(p.amount)}</td>
                    <td style={{ ...TD, color: MUTED, fontSize: 12 }}>{p.provider || '—'}</td>
                    <td style={TD}><StatusPill status={p.status} /></td>
                    <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {p.reference && (
                        <Btn size="sm" variant="secondary" onClick={() => setTraceRef(p.reference)} style={{ marginRight: 6 }}>
                          <FileSearch size={13} style={{ marginRight: 4 }} />Audit
                        </Btn>
                      )}
                      {p.status === 'success' && (
                        <Btn size="sm" variant="secondary"
                          onClick={() => setRefundModal({ open: true, id: p.id, label: `${p.user_email || 'this user'} — ${ngn(p.amount)}` })}>
                          Refund
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && hasMore && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Btn variant="secondary" onClick={() => setPage(p => p + 1)}>Load more</Btn>
          </div>
        )}
      </div>

      <Modal open={refundModal.open} onClose={() => setRefundModal({ open: false, id: null, label: '' })} title="Confirm Refund">
        <p style={{ fontSize: 14, color: INK, fontFamily: FONT, margin: '0 0 20px', lineHeight: 1.6 }}>
          Refund the payment for <strong>{refundModal.label}</strong>? This revokes access to all items in the order and cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setRefundModal({ open: false, id: null, label: '' })}>Cancel</Btn>
          <Btn variant="primary" disabled={busy} onClick={() => doRefund(refundModal.id)}>{busy ? 'Processing…' : 'Refund'}</Btn>
        </div>
      </Modal>

      {traceRef && <TraceModal reference={traceRef} onClose={() => setTraceRef(null)} onRefunded={doRefund} />}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
