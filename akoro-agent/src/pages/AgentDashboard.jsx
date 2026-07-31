/**
 * AgentDashboard — mirrors the learner app's shell: header (avatar + balance
 * chip) up top, one scrollable content area, emoji bottom nav. Tabs are held
 * in local state exactly like LearnerDashboard's NAV_ITEMS pattern.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { BRAND, GREEN, RED, AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, FONT } from '../constants.js';

const NAV_ITEMS = [
  { key: 'market',   icon: '🏪', label: 'Marketplace' },
  { key: 'wallet',   icon: '🪙', label: 'Wallet' },
  { key: 'codes',    icon: '🎟️', label: 'My Codes' },
  { key: 'startups', icon: '🏢', label: 'My Startups' },
];

const fmt = (n) => Number(n || 0).toLocaleString();
const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AgentDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('market');
  const [balance, setBalance] = useState(null);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const loadWallet = useCallback(() => {
    apiGet('/api/vouchers/wallet').then((r) => setBalance(r.balance))
      .catch((e) => { setBalance(0); showToast(e.message || 'Could not load your wallet balance'); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadWallet(); }, [loadWallet]);

  // Returning from a Paystack top-up.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('ref')) {
      showToast('Confirming your top-up…');
      let n = 0; const t = setInterval(() => { loadWallet(); if (++n >= 5) clearInterval(t); }, 2500);
      window.history.replaceState({}, '', window.location.pathname);
      setTab('wallet');
    }
  }, [loadWallet]);

  return (
    <div style={{ width: '100vw', height: '100dvh', fontFamily: FONT, background: LIGHT, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* HEADER */}
      <div style={{ background: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15, fontWeight: 900 }}>
            {(user?.fullName || user?.username || '?').trim().charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 900, color: INK, lineHeight: 1.2 }}>{user?.fullName || user?.username || 'Agent'}</div>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>Voucher Agent</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setTab('wallet')} title="Wallet balance"
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#FFF7E6', border: '1px solid #FFE2A8', borderRadius: 100, height: 34, padding: '0 12px', cursor: 'pointer' }}>
            <span style={{ fontSize: 13 }}>🪙</span>
            <span style={{ fontSize: 12.5, fontWeight: 900, color: '#B45309' }}>{balance == null ? '…' : usd(balance)}</span>
          </button>
          <button onClick={logout} title="Sign out"
            style={{ width: 34, height: 34, borderRadius: '50%', background: '#F3F4F6', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⎋</button>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: 90 }}>
        {tab === 'market'   && <MarketplaceTab onToast={showToast} onBought={loadWallet} />}
        {tab === 'wallet'   && <WalletTab balance={balance} onRefresh={loadWallet} onToast={showToast} />}
        {tab === 'codes'    && <CodesTab onToast={showToast} />}
        {tab === 'startups' && <StartupsTab onToast={showToast} />}
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: WHITE, borderTop: `1px solid ${BORDER}`, display: 'flex', padding: '6px 4px calc(6px + env(safe-area-inset-bottom,0px))' }}>
        {NAV_ITEMS.map(({ key, icon, label }) => (
          <button key={key} onClick={() => setTab(key)} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: '8px 2px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 20, opacity: tab === key ? 1 : 0.5 }}>{icon}</span>
            <span style={{ fontSize: 10.5, fontWeight: tab === key ? 800 : 600, color: tab === key ? BRAND : MUTED2 }}>{label}</span>
          </button>
        ))}
      </div>

      {toast && <div style={{ position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 18px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 999 }}>{toast}</div>}
    </div>
  );
}

