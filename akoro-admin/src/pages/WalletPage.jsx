/**
 * WalletPage (instructor) — coin balance, Paystack top-up, and AI-usage ledger.
 * Every AI feature (agent tasks, AI chat, generators) draws from this balance.
 */
import { useState, useEffect, useCallback } from 'react';
import { Coins, Plus, Loader2, ArrowUpRight, ArrowDownRight, Wallet as WalletIcon } from 'lucide-react';
import { apiGet, apiPost } from '../services/api.js';
import { PageLayout } from '../components/Layout.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, FONT } from '../constants.js';

const PRESETS = [500, 2000, 5000, 20000];
const fmt = (n) => Number(n || 0).toLocaleString();
const TYPE_LABEL = { topup: 'Top-up', debit: 'AI usage', grant: 'Grant', allocate: 'Allocation', refund: 'Refund', adjust: 'Adjustment' };

export default function WalletPage() {
  const [data, setData] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [coins, setCoins] = useState(2000);
  const [busy, setBusy] = useState(false);
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

  const nairaFor = (c) => pricing ? Math.round(c * (pricing.coinPriceNaira || 0)) : null;
  const topUp = async () => {
    if (!coins || coins < 1) return showToast('Enter a coin amount');
    setBusy(true);
    try {
      const r = await apiPost('/api/wallet/topup/init', { coins: Number(coins), target: 'user' });
      if (r.data?.authorization_url) window.location.href = r.data.authorization_url;
      else showToast('Could not start payment');
    } catch (e) { showToast(e.message || 'Top-up failed'); }
    finally { setBusy(false); }
  };

  const recent = data?.recent || [];
  return (
    <PageLayout title="Wallet & AI Credits" subtitle="Top up coins — every AI feature draws from this balance">
    <div style={{ maxWidth: 720, fontFamily: FONT }}>
      <div style={{ background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, borderRadius: 18, padding: '22px 20px', color: WHITE, marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.9, display: 'flex', alignItems: 'center', gap: 6 }}><WalletIcon size={15} /> Your balance</div>
        <div style={{ fontSize: 40, fontWeight: 900, marginTop: 4 }}>🪙 {fmt(data?.balance)} <span style={{ fontSize: 16, fontWeight: 700, opacity: 0.9 }}>coins</span></div>
      </div>

      <AdminOverview showToast={showToast} />


      <div style={card}>
        <div style={cardTitle}><Plus size={16} /> Top up</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {PRESETS.map((c) => (
            <button key={c} onClick={() => setCoins(c)} style={{ ...pill, ...(Number(coins) === c ? pillOn : {}) }}>
              {fmt(c)}{nairaFor(c) != null && <span style={{ opacity: 0.7, marginLeft: 5 }}>≈₦{fmt(nairaFor(c))}</span>}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="number" min="1" value={coins} onChange={(e) => setCoins(e.target.value)} style={inp} />
          {nairaFor(coins) != null && <span style={{ fontSize: 12.5, color: MUTED }}>≈ ₦{fmt(nairaFor(coins))}</span>}
          <button onClick={topUp} disabled={busy} style={primaryBtn}>{busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Plus size={14} />} Pay with Paystack</button>
        </div>
        {pricing && <div style={{ marginTop: 12, fontSize: 12, color: MUTED2 }}>Example: {pricing.examples?.map((e) => `${e.label} ≈ ${e.coins}`).join(' · ')} coins</div>}
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ ...cardTitle, padding: '16px 18px 0' }}><Coins size={16} /> Recent activity</div>
        {recent.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: MUTED2, fontSize: 13 }}>No transactions yet.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 10 }}>
            <thead><tr>{['When', 'Type', 'Detail', 'Coins'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {recent.map((t) => (
                <tr key={t.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={td}>{new Date(t.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td style={td}>{TYPE_LABEL[t.type] || t.type}</td>
                  <td style={{ ...td, color: MUTED2 }}>{(t.feature || t.model || '—').replace(/_/g, ' ')}</td>
                  <td style={{ ...td, fontWeight: 800, color: t.delta >= 0 ? GREEN : RED }}>{t.delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {t.delta >= 0 ? '+' : ''}{fmt(t.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
    </PageLayout>
  );
}

// Platform-wide coin analytics + a grant/adjust tool (admins only).
function AdminOverview({ showToast }) {
  const [o, setO] = useState(null);
  const [notAdmin, setNotAdmin] = useState(false);
  const [form, setForm] = useState({ owner_type: 'user', owner_id: '', coins: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const loadO = () => apiGet('/api/wallet/admin/overview').then((r) => setO(r.data)).catch(() => setNotAdmin(true));
  useEffect(() => { loadO(); }, []);
  if (notAdmin) return null;
  const grant = async () => {
    if (!form.owner_id || !Number(form.coins)) return showToast('Enter an account id and coin amount');
    setBusy(true);
    try { await apiPost('/api/wallet/admin/grant', { ...form, coins: Number(form.coins) }); showToast('Applied ✓'); setForm({ ...form, coins: '', reason: '' }); loadO(); }
    catch (e) { showToast(e.message || 'Failed'); } finally { setBusy(false); }
  };
  const Stat = ({ label, value }) => (
    <div style={{ flex: '1 1 130px', background: LIGHT, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: INK, marginTop: 2 }}>{fmt(value)}</div>
    </div>
  );
  return (
    <div style={card}>
      <div style={cardTitle}>Platform coins</div>
      {!o ? <div style={{ color: MUTED2, fontSize: 13 }}>Loading…</div> : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <Stat label="Total balance" value={o.total_balance} />
            <Stat label="Topped up (all)" value={o.total_topped_up} />
            <Stat label="Spent (all)" value={o.total_spent} />
            <Stat label="Spent · 7d" value={o.spent_7d} />
            <Stat label="Accounts" value={o.accounts} />
          </div>
          {Array.isArray(o.spend_by_feature) && o.spend_by_feature.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: MUTED2, marginBottom: 6 }}>Spend by feature</div>
              {o.spend_by_feature.slice(0, 8).map((f) => (
                <div key={f.feature} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: MUTED, padding: '3px 0' }}>
                  <span>{(f.feature || '').replace(/_/g, ' ')} <span style={{ color: MUTED2 }}>· {fmt(f.calls)} calls</span></span>
                  <span style={{ fontWeight: 800, color: INK }}>{fmt(f.coins)}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: INK, marginBottom: 8 }}>Grant / adjust coins</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={form.owner_type} onChange={(e) => setForm({ ...form, owner_type: e.target.value })} style={{ ...inp, width: 100 }}>
                <option value="user">User</option><option value="school">School</option>
              </select>
              <input placeholder="account owner id (uuid)" value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })} style={{ ...inp, width: 260 }} />
              <input type="number" placeholder="coins (± )" value={form.coins} onChange={(e) => setForm({ ...form, coins: e.target.value })} style={{ ...inp, width: 110 }} />
              <input placeholder="reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} style={{ ...inp, width: 150 }} />
              <button onClick={grant} disabled={busy} style={primaryBtn}>Apply</button>
            </div>
            <div style={{ fontSize: 11, color: MUTED2, marginTop: 6 }}>Positive coins grant credit; negative deducts. Reason is recorded in the ledger.</div>
          </div>
        </>
      )}
    </div>
  );
}

const card = { background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 14, padding: 18, marginBottom: 18 };
const cardTitle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, color: INK, marginBottom: 14 };
const pill = { padding: '9px 13px', borderRadius: 100, border: `1px solid ${BORDER}`, background: WHITE, color: INK, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT };
const pillOn = { border: `1px solid ${AMBER}`, background: `${AMBER}12`, color: '#B45309' };
const inp = { width: 140, padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER}`, background: WHITE, color: INK, fontSize: 14, fontFamily: FONT };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11.5, fontWeight: 800, color: MUTED2, background: LIGHT };
const td = { padding: '10px 14px', fontSize: 12.5, color: MUTED, verticalAlign: 'middle' };
const toastStyle = { position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, fontFamily: FONT };
