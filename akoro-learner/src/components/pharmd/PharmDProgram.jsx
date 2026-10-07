/**
 * PharmDProgram.jsx
 * ─────────────────────────────────────────────────────────────
 * The PHARM.D discovery experience, ported 1:1 from
 * reference/pharm D discovery and course page.md — now on REAL
 * data: the programme tree, course folders and topics come from
 * /api/pharmd (services/pharmdApi.js; the catalogue that
 * scripts/upload-pharmd-courses.mjs loads into Supabase), topic
 * PDFs open from the storage bucket, and "Mark as complete"
 * persists per learner.
 *
 * Two views — programme browse (hero + year rows of course cards)
 * and the course folder (art, author, action row, topic list with
 * done-checks) — plus the course/topic action sheet. Tapping a
 * topic opens PharmDTopicSession: the CONTENT READER modal as the
 * main display (the real PDF, Generate tools) with the teach agent
 * session a chat-icon away — reader + chat side by side on
 * desktop/tablet, the reader full-screen over the chat on mobile.
 *
 * Layout and visuals are the reference's, unchanged; only the
 * chrome colours ride the app's --ak-* theme tokens (light/dark
 * follows the app). The reference's 430px phone column is the
 * MOBILE look (the full-bleed takeover); on tablet/desktop the page
 * spans the full width of the shell's content area — like the
 * Discover hub and the Contents/Materials pages — with the folder
 * art kept to a banner height.
 *
 * Mounted in-tab by LearnerDashboard when the Discover hub's Pharm D
 * card opens (?view=pharmd): on desktop/tablet the page renders INSIDE
 * the app shell — side nav, header and Now-Studying all stay — exactly
 * like the hub itself; on mobile it stays the full-screen takeover.
 * The open course rides in the URL too (?course=CODE), so the browser
 * Back/Forward buttons walk the hub > browse > folder chain just like
 * the in-app back arrows do.
 */
import { useEffect, useRef, useState } from 'react';
import { BRAND } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';
import Toast from '../common/Toast.jsx';
import AddToFolderPage from '../library/AddToFolderPage.jsx';
import Spinner from '../common/Spinner.jsx';
import { useIsMobileView } from '../teaching/SessionReaderModal.jsx';
import {
  fetchPharmdProgramme, fetchPharmdCourse, fetchPharmdProgress, completePharmdTopic,
} from '../../services/pharmdApi.js';
import PharmDTopicSession from './PharmDTopicSession.jsx';
import NowStudyingBar from '../dashboard/NowStudyingBar.jsx';
import { useNowStudying } from '../../utils/nowStudying.js';
import { STUDENT_ID } from '../../constants.js';
import { PROGRAM, AUTHOR, accentFor } from './pharmdData.js';

/* The reference's done-green — a content colour, theme-independent. */
const GREEN = '#2BB673';

/* Sheet menus (reference sheetActionsFor). */
const SHEET_ACTIONS = {
  topic: [
    ['ti-share', 'Share'], ['ti-folder-plus', 'Add to folder'], ['ti-download', 'Download'],
    ['ti-check', 'Mark as complete'], ['ti-book-2', 'Go to course'],
  ],
  course: [
    ['ti-share', 'Share'], ['ti-bookmark-plus', 'Add to Library'], ['ti-download', 'Download all topics'],
    ['ti-user', 'Go to creator'], ['ti-school', 'Go to program'],
  ],
};

/* One line under a topic: honest about what the data has. */
const topicMeta = (t) => [
  t.read_minutes ? `${t.read_minutes} min read` : 'PDF',
  t.size ? `${(t.size / 1024 / 1024).toFixed(1)} MB` : null,
].filter(Boolean).join(' · ');

