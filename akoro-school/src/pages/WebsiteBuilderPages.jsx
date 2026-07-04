/**
 * Website Builder pages — Media library, Site Pages (WordPress-style list +
 * dedicated editor) and Menus. Media & Menus are config-driven ResourcePages;
 * Pages is a custom table (edit / trash / restore / delete) whose Edit opens a
 * dedicated editor route with a Back button, like the Domain page.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, RotateCcw, ArrowLeft, Save, Loader2, FileText, X,
  ChevronUp, ChevronDown, Link2, Menu as MenuIcon, Image as ImageIcon, UploadCloud,
  Sparkles, Type, LayoutGrid, Minus, Code, GripVertical,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, AMBER, BLUE, PURPLE, RED, FONT } from '../constants.js';

const BASE = '/api/school/mgmt';
const slugify = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const pill = (v, map) => {
  const c = map[v] || MUTED2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: `${c}15`, color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{String(v || '—').replace('_', ' ')}</span>;
};

/* ── Shared table styling ────────────────────────────────────────────────── */
const th = { textAlign: 'left', padding: '11px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .4 };
const td = { padding: '12px 14px', fontSize: 13, color: INK, borderTop: `1px solid ${BORDER}` };
const iconBtn = (color) => ({ width: 30, height: 30, borderRadius: 7, border: 'none', background: `${color}15`, color, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });
const Tabs = ({ tabs, tab, setTab }) => (
  <div style={{ display: 'inline-flex', background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 3, flexWrap: 'wrap' }}>
    {tabs.map((t) => (
      <button key={t.key} onClick={() => setTab(t.key)} style={{
        padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 800,
        background: tab === t.key ? WHITE : 'transparent', color: tab === t.key ? INK : MUTED2,
        boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,.12)' : 'none',
      }}>{t.label}</button>
    ))}
  </div>
);
const addBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
const backBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT };
const toastEl = (toast) => toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>;

