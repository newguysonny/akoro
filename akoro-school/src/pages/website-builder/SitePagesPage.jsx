/**
 * Website Builder — Pages list (WordPress-style, trash/restore/delete).
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, RotateCcw, ArrowLeft, Save, Loader2, FileText, X,
  ChevronUp, ChevronDown, Link2, Menu as MenuIcon, Image as ImageIcon, UploadCloud,
  Sparkles, Type, LayoutGrid, Minus, Code, GripVertical,
} from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../services/api.js';
import { INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, AMBER, BLUE, PURPLE, RED, FONT } from '../../constants.js';
import { BASE, slugify, pill, th, td, iconBtn, Tabs, addBtn, backBtn, toastEl, miniBtn } from './shared.jsx';
import { confirmDialog } from '../../components/ConfirmHost.jsx';

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
  const destroy = async (r) => { if (await confirmDialog(`Permanently delete “${r.title}”? This cannot be undone.`)) act(r.id, () => apiDelete(`${BASE}/site-pages/${r.id}`), 'Deleted permanently'); };

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
