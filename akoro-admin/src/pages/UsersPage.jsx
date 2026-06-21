import { useState, useEffect, useCallback } from 'react';
import { Users, Search, UserX, UserCheck, Trash2, LogOut, UserPlus, Upload, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton, Inp } from '../components/Primitives.jsx';
import useAdminAPI from '../hooks/useAdminAPI.js';
import { apiGet, apiPost } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../constants.js';

function RolePill({ role }) {
  const map = {
    student:    { bg: '#EDE9FF', color: PURPLE },
    instructor: { bg: '#FFF3DC', color: AMBER },
    admin:      { bg: '#FFE4E4', color: RED },
  };
  const cfg = map[role] || map.student;
  return (
    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color }}>
      {role}
    </span>
  );
}

function StatusPill({ active }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: active ? '#DCFCE7' : '#FEE2E2',
      color: active ? GREEN : RED,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: active ? GREEN : RED, display: 'inline-block' }} />
      {active ? 'Active' : 'Suspended'}
    </span>
  );
}

function UserDrawer({ user, onClose }) {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    apiGet(`/api/admin/users/${user.id}/enrollments`)
      .then(res => setEnrollments(Array.isArray(res) ? res : (res?.enrollments || res?.data || [])))
      .catch(() => setEnrollments([]))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return null;

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  return (
    <>
      {/* overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(26,26,46,.35)',
          zIndex: 900, backdropFilter: 'blur(2px)',
        }}
      />
      {/* drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 400,
        background: WHITE, zIndex: 901, boxShadow: '-8px 0 40px rgba(0,0,0,.15)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: INK, fontFamily: FONT, margin: 0 }}>User Profile</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: MUTED }}>
            <X size={18} />
          </button>
        </div>

        {/* User info */}
        <div style={{ padding: '24px', borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: `${AMBER}20`, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 700, color: AMBER, flexShrink: 0,
            }}>
              {(user.full_name || user.fullName || user.username || '?')[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: INK, fontFamily: FONT }}>
                {user.full_name || user.fullName || user.username || '—'}
              </div>
              <div style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>{user.email}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Role',    value: <RolePill role={user.role} /> },
              { label: 'Status',  value: <StatusPill active={user.is_active !== false} /> },
              { label: 'Joined',  value: fmtDate(user.created_at) },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: MUTED, fontFamily: FONT }}>{label}</span>
                <span style={{ fontSize: 13, color: INK, fontFamily: FONT }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Enrollments */}
        <div style={{ padding: '20px 24px', flex: 1 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT, margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Enrollment History
          </h3>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1,2,3].map(i => <Skeleton key={i} height={56} />)}
            </div>
          ) : enrollments.length === 0 ? (
            <p style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>No enrollments yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {enrollments.map((enr, idx) => {
                const progress = enr.progress || enr.completion_percentage || 0;
                return (
                  <div key={enr.id || idx} style={{
                    background: LIGHT, borderRadius: 10, padding: '12px 14px',
                    border: `1px solid ${BORDER}`,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT, marginBottom: 6 }}>
                      {enr.course_title || enr.course?.title || '—'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: `${BORDER}`, borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, progress)}%`, height: '100%', background: GREEN, borderRadius: 4, transition: 'width .3s' }} />
                      </div>
                      <span style={{ fontSize: 11, color: MUTED, fontFamily: FONT, flexShrink: 0 }}>
                        {Math.round(progress)}%
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT, marginTop: 4 }}>
                      Enrolled {fmtDate(enr.enrolled_at || enr.created_at)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const PAGE_SIZE = 20;

export default function UsersPage() {
  const api      = useAdminAPI();
  const navigate = useNavigate();

  const [users,        setUsers]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [roleFilter,   setRoleFilter]   = useState('all');
  const [page,         setPage]         = useState(1);
  const [deleteModal,  setDeleteModal]  = useState({ open: false, id: null, name: '' });
  const [logoutModal,  setLogoutModal]  = useState({ open: false, id: null, name: '' });
  const [busy,         setBusy]         = useState(false);
  const [toast,        setToast]        = useState(null);
  const [drawerUser,   setDrawerUser]   = useState(null);

  // Invite
  const [inviteModal,  setInviteModal]  = useState(false);
  const [inviteForm,   setInviteForm]   = useState({ email: '', full_name: '', role: 'student' });
  const [inviteBusy,   setInviteBusy]   = useState(false);

  // CSV import
  const [csvModal,     setCsvModal]     = useState(false);
  const [csvText,      setCsvText]      = useState('');
  const [csvBusy,      setCsvBusy]      = useState(false);
  const [csvResult,    setCsvResult]    = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 200, sort: 'newest' };
      if (roleFilter !== 'all') params.role = roleFilter;
      const res = await api.getUsers(params);
      const arr = Array.isArray(res) ? res : (res?.users || res?.data || []);
      setUsers(arr);
    } catch {
      showToast('Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [api, roleFilter]);

  useEffect(() => { load(); setPage(1); }, [load]);

  const filtered = users.filter(u => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const name = (u.full_name || u.fullName || u.username || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    return name.includes(q) || email.includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleStatus = async (u) => {
    setBusy(u.id);
    try {
      if (u.is_active) {
        await api.suspendUser(u.id);
        setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: false } : x));
        showToast('User suspended');
      } else {
        await api.activateUser(u.id);
        setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: true } : x));
        showToast('User activated');
      }
    } catch (err) {
      showToast(err.message || 'Action failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const confirmForceLogout = async () => {
    setBusy(logoutModal.id);
    try {
      await api.forceLogout(logoutModal.id);
      setLogoutModal({ open: false, id: null, name: '' });
      showToast(`${logoutModal.name} has been logged out`);
    } catch (err) {
      showToast(err.message || 'Force logout failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async () => {
    setBusy(deleteModal.id);
    try {
      await api.deleteUser(deleteModal.id);
      setUsers(prev => prev.filter(x => x.id !== deleteModal.id));
      setDeleteModal({ open: false, id: null, name: '' });
      showToast('User deleted');
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleInvite = async () => {
    if (!inviteForm.email.trim()) return;
    setInviteBusy(true);
    try {
      await apiPost('/api/admin/users/invite', inviteForm);
      setInviteModal(false);
      setInviteForm({ email: '', full_name: '', role: 'student' });
      showToast('Invitation sent successfully');
    } catch (err) {
      showToast(err.message || 'Failed to send invite', 'error');
    } finally {
      setInviteBusy(false);
    }
  };

  const parseCSV = (text) => {
    return text.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(',').map(p => p.trim());
        return { email: parts[0] || '', full_name: parts[1] || '', role: parts[2] || 'student' };
      })
      .filter(row => row.email);
  };

  const handleCSVImport = async () => {
    const rows = parseCSV(csvText);
    if (rows.length === 0) { showToast('No valid rows found in CSV', 'error'); return; }
    setCsvBusy(true);
    try {
      const res = await apiPost('/api/admin/users/invite-csv', { rows });
      setCsvResult(res);
      setCsvText('');
      load();
    } catch (err) {
      showToast(err.message || 'CSV import failed', 'error');
    } finally {
      setCsvBusy(false);
    }
  };

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };

  const CHIP = (active) => ({
    padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
    fontFamily: FONT, fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? AMBER : 'transparent', color: active ? WHITE : MUTED,
    transition: 'all .15s',
  });

  const actions = (
    <div style={{ display: 'flex', gap: 8 }}>
      <Btn variant="secondary" size="sm" onClick={() => setCsvModal(true)}>
        <Upload size={13} /> Import CSV
      </Btn>
      <Btn variant="primary" size="sm" onClick={() => setInviteModal(true)}>
        <UserPlus size={13} /> Invite User
      </Btn>
    </div>
  );

  return (
    <PageLayout title="Users" subtitle={`${filtered.length} total users`} action={actions}>
      {/* Filters bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} color={MUTED} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name or email…"
            style={{
              width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10,
              border: `1.5px solid ${BORDER}`, outline: 'none',
              fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['all', 'student', 'instructor'].map(r => (
            <button key={r} style={CHIP(roleFilter === r)} onClick={() => { setRoleFilter(r); setPage(1); }}>
              {r === 'all' ? 'All' : r === 'student' ? 'Students' : 'Instructors'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', marginBottom: 20, overflowX: 'auto' }}>
        {loading ? (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2,3,4,5,6].map(i => <Skeleton key={i} height={48} />)}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr style={{ background: LIGHT }}>
                <th style={TH}>User</th>
                <th style={TH}>Email</th>
                <th style={TH}>Role</th>
                <th style={TH}>Status</th>
                <th style={TH}>Joined</th>
                <th style={{ ...TH, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No users found</td></tr>
              ) : paged.map(u => (
                <tr key={u.id}
                  onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                  onMouseLeave={e => e.currentTarget.style.background = WHITE}>
                  <td style={TD}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%',
                        background: `${AMBER}20`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, color: AMBER, flexShrink: 0,
                      }}>
                        {(u.full_name || u.fullName || u.username || '?')[0].toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 600 }}>{u.full_name || u.fullName || u.username || '—'}</span>
                    </div>
                  </td>
                  <td style={{ ...TD, color: MUTED }}>{u.email}</td>
                  <td style={TD}><RolePill role={u.role} /></td>
                  <td style={TD}><StatusPill active={u.is_active !== false} /></td>
                  <td style={{ ...TD, color: MUTED }}>{fmtDate(u.created_at)}</td>
                  <td style={{ ...TD, textAlign: 'right', borderBottom: `1px solid ${BORDER}` }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Btn size="sm" variant="secondary" onClick={() => setDrawerUser(u)}>
                        View
                      </Btn>
                      <Btn size="sm" variant="secondary" disabled={busy === u.id} onClick={() => toggleStatus(u)}>
                        {u.is_active !== false
                          ? <><UserX size={13} /> Suspend</>
                          : <><UserCheck size={13} /> Activate</>}
                      </Btn>
                      <Btn
                        size="sm" variant="secondary"
                        title="Force logout"
                        disabled={busy === u.id}
                        onClick={() => setLogoutModal({ open: true, id: u.id, name: u.full_name || u.fullName || u.email })}
                      >
                        <LogOut size={13} />
                      </Btn>
                      <Btn
                        size="sm" variant="danger"
                        onClick={() => setDeleteModal({ open: true, id: u.id, name: u.full_name || u.fullName || u.email })}
                      >
                        <Trash2 size={13} />
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Btn size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</Btn>
          <span style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>Page {page} of {totalPages}</span>
          <Btn size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</Btn>
        </div>
      )}

      {/* User Drawer */}
      {drawerUser && <UserDrawer user={drawerUser} onClose={() => setDrawerUser(null)} />}

      {/* Invite User Modal */}
      <Modal open={inviteModal} onClose={() => { setInviteModal(false); setInviteForm({ email: '', full_name: '', role: 'student' }); }} title="Invite User" width={460}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Inp
            label="Email Address"
            type="email"
            placeholder="user@example.com"
            value={inviteForm.email}
            onChange={e => setInviteForm(p => ({ ...p, email: e.target.value }))}
          />
          <Inp
            label="Full Name"
            type="text"
            placeholder="Jane Smith"
            value={inviteForm.full_name}
            onChange={e => setInviteForm(p => ({ ...p, full_name: e.target.value }))}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: INK, fontFamily: FONT }}>Role</label>
            <select
              value={inviteForm.role}
              onChange={e => setInviteForm(p => ({ ...p, role: e.target.value }))}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 10,
                border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 14, fontFamily: FONT,
                color: INK, background: WHITE, cursor: 'pointer', boxSizing: 'border-box',
              }}
            >
              <option value="student">Student</option>
              <option value="instructor">Instructor</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <Btn variant="secondary" onClick={() => setInviteModal(false)}>Cancel</Btn>
          <Btn variant="primary" disabled={inviteBusy || !inviteForm.email.trim()} onClick={handleInvite}>
            {inviteBusy ? 'Sending…' : 'Send Invite'}
          </Btn>
        </div>
      </Modal>

      {/* CSV Import Modal */}
      <Modal open={csvModal} onClose={() => { setCsvModal(false); setCsvText(''); setCsvResult(null); }} title="Import Users via CSV" width={500}>
        {csvResult ? (
          <div>
            <div style={{
              background: '#DCFCE7', borderRadius: 10, padding: '14px 18px',
              fontSize: 14, color: GREEN, fontFamily: FONT, fontWeight: 600, marginBottom: 16,
            }}>
              {csvResult.invited ?? csvResult.success ?? 0} invited, {csvResult.skipped ?? csvResult.failed ?? 0} skipped
            </div>
            {csvResult.errors && csvResult.errors.length > 0 && (
              <div style={{ fontSize: 12, color: MUTED, fontFamily: FONT, marginBottom: 14 }}>
                {csvResult.errors.map((e, i) => <div key={i}>• {e}</div>)}
              </div>
            )}
            <Btn variant="secondary" onClick={() => { setCsvModal(false); setCsvText(''); setCsvResult(null); }}>Close</Btn>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 13, color: MUTED, fontFamily: FONT, margin: '0 0 12px', lineHeight: 1.6 }}>
              Paste CSV data below. Format: <code style={{ background: LIGHT, padding: '1px 6px', borderRadius: 4 }}>email,full_name,role</code> — one row per line.
            </p>
            <textarea
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
              placeholder={"alice@example.com,Alice Smith,student\nbob@example.com,Bob Jones,instructor"}
              rows={8}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 10,
                border: `1.5px solid ${BORDER}`, outline: 'none',
                fontSize: 13, fontFamily: 'monospace', color: INK,
                background: WHITE, resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 12, color: MUTED2, fontFamily: FONT, marginTop: 6 }}>
              {parseCSV(csvText).length} rows parsed
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <Btn variant="secondary" onClick={() => setCsvModal(false)}>Cancel</Btn>
              <Btn variant="primary" disabled={csvBusy || !csvText.trim()} onClick={handleCSVImport}>
                {csvBusy ? 'Importing…' : 'Import'}
              </Btn>
            </div>
          </>
        )}
      </Modal>

      {/* Force-logout confirm modal */}
      <Modal open={logoutModal.open} onClose={() => setLogoutModal({ open: false, id: null, name: '' })} title="Force Logout User">
        <p style={{ fontSize: 14, color: INK, fontFamily: FONT, margin: '0 0 20px', lineHeight: 1.6 }}>
          This will immediately terminate all active sessions for <strong>{logoutModal.name}</strong>.
          They will be required to sign in again. Their account will remain active.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setLogoutModal({ open: false, id: null, name: '' })}>Cancel</Btn>
          <Btn variant="danger" disabled={!!busy} onClick={confirmForceLogout}>{busy ? 'Logging out…' : 'Force Logout'}</Btn>
        </div>
      </Modal>

      {/* Delete confirm modal */}
      <Modal open={deleteModal.open} onClose={() => setDeleteModal({ open: false, id: null, name: '' })} title="Delete User">
        <p style={{ fontSize: 14, color: INK, fontFamily: FONT, margin: '0 0 20px', lineHeight: 1.6 }}>
          Are you sure you want to permanently delete <strong>{deleteModal.name}</strong>? This action cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setDeleteModal({ open: false, id: null, name: '' })}>Cancel</Btn>
          <Btn variant="danger" disabled={!!busy} onClick={confirmDelete}>{busy ? 'Deleting…' : 'Delete'}</Btn>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
