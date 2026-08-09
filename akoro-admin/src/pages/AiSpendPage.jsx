/**
 * AiSpendPage — what the platform's AI costs, how slow it is, what fails.
 *
 * Reads edu.ai_call_log, which carries one row per model call whether or not
 * anyone was billed for it. Before that table existed the only record was the
 * wallet debit, so a system or cron call left no trace and latency was recorded
 * nowhere at all.
 *
 * The page is arranged around the decision it exists to serve — "should this
 * feature move to a cheaper model?" — so cost and p95 latency sit in the same
 * row rather than in separate charts. Expensive and fast is a candidate.
 * Expensive and already slow is not, and splitting them across two views
 * would hide exactly that.
 */
import { useState, useEffect, useCallback } from 'react';
import { DollarSign, Zap, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Skeleton, Toast } from '../components/Primitives.jsx';
import { apiGet } from '../services/api.js';
import { StatCard } from './analytics-page/parts.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../constants.js';

const WINDOWS = [
  { key: 24,  label: '24 hours' },
  { key: 168, label: '7 days'   },
  { key: 720, label: '30 days'  },
];

/* Money here is fractions of a cent per call and tens of dollars in total, so
   one fixed precision cannot serve both without lying at one end. */
const usd = (n) => {
  const v = Number(n || 0);
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(5)}`;
  if (v < 1)    return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
};
const num = (n) => Number(n || 0).toLocaleString();
const ms  = (n) => (n == null ? '—' : `${Number(n).toLocaleString()}ms`);

/* Latency is judged against what it is FOR: a tutor reply and a nightly batch
   job do not share a threshold, but a page cannot know which is which, so this
   only flags the plainly slow rather than pretending to a per-feature SLO. */
const latencyTone = (p95) => (p95 == null ? MUTED : p95 > 10000 ? RED : p95 > 4000 ? AMBER : GREEN);

export default function AiSpendPage() {
  const [hours, setHours]     = useState(24);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [toast, setToast]     = useState(null);
  const [alerts, setAlerts]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // Both together: an incident is the moment you least want to click twice,
      // and a spend figure without the alert state beside it is half the story.
      const [d, a] = await Promise.all([
        apiGet(`/api/admin/ai-spend?hours=${hours}`),
        apiGet('/api/admin/alerts').catch(() => null),
      ]);
      setData(d); setAlerts(a);
    } catch (e) {
      // 503 means the reporting migration has not run — that is a different
      // problem from "no usage", and saying so saves a wasted investigation.
      setError(e.message);
    } finally { setLoading(false); }
  }, [hours]);

  useEffect(() => { load(); }, [load]);

  const t = data?.totals;
  const maxUsd = Math.max(...(data?.byFeature ?? []).map(r => Number(r.usd || 0)), 0.000001);
  const maxSeries = Math.max(...(data?.series ?? []).map(r => Number(r.usd || 0)), 0.000001);

  return (
    <PageLayout
      title="AI spend"
      subtitle="Every model call — cost, latency and failures, billed or not"
      action={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', background: LIGHT, borderRadius: 10, padding: 3, border: `1px solid ${BORDER}` }}>
            {WINDOWS.map(w => (
              <button key={w.key} onClick={() => setHours(w.key)}
                style={{
                  border: 'none', cursor: 'pointer', borderRadius: 8, padding: '6px 12px',
                  fontFamily: FONT, fontSize: 12.5, fontWeight: 700,
                  background: hours === w.key ? WHITE : 'transparent',
                  color: hours === w.key ? INK : MUTED,
                  boxShadow: hours === w.key ? '0 1px 3px rgba(0,0,0,.07)' : 'none',
                }}>{w.label}</button>
            ))}
          </div>
          <button onClick={load} title="Refresh"
            style={{ border: `1px solid ${BORDER}`, background: WHITE, borderRadius: 10, padding: '7px 10px', cursor: 'pointer' }}>
            <RefreshCw size={15} color={MUTED} />
          </button>
        </div>
      }
    >
      {error && (
        <div style={{
          background: '#FEF2F2', border: `1px solid ${RED}33`, color: RED,
          borderRadius: 12, padding: '13px 16px', fontFamily: FONT, fontSize: 13.5, marginBottom: 20,
        }}>{error}</div>
      )}

      {/* ── Alerts ───────────────────────────────────────────────────────
          Firing rules first and loud; when nothing is firing, still say how
          many rules are watching — an empty space cannot tell you whether
          nothing is wrong or nothing is being checked. */}
      {alerts && (
        <div style={{ marginBottom: 20 }}>
          {alerts.firing > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alerts.rules.filter(r => r.firing).map(r => (
                <div key={r.key} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 11,
                  background: r.severity === 'critical' ? '#FEF2F2' : '#FFF7ED',
                  border: `1px solid ${r.severity === 'critical' ? RED : AMBER}33`,
                  borderLeft: `3px solid ${r.severity === 'critical' ? RED : AMBER}`,
                  borderRadius: 12, padding: '12px 15px', fontFamily: FONT,
                }}>
                  <AlertTriangle size={16} color={r.severity === 'critical' ? RED : AMBER} style={{ marginTop: 1, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{r.title}</div>
                    <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{r.detail}</div>
                  </div>
                  {r.since && (
                    <span style={{ fontSize: 11.5, color: MUTED2, whiteSpace: 'nowrap' }}>
                      since {new Date(r.since).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT,
              fontSize: 12.5, color: MUTED, background: LIGHT,
              border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 13px',
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN }} />
              {alerts.rules.filter(r => r.enabled).length} rules watching · nothing firing
              {alerts.rules.some(r => !r.enabled) &&
                ` · ${alerts.rules.filter(r => !r.enabled).length} not configured`}
            </div>
          )}
        </div>
      )}

      {/* ── The four numbers ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatCard icon={DollarSign} label="Spend" color={AMBER} loading={loading}
          value={usd(t?.usd)} sub={`${num(t?.calls)} calls`} />
        {/* Cost per call is the figure a routing change moves — a total can fall
            simply because it was a quiet day. */}
        <StatCard icon={Zap} label="Cost per call" color={PURPLE} loading={loading}
          value={usd(t?.usdPerCall)} sub={`${num(t?.tokensOut)} tokens out`} />
        <StatCard icon={Clock} label="p95 latency" color={BLUE} loading={loading}
          value={ms(Math.max(...(data?.byFeature ?? []).map(r => Number(r.p95_ms || 0)), 0) || null)}
          sub="slowest feature" />
        <StatCard icon={AlertTriangle} label="Failures" color={t?.failed ? RED : GREEN} loading={loading}
          value={num(t?.failed)} sub={t?.calls ? `${(t.failureRate * 100).toFixed(1)}% of calls` : '—'} />
      </div>

      {/* ── Where the money goes ─────────────────────────────────────────── */}
      <Panel title="By feature" hint="Cost and p95 together — expensive and fast is a candidate for a cheaper model; expensive and already slow is not.">
        {loading ? <Skeleton height={160} /> : (
          <Table
            head={['Feature', 'Calls', 'Spend', 'Avg', 'p95', 'Failed']}
            rows={(data?.byFeature ?? []).map(r => [
              <Bar key="f" label={r.feature} value={Number(r.usd || 0)} max={maxUsd}
                   muted={r.feature === 'unattributed'} />,
              num(r.calls),
              usd(r.usd),
              ms(r.avg_ms),
              <span key="p" style={{ color: latencyTone(r.p95_ms), fontWeight: 700 }}>{ms(r.p95_ms)}</span>,
              Number(r.failed) ? <span key="x" style={{ color: RED, fontWeight: 700 }}>{r.failed}</span> : '—',
            ])}
            empty="No calls in this window."
          />
        )}
      </Panel>

      {/* ── What each tier really costs ──────────────────────────────────── */}
      <Panel title="By model" hint="What a tier costs per call here, as opposed to on the price list.">
        {loading ? <Skeleton height={120} /> : (
          <Table
            head={['Model', 'Calls', 'Spend', 'Per call', 'Avg', 'p95', 'Out']}
            rows={(data?.byModel ?? []).map(r => [
              <code key="m" style={{ fontSize: 12.5, color: INK }}>{r.model}</code>,
              num(r.calls),
              usd(r.usd),
              usd(r.usd_per_call),
              ms(r.avg_ms),
              <span key="p" style={{ color: latencyTone(r.p95_ms), fontWeight: 700 }}>{ms(r.p95_ms)}</span>,
              num(r.avg_tokens_out),
            ])}
            empty="No calls in this window."
          />
        )}
      </Panel>

      {/* ── Is today normal? ─────────────────────────────────────────────── */}
      <Panel title="Over time" hint={hours > 48 ? 'Daily' : 'Hourly'}>
        {loading ? <Skeleton height={120} /> : (data?.series ?? []).length === 0
          ? <Empty>No calls in this window.</Empty>
          : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 130, overflowX: 'auto', paddingTop: 8 }}>
              {(data.series ?? []).map((p, i) => {
                const h = Math.max(2, (Number(p.usd || 0) / maxSeries) * 110);
                const failed = Number(p.failed || 0) > 0;
                return (
                  <div key={i} title={`${new Date(p.bucket).toLocaleString()} · ${usd(p.usd)} · ${num(p.calls)} calls · p95 ${ms(p.p95_ms)}${failed ? ` · ${p.failed} failed` : ''}`}
                    style={{ flex: '1 0 10px', minWidth: 10, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                    {/* A bucket containing failures is coloured, not annotated —
                        it has to read at a glance across a 30-day strip. */}
                    <div style={{ height: h, borderRadius: '4px 4px 0 0', background: failed ? RED : AMBER, opacity: failed ? .85 : .75 }} />
                  </div>
                );
              })}
            </div>
          )}
      </Panel>

      {/* ── What is failing ──────────────────────────────────────────────── */}
      {(data?.failures ?? []).length > 0 && (
        <Panel title="Failures" hint="Grouped by kind — never by message.">
          <Table
            head={['Kind', 'Feature', 'Model', 'Count', 'Last seen']}
            rows={data.failures.map(r => [
              <span key="k" style={{ color: RED, fontWeight: 700 }}>{r.error_kind}</span>,
              r.feature, <code key="m" style={{ fontSize: 12.5 }}>{r.model}</code>,
              num(r.calls), new Date(r.last_at).toLocaleString(),
            ])}
            empty=""
          />
        </Panel>
      )}

      {data && !loading && (
        <p style={{ color: MUTED2, fontFamily: FONT, fontSize: 12, marginTop: 18 }}>
          {num(t?.calls)} calls in the last {WINDOWS.find(w => w.key === hours)?.label}
          {' · '}read at {new Date(data.generatedAt).toLocaleTimeString()}
        </p>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

/* ── Small local pieces ─────────────────────────────────────────────────── */

function Panel({ title, hint, children }) {
  return (
    <section style={{
      background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16,
      padding: 20, marginBottom: 20,
    }}>
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: INK, margin: 0 }}>{title}</h3>
        {hint && <p style={{ fontFamily: FONT, fontSize: 12.5, color: MUTED, margin: '3px 0 0' }}>{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Table({ head, rows, empty }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 13 }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} style={{
                textAlign: i === 0 ? 'left' : 'right', padding: '8px 10px',
                fontSize: 10.5, letterSpacing: '.07em', textTransform: 'uppercase',
                color: MUTED, fontWeight: 700, borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r}>
              {cells.map((c, i) => (
                <td key={i} style={{
                  padding: '9px 10px', borderBottom: `1px solid ${BORDER}`,
                  textAlign: i === 0 ? 'left' : 'right', color: INK,
                  // Figures that sit in a column must line up to be compared.
                  fontVariantNumeric: i === 0 ? 'normal' : 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Name plus a proportional bar, so the biggest line is visible without reading. */
function Bar({ label, value, max, muted }) {
  const pct = Math.max(2, (value / max) * 100);
  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 150 }}>
      <span style={{ fontWeight: 650, color: muted ? MUTED : INK, fontSize: 13 }}>
        {label}{muted && <span style={{ fontSize: 11, color: MUTED2 }}> · no feature set</span>}
      </span>
      <div style={{ height: 4, background: LIGHT, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: muted ? MUTED2 : AMBER }} />
      </div>
    </div>
  );
}

function Empty({ children }) {
  return <p style={{ fontFamily: FONT, fontSize: 13, color: MUTED, margin: '6px 0' }}>{children}</p>;
}
