/** Certificates + Communicate module pages (mgmt schema). */
import { useState, useEffect } from 'react';
import { Award, Loader2, Printer, Megaphone } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';

const BASE = '/api/school/mgmt';
const pill = (v, map) => {
  const c = map[v] || MUTED2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: `${c}15`, color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{String(v).replace('_', ' ')}</span>;
};
const AUDIENCES = ['all', 'students', 'staff', 'parents'].map((a) => ({ value: a, label: a[0].toUpperCase() + a.slice(1) }));

/* ═══ Certificates ═══ */
export function CertificateTemplatesPage() {
  return <ResourcePage title="Certificate Templates" subtitle="Reusable document templates — use {{recipient_name}}, {{school_name}}, {{date}}, {{serial_no}}" resource="certificate-templates"
    columns={[{ key: 'name', label: 'Template' }, { key: 'description', label: 'Description' }]}
    fields={[
      { key: 'name', label: 'Template Name', required: true },
      { key: 'description', label: 'Description' },
      { key: 'body', label: 'Template Body', type: 'textarea', full: true, placeholder: 'This certifies that {{recipient_name}} …' },
    ]} createLabel="New Template" />;
}

export function GenerateDocumentPage() {
  const [templates, setTemplates] = useState([]);
  const [students, setStudents] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const loadHistory = () => apiGet(`${BASE}/generated-documents`).then((r) => setHistory(r.data || [])).catch(() => {});
  useEffect(() => {
    apiGet(`${BASE}/certificate-templates`).then((r) => setTemplates(r.data || [])).catch(() => {});
    apiGet(`${BASE}/students?status=active`).then((r) => setStudents(r.data || [])).catch(() => {});
    loadHistory();
  }, []);

  const generate = async () => {
    if (!templateId) return showToast('Pick a template');
    if (!studentId && !recipient.trim()) return showToast('Pick a student or type a recipient name');
    setBusy(true);
    try {
      const res = await apiPost(`${BASE}/certificates/generate`, {
        template_id: templateId, student_id: studentId || undefined, recipient_name: recipient.trim() || undefined,
      });
      setResult(res.data); loadHistory();
    } catch (e) { showToast(e.message || 'Could not generate'); }
    finally { setBusy(false); }
  };

  const lbl = { fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 5 };
  return (
    <PageLayout title="Generate Document" subtitle="Issue a certificate from a template">
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', maxWidth: 420, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '20px 22px' }}>
          <label style={lbl}>Template</label>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 12 }}>
            <option value="">— select template —</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label style={lbl}>Student</label>
          <select value={studentId} onChange={(e) => { setStudentId(e.target.value); setRecipient(''); }} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 12 }}>
            <option value="">— optional —</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.admission_no})</option>)}
          </select>
          <label style={lbl}>Or recipient name</label>
          <input value={recipient} onChange={(e) => { setRecipient(e.target.value); setStudentId(''); }} placeholder="e.g. Mrs. Grace Okon" style={{ ...inputStyle, marginBottom: 16 }} />
          <button onClick={generate} disabled={busy} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: busy ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: busy ? '#9CA3AF' : WHITE, fontSize: 13.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: FONT }}>
            {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Award size={14} />} Generate
          </button>
        </div>

        <div style={{ flex: '1.3 1 360px' }}>
          {result && (
            <div style={{ background: WHITE, border: `2px solid ${AMBER}55`, borderRadius: 16, padding: '28px 26px', marginBottom: 16, fontFamily: FONT }}>
              <div style={{ textAlign: 'center', marginBottom: 14 }}>
                <Award size={30} color={AMBER} />
                <p style={{ fontSize: 16, fontWeight: 800, color: INK, margin: '6px 0 0' }}>{result.template_name}</p>
                <p style={{ fontSize: 11, color: MUTED2, margin: '2px 0 0' }}>Serial: {result.serial_no}</p>
              </div>
              <p style={{ fontSize: 14, color: INK, lineHeight: 1.8, margin: 0, textAlign: 'center' }}>{result.body}</p>
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <button onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                  <Printer size={13} /> Print
                </button>
              </div>
            </div>
          )}
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, fontFamily: FONT, fontSize: 13, fontWeight: 800, color: INK }}>Issued Documents ({history.length})</div>
            {history.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: MUTED2, fontSize: 12.5, fontFamily: FONT }}>Nothing issued yet.</div>
            ) : history.slice(0, 12).map((d) => (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 16px', borderBottom: `1px solid ${BORDER}`, fontFamily: FONT, fontSize: 12.5 }}>
                <span style={{ fontWeight: 700, color: INK }}>{d.recipient_name}</span>
                <span style={{ color: MUTED2 }}>{d.template_name || '—'} · {d.serial_no}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

/* ═══ Communicate ═══ */
export function NoticeBoardPage() {
  return <ResourcePage title="Notice Board" subtitle="School-wide announcements" resource="notices"
    columns={[
      { key: 'title', label: 'Notice' },
      { key: 'audience', label: 'Audience', render: (r) => pill(r.audience, { all: BLUE, students: GREEN, staff: PURPLE, parents: AMBER }) },
      { key: 'publish_on', label: 'Published' }, { key: 'expires_on', label: 'Expires' }, { key: 'pinned', label: 'Pinned' },
    ]}
    fields={[
      { key: 'title', label: 'Title', required: true },
      { key: 'audience', label: 'Audience', type: 'select', default: 'all', options: AUDIENCES },
      { key: 'publish_on', label: 'Publish On', type: 'date' },
      { key: 'expires_on', label: 'Expires On', type: 'date' },
      { key: 'pinned', label: 'Pin to Top', type: 'toggle' },
      { key: 'body', label: 'Notice Body', type: 'textarea', full: true },
    ]} listFilters={[{ key: 'audience', label: 'Audience', options: AUDIENCES }]} createLabel="New Notice" />;
}

export function EventsHolidaysPage() {
  const TYPES = [{ value: 'event', label: 'Event' }, { value: 'holiday', label: 'Holiday' }];
  return <ResourcePage title="Events & Holidays" subtitle="School calendar" resource="school-events"
    columns={[
      { key: 'title', label: 'Title' },
      { key: 'event_type', label: 'Type', render: (r) => pill(r.event_type, { event: BLUE, holiday: GREEN }) },
      { key: 'starts_on', label: 'Starts' }, { key: 'ends_on', label: 'Ends' },
    ]}
    fields={[
      { key: 'title', label: 'Title', required: true },
      { key: 'event_type', label: 'Type', type: 'select', default: 'event', options: TYPES },
      { key: 'starts_on', label: 'Starts On', type: 'date' },
      { key: 'ends_on', label: 'Ends On', type: 'date' },
      { key: 'description', label: 'Description', type: 'textarea', full: true },
    ]} listFilters={[{ key: 'event_type', label: 'Type', options: TYPES }]} createLabel="New Entry" />;
}

const BROADCAST_COLUMNS = [
  { key: 'title', label: 'Broadcast' },
  { key: 'channel', label: 'Channel', render: (r) => pill(r.channel, { in_app: BLUE, sms: GREEN, email: PURPLE, whatsapp: GREEN }) },
  { key: 'audience', label: 'Audience' },
  { key: 'status', label: 'Status', render: (r) => pill(r.status, { draft: AMBER, sent: GREEN }) },
];
const BROADCAST_FIELDS = [
  { key: 'title', label: 'Title', required: true },
  { key: 'channel', label: 'Channel', type: 'select', default: 'in_app', options: [{ value: 'in_app', label: 'In-App' }, { value: 'sms', label: 'SMS' }, { value: 'email', label: 'Email' }, { value: 'whatsapp', label: 'WhatsApp' }] },
  { key: 'audience', label: 'Audience', type: 'select', default: 'all', options: AUDIENCES },
  { key: 'status', label: 'Status', type: 'select', default: 'draft', options: [{ value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' }] },
  { key: 'message', label: 'Message', type: 'textarea', required: true, full: true },
];

export function ComposeBroadcastPage() {
  return <ResourcePage title="Compose Broadcast" subtitle="Send a message to your community" resource="broadcasts"
    columns={BROADCAST_COLUMNS} fields={BROADCAST_FIELDS} createLabel="Compose Broadcast" startOpen />;
}

export function BroadcastHistoryPage() {
  return <ResourcePage title="Broadcast History" subtitle="Previously composed messages" resource="broadcasts"
    columns={BROADCAST_COLUMNS} fields={BROADCAST_FIELDS}
    listFilters={[{ key: 'status', label: 'Status', options: [{ value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' }] }]}
    createLabel="Compose Broadcast" />;
}

export function ImageGalleryPage() {
  return <ResourcePage title="Image Gallery" subtitle="School photo albums" resource="gallery-images"
    columns={[
      { key: 'image_url', label: 'Preview', render: (r) => r.image_url ? <img src={r.image_url} alt="" style={{ width: 52, height: 38, objectFit: 'cover', borderRadius: 6 }} /> : '—' },
      { key: 'title', label: 'Title' }, { key: 'album', label: 'Album' }, { key: 'taken_on', label: 'Taken' },
    ]}
    fields={[
      { key: 'title', label: 'Title', required: true },
      { key: 'album', label: 'Album', placeholder: 'Sports Day 2026' },
      { key: 'taken_on', label: 'Taken On', type: 'date' },
      { key: 'image_url', label: 'Image URL', full: true, placeholder: 'https://…' },
    ]} createLabel="Add Image" searchKeys={['title', 'album']} />;
}
