/**
 * WalletPage — coin balance, top-up (Paystack), AI-usage ledger, and
 * (for school admins) allocating coins to students.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins, Plus, Loader2, ArrowUpRight, ArrowDownRight, Wallet as WalletIcon, Send } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { inputStyle } from '../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, FONT } from '../constants.js';

const COIN_PRESETS = [500, 2000, 5000, 20000];
const fmt = (n) => Number(n || 0).toLocaleString();
const TYPE_LABEL = { topup: 'Top-up', debit: 'AI usage', grant: 'Grant', allocate: 'Allocation', refund: 'Refund', adjust: 'Adjustment' };

export default function WalletPage() {
  const [data, setData] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [coins, setCoins] = useState(2000);
  const [target, setTarget] = useState('school');       // 'school' | 'user'
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(() => {
    apiGet('/api/wallet').then((r) => setData(r.data)).catch(() => setData({ balance: 0, accounts: [], recent: [] }));
  }, []);
  useEffect(() => {
    load();
    apiGet('/api/wallet/pricing').then((r) => setPricing(r.data)).catch(() => {});
    // Coming back from Paystack? The webhook credits async — refresh a few times.
    if (new URLSearchParams(window.location.search).get('ref')) {
      showToast('Confirming your top-up…');
      let n = 0; const t = setInterval(() => { load(); if (++n >= 5) clearInterval(t); }, 2500);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [load]);

  const navigate = useNavigate();
  const topUp = () => {
    if (!coins || coins < 1) return showToast('Enter a coin amount');
    navigate('/purchase', { state: { type: 'topup', coins: Number(coins), target, title: `${Number(coins).toLocaleString()} coins`, subtitle: `${target === 'school' ? 'School' : 'My'} wallet top-up`, amountNaira: nairaFor(Number(coins)) } });
  };

  const schoolAcc = data?.accounts?.find((a) => a.kind === 'school');
  const userAcc   = data?.accounts?.find((a) => a.kind === 'user');
  const nairaFor  = (c) => pricing ? Math.round(c * (pricing.coinPriceNaira || 0)) : null;

  return (
    <PageLayout title="Wallet & AI Credits" subtitle="Top up coins — every AI feature draws from this balance">
      {/* Balance cards */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        {schoolAcc && <BalanceCard label="School balance" balance={schoolAcc.balance} accent={AMBER} icon={WalletIcon} />}
        {userAcc && <BalanceCard label="My balance" balance={userAcc.balance} accent={GREEN} icon={Coins} />}
      </div>

      {/* Top-up */}
      <div style={card}>
        <div style={cardTitle}><Plus size={16} /> Top up</div>
        {schoolAcc && userAcc && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {[['school', 'School wallet'], ['user', 'My wallet']].map(([v, l]) => (
              <button key={v} onClick={() => setTarget(v)} style={{ ...pill, ...(target === v ? pillOn : {}) }}>{l}</button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {COIN_PRESETS.map((c) => (
            <button key={c} onClick={() => setCoins(c)} style={{ ...pill, ...(Number(coins) === c ? pillOn : {}) }}>
              {fmt(c)} coins{nairaFor(c) != null && <span style={{ opacity: 0.7, marginLeft: 6 }}>≈ ₦{fmt(nairaFor(c))}</span>}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="number" min="1" value={coins} onChange={(e) => setCoins(e.target.value)} style={{ ...inputStyle, width: 160 }} />
          {nairaFor(coins) != null && <span style={{ fontSize: 12.5, color: MUTED }}>≈ ₦{fmt(nairaFor(coins))}</span>}
          <button onClick={topUp} style={primaryBtn}><Plus size={14} /> Continue to checkout</button>
        </div>
        {pricing && (
          <div style={{ marginTop: 14, fontSize: 12, color: MUTED2 }}>
            Example costs: {pricing.examples?.map((e) => `${e.label} ≈ ${e.coins} coin${e.coins === 1 ? '' : 's'}`).join(' · ')}
          </div>
        )}
      </div>

      {/* Allocate to a student (school admins) */}
      {schoolAcc && <AllocatePanel onDone={load} onToast={showToast} />}

      {/* Ledger */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ ...cardTitle, padding: '16px 18px 0' }}>Recent activity</div>
        {(!data?.recent || data.recent.length === 0) ? (
          <div style={{ padding: 28, textAlign: 'center', color: MUTED2, fontSize: 13 }}>No transactions yet.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: FONT, marginTop: 10 }}>
            <thead><tr>{['When', 'Type', 'Detail', 'Coins', 'Balance'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.recent.map((t) => (
                <tr key={t.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={td}>{new Date(t.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td style={td}>{TYPE_LABEL[t.type] || t.type}</td>
                  <td style={{ ...td, color: MUTED2 }}>{t.feature || t.model || '—'}{t.tokens_in ? ` · ${fmt((t.tokens_in || 0) + (t.tokens_out || 0))} tok` : ''}</td>
                  <td style={{ ...td, fontWeight: 800, color: t.delta >= 0 ? GREEN : RED }}>
                    {t.delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {t.delta >= 0 ? '+' : ''}{fmt(t.delta)}
                  </td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(t.balance_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {toast && <div style={toastStyle}>{toast}</div>}
    </PageLayout>
  );
}

function BalanceCard({ label, balance, accent, icon: Icon }) {
  return (
    <div style={{ flex: '1 1 240px', background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 14, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: MUTED, fontSize: 12.5, fontWeight: 700, fontFamily: FONT }}><Icon size={15} color={accent} /> {label}</div>
      <div style={{ fontSize: 32, fontWeight: 900, color: INK, marginTop: 6, fontFamily: FONT }}>{fmt(balance)} <span style={{ fontSize: 15, color: MUTED2, fontWeight: 700 }}>coins</span></div>
    </div>
  );
}

function AllocatePanel({ onDone, onToast }) {
  const [students, setStudents] = useState([]);
  const [sel, setSel] = useState('');
  const [coins, setCoins] = useState(200);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    apiGet('/api/school/mgmt/students').then((r) => setStudents((r.data || []).filter((s) => s.user_id))).catch(() => {});
  }, []);
  const allocate = async () => {
    if (!sel || !coins) return onToast('Pick a student and amount');
    setBusy(true);
    try {
      await apiPost('/api/wallet/allocate', { student_user_id: sel, coins: Number(coins) });
      onToast('Coins allocated ✓'); onDone();
    } catch (e) { onToast(e.message || 'Could not allocate'); }
    finally { setBusy(false); }
  };
  if (!students.length) return null;
  return (
    <div style={card}>
      <div style={cardTitle}><Send size={15} /> Give coins to a student</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ ...inputStyle, width: 240, cursor: 'pointer' }}>
          <option value="">— select student —</option>
          {students.map((s) => <option key={s.id} value={s.user_id}>{[s.first_name, s.last_name].filter(Boolean).join(' ') || s.admission_no}</option>)}
        </select>
        <input type="number" min="1" value={coins} onChange={(e) => setCoins(e.target.value)} style={{ ...inputStyle, width: 120 }} />
        <button onClick={allocate} disabled={busy} style={primaryBtn}>{busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Send size={14} />} Allocate</button>
      </div>
    </div>
  );
}

const card = { background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 14, padding: 18, marginBottom: 20, fontFamily: FONT };
const cardTitle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, color: INK, marginBottom: 14 };
const pill = { padding: '8px 13px', borderRadius: 9, border: `1px solid ${BORDER}`, background: WHITE, color: INK, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT };
const pillOn = { border: `1px solid ${AMBER}`, background: `${AMBER}12`, color: '#B45309' };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11.5, fontWeight: 800, color: MUTED2, background: LIGHT };
const td = { padding: '10px 14px', fontSize: 12.5, color: MUTED, verticalAlign: 'middle' };
const toastStyle = { position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, fontFamily: FONT };
