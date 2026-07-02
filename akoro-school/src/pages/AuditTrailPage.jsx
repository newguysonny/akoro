import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  History, ArrowLeft, Loader2, Plus, Pencil, Trash2, RefreshCw,
  User, Clock, Filter, ChevronDown, ChevronUp,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';

const METHOD_META = {
  POST:   { color: GREEN, icon: Plus,     label: 'Created' },
  PUT:    { color: BLUE,  icon: Pencil,   label: 'Updated' },
  PATCH:  { color: BLUE,  icon: Pencil,   label: 'Updated' },
  DELETE: { color: RED,   icon: Trash2,   label: 'Deleted' },
};

const formatDate = (iso) => new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const humanizeEntity = (t) => (t || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function LogRow({ log }) {
  const [open, setOpen] = useState(false);
  const meta = METHOD_META[log.method] || { color: MUTED2, icon: RefreshCw, label: log.method };
  const hasDetails = log.details && Object.keys(log.details).length > 0;

  return (
    <div style={{ borderBottom: `1px solid ${BORDER}` }}>
      <div onClick={() => hasDetails && setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', cursor: hasDetails ? 'pointer' : 'default', flexWrap: 'wrap' }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: `${meta.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <meta.icon size={14} color={meta.color} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: INK, margin: 0, fontFamily: FONT }}>
            {meta.label} <span style={{ color: MUTED }}>{humanizeEntity(log.entityType)}</span>
            {log.entityLabel && <span style={{ color: AMBER }}> — {log.entityLabel}</span>}
          </p>
          <p style={{ fontSize: 11, color: MUTED2, margin: '2px 0 0', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><User size={10} /> {log.actorName || 'Unknown'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={10} /> {formatDate(log.createdAt)}</span>
          </p>
        </div>
        <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: `${meta.color}12`, color: meta.color, fontFamily: FONT }}>{log.method}</span>
        {hasDetails && (open ? <ChevronUp size={14} color={MUTED2} /> : <ChevronDown size={14} color={MUTED2} />)}
      </div>
      {open && hasDetails && (
        <div style={{ padding: '0 16px 14px 60px' }}>
          <pre style={{ fontSize: 11.5, background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px', margin: 0, fontFamily: 'ui-monospace, Menlo, monospace', color: MUTED, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {JSON.stringify(log.details, null, 2)}
          </pre>
          <p style={{ fontSize: 10.5, color: MUTED2, margin: '6px 0 0', fontFamily: FONT }}>{log.path}</p>
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
        <button onClick={() => navigate('/settings-billing')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
          <ArrowLeft size={14} /> Back to Settings
        </button>
      </div>

      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', padding: '14px 18px', borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <History size={16} color={AMBER} />
            <span style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: FONT }}>Activity Log</span>
            <span style={{ fontSize: 11.5, color: MUTED2, fontFamily: FONT }}>({total} events)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Filter size={13} color={MUTED2} />
            <select value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }} style={{ padding: '7px 11px', borderRadius: 8, border: `1.5px solid ${BORDER}`, fontSize: 12, fontFamily: FONT, color: INK, cursor: 'pointer' }}>
              <option value="">All modules</option>
              {entityTypes.map((t) => <option key={t} value={t}>{humanizeEntity(t)}</option>)}
            </select>
            <select value={methodFilter} onChange={(e) => { setMethodFilter(e.target.value); setPage(1); }} style={{ padding: '7px 11px', borderRadius: 8, border: `1.5px solid ${BORDER}`, fontSize: 12, fontFamily: FONT, color: INK, cursor: 'pointer' }}>
              <option value="">All actions</option>
              <option value="POST">Created</option>
              <option value="PUT">Updated</option>
              <option value="PATCH">Updated</option>
              <option value="DELETE">Deleted</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '30px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={18} style={{ animation: 'spin .8s linear infinite' }} /></div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '40px 18px', textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT }}>
            No activity recorded yet. Changes you make across Settings & Billing will show up here.
          </div>
        ) : (
          logs.map((log) => <LogRow key={log.id} log={log} />)
        )}

        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderTop: `1px solid ${BORDER}`, background: LIGHT, flexWrap: 'wrap', gap: 10 }}>
            <span style={{ fontSize: 12, color: MUTED2, fontFamily: FONT }}>Page {page} of {totalPages}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: '6px 12px', borderRadius: 7, border: `1.5px solid ${BORDER}`, background: WHITE, color: page === 1 ? MUTED2 : MUTED, fontSize: 12, fontWeight: 700, cursor: page === 1 ? 'default' : 'pointer', fontFamily: FONT }}>Previous</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ padding: '6px 12px', borderRadius: 7, border: `1.5px solid ${BORDER}`, background: WHITE, color: page === totalPages ? MUTED2 : MUTED, fontSize: 12, fontWeight: 700, cursor: page === totalPages ? 'default' : 'pointer', fontFamily: FONT }}>Next</button>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
