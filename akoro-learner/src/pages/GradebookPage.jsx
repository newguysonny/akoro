/*
 * GradebookPage — the lowerEd report card, structured exactly like the
 * StudentGradebook reference (subject dropdown with mini averages, type
 * filter, date sort, three summary cards, one row per assignment) wearing
 * Akoro's branding, under the Activities/Notifications-style header.
 *
 * Marks are honest states until grading lands: ✓ submitted · X missed (past
 * due, still open) · – pending; a published teacher grade is the number, and
 * the subject averages are computed from those published grades only.
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ArrowUpDown, X } from 'lucide-react';
import { fetchMyGradebook, TYPE_LABEL, TYPE_DOT } from '../services/gradebookApi.js';
import { BRAND, GREEN, RED } from '../constants.js';
import { AppShell } from '../components/AppShell.jsx';
import { APP_HOME } from '../config/target.js';

/* Work types — the reference's type filter, with Akoro's activity kinds. */
const TYPES = [
  { key: 'all',         label: 'All types' },
  { key: 'self_study',  label: 'Self study' },
  { key: 'assignment',  label: 'Assignment' },
  { key: 'project',     label: 'Project' },
  { key: 'multi_stage', label: 'Journey' },
];

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/* A subject's average from its published numeric grades — never invented. */
function averageOf(rows) {
  const nums = rows.map(r => r.mark).filter(v => typeof v === 'number');
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/* Score badge — identical bands to the reference, Akoro tokens. */
function badgeStyle(val) {
  if (val === 'X')       return { color: RED,     background: 'rgba(239,68,68,.10)' };
  if (val === '✓')       return { color: GREEN,   background: 'rgba(16,185,129,.10)' };
  if (typeof val === 'number') {
    if (val >= 80) return { color: GREEN,    background: 'rgba(16,185,129,.10)' };
    if (val >= 60) return { color: '#B45309', background: 'rgba(232,163,61,.14)' };
    return { color: RED, background: 'rgba(239,68,68,.10)' };
  }
  return { color: 'var(--ak-text-muted)', background: 'var(--ak-bg)' };
}

const N = "'Nunito',sans-serif";

export default function GradebookPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSubjectId, setActiveSubjectId] = useState('all');
  const [type, setType] = useState('all');
  const [sortDir, setSortDir] = useState('asc');
  const [subjectMenuOpen, setSubjectMenuOpen] = useState(false);
  const subjectMenuRef = useRef(null);

  useEffect(() => {
    fetchMyGradebook().then(setData).finally(() => setLoading(false));
  }, []);

  /* Close the subject menu on outside click / Escape — as the reference does. */
  useEffect(() => {
    function onClickOutside(e) {
      if (subjectMenuRef.current && !subjectMenuRef.current.contains(e.target)) setSubjectMenuOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setSubjectMenuOpen(false); }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const subjects = data?.subjects ?? [];
  const totals   = data?.totals ?? { submitted: 0, missed: 0, total: 0 };

  const allRows = useMemo(() => subjects.flatMap(s => s.assignments), [subjects]);
  const scopedRows = activeSubjectId === 'all'
    ? allRows
    : (subjects.find(s => s.id === activeSubjectId)?.assignments ?? []);

  const visibleAssignments = useMemo(() => {
    let list = scopedRows;
    if (type !== 'all') list = list.filter(a => a.type === type);
    return [...list].sort((a, b) => sortDir === 'asc'
      ? String(a.date || '9999').localeCompare(String(b.date || '9999'))
      : String(b.date || '9999').localeCompare(String(a.date || '9999')));
  }, [scopedRows, type, sortDir]);

  const activeSubject = subjects.find(s => s.id === activeSubjectId) ?? null;
  const avg       = averageOf(scopedRows);
  const completed = scopedRows.filter(r => r.mark === '✓' || typeof r.mark === 'number').length;
  const missed    = scopedRows.filter(r => r.mark === 'X').length;
  const rowCount  = activeSubjectId === 'all' ? totals.total : scopedRows.length;

  const subjectMiniAvg = (s) => averageOf(s.assignments);
  const activeName = activeSubjectId === 'all' ? 'All subjects' : (activeSubject?.name ?? 'Subjects');

  return (
    <AppShell>
    <div style={{ width: '100%', height: '100%', fontFamily: N, background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── HEADER — the Notifications/Activities page style ── */}
      <div style={{ background: 'var(--ak-surface)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--ak-border)', padding: '14px 18px', zIndex: 100, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => navigate(APP_HOME)}
              style={{ background: '#F0EBFF', border: '1px solid #DDD3FF', borderRadius: 100, width: 34, height: 34, cursor: 'pointer', color: BRAND, fontSize: 16, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ‹
            </button>
            <div>
              <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>Gradebook</p>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0 }}>
                {loading ? 'Loading…' : totals.total ? `${totals.submitted} of ${totals.total} submitted` : 'No work assigned yet'}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#F0FFF8', border: '1px solid #BBF7D0', borderRadius: 100, padding: '6px 13px' }}
            title="Submitted work across your subjects">
            <span style={{ fontSize: 14, lineHeight: 1 }}>✅</span>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#15803D', lineHeight: 1 }}>
              {loading ? '–' : `${totals.total ? Math.round((totals.submitted / totals.total) * 100) : 0}%`}
            </span>
          </div>
        </div>
      </div>

      {/* ── MAIN — the reference gradebook, Akoro-branded ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 80px' }}>
        <div style={{ background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 16, overflow: 'hidden' }}>

          {/* Subject title + dropdown */}
          <div style={{ padding: '16px 16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ position: 'relative' }} ref={subjectMenuRef}>
                <button onClick={() => setSubjectMenuOpen(v => !v)} aria-haspopup="listbox" aria-expanded={subjectMenuOpen}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: N }}>
                  <span style={{ fontSize: 22, fontWeight: 900, color: 'var(--ak-text)' }}>{loading ? 'Gradebook' : activeName}</span>
                  <ChevronDown size={19} color="var(--ak-text-muted)"
                    style={{ transform: subjectMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                </button>

                {subjectMenuOpen && (
                  <div role="listbox"
                    style={{ position: 'absolute', left: 0, top: '100%', marginTop: 8, width: 260, background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 12, boxShadow: '0 10px 30px rgba(33,31,53,.16)', zIndex: 60, padding: '4px 0', maxHeight: 300, overflowY: 'auto' }}>
                    {[{ id: 'all', name: 'All subjects', assignments: allRows }, ...subjects].map(s => {
                      const mini = s.id === 'all' ? averageOf(allRows) : subjectMiniAvg(s);
                      const active = s.id === activeSubjectId;
                      return (
                        <button key={s.id} role="option" aria-selected={active}
                          onClick={() => { setActiveSubjectId(s.id); setSubjectMenuOpen(false); }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 14px', background: active ? '#F1ECFF' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: N }}>
                          <span style={{ fontSize: 13, fontWeight: active ? 800 : 600, color: active ? BRAND : 'var(--ak-text)' }}>{s.name}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: mini == null ? 'var(--ak-text-muted)' : GREEN }}>
                            {mini == null ? '–' : `${mini}%`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--ak-text-muted)', margin: '4px 0 12px', fontWeight: 600 }}>
              {loading ? '—' : `${subjects.length} subject${subjects.length === 1 ? '' : 's'} · ${rowCount} ${rowCount === 1 ? 'activity' : 'activities'}`}
            </p>

            {/* Type filter + date sort */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <select value={type} onChange={e => setType(e.target.value)}
                style={{ fontSize: 12.5, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', borderRadius: 10, padding: '8px 10px', cursor: 'pointer', fontFamily: N, fontWeight: 700 }}>
                {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontWeight: 700, fontFamily: N }}>
                <ArrowUpDown size={13} /> Date {sortDir === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>

          {/* Summary cards — average / completed / missed */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: '14px 16px' }}>
            <div style={{ background: 'var(--ak-bg)', border: '1px solid var(--ak-border)', borderRadius: 12, padding: '11px 12px' }}>
              <div style={{ fontSize: 9.5, letterSpacing: .5, textTransform: 'uppercase', color: 'var(--ak-text-muted)', fontWeight: 800, marginBottom: 4 }}>Average</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: GREEN, display: 'flex', alignItems: 'baseline', gap: 3 }}>
                {avg ?? '–'}<span style={{ fontSize: 11, color: 'var(--ak-text-muted)', fontWeight: 700 }}>%</span>
              </div>
              <div style={{ width: '100%', height: 5, background: 'var(--ak-border)', borderRadius: 999, overflow: 'hidden', marginTop: 6 }}>
                <div style={{ height: '100%', background: GREEN, borderRadius: 999, width: `${avg ?? 0}%`, transition: 'width .3s' }} />
              </div>
            </div>
            <div style={{ background: 'var(--ak-bg)', border: '1px solid var(--ak-border)', borderRadius: 12, padding: '11px 12px' }}>
              <div style={{ fontSize: 9.5, letterSpacing: .5, textTransform: 'uppercase', color: 'var(--ak-text-muted)', fontWeight: 800, marginBottom: 4 }}>Submitted</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--ak-text)', display: 'flex', alignItems: 'baseline', gap: 3 }}>
                {loading ? '–' : completed}<span style={{ fontSize: 11, color: 'var(--ak-text-muted)', fontWeight: 700 }}>of {rowCount}</span>
              </div>
            </div>
            <div style={{ background: 'var(--ak-bg)', border: '1px solid var(--ak-border)', borderRadius: 12, padding: '11px 12px' }}>
              <div style={{ fontSize: 9.5, letterSpacing: .5, textTransform: 'uppercase', color: 'var(--ak-text-muted)', fontWeight: 800, marginBottom: 4 }}>Missed</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: missed ? RED : 'var(--ak-text-muted)', display: 'flex', alignItems: 'baseline', gap: 3 }}>
                {loading ? '–' : missed}<span style={{ fontSize: 11, color: 'var(--ak-text-muted)', fontWeight: 700 }}>work</span>
              </div>
            </div>
          </div>

          {/* Assignment list */}
          <div style={{ padding: '0 16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, letterSpacing: .5, textTransform: 'uppercase', color: 'var(--ak-text-muted)', fontWeight: 800, borderTop: '1px solid var(--ak-border)', padding: '9px 2px' }}>
              <span>Assignment</span><span>Score</span>
            </div>

            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' }}>
                {[1, 2, 3].map(i => <div key={i} style={{ height: 44, borderRadius: 10, background: 'var(--ak-border)', opacity: .4 }} />)}
              </div>
            ) : visibleAssignments.length === 0 ? (
              <div style={{ padding: '36px 4px', textAlign: 'center', fontSize: 13, color: 'var(--ak-text-muted)', fontWeight: 700 }}>
                Nothing here yet — assigned work shows up subject by subject.
              </div>
            ) : (
              visibleAssignments.map(a => {
                const date = fmtDate(a.date);
                const overdue = a.mark === 'X';
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderBottom: '1px solid var(--ak-border)', padding: '11px 2px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: TYPE_DOT[a.type] || 'var(--ak-text-muted)', flexShrink: 0 }} />
                        {TYPE_LABEL[a.type] || a.type}
                        {date && !overdue && <span>· {date}</span>}
                        {overdue && <span style={{ color: RED, fontWeight: 900 }}>· was due {date}</span>}
                      </div>
                    </div>
                    <span style={{ ...badgeStyle(a.mark), fontSize: 12, fontWeight: 900, borderRadius: 8, padding: '6px 0', width: 52, textAlign: 'center', flexShrink: 0 }}>
                      {a.mark}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
    </AppShell>
  );
}
