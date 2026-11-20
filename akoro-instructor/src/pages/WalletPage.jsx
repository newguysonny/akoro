/**
 * WalletPage (instructor) — coin balance, Paystack top-up, and AI-usage ledger.
 * Every AI feature (agent tasks, AI chat, generators) draws from this balance.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../services/api.js';
import { PageLayout } from '../components/Layout.jsx';
import { GREEN, RED } from '../constants.js';
import { C } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';
import { BRAND } from '../ui/tokens.js';
import {
  WalletBalanceCard, WalletPanel, WalletPreset, WalletPrimaryButton, WalletRow,
} from '../shared/WalletShell.jsx';

const PRESETS = [500, 2000, 5000, 20000];
const fmt = (n) => Number(n || 0).toLocaleString();
const TYPE_LABEL = { topup: 'Top-up', debit: 'AI usage', grant: 'Grant', allocate: 'Allocation', refund: 'Refund', adjust: 'Adjustment' };

export default function WalletPage() {
  const [data, setData] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [coins, setCoins] = useState(2000);
  const [busy, setBusy] = useState(false);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherErr, setVoucherErr] = useState('');
  const [voucherMsg, setVoucherMsg] = useState('');
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(() => {
    apiGet('/api/wallet').then((r) => setData(r.data)).catch(() => setData({ balance: 0, accounts: [], recent: [] }));
  }, []);
  useEffect(() => {
    load();
    apiGet('/api/wallet/pricing').then((r) => setPricing(r.data)).catch(() => {});
    if (new URLSearchParams(window.location.search).get('ref')) {
      showToast('Confirming your top-up…');
      let n = 0; const t = setInterval(() => { load(); if (++n >= 5) clearInterval(t); }, 2500);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [load]);

  const navigate = useNavigate();
  const nairaFor = (c) => pricing ? Math.round(c * (pricing.coinPriceNaira || 0)) : null;
  const topUp = () => {
    if (!coins || coins < 1) return showToast('Enter a coin amount');
    navigate('/purchase', { state: { title: `${Number(coins).toLocaleString()} coins`, subtitle: 'Wallet top-up', amountNaira: nairaFor(Number(coins)), coins: Number(coins), initPath: '/api/wallet/topup/init', initBody: { coins: Number(coins), target: 'user' } } });
  };

  const recent = data?.recent || [];
  // Redeem a voucher code bought from an Akoro agent. Same endpoint the
  // learner app uses — 1 voucher credit = 1 coin, credited server-side.
  const redeemVoucher = async (e) => {
    e.preventDefault();
    const code = voucherCode.trim();
    if (!code) return setVoucherErr('Enter a voucher code');
    setBusy(true); setVoucherErr(''); setVoucherMsg('');
    try {
      const r = await apiPost('/api/wallet/redeem-voucher', { code });
      const d = r?.data ?? r;
      setVoucherMsg(`Redeemed — +${fmt(d.coins)} coins added.`);
      setVoucherCode(''); setVoucherOpen(false);
      load();
    } catch (e2) {
      setVoucherErr(e2?.message || 'Could not redeem that code');
    } finally { setBusy(false); }
  };

  return (
    <PageLayout title="Wallet & AI Credits" subtitle="Top up coins — every AI feature draws from this balance">
    <div style={{ fontFamily: C.font }}>
      <WalletBalanceCard
        accent={BRAND}
        label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Ico ti="ti-wallet" size={15} /> Your balance</span>}
        amount={data?.balance}
        unit="coins"
        icon={<Ico ti="ti-coins" size={30} />}
      />

      <WalletPanel title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Ico ti="ti-plus" size={16} /> Top up</span>}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {PRESETS.map((c) => (
            <WalletPreset key={c} active={Number(coins) === c} onClick={() => setCoins(c)}>
              {fmt(c)}{nairaFor(c) != null && <span style={{ opacity: 0.7, marginLeft: 5 }}>≈₦{fmt(nairaFor(c))}</span>}
            </WalletPreset>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="number" min="1" value={coins} onChange={(e) => setCoins(e.target.value)} style={inp} />
          {nairaFor(coins) != null && <span style={{ fontSize: 12.5, color: C.muted }}>≈ ₦{fmt(nairaFor(coins))}</span>}
          <WalletPrimaryButton onClick={topUp} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Ico ti="ti-plus" size={14} /> Continue to checkout
          </WalletPrimaryButton>
        </div>
        {pricing && <div style={{ marginTop: 12, fontSize: 12, color: C.muted2 }}>Example: {pricing.examples?.map((e) => `${e.label} ≈ ${e.coins}`).join(' · ')} coins</div>}

        {/* Voucher redemption — a code bought from an Akoro agent, offline */}
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
          {voucherMsg && <div style={{ fontSize: 12.5, fontWeight: 800, color: GREEN, marginBottom: 10 }}>{voucherMsg}</div>}
          {!voucherOpen ? (
            <button onClick={() => { setVoucherOpen(true); setVoucherErr(''); setVoucherMsg(''); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, border: `1px dashed ${C.border}`, background: 'transparent', cursor: 'pointer', fontFamily: C.font, fontSize: 13, fontWeight: 800, color: C.ink }}>
              <Ico ti="ti-ticket" size={15} /> Top up with a voucher code
            </button>
          ) : (
            <form onSubmit={redeemVoucher}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, marginBottom: 8 }}>Redeem a voucher code</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={voucherCode} onChange={(e) => setVoucherCode(e.target.value.toUpperCase())} autoFocus
                  placeholder="XXXX-XXXX-XXXX"
                  style={{ ...inp, width: 190, fontFamily: 'monospace', letterSpacing: 0.5 }} />
                <button type="submit" disabled={busy} style={primaryBtn}>{busy ? 'Redeeming…' : 'Redeem'}</button>
                <button type="button" onClick={() => { setVoucherOpen(false); setVoucherErr(''); }}
                  style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>Cancel</button>
              </div>
              {voucherErr && <div style={{ color: RED, fontSize: 12.5, fontWeight: 700, marginTop: 8 }}>{voucherErr}</div>}
              <div style={{ fontSize: 11.5, color: C.muted2, marginTop: 8 }}>Bought a code from an Akoro agent? Enter it here to add coins instantly.</div>
            </form>
          )}
        </div>
      </WalletPanel>

      <WalletPanel title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Ico ti="ti-coins" size={16} /> Recent activity</span>}>
        {recent.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: C.muted2, fontSize: 13 }}>No transactions yet.</div>
        ) : (
          recent.map((t, i) => (
            <WalletRow
              key={t.id}
              last={i === recent.length - 1}
              title={TYPE_LABEL[t.type] || t.type}
              detail={`${(t.feature || t.model || '—').replace(/_/g, ' ')} · ${new Date(t.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
              amount={<>{t.delta >= 0 ? <Ico ti="ti-arrow-up-right" size={13} /> : <Ico ti="ti-arrow-down-right" size={13} />} {t.delta >= 0 ? '+' : ''}{fmt(t.delta)}</>}
              positive={t.delta >= 0}
            />
          ))
        )}
      </WalletPanel>
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
    </PageLayout>
  );
}

const inp = { width: 140, padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 14, fontFamily: C.font };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: C.font };
const toastStyle = { position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, fontFamily: C.font };
