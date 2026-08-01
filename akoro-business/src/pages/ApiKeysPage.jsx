import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Copy, Check, ScrollText, Ban, RotateCcw, X } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, LIGHT, GREEN, RED, AMBER, ACCENT, FONT } from '../constants.js';

const usd = (n) => `$${Number(n || 0).toFixed(2)}`;

export default function ApiKeysPage() {
  const { current } = useStartup();
  const [keys, setKeys] = useState(null);
  const [newKey, setNewKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);   // name-the-key modal
  const [keyName, setKeyName] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    if (!current) return;
    apiGet(`/api/vouchers/startups/${current.id}/api-keys`).then((r) => setKeys(r.keys || [])).catch(() => setKeys([]));
  }, [current]);
  useEffect(() => { load(); }, [load]);

  // The backend has always accepted a `label` — the UI just never sent one, so
  // every key came back "Untitled key" with no way to tell them apart.
  const issue = async (e) => {
    e?.preventDefault?.();
    setBusy(true); setErr('');
    try {
      const r = await apiPost(`/api/vouchers/startups/${current.id}/api-keys`, { label: keyName.trim() || undefined });
      setNewKey(r.key.rawKey); setCopied(false); setNaming(false); setKeyName('');
      load();
    } catch (e2) { setErr(e2.message || 'Could not create the key'); }
    finally { setBusy(false); }
  };
  const toggleRevoke = async (k) => {
    try {
      await apiPatch(`/api/vouchers/startups/${current.id}/api-keys/${k.id}`, { status: k.status === 'active' ? 'revoked' : 'active' });
      load();
    } catch (e) { setErr(e.message || 'Could not update the key'); }
  };
  const remove = async (k) => {
    if (!window.confirm(`Permanently delete "${k.name}"? This can't be undone — any requests still using this key will start failing immediately.`)) return;
    try {
      await apiDelete(`/api/vouchers/startups/${current.id}/api-keys/${k.id}`);
      load();
    } catch (e) { setErr(e.message || 'Could not delete the key'); }
  };
  const copy = () => { navigator.clipboard?.writeText(newKey); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  if (!current) return null;
  return (
    <PageLayout title="API Keys" subtitle="Server-to-server keys for POST /api/vouchers/v1/validate"
      action={<button onClick={() => { setNaming(true); setErr(''); }} disabled={busy} style={primaryBtn}><Plus size={14} /> Create new secret key</button>}>

      {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: RED, borderRadius: 10, padding: '10px 14px', fontSize: 12.5, fontWeight: 700, marginBottom: 16 }}>{err}</div>}

      {naming && (
        <div onClick={() => setNaming(false)} style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(17,12,40,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <form onClick={(ev) => ev.stopPropagation()} onSubmit={issue} style={{ width: '100%', maxWidth: 400, background: WHITE, borderRadius: 16, padding: 24, fontFamily: FONT }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: INK }}>Name your key</div>
              <button type="button" onClick={() => setNaming(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>So you can tell your keys apart later — e.g. "Production server", "Staging".</div>
            <input value={keyName} onChange={(ev) => setKeyName(ev.target.value)} autoFocus maxLength={60} placeholder="e.g. Production server"
              style={{ width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 14, fontFamily: FONT, outline: 'none' }} />
            <button type="submit" disabled={busy} style={{ ...primaryBtn, width: '100%', justifyContent: 'center', marginTop: 16, padding: 12 }}>
              {busy ? 'Creating…' : 'Create key'}
            </button>
          </form>
        </div>
      )}

      {newKey && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: '#92400E', marginBottom: 8 }}>⚠️ Copy this now — it will never be shown again</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <code style={{ flex: 1, fontSize: 12.5, wordBreak: 'break-all', background: WHITE, padding: '8px 10px', borderRadius: 8 }}>{newKey}</code>
            <button onClick={copy} style={{ padding: '8px 10px', borderRadius: 8, border: 'none', background: copied ? GREEN : ACCENT, color: '#fff', cursor: 'pointer' }}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      )}

      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
        {keys === null ? <div style={{ padding: 30, color: MUTED2 }}>Loading…</div> : keys.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: MUTED2, fontSize: 13 }}>No API keys yet — issue one to start validating vouchers.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: FONT, minWidth: 760 }}>
            <thead>
              <tr>{['Name', 'Status', 'Tracking ID', 'Secret Key', 'Created by', 'Permissions', 'Monthly spend', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 800, color: MUTED2, background: LIGHT, whiteSpace: 'nowrap' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={{ ...td, fontWeight: 700, color: INK }}>{k.name}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 100, color: k.status === 'active' ? GREEN : MUTED2, background: k.status === 'active' ? `${GREEN}14` : `${MUTED2}14` }}>{k.status}</span>
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{k.tracking_id}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{k.key_prefix}</td>
                  <td style={td}>{k.created_by}</td>
                  <td style={td}>{k.permissions}</td>
                  <td style={{ ...td, fontWeight: 700, color: INK }}>{usd(k.monthly_spend_usd)}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <Link to={`/api-keys/${k.id}/logs`} title="View logs" style={{ color: MUTED, marginRight: 12 }}><ScrollText size={15} /></Link>
                    <button onClick={() => toggleRevoke(k)} title={k.status === 'active' ? 'Revoke' : 'Reactivate'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: k.status === 'active' ? AMBER : GREEN, marginRight: 12 }}>
                      {k.status === 'active' ? <Ban size={15} /> : <RotateCcw size={15} />}
                    </button>
                    <button onClick={() => remove(k)} title="Delete permanently" style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED }}><Trash2 size={15} /></button>
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

const td = { padding: '12px 16px', fontSize: 12.5, color: MUTED };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: 'none', background: ACCENT, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
