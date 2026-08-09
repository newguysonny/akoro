/**
 * EvalsPage — does the model still do its job?
 *
 * Every other page in this app reports what happened. This one makes something
 * happen, and it is the first control here that spends real money: pressing Run
 * bills OpenAI for a few hundred calls. So the cost estimate is shown before
 * the button does anything, the confirm step repeats it, and a run in flight
 * can be stopped.
 *
 * The page is arranged around the decision it exists to serve — "can we move
 * this to a cheaper model?" — so each suite card puts every model's last result
 * in one row. Pass rate and cost side by side is the comparison; two separate
 * views of the same numbers would hide it.
 *
 * Failures come first in the results list, always. Nobody opens a run to read
 * the passes.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { FlaskConical, Play, XCircle, CheckCircle2, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Skeleton, Toast } from '../components/Primitives.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, FONT } from '../constants.js';

/* Runs cost fractions of a dollar; showing $0.00 for a real charge reads as
   free, which is the one impression this page must not give. */
const usd = (n) => {
  const v = Number(n || 0);
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1)    return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
};
const pct  = (p, t) => (t ? `${Math.round((p / t) * 100)}%` : '—');
const secs = (m) => (m == null ? '—' : `${(Number(m) / 1000).toFixed(1)}s`);
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/* A suite is a gate, not a dashboard: anything short of green means a case that
   used to work no longer does, so there is no "mostly fine" band here. */
const rateTone = (p, t) => (!t ? MUTED : p === t ? GREEN : p / t >= 0.8 ? AMBER : RED);

export default function EvalsPage() {
  const [meta, setMeta]       = useState(null);
  const [runs, setRuns]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [toast, setToast]     = useState(null);
  const [confirm, setConfirm] = useState(null);   // { suite, model, estimate }
  const [openRun, setOpenRun] = useState(null);   // { run, results }
  const [busy, setBusy]       = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        apiGet('/api/admin/evals/suites'),
        apiGet('/api/admin/evals?limit=20'),
      ]);
      setMeta(s); setRuns(r.runs ?? []); setError(null);
    } catch (e) {
      setError(e.message || 'Could not load evals');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const active = runs.find((r) => r.status === 'queued' || r.status === 'running') ?? null;

  /* Poll only while something is actually running. A suite takes minutes and
     writes results per case, so the point of polling is to watch it fill in —
     once it is done there is nothing to wait for and the interval is waste. */
  useEffect(() => {
    clearInterval(pollRef.current);
    if (!active) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await apiGet('/api/admin/evals?limit=20');
        setRuns(r.runs ?? []);
        if (openRun?.run?.id) {
          const d = await apiGet(`/api/admin/evals/${openRun.run.id}`);
          setOpenRun({ run: d.run, results: d.results });
        }
        const stillGoing = (r.runs ?? []).some((x) => x.status === 'queued' || x.status === 'running');
        if (!stillGoing) load();      // finished — refresh the suite cards' last-run row
      } catch { /* a dropped poll is not worth a toast */ }
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, [active?.id, openRun?.run?.id, load]);

  async function start() {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = await apiPost('/api/admin/evals/run', { suite: confirm.suite.key, model: confirm.model });
      setConfirm(null);
      setToast({ type: 'success', message: `Running ${confirm.suite.title} on ${confirm.model} — ${res.cases} cases` });
      await load();
      openDetail(res.runId);
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'Could not start the run' });
    } finally { setBusy(false); }
  }

  async function openDetail(id) {
    try {
      const d = await apiGet(`/api/admin/evals/${id}`);
      setOpenRun({ run: d.run, results: d.results });
    } catch (e) { setToast({ type: 'error', message: e.message }); }
  }

  async function cancel(id) {
    try {
      await apiPost(`/api/admin/evals/${id}/cancel`, {});
      setToast({ type: 'success', message: 'Stopping after the case it is on' });
      load();
    } catch (e) { setToast({ type: 'error', message: e.message }); }
  }

  return (
    <PageLayout title="Evals" subtitle="Does the model still do its job?">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Said once, plainly, above everything: this page spends. */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', marginBottom: 18,
                    background: '#FFFBEB', border: `1px solid ${AMBER}44`, borderRadius: 10 }}>
        <AlertTriangle size={16} color={AMBER} style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontFamily: FONT, fontSize: 13, color: INK, lineHeight: 1.5 }}>
          Running a suite calls the live model for every case and is billed. Estimates below are
          order-of-magnitude; the run records what it actually cost.
          {meta && !meta.liveKey && (
            <div style={{ marginTop: 6, color: RED, fontWeight: 600 }}>
              No live OPENAI_API_KEY on the API — runs are refused rather than scored against the
              stand-in model, which would pass everything and prove nothing.
            </div>
          )}
        </div>
      </div>

      {loading && <Skeleton height={200} />}
      {error && !loading && <div style={{ color: RED, fontFamily: FONT }}>{error}</div>}

      {meta && !loading && (
        <div style={{ display: 'grid', gap: 16 }}>
          {meta.suites.map((s) => (
            <SuiteCard
              key={s.key} suite={s} models={meta.models}
              disabled={!meta.liveKey || !!active}
              activeNote={active ? `A run is already going (${active.suite} on ${active.model})` : null}
              onRun={(model) => setConfirm({ suite: s, model, estimate: s.estimates[model] })}
            />
          ))}
        </div>
      )}

      <h3 style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: INK, margin: '28px 0 10px' }}>
        Recent runs
      </h3>
      <RunTable runs={runs} onOpen={openDetail} onCancel={cancel} />

      {confirm && (
        <ConfirmDialog c={confirm} busy={busy} onCancel={() => setConfirm(null)} onGo={start} />
      )}
      {openRun && (
        <RunDrawer run={openRun.run} results={openRun.results} onClose={() => setOpenRun(null)} onCancel={cancel} />
      )}
    </PageLayout>
  );
}

