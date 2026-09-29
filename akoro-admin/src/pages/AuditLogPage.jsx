import { useCallback, useEffect, useState } from 'react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet } from '../services/api.js';

/**
 * AuditLogPage — the Audit Log panel (plan §4.1 admin_audit_log).
 *
 * React + Tailwind conversion of the "Audit Log" panel in
 * reference/Admin-Tiers & Credits prototype page.md, reading the real
 * append-only log written by every tiers / pilot-schools / applications
 * mutation (and the pilot-expiry-check cron):
 *
 *   GET /api/admin/audit-log
 *
 * Columns match the prototype: When | Actor | Change | Before → After.
 * `before`/`after` are JSONB snapshots; changed keys render as a compact
 * "old → new" diff in the prototype's diff styling.
 */

const ACTION_LABELS = {
  'tier.created':                    'Tier created',
  'tier.updated':                    'Tier updated',
  'tier.price_changed.new_only':     'Tier price changed (new subscribers only)',
  'tier.price_changed.all':          'Tier price changed (all existing subscribers)',
  'lifecycle_settings.updated':      'Subscription lifecycle settings updated',
  'pilot_school.created':            'Pilot school added',
  'pilot_school.updated':            'Pilot school updated',
  'pilot.expired':                   'Pilot expired',
  'application.approved':            'Application approved',
  'application.rejected':            'Application rejected',
  'application.approved_legacy':     'Application approved',
  'application.rejected_legacy':     'Application rejected',
};

const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Compact key-by-key diff of two JSONB snapshots. */
function diff(before, after) {
  const b = before && typeof before === 'object' ? before : {};
  const a = after && typeof after === 'object' ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys.map((k) => {
    const oldV = b[k], newV = a[k];
    if (JSON.stringify(oldV) === JSON.stringify(newV)) return null;
    const fmt = (v) => (v === null || v === undefined ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
    return (
      <div key={k} className="ak-diff-line">
        <span className="text-akoro-dim font-semibold">{k}:</span>{' '}
        {oldV !== undefined && <span className="ak-diff-old">{fmt(oldV)}</span>}
        {oldV !== undefined && ' → '}
        <span className="ak-diff-new">{fmt(newV)}</span>
      </div>
    );
  }).filter(Boolean);
}

export default function AuditLogPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [entries, setEntries] = useState([]);

  const load = useCallback(async () => {
    try {
      setLoadError('');
      const res = await apiGet('/api/admin/audit-log?limit=200');
      setEntries(res.data ?? []);
    } catch (e) {
      setLoadError(e.message || 'Could not load the audit log.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <PageLayout title="Audit Log" subtitle="Every pricing, tier, and credit change made from this dashboard">
      <div className="ak-page">

        <h1 className="ak-h1">Audit Log</h1>
        <p className="ak-sub">Every pricing, tier, and credit change made from this dashboard, most recent first.</p>

        {loading && <p className="ak-sub">Loading…</p>}
        {loadError && <p className="ak-sub text-akoro-coral">{loadError}</p>}

        {!loading && (
          <table className="ak-table">
            <thead>
              <tr><th>When</th><th>Actor</th><th>Change</th><th>Before → After</th></tr>
            </thead>
            <tbody>
              {entries.length ? entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{fmtWhen(e.created_at)}</td>
                  <td>{e.actor_label || '—'}</td>
                  <td>
                    {ACTION_LABELS[e.action] ?? e.action}
                    {e.after?.school && <span className="block text-akoro-dim text-[0.78rem] font-semibold">{e.after.school}</span>}
                    {e.after?.name && !e.after.school && <span className="block text-akoro-dim text-[0.78rem] font-semibold">{e.after.name}{e.after.platform ? ` (${e.after.platform})` : ''}</span>}
                  </td>
                  <td>{diff(e.before, e.after)}</td>
                </tr>
              )) : (
                <tr><td colSpan={4} className="text-akoro-dim">No changes recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </PageLayout>
  );
}
