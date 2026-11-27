import { useState, useEffect } from 'react';
import { AlertTriangle, Camera } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Modal } from '../components/Primitives.jsx';
import { apiGet } from '../services/api.js';
import { GREEN, RED, PURPLE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

/**
 * AssessmentReviewPage — instructor review of proctored assessments.
 *
 * Backed by GET /api/adaptive/assessments/review (flagged + terminated, ordered
 * by cheat probability) and GET /api/adaptive/assessments/:id for the full
 * transcript + proctoring evidence.
 */

const VERDICT = {
  pass:       { label: 'Pass',       color: GREEN },
  fail:       { label: 'Fail',       color: RED   },
  flagged:    { label: 'Flagged',    color: C.brand },
  terminated: { label: 'Terminated', color: RED   },
};

function verdictMeta(v) { return VERDICT[v] || { label: v || '—', color: C.muted }; }

function VerdictPill({ verdict }) {
  const v = verdictMeta(verdict);
  return (
    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: tint(10, v.color), color: v.color, display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: C.font }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: v.color, display: 'inline-block' }} />
      {v.label}
    </span>
  );
}

export default function AssessmentReviewPage() {
  const [filter, setFilter] = useState('review');   // review | all | terminated | flagged
  const [rows, setRows]     = useState(null);
  const [error, setError]   = useState('');
  const [detailId, setDetailId] = useState(null);

  useEffect(() => {
    let alive = true;
    setRows(null); setError('');
    // 'review' → default queue (flagged + terminated); others filter by verdict.
    const path = filter === 'review'
      ? '/api/adaptive/assessments/review'
      : `/api/adaptive/assessments/review?verdict=${filter}`;
    apiGet(path)
      .then(d => { if (alive) setRows(d.assessments || []); })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [filter]);

  return (
    <PageLayout title="Assessment Review" subtitle="Proctored exam integrity & results">
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { k: 'review',     label: 'Review queue' },
          { k: 'flagged',    label: 'Flagged' },
          { k: 'terminated', label: 'Terminated' },
        ].map(t => (
          <button key={t.k} onClick={() => setFilter(t.k)}
            style={{
              padding: '7px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: C.font,
              fontSize: 13, fontWeight: 700,
              border: `1px solid ${filter === t.k ? PURPLE : C.border}`,
              background: filter === t.k ? `${PURPLE}10` : C.surface,
              color: filter === t.k ? PURPLE : C.muted,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: `${RED}10`, border: `1px solid ${RED}33`, borderRadius: 12,
          padding: '12px 14px', color: RED, fontSize: 13, fontWeight: 600, fontFamily: C.font }}>
          {error}
        </div>
      )}

      {!rows && !error && <Skeleton />}

      {rows && rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: C.muted2, fontFamily: C.font }}>
          <Ico ti="ti-shield" size={36} style={{ marginBottom: 10, opacity: .5 }} />
          <p style={{ fontSize: 14, fontWeight: 600 }}>No assessments in this view.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => <ReviewRow key={r.id} r={r} onOpen={() => setDetailId(r.id)} />)}
        </div>
      )}

      {detailId && <DetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </PageLayout>
  );
}

function ReviewRow({ r, onOpen }) {
  const cheat = Math.round((r.cheatProbability || 0) * 100);
  const cheatColor = cheat >= 70 ? RED : cheat >= 40 ? C.brand : GREEN;

  return (
    <div onClick={onOpen} style={{
      display: 'flex', alignItems: 'center', gap: 14, background: C.surface,
      border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px', cursor: 'pointer',
      fontFamily: C.font,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14.5, fontWeight: 800, color: C.ink }}>{r.topic}</span>
          <VerdictPill verdict={r.verdict} />
          {!r.identityVerified && (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: C.brand, display: 'flex', alignItems: 'center', gap: 3 }}>
              <Ico ti="ti-alert-triangle" size={12} /> No ID
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
          {r.subject || '—'} · {r.studentId} · {r.completedAt ? new Date(r.completedAt).toLocaleString() : 'in progress'}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted2, letterSpacing: .3 }}>INTEGRITY</div>
        <div style={{ fontSize: 18, fontWeight: 900, color: cheatColor }}>{cheat}%</div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 56 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted2, letterSpacing: .3 }}>SCORE</div>
        <div style={{ fontSize: 18, fontWeight: 900, color: C.ink }}>{r.score ?? '—'}</div>
      </div>

      <Ico ti="ti-eye" size={18} color={C.muted2} style={{ flexShrink: 0 }} />
    </div>
  );
}

