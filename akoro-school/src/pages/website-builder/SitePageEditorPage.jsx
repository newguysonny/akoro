/**
 * Website Builder — Page editor (block editor for block pages, visual editor
 * for HTML/template pages), with live preview.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {Plus, Pencil, Trash2, RotateCcw, Save, Loader2, FileText, X, ChevronUp, ChevronDown, Link2, Menu as MenuIcon, Image as ImageIcon, UploadCloud, Sparkles, Type, LayoutGrid, Minus, Code, GripVertical, PencilLine, Image } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import BackButton from '../../components/BackButton.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../services/api.js';
import { INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, AMBER, BLUE, PURPLE, RED, FONT } from '../../constants.js';
import { BASE, slugify, pill, th, td, iconBtn, Tabs, addBtn, backBtn, toastEl, miniBtn } from './shared.jsx';
import { newBlock, uid, renderBlocks, BlockEditor } from './blockEditor.jsx';
import { isFullDoc, prepareEditableDoc } from './visualEditor.jsx';
import { MediaPicker } from './MediaPicker.jsx';

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
  // Visual (WordPress-style) mode — for pages whose content is HTML (imported
  // templates / legacy pages). The page renders for real and text is edited
  // inline; blocks-based pages keep the block editor.
  const [mode, setMode] = useState('blocks');            // 'blocks' | 'visual'
  const [htmlContent, setHtmlContent] = useState('');     // authoritative page HTML (visual mode)
  const [editorDoc, setEditorDoc] = useState('');         // iframe srcDoc (scripts disabled + boot)
  const [isRegionEdit, setIsRegionEdit] = useState(false);// fragment page edited inside theme chrome
  const [showCode, setShowCode] = useState(false);        // advanced: raw HTML view
  const [visualImgId, setVisualImgId] = useState(null);   // image awaiting a library pick
  const editorFrameRef = useRef(null);
  const htmlRef = useRef('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const contentHtml = useMemo(() => renderBlocks(blocks), [blocks]);

  // Pixel-perfect live preview for BLOCK pages: render blocks → HTML through
  // the real site renderer (same theme/menus/colours), debounced.
  useEffect(() => {
    if (loading || mode !== 'blocks') return;
    setPreviewing(true);
    const t = setTimeout(() => {
      apiPost('/api/school/website/preview-page', { title: form.title, content: contentHtml, slug: form.slug })
        .then((r) => setPreviewHtml(r.html || ''))
        .catch(() => {})
        .finally(() => setPreviewing(false));
    }, 450);
    return () => clearTimeout(t);
  }, [form.title, contentHtml, form.slug, loading, mode]);

  // Media picker → block image OR visual-mode image swap.
  const onPickedImage = (m) => {
    if (visualImgId) {
      editorFrameRef.current?.contentWindow?.postMessage({ __editor: true, type: 'set-image', id: visualImgId, url: m.url }, '*');
      setVisualImgId(null);
      return;
    }
    if (pickerFor) setBlocks((bs) => bs.map((b) => b.id === pickerFor ? { ...b, url: m.url, alt: b.alt || m.alt_text || m.title || '' } : b));
    setPickerFor(null);
  };

  // Boot the visual editor for a given page HTML: full documents render
  // standalone; fragments render through the real site renderer and only the
  // page's own content region is editable (the chrome stays hands-off).
  const openVisual = useCallback(async (content, meta) => {
    setHtmlContent(content);
    htmlRef.current = content;
    if (isFullDoc(content)) {
      setIsRegionEdit(false);
      setEditorDoc(prepareEditableDoc(content, null));
    } else {
      setIsRegionEdit(true);
      try {
        const r = await apiPost('/api/school/website/preview-page', { title: meta.title, content, slug: meta.slug });
        setEditorDoc(prepareEditableDoc(r.html || '', '.page-content'));
      } catch {
        // Renderer unavailable — edit the bare fragment instead.
        setIsRegionEdit(false);
        setEditorDoc(prepareEditableDoc(`<!doctype html><html><head></head><body>${content}</body></html>`, null));
      }
    }
    setMode('visual');
  }, []);

  useEffect(() => {
    if (isNew) return;
    apiGet(`${BASE}/site-pages/${id}`).then(async (r) => {
      const d = r.data || {};
      setForm({ title: d.title || '', slug: d.slug || '', status: d.status || 'draft', sort_order: d.sort_order ?? 0 });
      setSlugEdited(!!d.slug);
      const structured = Array.isArray(d.blocks) && d.blocks.length && !(d.blocks.length === 1 && d.blocks[0].type === 'html');
      if (structured) {
        setBlocks(d.blocks.map((b) => b.id ? b : { ...b, id: uid() }));
      } else {
        const content = (d.blocks?.[0]?.type === 'html' ? d.blocks[0].html : '') || d.content || '';
        if (content) await openVisual(content, { title: d.title || '', slug: d.slug || '' });
        else setBlocks([]);
      }
    }).catch((e) => showToast(e.message || 'Could not load page'))
      .finally(() => setLoading(false));
  }, [id, isNew, openVisual]);

  // Visual-editor messages from the iframe.
  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data || {};
      if (!d.__editor) return;
      if (d.type === 'html') { setHtmlContent(d.html); htmlRef.current = d.html; }
      if (d.type === 'pick-image') setVisualImgId(d.id);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Ask the iframe for its very latest HTML (beats the debounce) before saving.
  const requestLatestHtml = () => new Promise((resolve) => {
    const win = editorFrameRef.current?.contentWindow;
    if (!win) return resolve(null);
    let done = false;
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.__editor && d.type === 'html') { done = true; window.removeEventListener('message', onMsg); resolve(d.html); }
    };
    window.addEventListener('message', onMsg);
    win.postMessage({ __editor: true, type: 'get-html' }, '*');
    setTimeout(() => { if (!done) { window.removeEventListener('message', onMsg); resolve(null); } }, 700);
  });

  // Section outline (visual mode): every heading on the page, click to jump.
  const outline = useMemo(() => {
    if (mode !== 'visual' || !htmlContent) return [];
    try {
      const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
      return [...doc.querySelectorAll('h1,h2,h3')].map((h, i) => ({
        i, tag: h.tagName.toLowerCase(),
        text: (h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 64) || '(empty heading)',
      }));
    } catch { return []; }
  }, [htmlContent, mode]);

  const execCmd = (cmd) => editorFrameRef.current?.contentWindow?.postMessage({ __editor: true, type: 'cmd', cmd }, '*');
  const scrollToHeading = (i) => editorFrameRef.current?.contentWindow?.postMessage({ __editor: true, type: 'scroll-to', index: i }, '*');

  const save = async () => {
    if (!form.title.trim()) return showToast('Title is required');
    setSaving(true);
    let content = contentHtml, bodyBlocks = blocks;
    if (mode === 'visual') {
      const latest = showCode ? htmlRef.current : await requestLatestHtml();
      content = latest ?? htmlRef.current;
      bodyBlocks = []; // authoritative content lives in `content`
    }
    const body = { ...form, slug: (form.slug || slugify(form.title)) || null, sort_order: Number(form.sort_order) || 0, content, blocks: bodyBlocks };
    try {
      if (isNew) await apiPost(`${BASE}/site-pages`, body);
      else await apiPut(`${BASE}/site-pages/${id}`, body);
      navigate('/website-builder/pages');
    } catch (e) { showToast(e.message || 'Could not save'); setSaving(false); }
  };

  return (
    <PageLayout title={isNew ? 'Add New Page' : 'Edit Page'} subtitle="Website Builder · Pages">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 10, flexWrap: 'wrap' }}>
        <BackButton onClick={() => navigate('/website-builder/pages')} label="Back to Pages" />
        <button onClick={save} disabled={saving || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 20px', borderRadius: 9, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 13, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
          {saving ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} {saving ? 'Saving…' : 'Save Page'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2, fontFamily: FONT }}><Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
        <div style={{ display: 'flex', gap: 18, alignItems: 'stretch', flexWrap: 'wrap' }}>
          {/* Left: editing controls */}
          <div style={{ flex: mode === 'visual' ? '0 1 300px' : '1 1 380px', minWidth: 280, maxWidth: mode === 'visual' ? 320 : 460, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '20px 22px', maxHeight: 'calc(100vh - 190px)', overflowY: 'auto' }}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Page Title <span style={{ color: RED }}>*</span></label>
              <input value={form.title} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, title: v, slug: slugEdited ? f.slug : slugify(v) })); }} placeholder="e.g. About Us" style={{ ...inputStyle, fontSize: 15 }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>URL Slug</label>
              <input value={form.slug} onChange={(e) => { setSlugEdited(true); set('slug')(e); }} placeholder="about-us" style={inputStyle} />
            </div>

            {mode === 'blocks' ? (
              <div style={{ marginBottom: 16 }}>
                <label style={{ ...labelStyle }}>Sections</label>
                <BlockEditor blocks={blocks} onChange={setBlocks} onPickImage={setPickerFor} />
              </div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Sections on this page</label>
                {outline.length === 0 ? (
                  <p style={{ fontSize: 12, color: MUTED2, fontFamily: FONT, margin: '4px 0 10px' }}>No headings found yet.</p>
                ) : (
                  <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
                    {outline.map((h) => (
                      <button key={h.i} onClick={() => scrollToHeading(h.i)} title="Click to jump to this section" style={{ display: 'block', width: '100%', textAlign: 'left', padding: `7px 12px 7px ${12 + (h.tag === 'h1' ? 0 : h.tag === 'h2' ? 12 : 24)}px`, border: 'none', borderTop: h.i ? `1px solid ${BORDER}` : 'none', background: WHITE, color: h.tag === 'h1' ? INK : MUTED, fontSize: 12, fontWeight: h.tag === 'h1' ? 800 : 600, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {h.text}
                      </button>
                    ))}
                  </div>
                )}
                <p style={{ fontSize: 11.5, color: MUTED2, fontFamily: FONT, lineHeight: 1.55, margin: '0 0 12px' }}>
                  <PencilLine size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Click any text on the page and type to change it.<br />
                  <Image size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Double-click an image to replace it from the library.
                </p>
                <button onClick={() => setShowCode((v) => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: `1.5px solid ${BORDER}`, background: showCode ? LIGHT : WHITE, color: MUTED, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                  <Code size={12} /> {showCode ? 'Back to visual editing' : 'Edit HTML (advanced)'}
                </button>
              </div>
            )}

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

          {/* Right: live preview (blocks) or visual editor (WordPress-style) */}
          <div style={{ flex: '2 1 480px', minWidth: 320, display: 'flex', flexDirection: 'column', border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', background: WHITE, minHeight: 480 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: `1px solid ${BORDER}`, background: LIGHT }}>
              <span style={{ display: 'inline-flex', gap: 5 }}>{[RED, AMBER, GREEN].map((c) => <span key={c} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: MUTED2, fontFamily: FONT }}>
                {mode === 'visual' ? (showCode ? 'HTML source' : 'Visual Editor — click text to edit') : 'Live Preview'}{form.slug ? ` · /${form.slug}` : ''}
              </span>
              {mode === 'visual' && !showCode && (
                <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
                  <button onClick={() => execCmd('bold')} title="Bold selection" style={{ ...miniBtn, fontWeight: 900, fontFamily: FONT, fontSize: 12 }}>B</button>
                  <button onClick={() => execCmd('italic')} title="Italic selection" style={{ ...miniBtn, fontStyle: 'italic', fontFamily: FONT, fontSize: 12 }}>I</button>
                  <button onClick={() => execCmd('underline')} title="Underline selection" style={{ ...miniBtn, textDecoration: 'underline', fontFamily: FONT, fontSize: 12 }}>U</button>
                </span>
              )}
              {mode === 'blocks' && previewing && <Loader2 size={12} color={MUTED2} style={{ animation: 'spin .8s linear infinite', marginLeft: 'auto' }} />}
            </div>
            {mode === 'visual' ? (
              showCode ? (
                <textarea
                  value={htmlContent}
                  onChange={(e) => { setHtmlContent(e.target.value); htmlRef.current = e.target.value; }}
                  onBlur={() => {
                    // Rebuild the visual editor with the edited source.
                    if (isFullDoc(htmlRef.current)) { setIsRegionEdit(false); setEditorDoc(prepareEditableDoc(htmlRef.current, null)); }
                    else if (!isRegionEdit) setEditorDoc(prepareEditableDoc(`<!doctype html><html><head></head><body>${htmlRef.current}</body></html>`, null));
                  }}
                  spellCheck={false}
                  style={{ flex: 1, width: '100%', border: 'none', outline: 'none', resize: 'none', padding: 16, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, lineHeight: 1.6, color: INK, background: WHITE, minHeight: 440 }}
                />
              ) : (
                <iframe ref={editorFrameRef} title="Visual editor" srcDoc={editorDoc} style={{ flex: 1, width: '100%', border: 'none', minHeight: 440, background: WHITE }} />
              )
            ) : (
              <iframe title="Page preview" srcDoc={previewHtml} sandbox="" style={{ flex: 1, width: '100%', border: 'none', minHeight: 440, background: WHITE }} />
            )}
          </div>
        </div>
      )}

      <MediaPicker open={!!pickerFor || !!visualImgId} onClose={() => { setPickerFor(null); setVisualImgId(null); }} onPick={onPickedImage} />
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

