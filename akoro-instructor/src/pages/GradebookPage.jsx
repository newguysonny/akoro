import { useMemo, useState } from 'react';
import { Plus, ChevronLeft, ChevronRight, Scale, SlidersHorizontal } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast } from '../components/Primitives.jsx';
import {
  AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, PURPLE, BLUE, FONT,
} from '../constants.js';

/**
 * GradebookPage — the score matrix, ported from the reference design
 * (reference/gradebook.md) onto the instructor app's chrome and palette.
 *
 * The reference is a self-contained demo: seeded classes, assignments and
 * scores (hash-stable, so every learner row looks the same on every visit),
 * with edits kept in local overrides until Cancel clears them. The grading
 * MATH is the real thing and is ported verbatim:
 *
 *   · Each assignment (assessment) resolves to earned/possible points,
 *     independent of how many questions it has or what it's out of.
 *   · Per-class grading settings — every class carries its own category
 *     weights and its own aggregation method ("per-subject weighting").
 *   · Equal-weight: every assignment in a category counts the same, no
 *     matter how many points it's out of. Points-based: points are pooled
 *     within a category — a 20-point test naturally counts more than a
 *     5-point quiz.
 *   · Weights don't have to add to 100 — they scale automatically on save.
 *   · Grading scale (percentage → letter) is school-wide, not per-class.
 *
 * Everything the reference left inert stays inert here (the tab row's other
 * views, Add Assignment, Add Class) so the next round can wire them to real
 * data; the type filter and term select are live because they read cleanly
 * from local state.
 */

/* ── Seeded data (the reference's demo academy) ─────────────────────────── */
const CLASSES = [
  { id: 'algebra',  name: 'Algebra I (H)',         color: AMBER },
  { id: 'english',  name: 'English Language',      color: '#3B82F6' },
  { id: 'biology',  name: 'Biology',               color: '#10B981' },
  { id: 'geography', name: 'Geography',            color: '#0D9488' },
  { id: 'pe',       name: 'Physical & Health Ed.', color: '#F59E0B' },
  { id: 'reading',  name: 'Reading',               color: '#8B5CF6' },
  { id: 'social',   name: 'Social Studies',        color: '#EF4444' },
];

const ASSIGNMENT_TEMPLATE = [
  { key: 'prequiz',   name: 'Pre-Quiz',   type: 'Quiz',      due: 'Sep 10', points: 10,  letter: false },
  { key: 'classwork', name: 'Class Work', type: 'Classwork', due: 'Sep 12', points: null, letter: true },
  { key: 'homework',  name: 'Homework',   type: 'Homework',  due: 'Sep 15', points: 10,  letter: false },
  { key: 'popquiz',   name: 'Pop Quiz',   type: 'Quiz',      due: 'Sep 22', points: 20,  letter: false },
  { key: 'worksheet', name: 'Worksheet',  type: 'Homework',  due: 'Sep 29', points: 15,  letter: false },
];
const NAME_OVERRIDES = {
  biology:   { worksheet: 'Lab Report' },
  pe:        { worksheet: 'Fitness Test', popquiz: 'Skills Check' },
  geography: { worksheet: 'Map Assignment' },
  reading:   { worksheet: 'Book Report' },
};

const STUDENTS = [
  'Amara JSS1-2', 'Chidi Okafor', 'Ngozi Eze', 'Tunde Bello',
  'Fatima Ibrahim', 'Emeka Nwosu', 'Blessing Adeyemi', 'Ibrahim Musa', 'Grace Okonkwo',
];
const LETTERS = ['A', 'A', 'B', 'B', 'C', 'D'];
const LETTER_PCT = { A: 95, B: 85, C: 75, D: 65, F: 50 };

const INITIAL_CATEGORY_TYPES = [
  { type: 'Quiz',      color: BLUE },
  { type: 'Classwork', color: PURPLE },
  { type: 'Homework',  color: '#F59E0B' },
  { type: 'Test',      color: RED },
];
/* Distinct hues for teacher-added categories, cycled. */
const CATEGORY_PALETTE = ['#0D9488', '#8B5CF6', '#EC4899', '#059669', '#0891B2', '#D97706', '#DC2626', '#4F46E5'];

const INITIAL_SCALE = [
  { grade: 'A', min: 90, color: GREEN },
  { grade: 'B', min: 80, color: BLUE },
  { grade: 'C', min: 70, color: '#F59E0B' },
  { grade: 'D', min: 60, color: '#F97316' },
  { grade: 'F', min: 0,  color: RED },
];

