/**
 * Student Information — Student Profile page (header, quick facts, tab bar).
 * Renders the tab panels from ./profileTabs.jsx.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Users, UserCheck, UserX, Home, Tags, ShieldAlert, Loader2, Save, ClipboardCheck,
  Eye, Pencil, Trash2, UserPlus, Search, ArrowLeft, Phone, Mail, MapPin, Droplet,
  Cake, CreditCard, ShieldCheck, CircleDot, X, Copy, Printer, Columns, Image,
  FileUp, Upload, Sheet, Download, CheckSquare, FileText,
  FolderOpen, Key, HeartPulse, Bus, Bed, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, RefreshCw,
  ClipboardList, ThumbsUp, ThumbsDown, Plus,
} from 'lucide-react';
import { PageLayout } from '../../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../../constants.js';
import { BASE, fullName, studentOpts, STATUS_PILL, STUDENT_FIELDS, STUDENT_COLUMNS, STUDENT_SEARCH, CLASS_FILTER, naira, STATUS_OPTS, InfoRow, GridInfo, InfoGrid, SectionCard, Ring, statPill, FEE_STATUS_COLOR, ModalShell } from './shared.jsx';
import {
  FeesTab, DocumentsTab, CredentialsTab, HealthTab,
  ExamsTab, AttendanceTab, BehaviorTab, TransportTab,
} from './profileTabs.jsx';

/* ── Profile tabs config ─────────────────────────────────────────────────── */
const PROFILE_TABS = [
  { key: 'profile', label: 'Profile', icon: Users },
  { key: 'fees', label: 'Fees', icon: CreditCard },
  { key: 'documents', label: 'Documents', icon: FolderOpen },
  { key: 'credentials', label: 'Credentials', icon: Key },
  { key: 'health', label: 'Health', icon: HeartPulse },
  { key: 'exams', label: 'Exams', icon: ClipboardList },
  { key: 'attendance', label: 'Attendance', icon: ClipboardCheck },
  { key: 'behavior', label: 'Behavior', icon: ShieldAlert },
  { key: 'transport', label: 'Transport', icon: Bus },
];

