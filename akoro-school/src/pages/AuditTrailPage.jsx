import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import BackButton from '../components/BackButton.jsx';
import { apiGet } from '../services/api.js';
import { GREEN, RED, BLUE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const METHOD_META = {
  POST:   { color: GREEN, icon: Plus, ti: 'ti-plus',     label: 'Created' },
  PUT:    { color: BLUE,  icon: Pencil, ti: 'ti-pencil',   label: 'Updated' },
  PATCH:  { color: BLUE,  icon: Pencil, ti: 'ti-pencil',   label: 'Updated' },
  DELETE: { color: RED,   icon: Trash2, ti: 'ti-trash',   label: 'Deleted' },
};

const formatDate = (iso) => new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const humanizeEntity = (t) => (t || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function LogRow({ log }) {
  const [open, setOpen] = useState(false);
  const meta = METHOD_META[log.method] || { color: C.muted2, icon: RefreshCw, ti: 'ti-refresh', label: log.method };
  const hasDetails = log.details && Object.keys(log.details).length > 0;

  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <div onClick={() => hasDetails && setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', cursor: hasDetails ? 'pointer' : 'default', flexWrap: 'wrap' }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: tint(8, meta.color), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Ico lucide={meta.icon} ti={meta.ti} size={14} color={meta.color} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: C.ink, margin: 0, fontFamily: C.font }}>
            {meta.label} <span style={{ color: C.muted }}>{humanizeEntity(log.entityType)}</span>
            {log.entityLabel && <span style={{ color: C.brand }}> — {log.entityLabel}</span>}
          </p>
          <p style={{ fontSize: 11, color: C.muted2, margin: '2px 0 0', fontFamily: C.font, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Ico ti="ti-user" size={10} /> {log.actorName || 'Unknown'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Ico ti="ti-clock" size={10} /> {formatDate(log.createdAt)}</span>
          </p>
        </div>
        <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: tint(7, meta.color), color: meta.color, fontFamily: C.font }}>{log.method}</span>
        {hasDetails && (open ? <Ico ti="ti-chevron-up" size={14} color={C.muted2} /> : <Ico ti="ti-chevron-down" size={14} color={C.muted2} />)}
      </div>
      {open && hasDetails && (
        <div style={{ padding: '0 16px 14px 60px' }}>
          <pre style={{ fontSize: 11.5, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', margin: 0, fontFamily: 'ui-monospace, Menlo, monospace', color: C.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {JSON.stringify(log.details, null, 2)}
          </pre>
          <p style={{ fontSize: 10.5, color: C.muted2, margin: '6px 0 0', fontFamily: C.font }}>{log.path}</p>
        </div>
      )}
    </div>
  );
}

export default function AuditTrailPage() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [entityTypes, setEntityTypes] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState('');
  const pageSize = 25;

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
    if (entityFilter) params.set('entityType', entityFilter);
    if (methodFilter) params.set('method', methodFilter);
    apiGet(`/api/school/audit-logs?${params.toString()}`)
      .then((res) => { setLogs(res.data || []); setTotal(res.total || 0); setEntityTypes(res.entityTypes || []); })
      .catch((e) => showToast(e.message || 'Could not load audit logs'))
      .finally(() => setLoading(false));
  }, [page, entityFilter, methodFilter]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <PageLayout title="Audit Trail" subtitle="Every change made to your school's settings">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <BackButton onClick={() => navigate('/settings-billing')} label="Back to Settings" />
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ico ti="ti-history" size={16} color={C.brand} />
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, fontFamily: C.font }}>Activity Log</span>
            <span style={{ fontSize: 11.5, color: C.muted2, fontFamily: C.font }}>({total} events)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Ico ti="ti-filter" size={13} color={C.muted2} />
            <select value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }} style={{ padding: '7px 11px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: C.font, color: C.ink, cursor: 'pointer' }}>
              <option value="">All modules</option>
              {entityTypes.map((t) => <option key={t} value={t}>{humanizeEntity(t)}</option>)}
            </select>
            <select value={methodFilter} onChange={(e) => { setMethodFilter(e.target.value); setPage(1); }} style={{ padding: '7px 11px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12, fontFamily: C.font, color: C.ink, cursor: 'pointer' }}>
              <option value="">All actions</option>
              <option value="POST">Created</option>
              <option value="PUT">Updated</option>
              <option value="PATCH">Updated</option>
              <option value="DELETE">Deleted</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '30px 0', textAlign: 'center', color: C.muted2 }}><Ico ti="ti-loader-2" size={18} style={{ animation: 'spin .8s linear infinite' }} /></div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '40px 18px', textAlign: 'center', color: C.muted2, fontSize: 13, fontFamily: C.font }}>
            No activity recorded yet. Changes you make across Settings & Billing will show up here.
          </div>
        ) : (
          logs.map((log) => <LogRow key={log.id} log={log} />)
        )}

        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderTop: `1px solid ${C.border}`, background: C.bg, flexWrap: 'wrap', gap: 10 }}>
            <span style={{ fontSize: 12, color: C.muted2, fontFamily: C.font }}>Page {page} of {totalPages}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: '6px 12px', borderRadius: 7, border: `1.5px solid ${C.border}`, background: C.surface, color: page === 1 ? C.muted2 : C.muted, fontSize: 12, fontWeight: 700, cursor: page === 1 ? 'default' : 'pointer', fontFamily: C.font }}>Previous</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ padding: '6px 12px', borderRadius: 7, border: `1.5px solid ${C.border}`, background: C.surface, color: page === totalPages ? C.muted2 : C.muted, fontSize: 12, fontWeight: 700, cursor: page === totalPages ? 'default' : 'pointer', fontFamily: C.font }}>Next</button>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
