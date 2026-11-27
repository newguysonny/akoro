import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageLayout } from '../components/Layout.jsx';
import BackButton from '../components/BackButton.jsx';
import { apiGet } from '../services/api.js';
import { GREEN, RED, BLUE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const formatDate = (iso) => new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const STATUS_STYLE = {
  paid:    { bg: `${GREEN}18`, color: GREEN,  label: 'Paid' },
  pending: { bg: '#FEF3C7',     color: '#B45309', label: 'Pending Payment' },
  failed:  { bg: `${RED}15`,   color: RED,    label: 'Failed' },
};

export default function SubscriptionHistoryPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet('/api/school/subscription/payments')
      .then((res) => setRows(res.data || []))
      .catch((e) => showToast(e.message || 'Could not load payment history'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.orderId, r.plan, r.method, r.transactionId, r.status].some((v) => (v || '').toLowerCase().includes(q)));
  }, [rows, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const retry = async (row) => {
    try {
      showToast('Retrying payment…');
      // Re-checkout is handled from the subscription page's plan cards; deep-link there.
      navigate('/settings-subscription');
    } catch (e) { showToast(e.message || 'Could not retry'); }
  };

  return (
    <PageLayout title="Payment History" subtitle="Your subscription payment records">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 18 }}>
        <BackButton onClick={() => navigate('/settings-subscription')} label="Back to Subscription" />
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Ico ti="ti-file-text" size={16} color={C.brand} />
          <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, fontFamily: C.font }}>Your Subscription Payments</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12.5, color: C.muted, fontFamily: C.font }}>Show</span>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ padding: '6px 10px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12.5, fontFamily: C.font, color: C.ink, cursor: 'pointer' }}>
              {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span style={{ fontSize: 12.5, color: C.muted, fontFamily: C.font }}>entries</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12.5, color: C.muted, fontFamily: C.font }}>Search:</span>
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} style={{ padding: '7px 11px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12.5, fontFamily: C.font, color: C.ink, outline: 'none' }} />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '30px 0', textAlign: 'center', color: C.muted2 }}><Ico ti="ti-loader-2" size={18} style={{ animation: 'spin .8s linear infinite' }} /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '30px 0', textAlign: 'center', color: C.muted2, fontSize: 13, fontFamily: C.font }}>No payment records yet.</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.font, minWidth: 760 }}>
                <thead>
                  <tr style={{ background: C.bg }}>
                    {['Order ID', 'Plan', 'Amount', 'Method', 'Transaction ID', 'Proof', 'Status', 'Date', 'Action'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10.5, fontWeight: 800, color: C.muted2, letterSpacing: .3, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => {
                    const s = STATUS_STYLE[r.status] || STATUS_STYLE.pending;
                    return (
                      <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: '11px 12px', fontSize: 12.5, color: C.ink, fontWeight: 700 }}>#{r.orderId}</td>
                        <td style={{ padding: '11px 12px', fontSize: 12.5, color: C.ink }}>{r.plan}</td>
                        <td style={{ padding: '11px 12px', fontSize: 12.5, color: C.ink, fontWeight: 700 }}>{naira(r.amount)}</td>
                        <td style={{ padding: '11px 12px' }}>
                          <span style={{ padding: '3px 9px', borderRadius: 6, background: '#0EA5E9', color: '#fff', fontSize: 11, fontWeight: 800 }}>{r.method}</span>
                        </td>
                        <td style={{ padding: '11px 12px', fontSize: 12, color: C.muted2 }}>{r.transactionId || '-'}</td>
                        <td style={{ padding: '11px 12px', fontSize: 12, color: C.muted2 }}>{r.proofUrl ? <a href={r.proofUrl} target="_blank" rel="noreferrer" style={{ color: BLUE }}>View</a> : '-'}</td>
                        <td style={{ padding: '11px 12px' }}>
                          <span style={{ padding: '4px 10px', borderRadius: 6, background: s.bg, color: s.color, fontSize: 11, fontWeight: 800 }}>{s.label}</span>
                        </td>
                        <td style={{ padding: '11px 12px', fontSize: 12, color: C.muted2, whiteSpace: 'nowrap' }}>{formatDate(r.createdAt)}</td>
                        <td style={{ padding: '11px 12px' }}>
                          {r.status === 'pending' && (
                            <button onClick={() => retry(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 7, border: 'none', background: C.brand, color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: C.font, whiteSpace: 'nowrap' }}>
                              <Ico ti="ti-credit-card" size={11} /> Pay Now
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
              <span style={{ fontSize: 12, color: C.muted2, fontFamily: C.font }}>
                Showing {Math.min((page - 1) * pageSize + 1, filtered.length)} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} entries
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: '6px 12px', borderRadius: 7, border: `1.5px solid ${C.border}`, background: C.surface, color: page === 1 ? C.muted2 : C.muted, fontSize: 12, fontWeight: 700, cursor: page === 1 ? 'default' : 'pointer', fontFamily: C.font }}>Previous</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button key={n} onClick={() => setPage(n)} style={{ padding: '6px 12px', borderRadius: 7, border: 'none', background: n === page ? C.brand : C.surface, color: n === page ? '#fff' : C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: C.font, boxShadow: n === page ? 'none' : `inset 0 0 0 1.5px ${C.border}` }}>{n}</button>
                ))}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ padding: '6px 12px', borderRadius: 7, border: `1.5px solid ${C.border}`, background: C.surface, color: page === totalPages ? C.muted2 : C.muted, fontSize: 12, fontWeight: 700, cursor: page === totalPages ? 'default' : 'pointer', fontFamily: C.font }}>Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
