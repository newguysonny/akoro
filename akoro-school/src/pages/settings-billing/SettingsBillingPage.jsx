/**
 * SettingsBillingPage — composes the components from ./parts.jsx.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Ico } from '../../theme/Ico.jsx';
import { PageLayout } from '../../components/Layout.jsx';
import { apiGet, apiPut, apiPost } from '../../services/api.js';
import { C, tint } from '../../theme/colors.js';
import { SettingsCard, SettingsGroup } from '../../shared/SettingsCard.jsx';
import { WalletPanel } from '../../shared/WalletShell.jsx';

import { TABS, EXTERNAL, SchoolProfilePanel, SystemFormatsPanel, AttendancePanel, SecurityPanel, IntegrationsPanel, HelpSupportPanel, AboutPanel, QuickGuide, VALID_TABS, NO_SAVE_TABS } from './parts.jsx';

const ACCENT = C.brand;
const ACTIVE_CARD = { background: tint(8), border: `1px solid ${ACCENT}`, boxShadow: 'none' };

export default function SettingsBillingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialTab = VALID_TABS.includes(params.get('tab')) ? params.get('tab') : 'profile';
  const [tab, setTab] = useState(initialTab);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [toast, setToast] = useState('');
  const [profile, setProfile] = useState({});
  const [formats, setFormats] = useState({});
  const [attendance, setAttendance] = useState({});
  const [security, setSecurity] = useState({});
  const [integrations, setIntegrations] = useState({});
  const [personalisation, setPersonalisation] = useState({});

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet('/api/school/settings')
      .then((res) => {
        const d = res.data || {};
        setProfile(d.profile || {});
        setFormats(d.systemFormats || {});
        setAttendance(d.attendance || {});
        setSecurity(d.security || {});
        setIntegrations(d.integrations || {});
        setPersonalisation(d.personalisation || {});
      })
      .catch((e) => showToast(e.message || 'Could not load settings'))
      .finally(() => setLoading(false));
  }, []);

  const regenerateKey = async () => {
    setRegenerating(true);
    try {
      const res = await apiPost('/api/school/settings/integrations/regenerate-key', {});
      setIntegrations((prev) => ({ ...prev, biometricApiKey: res.data.biometricApiKey }));
      showToast('New API key generated ✓');
    } catch (e) { showToast(e.message || 'Could not generate key'); }
    finally { setRegenerating(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      if (tab === 'profile') {
        await apiPut('/api/school/settings/profile', profile);
      } else if (tab === 'formats') {
        await apiPut('/api/school/settings/system-formats', formats);
        await apiPut('/api/school/settings/personalisation', personalisation);
      } else if (tab === 'attendance') {
        await apiPut('/api/school/settings/attendance', attendance);
      } else if (tab === 'security') {
        await apiPut('/api/school/settings/security', security);
      }
      showToast('Saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  const TabCard = ({ t }) => {
    const on = tab === t.key;
    const go = () => {
      if (t.external) { if (t.to && t.to !== '#') navigate(t.to); return; }
      setTab(t.key);
    };
    return (
      <SettingsCard
        icon={<Ico lucide={t.icon} ti={t.ti} size={17} color={on ? ACCENT : 'var(--ak-text-muted, #8a8aa3)'} />}
        title={t.label}
        onClick={go}
        style={on ? ACTIVE_CARD : undefined}
        chevron={t.external ? <Ico ti="ti-external-link" size={14} color="var(--ak-text-muted, #8a8aa3)" /> : undefined}
      />
    );
  };

  return (
    <PageLayout title="School Settings" subtitle="Manage your school profile, formats and integrations">
      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left tab rail */}
        <aside style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <SettingsGroup title="Settings" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {TABS.map((t) => <TabCard key={t.key} t={t} />)}
          </SettingsGroup>
          <SettingsGroup title="External channels" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {EXTERNAL.map((t) => <TabCard key={t.key} t={t} />)}
          </SettingsGroup>

          {/* Quick Guide */}
          <QuickGuide tab={tab} />
        </aside>

        {/* Right content card */}
        <WalletPanel style={{ flex: 1, minWidth: 300, padding: '22px 24px', marginBottom: 0 }}>
          {loading ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: C.muted2, fontFamily: C.font, fontSize: 13.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <Ico ti="ti-loader-2" size={22} style={{ animation: 'spin .8s linear infinite' }} /> Loading settings…
            </div>
          ) : (
            <>
              {tab === 'profile'      && <SchoolProfilePanel value={profile} onChange={setProfile} onToast={showToast} />}
              {tab === 'formats'      && <SystemFormatsPanel formats={formats} onFormatsChange={setFormats} personalisation={personalisation} onPersonalisationChange={setPersonalisation} />}
              {tab === 'attendance'   && <AttendancePanel value={attendance} onChange={setAttendance} />}
              {tab === 'security'     && <SecurityPanel value={security} onChange={setSecurity} onToast={showToast} />}
              {tab === 'integrations' && <IntegrationsPanel apiKey={integrations.biometricApiKey} onRegenerate={regenerateKey} regenerating={regenerating} />}
              {tab === 'help'         && <HelpSupportPanel />}
              {tab === 'about'        && <AboutPanel />}

              {!NO_SAVE_TABS.includes(tab) && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 26, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
                  <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: saving ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: saving ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: C.font, boxShadow: saving ? 'none' : `0 4px 14px ${tint(27)}` }}>
                    {saving ? <Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={15} />} {saving ? 'Saving…' : 'Save Settings'}
                  </button>
                </div>
              )}
            </>
          )}
        </WalletPanel>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
