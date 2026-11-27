import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Banknote,
  UserCog,
  ClipboardList,
  Award,
  Library,
  Bus,
  Building2,
  Package,
  Boxes,
  Monitor,
  Wallet,
  DoorOpen,
  Megaphone,
  Laptop,
  Layers,
  LayoutGrid,
  Video,
  PenTool,
  QrCode,
  GraduationCap,
  BarChart3,
  LifeBuoy,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPut } from '../services/api.js';
import { GREEN, RED, BLUE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

/* Core areas are essential system components — always active, never disableable.
   These have NO moduleKey in the sidebar, so they can never be hidden. */
const CORE_MODULES = [
  { key: 'staff_team',          label: 'Staff & Teams',            icon: UserCog, ti: 'ti-user-cog' },
  { key: 'student_information', label: 'Student Information',       icon: Users, ti: 'ti-users' },
  { key: 'academics',           label: 'Academic Management',       icon: GraduationCap, ti: 'ti-school' },
  { key: 'modules_area',        label: 'Modules (Courses, Classes, Students, Assessments…)', icon: LayoutGrid, ti: 'ti-layout-grid' },
  { key: 'document_templates',  label: 'Document Templates',        icon: Award, ti: 'ti-award' },
  { key: 'help_center',         label: 'Help Center',               icon: LifeBuoy, ti: 'ti-lifebuoy' },
  { key: 'reports_analytics',   label: 'Reports & Analytics',       icon: BarChart3, ti: 'ti-chart-bar' },
  { key: 'apps_center',         label: 'Apps Center',               icon: LayoutGrid, ti: 'ti-layout-grid' },
];

/* Optional modules — can be toggled off to hide them from the sidebar.
   Each key matches a `moduleKey` on the corresponding sidebar item. */
const TOGGLE_MODULES = [
  { key: 'fees_collection',     label: 'Finance & Fees',            icon: Banknote, ti: 'ti-cash-banknote' },
  { key: 'accounts_finance',    label: 'Accounts',                  icon: Wallet, ti: 'ti-wallet' },
  { key: 'front_office',        label: 'Front Office',              icon: DoorOpen, ti: 'ti-door' },
  { key: 'offline_examinations', label: 'Offline Examinations',     icon: ClipboardList, ti: 'ti-clipboard-list' },
  { key: 'cbc_academics',       label: 'CBC / Competency Academics', icon: Layers, ti: 'ti-stack-2' },
  { key: 'online_examinations', label: 'Online Examinations',       icon: Laptop, ti: 'ti-device-laptop' },
  { key: 'human_resource',      label: 'Human Resource',            icon: UserCog, ti: 'ti-user-cog' },
  { key: 'ptm',                 label: 'Parent–Teacher Meetings',   icon: Video, ti: 'ti-video' },
  { key: 'lesson_planner',      label: 'Lesson Planner',            icon: ClipboardList, ti: 'ti-clipboard-list' },
  { key: 'digital_evaluation',  label: 'OSM / Digital Evaluation',  icon: PenTool, ti: 'ti-vector-bezier-2' },
  { key: 'qr_attendance',       label: 'QR Code Attendance',        icon: QrCode, ti: 'ti-qrcode' },
  { key: 'study_center',        label: 'Study Center',              icon: Monitor, ti: 'ti-device-desktop' },
  { key: 'communications',      label: 'Communicate',               icon: Megaphone, ti: 'ti-speakerphone' },
  { key: 'library',             label: 'Library',                   icon: Library, ti: 'ti-library' },
  { key: 'inventory',           label: 'Inventory',                 icon: Package, ti: 'ti-package' },
  { key: 'transport',           label: 'Transport',                 icon: Bus, ti: 'ti-bus' },
  { key: 'hostel',              label: 'Hostel',                    icon: Building2, ti: 'ti-building' },
  { key: 'asset_management',    label: 'Asset Management',          icon: Boxes, ti: 'ti-packages' },
];

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}>
      <span style={{ display: 'inline-block', width: 38, height: 22, borderRadius: 999, background: on ? BLUE : C.border, position: 'relative', transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 2.5, left: on ? 18 : 2.5, width: 17, height: 17, borderRadius: '50%', background: C.surface, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
      </span>
    </button>
  );
}

function CoreCard({ mod }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: `${BLUE}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Ico lucide={mod.icon} ti={mod.ti} size={16} color={BLUE} />
        </div>
        <span style={{ fontSize: 14, fontWeight: 800, color: C.ink, fontFamily: C.font }}>{mod.label}</span>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: `${GREEN}15`, color: GREEN, fontSize: 11, fontWeight: 800, fontFamily: C.font, marginBottom: 8 }}>
        <Ico ti="ti-circle-check" size={11} /> Core Module
      </span>
      <p style={{ fontSize: 11.5, color: C.muted2, margin: 0, fontFamily: C.font, lineHeight: 1.5 }}>
        This is an essential system component and cannot be disabled.
      </p>
    </div>
  );
}

function ToggleCard({ mod, on, onChange }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: `${BLUE}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Ico lucide={mod.icon} ti={mod.ti} size={16} color={BLUE} />
        </div>
        <span style={{ fontSize: 14, fontWeight: 800, color: C.ink, fontFamily: C.font }}>{mod.label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Toggle on={on} onChange={onChange} />
        <span style={{ fontSize: 12, fontWeight: 700, color: on ? BLUE : C.muted2, fontFamily: C.font }}>{on ? 'Active' : 'Disabled'}</span>
      </div>
    </div>
  );
}

