import { useState, useEffect, useCallback } from 'react';
import { Send, RotateCcw, Copy, Check, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, LIGHT, GREEN, RED, AMBER, ACCENT, FONT } from '../constants.js';

const STATUS_COLOR = { delivered: GREEN, failed: RED, pending: AMBER, sending: AMBER };

export default function WebhooksPage() {
  const { current } = useStartup();
  const [data, setData] = useState(null);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    if (!current) return;
    apiGet(`/api/vouchers/startups/${current.id}/webhooks`).then(setData).catch(() => setData({ deliveries: [] }));
  }, [current]);
  useEffect(() => { load(); }, [load]);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  const sendTest = async () => {
    setBusy(true);
    try { await apiPost(`/api/vouchers/startups/${current.id}/webhooks/test`, {}); flash('Test event queued — refresh in a moment.'); setTimeout(load, 1500); }
    catch (e) { flash(e.message || 'Could not send test'); }
    finally { setBusy(false); }
  };
  const rotate = async () => {
    if (!window.confirm('Rotate the signing secret? Deliveries will be signed with the new secret immediately — update your server first or verification will start failing.')) return;
    try { await apiPost(`/api/vouchers/startups/${current.id}/webhooks/rotate-secret`, {}); flash('Signing secret rotated.'); load(); }
    catch (e) { flash(e.message || 'Could not rotate'); }
  };
  const retry = async (id) => {
    try { await apiPost(`/api/vouchers/startups/${current.id}/webhooks/${id}/retry`, {}); flash('Requeued.'); setTimeout(load, 1200); }
    catch (e) { flash(e.message || 'Could not retry'); }
  };
  const copySecret = () => { navigator.clipboard?.writeText(data?.webhook_secret || ''); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  if (!current) return null;
  const deliveries = data?.deliveries || [];

  return (
    <PageLayout title="Webhooks" subtitle="We POST an event to your server whenever one of your vouchers is redeemed"
      action={<button onClick={sendTest} disabled={busy || !data?.webhook_url} style={primaryBtn}><Send size={14} /> Send test event</button>}>

      {msg && <div style={{ background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 16 }}>{msg}</div>}

      {/* Endpoint + secret */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: INK, marginBottom: 12 }}>Endpoint</div>
        {data?.webhook_url ? (
          <code style={{ fontSize: 12.5, color: INK, wordBreak: 'break-all' }}>{data.webhook_url}</code>
        ) : (
          <div style={{ fontSize: 12.5, color: MUTED }}>No webhook URL set — add one in <strong>Settings</strong> to start receiving events.</div>
        )}

        <div style={{ fontSize: 13.5, fontWeight: 800, color: INK, margin: '20px 0 6px' }}>Signing secret</div>
        <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 10, lineHeight: 1.5 }}>
          Verify every delivery with this before trusting it — otherwise anyone who learns your URL can post fake redemptions to it.
        </div>
        {data?.webhook_secret ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ flex: 1, fontSize: 12.5, background: LIGHT, padding: '9px 11px', borderRadius: 8, wordBreak: 'break-all' }}>
              {showSecret ? data.webhook_secret : '•'.repeat(32)}
            </code>
            <button onClick={() => setShowSecret((s) => !s)} title={showSecret ? 'Hide' : 'Reveal'} style={iconBtn}>{showSecret ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            <button onClick={copySecret} title="Copy" style={iconBtn}>{copied ? <Check size={15} color={GREEN} /> : <Copy size={15} />}</button>
            <button onClick={rotate} title="Rotate" style={{ ...iconBtn, color: AMBER }}><RotateCcw size={15} /></button>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: MUTED2 }}>Generated automatically with your first delivery.</div>
        )}
      </div>

      {/* Delivery log */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>Recent deliveries</div>
        <button onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: ACCENT, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}><RefreshCw size={13} /> Refresh</button>
      </div>
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
        {data === null ? <div style={{ padding: 30, color: MUTED2 }}>Loading…</div> : deliveries.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: MUTED2, fontSize: 13 }}>No deliveries yet.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: FONT, minWidth: 700 }}>
            <thead>
              <tr>{['When', 'Event', 'Status', 'Code', 'Attempts', 'Error', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 800, color: MUTED2, background: LIGHT, whiteSpace: 'nowrap' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={td}>{new Date(d.created_at).toLocaleString()}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{d.event}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 100, color: STATUS_COLOR[d.status] || MUTED2, background: `${STATUS_COLOR[d.status] || MUTED2}14` }}>{d.status}</span>
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{d.last_status_code ?? '—'}</td>
                  <td style={td}>{d.attempts}/{d.max_attempts}</td>
                  <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.last_error || ''}>{d.last_error || '—'}</td>
                  <td style={td}>
                    {d.status !== 'delivered' && (
                      <button onClick={() => retry(d.id)} title="Retry now" style={iconBtn}><RotateCcw size={15} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageLayout>
  );
}

const td = { padding: '11px 16px', fontSize: 12.5, color: MUTED };
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', color: MUTED, display: 'inline-flex', alignItems: 'center' };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: 'none', background: ACCENT, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
