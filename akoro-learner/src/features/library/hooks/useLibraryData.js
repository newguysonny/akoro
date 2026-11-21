import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchMyLibrary } from '../../../services/libraryApi.js';
import { listRecords, listRecordsPage, listFolders, listFoldersPage, setRecordProgress, touchRecordOpened, searchRecords } from '../../../services/recordsApi.js';
import { useLocalList, useSentinel } from '../../../lib/usePagedList.js';
import { STUDENT_ID } from '../../../constants.js';
import { useLang } from '../../../contexts/LanguageContext.jsx';
import { listDeleted } from '../../../lib/chatUploads.js';
import { useHigherEd } from '../../../hooks/useStudyTier.js';
import { useIsMobileView } from '../../../hooks/useIsMobileView.js';
import { useNowStudying } from '../../../utils/nowStudying.js';
import { APP_HOME } from '../../../config/target.js';
import { recordFileType } from '../components/recordFileType.js';
import { KINDS, FILE_TYPE_META, getMeta, READER_TOOLS } from '../components/libraryMeta.js';

export function useLibraryData() {
  const navigate = useNavigate();
  const { t } = useLang();
  // Now-Studying parking — the same tracking the dashboard shelf gives
  // records, so a record opened HERE parks on the bar too.
  const [now, nowActs] = useNowStudying(STUDENT_ID);
  const [searchParams] = useSearchParams();
  const openRecordRef = useRef(null);   // the ?record= deep link opens through the normal flow
  const [items, setItems]       = useState([]);
  const [records, setRecords]   = useState([]);
  const [folders, setFolders]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('all');
  const [viewer, setViewer]     = useState(null);   // the record open as a session
  const [viewerChat, setViewerChat] = useState('ask');   // the reader's chat state for the open record
  // ?tool= from an Agent Chat link: the reader opens on that study tool (Quiz, Flashcards…).
  const [viewerTool, setViewerTool] = useState(null);
  const [viewerArtifact, setViewerArtifact] = useState(null);   // a saved tab to open on (made in Agent Chat)

  /* Semantic search — the server searches INSIDE your records (what a paste
     says, what a scanned PDF contains, what a recording was about), fused
     vector + keyword. Debounced; empty query returns to the shelf. */
  const [q, setQ]                   = useState('');
  const [qResults, setQResults]     = useState(null);   // null = not searching
  const [qBusy, setQBusy]           = useState(false);
  /* Search pages by growing the limit in 12s (the endpoint re-runs the
     ranked search; a short page means the results are exhausted). */
  const [qLimit, setQLimit]         = useState(12);
  const qResultsRef                 = useRef(null);
  qResultsRef.current = qResults;
  useEffect(() => {
    const query = q.trim();
    if (!query) { setQResults(null); setQBusy(false); return; }
    if (qResultsRef.current === null) setQBusy(true);
    const id = setTimeout(async () => {
      const results = await searchRecords(query, qLimit);
      setQResults(results);
      setQBusy(false);
    }, 350);
    return () => clearTimeout(id);
  }, [q, qLimit]);
  const qHasMore = qResults !== null && qResults.length >= qLimit && qLimit < 96;
  const qSentinelRef = useSentinel(() => { if (qHasMore) setQLimit((l) => Math.min(l + 12, 96)); }, qHasMore);

  // ── Add a record — the + in the header ────────────────────────────────────
  // Every learner (school and higher-ed alike) adds material from the shelf
  // that holds it. The Now-Studying bar's + deep-links here with ?add=1.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [folderSheetOpen, setFolderSheetOpen] = useState(false);
  const [folderPage, setFolderPage] = useState(null);   // the folder opened full-screen
  const [folderReader, setFolderReader] = useState(null);   // the folder opened in the content reader
  const [addToFolder, setAddToFolder] = useState(null); // the content being filed away
  const [addToCommunity, setAddToCommunity] = useState(null); // the content being shared to communities
  const [addTarget, setAddTarget] = useState(null);   // the snapshot awaiting a folder/community pick
  // The blog option belongs to the higher-ed tier (studyLevel.js gate) —
  // resolved via the shared cached hook, so the page never flashes the
  // school layout at a higher-ed learner while the tier revalidates.
  const higherEd = useHigherEd();
  const [toast, setToast] = useState('');
  // Recently deleted (§7.17, D55): chat uploads undone in the last 30 days — a tile at the end of Folders.
  const [deletedCount, setDeletedCount] = useState(0);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const closeDeleted = () => { setDeletedOpen(false); load(); };
  useEffect(() => {
    if (searchParams.get('add')) setSheetOpen(true);
  }, [searchParams]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  /* Records and folders page in from the server (12 / 20 at a time);
     `records`/`folders` hold the accumulated pages, the refs hold the
     cursor state, and the totals drive the "Showing N of M" footers. */
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [foldersTotal, setFoldersTotal] = useState(0);
  const recordsPageRef = useRef({ cursor: null, done: true, loading: false });
  const foldersPageRef = useRef({ cursor: null, done: true, loading: false });

  const loadMoreRecords = useCallback(async () => {
    const st = recordsPageRef.current;
    if (st.loading || st.done) return;
    st.loading = true;
    try {
      const page = await listRecordsPage({ limit: 12, cursor: st.cursor });
      st.cursor = page.nextCursor || null;
      st.done = !page.nextCursor;
      if (typeof page.total === 'number') setRecordsTotal(page.total);
      setRecords((rs) => {
        const seen = new Set(rs.map((r) => r.id));
        return [...rs, ...(page.records || []).filter((r) => !seen.has(r.id))];
      });
    } catch { /* keep what's shown — the sentinel can retry */ }
    st.loading = false;
  }, []);

  const loadMoreFolders = useCallback(async () => {
    const st = foldersPageRef.current;
    if (st.loading || st.done) return;
    st.loading = true;
    try {
      const page = await listFoldersPage({ limit: 20, cursor: st.cursor });
      st.cursor = page.nextCursor || null;
      st.done = !page.nextCursor;
      if (typeof page.total === 'number') setFoldersTotal(page.total);
      setFolders((fs) => {
        const seen = new Set(fs.map((f) => f.id));
        return [...fs, ...(page.folders || []).filter((f) => !seen.has(f.id))];
      });
    } catch { /* keep what's shown */ }
    st.loading = false;
  }, []);

  /* A wholesale folder replacement (add-to-folder refresh) — the full
     list becomes the state and paging stops. */
  const replaceFolders = useCallback((flds) => {
    setFolders(flds || []);
    setFoldersTotal((flds || []).length);
    foldersPageRef.current = { cursor: null, done: true, loading: false };
  }, []);

  const load = useCallback(async () => {
    try {
      // The shelf is three feeds now: the school/higher-ed library, the
      // learner's own records (first page), and their folders (first
      // page). One failing shouldn't blank the others.
      const [lib, recPage, fldPage, gone] = await Promise.all([
        fetchMyLibrary().catch(() => []),
        listRecordsPage({ limit: 12 }).catch(() => ({ records: [], total: 0, nextCursor: null })),
        listFoldersPage({ limit: 20 }).catch(() => ({ folders: [], total: 0, nextCursor: null })),
        listDeleted().catch(() => []),
      ]);
      setItems(lib);
      setRecords(recPage.records || []);
      setRecordsTotal(recPage.total || 0);
      recordsPageRef.current = { cursor: recPage.nextCursor || null, done: !recPage.nextCursor, loading: false };
      setFolders(fldPage.folders || []);
      setFoldersTotal(fldPage.total || 0);
      foldersPageRef.current = { cursor: fldPage.nextCursor || null, done: !fldPage.nextCursor, loading: false };
      setDeletedCount(gone.length);
      // Deep link (Discover search results): /library?folder=<id> opens
      // that folder full-screen once the shelf lands.
      const folderParam = searchParams.get('folder');
      if (folderParam) {
        let target = (fldPage.folders || []).find((f) => `${f.id}` === `${folderParam}`);
        if (!target) {
          const all = await listFolders().catch(() => []);
          target = (all || []).find((f) => `${f.id}` === `${folderParam}`);
        }
        if (target) setFolderPage(target);
      }
      // Deep link (Agent Chat materials): /library?record=<id> opens that record.
      const recordParam = searchParams.get('record');
      if (recordParam) {
        let target = (recPage.records || []).find((r) => `${r.id}` === `${recordParam}`);
        if (!target) {
          const all = await listRecords().catch(() => []);
          target = (all || []).find((r) => `${r.id}` === `${recordParam}`);
        }
        const tool = searchParams.get('tool');
        if (target && READER_TOOLS.has(tool)) setViewerTool(tool);
        const artifactParam = searchParams.get('artifact');
        if (target && /^[0-9a-f-]{36}$/i.test(artifactParam || '')) setViewerArtifact(artifactParam);
        if (target) openRecordRef.current?.(target);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ⋯ on a shelf row → choose where to file that content (folder or
     community). Snapshots are stored at add time (title/sub/kind/link),
     so neither target re-asks the shelf. */
  const fileItemSnapshot = (item) => {
    if (!item) return null;
    if (item.isRecordItem) {
      const ft = recordFileType(item);
      const kind = item.kind === 'link' ? 'link'
        : item.kind === 'paste' ? 'paste'
        : ['pdf','docx','pptx','audio','video','image','text'].includes(ft) ? ft : 'text';
      return { itemType: 'record', itemRef: String(item.id), title: item.name, sub: 'Your record', kind, link: null };
    }
    if (item.kind === 'blog') {
      return { itemType: 'library', itemRef: String(item.id), title: item.title, sub: 'Blog', kind: 'blog', link: `/write/blog/${item.id}` };
    }
    if (item.kind === 'course') {
      return { itemType: 'library', itemRef: String(item.id), title: item.title, sub: 'Course', kind: 'course', link: item.slug ? `/course/${item.slug}` : null };
    }
    const k = item.kind || 'text';
    return {
      itemType: 'library', itemRef: String(item.id), title: item.title,
      sub: k[0].toUpperCase() + k.slice(1), kind: ['pdf','audio','video','image','text','link','paste','blog','course','topic'].includes(k) ? k : 'text', link: null,
    };
  };
  const openAddTarget = (item) => {
    const snapshot = fileItemSnapshot(item);
    if (snapshot) setAddTarget(snapshot);
  };

  /* Opening shelf content parks it on the Now-Studying bar — blogs,
     courses and guides ride with their route so the bar reopens them
     exactly where the learner left. */
  const openLibraryItem = (it) => {
    if (!it) return;
    if (it.isRecordItem) return openRecord(it);
    const path = it.kind === 'blog' ? `/write/blog/${it.id}` : `/course/${it.slug || it.id}`;
    nowActs.setCurrent({
      type: 'library', id: String(it.id), title: it.title,
      sub: it.subtitle || (it.kind ? it.kind[0].toUpperCase() + it.kind.slice(1) : 'Library'),
      emoji: getMeta(it.kind).icon, progress: 0,
      snapshot: { path },
    });
    navigate(path);
  };

  /* Items stored inside a folder open back onto the surface they came
     from: records re-enter their teach session, links navigate. */
  const openFolderItem = async (it) => {
    if (!it) return;
    if (it.itemType === 'record') {
      let r = records.find((x) => String(x.id) === String(it.itemRef));
      if (!r) {
        try { r = ((await listRecords()) || []).find((x) => String(x.id) === String(it.itemRef)) || null; } catch { /* offline */ }
      }
      if (r) { setFolderPage(null); openRecord(r); }
      else setToast('That record is no longer on your shelf');
      return;
    }
    if (it.link) {
      // Parked like a shelf open — the bar follows the learner to the route.
      nowActs.setCurrent({
        type: 'library', id: String(it.itemRef), title: it.title,
        sub: it.sub || 'Library', emoji: FILE_TYPE_META[it.kind]?.icon || getMeta(it.kind).icon, progress: 0,
        snapshot: { path: it.link },
      });
      setFolderPage(null);
      navigate(it.link);
      return;
    }
    if (it.itemType === 'pharmd_topic') {
      // The programme page opens from Discover — park it so the bar can
      // take the learner straight back to the topic.
      nowActs.setCurrent({
        type: 'pharmd', id: String(it.itemRef), title: it.title,
        sub: it.sub || 'PHARM.D', emoji: 'ti-stethoscope',
        progress: 0, snapshot: { topicId: it.itemRef },
      });
      setToast('Open Pharm.D topics from the Discover tab');
      return;
    }
    setToast('Open this from its own page');
  };

  /* The bar's resume, from the shelf: records reopen in their teach
     session, parked routes navigate; anything the dashboard owns
     (sessions, battles, Pharm.D topics) hands off to /app, whose own
     bar knows how to resume it. */
  const openNowFromLibrary = async () => {
    const it = now.item;
    if (!it) return;
    if (it.type === 'record') {
      let r = records.find((x) => x.id === it.id);
      if (!r) { try { r = (await listRecords()).find((x) => x.id === it.id) || null; } catch { /* offline */ } }
      if (r) openRecord(r);
      else setToast('That record is no longer on your shelf');
      return;
    }
    if (it.type === 'library' && it.snapshot?.path) { navigate(it.snapshot.path); return; }
    navigate(APP_HOME);
  };

  /* A search hit names a record; open it through the normal flow. */
  const openSearchHit = async (hit) => {
    let r = records.find((x) => x.id === hit.recordId);
    if (!r) {
      try { r = ((await listRecords()) || []).find((x) => x.id === hit.recordId) || null; } catch { /* offline */ }
    }
    if (!r) { setToast('That record is no longer on your shelf'); return; }
    setQ('');
    openRecord(r);
  };

  /* Opening a record starts a TEACHING session over it — same flow as
     "Start teaching", with the file itself as the material. Links stay links. */
  const openRecord = (r, chatState = 'ask') => {
    if (!r) return;
    setViewerChat(chatState);
    // Park on the Now-Studying bar first (same shape as the dashboard).
    const kindLabel = r.kind === 'link' ? t('records.tab_link') : r.kind === 'paste' ? t('records.tab_paste') : t('records.tab_upload');
    nowActs.setCurrent({
      type: 'record', id: r.id, title: r.name, sub: kindLabel,
      emoji: r.kind === 'link' ? 'ti-link' : r.kind === 'paste' ? 'ti-clipboard' : 'ti-paperclip',
      hasPreview: r.kind !== 'link' && !!r.hasPreview,
      progress: r.progress || 0,
    });
    if (r.kind === 'link' && r.url) { try { window.open(r.url, '_blank', 'noopener'); } catch { /* popup blocked */ } }
    else if (r.kind === 'upload' && !r.fileMissing) setViewer(r);
    else if (r.kind === 'paste') setViewer(r);
    else if (r.kind === 'upload') setViewer(r);     // missing file → the viewer explains itself
    setSheetOpen(false);
  };
  openRecordRef.current = openRecord;

  /* First open of a fresh record: 10% progress + a last-opened stamp. */
  const handleRecordOpened = useCallback((r) => {
    if (!r?.id) return;
    if (!r.progress) {
      setRecords((rs) => rs.map(x => x.id === r.id ? { ...x, progress: 10 } : x));
      setRecordProgress(r.id, 10).catch(() => {});
      nowActs.setProgress(r.id, 10);   // the parked bar item follows along
    }
    touchRecordOpened(r.id).catch(() => {});
  }, [nowActs]);

  /* Watched-through milestones from the player update the shelf. */
  const handleRecordProgress = useCallback((r, pct) => {
    setRecords((rs) => rs.map(x => x.id === r.id ? { ...x, progress: pct } : x));
    setRecordProgress(r.id, pct).catch(() => {});
    nowActs.setProgress(r.id, pct);    // keep the bar's scrubber honest
  }, [nowActs]);

  const toRecordItem = (r) => ({ ...r, isRecordItem: true });
  const displayed = filter === 'all'
    ? [...items, ...records.map(toRecordItem)]
    : filter === 'records'
      ? records.map(toRecordItem)
      : items.filter(a => a.kind === filter);
  const activeLabel = KINDS.find(k => k.key === filter)?.label || 'Library';

  /* Paging (scroll-to-fetch-more): the records-bearing tabs ride the
     server cursor; the kind tabs (courses / guides / blogs — bounded
     personal lists fetched whole) reveal 12 at a time locally. */
  const recordsTab = filter === 'all' || filter === 'records';
  const kindLocal = useLocalList(recordsTab ? [] : displayed, 12, filter);
  const visibleDisplayed = recordsTab ? displayed : kindLocal.visible;
  const recordsSentinelRef = useSentinel(loadMoreRecords, recordsTab && recordsTotal > records.length);
  const foldersSentinelRef = useSentinel(loadMoreFolders, foldersTotal > folders.length);
  const listShown = recordsTab ? displayed.length : kindLocal.shown;
  const listTotal = recordsTab ? (filter === 'records' ? recordsTotal : items.length + recordsTotal) : kindLocal.total;
  const listHasMore = recordsTab ? recordsTotal > records.length : kindLocal.hasMore;

  const isMobile = useIsMobileView();

  return {
    navigate, t, now, nowActs,
    items, setItems, records, setRecords, folders, setFolders,
    loading, filter, setFilter,
    viewer, setViewer, viewerChat, setViewerChat, viewerTool, setViewerTool, viewerArtifact, setViewerArtifact,
    q, setQ, qResults, qBusy, qLimit, setQLimit, qHasMore, qSentinelRef,
    sheetOpen, setSheetOpen, addOpen, setAddOpen, folderSheetOpen, setFolderSheetOpen,
    folderPage, setFolderPage, folderReader, setFolderReader,
    addToFolder, setAddToFolder, addToCommunity, setAddToCommunity, addTarget, setAddTarget,
    higherEd, toast, setToast,
    deletedCount, setDeletedCount, deletedOpen, setDeletedOpen, closeDeleted,
    recordsTotal, setRecordsTotal, foldersTotal, setFoldersTotal,
    loadMoreRecords, loadMoreFolders, replaceFolders, load,
    fileItemSnapshot, openAddTarget, openLibraryItem, openFolderItem, openNowFromLibrary, openSearchHit, openRecord,
    handleRecordOpened, handleRecordProgress,
    toRecordItem, displayed, activeLabel,
    recordsTab, kindLocal, visibleDisplayed, recordsSentinelRef, foldersSentinelRef,
    listShown, listTotal, listHasMore,
    isMobile,
  };
}
