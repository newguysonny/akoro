/**
 * ContentsDiscoveryTab.jsx
 * ─────────────────────────────────────────────────────────────
 * The Contents/Materials discovery feed (Discover hub, higher-ed):
 * everything the community uploads — videos, audio, PDFs, images,
 * text files and pasted notes — in the same Udemy-style feed as the
 * courses discovery page: search, type chips, expandable rails of
 * rich cards.
 *
 * One product rule rides the data, not this UI: uploads owned by
 * Premium subscribers never enter the feed (the API excludes them);
 * everyone — Premium learners included — can browse and open what
 * the rest of the community shared.
 *
 * Open flow: the feed list carries METADATA only (no presigned URLs —
 * browsing is free); tapping a card asks the API to open that one
 * record (a presigned file URL or the paste's full text) and hands it
 * to RecordTeachSession — a discovered record opens as the same
 * teaching session a shelf record does.
 *
 * Data:
 *   GET /api/records/discover           — the feed (metadata + owners)
 *   GET /api/records/discover/:id/open  — one call per open
 */
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../common/Icons.jsx';
import { BRAND, RED, GREEN, GOLD, STUDENT_ID } from '../../constants.js';
import { discoverRecords, discoverRecordOpen } from '../../services/recordsApi.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import Toast from '../common/Toast.jsx';
import RecordTeachSession from '../library/RecordTeachSession.jsx';

const FONT = "'Nunito', sans-serif";
const CARD_W = 172;

/* ── The content types the feed buckets records into ─────────── */
const TYPES = {
  video: { icon: 'ti-player-play', color: BRAND },
  audio: { icon: 'ti-headphones',  color: '#8B5CF6' },
  pdf:   { icon: 'ti-file-text',   color: RED },
  note:  { icon: 'ti-edit',        color: GOLD },
  image: { icon: 'ti-photo',       color: GREEN },
};

const fmtSize = (bytes) => {
  const b = Number(bytes) || 0;
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
};
const fmtDuration = (s) => {
  const v = Number(s) || 0;
  if (!v) return null;
  const m = Math.floor(v / 60), sec = Math.round(v % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

/* ── Record card (Udemy vertical, same family as the course card) ── */
function RecordCard({ item, type, wide, opening, onOpen }) {
  const { t } = useLang();
  const meta = TYPES[type] || TYPES.note;
  const mine = item.ownerId === STUDENT_ID;
  const dur = fmtDuration(item.duration);
  const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : null;
  return (
    <button
      onClick={() => onOpen(item)}
      style={{
        textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
        fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 7,
        width: wide ? '100%' : CARD_W, flexShrink: 0,
      }}>
      <div style={{
        width: '100%', aspectRatio: '16/10', borderRadius: 12, overflow: 'hidden', position: 'relative',
        background: `linear-gradient(135deg, ${meta.color}26, ${meta.color}0D)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${meta.color}33`,
      }}>
        <span style={{ fontSize: 46 }}>
          {opening
            ? <span className="ti ti-loader-2" style={{ fontSize: 40, color: meta.color, animation: 'cfeed-spin 1s linear infinite' }}/>
            : <Icon name={meta.icon} size={46} color={meta.color}/>}
        </span>
        <span style={{
          position: 'absolute', top: 7, left: 7, fontSize: 9, fontWeight: 900, letterSpacing: .3,
          color: '#fff', background: 'rgba(17,12,40,.72)', padding: '3px 7px', borderRadius: 6,
          textTransform: 'uppercase',
        }}>{t(`discovery.contents_${type === 'note' ? 'notes' : type + 's'}`)}</span>
        {mine && (
          <span style={{
            position: 'absolute', top: 7, right: 7, fontSize: 9, fontWeight: 900,
            color: '#fff', background: GREEN, padding: '3px 7px', borderRadius: 6,
          }}>{t('discovery.contents_you')}</span>
        )}
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)', lineHeight: 1.25,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 34 }}>
        {item.name}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {t('discovery.by')} {mine ? t('discovery.contents_you').toLowerCase() : item.ownerName}
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
        {[dur, fmtSize(item.size), date].filter(Boolean).join(' · ')}
      </div>
    </button>
  );
}

/* ── Section rail: header + See all + horizontal strip / grid ── */
function Rail({ title, accent, count, loading, expanded, onToggle, children, emptyText }) {
  const { t } = useLang();
  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 14px', gap: 10 }}>
        <h2 style={{ fontSize: 21, fontWeight: 900, color: 'var(--ak-text)', margin: 0, lineHeight: 1.15 }}>{title}</h2>
        {count > 0 && (
          <button onClick={onToggle} style={{ background: 'none', border: 'none', color: BRAND, fontSize: 13, fontWeight: 900, cursor: 'pointer', fontFamily: FONT, flexShrink: 0, whiteSpace: 'nowrap' }}>
            {expanded ? t('discovery.show_less') : t('discovery.see_all')}
          </button>
        )}
      </div>
      {loading ? (
        <div style={{ display: 'flex', gap: 12, padding: '14px 14px 4px', overflow: 'hidden' }}>
          {[0, 1, 2].map(i => <div key={i} style={{ width: CARD_W, flexShrink: 0, height: 170, borderRadius: 12, background: 'var(--ak-surface)', opacity: .55 }} />)}
        </div>
      ) : count === 0 ? (
        <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ak-text-muted)', padding: '10px 14px 0', margin: 0 }}>{emptyText}</p>
      ) : expanded ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '18px 12px', padding: '14px 14px 4px' }}>{children}</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, padding: '14px 14px 6px', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>{children}</div>
      )}
    </section>
  );
}

