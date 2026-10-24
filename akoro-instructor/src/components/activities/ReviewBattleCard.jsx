/*
 * ReviewBattleCard — an activity's review battle on its detail page: one
 * class battle, sent to every learner's Challenges; when it runs, and each
 * learner's state (sent · accepted · running · done with the mark · missed),
 * plus the class average. The class ranking is the Ranking page's.
 * Not graded. GET /api/self-study/:id/reviews (self-study/activityReview.js).
 */
import { useEffect, useState } from 'react';
import { apiGet } from '../../services/api.js';
import { GREEN, BLUE } from '../../constants.js';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '');

export default function ReviewBattleCard({ activityId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!activityId) return;
    apiGet(`/api/self-study/${activityId}/reviews`).then((d) => setData(d?.data ?? null)).catch(() => setData(null));
  }, [activityId]);
  if (!data?.review) return null;
  const done = data.reviews.filter((r) => r.status === 'done');
  const accepted = data.reviews.filter((r) => ['accepted', 'running', 'done'].includes(r.status)).length;
  const avg = done.length ? Math.round(done.reduce((n, r) => n + (r.total ? (r.correct / r.total) * 100 : 0), 0) / done.length) : null;
  const chip = (r) => (r.status === 'done'
    ? { label: r.total ? `${r.correct}/${r.total}` : 'Done', color: GREEN, bg: '#DCFCE7' }
    : r.status === 'running' ? { label: 'Running', color: BLUE, bg: '#EFF6FF' }
    : r.status === 'sent' ? { label: 'In Challenges', color: '#7C3AED', bg: '#F3E8FF' }
    : r.status === 'accepted' ? { label: 'Accepted', color: '#047857', bg: '#ECFDF5' }
    : r.status === 'missed' ? { label: 'Missed', color: '#B45309', bg: '#FEF3C7' }
    : r.status === 'no_agent' ? { label: 'No agent', color: C.muted, bg: C.bg }
    : { label: 'Waiting', color: C.muted, bg: C.bg });
  return (
    <div data-review-card="" style={{ marginTop: 14, fontFamily: C.font }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, letterSpacing: .5, color: C.muted2 }}><Ico ti="ti-swords" size={13} color={C.muted2} />REVIEW BATTLE</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{fmt(data.review.at)} · {data.review.questions} questions · not graded</div>
      </div>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
        One battle for the whole class, sent to each learner's Challenges. It starts {fmt(data.startsAt || data.review.at)} with everyone who accepted; each protégé answers what its learner taught it.
        {accepted > 0 && data.battleStatus !== 'completed' && <> <b style={{ color: C.ink }}>{accepted}</b> of {data.reviews.length} in.</>}
        {avg != null && <> Average so far: <b style={{ color: C.ink }}>{avg}%</b> ({done.length} done).</>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
        {data.reviews.map((r) => {
          const c = chip(r);
          return (
            <div key={r.learnerId} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface }}>
              <Ico ti="ti-robot" size={15} color={C.muted2} />
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: C.ink }}>{r.name || 'Learner'}</span>
              <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 20, color: c.color, background: c.bg }}>{c.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
