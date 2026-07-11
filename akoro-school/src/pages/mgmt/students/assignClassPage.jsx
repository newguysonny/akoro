/**
 * Student Information — bulk Assign to Class.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Users, UserCheck, UserX, Home, Tags, ShieldAlert, Loader2, Save, ClipboardCheck,
  Eye, Pencil, Trash2, UserPlus, Search, ArrowLeft, Phone, Mail, MapPin, Droplet,
  Cake, CreditCard, ShieldCheck, CircleDot, X, Copy, Printer, Columns, Image,
  FileUp, Upload, Sheet, Download, CheckSquare, FileText,
  FolderOpen, Key, HeartPulse, Bus, Bed, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, RefreshCw,
  ClipboardList, ThumbsUp, ThumbsDown, Plus,
} from 'lucide-react';
import { PageLayout } from '../../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../../constants.js';
import { BASE, fullName, studentOpts, STATUS_PILL, STUDENT_FIELDS, STUDENT_COLUMNS, STUDENT_SEARCH, CLASS_FILTER, naira, STATUS_OPTS, InfoRow, GridInfo, InfoGrid, SectionCard, Ring, statPill, FEE_STATUS_COLOR, ModalShell } from './shared.jsx';

/* ── Assign to Class (bulk — includes students with no class yet) ──── */
export function AssignClassPage() {
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [filterClass, setFilterClass] = useState('__null__'); // default: unassigned
  const [toClass, setToClass] = useState('');
  const [toSection, setToSection] = useState('');
  const [students, setStudents] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
  }, []);

  const load = () => {
    const cls = filterClass ? `&class_id=${filterClass}` : '';
    apiGet(`${BASE}/students?status=active${cls}`).then((r) => {
      setStudents(r.data || []);
      setSelected({});
    }).catch(() => setStudents([]));
  };
  useEffect(load, [filterClass]);

  const chosen = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const allChecked = students?.length && chosen.length === students.length;

  const assign = async () => {
    if (!toClass) return showToast('Pick a target class');
    if (!chosen.length) return showToast('Select at least one student');
    setBusy(true);
    try {
      const res = await apiPost(`${BASE}/students/assign-class`, { to_class_id: toClass, section_id: toSection || undefined, student_ids: chosen });
      showToast(`Assigned ${res.assigned} student${res.assigned === 1 ? '' : 's'} ✓`);
      load();
    } catch (e) { showToast(e.message || 'Assignment failed'); }
    finally { setBusy(false); }
  };

  const disabled = busy || !chosen.length || !toClass;
  return (
    <PageLayout title="Assign to Class" subtitle="Bulk-place students into a class — including students without one">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18, alignItems: 'center' }}>
        <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} style={{ ...inputStyle, width: 190, cursor: 'pointer' }}>
          <option value="__null__">Unassigned students</option>
          <option value="">All students</option>
          {classes.map((c) => <option key={c.id} value={c.id}>In {c.name}</option>)}
        </select>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: MUTED2, fontFamily: FONT }}>→ assign to</span>
        <select value={toClass} onChange={(e) => { setToClass(e.target.value); setToSection(''); }} style={{ ...inputStyle, width: 170, cursor: 'pointer' }}>
          <option value="">Target class…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={toSection} onChange={(e) => setToSection(e.target.value)} style={{ ...inputStyle, width: 170, cursor: 'pointer' }}>
          <option value="">Section (optional)</option>
          {sections.filter((s) => s.class_id === toClass).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={assign} disabled={disabled} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 9, border: 'none', background: disabled ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: disabled ? '#9CA3AF' : WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : null} Assign {chosen.length ? `(${chosen.length})` : ''}
        </button>
      </div>

      {students && (
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          {students.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT }}>
              {filterClass === '__null__' ? 'No unassigned students — everyone has a class. 🎉' : 'No active students matched.'}
            </div>
          ) : (<>
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer', fontFamily: FONT, background: LIGHT }}>
              <input type="checkbox" checked={!!allChecked} onChange={(e) => setSelected(e.target.checked ? Object.fromEntries(students.map((s) => [s.id, true])) : {})} style={{ width: 15, height: 15, accentColor: AMBER }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: MUTED }}>Select all ({students.length})</span>
            </label>
            {students.map((s) => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer', fontFamily: FONT }}>
                <input type="checkbox" checked={!!selected[s.id]} onChange={(e) => setSelected((p) => ({ ...p, [s.id]: e.target.checked }))} style={{ width: 15, height: 15, accentColor: AMBER }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{fullName(s)}</span>
                <span style={{ fontSize: 11, color: MUTED2 }}>{s.admission_no}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: s.class_name ? BLUE : MUTED2 }}>{s.class_name || 'No class'}</span>
              </label>
            ))}
          </>)}
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}
