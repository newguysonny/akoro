/**
 * DiscoverSearchPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Full-screen search for the higher-ed Discover hub. Its default state is a
 * useful study surface rather than an empty input: recent searches, enrolled
 * courses to continue, and real classmates eligible for a battle. Typing turns
 * it into a grouped search across the things this learner can actually access:
 * Discover destinations, device-local study records, published courses, and
 * classmates.
 *
 * Data boundaries are intentional:
 *   • enrolled courses and classmates come from authenticated API endpoints;
 *   • saved records are the existing device-local Higher Ed records; and
 *   • folders are not shown until the Library has a real folders endpoint.
 * No sample classmates, course progress, or folder results are invented.
 */
import { useEffect, useState } from 'react';
import { BRAND, GREEN, GOLD, SUBJECT_COLORS } from '../../constants.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { Icon } from '../common/Icons.jsx';
import { apiGet } from '../../services/api.js';
import { listRecords } from '../../services/recordsApi.js';
import { TYPES, matchTypes, FONT } from './dhubTypes.js';

export const RECENTS_KEY = 'akoro.dhubRecents';
export const MAX_RECENTS = 8;

/* Most-recent-first, de-duped case-insensitively by query text, capped.
   Entries are { q, scope } — scope is a discovery-type key for section
   jumps, 'search' for a generic hand-off. Legacy recents were bare strings,
   so loadRecents turns them into generic search entries. */
export function pushRecent(list, query, scope = 'search') {
  const value = (query || '').trim();
  if (!value) return list;
  const entry = { q: value, scope };
  const rest = list.filter((row) => (typeof row === 'string' ? row : row.q).toLowerCase() !== value.toLowerCase());
  return [entry, ...rest.map((row) => (typeof row === 'string' ? { q: row, scope: 'search' } : row))].slice(0, MAX_RECENTS);
}

/* Client-side matchers intentionally stay pure and are checked by the small
   SSR script. Keeping them local means searches respond instantly while each
   page-open performs just one fetch for each data source. */
export function matchCourse(course, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return false;
  return `${course.title || ''} ${course.subject || ''} ${course.instructor_name || course.teacher_name || ''}`
    .toLowerCase().includes(q);
}

export function matchRecord(record, query) {
  const q = (query || '').trim().toLowerCase();
  return !!q && `${record.name || ''} ${record.kind || ''}`.toLowerCase().includes(q);
}

export function matchClassmate(person, query) {
  const q = (query || '').trim().toLowerCase();
  return !!q && `${person.full_name || ''} ${person.username || ''} ${person.className || ''}`.toLowerCase().includes(q);
}

function loadRecents() {
  try {
    const raw = globalThis.localStorage?.getItem(RECENTS_KEY);
    const rows = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => typeof row === 'string' || (row && typeof row.q === 'string'))
      .map((row) => (typeof row === 'string'
        ? { q: row, scope: 'search' }
        : { q: row.q, scope: typeof row.scope === 'string' ? row.scope : 'search' }));
  } catch { return []; }
}

function persistRecents(list) {
  try { globalThis.localStorage?.setItem(RECENTS_KEY, JSON.stringify(list)); }
  catch { /* private mode / quota — recents degrade silently */ }
}

// Records live on the server now (the library shelf) — search loads them
// from the same feed the Library page uses, so a learner finds their
// material on any device, not just the one it was added on.
function loadRecordsRemote(setRecords) {
  listRecords()
    .then((rows) => setRecords(Array.isArray(rows) ? rows.filter((row) => row && typeof row.name === 'string') : []))
    .catch(() => { /* offline — records just don't surface in search */ });
}

function normalizeEnrollment(enrollment) {
  const course = enrollment?.courses || {};
  const progress = Math.max(0, Math.min(100, Number(enrollment?.progress) || 0));
  return {
    id: enrollment?.id || course.id || course.slug || course.title,
    title: course.title || 'Course',
    subject: course.subject || '',
    progress,
    slug: course.slug || null,
    cover: course.cover_image_url || null,
    courseType: course.course_type || 'video',
  };
}

