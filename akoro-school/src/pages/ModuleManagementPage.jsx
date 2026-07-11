import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Grid3x3, Info, Save, Loader2, CheckCircle2, ChevronRight,
  Users, BookOpen, Banknote, UserCog, ClipboardList, Award,
  Edit3, Library, Bus, Building2, Package, Boxes, Bot, MessageSquare,
  Monitor, Wallet, DoorOpen, Megaphone, Laptop, Fingerprint, Layers,
  HeartPulse, LayoutGrid, Video, ClipboardCheck, PenTool, QrCode, ShieldCheck,
  GraduationCap, BarChart3, LifeBuoy,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPut } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';

/* Core areas are essential system components — always active, never disableable.
   These have NO moduleKey in the sidebar, so they can never be hidden. */
const CORE_MODULES = [
  { key: 'staff_team',          label: 'Staff & Teams',            icon: UserCog },
  { key: 'student_information', label: 'Student Information',       icon: Users },
  { key: 'academics',           label: 'Academic Management',       icon: GraduationCap },
  { key: 'modules_area',        label: 'Modules (Courses, Classes, Students, Assessments…)', icon: LayoutGrid },
  { key: 'document_templates',  label: 'Document Templates',        icon: Award },
];

/* Optional modules — can be toggled off to hide them from the sidebar.
   Each key matches a `moduleKey` on the corresponding sidebar item. */
const TOGGLE_MODULES = [
  { key: 'fees_collection',     label: 'Finance & Fees',            icon: Banknote },
  { key: 'accounts_finance',    label: 'Accounts',                  icon: Wallet },
  { key: 'front_office',        label: 'Front Office',              icon: DoorOpen },
  { key: 'offline_examinations', label: 'Offline Examinations',     icon: ClipboardList },
  { key: 'cbc_academics',       label: 'CBC / Competency Academics', icon: Layers },
  { key: 'online_examinations', label: 'Online Examinations',       icon: Laptop },
  { key: 'human_resource',      label: 'Human Resource',            icon: UserCog },
  { key: 'ptm',                 label: 'Parent–Teacher Meetings',   icon: Video },
  { key: 'lesson_planner',      label: 'Lesson Planner',            icon: ClipboardList },
  { key: 'digital_evaluation',  label: 'OSM / Digital Evaluation',  icon: PenTool },
  { key: 'qr_attendance',       label: 'QR Code Attendance',        icon: QrCode },
  { key: 'study_center',        label: 'Study Center',              icon: Monitor },
  { key: 'communications',      label: 'Communicate',               icon: Megaphone },
  { key: 'library',             label: 'Library',                   icon: Library },
  { key: 'inventory',           label: 'Inventory',                 icon: Package },
  { key: 'transport',           label: 'Transport',                 icon: Bus },
  { key: 'hostel',              label: 'Hostel',                    icon: Building2 },
  { key: 'help_center',         label: 'Help Center',               icon: LifeBuoy },
  { key: 'asset_management',    label: 'Asset Management',          icon: Boxes },
  { key: 'reports_analytics',   label: 'Reports & Analytics',       icon: BarChart3 },
  { key: 'apps_center',         label: 'Apps Center',               icon: LayoutGrid },
];

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}>
      <span style={{ display: 'inline-block', width: 38, height: 22, borderRadius: 999, background: on ? BLUE : '#D8D5CE', position: 'relative', transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 2.5, left: on ? 18 : 2.5, width: 17, height: 17, borderRadius: '50%', background: WHITE, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
      </span>
    </button>
  );
}

function CoreCard({ mod }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: `${BLUE}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <mod.icon size={16} color={BLUE} />
        </div>
        <span style={{ fontSize: 14, fontWeight: 800, color: INK, fontFamily: FONT }}>{mod.label}</span>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: `${GREEN}15`, color: GREEN, fontSize: 11, fontWeight: 800, fontFamily: FONT, marginBottom: 8 }}>
        <CheckCircle2 size={11} /> Core Module
      </span>
      <p style={{ fontSize: 11.5, color: MUTED2, margin: 0, fontFamily: FONT, lineHeight: 1.5 }}>
        This is an essential system component and cannot be disabled.
      </p>
    </div>
  );
}

function ToggleCard({ mod, on, onChange }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: `${BLUE}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <mod.icon size={16} color={BLUE} />
        </div>
        <span style={{ fontSize: 14, fontWeight: 800, color: INK, fontFamily: FONT }}>{mod.label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Toggle on={on} onChange={onChange} />
        <span style={{ fontSize: 12, fontWeight: 700, color: on ? BLUE : MUTED2, fontFamily: FONT }}>{on ? 'Active' : 'Disabled'}</span>
      </div>
    </div>
  );
}