const TERMS = ['1st Term', '2nd Term', '3rd Term'];
const TYPE_FILTERS = ['All Types', 'Quiz', 'Classwork', 'Homework', 'Test'];
const RANGES = ['Sep 8 – Oct 3', 'Oct 6 – Oct 31', 'Nov 3 – Nov 28', 'Dec 1 – Dec 12'];
const TABS = ['Overall', 'By Assignment', 'By Student', 'Assignments', 'Final Grades by Student', 'Final Grades by Class'];

/* ── Grading math (ported verbatim from the reference) ──────────────────── */

/* Stable pseudo-scores so the seeded matrix looks identical every visit. */
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h * 31) + str.charCodeAt(i)) >>> 0; }
  return h;
}
function assignmentsFor(classId) {
  const over = NAME_OVERRIDES[classId] || {};
  return ASSIGNMENT_TEMPLATE.map((a) => (over[a.key] ? { ...a, name: over[a.key] } : a));
}
function baseValue(classId, student, a) {
  const h = hash(classId + student + a.key);
  if (a.letter) return LETTERS[h % LETTERS.length];
  const pct = 0.6 + (h % 40) / 100; // 60%–99%
  return Math.round(a.points * pct * 10) / 10;
}
function getValue(overrides, classId, student, a) {
  const o = overrides[classId] && overrides[classId][student] && overrides[classId][student][a.key];
  return o !== undefined ? o : baseValue(classId, student, a);
}

/* Each assessment resolves to earned/possible points, independent of how
   many questions it has or what it's out of. */
function pointsFor(a, value) {
  if (a.letter) return { earned: LETTER_PCT[value] ?? 75, possible: 100 };
  return { earned: Number(value) || 0, possible: a.points };
}
function pctFor(a, value) {
  const p = pointsFor(a, value);
  return p.possible ? (p.earned / p.possible) * 100 : 0;
}

function sortedScale(scale) { return [...scale].sort((a, b) => b.min - a.min); }
function bandForPct(scale, pct) {
  const s = sortedScale(scale);
  return s.find((b) => pct >= b.min) || s[s.length - 1];
}

/* Weighted final for one student: category percentages (equal-weight or
   points-pooled) combined with the class's category weights. Weights that
   don't total 100 are scaled by the total of the categories PRESENT for
   that student, so an untested category doesn't drag the grade down. */
function finalFor({ classId, student, assignments, settings, scale, overrides }) {
  const byType = {};
  assignments.forEach((a) => {
    (byType[a.type] = byType[a.type] || []).push({ a, value: getValue(overrides, classId, student, a) });
  });

  const presentTypes = Object.keys(byType);
  const totalWeight = presentTypes.reduce((sum, t) => sum + (settings.weights[t] || 0), 0) || 1;

  const avg = presentTypes.reduce((sum, t) => {
    const items = byType[t];
    let typePct;
    if (settings.aggregation === 'points') {
      const earned = items.reduce((s, it) => s + pointsFor(it.a, it.value).earned, 0);
      const possible = items.reduce((s, it) => s + pointsFor(it.a, it.value).possible, 0);
      typePct = possible ? (earned / possible) * 100 : 0;
    } else {
      typePct = items.reduce((s, it) => s + pctFor(it.a, it.value), 0) / items.length;
    }
    return sum + typePct * ((settings.weights[t] || 0) / totalWeight);
  }, 0);

  const rounded = Math.round(avg * 10) / 10;
  return { pct: rounded, band: bandForPct(scale, rounded) };
}

/* Default per-class settings: split 100 evenly across the current categories. */
function defaultSettings(categories) {
  const weights = {};
  const even = Math.round(100 / categories.length);
  categories.forEach((c) => { weights[c.type] = even; });
  return { weights, aggregation: 'equal' };
}

/* ── Grading System modal ───────────────────────────────────────────────── */

