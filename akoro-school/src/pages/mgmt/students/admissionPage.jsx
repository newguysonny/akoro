/**
 * Student Admission — multi-step registration wizard.
 * Steps: Academic · Personal Info · Parents · Health & Bank · Documents.
 * On "Admit Student" it creates the student, uploads the photo + documents,
 * and assigns any selected fee groups (+ opening balance).
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, User, Users, HeartPulse, FolderOpen } from 'lucide-react';
import { Ico } from '../../../theme/Ico.jsx';
import { PageLayout } from '../../../components/Layout.jsx';
import { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost } from '../../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../../constants.js';
import { C, tint } from '../../../theme/colors.js';
import { BASE } from './shared.jsx';

const STEPS = [
  { key: 'academic', label: 'Academic', icon: GraduationCap, ti: 'ti-school' },
  { key: 'personal', label: 'Personal Info', icon: User, ti: 'ti-user' },
  { key: 'parents', label: 'Parents', icon: Users, ti: 'ti-users' },
  { key: 'health', label: 'Health & Bank', icon: HeartPulse, ti: 'ti-heartbeat' },
  { key: 'documents', label: 'Documents', icon: FolderOpen, ti: 'ti-folder-open' },
];

const lbl = { display: 'block', fontSize: 11.5, fontWeight: 700, color: C.ink, margin: '0 0 5px', fontFamily: C.font };
const req = <span style={{ color: RED }}> *</span>;
const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px 14px' };
const sectionHead = (icon, title, color) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: tint(5, color), borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
    {icon}<span style={{ fontSize: 13, fontWeight: 800, color, fontFamily: C.font, textTransform: 'uppercase', letterSpacing: .4 }}>{title}</span>
  </div>
);

function Field({ label, required, children, full }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <label style={lbl}>{label}{required && req}</label>
      {children}
    </div>
  );
}

export function StudentAdmissionPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    admission_no: '', roll_no: '', admitted_on: new Date().toISOString().slice(0, 10),
    class_id: '', section_id: '', biometric_id: '', previous_school: '', opening_balance: '',
    first_name: '', middle_name: '', last_name: '', gender: '', dob: '', category_id: '', house_id: '',
    blood_group: '', religion: '', aadhaar_no: '', pen_no: '', caste: '', sub_caste: '', mother_tongue: '',
    place_of_birth: '', nationality: '', bpl: false, rte: false, student_phone: '', student_email: '',
    father_name: '', father_phone: '', father_occupation: '', mother_name: '', mother_phone: '', mother_occupation: '',
    guardian_name: '', guardian_phone: '', guardian_email: '', emergency_name: '', emergency_phone: '',
    height_cm: '', weight_kg: '', medical_history: '', bank_name: '', bank_account_no: '', bank_ifsc: '',
  });
  const [photo, setPhoto] = useState(null);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [categories, setCategories] = useState([]);
  const [houses, setHouses] = useState([]);
  const [feeGroups, setFeeGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState({});
  const [extraFields, setExtraFields] = useState([]);           // [{ label, value }]
  const [documents, setDocuments] = useState([{ title: '', file: null }]);
  const [parentMode, setParentMode] = useState('new');          // 'new' | 'existing'
  const [siblingQuery, setSiblingQuery] = useState('');
  const [siblingResults, setSiblingResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3200); };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
    apiGet(`${BASE}/student-categories`).then((r) => setCategories(r.data || [])).catch(() => {});
    apiGet(`${BASE}/student-houses`).then((r) => setHouses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/fee-groups`).then((r) => setFeeGroups(r.data || [])).catch(() => {});
  }, []);

  const autoCodes = useCallback((which) => {
    apiGet(`${BASE}/students/next-codes${form.class_id ? `?class_id=${form.class_id}` : ''}`).then((r) => {
      setForm((f) => ({
        ...f,
        ...(which === 'admission_no' || which === 'both' ? { admission_no: r.data.admission_no } : {}),
        ...(which === 'roll_no' || which === 'both' ? { roll_no: r.data.roll_no } : {}),
      }));
    }).catch(() => showToast('Could not generate a number'));
  }, [form.class_id]);

  const searchSiblings = (q) => {
    setSiblingQuery(q);
    if (q.trim().length < 2) return setSiblingResults([]);
    apiGet(`${BASE}/students/list`).then((r) => {
      const ql = q.toLowerCase();
      setSiblingResults((r.data || []).filter((s) =>
        [s.guardian_name, s.guardian_phone, s.first_name, s.last_name].some((v) => String(v || '').toLowerCase().includes(ql))
      ).slice(0, 8));
    }).catch(() => {});
  };
  const linkSibling = (s) => {
    setForm((f) => ({ ...f, guardian_name: s.guardian_name || '', guardian_phone: s.guardian_phone || '', guardian_email: s.guardian_email || '' }));
    setSiblingResults([]); setSiblingQuery(`${s.guardian_name || ''} (${s.admission_no})`);
    showToast('Linked parent details from existing student');
  };

  const addDoc = () => setDocuments((d) => [...d, { title: '', file: null }]);
  const setDoc = (i, patch) => setDocuments((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const delDoc = (i) => setDocuments((d) => d.filter((_, j) => j !== i));

  const addExtra = () => setExtraFields((e) => [...e, { label: '', value: '' }]);
  const setExtra = (i, patch) => setExtraFields((e) => e.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const delExtra = (i) => setExtraFields((e) => e.filter((_, j) => j !== i));

  const selStyle = { ...inputStyle, cursor: 'pointer' };

  const admit = async () => {
    if (!form.admission_no.trim()) { setStep(0); return showToast('Admission No is required'); }
    if (!form.class_id) { setStep(0); return showToast('Class is required'); }
    if (!form.first_name.trim() || !form.last_name.trim()) { setStep(1); return showToast('First and last name are required'); }

    setBusy(true);
    try {
      // Custom / non-column values captured into extra_fields.
      const extras = [...extraFields.filter((x) => x.label.trim())];
      if (form.middle_name.trim()) extras.push({ label: 'Middle Name', value: form.middle_name.trim() });
      if (form.bpl) extras.push({ label: 'BPL', value: 'Yes' });
      if (form.rte) extras.push({ label: 'RTE', value: 'Yes' });

      const COLS = ['admission_no', 'roll_no', 'class_id', 'section_id', 'biometric_id', 'previous_school',
        'first_name', 'last_name', 'gender', 'dob', 'category_id', 'house_id', 'blood_group', 'religion',
        'aadhaar_no', 'pen_no', 'caste', 'sub_caste', 'mother_tongue', 'place_of_birth', 'nationality',
        'student_phone', 'student_email', 'father_name', 'father_phone', 'father_occupation', 'mother_name',
        'mother_phone', 'mother_occupation', 'guardian_name', 'guardian_phone', 'guardian_email',
        'emergency_name', 'emergency_phone', 'height_cm', 'weight_kg', 'medical_history',
        'bank_name', 'bank_account_no', 'bank_ifsc'];
      const payload = { status: 'active', admitted_on: form.admitted_on || null, extra_fields: extras };
      for (const c of COLS) if (form[c] !== '' && form[c] != null) payload[c] = form[c];

      const res = await apiPost(`${BASE}/students`, payload);
      const id = res.data?.id;
      if (!id) throw new Error('Student was not created');

      // Photo → reuse bulk-photos (matches by filename = admission_no).
      if (photo) {
        try {
          const ext = (photo.name.split('.').pop() || 'jpg');
          const named = new File([photo], `${form.admission_no}.${ext}`, { type: photo.type });
          const fd = new FormData(); fd.append('files', named);
          await fetch(`${API}${BASE}/students/bulk-photos`, { method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'school' }, body: fd });
        } catch { /* non-fatal */ }
      }

      // Fee groups + opening balance.
      const groupIds = Object.keys(selectedGroups).filter((k) => selectedGroups[k]);
      const openingBalance = Number(form.opening_balance) || 0;
      if (groupIds.length || openingBalance > 0) {
        try { await apiPost(`${BASE}/students/${id}/assign-fee-groups`, { group_ids: groupIds, opening_balance: openingBalance }); }
        catch { showToast('Student admitted, but fee assignment failed'); }
      }

      // Documents (one request per titled file).
      for (const d of documents) {
        if (!d.file || !d.title.trim()) continue;
        const fd = new FormData(); fd.append('files', d.file); fd.append('title', d.title.trim());
        try { await fetch(`${API}${BASE}/students/${id}/documents/upload`, { method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'school' }, body: fd }); }
        catch { /* non-fatal */ }
      }

      navigate(`/mgmt/students/${id}`);
    } catch (e) { showToast(e.message || 'Could not admit student'); setBusy(false); }
  };

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));
  const navBtn = (variant) => ({ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 9, border: variant === 'ghost' ? `1.5px solid ${C.border}` : 'none', background: variant === 'ghost' ? C.surface : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: variant === 'ghost' ? C.muted : '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font });
  const autoBtn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 10px', borderRadius: 8, border: `1.5px solid ${BLUE}55`, background: `${BLUE}0C`, color: BLUE, fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: C.font, whiteSpace: 'nowrap' };

  return (
    <PageLayout title="Student Admission" subtitle="Register a new student">
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Step rail */}
        <div style={{ flex: '0 1 220px', minWidth: 190, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {STEPS.map((s, i) => (
            <button key={s.key} onClick={() => setStep(i)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: C.font, textAlign: 'left',
              border: `1px solid ${i === step ? BLUE : C.border}`, background: i === step ? BLUE : C.surface, color: i === step ? '#fff' : C.ink,
            }}>
              <Ico lucide={s.icon} ti={s.ti} size={16} color={i === step ? '#fff' : C.muted2} />
              <span style={{ fontSize: 12.5, fontWeight: 800 }}>{i + 1}. {s.label}</span>
            </button>
          ))}
        </div>

        {/* Step body */}
        <div style={{ flex: '1 1 460px', minWidth: 300, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px' }}>
          {/* progress bar */}
          <div style={{ height: 5, borderRadius: 999, background: C.border, overflow: 'hidden', marginBottom: 18 }}>
            <div style={{ height: '100%', width: `${((step + 1) / STEPS.length) * 100}%`, background: `linear-gradient(90deg, ${BLUE}, ${C.brand})`, transition: 'width .2s' }} />
          </div>

          {step === 0 && (<>
            {sectionHead(<Ico ti="ti-school" size={15} color={BLUE} />, 'Academic Details', BLUE)}
            <div style={grid2}>
              <Field label="Admission No" required>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={form.admission_no} onChange={set('admission_no')} style={{ ...inputStyle, flex: 1 }} />
                  <button onClick={() => autoCodes('admission_no')} style={autoBtn}><Ico ti="ti-wand" size={12} /> Auto</button>
                </div>
              </Field>
              <Field label="Roll Number">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={form.roll_no} onChange={set('roll_no')} style={{ ...inputStyle, flex: 1 }} />
                  <button onClick={() => autoCodes('roll_no')} style={autoBtn}><Ico ti="ti-wand" size={12} /> Auto</button>
                </div>
              </Field>
              <Field label="Admission Date"><input type="date" value={form.admitted_on} onChange={set('admitted_on')} style={inputStyle} /></Field>
              <Field label="Class" required>
                <select value={form.class_id} onChange={(e) => { set('class_id')(e); setForm((f) => ({ ...f, section_id: '' })); }} style={selStyle}>
                  <option value="">Select Class</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Section">
                <select value={form.section_id} onChange={set('section_id')} style={selStyle}>
                  <option value="">— Select —</option>{sections.filter((s) => !form.class_id || s.class_id === form.class_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Biometric ID"><input value={form.biometric_id} onChange={set('biometric_id')} placeholder="Device User ID" style={inputStyle} /></Field>
            </div>
            {sectionHead(<Ico ti="ti-building" size={15} color={C.muted} />, 'Previous School Details', C.muted)}
            <Field label="Previous School Name & Details" full>
              <textarea value={form.previous_school} onChange={set('previous_school')} rows={3} placeholder="Enter previous school name, address, and any relevant details" style={{ ...inputStyle, resize: 'vertical' }} />
            </Field>
            <div style={{ marginTop: 12 }}>
              <Field label="Opening Due Balance (If Any)">
                <input type="number" value={form.opening_balance} onChange={set('opening_balance')} placeholder="0" style={inputStyle} />
                <p style={{ fontSize: 11, color: C.muted2, margin: '5px 0 0', fontFamily: C.font }}>Outstanding balance from a previous school. Shows as “Opening Due Balance” in the student's fee ledger.</p>
              </Field>
            </div>
          </>)}

          {step === 1 && (<>
            {sectionHead(<Ico ti="ti-user" size={15} color={BLUE} />, 'Student Details', BLUE)}
            <div style={grid2}>
              <Field label="First Name" required><input value={form.first_name} onChange={set('first_name')} placeholder="Enter first name" style={inputStyle} /></Field>
              <Field label="Middle Name"><input value={form.middle_name} onChange={set('middle_name')} placeholder="Middle name" style={inputStyle} /></Field>
              <Field label="Last Name" required><input value={form.last_name} onChange={set('last_name')} placeholder="Last name" style={inputStyle} /></Field>
              <Field label="Gender" required>
                <select value={form.gender} onChange={set('gender')} style={selStyle}><option value="">Select</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select>
              </Field>
              <Field label="Date of Birth"><input type="date" value={form.dob} onChange={set('dob')} style={inputStyle} /></Field>
              <Field label="Category">
                <select value={form.category_id} onChange={set('category_id')} style={selStyle}><option value="">Select</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </Field>
              <Field label="House">
                <select value={form.house_id} onChange={set('house_id')} style={selStyle}><option value="">Select</option>{houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
              </Field>
              <Field label="Blood Group">
                <select value={form.blood_group} onChange={set('blood_group')} style={selStyle}><option value="">Select</option>{['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((b) => <option key={b} value={b}>{b}</option>)}</select>
              </Field>
              <Field label="Religion"><input value={form.religion} onChange={set('religion')} style={inputStyle} /></Field>
              <Field label="Aadhaar / National ID"><input value={form.aadhaar_no} onChange={set('aadhaar_no')} style={inputStyle} /></Field>
              <Field label="PEN / SSSM ID"><input value={form.pen_no} onChange={set('pen_no')} style={inputStyle} /></Field>
              <Field label="Caste"><input value={form.caste} onChange={set('caste')} style={inputStyle} /></Field>
              <Field label="Sub-Caste"><input value={form.sub_caste} onChange={set('sub_caste')} style={inputStyle} /></Field>
              <Field label="Mother Tongue"><input value={form.mother_tongue} onChange={set('mother_tongue')} style={inputStyle} /></Field>
              <Field label="Place of Birth"><input value={form.place_of_birth} onChange={set('place_of_birth')} style={inputStyle} /></Field>
              <Field label="Nationality"><input value={form.nationality} onChange={set('nationality')} style={inputStyle} /></Field>
              <Field label="Student Phone (Optional)"><input value={form.student_phone} onChange={set('student_phone')} style={inputStyle} /></Field>
              <Field label="Student Email (Optional Login)"><input value={form.student_email} onChange={set('student_email')} style={inputStyle} /></Field>
            </div>
            <div style={{ display: 'flex', gap: 20, margin: '14px 0 4px', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: C.ink, fontFamily: C.font, cursor: 'pointer' }}><input type="checkbox" checked={form.bpl} onChange={set('bpl')} /> Below Poverty Line (BPL)</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: C.ink, fontFamily: C.font, cursor: 'pointer' }}><input type="checkbox" checked={form.rte} onChange={set('rte')} /> RTE (Right to Education)</label>
            </div>
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', marginTop: 12 }}>
              <label style={lbl}>Student Photo</label>
              <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
            </div>
          </>)}

          {step === 2 && (<>
            {sectionHead(<Ico ti="ti-users" size={15} color={PURPLE} />, 'Parent & Guardian Details', PURPLE)}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              {[['new', 'Create New Parent Account'], ['existing', 'Link to Existing Parent']].map(([k, l]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, color: C.ink, fontFamily: C.font, cursor: 'pointer' }}>
                  <input type="radio" name="parentMode" checked={parentMode === k} onChange={() => setParentMode(k)} /> {l}
                </label>
              ))}
            </div>
            {parentMode === 'existing' ? (
              <div style={{ position: 'relative' }}>
                <Field label="Search Existing Parent (by an existing student)">
                  <div style={{ position: 'relative' }}>
                    <Ico ti="ti-search" size={15} color={C.muted2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                    <input value={siblingQuery} onChange={(e) => searchSiblings(e.target.value)} placeholder="Search by parent's name, phone, or child's name…" style={{ ...inputStyle, paddingLeft: 34 }} />
                  </div>
                </Field>
                {siblingResults.length > 0 && (
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, marginTop: 6, overflow: 'hidden' }}>
                    {siblingResults.map((s) => (
                      <button key={s.id} onClick={() => linkSibling(s)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 13px', border: 'none', borderTop: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer', fontFamily: C.font }}>
                        <b style={{ fontSize: 12.5 }}>{s.guardian_name || '—'}</b> <span style={{ fontSize: 11, color: C.muted2 }}>{s.guardian_phone || ''} · child: {s.first_name} {s.last_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={grid2}>
                <Field label="Father's Name"><input value={form.father_name} onChange={set('father_name')} style={inputStyle} /></Field>
                <Field label="Father's Phone"><input value={form.father_phone} onChange={set('father_phone')} style={inputStyle} /></Field>
                <Field label="Father's Occupation"><input value={form.father_occupation} onChange={set('father_occupation')} style={inputStyle} /></Field>
                <Field label="Mother's Name"><input value={form.mother_name} onChange={set('mother_name')} style={inputStyle} /></Field>
                <Field label="Mother's Phone"><input value={form.mother_phone} onChange={set('mother_phone')} style={inputStyle} /></Field>
                <Field label="Mother's Occupation"><input value={form.mother_occupation} onChange={set('mother_occupation')} style={inputStyle} /></Field>
              </div>
            )}
            <div style={{ marginTop: 16 }}>{sectionHead(<Ico ti="ti-users" size={15} color={BLUE} />, 'Primary Contact / Guardian', BLUE)}</div>
            <div style={grid2}>
              <Field label="Guardian Name"><input value={form.guardian_name} onChange={set('guardian_name')} style={inputStyle} /></Field>
              <Field label="Guardian Phone"><input value={form.guardian_phone} onChange={set('guardian_phone')} style={inputStyle} /></Field>
              <Field label="Guardian Email"><input value={form.guardian_email} onChange={set('guardian_email')} style={inputStyle} /></Field>
              <Field label="Emergency Contact Name"><input value={form.emergency_name} onChange={set('emergency_name')} style={inputStyle} /></Field>
              <Field label="Emergency Contact Phone"><input value={form.emergency_phone} onChange={set('emergency_phone')} style={inputStyle} /></Field>
            </div>
          </>)}

          {step === 3 && (<>
            {sectionHead(<Ico ti="ti-heartbeat" size={15} color={RED} />, 'Health & Medical Info', RED)}
            <div style={grid2}>
              <Field label="Height (cm)"><input type="number" value={form.height_cm} onChange={set('height_cm')} style={inputStyle} /></Field>
              <Field label="Weight (kg)"><input type="number" value={form.weight_kg} onChange={set('weight_kg')} style={inputStyle} /></Field>
            </div>
            <div style={{ marginTop: 12 }}>
              <Field label="Medical History / Allergies" full>
                <textarea value={form.medical_history} onChange={set('medical_history')} rows={3} placeholder="Enter any medical history, allergies, or special requirements" style={{ ...inputStyle, resize: 'vertical' }} />
              </Field>
            </div>
            <div style={{ marginTop: 16 }}>{sectionHead(<Ico ti="ti-building-bank" size={15} color={BLUE} />, 'Bank Details', BLUE)}</div>
            <div style={grid2}>
              <Field label="Bank Name"><input value={form.bank_name} onChange={set('bank_name')} style={inputStyle} /></Field>
              <Field label="Account Number"><input value={form.bank_account_no} onChange={set('bank_account_no')} style={inputStyle} /></Field>
              <Field label="IFSC Code"><input value={form.bank_ifsc} onChange={set('bank_ifsc')} style={inputStyle} /></Field>
            </div>
          </>)}

          {step === 4 && (<>
            {sectionHead(<Ico ti="ti-folder-open" size={15} color={C.brand} />, 'Assign Fee Groups', C.brand)}
            {feeGroups.length === 0 ? (
              <p style={{ fontSize: 12.5, color: C.muted2, fontFamily: C.font }}>No fee groups yet. Create them in Finance & Fees → Fee Groups.</p>
            ) : (<>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button onClick={() => setSelectedGroups(Object.fromEntries(feeGroups.map((g) => [g.id, true])))} style={{ ...autoBtn, color: GREEN, borderColor: `${GREEN}55`, background: `${GREEN}0C` }}>Select All</button>
                <button onClick={() => setSelectedGroups({})} style={{ ...autoBtn, color: C.muted, borderColor: C.border, background: C.surface }}>Clear All</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                {feeGroups.map((g) => (
                  <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', border: `1px solid ${selectedGroups[g.id] ? BLUE : C.border}`, background: selectedGroups[g.id] ? `${BLUE}0A` : C.surface, borderRadius: 9, cursor: 'pointer', fontFamily: C.font }}>
                    <input type="checkbox" checked={!!selectedGroups[g.id]} onChange={(e) => setSelectedGroups((p) => ({ ...p, [g.id]: e.target.checked }))} />
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{g.name}</span>
                  </label>
                ))}
              </div>
            </>)}

            <div style={{ marginTop: 18 }}>{sectionHead(<Ico ti="ti-plus" size={15} color={BLUE} />, 'Additional Details', BLUE)}</div>
            {extraFields.map((x, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={x.label} onChange={(e) => setExtra(i, { label: e.target.value })} placeholder="Field name" style={{ ...inputStyle, flex: 1 }} />
                <input value={x.value} onChange={(e) => setExtra(i, { value: e.target.value })} placeholder="Value" style={{ ...inputStyle, flex: 1 }} />
                <button onClick={() => delExtra(i)} style={{ border: 'none', background: `${RED}12`, color: RED, borderRadius: 8, width: 34, cursor: 'pointer' }}><Ico ti="ti-trash" size={13} /></button>
              </div>
            ))}
            <button onClick={addExtra} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: `1.5px dashed ${C.border}`, background: C.surface, color: C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}><Ico ti="ti-plus" size={13} /> Add custom field</button>

            <div style={{ marginTop: 18 }}>{sectionHead(<Ico ti="ti-folder-open" size={15} color={C.muted} />, 'Upload Documents', C.muted)}</div>
            {documents.map((d, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={d.title} onChange={(e) => setDoc(i, { title: e.target.value })} placeholder="Document name (e.g. Birth Certificate)" style={{ ...inputStyle, flex: '1 1 180px' }} />
                <input type="file" onChange={(e) => setDoc(i, { file: e.target.files?.[0] || null })} style={{ flex: '1 1 160px', fontSize: 12 }} />
                <button onClick={() => delDoc(i)} style={{ border: 'none', background: `${RED}12`, color: RED, borderRadius: 8, width: 34, height: 34, cursor: 'pointer' }}><Ico ti="ti-x" size={14} /></button>
              </div>
            ))}
            <button onClick={addDoc} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: `1.5px dashed ${C.border}`, background: C.surface, color: C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}><Ico ti="ti-plus" size={13} /> Add Document</button>
          </>)}

          {/* Nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.border}`, gap: 10 }}>
            <button onClick={prev} disabled={step === 0} style={{ ...navBtn('ghost'), opacity: step === 0 ? 0.5 : 1 }}><Ico ti="ti-arrow-left" size={14} /> Previous</button>
            {step < STEPS.length - 1 ? (
              <button onClick={next} style={navBtn()}>Next Step <Ico ti="ti-arrow-right" size={14} /></button>
            ) : (
              <button onClick={admit} disabled={busy} style={{ ...navBtn(), background: busy ? C.borderSoft : `linear-gradient(135deg, ${GREEN}, #0E9F6E)`, color: busy ? C.muted2 : '#fff' }}>
                {busy ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={14} />} Admit Student
              </button>
            )}
          </div>
        </div>
      </div>

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, maxWidth: '80vw' }}>{toast}</div>}
    </PageLayout>
  );
}
