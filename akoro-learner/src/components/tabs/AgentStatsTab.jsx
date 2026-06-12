/**
 * AgentStatsTab.jsx
 * ─────────────────────────────────────────────────────────────
 * The student agent's brain: intelligence stats, knowledge-health
 * dashboard (decay), and a growth timeline.
 *
 * Endpoints (all under /api/adaptive/chat):
 *   GET /student/agent/:id/intelligence  → { intelligence, agent }
 *   GET /student/agent/:id/growth?limit=  → { agent, history[] }
 *   GET /decay/status/:id                 → { dashboard }
 *   GET /decay/subjects/:id               → { subjects[] }
 */

import { useState, useEffect, useCallback } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECT_COLORS, STUDENT_ID } from '../../constants.js';
import { apiGet } from '../../services/api.js';

const FONT = "'Nunito', sans-serif";
const CHAT = '/api/adaptive/chat';

const pct  = (v) => Math.round((v ?? 0) * (v <= 1 ? 100 : 1));   // accepts 0-1 or 0-100
const sCol = (s) => SUBJECT_COLORS[(s || '').toLowerCase()] || BRAND;

const HEALTH = {
  critical: { color: RED,    label: 'Critical' },
  high:     { color: '#F97316', label: 'Needs review' },
  medium:   { color: GOLD,   label: 'Fading' },
  low:      { color: GREEN,  label: 'Healthy' },
};
const healthOf = (conf) => {
  const c = conf <= 1 ? conf : conf / 100;
  if (c < 0.35) return 'critical';
  if (c < 0.55) return 'high';
  if (c < 0.72) return 'medium';
  return 'low';
};
const fmtAgo = (iso) => {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? '1d ago' : `${d}d ago`;
};

function StatCell({ value, label, color = 'var(--ak-text)' }) {
  return (
    <div style={{ textAlign: 'center', background: 'var(--ak-bg)', borderRadius: 12, padding: '11px 6px', border: '1px solid var(--ak-border)' }}>
      <div style={{ fontSize: 19, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: .3 }}>{label}</div>
    </div>
  );
}

function Section({ title, children, hint }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 12.5, fontWeight: 900, color: 'var(--ak-text)', marginBottom: 2 }}>{title}</div>
      {hint && <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ak-text-muted)', marginBottom: 9 }}>{hint}</div>}
      {!hint && <div style={{ height: 9 }} />}
      {children}
    </div>
  );
}

