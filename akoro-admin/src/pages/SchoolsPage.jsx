import { useState, useEffect, useCallback } from 'react';
import { Search, CheckCircle2, XCircle, Building2, Globe } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton } from '../components/Primitives.jsx';
import useAdminAPI from '../hooks/useAdminAPI.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';

function StatusPill({ status }) {
  const map = {
    verified: { bg: '#DCFCE7', color: GREEN,    label: 'Verified' },
    pending:  { bg: '#FEF3C7', color: '#D97706', label: 'Pending'  },
    rejected: { bg: '#FEE2E2', color: RED,      label: 'Rejected' },
  };
  const cfg = map[status] || map.pending;
  return (
    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: cfg.bg, color: cfg.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color, display: 'inline-block' }} />
      {cfg.label}
    </span>
  );
}

export default function SchoolsPage() {
  const api = useAdminAPI();

  const [schools,      setSchools]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('all');   // show every school by default; pending queue is one click away
  const [busy,         setBusy]         = useState(null);
  const [confirmModal, setConfirmModal] = useState({ open: false, type: '', id: null, name: '' });
  const [toast,        setToast]        = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getSchools();
      setSchools(Array.isArray(res) ? res : (res?.data || []));
    } catch {
      showToast('Failed to load schools', 'error');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = schools.filter(s => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      (s.name || '').toLowerCase().includes(q) ||
      (s.admin?.email || '').toLowerCase().includes(q) ||
      (s.website || '').toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || (s.verification_status || 'pending') === statusFilter;
    return matchSearch && matchStatus;
  });

  const doAction = async () => {
    const { type, id, name } = confirmModal;
    setBusy(id);
    try {
      if (type === 'verify') {
        await api.verifySchool(id);
        setSchools(prev => prev.map(x => x.id === id ? { ...x, verification_status: 'verified' } : x));
        showToast(`${name} verified`);
      } else {
        await api.rejectSchool(id);
        setSchools(prev => prev.map(x => x.id === id ? { ...x, verification_status: 'rejected' } : x));
        showToast(`${name} rejected`);
      }
    } catch (err) {
      showToast(err.message || 'Action failed', 'error');
    } finally {
      setBusy(null);
      setConfirmModal({ open: false, type: '', id: null, name: '' });
    }
  };

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const statusOf = (s) => s.verification_status || 'pending';

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };
  const CHIP = (active) => ({
    padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
    fontFamily: FONT, fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? AMBER : 'transparent', color: active ? WHITE : MUTED, transition: 'all .15s',
  });

  const pendingCount = schools.filter(s => statusOf(s) === 'pending').length;

  return (
    <PageLayout title="Schools" subtitle={pendingCount ? `${pendingCount} awaiting approval` : `${filtered.length} schools`}>
      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} color={MUTED} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email or website…"
            style={{ width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10, border: `1.5px solid ${BORDER}`,
              outline: 'none', fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['pending', 'verified', 'rejected', 'all'].map(s => (
            <button key={s} style={CHIP(statusFilter === s)} onClick={() => setStatusFilter(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', overflowX: 'auto' }}>
        {loading ? (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2,3,4,5].map(i => <Skeleton key={i} height={52} />)}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr style={{ background: LIGHT }}>
                <th style={TH}>School</th>
                <th style={TH}>Admin</th>
                <th style={TH}>Website</th>
                <th style={TH}>Status</th>
                <th style={TH}>Signed up</th>
                <th style={{ ...TH, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No schools found</td></tr>
              ) : filtered.map(s => (
                <tr key={s.id}
                  onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                  onMouseLeave={e => e.currentTarget.style.background = WHITE}>
                  <td style={TD}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {s.logo_url
                        ? <img src={s.logo_url} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                        : <div style={{ width: 34, height: 34, borderRadius: 8, background: `${BLUE}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Building2 size={17} color={BLUE} /></div>}
                      <span style={{ fontWeight: 600 }}>{s.name || '—'}</span>
                    </div>
                  </td>
                  <td style={{ ...TD, color: MUTED }}>
                    {s.admin?.full_name || '—'}<br />
                    <span style={{ fontSize: 11.5 }}>{s.admin?.email || ''}</span>
                  </td>
                  <td style={{ ...TD, color: MUTED }}>
                    {s.website
                      ? <a href={s.website} target="_blank" rel="noreferrer" style={{ color: AMBER, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Globe size={12} /> Visit</a>
                      : <span style={{ color: '#B45309', fontWeight: 600 }}>No website</span>}
                  </td>
                  <td style={TD}><StatusPill status={statusOf(s)} /></td>
                  <td style={{ ...TD, color: MUTED }}>{fmtDate(s.created_at)}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {statusOf(s) !== 'verified' && (
                        <Btn size="sm" variant="green" disabled={busy === s.id}
                          onClick={() => setConfirmModal({ open: true, type: 'verify', id: s.id, name: s.name })}>
                          <CheckCircle2 size={13} /> Verify
                        </Btn>
                      )}
                      {statusOf(s) !== 'rejected' && (
                        <Btn size="sm" variant="danger" disabled={busy === s.id}
                          onClick={() => setConfirmModal({ open: true, type: 'reject', id: s.id, name: s.name })}>
                          <XCircle size={13} /> Reject
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
        title={confirmModal.type === 'verify' ? 'Verify School' : 'Reject School'}>
        <p style={{ fontSize: 14, color: INK, fontFamily: FONT, margin: '0 0 20px', lineHeight: 1.6 }}>
          {confirmModal.type === 'verify'
            ? <>Verify <strong>{confirmModal.name}</strong> as an approved school on the platform?</>
            : <>Reject <strong>{confirmModal.name}</strong>? They stay in the list as rejected and can be verified later.</>}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setConfirmModal({ open: false, type: '', id: null, name: '' })}>Cancel</Btn>
          <Btn variant={confirmModal.type === 'verify' ? 'green' : 'danger'} disabled={!!busy} onClick={doAction}>
            {busy ? '…' : confirmModal.type === 'verify' ? 'Verify' : 'Reject'}
          </Btn>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
