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
import { BRAND, RED, GREEN, GOLD } from '../../constants.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import Toast from '../common/Toast.jsx';

const FONT = "'Nunito', sans-serif";

/* Gradient + art per type card. Order matches the product spec:
   Notes/Materials, Courses, Pharm D, Teaching guide, Live classes. */
const TYPES = (t) => ([
  {
    key: 'notes', icon: '📝', accent: GOLD, soon: true,
    grad: 'linear-gradient(140deg,#7C5CE6,#5B3FD1)',
    label: t('dhub.card_notes'), desc: t('dhub.card_notes_desc'),
    kw: 'notes materials library records pdf document upload link paste',
  },
  {
    key: 'courses', icon: '📚', accent: BRAND, soon: false, primary: true,
    grad: 'linear-gradient(140deg,#F28C52,#DE5F26)',
    label: t('dhub.card_courses'), desc: t('dhub.card_courses_desc'),
    kw: 'courses video lessons catalogue study curriculum marketplace',
  },
  {
    key: 'pharmd', icon: '💊', accent: GREEN, soon: true,
    grad: 'linear-gradient(140deg,#14B8A6,#0C7E72)',
    label: t('dhub.card_pharmd'), desc: t('dhub.card_pharmd_desc'),
    kw: 'pharm d pharmacy doctor program clinical pharmacology',
  },
  {
    key: 'guide', icon: '🧑🏽‍🏫', accent: '#8B5CF6', soon: true,
    grad: 'linear-gradient(140deg,#4C8DF0,#2E62D9)',
    label: t('dhub.card_guide'), desc: t('dhub.card_guide_desc'),
    kw: 'teaching guide teacher agents tutors trained',
  },
  {
    key: 'live', icon: '📡', accent: RED, soon: true,
    grad: 'linear-gradient(140deg,#EF4E78,#C92A54)',
    label: t('dhub.card_live'), desc: t('dhub.card_live_desc'),
    kw: 'live classes real time tutors stream broadcast',
  },
]);

export default function DiscoverHub({ onOpenCourses, initialQuery = '' }) {
  const { t } = useLang();
  const [query, setQuery] = useState(initialQuery);
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
                {ty.icon}
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
