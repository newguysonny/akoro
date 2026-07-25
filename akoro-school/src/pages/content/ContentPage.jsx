/**
 * ContentPage — the school's content hub. Mirrors the settings tab-rail
 * pattern: a left rail of tabs + quick guide, and a right content card that
 * swaps panels by state (no route change). Settings is a side-section tab;
 * External Channels shows cards that open dedicated channel pages.
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, Save, Loader2 } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import { apiGet, apiPut } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, BLUE, FONT } from '../../constants.js';
import {
  TABS, EXTERNAL, SETTINGS_TAB, VALID_TABS, NO_SAVE_TABS,
  QuickGuide, GeneratorPanel, ContentSettingsPanel, ExternalChannelsPanel,
} from './parts.jsx';

export default function ContentPage() {
  const [params] = useSearchParams();
  const initialTab = VALID_TABS.includes(params.get('tab')) ? params.get('tab') : 'blog';
  const [tab, setTab] = useState(initialTab);
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

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
        background: on ? BLUE : 'transparent', color: on ? WHITE : MUTED,
        fontSize: 13.5, fontWeight: on ? 700 : 600, fontFamily: FONT, transition: 'all .12s',
      }}
        onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = LIGHT; }}
        onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
        <t.icon size={16} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{t.label}</span>
        {t.key === 'channels' && <ExternalLink size={13} color={MUTED2} />}
      </button>
    );
  };

  return (
    <PageLayout title="Content" subtitle="Generate on-brand content and manage your channels">
      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left rail */}
        <aside style={{ width: 232, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: MUTED2, padding: '8px 13px 6px', fontFamily: FONT }}>GENERATORS</div>
            {TABS.map((t) => <TabButton key={t.key} t={t} />)}
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: MUTED2, padding: '12px 13px 6px', fontFamily: FONT }}>CHANNELS & SETTINGS</div>
            {EXTERNAL.map((t) => <TabButton key={t.key} t={t} />)}
            <TabButton t={SETTINGS_TAB} />
          </div>
          <QuickGuide tab={tab} />
        </aside>

        {/* Right content card */}
        <section style={{ flex: 1, minWidth: 300, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '22px 24px' }}>
          {tab === 'blog'     && <GeneratorPanel kind="blog" onToast={showToast} />}
          {tab === 'social'   && <GeneratorPanel kind="social" onToast={showToast} />}
          {tab === 'activity' && <GeneratorPanel kind="activity" onToast={showToast} />}
          {tab === 'channels' && <ExternalChannelsPanel onToast={showToast} />}
          {tab === 'settings' && <ContentSettingsPanel value={settings} onChange={setSettings} />}

          {!NO_SAVE_TABS.includes(tab) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 26, paddingTop: 18, borderTop: `1px solid ${BORDER}` }}>
              <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 13.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
                {saving ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={15} />}{saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          )}
        </section>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
