import { useState, useEffect } from 'react';
import {Shield, AlertTriangle, Eye, X, Camera, CheckCircle2, XCircle, Lightbulb } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Modal } from '../components/Primitives.jsx';
import { apiGet } from '../services/api.js';
import {
  INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, PURPLE, AMBER, FONT,
} from '../constants.js';

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
  flagged:    { label: 'Flagged',    color: AMBER },
  terminated: { label: 'Terminated', color: RED   },
};

function verdictMeta(v) { return VERDICT[v] || { label: v || '—', color: MUTED }; }

function VerdictPill({ verdict }) {
  const v = verdictMeta(verdict);
  return (
    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: `${v.color}1A`, color: v.color, display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: FONT }}>
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
              padding: '7px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: FONT,
              fontSize: 13, fontWeight: 700,
              border: `1px solid ${filter === t.k ? PURPLE : BORDER}`,
              background: filter === t.k ? `${PURPLE}10` : WHITE,
              color: filter === t.k ? PURPLE : MUTED,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: `${RED}10`, border: `1px solid ${RED}33`, borderRadius: 12,
          padding: '12px 14px', color: RED, fontSize: 13, fontWeight: 600, fontFamily: FONT }}>
          {error}
        </div>
      )}

      {!rows && !error && <Skeleton />}

      {rows && rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: MUTED2, fontFamily: FONT }}>
          <Shield size={36} strokeWidth={1.5} style={{ marginBottom: 10, opacity: .5 }} />
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
  const cheatColor = cheat >= 70 ? RED : cheat >= 40 ? AMBER : GREEN;

  return (
    <div onClick={onOpen} style={{
      display: 'flex', alignItems: 'center', gap: 14, background: WHITE,
      border: `1px solid ${BORDER}`, borderRadius: 14, padding: '14px 16px', cursor: 'pointer',
      fontFamily: FONT,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>{r.topic}</span>
          <VerdictPill verdict={r.verdict} />
          {!r.identityVerified && (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: AMBER, display: 'flex', alignItems: 'center', gap: 3 }}>
              <AlertTriangle size={12} /> No ID
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
          {r.subject || '—'} · {r.studentId} · {r.completedAt ? new Date(r.completedAt).toLocaleString() : 'in progress'}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: MUTED2, letterSpacing: .3 }}>INTEGRITY</div>
        <div style={{ fontSize: 18, fontWeight: 900, color: cheatColor }}>{cheat}%</div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 56 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: MUTED2, letterSpacing: .3 }}>SCORE</div>
        <div style={{ fontSize: 18, fontWeight: 900, color: INK }}>{r.score ?? '—'}</div>
      </div>

      <Eye size={18} color={MUTED2} style={{ flexShrink: 0 }} />
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
      {error && <p style={{ color: RED, fontFamily: FONT, fontWeight: 600 }}>{error}</p>}
      {!data && !error && <Skeleton />}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: FONT }}>
          {/* Header stats */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Stat label="Verdict" value={v.label} color={v.color} />
            <Stat label="Score" value={data.score ?? '—'} color={INK} />
            <Stat label="Cheat probability" value={`${Math.round((data.cheatProbability || 0) * 100)}%`}
              color={(data.cheatProbability || 0) >= 0.4 ? RED : GREEN} />
            <Stat label="Identity" value={data.identityVerified ? 'Verified' : 'Unverified'}
              color={data.identityVerified ? GREEN : AMBER} />
          </div>

          {/* Reference photo */}
          {data.referenceImageUrl && (
            <div>
              <SectionLabel icon={Camera}>Identity reference</SectionLabel>
              <img src={data.referenceImageUrl} alt="reference"
                style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 10, border: `1px solid ${BORDER}` }} />
            </div>
          )}

          {/* Verdict detail */}
          {data.verdictDetail && (
            <div>
              <SectionLabel>Sergeant's verdict</SectionLabel>
              <p style={{ fontSize: 13.5, color: INK, lineHeight: 1.6, margin: 0,
                background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                {data.verdictDetail}
              </p>
            </div>
          )}

          {/* Cheat events */}
          {data.cheatEvents?.length > 0 && (
            <div>
              <SectionLabel icon={AlertTriangle}>Proctoring flags ({data.cheatEvents.length})</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.cheatEvents.map((e, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: `${RED}08`, border: `1px solid ${RED}22`, borderRadius: 8, padding: '7px 11px' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, textTransform: 'capitalize' }}>
                      {String(e.type || '').replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: e.severity === 'high' ? RED : AMBER }}>
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
                background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 12 }}>
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
    return <div style={{ fontSize: 13, color: INK, paddingLeft: 12, borderLeft: `2px solid ${BORDER}` }}>{b.text}</div>;
  if (b.type === 'sergeant')
    return (
      <div style={{ fontSize: 12.5, color: MUTED, display: 'flex', gap: 6, alignItems: 'center' }}>
        {b.correct != null && (b.correct ? <CheckCircle2 size={14} color={GREEN} /> : <XCircle size={14} color={RED} />)}
        <span>{b.text}{b.score != null ? ` (${b.score}/100)` : ''}</span>
      </div>
    );
  if (b.type === 'hint')
    return <div style={{ fontSize: 12, color: AMBER, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 5 }}><Lightbulb size={12} /> {b.text}</div>;
  if (b.type === 'proctor-flag')
    return <div style={{ fontSize: 12, color: RED, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={12} /> {b.text}</div>;
  return null;
}

function Stat({ label, value, color }) {
  return (
    <div style={{ flex: '1 1 120px', background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: MUTED2, letterSpacing: .3 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function SectionLabel({ children, icon: Icon }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      {Icon && <Icon size={14} color={MUTED} />}
      <span style={{ fontSize: 11, fontWeight: 800, color: MUTED, letterSpacing: .4 }}>
        {typeof children === 'string' ? children.toUpperCase() : children}
      </span>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ height: 64, borderRadius: 14, background: LIGHT, border: `1px solid ${BORDER}` }} />
      ))}
    </div>
  );
}
