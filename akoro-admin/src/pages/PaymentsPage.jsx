import { useState, useEffect, useCallback } from 'react';
import { DollarSign, Search, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton } from '../components/Primitives.jsx';
import { apiGet, apiPatch } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../constants.js';

const STATUS_FILTERS = ['all', 'success', 'failed', 'refunded', 'pending'];

function StatusPill({ status }) {
  const map = {
    success:  { bg: '#DCFCE7', color: GREEN },
    failed:   { bg: '#FEE2E2', color: RED },
    refunded: { bg: '#FFF3DC', color: AMBER },
    pending:  { bg: '#F3F4F6', color: MUTED },
  };
  const cfg = map[status] || map.pending;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: cfg.bg, color: cfg.color,
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

export default function PaymentsPage() {
  const [stats, setStats]           = useState(null);
  const [payments, setPayments]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage]             = useState(1);
  const [refundModal, setRefundModal] = useState({ open: false, id: null, label: '' });
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
      setStats(res);
    } catch {
      // non-fatal
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 200 });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (search.trim()) params.set('email', search.trim());
      const res = await apiGet(`/api/admin/payments?${params}`);
      const arr = Array.isArray(res) ? res : (res?.payments || res?.data || []);
      setPayments(arr);
    } catch (err) {
      showToast(err.message || 'Failed to load payments', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadPayments(); setPage(1); }, [loadPayments]);

  const handleRefund = async () => {
    setBusy(true);
    try {
      await apiPatch(`/api/admin/payments/${refundModal.id}/refund`, { reason: 'Admin refund' });
      setPayments(prev => prev.map(p => p.id === refundModal.id ? { ...p, status: 'refunded' } : p));
      setRefundModal({ open: false, id: null, label: '' });
      showToast('Payment refunded successfully');
    } catch (err) {
      showToast(err.message || 'Refund failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const fmtDate   = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const fmtMoney  = (v, currency = 'USD') => {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v || 0); }
    catch { return `$${(v || 0).toFixed(2)}`; }
  };

  const paged     = payments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasMore   = page * PAGE_SIZE < payments.length;

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };

  const CHIP = (active) => ({
    padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
    fontFamily: FONT, fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? AMBER : 'transparent', color: active ? WHITE : MUTED,
    transition: 'all .15s',
  });

  return (
    <PageLayout title="Payments & Transactions" subtitle="All payment records and refunds">
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
          <StatCard icon={DollarSign} label="Total Revenue"      color={GREEN}  value={fmtMoney(stats?.total_revenue)}          loading={statsLoading} />
          <StatCard icon={CheckCircle} label="Successful"        color={BLUE}   value={(stats?.total_success ?? 0).toLocaleString()}  loading={statsLoading} />
          <StatCard icon={RefreshCw}  label="Refunded"           color={AMBER}  value={fmtMoney(stats?.total_refunded)}          loading={statsLoading} />
          <StatCard icon={XCircle}    label="Failed"             color={RED}    value={(stats?.total_failed ?? 0).toLocaleString()}    loading={statsLoading} />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} color={MUTED} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by email…"
              style={{
                width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10,
                border: `1.5px solid ${BORDER}`, outline: 'none',
                fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box',
              }}
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

        {/* Table */}
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
          {loading ? (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1,2,3,4,5,6].map(i => <Skeleton key={i} height={48} />)}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: LIGHT }}>
                  <th style={TH}>Date</th>
                  <th style={TH}>User</th>
                  <th style={TH}>Course</th>
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
                    <td style={{ ...TD, color: MUTED, whiteSpace: 'nowrap' }}>{fmtDate(p.created_at || p.date)}</td>
                    <td style={TD}>
                      <div style={{ fontWeight: 600 }}>{p.user_name || p.user?.full_name || '—'}</div>
                      <div style={{ fontSize: 11, color: MUTED }}>{p.user_email || p.user?.email || ''}</div>
                    </td>
                    <td style={{ ...TD, maxWidth: 200 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.course_title || p.course?.title || '—'}
                      </span>
                    </td>
                    <td style={{ ...TD, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {fmtMoney(p.amount, p.currency)}
                    </td>
                    <td style={{ ...TD, color: MUTED, fontSize: 12 }}>
                      {p.provider || p.payment_provider || '—'}
                    </td>
                    <td style={TD}><StatusPill status={p.status} /></td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      {p.status === 'success' && (
                        <Btn
                          size="sm" variant="secondary"
                          onClick={() => setRefundModal({ open: true, id: p.id, label: `${p.user_email || p.user?.email || 'this user'} — ${fmtMoney(p.amount, p.currency)}` })}
                        >
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

        {/* Load more */}
        {!loading && hasMore && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Btn variant="secondary" onClick={() => setPage(p => p + 1)}>Load more</Btn>
          </div>
        )}

      </div>

      {/* Refund confirm modal */}
      <Modal open={refundModal.open} onClose={() => setRefundModal({ open: false, id: null, label: '' })} title="Confirm Refund">
        <p style={{ fontSize: 14, color: INK, fontFamily: FONT, margin: '0 0 20px', lineHeight: 1.6 }}>
          Are you sure you want to refund the payment for <strong>{refundModal.label}</strong>? This action cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setRefundModal({ open: false, id: null, label: '' })}>Cancel</Btn>
          <Btn variant="primary" disabled={busy} onClick={handleRefund}>{busy ? 'Processing…' : 'Refund'}</Btn>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
