import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchMyLibrary } from '../services/libraryApi.js';
import { Icon } from '../components/common/Icons.jsx';
import { BRAND, RED, GREEN, GOLD, STUDENT_ID } from '../constants.js';
import { useLang } from '../contexts/LanguageContext.jsx';
import AddRecordModal from '../components/dashboard/AddRecordModal.jsx';

/* Icon + accent per library kind (tabler icons, matches the app's icon style) */
const TYPE_META = {
  course:     { icon: 'ti-player-play', color: BRAND    },
  guide:      { icon: 'ti-book-2',      color: '#A855F7' },
  folder:     { icon: 'ti-folder',      color: GREEN    },
  collection: { icon: 'ti-stack',       color: GOLD     },
};

const KINDS = [
  { key: 'all',        label: 'All'             },
  { key: 'course',     label: 'Courses'         },
  { key: 'guide',      label: 'Teaching guides' },
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

const CARD_BASE = {
  display: 'flex', gap: 12, padding: '13px 15px',
  background: 'var(--ak-surface)', borderRadius: 14, border: '1px solid var(--ak-border)',
  alignItems: 'center', width: '100%', textAlign: 'left', fontFamily: "'Nunito',sans-serif",
};

function CourseCard({ item, onOpen }) {
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
    </button>
  );
}

function GuideCard({ item }) {
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
    </div>
  );
}

/* Generic row for kinds whose data hasn't landed yet (folders, collections). */
function ItemCard({ item }) {
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
    </div>
  );
}

function LibraryItem({ item, onOpen }) {
  if (item.kind === 'course') return <CourseCard item={item} onOpen={onOpen} />;
  if (item.kind === 'guide')  return <GuideCard item={item} />;
  return <ItemCard item={item} />;
}

export default function LibraryPage() {
  const navigate = useNavigate();
  const { t } = useLang();
  const [searchParams] = useSearchParams();
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  // ── Add a record — the + in the header ────────────────────────────────────
  // Moved here from the Learn tab's FAB so every learner (school and
  // higher-ed alike) can add material from the shelf that holds it. The
  // Now-Studying bar's + deep-links here with ?add=1 to open the sheet.
  // Records stay device-local and keyed by the signed-in learner's id — the
  // same key the Learn tab used, so nothing saved before is lost.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState('');
  useEffect(() => {
    if (searchParams.get('add')) setSheetOpen(true);
  }, [searchParams]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const recordsKey = `akoro_records_${STUDENT_ID || 'me'}`;
  const loadRecordsLocal = () => {
    try { const raw = JSON.parse(localStorage.getItem(recordsKey) || '[]'); return Array.isArray(raw) ? raw : []; }
    catch { return []; }
  };
  const setRecordProgress = (id, progress) => {
    const list = loadRecordsLocal().map(r => r.id === id
      ? { ...r, progress: Math.max(0, Math.min(100, progress)), last_opened_at: new Date().toISOString() }
      : r);
    try { localStorage.setItem(recordsKey, JSON.stringify(list)); } catch { /* private mode */ }
  };

  // Opening a record: links open in a new tab right away; uploads/pastes say
  // the in-app viewer is on its way instead of pretending the file opened.
  const openRecord = (r) => {
    if (!r) return;
    if (!r.progress) setRecordProgress(r.id, 10);
    if (r.kind === 'link' && r.url) { try { window.open(r.url, '_blank', 'noopener'); } catch { /* popup blocked */ } }
    else setToast(t('records.viewer_soon'));
    setSheetOpen(false);
  };

  // Self-reported completion (there's no playback to measure).
  const toggleRecordDone = (r) => {
    setRecordProgress(r.id, (r.progress || 0) >= 100 ? 10 : 100);
  };

  const load = useCallback(async () => {
    try {
      setItems(await fetchMyLibrary());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const displayed = filter === 'all' ? items : items.filter(a => a.kind === filter);
  const activeLabel = KINDS.find(k => k.key === filter)?.label || 'Library';

  const TAB = (active) => ({
    padding: '6px 16px', borderRadius: 100, border: 'none', cursor: 'pointer',
    fontFamily: "'Nunito',sans-serif", fontSize: 12, fontWeight: active ? 800 : 600,
    background: active ? BRAND : '#F0EBFF', color: active ? '#fff' : '#9CA3AF',
    flexShrink: 0, whiteSpace: 'nowrap',
  });

  return (
    <div style={{ width: '100vw', height: '100vh', fontFamily: "'Nunito',sans-serif", background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                {items.length > 0 ? `${items.length} saved` : 'Your shelf is empty'}
              </p>
            </div>
          </div>
          {/* Plus — add a record (upload / link / paste), for every learner */}
          <button onClick={() => setSheetOpen(true)} aria-label={t('records.title')} title={t('records.title')}
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
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3,4].map(i => <div key={i} style={{ height: 70, borderRadius: 14, background: 'var(--ak-border)', opacity: .4 }} />)}
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10, color: getMeta(filter).color }}>
              <Icon name={getMeta(filter).icon} size={40}/>
            </div>
            <p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>
              {filter === 'all' ? 'Nothing saved yet' : `No ${activeLabel.toLowerCase()} yet`}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {displayed.map(a => <LibraryItem key={a.id} item={a} onOpen={(slug) => navigate(`/course/${slug}`)} />)}
          </div>
        )}
      </div>

      {/* Bottom toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 3000, background: 'var(--ak-text)', color: '#fff', fontSize: 12.5, fontWeight: 800, padding: '9px 18px', borderRadius: 100, boxShadow: '0 6px 20px rgba(0,0,0,.25)' }}>
          {toast}
        </div>
      )}

      {/* Add-record sheet — upload / link / paste, for every learner */}
      <AddRecordModal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        user={{ id: STUDENT_ID }}
        onOpenRecord={openRecord}
        onToggleDone={toggleRecordDone}
      />
    </div>
  );
}
