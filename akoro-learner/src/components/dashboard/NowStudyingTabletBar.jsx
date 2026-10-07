/**
 * NowStudyingTabletBar — the tablet "now studying" surface.
 *
 * Tablet twin of the mobile NowStudyingBar: a fixed, full-width bar pinned
 * to the bottom of the viewport, laid out like a music app's player bar
 * (the Spotify sample) — three columns in a single row:
 *
 *   · left   — art tile + name & details (tap either to open);
 *   · centre — progress tracking with previous / next skip controls and a
 *              resume play button, the player's scrubber row;
 *   · right  — the tool icons (open book, quick-add a record, dismiss).
 *
 * Same data as the other surfaces (utils/nowStudying.js), same controls
 * (open / quick-add a record / dismiss) plus the skip pair, and the same
 * colour story:
 *   · a study item's line is its PROGRESS FILL — colour reads the stage
 *     (grey → red → amber → green → brand-complete), width the amount;
 *   · a battle's line is a LIVE INDICATOR — pulsing red while the battle
 *     runs, steady brand while it waits in the lobby. Battles don't queue,
 *     so the skip controls hide while a battle is parked.
 *
 * Responsive (rules in index.css): shown ONLY on tablet (769–1024px),
 * where it replaces the sidebar's NowStudyingSidebarCard; mobile (≤768px)
 * keeps its own bar above the bottom nav and desktop (>1024px) keeps the
 * sidebar card. While it shows, the sidebar and the content column stop
 * above it (.ak-has-nowbar height rules) so nothing scrolls underneath.
 */
import { BRAND, RED } from '../../constants.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { progressStage } from '../../utils/nowStudying.js';
import { Icon } from '../common/Icons.jsx';

const FONT = "'Nunito', sans-serif";

