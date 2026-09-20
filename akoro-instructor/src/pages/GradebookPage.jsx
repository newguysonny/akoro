import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Scale, SlidersHorizontal } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast } from '../components/Primitives.jsx';
import {
  AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, PURPLE, BLUE, FONT,
} from '../constants.js';
import { apiGet, apiPatch } from '../services/api.js';

/**
 * GradebookPage — the score matrix from the reference design
 * (reference/gradebook.md), wired to REAL data:
 *
 *   classes      GET /api/battle/my-classes        (the teacher's classes)
 *   assignments  GET /api/self-study               (briefs; filtered to the
 *                selected class by classroom_id)
 *   students +   GET /api/self-study/:id           (targets with each
   grades                                           learner's status + grade)
 *   publishing   PATCH /api/self-study/:id/targets/:studentId/grade
 *
 * A cell is a published grade, 0–100. The Final column combines cells by
 * assignment TYPE with per-class weights (the Grading System modal; weights
 * scale to 100 on save and only count when that type has graded work), then
 * maps to a letter with the school-wide scale (Grading Scale modal).
 *
 * Edits are local until Save publishes them (Cancel discards); Save patches
 * each edited cell and reports failures honestly.
 */

/* ── Activity types = gradebook categories ──────────────────────────────── */
const TYPES = [
  { type: 'assignment',  label: 'Assignment',  color: PURPLE },
  { type: 'project',     label: 'Project',     color: '#10B981' },
  { type: 'self_study',  label: 'Self study',  color: '#F59E0B' },
  { type: 'live_course', label: 'Live course', color: '#E11D48' },
  { type: 'multi_stage', label: 'Multi stage', color: '#3B82F6' },
];
const typeMeta = (t) => TYPES.find((x) => x.type === t) || { type: t, label: t || 'Activity', color: MUTED2 };
const RAIL_COLORS = [AMBER, '#3B82F6', '#10B981', '#0D9488', '#F59E0B', '#8B5CF6', '#EF4444', '#059669'];
const TABS = ['Overall', 'By Assignment', 'By Student', 'Assignments', 'Final Grades by Student', 'Final Grades by Class'];

const INITIAL_SCALE = [
  { grade: 'A', min: 90, color: GREEN },
  { grade: 'B', min: 80, color: BLUE },
  { grade: 'C', min: 70, color: '#F59E0B' },
  { grade: 'D', min: 60, color: '#F97316' },
  { grade: 'F', min: 0,  color: RED },
];
function sortedScale(scale) { return [...scale].sort((a, b) => b.min - a.min); }
function bandForPct(scale, pct) {
  const s = sortedScale(scale);
  return s.find((b) => pct >= b.min) || s[s.length - 1];
}

/* Default weights: split 100 evenly over the types present in this class. */
function defaultSettings(types) {
  const weights = {};
  const even = types.length ? Math.round(100 / types.length) : 0;
  types.forEach((t) => { weights[t] = even; });
  return { weights };
}

