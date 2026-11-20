/*
 * LessonCheckCard — the short check's result inside the teaching lesson
 * (Grand Plan Phase 7 teaching.request_assessment; preview approved
 * 2026-11-07). The protégé answered only from what the learner taught; a
 * guess never counts. One row per question; the first thing still to teach
 * becomes a "Teach … next" button that fills the message box.
 */
import { BRAND } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';
import { ScoreRing } from '../../agent-chat/index.js';

const NUNITO = "'Nunito',sans-serif";
const MARK = {
  correct: { icon: 'ti-check', color: '#10B981' },
  wrong: { icon: 'ti-x', color: '#EF4444' },
  guessed: { icon: 'ti-help', color: '#9CA3AF' },
  guessed_right: { icon: 'ti-help', color: '#9CA3AF' },
};

export default function LessonCheckCard({ assessment, agentName = 'Your agent', topic = '', onTeachNext = null }) {
  const items = Array.isArray(assessment?.items) ? assessment.items : [];
  if (!items.length) return null;
  const total = assessment.total ?? items.length;
  const correct = assessment.correct ?? items.filter((i) => i.outcome === 'correct').length;
  const next = items.find((i) => i.outcome !== 'correct');
  return (
    <div data-lesson-check="" style={{ background: 'var(--ak-surface)', border: `1px solid ${BRAND}30`, borderRadius: 16, padding: 14, display: 'grid', gap: 10, fontFamily: NUNITO, maxWidth: 520 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <ScoreRing score={total ? correct / total : 0} correct={correct} total={total} passed={total > 0 && correct === total} size={56} />
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)' }}>{agentName}'s check{topic ? ` · ${topic}` : ''}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ak-text-sub)', lineHeight: 1.45 }}>Answered only from what you taught. A guess never counts.</div>
        </div>
      </div>
      {items.map((it, i) => {
        const m = MARK[it.outcome] || MARK.guessed;
        const guessed = it.outcome === 'guessed' || it.outcome === 'guessed_right';
        return (
          <div key={i} data-check-item={it.outcome} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.45, padding: '7px 9px', borderRadius: 10, background: 'var(--ak-surface2, rgba(0,0,0,.03))' }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}><Icon name={m.icon} size={11} color="#fff" /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, color: 'var(--ak-text)' }}>{it.question}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ak-text-sub)' }}>
                {guessed ? `${agentName} guessed — you haven't taught this yet.` : <>"{it.answer}" <span style={{ color: 'var(--ak-text-muted)', fontWeight: 800 }}>· from your teaching</span></>}
              </div>
            </div>
          </div>
        );
      })}
      {next && onTeachNext && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => onTeachNext(`Let me teach you ${String(next.concept || next.question).replace(/\?$/, '')} next.`)}
            style={{ border: 'none', borderRadius: 20, padding: '8px 14px', fontWeight: 800, fontSize: 12.5, fontFamily: NUNITO, color: '#fff', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="ti-school" size={13} color="#fff" />Teach {String(next.concept || 'it').slice(0, 40)} next
          </button>
        </div>
      )}
    </div>
  );
}