export default function NowStudyingTabletBar({ item, onOpen, onAdd, onDismiss, onPrev, onNext, canSkip }) {
  const { t } = useLang();
  if (!item) return null;
  const isBattle   = item.type === 'battle';
  const battleLive = isBattle && item.snapshot?.status === 'live';
  const stage      = isBattle ? null : progressStage(item.progress);
  const dotColor   = isBattle ? (battleLive ? RED : BRAND) : stage.color;
  const livePulse  = { animation: 'ak-tabnow-pulse 1.6s ease-in-out infinite' };
  const pct        = Math.max(0, Math.min(100, item.progress || 0));
  const skipBtn    = (dir) => (
    <button onClick={dir < 0 ? onPrev : onNext} disabled={!canSkip}
      title={dir < 0 ? t('now.prev') : t('now.next')} aria-label={dir < 0 ? t('now.prev') : t('now.next')}
      style={{
        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
        background: 'transparent', border: 'none',
        cursor: canSkip ? 'pointer' : 'default', opacity: canSkip ? .85 : .28,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <Icon name={dir < 0 ? 'ti-player-skip-back' : 'ti-player-skip-forward'} size={17} color="var(--ak-text-sub)"/>
    </button>
  );

  return (
    <div className="ak-tabnow" style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 'var(--z-bar)',
      background: 'var(--ak-surface)', borderTop: '1px solid var(--ak-border)',
      boxShadow: '0 -4px 18px rgba(0,0,0,.10)', fontFamily: FONT,
      height: 'var(--ak-tabnow-h, 78px)',
      animation: 'ak-tabnow-in .28s ease-out',
    }}>
      <style>{`
        @keyframes ak-tabnow-in{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes ak-tabnow-pulse{0%,100%{opacity:1}50%{opacity:.35}}
      `}</style>

      {/* Single row, three sections — meta | player | tools */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr) minmax(0,1fr)',
        alignItems: 'center', gap: 16, padding: '0 18px', height: '100%',
      }}>

        {/* 1 — Name & details: art tile + title + source line. The whole
            column opens the item, like tapping the track in a player. */}
        <div className="ak-tabnow-meta" onClick={onOpen} title={item.title}
          style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, cursor: 'pointer' }}>
          <div style={{
            width: 46, height: 46, borderRadius: 'var(--r-md, 12px)', flexShrink: 0,
            background: battleLive ? `${RED}14` : `${BRAND}14`,
            border: `1px solid ${battleLive ? `${RED}2e` : `${BRAND}2e`}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
          }}>
            {item.emoji?.startsWith('ti-') ? <Icon name={item.emoji} size={22}/> : item.emoji ? <span>{item.emoji}</span> : <Icon name="ti-book" size={22}/>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize: 13, fontWeight: 900, color: 'var(--ak-text)', margin: 0, lineHeight: 1.3,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
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

        {/* 2 — Progress tracking + previous / next: the scrubber row.
            Study items: prev / play / next over a stage-coloured progress
            fill flanked by the % and the stage label. Battles: play over a
            live indicator (skips hidden — battles don't queue). */}
        <div className="ak-tabnow-center" style={{ minWidth: 0, padding: '0 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 7 }}>
            {!isBattle && onPrev && skipBtn(-1)}
            <button onClick={onOpen} title={isBattle ? t('now.resume_battle') : t('now.resume')}
              aria-label={isBattle ? t('now.resume_battle') : t('now.resume')}
              style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0, border: 'none', cursor: 'pointer',
                background: `linear-gradient(135deg,${BRAND},#4C1DCC)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 2px 12px ${BRAND}44`,
              }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="#fff"><path d="M7 4.5v15a1 1 0 001.54.84l11.2-7.5a1 1 0 000-1.68L8.54 3.66A1 1 0 007 4.5z"/></svg>
            </button>
            {!isBattle && onNext && skipBtn(1)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {isBattle ? (
              <>
                <span style={{
                  fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
                  color: battleLive ? RED : 'var(--ak-text-muted)',
                  ...(!battleLive ? { animation: 'none' } : livePulse),
                }}>{battleLive ? t('now.battle_live') : t('now.battle_lobby')}</span>
                <div title={battleLive ? t('now.battle_live') : t('now.battle_lobby')}
                  style={{
                    flex: 1, height: 4, borderRadius: 99,
                    background: battleLive ? RED : `${BRAND}66`,
                    ...(!battleLive ? { animation: 'none' } : livePulse),
                  }}/>
              </>
            ) : (
              <>
                <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{Math.round(pct)}%</span>
                <div style={{ flex: 1, height: 4, background: 'var(--ak-tag-bg)', borderRadius: 99, overflow: 'hidden' }}>
                  <div title={`${Math.round(pct)}% · ${stage.label}`} style={{
                    height: '100%', width: `${pct}%`, background: stage.color, borderRadius: 99,
                    transition: 'width .4s ease, background .3s',
                  }}/>
                </div>
                <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-muted)', whiteSpace: 'nowrap' }}>{stage.label}</span>
              </>
            )}
          </div>
        </div>

        {/* 3 — Tool icons: open the material (book / swords), quick-add a
            record (study items only), dismiss the parked item. */}
        <div className="ak-tabnow-tools" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onOpen} title={isBattle ? t('now.resume_battle') : t('now.resume')}
            aria-label={isBattle ? t('now.resume_battle') : t('now.resume')}
            style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
              background: 'var(--ak-surface-hover)', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <Icon name={isBattle ? 'ti-swords' : 'ti-book'} size={17} color={BRAND}/>
          </button>
          {!isBattle && (
            <button onClick={onAdd} title={t('records.title')} aria-label={t('records.title')}
              style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
                background: 'transparent', border: '1.5px solid var(--ak-border2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-sub)" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            </button>
          )}
          <button onClick={onDismiss} title={t('now.dismiss')} aria-label={t('now.dismiss')}
            style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
              background: 'transparent', border: 'none', opacity: .55,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-muted)" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
