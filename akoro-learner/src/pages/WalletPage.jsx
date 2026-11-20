/**
 * WalletPage (learner) — coin balance, top-up via Paystack, and AI-usage history.
 * Reached from the header balance chip and the Settings "Credit Balance" card.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/common/Icons.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { useWallet } from '../hooks/useWallet.js';
import { BRAND, GREEN, RED, GOLD } from '../constants.js';
import { AppShell } from '../components/AppShell.jsx';

const PRESETS = [500, 2000, 5000, 20000];
const fmt = (n) => Number(n || 0).toLocaleString();
const TYPE_LABEL = { topup: 'Top-up', debit: 'AI usage', grant: 'Grant', allocate: 'From school', refund: 'Refund', adjust: 'Adjustment' };

export default function WalletPage() {
  const navigate = useNavigate();
  const { wallet, balance, refresh } = useWallet();
  const [pricing, setPricing] = useState(null);
  const [coins, setCoins] = useState(2000);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherErr, setVoucherErr] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const redeemVoucher = async (e) => {
    e.preventDefault();
    const code = voucherCode.trim();
    if (!code) return setVoucherErr('Enter a voucher code');
    setBusy(true); setVoucherErr('');
    try {
      const r = await apiPost('/api/wallet/redeem-voucher', { code });
      const d = r?.data ?? r;
      showToast(`Voucher redeemed — +${fmt(d.coins)} coins`);
      setVoucherCode(''); setVoucherOpen(false);
      refresh();
    } catch (e2) {
      setVoucherErr(e2?.message || 'Could not redeem that code');
    } finally { setBusy(false); }
  };

  useEffect(() => {
    apiGet('/api/wallet/pricing').then((r) => setPricing(r.data)).catch(() => {});
    if (new URLSearchParams(window.location.search).get('ref')) {
      showToast('Confirming your top-up…');
      let n = 0; const t = setInterval(() => { refresh(); if (++n >= 5) clearInterval(t); }, 2500);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [refresh]);

  const nairaFor = (c) => pricing ? Math.round(c * (pricing.coinPriceNaira || 0)) : null;

  const topUp = () => {
    if (!coins || coins < 1) return showToast('Enter a coin amount');
    // Reuse the shared checkout page (top-up mode) before Paystack opens.
    navigate('/checkout', { state: { mode: 'topup', coins: Number(coins), target: 'user', amountNaira: nairaFor(Number(coins)) } });
  };

  const recent = wallet?.recent || [];

  return (
    <AppShell>
    <div style={{ minHeight: '100%', background: 'var(--ak-bg)', fontFamily: "'Nunito',sans-serif", color: 'var(--ak-text)' }}>
      {/* Header */}
      <div style={{ background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--ak-text)', lineHeight: 1 }}>‹</button>
        <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Wallet & AI Credits</h1>
      </div>

      {/* Full-width content, matching the settings page: 16px gutters, no centred column. */}
      <div style={{ padding: '18px 16px 24px' }}>
        {/* Balance */}
        <div style={{ background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, borderRadius: 18, padding: '22px 20px', color: '#fff', marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.85 }}>Your balance</div>
          <div style={{ fontSize: 40, fontWeight: 900, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="ti-coins" size={26} color="#FDE68A"/>{fmt(balance)} <span style={{ fontSize: 16, fontWeight: 700, opacity: 0.85 }}>coins</span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>Every AI feature — tutor chat, quizzes, assessments — spends from here.</div>
        </div>

        {/* Top up */}
        <div style={card}>
          <div style={cardTitle}>Top up</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {PRESETS.map((c) => (
              <button key={c} onClick={() => setCoins(c)} style={{ ...pill, ...(Number(coins) === c ? pillOn : {}) }}>
                {fmt(c)}{nairaFor(c) != null && <span style={{ opacity: 0.7, marginLeft: 5 }}>≈₦{fmt(nairaFor(c))}</span>}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="number" min="1" value={coins} onChange={(e) => setCoins(e.target.value)} style={inp} />
            {nairaFor(coins) != null && <span style={{ fontSize: 13, color: 'var(--ak-text-sub)' }}>≈ ₦{fmt(nairaFor(coins))}</span>}
            <button onClick={topUp} style={primaryBtn}>Continue to checkout</button>
          </div>
          {pricing && (
            <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--ak-text-muted)' }}>
              e.g. {pricing.examples?.map((e) => `${e.label} ≈ ${e.coins}`).join(' · ')} coins
            </div>
          )}

          {/* Voucher redemption — a code bought from an agent, offline */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--ak-border)' }}>
            {!voucherOpen ? (
              <button onClick={() => { setVoucherOpen(true); setVoucherErr(''); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px dashed var(--ak-border2)', background: 'transparent', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)' }}>
                <Icon name="ti-ticket" size={16} color={BRAND}/> Top up with a voucher code
              </button>
            ) : (
              <form onSubmit={redeemVoucher}>
                <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}><Icon name="ti-ticket" size={13}/> Redeem a voucher code</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input value={voucherCode} onChange={(e) => setVoucherCode(e.target.value.toUpperCase())} autoFocus
                    placeholder="XXXX-XXXX-XXXX"
                    style={{ ...inp, flex: 1, minWidth: 170, fontFamily: 'monospace', letterSpacing: 0.5 }} />
                  <button type="submit" disabled={busy} style={primaryBtn}>{busy ? 'Redeeming…' : 'Redeem'}</button>
                  <button type="button" onClick={() => { setVoucherOpen(false); setVoucherErr(''); }}
                    style={{ padding: '10px 14px', borderRadius: 11, border: '1px solid var(--ak-border)', background: 'transparent', color: 'var(--ak-text-sub)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>Cancel</button>
                </div>
                {voucherErr && <div style={{ color: RED, fontSize: 12.5, fontWeight: 700, marginTop: 8 }}>{voucherErr}</div>}
                <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 8 }}>Bought a code from an Akoro agent? Enter it here to add coins instantly.</div>
              </form>
            )}
          </div>
        </div>

        {/* History */}
        <div style={{ ...card, padding: 0 }}>
          <div style={{ ...cardTitle, padding: '16px 16px 4px' }}>Recent activity</div>
          {recent.length === 0 ? (
            <div style={{ padding: 26, textAlign: 'center', color: 'var(--ak-text-muted)', fontSize: 13 }}>No transactions yet.</div>
          ) : recent.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--ak-border)' }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{TYPE_LABEL[t.type] || t.type}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)' }}>
                  {(t.feature || t.model || '').replace(/_/g, ' ')}{t.tokens_in ? ` · ${fmt((t.tokens_in || 0) + (t.tokens_out || 0))} tok` : ''} · {new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 900, color: t.delta >= 0 ? GREEN : RED }}>{t.delta >= 0 ? '+' : ''}{fmt(t.delta)}</div>
            </div>
          ))}
        </div>
      </div>
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
    </AppShell>
  );
}

const card = { background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 16, padding: 16, marginBottom: 16 };
const cardTitle = { fontSize: 14, fontWeight: 800, marginBottom: 12 };
const pill = { padding: '9px 13px', borderRadius: 100, border: '1px solid var(--ak-border)', background: 'var(--ak-bg)', color: 'var(--ak-text)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const pillOn = { border: `1px solid ${BRAND}`, background: `${BRAND}14`, color: BRAND };
const inp = { width: 130, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--ak-border)', background: 'var(--ak-bg)', color: 'var(--ak-text)', fontSize: 14, fontFamily: 'inherit' };
const primaryBtn = { padding: '10px 16px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' };
const toastStyle = { position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: '#2D2D2D', color: '#fff', padding: '10px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 };