function fmtDue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* ── Grading System modal (weights per type) ────────────────────────────── */
function GradingSystemModal({ open, onClose, className, types, settings, onSave }) {
  const [draft, setDraft] = useState(settings.weights);
  const [applyAll, setApplyAll] = useState(false);
  const [seededFor, setSeededFor] = useState(null);
  if (open && seededFor !== className) {
    setSeededFor(className);
    setDraft(settings.weights);
    setApplyAll(false);
  }
  if (!open && seededFor !== null) setSeededFor(null);

  const total = types.reduce((s, t) => s + (Number(draft[t.type]) || 0), 0);

  const save = () => {
    const raw = {};
    types.forEach((t) => { raw[t.type] = Math.max(0, Number(draft[t.type]) || 0); });
    let sum = Object.values(raw).reduce((s, v) => s + v, 0);
    if (sum <= 0) {
      const even = Math.round(100 / types.length);
      types.forEach((t) => { raw[t.type] = even; });
      sum = even * types.length || 1;
    }
    const normalized = {};
    types.forEach((t) => { normalized[t.type] = Math.round((raw[t.type] / sum) * 1000) / 10; });
    onSave({ weights: normalized, applyAll });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Grading System" width={460}>
      <p style={{ fontSize: 12.5, fontWeight: 500, color: MUTED, margin: '0 0 16px' }}>
        How much each activity type counts toward the Final, for{' '}
        <strong style={{ color: INK }}>{className}</strong>.
      </p>

      <p style={SECTION_LABEL}>Type weights</p>
      {types.map((t) => (
        <div key={t.type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderBottom: `1px solid ${BORDER}` }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: INK }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
            {t.label}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <input type="number" min="0" max="100" step="1" value={draft[t.type] ?? 0}
              onChange={(e) => setDraft((w) => ({ ...w, [t.type]: e.target.value }))}
              style={WEIGHT_INPUT} />
            <span style={{ fontSize: 12, fontWeight: 700, color: MUTED2 }}>%</span>
          </span>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>Total</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: total === 100 ? '#047857' : '#B45309' }}>{total}%</span>
      </div>
      <p style={{ fontSize: 10.5, fontWeight: 500, color: MUTED2, margin: '5px 0 0' }}>
        Doesn't need to add up to 100 — it'll scale automatically when you save. A type only counts when it has graded work.
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${BORDER}`, fontSize: 12, fontWeight: 600, color: MUTED, cursor: 'pointer' }}>
        <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} style={{ accentColor: AMBER, cursor: 'pointer' }} />
        <span>Apply to all classes, not just this one</span>
      </label>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save}>Save</Btn>
      </div>
    </Modal>
  );
}

/* ── Grading Scale modal ────────────────────────────────────────────────── */
function GradingScaleModal({ open, onClose, scale, onSave }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(scale.map((b) => [b.grade, b.min])));
  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setDraft(Object.fromEntries(scale.map((b) => [b.grade, b.min])));
    setSeeded(true);
  }
  if (!open && seeded) setSeeded(false);

  const sorted = sortedScale(scale);

  const save = () => {
    const next = scale.map((b) => (
      b.grade === 'F' ? b : { ...b, min: Math.max(0, Math.min(100, Number(draft[b.grade]) || 0)) }
    ));
    onSave(next);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Grading Scale" width={460}>
      <p style={{ fontSize: 12.5, fontWeight: 500, color: MUTED, margin: '0 0 16px' }}>
        How a Final percentage maps to a letter grade — applies school-wide.
      </p>

      {sorted.map((band, i) => {
        const above = sorted[i - 1];
        const upper = above ? Math.max(band.min, (Number(draft[above.grade]) || 0) - 1) : 100;
        const floor = Number(draft[band.grade]) || 0;
        return (
          <div key={band.grade} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${BORDER}` }}>
            <span style={{
              width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12.5, fontWeight: 800, color: WHITE, background: band.color, flexShrink: 0,
            }}>{band.grade}</span>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: MUTED }}>
              {band.grade === 'F' ? `below ${draft[sorted[i - 1]?.grade] ?? 60}%` : `${floor}–${Math.min(upper, 100)}%`}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" min="0" max="100" step="1" value={draft[band.grade]}
                disabled={band.grade === 'F'}
                onChange={(e) => setDraft((d) => ({ ...d, [band.grade]: e.target.value }))}
                style={{ ...WEIGHT_INPUT, ...(band.grade === 'F' ? { background: LIGHT, color: MUTED2 } : {}) }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: MUTED2 }}>% min</span>
            </span>
          </div>
        );
      })}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save}>Save</Btn>
      </div>
    </Modal>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