function LockedCard({ mod, onGet }) {
  return (
    <div style={{ background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Ico lucide={mod.icon} ti={mod.ti} size={16} color={C.muted2} />
        </div>
        <span style={{ fontSize: 14, fontWeight: 800, color: C.muted, fontFamily: C.font }}>{mod.label}</span>
      </div>
      <button onClick={onGet} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 9, border: `1px solid ${C.brand}`, background: tint(7), color: C.brand, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
        <Ico ti="ti-shield-check" size={12} /> Get it in the Apps Center
      </button>
    </div>
  );
}

export default function ModuleManagementPage() {
  const navigate = useNavigate();
  const [modules, setModules] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [access, setAccess] = useState({});

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet('/api/school/settings')
      .then((res) => { setModules(res.data?.modules || {}); setAccess(res.data?.moduleAccess || {}); })
      .catch((e) => showToast(e.message || 'Could not load modules'))
      .finally(() => setLoading(false));
  }, []);

  // A module is toggleable only once the school owns it. Anything not bought is
  // shown here anyway — hiding it would leave a teacher wondering where the
  // feature went — but as a locked card that points at the Apps Center.
  const owns = (key) => access[key] === true;
  const isOn = (key) => owns(key) && modules[key] !== false;
  const toggle = (key) => setModules((prev) => ({ ...prev, [key]: !isOn(key) }));

  const q = search.trim().toLowerCase();
  const matches = (m) => !q || m.label.toLowerCase().includes(q);
  const coreShown = CORE_MODULES.filter(matches);
  const ownedShown = TOGGLE_MODULES.filter((m) => matches(m) && owns(m.key));
  const lockedShown = TOGGLE_MODULES.filter((m) => matches(m) && !owns(m.key));

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, fontSize: 12.5, color: C.muted, fontFamily: C.font }}>
        <span onClick={() => navigate('/')} style={{ color: C.brand, fontWeight: 700, cursor: 'pointer' }}>Dashboard</span>
        <Ico ti="ti-chevron-right" size={13} color={C.muted2} />
        <span style={{ fontWeight: 700, color: C.ink }}>Module Management</span>
      </div>

      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Main column */}
        <div style={{ flex: '2 1 500px', minWidth: 320 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
              <Ico ti="ti-grid-3x3" size={17} color={C.brand} />
              <span style={{ fontSize: 15, fontWeight: 800, color: C.ink, fontFamily: C.font }}>Enable/Disable Features</span>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: `${BLUE}0A`, border: `1px solid ${BLUE}22`, borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
              <Ico ti="ti-info-circle" size={15} color={BLUE} style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12.5, color: C.ink, margin: 0, lineHeight: 1.55, fontFamily: C.font }}>
                Disable modules that your school doesn't use to keep the side menu clean.
              </p>
            </div>

            {/* Search */}
            <div style={{ position: 'relative', marginBottom: 20 }}>
              <Ico ti="ti-search" size={15} color={C.muted2} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search modules…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px 10px 36px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, fontSize: 13, color: C.ink, fontFamily: C.font, outline: 'none' }}
              />
            </div>

            {loading ? (
              <div style={{ padding: '50px 0', textAlign: 'center', color: C.muted2 }}><Ico ti="ti-loader-2" size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
            ) : (coreShown.length + ownedShown.length + lockedShown.length === 0) ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: C.muted2, fontSize: 13, fontFamily: C.font }}>No modules match “{search}”.</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
                  {coreShown.map((m) => <CoreCard key={m.key} mod={m} />)}
                  {ownedShown.map((m) => (
                    <ToggleCard key={m.key} mod={m} on={isOn(m.key)} onChange={() => toggle(m.key)} />
                  ))}
                </div>

                {lockedShown.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .6, color: C.muted2, margin: '22px 0 10px', fontFamily: C.font }}>
                      NOT INSTALLED — AVAILABLE IN THE APPS CENTER
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
                      {lockedShown.map((m) => <LockedCard key={m.key} mod={m} onGet={() => navigate('/apps')} />)}
                    </div>
                  </>
                )}
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
              <button onClick={save} disabled={saving || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: saving ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: saving ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: C.font, boxShadow: saving ? 'none' : `0 4px 14px ${tint(27)}` }}>
                {saving ? <Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={15} />} {saving ? 'Saving…' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>

        {/* Help & Guidance sidebar */}
        <div style={{ flex: '1 1 260px', minWidth: 260 }}>
          <div style={{ background: BLUE, borderRadius: '14px 14px 0 0', padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ico ti="ti-info-circle" size={15} color="#fff" />
            <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', fontFamily: C.font }}>Help &amp; Guidance</span>
          </div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '16px 16px 18px' }}>
            <p style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, margin: '0 0 6px', fontFamily: C.font }}>Why disable modules?</p>
            <p style={{ fontSize: 12, color: C.muted, margin: '0 0 16px', lineHeight: 1.6, fontFamily: C.font }}>
              Disabling unused modules keeps your sidebar clean and improves the focus of your staff. You can re-enable them at any time.
            </p>

            <p style={{ fontSize: 12.5, fontWeight: 800, color: RED, margin: '0 0 6px', fontFamily: C.font }}>Impact on Data</p>
            <p style={{ fontSize: 12, color: C.muted, margin: '0 0 16px', lineHeight: 1.6, fontFamily: C.font }}>
              Disabling a module only hides the interface. Existing data remains safe in the database until the module is re-enabled.
            </p>

            <p style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, margin: '0 0 6px', fontFamily: C.font }}>Subscription Impact</p>
            <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.6, fontFamily: C.font }}>
              Modules marked as "Not in Plan" are restricted based on your current subscription. Contact support to upgrade your plan.
            </p>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
