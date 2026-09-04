/**
 * NowStudyingBar — Spotify-style "now studying" mini-bar.
 *
 * Sits fixed just above the bottom nav on every tab except the AI chat,
 * for higher-ed learners. Shows the material or session the learner has
 * open — art, title, source — with resume / quick-add / dismiss controls,
 * and a progress fill line pinned to its bottom edge whose COLOUR reads
 * the stage (grey → red → amber → green → brand-complete) and whose
 * width reads the amount.
 *
 * Data comes from utils/nowStudying.js; the dashboard decides visibility.
 */
import { BRAND } from '../../constants.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { progressStage } from '../../utils/nowStudying.js';

const FONT = "'Nunito', sans-serif";

export default function NowStudyingBar({ item, onOpen, onAdd, onDismiss }) {
  const { t } = useLang();
  if (!item) return null;
  const stage = progressStage(item.progress);

  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))', zIndex: 850,
      background: 'var(--ak-surface)', borderTop: '1px solid var(--ak-border)',
      boxShadow: '0 -4px 18px rgba(0,0,0,.10)', fontFamily: FONT,
      animation: 'sheet-up .28s cubic-bezier(.32,1.2,.64,1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px 11px 14px' }}>
        {/* Art — subject emoji on a tinted tile (session) or file glyph (record) */}
        <div style={{ width: 42, height: 42, borderRadius: 11, flexShrink: 0, background: `${BRAND}14`, border: `1px solid ${BRAND}2e`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{item.emoji || '📚'}</div>

        {/* Title + source */}
        <div onClick={onOpen} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
          <p style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.title}
          </p>
          <p style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <span style={{ color: stage.color, fontSize: 9 }}>●</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.sub}</span>
            {item.progress > 0 && <span style={{ flexShrink: 0, fontFamily: 'monospace' }}>{Math.round(item.progress)}%</span>}
          </p>
        </div>

        {/* Controls — add-a-record, resume, dismiss */}
        <button onClick={onAdd} title={t('records.title')} aria-label={t('records.title')}
          style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: 'transparent', border: '1.5px solid var(--ak-border2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-sub)" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        </button>
        <button onClick={onOpen} title={t('now.resume')} aria-label={t('now.resume')}
          style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, border: 'none',
            background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: `0 2px 10px ${BRAND}44` }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="#fff"><path d="M7 4.5v15a1 1 0 001.54.84l11.2-7.5a1 1 0 000-1.68L8.54 3.66A1 1 0 007 4.5z"/></svg>
        </button>
        <button onClick={onDismiss} title={t('now.dismiss')} aria-label={t('now.dismiss')}
          style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: 'transparent', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: .55 }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-muted)" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {/* Progress fill — fixed to the bar's bottom edge, colour = stage */}
      <div style={{ height: 3, background: 'var(--ak-tag-bg)', overflow: 'hidden' }}>
        <div title={`${Math.round(item.progress || 0)}% · ${stage.label}`} style={{ height: '100%', width: `${Math.max(0, Math.min(100, item.progress || 0))}%`,
          background: stage.color, borderRadius: 99, transition: 'width .4s ease, background .3s' }}/>
      </div>
    </div>
  );
}
