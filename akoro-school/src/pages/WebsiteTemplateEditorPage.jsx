import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import BackButton from '../components/BackButton.jsx';
import { apiGet, apiPut } from '../services/api.js';
import { GREEN, BLUE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

// These are the tokens the backend renderer (siteRenderer.js) actually substitutes.
const VARIABLES = ['{{school_name}}', '{{school_acronym}}', '{{school_logo}}', '{{principal_name}}', '{{school_address}}', '{{contact_email}}', '{{contact_phone}}', '{{hero_title}}', '{{hero_subtitle}}', '{{about_text}}', '{{year}}'];
// Section loops + conditionals. Inside {{#each courses}} use {{title}}, {{subject}}, {{level}}, {{price}}; teachers/classes expose {{name}}.
const SHORTCUTS = [
  '{{#each courses}} … {{/each}}',
  '{{#each teachers}} … {{/each}}',
  '{{#each classes}} … {{/each}}',
  '{{#if about_text}} … {{/if}}',
  '{{stats.courses}}', '{{stats.teachers}}', '{{stats.classes}}',
];

function Collapsible({ title, items, open, onToggle, onInsert }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: C.font }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{title}</span>
        {open ? <Ico ti="ti-chevron-up" size={15} color={C.muted2} /> : <Ico ti="ti-chevron-down" size={15} color={C.muted2} />}
      </button>
      {open && (
        <div style={{ padding: '0 16px 14px', display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {items.map((v) => (
            <code key={v} onClick={() => onInsert?.(v)} title="Click to copy" style={{ fontSize: 11.5, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: '5px 9px', color: C.brandDeep, cursor: 'pointer', fontFamily: 'ui-monospace, Menlo, monospace' }}>{v}</code>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WebsiteTemplateEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { state } = useLocation();
  const seed = state?.template;

  const [name, setName] = useState(seed?.name || id || 'untitled-template');
  const [desc, setDesc] = useState(seed?.description || '');
  const [active, setActive] = useState(seed?.active ?? false);
  const [html, setHtml] = useState(seed?.html || '<!DOCTYPE html>\n<html>\n<head><title>New Template</title></head>\n<body>\n  <h1>Hello, {{school_name}}</h1>\n</body>\n</html>');
  const [tab, setTab] = useState('editor'); // 'editor' | 'preview'
  const [viewport, setViewport] = useState('desktop');
  const [openVars, setOpenVars] = useState(false);
  const [openShortcuts, setOpenShortcuts] = useState(false);
  const [loading, setLoading] = useState(!seed?.html);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    if (seed?.html) { setLoading(false); return; }
    apiGet(`/api/school/website/templates/${id}`)
      .then((res) => {
        const t = res.data;
        setName(t.name); setDesc(t.description || ''); setActive(t.active); setHtml(t.html || '');
      })
      .catch((e) => showToast(e.message || 'Could not load template'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = async () => {
    setSaving(true);
    try {
      await apiPut(`/api/school/website/templates/${id}`, { name, description: desc, html });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  const viewportWidth = viewport === 'mobile' ? 380 : viewport === 'tablet' ? 620 : '100%';

  return (
    <PageLayout title={`Edit Template: ${name}`} subtitle="Full HTML template editor">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>
        <BackButton onClick={() => navigate('/settings-website/templates')} label="Back to Templates" />
      </div>

      {/* Settings card */}
      <div style={{ background: C.surface, border: `1.5px solid ${tint(27)}`, borderRadius: 14, padding: '18px 20px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
          <Ico ti="ti-settings-2" size={16} color={C.brand} />
          <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, fontFamily: C.font }}>Settings</span>
          {loading && <Ico ti="ti-loader-2" size={13} color={C.muted2} style={{ animation: 'spin .8s linear infinite' }} />}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>Template Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${C.border}`, outline: 'none', fontSize: 13.5, fontFamily: C.font, color: C.ink, boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 6 }}>Description</label>
          <textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Brief description…" style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${C.border}`, outline: 'none', fontSize: 13.5, fontFamily: C.font, color: C.ink, boxSizing: 'border-box', resize: 'vertical' }} />
        </div>

        {active && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: `${GREEN}0C`, border: `1px solid ${GREEN}33`, borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
            <Ico ti="ti-circle-check" size={14} color={GREEN} />
            <span style={{ fontSize: 12.5, color: C.ink, fontFamily: C.font }}>This template is <b>active</b> and currently displayed on your school website.</span>
          </div>
        )}

        <button onClick={save} disabled={saving} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: saving ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: saving ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: C.font }}>
          {saving ? <Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={15} />} {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Template'}
        </button>
      </div>

      <Collapsible title="School Variables" items={VARIABLES} open={openVars} onToggle={() => setOpenVars((o) => !o)} onInsert={(v) => { navigator.clipboard?.writeText(v); showToast(`Copied ${v}`); }} />
      <Collapsible title="Section Loops & Conditionals" items={SHORTCUTS} open={openShortcuts} onToggle={() => setOpenShortcuts((o) => !o)} onInsert={(v) => { navigator.clipboard?.writeText(v); showToast(`Copied ${v}`); }} />

      {/* Editor / Preview */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', marginTop: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.border}`, padding: '4px 12px', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setTab('editor')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', border: 'none', borderBottom: tab === 'editor' ? `2px solid ${C.brand}` : '2px solid transparent', background: 'transparent', color: tab === 'editor' ? C.brand : C.muted, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
              <Ico ti="ti-code" size={14} /> HTML Editor
            </button>
            <button onClick={() => setTab('preview')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', border: 'none', borderBottom: tab === 'preview' ? `2px solid ${C.brand}` : '2px solid transparent', background: 'transparent', color: tab === 'preview' ? C.brand : C.muted, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
              <Ico ti="ti-eye" size={14} /> Live Preview
            </button>
          </div>
          {tab === 'preview' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {[['desktop', 'ti-device-desktop'], ['tablet', 'ti-device-tablet'], ['mobile', 'ti-device-mobile']].map(([k, ti]) => (
                <button key={k} onClick={() => setViewport(k)} style={{ width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${viewport === k ? BLUE : C.border}`, background: viewport === k ? `${BLUE}10` : C.surface, color: viewport === k ? BLUE : C.muted2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ico ti={ti} size={14} />
                </button>
              ))}
              <button style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderRadius: 8, border: `1.5px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>
                <Ico ti="ti-refresh" size={11} /> Refresh
              </button>
            </div>
          )}
        </div>

        {tab === 'editor' ? (
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            spellCheck={false}
            style={{
              width: '100%', minHeight: 420, padding: '16px 18px', border: 'none', outline: 'none',
              resize: 'vertical', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12.5,
              lineHeight: 1.7, color: '#E2E8F0', background: '#1A202C', boxSizing: 'border-box',
            }}
          />
        ) : (
          <div style={{ padding: '20px', background: C.bg, display: 'flex', justifyContent: 'center' }}>
            <iframe
              title="Template preview"
              srcDoc={html}
              sandbox=""
              style={{ width: viewportWidth, maxWidth: '100%', height: 480, border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface }}
            />
          </div>
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
