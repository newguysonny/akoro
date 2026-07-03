/**
 * Website Builder pages — Media library, Site Pages (WordPress-style list +
 * dedicated editor) and Menus. Media & Menus are config-driven ResourcePages;
 * Pages is a custom table (edit / trash / restore / delete) whose Edit opens a
 * dedicated editor route with a Back button, like the Domain page.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, RotateCcw, ArrowLeft, Save, Loader2, FileText, X,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, AMBER, BLUE, PURPLE, RED, FONT } from '../constants.js';

const BASE = '/api/school/mgmt';
const slugify = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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

/* ── Pages — WordPress-style list ────────────────────────────────────────── */
const TABS = [
  { key: 'all', label: 'All', view: 'active' },
  { key: 'published', label: 'Published', view: 'active', status: 'published' },
  { key: 'draft', label: 'Draft', view: 'active', status: 'draft' },
  { key: 'trash', label: 'Trash', view: 'trash' },
];

export function SitePagesPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    const t = TABS.find((x) => x.key === tab);
    const params = new URLSearchParams({ view: t.view });
    if (t.status) params.set('status', t.status);
    setRows(null);
    apiGet(`${BASE}/site-pages?${params}`).then((r) => setRows(r.data || [])).catch((e) => { showToast(e.message || 'Could not load'); setRows([]); });
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const act = async (id, fn, okMsg) => {
    setBusyId(id);
    try { await fn(); showToast(okMsg); load(); }
    catch (e) { showToast(e.message || 'Action failed'); }
    finally { setBusyId(null); }
  };
  const trash = (r) => act(r.id, () => apiPost(`${BASE}/site-pages/${r.id}/trash`, {}), 'Moved to Trash');
  const restore = (r) => act(r.id, () => apiPost(`${BASE}/site-pages/${r.id}/restore`, {}), 'Restored');
  const destroy = (r) => { if (window.confirm(`Permanently delete “${r.title}”? This cannot be undone.`)) act(r.id, () => apiDelete(`${BASE}/site-pages/${r.id}`), 'Deleted permanently'); };

  const isTrash = tab === 'trash';
  const th = { textAlign: 'left', padding: '11px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .4 };
  const td = { padding: '12px 14px', fontSize: 13, color: INK, borderTop: `1px solid ${BORDER}` };
  const iconBtn = (color) => ({ width: 30, height: 30, borderRadius: 7, border: 'none', background: `${color}15`, color, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });

  return (
    <PageLayout title="Pages" subtitle="Content pages on your school website">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 3 }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 800,
              background: tab === t.key ? WHITE : 'transparent', color: tab === t.key ? INK : MUTED2,
              boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,.12)' : 'none',
            }}>{t.label}</button>
          ))}
        </div>
        <button onClick={() => navigate('/website-builder/pages/new')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <Plus size={15} /> Add New Page
        </button>
      </div>

      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
          <thead><tr>
            <th style={th}>TITLE</th><th style={th}>SLUG</th><th style={th}>STATUS</th><th style={th}>ORDER</th>
            <th style={{ ...th, textAlign: 'right' }}>ACTIONS</th>
          </tr></thead>
          <tbody>
            {rows === null && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={5}><Loader2 size={18} style={{ animation: 'spin .8s linear infinite' }} /></td></tr>}
            {rows && rows.length === 0 && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={5}>{isTrash ? 'Trash is empty.' : 'No pages yet — click “Add New Page”.'}</td></tr>}
            {(rows || []).map((r) => (
              <tr key={r.id}>
                <td style={{ ...td }}>
                  <button onClick={() => !isTrash && navigate(`/website-builder/pages/${r.id}`)} style={{ border: 'none', background: 'none', padding: 0, cursor: isTrash ? 'default' : 'pointer', fontFamily: FONT, fontSize: 13.5, fontWeight: 800, color: isTrash ? INK : BLUE, textAlign: 'left' }}>
                    {r.title}
                  </button>
                </td>
                <td style={{ ...td, color: MUTED2 }}>{r.slug ? <code>/{r.slug}</code> : '—'}</td>
                <td style={td}>{pill(r.status, { published: GREEN, draft: MUTED2 })}</td>
                <td style={td}>{r.sort_order}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    {busyId === r.id ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : isTrash ? (
                      <>
                        <button title="Restore" onClick={() => restore(r)} style={iconBtn(GREEN)}><RotateCcw size={14} /></button>
                        <button title="Delete permanently" onClick={() => destroy(r)} style={iconBtn(RED)}><Trash2 size={14} /></button>
                      </>
                    ) : (
                      <>
                        <button title="Edit" onClick={() => navigate(`/website-builder/pages/${r.id}`)} style={iconBtn(BLUE)}><Pencil size={14} /></button>
                        <button title="Move to Trash" onClick={() => trash(r)} style={iconBtn(AMBER)}><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Page editor (dedicated route, Back button) ──────────────────────────── */
const PAGE_STATUS = [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }];
const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 700, color: INK, margin: '0 0 6px', fontFamily: FONT };

export function SitePageEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = !id;
  const [form, setForm] = useState({ title: '', slug: '', content: '', status: 'draft', sort_order: 0 });
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [slugEdited, setSlugEdited] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (isNew) return;
    apiGet(`${BASE}/site-pages/${id}`).then((r) => {
      const d = r.data || {};
      setForm({ title: d.title || '', slug: d.slug || '', content: d.content || '', status: d.status || 'draft', sort_order: d.sort_order ?? 0 });
      setSlugEdited(!!d.slug);
    }).catch((e) => showToast(e.message || 'Could not load page'))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const save = async () => {
    if (!form.title.trim()) return showToast('Title is required');
    setSaving(true);
    const body = { ...form, slug: (form.slug || slugify(form.title)) || null, sort_order: Number(form.sort_order) || 0 };
    try {
      if (isNew) await apiPost(`${BASE}/site-pages`, body);
      else await apiPut(`${BASE}/site-pages/${id}`, body);
      navigate('/website-builder/pages');
    } catch (e) { showToast(e.message || 'Could not save'); setSaving(false); }
  };

  return (
    <PageLayout title={isNew ? 'Add New Page' : 'Edit Page'} subtitle="Website Builder · Pages">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/website-builder/pages')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
          <ArrowLeft size={14} /> Back to Pages
        </button>
        <button onClick={save} disabled={saving || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 20px', borderRadius: 9, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 13, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
          {saving ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} {saving ? 'Saving…' : 'Save Page'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2, fontFamily: FONT }}><Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 460px', minWidth: 300, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '20px 22px' }}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Page Title <span style={{ color: RED }}>*</span></label>
              <input value={form.title} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, title: v, slug: slugEdited ? f.slug : slugify(v) })); }} placeholder="e.g. About Us" style={{ ...inputStyle, fontSize: 15 }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>URL Slug</label>
              <input value={form.slug} onChange={(e) => { setSlugEdited(true); set('slug')(e); }} placeholder="about-us" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Content</label>
              <textarea value={form.content} onChange={set('content')} placeholder="Write your page content here (HTML or plain text)…" style={{ ...inputStyle, minHeight: 320, resize: 'vertical', lineHeight: 1.6, fontFamily: 'ui-monospace, Menlo, monospace' }} />
            </div>
          </div>

          <aside style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 320, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <FileText size={15} color={BLUE} /><span style={{ fontSize: 13, fontWeight: 800, color: INK, fontFamily: FONT }}>Page Settings</span>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Status</label>
              <select value={form.status} onChange={set('status')} style={{ ...inputStyle, cursor: 'pointer' }}>
                {PAGE_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Sort Order</label>
              <input type="number" value={form.sort_order} onChange={set('sort_order')} style={inputStyle} />
            </div>
          </aside>
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
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
