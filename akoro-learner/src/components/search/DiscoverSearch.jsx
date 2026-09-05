import { useState, useEffect, useRef } from 'react';
import { apiGet } from '../../services/api.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import Toast from '../common/Toast.jsx';
import { dhubTypes } from './dhubArt.js';
import { loadRecents, saveRecent, removeRecent, clearRecents } from './dhubRecents.js';

import { BRAND, GOLD } from '../../constants.js';

const FONT = "'Nunito', sans-serif";

/* Small gradient tile used by every row (recents, sections, results). */
function ArtTile({ art, icon, size = 46 }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 13, flexShrink: 0,
      background: art.grad, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.44, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.25), 0 2px 6px rgba(15,23,42,.14)' }}>
      {icon}
    </span>
  );
}

/* ── DiscoverSearch ── */
export default function DiscoverSearch({ onClose, onOpenCourses, initialQuery = '' }) {
  const { t } = useLang();
  const [query, setQuery] = useState(initialQuery);
  const [recents, setRecents] = useState(loadRecents);
  const [courses, setCourses] = useState([]);
  const [toast, setToast] = useState(null);
  const inputRef = useRef(null);
  const aliveRef = useRef(true);

  useEffect(() => () => { aliveRef.current = false; }, []);

  // Autofocus + Escape-to-close + scroll lock, browser only.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prevOverflow = document.body?.style?.overflow;
    if (document.body?.style) document.body.style.overflow = 'hidden';
    inputRef.current?.focus?.();
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.body?.style) document.body.style.overflow = prevOverflow || '';
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live course results (same endpoints the catalogue uses). Debounced,
  // fail-silent: offline it just shows the jump list.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) { setCourses([]); return; }
    const id = setTimeout(() => {
      Promise.all([
        apiGet('/api/courses/published?type=live&limit=40').catch(() => ({ courses: [] })),
        apiGet('/api/courses/published?type=video&limit=40').catch(() => ({ courses: [] })),
      ]).then(([lv, vd]) => {
        if (!aliveRef.current) return;
        const pool = [...(lv.courses || []), ...(vd.courses || [])];
        const hits = pool.filter(c => `${c.title || ''} ${c.subject || ''}`.toLowerCase().includes(q)).slice(0, 4);
        setCourses(hits);
      }).catch(() => { if (aliveRef.current) setCourses([]); });
    }, 350);
    return () => clearTimeout(id);
  }, [query]);

  const q = query.trim().toLowerCase();
  const sections = dhubTypes(t);
  const jumpHits = !q ? [] : sections.filter(s =>
    `${s.label} ${s.desc} ${s.kw}`.toLowerCase().includes(q));

  const handOff = (scope) => {
    if (q) { saveRecent(q, scope); setRecents(loadRecents()); }
    onClose?.();
    onOpenCourses?.(query.trim());
  };
  const soon = (label) => setToast({ msg: `${label} — ${t('dhub.coming_soon')}`, color: GOLD });

  const activateSection = (s) => {
    if (s.key === 'courses') handOff('courses');
    else { soon(s.label); if (q) { saveRecent(q, s.key); setRecents(loadRecents()); } }
  };
  const rerun = (r) => { setQuery(r.q); };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2400, background: 'var(--ak-bg)',
      display: 'flex', flexDirection: 'column', fontFamily: FONT, animation: 'dhubSearchUp .25s cubic-bezier(.32,1,.64,1)' }}>
      <style>{`@keyframes dhubSearchUp{from{transform:translateY(24px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>

      {/* Header: back arrow + input, mirrors the hub's pill so it feels like the same box, opened */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px 10px' }}>
        <button onClick={onClose} aria-label={t('dhub.search_back')} title={t('dhub.search_back')}
          style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
            background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .5, pointerEvents: 'none' }}>🔍</span>
          <input ref={inputRef} value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && jumpHits.length >= 0 && q) handOff('all'); }}
            placeholder={t('dhub.search_ph')}
            style={{ width: '100%', boxSizing: 'border-box', padding: '11px 38px', borderRadius: 999,
              border: '1px solid var(--ak-border3)', background: 'var(--ak-surface)', fontSize: 13.5,
              fontWeight: 600, color: 'var(--ak-text)', fontFamily: FONT, outline: 'none' }} />
          {query && (
            <button onClick={() => setQuery('')} aria-label={t('dhub.clear')}
              style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22,
                borderRadius: '50%', border: 'none', background: 'var(--ak-tag-bg, #F3F4F6)', color: 'var(--ak-text-sec, #6B7280)',
                fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>✕</button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 16px 90px' }}>
        {/* ── Empty query → Recent searches ── */}
        {!q && (recents.length ? (
          <>
            <h2 style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', margin: '12px 0 2px' }}>
              {t('dhub.search_recent')}
            </h2>
            {recents.map((r) => {
              const art = DHUB_ART[r.scope] || DHUB_ART.notes;
              const scopeLabel = r.scope === 'all' ? t('dhub.search_all_scope')
                : (sections.find(s => s.key === r.scope)?.label || t('dhub.search_all_scope'));
              return (
                <div key={`${r.scope}:${r.q}`} onClick={() => rerun(r)} role="button"
                  aria-label={`${t('dhub.search_recent')}: ${r.q}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0',
                    borderBottom: '1px solid var(--ak-border)', cursor: 'pointer' }}>
                  <ArtTile art={art} icon={r.scope === 'all' ? '🔍' : art.icon} size={44} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.q}</span>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 2 }}>{scopeLabel}</span>
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); removeRecent(r.q, r.scope); setRecents(loadRecents()); }}
                    aria-label={t('dhub.search_remove')} title={t('dhub.search_remove')}
                    style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', flexShrink: 0, cursor: 'pointer',
                      background: 'var(--ak-tag-bg, #F3F4F6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-muted)" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              );
            })}
            <button onClick={() => { clearRecents(); setRecents([]); }}
              style={{ marginTop: 14, padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
                border: '1.5px solid var(--ak-border2)', background: 'transparent', color: 'var(--ak-text-sub)',
                fontSize: 12, fontWeight: 800, fontFamily: FONT }}>
              {t('dhub.search_clear_all')}
            </button>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '54px 20px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ak-text-sec, #6B7280)', margin: 0, lineHeight: 1.5 }}>
              {t('dhub.search_none')}
            </p>
          </div>
        )}}

        {/* ── Typing → Jump to + live Courses ── */}
        {!!q && (
          <>
            <h2 style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', margin: '12px 0 2px' }}>
              {t('dhub.search_jump')}
            </h2>
            <div onClick={() => handOff('all')} role="button" aria-label={`${t('dhub.search_all_scope')}: ${query.trim()}`}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0',
                borderBottom: '1px solid var(--ak-border)', cursor: 'pointer' }}>
              <ArtTile art={DHUB_ART.notes} icon="🔍" size={44} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{query.trim()}"</span>
                <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 2 }}>
                  {t('dhub.search_in_courses')}
                </span>
              </span>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-muted)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
            {jumpHits.map((s) => (
              <div key={s.key} onClick={() => activateSection(s)} role="button" aria-label={s.label}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0',
                  borderBottom: '1px solid var(--ak-border)', cursor: 'pointer' }}>
                <ArtTile art={s.art} icon={s.art.icon} size={44} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)' }}>{s.label}</span>
                    {s.soon && (
                      <span style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: .4, padding: '2px 7px',
                        borderRadius: 99, background: 'var(--ak-tag-bg, #F3F4F6)', color: 'var(--ak-text-sub)', textTransform: 'uppercase' }}>
                        {t('dhub.soon')}
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 2 }}>{s.desc}</span>
                </span>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-muted)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            ))}

            {courses.length > 0 && (
              <>
                <h2 style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', margin: '18px 0 2px' }}>
                  {t('dhub.card_courses')}
                </h2>
                {courses.map((c) => (
                  <div key={c.id || c.title} onClick={() => handOff('courses')} role="button" aria-label={c.title}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0',
                      borderBottom: '1px solid var(--ak-border)', cursor: 'pointer' }}>
                    <ArtTile art={DHUB_ART.courses} icon="🎓" size={44} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 2 }}>
                        {t('dhub.search_course_type')}{c.subject ? ` • ${c.subject}` : ''}
                      </span>
                    </span>
                    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-muted)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </div>
                ))}
              </>
            )}

            {/* Nothing anywhere */}
            {jumpHits.length === 0 && (
              <div style={{ textAlign: 'center', padding: '34px 20px 0' }}>
                <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sec, #6B7280)', margin: 0 }}>
                  {t('dhub.no_match')}
                </p>
                <button onClick={() => setQuery('')}
                  style={{ marginTop: 10, padding: '7px 16px', borderRadius: 99, border: 'none',
                    background: BRAND, color: '#fff', fontSize: 12, fontWeight: 800,
                    cursor: 'pointer', fontFamily: FONT }}>
                    {t('dhub.clear')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}