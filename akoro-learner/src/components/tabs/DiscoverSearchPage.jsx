/**
 * DiscoverSearchPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Full-screen search page for the higher-ed Discover hub — opened
 * from the hub's search box. Music-app search-screen energy, on our
 * chrome (--ak tokens, Nunito, rounded rows):
 *
 *   • Back button + autofocused input pinned to the top bar — Esc
 *     closes, and body scroll is locked while the page is open
 *   • Blank query → Recent searches, SCOPE-TAGGED: each row wears the
 *     gradient tile + label of the section it jumped to ("Courses",
 *     "Pharm D", …) or a 🔍 "Search" chip for generic catalogue
 *     hand-offs. Tap a row to re-run it, ✕ removes one, "Clear all"
 *     wipes the list. No recents → friendly "No recent searches yet.
 *     Try:" with example chips (deliberately distinct from the
 *     no-match empty state).
 *   • Typed query → LIVE COURSE RESULTS first: real published courses
 *     from /api/courses/published?type=live|video — the catalogue's
 *     own endpoints, fetched once per page-open then filtered per
 *     keystroke (identical data, fewer requests than a per-keystroke
 *     debounce) — then the matching discovery-type cards below.
 *     Tapping a course opens it (/course/:slug via onOpenCourse);
 *     Enter takes whatever sits at the top of the screen.
 *
 * The page itself never navigates: section picks go up via onPick,
 * course picks via onOpenCourse. SSR-safe (guarded storage, network
 * and effects only), so scripts/check-dhub-search.mjs can render it.
 */
import { useEffect, useState } from 'react';
import { BRAND } from '../../constants.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { Icon } from '../common/Icons.jsx';
import { apiGet } from '../../services/api.js';
import { TYPES, matchTypes, FONT } from './dhubTypes.js';

export const RECENTS_KEY = 'akoro.dhubRecents';
export const MAX_RECENTS = 8;

/* Most-recent-first, de-duped case-insensitively by query text, capped.
   Entries are { q, scope } — scope is a discovery-type key for section
   jumps, 'search' for generic catalogue hand-offs. Legacy recents were
   bare strings: they load back in as scope 'search' (see loadRecents).
   Pure — unit-checked directly by the check script. */
export function pushRecent(list, query, scope = 'search') {
  const v = (query || '').trim();
  if (!v) return list;
  const entry = { q: v, scope };
  const rest = list.filter((r) => (typeof r === 'string' ? r : r.q).toLowerCase() !== v.toLowerCase());
  return [entry, ...rest.map((r) => (typeof r === 'string' ? { q: r, scope: 'search' } : r))].slice(0, MAX_RECENTS);
}

/* Client-side matcher for live course results — same fields the
   catalogue filters on (title + subject), plus teacher name. */
export function matchCourse(course, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return false;
  return `${course.title || ''} ${course.subject || ''} ${course.instructor_name || course.teacher_name || ''}`
    .toLowerCase().includes(q);
}

function loadRecents() {
  try {
    const raw = globalThis.localStorage?.getItem(RECENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => typeof x === 'string' || (x && typeof x.q === 'string'))
      .map((x) => (typeof x === 'string' ? { q: x, scope: 'search' } : { q: x.q, scope: typeof x.scope === 'string' ? x.scope : 'search' }));
  } catch { return []; }
}

function persistRecents(list) {
  try { globalThis.localStorage?.setItem(RECENTS_KEY, JSON.stringify(list)); }
  catch { /* private mode / quota — recents degrade silently */ }
}

const ChevronRight = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
);

