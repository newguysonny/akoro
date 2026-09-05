/**
 * DiscoverHub.jsx
 * ─────────────────────────────────────────────────────────────
 * Higher-ed learners' Discover landing: a search box plus a grid of
 * discovery-type cards. The hub is a router, not a feed — only the
 * Courses card opens the course catalogue (DiscoveryTab); every other
 * type — Notes/Materials, Pharm D, Teaching guide AND Live classes —
 * answers "coming soon" until its own destination ships. (The hub's
 * Live classes is its own product, deliberately NOT the Learn tab's
 * live sessions view, which is a different thing.)
 *
 * Gated by isHigherEdUI() in LearnerDashboard — school learners keep
 * the current DiscoveryTab feed directly.
 */
import { useState } from 'react';
import { BRAND, RED, GREEN, GOLD } from '../../constants.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import Toast from '../common/Toast.jsx';

const FONT = "'Nunito', sans-serif";

/* Accent + art per type card. Order matches the product spec:
   Notes/Materials, Courses, Pharm D, Teaching guide, Live classes. */
const TYPES = (t) => ([
  {
    key: 'notes', icon: '📝', accent: GOLD, soon: true,
    label: t('dhub.card_notes'), desc: t('dhub.card_notes_desc'),
    kw: 'notes materials library records pdf document upload link paste',
  },
  {
    key: 'courses', icon: '📚', accent: BRAND, soon: false, primary: true,
    label: t('dhub.card_courses'), desc: t('dhub.card_courses_desc'),
    kw: 'courses video lessons catalogue study curriculum marketplace',
  },
  {
    key: 'pharmd', icon: '💊', accent: GREEN, soon: true,
    label: t('dhub.card_pharmd'), desc: t('dhub.card_pharmd_desc'),
    kw: 'pharm d pharmacy doctor program clinical pharmacology',
  },
  {
    key: 'guide', icon: '🧑🏽‍🏫', accent: '#8B5CF6', soon: true,
    label: t('dhub.card_guide'), desc: t('dhub.card_guide_desc'),
    kw: 'teaching guide teacher agents tutors trained',
  },
  {
    key: 'live', icon: '📡', accent: RED, soon: true,
    label: t('dhub.card_live'), desc: t('dhub.card_live_desc'),
    kw: 'live classes real time tutors stream broadcast',
  },
]);

export default function DiscoverHub({ onOpenCourses }) {
  const { t } = useLang();
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState(null);

  const all = TYPES(t);
  const q = query.trim().toLowerCase();
  const visible = !q ? all : all.filter((ty) =>
    `${ty.label} ${ty.desc} ${ty.kw}`.toLowerCase().includes(q));

  const activate = (ty) => {
    if (ty.key === 'courses') onOpenCourses?.(query.trim());
    else setToast({ msg: `${ty.label} — ${t('dhub.coming_soon')}`, color: GOLD });
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

      {/* Search */}
      <div style={{ padding: '10px 16px 4px' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .5, pointerEvents: 'none' }}>🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
            placeholder={t('dhub.search_ph')}
            style={{ width: '100%', boxSizing: 'border-box', padding: '12px 38px 12px 36px', borderRadius: 14, border: '1px solid var(--ak-border3)', background: 'var(--ak-surface)', fontSize: 13.5, fontWeight: 600, color: 'var(--ak-text)', fontFamily: FONT, outline: 'none' }}
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label={t('dhub.clear')} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'var(--ak-tag-bg, #F3F4F6)', color: 'var(--ak-text-sec, #6B7280)', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>✕</button>
          )}
        </div>
      </div>

      {/* Type cards grid */}
      {visible.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, padding: '10px 16px 0' }}>
          {visible.map((ty) => (
            <div key={ty.key} onClick={() => activate(ty)} role="button" aria-label={ty.label}
              style={{ position: 'relative', cursor: 'pointer', borderRadius: 18, padding: '14px 13px',
                background: 'var(--ak-surface)', border: ty.primary ? `1.5px solid ${BRAND}55` : '1px solid var(--ak-border)',
                boxShadow: ty.primary ? `0 4px 16px ${BRAND}18` : '0 1px 6px rgba(0,0,0,.05)',
                display: 'flex', flexDirection: 'column', gap: 8, minHeight: 128, transition: 'transform .12s' }}>
              {ty.soon && (
                <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 8.5, fontWeight: 900, letterSpacing: .4,
                  padding: '2px 7px', borderRadius: 8, background: `${GOLD}1c`, color: '#B45309', textTransform: 'uppercase' }}>
                  {t('dhub.soon')}
                </span>
              )}
              <div style={{ width: 40, height: 40, borderRadius: 13, background: `${ty.accent}16`, border: `1px solid ${ty.accent}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                {ty.icon}
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)', margin: 0, lineHeight: 1.25 }}>{ty.label}</p>
                <p style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ak-text-muted)', margin: '3px 0 0', lineHeight: 1.4 }}>{ty.desc}</p>
              </div>
              <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 900, color: ty.primary ? BRAND : 'var(--ak-text-muted)' }}>
                {ty.primary ? t('dhub.cta_browse') : t('dhub.cta_soon')}
                <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ margin: '10px 16px 0', padding: '26px 18px', borderRadius: 16, border: '1px dashed var(--ak-border2)',
          textAlign: 'center', background: 'var(--ak-surface)' }}>
          <div style={{ fontSize: 26, marginBottom: 6 }}>🔍</div>
          <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sec, #6B7280)', margin: 0 }}>{t('dhub.no_match')}</p>
          <button onClick={() => setQuery('')} style={{ marginTop: 10, padding: '7px 16px', borderRadius: 99, border: 'none',
            background: BRAND, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
            {t('dhub.clear')}
          </button>
        </div>
      )}

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}
