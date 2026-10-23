/**
 * MarketplacePage — composes the components from ./parts.jsx.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import ToolsWorkbench from '../../components/teaching/ToolsWorkbench.jsx';
import { Upload } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import { apiGet, apiPost, API } from '../../services/api.js';
import { useNavigate } from 'react-router-dom';
import { uploadAndOcr } from '../../services/uploadApi.js';
import { GREEN, RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

import { BRAND, FONTF, naira, TEMPLATE_TARGETS, CreateTemplateModal, ViewTemplateModal, ItemCard } from './parts.jsx';

export default function MarketplacePage() {
  const navigate = useNavigate();
  const [tab, setTab]       = useState('tools');
  const [tools, setTools]   = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast]   = useState('');
  const [templates, setTemplates] = useState([]);
  const [showTplModal, setShowTpl] = useState(false);
  const [viewTpl, setViewTpl] = useState(null);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const loadTemplates = useCallback(() => {
    apiGet('/api/instructor/tools/templates')
      // Sample templates now live in the Documents page — hide them here.
      .then((res) => setTemplates((res.templates || []).filter((t) => !t.is_sample)))
      .catch(() => {});
  }, []);

  const deleteTemplate = async (id) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    try { await fetch(`${API}/api/instructor/tools/templates/${id}`, { method: 'DELETE', credentials: 'include', headers: { 'X-Akoro-Portal': 'instructor' } }); }
    catch { /* ignore */ }
  };

  const load = useCallback(async () => {
    try {
      const res = await apiGet('/api/instructor/tools');
      setTools(res.tools || []);
      setAssets(res.assets || []);
    } catch (e) {
      showToast(e.message || 'Could not load catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  /* Initial load + handle Paystack redirect (?tool_ref=...) */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('tool_ref');
    if (ref) {
      // Clean the URL, then verify the payment before loading the catalog
      window.history.replaceState({}, '', window.location.pathname);
      apiGet(`/api/instructor/tools/verify/${ref}`)
        .then((r) => showToast(r?.owned ? 'Unlocked ✓' : (r?.message || 'Payment not completed')))
        .catch((e) => showToast(e.message || 'Verification failed'))
        .finally(load);
    } else {
      load();
    }
    loadTemplates();
  }, [load, loadTemplates]);

  const buy = async (item) => {
    // Paid → review on the checkout page; free → unlock directly.
    if (item.price !== 0) {
      navigate('/purchase', { state: { title: item.name, subtitle: 'Tool / asset unlock', amountNaira: item.price, initPath: '/api/instructor/tools/checkout', initBody: { toolId: item.id } } });
      return;
    }
    setBusyId(item.id);
    try {
      const res = await apiPost('/api/instructor/tools/checkout', { toolId: item.id });
      if (res?.owned) { showToast('Unlocked ✓'); await load(); }
      else showToast(res?.error || 'Could not unlock');
    } catch (e) {
      showToast(e.message || 'Checkout failed');
    } finally {
      setBusyId(null);
    }
  };

  // This page shows only what the instructor already owns; browsing/unlocking
  // lives in the App Center.
  const items      = (tab === 'tools' ? tools : assets).filter((i) => i.owned);
  const ownedCount = items.length;

  return (
    <PageLayout title="Tools & Assets" subtitle="Your unlocked tools, assets & templates">
      <div style={{ maxWidth: tab === 'tools' ? 1040 : 600, margin: '0 auto' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', background: C.surface, borderRadius: 12, padding: 4, marginBottom: 18, border: `1px solid ${C.border}`, gap: 4 }}>
          {(() => {
            const ot = tools.filter((i) => i.owned).length, oa = assets.filter((i) => i.owned).length;
            return [['tools', `Tools${ot ? ` (${ot})` : ''}`], ['assets', `Assets${oa ? ` (${oa})` : ''}`]];
          })().map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '9px 0', borderRadius: 9, border: 'none',
              background: tab === t ? BRAND : 'transparent',
              color: tab === t ? '#fff' : C.muted2,
              fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONTF, transition: 'all .2s',
            }}>{label}</button>
          ))}
        </div>

        {/* ── Tools tab: the working tools, laid out like the content hub ── */}
        {tab === 'tools' && (
          <div style={{ marginBottom: 26 }}>
            <ToolsWorkbench />
          </div>
        )}

        {/* ── My Templates (Assets tab) ── */}
        {tab === 'assets' && (
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '0 2px' }}>
              <p style={{ fontSize: 11, fontWeight: 900, color: BRAND, letterSpacing: 1.5, textTransform: 'uppercase', margin: 0 }}>My Templates</p>
              <button onClick={() => setShowTpl(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 20, border: `1.5px solid ${BRAND}`, background: tint(8), color: BRAND, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONTF }}>
                <Ico ti="ti-plus" size={13} /> Create template
              </button>
            </div>
            {templates.length === 0 ? (
              <div style={{ padding: '18px', borderRadius: 14, border: `1.5px dashed ${C.border}`, background: C.bg, textAlign: 'center', fontSize: 12.5, color: C.muted }}>
                Upload a photo of your notes or worksheet to make a reusable template your agent copies.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {templates.map((t) => (
                  <div key={t.id} onClick={() => setViewTpl(t)} style={{ display: 'flex', alignItems: 'center', gap: 11, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '11px 13px', cursor: 'pointer' }}>
                    <div style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 9, background: tint(7, BRAND), display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti="ti-file-text" size={16} color={BRAND} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                        {t.is_sample && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 7px', borderRadius: 20, background: `${GREEN}15`, color: GREEN, flexShrink: 0 }}>SAMPLE</span>}
                      </div>
                      <div style={{ fontSize: 11, color: C.muted2 }}>{(TEMPLATE_TARGETS.find((x) => x.value === t.tool_target) || {}).label || t.tool_target}</div>
                    </div>
                    {!t.is_sample && <button onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted2, padding: 4 }}><Ico ti="ti-trash" size={15} /></button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Summary strip */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, padding: '0 2px' }}>
          <p style={{ fontSize: 11, fontWeight: 900, color: BRAND, letterSpacing: 1.5, textTransform: 'uppercase', margin: 0 }}>
            {tab === 'tools' ? 'Other unlocked tools' : 'Exam Resources'}
          </p>
          {!loading && <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{ownedCount} unlocked</span>}
        </div>

        {/* List */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ height: 92, borderRadius: 16, background: C.tagBg, animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 24px', color: C.muted2, fontSize: 13.5, lineHeight: 1.6 }}>
            You haven’t unlocked any {tab} yet.<br />
            <a href="/apps" style={{ color: BRAND, fontWeight: 800, textDecoration: 'none' }}>Browse the App Center →</a>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((item) => (
              <ItemCard key={item.id} item={item} busy={busyId === item.id} onBuy={buy} />
            ))}
          </div>
        )}
      </div>

      {showTplModal && (
        <CreateTemplateModal
          onClose={() => setShowTpl(false)}
          onSaved={(tpl) => { setShowTpl(false); if (tpl) setTemplates((prev) => [tpl, ...prev]); showToast('Template saved ✓'); }}
        />
      )}

      {viewTpl && <ViewTemplateModal tpl={viewTpl} onClose={() => setViewTpl(null)} />}

      {toast && (
        <div style={{ position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}