export default function AgentStatsTab({ studentId = STUDENT_ID, agentName = 'Agent', agentEmoji = '🤖', onStartTeach }) {
  const [intel,    setIntel]    = useState(null);
  const [history,  setHistory]  = useState([]);
  const [dash,     setDash]     = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [i, g, d, s] = await Promise.allSettled([
      apiGet(`${CHAT}/student/agent/${studentId}/intelligence`),
      apiGet(`${CHAT}/student/agent/${studentId}/growth?limit=15`),
      apiGet(`${CHAT}/decay/status/${studentId}`),
      apiGet(`${CHAT}/decay/subjects/${studentId}`),
    ]);
    if (i.status === 'fulfilled') setIntel(i.value.intelligence || null);
    if (g.status === 'fulfilled') setHistory(g.value.history || []);
    if (d.status === 'fulfilled') setDash(d.value.dashboard || null);
    if (s.status === 'fulfilled') setSubjects(s.value.subjects || []);
    setLoading(false);
  }, [studentId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 11, fontFamily: FONT }}>
        {[0, 1, 2].map(i => <div key={i} style={{ height: 90, borderRadius: 14, background: 'var(--ak-bg)', opacity: .6 }} />)}
      </div>
    );
  }

  const summary = dash?.summary || {};
  const topicsToReview = dash?.topicsNeedingReview || [];
  const avgConf = summary.avgConfidence ?? (intel?.avg_confidence != null ? pct(intel.avg_confidence) : 0);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 24px', fontFamily: FONT, background: 'var(--ak-surface)' }}>

      {/* Intelligence header */}
      <div style={{ background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, borderRadius: 18, padding: '16px 16px 18px', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{agentEmoji}</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 900 }}>{agentName}</div>
              <div style={{ fontSize: 11.5, fontWeight: 700, opacity: .85 }}>Level {intel?.level ?? 1} · {intel?.knowledge_score ?? 0} knowledge score</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{avgConf}%</div>
            <div style={{ fontSize: 9.5, fontWeight: 700, opacity: .8, textTransform: 'uppercase', letterSpacing: .3 }}>Avg confidence</div>
          </div>
        </div>
      </div>

      {/* Stat cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginTop: 12 }}>
        <StatCell value={intel?.total_sessions ?? 0} label="Sessions" />
        <StatCell value={intel?.total_turns ?? 0}    label="Turns" />
        <StatCell value={intel?.total_knowledge_chunks ?? 0} label="Chunks" color={BRAND} />
        <StatCell value={(intel?.subjects_learned?.length) ?? subjects.length ?? 0} label="Subjects" />
      </div>

      {/* Knowledge health — subjects */}
      <Section title="Knowledge health"
        hint={summary.topicsNeedingAttention > 0
          ? `${summary.topicsNeedingAttention} topic${summary.topicsNeedingAttention === 1 ? '' : 's'} need attention`
          : 'Your agent is keeping its knowledge sharp.'}>
        {subjects.length === 0 ? (
          <Empty text="No subjects learned yet. Teach your agent to grow its knowledge." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {subjects.map((sub) => {
              const conf = pct(sub.avg_confidence);
              const h = HEALTH[healthOf(sub.avg_confidence)];
              const col = sCol(sub.subject);
              return (
                <div key={sub.subject} style={{ background: '#FBFAFF', border: '1px solid #F0ECFF', borderRadius: 13, padding: '11px 13px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', textTransform: 'capitalize' }}>{sub.subject || 'General'}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: h.color, background: `${h.color}18`, padding: '2px 8px', borderRadius: 20 }}>{h.label} · {conf}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: 'var(--ak-border)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${conf}%`, background: col, borderRadius: 4, transition: 'width .5s' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 7, fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
                    <span>{sub.topic_count ?? 0} topics</span>
                    {sub.critical_count > 0 && <span style={{ color: RED }}>{sub.critical_count} critical</span>}
                    {sub.last_activity && <span>· last {fmtAgo(sub.last_activity)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Topics needing review */}
      {topicsToReview.length > 0 && (
        <Section title="Due for revision" hint="Teach these again to reinforce before they fade.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topicsToReview.slice(0, 8).map((t, i) => {
              const conf = pct(t.confidence);
              const h = HEALTH[t.health_status || healthOf(t.confidence)];
              return (
                <div key={t.id || `${t.topic}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 13, padding: '10px 12px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: h.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{t.topic}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)', textTransform: 'capitalize' }}>{t.subject || 'General'} · {conf}% confidence</div>
                  </div>
                  {onStartTeach && (
                    <button onClick={() => onStartTeach({ topic: t.topic, subject: t.subject, agentName, agentEmoji })}
                      style={{ flexShrink: 0, padding: '7px 13px', borderRadius: 10, border: 'none', background: `${BRAND}12`, color: BRAND, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                      Teach again
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Growth timeline */}
      <Section title="Growth timeline" hint="What your agent learned in recent sessions.">
        {history.length === 0 ? (
          <Empty text="No teaching sessions yet. Start a session to grow your agent." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {history.map((h, i) => {
              const delta = Math.round(h.understanding_delta ?? ((h.understanding_end ?? 0) - (h.understanding_start ?? 0)));
              const col = sCol(h.subject);
              return (
                <div key={h.id || h.session_id || i} style={{ background: '#FBFAFF', border: '1px solid #F0ECFF', borderRadius: 13, padding: '11px 13px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', textTransform: 'capitalize' }}>{h.topic || 'Session'}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>{fmtAgo(h.completed_at || h.started_at)}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {h.subject && <span style={{ fontSize: 10, fontWeight: 800, color: col, background: `${col}14`, padding: '2px 8px', borderRadius: 20, textTransform: 'capitalize' }}>{h.subject}</span>}
                    {delta !== 0 && <span style={{ fontSize: 10.5, fontWeight: 800, color: delta > 0 ? GREEN : RED }}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}% understanding</span>}
                    {h.agent_knowledge_added > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-sub)' }}>+{h.agent_knowledge_added} chunks</span>}
                    {h.xp_earned > 0 && <span style={{ fontSize: 10.5, fontWeight: 800, color: GOLD }}>+{h.xp_earned} XP</span>}
                  </div>
                  {h.concepts_learned?.length > 0 && (
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ak-text-sub)', marginTop: 6, lineHeight: 1.4 }}>
                      💡 {h.concepts_learned.slice(0, 4).join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

function Empty({ text }) {
  return (
    <div style={{ background: '#FBFAFF', border: '1px dashed #DDD3FF', borderRadius: 14, padding: 24, textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: 'var(--ak-text-muted)' }}>
      {text}
    </div>
  );
}
