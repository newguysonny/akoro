/**
 * NowStudyingBar — Spotify-style "now studying" mini-bar.
 *
 * Sits fixed just above the bottom nav on every tab except the AI chat,
 * for higher-ed learners. Shows the session, record OR BATTLE the learner
 * has parked — art, title, source — with resume / quick-add / dismiss
 * controls, and a line pinned to its bottom edge.
 *
 * Sessions and battles share this one bar:
 *   · a study item's line is its PROGRESS FILL — colour reads the stage
 *     (grey → red → amber → green → brand-complete), width the amount;
 *   · a battle's line is a LIVE INDICATOR — pulsing red while the battle
 *     is running, steady brand while it waits in the lobby. The quick-add
 *     control is study-only, so it hides while a battle is parked.
 *
 * Data comes from utils/nowStudying.js; the dashboard decides visibility.
 *
 * The WHOLE bar opens the item — tap anywhere (art tile, title, gaps).
 * The control buttons (quick-add / resume / dismiss) stop the tap from
 * bubbling, so their own action runs instead of the open.
 */
import { BRAND, RED } from '../../constants.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { progressStage } from '../../utils/nowStudying.js';
import { Icon } from '../common/Icons.jsx';

const FONT = "'Nunito', sans-serif";

export default function NowStudyingBar({ item, onOpen, onAdd, onDismiss, sticky = false }) {
  const { t } = useLang();
  if (!item) return null;
  const isBattle  = item.type === 'battle';
  const battleLive = isBattle && item.snapshot?.status === 'live';
  const stage = isBattle ? null : progressStage(item.progress);
  const dotColor = isBattle ? (battleLive ? RED : BRAND) : stage.color;
  const livePulse = { animation: 'now-live-pulse 1.6s ease-in-out infinite' };

  /* sticky — the same bar rendered INSIDE a full-screen page (folders,
     Pharm.D, programme pages). It pins to the VIEWPORT bottom, not the
     content's: a sticky element in a short page (a coming-soon card, a page
     still loading) sits wherever the content ends, which read as a misplaced
     bar mid-screen. Fixed keeps it on the bottom edge for every page length;
     z 30 stays under that page's sheets (40) so rename/delete still cover it. */
  return (
    <div className="ak-now-bar" onClick={onOpen} style={sticky
      ? { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30,
          background: 'var(--ak-surface)', borderTop: '1px solid var(--ak-border)',
          boxShadow: '0 -4px 18px rgba(0,0,0,.10)', fontFamily: FONT,
          animation: `sheet-up .28s var(--ease-spring)`, cursor: 'pointer' }
      : { position: 'fixed', left: 0, right: 0, bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))', zIndex: 'var(--z-bar)',
          background: 'var(--ak-surface)', borderTop: '1px solid var(--ak-border)',
          boxShadow: '0 -4px 18px rgba(0,0,0,.10)', fontFamily: FONT,
          animation: `sheet-up .28s var(--ease-spring)`, cursor: 'pointer' }}>
      <style>{`@keyframes now-live-pulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px 11px 14px' }}>
        {/* Art — subject emoji on a tinted tile (session/record), ⚔️ for a
            parked battle (red tint while live, brand in the lobby) */}
        <div style={{ width: 42, height: 42, borderRadius: 'var(--r-md)', flexShrink: 0,
          background: battleLive ? `${RED}14` : `${BRAND}14`,
          border: `1px solid ${battleLive ? `${RED}2e` : `${BRAND}2e`}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{item.emoji?.startsWith('ti-') ? <Icon name={item.emoji} size={20}/> : item.emoji ? <span>{item.emoji}</span> : <Icon name="ti-book" size={20}/>}</div>

        {/* Title + source — taps land on the bar's root (open) */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.title}
          </p>
          <p style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {/* Study items: progress-stage dot + %. Battles: live/lobby dot, no % */}
            <span style={{ color: dotColor, fontSize: 9, display: 'inline-block', ...(!battleLive ? { animation: 'none' } : livePulse) }}>●</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.sub}</span>
            {!isBattle && item.progress > 0 && <span style={{ flexShrink: 0, fontFamily: 'monospace' }}>{Math.round(item.progress)}%</span>}
          </p>
        </div>

        {/* Controls — add-a-record (study items only), resume, dismiss */}
        {!isBattle && (
          <button onClick={(e) => { e.stopPropagation(); onAdd?.(); }} title={t('records.title')} aria-label={t('records.title')}
            style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: 'transparent', border: '1.5px solid var(--ak-border2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-sub)" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          </button>
        )}
        <button onClick={(e) => { e.stopPropagation(); onOpen?.(); }} title={isBattle ? t('now.resume_battle') : t('now.resume')} aria-label={isBattle ? t('now.resume_battle') : t('now.resume')}
          style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, border: 'none',
            background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: `0 2px 10px ${BRAND}44` }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="#fff"><path d="M7 4.5v15a1 1 0 001.54.84l11.2-7.5a1 1 0 000-1.68L8.54 3.66A1 1 0 007 4.5z"/></svg>
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDismiss?.(); }} title={t('now.dismiss')} aria-label={t('now.dismiss')}
          style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: 'transparent', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: .55 }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-muted)" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {/* Bottom line — study items: progress fill (colour = stage).
          Battles: live indicator (pulsing red while running, brand in the lobby). */}
      {isBattle ? (
        <div title={battleLive ? t('now.battle_live') : t('now.battle_lobby')}
          style={{ height: 3, background: battleLive ? RED : `${BRAND}66`, borderRadius: 99,
            ...(!battleLive ? { animation: 'none' } : livePulse) }}/>
      ) : (
        <div style={{ height: 3, background: 'var(--ak-tag-bg)', overflow: 'hidden' }}>
          <div title={`${Math.round(item.progress || 0)}% · ${stage.label}`} style={{ height: '100%', width: `${Math.max(0, Math.min(100, item.progress || 0))}%`,
            background: stage.color, borderRadius: 99, transition: 'width .4s ease, background .3s' }}/>
        </div>
      )}
    </div>
  );
}
