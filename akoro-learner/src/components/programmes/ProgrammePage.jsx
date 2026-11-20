/**
 * ProgrammePage.jsx
 * ─────────────────────────────────────────────────────────────
 * The generic published-programme experience the Discover hub's
 * programme cards open — IDENTICAL layout and arrangement to the
 * PHARM.D pages (PharmDProgram.jsx): the same hero, the same
 * horizontal year/section rows of 132px course cards, the same
 * course folder (art banner, author row, action row, numbered
 * topic list). Only the content differs — it reads the admin
 * console's Program Courses tree via /api/programmes/catalogue
 * (services/programmesApi.js), published-only at every level,
 * and a cover image (programme or course) replaces the gradient
 * wherever the admin supplied one.
 *
 * Two views, like PharmDProgram:
 *   browse — programme hero + section rows of course cards.
 *   folder — one course: art, author, action row, materials list.
 *     A material with a resource URL opens in a new tab.
 *
 * Empty states (the golden-path audit's three questions):
 *   · no sections at all → "No sections or courses yet — programme
 *     content is coming soon."
 *   · a section with no published course → "Courses for {section}
 *     are coming soon." (the Pharm.D wording)
 *   · a course with no published material → "Published learning
 *     materials for this course will appear here."
 *
 * Mounted in-tab by LearnerDashboard (?view=programme&programme=ID,
 * plus ?pcourse=ID for the open course) so the browser Back/Forward
 * walk hub > browse > folder exactly like the Pharm.D chain. On
 * mobile it is the full-screen takeover, in-tab on tablet/desktop —
 * the same .pd-page / .pd-inline split as PharmDProgram.
 */
import { useEffect, useRef, useState } from 'react';
import { BRAND } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';
import Toast from '../common/Toast.jsx';
import Spinner from '../common/Spinner.jsx';
import { useIsMobileView } from '../../hooks/useIsMobileView.js';
import { AUTHOR } from '../../features/pharmd/index.js';
import { fetchProgramme, fetchProgrammeCourse } from '../../services/programmesApi.js';

/* The admin console's six course-card gradients — the colour the admin
   picked for each course, used wherever there is no cover image. */
export const COURSE_G = [
  'linear-gradient(145deg,#ff6b52,#8a2c20)', 'linear-gradient(145deg,#6c3cff,#2d1b6e)',
  'linear-gradient(145deg,#14b8a0,#0b6b60)', 'linear-gradient(145deg,#4a8af0,#2652b5)',
  'linear-gradient(145deg,#ee4a73,#a11d45)', 'linear-gradient(145deg,#f0894a,#c0501a)',
];

const TYPE_LABEL = { pdf: 'PDF', video: 'Video', audio: 'Audio', note: 'Note', link: 'Link', slides: 'Slides' };

/* Art for a course tile/banner: the cover image when the admin set one,
   the admin-picked gradient when not (the Pharm.D ::after wash keeps the
   code legible over both). */