export default function DiscoverSearchPage({ initialQuery = '', onClose, onPick, onOpenCourse, initialCourses = [] }) {
  const { t } = useLang();
  const [query, setQuery] = useState(initialQuery);
  const [recents, setRecents] = useState(loadRecents);
  const [courses, setCourses] = useState(initialCourses);

  const all = TYPES(t);
  const q = query.trim();
  const visible = matchTypes(t, query);
  const courseRows = q ? courses.filter((c) => matchCourse(c, q)).slice(0, 5) : [];

  /* Live course catalogue — the catalogue's own endpoints, fetched once
     per page-open and then filtered per keystroke client-side (the same
     shape the catalogue itself uses: prefetch + local filter). */
  useEffect(() => {
    let alive = true;
    Promise.all([
      apiGet('/api/courses/published?type=live&limit=40').catch(() => null),
      apiGet('/api/courses/published?type=video&limit=40').catch(() => null),
    ]).then(([live, video]) => {
      const rows = [
        ...(live?.courses || []).map((c) => ({ ...c, _kind: 'live' })),
        ...(video?.courses || []).map((c) => ({ ...c, _kind: 'video' })),
      ];
      if (alive && rows.length) setCourses(rows);
    });
    return () => { alive = false; };
  }, []);

  /* Esc closes, like the back button; body scroll locked while open. */
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const record = (text, scope) => {
    const next = pushRecent(recents, text, scope);
    setRecents(next); persistRecents(next);
  };

  /* Tapping a section row: jump straight there, tagged to that section. */
  const pickType = (ty) => {
    record(q || ty.label, ty.key);
    onPick?.(ty, q);
  };

  /* Tapping a live course row: record + open the course itself. */
  const pickCourse = (c) => {
    record(q || c.title, 'courses');
    if (onOpenCourse && c.slug) onOpenCourse(c);
    else onPick?.(all[1], q || c.title);   // no deep-link handler → catalogue hand-off
  };

  /* Enter = the first thing on screen: top live course when there is
     one, else the first matching section, else a generic catalogue
     hand-off (the 🔍 "Search" scope). */
  const onEnter = () => {
    if (!q) return;
    if (courseRows.length) return pickCourse(courseRows[0]);
    if (visible.length) return pickType(visible[0]);
    record(q, 'search');
    onPick?.(all[1], q);
  };

  const removeRecent = (rq) => {
    const next = recents.filter((x) => x.q !== rq);
    setRecents(next); persistRecents(next);
  };
  const clearRecents = () => { setRecents([]); persistRecents([]); };

  /* The gradient tile + label a recent jumped to — 🔍 Search for
     generic hand-offs. */
  const scopeMeta = (scope) => {
    const ty = all.find((x) => x.key === scope);
    return ty
      ? { icon: ty.icon, chipBg: ty.grad, label: ty.label }
      : { icon: 'ti-search', chipBg: 'var(--ak-tag-bg, #F3F4F6)', label: t('dhub.scope_search') };
  };

  const sectionHeader = { fontSize: 12, fontWeight: 900, color: 'var(--ak-text-sub)',
    margin: '10px 2px 6px', textTransform: 'uppercase', letterSpacing: .5 };

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
          <span aria-hidden="true" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .5, pointerEvents: 'none' }}><Icon name="ti-search" size={14}/></span>
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
                color: 'var(--ak-text-sec, #6B7280)', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}><Icon name="ti-x" size={11}/></button>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 90px' }}>
        {!q ? (
          <>
            {/* Blank query → scope-tagged recent searches… */}
            {recents.length > 0 ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 2px 6px' }}>
                  <p style={{ ...sectionHeader, margin: 0, padding: 0 }}>{t('dhub.recent')}</p>
                  <button onClick={clearRecents}
                    style={{ border: 'none', background: 'none', color: BRAND, fontSize: 12, fontWeight: 800,
                      cursor: 'pointer', fontFamily: FONT, padding: 0 }}>
                    {t('dhub.clear_all')}
                  </button>
                </div>
                <style>{`.dhub-recent:active{transform:scale(.98)}`}</style>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recents.map((r) => {
                    const meta = scopeMeta(r.scope);
                    return (
                      <div key={r.q} className="dhub-recent" onClick={() => setQuery(r.q)} role="button"
                        style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 14,
                          background: 'var(--ak-surface)', border: '1px solid var(--ak-border3)', cursor: 'pointer',
                          transition: 'transform .12s ease' }}>
                        <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 10, flexShrink: 0,
                          background: meta.chipBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 14, boxShadow: '0 3px 8px rgba(15,23,42,.16)' }}>{meta.icon?.startsWith('ti-') ? <Icon name={meta.icon} size={14}/> : meta.icon}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', margin: 0,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.q}</p>
                          <p style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-sub)', margin: '1px 0 0',
                            textTransform: 'uppercase', letterSpacing: .4 }}>{meta.label}</p>
                        </span>
                        <button onClick={(e) => { e.stopPropagation(); removeRecent(r.q); }}
                          aria-label={`${t('dhub.remove')} "${r.q}"`}
                          style={{ width: 24, height: 24, borderRadius: '50%', border: 'none', flexShrink: 0,
                            background: 'var(--ak-tag-bg, #F3F4F6)', color: 'var(--ak-text-sec, #6B7280)',
                            fontSize: 10.5, fontWeight: 900, cursor: 'pointer' }}><Icon name="ti-x" size={10}/></button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              /* …or, with nothing searched yet, the friendly empty state
                 (distinct from the no-match message) with example chips */
              <div style={{ padding: '44px 18px', textAlign: 'center' }}>
                <div style={{ marginBottom: 8 }}><Icon name="ti-search" size={30} color="var(--ak-text-sec, #6B7280)"/></div>
                <p style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', margin: 0 }}>
                  {t('dhub.recent_none')}
                </p>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)', margin: '10px 0 8px' }}>
                  {t('dhub.try')}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                  {[all[1], all[2], all[0]].map((ty) => (
                    <button key={ty.key} onClick={() => setQuery(ty.label)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px',
                        borderRadius: 99, border: '1px solid var(--ak-border3)', background: 'var(--ak-surface)',
                        fontSize: 12, fontWeight: 800, color: 'var(--ak-text)', cursor: 'pointer', fontFamily: FONT }}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: ty.grad }} />
                      {ty.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : visible.length > 0 || courseRows.length > 0 ? (
          <>
            {/* Typed query → LIVE course results first… */}
            {courseRows.length > 0 && (
              <>
                <p style={sectionHeader}>{t('dhub.course_results')}</p>
                <style>{`.dhub-course:active{transform:scale(.98)}`}</style>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
                  {courseRows.map((c) => (
                    <div key={`${c._kind || 'course'}-${c.id || c.slug || c.title}`} className="dhub-course"
                      onClick={() => pickCourse(c)} role="button" aria-label={c.title}
                      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 14,
                        background: 'var(--ak-surface)', border: '1px solid var(--ak-border3)', cursor: 'pointer',
                        transition: 'transform .12s ease' }}>
                      <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                        overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, background: c._kind === 'live'
                          ? 'linear-gradient(140deg,#EF4E78,#C92A54)'
                          : 'linear-gradient(140deg,#F28C52,#DE5F26)',
                        boxShadow: '0 3px 9px rgba(15,23,42,.18)' }}>
                        {c.cover_image_url
                          ? <img src={c.cover_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <Icon name={c._kind === 'live' ? 'ti-broadcast' : 'ti-book'} size={18} color="#fff"/>}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', margin: 0, lineHeight: 1.2,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</p>
                        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ak-text-sub)', margin: '2px 0 0',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.subject || ''}{c.price ? ` · ${c.price}` : ''}
                        </p>
                      </span>
                      <span aria-hidden="true" style={{ color: 'var(--ak-text-sec, #6B7280)', flexShrink: 0 }}><ChevronRight /></span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* …then the matching discovery-type cards */}
            {visible.length > 0 && (
              <>
                <p style={sectionHeader}>{t('dhub.results')}</p>
                <style>{`.dhub-result:active{transform:scale(.98)}`}</style>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {visible.map((ty) => (
                    <div key={ty.key} className="dhub-result" onClick={() => pickType(ty)} role="button" aria-label={ty.label}
                      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 14,
                        background: 'var(--ak-surface)', border: '1px solid var(--ak-border3)', cursor: 'pointer',
                        transition: 'transform .12s ease' }}>
                      <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                        background: ty.grad, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16, boxShadow: '0 3px 9px rgba(15,23,42,.18)' }}>{ty.icon?.startsWith('ti-') ? <Icon name={ty.icon} size={16}/> : ty.icon}</span>
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
            )}
          </>
        ) : (
          /* Genuinely nothing — no courses, no sections */
          <div style={{ margin: '10px 0 0', padding: '26px 18px', borderRadius: 16,
            border: '1px dashed var(--ak-border2)', textAlign: 'center', background: 'var(--ak-surface)' }}>
            <div style={{ marginBottom: 6 }}><Icon name="ti-search" size={26} color="var(--ak-text-sec, #6B7280)"/></div>
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
