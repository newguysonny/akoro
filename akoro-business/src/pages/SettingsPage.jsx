import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiPatch } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, ACCENT, FONT } from '../constants.js';

export default function SettingsPage() {
  const { user } = useAuth();
  const { current, refresh } = useStartup();
  const [rate, setRate] = useState('');
  const [webhook, setWebhook] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (current) { setRate(current.credit_rate_usd); setWebhook(current.webhook_url || ''); }
  }, [current]);

  const save = async () => {
    setBusy(true);
    try {
      await apiPatch(`/api/vouchers/startups/${current.id}`, { credit_rate_usd: Number(rate), webhook_url: webhook || null });
      setToast('Saved ✓'); refresh();
    } catch (e) { setToast(e.message || 'Could not save'); }
    finally { setBusy(false); setTimeout(() => setToast(''), 2500); }
  };

  if (!current) return null;
  return (
    <PageLayout title="Settings">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 520 }}>
        <div style={card}>
          <div style={cardTitle}>Profile</div>
          <Row label="Name" value={user?.fullName || '—'} />
          <Row label="Email" value={user?.email || '—'} />
        </div>

        <div style={card}>
          <div style={cardTitle}>Voucher program</div>
          <label style={lbl}>Credit rate (USD per credit)</label>
          <input type="number" step="0.01" min="0.01" value={rate} onChange={(e) => setRate(e.target.value)} style={inp} />
          <label style={lbl}>Webhook URL (optional — notified on bulk purchases)</label>
          <input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://yourapp.com/webhooks/akoro" style={inp} />
          <button onClick={save} disabled={busy} style={{ ...primaryBtn, marginTop: 12 }}><Save size={14} /> {busy ? 'Saving…' : 'Save changes'}</button>
          {toast && <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: INK }}>{toast}</div>}
        </div>
      </div>
    </PageLayout>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${BORDER}` }}>
      <span style={{ fontSize: 12.5, color: MUTED }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{value}</span>
    </div>
  );
}

const card = { background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20 };
const cardTitle = { fontSize: 13.5, fontWeight: 800, color: INK, marginBottom: 12 };
const lbl = { display: 'block', fontSize: 11.5, fontWeight: 700, color: MUTED2, margin: '10px 0 4px' };
const inp = { width: '100%', padding: '9px 12px', borderRadius: 9, border: `1px solid ${BORDER}`, fontSize: 13, fontFamily: FONT, outline: 'none' };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: 'none', background: ACCENT, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
