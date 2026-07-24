/**
 * Student Information — Student Profile tab panels.
 * Each tab self-fetches its slice of data; composed by StudentProfilePage.
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

function FeesTab({ studentId, showToast }) {
  const [data, setData] = useState(null);
  const [openGroups, setOpenGroups] = useState({});
  useEffect(() => { apiGet(`${BASE}/students/${studentId}/fees`).then((r) => { setData(r.data); setOpenGroups(Object.fromEntries((r.data.groups || []).map((g, i) => [i, true]))); }).catch(() => showToast('Could not load fees')); }, [studentId]);
  if (!data) return <SectionCard title="Fees" color={BLUE}><Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /></SectionCard>;

  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 800, color: MUTED2 };
  const td = { padding: '8px 10px', fontSize: 12.5, color: INK, borderTop: `1px solid ${BORDER}` };
  const toggle = (i) => setOpenGroups((p) => ({ ...p, [i]: !p[i] }));

  return (
    <SectionCard title="Fees" color={BLUE}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <Ring percent={data.percentCollected} label="Collected" color={GREEN} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1, minWidth: 260 }}>
          {statPill('Assigned', naira(data.assigned), BLUE)}
          {statPill('Collected', naira(data.collected), GREEN)}
          {statPill('Concession', naira(data.concession), AMBER)}
          {statPill('Fine', naira(data.fine), PURPLE)}
          {statPill('Balance', naira(data.balance), RED)}
        </div>
      </div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUTED, fontFamily: FONT, marginBottom: 5 }}>
          <span>Payment Progress</span><span>{data.percentCollected}% Complete</span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: BORDER, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${data.percentCollected}%`, background: GREEN, borderRadius: 999 }} />
        </div>
      </div>

      {data.groups.length === 0 ? <p style={{ fontSize: 12.5, color: MUTED2 }}>No fees assigned yet.</p> : data.groups.map((g, i) => (
        <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
          <button onClick={() => toggle(i)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: LIGHT, border: 'none', cursor: 'pointer', fontFamily: FONT, textAlign: 'left' }}>
            {openGroups[i] ? <ChevronUp size={14} color={MUTED2} /> : <ChevronDown size={14} color={MUTED2} />}
            <span style={{ fontSize: 12.5, fontWeight: 800, color: INK, flex: 1 }}>{g.title}</span>
            {g.unpaidCount > 0 && <span style={{ padding: '2px 9px', borderRadius: 999, background: `${RED}15`, color: RED, fontSize: 10.5, fontWeight: 800 }}>{g.unpaidCount} Unpaid</span>}
            <span style={{ fontSize: 11.5, color: MUTED2 }}>Total: {naira(g.total)} · Due: {naira(g.due)}</span>
          </button>
          {openGroups[i] && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Fee Type</th><th style={th}>Due Date</th><th style={th}>Amount</th><th style={th}>Paid</th><th style={th}>Due</th><th style={th}>Status</th></tr></thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{r.fee_type_name}</td><td style={td}>{r.due_date || '—'}</td><td style={td}>{naira(r.amount)}</td>
                    <td style={{ ...td, color: GREEN }}>{naira(r.paid)}</td><td style={{ ...td, color: r.due > 0 ? RED : GREEN }}>{naira(r.due)}</td>
                    <td style={td}><span style={{ padding: '2px 9px', borderRadius: 999, background: `${FEE_STATUS_COLOR[r.status]}15`, color: FEE_STATUS_COLOR[r.status], fontSize: 10.5, fontWeight: 800, textTransform: 'capitalize' }}>{r.status}</span></td>
                  </tr>
                ))}
                <tr><td style={{ ...td, fontWeight: 800 }}>Sub-Total ({g.rows.length} items)</td><td style={td} /><td style={{ ...td, fontWeight: 800 }}>{naira(g.total)}</td><td style={td} /><td style={{ ...td, fontWeight: 800 }}>{naira(g.due)}</td><td style={td} /></tr>
              </tbody>
            </table>
          )}
        </div>
      ))}
    </SectionCard>
  );
}

/* ── Documents tab ────────────────────────────────────────────────────────── */
function DocumentsTab({ studentId, showToast }) {
  const [docs, setDocs] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiGet(`${BASE}/student-documents?student_id=${studentId}`).then((r) => setDocs(r.data || [])).catch(() => setDocs([])), [studentId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      const r = await fetch(`${API}${BASE}/students/${studentId}/documents/upload`, { method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'school' }, body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      showToast('Uploaded ✓'); load();
    } catch (e) { showToast(e.message || 'Upload failed'); }
    finally { setBusy(false); }
  };
  const remove = async (d) => { if (!window.confirm(`Delete "${d.title}"?`)) return; try { await apiDelete(`${BASE}/student-documents/${d.id}`); load(); } catch (e) { showToast(e.message); } };

  return (
    <SectionCard title="Documents" color={GREEN}>
      <div style={{ marginBottom: 12 }}>
        <input type="file" multiple onChange={(e) => upload(e.target.files)} disabled={busy} />
      </div>
      {docs === null ? <Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /> : docs.length === 0 ? <p style={{ fontSize: 12.5, color: MUTED2 }}>No documents uploaded yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {docs.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 8 }}>
              <FolderOpen size={14} color={MUTED2} />
              <a href={d.url} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 12.5, color: BLUE, fontFamily: FONT, textDecoration: 'none', fontWeight: 700 }}>{d.title}</a>
              <span style={{ fontSize: 11, color: MUTED2 }}>{d.uploaded_at?.slice(0, 10)}</span>
              <button onClick={() => remove(d)} style={{ border: 'none', background: `${RED}12`, color: RED, borderRadius: 7, width: 26, height: 26, cursor: 'pointer' }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/* ── Credentials tab ─────────────────────────────────────────────────────── */
function CredentialsTab({ studentId, data, onChanged, showToast }) {
  const [busy, setBusy] = useState(null);
  const [revealed, setRevealed] = useState({});

  const regenerate = async (target) => {
    setBusy(target);
    try {
      const r = await apiPost(`${BASE}/students/${studentId}/credentials/regenerate`, { target });
      setRevealed((p) => ({ ...p, [target]: { username: r.username, password: r.password } }));
      onChanged();
    } catch (e) { showToast(e.message || 'Could not regenerate'); }
    finally { setBusy(null); }
  };

  const block = (target, title, username, has) => (
    <SectionCard title={title} color={target === 'student' ? BLUE : PURPLE}>
      <InfoRow icon={Key} label="Username" value={revealed[target]?.username || username || '—'} />
      {revealed[target] ? (
        <div style={{ background: `${GREEN}10`, border: `1px solid ${GREEN}44`, borderRadius: 8, padding: '10px 12px', marginTop: 8, fontFamily: FONT }}>
          <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 4 }}>New password (shown once — copy it now):</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: INK, letterSpacing: 1 }}>{revealed[target].password}</div>
        </div>
      ) : (
        <p style={{ fontSize: 11.5, color: MUTED2, fontStyle: 'italic', margin: '6px 0 0' }}>
          {has ? 'Password is not stored for security.' : 'No password set yet.'} Click Regenerate to set a new one.
        </p>
      )}
      <button onClick={() => regenerate(target)} disabled={busy === target} style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 9, border: 'none', background: busy === target ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: busy === target ? '#9CA3AF' : WHITE, fontSize: 12, fontWeight: 800, cursor: busy === target ? 'default' : 'pointer', fontFamily: FONT }}>
        {busy === target ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <RefreshCw size={13} />} Regenerate
      </button>
    </SectionCard>
  );

  return (
    <>
      <p style={{ fontSize: 12.5, color: MUTED, marginBottom: 14, fontFamily: FONT }}>
        Portal login credentials. Admins can share these with the student/parent and regenerate them if lost.
      </p>
      {block('student', 'Student Login', data.student_username, data.hasStudentPassword)}
      {block('parent', 'Parent Login', data.parent_username, data.hasParentPassword)}
    </>
  );
}