export default function PharmDProgram({ onClose, focus, onFocusConsumed,
  courseRoute = null,   // the course the URL says is open (null = browse view)
  onCourseRoute,        // (code|null) — mirror a course transition into the URL
}) {
  const isMobile = useIsMobileView();       // mobile keeps the takeover; the rest render in-tab
  const inline = !isMobile;
  const [view, setView] = useState(courseRoute ? 'folder' : 'browse');  // browse | folder
  const [code, setCode] = useState(courseRoute);   // the open course code
  const [sessionTopic, setSessionTopic] = useState(null);  // index into topics — the open topic session
  const [now, nowActs] = useNowStudying(STUDENT_ID);      // the parked Now-Studying item
  const [sheet, setSheet] = useState(null);       // { kind:'course' } | { kind:'topic', idx }
  const [addToFolder, setAddToFolder] = useState(null);  // the topic being filed into folders
  const [toast, setToast] = useState(null);

  /* Real data: the programme tree, the open course, my completion. */
  const [meta, setMeta] = useState(PROGRAM);      // hero copy; the API confirms it
  const [years, setYears] = useState(null);       // null = still loading
  const [loadErr, setLoadErr] = useState(false);
  const [courseData, setCourseData] = useState(null); // { course, topics }
  const [courseLoading, setCourseLoading] = useState(false);
  const [done, setDone] = useState(() => new Set());  // completed topic ids
  const scrollRef = useRef(null);

  const topics = courseData?.topics ?? [];
  const isDone = (i) => !!topics[i] && done.has(topics[i].id);

  /* Programme + my progress, once per open. Progress is optional —
     the catalogue renders for anyone; only saving needs a session. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await fetchPharmdProgramme();
        if (!alive) return;
        setYears(d?.years ?? []);
        if (d?.programme?.name) setMeta({ name: d.programme.name, sub: d.programme.subtitle || '' });
        setLoadErr(false);
      } catch {
        if (alive) setLoadErr(true);
      }
      try {
        const ids = await fetchPharmdProgress();
        if (alive) setDone(new Set(ids));
      } catch { /* not signed in / offline — checks simply start empty */ }
    })();
    return () => { alive = false; };
  }, []);

  /* Every view change starts at the top (reference window.scrollTo) — the
     phone column's own scroll on mobile, the tab container's when in-tab. */
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
    scrollRef.current?.closest('.ak-dash-scroll')?.scrollTo(0, 0);
  }, [view, code]);

  /* A reopen request (the Now-Studying bar's resume): head straight for
     the parked topic — openCourse LOADS the course (the old code only set
     the folder view, so the topics never arrived and the folder sat on
     'Could not load the topics'), and the effect below opens the reader
     session the moment the list lands. Consumed once: the caller is told,
     so a later plain visit to Pharm D starts at the programme browse. */
  const focusedRef = useRef(null);
  useEffect(() => {
    if (!focus?.code || !focus?.topicId) return;
    focusedRef.current = String(focus.topicId);
    if (focus.code !== code) {
      openCourse(focus.code);      // loads the course; view + code + URL ride along
    } else if (topics.length) {
      const i = topics.findIndex((t) => String(t.id) === focusedRef.current);
      focusedRef.current = null;
      if (i >= 0) openTopic(i);
    }
    onFocusConsumed?.();
  }, [focus?.ts]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focusedRef.current || !topics.length) return;
    const i = topics.findIndex((t) => String(t.id) === String(focusedRef.current));
    focusedRef.current = null;
    if (i >= 0) openTopic(i);
  }, [topics]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Escape closes the sheet (reference keydown). */
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e) => { if (e.key === 'Escape') setSheet(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet]);

  const soon = (label) => setToast({ msg: `${label} — coming soon`, color: BRAND });

  /* Open a course — or, with null, go back to the browse view. Our own
     transitions mirror into the URL (?course=CODE) so Back/Forward walk
     the hub > browse > folder chain; the sync effect below follows the
     entries we did NOT push (the history buttons). */
  const lastRouteRef = useRef(courseRoute);
  const openCourse = async (c) => {
    if (c !== courseRoute) {
      lastRouteRef.current = c;
      onCourseRoute?.(c);
    }
    setCode(c);
    setView(c ? 'folder' : 'browse');
    if (c !== code) setSessionTopic(null);   // a different course's reader can't stay open
    setCourseData(null);
    if (!c) return;
    setCourseLoading(true);
    try {
      setCourseData(await fetchPharmdCourse(c));
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
    else { setView('browse'); setCode(null); setSessionTopic(null); }
  }, [courseRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  /* A deep link / refresh straight into a course folder: land open. */
  useEffect(() => { if (courseRoute) openCourse(courseRoute); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* A topic opens its agent session (PharmDTopicSession) — the content
     reader modal is the main display, the teach session a chat-icon away. */
  const openTopic = (i) => {
    setSessionTopic(i);
    const t = topics[i];
    if (t) {
      // Parked like a track — the bar follows the learner off this page,
      // and its snapshot reopens this exact topic from anywhere.
      nowActs.setCurrent({
        type: 'pharmd', id: String(t.id), title: t.title,
        sub: `${code || 'PHARM.D'} · PHARM.D`, emoji: 'ti-stethoscope',
        progress: done.has(t.id) ? 100 : 0,
        snapshot: { code, topicId: String(t.id) },
      });
    }
  };

  /* Start where the learner left off — first unfinished topic. */
  const startLearning = () => {
    const first = topics.findIndex((t) => !done.has(t.id));
    openTopic(first === -1 ? 0 : first);
  };

  /* Mark as complete — optimistic flip, rolled back on failure. */
  const toggleDone = async (topicId, next) => {
    setDone((s) => {
      const n = new Set(s);
      if (next) n.add(topicId); else n.delete(topicId);
      return n;
    });
    try {
      await completePharmdTopic(topicId, next);
    } catch {
      setDone((s) => {
        const n = new Set(s);
        if (next) n.delete(topicId); else n.add(topicId);
        return n;
      });
      setToast({ msg: 'Could not save that — try again.', color: BRAND });
    }
  };

  const runSheetAction = (kind, label, idx) => {
    setSheet(null);
    if (kind === 'topic' && label === 'Add to folder') {
      const t = topics[idx];
      if (t) setAddToFolder(t);
      return;
    }
    if (kind === 'topic' && label === 'Mark as complete') {
      const t = topics[idx];
      if (t) toggleDone(t.id, !done.has(t.id));
      return;
    }
    if (kind === 'topic' && label === 'Download') {
      const t = topics[idx];
      if (t?.file_url) window.open(t.file_url, '_blank', 'noopener');
      return;
    }
    if (label === 'Go to course') { setView('folder'); return; }
    if (label === 'Go to program') { openCourse(null); return; }
    soon(label);
  };

  return (
    <div role={inline ? undefined : 'dialog'} aria-modal={inline ? undefined : 'true'}
      aria-label={inline ? undefined : `${meta.name} — ${meta.sub}`}
      className={inline ? 'pd-inline' : 'pd-page'}>
      <style>{`
        .pd-page{position:fixed;inset:0;z-index:1500;background:var(--ak-bg,#FAFAFC);display:flex;justify-content:center;font-family:'Nunito',system-ui,sans-serif;color:var(--ak-text,#111827)}
        /* Desktop/tablet — in-tab inside the app shell: plain flow content,
           the tab's own scroll container scrolls it, the shell chrome stays. */
        .pd-inline{width:100%;display:flex;justify-content:center;font-family:'Nunito',system-ui,sans-serif;color:var(--ak-text,#111827)}
        /* In-tab (tablet/desktop, >=768px) the 430px phone column and its
           centring are the MOBILE look — the page spans the full width of
           the shell's content area, like the Discover hub / Contents pages.
           Written as .pd-phone.pd-phone-inline so it beats .pd-phone's
           max-width/height/overflow/background regardless of rule order
           (a bare .pd-phone-inline loses to the later .pd-phone rule). */
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
        /* In-tab the art spans the content area — keep it a banner: the
           reference's 1.6 ratio full-width would be a huge gradient slab. */
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
        .pd-check{width:20px;height:20px;border-radius:50%;border:1.5px solid var(--ak-border2,#E5E7EB);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.7rem;color:${GREEN}}
        .pd-check.done{background:${GREEN};border-color:${GREEN};color:#fff}
        .pd-more{background:none;border:none;color:var(--ak-text-sub,#6B7280);padding:6px 4px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit}
        .pd-upload{position:absolute;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,0.5);border:1.5px solid rgba(255,255,255,0.5);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;font-family:inherit}
        .pd-card .pd-upload{width:24px;height:24px;top:6px;right:6px}
        .pd-folder-art .pd-upload{bottom:10px;right:10px}
        /* Action sheet */
        .pd-sheet-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center;z-index:40}
        .pd-sheet{width:100%;max-width:430px;background:var(--ak-surface,#fff);border-radius:20px 20px 0 0;padding:10px 0 max(18px, env(safe-area-inset-bottom));max-height:80vh;overflow-y:auto}
        .pd-sheet-handle{width:36px;height:4px;border-radius:100px;background:var(--ak-border2,#E5E7EB);margin:6px auto 14px}
        .pd-sheet-head{display:flex;align-items:center;gap:12px;padding:0 20px 16px;border-bottom:1px solid var(--ak-border,#F3F4F6)}
        .pd-sheet-art{width:48px;height:48px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.85rem;color:#fff}
        .pd-sheet-title{font-weight:800;font-size:.95rem;color:var(--ak-text,#111827)}
        .pd-sheet-sub{font-size:.78rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:2px}
        .pd-sheet-actions{padding:8px 0}
        .pd-sheet-action{display:flex;align-items:center;gap:16px;padding:13px 20px;cursor:pointer;background:none;border:none;width:100%;text-align:left;font-family:inherit}
        .pd-sheet-action:hover{background:var(--ak-surface-hover,#F9FAFB)}
        .pd-s-icon{width:22px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .pd-s-label{font-size:.92rem;font-weight:700;color:var(--ak-text,#111827)}
        /* Loading / error states */
        .pd-state{padding:36px 22px;display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--ak-text-sub,#6B7280);font-weight:700;font-size:.85rem}
      `}</style>

      <div className={inline ? 'pd-phone pd-phone-inline' : 'pd-phone'} ref={scrollRef}>

        {/* ── View 1: Browse ── */}
        {view === 'browse' && (
          <div>
            <div className="pd-hero">
              <button className="pd-back" aria-label="Back to Discover" onClick={onClose}>←</button>
              <h1>{meta.name}</h1>
              <div className="pd-sub">{meta.sub}</div>
            </div>
            {years === null && !loadErr && (
              <div className="pd-state"><Spinner size={18} color={BRAND}/> Loading the programme…</div>
            )}
            {loadErr && (
              <div className="pd-state">
                <div>Could not load the programme — check your connection.</div>
                <button onClick={() => { setYears(null); setLoadErr(false); }}
                  style={{ padding: '9px 18px', borderRadius: 20, border: 'none', background: BRAND, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Try again
                </button>
              </div>
            )}
            {(years ?? []).map((year) => (
              <div className="pd-section" key={year.label}>
                <h2>{year.label}</h2>
                {year.courses?.length ? (
                  <div className="pd-row">
                    {year.courses.map((c) => (
                      <div key={c.id || c.code} className="pd-card" role="button" tabIndex={0}
                        onClick={() => openCourse(c.code)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCourse(c.code); } }}>
                        <span className="pd-art" style={{ background: accentFor(c.code) }}>
                          <span className="pd-upload" role="button" aria-label={`Set cover photo for ${c.code}`}
                            onClick={(e) => { e.stopPropagation(); soon('Custom covers'); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); soon('Custom covers'); } }}><Icon name="ti-camera" size={12}/></span>
                          <span className="pd-code">{c.code}</span>
                        </span>
                        <div className="pd-name">{c.title || c.code}</div>
                        <div className="pd-meta">Course. by {AUTHOR}</div>
                        <div className="pd-reads">{c.topics} topic{c.topics === 1 ? '' : 's'}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pd-empty"><div className="pd-empty-card">Courses for {year.label} are coming soon.</div></div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── View 2: Folder (course) ── */}
        {view === 'folder' && code && (
          <div>
            <div className="pd-folder-hero">
              <button className="pd-back" aria-label="Back to programme" onClick={() => openCourse(null)}>←</button>
              <div className="pd-folder-art" style={{ background: accentFor(code) }}>
                <span className="pd-upload" role="button" aria-label="Set cover photo"
                  onClick={() => soon('Custom covers')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') soon('Custom covers'); }}><Icon name="ti-camera" size={14}/></span>
                <span className="pd-code-big">{code}</span>
              </div>
              <h2 className="pd-folder-title">{courseData?.course?.title || code}</h2>
              <div className="pd-author-row">
                <span className="pd-author-avatar" style={{ background: accentFor(code) }}>{AUTHOR.charAt(0)}</span>
                <span className="pd-author-name">{AUTHOR}</span>
              </div>
              <p className="pd-folder-meta">{topics.length} topics · {meta.name}</p>
              <div className="pd-action-row">
                <button className="pd-start" onClick={startLearning} disabled={!topics.length}>Start learning</button>
                <button className="pd-icon-btn" aria-label="Download all topics" onClick={() => soon('Offline downloads')}><Icon name="ti-download" size={18}/></button>
                <button className="pd-icon-btn" aria-label="More" onClick={() => setSheet({ kind: 'course' })}><Icon name="ti-dots-vertical" size={20}/></button>
              </div>
            </div>
            <div className="pd-topic-list">
              {courseLoading && <div className="pd-state"><Spinner size={16} color={BRAND}/> Loading topics…</div>}
              {!courseLoading && !courseData && (
                <div className="pd-state">
                  <div>Could not load the topics.</div>
                  <button onClick={() => openCourse(code)}
                    style={{ padding: '9px 18px', borderRadius: 20, border: 'none', background: BRAND, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Try again
                  </button>
                </div>
              )}
              {!courseLoading && courseData && !topics.length && (
                <div className="pd-empty"><div className="pd-empty-card">Topics for {courseData.course?.title || code} are being prepared — check back soon.</div></div>
              )}
              {topics.map((t, i) => (
                <div key={t.id || i} className="pd-topic-row" role="button" tabIndex={0}
                  onClick={() => openTopic(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTopic(i); } }}>
                  <div className="pd-topic-num">{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="pd-t-name">{t.title}</div>
                    <div className="pd-t-meta">{topicMeta(t)}</div>
                  </div>
                  <div className={`pd-check${isDone(i) ? ' done' : ''}`}>{isDone(i) ? '✓' : ''}</div>
                  <button className="pd-more" aria-label={`More for ${t.title}`}
                    onClick={(e) => { e.stopPropagation(); setSheet({ kind: 'topic', idx: i }); }}><Icon name="ti-dots-vertical" size={16}/></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Topic session — the reader modal + teach session (chat icon) ── */}
        {sessionTopic !== null && topics[sessionTopic] && (
          <PharmDTopicSession
            topic={topics[sessionTopic]}
            course={courseData?.course}
            onClose={() => setSessionTopic(null)}
          />
        )}

        {/* The Now-Studying bar, pinned to the column's bottom edge — the
            MOBILE takeover only: in-tab the shell's own bar (side rail /
            player bar) is already on screen, and a second one here would
            duplicate it. (Under the sheets: sticky z 30 < sheet z 40.) */}
        {!inline && now.item && !now.dismissed && sessionTopic === null && !sheet && (
          <NowStudyingBar sticky item={now.item}
            onOpen={() => {
              const it = now.item;
              if (it?.type === 'pharmd' && it.snapshot?.code === code) {
                const i = topics.findIndex((t) => String(t.id) === String(it.id));
                if (i >= 0) { openTopic(i); return; }
              }
              onClose?.();
            }}
            onDismiss={nowActs.dismiss}/>
        )}
      </div>

      {/* ── Action sheet (course or topic) ── */}
      {sheet && code && (
        <div className="pd-sheet-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="pd-sheet">
            <div className="pd-sheet-handle" />
            <div className="pd-sheet-head">
              <div className="pd-sheet-art" style={{ background: accentFor(code) }}>
                {sheet.kind === 'topic' ? sheet.idx + 1 : code.slice(0, 2)}
              </div>
              <div>
                <div className="pd-sheet-title">
                  {sheet.kind === 'topic' ? (topics[sheet.idx]?.title ?? '') : (courseData?.course?.title || code)}
                </div>
                <div className="pd-sheet-sub">
                  {sheet.kind === 'topic'
                    ? `${code}${topics[sheet.idx] ? ` · ${topicMeta(topics[sheet.idx])}` : ''}`
                    : `Course · by ${AUTHOR}`}
                </div>
              </div>
            </div>
            <div className="pd-sheet-actions">
              {SHEET_ACTIONS[sheet.kind].map(([icon, label]) => (
                <button key={label} className="pd-sheet-action" onClick={() => runSheetAction(sheet.kind, label, sheet.idx)}>
                  <span className="pd-s-icon"><Icon name={icon} size={18}/></span>
                  <span className="pd-s-label">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ⋯ → Add to folder on a topic — pick the folders it joins. */}
      {addToFolder && (
        <AddToFolderPage
          item={{
            itemType: 'pharmd_topic',
            itemRef: String(addToFolder.id),
            title: addToFolder.title,
            sub: `${code || 'PHARM.D'} · PHARM.D`,
            kind: 'topic',
            link: null,
          }}
          onClose={() => setAddToFolder(null)}
        />
      )}

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}
