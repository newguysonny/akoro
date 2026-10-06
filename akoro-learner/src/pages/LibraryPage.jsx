import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchMyLibrary } from '../services/libraryApi.js';
import { listRecords, listFolders, setRecordProgress, touchRecordOpened } from '../services/recordsApi.js';
import { Icon, XIcon } from '../components/common/Icons.jsx';
import { BRAND, RED, GREEN, GOLD, STUDENT_ID } from '../constants.js';
import { useLang } from '../contexts/LanguageContext.jsx';
import AddRecordModal from '../components/dashboard/AddRecordModal.jsx';
import CreateFolderSheet from '../components/library/CreateFolderSheet.jsx';
import LibraryFolderPage from '../components/library/LibraryFolderPage.jsx';
import AddToFolderPage from '../components/library/AddToFolderPage.jsx';
import RecordTeachSession, { recordFileType } from '../components/library/RecordTeachSession.jsx';
import { useHigherEd } from '../hooks/useStudyTier.js';
import { AppShell } from '../components/AppShell.jsx';
import { useNowStudying } from '../utils/nowStudying.js';

/* Icon + accent per library kind (tabler icons, matches the app's icon style) */
const TYPE_META = {
  course:     { icon: 'ti-player-play', color: BRAND    },
  guide:      { icon: 'ti-book-2',      color: '#A855F7' },
  folder:     { icon: 'ti-folder',      color: GREEN    },
  collection: { icon: 'ti-stack',       color: GOLD     },
  blog:       { icon: 'ti-news',        color: '#0EA5E9' },
};

const KINDS = [
  { key: 'all',        label: 'All'             },
  { key: 'course',     label: 'Courses'         },
  { key: 'guide',      label: 'Teaching guides' },
  { key: 'blog',       label: 'Blogs'           },
  { key: 'records',    label: 'My records'      },
  { key: 'folder',     label: 'Folders'         },
  { key: 'collection', label: 'Collections'     },
];

/* Same status map the Activity page uses, so a card reads the same in
   both places. */
const STATUS = {
  assigned: { label: 'Not started', color: '#6B7280', bg: 'rgba(107,114,128,.10)' },
  started:  { label: 'In progress', color: BRAND,     bg: `${BRAND}12` },
  complete: { label: 'Done',        color: GREEN,     bg: 'rgba(16,185,129,.10)' },
};

const getMeta = (kind) => TYPE_META[kind] || { icon: 'ti-books', color: '#9CA3AF' };
const getStatus = (stat) => STATUS[stat] || STATUS.assigned;

/* What each record IS — the icon says it before the name does. */
const FILE_TYPE_META = {
  pdf:   { icon: 'ti-file-type-pdf', color: '#EF4444' },
  audio: { icon: 'ti-music',         color: '#10B981' },
  video: { icon: 'ti-video',         color: '#6366F1' },
  image: { icon: 'ti-photo',         color: '#0EA5E9' },
  text:  { icon: 'ti-file-text',     color: '#F59E0B' },
  other: { icon: 'ti-paperclip',     color: '#9CA3AF' },
};
const RECORD_KIND_META = {
  link:  { icon: 'ti-link',     color: '#0EA5E9' },
  paste: { icon: 'ti-clipboard', color: '#A855F7' },
};
const recordMeta = (r) => {
  if (r.kind === 'upload') {
    if (r.fileMissing) return { icon: 'ti-cloud-off', color: '#F59E0B' };
    return FILE_TYPE_META[recordFileType(r)] || FILE_TYPE_META.other;
  }
  return RECORD_KIND_META[r.kind] || FILE_TYPE_META.other;
};

