/**
 * NowStudyingSidebarCard — the sidebar's "now studying" widget.
 *
 * RETIRED (not mounted anywhere): every surface above mobile now uses the
 * fixed full-width NowStudyingTabletBar instead, and mobile keeps its own
 * NowStudyingBar. Kept on disk in case the sidebar card returns.
 *
 * Desktop twin of NowStudyingBar: instead of a fixed bar above the bottom
 * nav (mobile), the parked session / record / battle lives at the bottom of
 * the sidebar nav — the way a music app pins the mini-player. Same data (utils/nowStudying.js), same
 * controls (open / quick-add a record / dismiss), same colour story:
 *
 *   · a study item's line is its PROGRESS FILL — colour reads the stage
 *     (grey → red → amber → green → brand-complete), width the amount;
 *   · a battle's line is a LIVE INDICATOR — pulsing red while the battle
 *     runs, steady brand while it waits in the lobby. The quick-add control
 *     is study-only, so it hides while a battle is parked.
 *
 * Responsive (rules in index.css):
 *   · full sidebar  (>1024px) — caption, art, title, progress, actions;
 *   · icon rail (769–1024px) — collapses to the art tile + progress line
 *     with a corner dismiss ✕; tapping the tile opens;
 *   · mobile      (≤768px)   — never rendered (the whole sidebar is hidden;
 *     the fixed NowStudyingBar remains the only surface there).
 *
 * The dashboard drives both surfaces from the same visibility flag, so they
 * can never disagree.
 */
import { BRAND, RED } from '../../../constants.js';
import { useLang } from '../../../contexts/LanguageContext.jsx';
import { progressStage } from '../../../utils/nowStudying.js';
import { Icon } from '../../../components/common/Icons.jsx';

const FONT = "'Nunito', sans-serif";

export default function NowStudyingSidebarCard({ item, onOpen, onAdd, onDismiss }) {
  const { t } = useLang();
  if (!item) return null;
  const isBattle   = item.type === 'battle';
  const battleLive = isBattle && item.snapshot?.status === 'live';
  const stage      = isBattle ? null : progressStage(item.progress);
  const dotColor   = isBattle ? (battleLive ? RED : BRAND) : stage.color;
  const livePulse  = { animation: 'ak-now-card-pulse 1.6s ease-in-out infinite' };
  const pct        = Math.max(0, Math.min(100, item.progress || 0));

  return (
    <div className="ak-sb-now" style={{
      margin: '10px 12px', padding: 11, borderRadius: 14, position: 'relative',
      background: 'var(--ak-surface-hover)', border: '1px solid var(--ak-border2)',
      fontFamily: FONT, flexShrink: 0,
      animation: 'ak-now-card-in .28s var(--ease-spring, ease-out)',
    }}>
      <style>{`
        @keyframes ak-now-card-pulse{0%,100%{opacity:1}50%{opacity:.35}}
        @keyframes ak-now-card-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      {/* Caption + dismiss */}
      <div className="ak-sb-now-caption" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span className="ak-sb-now-label" style={{
          fontSize: 9, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase',
          color: 'var(--ak-text-muted)', display: 'flex', alignItems: 'center', gap: 5,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          <span style={{ color: dotColor, fontSize: 8, display: 'inline-block', ...(!battleLive ? { animation: 'none' } : livePulse) }}>●</span>
          {t('now.studying')}
        </span>
        <button onClick={onDismiss} title={t('now.dismiss')} aria-label={t('now.dismiss')}
          className="ak-sb-now-x"
          style={{
            width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
            background: 'transparent', border: 'none', cursor: 'pointer', marginLeft: 'auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: .55,
          }}>
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-muted)" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {/* Art + title — the whole row opens the item */}
      <div className="ak-sb-now-main" onClick={onOpen} title={item.title}
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', minWidth: 0 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 'var(--r-md, 12px)', flexShrink: 0,
          background: battleLive ? `${RED}14` : `${BRAND}14`,
          border: `1px solid ${battleLive ? `${RED}2e` : `${BRAND}2e`}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19,
        }}>
          {item.emoji?.startsWith('ti-') ? <Icon name={item.emoji} size={19}/> : item.emoji ? <span>{item.emoji}</span> : <Icon name="ti-book" size={19}/>}
        </div>
        <div className="ak-sb-now-text" style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontSize: 12.5, fontWeight: 900, color: 'var(--ak-text)', margin: 0, lineHeight: 1.3,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{item.title}</p>
          <p style={{
            fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '3px 0 0',
            display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', overflow: 'hidden',
          }}>
            <span style={{ color: dotColor, fontSize: 8, display: 'inline-block', flexShrink: 0, ...(!battleLive ? { animation: 'none' } : livePulse) }}>●</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.sub}</span>
            {!isBattle && pct > 0 && <span style={{ flexShrink: 0, fontFamily: 'monospace' }}>{Math.round(pct)}%</span>}
          </p>
        </div>
      </div>

      {/* Bottom line — study items: progress fill (colour = stage).
          Battles: live indicator (pulsing red while running, brand in lobby). */}
      {isBattle ? (
        <div title={battleLive ? t('now.battle_live') : t('now.battle_lobby')}
          style={{ height: 3, marginTop: 9, background: battleLive ? RED : `${BRAND}66`, borderRadius: 99,
            ...(!battleLive ? { animation: 'none' } : livePulse) }}/>
      ) : (
        <div style={{ height: 3, marginTop: 9, background: 'var(--ak-tag-bg)', overflow: 'hidden', borderRadius: 99 }}>
          <div title={`${Math.round(pct)}% · ${stage.label}`} style={{
            height: '100%', width: `${pct}%`, background: stage.color, borderRadius: 99,
            transition: 'width .4s ease, background .3s' }}/>
        </div>
      )}

      {/* Actions — resume always; quick-add a record for study items only */}
      <div className="ak-sb-now-actions" style={{ display: 'flex', gap: 7, marginTop: 10 }}>
        <button onClick={onOpen} title={isBattle ? t('now.resume_battle') : t('now.resume')}
          style={{
            flex: 1, height: 30, borderRadius: 100, border: 'none', cursor: 'pointer',
            background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff',
            fontFamily: FONT, fontSize: 11.5, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            boxShadow: `0 2px 10px ${BRAND}44`,
          }}>
          <svg width={11} height={11} viewBox="0 0 24 24" fill="#fff"><path d="M7 4.5v15a1 1 0 001.54.84l11.2-7.5a1 1 0 000-1.68L8.54 3.66A1 1 0 007 4.5z"/></svg>
          {isBattle ? t('now.resume_battle') : t('now.resume')}
        </button>
        {!isBattle && (
          <button onClick={onAdd} title={t('records.title')} aria-label={t('records.title')}
            style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
              background: 'transparent', border: '1.5px solid var(--ak-border2)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-sub)" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}