/* ── Marketplace: browse startups, buy a batch of codes ─────────────────── */
function MarketplaceTab({ onToast, onBought }) {
  const [startups, setStartups] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [picked, setPicked] = useState(null);
  const [qty, setQty] = useState(10);
  const [busy, setBusy] = useState(false);
  const [lastCodes, setLastCodes] = useState(null);

  useEffect(() => {
    apiGet('/api/vouchers/marketplace')
      .then((r) => setStartups(r.startups || []))
      // Distinguish "the API told us there are zero startups" from "the
      // request itself failed" — silently collapsing both into an empty
      // list makes a real network/auth error look identical to an empty
      // marketplace, which is exactly the bug that's hard to diagnose.
      .catch((e) => { setLoadErr(e.message || 'Could not load the marketplace'); setStartups([]); });
  }, []);

  const tierFor = (s, q) => {
    const applicable = (s.discountTiers || []).filter((t) => q * (picked?.unitCredits || 1) >= t.min_credits);
    return applicable.sort((a, b) => b.min_credits - a.min_credits)[0];
  };

  const buy = async (s, unitCredits) => {
    setBusy(true); setLastCodes(null);
    try {
      const r = await apiPost('/api/vouchers/purchase', { startupId: s.id, quantity: qty, unitCredits });
      setLastCodes(r.codes || []);
      onToast(`Bought ${r.quantity} codes · ${usd(r.totalCostUsd)}`);
      onBought();
    } catch (e) {
      onToast(e.message?.includes('INSUFFICIENT') || e.status === 402 ? 'Insufficient wallet balance — top up first' : (e.message || 'Purchase failed'));
    } finally { setBusy(false); }
  };

  if (startups === null) return <Loading />;
  if (!startups.length) return <Empty text={loadErr ? `Couldn't load the marketplace — ${loadErr}` : 'No startups are selling credit yet.'} />;

  return (
    <div>
      <h2 style={h2}>Marketplace</h2>
      {startups.map((s) => (
        <div key={s.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 900, color: INK }}>{s.name}</div>
              <div style={{ fontSize: 12, color: MUTED }}>{usd(s.credit_rate_usd)} / credit</div>
            </div>
            <button onClick={() => setPicked(picked?.id === s.id ? null : { ...s, unitCredits: 100 })}
              style={{ padding: '8px 14px', borderRadius: 9, border: 'none', background: picked?.id === s.id ? MUTED2 : BRAND, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
              {picked?.id === s.id ? 'Close' : 'Buy'}
            </button>
          </div>
          {s.discountTiers?.length > 0 && (
            <div style={{ fontSize: 11, color: MUTED2, marginTop: 6 }}>
              Bulk discounts: {s.discountTiers.map((t) => `${fmt(t.min_credits)}+ → −${t.discount_pct}%`).join(' · ')}
            </div>
          )}
          {picked?.id === s.id && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}>
              <label style={smallLbl}>Credits per code</label>
              <input type="number" min="1" value={picked.unitCredits} onChange={(e) => setPicked({ ...picked, unitCredits: Number(e.target.value) })} style={inp} />
              <label style={smallLbl}>Number of codes</label>
              <input type="number" min="1" value={qty} onChange={(e) => setQty(Number(e.target.value))} style={inp} />
              {(() => { const t = tierFor(s, qty); const unitPrice = s.credit_rate_usd * (1 - (t?.discount_pct || 0) / 100);
                return <div style={{ fontSize: 12.5, color: MUTED, margin: '8px 0' }}>≈ {usd(unitPrice * qty)} total{t ? ` (−${t.discount_pct}% tier)` : ''}</div>; })()}
              <button onClick={() => buy(s, picked.unitCredits)} disabled={busy} style={{ ...primaryBtn, width: '100%' }}>{busy ? 'Buying…' : 'Confirm purchase'}</button>
            </div>
          )}
        </div>
      ))}
      {lastCodes && (
        <div style={{ ...card, background: '#F0FDF4', border: `1px solid ${GREEN}55` }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: INK, marginBottom: 8 }}>Your new codes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
            {lastCodes.map((c) => <code key={c} style={{ fontSize: 12.5, fontFamily: 'monospace', color: INK }}>{c}</code>)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Wallet: balance, top up, history ────────────────────────────────────── */
const PRESETS = [10, 50, 100, 500];
function WalletTab({ balance, onRefresh, onToast }) {
  const [amount, setAmount] = useState(50);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState(null);
  useEffect(() => {
    apiGet('/api/vouchers/wallet/transactions?limit=20').then((r) => setTx(r.transactions || []))
      .catch((e) => { setTx([]); onToast(e.message || 'Could not load transaction history'); });
  }, [balance]); // eslint-disable-line react-hooks/exhaustive-deps

  const topUp = async () => {
    if (!amount || amount <= 0) return onToast('Enter an amount');
    setBusy(true);
    try {
      const r = await apiPost('/api/vouchers/wallet/topup/init', { amountUsd: Number(amount) });
      if (r.authorization_url) window.location.href = r.authorization_url;
    } catch (e) { onToast(e.message || 'Could not start payment'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <h2 style={h2}>Wallet</h2>
      <div style={{ background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, borderRadius: 18, padding: '22px 20px', color: '#fff', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.9 }}>Available balance</div>
        <div style={{ fontSize: 34, fontWeight: 900, marginTop: 4 }}>{balance == null ? '…' : usd(balance)}</div>
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, color: INK, marginBottom: 10 }}>Top up</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {PRESETS.map((p) => (
            <button key={p} onClick={() => setAmount(p)} style={{ ...pill, ...(amount === p ? pillOn : {}) }}>{usd(p)}</button>
          ))}
        </div>
        <input type="number" min="1" value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={inp} />
        <button onClick={topUp} disabled={busy} style={{ ...primaryBtn, width: '100%', marginTop: 10 }}>{busy ? 'Starting…' : 'Continue to checkout'}</button>
      </div>
      <div style={{ ...card, padding: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: INK, padding: '14px 16px 0' }}>Recent activity</div>
        {tx === null ? <Loading /> : tx.length === 0 ? <div style={{ padding: 20, color: MUTED2, fontSize: 12.5 }}>No transactions yet.</div> : tx.map((t) => (
          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', borderTop: `1px solid ${BORDER}` }}>
            <span style={{ fontSize: 12.5, color: MUTED, textTransform: 'capitalize' }}>{t.type}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: t.delta_usd >= 0 ? GREEN : RED }}>{t.delta_usd >= 0 ? '+' : ''}{usd(t.delta_usd)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── My Codes ─────────────────────────────────────────────────────────────── */
const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Unsold/unused' },
  { key: 'used', label: 'Redeemed' },
];
function CodesTab({ onToast }) {
  const [codes, setCodes] = useState(null);
  const [filter, setFilter] = useState('all');
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    apiGet('/api/vouchers/my-codes').then((r) => setCodes(r.codes || []))
      .catch((e) => { setCodes([]); onToast(e.message || 'Could not load your codes'); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const copyCode = (c) => { navigator.clipboard?.writeText(c.code); setCopiedId(c.id); setTimeout(() => setCopiedId(null), 1800); };
  const shareCode = (c) => {
    const text = `Here's your ${c.startups?.name || 'credit'} voucher code: ${c.code}\n(worth ${c.credits} credits) — redeem it in the app to top up your balance.`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else { navigator.clipboard?.writeText(text); setCopiedId(c.id); setTimeout(() => setCopiedId(null), 1800); }
  };

  if (codes === null) return <Loading />;
  const filtered = filter === 'all' ? codes : codes.filter((c) => c.status === filter);

  return (
    <div>
      <h2 style={h2}>My Codes</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {STATUS_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{ ...pill, ...(filter === f.key ? pillOn : {}) }}>{f.label}</button>
        ))}
      </div>
      {filtered.length === 0 ? <Empty text="No codes in this view." /> : filtered.map((c) => (
        <div key={c.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: c.status === 'active' ? 10 : 0 }}>
            <div>
              <code style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 800, color: INK }}>{c.code}</code>
              <div style={{ fontSize: 11.5, color: MUTED2, marginTop: 3 }}>{c.startups?.name} · {c.credits} credits</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 100,
              color: c.status === 'active' ? GREEN : c.status === 'used' ? MUTED2 : RED,
              background: c.status === 'active' ? `${GREEN}14` : c.status === 'used' ? `${MUTED2}14` : `${RED}14` }}>{c.status}</span>
          </div>
          {c.status === 'active' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => copyCode(c)} style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: `1px solid ${BORDER}`, background: WHITE, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>{copiedId === c.id ? 'Copied ✓' : 'Copy code'}</button>
              <button onClick={() => shareCode(c)} style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', background: BRAND, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Share to customer</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── My Startups: register + manage (rate, discount tiers, API keys) ────── */
function StartupsTab({ onToast }) {
  const [startups, setStartups] = useState(null);
  const [form, setForm] = useState({ name: '', credit_rate_usd: 0.1 });
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [keys, setKeys] = useState({});
  const [newKey, setNewKey] = useState(null);

  const load = () => apiGet('/api/vouchers/startups/mine').then((r) => setStartups(r.startups || []))
    .catch((e) => { setStartups([]); onToast(e.message || 'Could not load your startups'); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const register = async () => {
    if (!form.name.trim() || !form.credit_rate_usd) return onToast('Name and a positive rate are required');
    setBusy(true);
    try { await apiPost('/api/vouchers/startups', form); setForm({ name: '', credit_rate_usd: 0.1 }); onToast('Startup registered ✓'); load(); }
    catch (e) { onToast(e.message || 'Could not register'); } finally { setBusy(false); }
  };

  const openKeys = async (s) => {
    setExpanded(expanded === s.id ? null : s.id);
    if (!keys[s.id]) {
      const r = await apiGet(`/api/vouchers/startups/${s.id}/api-keys`).catch(() => ({ keys: [] }));
      setKeys((k) => ({ ...k, [s.id]: r.keys || [] }));
    }
  };
  const issueKey = async (s) => {
    try {
      const r = await apiPost(`/api/vouchers/startups/${s.id}/api-keys`, {});
      setNewKey(r.key.rawKey);
      setKeys((k) => ({ ...k, [s.id]: [{ ...r.key, key_prefix: r.key.key_prefix }, ...(k[s.id] || [])] }));
    } catch (e) { onToast(e.message || 'Could not issue key'); }
  };

  if (startups === null) return <Loading />;

  return (
    <div>
      <h2 style={h2}>My Startups</h2>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, color: INK, marginBottom: 10 }}>Register a startup</div>
        <label style={smallLbl}>Name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inp} />
        <label style={smallLbl}>Credit rate (USD per credit)</label>
        <input type="number" step="0.01" min="0.01" value={form.credit_rate_usd} onChange={(e) => setForm({ ...form, credit_rate_usd: Number(e.target.value) })} style={inp} />
        <button onClick={register} disabled={busy} style={{ ...primaryBtn, width: '100%', marginTop: 10 }}>{busy ? 'Registering…' : 'Register startup'}</button>
      </div>

      {newKey && (
        <div style={{ ...card, background: '#FFFBEB', border: `1px solid ${AMBER}55` }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: '#92400E', marginBottom: 6 }}>⚠️ Save this key now — it won't be shown again</div>
          <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{newKey}</code>
        </div>
      )}

      {startups.length === 0 ? <Empty text="You haven't registered a startup yet." /> : startups.map((s) => (
        <div key={s.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 900, color: INK }}>{s.name}</div>
              <div style={{ fontSize: 12, color: MUTED }}>{usd(s.credit_rate_usd)}/credit · {s.status}</div>
            </div>
            <button onClick={() => openKeys(s)} style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${BORDER}`, background: WHITE, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>API keys</button>
          </div>
          {expanded === s.id && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
              {(keys[s.id] || []).map((k) => (
                <div key={k.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
                  <code>{k.key_prefix}</code><span style={{ color: k.status === 'active' ? GREEN : MUTED2 }}>{k.status}</span>
                </div>
              ))}
              <button onClick={() => issueKey(s)} style={{ marginTop: 8, padding: '7px 12px', borderRadius: 8, border: 'none', background: BRAND, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>+ New key</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Loading() { return <div style={{ textAlign: 'center', padding: 40, color: MUTED2 }}>Loading…</div>; }
function Empty({ text }) { return <div style={{ textAlign: 'center', padding: 40, color: MUTED2, fontSize: 13 }}>{text}</div>; }

const h2 = { fontSize: 17, fontWeight: 900, color: INK, marginBottom: 12 };
const card = { background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16, marginBottom: 12 };
const smallLbl = { display: 'block', fontSize: 11, fontWeight: 700, color: MUTED2, margin: '10px 0 4px' };
const inp = { width: '100%', padding: '9px 12px', borderRadius: 9, border: `1px solid ${BORDER}`, fontSize: 13, fontFamily: FONT, outline: 'none' };
const pill = { padding: '8px 13px', borderRadius: 100, border: `1px solid ${BORDER}`, background: WHITE, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT };
const pillOn = { border: `1px solid ${BRAND}`, background: `${BRAND}12`, color: BRAND };
const primaryBtn = { padding: '10px 16px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
