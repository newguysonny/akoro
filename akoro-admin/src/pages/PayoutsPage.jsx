import { useState, useEffect, useCallback } from 'react';
import { DollarSign, Clock, CheckCircle } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton, Inp } from '../components/Primitives.jsx';
import { apiGet, apiPatch } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../constants.js';

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

function StatusPill({ status }) {
  const map = {
    paid:     { bg: '#DCFCE7', color: GREEN },
    pending:  { bg: '#FFF3DC', color: AMBER },
    on_hold:  { bg: '#FEE2E2', color: RED },
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

const TX_FILTERS = ['all', 'pending', 'paid', 'on_hold'];

export default function PayoutsPage() {
  const [activeTab,    setActiveTab]    = useState('instructors');
  const [summary,      setSummary]      = useState(null);
  const [summaryStats, setSummaryStats] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [txFilter,     setTxFilter]     = useState('all');
  const [loadingSum,   setLoadingSum]   = useState(true);
  const [loadingTx,    setLoadingTx]    = useState(true);
  const [markModal,    setMarkModal]    = useState({ open: false, instructorId: null, name: '' });
  const [markBusy,     setMarkBusy]     = useState(false);
  const [toast,        setToast]        = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadSummary = useCallback(async () => {
    setLoadingSum(true);
    try {
      const res = await apiGet('/api/admin/payouts/summary');
      const instructors = Array.isArray(res) ? res : (res?.instructors || res?.data || []);
      setSummary(instructors);
      // Compute totals from summary
      const totalEarned = instructors.reduce((s, i) => s + (i.total_earned || 0), 0);
      const totalPending = instructors.reduce((s, i) => s + (i.pending || 0), 0);
      const totalPaid = instructors.reduce((s, i) => s + (i.paid || 0), 0);
      setSummaryStats({ totalEarned, totalPending, totalPaid });
    } catch (err) {
      showToast(err.message || 'Failed to load payout summary', 'error');
    } finally {
      setLoadingSum(false);
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    setLoadingTx(true);
    try {
      const params = new URLSearchParams();
      if (txFilter !== 'all') params.set('status', txFilter);
      const res = await apiGet(`/api/admin/payouts${params.toString() ? '?' + params : ''}`);
      const arr = Array.isArray(res) ? res : (res?.transactions || res?.data || []);
      setTransactions(arr);
    } catch (err) {
      showToast(err.message || 'Failed to load transactions', 'error');
    } finally {
      setLoadingTx(false);
    }
  }, [txFilter]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { if (activeTab === 'transactions') loadTransactions(); }, [activeTab, loadTransactions]);

  const handleMarkPaid = async () => {
    setMarkBusy(true);
    try {
      // Mark all pending for this instructor
      const instructorRow = (summary || []).find(i => i.instructor_id === markModal.instructorId || i.id === markModal.instructorId);
      const pendingIds = instructorRow?.pending_payout_ids || [];
      if (pendingIds.length > 0) {
        await Promise.all(pendingIds.map(pid => apiPatch(`/api/admin/payouts/${pid}/mark-paid`, {})));
      } else {
        // Fallback: mark the instructor-level pending payout
        await apiPatch(`/api/admin/payouts/${markModal.instructorId}/mark-paid`, {});
      }
      setMarkModal({ open: false, instructorId: null, name: '' });
      showToast('Payouts marked as paid');
      loadSummary();
    } catch (err) {
      showToast(err.message || 'Failed to mark paid', 'error');
    } finally {
      setMarkBusy(false);
    }
  };

  const fmtMoney = (v) => {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0); }
    catch { return `$${(v || 0).toFixed(2)}`; }
  };
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };

  const CHIP = (active) => ({
    padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
    fontFamily: FONT, fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? AMBER : 'transparent', color: active ? WHITE : MUTED,
    transition: 'all .15s',
  });

  const TAB = (active) => ({
    padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
    fontFamily: FONT, fontSize: 13, fontWeight: active ? 700 : 500,
    background: active ? AMBER : 'transparent', color: active ? WHITE : MUTED,
    transition: 'all .15s',
  });

  return (
    <PageLayout title="Instructor Payouts" subtitle="Manage earnings and payouts">
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
          <StatCard icon={DollarSign} label="Total Earned"    color={BLUE}  value={fmtMoney(summaryStats?.totalEarned)}   loading={loadingSum} />
          <StatCard icon={Clock}      label="Pending Payouts" color={AMBER} value={fmtMoney(summaryStats?.totalPending)}  loading={loadingSum} />
          <StatCard icon={CheckCircle} label="Paid Out"       color={GREEN} value={fmtMoney(summaryStats?.totalPaid)}     loading={loadingSum} />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: LIGHT, borderRadius: 12, padding: 4, width: 'fit-content' }}>
          <button style={TAB(activeTab === 'instructors')} onClick={() => setActiveTab('instructors')}>By Instructor</button>
          <button style={TAB(activeTab === 'transactions')} onClick={() => setActiveTab('transactions')}>All Transactions</button>
        </div>

        {/* By Instructor tab */}
        {activeTab === 'instructors' && (
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', overflowX: 'auto' }}>
            {loadingSum ? (
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[1,2,3,4].map(i => <Skeleton key={i} height={52} />)}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
                <thead>
                  <tr style={{ background: LIGHT }}>
                    <th style={TH}>Instructor</th>
                    <th style={TH}>Email</th>
                    <th style={TH}>Courses</th>
                    <th style={TH}>Total Earned</th>
                    <th style={TH}>Pending</th>
                    <th style={TH}>Paid</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(!summary || summary.length === 0) ? (
                    <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No payout data available</td></tr>
                  ) : summary.map((row, idx) => (
                    <tr key={row.instructor_id || row.id || idx}
                      onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                      onMouseLeave={e => e.currentTarget.style.background = WHITE}>
                      <td style={TD}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 34, height: 34, borderRadius: '50%',
                            background: `${AMBER}20`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, fontWeight: 700, color: AMBER, flexShrink: 0,
                          }}>
                            {(row.full_name || row.name || '?')[0].toUpperCase()}
                          </div>
                          <span style={{ fontWeight: 600 }}>{row.full_name || row.name || '—'}</span>
                        </div>
                      </td>
                      <td style={{ ...TD, color: MUTED }}>{row.email || '—'}</td>
                      <td style={{ ...TD, color: MUTED }}>{(row.courses_count ?? row.courses ?? 0).toLocaleString()}</td>
                      <td style={{ ...TD, fontWeight: 700 }}>{fmtMoney(row.total_earned)}</td>
                      <td style={{ ...TD, color: AMBER, fontWeight: 600 }}>{fmtMoney(row.pending)}</td>
                      <td style={{ ...TD, color: GREEN, fontWeight: 600 }}>{fmtMoney(row.paid)}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        {(row.pending || 0) > 0 && (
                          <Btn size="sm" variant="green"
                            onClick={() => setMarkModal({ open: true, instructorId: row.instructor_id || row.id, name: row.full_name || row.name || 'this instructor' })}>
                            Mark Paid
                          </Btn>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* All Transactions tab */}
        {activeTab === 'transactions' && (
          <>
            {/* Status filter chips */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {TX_FILTERS.map(f => (
                <button key={f} style={CHIP(txFilter === f)} onClick={() => setTxFilter(f)}>
                  {f === 'all' ? 'All' : f === 'on_hold' ? 'On Hold' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', overflowX: 'auto' }}>
              {loadingTx ? (
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[1,2,3,4,5].map(i => <Skeleton key={i} height={52} />)}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
                  <thead>
                    <tr style={{ background: LIGHT }}>
                      <th style={TH}>Date</th>
                      <th style={TH}>Instructor</th>
                      <th style={TH}>Course</th>
                      <th style={TH}>Gross</th>
                      <th style={TH}>Commission</th>
                      <th style={TH}>Net</th>
                      <th style={TH}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.length === 0 ? (
                      <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No transactions found</td></tr>
                    ) : transactions.map((tx, idx) => (
                      <tr key={tx.id || idx}
                        onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                        onMouseLeave={e => e.currentTarget.style.background = WHITE}>
                        <td style={{ ...TD, color: MUTED, whiteSpace: 'nowrap' }}>{fmtDate(tx.created_at || tx.date)}</td>
                        <td style={TD}>
                          <div style={{ fontWeight: 600 }}>{tx.instructor_name || tx.instructor?.full_name || '—'}</div>
                          <div style={{ fontSize: 11, color: MUTED }}>{tx.instructor_email || tx.instructor?.email || ''}</div>
                        </td>
                        <td style={{ ...TD, maxWidth: 180 }}>
                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tx.course_title || tx.course?.title || '—'}
                          </span>
                        </td>
                        <td style={{ ...TD, fontWeight: 600 }}>{fmtMoney(tx.gross || tx.amount)}</td>
                        <td style={{ ...TD, color: MUTED }}>{fmtMoney(tx.commission || tx.platform_fee)}</td>
                        <td style={{ ...TD, fontWeight: 700, color: GREEN }}>{fmtMoney(tx.net || tx.instructor_payout)}</td>
                        <td style={TD}><StatusPill status={tx.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

      </div>

      {/* Mark Paid Modal */}
      <Modal open={markModal.open} onClose={() => setMarkModal({ open: false, instructorId: null, name: '' })} title="Mark Payouts as Paid" width={420}>
        <p style={{ fontSize: 14, color: INK, fontFamily: FONT, margin: '0 0 20px', lineHeight: 1.6 }}>
          This will mark all pending payouts for <strong>{markModal.name}</strong> as paid. This action cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setMarkModal({ open: false, instructorId: null, name: '' })}>Cancel</Btn>
          <Btn variant="green" disabled={markBusy} onClick={handleMarkPaid}>{markBusy ? 'Processing…' : 'Confirm Mark Paid'}</Btn>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
