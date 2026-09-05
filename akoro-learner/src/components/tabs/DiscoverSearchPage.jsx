/**
 * DiscoverSearchPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Full-screen search page for the higher-ed Discover hub — opened
 * from the hub's search box. Music-app search-screen energy, but on
 * our chrome (--ak tokens, Nunito, rounded rows):
 *
 *   • Back button + autofocused input pinned to the top bar
 *   • Blank query → Recent searches (localStorage-backed: tap a row
 *     to re-run it, ✕ removes one, "Clear all" wipes the list)
 *   • Typed query → live results over the five discovery types
 *     (same matcher as the hub grid), each row wearing its tile's
 *     gradient chip; Enter takes the first result
 *
 * Picking a result records the query in recent searches and hands
 * the card back to the hub via onPick (courses → catalogue, the
 * rest → coming-soon toast) — the page itself never navigates.
 *
 * SSR-safe: every localStorage touch is guarded, all event wiring
 * lives in handlers/effects, so `renderToString` works in the
 * check script (scripts/check-dhub-search.mjs).
 */
import { useEffect, useState } from 'react';
import { BRAND } from '../../constants.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { TYPES, matchTypes, FONT } from './dhubTypes.js';

export const RECENTS_KEY = 'akoro.dhubRecents';
export const MAX_RECENTS = 8;

/* Most-recent-first, de-duped case-insensitively, trimmed, capped.
   Pure — unit-checked directly by the check script. */
export function pushRecent(list, query) {
  const v = (query || '').trim();
  if (!v) return list;
  const rest = list.filter((r) => r.toLowerCase() !== v.toLowerCase());
  return [v, ...rest].slice(0, MAX_RECENTS);
}