function DetailModal({ id, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    apiGet(`/api/adaptive/assessments/${id}`)
      .then(d => { if (alive) setData(d.assessment); })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [id]);

  const v = data ? verdictMeta(data.verdict) : null;

  return (
    <Modal open onClose={onClose} title="Assessment detail" width={680}>
      {error && <p style={{ color: RED, fontFamily: C.font, fontWeight: 600 }}>{error}</p>}
      {!data && !error && <Skeleton />}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: C.font }}>
          {/* Header stats */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Stat label="Verdict" value={v.label} color={v.color} />
            <Stat label="Score" value={data.score ?? '—'} color={C.ink} />
            <Stat label="Cheat probability" value={`${Math.round((data.cheatProbability || 0) * 100)}%`}
              color={(data.cheatProbability || 0) >= 0.4 ? RED : GREEN} />
            <Stat label="Identity" value={data.identityVerified ? 'Verified' : 'Unverified'}
              color={data.identityVerified ? GREEN : C.brand} />
          </div>

          {/* Reference photo */}
          {data.referenceImageUrl && (
            <div>
              <SectionLabel icon={Camera} ti="ti-camera">Identity reference</SectionLabel>
              <img src={data.referenceImageUrl} alt="reference"
                style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 10, border: `1px solid ${C.border}` }} />
            </div>
          )}

          {/* Verdict detail */}
          {data.verdictDetail && (
            <div>
              <SectionLabel>Sergeant's verdict</SectionLabel>
              <p style={{ fontSize: 13.5, color: C.ink, lineHeight: 1.6, margin: 0,
                background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                {data.verdictDetail}
              </p>
            </div>
          )}

          {/* Cheat events */}
          {data.cheatEvents?.length > 0 && (
            <div>
              <SectionLabel icon={AlertTriangle} ti="ti-alert-triangle">Proctoring flags ({data.cheatEvents.length})</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.cheatEvents.map((e, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: `${RED}08`, border: `1px solid ${RED}22`, borderRadius: 8, padding: '7px 11px' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, textTransform: 'capitalize' }}>
                      {String(e.type || '').replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: e.severity === 'high' ? RED : C.brand }}>
                      {e.severity} · {e.ts ? new Date(e.ts).toLocaleTimeString() : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transcript */}
          {data.blockHistory?.length > 0 && (
            <div>
              <SectionLabel>Transcript</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto',
                background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
                {data.blockHistory.map((b, i) => <TranscriptBlock key={i} b={b} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function TranscriptBlock({ b }) {
  if (b.type === 'question')
    return <div style={{ fontSize: 13, fontWeight: 700, color: PURPLE }}>Q{b.idx}. {b.text}</div>;
  if (b.type === 'user')
    return <div style={{ fontSize: 13, color: C.ink, paddingLeft: 12, borderLeft: `2px solid ${C.border}` }}>{b.text}</div>;
  if (b.type === 'sergeant')
    return (
      <div style={{ fontSize: 12.5, color: C.muted, display: 'flex', gap: 6, alignItems: 'center' }}>
        {b.correct != null && (b.correct ? <Ico ti="ti-circle-check" size={14} color={GREEN} /> : <Ico ti="ti-circle-x" size={14} color={RED} />)}
        <span>{b.text}{b.score != null ? ` (${b.score}/100)` : ''}</span>
      </div>
    );
  if (b.type === 'hint')
    return <div style={{ fontSize: 12, color: C.brand, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 5 }}><Ico ti="ti-bulb" size={12} /> {b.text}</div>;
  if (b.type === 'proctor-flag')
    return <div style={{ fontSize: 12, color: RED, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}><Ico ti="ti-alert-triangle" size={12} /> {b.text}</div>;
  return null;
}

function Stat({ label, value, color }) {
  return (
    <div style={{ flex: '1 1 120px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted2, letterSpacing: .3 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function SectionLabel({ children, icon: Icon, ti }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      {Icon && <Ico lucide={Icon} ti={ti} size={14} color={C.muted} />}
      <span style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: .4 }}>
        {typeof children === 'string' ? children.toUpperCase() : children}
      </span>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ height: 64, borderRadius: 14, background: C.bg, border: `1px solid ${C.border}` }} />
      ))}
    </div>
  );
}