/* ── Health tab ───────────────────────────────────────────────────────────── */
function HealthTab({ studentId, showToast }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const load = useCallback(() => apiGet(`${BASE}/health-records?student_id=${studentId}`).then((r) => setRows(r.data || [])).catch(() => setRows([])), [studentId]);
  useEffect(() => { load(); }, [load]);
  const remove = async (r) => { if (!window.confirm(`Delete "${r.title}"?`)) return; try { await apiDelete(`${BASE}/health-records/${r.id}`); load(); } catch (e) { showToast(e.message); } };
  return (
    <SectionCard title="Health Records" color={RED} action={
      <button onClick={() => navigate(`/mgmt/students/${studentId}/health/new`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
        <Plus size={13} /> Add Record
      </button>
    }>
      {rows === null ? <Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /> : rows.length === 0 ? <p style={{ fontSize: 12.5, color: MUTED2 }}>No health records yet.</p> : (
        rows.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: `1px solid ${BORDER}` }}>
            <HeartPulse size={14} color={RED} />
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 12.5 }}>{r.title}</b>
              <div style={{ fontSize: 11, color: MUTED2 }}>{r.record_type} · {r.recorded_on}</div>
              {r.details && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{r.details}</div>}
            </div>
            <button onClick={() => remove(r)} style={{ border: 'none', background: `${RED}12`, color: RED, borderRadius: 7, width: 26, height: 26, cursor: 'pointer' }}><Trash2 size={12} /></button>
          </div>
        ))
      )}
    </SectionCard>
  );
}

