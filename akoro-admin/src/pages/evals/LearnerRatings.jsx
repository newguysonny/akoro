/**
 * LearnerRatings — the human side of the evals (Grand Plan Phase 18 item 4).
 *
 * Learners rate the agent's replies up or down. This shows the up-rate per
 * surface and the worst-rated turns, each with the verdict the code computed
 * for the same turn beside the learner's label: a thumbs-down on a turn the
 * checks passed is the one worth reading, so those lead. No learner identity
 * reaches this page.
 */
import { useEffect, useState } from 'react';
import { ThumbsUp, ThumbsDown, RefreshCw } from 'lucide-react';
import { apiGet } from '../../services/api.js';
import { INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, AMBER, FONT } from '../../constants.js';

const SURFACE_LABEL = { agent_chat: 'Agent Chat replies', workflow_summary: 'Workflow summaries' };
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export default function LearnerRatings() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState(null);
  const [turns, setTurns] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load(d = days) {
    setLoading(true);
    try {
      const [s, w] = await Promise.all([
        apiGet(`/api/admin/agent-ratings/summary?days=${d}`),
        apiGet(`/api/admin/agent-ratings/worst?days=${d}&limit=20`),
      ]);
      setSummary(s.surfaces ?? []); setTurns(w.turns ?? []); setError(null);
    } catch (e) {
      setError(e.message || 'Could not load ratings');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(days); }, [days]);

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 10px', flexWrap: 'wrap' }}>
        <h3 style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: INK, margin: 0, flex: 1 }}>Learner ratings</h3>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
                style={{ fontFamily: FONT, fontSize: 13, padding: '6px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, background: WHITE, color: INK }}>
          {[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        <button onClick={() => load(days)} title="Refresh"
                style={{ display: 'flex', alignItems: 'center', padding: 7, borderRadius: 8, border: `1px solid ${BORDER}`, background: WHITE, cursor: 'pointer' }}>
          <RefreshCw size={14} color={MUTED} />
        </button>
      </div>
      {error && <div style={{ color: RED, fontFamily: FONT, fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {(summary ?? []).map((s) => (
          <div key={s.surface} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 16px', minWidth: 220, flex: '1 1 220px' }}>
            <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED2 }}>{SURFACE_LABEL[s.surface] ?? s.surface}</div>
            <div style={{ fontFamily: FONT, fontSize: 22, fontWeight: 700, color: s.upRate == null ? MUTED : s.upRate >= 0.8 ? GREEN : s.upRate >= 0.6 ? AMBER : RED }}>
              {s.upRate == null ? '—' : `${Math.round(s.upRate * 100)}% up`}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED, display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><ThumbsUp size={12} /> {s.up}</span>
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><ThumbsDown size={12} /> {s.down}</span>
              <span>{s.total} rated</span>
            </div>
          </div>
        ))}
        {loading && !summary && <div style={{ fontFamily: FONT, fontSize: 13, color: MUTED }}>Loading…</div>}
      </div>

      <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: INK, margin: '18px 0 8px' }}>Worst-rated turns</div>
      {!loading && turns.length === 0 && <div style={{ fontFamily: FONT, fontSize: 13, color: MUTED }}>No thumbs-down in this window.</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {turns.map((t) => (
          <div key={`${t.surface}:${t.message_id}`} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontFamily: FONT, fontSize: 11, color: MUTED2 }}>
              <ThumbsDown size={12} color={RED} />
              <span>{SURFACE_LABEL[t.surface] ?? t.surface}</span>
              <span>· {when(t.updated_at)}</span>
              {t.verdict && (
                <span style={{ padding: '1px 8px', borderRadius: 999, background: LIGHT, fontWeight: 700, color: t.verdict === 'pass' ? GREEN : RED }}
                      title={t.verdict === 'pass' ? 'The code checks passed this turn — the learner disagrees' : `Failed: ${t.failure_class ?? 'other'}`}>
                  checks: {t.verdict}{t.failure_class ? ` (${t.failure_class})` : ''}
                </span>
              )}
              {!t.verdict && <span>· no episode</span>}
            </div>
            {t.reason && <div style={{ fontFamily: FONT, fontSize: 13, color: INK, fontWeight: 600, marginTop: 6 }}>“{t.reason}”</div>}
            {t.excerpt && <div style={{ fontFamily: FONT, fontSize: 12.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{t.excerpt}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