function GradingSystemModal({ open, onClose, className, categories, settings, onSave }) {
  /* Local drafts — Cancel discards added/removed categories too (the
     reference mutated the global list live; a Cancel that keeps your
     deletions isn't a Cancel). */
  const [draftCats, setDraftCats] = useState(categories);
  const [draftWeights, setDraftWeights] = useState(settings.weights);
  const [aggregation, setAggregation] = useState(settings.aggregation);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [applyAll, setApplyAll] = useState(false);

  // Re-seed the drafts each time the modal opens for a (possibly different)
  // class. useEffect would flash one render of stale values; keying the modal
  // by open-ness in the parent would remount it — simplest is to track the
  // seed identity ourselves.
  const [seededFor, setSeededFor] = useState(null);
  if (open && seededFor !== className) {
    setSeededFor(className);
    setDraftCats(categories);
    setDraftWeights(settings.weights);
    setAggregation(settings.aggregation);
    setNewCategoryName('');
    setApplyAll(false);
  }

  const nextCategoryColor = (list) => CATEGORY_PALETTE[list.length % CATEGORY_PALETTE.length];

  const addCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return;
    if (draftCats.some((c) => c.type.toLowerCase() === name.toLowerCase())) return;
    // New category starts at 0% until the teacher gives it weight.
    setDraftCats([...draftCats, { type: name, color: nextCategoryColor(draftCats) }]);
    setDraftWeights((w) => ({ ...w, [name]: 0 }));
    setNewCategoryName('');
  };
  const removeCategory = (type) => {
    if (draftCats.length <= 1) return;
    setDraftCats(draftCats.filter((c) => c.type !== type));
    setDraftWeights(({ [type]: _drop, ...rest }) => rest);
  };

  const total = draftCats.reduce((s, c) => s + (Number(draftWeights[c.type]) || 0), 0);

  const save = () => {
    const raw = {};
    draftCats.forEach((c) => { raw[c.type] = Math.max(0, Number(draftWeights[c.type]) || 0); });
    let sum = Object.values(raw).reduce((s, v) => s + v, 0);
    if (sum <= 0) {
      const even = Math.round(100 / draftCats.length);
      draftCats.forEach((c) => { raw[c.type] = even; });
      sum = even * draftCats.length;
    }
    // Scales whatever was entered to total 100.
    const normalized = {};
    draftCats.forEach((c) => {
      normalized[c.type] = Math.round((raw[c.type] / sum) * 1000) / 10;
    });
    onSave({ categories: draftCats, weights: normalized, aggregation, applyAll });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Grading System" width={460}>
      <p style={{ fontSize: 12.5, fontWeight: 500, color: MUTED, margin: '0 0 16px' }}>
        Settings apply to <strong style={{ color: INK }}>{className}</strong> unless you choose to apply them everywhere below.
      </p>

      <p style={SECTION_LABEL}>Assessment system</p>
      {[
        { key: 'equal', title: 'Equal-weight', desc: "Every assignment in a category counts the same, no matter how many points it's out of." },
        { key: 'points', title: 'Points-based', desc: 'Points are pooled within a category — a 20-point test naturally counts more than a 5-point quiz.' },
      ].map((o) => (
        <label key={o.key} style={{
          display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 10px',
          borderRadius: 12, marginBottom: 6, background: aggregation === o.key ? `${AMBER}10` : LIGHT, cursor: 'pointer',
        }}>
          <input type="radio" name="gb-aggregation" checked={aggregation === o.key}
            onChange={() => setAggregation(o.key)} style={{ marginTop: 3, accentColor: AMBER, flexShrink: 0, cursor: 'pointer' }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{o.title}</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: MUTED2, lineHeight: 1.4 }}>{o.desc}</span>
          </span>
        </label>
      ))}

      <p style={{ ...SECTION_LABEL, marginTop: 16 }}>Category weights</p>
      {draftCats.map((c) => (
        <div key={c.type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderBottom: `1px solid ${BORDER}` }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: INK }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
            {c.type}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <input type="number" min="0" max="100" step="1" value={draftWeights[c.type] ?? 0}
              onChange={(e) => setDraftWeights((w) => ({ ...w, [c.type]: e.target.value }))}
              style={WEIGHT_INPUT} />
            <span style={{ fontSize: 12, fontWeight: 700, color: MUTED2 }}>%</span>
            <button onClick={() => removeCategory(c.type)} disabled={draftCats.length <= 1}
              aria-label={`Remove ${c.type}`} style={ICON_BTN(draftCats.length <= 1)}>
              ×
            </button>
          </span>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
          placeholder="New category — e.g. Exam, Monthly Test" maxLength={24} style={NEW_CATEGORY_INPUT} />
        <Btn variant="outline" size="sm" onClick={addCategory} style={{ flexShrink: 0 }}>
          <Plus size={12} /> Add
        </Btn>
      </div>
      <p style={{ fontSize: 10.5, fontWeight: 500, color: MUTED2, margin: '6px 0 0' }}>
        A new category only affects the grade once assignments are tagged with that type.
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>Total</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: total === 100 ? '#047857' : '#B45309' }}>{total}%</span>
      </div>
      <p style={{ fontSize: 10.5, fontWeight: 500, color: MUTED2, margin: '5px 0 0' }}>
        Doesn't need to add up to 100 — it'll scale automatically when you save.
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${BORDER}`, fontSize: 12, fontWeight: 600, color: MUTED, cursor: 'pointer' }}>
        <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} style={{ accentColor: AMBER, cursor: 'pointer' }} />
        <span>Apply to all subjects, not just this one</span>
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
const NEW_CATEGORY_INPUT = {
  flex: 1, padding: '7px 10px', borderRadius: 9, border: `1.5px dashed ${BORDER}`,
  fontFamily: FONT, fontSize: 12, fontWeight: 600, color: INK, outline: 'none',
};
const ICON_BTN = (disabled) => ({
  border: 'none', background: 'none', cursor: disabled ? 'default' : 'pointer', color: MUTED2,
  width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 6, flexShrink: 0, fontSize: 14, lineHeight: 1,
  opacity: disabled ? 0.3 : 1,
});

export default function GradebookPage() {
  const [currentClass, setCurrentClass] = useState('algebra');
  const [categoryTypes, setCategoryTypes] = useState(INITIAL_CATEGORY_TYPES);
  const [classSettings, setClassSettings] = useState({});
  const [gradeScale, setGradeScale] = useState(INITIAL_SCALE);
  const [overrides, setOverrides] = useState({});
  const [term, setTerm] = useState(TERMS[0]);
  const [typeFilter, setTypeFilter] = useState('All Types');
  const [rangeIdx, setRangeIdx] = useState(0);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message) => {
    setToast({ message });
    setTimeout(() => setToast((t) => (t?.message === message ? null : t)), 2600);
  };

  const classObj = CLASSES.find((c) => c.id === currentClass);
  const settings = classSettings[currentClass] || defaultSettings(categoryTypes);
  const assignments = useMemo(() => assignmentsFor(currentClass), [currentClass]);
  const visibleAssignments = typeFilter === 'All Types'
    ? assignments
    : assignments.filter((a) => a.type === typeFilter);

  const finals = useMemo(() => Object.fromEntries(STUDENTS.map((student) => [
    student,
    finalFor({ classId: currentClass, student, assignments, settings, scale: gradeScale, overrides }),
  ])), [currentClass, assignments, settings, gradeScale, overrides]);

  const setScore = (student, key, value) => {
    setOverrides((o) => ({
      ...o,
      [currentClass]: { ...o[currentClass], [student]: { ...o[currentClass]?.[student], [key]: value } },
    }));
  };
  const commitScore = (student, a) => {
    // Normalize what was typed once the cell blurs: numbers clamp at ≥ 0,
    // letters fall back to 'A' — the same rules the reference applied on change.
    const raw = getValue(overrides, currentClass, student, a);
    const value = a.letter ? (String(raw).toUpperCase().slice(0, 1) || 'A')
                            : String(Math.max(0, Number(raw) || 0));
    setScore(student, a.key, value);
  };

  const saveGradingSystem = ({ categories, weights, aggregation, applyAll }) => {
    setCategoryTypes(categories);
    setClassSettings((cs) => {
      if (!applyAll) return { ...cs, [currentClass]: { weights, aggregation } };
      const all = {};
      CLASSES.forEach((c) => { all[c.id] = { weights: { ...weights }, aggregation }; });
      return { ...cs, ...all };
    });
    showToast('Grading system updated');
  };

  return (
    <PageLayout title="Gradebook" subtitle={`${term} · September 8 – December 12, 2026`}>
      <style>{`
        .gb-shell{ display:flex; gap:18px; align-items:flex-start; }
        .gb-table{ width:100%; border-collapse:collapse; min-width:760px; }
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
        {/* ── Sidebar: add, filters, class rail ── */}
        <aside style={{ width: 240, flexShrink: 0, position: 'sticky', top: 0 }}>
          <Btn style={{ width: '100%', marginBottom: 16 }}><Plus size={13} /> Add Assignment</Btn>

          <div style={{ background: LIGHT, borderRadius: 14, padding: 12, marginBottom: 16, border: `1px solid ${BORDER}` }}>
            <p style={SECTION_LABEL}>Filters</p>
            <select value={term} onChange={(e) => setTerm(e.target.value)} style={FILTER_SELECT}>
              {TERMS.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ ...FILTER_SELECT, marginBottom: 0 }}>
              {TYPE_FILTERS.map((t) => <option key={t}>{t}</option>)}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <button aria-label="Previous" onClick={() => setRangeIdx((i) => Math.max(0, i - 1))} style={RANGE_BTN}>
                <ChevronLeft size={11} />
              </button>
              <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: MUTED }}>{RANGES[rangeIdx]}</span>
              <button aria-label="Next" onClick={() => setRangeIdx((i) => Math.min(RANGES.length - 1, i + 1))} style={RANGE_BTN}>
                <ChevronRight size={11} />
              </button>
            </div>
          </div>

          <p style={SECTION_LABEL}>Classes</p>
          {CLASSES.map((c) => {
            const active = c.id === currentClass;
            return (
              <button key={c.id} onClick={() => setCurrentClass(c.id)} style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 10px',
                borderRadius: 10, border: 'none', background: active ? `${AMBER}12` : 'transparent',
                fontFamily: FONT, fontSize: 12.5, fontWeight: active ? 700 : 600,
                color: active ? AMBER : MUTED, cursor: 'pointer', textAlign: 'left', marginBottom: 2,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                {c.name}
              </button>
            );
          })}
          <button style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '8px 10px', fontSize: 12,
            fontWeight: 700, color: AMBER, background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: FONT, marginTop: 4,
          }}><Plus size={12} /> Add Class</button>
        </aside>

        {/* ── Main: tabs, class header, matrix ── */}
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
                {classObj.name}
              </h1>
              <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: 0, fontFamily: FONT }}>
                {term} · September 8 – December 12, 2026
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <Btn variant="secondary" onClick={() => setOverrides((o) => ({ ...o, [currentClass]: {} }))}>Cancel</Btn>
              <Btn onClick={() => showToast('Grades saved')}>Save</Btn>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
            <Btn variant="secondary" size="sm" onClick={() => setScaleOpen(true)}>
              <Scale size={14} /> Grading Scale
            </Btn>
            <Btn variant="secondary" size="sm" onClick={() => setWeightsOpen(true)}>
              <SlidersHorizontal size={14} /> Grading System
            </Btn>
          </div>

          <div style={{ background: WHITE, borderRadius: 16, border: `1px solid ${BORDER}`, boxShadow: '0 2px 10px rgba(26,26,46,0.05)', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="gb-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Student</th>
                    <th style={{ fontSize: 10.5, fontWeight: 800, color: MUTED2, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Final</th>
                    {visibleAssignments.map((a) => (
                      <th key={a.key}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: INK }}>{a.name}</div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: MUTED2, marginTop: 2 }}>{a.type} · {a.due}</div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: MUTED2, marginTop: 1 }}>
                          {a.letter ? 'Letter grade' : `${a.points} pts`}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STUDENTS.map((student) => (
                    <tr key={student}>
                      <td>{student}</td>
                      <td>
                        {(() => {
                          const f = finals[student];
                          return (
                            <span style={{
                              display: 'inline-flex', fontSize: 12.5, fontWeight: 800, padding: '4px 12px',
                              borderRadius: 20, background: `${f.band.color}14`, color: f.band.color, fontFamily: FONT,
                            }}>
                              {f.pct} <small style={{ opacity: 0.75 }}>· {f.band.grade}</small>
                            </span>
                          );
                        })()}
                      </td>
                      {visibleAssignments.map((a) => (
                        <td key={a.key}>
                          <input
                            className="gb-score"
                            type="text"
                            value={getValue(overrides, currentClass, student, a)}
                            inputMode={a.letter ? undefined : 'decimal'}
                            onChange={(e) => setScore(student, a.key, a.letter
                              ? e.target.value.toUpperCase().slice(0, 1)
                              : e.target.value)}
                            onBlur={() => commitScore(student, a)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <GradingSystemModal
        open={weightsOpen}
        onClose={() => setWeightsOpen(false)}
        className={classObj.name}
        categories={categoryTypes}
        settings={settings}
        onSave={saveGradingSystem}
      />
      <GradingScaleModal
        open={scaleOpen}
        onClose={() => setScaleOpen(false)}
        scale={gradeScale}
        onSave={(next) => { setGradeScale(next); showToast('Grading scale updated'); }}
      />

      {toast && <Toast message={toast.message} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

const FILTER_SELECT = {
  width: '100%', padding: '7px 10px', borderRadius: 9, border: `1px solid ${BORDER}`,
  background: WHITE, fontFamily: FONT, fontSize: 12, fontWeight: 600, color: INK,
  marginBottom: 7, cursor: 'pointer', outline: 'none',
};
const RANGE_BTN = {
  width: 22, height: 22, borderRadius: 6, border: `1px solid ${BORDER}`, background: WHITE,
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  color: MUTED, flexShrink: 0, padding: 0,
};
