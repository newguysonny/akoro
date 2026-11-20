import { BRAND, GREEN, GOLD } from '../../../constants.js';
import { recordFileType } from './recordFileType.js';

/* Icon + accent per library kind (tabler icons, matches the app's icon style) */
export const TYPE_META = {
  course:     { icon: 'ti-player-play', color: BRAND    },
  guide:      { icon: 'ti-book-2',      color: '#A855F7' },
  folder:     { icon: 'ti-folder',      color: GREEN    },
  collection: { icon: 'ti-stack',       color: GOLD     },
  blog:       { icon: 'ti-news',        color: '#0EA5E9' },
};

export const KINDS = [
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
export const STATUS = {
  assigned: { label: 'Not started', color: '#6B7280', bg: 'rgba(107,114,128,.10)' },
  started:  { label: 'In progress', color: BRAND,     bg: `${BRAND}12` },
  complete: { label: 'Done',        color: GREEN,     bg: 'rgba(16,185,129,.10)' },
};

export const getMeta = (kind) => TYPE_META[kind] || { icon: 'ti-books', color: '#9CA3AF' };
export const getStatus = (stat) => STATUS[stat] || STATUS.assigned;

/* What each record IS — the icon says it before the name does. */
export const FILE_TYPE_META = {
  pdf:   { icon: 'ti-file-type-pdf', color: '#EF4444' },
  docx:  { icon: 'ti-file-type-docx', color: '#2563EB' },
  pptx:  { icon: 'ti-presentation',   color: '#EA580C' },
  audio: { icon: 'ti-music',         color: '#10B981' },
  video: { icon: 'ti-video',         color: '#6366F1' },
  image: { icon: 'ti-photo',         color: '#0EA5E9' },
  text:  { icon: 'ti-file-text',     color: '#F59E0B' },
  other: { icon: 'ti-paperclip',     color: '#9CA3AF' },
};
export const RECORD_KIND_META = {
  link:  { icon: 'ti-link',     color: '#0EA5E9' },
  paste: { icon: 'ti-clipboard', color: '#A855F7' },
};
export const recordMeta = (r) => {
  if (r.kind === 'upload') {
    if (r.fileMissing) return { icon: 'ti-cloud-off', color: '#F59E0B' };
    return FILE_TYPE_META[recordFileType(r)] || FILE_TYPE_META.other;
  }
  return RECORD_KIND_META[r.kind] || FILE_TYPE_META.other;
};

/* 42 → "0:42" */
export const fmtDur = (sec) => {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return null;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};
export const fmtSize = (b) => {
  if (!b || b <= 0) return '';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

export const CARD_BASE = {
  display: 'flex', gap: 12, padding: '13px 15px',
  background: 'var(--ak-surface)', borderRadius: 14, border: '1px solid var(--ak-border)',
  alignItems: 'center', width: '100%', textAlign: 'left', fontFamily: "'Nunito',sans-serif",
};

/* The reader's study tools a link may open directly (SessionReaderModal's tool ids). */
export const READER_TOOLS = new Set(['summary', 'quiz', 'flashcards', 'notes', 'podcast']);

export const TAB = (active) => ({
  padding: '6px 16px', borderRadius: 100, border: 'none', cursor: 'pointer',
  fontFamily: "'Nunito',sans-serif", fontSize: 12, fontWeight: active ? 800 : 600,
  background: active ? BRAND : '#F0EBFF', color: active ? '#fff' : '#9CA3AF',
  flexShrink: 0, whiteSpace: 'nowrap',
});
