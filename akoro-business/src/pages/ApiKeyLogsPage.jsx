import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { apiGet } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, LIGHT, GREEN, AMBER, RED, FONT } from '../constants.js';

const statusColor = (s) => (s < 300 ? GREEN : s < 500 ? AMBER : RED);

export default function ApiKeyLogsPage() {
  const { keyId } = useParams();
  const { current } = useStartup();
  const [logs, setLogs] = useState(null);

  useEffect(() => {
    if (!current) return;
    apiGet(`/api/vouchers/startups/${current.id}/api-keys/${keyId}/logs`).then((r) => setLogs(r.logs || [])).catch(() => setLogs([]));
  }, [current, keyId]);

  if (!current) return null;
  return (
    <PageLayout title="API key logs" subtitle="Every /v1/validate request made with this key"
      action={<Link to="/api-keys" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: MUTED, textDecoration: 'none' }}><ArrowLeft size={14} /> Back to API keys</Link>}>
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
        {logs === null ? <div style={{ padding: 30, color: MUTED2 }}>Loading…</div> : logs.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: MUTED2, fontSize: 13 }}>No requests logged for this key yet.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: FONT, minWidth: 640 }}>
            <thead>
              <tr>{['When', 'Method', 'Path', 'Status', 'Reason', 'IP'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 800, color: MUTED2, background: LIGHT }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={td}>{new Date(l.created_at).toLocaleString()}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{l.method}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{l.path}</td>
                  <td style={{ ...td, fontWeight: 800, color: statusColor(l.status_code) }}>{l.status_code}</td>
                  <td style={td}>{l.reason || '—'}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{l.ip_address || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageLayout>
  );
}

const td = { padding: '10px 16px', fontSize: 12.5, color: MUTED };