const artFor = (c) => (c?.cover_url
  ? { backgroundImage: `url(${c.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  : { background: COURSE_G[c?.color || 0] });

/* One line under a material: honest about what the data has. */
const materialMeta = (m) => [TYPE_LABEL[m.type] || 'PDF', m.meta || null].filter(Boolean).join(' · ');

export default function ProgrammePage({ programmeId, onClose,
  courseRoute = null,   // the course id the URL says is open (null = browse view)
  onCourseRoute,        // (id|null) — mirror a course transition into the URL
}) {
  const isMobile = useIsMobileView();       // mobile keeps the takeover; the rest render in-tab
  const inline = !isMobile;
  const [view, setView] = useState(courseRoute ? 'folder' : 'browse');  // browse | folder
  const [courseId, setCourseId] = useState(courseRoute);  // the open course id
  const [toast, setToast] = useState(null);

  /* Real data: the programme tree and the open course. */
  const [p, setP] = useState(null);               // null = still loading
  const [loadErr, setLoadErr] = useState(false);
  const [loadTick, setLoadTick] = useState(0);    // Try again
  const [courseData, setCourseData] = useState(null);
  const [courseLoading, setCourseLoading] = useState(false);
  const scrollRef = useRef(null);

  const materials = courseData?.materials ?? [];
  const sections = p?.sections ?? [];
  /* The open course's tree entry — art and colour while the folder loads. */
  const treeCourse = sections.flatMap((s) => s.courses ?? []).find((c) => c.id === courseId) || null;
  const folderCourse = courseData || treeCourse;

  /* The programme, once per open (and on Try again). */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await fetchProgramme(programmeId);
        if (!alive) return;
        setP(d);
        setLoadErr(!d);
      } catch {
        if (alive) setLoadErr(true);
      }
    })();
    return () => { alive = false; };
  }, [programmeId, loadTick]);

  /* Every view change starts at the top (the Pharm.D behaviour) — the
     phone column's own scroll on mobile, the tab container's when in-tab. */
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
    scrollRef.current?.closest('.ak-dash-scroll')?.scrollTo(0, 0);
  }, [view, courseId]);

  const soon = (label) => setToast({ msg: `${label} — coming soon`, color: BRAND });

  /* Open a course — or, with null, go back to the browse view. Our own
     transitions mirror into the URL (?pcourse=ID) so Back/Forward walk
     the hub > browse > folder chain; the sync effect below follows the
     entries we did NOT push (the history buttons). */
  const lastRouteRef = useRef(courseRoute);
  const openCourse = async (id) => {
    if (id !== courseRoute) {
      lastRouteRef.current = id;
      onCourseRoute?.(id);
    }
    setCourseId(id);
    setView(id ? 'folder' : 'browse');
    setCourseData(null);
    if (!id) return;
    setCourseLoading(true);
    try {
      setCourseData(await fetchProgrammeCourse(id));
    } catch {
      setToast({ msg: 'Could not load that course — check your connection.', color: BRAND });
    } finally {
      setCourseLoading(false);
    }
  };

  /* The URL moved without us (browser Back/Forward, deep link): follow. */
  useEffect(() => {
    if (courseRoute === lastRouteRef.current) return;
    lastRouteRef.current = courseRoute;
    if (courseRoute) openCourse(courseRoute);
    else { setView('browse'); setCourseId(null); }
  }, [courseRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  /* A deep link / refresh straight into a course folder: land open. */
  useEffect(() => { if (courseRoute) openCourse(courseRoute); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* A material opens its resource URL; without one it is on its way. */
  const openMaterial = (m) => {
    if (m?.url) window.open(m.url, '_blank', 'noopener');
    else setToast({ msg: 'This material has no file yet — check back soon.', color: BRAND });
  };

  /* Start where the learner left off — the first openable material. */
  const startLearning = () => {
    const first = materials.find((m) => m.url) || materials[0];
    if (first) openMaterial(first);
  };

  const code = folderCourse?.code || '';
  const heroStyle = p?.cover_url
    ? { backgroundImage: `linear-gradient(160deg, rgba(37,21,99,.78) 0%, rgba(46,26,110,.85) 75%), url(${p.cover_url})`,
        backgroundSize: 'cover', backgroundPosition: 'center' }
    : undefined;

  return (
    <div role={inline ? undefined : 'dialog'} aria-modal={inline ? undefined : 'true'}
      aria-label={inline ? undefined : (p?.name || 'Programme')}
      className={inline ? 'pd-inline' : 'pd-page'}>
      <style>{`
        .pd-page{position:fixed;inset:0;z-index:1500;background:var(--ak-bg,#FAFAFC);display:flex;justify-content:center;font-family:'Nunito',system-ui,sans-serif;color:var(--ak-text,#111827)}
        /* Desktop/tablet — in-tab inside the app shell: plain flow content,
           the tab's own scroll container scrolls it, the shell chrome stays. */
        .pd-inline{width:100%;display:flex;justify-content:center;font-family:'Nunito',system-ui,sans-serif;color:var(--ak-text,#111827)}
        .pd-phone.pd-phone-inline{width:100%;max-width:none;height:auto;overflow:visible;background:transparent}
        .pd-phone{width:100%;max-width:430px;height:100%;overflow-y:auto;position:relative;background:var(--ak-bg,#FAFAFC);padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
        .pd-back{width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,0.14);color:#fff;font-size:1.1rem;font-weight:700;cursor:pointer;margin-bottom:20px;font-family:inherit}
        /* Browse */
        .pd-hero{background:linear-gradient(160deg, ${BRAND} 0%, #2E1A6E 75%);padding:20px 22px 28px}
        .pd-hero h1{font-size:2.1rem;font-weight:900;margin:0;color:#fff}
        .pd-hero .pd-sub{color:rgba(255,255,255,0.75);font-weight:700;font-size:.85rem;margin-top:6px}
        .pd-section{padding:22px 0 4px}
        .pd-section h2{font-size:1.15rem;font-weight:800;margin:0 0 14px;padding:0 22px;color:var(--ak-text,#111827)}
        .pd-row{display:flex;gap:14px;overflow-x:auto;padding:0 22px 10px;scrollbar-width:none}
        .pd-row::-webkit-scrollbar{display:none}
        .pd-card{flex:0 0 132px;cursor:pointer;background:none;border:none;padding:0;text-align:left;font-family:inherit;color:inherit}
        .pd-card .pd-art{width:132px;height:132px;border-radius:14px;display:flex;flex-direction:column;justify-content:flex-end;padding:12px;position:relative;overflow:hidden}
        .pd-card .pd-art::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,0.35) 100%)}
        .pd-card .pd-code{position:relative;z-index:1;font-weight:900;font-size:1.05rem;color:#fff}
        .pd-card .pd-name{font-size:.85rem;font-weight:700;margin-top:8px;color:var(--ak-text,#111827)}
        .pd-card .pd-meta{font-size:.74rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:2px}
        .pd-card .pd-reads{font-size:.74rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:1px}
        .pd-empty{padding:18px 22px;flex:0 0 auto;width:100%}
        .pd-empty-card{border:1.5px dashed var(--ak-border2,#E5E7EB);border-radius:14px;padding:18px;text-align:center;color:var(--ak-text-sub,#6B7280);font-weight:700;font-size:.85rem}
        /* Folder */
        .pd-folder-hero{padding:20px 22px 24px;position:relative}
        .pd-folder-art{width:100%;aspect-ratio:1.6;border-radius:16px;display:flex;align-items:center;justify-content:center;margin:18px 0 20px;position:relative;overflow:hidden}
        .pd-phone.pd-phone-inline .pd-folder-art{max-height:280px}
        .pd-code-big{font-size:2.6rem;font-weight:900;color:rgba(255,255,255,0.92);letter-spacing:.02em}
        .pd-folder-title{font-size:1.5rem;font-weight:900;margin:0 0 4px;color:var(--ak-text,#111827)}
        .pd-author-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
        .pd-author-avatar{width:24px;height:24px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:900;color:#fff}
        .pd-author-name{font-size:.86rem;font-weight:800;color:var(--ak-text,#111827)}
        .pd-folder-meta{color:var(--ak-text-sub,#6B7280);font-weight:700;font-size:.85rem;margin:0 0 20px}
        .pd-action-row{display:flex;align-items:center;gap:14px;margin-bottom:8px}
        .pd-start{flex:1;padding:13px;border-radius:100px;border:none;background:${BRAND};color:#fff;font-family:inherit;font-weight:800;font-size:.95rem;cursor:pointer}
        .pd-icon-btn{width:44px;height:44px;border-radius:50%;border:1px solid var(--ak-border2,#E5E7EB);background:var(--ak-surface,#fff);color:var(--ak-text,#111827);font-size:1.1rem;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;font-family:inherit;text-decoration:none}
        .pd-topic-list{padding:18px 10px 30px}
        .pd-topic-row{display:flex;align-items:center;gap:14px;padding:13px 12px;border-radius:12px;cursor:pointer}
        .pd-topic-row:hover{background:var(--ak-surface,#fff)}
        .pd-topic-num{width:30px;text-align:center;color:var(--ak-text-sub,#6B7280);font-weight:800;font-size:.9rem;flex-shrink:0}
        .pd-t-name{font-weight:700;font-size:.95rem;color:var(--ak-text,#111827)}
        .pd-t-meta{font-size:.76rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:2px}
        .pd-more{background:none;border:none;color:var(--ak-text-sub,#6B7280);padding:6px 4px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit}
        /* Loading / error states */
        .pd-state{padding:36px 22px;display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--ak-text-sub,#6B7280);font-weight:700;font-size:.85rem}
      `}</style>

      <div className={inline ? 'pd-phone pd-phone-inline' : 'pd-phone'} ref={scrollRef}>

        {/* ── View 1: Browse ── */}
        {view === 'browse' && (
          <div>
            <div className="pd-hero" style={heroStyle}>
              <button className="pd-back" aria-label="Back to Discover" onClick={onClose}>←</button>
              <h1>{p?.name || '\u00A0'}</h1>
              <div className="pd-sub">{[p?.description, p?.duration_label].filter(Boolean).join(' · ')}</div>
            </div>
            {p === null && !loadErr && (
              <div className="pd-state"><Spinner size={18} color={BRAND}/> Loading the programme…</div>
            )}
            {loadErr && (
              <div className="pd-state">
                <div>Could not load the programme — check your connection.</div>
                <button onClick={() => { setP(null); setLoadErr(false); setLoadTick((t) => t + 1); }}
                  style={{ padding: '9px 18px', borderRadius: 20, border: 'none', background: BRAND, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Try again
                </button>
              </div>
            )}
            {p && !loadErr && !sections.length && (
              <div className="pd-empty"><div className="pd-empty-card">No sections or courses yet — programme content is coming soon.</div></div>
            )}
            {sections.map((s) => (
              <div className="pd-section" key={s.id}>
                <h2>{s.name}</h2>
                {s.courses?.length ? (
                  <div className="pd-row">
                    {s.courses.map((c) => (
                      <div key={c.id} className="pd-card" role="button" tabIndex={0}
                        onClick={() => openCourse(c.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCourse(c.id); } }}>
                        <span className="pd-art" style={artFor(c)}>
                          <span className="pd-code">{c.code}</span>
                        </span>
                        <div className="pd-name">{c.title || c.code}</div>
                        <div className="pd-meta">Course. by {c.instructor || AUTHOR}</div>
                        <div className="pd-reads">{c.materials_count} topic{c.materials_count === 1 ? '' : 's'}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pd-empty"><div className="pd-empty-card">Courses for {s.name} are coming soon.</div></div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── View 2: Folder (course) ── */}
        {view === 'folder' && courseId && (
          <div>
            <div className="pd-folder-hero">
              <button className="pd-back" aria-label="Back to programme" onClick={() => openCourse(null)}>←</button>
              <div className="pd-folder-art" style={artFor(folderCourse)}>
                {!folderCourse?.cover_url && <span className="pd-code-big">{code}</span>}
              </div>
              <h2 className="pd-folder-title">{folderCourse?.title || code}</h2>
              <div className="pd-author-row">
                <span className="pd-author-avatar" style={{ background: COURSE_G[folderCourse?.color || 0] }}>{(folderCourse?.instructor || AUTHOR).charAt(0)}</span>
                <span className="pd-author-name">{folderCourse?.instructor || AUTHOR}</span>
              </div>
              <p className="pd-folder-meta">{materials.length} topic{materials.length === 1 ? '' : 's'} · {p?.name || ''}</p>
              <div className="pd-action-row">
                <button className="pd-start" onClick={startLearning} disabled={!materials.length}>Start learning</button>
                <button className="pd-icon-btn" aria-label="Download all topics" onClick={() => soon('Offline downloads')}><Icon name="ti-download" size={18}/></button>
                <button className="pd-icon-btn" aria-label="More" onClick={() => soon('More actions')}><Icon name="ti-dots-vertical" size={20}/></button>
              </div>
            </div>
            <div className="pd-topic-list">
              {courseLoading && <div className="pd-state"><Spinner size={16} color={BRAND}/> Loading topics…</div>}
              {!courseLoading && !courseData && (
                <div className="pd-state">
                  <div>Could not load the topics.</div>
                  <button onClick={() => openCourse(courseId)}
                    style={{ padding: '9px 18px', borderRadius: 20, border: 'none', background: BRAND, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Try again
                  </button>
                </div>
              )}
              {!courseLoading && courseData && !materials.length && (
                <div className="pd-empty"><div className="pd-empty-card">Published learning materials for this course will appear here.</div></div>
              )}
              {materials.map((m, i) => (
                <div key={m.id || i} className="pd-topic-row" role="button" tabIndex={0}
                  onClick={() => openMaterial(m)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMaterial(m); } }}>
                  <div className="pd-topic-num">{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="pd-t-name">{m.title}</div>
                    <div className="pd-t-meta">{materialMeta(m)}</div>
                  </div>
                  <button className="pd-more" aria-label={`Open ${m.title}`}
                    onClick={(e) => { e.stopPropagation(); openMaterial(m); }}>
                    <Icon name={m.url ? 'ti-external-link' : 'ti-dots-vertical'} size={16}/>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}