/* ── Media picker modal (insert media into content) ──────────────────────── */
export function MediaPicker({ open, onClose, onPick }) {
  const [media, setMedia] = useState(null);
  useEffect(() => {
    if (!open) return;
    setMedia(null);
    apiGet(`${BASE}/site-media?view=active`).then((r) => setMedia(r.data || [])).catch(() => setMedia([]));
  }, [open]);
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 720, maxHeight: '85vh', overflowY: 'auto', background: WHITE, borderRadius: 16, padding: '20px 22px', fontFamily: FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: INK }}>Media Library</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: MUTED2 }}><X size={18} /></button>
        </div>
        {media === null ? <div style={{ textAlign: 'center', padding: 40, color: MUTED2 }}><Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
          : media.length === 0 ? <p style={{ color: MUTED2, fontSize: 13, textAlign: 'center', padding: 30 }}>No media yet. Add some in the Media Library first.</p>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
              {media.map((m) => (
                <button key={m.id} onClick={() => onPick(m)} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: WHITE, padding: 8, cursor: 'pointer', textAlign: 'left', fontFamily: FONT }}>
                  <div style={{ height: 84, borderRadius: 6, overflow: 'hidden', background: LIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
                    {m.media_type === 'image' && m.url ? <img src={m.url} alt={m.alt_text || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 11, fontWeight: 800, color: MUTED2, textTransform: 'uppercase' }}>{m.media_type}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</div>
                </button>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

// Build an HTML snippet for a media item to insert into page content.
const mediaSnippet = (m) => m.media_type === 'image'
  ? `\n<img src="${m.url}" alt="${(m.alt_text || m.title || '').replace(/"/g, '&quot;')}" style="max-width:100%" />\n`
  : m.media_type === 'video'
    ? `\n<video src="${m.url}" controls style="max-width:100%"></video>\n`
    : `\n<a href="${m.url}">${m.title || 'Download'}</a>\n`;

/* ── Media library — WordPress-style table ───────────────────────────────── */
const MEDIA_TYPES = [
  { value: 'image', label: 'Image' }, { value: 'video', label: 'Video' },
  { value: 'document', label: 'Document' }, { value: 'other', label: 'Other' },
];
const MEDIA_TABS = [
  { key: 'all', label: 'All', view: 'active' },
  { key: 'image', label: 'Images', view: 'active', media_type: 'image' },
  { key: 'video', label: 'Videos', view: 'active', media_type: 'video' },
  { key: 'document', label: 'Documents', view: 'active', media_type: 'document' },
  { key: 'trash', label: 'Trash', view: 'trash' },
];
const MediaThumb = ({ r, size = 46 }) => (
  r.media_type === 'image' && r.url
    ? <img src={r.url} alt={r.alt_text || ''} style={{ width: size, height: size, borderRadius: 8, objectFit: 'cover', border: `1px solid ${BORDER}`, background: LIGHT }} />
    : <div style={{ width: size, height: size, borderRadius: 8, background: LIGHT, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: MUTED2, textTransform: 'uppercase' }}>{(r.media_type || 'file').slice(0, 3)}</div>
);

export function MediaPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef(null);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const upload = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      const r = await fetch(`${API}/api/school/mgmt/site-media/upload`, { method: 'POST', credentials: 'include', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      showToast(`Uploaded ${data.data?.length || files.length} file(s) ✓`);
      if (tab !== 'all') setTab('all'); else load();
    } catch (e) { showToast(e.message || 'Upload failed'); }
    finally { setUploading(false); }
  };

  const load = useCallback(() => {
    const t = MEDIA_TABS.find((x) => x.key === tab);
    const params = new URLSearchParams({ view: t.view });
    if (t.media_type) params.set('media_type', t.media_type);
    setRows(null);
    apiGet(`${BASE}/site-media?${params}`).then((r) => setRows(r.data || [])).catch((e) => { showToast(e.message || 'Could not load'); setRows([]); });
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const act = async (id, fn, okMsg) => {
    setBusyId(id);
    try { await fn(); showToast(okMsg); load(); }
    catch (e) { showToast(e.message || 'Action failed'); }
    finally { setBusyId(null); }
  };
  const trash = (r) => act(r.id, () => apiPost(`${BASE}/site-media/${r.id}/trash`, {}), 'Moved to Trash');
  const restore = (r) => act(r.id, () => apiPost(`${BASE}/site-media/${r.id}/restore`, {}), 'Restored');
  const destroy = (r) => { if (window.confirm(`Permanently delete “${r.title}”? This cannot be undone.`)) act(r.id, () => apiDelete(`${BASE}/site-media/${r.id}`), 'Deleted permanently'); };
  const isTrash = tab === 'trash';

  return (
    <PageLayout title="Media Library" subtitle="Images, videos and files to use on your website">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Tabs tabs={MEDIA_TABS} tab={tab} setTab={setTab} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => uploadRef.current?.click()} style={{ ...addBtn, background: WHITE, color: BLUE, border: `1.5px solid ${BLUE}55` }}>
            {uploading ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <UploadCloud size={15} />} Upload Files
          </button>
          <button onClick={() => navigate('/website-builder/media/new')} style={addBtn}><Plus size={15} /> Add by URL</button>
        </div>
      </div>

      <input ref={uploadRef} type="file" multiple onChange={(e) => { upload(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />

      {!isTrash && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          onClick={() => uploadRef.current?.click()}
          style={{ border: `2px dashed ${drag ? AMBER : BORDER}`, background: drag ? `${AMBER}0C` : LIGHT, borderRadius: 12, padding: '18px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', fontFamily: FONT, color: MUTED }}
        >
          {uploading ? <Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /> : <UploadCloud size={18} color={drag ? AMBER : MUTED2} />}
          <span style={{ fontSize: 13, fontWeight: 700 }}>{uploading ? 'Uploading…' : 'Drag & drop files here to upload, or click to choose'}</span>
        </div>
      )}

      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
          <thead><tr>
            <th style={th}>PREVIEW</th><th style={th}>TITLE</th><th style={th}>TYPE</th><th style={th}>URL</th>
            <th style={{ ...th, textAlign: 'right' }}>ACTIONS</th>
          </tr></thead>
          <tbody>
            {rows === null && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={5}><Loader2 size={18} style={{ animation: 'spin .8s linear infinite' }} /></td></tr>}
            {rows && rows.length === 0 && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={5}>{isTrash ? 'Trash is empty.' : 'No media yet — click “Add New Media”.'}</td></tr>}
            {(rows || []).map((r) => (
              <tr key={r.id}>
                <td style={td}><MediaThumb r={r} /></td>
                <td style={td}>
                  <button onClick={() => !isTrash && navigate(`/website-builder/media/${r.id}`)} style={{ border: 'none', background: 'none', padding: 0, cursor: isTrash ? 'default' : 'pointer', fontFamily: FONT, fontSize: 13.5, fontWeight: 800, color: isTrash ? INK : BLUE, textAlign: 'left' }}>{r.title}</button>
                  {r.alt_text && <div style={{ fontSize: 11, color: MUTED2, marginTop: 2 }}>{r.alt_text}</div>}
                </td>
                <td style={td}>{pill(r.media_type, { image: BLUE, video: PURPLE, document: AMBER, other: MUTED2 })}</td>
                <td style={td}><a href={r.url} target="_blank" rel="noreferrer" style={{ color: BLUE, fontSize: 12 }}>{(r.url || '').slice(0, 42)}{(r.url || '').length > 42 ? '…' : ''}</a></td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    {busyId === r.id ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : isTrash ? (
                      <>
                        <button title="Restore" onClick={() => restore(r)} style={iconBtn(GREEN)}><RotateCcw size={14} /></button>
                        <button title="Delete permanently" onClick={() => destroy(r)} style={iconBtn(RED)}><Trash2 size={14} /></button>
                      </>
                    ) : (
                      <>
                        <button title="Edit" onClick={() => navigate(`/website-builder/media/${r.id}`)} style={iconBtn(BLUE)}><Pencil size={14} /></button>
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
      {toastEl(toast)}
    </PageLayout>
  );
}

/* ── Media editor (dedicated route, Back button) ─────────────────────────── */
export function MediaEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = !id;
  const [form, setForm] = useState({ title: '', media_type: 'image', url: '', alt_text: '' });
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (isNew) return;
    apiGet(`${BASE}/site-media/${id}`).then((r) => {
      const d = r.data || {};
      setForm({ title: d.title || '', media_type: d.media_type || 'image', url: d.url || '', alt_text: d.alt_text || '' });
    }).catch((e) => showToast(e.message || 'Could not load media'))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const save = async () => {
    if (!form.title.trim()) return showToast('Title is required');
    if (!form.url.trim()) return showToast('File URL is required');
    setSaving(true);
    try {
      if (isNew) await apiPost(`${BASE}/site-media`, form);
      else await apiPut(`${BASE}/site-media/${id}`, form);
      navigate('/website-builder/media');
    } catch (e) { showToast(e.message || 'Could not save'); setSaving(false); }
  };

  return (
    <PageLayout title={isNew ? 'Add New Media' : 'Edit Media'} subtitle="Website Builder · Media Library">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/website-builder/media')} style={backBtn}><ArrowLeft size={14} /> Back to Media</button>
        <button onClick={save} disabled={saving || loading} style={{ ...addBtn, background: saving ? '#E5E7EB' : addBtn.background, color: saving ? '#9CA3AF' : WHITE }}>
          {saving ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} {saving ? 'Saving…' : 'Save Media'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2, fontFamily: FONT }}><Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 420px', minWidth: 300, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '20px 22px' }}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Title <span style={{ color: RED }}>*</span></label>
              <input value={form.title} onChange={set('title')} placeholder="e.g. Campus front gate" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>File URL <span style={{ color: RED }}>*</span></label>
              <input value={form.url} onChange={set('url')} placeholder="https://…" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Alt Text</label>
              <input value={form.alt_text} onChange={set('alt_text')} placeholder="Describe the media (accessibility / SEO)" style={inputStyle} />
            </div>
          </div>

          <aside style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 320, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 18px' }}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Type</label>
              <select value={form.media_type} onChange={set('media_type')} style={{ ...inputStyle, cursor: 'pointer' }}>
                {MEDIA_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <label style={labelStyle}>Preview</label>
            <div style={{ borderRadius: 10, border: `1px solid ${BORDER}`, background: LIGHT, minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 8 }}>
              {form.media_type === 'image' && form.url
                ? <img src={form.url} alt={form.alt_text || ''} style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8 }} />
                : <MediaThumb r={form} size={72} />}
            </div>
          </aside>
        </div>
      )}
      {toastEl(toast)}
    </PageLayout>
  );
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

/* ═══════════════ Visual page blocks (no source code) ═════════════════════ */
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uid = () => Math.random().toString(36).slice(2, 9);

const BLOCK_TYPES = [
  { type: 'hero', label: 'Hero', icon: Sparkles, desc: 'Big headline + button' },
  { type: 'heading', label: 'Heading', icon: Type, desc: 'Section title' },
  { type: 'text', label: 'Text', icon: FileText, desc: 'Paragraph(s)' },
  { type: 'image', label: 'Image', icon: ImageIcon, desc: 'A picture' },
  { type: 'button', label: 'Button', icon: Link2, desc: 'A call-to-action' },
  { type: 'cards', label: 'Cards', icon: LayoutGrid, desc: 'Feature grid' },
  { type: 'divider', label: 'Divider', icon: Minus, desc: 'A line break' },
  { type: 'html', label: 'Custom HTML', icon: Code, desc: 'Advanced / embed' },
];
const blockMeta = (t) => BLOCK_TYPES.find((b) => b.type === t) || { label: t, icon: FileText };

function newBlock(type) {
  const id = uid();
  switch (type) {
    case 'hero': return { id, type, heading: 'Welcome to our school', subheading: 'A short line about what makes you special.', buttonText: 'Get Started', buttonLink: '/apply', align: 'center' };
    case 'heading': return { id, type, text: 'Section heading', level: 'h2', align: 'left' };
    case 'text': return { id, type, body: 'Write something here…' };
    case 'image': return { id, type, url: '', alt: '', align: 'center', width: '100%' };
    case 'button': return { id, type, label: 'Click here', link: '', align: 'left' };
    case 'cards': return { id, type, items: [{ emoji: '⭐', title: 'Feature', text: 'Describe it briefly.' }] };
    case 'divider': return { id, type };
    case 'html': return { id, type, html: '' };
    default: return { id, type };
  }
}

// Block → HTML. Uses theme CSS vars so it matches the site's colours.
function renderBlock(b) {
  switch (b.type) {
    case 'hero': return `<section style="text-align:${b.align || 'center'};padding:72px 24px;background:${b.bg || 'linear-gradient(160deg,#eef2ff,#fff)'}"><div style="max-width:760px;margin:0 auto"><h1 style="font-size:40px;font-weight:900;margin:0 0 14px;color:var(--primary,#1a1a2e)">${esc(b.heading)}</h1>${b.subheading ? `<p style="font-size:18px;color:var(--secondary,#6b7280);margin:0 auto 26px">${esc(b.subheading)}</p>` : ''}${b.buttonText ? `<a href="${esc(b.buttonLink || '#')}" style="display:inline-block;padding:14px 30px;border-radius:50px;font-weight:700;text-decoration:none;background:var(--primary,#1a56db);color:#fff">${esc(b.buttonText)}</a>` : ''}</div></section>`;
    case 'heading': return `<${b.level || 'h2'} style="text-align:${b.align || 'left'};font-weight:800;margin:20px 0 12px;color:var(--primary,#1a1a2e)">${esc(b.text)}</${b.level || 'h2'}>`;
    case 'text': return (b.body || '').split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.75;font-size:16px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    case 'image': return b.url ? `<figure style="margin:16px 0;text-align:${b.align || 'center'}"><img src="${esc(b.url)}" alt="${esc(b.alt)}" style="max-width:${esc(b.width || '100%')};border-radius:10px"></figure>` : '';
    case 'button': return `<div style="text-align:${b.align || 'left'};margin:16px 0"><a href="${esc(b.link || '#')}" style="display:inline-block;padding:12px 26px;border-radius:50px;font-weight:700;text-decoration:none;background:var(--primary,#1a56db);color:#fff">${esc(b.label)}</a></div>`;
    case 'cards': return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:18px 0">${(b.items || []).map((c) => `<div style="border:1px solid #e7e7ef;border-radius:12px;padding:22px"><div style="font-size:28px;line-height:1">${esc(c.emoji || '')}</div><h3 style="margin:8px 0 6px;font-size:17px">${esc(c.title)}</h3><p style="color:#555;line-height:1.6;margin:0;font-size:14px">${esc(c.text)}</p></div>`).join('')}</div>`;
    case 'divider': return `<hr style="border:none;border-top:1px solid #e7e7ef;margin:26px 0">`;
    case 'html': return b.html || '';
    default: return '';
  }
}
const renderBlocks = (blocks) => (blocks || []).map(renderBlock).join('\n');

/* ── Block editor (left panel) ───────────────────────────────────────────── */
const bLabel = { display: 'block', fontSize: 11.5, fontWeight: 700, color: MUTED, margin: '0 0 5px', fontFamily: FONT };
const bInput = { ...inputStyle, fontSize: 13 };
const ALIGN = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }];

function BlockFields({ block, update, onPickImage }) {
  const f = (k) => (e) => update({ [k]: e.target.value });
  switch (block.type) {
    case 'hero': return (<>
      <label style={bLabel}>Headline</label><input value={block.heading || ''} onChange={f('heading')} style={bInput} />
      <label style={bLabel}>Subheading</label><textarea value={block.subheading || ''} onChange={f('subheading')} style={{ ...bInput, minHeight: 56, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}><label style={bLabel}>Button text</label><input value={block.buttonText || ''} onChange={f('buttonText')} placeholder="(optional)" style={bInput} /></div>
        <div style={{ flex: 1 }}><label style={bLabel}>Button link</label><input value={block.buttonLink || ''} onChange={f('buttonLink')} placeholder="/apply" style={bInput} /></div>
      </div>
      <label style={bLabel}>Align</label><select value={block.align || 'center'} onChange={f('align')} style={bInput}>{ALIGN.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
    </>);
    case 'heading': return (<>
      <label style={bLabel}>Text</label><input value={block.text || ''} onChange={f('text')} style={bInput} />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}><label style={bLabel}>Size</label><select value={block.level || 'h2'} onChange={f('level')} style={bInput}><option value="h2">Large (H2)</option><option value="h3">Medium (H3)</option></select></div>
        <div style={{ flex: 1 }}><label style={bLabel}>Align</label><select value={block.align || 'left'} onChange={f('align')} style={bInput}>{ALIGN.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></div>
      </div>
    </>);
    case 'text': return (<>
      <label style={bLabel}>Text <span style={{ fontWeight: 400, color: MUTED2 }}>(blank line = new paragraph)</span></label>
      <textarea value={block.body || ''} onChange={f('body')} style={{ ...bInput, minHeight: 120, resize: 'vertical', lineHeight: 1.6 }} />
    </>);
    case 'image': return (<>
      <label style={bLabel}>Image</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={block.url || ''} onChange={f('url')} placeholder="https://…" style={{ ...bInput, flex: 1 }} />
        <button type="button" onClick={onPickImage} style={{ padding: '0 12px', borderRadius: 9, border: `1.5px solid ${BLUE}55`, background: `${BLUE}0C`, color: BLUE, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' }}>Library</button>
      </div>
      {block.url && <img src={block.url} alt="" style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8, marginTop: 8, border: `1px solid ${BORDER}` }} />}
      <label style={bLabel}>Alt text</label><input value={block.alt || ''} onChange={f('alt')} style={bInput} />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}><label style={bLabel}>Align</label><select value={block.align || 'center'} onChange={f('align')} style={bInput}>{ALIGN.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></div>
        <div style={{ flex: 1 }}><label style={bLabel}>Width</label><input value={block.width || '100%'} onChange={f('width')} placeholder="100% or 400px" style={bInput} /></div>
      </div>
    </>);
    case 'button': return (<>
      <label style={bLabel}>Label</label><input value={block.label || ''} onChange={f('label')} style={bInput} />
      <label style={bLabel}>Link</label><input value={block.link || ''} onChange={f('link')} placeholder="/apply or https://…" style={bInput} />
      <label style={bLabel}>Align</label><select value={block.align || 'left'} onChange={f('align')} style={bInput}>{ALIGN.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
    </>);
    case 'cards': {
      const items = block.items || [];
      const setItem = (i, patch) => update({ items: items.map((it, j) => j === i ? { ...it, ...patch } : it) });
      return (<>
        {items.map((it, i) => (
          <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: 9, padding: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <input value={it.emoji || ''} onChange={(e) => setItem(i, { emoji: e.target.value })} placeholder="⭐" style={{ ...bInput, width: 52, textAlign: 'center' }} />
              <input value={it.title || ''} onChange={(e) => setItem(i, { title: e.target.value })} placeholder="Title" style={{ ...bInput, flex: 1 }} />
              <button type="button" onClick={() => update({ items: items.filter((_, j) => j !== i) })} style={{ border: 'none', background: `${RED}12`, color: RED, borderRadius: 7, width: 28, height: 28, cursor: 'pointer' }}><Trash2 size={12} /></button>
            </div>
            <textarea value={it.text || ''} onChange={(e) => setItem(i, { text: e.target.value })} placeholder="Description" style={{ ...bInput, minHeight: 44, resize: 'vertical' }} />
          </div>
        ))}
        <button type="button" onClick={() => update({ items: [...items, { emoji: '✅', title: 'New card', text: '' }] })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: `1.5px dashed ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}><Plus size={13} /> Add card</button>
      </>);
    }
    case 'html': return (<>
      <label style={bLabel}>HTML / embed code</label>
      <textarea value={block.html || ''} onChange={f('html')} style={{ ...bInput, minHeight: 120, resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
    </>);
    case 'divider': return <p style={{ fontSize: 12, color: MUTED2, fontFamily: FONT, margin: 0 }}>A horizontal line — nothing to configure.</p>;
    default: return null;
  }
}

function BlockEditor({ blocks, onChange, onPickImage }) {
  const [open, setOpen] = useState(null);   // expanded block id
  const [adding, setAdding] = useState(false);
  const update = (id, patch) => onChange(blocks.map((b) => b.id === id ? { ...b, ...patch } : b));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= blocks.length) return; const copy = [...blocks]; [copy[i], copy[j]] = [copy[j], copy[i]]; onChange(copy); };
  const remove = (id) => onChange(blocks.filter((b) => b.id !== id));
  const add = (type) => { const b = newBlock(type); onChange([...blocks, b]); setAdding(false); setOpen(b.id); };

  return (
    <div>
      {blocks.length === 0 && <p style={{ fontSize: 12.5, color: MUTED2, fontFamily: FONT, textAlign: 'center', padding: '18px 0' }}>No sections yet — add your first block below.</p>}
      {blocks.map((b, i) => {
        const M = blockMeta(b.type);
        const isOpen = open === b.id;
        return (
          <div key={b.id} style={{ border: `1px solid ${isOpen ? AMBER : BORDER}`, borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', background: isOpen ? `${AMBER}0C` : LIGHT, cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : b.id)}>
              <GripVertical size={14} color={MUTED2} />
              <M.icon size={14} color={AMBER} />
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 800, color: INK, fontFamily: FONT }}>{M.label}</span>
              <button onClick={(e) => { e.stopPropagation(); move(i, -1); }} disabled={i === 0} style={{ ...miniBtn, opacity: i === 0 ? 0.3 : 1 }}><ChevronUp size={13} /></button>
              <button onClick={(e) => { e.stopPropagation(); move(i, 1); }} disabled={i === blocks.length - 1} style={{ ...miniBtn, opacity: i === blocks.length - 1 ? 0.3 : 1 }}><ChevronDown size={13} /></button>
              <button onClick={(e) => { e.stopPropagation(); remove(b.id); }} style={{ ...miniBtn, color: RED }}><Trash2 size={12} /></button>
            </div>
            {isOpen && <div style={{ padding: '12px 12px 14px' }}><BlockFields block={b} update={(patch) => update(b.id, patch)} onPickImage={() => onPickImage(b.id)} /></div>}
          </div>
        );
      })}

      {adding ? (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 8, marginTop: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {BLOCK_TYPES.map((t) => (
              <button key={t.type} onClick={() => add(t.type)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, background: WHITE, cursor: 'pointer', textAlign: 'left', fontFamily: FONT }}>
                <t.icon size={15} color={AMBER} />
                <span><span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: INK }}>{t.label}</span><span style={{ fontSize: 10.5, color: MUTED2 }}>{t.desc}</span></span>
              </button>
            ))}
          </div>
          <button onClick={() => setAdding(false)} style={{ marginTop: 8, width: '100%', padding: '7px', borderRadius: 8, border: 'none', background: LIGHT, color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', padding: '11px', borderRadius: 10, border: `1.5px dashed ${AMBER}88`, background: `${AMBER}08`, color: '#D4651E', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, marginTop: 4 }}>
          <Plus size={15} /> Add block
        </button>
      )}
    </div>
  );
}
const miniBtn = { width: 26, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: MUTED2, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };

/* ── Page editor (dedicated route, Back button) ──────────────────────────── */
const PAGE_STATUS = [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }];
const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 700, color: INK, margin: '0 0 6px', fontFamily: FONT };

export function SitePageEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = !id;
  const [form, setForm] = useState({ title: '', slug: '', status: 'draft', sort_order: 0 });
  const [blocks, setBlocks] = useState(isNew ? [newBlock('heading'), newBlock('text')] : []);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [slugEdited, setSlugEdited] = useState(false);
  const [pickerFor, setPickerFor] = useState(null);  // block id awaiting an image pick
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const contentHtml = useMemo(() => renderBlocks(blocks), [blocks]);

  // Pixel-perfect live preview: render the blocks → HTML through the real site
  // renderer (same theme/menus/colours as production), debounced.
  useEffect(() => {
    if (loading) return;
    setPreviewing(true);
    const t = setTimeout(() => {
      apiPost('/api/school/website/preview-page', { title: form.title, content: contentHtml, slug: form.slug })
        .then((r) => setPreviewHtml(r.html || ''))
        .catch(() => {})
        .finally(() => setPreviewing(false));
    }, 450);
    return () => clearTimeout(t);
  }, [form.title, contentHtml, form.slug, loading]);

  // Media picker → set the awaiting image block's url.
  const onPickedImage = (m) => {
    if (pickerFor) setBlocks((bs) => bs.map((b) => b.id === pickerFor ? { ...b, url: m.url, alt: b.alt || m.alt_text || m.title || '' } : b));
    setPickerFor(null);
  };

  useEffect(() => {
    if (isNew) return;
    apiGet(`${BASE}/site-pages/${id}`).then((r) => {
      const d = r.data || {};
      setForm({ title: d.title || '', slug: d.slug || '', status: d.status || 'draft', sort_order: d.sort_order ?? 0 });
      setSlugEdited(!!d.slug);
      // Load structured blocks; fall back to wrapping legacy HTML content.
      if (Array.isArray(d.blocks) && d.blocks.length) setBlocks(d.blocks.map((b) => b.id ? b : { ...b, id: uid() }));
      else if (d.content) setBlocks([{ id: uid(), type: 'html', html: d.content }]);
      else setBlocks([]);
    }).catch((e) => showToast(e.message || 'Could not load page'))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const save = async () => {
    if (!form.title.trim()) return showToast('Title is required');
    setSaving(true);
    const body = { ...form, slug: (form.slug || slugify(form.title)) || null, sort_order: Number(form.sort_order) || 0, content: contentHtml, blocks };
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
        <div style={{ display: 'flex', gap: 18, alignItems: 'stretch', flexWrap: 'wrap' }}>
          {/* Left: editing controls */}
          <div style={{ flex: '1 1 380px', minWidth: 320, maxWidth: 460, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '20px 22px', maxHeight: 'calc(100vh - 190px)', overflowY: 'auto' }}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Page Title <span style={{ color: RED }}>*</span></label>
              <input value={form.title} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, title: v, slug: slugEdited ? f.slug : slugify(v) })); }} placeholder="e.g. About Us" style={{ ...inputStyle, fontSize: 15 }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>URL Slug</label>
              <input value={form.slug} onChange={(e) => { setSlugEdited(true); set('slug')(e); }} placeholder="about-us" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ ...labelStyle }}>Sections</label>
              <BlockEditor blocks={blocks} onChange={setBlocks} onPickImage={setPickerFor} />
            </div>
            <div style={{ display: 'flex', gap: 12, borderTop: `1px solid ${BORDER}`, paddingTop: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Status</label>
                <select value={form.status} onChange={set('status')} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {PAGE_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div style={{ width: 110 }}>
                <label style={labelStyle}>Order</label>
                <input type="number" value={form.sort_order} onChange={set('sort_order')} style={inputStyle} />
              </div>
            </div>
          </div>

          {/* Right: live preview */}
          <div style={{ flex: '2 1 480px', minWidth: 320, display: 'flex', flexDirection: 'column', border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', background: WHITE, minHeight: 480 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: `1px solid ${BORDER}`, background: LIGHT }}>
              <span style={{ display: 'inline-flex', gap: 5 }}>{[RED, AMBER, GREEN].map((c) => <span key={c} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: MUTED2, fontFamily: FONT }}>Live Preview{form.slug ? ` · /${form.slug}` : ''}</span>
              {previewing && <Loader2 size={12} color={MUTED2} style={{ animation: 'spin .8s linear infinite', marginLeft: 'auto' }} />}
            </div>
            <iframe title="Page preview" srcDoc={previewHtml} style={{ flex: 1, width: '100%', border: 'none', minHeight: 440, background: WHITE }} />
          </div>
        </div>
      )}

      <MediaPicker open={!!pickerFor} onClose={() => setPickerFor(null)} onPick={onPickedImage} />
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Menus — WordPress-style menu builder ────────────────────────────────── */
const TARGETS = [{ value: '_self', label: 'Same tab' }, { value: '_blank', label: 'New tab' }];
const LOCATIONS = [
  { value: '', label: 'Not assigned' },
  { value: 'primary', label: 'Primary / Main menu (header)' },
  { value: 'footer', label: 'Footer menu' },
  { value: 'social', label: 'Social menu' },
];
const locLabel = (v) => (LOCATIONS.find((l) => l.value === (v || '')) || {}).label || 'Not assigned';

export function MenusPage() {
  const [menus, setMenus] = useState(null);
  const [sel, setSel] = useState(null);          // selected menu id
  const [pages, setPages] = useState([]);
  const [items, setItems] = useState([]);
  const [newMenuName, setNewMenuName] = useState('');
  const [menuName, setMenuName] = useState('');
  const [menuLoc, setMenuLoc] = useState('');
  const [addMode, setAddMode] = useState('page'); // page | custom
  const [addPageId, setAddPageId] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addTarget, setAddTarget] = useState('_self');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2800); };

  const loadMenus = useCallback(() => {
    apiGet(`${BASE}/menus`).then((r) => setMenus(r.data || [])).catch(() => setMenus([]));
  }, []);
  useEffect(() => { loadMenus(); apiGet(`${BASE}/site-pages?view=active`).then((r) => setPages(r.data || [])).catch(() => {}); }, [loadMenus]);

  const selMenu = (menus || []).find((m) => m.id === sel);
  const loadItems = useCallback((menuId) => {
    if (!menuId) return setItems([]);
    apiGet(`${BASE}/menu-items?menu_id=${menuId}`).then((r) => setItems(r.data || [])).catch(() => setItems([]));
  }, []);
  useEffect(() => { if (selMenu) { setMenuName(selMenu.name); setMenuLoc(selMenu.location || ''); loadItems(selMenu.id); } }, [sel]); // eslint-disable-line

  const createMenu = async () => {
    if (!newMenuName.trim()) return showToast('Enter a menu name');
    setBusy(true);
    try {
      const r = await apiPost(`${BASE}/menus`, { name: newMenuName.trim() });
      setNewMenuName(''); await loadMenus(); setSel(r.data.id);
    } catch (e) { showToast(e.message || 'Could not create'); } finally { setBusy(false); }
  };
  const saveMenu = async () => {
    setBusy(true);
    try {
      await apiPut(`${BASE}/menus/${sel}`, { name: menuName.trim() || 'Menu', location: menuLoc || null });
      await loadMenus(); showToast('Menu saved ✓');
    } catch (e) { showToast(e.message?.includes('exist') ? 'That location is already used by another menu' : (e.message || 'Could not save')); }
    finally { setBusy(false); }
  };
  const deleteMenu = async () => {
    if (!window.confirm(`Delete the menu “${selMenu.name}” and its items?`)) return;
    try { await apiDelete(`${BASE}/menus/${sel}`); setSel(null); setItems([]); loadMenus(); } catch (e) { showToast(e.message); }
  };

  const addItem = async () => {
    const order = (items[items.length - 1]?.sort_order ?? items.length - 1) + 1;
    let body;
    if (addMode === 'page') {
      if (!addPageId) return showToast('Choose a page');
      const p = pages.find((x) => x.id === addPageId);
      body = { menu_id: sel, label: addLabel.trim() || p?.title || 'Page', page_id: addPageId, target: addTarget, sort_order: order };
    } else {
      if (!addLabel.trim() || !addUrl.trim()) return showToast('Label and URL are required');
      body = { menu_id: sel, label: addLabel.trim(), url: addUrl.trim(), target: addTarget, sort_order: order };
    }
    try {
      await apiPost(`${BASE}/menu-items`, body);
      setAddPageId(''); setAddLabel(''); setAddUrl('');
      loadItems(sel);
    } catch (e) { showToast(e.message || 'Could not add'); }
  };
  const removeItem = async (it) => { try { await apiDelete(`${BASE}/menu-items/${it.id}`); loadItems(sel); } catch (e) { showToast(e.message); } };
  const move = async (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const a = items[idx], b = items[j];
    try {
      await Promise.all([
        apiPut(`${BASE}/menu-items/${a.id}`, { sort_order: b.sort_order }),
        apiPut(`${BASE}/menu-items/${b.id}`, { sort_order: a.sort_order }),
      ]);
      loadItems(sel);
    } catch (e) { showToast(e.message); }
  };

  const card = { background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px' };
  const smallLabel = { display: 'block', fontSize: 12, fontWeight: 700, color: MUTED, margin: '0 0 5px', fontFamily: FONT };

  return (
    <PageLayout title="Menus" subtitle="Build navigation menus for your website — primary, footer and social">
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: menu list + create */}
        <aside style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><MenuIcon size={15} color={AMBER} /><span style={{ fontSize: 13, fontWeight: 800, color: INK, fontFamily: FONT }}>Your Menus</span></div>
            {menus === null ? <Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /> : menus.length === 0 ? (
              <p style={{ fontSize: 12.5, color: MUTED2, fontFamily: FONT }}>No menus yet. Create one below.</p>
            ) : menus.map((m) => (
              <button key={m.id} onClick={() => setSel(m.id)} style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 9, marginBottom: 6, cursor: 'pointer', fontFamily: FONT,
                border: `1px solid ${sel === m.id ? AMBER : BORDER}`, background: sel === m.id ? `${AMBER}0C` : WHITE,
              }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{m.name}</div>
                <div style={{ fontSize: 11, color: m.location ? GREEN : MUTED2, marginTop: 2, fontWeight: 700 }}>{locLabel(m.location)}</div>
              </button>
            ))}
          </div>
          <div style={card}>
            <label style={smallLabel}>Create a new menu</label>
            <input value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} placeholder="e.g. Primary Menu" style={inputStyle} />
            <button onClick={createMenu} disabled={busy} style={{ ...addBtn, marginTop: 10, width: '100%', justifyContent: 'center' }}><Plus size={15} /> Create Menu</button>
          </div>
        </aside>

        {/* Right: selected menu editor */}
        <section style={{ flex: '2 1 460px', minWidth: 300 }}>
          {!selMenu ? (
            <div style={{ ...card, textAlign: 'center', color: MUTED2, padding: '48px 20px', fontFamily: FONT }}>Select a menu on the left, or create one to get started.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={card}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '1 1 200px' }}><label style={smallLabel}>Menu name</label><input value={menuName} onChange={(e) => setMenuName(e.target.value)} style={inputStyle} /></div>
                  <div style={{ flex: '1 1 200px' }}><label style={smallLabel}>Display location</label>
                    <select value={menuLoc} onChange={(e) => setMenuLoc(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>{LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select>
                  </div>
                  <button onClick={saveMenu} disabled={busy} style={addBtn}><Save size={14} /> Save</button>
                  <button onClick={deleteMenu} title="Delete menu" style={{ ...iconBtn(RED), width: 38, height: 38 }}><Trash2 size={15} /></button>
                </div>
              </div>

              {/* Items */}
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK, fontFamily: FONT, marginBottom: 12 }}>Menu structure</div>
                {items.length === 0 ? <p style={{ fontSize: 12.5, color: MUTED2, fontFamily: FONT, marginBottom: 12 }}>No items yet — add pages or custom links below.</p> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                    {items.map((it, i) => (
                      <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${BORDER}`, borderRadius: 9, padding: '9px 12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <button onClick={() => move(i, -1)} disabled={i === 0} style={{ ...iconBtn(MUTED2), width: 22, height: 18, opacity: i === 0 ? .3 : 1 }}><ChevronUp size={13} /></button>
                          <button onClick={() => move(i, 1)} disabled={i === items.length - 1} style={{ ...iconBtn(MUTED2), width: 22, height: 18, opacity: i === items.length - 1 ? .3 : 1 }}><ChevronDown size={13} /></button>
                        </div>
                        {it.page_id ? <FileText size={14} color={BLUE} /> : <Link2 size={14} color={PURPLE} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT }}>{it.label}</div>
                          <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT }}>{it.page_id ? (it.page_id_name ? `Page: ${it.page_id_name}` : 'Page') : it.url}{it.target === '_blank' ? ' · new tab' : ''}</div>
                        </div>
                        <button onClick={() => removeItem(it)} style={iconBtn(RED)}><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add item */}
                <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 14 }}>
                  <div style={{ display: 'inline-flex', background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 9, padding: 3, marginBottom: 12 }}>
                    {[{ k: 'page', l: 'Add Page' }, { k: 'custom', l: 'Custom Link' }].map((m) => (
                      <button key={m.k} onClick={() => setAddMode(m.k)} style={{ padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 800, background: addMode === m.k ? WHITE : 'transparent', color: addMode === m.k ? INK : MUTED2 }}>{m.l}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    {addMode === 'page' ? (
                      <div style={{ flex: '1 1 200px' }}><label style={smallLabel}>Page</label>
                        <select value={addPageId} onChange={(e) => setAddPageId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                          <option value="">Choose a page…</option>
                          {pages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                        </select>
                      </div>
                    ) : (
                      <>
                        <div style={{ flex: '1 1 140px' }}><label style={smallLabel}>Label</label><input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="e.g. Facebook" style={inputStyle} /></div>
                        <div style={{ flex: '1 1 180px' }}><label style={smallLabel}>URL</label><input value={addUrl} onChange={(e) => setAddUrl(e.target.value)} placeholder="https://…" style={inputStyle} /></div>
                      </>
                    )}
                    {addMode === 'page' && <div style={{ flex: '1 1 140px' }}><label style={smallLabel}>Label (optional)</label><input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="Defaults to page title" style={inputStyle} /></div>}
                    <div style={{ width: 120 }}><label style={smallLabel}>Opens</label>
                      <select value={addTarget} onChange={(e) => setAddTarget(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>{TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
                    </div>
                    <button onClick={addItem} style={addBtn}><Plus size={14} /> Add</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
      {toastEl(toast)}
    </PageLayout>
  );
}
