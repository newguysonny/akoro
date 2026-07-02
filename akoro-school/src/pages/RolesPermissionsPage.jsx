import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck, ArrowLeft, Plus, Trash2, Save, Loader2, Lock, Users, X, Check,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';

/* Same module catalog as Module Management, used here as the permission-matrix rows. */
const MODULES = [
  { key: 'student_information', label: 'Student Information' },
  { key: 'academics',           label: 'Academics' },
  { key: 'fees_collection',     label: 'Fees Collection' },
  { key: 'human_resource',      label: 'Human Resource' },
  { key: 'offline_examinations', label: 'Offline Examinations' },
  { key: 'certificates_documents', label: 'Certificates & Documents' },
  { key: 'homework',          label: 'Homework' },
  { key: 'library',           label: 'Library Management' },
  { key: 'transport',         label: 'Transport' },
  { key: 'hostel',            label: 'Hostel' },
  { key: 'inventory',         label: 'Inventory' },
  { key: 'asset_management',  label: 'Asset Management' },
  { key: 'accounts_finance',  label: 'Accounts & Finance' },
  { key: 'front_office',      label: 'Front Office' },
  { key: 'communications',    label: 'Communications' },
  { key: 'online_examinations', label: 'Online Examinations' },
  { key: 'cbc_academics',     label: 'CBC / Competency Academics' },
  { key: 'apps_center',       label: 'Apps Center' },
  { key: 'ptm',               label: 'Parent–Teacher Meetings' },
  { key: 'lesson_planner',    label: 'Lesson Planner' },
  { key: 'qr_attendance',     label: 'QR Code Attendance' },
  { key: 'assessment',        label: 'Assessment' },
];
const ACTIONS = ['view', 'create', 'edit', 'delete'];

