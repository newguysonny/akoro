import { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  Settings2, ArrowLeft, Save, CheckCircle2, Wand2, Terminal, Code2, Eye,
  ChevronDown, ChevronUp, Monitor, Tablet, Smartphone, RefreshCw,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, BLUE, FONT } from '../constants.js';

const VARIABLES = ['{{school_name}}', '{{school_logo}}', '{{principal_name}}', '{{school_address}}', '{{contact_email}}', '{{contact_phone}}'];
const SHORTCUTS = ['{{about_section}}', '{{notices_list}}', '{{events_list}}', '{{gallery_grid}}', '{{contact_form}}'];

function Collapsible({ title, items, open, onToggle }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: FONT }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: INK }}>{title}</span>
        {open ? <ChevronUp size={15} color={MUTED2} /> : <ChevronDown size={15} color={MUTED2} />}
      </button>
      {open && (
        <div style={{ padding: '0 16px 14px', display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {items.map((v) => (
            <code key={v} style={{ fontSize: 11.5, background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 7, padding: '5px 9px', color: '#D4651E', cursor: 'pointer', fontFamily: 'ui-monospace, Menlo, monospace' }}>{v}</code>
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
  const [desc, setDesc] = useState(seed?.desc || '');
  const [active] = useState(seed?.active ?? false);
  const [html, setHtml] = useState(seed?.html || '<!DOCTYPE html>\n<html>\n<head><title>New Template</title></head>\n<body>\n  <h1>Hello, {{school_name}}</h1>\n</body>\n</html>');
  const [tab, setTab] = useState('editor'); // 'editor' | 'preview'
  const [viewport, setViewport] = useState('desktop');
  const [openVars, setOpenVars] = useState(false);
  const [openShortcuts, setOpenShortcuts] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const viewportWidth = viewport === 'mobile' ? 380 : viewport === 'tablet' ? 620 : '100%';

  return (
    <PageLayout title={`Edit Template: ${name}`} subtitle="Full HTML template editor">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>
        <button onClick={() => navigate('/settings-website/templates')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: LIGHT, color: MUTED, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <ArrowLeft size={14} /> Back to Templates
        </button>
      </div>

      {/* Settings card */}
      <div style={{ background: WHITE, border: `1.5px solid ${AMBER}44`, borderRadius: 14, padding: '18px 20px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
          <Settings2 size={16} color={AMBER} />
          <span style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: FONT }}>Settings</span>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 6 }}>Template Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13.5, fontFamily: FONT, color: INK, boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 6 }}>Description</label>
          <textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Brief description…" style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13.5, fontFamily: FONT, color: INK, boxSizing: 'border-box', resize: 'vertical' }} />
        </div>

        {active && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: `${GREEN}0C`, border: `1px solid ${GREEN}33`, borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
            <CheckCircle2 size={14} color={GREEN} />
            <span style={{ fontSize: 12.5, color: INK, fontFamily: FONT }}>This template is <b>active</b> and currently displayed on your school website.</span>
          </div>
        )}

        <button onClick={save} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <Save size={15} /> {saved ? 'Saved ✓' : 'Save Template'}
        </button>
      </div>

      <Collapsible title="School Variables" items={VARIABLES} open={openVars} onToggle={() => setOpenVars((o) => !o)} />
      <Collapsible title="Shortcuts" items={SHORTCUTS} open={openShortcuts} onToggle={() => setOpenShortcuts((o) => !o)} />

      {/* Editor / Preview */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', marginTop: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${BORDER}`, padding: '4px 12px', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setTab('editor')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', border: 'none', borderBottom: tab === 'editor' ? `2px solid ${AMBER}` : '2px solid transparent', background: 'transparent', color: tab === 'editor' ? AMBER : MUTED, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
              <Code2 size={14} /> HTML Editor
            </button>
            <button onClick={() => setTab('preview')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', border: 'none', borderBottom: tab === 'preview' ? `2px solid ${AMBER}` : '2px solid transparent', background: 'transparent', color: tab === 'preview' ? AMBER : MUTED, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
              <Eye size={14} /> Live Preview
            </button>
          </div>
          {tab === 'preview' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {[['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]].map(([k, Icon]) => (
                <button key={k} onClick={() => setViewport(k)} style={{ width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${viewport === k ? BLUE : BORDER}`, background: viewport === k ? `${BLUE}10` : WHITE, color: viewport === k ? BLUE : MUTED2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={14} />
                </button>
              ))}
              <button style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderRadius: 8, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                <RefreshCw size={11} /> Refresh
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
          <div style={{ padding: '20px', background: LIGHT, display: 'flex', justifyContent: 'center' }}>
            <iframe
              title="Template preview"
              srcDoc={html}
              style={{ width: viewportWidth, maxWidth: '100%', height: 480, border: `1px solid ${BORDER}`, borderRadius: 10, background: WHITE }}
            />
          </div>
        )}
      </div>
    </PageLayout>
  );
}