/* ── Exams tab ────────────────────────────────────────────────────────────── */
function ExamsTab({ studentId, showToast }) {
  const [data, setData] = useState(null);
  const [openExam, setOpenExam] = useState(null);
  const [marksheet, setMarksheet] = useState(null);
  useEffect(() => { apiGet(`${BASE}/students/${studentId}/exams`).then((r) => setData(r.data)).catch(() => setData({ exams: [], uploads: [] })); }, [studentId]);

  const view = async (exam) => {
    setOpenExam(exam.id); setMarksheet(null);
    try { const r = await apiGet(`${BASE}/students/${studentId}/exams/${exam.id}`); setMarksheet(r.data); } catch (e) { showToast(e.message); }
  };

  if (!data) return <SectionCard title="Report Cards & Marksheets" color={PURPLE}><Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /></SectionCard>;
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 800, color: MUTED2 };
  const td = { padding: '8px 10px', fontSize: 12.5, color: INK, borderTop: `1px solid ${BORDER}` };
  return (
    <SectionCard title="Report Cards & Marksheets" color={PURPLE}>
      {data.exams.length === 0 && data.uploads.length === 0 ? <p style={{ fontSize: 12.5, color: MUTED2 }}>No exam results yet.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead><tr><th style={th}>Title</th><th style={th}>Type</th><th style={th}>Action</th></tr></thead>
          <tbody>
            {data.exams.map((e) => (
              <tr key={e.id}><td style={td}>{e.name}</td><td style={td}>System</td>
                <td style={td}><button onClick={() => view(e)} style={{ border: 'none', background: `${BLUE}12`, color: BLUE, borderRadius: 7, padding: '5px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>View</button></td></tr>
            ))}
            {data.uploads.map((u) => (
              <tr key={u.id}><td style={td}>{u.title}</td><td style={td}>Upload</td>
                <td style={td}>{u.file_url ? <a href={u.file_url} target="_blank" rel="noreferrer" style={{ color: BLUE, fontSize: 11.5, fontWeight: 700 }}>Open</a> : '—'}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {openExam && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 14 }}>
          {!marksheet ? <Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /> : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Subject</th><th style={th}>Score</th><th style={th}>Max</th><th style={th}>Result</th></tr></thead>
                <tbody>{marksheet.subjects.map((s, i) => <tr key={i}><td style={td}>{s.subject}</td><td style={td}>{s.score ?? '—'}</td><td style={td}>{s.max}</td><td style={td}>{s.pass === null ? '—' : s.pass ? <span style={{ color: GREEN, fontWeight: 800 }}>Pass</span> : <span style={{ color: RED, fontWeight: 800 }}>Fail</span>}</td></tr>)}</tbody>
              </table>
              <div style={{ marginTop: 8, fontSize: 12.5, fontFamily: FONT }}><b>Total:</b> {marksheet.total}/{marksheet.maxTotal} ({marksheet.percent}%)</div>
              {marksheet.remark && <div style={{ marginTop: 6, fontSize: 12, color: MUTED, fontFamily: FONT }}><b>Remark:</b> {marksheet.remark}</div>}
            </>
          )}
        </div>
      )}
    </SectionCard>
  );
}

/* ── Attendance tab (month calendar) ─────────────────────────────────────── */
function AttendanceTab({ studentId, showToast }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  useEffect(() => { apiGet(`${BASE}/students/${studentId}/attendance?month=${month}`).then((r) => setData(r.data)).catch(() => showToast('Could not load attendance')); }, [studentId, month]);

  const shiftMonth = (delta) => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
  const STATUS_COLOR = { present: GREEN, absent: RED, late: AMBER, excused: BLUE };
  const STATUS_LABEL = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Half Day' };
  const [y, m] = month.split('-').map(Number);
  const firstDay = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const presentPct = data?.stats?.total ? Math.round((data.stats.present / (data.stats.present + data.stats.absent + data.stats.late + data.stats.excused || 1)) * 100) : 0;

  return (
    <SectionCard title="Attendance" color={BLUE}>
      {data && (
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <Ring percent={presentPct} label="Present" color={GREEN} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1, minWidth: 220 }}>
            {statPill('Present', data.stats.present, GREEN)}
            {statPill('Absent', data.stats.absent, RED)}
            {statPill('Late', data.stats.late, AMBER)}
            {statPill('Half Day', data.stats.excused, BLUE)}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button onClick={() => shiftMonth(-1)} style={{ border: 'none', background: LIGHT, borderRadius: 7, width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronLeft size={15} /></button>
        <b style={{ fontFamily: FONT, fontSize: 13 }}>{new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</b>
        <button onClick={() => shiftMonth(1)} style={{ border: 'none', background: LIGHT, borderRadius: 7, width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronRight size={15} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, fontFamily: FONT }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} style={{ fontSize: 10.5, fontWeight: 800, color: MUTED2, textAlign: 'center', padding: 4 }}>{d}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const date = `${month}-${String(day).padStart(2, '0')}`;
          const status = data?.records?.[date]?.status;
          return (
            <div key={i} style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, fontSize: 12, fontWeight: 700, background: status ? `${STATUS_COLOR[status]}18` : LIGHT, color: status ? STATUS_COLOR[status] : MUTED2 }}>
              {day}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        {Object.entries(STATUS_COLOR).map(([k, c]) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: MUTED, fontFamily: FONT }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: c }} /> {STATUS_LABEL[k]}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: MUTED, fontFamily: FONT }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: LIGHT, border: `1px solid ${BORDER}` }} /> No Record
        </span>
      </div>
    </SectionCard>
  );
}