/* 42 → "0:42" */
const fmtDur = (sec) => {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return null;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};
const fmtSize = (b) => {
  if (!b || b <= 0) return '';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const CARD_BASE = {
  display: 'flex', gap: 12, padding: '13px 15px',
  background: 'var(--ak-surface)', borderRadius: 14, border: '1px solid var(--ak-border)',
  alignItems: 'center', width: '100%', textAlign: 'left', fontFamily: "'Nunito',sans-serif",
};

/* The ⋯ on every shelf row — opens Add to Folder for that content. */
function MoreBtn({ item, onMore }) {
  if (!onMore) return null;
  return (
    <button aria-label={`More for ${item.name || item.title || 'this item'}`}
      onClick={(e) => { e.stopPropagation(); onMore(item); }}
      style={{ background: 'none', border: 'none', padding: 6, margin: '-6px -4px -6px 0', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--ak-text-muted)' }}>
      <Icon name="ti-dots-vertical" size={16}/>
    </button>
  );
}

function CourseCard({ item, onOpen, onMore }) {
  const live = item.courseType === 'live';
  const st = getStatus(item.status);
  const open = () => { if (item.slug) onOpen(item.slug); };
  return (
    <button onClick={open} style={{ ...CARD_BASE, cursor: 'pointer' }}>
      <div style={{
        width: 46, height: 46, borderRadius: 11, flexShrink: 0, overflow: 'hidden',
        background: `linear-gradient(135deg, ${BRAND}18, ${BRAND}08)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {item.cover
          ? <img src={item.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(ev) => { ev.currentTarget.style.display = 'none'; }} />
          : (live ? <Icon name="ti-circle-dot" size={22} color={RED}/>
                  : <Icon name="ti-player-play" size={22} color={BRAND}/>)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title}
          </span>
          <span style={{ fontSize: 8.5, fontWeight: 900, color: live ? RED : BRAND, background: live ? 'rgba(239,68,68,.12)' : 'rgba(108,59,255,.12)', padding: '1px 5px', borderRadius: 5, flexShrink: 0 }}>
            {live ? 'LIVE' : 'VIDEO'}
          </span>
        </div>
        {item.subtitle && (
          <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.subtitle}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: st.color, background: st.bg, borderRadius: 100, padding: '2px 9px' }}>
            {st.label}
          </span>
          <div style={{ flex: 1, height: 4, background: 'var(--ak-border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${item.progress || 0}%`, background: GREEN, borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-muted)', flexShrink: 0 }}>{item.progress || 0}%</span>
        </div>
      </div>
    
<MoreBtn item={item} onMore={onMore}/>
      </button>
  );
}

function GuideCard({ item, onMore }) {
  const { color } = getMeta('guide');
  return (
    <div style={CARD_BASE}>
      <div style={{
        width: 46, height: 46, borderRadius: 11, flexShrink: 0,
        background: `${color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22,
      }}>
        {item.emoji || <Icon name="ti-book-2" size={22} color={color}/>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title}
        </div>
        {item.subtitle && (
          <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.subtitle}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 7 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: '#A855F7', background: 'rgba(168,85,247,.10)', borderRadius: 100, padding: '2px 9px' }}>
            Guide
          </span>
        </div>
      </div>
    <MoreBtn item={item} onMore={onMore}/>
      </div>
  );
}

/* Generic row for kinds whose data hasn't landed yet (folders, collections). */
function ItemCard({ item, onMore }) {
  const { icon, color } = getMeta(item.kind);
  return (
    <div style={CARD_BASE}>
      <div style={{
        width: 46, height: 46, borderRadius: 11, flexShrink: 0,
        background: `${color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={22} color={color}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title}
        </div>
        {item.subtitle && (
          <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 2 }}>
            {item.subtitle}
          </div>
        )}
      </div>
    <MoreBtn item={item} onMore={onMore}/>
      </div>
  );
}

function BlogCard({ item, onOpen, onMore }) {
  const published = item.blogStatus === 'published';
  const color = published ? GREEN : GOLD;
  return (
    <button onClick={() => onOpen(item)} style={{ ...CARD_BASE, cursor: 'pointer' }}>
      <div style={{
        width: 46, height: 46, borderRadius: 11, flexShrink: 0,
        background: '#0EA5E914', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="ti-news" size={22} color="#0EA5E9"/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title}
        </div>
        {item.details && (
          <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.details}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color, background: `${color}14`, borderRadius: 100, padding: '2px 9px' }}>
            {published ? 'Published' : 'Draft'}
          </span>
        </div>
      </div>
    
<MoreBtn item={item} onMore={onMore}/>
      </button>
  );
}

/* A record on the shelf — its icon says what it is (PDF/audio/video/doc…),
   its progress says where the learner left off, and tapping it opens the
   record as a full study session. */
function RecordCard({ item, onOpen, onMore }) {
  const meta = recordMeta(item);
  const done = (item.progress || 0) >= 100;
  const bits = [
    fmtDur(item.duration),
    fmtSize(item.size),
    item.createdAt ? new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '',
  ].filter(Boolean).join(' · ');
  return (
    <button onClick={() => onOpen(item)} style={{ ...CARD_BASE, cursor: 'pointer' }}>
      <div style={{
        width: 46, height: 46, borderRadius: 11, flexShrink: 0,
        background: `${meta.color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={meta.icon} size={22} color={meta.color}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: done ? 'var(--ak-text-muted)' : 'var(--ak-text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: done ? 'line-through' : 'none' }}>
          {item.name}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {bits || 'Record'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: done ? GREEN : BRAND, background: done ? 'rgba(16,185,129,.10)' : `${BRAND}12`, borderRadius: 100, padding: '2px 9px' }}>
            {done ? 'Done' : (item.progress > 0 ? 'In progress' : 'New')}
          </span>
          <div style={{ flex: 1, height: 4, background: 'var(--ak-border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${item.progress || 0}%`, background: GREEN, borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-muted)', flexShrink: 0 }}>{item.progress || 0}%</span>
        </div>
      </div>
    <MoreBtn item={item} onMore={onMore}/>
      </button>
  );
}

/* Record rows keep their real kind ('upload'/'link'/'paste') — the viewer
   and the icons branch on it — and carry isRecordItem so the list routes
   them to the record card. */
function LibraryItem({ item, onOpen, onMore }) {
  if (item.isRecordItem)     return <RecordCard item={item} onOpen={onOpen} onMore={onMore} />;
  if (item.kind === 'course') return <CourseCard item={item} onOpen={onOpen} onMore={onMore} />;
  if (item.kind === 'guide')  return <GuideCard item={item} onMore={onMore} />;
  if (item.kind === 'blog')   return <BlogCard item={item} onOpen={onOpen} onMore={onMore} />;
  return <ItemCard item={item} onMore={onMore} />;
}

export default function LibraryPage() {
  const navigate = useNavigate();
  const { t } = useLang();
  // Now-Studying parking — the same tracking the dashboard shelf gives
  // records, so a record opened HERE parks on the bar too.
  const [, nowActs] = useNowStudying(STUDENT_ID);
  const [searchParams] = useSearchParams();
  const [items, setItems]       = useState([]);
  const [records, setRecords]   = useState([]);
  const [folders, setFolders]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('all');
  const [viewer, setViewer]     = useState(null);   // the record open as a session

  // ── Add a record — the + in the header ────────────────────────────────────
  // Every learner (school and higher-ed alike) adds material from the shelf
  // that holds it. The Now-Studying bar's + deep-links here with ?add=1.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [folderSheetOpen, setFolderSheetOpen] = useState(false);
  const [folderPage, setFolderPage] = useState(null);   // the folder opened full-screen
  const [addToFolder, setAddToFolder] = useState(null); // the content being filed away
  // The blog option belongs to the higher-ed tier (studyLevel.js gate) —
  // resolved via the shared cached hook, so the page never flashes the
  // school layout at a higher-ed learner while the tier revalidates.
  const higherEd = useHigherEd();
  const [toast, setToast] = useState('');
  useEffect(() => {
    if (searchParams.get('add')) setSheetOpen(true);
  }, [searchParams]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const load = useCallback(async () => {
    try {
      // The shelf is three feeds now: the school/higher-ed library, the
      // learner's own records, and their folders. One failing shouldn't
      // blank the others.
      const [lib, recs, flds] = await Promise.all([
        fetchMyLibrary().catch(() => []),
        listRecords().catch(() => []),
        listFolders().catch(() => []),
      ]);
      setItems(lib);
      setRecords(recs);
      setFolders(flds);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ⋯ on a shelf row → file that content away. Snapshots are stored at
     add time (title/sub/kind/link), so a folder never re-asks the shelf. */
  const openAddToFolder = (item) => {
    if (!item) return;
    if (item.isRecordItem) {
      const ft = recordFileType(item);
      const kind = item.kind === 'link' ? 'link'
        : item.kind === 'paste' ? 'paste'
        : ['pdf','audio','video','image','text'].includes(ft) ? ft : 'text';
      setAddToFolder({ itemType: 'record', itemRef: String(item.id), title: item.name, sub: 'Your record', kind, link: null });
    } else if (item.kind === 'blog') {
      setAddToFolder({ itemType: 'library', itemRef: String(item.id), title: item.title, sub: 'Blog', kind: 'blog', link: `/write/blog/${item.id}` });
    } else if (item.kind === 'course') {
      setAddToFolder({ itemType: 'library', itemRef: String(item.id), title: item.title, sub: 'Course', kind: 'course', link: item.slug ? `/course/${item.slug}` : null });
    } else {
      const k = item.kind || 'text';
      setAddToFolder({
        itemType: 'library', itemRef: String(item.id), title: item.title,
        sub: k[0].toUpperCase() + k.slice(1), kind: ['pdf','audio','video','image','text','link','paste','blog','course','topic'].includes(k) ? k : 'text', link: null,
      });
    }
  };

  /* Items stored inside a folder open back onto the surface they came
     from: records re-enter their teach session, links navigate. */
  const openFolderItem = (it) => {
    if (!it) return;
    if (it.itemType === 'record') {
      const r = records.find((x) => String(x.id) === String(it.itemRef));
      if (r) { setFolderPage(null); openRecord(r); }
      else setToast('That record is no longer on your shelf');
      return;
    }
    if (it.link) { setFolderPage(null); navigate(it.link); return; }
    setToast(it.itemType === 'pharmd_topic' ? 'Open Pharm.D topics from the Discover tab' : 'Open this from its own page');
  };

  /* Opening a record starts a TEACHING session over it — same flow as
     "Start teaching", with the file itself as the material. Links stay links. */
  const openRecord = (r) => {
    if (!r) return;
    // Park on the Now-Studying bar first (same shape as the dashboard).
    const kindLabel = r.kind === 'link' ? t('records.tab_link') : r.kind === 'paste' ? t('records.tab_paste') : t('records.tab_upload');
    nowActs.setCurrent({
      type: 'record', id: r.id, title: r.name, sub: kindLabel,
      emoji: r.kind === 'link' ? 'ti-link' : r.kind === 'paste' ? 'ti-clipboard' : 'ti-paperclip',
      progress: r.progress || 0,
    });
    if (r.kind === 'link' && r.url) { try { window.open(r.url, '_blank', 'noopener'); } catch { /* popup blocked */ } }
    else if (r.kind === 'upload' && !r.fileMissing) setViewer(r);
    else if (r.kind === 'paste') setViewer(r);
    else if (r.kind === 'upload') setViewer(r);     // missing file → the viewer explains itself
    setSheetOpen(false);
  };

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

  const TAB = (active) => ({
    padding: '6px 16px', borderRadius: 100, border: 'none', cursor: 'pointer',
    fontFamily: "'Nunito',sans-serif", fontSize: 12, fontWeight: active ? 800 : 600,
    background: active ? BRAND : '#F0EBFF', color: active ? '#fff' : '#9CA3AF',
    flexShrink: 0, whiteSpace: 'nowrap',
  });

  return (
    <AppShell>
    <div style={{ width: '100%', height: '100%', fontFamily: "'Nunito',sans-serif", background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* HEADER */}
      <div style={{ background: 'var(--ak-surface)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--ak-border)', padding: '14px 18px', zIndex: 100, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => navigate('/app')}
              style={{ background: '#F0EBFF', border: '1px solid #DDD3FF', borderRadius: 100, width: 34, height: 34, cursor: 'pointer', color: BRAND, fontSize: 16, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ‹
            </button>
            <div>
              <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>Library</p>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0 }}>
                {items.length + records.length > 0 ? `${items.length + records.length} saved` : 'Your shelf is empty'}
              </p>
            </div>
          </div>
          {/* Plus — choose: upload a record or (higher-ed) write a blog */}
          <button onClick={() => setAddOpen(true)} aria-label={t('records.title')} title={t('records.title')}
            style={{ background: BRAND, border: 'none', borderRadius: 100, width: 34, height: 34, cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="ti-plus" size={18}/>
          </button>
        </div>

        {/* Pills — scrollable area of library kinds */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          {KINDS.map(k => <button key={k.key} style={TAB(filter === k.key)} onClick={() => setFilter(k.key)}>{k.label}</button>)}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 80px' }}>
        {/* Folders — the shelf's organization layer. Created from the
            Add-to-library sheet; opening one (adding items) comes next. */}
        {!loading && folders.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text-muted)', margin: '0 0 8px', letterSpacing: .3 }}>FOLDERS</p>
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
              {folders.map(f => (
                <button key={f.id} onClick={() => setFolderPage(f)}
                  title={f.description || f.name}
                  style={{ flex: '0 0 128px', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: "'Nunito',sans-serif" }}>
                  {f.coverUrl
                    ? <img src={f.coverUrl} alt="" style={{ display: 'block', width: '100%', height: 72, objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: 72, background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="ti-folder" size={26} color="rgba(255,255,255,.9)"/>
                      </div>}
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
                      <Icon name={f.visibility === 'public' ? 'ti-world' : 'ti-lock'} size={11}/>
                      {f.visibility === 'public' ? 'Public' : 'Private'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3,4].map(i => <div key={i} style={{ height: 70, borderRadius: 14, background: 'var(--ak-border)', opacity: .4 }} />)}
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10, color: filter === 'records' ? BRAND : getMeta(filter).color }}>
              <Icon name={filter === 'records' ? 'ti-file-text' : getMeta(filter).icon} size={40}/>
            </div>
            <p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>
              {filter === 'all' ? 'Nothing saved yet' : `No ${activeLabel.toLowerCase()} yet`}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {displayed.map(a => <LibraryItem key={a.id} item={a} onMore={openAddToFolder} onOpen={(it) => it?.isRecordItem
              ? openRecord(it)
              : it?.kind === 'blog' ? navigate(`/write/blog/${it.id}`) : navigate(`/course/${it?.slug || it?.id}`)} />)}
          </div>
        )}
      </div>

      {/* Bottom toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 3000, background: 'var(--ak-text)', color: '#fff', fontSize: 12.5, fontWeight: 800, padding: '9px 18px', borderRadius: 100, boxShadow: '0 6px 20px rgba(0,0,0,.25)' }}>
          {toast}
        </div>
      )}

      {/* + choice — upload or write a blog */}
      {addOpen && (
        <><div onClick={() => setAddOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2400, background: 'rgba(6,6,18,.55)', backdropFilter: 'blur(5px)' }} />
        <div role="dialog" aria-label="Add to library" style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 2500, width: 'min(92vw,360px)', background: 'var(--ak-surface)', borderRadius: 20, border: '1px solid var(--ak-border)', padding: '18px 16px 14px', fontFamily: "'Nunito',sans-serif", animation: 'drawer-in .22s cubic-bezier(.32,1,.64,1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={{ fontSize: 15, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>Add to library</p>
            <button onClick={() => setAddOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}><XIcon size={16} color="var(--ak-text-muted)" /></button>
          </div>
          <button onClick={() => { setAddOpen(false); setSheetOpen(true); }} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 13px', borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface-hover)', cursor: 'pointer', textAlign: 'left', marginBottom: 8, fontFamily: "'Nunito',sans-serif" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: `${BRAND}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="ti-paperclip" size={19} color={BRAND} /></div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', margin: 0 }}>Upload a record</p>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ak-text-muted)', margin: 0 }}>Files, links or pasted text</p>
            </div>
          </button>
          <button onClick={() => { setAddOpen(false); setFolderSheetOpen(true); }} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 13px', borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface-hover)', cursor: 'pointer', textAlign: 'left', marginBottom: 8, fontFamily: "'Nunito',sans-serif" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: '#F59E0B14', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="ti-folder" size={19} color="#F59E0B" /></div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', margin: 0 }}>Create a folder</p>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ak-text-muted)', margin: 0 }}>Name, cover, description, visibility</p>
            </div>
          </button>
          {higherEd && (
            <button onClick={() => { setAddOpen(false); navigate('/write/blog/new'); }} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 13px', borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface-hover)', cursor: 'pointer', textAlign: 'left', fontFamily: "'Nunito',sans-serif" }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: '#0EA5E914', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="ti-news" size={19} color="#0EA5E9" /></div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', margin: 0 }}>Write a blog</p>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ak-text-muted)', margin: 0 }}>Draft or publish an article on your shelf</p>
              </div>
            </button>
          )}
        </div></>
      )}

      {/* Add-record sheet — upload / link / paste, for every learner */}
      <AddRecordModal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        user={{ id: STUDENT_ID }}
        onOpenRecord={openRecord}
        onRecordsChanged={setRecords}
      />

      {/* Create-folder sheet — name, cover, description, visibility */}
      <CreateFolderSheet
        open={folderSheetOpen}
        onClose={() => setFolderSheetOpen(false)}
        onCreated={(f) => { setFolders((fs) => [f, ...fs]); setToast(`Folder “${f.name}” created`); }}
      />

      {/* A folder opened full-screen — the Pharm.D folder UI, with
          rename + delete in its more sheet. */}
      {folderPage && (
        <LibraryFolderPage
          folder={folderPage}
          onClose={() => setFolderPage(null)}
          onOpenItem={openFolderItem}
          onRenamed={(f) => { setFolders((fs) => fs.map((x) => (x.id === f.id ? f : x))); setFolderPage(f); }}
          onDeleted={(id) => { setFolders((fs) => fs.filter((x) => x.id !== id)); setFolderPage(null); setToast('Folder deleted'); }}
        />
      )}

      {/* ⋯ on any shelf row — pick the folders this content joins. */}
      {addToFolder && (
        <AddToFolderPage
          item={addToFolder}
          onClose={() => setAddToFolder(null)}
          onAdded={() => { listFolders().then(setFolders).catch(() => {}); }}
        />
      )}

      {/* The record as a TEACHING session — the learner teaches their agent
          over the real file; the content box opens it in the reader. */}
      {viewer && (
        <RecordTeachSession
          record={viewer}
          onClose={() => setViewer(null)}
          onMinimize={() => setViewer(null)}
          onOpened={handleRecordOpened}
          onProgress={handleRecordProgress}
        />
      )}
    </div>
    </AppShell>
  );
}
