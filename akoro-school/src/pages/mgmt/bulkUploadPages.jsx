/**
 * Dedicated bulk-upload pages (Student Information): Students / Photos / Documents.
 * Each page: upload area(s) → quick actions (templates/samples) → server limits →
 * how-it-works → recent import history (persisted server-side).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, Download, FileUp, Image as ImageIcon, ArrowLeft, Loader2, CheckCircle2,
  XCircle, Info, ChevronDown, ChevronUp, FileArchive, History, Server, Users,
} from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';

const BASE = '/api/school/mgmt';

/* ── shared helpers ────────────────────────────────────────────────────── */
async function downloadFromApi(path, filename) {
  const r = await fetch(`${API}${path}`, { credentials: 'include' });
  if (!r.ok) throw new Error('Download failed');
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && next === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()])));
}

/* ── card shell ────────────────────────────────────────────────────────── */
function Card({ icon: Icon, title, color = BLUE, children, right }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderTop: `3px solid ${color}`, borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {Icon && <Icon size={16} color={color} />}
          <span style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: FONT }}>{title}</span>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function FilePickerRow({ file, onPick, accept, placeholder = 'Choose file…' }) {
  const inputRef = useRef(null);
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ ...inputStyle, flex: 1, display: 'flex', alignItems: 'center', color: file ? INK : MUTED2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file ? file.name : placeholder}
      </div>
      <button type="button" onClick={() => inputRef.current?.click()} style={{ padding: '9px 16px', borderRadius: 9, border: `1px solid ${BORDER}`, background: LIGHT, color: INK, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' }}>Browse</button>
      <input ref={inputRef} type="file" accept={accept} onChange={(e) => onPick(e.target.files?.[0] || null)} style={{ display: 'none' }} />
    </div>
  );
}

function quickBtn(color) {
  return { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '10px 14px', borderRadius: 9, border: `1px solid ${color}44`, background: `${color}0A`, color, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, marginBottom: 8 };
}

function ResultBox({ result }) {
  if (!result) return null;
  const total = result.total ?? result.totalFiles ?? 0;
  const success = result.matched ?? (result.inserted || 0) + (result.updated || 0);
  const failed = result.failed ?? result.skipped ?? (result.unmatched ? result.unmatched.length : 0);
  const errors = result.errors || (result.unmatched || []).map((f) => `Unmatched: ${f}`);
  return (
    <div style={{ background: LIGHT, borderRadius: 10, padding: '12px 14px', marginTop: 12, fontFamily: FONT }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: GREEN, fontWeight: 800 }}><CheckCircle2 size={14} /> Success: {success}</span>
        {failed > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: RED, fontWeight: 800 }}><XCircle size={14} /> Failed: {failed}</span>}
        <span style={{ color: MUTED2 }}>Total: {total}</span>
      </div>
      {errors.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: RED, fontSize: 11.5 }}>
          {errors.slice(0, 15).map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}