/* ── Behavior tab ─────────────────────────────────────────────────────────── */
function BehaviorTab({ studentId, showToast }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  useEffect(() => { apiGet(`${BASE}/students/${studentId}/behavior-summary`).then((r) => setData(r.data)).catch(() => showToast('Could not load behavior summary')); }, [studentId]);
  const SEVERITY_COLOR = { low: GREEN, medium: AMBER, high: RED };

  if (!data) return <SectionCard title="Behavior" color={AMBER}><Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /></SectionCard>;
  const scoreColor = data.score > 0 ? GREEN : data.score < 0 ? RED : MUTED2;

  return (
    <SectionCard title="Behavior" color={AMBER} action={
      <button onClick={() => navigate(`/mgmt/students/${studentId}/behavior/new`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
        <Plus size={13} /> Add Record
      </button>
    }>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 96, height: 96, borderRadius: '50%', border: `3px solid ${scoreColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: scoreColor, fontFamily: FONT }}>{data.score > 0 ? `+${data.score}` : data.score}</span>
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, color: MUTED2, fontFamily: FONT, textTransform: 'uppercase' }}>Score</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1, minWidth: 220 }}>
          <div style={{ flex: '1 1 110px', background: `${GREEN}12`, border: `1px solid ${GREEN}33`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ThumbsUp size={16} color={GREEN} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: GREEN, fontFamily: FONT }}>{data.positive}</div>
              <div style={{ fontSize: 10, color: MUTED, fontFamily: FONT, textTransform: 'uppercase', letterSpacing: .3 }}>Positive</div>
            </div>
          </div>
          <div style={{ flex: '1 1 110px', background: `${RED}12`, border: `1px solid ${RED}33`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ThumbsDown size={16} color={RED} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: RED, fontFamily: FONT }}>{data.negative}</div>
              <div style={{ fontSize: 10, color: MUTED, fontFamily: FONT, textTransform: 'uppercase', letterSpacing: .3 }}>Negative</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, fontFamily: FONT, marginBottom: 8 }}>
        Incident Log — {data.hasActiveSession ? 'Current Session' : 'All Records'}
      </div>
      {data.records.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: MUTED2 }}>
          <div style={{ fontSize: 26, marginBottom: 6 }}>😊</div>
          <p style={{ fontSize: 12.5, margin: 0 }}>No behavior incidents recorded this session.</p>
        </div>
      ) : (
        data.records.map((r) => (
          <div key={r.id} style={{ padding: '8px 0', borderTop: `1px solid ${BORDER}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {r.polarity === 'positive' ? <ThumbsUp size={13} color={GREEN} /> : <ThumbsDown size={13} color={RED} />}
              <span style={{ padding: '2px 9px', borderRadius: 999, background: `${SEVERITY_COLOR[r.severity]}15`, color: SEVERITY_COLOR[r.severity], fontSize: 10.5, fontWeight: 800, textTransform: 'capitalize' }}>{r.severity}</span>
              <b style={{ fontSize: 12.5 }}>{r.incident_type}</b>
              <span style={{ fontSize: 11, fontWeight: 800, color: r.polarity === 'positive' ? GREEN : RED }}>{r.polarity === 'positive' ? `+${r.points}` : `-${r.points}`}</span>
              <span style={{ fontSize: 11, color: MUTED2, marginLeft: 'auto' }}>{r.recorded_on}</span>
            </div>
            {r.description && <p style={{ fontSize: 12, color: MUTED, margin: '4px 0 0' }}>{r.description}</p>}
          </div>
        ))
      )}
    </SectionCard>
  );
}

