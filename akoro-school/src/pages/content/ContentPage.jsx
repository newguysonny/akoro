/**
 * ContentPage — the school's content hub. Mirrors the settings tab-rail
 * pattern: a left rail of tabs + quick guide, and a right content card that
 * swaps panels by state (no route change). Settings is a side-section tab;
 * External Channels shows cards that open dedicated channel pages.
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ico } from '../../theme/Ico.jsx';
import { PageLayout } from '../../components/Layout.jsx';
import { apiGet, apiPut } from '../../services/api.js';
import { BLUE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import {
  TABS, EXTERNAL, SETTINGS_TAB, VALID_TABS, NO_SAVE_TABS,
  QuickGuide, GeneratorPanel, ContentSettingsPanel, ExternalChannelsPanel, PastCreations,
} from './parts.jsx';

export default function ContentPage() {
  const [params] = useSearchParams();
  const initialTab = VALID_TABS.includes(params.get('tab')) ? params.get('tab') : 'blog';
  const [tab, setTab] = useState(initialTab);
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);   // bump to reload Past creations
  const [toast, setToast] = useState('');
  const isGenerator = ['blog', 'social', 'activity'].includes(tab);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet('/api/school/settings')
      .then((res) => setSettings(res.data?.content || {}))
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await apiPut('/api/school/settings/content', settings);
      showToast('Saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  const TabButton = ({ t }) => {
    const on = tab === t.key;
    return (
      <button onClick={() => setTab(t.key)} style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
        padding: '11px 13px', borderRadius: 10, border: 'none', cursor: 'pointer',
        background: on ? BLUE : 'transparent', color: on ? '#fff' : C.muted,
        fontSize: 13.5, fontWeight: on ? 700 : 600, fontFamily: C.font, transition: 'all .12s',
      }}
        onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = C.bg; }}
        onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
        <Ico lucide={t.icon} ti={t.ti} size={16} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{t.label}</span>
        {t.key === 'channels' && <Ico ti="ti-external-link" size={13} color={C.muted2} />}
      </button>
    );
  };

  return (
    <PageLayout title="Content" subtitle="Generate on-brand content and manage your channels">
      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left rail */}
        <aside style={{ width: 232, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: C.muted2, padding: '8px 13px 6px', fontFamily: C.font }}>GENERATORS</div>
            {TABS.map((t) => <TabButton key={t.key} t={t} />)}
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: C.muted2, padding: '12px 13px 6px', fontFamily: C.font }}>CHANNELS & SETTINGS</div>
            {EXTERNAL.map((t) => <TabButton key={t.key} t={t} />)}
            <TabButton t={SETTINGS_TAB} />
          </div>
          <QuickGuide tab={tab} />
        </aside>

        {/* Right content card */}
        <section style={{ flex: 1, minWidth: 300, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '22px 24px' }}>
          {tab === 'blog'     && <GeneratorPanel kind="blog" onToast={showToast} onGenerated={() => setRefreshKey((k) => k + 1)} />}
          {tab === 'social'   && <GeneratorPanel kind="social" onToast={showToast} onGenerated={() => setRefreshKey((k) => k + 1)} />}
          {tab === 'activity' && <GeneratorPanel kind="activity" onToast={showToast} onGenerated={() => setRefreshKey((k) => k + 1)} />}
          {tab === 'channels' && <ExternalChannelsPanel onToast={showToast} />}
          {tab === 'settings' && <ContentSettingsPanel value={settings} onChange={setSettings} />}

          {!NO_SAVE_TABS.includes(tab) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 26, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
              <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: saving ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: saving ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: C.font }}>
                {saving ? <Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={15} />}{saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Past creations — its own full-width section below both columns */}
      {isGenerator && <PastCreations kind={tab} refreshKey={refreshKey} onToast={showToast} />}

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
