import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Search, Eye, Trash2, Star } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton, StatusPill } from '../components/Primitives.jsx';
import useAdminAPI from '../hooks/useAdminAPI.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../constants.js';

export default function CoursesPage() {
  const api = useAdminAPI();

  const [courses,     setCourses]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [deleteModal, setDeleteModal] = useState({ open: false, id: null, title: '' });
  const [busy,        setBusy]        = useState(false);
  const [toast,       setToast]       = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getCourses();
      const arr = Array.isArray(res) ? res : (res?.courses || res?.data || []);
      setCourses(arr);
    } catch {
      showToast('Failed to load courses', 'error');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = courses.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (c.title || '').toLowerCase().includes(q) ||
           (c.instructor_name || c.instructor?.name || '').toLowerCase().includes(q);
  });

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.deleteCourse(deleteModal.id);
      setCourses(prev => prev.filter(c => c.id !== deleteModal.id));
      setDeleteModal({ open: false, id: null, title: '' });
      showToast('Course deleted');
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };

  const statusVal = (c) => {
    const s = c.status || c.type || 'draft';
    if (s === 'live' || s === 'published') return 'live';
    if (s === 'completed') return 'completed';
    return 'draft';
  };

  return (
    <PageLayout title="Courses" subtitle={`${filtered.length} courses`}>
      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ position: 'relative', maxWidth: 380 }}>
          <Search size={15} color={MUTED} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title or instructor…"
            style={{
              width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10,
              border: `1.5px solid ${BORDER}`, outline: 'none',
              fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box',
            }}
          />
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
                <th style={TH}>Course Title</th>
                <th style={TH}>Instructor</th>
                <th style={TH}>Students</th>
                <th style={TH}>Status</th>
                <th style={TH}>Created</th>
                <th style={{ ...TH, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No courses found</td></tr>
              ) : filtered.map(c => (
                <tr key={c.id}
                  onMouseEnter={e => e.currentTarget.style.background = '#FAF8F5'}
                  onMouseLeave={e => e.currentTarget.style.background = WHITE}>
                  <td style={TD}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: 8,
                        background: `${PURPLE}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <BookOpen size={16} color={PURPLE} />
                      </div>
                      <span style={{ fontWeight: 600, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.title}
                      </span>
                    </div>
                  </td>
                  <td style={{ ...TD, color: MUTED }}>
                    {c.instructor_name || c.instructor?.full_name || c.instructor?.name || '—'}
                  </td>
                  <td style={{ ...TD, color: MUTED }}>
                    {(c.enrolled_count ?? c.students_enrolled ?? 0).toLocaleString()}
                  </td>
                  <td style={TD}><StatusPill status={statusVal(c)} /></td>
                  <td style={{ ...TD, color: MUTED }}>{fmtDate(c.created_at)}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>
                    <Btn size="sm" variant="danger"
                      onClick={() => setDeleteModal({ open: true, id: c.id, title: c.title })}>
                      <Trash2 size={13} /> Delete
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete confirm */}
      <Modal open={deleteModal.open} onClose={() => setDeleteModal({ open: false, id: null, title: '' })} title="Delete Course">
        <p style={{ fontSize: 14, color: INK, fontFamily: FONT, margin: '0 0 20px', lineHeight: 1.6 }}>
          Are you sure you want to permanently delete <strong>{deleteModal.title}</strong>? All enrolled students will lose access.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setDeleteModal({ open: false, id: null, title: '' })}>Cancel</Btn>
          <Btn variant="danger" disabled={busy} onClick={confirmDelete}>{busy ? 'Deleting…' : 'Delete Course'}</Btn>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
