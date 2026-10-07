/**
 * DiscoverHub.jsx
 * ─────────────────────────────────────────────────────────────
 * Higher-ed learners' Discover landing: a search box plus a grid of
 * discovery-type cards. The hub is a router, not a feed — the
 * Courses card opens the course catalogue (DiscoveryTab), Teaching guide
 * and Live classes open their focused discovery feeds (the same
 * DiscoveryTab UI, one rail), Pharm D asks the shell to open its
 * programme page (PharmDProgram — browse → course folder), and
 * Notes/Materials answers "coming soon" until its own destination ships.
 * (The hub's
 * Live classes is its own product, deliberately NOT the Learn tab's
 * live sessions view, which is a different thing.)
 *
 * Card design: bold 2-col colour-block tiles (music-app browse energy)
 * but distinctly ours — per-type gradient washes rather than flat
 * fills, and a tilted glass "study flashcard" holding the category
 * emoji tucked into the corner (not a rotated album sleeve). The
 * colour blocks are theme-independent by design; all surrounding
 * chrome (header, search, empty state) stays on --ak tokens.
 *
 * Gated by isHigherEdUI() in LearnerDashboard — school learners keep
 * the current DiscoveryTab feed directly.
 */
import { useState } from 'react';
import { BRAND, GOLD } from '../../constants.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { Icon } from '../common/Icons.jsx';
import Toast from '../common/Toast.jsx';
import DiscoverSearchPage from './DiscoverSearchPage.jsx';
import { TYPES, matchTypes, FONT } from './dhubTypes.js';