const chevron = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const recordIcon = (kind) => ({ upload: 'ti-paperclip', link: 'ti-link', paste: 'ti-clipboard' }[kind] || 'ti-file-text');

function Section({ title, action, children, className = '' }) {
  return (
    <section className={`dhub-search-section ${className}`}>
      <div className="dhub-search-section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function RecentRow({ row, meta, onRun, onRemove, removeLabel }) {
  return (
    <div className="dhub-recent-row">
      <button className="dhub-recent-main" onClick={onRun}>
        <span aria-hidden="true" className="dhub-recent-thumb" style={{ background: meta.chipBg }}>
          {meta.icon?.startsWith('ti-') ? <Icon name={meta.icon} size={18} /> : meta.icon}
        </span>
        <span className="dhub-recent-copy">
          <strong>{row.q}</strong>
          <small>{meta.label}</small>
        </span>
      </button>
      <button className="dhub-recent-dismiss" onClick={onRemove} aria-label={`${removeLabel} “${row.q}”`}>
        <Icon name="ti-x" size={14} />
      </button>
    </div>
  );
}

function ContinueCard({ course, onOpen, labels }) {
  const accent = SUBJECT_COLORS[(course.subject || '').toLowerCase()] || BRAND;
  const started = course.progress > 0;
  const complete = course.progress >= 100;
  const status = complete ? labels.complete : started ? labels.inProgress : labels.notStarted;
  const statusColor = complete ? GREEN : started ? GOLD : accent;

  return (
    <button className="dhub-topic-card" onClick={onOpen}>
      <span className="dhub-topic-card-top">
        <span className="dhub-topic-glyph" style={{ background: `linear-gradient(135deg,${accent},${accent}BB)` }}>
          {course.cover
            ? <img src={course.cover} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
            : <Icon name={course.courseType === 'live' ? 'ti-broadcast' : 'ti-book'} size={24} color="#fff" />}
        </span>
        <span className="dhub-topic-info">
          <strong>{course.title}</strong>
          <small>{[course.subject, course.courseType === 'live' ? labels.live : labels.course].filter(Boolean).join(' · ')}</small>
        </span>
        <span className="dhub-topic-status" style={{ color: statusColor, background: `${statusColor}15` }}>{status}</span>
      </span>
      <span className="dhub-topic-card-bottom">
        <span className="dhub-mini-bar"><span style={{ width: `${course.progress}%`, background: `linear-gradient(90deg,${accent},${accent}BB)` }} /></span>
        <strong>{course.progress}%</strong>
        <span className="dhub-continue-action" style={{ color: accent }}>{labels.continue}{chevron}</span>
      </span>
    </button>
  );
}

function ClassmateCard({ person, onBattle, battleLabel }) {
  const initial = (person.full_name || person.username || '?').trim().charAt(0).toUpperCase();
  return (
    <article className="dhub-classmate-card">
      <div className="dhub-classmate-photo">
        {person.avatar
          ? <img src={person.avatar} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
          : <span className="dhub-classmate-fallback">{person.emoji || initial}</span>}
        <span className="dhub-classmate-class">{person.className || 'Classmate'}</span>
      </div>
      <div className="dhub-classmate-footer">
        <strong>{person.full_name || person.username || 'Classmate'}</strong>
        <small>{person.username ? `@${person.username}` : person.className || ''}</small>
        <button onClick={onBattle}><Icon name="ti-swords" size={12} /> {battleLabel}</button>
      </div>
    </article>
  );
}

function SearchRow({ icon, iconBg, title, subtitle, onClick, actionLabel, image, disabled = false }) {
  const inner = (
    <>
      <span className="dhub-result-glyph" style={{ background: image ? 'var(--ak-surface-hover)' : iconBg }}>
        {image
          ? <img src={image} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
          : (typeof icon === 'string' && icon.startsWith('ti-') ? <Icon name={icon} size={17} color="#fff" /> : icon)}
      </span>
      <span className="dhub-result-copy">
        <strong>{title}</strong>
        {subtitle && <small>{subtitle}</small>}
      </span>
      {onClick && <span aria-label={actionLabel} className="dhub-result-action">{chevron}</span>}
    </>
  );
  return onClick
    ? <button className="dhub-result-row" onClick={onClick}>{inner}</button>
    : <div className="dhub-result-row dhub-result-row-static" aria-disabled={disabled}>{inner}</div>;
}

function Skeleton({ wide = false }) {
  return <span className={`dhub-search-skeleton ${wide ? 'dhub-search-skeleton-wide' : ''}`} aria-hidden="true" />;
}

export default function DiscoverSearchPage({
  initialQuery = '', onClose, onPick, onOpenCourse, onOpenRecord, onOpenBattles,
  initialCourses = [], userId, initialLoading = true,
}) {
  const { t } = useLang();
  const [query, setQuery] = useState(initialQuery);
  const [focused, setFocused] = useState(false);
  const [recents, setRecents] = useState(loadRecents);
  const [catalogueCourses, setCatalogueCourses] = useState(initialCourses);
  const [enrolledCourses, setEnrolledCourses] = useState([]);
  const [classmates, setClassmates] = useState([]);
  const [records, setRecords] = useState([]);
  const [learningLoading, setLearningLoading] = useState(initialLoading);
  const [peopleLoading, setPeopleLoading] = useState(initialLoading);

  const all = TYPES(t);
  const q = query.trim();
  const typeRows = matchTypes(t, query);
  const materialRows = q ? records.filter((record) => matchRecord(record, q)).slice(0, 5) : [];
  const courseRows = q ? catalogueCourses.filter((course) => matchCourse(course, q)).slice(0, 5) : [];
  const classmateRows = q ? classmates.filter((person) => matchClassmate(person, q)).slice(0, 5) : [];
  const hasResults = typeRows.length || materialRows.length || courseRows.length || classmateRows.length;
  const loadingSearch = learningLoading || peopleLoading;

  /* Catalogue and enrolled courses are separate on purpose. Public results can
     include any published course; the default Continue learning surface only
     includes a course the signed-in learner enrolled in. */
  useEffect(() => {
    let alive = true;
    Promise.all([
      apiGet('/api/courses/published?type=live&limit=40').catch(() => null),
      apiGet('/api/courses/published?type=video&limit=40').catch(() => null),
    ]).then(([live, video]) => {
      const rows = [
        ...(live?.courses || []).map((course) => ({ ...course, _kind: 'live' })),
        ...(video?.courses || []).map((course) => ({ ...course, _kind: 'video' })),
      ];
      if (alive && rows.length) setCatalogueCourses(rows);
    });
    apiGet('/api/user/enrollments')
      .then((data) => {
        const rows = data?.data || data?.enrollments || [];
        if (alive) setEnrolledCourses(rows.filter((row) => row?.courses).map(normalizeEnrollment).filter((row) => row.id));
      })
      .catch(() => { if (alive) setEnrolledCourses([]); })
      .finally(() => { if (alive) setLearningLoading(false); });
    return () => { alive = false; };
  }, []);

  /* Classmates are the people in the learner's actual classrooms who have an
     agent — exactly the people the existing battle flow can challenge. */
  useEffect(() => {
    let alive = true;
    apiGet('/api/battle/my-classes')
      .then(async (data) => {
        const rooms = (data?.data || []).slice(0, 4);
        const rosters = await Promise.all(rooms.map(async (room) => {
          try {
            const data = await apiGet(`/api/battle/classes/${encodeURIComponent(room.id)}/roster`);
            return (data?.data || []).filter((person) => person?.has_agent).map((person) => ({ ...person, className: room.name }));
          } catch { return []; }
        }));
        if (!alive) return;
        const seen = new Set();
        setClassmates(rosters.flat().filter((person) => {
          if (!person?.id || seen.has(person.id)) return false;
          seen.add(person.id);
          return true;
        }).slice(0, 12));
      })
      .catch(() => { if (alive) setClassmates([]); })
      .finally(() => { if (alive) setPeopleLoading(false); });
    return () => { alive = false; };
  }, []);

  /* Records are intentionally device-local today, matching AddRecordModal.
     Refresh if the profile resolves after this overlay has mounted. */
  useEffect(() => { loadRecordsRemote(setRecords); }, []);

  /* Esc closes; this overlay owns the viewport while open. */
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const remember = (text, scope = 'search') => {
    const next = pushRecent(recents, text, scope);
    setRecents(next);
    persistRecents(next);
  };

  const scopeMeta = (scope) => {
    const type = all.find((row) => row.key === scope);
    return type
      ? { icon: type.icon, chipBg: type.grad, label: type.label }
      : { icon: 'ti-search', chipBg: 'var(--ak-surface-hover)', label: t('dhub.scope_search') };
  };

  const pickType = (type) => {
    remember(q || type.label, type.key);
    onPick?.(type, q);
  };

  const pickCourse = (course) => {
    remember(q || course.title, 'courses');
    if (course.slug && onOpenCourse) onOpenCourse(course);
    else onPick?.(all.find((type) => type.key === 'courses'), q || course.title);
  };

  const pickRecord = (record) => {
    remember(q || record.name, 'contents');
    onClose?.();
    onOpenRecord?.(record);
  };

  const openBattles = () => {
    onClose?.();
    onOpenBattles?.();
  };

  /* Enter follows the strongest actionable result: a published course, then a
     material, then a Discover destination. It never pretends a classmate row
     is a profile page when the product only supports battling classmates. */
  const onEnter = () => {
    if (!q) return;
    if (courseRows.length) return pickCourse(courseRows[0]);
    if (materialRows.length) return pickRecord(materialRows[0]);
    if (typeRows.length) return pickType(typeRows[0]);
    remember(q, 'search');
    onPick?.(all.find((type) => type.key === 'courses'), q);
  };

  const removeRecent = (text) => {
    const next = recents.filter((row) => row.q !== text);
    setRecents(next);
    persistRecents(next);
  };

  const labels = {
    course: t('dhub.course'),
    live: t('dhub.live'),
    notStarted: t('dhub.not_started'),
    inProgress: t('dhub.in_progress'),
    complete: t('dhub.complete'),
    continue: t('dhub.continue'),
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={t('dhub.search_aria')} className="dhub-search-page">
      <style>{`
        @keyframes dhub-search-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
        .dhub-search-page{position:fixed;inset:0;z-index:1500;background:var(--ak-surface,#fff);color:var(--ak-text,#111827);font-family:${FONT};display:flex;flex-direction:column}
        .dhub-search-top{display:flex;align-items:center;gap:10px;padding:14px 16px 12px;border-bottom:1px solid var(--ak-border,#F3F4F6);flex-shrink:0}
        .dhub-search-close{width:30px;height:30px;flex-shrink:0;border:none;background:none;display:flex;align-items:center;justify-content:center;color:var(--ak-text,#111827);cursor:pointer;padding:0}
        .dhub-search-shell{flex:1;display:flex;align-items:center;gap:8px;background:var(--ak-surface-hover,#F9FAFB);border:1.5px solid var(--ak-border2,#E5E7EB);border-radius:50px;padding:9px 14px;transition:border-color .15s ease,box-shadow .15s ease}
        .dhub-search-shell.focused{border-color:${BRAND};box-shadow:0 0 0 3px ${BRAND}12}
        .dhub-search-shell svg{color:var(--ak-text-muted,#9CA3AF);flex-shrink:0}
        .dhub-search-shell input{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:${FONT};font-size:14px;font-weight:700;color:var(--ak-text,#111827)}
        .dhub-search-shell input::placeholder{color:var(--ak-text-muted,#9CA3AF)}
        .dhub-search-clear{border:none;background:none;cursor:pointer;color:var(--ak-text-muted,#9CA3AF);display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:2px}
        .dhub-search-body{flex:1;overflow-y:auto;padding:16px 16px 94px}
        .dhub-search-section{margin:0 0 22px}.dhub-search-section-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 11px}.dhub-search-section-head h2{margin:0;font-size:12.5px;font-weight:900;color:var(--ak-text,#111827)}
        .dhub-search-section-action{border:none;background:none;color:${BRAND};font-family:${FONT};font-size:11px;font-weight:800;cursor:pointer;padding:2px 0}
        .dhub-recent-row{display:flex;align-items:center;gap:6px}.dhub-recent-main{min-width:0;flex:1;display:flex;align-items:center;gap:12px;padding:8px 2px;border:none;background:none;color:inherit;text-align:left;font-family:${FONT};cursor:pointer}.dhub-recent-main:active,.dhub-result-row:active,.dhub-topic-card:active{transform:scale(.985)}
        .dhub-recent-thumb{width:44px;height:44px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:19px;color:#fff;overflow:hidden;background-size:cover;background-position:center}.dhub-recent-copy,.dhub-result-copy,.dhub-topic-info{display:block;min-width:0;flex:1}.dhub-recent-copy strong,.dhub-result-copy strong,.dhub-topic-info strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;font-weight:800;color:var(--ak-text,#111827)}.dhub-recent-copy small,.dhub-result-copy small,.dhub-topic-info small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--ak-text-sub,#6B7280);margin-top:1px}
        .dhub-recent-dismiss{width:26px;height:26px;border-radius:50%;flex-shrink:0;border:none;background:none;display:flex;align-items:center;justify-content:center;color:var(--ak-text-muted,#9CA3AF);cursor:pointer;padding:0}
        .dhub-topic-card{position:relative;width:100%;border-radius:18px;overflow:hidden;margin:0 0 12px;cursor:pointer;border:1px solid var(--ak-border2,#E5E7EB);background:var(--ak-surface,#fff);font-family:${FONT};text-align:left;padding:0;color:inherit;transition:transform .12s ease,box-shadow .12s ease}.dhub-topic-card:hover{box-shadow:0 5px 16px rgba(15,23,42,.08)}.dhub-topic-card-top{display:flex;align-items:center;gap:13px;padding:14px}.dhub-topic-glyph{width:52px;height:52px;border-radius:14px;flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center}.dhub-topic-glyph img{width:100%;height:100%;object-fit:cover}.dhub-topic-info strong{font-size:14.5px}.dhub-topic-info small{font-size:11px;font-weight:700;color:var(--ak-text-muted,#9CA3AF)}.dhub-topic-status{font-size:9.5px;font-weight:900;padding:3px 9px;border-radius:20px;flex-shrink:0;white-space:nowrap}.dhub-topic-card-bottom{display:flex;align-items:center;gap:10px;padding:0 14px 14px}.dhub-mini-bar{flex:1;height:7px;border-radius:4px;background:var(--ak-border2,#E5E7EB);overflow:hidden}.dhub-mini-bar span{display:block;height:100%;border-radius:4px}.dhub-topic-card-bottom>strong{font-size:12px;font-weight:900;color:var(--ak-text-sub,#6B7280);flex-shrink:0}.dhub-continue-action{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:900;flex-shrink:0}
        .dhub-classmate-row{display:flex;gap:12px;overflow-x:auto;padding:1px 0 7px;scrollbar-width:none}.dhub-classmate-row::-webkit-scrollbar{display:none}.dhub-classmate-card{flex-shrink:0;width:132px;border-radius:16px;overflow:hidden;border:1px solid var(--ak-border2,#E5E7EB);background:var(--ak-surface,#fff)}.dhub-classmate-photo{height:120px;width:100%;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;background:linear-gradient(135deg,#F0EBFF,#E5E7EB)}.dhub-classmate-photo img{width:100%;height:100%;object-fit:cover}.dhub-classmate-fallback{font-size:34px;font-weight:900;color:${BRAND}}.dhub-classmate-photo:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 55%,rgba(0,0,0,.35) 100%)}.dhub-classmate-class{position:absolute;left:8px;bottom:8px;z-index:1;max-width:calc(100% - 16px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:rgba(255,255,255,.92);color:${BRAND};font-size:9.5px;font-weight:900;padding:2px 7px;border-radius:20px}.dhub-classmate-footer{padding:9px 10px 11px}.dhub-classmate-footer>strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:900;color:var(--ak-text,#111827);line-height:1.25}.dhub-classmate-footer>small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--ak-text-muted,#9CA3AF);font-weight:700;margin-top:1px}.dhub-classmate-footer button{margin-top:8px;width:100%;display:flex;align-items:center;justify-content:center;gap:5px;padding:7px 0;border-radius:20px;border:1.5px solid ${BRAND};background:${BRAND}08;color:${BRAND};font-size:11px;font-weight:900;font-family:${FONT};cursor:pointer}.dhub-classmate-footer button:active{background:${BRAND};color:#fff}.dhub-classmate-footer button:active svg{color:#fff}
        .dhub-result-row{width:100%;display:flex;align-items:center;gap:12px;padding:10px 4px;border:none;border-bottom:1px solid var(--ak-border,#F3F4F6);background:none;color:inherit;text-align:left;font-family:${FONT};cursor:pointer;transition:transform .12s ease}.dhub-result-row:last-child{border-bottom:none}.dhub-result-row-static{cursor:default}.dhub-result-glyph{width:36px;height:36px;border-radius:10px;flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff}.dhub-result-glyph img{width:100%;height:100%;object-fit:cover}.dhub-result-copy strong{font-weight:800}.dhub-result-copy small{margin-top:2px}.dhub-result-action{width:30px;height:30px;border-radius:50%;flex-shrink:0;border:1.5px solid var(--ak-border2,#E5E7EB);display:flex;align-items:center;justify-content:center;color:var(--ak-text-sub,#6B7280)}
        .dhub-search-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 30px;text-align:center;color:var(--ak-text-muted,#9CA3AF)}.dhub-search-empty>span{margin-bottom:10px}.dhub-search-empty strong{font-size:13.5px;font-weight:800;color:var(--ak-text-sub,#6B7280);margin-bottom:4px}.dhub-search-empty small{font-size:12px;font-weight:600;line-height:1.45}.dhub-search-empty button{margin-top:15px;padding:8px 14px;border-radius:20px;border:1.5px solid var(--ak-border2,#E5E7EB);background:var(--ak-surface-hover,#F9FAFB);font-family:${FONT};font-size:12px;font-weight:800;color:${BRAND};cursor:pointer}
        .dhub-search-quiet{padding:3px 2px 0;font-size:12px;font-weight:700;color:var(--ak-text-muted,#9CA3AF);line-height:1.45}.dhub-search-skeleton{display:block;height:60px;border-radius:14px;background:linear-gradient(90deg,var(--ak-surface-hover,#F9FAFB) 25%,var(--ak-border,#F3F4F6) 50%,var(--ak-surface-hover,#F9FAFB) 75%);background-size:200% 100%;animation:dhub-search-shimmer 1.2s ease infinite;margin-bottom:9px}.dhub-search-skeleton-wide{width:132px;height:178px;flex-shrink:0;margin:0}.dhub-search-skeleton-row{display:flex;gap:12px;overflow:hidden}
      `}</style>

      <div className="dhub-search-top">
        <button onClick={onClose} className="dhub-search-close" aria-label={t('dhub.close_search')}>
          <Icon name="ti-arrow-left" size={20} />
        </button>
        <div className={`dhub-search-shell${focused ? ' focused' : ''}`}>
          <Icon name="ti-search" size={16} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onEnter(); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={t('dhub.search_ph')}
            aria-label={t('dhub.search_aria')}
          />
          {query && (
            <button onClick={() => setQuery('')} className="dhub-search-clear" aria-label={t('dhub.clear')}>
              <Icon name="ti-x" size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="dhub-search-body">
        {!q ? (
          <>
            {recents.length > 0 && (
              <Section title={t('dhub.recent')} action={<button className="dhub-search-section-action" onClick={() => { setRecents([]); persistRecents([]); }}>{t('dhub.clear_all')}</button>}>
                {recents.map((row) => <RecentRow key={row.q} row={row} meta={scopeMeta(row.scope)} onRun={() => setQuery(row.q)} onRemove={() => removeRecent(row.q)} removeLabel={t('dhub.remove')} />)}
              </Section>
            )}

            {learningLoading ? (
              <Section title={t('dhub.continue_learning')}><Skeleton /><Skeleton /></Section>
            ) : enrolledCourses.length > 0 ? (
              <Section title={t('dhub.continue_learning')}>
                {enrolledCourses.slice(0, 4).map((course) => <ContinueCard key={course.id} course={course} labels={labels} onOpen={() => pickCourse(course)} />)}
              </Section>
            ) : null}

            {peopleLoading ? (
              <Section title={t('dhub.classmates')}><div className="dhub-search-skeleton-row"><Skeleton wide /><Skeleton wide /><Skeleton wide /></div></Section>
            ) : classmates.length > 0 ? (
              <Section title={t('dhub.classmates')} action={onOpenBattles ? <button className="dhub-search-section-action" onClick={openBattles}>{t('dhub.see_all')}</button> : null}>
                <div className="dhub-classmate-row">
                  {classmates.map((person) => <ClassmateCard key={person.id} person={person} onBattle={openBattles} battleLabel={t('dhub.battle')} />)}
                </div>
              </Section>
            ) : null}

            {!learningLoading && !peopleLoading && !recents.length && !enrolledCourses.length && !classmates.length && (
              <div className="dhub-search-empty">
                <span><Icon name="ti-search" size={32} color="var(--ak-text-muted, #9CA3AF)" /></span>
                <strong>{t('dhub.recent_none')}</strong>
                <small>{t('dhub.search_empty_hint')}</small>
              </div>
            )}
          </>
        ) : hasResults ? (
          <>
            {typeRows.length > 0 && (
              <Section title={t('dhub.topics')}>
                {typeRows.map((type) => <SearchRow key={type.key} icon={type.icon} iconBg={type.grad} title={type.label} subtitle={type.desc} onClick={() => pickType(type)} actionLabel={t('dhub.cta_open')} />)}
              </Section>
            )}

            {materialRows.length > 0 && (
              <Section title={t('dhub.materials')}>
                {materialRows.map((record) => <SearchRow key={record.id} icon={recordIcon(record.kind)} iconBg="linear-gradient(135deg,#F59E0B,#B45309)" title={record.name} subtitle={t(`records.tab_${record.kind}`)} onClick={() => pickRecord(record)} actionLabel={t('dhub.cta_open')} />)}
              </Section>
            )}

            {courseRows.length > 0 && (
              <Section title={t('dhub.courses')}>
                {courseRows.map((course) => <SearchRow key={`${course._kind || 'course'}-${course.id || course.slug || course.title}`} icon={course._kind === 'live' ? 'ti-broadcast' : 'ti-book'} iconBg={course._kind === 'live' ? 'linear-gradient(135deg,#EF4E78,#C92A54)' : 'linear-gradient(135deg,#F28C52,#DE5F26)'} title={course.title} subtitle={[course.subject, course._kind === 'live' ? labels.live : labels.course].filter(Boolean).join(' · ')} image={course.cover_image_url} onClick={() => pickCourse(course)} actionLabel={t('dhub.cta_open')} />)}
              </Section>
            )}

            {classmateRows.length > 0 && (
              <Section title={t('dhub.classmates')}>
                {classmateRows.map((person) => <SearchRow key={person.id} icon={person.emoji || '🧑‍🎓'} iconBg="linear-gradient(135deg,#10B981,#059669)" image={person.avatar} title={person.full_name || person.username} subtitle={[person.username ? `@${person.username}` : null, person.className].filter(Boolean).join(' · ')} onClick={onOpenBattles ? openBattles : undefined} actionLabel={t('dhub.battle')} />)}
              </Section>
            )}
          </>
        ) : loadingSearch ? (
          <>
            <Section title={t('dhub.topics')}><Skeleton /><Skeleton /></Section>
            <Section title={t('dhub.courses')}><Skeleton /></Section>
          </>
        ) : (
          <div className="dhub-search-empty">
            <span><Icon name="ti-search" size={32} color="var(--ak-text-muted, #9CA3AF)" /></span>
            <strong>{t('dhub.no_match')}</strong>
            <small>{t('dhub.search_empty_hint')}</small>
            <button onClick={() => setQuery('')}>{t('dhub.clear')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
