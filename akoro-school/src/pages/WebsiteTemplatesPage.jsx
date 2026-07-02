import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Code2, ArrowLeft, Plus, ToggleLeft, Palette, CheckCircle2, Pencil, Layers } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, BLUE, FONT } from '../constants.js';

const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Yug International — Welcome</title>
  <meta name="description" content="Welcome to Yug International. Empowering students with knowledge, values, and skills for a brighter tomorrow.">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; color: #1a1a2e; }
    nav { padding: 20px 40px; display: flex; align-items: center; justify-content: space-between; background: #fff; }
    .logo { font-size: 24px; font-weight: 900; color: #1a56db; }
    .nav-links { display: flex; gap: 24px; list-style: none; }
    .nav-links a { font-size: 14px; font-weight: 600; color: #333; text-decoration: none; }
    .hero { min-height: 80vh; display: flex; align-items: center; justify-content: center; text-align: center; background: linear-gradient(160deg,#eef2ff,#fff); }
    .hero h1 { font-size: 48px; font-weight: 900; margin-bottom: 16px; }
    .hero span { color: #1a56db; }
    .hero p { font-size: 18px; color: #666; max-width: 600px; margin: 0 auto 32px; }
    .btn-primary { display: inline-block; padding: 14px 32px; border-radius: 50px; font-weight: 700; text-decoration: none; background: #1a56db; color: #fff; }
    footer { background: #1a202c; color: #ccc; padding: 40px; text-align: center; font-size: 14px; }
  </style>
</head>
<body>
  <nav>
    <div class="logo">Yug International</div>
    <ul class="nav-links">
      <li><a href="#about">About</a></li>
      <li><a href="#contact">Contact</a></li>
      <li><a href="/login">Login</a></li>
    </ul>
  </nav>

  <section class="hero">
    <div>
      <h1>Welcome to <span>Yug International</span></h1>
      <p>Empowering students with knowledge, values, and skills for a brighter tomorrow.</p>
      <a href="/login" class="btn-primary">Parent / Student Login</a>
    </div>
  </section>

  <footer>
    <p>&copy; 2026 Yug International. All Rights Reserved.</p>
  </footer>
</body>
</html>`;

const INITIAL_TEMPLATES = [
  { id: 'demo-templates', name: 'demo-templates', desc: '', updated: '1 month ago', active: true, html: DEFAULT_HTML },
];

export default function WebsiteTemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState(INITIAL_TEMPLATES);
  const [mode, setMode] = useState('template'); // 'template' | 'theme'

  const activate = (id) => setTemplates((prev) => prev.map((t) => ({ ...t, active: t.id === id })));

  const newTemplate = () => {
    const id = `template-${Date.now()}`;
    const tpl = { id, name: 'untitled-template', desc: '', updated: 'just now', active: false, html: DEFAULT_HTML };
    setTemplates((prev) => [...prev, tpl]);
    navigate(`/settings-website/templates/${id}`, { state: { template: tpl } });
  };

  return (
    <PageLayout title="Full HTML Templates" subtitle="Create and manage custom HTML landing pages for your school website">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/settings-website')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: LIGHT, color: MUTED, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <ArrowLeft size={14} /> Back to Website Settings
        </button>
        <button onClick={newTemplate} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <Plus size={14} /> New Template
        </button>
      </div>

      {/* Mode banner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', background: `${GREEN}0A`, border: `1.5px solid ${GREEN}44`, borderLeft: `4px solid ${GREEN}`, borderRadius: 12, padding: '14px 18px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <ToggleLeft size={20} color={GREEN} />
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT, marginRight: 8 }}>Website Mode:</span>
            <span style={{ fontSize: 11.5, fontWeight: 800, padding: '3px 10px', borderRadius: 999, background: mode === 'template' ? GREEN : MUTED2, color: WHITE, fontFamily: FONT }}>
              {mode === 'template' ? 'Full HTML Template' : 'Theme Mode'}
            </span>
            <p style={{ fontSize: 12, color: MUTED, margin: '6px 0 0', fontFamily: FONT }}>
              {mode === 'template'
                ? 'Your custom HTML template is live. Visitors see the full template (header to footer).'
                : 'Visitors see the Website Theme configured in Website Settings.'}
            </p>
          </div>
        </div>
        <button onClick={() => setMode((m) => (m === 'template' ? 'theme' : 'template'))} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${BLUE}55`, background: WHITE, color: BLUE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>
          <Palette size={13} /> Switch to {mode === 'template' ? 'Theme' : 'Template'} Mode
        </button>
      </div>

      {/* Saved templates table */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 18px', borderBottom: `1px solid ${BORDER}` }}>
          <Layers size={15} color={MUTED} />
          <span style={{ fontSize: 13, fontWeight: 800, color: INK, fontFamily: FONT }}>Saved Templates ({templates.length})</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, minWidth: 560 }}>
            <thead>
              <tr style={{ background: LIGHT }}>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .5 }}>STATUS</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .5 }}>TEMPLATE NAME</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .5 }}>DESCRIPTION</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .5 }}>LAST UPDATED</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .5 }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} style={{ borderTop: `1px solid ${BORDER}`, background: t.active ? `${GREEN}08` : 'transparent' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, background: t.active ? GREEN : BORDER, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      {t.active && <CheckCircle2 size={13} color={WHITE} />}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <p style={{ fontSize: 13, fontWeight: 800, color: INK, margin: 0 }}>{t.name}</p>
                    <p style={{ fontSize: 11, color: MUTED2, margin: '2px 0 0' }}>{t.name}</p>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: MUTED }}>{t.desc || '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: MUTED }}>{t.updated}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button onClick={() => navigate(`/settings-website/templates/${t.id}`, { state: { template: t } })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: 'none', background: BLUE, color: WHITE, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                        <Pencil size={11} /> Edit
                      </button>
                      {t.active ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${GREEN}55`, color: GREEN, fontSize: 11.5, fontWeight: 800, fontFamily: FONT }}>
                          <CheckCircle2 size={11} /> Active
                        </span>
                      ) : (
                        <button onClick={() => activate(t.id)} style={{ padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                          Set Active
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageLayout>
  );
}