function PermCheckbox({ on, disabled, onChange }) {
  return (
    <button onClick={() => !disabled && onChange(!on)} disabled={disabled} style={{
      width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${on ? BLUE : BORDER}`,
      background: disabled ? `${GREEN}12` : (on ? BLUE : WHITE), cursor: disabled ? 'default' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      {(on || disabled) && <Check size={13} color={disabled ? GREEN : WHITE} />}
    </button>
  );
}

function RoleEditor({ role, onSave, onCancel, saving }) {
  const [name, setName] = useState(role?.name || '');
  const [description, setDescription] = useState(role?.description || '');
  const [permissions, setPermissions] = useState(role?.permissions || {});
  const isAdmin = !!role?.isSystem;

  const hasAll = isAdmin || !!permissions['*'];
  const isOn = (modKey, action) => hasAll || !!permissions[modKey]?.[action];
  const togglePerm = (modKey, action) => {
    if (hasAll) return;
    setPermissions((prev) => ({
      ...prev,
      [modKey]: { ...(prev[modKey] || {}), [action]: !isOn(modKey, action) },
    }));
  };
  const toggleRow = (modKey) => {
    if (hasAll) return;
    const allOn = ACTIONS.every((a) => isOn(modKey, a));
    setPermissions((prev) => ({ ...prev, [modKey]: Object.fromEntries(ACTIONS.map((a) => [a, !allOn])) }));
  };

  return (
    <div style={{ background: WHITE, border: `1.5px solid ${AMBER}44`, borderRadius: 14, padding: '18px 20px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: INK, fontFamily: FONT }}>{role?.id ? 'Edit Role' : 'New Role'}</span>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED2 }}><X size={18} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
        <div>
          <label style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 6 }}>Role Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={isAdmin} placeholder="e.g. Librarian" style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13.5, fontFamily: FONT, color: INK, boxSizing: 'border-box', background: isAdmin ? LIGHT : WHITE }} />
        </div>
        <div>
          <label style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 6 }}>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role can do" style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13.5, fontFamily: FONT, color: INK, boxSizing: 'border-box' }} />
        </div>
      </div>

      {isAdmin ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: `${GREEN}0C`, border: `1px solid ${GREEN}33`, borderRadius: 10, padding: '12px 14px', marginBottom: 4 }}>
          <ShieldCheck size={15} color={GREEN} />
          <span style={{ fontSize: 12.5, color: INK, fontFamily: FONT }}>The Administrator role always has full access to every module and can't be restricted.</span>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: `1px solid ${BORDER}`, borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, minWidth: 460 }}>
            <thead>
              <tr style={{ background: LIGHT }}>
                <th style={{ textAlign: 'left', padding: '9px 12px', fontSize: 10.5, fontWeight: 800, color: MUTED2 }}>MODULE</th>
                {ACTIONS.map((a) => <th key={a} style={{ textAlign: 'center', padding: '9px 8px', fontSize: 10.5, fontWeight: 800, color: MUTED2, textTransform: 'uppercase' }}>{a}</th>)}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m.key} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td onClick={() => toggleRow(m.key)} style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600, color: INK, cursor: 'pointer' }}>{m.label}</td>
                  {ACTIONS.map((a) => (
                    <td key={a} style={{ padding: '8px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <PermCheckbox on={isOn(m.key, a)} onChange={() => togglePerm(m.key, a)} />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <button onClick={onCancel} style={{ padding: '10px 18px', borderRadius: 10, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
        <button onClick={() => onSave({ name, description, permissions })} disabled={saving || !name.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 20px', borderRadius: 10, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 13, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
          {saving ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} {saving ? 'Saving…' : 'Save Role'}
        </button>
      </div>
    </div>
  );
}

export default function RolesPermissionsPage() {
  const navigate = useNavigate();
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // role object, or {} for new
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    apiGet('/api/school/roles')
      .then((res) => setRoles(res.data || []))
      .catch((e) => showToast(e.message || 'Could not load roles'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveRole = async (payload) => {
    setSaving(true);
    try {
      if (editing?.id) {
        const res = await apiPut(`/api/school/roles/${editing.id}`, payload);
        setRoles((prev) => prev.map((r) => (r.id === editing.id ? res.data : r)));
      } else {
        const res = await apiPost('/api/school/roles', payload);
        setRoles((prev) => [...prev, res.data]);
      }
      setEditing(null);
      showToast('Role saved ✓');
    } catch (e) { showToast(e.message || 'Could not save role'); }
    finally { setSaving(false); }
  };

  const removeRole = async (role) => {
    if (role.isSystem) return;
    setBusyId(role.id);
    try {
      await apiDelete(`/api/school/roles/${role.id}`);
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
      showToast('Role deleted');
    } catch (e) { showToast(e.message || 'Could not delete role'); }
    finally { setBusyId(null); }
  };

  const permSummary = (role) => {
    if (role.isSystem || role.permissions?.['*']) return 'Full access';
    const modKeys = Object.keys(role.permissions || {}).filter((k) => k !== '*');
    if (!modKeys.length) return 'No modules assigned';
    return `${modKeys.length} module${modKeys.length === 1 ? '' : 's'}`;
  };

  return (
    <PageLayout title="Roles & Permissions" subtitle="Control what each staff role can see and do">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/settings-billing')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
          <ArrowLeft size={14} /> Back to Settings
        </button>
        <button onClick={() => setEditing({})} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <Plus size={14} /> New Role
        </button>
      </div>

      {editing && <RoleEditor role={editing.id ? editing : null} onSave={saveRole} onCancel={() => setEditing(null)} saving={saving} />}

      {loading ? (
        <div style={{ padding: '50px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {roles.map((role) => (
            <div key={role.id} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: role.isSystem ? `${GREEN}15` : `${BLUE}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {role.isSystem ? <Lock size={16} color={GREEN} /> : <ShieldCheck size={16} color={BLUE} />}
                  </div>
                  <div>
                    <p style={{ fontSize: 14.5, fontWeight: 800, color: INK, margin: 0, fontFamily: FONT }}>{role.name}</p>
                    <p style={{ fontSize: 11.5, color: MUTED2, margin: '2px 0 0', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}><Users size={11} /> {role.memberCount} member{role.memberCount === 1 ? '' : 's'}</p>
                  </div>
                </div>
                {role.isSystem && (
                  <span style={{ padding: '3px 9px', borderRadius: 999, background: `${GREEN}15`, color: GREEN, fontSize: 10.5, fontWeight: 800, fontFamily: FONT, whiteSpace: 'nowrap' }}>System</span>
                )}
              </div>

              <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 12px', lineHeight: 1.55, fontFamily: FONT, minHeight: 34 }}>{role.description || '—'}</p>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: role.isSystem || role.permissions?.['*'] ? GREEN : BLUE, fontFamily: FONT }}>{permSummary(role)}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setEditing(role)} style={{ padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Edit</button>
                  {!role.isSystem && (
                    <button onClick={() => removeRole(role)} disabled={busyId === role.id} style={{ width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${BORDER}`, background: WHITE, color: RED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {busyId === role.id ? <Loader2 size={12} style={{ animation: 'spin .8s linear infinite' }} /> : <Trash2 size={13} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
