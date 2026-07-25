/**
 * Document Templates — one hub for every printable template: the school's own
 * document templates, the shared default gallery (lesson plan, report card,
 * worksheet, certificate) and the legacy certificate templates. Create new
 * ones, view any as a real file, and Generate a filled document.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FileText, Plus, Sparkles, Eye, Pencil, Trash2, Printer, Loader2, ArrowLeft, Save, X, Award, Upload,
} from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';

const BASE = '/api/school/mgmt';
const CATEGORIES = [
  { value: 'form', label: 'Form' }, { value: 'certificate', label: 'Certificate' },
  { value: 'report', label: 'Report' }, { value: 'result', label: 'Result' },
  { value: 'letter', label: 'Letter' }, { value: 'id_card', label: 'ID Card' }, { value: 'other', label: 'Other' },
];
const catColor = { form: BLUE, certificate: AMBER, report: PURPLE, result: GREEN, letter: MUTED2, id_card: '#EC4899', other: MUTED2 };
const catPill = (v) => { const c = catColor[v] || MUTED2; return <span style={{ padding: '2px 9px', borderRadius: 999, background: `${c}15`, color: c, fontSize: 10.5, fontWeight: 800, textTransform: 'capitalize' }}>{String(v || 'form').replace('_', ' ')}</span>; };

// Open rendered HTML in a new printable window.
const openHtml = (html) => { const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } };
const fetchText = (path) => fetch(`${API}${path}`, { credentials: 'include', headers: { 'X-Akoro-Portal': 'school' } }).then((r) => r.ok ? r.text() : '').catch(() => '');

// A live snapshot of a template — its rendered HTML scaled into the card.
function Thumb({ getHtml, baseW = 830, height = 122, fallback }) {
  const ref = useRef(null);
  const [html, setHtml] = useState(null);
  const [scale, setScale] = useState(0.28);
  useEffect(() => { let on = true; Promise.resolve(getHtml()).then((h) => on && setHtml(h || '')).catch(() => on && setHtml('')); return () => { on = false; }; }, []); // eslint-disable-line
  useEffect(() => { const w = ref.current?.offsetWidth; if (w) setScale(w / baseW); }, [html, baseW]);
  return (
    <div ref={ref} style={{ height, overflow: 'hidden', position: 'relative', background: '#f1f1f4', borderBottom: `1px solid ${BORDER}` }}>
      {html === null ? <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}><Loader2 size={16} color={MUTED2} style={{ animation: 'spin .8s linear infinite' }} /></div>
        : html === '' ? (fallback || null)
        : <iframe title="preview" srcDoc={html} scrolling="no" tabIndex={-1} aria-hidden style={{ width: baseW, height: baseW * 1.3, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }} />}
    </div>
  );
}
const IconBlock = ({ cat, height = 122 }) => (
  <div style={{ height, background: `linear-gradient(135deg, ${(catColor[cat] || AMBER)}14, ${BLUE}10)`, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${BORDER}` }}>
    {cat === 'certificate' ? <Award size={30} color={catColor.certificate} /> : <FileText size={28} color={catColor[cat] || BLUE} />}
  </div>
);

/* ═══════════════ Hub ═══════════════ */
export function DocumentTemplatesPage() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState(null);
  const [certs, setCerts] = useState([]);
  const [cat, setCat] = useState('');
  const [gen, setGen] = useState(null);       // template being generated
  const [upload, setUpload] = useState(false);  // upload-a-file modal
  const [upName, setUpName] = useState('');
  const [upCat, setUpCat] = useState('form');
  const [upFile, setUpFile] = useState(null);
  const [upBusy, setUpBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const closeUpload = () => { setUpload(false); setUpFile(null); setUpName(''); setUpCat('form'); };
  // Upload a sample document (photo / scan / PDF) → AI vision rebuilds it into a
  // reusable HTML template with {{placeholders}} for the variable fields.
  const doUpload = async () => {
    if (!upFile) { showToast('Choose a document photo or PDF'); return; }
    setUpBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', upFile);
      if (upName.trim()) fd.append('name', upName.trim());
      fd.append('category', upCat);
      const r = await fetch(`${API}${BASE}/document-templates/build-from-file`, {
        method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'school' }, body: fd,
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || 'Could not build the template');
      showToast('Template built from your document ✓'); closeUpload(); load();
    } catch (e) { showToast(e.message || 'Upload failed'); }
    finally { setUpBusy(false); }
  };

  const load = useCallback(() => {
    apiGet(`${BASE}/document-templates`).then((r) => setDocs(r.data || [])).catch(() => setDocs([]));
    apiGet(`${BASE}/certificate-templates`).then((r) => setCerts(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  // Merge doc templates + legacy certs into one list.
  const all = useMemo(() => {
    const d = (docs || []).map((t) => ({ ...t, kind: 'doc' }));
    const c = (certs || []).map((t) => ({ id: t.id, name: t.name, description: t.description, category: 'certificate', kind: 'cert' }));
    return [...d, ...c].filter((t) => !cat || t.category === cat);
  }, [docs, certs, cat]);

  // Open the rendered template in a new tab. We can't point window.open at the
  // API URL directly: that navigation can't send the X-Akoro-Portal header the
  // API needs to read the school session cookie, so it 401s ("Access token
  // required"). Instead open a blank tab synchronously (keeps the click gesture
  // so it isn't popup-blocked) and fill it from an authenticated fetch.
  const view = (t) => {
    const w = window.open('', '_blank');
    fetchText(`${BASE}/document-templates/${encodeURIComponent(t.id)}/html?sample=1`)
      .then((html) => {
        if (!w) return;
        if (html) { w.document.write(html); w.document.close(); }
        else { w.close(); showToast('Could not load template'); }
      });
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.name}"?`)) return;
    try { await apiDelete(`${BASE}/${t.kind === 'cert' ? 'certificate-templates' : 'document-templates'}/${t.id}`); showToast('Deleted'); load(); }
    catch (e) { showToast(e.message); }
  };

  const card = { background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' };
  const actBtn = (color) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, border: `1px solid ${color}44`, background: `${color}0C`, color, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT });

  return (
    <PageLayout title="Document Templates" subtitle="All your printable templates — forms, reports, worksheets and certificates, in one place">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 3, flexWrap: 'wrap' }}>
          {[{ value: '', label: 'All' }, ...CATEGORIES].map((c) => (
            <button key={c.value} onClick={() => setCat(c.value)} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 800, background: cat === c.value ? WHITE : 'transparent', color: cat === c.value ? INK : MUTED2, boxShadow: cat === c.value ? '0 1px 3px rgba(0,0,0,.12)' : 'none' }}>{c.label}</button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button onClick={() => setGen({ pick: true })} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${BLUE}55`, background: `${BLUE}0C`, color: BLUE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}><Printer size={14} /> Generate</button>
          <button onClick={() => setUpload(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: INK, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}><Upload size={14} /> Upload</button>
          <button onClick={() => navigate('/mgmt/document-templates/new')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}><Plus size={15} /> New Template</button>
        </div>
      </div>

      {docs === null ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2, fontFamily: FONT }}><Loader2 size={22} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {all.map((t) => (
            <div key={`${t.kind}-${t.id}`} style={card}>
              {t.kind === 'doc'
                ? <Thumb getHtml={() => fetchText(`${BASE}/document-templates/${encodeURIComponent(t.id)}/html?sample=1`)} baseW={t.orientation === 'landscape' ? 1150 : 830} fallback={<IconBlock cat={t.category} />} />
                : <IconBlock cat={t.category} />}
              <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: FONT }}>{t.name}</span>
                  {catPill(t.category)}
                  {t.isDefault && <span style={{ fontSize: 9.5, fontWeight: 800, color: BLUE, textTransform: 'uppercase' }}>Starter</span>}
                  {t.kind === 'cert' && <span style={{ fontSize: 9.5, fontWeight: 800, color: MUTED2, textTransform: 'uppercase' }}>Classic</span>}
                </div>
                {t.description && <div style={{ fontSize: 11.5, color: MUTED2, fontFamily: FONT, flex: 1 }}>{t.description}</div>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {t.kind === 'doc' && <button onClick={() => view(t)} style={actBtn(INK)}><Eye size={12} /> View</button>}
                  <button onClick={() => setGen(t)} style={actBtn(AMBER)}><Printer size={12} /> Generate</button>
                  {t.kind === 'doc' && !t.isDefault && <button onClick={() => navigate(`/mgmt/document-templates/${t.id}`)} style={actBtn(BLUE)}><Pencil size={12} /> Edit</button>}
                  {t.kind === 'doc' && t.isDefault && <button onClick={() => navigate(`/mgmt/document-templates/new?from=${t.id.replace('default:', '')}`)} style={actBtn(BLUE)}><Pencil size={12} /> Customize</button>}
                  {!t.isDefault && <button onClick={() => remove(t)} style={actBtn(RED)}><Trash2 size={12} /></button>}
                </div>
              </div>
            </div>
          ))}
          {all.length === 0 && <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: MUTED2, fontFamily: FONT, padding: 30 }}>No templates in this category.</div>}
        </div>
      )}

      {gen && <GenerateModal seed={gen} allDocs={docs || []} allCerts={certs} onClose={() => setGen(null)} showToast={showToast} onDone={load} />}

      {upload && (
        <div onClick={closeUpload} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: WHITE, borderRadius: 16, padding: '20px 22px', fontFamily: FONT }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: INK }}>Build from a document</span>
              <button onClick={closeUpload} style={{ border: 'none', background: 'none', cursor: 'pointer', color: MUTED2 }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 14px', lineHeight: 1.5 }}>Upload a <b>photo, scan or PDF</b> of an existing document. AI recreates it as a reusable printable template, turning the variable fields into <b>{'{{placeholders}}'}</b> you can fill later.</p>
            <label style={{ fontSize: 12, fontWeight: 700, color: MUTED, display: 'block', margin: '0 0 5px' }}>Template name</label>
            <input value={upName} onChange={(e) => setUpName(e.target.value)} placeholder="Defaults to the file name" style={{ ...inputStyle, marginBottom: 12 }} />
            <label style={{ fontSize: 12, fontWeight: 700, color: MUTED, display: 'block', margin: '0 0 5px' }}>Category</label>
            <select value={upCat} onChange={(e) => setUpCat(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <label style={{ fontSize: 12, fontWeight: 700, color: MUTED, display: 'block', margin: '0 0 5px' }}>Document (photo, scan or PDF)</label>
            <input type="file" accept="image/*,application/pdf,.pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => { const f = e.target.files?.[0] || null; setUpFile(f); if (f && !upName.trim()) setUpName(f.name.replace(/\.[^.]+$/, '')); }} style={{ fontFamily: FONT, fontSize: 13 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={closeUpload} style={{ padding: '9px 16px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: INK, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
              <button onClick={doUpload} disabled={upBusy || !upFile} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, border: 'none', background: upBusy || !upFile ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: upBusy || !upFile ? '#9CA3AF' : WHITE, fontSize: 12.5, fontWeight: 800, cursor: upBusy || !upFile ? 'default' : 'pointer', fontFamily: FONT }}>
                {upBusy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Sparkles size={14} />}{upBusy ? 'Building…' : 'Build template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Generate modal — fill a template and produce a printable document ────── */
function GenerateModal({ seed, allDocs, allCerts, onClose, showToast, onDone }) {
  const preselect = seed?.pick ? '' : `${seed.kind}:${seed.id}`;
  const [sel, setSel] = useState(preselect);
  const [values, setValues] = useState({});
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);

  const options = [
    ...allDocs.map((t) => ({ v: `doc:${t.id}`, label: `${t.name}`, kind: 'doc', t })),
    ...allCerts.map((t) => ({ v: `cert:${t.id}`, label: `${t.name} (classic)`, kind: 'cert', t })),
  ];
  const chosen = options.find((o) => o.v === sel);
  const vars = chosen?.kind === 'doc' ? (chosen.t.variables || []) : [];

  const generate = async () => {
    if (!chosen) return showToast('Pick a template');
    setBusy(true);
    try {
      if (chosen.kind === 'doc') {
        const id = chosen.t.id;
        const r = await apiPost(`${BASE}/document-templates/${encodeURIComponent(id)}/render`, { data: values, save: true, title: chosen.t.name });
        openHtml(r.html);
        onDone();
      } else {
        if (!recipient.trim()) return showToast('Enter a recipient name');
        const r = await apiPost(`${BASE}/certificates/generate`, { template_id: chosen.t.id, recipient_name: recipient.trim() });
        openHtml(`<div style="font-family:Georgia,serif;max-width:640px;margin:40px auto;text-align:center;line-height:1.8"><h2>${chosen.t.name}</h2><p style="color:#888">Serial: ${r.data.serial_no}</p><p>${(r.data.body || '').replace(/\n/g, '<br>')}</p></div>`);
        onDone();
      }
      onClose();
    } catch (e) { showToast(e.message || 'Could not generate'); }
    finally { setBusy(false); }
  };

  const lbl = { fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT, display: 'block', margin: '0 0 5px' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, maxHeight: '86vh', overflowY: 'auto', background: WHITE, borderRadius: 16, padding: '20px 22px', fontFamily: FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: INK }}>Generate Document</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: MUTED2 }}><X size={18} /></button>
        </div>
        <label style={lbl}>Template</label>
        <select value={sel} onChange={(e) => { setSel(e.target.value); setValues({}); }} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 14 }}>
          <option value="">— select template —</option>
          {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>

        {chosen?.kind === 'doc' && vars.map((v) => (
          <div key={v.key} style={{ marginBottom: 10 }}>
            <label style={lbl}>{v.label || v.key}</label>
            <input value={values[v.key] || ''} onChange={(e) => setValues((s) => ({ ...s, [v.key]: e.target.value }))} style={inputStyle} />
          </div>
        ))}
        {chosen?.kind === 'doc' && vars.length === 0 && <p style={{ fontSize: 12, color: MUTED2 }}>This template has no fillable fields — it will render as-is.</p>}
        {chosen?.kind === 'cert' && (
          <div style={{ marginBottom: 10 }}><label style={lbl}>Recipient name</label><input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="e.g. Mrs. Grace Okon" style={inputStyle} /></div>
        )}

        <button onClick={generate} disabled={busy || !chosen} style={{ width: '100%', marginTop: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: (busy || !chosen) ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: (busy || !chosen) ? '#9CA3AF' : WHITE, fontSize: 13.5, fontWeight: 800, cursor: (busy || !chosen) ? 'default' : 'pointer', fontFamily: FONT }}>
          {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Printer size={14} />} Generate &amp; Open
        </button>
      </div>
    </div>
  );
}

/* ═══════════════ Template editor (split live A4 preview) ═══════════════ */
const SAMPLE_BODY = `<h1>New Document</h1>
<p class="sub">{{school_name}}</p>
<div class="row">Name <span class="grow">{{name}}</span></div>
<table style="margin-top:12px">
  <tr><th>Item</th><th>Detail</th></tr>
  <tr><td style="height:30px">Example</td><td></td></tr>
</table>`;

export function DocumentTemplateEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const fromDefault = new URLSearchParams(window.location.search).get('from');
  const isNew = !id;
  const [form, setForm] = useState({ name: '', description: '', category: 'form', page_size: 'A4', orientation: 'portrait', body: SAMPLE_BODY, css: '', variables: [] });
  const [loading, setLoading] = useState(!isNew || !!fromDefault);
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    const src = id || (fromDefault ? `default:${fromDefault}` : null);
    if (!src) return;
    apiGet(`${BASE}/document-templates`).then((r) => {
      const t = (r.data || []).find((x) => x.id === src);
      if (t) setForm({ name: fromDefault ? `${t.name} (copy)` : t.name, description: t.description || '', category: t.category || 'form', page_size: t.page_size || 'A4', orientation: t.orientation || 'portrait', body: t.body || SAMPLE_BODY, css: t.css || '', variables: t.variables || [] });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [id, fromDefault]);

  // Live A4 preview through the real document renderer, debounced.
  useEffect(() => {
    if (loading) return;
    setPreviewing(true);
    const sample = Object.fromEntries((form.variables || []).map((v) => [v.key, `[${v.label || v.key}]`]));
    const t = setTimeout(() => {
      apiPost(`${BASE}/documents/preview`, { body: form.body, css: form.css, page_size: form.page_size, orientation: form.orientation, data: sample })
        .then((r) => setPreviewHtml(r.html || '')).catch(() => {}).finally(() => setPreviewing(false));
    }, 450);
    return () => clearTimeout(t);
  }, [form.body, form.css, form.page_size, form.orientation, form.variables, loading]);

  const save = async () => {
    if (!form.name.trim()) return showToast('Name is required');
    setSaving(true);
    const body = { ...form };
    try {
      if (id && !id.startsWith('default:')) await apiPut(`${BASE}/document-templates/${id}`, body);
      else await apiPost(`${BASE}/document-templates`, body);   // new, or "customize a default" → owned copy
      navigate('/mgmt/document-templates');
    } catch (e) { showToast(e.message || 'Could not save'); setSaving(false); }
  };

  const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: INK, margin: '0 0 5px', fontFamily: FONT };
  const addVar = () => setForm((f) => ({ ...f, variables: [...(f.variables || []), { key: '', label: '' }] }));
  const setVar = (i, patch) => setForm((f) => ({ ...f, variables: f.variables.map((v, j) => j === i ? { ...v, ...patch } : v) }));
  const delVar = (i) => setForm((f) => ({ ...f, variables: f.variables.filter((_, j) => j !== i) }));

  return (
    <PageLayout title={isNew ? 'New Template' : 'Edit Template'} subtitle="Document Templates">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/mgmt/document-templates')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}><ArrowLeft size={14} /> Back</button>
        <button onClick={save} disabled={saving || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 20px', borderRadius: 9, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 13, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>{saving ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} Save Template</button>
      </div>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2, fontFamily: FONT }}><Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 380px', minWidth: 320, maxWidth: 480, maxHeight: 'calc(100vh - 170px)', overflowY: 'auto', background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ marginBottom: 12 }}><label style={lbl}>Name <span style={{ color: RED }}>*</span></label><input value={form.name} onChange={set('name')} style={inputStyle} /></div>
            <div style={{ marginBottom: 12 }}><label style={lbl}>Description</label><input value={form.description} onChange={set('description')} style={inputStyle} /></div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}><label style={lbl}>Category</label><select value={form.category} onChange={set('category')} style={{ ...inputStyle, cursor: 'pointer' }}>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
              <div style={{ width: 90 }}><label style={lbl}>Page</label><select value={form.page_size} onChange={set('page_size')} style={{ ...inputStyle, cursor: 'pointer' }}><option>A4</option><option>Letter</option><option>A5</option><option>Legal</option></select></div>
              <div style={{ width: 110 }}><label style={lbl}>Layout</label><select value={form.orientation} onChange={set('orientation')} style={{ ...inputStyle, cursor: 'pointer' }}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <label style={{ ...lbl, margin: 0 }}>Fields (variables)</label>
                <button type="button" onClick={addVar} style={{ border: 'none', background: `${BLUE}12`, color: BLUE, borderRadius: 7, padding: '4px 10px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>+ Field</button>
              </div>
              {(form.variables || []).map((v, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input value={v.key} onChange={(e) => setVar(i, { key: e.target.value })} placeholder="key" style={{ ...inputStyle, flex: 1 }} />
                  <input value={v.label} onChange={(e) => setVar(i, { label: e.target.value })} placeholder="Label" style={{ ...inputStyle, flex: 1 }} />
                  <button onClick={() => delVar(i)} style={{ border: 'none', background: `${RED}12`, color: RED, borderRadius: 7, width: 32, cursor: 'pointer' }}><Trash2 size={12} /></button>
                </div>
              ))}
              <p style={{ fontSize: 11, color: MUTED2, margin: '4px 0 0', fontFamily: FONT }}>Use these as <code>{'{{key}}'}</code> in the body. Blank fields render as dotted lines (wrap in <code>&lt;span class="fill"&gt;</code>).</p>
            </div>
            <div style={{ marginBottom: 12 }}><label style={lbl}>Body (HTML — tables, sections, {'{{fields}}'})</label><textarea value={form.body} onChange={set('body')} style={{ ...inputStyle, minHeight: 220, resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} /></div>
            <div><label style={lbl}>Extra CSS (optional)</label><textarea value={form.css} onChange={set('css')} style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} /></div>
          </div>

          <div style={{ flex: '2 1 460px', minWidth: 320, display: 'flex', flexDirection: 'column', border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', background: WHITE, minHeight: 560 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: `1px solid ${BORDER}`, background: LIGHT }}>
              <span style={{ display: 'inline-flex', gap: 5 }}>{[RED, AMBER, GREEN].map((c) => <span key={c} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: MUTED2, fontFamily: FONT }}>Live Preview · {form.page_size} {form.orientation}</span>
              {previewing && <Loader2 size={12} color={MUTED2} style={{ animation: 'spin .8s linear infinite', marginLeft: 'auto' }} />}
            </div>
            <iframe title="Document preview" srcDoc={previewHtml} style={{ flex: 1, width: '100%', border: 'none', minHeight: 520, background: '#e9e9ee' }} />
          </div>
        </div>
      )}
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}