export default function DiscoverHub({ onOpenCourses, onOpenCourse, onOpenRecord, onOpenBattles, onOpenPharmd, onOpenRail, userId, initialQuery = '' }) {
  const { t } = useLang();
  const [query, setQuery] = useState(initialQuery);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const all = TYPES(t);
  const visible = matchTypes(t, query);

  const activate = (ty, qOverride) => {
    const q = qOverride ?? query.trim();
    if (ty.key === 'courses') onOpenCourses?.(q);
    else if (ty.key === 'pharmd') onOpenPharmd?.();
    // The focused discovery feeds — same courses-feed UI, one rail.
    else if (ty.key === 'guide') onOpenRail?.('guides', q);
    else if (ty.key === 'live') onOpenRail?.('live', q);
    else setToast({ msg: `${ty.label} — ${t('dhub.coming_soon')}`, color: GOLD });
  };

  /* Picked from the full-screen search page: close it, reflect the
     query on the hub behind, then activate the chosen card. */
  const onSearchPick = (ty, q) => {
    setSearchOpen(false);
    setQuery(q);
    activate(ty, q);
  };

  // Enter = the first thing the grid is showing (Courses leads when the
  // query matches nothing in particular, so a content search lands in
  // the catalogue rather than nowhere).
  const onEnter = () => activate(visible[0] || all[1]);

  return (
    <div style={{ padding: '4px 0 90px', fontFamily: FONT }}>
      {/* Header */}
      <div style={{ padding: '12px 16px 2px' }}>
        <h1 style={{ fontSize: 21, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>
          {t('dhub.title')}
        </h1>
        <p style={{ fontSize: 12.5, color: 'var(--ak-text-sub)', margin: '3px 0 0' }}>
          {t('dhub.sub')}
        </p>
      </div>

      {/* Search — opening the box raises the full-screen search page
          (typing, recent searches and live results live there); the hub
          box stays read-only so returning with a query still filters. */}
      <div style={{ padding: '10px 16px 4px' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .5, pointerEvents: 'none' }}><Icon name="ti-search" size={14}/></span>
          <input
            readOnly
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
            onFocus={() => setSearchOpen(true)}
            onClick={() => setSearchOpen(true)}
            placeholder={t('dhub.search_ph')}
            aria-label={t('dhub.search_aria')}
            style={{ width: '100%', boxSizing: 'border-box', padding: '12px 38px 12px 36px', borderRadius: 14, border: '1px solid var(--ak-border3)', background: 'var(--ak-surface)', fontSize: 13.5, fontWeight: 600, color: 'var(--ak-text)', fontFamily: FONT, outline: 'none', cursor: 'pointer' }}
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label={t('dhub.clear')} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'var(--ak-tag-bg, #F3F4F6)', color: 'var(--ak-text-sec, #6B7280)', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}><Icon name="ti-x" size={11}/></button>
          )}
        </div>
      </div>

      {/* Type cards grid — colour-block tiles */}
      {visible.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, padding: '12px 16px 0' }}>
          <style>{`.dhub-card{transition:transform .15s ease,box-shadow .15s ease}.dhub-card:hover{transform:translateY(-2px)}.dhub-card:active{transform:scale(.97)}`}</style>
          {visible.map((ty) => (
            <div key={ty.key} onClick={() => activate(ty)} role="button" aria-label={ty.label} className="dhub-card"
              style={{ position: 'relative', cursor: 'pointer', borderRadius: 20, padding: '13px 14px',
                background: ty.grad, color: '#fff', overflow: 'hidden', minHeight: 122,
                boxShadow: ty.primary ? '0 6px 18px rgba(222,95,38,.32)' : '0 4px 14px rgba(15,23,42,.16)',
                display: 'flex', flexDirection: 'column' }}>
              {/* Depth arc */}
              <span aria-hidden="true" style={{ position: 'absolute', right: -26, bottom: -32, width: 112, height: 112,
                borderRadius: '50%', border: '1.5px solid rgba(255,255,255,.16)', pointerEvents: 'none' }} />
              {/* Tilted glass study-tile — our take on the corner art */}
              <span aria-hidden="true" style={{ position: 'absolute', right: -9, bottom: -11, width: 60, height: 60,
                borderRadius: 16, transform: 'rotate(-14deg)',
                background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.35)',
                boxShadow: '0 6px 14px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, pointerEvents: 'none' }}>
                {ty.icon?.startsWith('ti-') ? <Icon name={ty.icon} size={28}/> : ty.icon}
              </span>
              {ty.soon && (
                <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 8.5, fontWeight: 900, letterSpacing: .4,
                  padding: '3px 8px', borderRadius: 99, background: 'rgba(0,0,0,.28)', color: 'rgba(255,255,255,.92)',
                  textTransform: 'uppercase' }}>
                  {t('dhub.soon')}
                </span>
              )}
              <p style={{ fontSize: 14.5, fontWeight: 900, margin: 0, lineHeight: 1.2, maxWidth: '76%',
                textShadow: '0 1px 2px rgba(0,0,0,.12)' }}>{ty.label}</p>
              <p style={{ fontSize: 10.5, fontWeight: 700, margin: '4px 0 0', lineHeight: 1.35,
                color: 'rgba(255,255,255,.78)', maxWidth: '82%' }}>{ty.desc}</p>
              {ty.primary && (
                <span style={{ marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10,
                  fontWeight: 900, padding: '4px 10px', borderRadius: 99, background: 'rgba(255,255,255,.22)',
                  color: '#fff', alignSelf: 'flex-start' }}>
                  {t('dhub.cta_browse')}
                  <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ margin: '10px 16px 0', padding: '26px 18px', borderRadius: 16, border: '1px dashed var(--ak-border2)',
          textAlign: 'center', background: 'var(--ak-surface)' }}>
          <div style={{ marginBottom: 6 }}><Icon name="ti-search" size={26} color="var(--ak-text-sec, #6B7280)"/></div>
          <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sec, #6B7280)', margin: 0 }}>{t('dhub.no_match')}</p>
          <button onClick={() => setQuery('')} style={{ marginTop: 10, padding: '7px 16px', borderRadius: 99, border: 'none',
            background: BRAND, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
            {t('dhub.clear')}
          </button>
        </div>
      )}

      {searchOpen && (
        <DiscoverSearchPage
          initialQuery={query}
          userId={userId}
          onClose={() => setSearchOpen(false)}
          onPick={onSearchPick}
          onOpenCourse={onOpenCourse}
          onOpenRecord={onOpenRecord}
          onOpenBattles={onOpenBattles}
        />
      )}

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}
