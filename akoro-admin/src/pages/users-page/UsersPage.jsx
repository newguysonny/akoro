/**
 * UsersPage — composes the components from ./parts.jsx.
 */
import { useState, useEffect, useCallback } from 'react';
import { Users, Search, UserX, UserCheck, Trash2, LogOut, UserPlus, Upload, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton, Inp } from '../../components/Primitives.jsx';
import useAdminAPI from '../../hooks/useAdminAPI.js';
import { apiGet, apiPost } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';

import { RolePill, StatusPill, UserDrawer, PAGE_SIZE } from './parts.jsx';

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

  // Create account
  const [inviteModal,  setInviteModal]  = useState(false);
  const [inviteForm,   setInviteForm]   = useState({ email: '', full_name: '', role: 'student', password: '' });
  const [inviteBusy,   setInviteBusy]   = useState(false);
  const [created,      setCreated]      = useState(null);

  const resetCreate = () => { setInviteModal(false); setCreated(null); setInviteForm({ email: '', full_name: '', role: 'student', password: '' }); };

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
    if (!inviteForm.email.trim() || !inviteForm.full_name.trim()) return;
    setInviteBusy(true);
    try {
      const body = { ...inviteForm };
      if (!body.password.trim()) delete body.password; // blank → server generates one
      const res = await apiPost('/api/admin/users/create', body);
      const data = res?.data ?? res;
      setCreated(data);          // show credentials + login link
      showToast('Account created');
      load();
    } catch (err) {
      showToast(err.message || 'Failed to create account', 'error');
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
        <UserPlus size={13} /> Create Account
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
          {['all', 'student', 'instructor', 'school_admin'].map(r => (
            <button key={r} style={CHIP(roleFilter === r)} onClick={() => { setRoleFilter(r); setPage(1); }}>
              {r === 'all' ? 'All' : r === 'student' ? 'Learners' : r === 'instructor' ? 'Instructors' : 'Schools'}
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

      {/* Create Account Modal */}
      <Modal open={inviteModal} onClose={resetCreate} title={created ? 'Account Created' : 'Create Account'} width={460}>
        {created ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: MUTED, fontFamily: FONT, margin: 0, lineHeight: 1.6 }}>
              <strong style={{ color: INK }}>{created.full_name || created.email}</strong> can now sign in.
              A welcome email with the sign-in link has been sent.
              {created.tempPassword ? ' Share the temporary password below — it won’t be shown again.' : ''}
            </p>
            <div style={{ background: LIGHT, borderRadius: 10, padding: '14px 16px', fontFamily: FONT, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div><span style={{ color: MUTED }}>Email:</span> <strong>{created.email}</strong></div>
              {created.tempPassword && (
                <div><span style={{ color: MUTED }}>Temp password:</span>{' '}
                  <code style={{ background: WHITE, padding: '2px 8px', borderRadius: 6, border: `1px solid ${BORDER}`, fontWeight: 700 }}>{created.tempPassword}</code>
                </div>
              )}
              {created.loginUrl && (
                <div><span style={{ color: MUTED }}>Sign-in:</span> <a href={created.loginUrl} target="_blank" rel="noreferrer" style={{ color: AMBER }}>{created.loginUrl}</a></div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
              {created.tempPassword && (
                <Btn variant="secondary" onClick={() => { navigator.clipboard?.writeText(`${created.email} / ${created.tempPassword}`); showToast('Credentials copied'); }}>Copy credentials</Btn>
              )}
              <Btn variant="primary" onClick={resetCreate}>Done</Btn>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Inp
                label="Full Name"
                type="text"
                placeholder="Jane Smith"
                value={inviteForm.full_name}
                onChange={e => setInviteForm(p => ({ ...p, full_name: e.target.value }))}
              />
              <Inp
                label="Email Address"
                type="email"
                placeholder="user@example.com"
                value={inviteForm.email}
                onChange={e => setInviteForm(p => ({ ...p, email: e.target.value }))}
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
                  <option value="student">Learner</option>
                  <option value="instructor">Instructor</option>
                  <option value="school_admin">School</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <Inp
                label="Password (optional — leave blank to auto-generate)"
                type="text"
                placeholder="Auto-generated if left blank"
                value={inviteForm.password}
                onChange={e => setInviteForm(p => ({ ...p, password: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <Btn variant="secondary" onClick={resetCreate}>Cancel</Btn>
              <Btn variant="primary" disabled={inviteBusy || !inviteForm.email.trim() || !inviteForm.full_name.trim()} onClick={handleInvite}>
                {inviteBusy ? 'Creating…' : 'Create Account'}
              </Btn>
            </div>
          </>
        )}
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

