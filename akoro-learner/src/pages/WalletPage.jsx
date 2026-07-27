/**
 * WalletPage (learner) — coin balance, top-up via Paystack, and AI-usage history.
 * Reached from the header balance chip and the Settings "Credit Balance" card.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../services/api.js';
import { useWallet } from '../hooks/useWallet.js';
import { BRAND, GREEN, RED, GOLD } from '../constants.js';

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
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

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
    // Review on the checkout page before Paystack opens.
    navigate('/purchase', { state: { type: 'topup', coins: Number(coins), target: 'user', title: `${Number(coins).toLocaleString()} coins`, subtitle: 'Wallet top-up', amountNaira: nairaFor(Number(coins)) } });
  };

  const recent = wallet?.recent || [];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ak-bg)', fontFamily: "'Nunito',sans-serif", color: 'var(--ak-text)' }}>
      {/* Header */}
      <div style={{ background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--ak-text)', lineHeight: 1 }}>‹</button>
        <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Wallet & AI Credits</h1>
      </div>

      <div style={{ maxWidth: 620, margin: '0 auto', padding: 18 }}>
        {/* Balance */}
        <div style={{ background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, borderRadius: 18, padding: '22px 20px', color: '#fff', marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.85 }}>Your balance</div>
          <div style={{ fontSize: 40, fontWeight: 900, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🪙</span>{fmt(balance)} <span style={{ fontSize: 16, fontWeight: 700, opacity: 0.85 }}>coins</span>
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
  );
}

const card = { background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 16, padding: 16, marginBottom: 16 };
const cardTitle = { fontSize: 14, fontWeight: 800, marginBottom: 12 };
const pill = { padding: '9px 13px', borderRadius: 100, border: '1px solid var(--ak-border)', background: 'var(--ak-bg)', color: 'var(--ak-text)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const pillOn = { border: `1px solid ${BRAND}`, background: `${BRAND}14`, color: BRAND };
const inp = { width: 130, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--ak-border)', background: 'var(--ak-bg)', color: 'var(--ak-text)', fontSize: 14, fontFamily: 'inherit' };
const primaryBtn = { padding: '10px 16px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' };
const toastStyle = { position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: '#2D2D2D', color: '#fff', padding: '10px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 };
