import { useState, useEffect, useCallback } from 'react';
import { Users, Search, Filter, UserX, UserCheck, Trash2, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton, Inp } from '../components/Primitives.jsx';
import useAdminAPI from '../hooks/useAdminAPI.js';
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

const PAGE_SIZE = 20;

export default function UsersPage() {
  const api      = useAdminAPI();
  const navigate = useNavigate();

  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [page,       setPage]       = useState(1);
  const [deleteModal, setDeleteModal] = useState({ open: false, id: null, name: '' });
  const [busy,       setBusy]       = useState(false);
  const [toast,      setToast]      = useState(null);

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

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };

  const CHIP = (active) => ({
    padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
    fontFamily: FONT, fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? AMBER : 'transparent', color: active ? WHITE : MUTED,
    transition: 'all .15s',
  });

  return (
    <PageLayout title="Users" subtitle={`${filtered.length} total users`}>
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
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
        {loading ? (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2,3,4,5,6].map(i => <Skeleton key={i} height={48} />)}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                      <Btn size="sm" variant="secondary" disabled={busy === u.id} onClick={() => toggleStatus(u)}>
                        {u.is_active !== false
                          ? <><UserX size={13} /> Suspend</>
                          : <><UserCheck size={13} /> Activate</>}
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
