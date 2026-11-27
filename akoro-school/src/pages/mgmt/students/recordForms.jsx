/**
 * Student Information — dedicated "Add Record" pages (Health / Behavior).
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ShieldAlert, HeartPulse } from 'lucide-react';
import { Ico } from '../../../theme/Ico.jsx';
import { PageLayout } from '../../../components/Layout.jsx';
import BackButton from '../../../components/BackButton.jsx';
import ResourcePage, { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../../constants.js';
import { C, tint } from '../../../theme/colors.js';
import { BASE, fullName, studentOpts, STATUS_PILL, STUDENT_FIELDS, STUDENT_COLUMNS, STUDENT_SEARCH, CLASS_FILTER, naira, STATUS_OPTS, InfoRow, GridInfo, InfoGrid, SectionCard, Ring, statPill, FEE_STATUS_COLOR, ModalShell } from './shared.jsx';

/* ── Dedicated "Add Record" pages (Health / Behavior) ────────────────────── */
function RecordFormShell({ title, color, icon: Icon, ti, backTo, onSave, busy, children }) {
  const navigate = useNavigate();
  return (
    <PageLayout title={title}>
      <div style={{ maxWidth: 640 }}>
        <BackButton onClick={() => navigate(backTo)} label="Back to Profile" />
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            {Icon && <Ico lucide={Icon} ti={ti} size={18} color={color} />}
            <b style={{ fontSize: 15, fontFamily: C.font, color: C.ink }}>{title}</b>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
          <button onClick={onSave} disabled={busy} style={{ marginTop: 18, padding: '10px 20px', borderRadius: 9, border: 'none', background: color, color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: C.font, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {busy ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={14} />} Save Record
          </button>
        </div>
      </div>
    </PageLayout>
  );
}

const fieldLabel = { fontSize: 11.5, fontWeight: 800, color: C.muted2, fontFamily: C.font, textTransform: 'uppercase', letterSpacing: .3, marginBottom: 5, display: 'block' };

export function HealthRecordFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ record_type: 'condition', title: '', recorded_on: '', details: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.title.trim()) return setError('Give this record a title.');
    setBusy(true); setError('');
    try {
      await apiPost(`${BASE}/health-records`, { ...form, student_id: id });
      navigate(`/mgmt/students/${id}?tab=health`);
    } catch (e) { setError(e.message || 'Could not save this record.'); }
    finally { setBusy(false); }
  };

  return (
    <RecordFormShell title="Add Health Record" color={RED} icon={HeartPulse} ti="ti-heartbeat" backTo={`/mgmt/students/${id}?tab=health`} onSave={save} busy={busy}>
      {error && (
        <div style={{ padding: '10px 13px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 11, fontSize: 12.5, fontWeight: 700, color: '#991B1B' }}>
          {error}
        </div>
      )}
      <div>
        <label style={fieldLabel}>Type</label>
        <select value={form.record_type} onChange={set('record_type')} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
          <option value="allergy">Allergy</option><option value="condition">Condition</option>
          <option value="vaccination">Vaccination</option><option value="checkup">Checkup</option>
        </select>
      </div>
      <div>
        <label style={fieldLabel}>Title</label>
        <input value={form.title} onChange={set('title')} placeholder="e.g. Peanut Allergy" style={{ ...inputStyle, width: '100%' }} />
      </div>
      <div>
        <label style={fieldLabel}>Date</label>
        <input type="date" value={form.recorded_on} onChange={set('recorded_on')} style={{ ...inputStyle, width: '100%' }} />
      </div>
      <div>
        <label style={fieldLabel}>Details</label>
        <textarea value={form.details} onChange={set('details')} rows={4} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
      </div>
    </RecordFormShell>
  );
}

export function BehaviorRecordFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ incident_type: '', polarity: 'negative', severity: 'low', points: 1, description: '', action_taken: '', recorded_on: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.incident_type.trim()) return setError('Choose an incident type.');
    setBusy(true);
    try {
      await apiPost(`${BASE}/behavior-records`, { ...form, points: Number(form.points) || 1, student_id: id });
      navigate(`/mgmt/students/${id}?tab=behavior`);
    } catch (e) { setError(e.message || 'Could not save this record.'); }
    finally { setBusy(false); }
  };

  return (
    <RecordFormShell title="Add Behavior Record" color={C.brand} icon={ShieldAlert} ti="ti-shield-exclamation" backTo={`/mgmt/students/${id}?tab=behavior`} onSave={save} busy={busy}>
      {error && (
        <div style={{ padding: '10px 13px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 11, fontSize: 12.5, fontWeight: 700, color: '#991B1B' }}>
          {error}
        </div>
      )}
      <div>
        <label style={fieldLabel}>Incident Type</label>
        <input value={form.incident_type} onChange={set('incident_type')} placeholder="e.g. Helped a classmate" style={{ ...inputStyle, width: '100%' }} />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={fieldLabel}>Polarity</label>
          <select value={form.polarity} onChange={set('polarity')} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
            <option value="positive">Positive</option><option value="negative">Negative</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={fieldLabel}>Severity</label>
          <select value={form.severity} onChange={set('severity')} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={fieldLabel}>Points</label>
          <input type="number" min={1} value={form.points} onChange={set('points')} style={{ ...inputStyle, width: '100%' }} />
        </div>
      </div>
      <div>
        <label style={fieldLabel}>Date</label>
        <input type="date" value={form.recorded_on} onChange={set('recorded_on')} style={{ ...inputStyle, width: '100%' }} />
      </div>
      <div>
        <label style={fieldLabel}>Description</label>
        <textarea value={form.description} onChange={set('description')} rows={3} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
      </div>
      <div>
        <label style={fieldLabel}>Action Taken</label>
        <textarea value={form.action_taken} onChange={set('action_taken')} rows={3} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
      </div>
    </RecordFormShell>
  );
}

