import { useState, useEffect, useCallback } from 'react';
import { Briefcase, Plus, Edit2, Trash2, Users } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton, Inp, Txa, Sel } from '../components/Primitives.jsx';
import useAdminAPI from '../hooks/useAdminAPI.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, RED, GREEN, FONT } from '../constants.js';

const TABS = ['jobs', 'departments', 'applications'];
const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];
const JOB_STATUSES = ['open', 'closed'];

const EMPTY_JOB = { title: '', department_id: '', location: '', type: 'Full-time', summary: '', description: '', status: 'open' };
const EMPTY_DEPT = { name: '', color: '#6C3BFF' };

export default function CareersAdminPage() {
  const api = useAdminAPI();
  const [tab, setTab] = useState('jobs');
  const [depts, setDepts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [jobModal, setJobModal] = useState(null);   // null | {mode:'new'|'edit', data:{}}
  const [deptModal, setDeptModal] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null); // {type:'job'|'dept', id, name}

  const showToast = (msg, type = 'success') => { setToast({ message: msg, type }); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, j, a] = await Promise.all([api.getDepartments(), api.getJobs(), api.getApplications()]);
      setDepts(d || []); setJobs(j || []); setApps(a || []);
    } catch { showToast('Failed to load data', 'error'); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  // flatten grouped jobs for table
  const flatJobs = jobs.flatMap(g => (g.jobs || []).map(j => ({ ...j, deptName: g.dept, deptColor: g.color })));

  const saveJob = async () => {
    try {
      const d = jobModal.data;
      if (jobModal.mode === 'new') await api.createJob(d);
      else await api.updateJob(d.id, d);
      showToast(jobModal.mode === 'new' ? 'Job created' : 'Job updated');
      load(); setJobModal(null);
    } catch { showToast('Save failed', 'error'); }
  };

  const saveDept = async () => {
    try {
      const d = deptModal.data;
      if (deptModal.mode === 'new') await api.createDepartment(d);
      else await api.updateDepartment(d.id, d);
      showToast(deptModal.mode === 'new' ? 'Department created' : 'Department updated');
      load(); setDeptModal(null);
    } catch { showToast('Save failed', 'error'); }
  };

  const handleDelete = async () => {
    try {
      if (deleteModal.type === 'job') await api.deleteJob(deleteModal.id);
      else await api.deleteDepartment(deleteModal.id);
      showToast('Deleted'); load();
    } catch { showToast('Delete failed', 'error'); }
    setDeleteModal(null);
  };

  const TH = { padding: '10px 16px', fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', background: LIGHT, borderBottom: `1px solid ${BORDER}` };
  const TD = { padding: '14px 16px', fontSize: 13.5, color: INK, borderBottom: `1px solid ${BORDER}`, verticalAlign: 'middle' };
  const setJob = k => e => setJobModal(m => ({ ...m, data: { ...m.data, [k]: e.target.value } }));
  const setDept = k => e => setDeptModal(m => ({ ...m, data: { ...m.data, [k]: e.target.value } }));

  return (
    <PageLayout title="Careers" subtitle="Manage job listings, departments and applications">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: `1px solid ${BORDER}`, paddingBottom: 0 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '10px 20px', borderRadius: '8px 8px 0 0', border: `1px solid ${tab === t ? BORDER : 'transparent'}`, borderBottom: tab === t ? `1px solid ${WHITE}` : `1px solid ${BORDER}`, background: tab === t ? WHITE : 'transparent', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: tab === t ? AMBER : MUTED, fontFamily: FONT, textTransform: 'capitalize', marginBottom: -1 }}>{t}</button>
        ))}
        <div style={{ flex: 1 }} />
        {tab === 'jobs' && <Btn size="sm" onClick={() => setJobModal({ mode: 'new', data: { ...EMPTY_JOB } })}><Plus size={13} /> Add Job</Btn>}
        {tab === 'departments' && <Btn size="sm" onClick={() => setDeptModal({ mode: 'new', data: { ...EMPTY_DEPT } })}><Plus size={13} /> Add Dept</Btn>}
      </div>

      {/* Jobs tab */}
      {tab === 'jobs' && (
        <div style={{ background: WHITE, borderRadius: 16, border: `1px solid ${BORDER}`, overflow: 'hidden', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead><tr>{['Title', 'Department', 'Location', 'Type', 'Status', 'Posted', 'Actions'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={7} style={TD}><Skeleton height={20} /></td></tr>)
                : flatJobs.length === 0 ? <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: MUTED, padding: 40 }}>No jobs yet.</td></tr>
                : flatJobs.map(j => (
                  <tr key={j.id} onMouseEnter={e => e.currentTarget.style.background = LIGHT} onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={TD}><span style={{ fontWeight: 600 }}>{j.title}</span></td>
                    <td style={TD}><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: `${j.deptColor}22`, color: j.deptColor }}>{j.deptName}</span></td>
                    <td style={{ ...TD, color: MUTED }}>{j.location || '—'}</td>
                    <td style={{ ...TD, color: MUTED }}>{j.type}</td>
                    <td style={TD}><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: j.status === 'open' ? '#DCFCE7' : '#F3F4F6', color: j.status === 'open' ? '#166534' : '#6B7280' }}>{j.status}</span></td>
                    <td style={{ ...TD, color: MUTED }}>{j.posted_at ? new Date(j.posted_at).toLocaleDateString() : '—'}</td>
                    <td style={TD}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Btn variant="ghost" size="sm" onClick={() => setJobModal({ mode: 'edit', data: { ...j, department_id: j.department_id } })}><Edit2 size={13} /></Btn>
                        <Btn variant="ghost" size="sm" onClick={() => setDeleteModal({ type: 'job', id: j.id, name: j.title })} style={{ color: RED }}><Trash2 size={13} /></Btn>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Departments tab */}
      {tab === 'departments' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 16 }}>
          {loading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={100} style={{ borderRadius: 12 }} />)
            : depts.map(d => (
              <div key={d.id} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: d.color }} />
                  <span style={{ fontWeight: 700, fontSize: 15, color: INK }}>{d.name}</span>
                </div>
                <span style={{ fontSize: 12, color: MUTED }}>{flatJobs.filter(j => j.deptName === d.name).length} open roles</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn variant="ghost" size="sm" onClick={() => setDeptModal({ mode: 'edit', data: { ...d } })}><Edit2 size={13} /></Btn>
                  <Btn variant="ghost" size="sm" onClick={() => setDeleteModal({ type: 'dept', id: d.id, name: d.name })} style={{ color: RED }}><Trash2 size={13} /></Btn>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Applications tab */}
      {tab === 'applications' && (
        <div style={{ background: WHITE, borderRadius: 16, border: `1px solid ${BORDER}`, overflow: 'hidden', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead><tr>{['Applicant', 'Email', 'Job Applied For', 'Date'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={4} style={TD}><Skeleton height={20} /></td></tr>)
                : apps.length === 0 ? <tr><td colSpan={4} style={{ ...TD, textAlign: 'center', color: MUTED, padding: 40 }}>No applications yet.</td></tr>
                : apps.map(a => (
                  <tr key={a.id} onMouseEnter={e => e.currentTarget.style.background = LIGHT} onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ ...TD, fontWeight: 600 }}>{a.name}</td>
                    <td style={{ ...TD, color: MUTED }}>{a.email}</td>
                    <td style={{ ...TD, color: MUTED }}>{a.jobs?.title || '—'}</td>
                    <td style={{ ...TD, color: MUTED }}>{new Date(a.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Job modal */}
      <Modal open={!!jobModal} onClose={() => setJobModal(null)} title={jobModal?.mode === 'new' ? 'Add Job' : 'Edit Job'} width={560}>
        {jobModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Inp label="Job title *" value={jobModal.data.title} onChange={setJob('title')} />
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 6, display: 'block' }}>Department</label>
              <Sel value={jobModal.data.department_id} onChange={setJob('department_id')}>
                <option value="">Select department…</option>
                {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Sel>
            </div>
            <Inp label="Location" value={jobModal.data.location} onChange={setJob('location')} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 6, display: 'block' }}>Type</label>
                <Sel value={jobModal.data.type} onChange={setJob('type')}>{JOB_TYPES.map(t => <option key={t}>{t}</option>)}</Sel>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 6, display: 'block' }}>Status</label>
                <Sel value={jobModal.data.status} onChange={setJob('status')}>{JOB_STATUSES.map(s => <option key={s}>{s}</option>)}</Sel>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 6, display: 'block' }}>Summary</label>
              <Txa value={jobModal.data.summary} onChange={setJob('summary')} rows={3} placeholder="Short summary shown on careers page…" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 6, display: 'block' }}>Description (optional)</label>
              <Txa value={jobModal.data.description || ''} onChange={setJob('description')} rows={4} placeholder="Full job description…" />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Btn variant="secondary" onClick={() => setJobModal(null)}>Cancel</Btn>
              <Btn onClick={saveJob}>Save</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Dept modal */}
      <Modal open={!!deptModal} onClose={() => setDeptModal(null)} title={deptModal?.mode === 'new' ? 'Add Department' : 'Edit Department'}>
        {deptModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Inp label="Department name *" value={deptModal.data.name} onChange={setDept('name')} />
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 6, display: 'block' }}>Colour</label>
              <input type="color" value={deptModal.data.color} onChange={setDept('color')} style={{ width: 60, height: 36, cursor: 'pointer', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 2 }} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Btn variant="secondary" onClick={() => setDeptModal(null)}>Cancel</Btn>
              <Btn onClick={saveDept}>Save</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!deleteModal} onClose={() => setDeleteModal(null)} title="Confirm Delete">
        <p style={{ color: MUTED, fontSize: 14, marginBottom: 20 }}>Delete "<strong>{deleteModal?.name}</strong>"? This cannot be undone.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setDeleteModal(null)}>Cancel</Btn>
          <Btn variant="danger" onClick={handleDelete}>Delete</Btn>
        </div>
      </Modal>
    </PageLayout>
  );
}
