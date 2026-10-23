/**
 * SelfStudyAnalyticsPage — per-activity analytics: how the class is doing on
 * one assigned activity, plus an AI report (misconceptions, difficulty,
 * strengths, gaps, recommendations) generated from the class's real teaching
 * signals — never from transcripts.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Sparkles, Loader2, RefreshCw, Users, Clock, CheckCircle2,
  Brain, AlertTriangle, Gauge,
} from 'lucide-react';
import { Ico } from '../theme/Ico.jsx';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Badge } from '../components/Primitives.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { GREEN, PURPLE, BLUE, RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';

const STATUS = {
  assigned: { color: C.muted,  bg: C.bg,     label: 'Not started' },
  started:  { color: BLUE,   bg: '#EFF6FF', label: 'In progress' },
  complete: { color: GREEN,  bg: '#DCFCE7', label: 'Complete' },
};

/* A small labelled bar — understanding reads calm, confusion reads alarm. */
function Bar({ label, value, tone }) {
  const color = tone === 'confusion'
    ? (value >= 60 ? RED : value >= 30 ? C.brand : GREEN)
    : (value >= 60 ? GREEN : value >= 30 ? C.brand : RED);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 150 }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, color: C.muted2, width: 82, flexShrink: 0, fontFamily: C.font }}>{label}</span>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: C.bg, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, transition: 'width .3s' }} />
      </div>
      <span style={{ fontSize: 10.5, fontWeight: 800, color, width: 30, textAlign: 'right', flexShrink: 0, fontFamily: C.font }}>{value}%</span>
    </div>
  );
}

function Stat({ icon: Icon, ti, label, value, color }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 10, fontFamily: C.font }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: tint(8, color), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Ico lucide={Icon} ti={ti} size={16} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 19, fontWeight: 900, color: C.ink, lineHeight: 1.1 }}>{value ?? '—'}</div>
        <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700 }}>{label}</div>
      </div>
    </div>
  );
}