/* ── The feed ─────────────────────────────────────────────────── */
export default function ContentsDiscoveryTab({ initialQuery = '' }) {
  const { t } = useLang();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [chip, setChip] = useState('all');        // all | video | audio | pdf | note | image
  const [expanded, setExpanded] = useState({});   // { video, audio, pdf, note, image }
  const [openingId, setOpeningId] = useState(null);
  const [session, setSession] = useState(null);   // the record opened as a teaching session
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let alive = true;
    discoverRecords()
      .then(d => { if (alive) setItems(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setLoadErr(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (it) =>
    (!q || `${it.name} ${it.ownerName}`.toLowerCase().includes(q));

  /* Bucket by type — pastes and uploaded text files are the notes rail. */
  const buckets = useMemo(() => {
    const b = { video: [], audio: [], pdf: [], note: [], image: [] };
    for (const it of items) {
      const ty = it.kind === 'paste' ? 'note'
        : it.fileType === 'text' ? 'note'
        : TYPES[it.fileType] ? it.fileType : null;
      if (ty && matches(it)) b[ty].push(it);
    }
    return b;
  }, [items, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k) => setExpanded(e => ({ ...e, [k]: !e[k] }));

  /* Open a card — one call to the API (presigned URL or the paste's full
     text), then the same teaching session a shelf record opens. */
  const open = async (item) => {
    if (openingId || session) return;
    setOpeningId(item.id);
    try {
      const d = await discoverRecordOpen(item.id);
      if (item.kind === 'paste') {
        setSession({ ...item, content: d?.content || item.contentPreview || '', fileUrl: null });
      } else {
        if (!d?.url) throw new Error('no url');
        setSession({ ...item, fileUrl: d.url });
      }
    } catch {
      setToast({ msg: t('discovery.contents_open_fail'), color: RED });
    } finally {
      setOpeningId(null);
    }
  };

  const chips = [
    { key: 'all',   label: t('discovery.contents_all') },
    ...Object.keys(TYPES).map(k => ({
      key: k,
      label: t(`discovery.contents_${k === 'note' ? 'notes' : k + 's'}`),
    })),
  ];

  return (
    <div style={{ padding: '4px 0 90px', fontFamily: FONT }}>
      <style>{'@keyframes cfeed-spin{to{transform:rotate(360deg)}}'}</style>

      {/* Header — the hub card's own title, like the focused feeds */}
      <div style={{ padding: '12px 16px 2px' }}>
        <h1 style={{ fontSize: 21, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>
          {t('dhub.card_contents')}
        </h1>
        <p style={{ fontSize: 12.5, color: 'var(--ak-text-sub)', margin: '3px 0 0' }}>
          {t('dhub.card_contents_desc')}
        </p>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 14px 0' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .5 }}><Icon name="ti-search" size={14}/></span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('discovery.search')}
            style={{ width: '100%', boxSizing: 'border-box', padding: '11px 13px 11px 36px', borderRadius: 13, border: '1px solid var(--ak-border3)', background: 'var(--ak-surface)', fontSize: 13, fontWeight: 600, color: 'var(--ak-text)', fontFamily: FONT, outline: 'none' }}
          />
        </div>
      </div>

      {/* Type chips — same pill row as the feed's category chips */}
      <div style={{ display: 'flex', gap: 9, marginTop: 12, padding: '0 14px 2px', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {chips.map(({ key, label }) => {
          const on = chip === key;
          const meta = TYPES[key];
          return (
            <button key={key} onClick={() => setChip(key)} style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '11px 18px', borderRadius: 100,
              border: on ? `1.5px solid ${meta ? meta.color : BRAND}` : '1.5px solid var(--ak-border3)',
              background: on ? `${meta ? meta.color : BRAND}12` : 'var(--ak-surface)',
              cursor: 'pointer', fontFamily: FONT,
            }}>
              {meta && <Icon name={meta.icon} size={14} color={meta.color}/>}
              <span style={{ fontSize: 13.5, fontWeight: 800, color: on ? (meta ? meta.color : BRAND) : 'var(--ak-text)', whiteSpace: 'nowrap' }}>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Rails — a selected chip shows just its type; All shows every rail */}
      {loading ? (
        <Rail title={t('discovery.contents_all')} accent={BRAND} count={0} loading expanded={false} onToggle={() => {}}>
          <span/>
        </Rail>
      ) : loadErr ? (
        <div style={{ margin: '26px 14px 0', padding: '26px 18px', borderRadius: 16, border: '1px dashed var(--ak-border2)', textAlign: 'center', background: 'var(--ak-surface)' }}>
          <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sec, #6B7280)', margin: 0 }}>
            {t('discovery.contents_open_fail')}
          </p>
        </div>
      ) : items.length === 0 ? (
        <div style={{ margin: '26px 14px 0', padding: '26px 18px', borderRadius: 16, border: '1px dashed var(--ak-border2)', textAlign: 'center', background: 'var(--ak-surface)' }}>
          <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sec, #6B7280)', margin: 0 }}>
            {t('discovery.contents_empty')}
          </p>
        </div>
      ) : (
        Object.keys(TYPES)
          .filter(k => chip === 'all' || chip === k)
          .filter(k => buckets[k].length > 0 || chip === k)
          .map(k => (
            <Rail
              key={k}
              title={t(`discovery.contents_${k === 'note' ? 'notes' : k + 's'}`)}
              accent={TYPES[k].color}
              count={buckets[k].length}
              loading={false}
              expanded={!!expanded[k]}
              onToggle={() => toggle(k)}
              emptyText={t('discovery.contents_empty')}>
              {(expanded[k] ? buckets[k] : buckets[k].slice(0, 10)).map(it => (
                <RecordCard key={it.id} item={it} type={k} wide={!!expanded[k]}
                  opening={openingId === it.id} onOpen={open}/>
              ))}
            </Rail>
          ))
      )}

      {/* The opened record — the same teaching session a shelf record opens.
          Uploads pass their presigned URL as the download link too: the
          shelf's /:id/file route is owner-scoped and would 403 here. */}
      {session && (
        <RecordTeachSession
          record={session}
          downloadUrl={session.kind === 'upload' ? session.fileUrl : null}
          onClose={() => setSession(null)}
          onMinimize={() => setSession(null)}
        />
      )}

      {toast && <Toast msg={toast.msg} color={toast.color} onDone={() => setToast(null)} />}
    </div>
  );
}
