/** QR Code Attendance module pages (mgmt schema). */
import { useState, useEffect, useCallback } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { ModuleSettingsForm } from '../../components/mgmt/extras.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { GREEN, RED, BLUE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const BASE = '/api/school/mgmt';

/* ── QR Attendance (live check-in) ───────────────────────────────── */
export function QRAttendancePage() {
  const [staff, setStaff] = useState([]);
  const [students, setStudents] = useState([]);
  const [personType, setPersonType] = useState('staff');
  const [personId, setPersonId] = useState('');
  const [direction, setDirection] = useState('in');
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const loadEvents = useCallback(() => {
    apiGet(`${BASE}/qr-events`).then((r) => {
      const today = new Date().toISOString().slice(0, 10);
      setEvents((r.data || []).filter((e) => String(e.happened_at).slice(0, 10) === today));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    apiGet(`${BASE}/staff?status=active`).then((r) => setStaff(r.data || [])).catch(() => {});
    apiGet(`${BASE}/students?status=active`).then((r) => setStudents(r.data || [])).catch(() => {});
    loadEvents();
  }, [loadEvents]);

  const people = personType === 'staff' ? staff : students;
  const labelOf = (p) => `${p.first_name} ${p.last_name} (${p.staff_no || p.admission_no})`;

  const checkin = async () => {
    if (!personId) return showToast('Pick a person first');
    const person = people.find((p) => p.id === personId);
    setBusy(true);
    try {
      await apiPost(`${BASE}/qr/checkin`, {
        person_type: personType,
        [personType === 'staff' ? 'staff_id' : 'student_id']: personId,
        person_name: person ? `${person.first_name} ${person.last_name}` : undefined,
        direction, method: 'manual',
      });
      showToast(`Checked ${direction} ✓`);
      loadEvents();
    } catch (e) { showToast(e.message || 'Could not record'); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="QR Attendance" subtitle="Scan-in station & manual check-in">
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Station QR + manual entry */}
        <div style={{ flex: '1 1 300px', maxWidth: 380 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 22px', textAlign: 'center', marginBottom: 14, fontFamily: C.font }}>
            <div style={{ width: 140, height: 140, borderRadius: 14, background: C.bg, border: `1.5px dashed ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <Ico ti="ti-qrcode" size={90} color={C.ink} />
            </div>
            <p style={{ fontSize: 13, fontWeight: 800, color: C.ink, margin: '0 0 4px' }}>Station QR Code</p>
            <p style={{ fontSize: 11.5, color: C.muted2, margin: 0, lineHeight: 1.5 }}>Staff and students scan this at the gate. Scanner hardware posts to the same check-in API used below.</p>
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px', fontFamily: C.font }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: C.ink, margin: '0 0 12px' }}>Manual Check-in</p>
            <select value={personType} onChange={(e) => { setPersonType(e.target.value); setPersonId(''); }} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 10 }}>
              <option value="staff">Staff</option><option value="student">Student</option>
            </select>
            <select value={personId} onChange={(e) => setPersonId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 10 }}>
              <option value="">— select {personType} —</option>
              {people.map((p) => <option key={p.id} value={p.id}>{labelOf(p)}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {[{ v: 'in', label: 'Check In', icon: LogIn, ti: 'ti-login', c: GREEN }, { v: 'out', label: 'Check Out', icon: LogOut, ti: 'ti-logout', c: RED }].map((d) => (
                <button key={d.v} onClick={() => setDirection(d.v)} style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', borderRadius: 9, border: `1.5px solid ${direction === d.v ? d.c : C.border}`, background: direction === d.v ? tint(7, d.c) : C.surface, color: direction === d.v ? d.c : C.muted2, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
                  <Ico lucide={d.icon} ti={d.ti} size={13} /> {d.label}
                </button>
              ))}
            </div>
            <button onClick={checkin} disabled={busy} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', borderRadius: 10, border: 'none', background: busy ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: busy ? C.muted2 : '#fff', fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: C.font }}>
              {busy ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-qrcode" size={14} />} Record
            </button>
          </div>
        </div>

        {/* Today's events */}
        <div style={{ flex: '1.4 1 360px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '13px 18px', borderBottom: `1px solid ${C.border}`, fontFamily: C.font }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>Today's Activity ({events.length})</span>
          </div>
          {events.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: C.muted2, fontSize: 13, fontFamily: C.font }}>No check-ins yet today.</div>
          ) : events.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: `1px solid ${C.border}`, fontFamily: C.font }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: e.direction === 'in' ? tint(8, GREEN) : tint(7, RED), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {e.direction === 'in' ? <Ico ti="ti-login" size={14} color={GREEN} /> : <Ico ti="ti-logout" size={14} color={RED} />}
              </span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{e.person_name || e.staff_name || e.student_name || 'Unknown'}</span>
                <span style={{ fontSize: 10.5, color: C.muted2, marginLeft: 8, textTransform: 'capitalize' }}>{e.person_type} · {e.method}</span>
              </div>
              <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>{new Date(e.happened_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
        </div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

export function QRSettingsPage() {
  return <ModuleSettingsForm module="qr-attendance" title="QR Attendance Setting" subtitle="Configure the scan station"
    fields={[
      { key: 'enabled', label: 'Enable QR Attendance', type: 'toggle' },
      { key: 'track_students', label: 'Track Students', type: 'toggle' },
      { key: 'track_staff', label: 'Track Staff', type: 'toggle' },
      { key: 'late_after', label: 'Mark Late After (HH:MM)', type: 'time', hint: 'Check-ins after this time are flagged late in reports.' },
    ]} />;
}

export function QRReportPage() {
  return <ResourcePage title="QR Attendance Report" subtitle="All scan-in/out events" resource="qr-events"
    columns={[
      { key: 'person_name', label: 'Person', render: (r) => <b>{r.person_name || r.staff_name || r.student_name || '—'}</b> },
      { key: 'person_type', label: 'Type' },
      { key: 'direction', label: 'Direction', render: (r) => <span style={{ padding: '3px 10px', borderRadius: 999, background: r.direction === 'in' ? tint(8, GREEN) : tint(7, RED), color: r.direction === 'in' ? GREEN : RED, fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>{r.direction}</span> },
      { key: 'method', label: 'Method' },
      { key: 'happened_at', label: 'Time', render: (r) => new Date(r.happened_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
    ]}
    fields={[]} canCreate={false} canEdit={false}
    listFilters={[
      { key: 'person_type', label: 'Type', options: [{ value: 'staff', label: 'Staff' }, { value: 'student', label: 'Student' }] },
      { key: 'direction', label: 'Direction', options: [{ value: 'in', label: 'In' }, { value: 'out', label: 'Out' }] },
    ]} searchKeys={['person_name']} />;
}