/* ── Transport tab (Transport + Hostel) ──────────────────────────────────── */
function TransportTab({ studentId, showToast }) {
  const [data, setData] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [form, setForm] = useState({ route_id: '', vehicle_id: '', pickup_point: '', fee: '' });
  const [roomId, setRoomId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => apiGet(`${BASE}/students/${studentId}/transport`).then((r) => setData(r.data)).catch(() => setData({ transport: null, hostel: null })), [studentId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiGet(`${BASE}/transport-routes`).then((r) => setRoutes(r.data || [])).catch(() => {});
    apiGet(`${BASE}/vehicles`).then((r) => setVehicles(r.data || [])).catch(() => {});
    apiGet(`${BASE}/hostel-rooms`).then((r) => setRooms(r.data || [])).catch(() => {});
  }, []);

  const assignTransport = async () => {
    setBusy(true);
    try { await apiPost(`${BASE}/student-transport`, { ...form, student_id: studentId }); showToast('Transport assigned ✓'); load(); }
    catch (e) { showToast(e.message || 'Could not assign'); }
    finally { setBusy(false); }
  };
  const assignHostel = async () => {
    if (!roomId) return showToast('Choose a room');
    setBusy(true);
    try { await apiPost(`${BASE}/hostel-allocations`, { room_id: roomId, student_id: studentId }); showToast('Hostel room allocated ✓'); load(); }
    catch (e) { showToast(e.message || 'Could not allocate'); }
    finally { setBusy(false); }
  };

  if (!data) return <SectionCard title="Transport & Hostel" color={BLUE}><Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /></SectionCard>;
  return (
    <>
      <SectionCard title="Transport Details" color={BLUE}>
        {data.transport ? (
          <>
            <InfoRow icon={Bus} label="Route" value={data.transport.route_name} />
            <InfoRow label="Vehicle" value={data.transport.vehicle_plate} />
            <InfoRow label="Driver" value={data.transport.driver_name ? `${data.transport.driver_name} (${data.transport.driver_phone || ''})` : null} />
            <InfoRow label="Pickup Point" value={data.transport.pickup_point} />
            <InfoRow label="Fee" value={naira(data.transport.fee)} />
          </>
        ) : (
          <>
            <p style={{ fontSize: 12.5, color: MUTED2, marginBottom: 10 }}>No transport assigned.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={form.route_id} onChange={(e) => setForm((f) => ({ ...f, route_id: e.target.value }))} style={{ ...inputStyle, flex: '1 1 140px', cursor: 'pointer' }}>
                <option value="">— route —</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select value={form.vehicle_id} onChange={(e) => setForm((f) => ({ ...f, vehicle_id: e.target.value }))} style={{ ...inputStyle, flex: '1 1 140px', cursor: 'pointer' }}>
                <option value="">— vehicle —</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_no}</option>)}
              </select>
              <input value={form.pickup_point} onChange={(e) => setForm((f) => ({ ...f, pickup_point: e.target.value }))} placeholder="Pickup point" style={{ ...inputStyle, flex: '1 1 140px' }} />
              <input type="number" value={form.fee} onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))} placeholder="Fee" style={{ ...inputStyle, flex: '1 1 100px' }} />
              <button onClick={assignTransport} disabled={busy} style={{ padding: '9px 16px', borderRadius: 9, border: 'none', background: AMBER, color: WHITE, fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Assign</button>
            </div>
          </>
        )}
      </SectionCard>
      <SectionCard title="Hostel Details" color={PURPLE}>
        {data.hostel ? (
          <>
            <InfoRow icon={Bed} label="Hostel" value={data.hostel.hostel_name} />
            <InfoRow label="Room No" value={data.hostel.room_no} />
            <InfoRow label="Allocated On" value={data.hostel.allocated_on} />
          </>
        ) : (
          <>
            <p style={{ fontSize: 12.5, color: MUTED2, marginBottom: 10 }}>No hostel room allocated.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ ...inputStyle, flex: '1 1 200px', cursor: 'pointer' }}>
                <option value="">— select room —</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.room_no}</option>)}
              </select>
              <button onClick={assignHostel} disabled={busy} style={{ padding: '9px 16px', borderRadius: 9, border: 'none', background: AMBER, color: WHITE, fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Allocate</button>
            </div>
          </>
        )}
      </SectionCard>
    </>
  );
}


export {
  FeesTab, DocumentsTab, CredentialsTab, HealthTab,
  ExamsTab, AttendanceTab, BehaviorTab, TransportTab,
};
