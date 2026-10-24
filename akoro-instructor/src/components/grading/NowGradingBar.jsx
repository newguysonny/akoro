/**
 * NowGradingBar — the instructor's "now grading" player bar.
 *
 * The learner app's NowStudyingTabletBar, for grading: a fixed, full-width bar pinned to the
 * bottom of the viewport on tablet AND desktop, laid out like a music app's player — three
 * columns in one row:
 *
 *   · left   — art tile + what is being graded and whose work (tap either to open);
 *   · centre — previous / resume / next student over the progress line (how much of THIS
 *              submission is marked), flanked by the % and the stage label;
 *   · right  — the tool icons (open the workspace, dismiss).
 *
 * The WHOLE bar opens the workspace; the control buttons stop the tap bubbling. On a phone it
 * collapses to one compact row above the bottom nav. While it shows, the sidebar and the page
 * stop above it (body.ak-has-nowgrading rules in nowGrading.css).
 */
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import { progressStage } from '../../lib/nowGrading.js';
import './nowGrading.css';

const BRAND = '#6C3BFF';

export default function NowGradingBar({ item, onOpen, onDismiss, onPrev, onNext, canPrev, canNext }) {
  if (!item) return null;
  const stage = progressStage(item.progress);
  const pct = Math.max(0, Math.min(100, item.progress || 0));
  const skip = (dir, enabled) => (
    <button onClick={(e) => { e.stopPropagation(); (dir < 0 ? onPrev : onNext)?.(); }} disabled={!enabled}
      title={dir < 0 ? 'Previous learner' : 'Next learner'} aria-label={dir < 0 ? 'Previous learner' : 'Next learner'}
      className="ak-nowg-skip"
      style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: 'transparent', border: 'none',
        cursor: enabled ? 'pointer' : 'default', opacity: enabled ? .85 : .28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Ico ti={dir < 0 ? 'ti-player-skip-back' : 'ti-player-skip-forward'} size={17} color="var(--ak-text-sub)" />
    </button>
  );
  const open = (e) => { e?.stopPropagation?.(); onOpen?.(); };

  return (
    <div className="ak-nowg" onClick={onOpen} role="region" aria-label="Now grading"
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 'var(--z-bar, 850)', background: 'var(--ak-surface)',
        borderTop: '1px solid var(--ak-border)', boxShadow: '0 -4px 18px rgba(0,0,0,.10)', fontFamily: C.font,
        height: 'var(--ak-nowg-h, 78px)', animation: 'ak-nowg-in .28s ease-out', cursor: 'pointer' }}>
      <div className="ak-nowg-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr) minmax(0,1fr)',
        alignItems: 'center', gap: 16, padding: '0 18px', height: '100%' }}>

        {/* 1 — art + what is being graded */}
        <div className="ak-nowg-meta" title={`${item.title} — ${item.studentName}`} style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
          <div style={{ width: 46, height: 46, borderRadius: 'var(--r-md, 12px)', flexShrink: 0, background: `${BRAND}14`, border: `1px solid ${BRAND}2e`,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ico ti="ti-clipboard-check" size={22} color={BRAND} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)', margin: 0, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Grading — {item.title}
            </p>
            <p style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '3px 0 0', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <span style={{ color: stage.color, fontSize: 8, display: 'inline-block', flexShrink: 0 }}>●</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.studentName}{item.subject ? ` · ${item.subject}` : ''}</span>
              {pct > 0 && <span className="ak-nowg-pct-inline" style={{ flexShrink: 0, fontFamily: 'monospace' }}>{Math.round(pct)}%</span>}
            </p>
          </div>
        </div>

        {/* 2 — skip / resume over the progress line */}
        <div className="ak-nowg-center" style={{ minWidth: 0, padding: '0 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 7 }}>
            {skip(-1, canPrev)}
            <button onClick={open} title="Resume grading" aria-label="Resume grading"
              style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, border: 'none', cursor: 'pointer',
                background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 2px 12px ${BRAND}44` }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="#fff"><path d="M7 4.5v15a1 1 0 001.54.84l11.2-7.5a1 1 0 000-1.68L8.54 3.66A1 1 0 007 4.5z" /></svg>
            </button>
            {skip(1, canNext)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{Math.round(pct)}%</span>
            <div style={{ flex: 1, height: 4, background: 'var(--ak-tag-bg)', borderRadius: 99, overflow: 'hidden' }}>
              <div title={`${Math.round(pct)}% · ${stage.label}`} style={{ height: '100%', width: `${pct}%`, background: stage.color, borderRadius: 99, transition: 'width .4s ease, background .3s' }} />
            </div>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-muted)', whiteSpace: 'nowrap' }}>{stage.label}</span>
          </div>
        </div>

        {/* 3 — tools */}
        <div className="ak-nowg-tools" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={open} title="Resume grading" aria-label="Resume grading"
            style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', background: 'var(--ak-surface-hover)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ico ti="ti-clipboard-check" size={17} color={BRAND} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDismiss?.(); }} title="Dismiss" aria-label="Dismiss"
            style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', background: 'transparent', border: 'none', opacity: .55, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-muted)" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
