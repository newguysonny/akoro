/**
 * SalesPage — an instructor's sales: every learner purchase of their courses,
 * with your net earning, the platform fee and payout status. Backed by
 * GET /api/instructor/earnings.
 */
import { useState, useEffect } from 'react';
import { Wallet, TrendingUp, Clock, Users } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Skeleton } from '../components/Primitives.jsx';
import { apiGet } from '../services/api.js';
import { GREEN, PURPLE, RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const ngn = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const STATUS = {
  pending:  { label: 'Pending',  bg: '#FEF3C7', color: '#B45309' },
  paid:     { label: 'Paid out', bg: '#DCFCE7', color: GREEN },
  refunded: { label: 'Refunded', bg: '#F1F0F4', color: C.muted },
};

function StatCard({ icon: Icon, ti, label, value, tint }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px', fontFamily: C.font }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: tint }}>
        <Ico ti={ti} size={15} /><span style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: .3 }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 900, color: C.ink, marginTop: 6 }}>{value}</div>
    </div>
  );
}

export default function SalesPage() {
  const [data, setData]     = useState(null);   // { summary, earnings }
  const [loading, setLoad]  = useState(true);

  useEffect(() => {
    let alive = true;
    apiGet('/api/instructor/earnings')
      .then((r) => { if (alive) setData(r?.data ?? r); })
      .catch(() => { if (alive) setData({ summary: {}, earnings: [] }); })
      .finally(() => { if (alive) setLoad(false); });
    return () => { alive = false; };
  }, []);

  const s = data?.summary || {};
  const rows = data?.earnings || [];

  const TH = { fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: C.font };
  const TD = { fontSize: 13, color: C.ink, padding: '13px 14px', fontFamily: C.font, borderBottom: `1px solid ${C.border}` };

  return (
    <PageLayout title="Sales & Earnings" subtitle={loading ? '' : `${s.total_sales || 0} sale${(s.total_sales || 0) === 1 ? '' : 's'} · ${s.commission_percent ?? 0}% platform fee`}>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{[1,2,3,4,5].map(i => <Skeleton key={i} height={52} />)}</div>
      ) : (
        <>
          {/* Summary */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <StatCard icon={Wallet} ti="ti-wallet"     label="Net earned"     value={ngn(s.total_net_ngn)}     tint={PURPLE} />
            <StatCard icon={Clock} ti="ti-clock"       label="Pending payout" value={ngn(s.pending_payout_ngn)} tint={C.brand} />
            <StatCard icon={TrendingUp} ti="ti-trending-up"  label="Paid out"       value={ngn(s.paid_out_ngn)}      tint={GREEN} />
            <StatCard icon={Users} ti="ti-users"       label="Total sales"    value={s.total_sales || 0}       tint={C.ink} />
          </div>

          {/* Sales list */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr style={{ background: C.bg }}>
                  <th style={TH}>Learner</th>
                  <th style={TH}>Course</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Gross</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Your net</th>
                  <th style={TH}>Status</th>
                  <th style={TH}>Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', color: C.muted, borderBottom: 'none', padding: '40px 14px' }}>No sales yet — they’ll appear here when learners buy your courses.</td></tr>
                ) : rows.map((e) => {
                  const st = STATUS[e.status] || STATUS.pending;
                  return (
                    <tr key={e.id}>
                      <td style={TD}>{e.student?.full_name || e.student?.username || 'Learner'}</td>
                      <td style={{ ...TD }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                          <Ico ti="ti-book" size={13} color={C.muted} /> {e.courses?.title || 'Course'}
                        </span>
                      </td>
                      <td style={{ ...TD, textAlign: 'right', color: C.muted }}>{ngn((e.gross_amount || 0) / 100)}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 800 }}>{ngn((e.net_amount || 0) / 100)}</td>
                      <td style={TD}><span style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 20, background: st.bg, color: st.color }}>{st.label}</span></td>
                      <td style={{ ...TD, color: C.muted }}>{fmtDate(e.earned_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageLayout>
  );
}
