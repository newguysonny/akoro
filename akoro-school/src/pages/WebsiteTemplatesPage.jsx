import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, CheckCircle2, Pencil, Trash2, UploadCloud, Loader2, FileCode2,
  X, Globe, LayoutList,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';

const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{school_name}} — Welcome</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; color: #1a1a2e; }
    .hero { min-height: 80vh; display: flex; align-items: center; justify-content: center; text-align: center; background: linear-gradient(160deg,#eef2ff,#fff); }
    .hero h1 { font-size: 40px; font-weight: 900; }
  </style>
</head>
<body>
  <section class="hero"><h1>Welcome to {{school_name}}</h1></section>
</body>
</html>`;

/* ── Shared bits ─────────────────────────────────────────────────────────── */
const backBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
const outlineBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${BLUE}55`, background: `${BLUE}0C`, color: BLUE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
const toastEl = (t) => t && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{t}</div>;

// Live snapshot of a website template — its rendered HTML scaled into the card.
const fetchTplHtml = (id) => apiGet(`/api/school/website/templates/${encodeURIComponent(id)}`).then((r) => r.data?.html || '').catch(() => '');
function Screenshot({ id, name, active, badge }) {
  const ref = useRef(null);
  const [html, setHtml] = useState(null);
  const [scale, setScale] = useState(0.22);
  const baseW = 1200;
  useEffect(() => { let on = true; fetchTplHtml(id).then((h) => on && setHtml(h || '')).catch(() => on && setHtml('')); return () => { on = false; }; }, [id]);
  useEffect(() => { const w = ref.current?.offsetWidth; if (w) setScale(w / baseW); }, [html]);
  return (
    <div ref={ref} style={{ position: 'relative', height: 158, borderBottom: `1px solid ${BORDER}`, overflow: 'hidden', background: '#f1f1f4' }}>
      {html === null ? <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}><Loader2 size={18} color={MUTED2} style={{ animation: 'spin .8s linear infinite' }} /></div>
        : html === '' ? <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(135deg, ${AMBER}14, ${BLUE}14)`, fontSize: 15, fontWeight: 900, color: INK }}>{name}</div>
        : <iframe title="preview" srcDoc={html} scrolling="no" tabIndex={-1} aria-hidden style={{ width: baseW, height: baseW * 0.85, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }} />}
      {active && (
        <span style={{ position: 'absolute', top: 10, left: 10, display: 'inline-flex', alignItems: 'center', gap: 4, background: GREEN, color: WHITE, fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 20, boxShadow: '0 1px 4px rgba(0,0,0,.2)' }}>
          <CheckCircle2 size={11} /> Active
        </span>
      )}
      {badge && !active && (
        <span style={{ position: 'absolute', top: 10, left: 10, background: BLUE, color: WHITE, fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: .4, boxShadow: '0 1px 4px rgba(0,0,0,.2)' }}>{badge}</span>
      )}
    </div>
  );
}

/* ═══════════════ Templates grid (installed / saved templates) ════════════ */
export default function WebsiteTemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('theme');
  const [busyId, setBusyId] = useState(null);
  const [chooser, setChooser] = useState(null);   // template being activated
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3200); };

  const load = useCallback(() => {
    Promise.all([apiGet('/api/school/website/templates'), apiGet('/api/school/website')])
      .then(([t, w]) => { setTemplates(t.data || []); setMode(w.data?.mode || 'theme'); })
      .catch((e) => showToast(e.message || 'Could not load templates'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const activate = async (id) => {
    setBusyId(id); setChooser(null);
    try {
      await apiPost(`/api/school/website/templates/${id}/activate`, {});
      await apiPut('/api/school/website', { mode: 'template' }); // make the template actually render
      setMode('template');
      showToast('Template activated ✓');
      load(); // reflect a cloned default becoming an owned, active template
    } catch (e) { showToast(e.message || 'Could not activate'); }
    finally { setBusyId(null); }
  };

  // Activate + auto-create Pages & a Primary menu from the template's zip.
  const activateImport = async (id) => {
    setBusyId(id); setChooser(null);
    try {
      const r = await apiPost(`/api/school/website/templates/${id}/import`, {});
      setMode('theme'); // builder mode: home page + menus + appearance drive the site
      showToast(`Activated ✓ Imported ${r.pagesCreated} page${r.pagesCreated === 1 ? '' : 's'} + ${r.menuItems} menu link${r.menuItems === 1 ? '' : 's'} into the builder${r.skipped ? ` (${r.skipped} already existed)` : ''}`);
      load();
    } catch (e) { showToast(e.message || 'Could not import'); }
    finally { setBusyId(null); }
  };
  const remove = async (id) => {
    if (!window.confirm('Delete this template?')) return;
    setBusyId(id);
    try { await apiDelete(`/api/school/website/templates/${id}`); setTemplates((p) => p.filter((t) => t.id !== id)); showToast('Deleted'); }
    catch (e) { showToast(e.message || 'Could not delete'); }
    finally { setBusyId(null); }
  };
  const useTheme = async () => { try { await apiPut('/api/school/website', { mode: 'theme' }); setMode('theme'); showToast('Switched to theme mode'); } catch (e) { showToast(e.message); } };

  return (
    <PageLayout title="Templates" subtitle="Installed website templates for your school">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/settings-website')} style={backBtn}><ArrowLeft size={14} /> Back to Website</button>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 22, padding: '0 7px', borderRadius: 11, background: LIGHT, border: `1px solid ${BORDER}`, fontSize: 12, fontWeight: 800, color: MUTED }}>{templates.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          {mode === 'template' && <button onClick={useTheme} style={outlineBtn}>Switch to Theme mode</button>}
          <button onClick={() => navigate('/settings-website/templates/add')} style={primaryBtn}><Plus size={15} /> Add New</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2, fontFamily: FONT }}><Loader2 size={22} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
          {templates.map((t) => (
            <div key={t.id} style={{ border: `1px solid ${t.active ? GREEN : BORDER}`, borderRadius: 14, overflow: 'hidden', background: WHITE }}>
              <Screenshot id={t.id} name={t.name || 'Untitled'} active={t.active} badge={t.isDefault ? 'Starter' : null} />
              <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: FONT }}>{t.name || 'Untitled'}</div>
                  {t.description && <div style={{ fontSize: 11.5, color: MUTED2, fontFamily: FONT }}>{t.description}</div>}
                </div>
                {busyId === t.id ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : t.isDefault ? (
                  <button onClick={() => (t.importable ? setChooser(t) : activate(t.id))} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Use this template</button>
                ) : (
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button onClick={() => navigate(`/settings-website/templates/${t.id}`, { state: { template: t } })} title="Customize" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: 'none', background: BLUE, color: WHITE, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}><Pencil size={12} /> Customize</button>
                    {!t.active && <button onClick={() => (t.importable ? setChooser(t) : activate(t.id))} style={{ padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Activate</button>}
                    <button onClick={() => remove(t.id)} title="Delete" style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: `${RED}12`, color: RED, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Add New tile */}
          <button onClick={() => navigate('/settings-website/templates/add')} style={{ border: `2px dashed ${BORDER}`, borderRadius: 14, background: LIGHT, minHeight: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, cursor: 'pointer', fontFamily: FONT, color: MUTED }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: WHITE, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus size={22} color={MUTED2} /></div>
            <span style={{ fontSize: 13, fontWeight: 800 }}>Add New Template</span>
          </button>
        </div>
      )}

      {/* Activation chooser — as-is vs import into builder */}
      {chooser && (
        <div onClick={() => setChooser(null)} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: WHITE, borderRadius: 18, padding: '22px 24px', fontFamily: FONT }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: INK }}>Activate “{chooser.name}”</span>
              <button onClick={() => setChooser(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: MUTED2 }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 16px', lineHeight: 1.6 }}>This template came from a zip with extra pages and a navigation menu. How would you like to use it?</p>

            <button onClick={() => activateImport(chooser.id)} style={{ display: 'flex', gap: 12, width: '100%', textAlign: 'left', alignItems: 'flex-start', padding: '14px 14px', borderRadius: 12, border: `2px solid ${AMBER}66`, background: `${AMBER}08`, cursor: 'pointer', fontFamily: FONT, marginBottom: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: `${AMBER}18`, color: AMBER, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><LayoutList size={18} /></div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>Activate & import into builder <span style={{ fontSize: 10.5, fontWeight: 800, color: AMBER, marginLeft: 4 }}>RECOMMENDED</span></div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 3, lineHeight: 1.55 }}>Auto-creates every page — including an editable <b>Home</b> — in <b>Pages</b>, and the template's nav as your <b>Primary menu</b>. Content, links and appearance are then all edited in the builder, with one nav everywhere.</div>
              </div>
            </button>

            <button onClick={() => activate(chooser.id)} style={{ display: 'flex', gap: 12, width: '100%', textAlign: 'left', alignItems: 'flex-start', padding: '14px 14px', borderRadius: 12, border: `1.5px solid ${BORDER}`, background: WHITE, cursor: 'pointer', fontFamily: FONT }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: `${BLUE}15`, color: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Globe size={18} /></div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>Activate as-is</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 3, lineHeight: 1.55 }}>Serve the template exactly as uploaded, without adding anything to Pages or Menus. Edit it as raw HTML via Customize.</div>
              </div>
            </button>
          </div>
        </div>
      )}
      {toastEl(toast)}
    </PageLayout>
  );
}

/* ═══════════════ Add Template library ════════════════════════════════════ */
export function AddTemplatePage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => { apiGet('/api/school/website/templates').then((r) => setTemplates(r.data || [])).catch(() => {}).finally(() => setLoading(false)); }, []);

  const startBlank = async () => {
    setBusy(true);
    try {
      const res = await apiPost('/api/school/website/templates', { name: 'Untitled Template', description: 'Blank starter', html: DEFAULT_HTML });
      navigate(`/settings-website/templates/${res.data.id}`, { state: { template: res.data } });
    } catch (e) { showToast(e.message || 'Could not create'); setBusy(false); }
  };

  return (
    <PageLayout title="Add Templates" subtitle="Start from blank or upload a template">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/settings-website/templates')} style={backBtn}><ArrowLeft size={14} /> Back to Templates</button>
        <button onClick={() => navigate('/settings-website/templates/upload')} style={{ ...outlineBtn, marginLeft: 'auto' }}><UploadCloud size={15} /> Upload Template</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
        {/* Start blank */}
        <button onClick={startBlank} disabled={busy} style={{ border: `2px dashed ${AMBER}66`, borderRadius: 14, background: `${AMBER}08`, minHeight: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, cursor: 'pointer', fontFamily: FONT, color: INK }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: WHITE, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{busy ? <Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /> : <FileCode2 size={22} color={AMBER} />}</div>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>Start from Blank</span>
          <span style={{ fontSize: 11.5, color: MUTED2 }}>Create and customise a new template</span>
        </button>

        {/* Upload tile */}
        <button onClick={() => navigate('/settings-website/templates/upload')} style={{ border: `2px dashed ${BLUE}55`, borderRadius: 14, background: `${BLUE}08`, minHeight: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, cursor: 'pointer', fontFamily: FONT, color: INK }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: WHITE, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><UploadCloud size={22} color={BLUE} /></div>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>Upload Template</span>
          <span style={{ fontSize: 11.5, color: MUTED2 }}>Install a template from an .html file</span>
        </button>

        {/* Installed templates */}
        {!loading && templates.map((t) => (
          <div key={t.id} style={{ border: `1px solid ${t.active ? GREEN : BORDER}`, borderRadius: 14, overflow: 'hidden', background: WHITE }}>
            <Screenshot id={t.id} name={t.name || 'Untitled'} active={t.active} />
            <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: FONT }}>{t.name || 'Untitled'}</div>
              <span style={{ fontSize: 11, fontWeight: 800, color: t.active ? GREEN : MUTED2, fontFamily: FONT }}>{t.active ? 'Active' : 'Installed'}</span>
            </div>
          </div>
        ))}
      </div>
      {toastEl(toast)}
    </PageLayout>
  );
}

/* ═══════════════ Upload Template (drag & drop) ═══════════════════════════ */
export function UploadTemplatePage() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2800); };

  const pick = (f) => {
    if (!f) return;
    if (!/\.(zip|html?|txt)$/i.test(f.name)) return showToast('Please choose a .zip or .html file');
    setFile(f);
  };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); };

  const install = async () => {
    if (!file) return showToast('Choose a template file first');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', file.name.replace(/\.(zip|html?|txt)$/i, ''));
      const r = await fetch(`${API}/api/school/website/templates/upload`, { method: 'POST', credentials: 'include', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      showToast('Template installed ✓');
      setTimeout(() => navigate('/settings-website/templates'), 700);
    } catch (e) { showToast(e.message || 'Could not install'); setBusy(false); }
  };

  return (
    <PageLayout title="Add Templates" subtitle="Upload Template">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/settings-website/templates/add')} style={backBtn}><ArrowLeft size={14} /> Back</button>
      </div>

      <p style={{ textAlign: 'center', color: MUTED, fontSize: 13.5, fontFamily: FONT, marginBottom: 18 }}>
        If you have a template in <b>.zip</b> or <b>.html</b> format, you may install it by uploading it here.
        A zip is unpacked into one self-contained template (CSS, JS and images inlined).
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{ maxWidth: 620, margin: '0 auto', border: `2px dashed ${drag ? AMBER : BORDER}`, background: drag ? `${AMBER}0C` : WHITE, borderRadius: 16, padding: '44px 24px', textAlign: 'center', cursor: 'pointer', fontFamily: FONT }}
      >
        <input ref={inputRef} type="file" accept=".zip,.html,.htm,.txt" onChange={(e) => pick(e.target.files?.[0])} style={{ display: 'none' }} />
        <div style={{ width: 60, height: 60, borderRadius: '50%', background: LIGHT, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <UploadCloud size={26} color={drag ? AMBER : MUTED2} />
        </div>
        {file ? (
          <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>{file.name}</div>
        ) : (
          <>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>Drag &amp; drop your template here</div>
            <div style={{ fontSize: 12.5, color: MUTED2, marginTop: 4 }}>or click to choose a file</div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 20 }}>
        <button onClick={() => inputRef.current?.click()} style={backBtn}>Choose File</button>
        <button onClick={install} disabled={!file || busy} style={{ ...primaryBtn, opacity: (!file || busy) ? 0.55 : 1, cursor: (!file || busy) ? 'default' : 'pointer' }}>
          {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <UploadCloud size={14} />} Install Now
        </button>
      </div>
      {toastEl(toast)}
    </PageLayout>
  );
}
