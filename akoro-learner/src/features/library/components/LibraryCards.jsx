import { Icon } from '../../../components/common/Icons.jsx';
import { BRAND, RED, GREEN, GOLD } from '../../../constants.js';
import { CARD_BASE, getMeta, getStatus, recordMeta, fmtDur, fmtSize } from './libraryMeta.js';

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
export function LibraryItem({ item, onOpen, onMore }) {
  if (item.isRecordItem)     return <RecordCard item={item} onOpen={onOpen} onMore={onMore} />;
  if (item.kind === 'course') return <CourseCard item={item} onOpen={onOpen} onMore={onMore} />;
  if (item.kind === 'guide')  return <GuideCard item={item} onMore={onMore} />;
  if (item.kind === 'blog')   return <BlogCard item={item} onOpen={onOpen} onMore={onMore} />;
  return <ItemCard item={item} onMore={onMore} />;
}
