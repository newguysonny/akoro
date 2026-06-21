import { useState, useEffect, useCallback } from 'react';
import { Search, Trash2, ShieldCheck } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton } from '../components/Primitives.jsx';
import { apiGet, apiPatch, apiDelete } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, FONT } from '../constants.js';

function Stars({ rating }) {
  return (
    <span style={{ fontSize: 14, letterSpacing: 1 }}>
      {[1,2,3,4,5].map(i => (
        <span key={i} style={{ color: i <= rating ? AMBER : MUTED2 }}>
          {i <= rating ? '★' : '☆'}
        </span>
      ))}
    </span>
  );
}

export default function ReviewsPage() {
  const [reviews, setReviews]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [reportedOnly, setReportedOnly] = useState(false);
  const [deleteModal, setDeleteModal] = useState({ open: false, id: null, label: '' });
  const [busy, setBusy]             = useState(null);
  const [toast, setToast]           = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 200 });
      if (reportedOnly) params.set('reported', 'true');
      const res = await apiGet(`/api/admin/reviews?${params}`);
      const arr = Array.isArray(res) ? res : (res?.reviews || res?.data || []);
      setReviews(arr);
    } catch (err) {
      showToast(err.message || 'Failed to load reviews', 'error');
    } finally {
      setLoading(false);
    }
  }, [reportedOnly]);

  useEffect(() => { load(); }, [load]);

  const filtered = reviews.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const course = (r.course_title || r.course?.title || '').toLowerCase();
    const user   = (r.user_name || r.user?.full_name || r.user?.email || '').toLowerCase();
    return course.includes(q) || user.includes(q);
  });

  const handleClearReports = async (id) => {
    setBusy(id);
    try {
      await apiPatch(`/api/admin/reviews/${id}/clear-reports`);
      setReviews(prev => prev.map(r => r.id === id ? { ...r, reported_count: 0, reports: 0 } : r));
      showToast('Reports cleared');
    } catch (err) {
      showToast(err.message || 'Failed to clear reports', 'error');
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async () => {
    setBusy(deleteModal.id);
    try {
      await apiDelete(`/api/admin/reviews/${deleteModal.id}`);
      setReviews(prev => prev.filter(r => r.id !== deleteModal.id));
      setDeleteModal({ open: false, id: null, label: '' });
      showToast('Review deleted');
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const fmtDate  = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const truncate = (str, n = 100) => str && str.length > n ? str.slice(0, n) + '…' : (str || '—');

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };

  const toggleChipStyle = (active) => ({
    padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
    fontFamily: FONT, fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? AMBER : 'transparent', color: active ? WHITE : MUTED,
    transition: 'all .15s',
  });

  return (
    <PageLayout title="Reviews & Moderation" subtitle={`${filtered.length} reviews`}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Filter bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} color={MUTED} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by course or user…"
              style={{
                width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10,
                border: `1.5px solid ${BORDER}`, outline: 'none',
                fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box',
              }}
            />
          </div>
          <button
            style={toggleChipStyle(reportedOnly)}
            onClick={() => setReportedOnly(p => !p)}
          >
            Show reported only
          </button>
        </div>

        {/* Table */}
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1,2,3,4,5,6].map(i => <Skeleton key={i} height={52} />)}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: LIGHT }}>
                  <th style={TH}>Course</th>
                  <th style={TH}>User</th>
                  <th style={TH}>Rating</th>
                  <th style={TH}>Comment</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Reports</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Helpful</th>
                  <th style={TH}>Date</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No reviews found</td></tr>
                ) : filtered.map(r => {
                  const reportCount = r.reported_count || r.reports || 0;
                  const rowBg = reportCount > 0 ? '#fff5f5' : WHITE;
                  return (
                    <tr key={r.id}
                      onMouseEnter={e => e.currentTarget.style.background = reportCount > 0 ? '#ffecec' : '#FAF8F5'}
                      onMouseLeave={e => e.currentTarget.style.background = rowBg}
                      style={{ background: rowBg }}>
                      <td style={{ ...TD, maxWidth: 160 }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                          {r.course_title || r.course?.title || '—'}
                        </span>
                      </td>
                      <td style={TD}>
                        <div style={{ fontWeight: 600 }}>{r.user_name || r.user?.full_name || '—'}</div>
                        <div style={{ fontSize: 11, color: MUTED }}>{r.user_email || r.user?.email || ''}</div>
                      </td>
                      <td style={TD}><Stars rating={r.rating || 0} /></td>
                      <td style={{ ...TD, maxWidth: 220, color: MUTED }}>
                        {truncate(r.comment || r.body || r.content, 100)}
                      </td>
                      <td style={{ ...TD, textAlign: 'center' }}>
                        {reportCount > 0
                          ? <span style={{ background: '#FEE2E2', color: RED, padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>{reportCount}</span>
                          : <span style={{ color: MUTED2 }}>—</span>
                        }
                      </td>
                      <td style={{ ...TD, textAlign: 'center', color: MUTED }}>
                        {(r.helpful_count || r.helpful || 0).toLocaleString()}
                      </td>
                      <td style={{ ...TD, color: MUTED, whiteSpace: 'nowrap' }}>{fmtDate(r.created_at)}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {reportCount > 0 && (
                            <Btn
                              size="sm" variant="secondary"
                              disabled={busy === r.id}
                              onClick={() => handleClearReports(r.id)}
                            >
                              <ShieldCheck size={13} />
                              Clear
                            </Btn>
                          )}
                          <Btn
                            size="sm" variant="danger"
                            disabled={busy === r.id}
                            onClick={() => setDeleteModal({ open: true, id: r.id, label: truncate(r.comment || r.body || r.content, 60) })}
                          >
                            <Trash2 size={13} />
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

      </div>

      {/* Delete confirm modal */}
      <Modal open={deleteModal.open} onClose={() => setDeleteModal({ open: false, id: null, label: '' })} title="Delete Review">
        <p style={{ fontSize: 14, color: INK, fontFamily: FONT, margin: '0 0 20px', lineHeight: 1.6 }}>
          Are you sure you want to permanently delete this review?<br />
          <em style={{ color: MUTED }}>{deleteModal.label}</em>
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setDeleteModal({ open: false, id: null, label: '' })}>Cancel</Btn>
          <Btn variant="danger" disabled={!!busy} onClick={confirmDelete}>{busy ? 'Deleting…' : 'Delete'}</Btn>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
