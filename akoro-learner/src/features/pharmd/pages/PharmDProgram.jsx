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
import { BRAND } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';
import Toast from '../../../components/common/Toast.jsx';
import AddToFolderPage from '../../../components/library/AddToFolderPage.jsx';
import AddToCommunityPage from '../../../components/communities/AddToCommunityPage.jsx';
import Spinner from '../../../components/common/Spinner.jsx';
import { useIsMobileView } from '../../../hooks/useIsMobileView.js';
import {
  fetchPharmdProgramme, fetchPharmdCourse, fetchPharmdProgress, completePharmdTopic,
} from '../../../services/pharmdApi.js';
import PharmDTopicSession from '../components/PharmDTopicSession.jsx';
import NowStudyingBar from '../../../components/dashboard/NowStudyingBar.jsx';
import { useNowStudying } from '../../../utils/nowStudying.js';
import { STUDENT_ID } from '../../../constants.js';
import { PROGRAM, AUTHOR, accentFor } from '../lib/pharmdData.js';
import PharmDProgramStyles from '../components/PharmDProgramStyles.jsx';
import { BrowseView, FolderView } from '../components/PharmDProgramViews.jsx';

import { SHEET_ACTIONS, topicMeta } from '../lib/pharmdUi.js';

export default function PharmDProgram({ onClose, focus, onFocusConsumed,
  courseRoute = null,   // the course the URL says is open (null = browse view)
  onCourseRoute,        // (code|null) — mirror a course transition into the URL
}) {
  const isMobile = useIsMobileView();       // mobile keeps the takeover; the rest render in-tab
  const inline = !isMobile;
  const [view, setView] = useState(courseRoute ? 'folder' : 'browse');  // browse | folder
  const [code, setCode] = useState(courseRoute);   // the open course code
  const [sessionTopic, setSessionTopic] = useState(null);  // index into topics — the open topic session
  const [sessionChat, setSessionChat] = useState('ask');   // the reader's chat state for the open topic
  const [now, nowActs] = useNowStudying(STUDENT_ID);      // the parked Now-Studying item
  const [sheet, setSheet] = useState(null);       // { kind:'course' } | { kind:'topic', idx }
  const [addToFolder, setAddToFolder] = useState(null);  // the topic being filed into folders
  const [addToCommunity, setAddToCommunity] = useState(null);  // the topic being shared to communities
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
  const openTopic = (i, chat = 'ask') => {
    setSessionChat(chat);
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
    if (kind === 'topic' && label === 'Agent session') {
      openTopic(idx, 'agent');
      return;
    }
    if (kind === 'topic' && label === 'Add to folder') {
      const t = topics[idx];
      if (t) setAddToFolder(t);
      return;
    }
    if (kind === 'topic' && label === 'Add to community') {
      const t = topics[idx];
      if (t) setAddToCommunity(t);
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
      <PharmDProgramStyles />

      <div className={inline ? 'pd-phone pd-phone-inline' : 'pd-phone'} ref={scrollRef}>

        {/* ── View 1: Browse ── */}
        {view === 'browse' && (
          <BrowseView meta={meta} years={years} loadErr={loadErr} setYears={setYears} setLoadErr={setLoadErr} openCourse={openCourse} soon={soon} onClose={onClose} />
        )}

        {/* ── View 2: Folder (course) ── */}
        {view === 'folder' && code && (
          <FolderView code={code} meta={meta} courseData={courseData} topics={topics} courseLoading={courseLoading} openCourse={openCourse} startLearning={startLearning} soon={soon} setSheet={setSheet} openTopic={openTopic} isDone={isDone} />
        )}

        {/* ── Topic session — the reader modal + teach session (chat icon) ── */}
        {sessionTopic !== null && topics[sessionTopic] && (
          <PharmDTopicSession
            topic={topics[sessionTopic]}
            course={courseData?.course}
            chatState={sessionChat}
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

      {/* ⋯ → Add to community on a topic — pick the communities it joins. */}
      {addToCommunity && (
        <AddToCommunityPage
          item={{
            itemType: 'pharmd_topic',
            itemRef: String(addToCommunity.id),
            title: addToCommunity.title,
            sub: `${code || 'PHARM.D'} · PHARM.D`,
            kind: 'topic',
            link: null,
          }}
          onClose={() => setAddToCommunity(null)}
        />
      )}

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}
