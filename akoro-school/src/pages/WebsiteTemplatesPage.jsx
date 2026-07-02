import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, ToggleLeft, Palette, CheckCircle2, Pencil, Layers, Loader2 } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPost, apiPut } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, BLUE, FONT } from '../constants.js';

const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My School — Welcome</title>
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

const timeAgo = (iso) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
};

export default function WebsiteTemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [mode, setMode] = useState('theme'); // 'template' | 'theme'
  const [toast, setToast] = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    Promise.all([
      apiGet('/api/school/website/templates'),
      apiGet('/api/school/website'),
    ]).then(([tRes, wRes]) => {
      setTemplates(tRes.data || []);
      setMode(wRes.data?.mode || 'theme');
    }).catch((e) => showToast(e.message || 'Could not load templates'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const activate = async (id) => {
    setBusyId(id);
    try {
      await apiPost(`/api/school/website/templates/${id}/activate`, {});
      setTemplates((prev) => prev.map((t) => ({ ...t, active: t.id === id })));
      setMode('template');
      showToast('Template activated ✓');
    } catch (e) { showToast(e.message || 'Could not activate'); }
    finally { setBusyId(null); }
  };

  const newTemplate = async () => {
    setCreating(true);
    try {
      const res = await apiPost('/api/school/website/templates', { name: 'untitled-template', description: '', html: DEFAULT_HTML });
      navigate(`/settings-website/templates/${res.data.id}`, { state: { template: res.data } });
    } catch (e) { showToast(e.message || 'Could not create template'); }
    finally { setCreating(false); }
  };

  const switchMode = async () => {
    const next = mode === 'template' ? 'theme' : 'template';
    try {
      await apiPut('/api/school/website', { mode: next });
      setMode(next);
    } catch (e) { showToast(e.message || 'Could not switch mode'); }
  };

  return (
    <PageLayout title="Full HTML Templates" subtitle="Create and manage custom HTML landing pages for your school website">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/settings-website')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: LIGHT, color: MUTED, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <ArrowLeft size={14} /> Back to Website Settings
        </button>
        <button onClick={newTemplate} disabled={creating} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: 'none', background: creating ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: creating ? '#9CA3AF' : WHITE, fontSize: 12.5, fontWeight: 800, cursor: creating ? 'default' : 'pointer', fontFamily: FONT }}>
          {creating ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Plus size={14} />} New Template
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
        <button onClick={switchMode} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${BLUE}55`, background: WHITE, color: BLUE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>
          <Palette size={13} /> Switch to {mode === 'template' ? 'Theme' : 'Template'} Mode
        </button>
      </div>

      {/* Saved templates table */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 18px', borderBottom: `1px solid ${BORDER}` }}>
          <Layers size={15} color={MUTED} />
          <span style={{ fontSize: 13, fontWeight: 800, color: INK, fontFamily: FONT }}>Saved Templates ({templates.length})</span>
        </div>
        {loading ? (
          <div style={{ padding: '30px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={18} style={{ animation: 'spin .8s linear infinite' }} /></div>
        ) : templates.length === 0 ? (
          <div style={{ padding: '30px 18px', textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT }}>No templates yet — click "New Template" to create one.</div>
        ) : (
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
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: MUTED }}>{t.description || '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: MUTED }}>{timeAgo(t.updatedAt)}</td>
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
                        <button onClick={() => activate(t.id)} disabled={busyId === t.id} style={{ padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                          {busyId === t.id ? <Loader2 size={11} style={{ animation: 'spin .8s linear infinite' }} /> : 'Set Active'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