function loadRecents() {
  try {
    const raw = globalThis.localStorage?.getItem(RECENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch { return []; }
}

function persistRecents(list) {
  try { globalThis.localStorage?.setItem(RECENTS_KEY, JSON.stringify(list)); }
  catch { /* private mode / quota — recents degrade silently */ }
}

const ChevronRight = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
);

export default function DiscoverSearchPage({ initialQuery = '', onClose, onPick }) {
  const { t } = useLang();
  const [query, setQuery] = useState(initialQuery);
  const [recents, setRecents] = useState(loadRecents);

  const all = TYPES(t);
  const q = query.trim();
  const visible = matchTypes(t, query);

  /* Enter = the first thing the results list is showing (Courses leads
     when the query matches nothing in particular, so a content search
     lands in the catalogue rather than nowhere) — same rule as the hub. */
  const pick = (ty) => {
    const next = pushRecent(recents, q || ty.label);
    setRecents(next); persistRecents(next);
    onPick?.(ty, q);
  };
  const onEnter = () => pick(visible[0] || all[1]);

  const removeRecent = (r) => {
    const next = recents.filter((x) => x !== r);
    setRecents(next); persistRecents(next);
  };
  const clearRecents = () => { setRecents([]); persistRecents([]); };

  /* Esc closes, like the back button. */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={t('dhub.search_aria')}
      style={{ position: 'fixed', inset: '0', zIndex: 1500, background: 'var(--ak-bg, #fff)',
        fontFamily: FONT, display: 'flex', flexDirection: 'column' }}>

      {/* Top bar — back + input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 10px',
        borderBottom: '1px solid var(--ak-border3)' }}>
        <button onClick={onClose} aria-label={t('dhub.close_search')}
          style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', flexShrink: 0,
            background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 17, fontWeight: 900,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
          ←
        </button>
        <div style={{ position: 'relative', flex: 1 }}>
          <span aria-hidden="true" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .5, pointerEvents: 'none' }}>🔍</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
            placeholder={t('dhub.search_ph')}
            aria-label={t('dhub.search_aria')}
            style={{ width: '100%', boxSizing: 'border-box', padding: '12px 38px 12px 36px', borderRadius: 14,
              border: '1px solid var(--ak-border3)', background: 'var(--ak-surface)', fontSize: 13.5,
              fontWeight: 600, color: 'var(--ak-text)', fontFamily: FONT, outline: 'none' }}
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label={t('dhub.clear')}
              style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22,
                borderRadius: '50%', border: 'none', background: 'var(--ak-tag-bg, #F3F4F6)',
                color: 'var(--ak-text-sec, #6B7280)', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>✕</button>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 90px' }}>
        {!q ? (
          <>
            {/* Blank query → recent searches (or the start-typing hint) */}
            {recents.length > 0 ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 2px 6px' }}>
                  <p style={{ fontSize: 12, fontWeight: 900, color: 'var(--ak-text-sub)', margin: 0,
                    textTransform: 'uppercase', letterSpacing: .5 }}>{t('dhub.recent')}</p>
                  <button onClick={clearRecents}
                    style={{ border: 'none', background: 'none', color: BRAND, fontSize: 12, fontWeight: 800,
                      cursor: 'pointer', fontFamily: FONT, padding: 0 }}>
                    {t('dhub.clear_all')}
                  </button>
                </div>
                <style>{`.dhub-recent:active{transform:scale(.98)}`}</style>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recents.map((r) => (
                    <div key={r} className="dhub-recent" onClick={() => setQuery(r)} role="button"
                      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 14,
                        background: 'var(--ak-surface)', border: '1px solid var(--ak-border3)', cursor: 'pointer',
                        transition: 'transform .12s ease' }}>
                      <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 10, flexShrink: 0,
                        background: 'var(--ak-tag-bg, #F3F4F6)', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 14 }}>🕑</span>
                      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: 'var(--ak-text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</span>
                      <button onClick={(e) => { e.stopPropagation(); removeRecent(r); }}
                        aria-label={`${t('dhub.remove')} "${r}"`}
                        style={{ width: 24, height: 24, borderRadius: '50%', border: 'none', flexShrink: 0,
                          background: 'var(--ak-tag-bg, #F3F4F6)', color: 'var(--ak-text-sec, #6B7280)',
                          fontSize: 10.5, fontWeight: 900, cursor: 'pointer' }}>✕</button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ padding: '46px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>🔍</div>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ak-text-sec, #6B7280)', margin: 0,
                  lineHeight: 1.5 }}>{t('dhub.recent_empty')}</p>
              </div>
            )}
          </>
        ) : visible.length > 0 ? (
          <>
            {/* Typed query → live results over the discovery types */}
            <p style={{ fontSize: 12, fontWeight: 900, color: 'var(--ak-text-sub)', margin: '10px 2px 6px',
              textTransform: 'uppercase', letterSpacing: .5 }}>{t('dhub.results')}</p>
            <style>{`.dhub-result:active{transform:scale(.98)}`}</style>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {visible.map((ty) => (
                <div key={ty.key} className="dhub-result" onClick={() => pick(ty)} role="button" aria-label={ty.label}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 14,
                    background: 'var(--ak-surface)', border: '1px solid var(--ak-border3)', cursor: 'pointer',
                    transition: 'transform .12s ease' }}>
                  <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                    background: ty.grad, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, boxShadow: '0 3px 9px rgba(15,23,42,.18)' }}>{ty.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)', margin: 0, lineHeight: 1.2 }}>{ty.label}</p>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ak-text-sub)', margin: '2px 0 0',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ty.desc}</p>
                  </span>
                  {ty.soon && (
                    <span style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: .4, padding: '3px 8px',
                      borderRadius: 99, background: 'var(--ak-tag-bg, #F3F4F6)', color: 'var(--ak-text-sec, #6B7280)',
                      textTransform: 'uppercase', flexShrink: 0 }}>{t('dhub.soon')}</span>
                  )}
                  <span aria-hidden="true" style={{ color: 'var(--ak-text-sec, #6B7280)', flexShrink: 0 }}><ChevronRight /></span>
                </div>
              ))}
            </div>
          </>
        ) : (
          /* No match — same message + clear action as the hub grid */
          <div style={{ margin: '10px 0 0', padding: '26px 18px', borderRadius: 16,
            border: '1px dashed var(--ak-border2)', textAlign: 'center', background: 'var(--ak-surface)' }}>
            <div style={{ fontSize: 26, marginBottom: 6 }}>🔍</div>
            <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sec, #6B7280)', margin: 0 }}>{t('dhub.no_match')}</p>
            <button onClick={() => setQuery('')}
              style={{ marginTop: 10, padding: '7px 16px', borderRadius: 99, border: 'none', background: BRAND,
                color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
              {t('dhub.clear')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