/* ---------------------------------------------------------------- suite card */

function SuiteCard({ suite, models, onRun, disabled, activeNote }) {
  const [model, setModel] = useState(models[0]);
  const last = Object.fromEntries((suite.lastRuns ?? []).map((r) => [r.model, r]));

  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <FlaskConical size={18} color={AMBER} style={{ marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: INK }}>{suite.title}</div>
          <div style={{ fontFamily: FONT, fontSize: 13, color: MUTED, lineHeight: 1.55, marginTop: 4 }}>
            {suite.purpose}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED2, marginTop: 6 }}>
            {suite.cases} cases · about {usd(suite.estimates[model])} on {model}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={model} onChange={(e) => setModel(e.target.value)}
                  style={{ fontFamily: FONT, fontSize: 13, padding: '8px 10px', borderRadius: 8,
                           border: `1px solid ${BORDER}`, background: WHITE, color: INK }}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={() => onRun(model)} disabled={disabled} title={activeNote ?? ''}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: FONT, fontSize: 13,
                           fontWeight: 600, padding: '8px 14px', borderRadius: 8, border: 'none',
                           background: disabled ? LIGHT : AMBER, color: disabled ? MUTED2 : WHITE,
                           cursor: disabled ? 'not-allowed' : 'pointer' }}>
            <Play size={14} /> Run
          </button>
        </div>
      </div>

      {/* Every model's last result on one row — this is the comparison the page
          exists for, so it is not behind a click. */}
      {(suite.lastRuns ?? []).length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}>
          {models.filter((m) => last[m]).map((m) => {
            const r = last[m];
            return (
              <div key={m} style={{ padding: '8px 12px', borderRadius: 8, background: LIGHT, minWidth: 140 }}>
                <div style={{ fontFamily: FONT, fontSize: 11, color: MUTED2 }}>{m}</div>
                <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: rateTone(r.passed, r.total) }}>
                  {r.passed}/{r.total} <span style={{ fontSize: 12, fontWeight: 600 }}>({pct(r.passed, r.total)})</span>
                </div>
                <div style={{ fontFamily: FONT, fontSize: 11, color: MUTED }}>
                  {usd(r.costUsd)} · {secs(r.ms)} · {when(r.at)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- confirm */

function ConfirmDialog({ c, onCancel, onGo, busy }) {
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: '#0006', display: 'flex',
                                     alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
           style={{ background: WHITE, borderRadius: 14, padding: 22, maxWidth: 440, width: '100%' }}>
        <div style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: INK }}>Run this suite?</div>
        <div style={{ fontFamily: FONT, fontSize: 13, color: MUTED, lineHeight: 1.6, marginTop: 10 }}>
          <b>{c.suite.title}</b> — {c.suite.cases} cases against <b>{c.model}</b>.
          This calls the live model once per case and is billed to the platform.
        </div>
        <div style={{ marginTop: 14, padding: '10px 12px', background: LIGHT, borderRadius: 8,
                      fontFamily: FONT, fontSize: 13, color: INK }}>
          Estimated cost: <b>{usd(c.estimate)}</b>
          <div style={{ fontSize: 11, color: MUTED2, marginTop: 3 }}>
            An estimate, not a quote. The run records what it actually cost.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onCancel} style={btn(LIGHT, INK)}>Cancel</button>
          <button onClick={onGo} disabled={busy} style={btn(AMBER, WHITE)}>
            {busy ? 'Starting…' : `Run · ~${usd(c.estimate)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const btn = (bg, fg) => ({
  fontFamily: FONT, fontSize: 13, fontWeight: 600, padding: '9px 16px',
  borderRadius: 8, border: 'none', background: bg, color: fg, cursor: 'pointer',
});

/* ---------------------------------------------------------------- runs table */

const STATUS = {
  queued:    { label: 'Queued',    color: MUTED },
  running:   { label: 'Running',   color: AMBER },
  done:      { label: 'Done',      color: GREEN },
  failed:    { label: 'Failed',    color: RED   },
  cancelled: { label: 'Cancelled', color: MUTED2 },
};

function RunTable({ runs, onOpen, onCancel }) {
  if (!runs.length) {
    return <div style={{ fontFamily: FONT, fontSize: 13, color: MUTED }}>Nothing has been run yet.</div>;
  }
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 13, minWidth: 620 }}>
        <thead>
          <tr style={{ background: LIGHT }}>
            {['Suite', 'Model', 'Result', 'Cost', 'Time', 'When', ''].map((h) => (
              <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: MUTED2, fontWeight: 600, fontSize: 12 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const st = STATUS[r.status] ?? STATUS.queued;
            const live = r.status === 'queued' || r.status === 'running';
            return (
              <tr key={r.id} onClick={() => onOpen(r.id)}
                  style={{ borderTop: `1px solid ${BORDER}`, cursor: 'pointer' }}>
                <td style={{ padding: '10px 12px', color: INK, fontWeight: 600 }}>{r.suite}</td>
                <td style={{ padding: '10px 12px', color: MUTED }}>{r.model}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ color: st.color, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {live && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
                    {live
                      ? `${st.label} · ${(r.cases_passed ?? 0) + (r.cases_failed ?? 0)}/${r.cases_total ?? '?'}`
                      : r.status === 'done'
                        ? <span style={{ color: rateTone(r.cases_passed, r.cases_total) }}>
                            {r.cases_passed}/{r.cases_total} passed
                          </span>
                        : st.label}
                  </span>
                  {r.error && <div style={{ color: RED, fontSize: 11, marginTop: 2 }}>{r.error}</div>}
                </td>
                <td style={{ padding: '10px 12px', color: MUTED }}>{usd(r.cost_usd)}</td>
                <td style={{ padding: '10px 12px', color: MUTED }}>{secs(r.ms)}</td>
                <td style={{ padding: '10px 12px', color: MUTED2 }}>{when(r.created_at)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  {live && (
                    <button onClick={(e) => { e.stopPropagation(); onCancel(r.id); }}
                            style={{ ...btn('transparent', RED), padding: '4px 8px', border: `1px solid ${RED}44` }}>
                      Stop
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------- run detail */

function RunDrawer({ run, results, onClose, onCancel }) {
  const live = run.status === 'queued' || run.status === 'running';
  const failures = results.filter((r) => !r.passed);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#0006', display: 'flex',
                                    justifyContent: 'flex-end', zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()}
           style={{ background: WHITE, width: 'min(620px, 100%)', height: '100%', overflowY: 'auto', padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 17, fontWeight: 700, color: INK }}>{run.suite}</div>
            <div style={{ fontFamily: FONT, fontSize: 13, color: MUTED, marginTop: 2 }}>
              {run.model} · {when(run.created_at)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {live && <button onClick={() => onCancel(run.id)} style={{ ...btn('transparent', RED), border: `1px solid ${RED}44` }}>Stop</button>}
            <button onClick={onClose} style={btn(LIGHT, INK)}>Close</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '18px 0' }}>
          <Stat label="Passed" value={`${run.cases_passed ?? 0}/${run.cases_total ?? 0}`}
                tone={rateTone(run.cases_passed, run.cases_total)} />
          <Stat label="Cost"  value={usd(run.cost_usd)} />
          <Stat label="Time"  value={secs(run.ms)} />
          <Stat label="Status" value={(STATUS[run.status] ?? STATUS.queued).label}
                tone={(STATUS[run.status] ?? STATUS.queued).color} />
        </div>

        {run.error && (
          <div style={{ padding: '10px 12px', background: '#FEF2F2', border: `1px solid ${RED}33`,
                        borderRadius: 8, color: RED, fontFamily: FONT, fontSize: 13, marginBottom: 14 }}>
            {run.error}
          </div>
        )}

        {live && !results.length && (
          <div style={{ fontFamily: FONT, fontSize: 13, color: MUTED }}>
            <RefreshCw size={13} style={{ verticalAlign: -2 }} /> Waiting for the first case…
          </div>
        )}

        {/* Failures first. That ordering comes from the API, not a sort here —
            a long run streams in and re-sorting on the client would shuffle
            rows under the reader's cursor. */}
        {failures.length > 0 && (
          <div style={{ fontFamily: FONT, fontSize: 12, color: RED, fontWeight: 700, margin: '0 0 8px' }}>
            {failures.length} failing
          </div>
        )}
        <div style={{ display: 'grid', gap: 8 }}>
          {results.map((r) => (
            <div key={r.id} style={{ border: `1px solid ${r.passed ? BORDER : RED + '55'}`, borderRadius: 10,
                                     padding: 12, background: r.passed ? WHITE : '#FEF2F2' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                {r.passed ? <CheckCircle2 size={15} color={GREEN} style={{ flexShrink: 0, marginTop: 1 }} />
                          : <XCircle size={15} color={RED} style={{ flexShrink: 0, marginTop: 1 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: INK }}>{r.name}</div>
                  {!r.passed && (
                    <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
                      <div><b style={{ color: MUTED2 }}>expected</b> {r.expected ?? '—'}</div>
                      <div><b style={{ color: MUTED2 }}>got</b> {r.actual ?? '—'}</div>
                    </div>
                  )}
                  {r.detail && (
                    <div style={{ fontFamily: FONT, fontSize: 12, color: r.passed ? MUTED2 : RED, marginTop: 4, lineHeight: 1.5 }}>
                      {r.detail}
                    </div>
                  )}
                </div>
                <div style={{ fontFamily: FONT, fontSize: 11, color: MUTED2, whiteSpace: 'nowrap' }}>{secs(r.ms)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = INK }) {
  return (
    <div style={{ padding: '10px 14px', background: LIGHT, borderRadius: 10, minWidth: 100 }}>
      <div style={{ fontFamily: FONT, fontSize: 11, color: MUTED2 }}>{label}</div>
      <div style={{ fontFamily: FONT, fontSize: 17, fontWeight: 700, color: tone }}>{value}</div>
    </div>
  );
}