export default function ModuleManagementPage() {
  const navigate = useNavigate();
  const [modules, setModules] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet('/api/school/settings')
      .then((res) => setModules(res.data?.modules || {}))
      .catch((e) => showToast(e.message || 'Could not load modules'))
      .finally(() => setLoading(false));
  }, []);

  const isOn = (key) => modules[key] !== false; // default active unless explicitly disabled
  const toggle = (key) => setModules((prev) => ({ ...prev, [key]: !isOn(key) }));

  const save = async () => {
    setSaving(true);
    try {
      await apiPut('/api/school/settings/modules', modules);
      window.dispatchEvent(new Event('akoro:modules-updated')); // refresh the sidebar immediately
      showToast('Configuration saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  return (
    <PageLayout title="Module Management" subtitle="Enable or disable school-management features">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, fontSize: 12.5, color: MUTED, fontFamily: FONT }}>
        <span onClick={() => navigate('/')} style={{ color: AMBER, fontWeight: 700, cursor: 'pointer' }}>Dashboard</span>
        <ChevronRight size={13} color={MUTED2} />
        <span style={{ fontWeight: 700, color: INK }}>Module Management</span>
      </div>

      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Main column */}
        <div style={{ flex: '2 1 500px', minWidth: 320 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
              <Grid3x3 size={17} color={AMBER} />
              <span style={{ fontSize: 15, fontWeight: 800, color: INK, fontFamily: FONT }}>Enable/Disable Features</span>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: `${BLUE}0A`, border: `1px solid ${BLUE}22`, borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
              <Info size={15} color={BLUE} style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12.5, color: INK, margin: 0, lineHeight: 1.55, fontFamily: FONT }}>
                Disable modules that your school doesn't use to keep the side menu clean.
              </p>
            </div>

            {loading ? (
              <div style={{ padding: '50px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
                {CORE_MODULES.map((m) => <CoreCard key={m.key} mod={m} />)}
                {TOGGLE_MODULES.map((m) => (
                  <ToggleCard key={m.key} mod={m} on={isOn(m.key)} onChange={() => toggle(m.key)} />
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 22, paddingTop: 18, borderTop: `1px solid ${BORDER}` }}>
              <button onClick={save} disabled={saving || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 13.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT, boxShadow: saving ? 'none' : `0 4px 14px ${AMBER}44` }}>
                {saving ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={15} />} {saving ? 'Saving…' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>

        {/* Help & Guidance sidebar */}
        <div style={{ flex: '1 1 260px', minWidth: 260 }}>
          <div style={{ background: BLUE, borderRadius: '14px 14px 0 0', padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={15} color={WHITE} />
            <span style={{ fontSize: 13, fontWeight: 800, color: WHITE, fontFamily: FONT }}>Help &amp; Guidance</span>
          </div>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '16px 16px 18px' }}>
            <p style={{ fontSize: 12.5, fontWeight: 800, color: INK, margin: '0 0 6px', fontFamily: FONT }}>Why disable modules?</p>
            <p style={{ fontSize: 12, color: MUTED, margin: '0 0 16px', lineHeight: 1.6, fontFamily: FONT }}>
              Disabling unused modules keeps your sidebar clean and improves the focus of your staff. You can re-enable them at any time.
            </p>

            <p style={{ fontSize: 12.5, fontWeight: 800, color: RED, margin: '0 0 6px', fontFamily: FONT }}>Impact on Data</p>
            <p style={{ fontSize: 12, color: MUTED, margin: '0 0 16px', lineHeight: 1.6, fontFamily: FONT }}>
              Disabling a module only hides the interface. Existing data remains safe in the database until the module is re-enabled.
            </p>

            <p style={{ fontSize: 12.5, fontWeight: 800, color: INK, margin: '0 0 6px', fontFamily: FONT }}>Subscription Impact</p>
            <p style={{ fontSize: 12, color: MUTED, margin: 0, lineHeight: 1.6, fontFamily: FONT }}>
              Modules marked as "Not in Plan" are restricted based on your current subscription. Contact support to upgrade your plan.
            </p>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