/* ── Student Profile — dedicated page (view + inline edit) ──────────────── */
export function StudentProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = [new URLSearchParams(window.location.search)];
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(PROFILE_TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'profile');
  const [editing, setEditing] = useState(params.get('edit') === '1');
  const [form, setForm] = useState({});
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [categories, setCategories] = useState([]);
  const [houses, setHouses] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(() => {
    apiGet(`${BASE}/students/${id}/profile`)
      .then((r) => { setData(r.data); setForm(r.data); })
      .catch((e) => showToast(e.message || 'Could not load student'))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
    apiGet(`${BASE}/student-categories`).then((r) => setCategories(r.data || [])).catch(() => {});
    apiGet(`${BASE}/student-houses`).then((r) => setHouses(r.data || [])).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try {
      const patch = {};
      for (const f of STUDENT_FIELDS) if (form[f.key] !== undefined) patch[f.key] = form[f.key] === '' ? null : form[f.key];
      const EXTRA_KEYS = ['biometric_id','place_of_birth','nationality','religion','caste','sub_caste','mother_tongue','quota',
        'student_email','student_phone','aadhaar_no','pen_no','father_name','father_phone','father_occupation','father_qualification','father_income','father_aadhaar',
        'mother_name','mother_phone','mother_occupation','mother_qualification','mother_aadhaar','emergency_name','emergency_phone',
        'height_cm','weight_kg','medical_history','bank_name','bank_account_no','bank_ifsc','permanent_address','previous_school','extra_fields'];
      for (const k of EXTRA_KEYS) if (form[k] !== undefined) patch[k] = form[k] === '' ? null : form[k];
      await apiPut(`${BASE}/students/${id}`, patch);
      showToast('Saved ✓'); setEditing(false); load();
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  if (loading) return <PageLayout title="Student Profile" subtitle=""><div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={22} style={{ animation: 'spin .8s linear infinite' }} /></div></PageLayout>;
  if (!data) return <PageLayout title="Student Profile" subtitle=""><div style={{ padding: '40px', textAlign: 'center', color: MUTED2, fontFamily: FONT }}>Student not found.</div></PageLayout>;

  const statCard = (label, value, color) => (
    <div style={{ flex: '1 1 140px', background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: FONT }}>{value}</div>
      <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT, marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <PageLayout title={fullName(data)} subtitle={`Admission No: ${data.admission_no}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/mgmt/students')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
          <ArrowLeft size={14} /> Back to Student List
        </button>
        {tab === 'profile' && (editing ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setEditing(false); setForm(data); }} style={{ padding: '9px 16px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 12.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
              {saving ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} Save Changes
            </button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
            <Pencil size={14} /> Edit Profile
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        {statCard('Total Fees', naira(data.fees?.assigned), INK)}
        {statCard('Amount Paid', naira(data.fees?.paid), GREEN)}
        {statCard('Balance Due', naira(data.fees?.due), data.fees?.due > 0 ? RED : GREEN)}
        {statCard('Attendance (Present)', data.attendance?.total ? `${Math.round((data.attendance.present / data.attendance.total) * 100)}%` : '—', BLUE)}
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: photo + quick facts (constant across tabs) */}
        <div style={{ flex: '1 1 240px', maxWidth: 280 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '22px 18px', textAlign: 'center' }}>
            <div style={{ width: 88, height: 88, borderRadius: '50%', margin: '0 auto 12px', overflow: 'hidden', background: LIGHT, border: `3px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {data.photo_url ? <img src={data.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Users size={34} color={MUTED2} />}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: INK, fontFamily: FONT }}>{fullName(data)}</div>
            <div style={{ display: 'inline-block', marginTop: 6, padding: '3px 12px', borderRadius: 999, background: `${AMBER}15`, color: AMBER, fontSize: 11.5, fontWeight: 800, fontFamily: FONT }}>{data.class_name || 'No class'}{data.section_name ? ` — ${data.section_name}` : ''}</div>
            <div style={{ marginTop: 14, textAlign: 'left' }}>
              <InfoRow icon={CreditCard} label="Admission No" value={data.admission_no} />
              <InfoRow icon={CircleDot} label="Roll No" value={data.roll_no} />
              <InfoRow icon={Droplet} label="Blood Group" value={data.blood_group} />
              <InfoRow icon={ShieldCheck} label="Status" value={STATUS_PILL(data.status, { active: { c: GREEN }, inactive: { c: RED }, alumni: { c: BLUE } })} />
            </div>
          </div>
        </div>

        {/* Right: tab bar + tab content */}
        <div style={{ flex: '2 1 420px', minWidth: 320 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: `1px solid ${BORDER}`, marginBottom: 16 }}>
            {PROFILE_TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 13px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT,
                fontSize: 12.5, fontWeight: 700, color: tab === t.key ? AMBER : MUTED2, borderBottom: `2px solid ${tab === t.key ? AMBER : 'transparent'}`, marginBottom: -1,
              }}>
                <t.icon size={13} /> {t.label}
              </button>
            ))}
          </div>

          {tab === 'profile' && <ProfileTab data={data} editing={editing} form={form} set={set} classes={classes} sections={sections} categories={categories} houses={houses} />}
          {tab === 'fees' && <FeesTab studentId={id} showToast={showToast} />}
          {tab === 'documents' && <DocumentsTab studentId={id} showToast={showToast} />}
          {tab === 'credentials' && <CredentialsTab studentId={id} data={data} onChanged={load} showToast={showToast} />}
          {tab === 'health' && <HealthTab studentId={id} showToast={showToast} />}
          {tab === 'exams' && <ExamsTab studentId={id} showToast={showToast} />}
          {tab === 'attendance' && <AttendanceTab studentId={id} showToast={showToast} />}
          {tab === 'behavior' && <BehaviorTab studentId={id} showToast={showToast} />}
          {tab === 'transport' && <TransportTab studentId={id} showToast={showToast} />}
        </div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, maxWidth: '80vw' }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Profile tab (view + inline edit) ────────────────────────────────────── */
