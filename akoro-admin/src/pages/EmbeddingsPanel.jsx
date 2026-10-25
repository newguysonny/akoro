/**
 * EmbeddingsPanel — the search embeddings, on the AI spend page.
 *
 * Which provider and model answer now (a live probe), how many stored rows
 * have a vector, and the model switch: "Re-embed everything" clears every
 * stored vector and refills them with the current provider
 * (POST /api/admin/embeddings/reembed-all). Vectors from two models don't
 * compare, so after EMBEDDINGS_PROVIDER / EMBEDDINGS_MODEL change on Render,
 * search is quietly wrong until this has run. The API probes the provider
 * first and clears nothing if it doesn't answer. While it runs, search uses
 * its text half; progress is the stores' missing count going down.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { apiGet, apiPost } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, AMBER, PURPLE, FONT } from '../constants.js';

const num = (n) => (n == null ? '—' : Number(n).toLocaleString());
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

export default function EmbeddingsPanel() {
  const [provider, setProvider] = useState(null);   // { probe, reembed }
  const [health, setHealth] = useState(null);       // { stores, totalMissing, reembed }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startMsg, setStartMsg] = useState(null);   // { ok, text }
  const timer = useRef(null);

  const load = useCallback(async ({ probe = true } = {}) => {
    setError('');
    try {
      const [p, h] = await Promise.all([
        probe ? apiGet('/api/admin/embeddings/provider') : Promise.resolve(null),
        apiGet('/api/admin/embeddings'),
      ]);
      if (p) setProvider(p);
      setHealth(h);
    } catch (e) {
      setError(e?.message || "Couldn't read the embeddings status.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const re = health?.reembed || provider?.reembed || null;
  const running = !!re?.running;
  // While it runs, re-read the counts every 5 s (no probe — that would embed again each time).
  useEffect(() => {
    clearInterval(timer.current);
    if (running) timer.current = setInterval(() => load({ probe: false }), 5000);
    return () => clearInterval(timer.current);
  }, [running, load]);

  const start = async () => {
    setStarting(true); setStartMsg(null);
    try {
      const r = await apiPost('/api/admin/embeddings/reembed-all', { confirm: true });
      setStartMsg(r?.started === false
        ? { ok: false, text: r?.reason || "It didn't start." }
        : { ok: true, text: 'Started: every vector was cleared and is being refilled. Search uses text matching until it finishes.' });
    } catch (e) {
      setStartMsg({ ok: false, text: e?.message || "It didn't start." });
    } finally {
      setStarting(false); setConfirming(false);
      load({ probe: false });
    }
  };

  const probe = provider?.probe;
  const stores = health?.stores || [];
  const total = stores.reduce((n, s) => n + (s.total || 0), 0);
  const missing = health?.totalMissing ?? null;
  const done = total ? Math.max(0, Math.min(100, Math.round(100 * (1 - (missing || 0) / total)))) : null;

  return (
    <section data-embeddings-panel="" style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 20, fontFamily: FONT }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: 0 }}>Search embeddings</h3>
          <p style={{ fontSize: 12.5, color: MUTED, margin: '3px 0 0' }}>
            The model that turns text into search vectors. After changing it on Render, re-embed everything — vectors from two models don't compare.
          </p>
        </div>
        <button type="button" onClick={() => load()} disabled={loading} aria-label="Refresh"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, border: `1px solid ${BORDER}`, background: WHITE, color: INK, fontSize: 12.5, fontWeight: 650, cursor: 'pointer' }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && <p style={{ color: RED, fontSize: 13, margin: '0 0 12px' }}>{error}</p>}

      {/* Which provider answers now */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
        <Fact label="Provider" value={probe ? probe.provider : (loading ? '…' : '—')} />
        <Fact label="Model" value={probe?.model || (loading ? '…' : '—')} />
        <Fact label="Live check" value={!probe ? (loading ? '…' : '—') : probe.ok ? 'Answers' : 'Not answering'}
          tone={!probe ? null : probe.ok ? GREEN : RED} sub={probe && !probe.ok ? probe.error : probe?.dims ? `${probe.dims}-wide vectors` : null} />
        <Fact label="Rows with a vector" value={total ? `${num(total - (missing || 0))} of ${num(total)}` : (loading ? '…' : '—')}
          sub={missing ? `${num(missing)} missing` : null} tone={missing ? AMBER : null} />
      </div>

      {/* The switch in progress */}
      {(running || re?.finishedAt) && (
        <div data-reembed-state={running ? 'running' : 'finished'} style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: 12, marginBottom: 14, background: LIGHT }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: running ? PURPLE : re?.error ? RED : GREEN }}>
            {running ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : re?.error ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
            {running ? 'Re-embedding…' : re?.error ? 'Re-embed stopped' : 'Re-embed finished'}
            {done != null && <span style={{ fontWeight: 600, color: MUTED }}>· {done}% of rows have a vector</span>}
          </div>
          {done != null && (
            <div style={{ height: 6, background: WHITE, borderRadius: 4, overflow: 'hidden', margin: '8px 0' }}>
              <div style={{ width: `${done}%`, height: '100%', background: running ? PURPLE : GREEN, transition: 'width .4s' }} />
            </div>
          )}
          <div style={{ fontSize: 12, color: MUTED }}>
            Started {when(re?.startedAt)}{re?.finishedAt ? ` · finished ${when(re.finishedAt)}` : ''} · {num(re?.filled)} filled{re?.failed ? ` · ${num(re.failed)} failed` : ''}
            {re?.cleared?.length ? ` · ${re.cleared.length} stores cleared` : ''}
          </div>
          {re?.error && <div style={{ fontSize: 12, color: RED, marginTop: 4 }}>{re.error} — press Re-embed everything again to continue.</div>}
        </div>
      )}

      {/* The button: two steps */}
      {!confirming ? (
        <button type="button" data-reembed-start="" onClick={() => { setStartMsg(null); setConfirming(true); }} disabled={running || loading}
          style={{ padding: '10px 16px', borderRadius: 11, border: 'none', background: running ? BORDER : INK, color: WHITE, fontSize: 13, fontWeight: 800, cursor: running ? 'not-allowed' : 'pointer' }}>
          {running ? 'Re-embedding…' : 'Re-embed everything'}
        </button>
      ) : (
        <div data-reembed-confirm="" style={{ border: `1px solid ${AMBER}`, borderRadius: 12, padding: 12, background: '#FFFBEB' }}>
          <p style={{ fontSize: 13, color: INK, margin: '0 0 10px', lineHeight: 1.5 }}>
            This clears <b>every stored vector</b> ({num(total)} rows) and refills them with <b>{probe?.model || 'the current model'}</b>. Search runs on text matching until it finishes. Nothing is cleared if the provider doesn't answer first.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" data-reembed-go="" onClick={start} disabled={starting}
              style={{ padding: '9px 14px', borderRadius: 10, border: 'none', background: RED, color: WHITE, fontSize: 13, fontWeight: 800, cursor: starting ? 'wait' : 'pointer' }}>
              {starting ? 'Starting…' : 'Yes, clear and re-embed'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={starting}
              style={{ padding: '9px 14px', borderRadius: 10, border: `1px solid ${BORDER}`, background: WHITE, color: INK, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {startMsg && <p data-reembed-msg="" style={{ fontSize: 12.5, color: startMsg.ok ? GREEN : RED, margin: '10px 0 0' }}>{startMsg.text}</p>}

      {/* Per store */}
      {stores.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ fontSize: 12.5, color: MUTED, cursor: 'pointer' }}>By store</summary>
          <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            {stores.map((s) => (
              <div key={s.store} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, color: INK, padding: '4px 0', borderBottom: `1px solid ${BORDER}` }}>
                <code style={{ fontSize: 12 }}>{s.store}</code>
                <span style={{ color: s.error ? RED : s.missing ? AMBER : MUTED2, fontVariantNumeric: 'tabular-nums' }}>
                  {s.error ? s.error : `${num((s.total || 0) - (s.missing || 0))} / ${num(s.total)}`}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function Fact({ label, value, sub, tone }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 10.5, letterSpacing: '.07em', textTransform: 'uppercase', color: MUTED, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 750, color: tone || INK, marginTop: 3, wordBreak: 'break-word' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: MUTED2, marginTop: 2, wordBreak: 'break-word' }}>{sub}</div>}
    </div>
  );
}
