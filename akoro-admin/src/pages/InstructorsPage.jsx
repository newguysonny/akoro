import { useState, useEffect, useCallback } from 'react';
import { GraduationCap, Search, CheckCircle2, XCircle, Eye, Ban } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton } from '../components/Primitives.jsx';
import useAdminAPI from '../hooks/useAdminAPI.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../constants.js';

function StatusPill({ status }) {
  const map = {
    verified:  { bg: '#DCFCE7', color: GREEN,  label: 'Verified'  },
    pending:   { bg: '#FEF3C7', color: '#D97706', label: 'Pending' },
    suspended: { bg: '#FEE2E2', color: RED,    label: 'Suspended' },
    active:    { bg: '#DCFCE7', color: GREEN,  label: 'Active'    },
  };
  const cfg = map[status] || map.pending;
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: cfg.bg, color: cfg.color, display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color, display: 'inline-block' }} />
      {cfg.label}
    </span>
  );
}

export default function InstructorsPage() {
  const api      = useAdminAPI();
  const navigate = useNavigate();

  const [instructors,   setInstructors]   = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [search,        setSearch]        = useState('');
  const [statusFilter,  setStatusFilter]  = useState('all');
  const [busy,          setBusy]          = useState(null);
  const [confirmModal,  setConfirmModal]  = useState({ open: false, type: '', id: null, name: '' });
  const [toast,         setToast]         = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getInstructors();
      const arr = Array.isArray(res) ? res : (res?.instructors || res?.data || []);
      setInstructors(arr);
    } catch {
      showToast('Failed to load instructors', 'error');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = instructors.filter(i => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      (i.full_name || i.fullName || i.username || '').toLowerCase().includes(q) ||
      (i.email || '').toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || i.status === statusFilter || i.verification_status === statusFilter;
    return matchSearch && matchStatus;
  });

  const doAction = async () => {
    const { type, id, name } = confirmModal;
    setBusy(id);
    try {
      if (type === 'verify') {
        await api.verifyInstructor(id);
        setInstructors(prev => prev.map(x => x.id === id ? { ...x, status: 'verified', verification_status: 'verified' } : x));
        showToast(`${name} verified`);
      } else {
        await api.suspendInstructor(id);
        setInstructors(prev => prev.map(x => x.id === id ? { ...x, status: 'suspended', verification_status: 'suspended' } : x));
        showToast(`${name} suspended`);
      }
    } catch (err) {
      showToast(err.message || 'Action failed', 'error');
    } finally {
      setBusy(null);
      setConfirmModal({ open: false, type: '', id: null, name: '' });
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

  const getStatus = (i) => i.status || i.verification_status || 'pending';

  return (
    <PageLayout title="Instructors" subtitle={`${filtered.length} instructors`}>
      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} color={MUTED} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            style={{
              width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10,
              border: `1.5px solid ${BORDER}`, outline: 'none',
              fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['all', 'verified', 'pending', 'suspended'].map(s => (
            <button key={s} style={CHIP(statusFilter === s)} onClick={() => setStatusFilter(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2,3,4,5].map(i => <Skeleton key={i} height={52} />)}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: LIGHT }}>
                <th style={TH}>Instructor</th>
                <th style={TH}>Email</th>
                <th style={TH}>Status</th>
                <th style={TH}>Courses</th>
                <th style={TH}>Students</th>
                <th style={TH}>Joined</th>
                <th style={{ ...TH, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No instructors found</td></tr>
              ) : filtered.map(inst => (
                <tr key={inst.id}
                  onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                  onMouseLeave={e => e.currentTarget.style.background = WHITE}>
                  <td style={TD}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%',
                        background: `${AMBER}20`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, color: AMBER, flexShrink: 0,
                      }}>
                        {(inst.full_name || inst.fullName || inst.username || '?')[0].toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 600 }}>{inst.full_name || inst.fullName || inst.username || '—'}</span>
                    </div>
                  </td>
                  <td style={{ ...TD, color: MUTED }}>{inst.email}</td>
                  <td style={TD}><StatusPill status={getStatus(inst)} /></td>
                  <td style={{ ...TD, color: MUTED }}>{inst.course_count ?? inst.courses_count ?? 0}</td>
                  <td style={{ ...TD, color: MUTED }}>{inst.student_count ?? inst.students_count ?? 0}</td>
                  <td style={{ ...TD, color: MUTED }}>{fmtDate(inst.created_at)}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {getStatus(inst) !== 'verified' && (
                        <Btn size="sm" variant="green" disabled={busy === inst.id}
                          onClick={() => setConfirmModal({ open: true, type: 'verify', id: inst.id, name: inst.full_name || inst.fullName || inst.email })}>
                          <CheckCircle2 size={13} /> Verify
                        </Btn>
                      )}
                      {getStatus(inst) !== 'suspended' && (
                        <Btn size="sm" variant="danger" disabled={busy === inst.id}
                          onClick={() => setConfirmModal({ open: true, type: 'suspend', id: inst.id, name: inst.full_name || inst.fullName || inst.email })}>
                          <Ban size={13} /> Suspend
                        </Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Confirm modal */}
      <Modal open={confirmModal.open} onClose={() => setConfirmModal({ open: false, type: '', id: null, name: '' })}
        title={confirmModal.type === 'verify' ? 'Verify Instructor' : 'Suspend Instructor'}>
        <p style={{ fontSize: 14, color: INK, fontFamily: FONT, margin: '0 0 20px', lineHeight: 1.6 }}>
          {confirmModal.type === 'verify'
            ? <>Verify <strong>{confirmModal.name}</strong> as an approved instructor on the platform?</>
            : <>Suspend <strong>{confirmModal.name}</strong>? They will lose access to instructor features.</>}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setConfirmModal({ open: false, type: '', id: null, name: '' })}>Cancel</Btn>
          <Btn variant={confirmModal.type === 'verify' ? 'green' : 'danger'} disabled={!!busy} onClick={doAction}>
            {busy ? '…' : confirmModal.type === 'verify' ? 'Verify' : 'Suspend'}
          </Btn>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
