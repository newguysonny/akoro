/**
 * CoursesPage — composes the components from ./parts.jsx.
 */
import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Search, Trash2, ChevronDown, ChevronUp, DollarSign } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton, Inp } from '../../components/Primitives.jsx';
import useAdminAPI from '../../hooks/useAdminAPI.js';
import { apiGet, apiPatch } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';

import { StatusPill, CourseAccordion, STATUS_FILTERS } from './parts.jsx';

export default function CoursesPage() {
  const api = useAdminAPI();

  const [courses,       setCourses]       = useState([]);
  const [categories,    setCategories]    = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [search,        setSearch]        = useState('');
  const [statusFilter,  setStatusFilter]  = useState('all');
  const [categoryFilter,setCategoryFilter]= useState('all');
  const [expandedRow,   setExpandedRow]   = useState(null);
  const [deleteModal,   setDeleteModal]   = useState({ open: false, id: null, title: '' });
  const [pricingModal,  setPricingModal]  = useState({ open: false, id: null, title: '', price: '' });
  const [priceBusy,     setPriceBusy]     = useState(false);
  const [busy,          setBusy]          = useState(false);
  const [toast,         setToast]         = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const [res, catRes] = await Promise.allSettled([
        api.getCourses(params.toString() ? Object.fromEntries(params) : undefined),
        apiGet('/api/admin/courses/categories'),
      ]);
      if (res.status === 'fulfilled') {
        const arr = Array.isArray(res.value) ? res.value : (res.value?.courses || res.value?.data || []);
        setCourses(arr);
      }
      if (catRes.status === 'fulfilled') {
        const cats = Array.isArray(catRes.value) ? catRes.value : (catRes.value?.categories || catRes.value?.data || []);
        setCategories(cats);
      }
    } catch {
      showToast('Failed to load courses', 'error');
    } finally {
      setLoading(false);
    }
  }, [api, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = courses.filter(c => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchTitle = (c.title || '').toLowerCase().includes(q);
      const matchInstructor = (c.instructor_name || c.instructor?.full_name || c.instructor?.name || '').toLowerCase().includes(q);
      if (!matchTitle && !matchInstructor) return false;
    }
    if (categoryFilter !== 'all') {
      const cat = c.category || c.category_name || c.category_id;
      if (String(cat) !== String(categoryFilter)) return false;
    }
    return true;
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

  const savePricing = async () => {
    if (!pricingModal.price && pricingModal.price !== 0) return;
    setPriceBusy(true);
    try {
      await apiPatch(`/api/admin/courses/${pricingModal.id}`, { price: Number(pricingModal.price) });
      setCourses(prev => prev.map(c => c.id === pricingModal.id ? { ...c, price: Number(pricingModal.price) } : c));
      setPricingModal({ open: false, id: null, title: '', price: '' });
      showToast('Price updated');
    } catch (err) {
      showToast(err.message || 'Failed to update price', 'error');
    } finally {
      setPriceBusy(false);
    }
  };

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const statusVal = (c) => {
    const s = c.status || c.type || 'draft';
    if (s === 'live' || s === 'published') return 'published';
    if (s === 'archived') return 'archived';
    return 'draft';
  };

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };

  const CHIP = (active) => ({
    padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
    fontFamily: FONT, fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? AMBER : 'transparent', color: active ? WHITE : MUTED,
    transition: 'all .15s',
  });

  return (
    <PageLayout title="Courses" subtitle={`${filtered.length} courses`}>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 380 }}>
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

        {/* Status filter chips */}
        <div style={{ display: 'flex', gap: 6 }}>
          {STATUS_FILTERS.map(s => (
            <button key={s} style={CHIP(statusFilter === s)} onClick={() => setStatusFilter(s)}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
          <button style={CHIP(categoryFilter === 'all')} onClick={() => setCategoryFilter('all')}>All Categories</button>
          {categories.map(cat => {
            const catId = String(cat.id || cat.slug || cat.name);
            const catLabel = cat.name || cat.label || catId;
            return (
              <button key={catId} style={CHIP(categoryFilter === catId)} onClick={() => setCategoryFilter(catId)}>
                {catLabel}
              </button>
            );
          })}
        </div>
      )}

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
                <th style={TH}>Course Title</th>
                <th style={TH}>Instructor</th>
                <th style={TH}>Students</th>
                <th style={TH}>Price</th>
                <th style={TH}>Status</th>
                <th style={TH}>Created</th>
                <th style={{ ...TH, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none' }}>No courses found</td></tr>
              ) : filtered.map(c => (
                <>
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
                        <span style={{ fontWeight: 600, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                    <td style={{ ...TD, fontWeight: 600 }}>
                      {c.price != null ? `₦${Number(c.price).toLocaleString('en-NG')}` : '—'}
                    </td>
                    <td style={TD}><StatusPill status={statusVal(c)} /></td>
                    <td style={{ ...TD, color: MUTED }}>{fmtDate(c.created_at)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Btn size="sm" variant="secondary"
                          onClick={() => setExpandedRow(expandedRow === c.id ? null : c.id)}>
                          {expandedRow === c.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />} View
                        </Btn>
                        <Btn size="sm" variant="secondary"
                          onClick={() => setPricingModal({ open: true, id: c.id, title: c.title, price: c.price ?? '' })}>
                          <DollarSign size={13} /> Pricing
                        </Btn>
                        <Btn size="sm" variant="danger"
                          onClick={() => setDeleteModal({ open: true, id: c.id, title: c.title })}>
                          <Trash2 size={13} />
                        </Btn>
                      </div>
                    </td>
                  </tr>
                  {expandedRow === c.id && (
                    <tr key={`${c.id}-accordion`}>
                      <td colSpan={7} style={{ padding: 0, borderBottom: `1px solid ${BORDER}` }}>
                        <CourseAccordion courseId={c.id} onClose={() => setExpandedRow(null)} />
                      </td>
                    </tr>
                  )}
                </>
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

      {/* Edit pricing modal */}
      <Modal open={pricingModal.open} onClose={() => setPricingModal({ open: false, id: null, title: '', price: '' })} title="Edit Pricing" width={400}>
        <p style={{ fontSize: 13, color: MUTED, fontFamily: FONT, margin: '0 0 16px' }}>
          Set the price for <strong style={{ color: INK }}>{pricingModal.title}</strong>
        </p>
        <Inp
          label="Price (₦)"
          type="number"
          min="0"
          step="100"
          placeholder="e.g. 5000"
          value={pricingModal.price}
          onChange={e => setPricingModal(prev => ({ ...prev, price: e.target.value }))}
        />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <Btn variant="secondary" onClick={() => setPricingModal({ open: false, id: null, title: '', price: '' })}>Cancel</Btn>
          <Btn variant="primary" disabled={priceBusy} onClick={savePricing}>{priceBusy ? 'Saving…' : 'Save Price'}</Btn>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