/* ── Profile tab (view + inline edit) ────────────────────────────────────── */
function ProfileTab({ data, editing, form, set, classes, sections, categories, houses }) {
  const lbl = { fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT, display: 'block', marginBottom: 5 };
  const editSel = (key, options, labelKey = 'name') => (
    <select value={form[key] || ''} onChange={set(key)} style={{ ...inputStyle, marginBottom: 8 }}>
      <option value="">— none —</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o[labelKey]}</option>)}
    </select>
  );
  const extra = Array.isArray(data.extra_fields) ? data.extra_fields : [];
  const formExtra = Array.isArray(form.extra_fields) ? form.extra_fields : extra;
  const setExtra = (i, patch) => set('extra_fields')({ target: { value: formExtra.map((f, j) => j === i ? { ...f, ...patch } : f) } });
  const addExtra = () => set('extra_fields')({ target: { value: [...formExtra, { label: '', value: '' }] } });
  const delExtra = (i) => set('extra_fields')({ target: { value: formExtra.filter((_, j) => j !== i) } });

  const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
  const parentCard = (title, color, initialSrc, fields) => (
    <div style={{ flex: '1 1 240px', minWidth: 220, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: `${color}18`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, fontFamily: FONT }}>{initial(initialSrc)}</div>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: INK, fontFamily: FONT }}>{title}</span>
      </div>
      <InfoGrid>{fields.map(([label, value]) => <GridInfo key={label} label={label} value={value} />)}</InfoGrid>
    </div>
  );

  if (!editing) return (
    <>
      <SectionCard title="Academic Information" color={BLUE}>
        <InfoGrid>
          <GridInfo label="Admission No" value={data.admission_no} />
          <GridInfo label="Admission Date" value={data.admitted_on} />
          <GridInfo label="Biometric ID" value={data.biometric_id} />
          <GridInfo label="Roll Number" value={data.roll_no} />
          <GridInfo label="House" value={data.house_name} />
          <GridInfo label="Category" value={data.category_name} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Personal Details" color={PURPLE}>
        <InfoGrid>
          <GridInfo icon={Cake} label="Date of Birth" value={data.dob} />
          <GridInfo label="Place of Birth" value={data.place_of_birth} />
          <GridInfo label="Gender" value={data.gender} />
          <GridInfo label="Nationality" value={data.nationality} />
          <GridInfo label="Religion" value={data.religion} />
          <GridInfo label="Caste" value={data.caste} />
          <GridInfo label="Sub-Caste" value={data.sub_caste} />
          <GridInfo label="Mother Tongue" value={data.mother_tongue} />
          <GridInfo icon={Droplet} label="Blood Group" value={data.blood_group} />
          <GridInfo label="Quotas" value={data.quota} />
          <GridInfo icon={ShieldAlert} label="Disability" value={data.is_disabled ? (data.disability_note || 'Yes') : 'None'} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Contact & Identity" color={GREEN}>
        <InfoGrid>
          <GridInfo icon={Mail} label="Student Email" value={data.student_email} />
          <GridInfo icon={Phone} label="Student Phone" value={data.student_phone} />
          <GridInfo label="Aadhaar / NID" value={data.aadhaar_no} />
          <GridInfo label="PEN / SSSM ID" value={data.pen_no} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Parent & Guardian Details" color={AMBER}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          {parentCard('Father Details', BLUE, data.father_name, [
            ['Name', data.father_name], ['Phone', data.father_phone], ['Occupation', data.father_occupation],
            ['Qualification', data.father_qualification], ['Income', data.father_income], ['Aadhaar', data.father_aadhaar],
          ])}
          {parentCard('Mother Details', PURPLE, data.mother_name, [
            ['Name', data.mother_name], ['Phone', data.mother_phone], ['Occupation', data.mother_occupation],
            ['Qualification', data.mother_qualification], ['Aadhaar', data.mother_aadhaar],
          ])}
        </div>
        <InfoGrid>
          <GridInfo label="Guardian" value={data.guardian_name ? `${data.guardian_name} (${data.guardian_phone || ''})` : null} />
          <GridInfo label="Emergency" value={data.emergency_name ? `${data.emergency_name} (${data.emergency_phone || ''})` : null} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Health & Medical" color={RED}>
        <InfoGrid>
          <GridInfo label="Height" value={data.height_cm ? `${data.height_cm} cm` : null} />
          <GridInfo label="Weight" value={data.weight_kg ? `${data.weight_kg} kg` : null} />
          <GridInfo label="Medical History" value={data.medical_history} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Bank Details" color={BLUE}>
        <InfoGrid>
          <GridInfo label="Bank Name" value={data.bank_name} />
          <GridInfo label="Account No" value={data.bank_account_no} />
          <GridInfo label="IFSC Code" value={data.bank_ifsc} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Address" color={PURPLE}>
        <InfoGrid>
          <GridInfo label="Current" value={data.address} />
          <GridInfo label="Permanent" value={data.permanent_address} />
        </InfoGrid>
      </SectionCard>
      <SectionCard title="Previous School" color={AMBER}>
        <GridInfo label="Details" value={data.previous_school || 'NO DATA'} />
      </SectionCard>
      {extra.length > 0 && (
        <SectionCard title="Additional Information" color={GREEN}>
          <InfoGrid>{extra.map((f, i) => <GridInfo key={i} label={f.label} value={f.value} />)}</InfoGrid>
        </SectionCard>
      )}
    </>
  );

  return (
    <>
      <SectionCard title="Academic Information" color={BLUE}>
        <label style={lbl}>Class</label>{editSel('class_id', classes)}
        <label style={lbl}>Section</label>{editSel('section_id', sections.filter((s) => !form.class_id || s.class_id === form.class_id))}
        <label style={lbl}>Category</label>{editSel('category_id', categories)}
        <label style={lbl}>House</label>{editSel('house_id', houses)}
        <label style={lbl}>Admitted On</label><input type="date" value={form.admitted_on || ''} onChange={set('admitted_on')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Biometric ID</label><input value={form.biometric_id || ''} onChange={set('biometric_id')} style={inputStyle} />
      </SectionCard>
      <SectionCard title="Personal Details" color={PURPLE}>
        <label style={lbl}>First Name</label><input value={form.first_name || ''} onChange={set('first_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Last Name</label><input value={form.last_name || ''} onChange={set('last_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Date of Birth</label><input type="date" value={form.dob || ''} onChange={set('dob')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Place of Birth</label><input value={form.place_of_birth || ''} onChange={set('place_of_birth')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Gender</label>
        <select value={form.gender || ''} onChange={set('gender')} style={{ ...inputStyle, marginBottom: 8 }}>
          <option value="">— select —</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
        </select>
        <label style={lbl}>Nationality</label><input value={form.nationality || ''} onChange={set('nationality')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Religion</label><input value={form.religion || ''} onChange={set('religion')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Caste</label><input value={form.caste || ''} onChange={set('caste')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Sub-Caste</label><input value={form.sub_caste || ''} onChange={set('sub_caste')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Mother Tongue</label><input value={form.mother_tongue || ''} onChange={set('mother_tongue')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Blood Group</label><input value={form.blood_group || ''} onChange={set('blood_group')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Quota</label><input value={form.quota || ''} onChange={set('quota')} style={inputStyle} />
      </SectionCard>
      <SectionCard title="Contact & Identity" color={GREEN}>
        <label style={lbl}>Student Email</label><input value={form.student_email || ''} onChange={set('student_email')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Student Phone</label><input value={form.student_phone || ''} onChange={set('student_phone')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Aadhaar / NID</label><input value={form.aadhaar_no || ''} onChange={set('aadhaar_no')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>PEN / SSSM ID</label><input value={form.pen_no || ''} onChange={set('pen_no')} style={inputStyle} />
      </SectionCard>
      <SectionCard title="Parent & Guardian Details" color={AMBER}>
        <div style={{ fontSize: 12, fontWeight: 800, color: INK, marginBottom: 6 }}>Father Details</div>
        <label style={lbl}>Name</label><input value={form.father_name || ''} onChange={set('father_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Phone</label><input value={form.father_phone || ''} onChange={set('father_phone')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Occupation</label><input value={form.father_occupation || ''} onChange={set('father_occupation')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Qualification</label><input value={form.father_qualification || ''} onChange={set('father_qualification')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Income</label><input value={form.father_income || ''} onChange={set('father_income')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Aadhaar</label><input value={form.father_aadhaar || ''} onChange={set('father_aadhaar')} style={{ ...inputStyle, marginBottom: 8 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: INK, margin: '10px 0 6px' }}>Mother Details</div>
        <label style={lbl}>Name</label><input value={form.mother_name || ''} onChange={set('mother_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Phone</label><input value={form.mother_phone || ''} onChange={set('mother_phone')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Occupation</label><input value={form.mother_occupation || ''} onChange={set('mother_occupation')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Qualification</label><input value={form.mother_qualification || ''} onChange={set('mother_qualification')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Aadhaar</label><input value={form.mother_aadhaar || ''} onChange={set('mother_aadhaar')} style={{ ...inputStyle, marginBottom: 8 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: INK, margin: '10px 0 6px' }}>Guardian &amp; Emergency</div>
        <label style={lbl}>Guardian Name</label><input value={form.guardian_name || ''} onChange={set('guardian_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Guardian Phone</label><input value={form.guardian_phone || ''} onChange={set('guardian_phone')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Guardian Email</label><input value={form.guardian_email || ''} onChange={set('guardian_email')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Emergency Contact Name</label><input value={form.emergency_name || ''} onChange={set('emergency_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Emergency Contact Phone</label><input value={form.emergency_phone || ''} onChange={set('emergency_phone')} style={inputStyle} />
      </SectionCard>
      <SectionCard title="Health & Medical" color={RED}>
        <label style={lbl}>Height (cm)</label><input type="number" value={form.height_cm || ''} onChange={set('height_cm')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Weight (kg)</label><input type="number" value={form.weight_kg || ''} onChange={set('weight_kg')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Medical History</label><textarea value={form.medical_history || ''} onChange={set('medical_history')} style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} />
      </SectionCard>
      <SectionCard title="Bank Details" color={BLUE}>
        <label style={lbl}>Bank Name</label><input value={form.bank_name || ''} onChange={set('bank_name')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>Account No</label><input value={form.bank_account_no || ''} onChange={set('bank_account_no')} style={{ ...inputStyle, marginBottom: 8 }} />
        <label style={lbl}>IFSC Code</label><input value={form.bank_ifsc || ''} onChange={set('bank_ifsc')} style={inputStyle} />
      </SectionCard>
      <SectionCard title="Address" color={PURPLE}>
        <label style={lbl}>Current Address</label><textarea value={form.address || ''} onChange={set('address')} style={{ ...inputStyle, minHeight: 60, resize: 'vertical', marginBottom: 8 }} />
        <label style={lbl}>Permanent Address</label><textarea value={form.permanent_address || ''} onChange={set('permanent_address')} style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} />
      </SectionCard>
      <SectionCard title="Previous School" color={AMBER}>
        <textarea value={form.previous_school || ''} onChange={set('previous_school')} style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }} />
      </SectionCard>
      <SectionCard title="Additional Information" color={GREEN}>
        {formExtra.map((f, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input value={f.label} onChange={(e) => setExtra(i, { label: e.target.value })} placeholder="Field name" style={{ ...inputStyle, flex: 1 }} />
            <input value={f.value} onChange={(e) => setExtra(i, { value: e.target.value })} placeholder="Value" style={{ ...inputStyle, flex: 1 }} />
            <button onClick={() => delExtra(i)} style={{ border: 'none', background: `${RED}12`, color: RED, borderRadius: 7, width: 32, cursor: 'pointer' }}><Trash2 size={12} /></button>
          </div>
        ))}
        <button onClick={addExtra} style={{ border: `1px dashed ${BORDER}`, background: WHITE, color: MUTED, borderRadius: 8, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>+ Add Field</button>
      </SectionCard>
    </>
  );
}

