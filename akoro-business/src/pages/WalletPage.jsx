import { useState, useEffect, useCallback } from 'react';
import { PageLayout } from '../components/Layout.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, GREEN, RED, ACCENT, FONT } from '../constants.js';

const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function WalletPage() {
  const { current } = useStartup();
  const [wallet, setWallet] = useState(null);
  const [withdrawals, setWithdrawals] = useState(null);
  const [form, setForm] = useState({ amountUsd: '', bankCode: '', accountNumber: '', accountName: '' });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3500); };

  const load = useCallback(() => {
    if (!current) return;
    apiGet(`/api/vouchers/startups/${current.id}/wallet`).then(setWallet).catch(() => setWallet({ balance: 0, recent: [] }));
    apiGet(`/api/vouchers/startups/${current.id}/withdrawals`).then((r) => setWithdrawals(r.withdrawals || [])).catch(() => setWithdrawals([]));
  }, [current]);
  useEffect(() => { load(); }, [load]);

  const withdraw = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await apiPost(`/api/vouchers/startups/${current.id}/withdraw`, {
        amountUsd: Number(form.amountUsd), bankCode: form.bankCode, accountNumber: form.accountNumber, accountName: form.accountName || undefined,
      });
      showToast(r.status === 'paid' ? 'Paid ✓' : 'Withdrawal submitted — processing');
      setForm({ amountUsd: '', bankCode: '', accountNumber: '', accountName: '' });
      load();
    } catch (e2) {
      showToast(e2.status === 402 ? 'Insufficient balance' : (e2.message || 'Withdrawal failed'));
    } finally { setBusy(false); }
  };

  if (!current || !wallet) return <PageLayout title="Balance & Withdraw">Loading…</PageLayout>;

  return (
    <PageLayout title="Balance & Withdraw" subtitle={`You earn on REDEEMED credits, net of a ${wallet.platformFeePct}% platform fee`}>
      <div style={{ background: `linear-gradient(135deg,#111827,#1F2937)`, borderRadius: 16, padding: '22px 20px', color: '#fff', marginBottom: 20, maxWidth: 420 }}>
        <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.8 }}>Withdrawable balance</div>
        <div style={{ fontSize: 32, fontWeight: 900, marginTop: 4 }}>{usd(wallet.balance)}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20, alignItems: 'start' }}>
        <form onSubmit={withdraw} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: INK, marginBottom: 14 }}>Withdraw to bank</div>
          <label style={lbl}>Amount (USD)</label>
          <input type="number" min="1" step="0.01" required value={form.amountUsd} onChange={(e) => setForm({ ...form, amountUsd: e.target.value })} style={inp} />
          <label style={lbl}>Bank code</label>
          <input required value={form.bankCode} onChange={(e) => setForm({ ...form, bankCode: e.target.value })} placeholder="e.g. 058" style={inp} />
          <label style={lbl}>Account number</label>
          <input required value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} style={inp} />
          <label style={lbl}>Account name (optional)</label>
          <input value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} style={inp} />
          <button type="submit" disabled={busy} style={{ ...primaryBtn, width: '100%', marginTop: 14 }}>{busy ? 'Submitting…' : 'Request withdrawal'}</button>
          {toast && <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: INK }}>{toast}</div>}
        </form>

        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: INK, padding: '14px 18px 0' }}>Ledger</div>
          {(wallet.recent || []).length === 0 ? <div style={{ padding: 24, color: MUTED2, fontSize: 12.5 }}>No activity yet.</div> :
            wallet.recent.map((t) => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 18px', borderTop: `1px solid ${BORDER}` }}>
                <span style={{ fontSize: 12, color: MUTED, textTransform: 'capitalize' }}>{t.type.replace(/_/g, ' ')}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: t.delta_usd >= 0 ? GREEN : RED }}>{t.delta_usd >= 0 ? '+' : ''}{usd(t.delta_usd)}</span>
              </div>
            ))}
        </div>
      </div>

      {withdrawals?.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: INK, marginBottom: 10 }}>Withdrawal history</div>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
            {withdrawals.map((w) => (
              <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 18px', borderTop: `1px solid ${BORDER}` }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{usd(w.amount_usd)}</div>
                  <div style={{ fontSize: 11.5, color: MUTED2 }}>{new Date(w.created_at).toLocaleString()}</div>
                </div>
                <span style={{ alignSelf: 'center', fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 100,
                  color: w.status === 'paid' ? GREEN : w.status === 'failed' ? RED : '#B45309',
                  background: w.status === 'paid' ? `${GREEN}14` : w.status === 'failed' ? `${RED}14` : '#FFF7E6' }}>{w.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageLayout>
  );
}

const lbl = { display: 'block', fontSize: 11.5, fontWeight: 700, color: MUTED2, margin: '10px 0 4px' };
const inp = { width: '100%', padding: '9px 12px', borderRadius: 9, border: `1px solid ${BORDER}`, fontSize: 13, fontFamily: FONT, outline: 'none' };
const primaryBtn = { padding: '10px 16px', borderRadius: 10, border: 'none', background: ACCENT, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
