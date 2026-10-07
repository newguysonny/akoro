import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { History, Loader2, CheckCircle2, Users } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import BackButton from '../components/BackButton.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';

const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const formatDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function ManageSubscriptionPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [plans, setPlans] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [toast, setToast] = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3200); };

  const load = useCallback(() => {
    apiGet('/api/school/subscription')
      .then((res) => { setPlans(res.data.plans || []); setCurrent(res.data.current); })
      .catch((e) => showToast(e.message || 'Could not load subscription'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const ref = params.get('sub_ref');
    if (ref) {
      window.history.replaceState({}, '', window.location.pathname);
      apiGet(`/api/school/subscription/verify/${ref}`)
        .then((r) => showToast(r?.activated ? 'Subscription activated ✓' : (r?.message || 'Payment not completed')))
        .catch((e) => showToast(e.message || 'Verification failed'))
        .finally(load);
    } else { load(); }
  }, [load, params]);

  // Review on the checkout page before Paystack opens.
  const checkout = (planKey, cycle, plan) => {
    const amountNaira = cycle === 'yearly' ? plan?.priceYearly : plan?.priceMonthly;
    navigate('/purchase', { state: { title: `${plan?.name || 'Subscription'} — ${cycle === 'yearly' ? 'Yearly' : 'Monthly'}`, subtitle: 'School subscription', amountNaira, initPath: '/api/school/subscription/checkout', initBody: { planKey, cycle } } });
  };

  const statusColor = { active: GREEN, trial: BLUE, expired: RED, cancelled: MUTED2 };

  return (
    <PageLayout title="Manage Subscription" subtitle="View your plan and upgrade at any time">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <BackButton onClick={() => navigate('/settings-billing')} label="Back to Settings" />
        <button onClick={() => navigate('/settings-subscription-history')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${BLUE}55`, background: `${BLUE}0C`, color: BLUE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <History size={14} /> Payment History
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Current plan */}
        <div style={{ flex: '1 1 300px', minWidth: 280, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ background: BLUE, padding: '11px 18px' }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: WHITE, fontFamily: FONT }}>Current Plan Details</span>
          </div>
          <div style={{ padding: '18px 20px' }}>
            <p style={{ fontSize: 18, fontWeight: 800, color: INK, margin: '0 0 8px', fontFamily: FONT }}>{current?.name}</p>
            <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 18px', lineHeight: 1.6, fontFamily: FONT }}>{current?.description}</p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Users size={14} color={MUTED2} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT }}>Max Students: {current?.maxStudents}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT }}>Status:</span>
              <span style={{ padding: '3px 10px', borderRadius: 999, background: `${statusColor[current?.status] || MUTED2}15`, color: statusColor[current?.status] || MUTED2, fontSize: 11, fontWeight: 800, fontFamily: FONT, textTransform: 'capitalize' }}>{current?.status}</span>
            </div>

            {current?.endsAt && (
              <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: 0, fontFamily: FONT }}>
                Subscription Ends On: <span style={{ color: RED }}>{formatDate(current.endsAt)}</span>
              </p>
            )}
          </div>
        </div>

        {/* Renew/Upgrade */}
        <div style={{ flex: '1.4 1 420px', minWidth: 320, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ background: GREEN, padding: '11px 18px' }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: WHITE, fontFamily: FONT }}>Renew or Upgrade Plan</span>
          </div>
          <div style={{ padding: '18px 20px' }}>
            <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 16px', fontFamily: FONT }}>Select a plan below to proceed to payment.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {plans.map((p) => {
                const isCurrent = p.key === current?.planKey;
                return (
                  <div key={p.key} style={{ border: `1.5px solid ${isCurrent ? GREEN : BORDER}`, borderRadius: 12, padding: '14px 16px', position: 'relative' }}>
                    {isCurrent && <span style={{ position: 'absolute', top: -9, right: 14, background: GREEN, color: WHITE, fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 3 }}><CheckCircle2 size={10} /> Current</span>}
                    <p style={{ fontSize: 14, fontWeight: 800, color: INK, margin: '0 0 4px', fontFamily: FONT }}>{p.name} <span style={{ fontWeight: 600, color: MUTED2, fontSize: 12 }}>(Up to {p.maxStudents} students)</span></p>
                    <p style={{ fontSize: 12, color: MUTED, margin: '0 0 12px', lineHeight: 1.55, fontFamily: FONT }}>{p.description}</p>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button onClick={() => checkout(p.key, "monthly", p)} disabled={busyKey === `${p.key}-monthly`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: `1.5px solid ${BLUE}`, background: WHITE, color: BLUE, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                        {busyKey === `${p.key}-monthly` ? <Loader2 size={12} style={{ animation: 'spin .8s linear infinite' }} /> : null} Pay Monthly - {naira(p.priceMonthly)}
                      </button>
                      <button onClick={() => checkout(p.key, "yearly", p)} disabled={busyKey === `${p.key}-yearly`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: AMBER, color: WHITE, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                        {busyKey === `${p.key}-yearly` ? <Loader2 size={12} style={{ animation: 'spin .8s linear infinite' }} /> : null} Pay Yearly - {naira(p.priceYearly)}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