/* ── The AI report card ──────────────────────────────────────────────────── */
function ReportCard({ data, onRegenerate, generating, error }) {
  const r = data?.report;
  const diffColor = { 'too easy': BLUE, 'about right': GREEN, 'too hard': RED }[r?.difficulty?.rating] || C.brand;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px', marginBottom: 20, fontFamily: C.font }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Ico lucide={Sparkles} ti="ti-sparkles" size={15} color={C.brand} />
          <span style={{ fontSize: 13.5, fontWeight: 900, color: C.ink }}>AI report</span>
          {data?.generatedAt && (
            <span style={{ fontSize: 10.5, color: C.muted2, fontWeight: 700 }}>
              {new Date(data.generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <Btn size="sm" variant="secondary" onClick={onRegenerate} disabled={generating}>
          {generating
            ? <><Ico lucide={Loader2} ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} /> Reading the class…</>
            : <><Ico lucide={RefreshCw} ti="ti-refresh" size={12} /> {r ? 'Regenerate' : 'Generate AI report'}</>}
        </Btn>
      </div>

      {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700, marginBottom: 10 }}>{error}</div>}

      {!r ? (
        <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, background: C.bg, borderRadius: 12, padding: '14px 16px' }}>
          Generate an AI read of this activity: likely misconceptions, whether the difficulty landed,
          where understanding is thin, and what to do next. Built from the class's progress and
          cognitive signals — never from learners' conversations.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.65 }}>{r.overview}</div>

          {r.difficulty && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Ico lucide={Gauge} ti="ti-gauge" size={14} color={diffColor} />
              <Badge color={diffColor} bg={tint(8, diffColor)}>Difficulty: {r.difficulty.rating}</Badge>
              <span style={{ fontSize: 12, color: C.muted }}>{r.difficulty.note}</span>
            </div>
          )}

          {r.misconceptions?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: C.muted2, marginBottom: 7 }}>LIKELY MISCONCEPTIONS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {r.misconceptions.map((m, i) => (
                  <div key={i} style={{ border: `1px solid ${tint(30, RED)}`, background: tint(9, RED), borderRadius: 10, padding: '9px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <Ico lucide={AlertTriangle} ti="ti-alert-triangle" size={12} color={RED} />
                      <span style={{ fontSize: 11.5, fontWeight: 900, color: RED }}>{m.learner}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: C.ink, fontWeight: 700, marginBottom: 2 }}>{m.misconception}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>→ {m.fix}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {r.strengths?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: C.muted2, marginBottom: 6 }}>STRENGTHS</div>
                {r.strengths.map((x, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, fontSize: 12, color: C.ink, marginBottom: 4, lineHeight: 1.5 }}>
                    <Ico lucide={CheckCircle2} ti="ti-circle-check" size={12} color={GREEN} style={{ flexShrink: 0, marginTop: 2 }} />{x}
                  </div>
                ))}
              </div>
            )}
            {r.gaps?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: C.muted2, marginBottom: 6 }}>GAPS</div>
                {r.gaps.map((x, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, fontSize: 12, color: C.ink, marginBottom: 4, lineHeight: 1.5 }}>
                    <Ico lucide={Brain} ti="ti-brain" size={12} color={C.brand} style={{ flexShrink: 0, marginTop: 2 }} />{x}
                  </div>
                ))}
              </div>
            )}
          </div>

          {r.recommendations?.length > 0 && (
            <div style={{ background: tint(4), border: `1px solid ${tint(20)}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: C.brand, marginBottom: 6 }}>RECOMMENDED NEXT STEPS</div>
              {r.recommendations.map((x, i) => (
                <div key={i} style={{ fontSize: 12.5, color: C.ink, marginBottom: 4, lineHeight: 1.55 }}>{i + 1}. {x}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function SelfStudyAnalyticsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError]     = useState('');

  const load = useCallback(() => {
    apiGet(`/api/self-study/${id}/analytics`)
      .then(d => { setData(d?.data ?? null); setErr(''); })
      .catch(e => setErr(e?.message || 'Could not load the analytics.'))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setGenError(''); setGenerating(true);
    try {
      const d = await apiPost(`/api/self-study/${id}/report`, {});
      setData(prev => prev ? { ...prev, report: { report: d?.data?.report, generatedAt: d?.data?.generatedAt } } : prev);
    } catch (e) { setGenError(e?.message || 'Could not generate the report.'); }
    finally { setGenerating(false); }
  };

  const a = data?.assignment;
  const s = data?.summary;

  return (
    <PageLayout
      title={a ? a.title : 'Activity analytics'}
      subtitle={a ? `${a.subject} · ${a.topic}` : ''}
      action={
        <Btn size="sm" variant="secondary" onClick={() => navigate(-1)}>
          <Ico lucide={ArrowLeft} ti="ti-arrow-left" size={13} /> Back
        </Btn>
      }
    >
      {loading ? (
        <div style={{ color: C.muted2, fontFamily: C.font }}>Loading analytics…</div>
      ) : err ? (
        <div style={{ color: RED, fontSize: 13.5, fontWeight: 700, fontFamily: C.font }}>{err}</div>
      ) : (
        <>
          {/* Class summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 20 }}>
            <Stat icon={Users} ti="ti-users" label="Assigned" value={s?.assigned} color={PURPLE} />
            <Stat icon={Clock} ti="ti-clock" label="In progress" value={s?.started} color={C.brand} />
            <Stat icon={CheckCircle2} ti="ti-circle-check" label="Complete" value={s?.complete} color={GREEN} />
            <Stat icon={Gauge} ti="ti-gauge" label="Avg understanding" value={s?.avgUnderstanding != null ? `${s.avgUnderstanding}%` : null} color={BLUE} />
            <Stat icon={AlertTriangle} ti="ti-alert-triangle" label="Avg confusion" value={s?.avgConfusion != null ? `${s.avgConfusion}%` : null} color={RED} />
          </div>

          <ReportCard data={data?.report} onRegenerate={generate} generating={generating} error={genError} />

          {/* Per-learner table */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px', fontFamily: C.font }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginBottom: 12 }}>Learners</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(data?.learners ?? []).map(r => (
                <div key={r.student.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 18 }}>{r.student.emoji}</span>
                  <div style={{ minWidth: 140, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{r.student.name}</div>
                    <div style={{ fontSize: 10.5, color: C.muted2 }}>@{r.student.username ?? '—'}{r.knowledgeScore != null ? ` · knowledge ${r.knowledgeScore}` : ''}</div>
                  </div>
                  {r.cognitive ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2, minWidth: 220 }}>
                      <Bar label="Understanding" value={r.cognitive.understanding} tone="understanding" />
                      <Bar label="Confusion" value={r.cognitive.confusion} tone="confusion" />
                      <Bar label="Engagement" value={r.cognitive.engagement} tone="engagement" />
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, color: C.muted2, fontStyle: 'italic' }}>No session yet</span>
                  )}
                  <Badge color={STATUS[r.status]?.color ?? C.muted} bg={STATUS[r.status]?.bg ?? C.bg}>
                    {STATUS[r.status]?.label ?? r.status}
                  </Badge>
                </div>
              ))}
              {(data?.learners ?? []).length === 0 && (
                <div style={{ fontSize: 12.5, color: C.muted, padding: '8px 0' }}>Nobody is assigned yet.</div>
              )}
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
