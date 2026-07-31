import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Copy, Check } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiGet, apiPost, apiDelete } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, GREEN, RED, ACCENT, FONT } from '../constants.js';

export default function ApiKeysPage() {
  const { current } = useStartup();
  const [keys, setKeys] = useState(null);
  const [newKey, setNewKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!current) return;
    apiGet(`/api/vouchers/startups/${current.id}/api-keys`).then((r) => setKeys(r.keys || [])).catch(() => setKeys([]));
  }, [current]);
  useEffect(() => { load(); }, [load]);

  const issue = async () => {
    setBusy(true);
    try { const r = await apiPost(`/api/vouchers/startups/${current.id}/api-keys`, {}); setNewKey(r.key.rawKey); setCopied(false); load(); }
    finally { setBusy(false); }
  };
  const revoke = async (id) => { await apiDelete(`/api/vouchers/startups/${current.id}/api-keys/${id}`); load(); };
  const copy = () => { navigator.clipboard?.writeText(newKey); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  if (!current) return null;
  return (
    <PageLayout title="API Keys" subtitle="Server-to-server keys for POST /api/vouchers/v1/validate"
      action={<button onClick={issue} disabled={busy} style={primaryBtn}><Plus size={14} /> New key</button>}>

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

      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        {keys === null ? <div style={{ padding: 30, color: MUTED2 }}>Loading…</div> : keys.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: MUTED2, fontSize: 13 }}>No API keys yet — issue one to start validating vouchers.</div>
        ) : keys.map((k) => (
          <div key={k.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${BORDER}` }}>
            <div>
              <code style={{ fontSize: 13, fontWeight: 700, color: INK }}>{k.key_prefix}</code>
              <div style={{ fontSize: 11.5, color: MUTED2, marginTop: 2 }}>Created {new Date(k.created_at).toLocaleDateString()}{k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleDateString()}` : ' · never used'}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 100, color: k.status === 'active' ? GREEN : MUTED2, background: k.status === 'active' ? `${GREEN}14` : `${MUTED2}14` }}>{k.status}</span>
              {k.status === 'active' && <button onClick={() => revoke(k.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED }}><Trash2 size={15} /></button>}
            </div>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}

const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: 'none', background: ACCENT, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
