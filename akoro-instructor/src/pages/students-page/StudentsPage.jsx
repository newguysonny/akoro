/**
 * StudentsPage — composes the components from ./parts.jsx.
 */
import { useState, useEffect, useRef } from 'react';
import {
  Search, Plus, X, User, Mail, Calendar, BookOpen, TrendingUp,
  Trash2, ChevronRight, Copy, Check, Upload, Link2, UserPlus, Eye, Download,
} from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { PageLayout } from '../../components/Layout.jsx';
import { Btn, Modal, Inp, StatusPill, Toast } from '../../components/Primitives.jsx';
import { useStudentsAPI } from '../../hooks/useStudentsAPI.js';
import { useCoursesAPI }  from '../../hooks/useCoursesAPI.js';
import {
  AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, RED, FONT,
} from '../../constants.js';

/* ── Enrol Modal — tabs: Manual | Invite Link | Bulk CSV ─────────────── */
import { EnrolModal } from './parts.jsx';
import JoinRequests from './JoinRequests.jsx';
import { confirmDialog } from '../../components/ConfirmHost.jsx';

const PAGE_SIZE = 12;
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function downloadCsv(rows, filename) {
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

export default function StudentsPage() {
  const { getStudents, removeStudent } = useStudentsAPI();
  const { getCourses } = useCoursesAPI();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const openProfile = (s) => navigate(`/mgmt/students/${s.id || s.enrollmentId}`, { state: { student: s } });

  const [students, setStudents] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [courses,  setCourses]  = useState([]);
  const [search,   setSearch]   = useState('');
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(searchParams.get('add') === '1');
  const [toast,    setToast]    = useState(null);
  const [checked,  setChecked]  = useState({});   // bulk-select map (rowId → bool)
  const [page,     setPage]     = useState(1);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // School-dashboard table styling.
  const th = { textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED, letterSpacing: .4, whiteSpace: 'nowrap' };
  const td = { padding: '11px 14px', fontSize: 13, color: INK, borderTop: `1px solid ${BORDER}`, whiteSpace: 'nowrap' };
  const iconBtn = (color) => ({ width: 30, height: 30, borderRadius: 7, border: 'none', background: `${color}15`, color, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });
  const toolBtn = (color) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 8, border: `1px solid ${color}44`, background: `${color}0C`, color, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT });
  const pageBtn = (disabled) => ({ padding: '6px 12px', borderRadius: 8, border: `1px solid ${BORDER}`, background: WHITE, color: disabled ? MUTED : INK, fontSize: 12.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: disabled ? 0.5 : 1 });

  const load = async () => {
    try {
      const [studRes, courseRes] = await Promise.allSettled([getStudents(), getCourses()]);
      const data = studRes.status === 'fulfilled' ? (studRes.value?.data || []) : [];
      setStudents(data);
      setFiltered(data);
      if (courseRes.status === 'fulfilled') setCourses(courseRes.value?.data || []);
    } catch {
      setStudents([]); setFiltered([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const q = search.trim().toLowerCase();
    setFiltered(!q ? students : students.filter(s =>
      (s.fullName || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q)
    ));
    setPage(1); setChecked({});
  }, [search, students]);

  const rowId = (s) => s.id || s.enrollmentId;
  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows    = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const checkedIds  = Object.keys(checked).filter(id => checked[id]);
  const allOnPage   = pageRows.length > 0 && pageRows.every(s => checked[rowId(s)]);
  const toggleAll   = (on) => setChecked(prev => { const n = { ...prev }; pageRows.forEach(s => { n[rowId(s)] = on; }); return n; });

  const exportCsv = () => {
    const src = checkedIds.length ? filtered.filter(s => checked[rowId(s)]) : filtered;
    downloadCsv([['Name', 'Email', 'Progress', 'Status'], ...src.map(s => [s.fullName || '', s.email || '', `${s.progress || 0}%`, s.status || ''])], 'students.csv');
  };
  const bulkRemove = async () => {
    const targets = filtered.filter(s => checked[rowId(s)]);
    if (!targets.length || !await confirmDialog(`Remove ${targets.length} student${targets.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    for (const s of targets) await handleRemove(s.enrollmentId);
    setChecked({});
  };

  const handleDone = () => {
    showToast('Students updated!');
    window.dispatchEvent(new Event('akoro:notifications-changed'));
    load();
  };

  const handleRemove = async (enrollmentId) => {
    await removeStudent(enrollmentId).catch(console.warn);
    setStudents(s => s.filter(x => x.enrollmentId !== enrollmentId));
    window.dispatchEvent(new Event('akoro:notifications-changed'));
    showToast('Student removed.', 'info');
  };

  return (
    <PageLayout
      title="Students"
      subtitle={`${loading ? '…' : students.length} enrolled learners`}
      action={
        <Btn size="sm" onClick={() => setModal(true)}>
          <Plus size={14} /> Add Student
        </Btn>
      }
    >
      {/* Pending learner join requests */}
      <JoinRequests onChanged={load} />

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 20, maxWidth: 420 }}>
        <Search size={16} color={MUTED} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          style={{
            width: '100%', padding: '10px 14px 10px 40px', borderRadius: 12,
            border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 14,
            fontFamily: FONT, color: INK, background: WHITE,
          }}
        />
      </div>

      {/* Bulk toolbar */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {checkedIds.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: `${AMBER}12`, border: `1px solid ${AMBER}44`, borderRadius: 10, padding: '6px 12px' }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: AMBER, fontFamily: FONT }}>{checkedIds.length} selected</span>
              <button onClick={bulkRemove} style={toolBtn(RED)}><Trash2 size={13} /> Remove</button>
            </div>
          )}
          <button onClick={exportCsv} style={{ ...toolBtn(GREEN), marginLeft: 'auto' }}>
            <Download size={14} /> Export CSV{checkedIds.length ? ` (${checkedIds.length})` : ''}
          </button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{ height: 66, borderRadius: 12, background: BORDER, opacity: .4, animation: 'shimmer 1.4s infinite linear', backgroundSize: '200% 100%', backgroundImage: `linear-gradient(90deg, ${BORDER} 0%, ${WHITE} 50%, ${BORDER} 100%)` }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: WHITE, border: `1px dashed ${BORDER}`, borderRadius: 16, padding: '48px', textAlign: 'center' }}>
          <User size={32} color={MUTED} style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 16px' }}>
            {search ? 'No students match your search' : 'No students enrolled yet'}
          </p>
          {!search && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Btn onClick={() => setModal(true)}><UserPlus size={14} /> Manual Entry</Btn>
              <Btn variant="secondary" onClick={() => setModal(true)}><Mail size={14} /> Send Invite</Btn>
              <Btn variant="secondary" onClick={() => setModal(true)}><Upload size={14} /> Import CSV</Btn>
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
            <thead><tr>
              <th style={{ ...th, width: 34 }}><input type="checkbox" checked={allOnPage} onChange={e => toggleAll(e.target.checked)} /></th>
              <th style={th}>STUDENT</th>
              <th style={th}>EMAIL</th>
              <th style={th}>PROGRESS</th>
              <th style={th}>STATUS</th>
              <th style={{ ...th, textAlign: 'right' }}>ACTIONS</th>
            </tr></thead>
            <tbody>
              {pageRows.map(s => (
                <tr key={s.id || s.enrollmentId}>
                  <td style={td}><input type="checkbox" checked={!!checked[rowId(s)]} onChange={e => setChecked(p => ({ ...p, [rowId(s)]: e.target.checked }))} /></td>
                  <td style={{ ...td, whiteSpace: 'normal' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: `linear-gradient(135deg, ${AMBER}88, ${PURPLE}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: WHITE }}>
                        {(s.fullName || s.email || '?')[0].toUpperCase()}
                      </div>
                      <button onClick={() => openProfile(s)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, fontWeight: 700, color: BLUE, textAlign: 'left', fontSize: 13 }}>
                        {s.fullName || 'Unknown'}
                      </button>
                    </div>
                  </td>
                  <td style={{ ...td, color: MUTED }}>{s.email || '—'}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 99, background: LIGHT, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${s.progress || 0}%`, background: AMBER, borderRadius: 99 }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{s.progress || 0}%</span>
                    </div>
                  </td>
                  <td style={td}><StatusPill status={s.status} /></td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => openProfile(s)} title="View profile" style={iconBtn(GREEN)}><Eye size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > PAGE_SIZE && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: 12.5, color: MUTED, fontFamily: FONT }}>
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={pageBtn(page <= 1)}>Prev</button>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT }}>{page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={pageBtn(page >= totalPages)}>Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      <EnrolModal
        open={modal}
        onClose={() => setModal(false)}
        onDone={handleDone}
        courses={courses}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

