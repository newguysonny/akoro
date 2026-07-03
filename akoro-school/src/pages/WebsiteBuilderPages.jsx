/**
 * Website Builder pages — Media library, Site Pages and Menus for the school's
 * public website. Each is a config-driven ResourcePage (mgmt CRUD). "Template"
 * in the sidebar reuses the existing Website Templates page.
 */
import ResourcePage from '../components/mgmt/ResourcePage.jsx';
import { INK, MUTED2, BORDER, LIGHT, GREEN, AMBER, BLUE, PURPLE } from '../constants.js';

const pill = (v, map) => {
  const c = map[v] || MUTED2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: `${c}15`, color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{String(v || '—').replace('_', ' ')}</span>;
};

/* ── Media library ───────────────────────────────────────────────────────── */
const MEDIA_TYPES = [
  { value: 'image', label: 'Image' }, { value: 'video', label: 'Video' },
  { value: 'document', label: 'Document' }, { value: 'other', label: 'Other' },
];
export function MediaPage() {
  return <ResourcePage title="Media Library" subtitle="Images, videos and files for your website"
    resource="site-media"
    columns={[
      { key: 'url', label: 'Preview', render: (r) => r.media_type === 'image' && r.url
        ? <img src={r.url} alt={r.alt_text || ''} style={{ width: 46, height: 46, borderRadius: 8, objectFit: 'cover', border: `1px solid ${BORDER}`, background: LIGHT }} />
        : <div style={{ width: 46, height: 46, borderRadius: 8, background: LIGHT, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: MUTED2, textTransform: 'uppercase' }}>{(r.media_type || 'file').slice(0, 3)}</div> },
      { key: 'title', label: 'Title', render: (r) => <b style={{ color: INK }}>{r.title}</b> },
      { key: 'media_type', label: 'Type', render: (r) => pill(r.media_type, { image: BLUE, video: PURPLE, document: AMBER, other: MUTED2 }) },
      { key: 'url', label: 'URL', render: (r) => <a href={r.url} target="_blank" rel="noreferrer" style={{ color: BLUE, fontSize: 12 }}>{(r.url || '').slice(0, 48)}{(r.url || '').length > 48 ? '…' : ''}</a> },
    ]}
    fields={[
      { key: 'title', label: 'Title', required: true },
      { key: 'media_type', label: 'Type', type: 'select', default: 'image', options: MEDIA_TYPES },
      { key: 'url', label: 'File URL', required: true, placeholder: 'https://…' },
      { key: 'alt_text', label: 'Alt Text', placeholder: 'Describe the media (for accessibility/SEO)' },
    ]}
    listFilters={[{ key: 'media_type', label: 'Type', options: MEDIA_TYPES }]}
    createLabel="Add Media" searchKeys={['title', 'url', 'alt_text']} />;
}

/* ── Site pages ──────────────────────────────────────────────────────────── */
const PAGE_STATUS = [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }];
export function SitePagesPage() {
  return <ResourcePage title="Pages" subtitle="Content pages on your school website"
    resource="site-pages"
    columns={[
      { key: 'title', label: 'Title', render: (r) => <b style={{ color: INK }}>{r.title}</b> },
      { key: 'slug', label: 'Slug', render: (r) => r.slug ? <code style={{ fontSize: 12, color: MUTED2 }}>/{r.slug}</code> : '—' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { published: GREEN, draft: MUTED2 }) },
      { key: 'sort_order', label: 'Order' },
    ]}
    fields={[
      { key: 'title', label: 'Page Title', required: true },
      { key: 'slug', label: 'URL Slug', placeholder: 'about-us (leave blank to auto-use the title)' },
      { key: 'content', label: 'Content', type: 'textarea', full: true, placeholder: 'Page content (HTML or text)' },
      { key: 'status', label: 'Status', type: 'select', default: 'draft', options: PAGE_STATUS },
      { key: 'sort_order', label: 'Sort Order', type: 'number', default: 0 },
    ]}
    listFilters={[{ key: 'status', label: 'Status', options: PAGE_STATUS }]}
    createLabel="New Page" searchKeys={['title', 'slug']} />;
}

/* ── Menus ───────────────────────────────────────────────────────────────── */
const TARGETS = [{ value: '_self', label: 'Same tab' }, { value: '_blank', label: 'New tab' }];
export function MenusPage() {
  return <ResourcePage title="Menus" subtitle="Navigation links on your website header"
    resource="site-menus"
    columns={[
      { key: 'label', label: 'Label', render: (r) => <b style={{ color: INK }}>{r.label}</b> },
      { key: 'parent_label', label: 'Under', render: (r) => r.parent_label || <span style={{ color: MUTED2 }}>Top level</span> },
      { key: 'page_id_name', label: 'Links to Page' },
      { key: 'url', label: 'or URL', render: (r) => r.url || '—' },
      { key: 'target', label: 'Opens', render: (r) => (TARGETS.find((t) => t.value === r.target) || {}).label || r.target },
      { key: 'sort_order', label: 'Order' },
    ]}
    fields={[
      { key: 'label', label: 'Menu Label', required: true },
      { key: 'page_id', label: 'Link to a Page', type: 'select', optionsFrom: { resource: 'site-pages', labelKey: 'title' }, placeholder: 'Choose a page…' },
      { key: 'url', label: 'or Custom URL', placeholder: 'https://… (used if no page is selected)' },
      { key: 'parent_label', label: 'Parent Menu (for dropdowns)', placeholder: 'Leave blank for a top-level item' },
      { key: 'target', label: 'Open In', type: 'select', default: '_self', options: TARGETS },
      { key: 'sort_order', label: 'Sort Order', type: 'number', default: 0 },
    ]}
    createLabel="Add Menu Item" searchKeys={['label', 'url', 'parent_label']} />;
}
