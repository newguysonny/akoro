/**
 * Website Builder — Media library list + media editor pages.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageLayout } from '../../components/Layout.jsx';
import BackButton from '../../components/BackButton.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../services/api.js';
import { GREEN, BLUE, PURPLE, RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import { BASE, slugify, pill, th, td, iconBtn, Tabs, addBtn, backBtn, toastEl, miniBtn } from './shared.jsx';
import { confirmDialog } from '../../components/ConfirmHost.jsx';
const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 700, color: C.ink, margin: '0 0 6px', fontFamily: C.font };

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
    ? <img src={r.url} alt={r.alt_text || ''} style={{ width: size, height: size, borderRadius: 8, objectFit: 'cover', border: `1px solid ${C.border}`, background: C.bg }} />
    : <div style={{ width: size, height: size, borderRadius: 8, background: C.bg, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: C.muted2, textTransform: 'uppercase' }}>{(r.media_type || 'file').slice(0, 3)}</div>
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
      const r = await fetch(`${API}/api/school/mgmt/site-media/upload`, { method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'school' }, body: fd });
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
  const destroy = async (r) => { if (await confirmDialog(`Permanently delete “${r.title}”? This cannot be undone.`)) act(r.id, () => apiDelete(`${BASE}/site-media/${r.id}`), 'Deleted permanently'); };
  const isTrash = tab === 'trash';

  return (
    <PageLayout title="Media Library" subtitle="Images, videos and files to use on your website">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Tabs tabs={MEDIA_TABS} tab={tab} setTab={setTab} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => uploadRef.current?.click()} style={{ ...addBtn, background: C.surface, color: BLUE, border: `1.5px solid ${BLUE}55` }}>
            {uploading ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-cloud-upload" size={15} />} Upload Files
          </button>
          <button onClick={() => navigate('/website-builder/media/new')} style={addBtn}><Ico ti="ti-plus" size={15} /> Add by URL</button>
        </div>
      </div>

      <input ref={uploadRef} type="file" multiple onChange={(e) => { upload(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />

      {!isTrash && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          onClick={() => uploadRef.current?.click()}
          style={{ border: `2px dashed ${drag ? C.brand : C.border}`, background: drag ? tint(5) : C.bg, borderRadius: 12, padding: '18px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', fontFamily: C.font, color: C.muted }}
        >
          {uploading ? <Ico ti="ti-loader-2" size={16} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-cloud-upload" size={18} color={drag ? C.brand : C.muted2} />}
          <span style={{ fontSize: 13, fontWeight: 700 }}>{uploading ? 'Uploading…' : 'Drag & drop files here to upload, or click to choose'}</span>
        </div>
      )}

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.font }}>
          <thead><tr>
            <th style={th}>PREVIEW</th><th style={th}>TITLE</th><th style={th}>TYPE</th><th style={th}>URL</th>
            <th style={{ ...th, textAlign: 'right' }}>ACTIONS</th>
          </tr></thead>
          <tbody>
            {rows === null && <tr><td style={{ ...td, textAlign: 'center', color: C.muted2 }} colSpan={5}><Ico ti="ti-loader-2" size={18} style={{ animation: 'spin .8s linear infinite' }} /></td></tr>}
            {rows && rows.length === 0 && <tr><td style={{ ...td, textAlign: 'center', color: C.muted2 }} colSpan={5}>{isTrash ? 'Trash is empty.' : 'No media yet — click “Add New Media”.'}</td></tr>}
            {(rows || []).map((r) => (
              <tr key={r.id}>
                <td style={td}><MediaThumb r={r} /></td>
                <td style={td}>
                  <button onClick={() => !isTrash && navigate(`/website-builder/media/${r.id}`)} style={{ border: 'none', background: 'none', padding: 0, cursor: isTrash ? 'default' : 'pointer', fontFamily: C.font, fontSize: 13.5, fontWeight: 800, color: isTrash ? C.ink : BLUE, textAlign: 'left' }}>{r.title}</button>
                  {r.alt_text && <div style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>{r.alt_text}</div>}
                </td>
                <td style={td}>{pill(r.media_type, { image: BLUE, video: PURPLE, document: C.brand, other: C.muted2 })}</td>
                <td style={td}><a href={r.url} target="_blank" rel="noreferrer" style={{ color: BLUE, fontSize: 12 }}>{(r.url || '').slice(0, 42)}{(r.url || '').length > 42 ? '…' : ''}</a></td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    {busyId === r.id ? <Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> : isTrash ? (
                      <>
                        <button title="Restore" onClick={() => restore(r)} style={iconBtn(GREEN)}><Ico ti="ti-rotate-2" size={14} /></button>
                        <button title="Delete permanently" onClick={() => destroy(r)} style={iconBtn(RED)}><Ico ti="ti-trash" size={14} /></button>
                      </>
                    ) : (
                      <>
                        <button title="Edit" onClick={() => navigate(`/website-builder/media/${r.id}`)} style={iconBtn(BLUE)}><Ico ti="ti-pencil" size={14} /></button>
                        <button title="Move to Trash" onClick={() => trash(r)} style={iconBtn(C.brand)}><Ico ti="ti-trash" size={14} /></button>
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
        <BackButton onClick={() => navigate('/website-builder/media')} label="Back to Media" />
        <button onClick={save} disabled={saving || loading} style={{ ...addBtn, background: saving ? C.borderSoft : addBtn.background, color: saving ? C.muted2 : '#fff' }}>
          {saving ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={14} />} {saving ? 'Saving…' : 'Save Media'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: C.muted2, fontFamily: C.font }}><Ico ti="ti-loader-2" size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 420px', minWidth: 300, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px' }}>
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

          <aside style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 320, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 18px' }}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Type</label>
              <select value={form.media_type} onChange={set('media_type')} style={{ ...inputStyle, cursor: 'pointer' }}>
                {MEDIA_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <label style={labelStyle}>Preview</label>
            <div style={{ borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 8 }}>
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

