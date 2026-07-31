import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiPost } from '../services/api.js';
import { BRAND, ACCENT, INK, MUTED, MUTED2, BORDER, WHITE, RED, FONT } from '../constants.js';

export default function CreateStartupPage() {
  const { logout } = useAuth();
  const { refresh } = useStartup();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', credit_rate_usd: 0.1 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await apiPost('/api/vouchers/startups', form);
      // Await the refresh before navigating — startups was already fetched
      // once as empty (that's why we're on this page), so a fire-and-forget
      // refresh() leaves it stale for one render and PageLayout's
      // needsOnboarding check bounces us straight back here.
      await refresh();
      navigate('/', { replace: true });
    } catch (e2) { setErr(e2.message || 'Could not register'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', fontFamily: FONT, padding: 18 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 420, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: INK, marginBottom: 4 }}>🏢 Set up your voucher program</div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 22 }}>You'll get an API key to validate vouchers from your own backend.</div>

        <label style={lbl}>Business / app name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required style={inp} placeholder="e.g. Fluent AI" />

        <label style={lbl}>Credit rate — how much is 1 credit worth?</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: MUTED, fontWeight: 700 }}>$</span>
          <input type="number" step="0.01" min="0.01" value={form.credit_rate_usd} onChange={(e) => setForm({ ...form, credit_rate_usd: Number(e.target.value) })} required style={inp} />
          <span style={{ fontSize: 12.5, color: MUTED2 }}>per credit</span>
        </div>
        <div style={{ fontSize: 11.5, color: MUTED2, marginTop: 6 }}>You set your own rate and can add bulk-purchase discount tiers later.</div>

        {err && <div style={{ color: RED, fontSize: 12.5, fontWeight: 700, margin: '12px 0' }}>{err}</div>}
        <button type="submit" disabled={busy} style={btn}>{busy ? 'Creating…' : 'Create voucher program'}</button>
        <button type="button" onClick={logout} style={{ width: '100%', marginTop: 10, padding: 10, borderRadius: 11, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Sign out</button>
      </form>
    </div>
  );
}

const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', margin: '14px 0 6px' };
const inp = { width: '100%', padding: '11px 13px', borderRadius: 11, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none', fontFamily: FONT };
const btn = { width: '100%', marginTop: 18, padding: 13, borderRadius: 13, border: 'none', background: `linear-gradient(135deg,${ACCENT},#4C1DCC)`, color: '#fff', fontSize: 14.5, fontWeight: 900, cursor: 'pointer', fontFamily: FONT };
