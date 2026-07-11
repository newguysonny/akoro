/**
 * Website Builder — Menus (WordPress-style menu builder).
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

/* ── Menus — WordPress-style menu builder ────────────────────────────────── */
const TARGETS = [{ value: '_self', label: 'Same tab' }, { value: '_blank', label: 'New tab' }];
const LOCATIONS = [
  { value: '', label: 'Not assigned' },
  { value: 'primary', label: 'Primary / Main menu (header)' },
  { value: 'footer', label: 'Footer menu' },
  { value: 'social', label: 'Social menu' },
];
const locLabel = (v) => (LOCATIONS.find((l) => l.value === (v || '')) || {}).label || 'Not assigned';

export function MenusPage() {
  const [menus, setMenus] = useState(null);
  const [sel, setSel] = useState(null);          // selected menu id
  const [pages, setPages] = useState([]);
  const [items, setItems] = useState([]);
  const [newMenuName, setNewMenuName] = useState('');
  const [menuName, setMenuName] = useState('');
  const [menuLoc, setMenuLoc] = useState('');
  const [addMode, setAddMode] = useState('page'); // page | custom
  const [addPageId, setAddPageId] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addTarget, setAddTarget] = useState('_self');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2800); };

  const loadMenus = useCallback(() => {
    apiGet(`${BASE}/menus`).then((r) => setMenus(r.data || [])).catch(() => setMenus([]));
  }, []);
  useEffect(() => { loadMenus(); apiGet(`${BASE}/site-pages?view=active`).then((r) => setPages(r.data || [])).catch(() => {}); }, [loadMenus]);

  const selMenu = (menus || []).find((m) => m.id === sel);
  const loadItems = useCallback((menuId) => {
    if (!menuId) return setItems([]);
    apiGet(`${BASE}/menu-items?menu_id=${menuId}`).then((r) => setItems(r.data || [])).catch(() => setItems([]));
  }, []);
  useEffect(() => { if (selMenu) { setMenuName(selMenu.name); setMenuLoc(selMenu.location || ''); loadItems(selMenu.id); } }, [sel]); // eslint-disable-line

  const createMenu = async () => {
    if (!newMenuName.trim()) return showToast('Enter a menu name');
    setBusy(true);
    try {
      const r = await apiPost(`${BASE}/menus`, { name: newMenuName.trim() });
      setNewMenuName(''); await loadMenus(); setSel(r.data.id);
    } catch (e) { showToast(e.message || 'Could not create'); } finally { setBusy(false); }
  };
  const saveMenu = async () => {
    setBusy(true);
    try {
      await apiPut(`${BASE}/menus/${sel}`, { name: menuName.trim() || 'Menu', location: menuLoc || null });
      await loadMenus(); showToast('Menu saved ✓');
    } catch (e) { showToast(e.message?.includes('exist') ? 'That location is already used by another menu' : (e.message || 'Could not save')); }
    finally { setBusy(false); }
  };
  const deleteMenu = async () => {
    if (!window.confirm(`Delete the menu “${selMenu.name}” and its items?`)) return;
    try { await apiDelete(`${BASE}/menus/${sel}`); setSel(null); setItems([]); loadMenus(); } catch (e) { showToast(e.message); }
  };

  const addItem = async () => {
    const order = (items[items.length - 1]?.sort_order ?? items.length - 1) + 1;
    let body;
    if (addMode === 'page') {
      if (!addPageId) return showToast('Choose a page');
      const p = pages.find((x) => x.id === addPageId);
      body = { menu_id: sel, label: addLabel.trim() || p?.title || 'Page', page_id: addPageId, target: addTarget, sort_order: order };
    } else {
      if (!addLabel.trim() || !addUrl.trim()) return showToast('Label and URL are required');
      body = { menu_id: sel, label: addLabel.trim(), url: addUrl.trim(), target: addTarget, sort_order: order };
    }
    try {
      await apiPost(`${BASE}/menu-items`, body);
      setAddPageId(''); setAddLabel(''); setAddUrl('');
      loadItems(sel);
    } catch (e) { showToast(e.message || 'Could not add'); }
  };
  const removeItem = async (it) => { try { await apiDelete(`${BASE}/menu-items/${it.id}`); loadItems(sel); } catch (e) { showToast(e.message); } };
  const move = async (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const a = items[idx], b = items[j];
    try {
      await Promise.all([
        apiPut(`${BASE}/menu-items/${a.id}`, { sort_order: b.sort_order }),
        apiPut(`${BASE}/menu-items/${b.id}`, { sort_order: a.sort_order }),
      ]);
      loadItems(sel);
    } catch (e) { showToast(e.message); }
  };

  const card = { background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px' };
  const smallLabel = { display: 'block', fontSize: 12, fontWeight: 700, color: MUTED, margin: '0 0 5px', fontFamily: FONT };

  return (
    <PageLayout title="Menus" subtitle="Build navigation menus for your website — primary, footer and social">
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: menu list + create */}
        <aside style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><MenuIcon size={15} color={AMBER} /><span style={{ fontSize: 13, fontWeight: 800, color: INK, fontFamily: FONT }}>Your Menus</span></div>
            {menus === null ? <Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /> : menus.length === 0 ? (
              <p style={{ fontSize: 12.5, color: MUTED2, fontFamily: FONT }}>No menus yet. Create one below.</p>
            ) : menus.map((m) => (
              <button key={m.id} onClick={() => setSel(m.id)} style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 9, marginBottom: 6, cursor: 'pointer', fontFamily: FONT,
                border: `1px solid ${sel === m.id ? AMBER : BORDER}`, background: sel === m.id ? `${AMBER}0C` : WHITE,
              }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{m.name}</div>
                <div style={{ fontSize: 11, color: m.location ? GREEN : MUTED2, marginTop: 2, fontWeight: 700 }}>{locLabel(m.location)}</div>
              </button>
            ))}
          </div>
          <div style={card}>
            <label style={smallLabel}>Create a new menu</label>
            <input value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} placeholder="e.g. Primary Menu" style={inputStyle} />
            <button onClick={createMenu} disabled={busy} style={{ ...addBtn, marginTop: 10, width: '100%', justifyContent: 'center' }}><Plus size={15} /> Create Menu</button>
          </div>
        </aside>

        {/* Right: selected menu editor */}
        <section style={{ flex: '2 1 460px', minWidth: 300 }}>
          {!selMenu ? (
            <div style={{ ...card, textAlign: 'center', color: MUTED2, padding: '48px 20px', fontFamily: FONT }}>Select a menu on the left, or create one to get started.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={card}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '1 1 200px' }}><label style={smallLabel}>Menu name</label><input value={menuName} onChange={(e) => setMenuName(e.target.value)} style={inputStyle} /></div>
                  <div style={{ flex: '1 1 200px' }}><label style={smallLabel}>Display location</label>
                    <select value={menuLoc} onChange={(e) => setMenuLoc(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>{LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select>
                  </div>
                  <button onClick={saveMenu} disabled={busy} style={addBtn}><Save size={14} /> Save</button>
                  <button onClick={deleteMenu} title="Delete menu" style={{ ...iconBtn(RED), width: 38, height: 38 }}><Trash2 size={15} /></button>
                </div>
              </div>

              {/* Items */}
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK, fontFamily: FONT, marginBottom: 12 }}>Menu structure</div>
                {items.length === 0 ? <p style={{ fontSize: 12.5, color: MUTED2, fontFamily: FONT, marginBottom: 12 }}>No items yet — add pages or custom links below.</p> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                    {items.map((it, i) => (
                      <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${BORDER}`, borderRadius: 9, padding: '9px 12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <button onClick={() => move(i, -1)} disabled={i === 0} style={{ ...iconBtn(MUTED2), width: 22, height: 18, opacity: i === 0 ? .3 : 1 }}><ChevronUp size={13} /></button>
                          <button onClick={() => move(i, 1)} disabled={i === items.length - 1} style={{ ...iconBtn(MUTED2), width: 22, height: 18, opacity: i === items.length - 1 ? .3 : 1 }}><ChevronDown size={13} /></button>
                        </div>
                        {it.page_id ? <FileText size={14} color={BLUE} /> : <Link2 size={14} color={PURPLE} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT }}>{it.label}</div>
                          <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT }}>{it.page_id ? (it.page_id_name ? `Page: ${it.page_id_name}` : 'Page') : it.url}{it.target === '_blank' ? ' · new tab' : ''}</div>
                        </div>
                        <button onClick={() => removeItem(it)} style={iconBtn(RED)}><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add item */}
                <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 14 }}>
                  <div style={{ display: 'inline-flex', background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 9, padding: 3, marginBottom: 12 }}>
                    {[{ k: 'page', l: 'Add Page' }, { k: 'custom', l: 'Custom Link' }].map((m) => (
                      <button key={m.k} onClick={() => setAddMode(m.k)} style={{ padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 800, background: addMode === m.k ? WHITE : 'transparent', color: addMode === m.k ? INK : MUTED2 }}>{m.l}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    {addMode === 'page' ? (
                      <div style={{ flex: '1 1 200px' }}><label style={smallLabel}>Page</label>
                        <select value={addPageId} onChange={(e) => setAddPageId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                          <option value="">Choose a page…</option>
                          {pages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                        </select>
                      </div>
                    ) : (
                      <>
                        <div style={{ flex: '1 1 140px' }}><label style={smallLabel}>Label</label><input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="e.g. Facebook" style={inputStyle} /></div>
                        <div style={{ flex: '1 1 180px' }}><label style={smallLabel}>URL</label><input value={addUrl} onChange={(e) => setAddUrl(e.target.value)} placeholder="https://…" style={inputStyle} /></div>
                      </>
                    )}
                    {addMode === 'page' && <div style={{ flex: '1 1 140px' }}><label style={smallLabel}>Label (optional)</label><input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="Defaults to page title" style={inputStyle} /></div>}
                    <div style={{ width: 120 }}><label style={smallLabel}>Opens</label>
                      <select value={addTarget} onChange={(e) => setAddTarget(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>{TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
                    </div>
                    <button onClick={addItem} style={addBtn}><Plus size={14} /> Add</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
      {toastEl(toast)}
    </PageLayout>
  );
}