const SECTION_LABEL = {
  fontSize: 11, fontWeight: 800, color: MUTED2, textTransform: 'uppercase',
  letterSpacing: '0.03em', margin: '0 0 10px',
};
const WEIGHT_INPUT = {
  width: 56, textAlign: 'right', padding: '6px 8px', borderRadius: 8,
  border: `1px solid ${BORDER}`, fontFamily: FONT, fontSize: 12.5,
  fontWeight: 700, color: INK, outline: 'none',
};
const FILTER_SELECT = {
  width: '100%', padding: '7px 10px', borderRadius: 9, border: `1px solid ${BORDER}`,
  background: WHITE, fontFamily: FONT, fontSize: 12, fontWeight: 600, color: INK,
  marginBottom: 7, cursor: 'pointer', outline: 'none',
};

export default function GradebookPage() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState(null);          // null = loading
  const [currentClass, setCurrentClass] = useState(null);
  const [assignments, setAssignments] = useState(null);  // null = loading
  const [students, setStudents] = useState([]);          // [{id, name}]
  const [grades, setGrades] = useState({});              // {aid: {sid: 0-100}}
  const [overrides, setOverrides] = useState({});        // {aid: {sid: raw}}
  const [typeFilter, setTypeFilter] = useState('all');
  const [classSettings, setClassSettings] = useState({});
  const [gradeScale, setGradeScale] = useState(INITIAL_SCALE);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3200);
  };

  /* ── data ── */
  useEffect(() => {
    let dead = false;
    apiGet('/api/battle/my-classes')
      .then((d) => { if (!dead) setClasses(d?.data ?? []); })
      .catch(() => { if (!dead) setClasses([]); });
    return () => { dead = true; };
  }, []);

  const loadClass = useCallback(async (classId) => {
    if (!classId) return;
    setAssignments(null);
    setOverrides({});
    try {
      const d = await apiGet('/api/self-study');
      const briefs = (d?.data ?? []).filter((b) => b.classroom_id === classId && b.status !== 'archived');
      const details = await Promise.all(
        briefs.map((b) => apiGet(`/api/self-study/${b.id}`).then((r) => r?.data).catch(() => null)),
      );
      const studentMap = new Map();
      const gradeMap = {};
      briefs.forEach((b, i) => {
        const targets = details[i]?.targets ?? [];
        gradeMap[b.id] = {};
        targets.forEach((t) => {
          if (!studentMap.has(t.student_id)) {
            studentMap.set(t.student_id, { id: t.student_id, name: t.full_name || t.username || 'Unknown' });
          }
          gradeMap[b.id][t.student_id] = t.grade ?? null;
        });
      });
      setAssignments(briefs);
      setStudents([...studentMap.values()].sort((a, b) => a.name.localeCompare(b.name)));
      setGrades(gradeMap);
    } catch {
      setAssignments([]);
      setStudents([]);
      setGrades({});
    }
  }, []);

  useEffect(() => { if (currentClass) loadClass(currentClass); }, [currentClass, loadClass]);

  /* ── derived ── */
  const classTypes = useMemo(() => {
    const present = [...new Set((assignments ?? []).map((a) => a.type ?? 'self_study'))];
    return present.map(typeMeta);
  }, [assignments]);

  const settings = classSettings[currentClass] || defaultSettings(classTypes.map((t) => t.type));

  const visibleAssignments = useMemo(
    () => (typeFilter === 'all' ? (assignments ?? []) : (assignments ?? []).filter((a) => (a.type ?? 'self_study') === typeFilter)),
    [assignments, typeFilter],
  );

  /* The effective grade for a cell: local edit first, published grade second. */
  const cellValue = (aid, sid) => {
    const o = overrides[aid]?.[sid];
    if (o !== undefined && o !== '') return Math.max(0, Math.min(100, Number(o) || 0));
    return grades[aid]?.[sid] ?? null;
  };
  const dirtyCount = useMemo(
    () => Object.values(overrides).reduce((n, row) => n + Object.keys(row ?? {}).length, 0),
    [overrides],
  );

  /* Final: weighted mean of graded cells grouped by type; only types with
     graded work count, their weights rescaled to the ones present. */
  const finalOf = (sid) => {
    const byType = {};
    (assignments ?? []).forEach((a) => {
      const g = cellValue(a.id, sid);
      if (g != null) (byType[a.type ?? 'self_study'] = byType[a.type ?? 'self_study'] || []).push(g);
    });
    const present = Object.keys(byType);
    if (!present.length) return null;
    // Types with weight 0 don't count; if EVERY graded type was zeroed the
    // final falls back to an equal-weight average so it never reads as 0.
    const totalWeight = present.reduce((s, t) => s + (settings.weights[t] || 0), 0);
    const wOf = (t) => (totalWeight > 0 ? (settings.weights[t] || 0) / totalWeight : 1 / present.length);
    const avg = present.reduce((sum, t) => {
      const mean = byType[t].reduce((s, g) => s + g, 0) / byType[t].length;
      return sum + mean * wOf(t);
    }, 0);
    const pct = Math.round(avg * 10) / 10;
    return { pct, band: bandForPct(gradeScale, pct) };
  };

  /* ── actions ── */
  const setCell = (aid, sid, value) => {
    setOverrides((o) => ({ ...o, [aid]: { ...o[aid], [sid]: value } }));
  };

  const save = async () => {
    const edits = [];
    Object.entries(overrides).forEach(([aid, row]) => {
      Object.entries(row ?? {}).forEach(([sid, raw]) => {
        const n = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
        edits.push({ aid, sid, grade: n });
      });
    });
    if (!edits.length) return;
    setSaving(true);
    const results = await Promise.allSettled(edits.map((e) =>
      apiPatch(`/api/self-study/${e.aid}/targets/${e.sid}/grade`, { grade: e.grade })));
    const failed = results.filter((r) => r.status === 'rejected').length;
    // Apply what the server accepted from the local draft.
    setGrades((g) => {
      const next = { ...g };
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          const { aid, sid, grade } = edits[i];
          next[aid] = { ...(next[aid] ?? {}), [sid]: grade };
        }
      });
      return next;
    });
    setOverrides({});
    setSaving(false);
    if (failed) showToast(`Published ${edits.length - failed} of ${edits.length} grades — ${failed} failed. Try saving again.`, 'error');
    else showToast(`Grades saved — ${edits.length} published`);
  };

  const saveGradingSystem = ({ weights, applyAll }) => {
    setClassSettings((cs) => {
      if (!applyAll) return { ...cs, [currentClass]: { weights } };
      const all = {};
      (classes ?? []).forEach((c) => { all[c.id] = { weights: { ...weights } }; });
      return { ...cs, ...all };
    });
    showToast('Grading system updated');
  };

  const classObj = (classes ?? []).find((c) => c.id === currentClass);

  return (
    <PageLayout title="Gradebook" subtitle={classObj ? classObj.name : 'Scores, weights and final grades'}>
      <style>{`
        .gb-shell{ display:flex; gap:18px; align-items:flex-start; }
        .gb-table{ width:100%; border-collapse:collapse; min-width:640px; }
        .gb-table th, .gb-table td{ padding:9px 14px; text-align:center; font-size:12.5px; white-space:nowrap; border-bottom:1px solid ${BORDER}; font-family:${FONT}; }
        .gb-table thead th{ vertical-align:top; padding-top:12px; padding-bottom:12px; border-bottom:1px solid ${BORDER}; background:${LIGHT}; }
        .gb-table thead th:first-child, .gb-table tbody td:first-child{ text-align:left; position:sticky; left:0; background:${LIGHT}; z-index:2; }
        .gb-table tbody td:first-child{ background:${WHITE}; font-weight:700; color:${INK}; }
        .gb-table tbody tr:hover td{ background:${LIGHT}; }
        .gb-score{ width:52px; text-align:center; font-family:${FONT}; font-size:12.5px; font-weight:700; color:${INK}; border:1px solid transparent; border-radius:8px; padding:4px 2px; background:transparent; outline:none; }
        .gb-score:hover{ border-color:${BORDER}; }
        .gb-score:focus{ border-color:${AMBER}; background:${AMBER}08; }
        @media (max-width: 1080px){ .gb-sidebar{ display:none; } }
      `}</style>

      <div className="gb-shell">
        {/* ── Sidebar: filters + class rail ── */}
        <aside style={{ width: 240, flexShrink: 0, position: 'sticky', top: 0 }}>
          <Btn style={{ width: '100%', marginBottom: 16 }} onClick={() => navigate('/activities')}>
            <Plus size={13} /> Add Assignment
          </Btn>

          <div style={{ background: LIGHT, borderRadius: 14, padding: 12, marginBottom: 16, border: `1px solid ${BORDER}` }}>
            <p style={SECTION_LABEL}>Filters</p>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ ...FILTER_SELECT, marginBottom: 0 }}>
              <option value="all">All Types</option>
              {classTypes.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
          </div>

          <p style={SECTION_LABEL}>Classes</p>
          {classes === null ? (
            [1, 2, 3].map((i) => <div key={i} style={{ height: 34, borderRadius: 10, background: LIGHT, marginBottom: 4 }} />)
          ) : classes.map((c, i) => {
            const active = c.id === currentClass;
            return (
              <button key={c.id} onClick={() => setCurrentClass(c.id)} style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 10px',
                borderRadius: 10, border: 'none', background: active ? `${AMBER}12` : 'transparent',
                fontFamily: FONT, fontSize: 12.5, fontWeight: active ? 700 : 600,
                color: active ? AMBER : MUTED, cursor: 'pointer', textAlign: 'left', marginBottom: 2,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: RAIL_COLORS[i % RAIL_COLORS.length], flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: MUTED2, flexShrink: 0 }}>{c.student_count ?? ''}</span>
              </button>
            );
          })}
        </aside>

        {/* ── Main: tabs, header, matrix ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${BORDER}`, marginBottom: 18, overflowX: 'auto' }}>
            {TABS.map((t, i) => (
              <button key={t} style={{
                background: 'none', border: 'none', fontFamily: FONT, fontSize: 12.5,
                fontWeight: i === 0 ? 700 : 600, color: i === 0 ? AMBER : MUTED2,
                padding: '0 0 10px', borderBottom: `2px solid ${i === 0 ? AMBER : 'transparent'}`,
                marginBottom: -1, cursor: 'default', whiteSpace: 'nowrap',
              }}>{t}</button>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <h1 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 3px', color: INK, fontFamily: FONT, letterSpacing: '-0.01em' }}>
                {classObj ? classObj.name : 'Pick a class'}
              </h1>
              <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: 0, fontFamily: FONT }}>
                {classObj
                  ? `${students.length} learner${students.length === 1 ? '' : 's'} with assigned work · ${assignments?.length ?? 0} activit${(assignments?.length ?? 0) === 1 ? 'y' : 'ies'}`
                  : 'Choose a class from the rail to see its gradebook'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <Btn variant="secondary" disabled={!dirtyCount || saving}
                onClick={() => setOverrides({})}>Cancel{dirtyCount ? ` (${dirtyCount})` : ''}</Btn>
              <Btn disabled={!dirtyCount || saving} onClick={save}>
                {saving ? 'Saving…' : dirtyCount ? `Save ${dirtyCount} grade${dirtyCount === 1 ? '' : 's'}` : 'Save'}
              </Btn>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
            <Btn variant="secondary" size="sm" onClick={() => setScaleOpen(true)}>
              <Scale size={14} /> Grading Scale
            </Btn>
            <Btn variant="secondary" size="sm" disabled={!classTypes.length} onClick={() => setWeightsOpen(true)}>
              <SlidersHorizontal size={14} /> Grading System
            </Btn>
          </div>

          {/* ── matrix ── */}
          {classes === null || assignments === null ? (
            <div style={{ background: WHITE, borderRadius: 16, border: `1px solid ${BORDER}`, padding: 20 }}>
              {[1, 2, 3, 4].map((i) => <div key={i} style={{ height: 38, borderRadius: 10, background: LIGHT, marginBottom: 8, opacity: 0.6 }} />)}
            </div>
          ) : !classObj ? (
            <EmptyState icon="📚" title="Pick a class" sub="Your classes appear in the rail on the left." />
          ) : !assignments.length ? (
            <EmptyState icon="📭" title="No activities in this class yet"
              sub="Assign work from the activities workbench and it lands here."
              action={<Btn size="sm" onClick={() => navigate('/activities')}><Plus size={13} /> Add Assignment</Btn>} />
          ) : !students.length ? (
            <EmptyState icon="🧑‍🎓" title="No learners assigned yet"
              sub="This class's activities have no learners on them — assign them from the workbench." />
          ) : (
            <div style={{ background: WHITE, borderRadius: 16, border: `1px solid ${BORDER}`, boxShadow: '0 2px 10px rgba(26,26,46,0.05)', overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="gb-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Student</th>
                      <th style={{ fontSize: 10.5, fontWeight: 800, color: MUTED2, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Final</th>
                      {visibleAssignments.map((a) => {
                        const tm = typeMeta(a.type ?? 'self_study');
                        return (
                          <th key={a.id}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: INK, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: tm.color, marginTop: 2 }}>{tm.label} · {fmtDue(a.due_at) || 'no due date'}</div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: MUTED2, marginTop: 1 }}>0–100</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => {
                      const f = finalOf(s.id);
                      return (
                        <tr key={s.id}>
                          <td>{s.name}</td>
                          <td>
                            {f ? (
                              <span style={{
                                display: 'inline-flex', fontSize: 12.5, fontWeight: 800, padding: '4px 12px',
                                borderRadius: 20, background: `${f.band.color}14`, color: f.band.color, fontFamily: FONT,
                              }}>
                                {f.pct} <small style={{ opacity: 0.75 }}>· {f.band.grade}</small>
                              </span>
                            ) : (
                              <span style={{ fontSize: 11, fontWeight: 600, color: MUTED2, fontFamily: FONT }}>—</span>
                            )}
                          </td>
                          {visibleAssignments.map((a) => {
                            const o = overrides[a.id]?.[s.id];
                            const server = grades[a.id]?.[s.id] ?? null;
                            const edited = o !== undefined;
                            const shown = edited ? o : (server ?? '');
                            return (
                              <td key={a.id}>
                                <input
                                  className="gb-score"
                                  type="text"
                                  inputMode="decimal"
                                  value={shown}
                                  placeholder="—"
                                  onChange={(e) => setCell(a.id, s.id, e.target.value)}
                                  onBlur={(e) => {
                                    const v = e.target.value;
                                    if (v === '') { setOverrides((ov) => { const row = { ...(ov[a.id] ?? {}) }; delete row[s.id]; return { ...ov, [a.id]: row }; }); return; }
                                    setCell(a.id, s.id, String(Math.max(0, Math.min(100, Math.round(Number(v) || 0)))));
                                  }}
                                  style={edited ? { borderColor: `${AMBER}88`, background: `${AMBER}08` } : undefined}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <GradingSystemModal
        open={weightsOpen}
        onClose={() => setWeightsOpen(false)}
        className={classObj?.name ?? ''}
        types={classTypes}
        settings={settings}
        onSave={saveGradingSystem}
      />
      <GradingScaleModal
        open={scaleOpen}
        onClose={() => setScaleOpen(false)}
        scale={gradeScale}
        onSave={(next) => { setGradeScale(next); showToast('Grading scale updated'); }}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

function EmptyState({ icon, title, sub, action }) {
  return (
    <div style={{ background: WHITE, borderRadius: 16, border: `1px solid ${BORDER}`, padding: '48px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div>
      <p style={{ fontSize: 14, fontWeight: 800, color: INK, margin: '0 0 4px', fontFamily: FONT }}>{title}</p>
      <p style={{ fontSize: 12.5, fontWeight: 500, color: MUTED, margin: 0, fontFamily: FONT }}>{sub}</p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}
