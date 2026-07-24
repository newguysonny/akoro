import { useState, useEffect, useCallback } from 'react';
import { LayoutTemplate, Plus, Trash2, Star, Upload, Code2, Eye, EyeOff, Monitor, X } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiPut, apiDelete, API } from '../services/api.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, RED, PURPLE, FONT } from '../constants.js';

export default function WebsiteTemplatesPage() {
  const [list, setList] = useState(null);
  const [modal, setModal] = useState(false);
  const [method, setMethod] = useState('paste');   // 'paste' | 'upload'
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [html, setHtml] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [preview, setPreview] = useState(null);   // { name, html } | 'loading'

  const show = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async () => {
    try { const r = await apiGet('/api/admin/website-templates'); setList(r?.data ?? r ?? []); }
    catch (e) { setList([]); show(e.message || 'Failed to load', 'error'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const reset = () => { setName(''); setDesc(''); setHtml(''); setFile(null); };

  const create = async () => {
    setBusy(true);
    try {
      if (method === 'upload') {
        if (!file) throw new Error('Choose an .html file');
        const fd = new FormData();
        fd.append('file', file);
        if (name.trim()) fd.append('name', name.trim());
        if (desc.trim()) fd.append('description', desc.trim());
        const r = await fetch(`${API}/api/admin/website-templates/upload`, { method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'admin' }, body: fd });
        const j = await r.json();
        if (!r.ok || !j.success) throw new Error(j.error || 'Upload failed');
      } else {
        if (!name.trim()) throw new Error('Enter a template name');
        if (!html.trim()) throw new Error('Paste the template HTML');
        await apiPost('/api/admin/website-templates', { name: name.trim(), description: desc.trim(), html: html.trim() });
      }
      show('Template added'); setModal(false); reset(); load();
    } catch (e) { show(e.message || 'Could not add template', 'error'); }
    finally { setBusy(false); }
  };

  const openPreview = async (t) => {
    setPreview('loading');
    try { const r = await apiGet(`/api/admin/website-templates/${t.id}`); const d = r?.data ?? r; setPreview({ name: d.name, html: d.html || '' }); }
    catch (e) { setPreview(null); show(e.message || 'Could not load preview', 'error'); }
  };

  const setDefault = async (t) => {
    try { await apiPost(`/api/admin/website-templates/${t.id}/default`); show(`“${t.name}” is now the default`); load(); }
    catch (e) { show(e.message || 'Failed', 'error'); }
  };
  const togglePublished = async (t) => {
    try { await apiPut(`/api/admin/website-templates/${t.id}`, { isPublished: !t.isPublished }); load(); }
    catch (e) { show(e.message || 'Failed', 'error'); }
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete the “${t.name}” template? Schools already using a copy keep theirs.`)) return;
    try { await apiDelete(`/api/admin/website-templates/${t.id}`); setList((l) => l.filter((x) => x.id !== t.id)); show('Deleted'); }
    catch (e) { show(e.message || 'Delete failed', 'error'); }
  };

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };
  const inp = { width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' };

  return (
    <PageLayout title="Website Templates" subtitle="The template gallery every school can use to build its website">
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <Btn variant="primary" onClick={() => { reset(); setModal(true); }}><Plus size={15} style={{ marginRight: 6 }} />Add template</Btn>
        </div>

        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', overflowX: 'auto' }}>
          {list === null ? (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>{[1, 2, 3].map((i) => <Skeleton key={i} height={44} />)}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
              <thead><tr style={{ background: LIGHT }}>
                <th style={TH}>Template</th><th style={TH}>Description</th><th style={TH}>Status</th><th style={{ ...TH, textAlign: 'right' }}>Actions</th>
              </tr></thead>
              <tbody>
                {list.length === 0 ? (
                  <tr><td colSpan={4} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none', padding: '40px 14px' }}>
                    <LayoutTemplate size={30} style={{ opacity: 0.4, marginBottom: 8 }} /><div>No platform templates yet — add one for schools to use.</div>
                  </td></tr>
                ) : list.map((t) => (
                  <tr key={t.id}>
                    <td style={{ ...TD, fontWeight: 700 }}>
                      {t.name}
                      {t.isDefault && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: `${AMBER}22`, color: '#B45309' }}>★ Default</span>}
                      {t.multiPage && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: `${PURPLE}18`, color: PURPLE }}>{t.pageCount} pages</span>}
                    </td>
                    <td style={{ ...TD, color: MUTED, maxWidth: 320 }}><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || '—'}</span></td>
                    <td style={TD}>
                      <button onClick={() => togglePublished(t)} title={t.isPublished ? 'Published — click to hide' : 'Hidden — click to publish'}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: t.isPublished ? GREEN : MUTED }}>
                        {t.isPublished ? <Eye size={13} /> : <EyeOff size={13} />}{t.isPublished ? 'Published' : 'Hidden'}
                      </button>
                    </td>
                    <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => openPreview(t)} title="Preview" style={{ background: 'none', border: 'none', cursor: 'pointer', color: PURPLE, marginRight: 12 }}><Monitor size={16} /></button>
                      {!t.isDefault && <button onClick={() => setDefault(t)} title="Set as default" style={{ background: 'none', border: 'none', cursor: 'pointer', color: AMBER, marginRight: 12 }}><Star size={16} /></button>}
                      <button onClick={() => remove(t)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED }}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={modal} onClose={() => !busy && setModal(false)} title="Add website template" width={600}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[{ k: 'paste', label: 'Paste HTML', icon: Code2 }, { k: 'upload', label: 'Upload .html', icon: Upload }].map((m) => (
            <button key={m.k} onClick={() => setMethod(m.k)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 700, border: `1.5px solid ${method === m.k ? AMBER : BORDER}`, background: method === m.k ? `${AMBER}12` : WHITE, color: method === m.k ? AMBER : MUTED }}>
              <m.icon size={15} />{m.label}
            </button>
          ))}
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name (e.g. Vista, Scholar, Minimal)" style={{ ...inp, marginBottom: 10 }} />
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Short description (optional)" style={{ ...inp, marginBottom: 10 }} />
        {method === 'paste' ? (
          <textarea value={html} onChange={(e) => setHtml(e.target.value)} rows={8} placeholder="Paste the full self-contained HTML…" style={{ ...inp, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }} />
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 8, fontFamily: FONT }}>Upload a self-contained <b>.html</b> file, or a <b>.zip</b> (CSS/JS/images are inlined into one HTML automatically).</div>
            <input type="file" accept="text/html,.html,.htm,.zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ fontFamily: FONT, fontSize: 13 }} />
          </>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <Btn variant="secondary" onClick={() => setModal(false)} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" onClick={create} disabled={busy}>{busy ? 'Saving…' : 'Add template'}</Btn>
        </div>
      </Modal>

      {preview && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#1A1A2E', color: '#fff' }}>
            <span style={{ fontSize: 14, fontWeight: 800, fontFamily: FONT }}>Preview{preview !== 'loading' && preview.name ? ` · ${preview.name}` : ''}</span>
            <button onClick={() => setPreview(null)} style={{ background: 'rgba(255,255,255,.12)', border: 'none', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
          </div>
          <div style={{ flex: 1, background: '#fff' }}>
            {preview === 'loading'
              ? <div style={{ padding: 40, fontFamily: FONT, color: MUTED }}>Loading preview…</div>
              : <iframe title="template-preview" srcDoc={preview.html} sandbox="allow-same-origin allow-scripts allow-popups" style={{ width: '100%', height: '100%', border: 'none' }} />}
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