function ServerLimits({ rows }) {
  const tr = { display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderTop: `1px solid ${BORDER}`, fontSize: 12.5, fontFamily: FONT };
  return (
    <div>
      {rows.map((r, i) => (
        <div key={r.label} style={{ ...tr, borderTop: i === 0 ? 'none' : tr.borderTop, background: r.highlight ? LIGHT : 'transparent', margin: r.highlight ? '0 -18px' : 0, padding: r.highlight ? '9px 18px' : '9px 0' }}>
          <span style={{ color: MUTED }}>{r.label}</span>
          <span style={{ fontWeight: 800, color: r.highlight ? BLUE : INK }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Collapsible({ title, icon, color = BLUE, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card icon={icon} title={title} color={color} right={
      <button onClick={() => setOpen((v) => !v)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: MUTED2 }}>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
    }>
      {open && children}
    </Card>
  );
}

const STATUS_COLOR = { completed: GREEN, partial: AMBER, failed: RED };

function ImportHistory({ kind, reloadKey }) {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => apiGet(`${BASE}/bulk-import-logs?kind=${kind}`).then((r) => setRows(r.data || [])).catch(() => setRows([])), [kind]);
  useEffect(() => { load(); }, [load, reloadKey]);
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, fontWeight: 800, color: MUTED2 };
  const td = { padding: '9px 10px', fontSize: 12, color: INK, borderTop: `1px solid ${BORDER}` };

  return (
    <Card icon={History} title="Recent Import History" color={PURPLE}>
      {rows === null ? <Loader2 size={16} style={{ animation: 'spin .8s linear infinite' }} /> : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '22px 0', color: MUTED2 }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>📥</div>
          <p style={{ fontSize: 12.5, margin: 0 }}>No recent imports. Upload a file to get started.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Date</th><th style={th}>File</th><th style={th}>Status</th><th style={th}>Success</th><th style={th}>Failed</th><th style={th}>Total</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{new Date(r.created_at).toLocaleString()}</td>
                  <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.file_name || '—'}</td>
                  <td style={td}><span style={{ padding: '2px 9px', borderRadius: 999, background: `${STATUS_COLOR[r.status]}15`, color: STATUS_COLOR[r.status], fontSize: 10.5, fontWeight: 800, textTransform: 'capitalize' }}>{r.status}</span></td>
                  <td style={{ ...td, color: GREEN, fontWeight: 700 }}>{r.success_count}</td>
                  <td style={{ ...td, color: r.failed_count > 0 ? RED : MUTED2, fontWeight: 700 }}>{r.failed_count}</td>
                  <td style={td}>{r.total_rows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function BackButton({ navigate }) {
  return (
    <button onClick={() => navigate('/mgmt/students')} style={quickBtn(INK)}>
      <ArrowLeft size={13} /> Back to Students
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   1. Bulk Student Upload (CSV of student records)
   ═══════════════════════════════════════════════════════════════════════ */
export function BulkStudentUploadPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const onPick = (f) => {
    setFile(f); setResult(null);
    if (!f) { setRows([]); return; }
    const reader = new FileReader();
    reader.onload = () => setRows(parseCSV(String(reader.result || '')));
    reader.readAsText(f);
  };

  const submit = async () => {
    if (!rows.length) return;
    setBusy(true);
    try {
      const res = await apiPost(`${BASE}/students/bulk-upload`, { rows, file_name: file?.name });
      setResult(res);
      setReloadKey((k) => k + 1);
    } catch (e) { setResult({ errors: [e.message || 'Upload failed'] }); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="Bulk Student Upload" subtitle="Import or update students from a CSV file">
      <Card icon={Users} title="Upload Student CSV" color={AMBER}>
        <label style={{ fontSize: 12, fontWeight: 700, color: MUTED, fontFamily: FONT, display: 'block', marginBottom: 6 }}>Upload CSV File *</label>
        <FilePickerRow file={file} onPick={onPick} accept=".csv,text/csv" placeholder="Choose CSV file…" />
        <p style={{ fontSize: 11, color: MUTED2, margin: '8px 0 0' }}>
          Matched by <b>admission_no</b>: existing students are updated, new ones are added. {rows.length > 0 && `${rows.length} row(s) found.`}
        </p>
        <ResultBox result={result} />
        <button onClick={submit} disabled={busy || !rows.length} style={{ marginTop: 14, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: (busy || !rows.length) ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: (busy || !rows.length) ? '#9CA3AF' : WHITE, fontSize: 13.5, fontWeight: 800, cursor: (busy || !rows.length) ? 'default' : 'pointer', fontFamily: FONT }}>
          {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Upload size={14} />} Process Upload {rows.length ? `(${rows.length})` : ''}
        </button>
      </Card>

      <Card icon={Info} title="Quick Actions" color={BLUE}>
        <button onClick={() => downloadFromApi(`${BASE}/bulk/students/template.csv`, 'students_template.csv')} style={quickBtn(BLUE)}><Download size={13} /> Download CSV Template</button>
        <BackButton navigate={navigate} />
      </Card>

      <Card icon={Server} title="Server Limits" color={MUTED2}>
        <ServerLimits rows={[
          { label: 'Max Rows per Import', value: 'No hard limit' },
          { label: 'Required Columns', value: 'admission_no, first_name, last_name' },
          { label: 'Match Key', value: 'admission_no', highlight: true },
        ]} />
      </Card>

      <Collapsible title="How It Works" icon={Info} color={GREEN}>
        <p style={{ fontSize: 12, color: MUTED, lineHeight: 1.6, margin: '0 0 10px' }}>
          Upload a CSV with a header row. Each row upserts one student — if the <b>admission_no</b> already exists for a
          student in your school, that student's fields are updated; otherwise a new student is created.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead><tr>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: MUTED2 }}>Column</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: MUTED2 }}>Example</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: MUTED2 }}>Notes</th>
            </tr></thead>
            <tbody>
              {[
                ['admission_no', 'ADM-1001', 'Required — unique per school'],
                ['first_name', 'Jane', 'Required'],
                ['last_name', 'Doe', 'Required'],
                ['roll_no, gender, dob', '1, female, 2015-04-12', 'Optional'],
                ['guardian_name, guardian_phone, guardian_email', 'John Doe, +234…', 'Optional'],
                ['address, blood_group, status', 'active/inactive/alumni', 'Optional'],
              ].map(([c, ex, n]) => (
                <tr key={c}>
                  <td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}`, fontFamily: 'monospace', color: RED }}>{c}</td>
                  <td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}` }}>{ex}</td>
                  <td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}`, color: MUTED }}>{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Collapsible>

      <ImportHistory kind="students" reloadKey={reloadKey} />
    </PageLayout>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   2. Bulk Photo Upload (quick filename-match, or ZIP + photo_mapping.csv)
   ═══════════════════════════════════════════════════════════════════════ */
export function BulkPhotoUploadPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [busyQuick, setBusyQuick] = useState(false);
  const [resultQuick, setResultQuick] = useState(null);

  const [zipFile, setZipFile] = useState(null);
  const [busyZip, setBusyZip] = useState(false);
  const [resultZip, setResultZip] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);

  const submitQuick = async () => {
    if (!files.length) return;
    setBusyQuick(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      const r = await fetch(`${API}${BASE}/students/bulk-photos`, { method: 'POST', credentials: 'include', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      setResultQuick(data);
      setReloadKey((k) => k + 1);
    } catch (e) { setResultQuick({ errors: [e.message || 'Upload failed'] }); }
    finally { setBusyQuick(false); }
  };

  const submitZip = async () => {
    if (!zipFile) return;
    setBusyZip(true);
    try {
      const fd = new FormData();
      fd.append('file', zipFile);
      const r = await fetch(`${API}${BASE}/students/bulk-photos-zip`, { method: 'POST', credentials: 'include', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      setResultZip(data);
      setReloadKey((k) => k + 1);
    } catch (e) { setResultZip({ errors: [e.message || 'Upload failed'] }); }
    finally { setBusyZip(false); }
  };

  return (
    <PageLayout title="Bulk Student Photo Upload" subtitle="Upload photos directly, or as a ZIP with a mapping CSV">
      <Card icon={ImageIcon} title="Quick Match — Upload Photo Files" color={PURPLE}>
        <p style={{ fontSize: 11.5, color: MUTED2, margin: '0 0 10px' }}>
          Name each photo exactly as the student's Admission Number (e.g. <code>ADM-0042.jpg</code>). One photo per student.
        </p>
        <input type="file" multiple accept="image/*" onChange={(e) => { setFiles(Array.from(e.target.files || [])); setResultQuick(null); }} />
        {files.length > 0 && <p style={{ fontSize: 12, color: MUTED2, marginTop: 8 }}>{files.length} file(s) selected</p>}
        <ResultBox result={resultQuick} />
        <button onClick={submitQuick} disabled={busyQuick || !files.length} style={{ marginTop: 12, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', borderRadius: 10, border: 'none', background: (busyQuick || !files.length) ? '#E5E7EB' : PURPLE, color: (busyQuick || !files.length) ? '#9CA3AF' : WHITE, fontSize: 13, fontWeight: 800, cursor: (busyQuick || !files.length) ? 'default' : 'pointer', fontFamily: FONT }}>
          {busyQuick ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Upload size={14} />} Upload {files.length ? `(${files.length})` : ''}
        </button>
      </Card>

      <Card icon={FileArchive} title="ZIP + Mapping CSV — Upload Photos (ZIP)" color={BLUE}>
        <p style={{ fontSize: 11.5, color: MUTED2, margin: '0 0 10px' }}>
          Upload a ZIP containing <code>photo_mapping.csv</code> (admission_no, file_name) and the photo files. Handles relabeling and mixed filenames.
        </p>
        <FilePickerRow file={zipFile} onPick={(f) => { setZipFile(f); setResultZip(null); }} accept=".zip" placeholder="Choose ZIP file…" />
        <p style={{ fontSize: 10.5, color: MUTED2, margin: '6px 0 0' }}>Accepted: .zip (max 100 MB). Must contain photo_mapping.csv and image files.</p>
        <ResultBox result={resultZip} />
        <button onClick={submitZip} disabled={busyZip || !zipFile} style={{ marginTop: 12, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', borderRadius: 10, border: 'none', background: (busyZip || !zipFile) ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: (busyZip || !zipFile) ? '#9CA3AF' : WHITE, fontSize: 13, fontWeight: 800, cursor: (busyZip || !zipFile) ? 'default' : 'pointer', fontFamily: FONT }}>
          {busyZip ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Upload size={14} />} Process ZIP Upload
        </button>
      </Card>

      <Card icon={Info} title="Quick Actions" color={GREEN}>
        <button onClick={() => downloadFromApi(`${BASE}/bulk/photos/template.csv`, 'photo_mapping_template.csv')} style={quickBtn(BLUE)}><Download size={13} /> Download CSV Template</button>
        <button onClick={() => downloadFromApi(`${BASE}/bulk/photos/sample.zip`, 'photos_sample.zip')} style={quickBtn(GREEN)}><FileArchive size={13} /> Download Sample ZIP</button>
        <BackButton navigate={navigate} />
      </Card>

      <Card icon={Server} title="Server Limits" color={MUTED2}>
        <ServerLimits rows={[
          { label: 'Max Upload Size (ZIP)', value: '100 MB' },
          { label: 'Max File Size per Photo', value: '15 MB' },
          { label: 'Effective Limit', value: '100 MB', highlight: true },
        ]} />
      </Card>

      <Collapsible title="How It Works" icon={Info} color={BLUE}>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: INK, marginBottom: 6 }}>ZIP File Structure</div>
            <pre style={{ background: INK, color: '#D1FADF', fontSize: 10.5, borderRadius: 8, padding: '10px 12px', overflowX: 'auto', margin: 0, lineHeight: 1.6 }}>
{`photos.zip
├── photo_mapping.csv   ← Required CSV
├── ADM-1001_photo.jpg  ← Photo file
└── ADM-1002_photo.jpg  ← Photo file`}
            </pre>
          </div>
          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: INK, marginBottom: 6 }}>CSV Format (photo_mapping.csv)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead><tr><th style={{ textAlign: 'left', padding: '6px 8px', color: MUTED2 }}>Column</th><th style={{ textAlign: 'left', padding: '6px 8px', color: MUTED2 }}>Example</th></tr></thead>
              <tbody>
                <tr><td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}`, fontFamily: 'monospace', color: RED }}>admission_no</td><td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}` }}>ADM-1001</td></tr>
                <tr><td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}`, fontFamily: 'monospace', color: RED }}>file_name</td><td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}` }}>ADM-1001_photo.jpg</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </Collapsible>

      <ImportHistory kind="photos" reloadKey={reloadKey} />
    </PageLayout>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   3. Bulk Student Document Upload (ZIP + document_mapping.csv)
   ═══════════════════════════════════════════════════════════════════════ */
export function BulkDocumentUploadPage() {
  const navigate = useNavigate();
  const [zipFile, setZipFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const submit = async () => {
    if (!zipFile) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', zipFile);
      const r = await fetch(`${API}${BASE}/students/bulk-docs-zip`, { method: 'POST', credentials: 'include', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      setResult(data);
      setReloadKey((k) => k + 1);
    } catch (e) { setResult({ errors: [e.message || 'Upload failed'] }); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="Bulk Student Document Upload" subtitle="Upload multiple documents per student via a ZIP + mapping CSV">
      <Card icon={FileArchive} title="Upload Student Documents (ZIP)" color={AMBER}>
        <label style={{ fontSize: 12, fontWeight: 700, color: MUTED, fontFamily: FONT, display: 'block', marginBottom: 6 }}>Upload ZIP File *</label>
        <FilePickerRow file={zipFile} onPick={(f) => { setZipFile(f); setResult(null); }} accept=".zip" placeholder="Choose ZIP file…" />
        <p style={{ fontSize: 10.5, color: MUTED2, margin: '8px 0 0' }}>
          Accepted: .zip (max 100 MB). Must contain <code>document_mapping.csv</code> and document files.
        </p>
        <ResultBox result={result} />
        <button onClick={submit} disabled={busy || !zipFile} style={{ marginTop: 14, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: (busy || !zipFile) ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: (busy || !zipFile) ? '#9CA3AF' : WHITE, fontSize: 13.5, fontWeight: 800, cursor: (busy || !zipFile) ? 'default' : 'pointer', fontFamily: FONT }}>
          {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Upload size={14} />} Process Upload
        </button>
      </Card>

      <Card icon={Info} title="Quick Actions" color={BLUE}>
        <button onClick={() => downloadFromApi(`${BASE}/bulk/docs/template.csv`, 'document_mapping_template.csv')} style={quickBtn(BLUE)}><Download size={13} /> Download CSV Template</button>
        <button onClick={() => downloadFromApi(`${BASE}/bulk/docs/sample.zip`, 'documents_sample.zip')} style={quickBtn(GREEN)}><FileArchive size={13} /> Download Sample ZIP</button>
        <BackButton navigate={navigate} />
      </Card>

      <Card icon={Server} title="Server Limits" color={MUTED2}>
        <ServerLimits rows={[
          { label: 'Max Upload Size', value: '100 MB' },
          { label: 'Max File Size per Document', value: '15 MB' },
          { label: 'Effective Limit', value: '100 MB', highlight: true },
        ]} />
      </Card>

      <Collapsible title="How It Works" icon={Info} color={GREEN}>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 220px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: INK, marginBottom: 6 }}>ZIP File Structure</div>
            <pre style={{ background: INK, color: '#D1FADF', fontSize: 10.5, borderRadius: 8, padding: '10px 12px', overflowX: 'auto', margin: 0, lineHeight: 1.6 }}>
{`student_documents.zip
├── document_mapping.csv    ← Required CSV
├── ADM-1001_birth_cert.pdf ← Document file
├── ADM-1001_tc.pdf         ← Document file
└── ADM-1002_birth_cert.pdf ← Document file`}
            </pre>
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: INK, marginBottom: 6 }}>CSV Format (document_mapping.csv)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead><tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: MUTED2 }}>Column</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: MUTED2 }}>Example</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: MUTED2 }}>Notes</th>
              </tr></thead>
              <tbody>
                <tr>
                  <td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}`, fontFamily: 'monospace', color: RED }}>admission_no</td>
                  <td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}` }}>ADM-1001</td>
                  <td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}`, color: MUTED }}>Must match existing student</td>
                </tr>
                <tr>
                  <td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}`, fontFamily: 'monospace', color: RED }}>document_name</td>
                  <td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}` }}>Birth Certificate</td>
                  <td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}`, color: MUTED }}>Label for the document</td>
                </tr>
                <tr>
                  <td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}`, fontFamily: 'monospace', color: RED }}>file_name</td>
                  <td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}` }}>ADM-1001_bc.pdf</td>
                  <td style={{ padding: '6px 8px', borderTop: `1px solid ${BORDER}`, color: MUTED }}>Filename inside ZIP</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ background: `${BLUE}0C`, border: `1px solid ${BLUE}33`, borderRadius: 8, padding: '8px 12px', fontSize: 11.5, color: MUTED, marginBottom: 10 }}>
          💡 <b>Tip:</b> One student can have multiple documents. Just add more rows in the CSV with the same admission number.
        </div>
        <div>
          <span style={{ fontSize: 11, fontWeight: 800, color: INK }}>Supported Formats: </span>
          {['PDF', 'JPG', 'JPEG', 'PNG', 'WebP', 'GIF', 'DOC', 'DOCX'].map((f) => (
            <span key={f} style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, background: LIGHT, color: MUTED, fontSize: 10.5, fontWeight: 700, marginRight: 6, marginTop: 4 }}>{f}</span>
          ))}
          <p style={{ fontSize: 10.5, color: MUTED2, margin: '8px 0 0' }}>Max 15 MB per document. Documents are added (not replaced).</p>
        </div>
      </Collapsible>

      <ImportHistory kind="documents" reloadKey={reloadKey} />
    </PageLayout>
  );
}
