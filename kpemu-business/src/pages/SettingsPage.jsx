import { useState, useEffect } from 'react';
import { Save, Upload } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiPatch, apiUpload } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, ACCENT, FONT, CATEGORIES } from '../constants.js';

export default function SettingsPage() {
  const { user } = useAuth();
  const { current, refresh } = useStartup();
  const [rate, setRate] = useState('');
  const [webhook, setWebhook] = useState('');
  const [category, setCategory] = useState('other');
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [imgBusy, setImgBusy] = useState(false);

  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImgBusy(true);
    try {
      const r = await apiUpload('/api/vouchers/startups/upload-cover', file);
      setCoverUrl(r.url);
    } catch (e2) { setToast(e2.message || 'Could not upload image'); setTimeout(() => setToast(''), 2500); }
    finally { setImgBusy(false); }
  };

  useEffect(() => {
    if (current) {
      setRate(current.credit_rate_usd); setWebhook(current.webhook_url || '');
      setCategory(current.category || 'other'); setDescription(current.description || ''); setCoverUrl(current.cover_image_url || '');
    }
  }, [current]);

  const save = async () => {
    setBusy(true);
    try {
      await apiPatch(`/api/vouchers/startups/${current.id}`, {
        credit_rate_usd: Number(rate), webhook_url: webhook || null,
        category, description: description || null, cover_image_url: coverUrl || null,
      });
      setToast('Saved'); refresh();
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

        <div style={card}>
          <div style={cardTitle}>Marketplace listing</div>
          <div style={{ fontSize: 11.5, color: MUTED2, marginTop: -6, marginBottom: 4 }}>How your business appears to agents browsing the marketplace.</div>
          <label style={lbl}>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
            {Object.entries(CATEGORIES).map(([key, c]) => <option key={key} value={key}>{c.label}</option>)}
          </select>
          <label style={lbl}>Cover photo</label>
          <input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://... or upload below" style={inp} />
          <label style={{ ...uploadBtn, marginTop: 8, opacity: imgBusy ? 0.6 : 1, pointerEvents: imgBusy ? 'none' : 'auto' }}>
            <Upload size={13} /> {imgBusy ? 'Uploading…' : 'Upload from device'}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={pickImage} style={{ display: 'none' }} />
          </label>
          {coverUrl && (
            <div style={{ marginTop: 8, width: '100%', aspectRatio: '16/10', borderRadius: 10, overflow: 'hidden', border: `1px solid ${BORDER}` }}>
              <img src={coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            </div>
          )}
          <label style={lbl}>Short pitch</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={200}
            style={{ ...inp, resize: 'vertical', fontFamily: FONT }} placeholder="One line agents will see in the marketplace" />
          <button onClick={save} disabled={busy} style={{ ...primaryBtn, marginTop: 12 }}><Save size={14} /> {busy ? 'Saving…' : 'Save changes'}</button>
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
const uploadBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: `1px dashed ${BORDER}`, background: '#F9FAFB', color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT };
