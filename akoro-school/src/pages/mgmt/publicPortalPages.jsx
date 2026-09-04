/**
 * Public-portal admin pages (mgmt schema):
 *   • Online Admissions — review /apply submissions, admit → creates student
 *   • Result PINs — generate/check the PINs parents use on /results
 *   • Online Payments — every Paystack checkout started on /pay or /apply
 */
import { useState, useEffect } from 'react';
import { UserCheck, X, KeyRound } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost, apiPut } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';

const BASE = '/api/school/mgmt';
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const pill = (v, map) => {
  const c = map[v] || MUTED2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: `${c}15`, color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{String(v || '—').replace('_', ' ')}</span>;
};
const STATUS_COLORS = { pending: AMBER, reviewed: BLUE, admitted: GREEN, rejected: RED };

/* ── Online Admissions review queue ──────────────────────────────────────── */
export function OnlineAdmissionsPage() {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);     // application being reviewed
  const [classes, setClasses] = useState([]);
  const [admit, setAdmit] = useState({ class_id: '', admission_no: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const load = () => {
    const q = status ? `?status=${status}` : '';
    apiGet(`${BASE}/admission-applications${q}`).then((r) => setRows(r.data || [])).catch(() => setRows([]));
  };
  useEffect(load, [status]);
  useEffect(() => { apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {}); }, []);

  const setAppStatus = async (app, s) => {
    try { await apiPut(`${BASE}/admission-applications/${app.id}`, { status: s }); load(); setView(null); }
    catch (e) { setErr(e.message); }
  };
  const doAdmit = async () => {
    setBusy(true); setErr('');
    try {
      const r = await apiPost(`${BASE}/admissions/${view.id}/admit`, admit);
      // The admission number is the one thing they need to write down, so it
      // stays on the page rather than behind an alert they must dismiss.
      setOkMsg(`Admitted 🎉 Admission number: ${r.data.admission_no}`);
      setView(null); setAdmit({ class_id: '', admission_no: '' }); load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const th = { textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2 };
  const td = { padding: '11px 14px', fontSize: 13, color: INK, borderTop: `1px solid ${BORDER}` };
  const label = { display: 'block', fontSize: 12, fontWeight: 700, color: MUTED, margin: '12px 0 5px' };

  return (
    <PageLayout title="Online Admissions" subtitle="Applications submitted on your public /apply page">
      {okMsg && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '11px 14px', borderRadius: 12, background: '#DCFCE7', border: '1px solid #BBF7D0' }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: '#166534' }}>{okMsg}</span>
          <button onClick={() => setOkMsg('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, fontWeight: 900, color: '#166534', opacity: .6 }}>×</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, width: 200 }}>
          <option value="">All statuses</option>
          {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
          <thead><tr>
            <th style={th}>APPLICATION NO</th><th style={th}>APPLICANT</th><th style={th}>CLASS</th>
            <th style={th}>FEE</th><th style={th}>STATUS</th><th style={th}>SUBMITTED</th><th style={th} />
          </tr></thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, fontWeight: 700 }}>{r.application_no}</td>
                <td style={td}>{[r.first_name, r.last_name].filter(Boolean).join(' ')}<div style={{ fontSize: 11.5, color: MUTED2 }}>{r.email || r.phone || ''}</div></td>
                <td style={td}>{r.class_applied || '—'}</td>
                <td style={td}>{Number(r.fee_amount) > 0 ? <>{naira(r.fee_amount)} {pill(r.fee_status, { paid: GREEN, unpaid: RED, waived: MUTED2 })}</> : '—'}</td>
                <td style={td}>{pill(r.status, STATUS_COLORS)}</td>
                <td style={td}>{new Date(r.created_at).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button onClick={() => { setView(r); setErr(''); }} style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BORDER}`, background: WHITE, color: BLUE, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Review</button>
                </td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={7}>No applications yet — share your public site's Apply page.</td></tr>}
          </tbody>
        </table>
      </div>

      {view && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }} onClick={() => setView(null)}>
          <div style={{ background: WHITE, borderRadius: 16, padding: 26, width: 560, maxHeight: '88vh', overflowY: 'auto', fontFamily: FONT }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: INK }}>{[view.first_name, view.last_name].filter(Boolean).join(' ')}</h3>
              <button onClick={() => setView(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: MUTED2 }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12.5, color: MUTED2, marginBottom: 14 }}>{view.application_no} · {pill(view.status, STATUS_COLORS)} {Number(view.fee_amount) > 0 && pill(`fee ${view.fee_status}`, { 'fee paid': GREEN, 'fee unpaid': RED, 'fee waived': MUTED2 })}</div>
            {[['Email', view.email], ['Phone', view.phone], ['Date of birth', view.dob], ['Gender', view.gender],
              ['Guardian', view.guardian_name], ['Guardian phone', view.guardian_phone], ['Address', view.address],
              ['Class applying for', view.class_applied],
              ...Object.entries(view.custom_answers || {})].map(([k, v]) => v ? (
                <div key={k} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ width: 170, fontSize: 12.5, fontWeight: 700, color: MUTED }}>{k}</div>
                  <div style={{ flex: 1, fontSize: 13, color: INK }}>{String(v)}</div>
                </div>) : null)}

            {view.status !== 'admitted' ? (<>
              <div style={{ marginTop: 18, padding: 16, background: `${GREEN}0d`, border: `1px solid ${GREEN}40`, borderRadius: 12 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK, display: 'flex', alignItems: 'center', gap: 8 }}><UserCheck size={15} color={GREEN} /> Admit this applicant</div>
                <label style={label}>Assign class</label>
                <select value={admit.class_id} onChange={(e) => setAdmit({ ...admit, class_id: e.target.value })} style={inputStyle}>
                  <option value="">— none yet —</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <label style={label}>Admission number (blank = auto)</label>
                <input value={admit.admission_no} onChange={(e) => setAdmit({ ...admit, admission_no: e.target.value })} style={inputStyle} placeholder="e.g. ADM-0107" />
                {err && <div style={{ color: RED, fontSize: 12.5, marginTop: 10 }}>{err}</div>}
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  <button onClick={doAdmit} disabled={busy} style={{ padding: '10px 20px', borderRadius: 9, border: 'none', background: GREEN, color: WHITE, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: FONT, opacity: busy ? .6 : 1 }}>{busy ? 'Admitting…' : 'Admit → create student'}</button>
                  {view.status !== 'rejected' && <button onClick={() => setAppStatus(view, 'rejected')} style={{ padding: '10px 20px', borderRadius: 9, border: `1px solid ${RED}`, background: WHITE, color: RED, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: FONT }}>Reject</button>}
                  {view.status === 'pending' && <button onClick={() => setAppStatus(view, 'reviewed')} style={{ padding: '10px 20px', borderRadius: 9, border: `1px solid ${BORDER}`, background: WHITE, color: BLUE, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: FONT }}>Mark reviewed</button>}
                </div>
              </div>
            </>) : <div style={{ marginTop: 18, color: GREEN, fontWeight: 800, fontSize: 13.5 }}>✓ Admitted — student record created.</div>}
          </div>
        </div>
      )}
    </PageLayout>
  );
}

/* ── Result PINs ─────────────────────────────────────────────────────────── */
export function ResultPinsPage() {
  const [exams, setExams] = useState([]);
  const [classes, setClasses] = useState([]);
  const [gen, setGen] = useState({ exam_id: '', class_id: '', max_uses: 10 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    apiGet(`${BASE}/exams`).then((r) => setExams(r.data || [])).catch(() => {});
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
  }, []);

  const generate = async () => {
    if (!gen.exam_id) return setMsg('Pick an exam first.');
    setBusy(true); setMsg('');
    try {
      const r = await apiPost(`${BASE}/result-pins/generate`, gen);
      setMsg(r.generated ? `Generated ${r.generated} PIN${r.generated === 1 ? '' : 's'}. 🎉` : (r.message || 'Nothing to generate.'));
      setReload((n) => n + 1);
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  return (
    <PageLayout title="Result PINs" subtitle="PINs parents use on your public /results checker">
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18, marginBottom: 18, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', fontFamily: FONT }}>
        <div style={{ minWidth: 200 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 5 }}>Exam</div>
          <select value={gen.exam_id} onChange={(e) => setGen({ ...gen, exam_id: e.target.value })} style={inputStyle}>
            <option value="">— select exam —</option>
            {exams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 180 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 5 }}>Class (blank = whole school)</div>
          <select value={gen.class_id} onChange={(e) => setGen({ ...gen, class_id: e.target.value })} style={inputStyle}>
            <option value="">All classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ width: 110 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 5 }}>Max checks</div>
          <input type="number" min="1" value={gen.max_uses} onChange={(e) => setGen({ ...gen, max_uses: e.target.value })} style={inputStyle} />
        </div>
        <button onClick={generate} disabled={busy} style={{ padding: '11px 22px', borderRadius: 9, border: 'none', background: AMBER, color: WHITE, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: FONT, display: 'inline-flex', gap: 8, alignItems: 'center', opacity: busy ? .6 : 1 }}>
          <KeyRound size={15} /> {busy ? 'Generating…' : 'Generate PINs'}
        </button>
        {msg && <div style={{ fontSize: 12.5, fontWeight: 700, color: msg.includes('🎉') ? GREEN : PURPLE, width: '100%' }}>{msg}</div>}
      </div>
      <ResourcePage key={reload} embedded title="" resource="result-pins" canCreate={false} canEdit={false}
        columns={[
          { key: 'pin', label: 'PIN', render: (r) => <b style={{ fontFamily: 'monospace' }}>{r.pin}</b> },
          { key: 'student_id_name', label: 'Student' },
          { key: 'exam_id_name', label: 'Exam' },
          { key: 'used_count', label: 'Used', render: (r) => `${r.used_count}/${r.max_uses}` },
          { key: 'created_at', label: 'Created', render: (r) => new Date(r.created_at).toLocaleDateString('en-NG', { day: '2-digit', month: 'short' }) },
        ]}
        fields={[]} searchKeys={['pin', 'student_id_name', 'exam_id_name']} />
    </PageLayout>
  );
}

/* ── Online Payments ledger ──────────────────────────────────────────────── */
export function OnlinePaymentsPage() {
  return <ResourcePage title="Online Payments" subtitle="Paystack checkouts from your public Pay Fees & Apply pages"
    resource="online-payments" canCreate={false} canEdit={false} canDelete={false}
    columns={[
      { key: 'reference', label: 'Reference', render: (r) => <b style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.reference}</b> },
      { key: 'purpose', label: 'Purpose', render: (r) => pill(r.purpose, { fees: BLUE, admission: PURPLE }) },
      { key: 'student_id_name', label: 'Student' },
      { key: 'amount', label: 'Amount', render: (r) => naira(r.amount) },
      { key: 'email', label: 'Payer Email' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { success: GREEN, pending: AMBER, failed: RED }) },
      { key: 'created_at', label: 'Started', render: (r) => new Date(r.created_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
    ]}
    fields={[]}
    listFilters={[
      { key: 'status', label: 'Status', options: [{ value: 'success', label: 'Success' }, { value: 'pending', label: 'Pending' }, { value: 'failed', label: 'Failed' }] },
      { key: 'purpose', label: 'Purpose', options: [{ value: 'fees', label: 'Fees' }, { value: 'admission', label: 'Admission' }] },
    ]}
    searchKeys={['reference', 'email', 'student_id_name']} />;
}
