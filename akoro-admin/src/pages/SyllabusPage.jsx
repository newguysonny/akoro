import { useState, useEffect, useCallback } from 'react';
import { BookMarked, Upload, FileText, Table2, PenLine, Trash2, Plus } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiDelete, API } from '../services/api.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../constants.js';

const EXAMS = ['WASSCE', 'JAMB', 'NECO', 'GCE', 'Other'];

// ── Tiny CSV parser (handles quoted fields, embedded commas/newlines) ────────
function parseCSV(text) {
  const rows = []; let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// CSV columns: exam, subject, code, topic, subtopic, content, objectives(; sep)
function csvToDocs(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('CSV has no data rows');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const ix = (k) => head.indexOf(k);
  const need = ['subject', 'topic', 'subtopic'];
  for (const n of need) if (ix(n) < 0) throw new Error(`CSV missing column: ${n}`);
  const bySubject = {};
  for (const r of rows.slice(1)) {
    const exam = (r[ix('exam')] || 'WASSCE').trim();
    const subject = (r[ix('subject')] || '').trim(); if (!subject) continue;
    const key = `${exam}|${subject}`;
    const doc = (bySubject[key] ??= { exam, name: subject, code: (r[ix('code')] || '').trim() || undefined, topics: [], _tmap: {} });
    const topicTitle = (r[ix('topic')] || '').trim() || 'General';
    let topic = doc._tmap[topicTitle];
    if (!topic) { topic = { title: topicTitle, subtopics: [] }; doc._tmap[topicTitle] = topic; doc.topics.push(topic); }
    const objs = (r[ix('objectives')] || '').split(';').map((s) => s.trim()).filter(Boolean);
    topic.subtopics.push({
      title: (r[ix('subtopic')] || '').trim(),
      content: (r[ix('content')] || '').trim() || undefined,
      objectives: objs.length ? objs : undefined,
    });
  }
  return Object.values(bySubject).map(({ _tmap, ...d }) => d);
}

// Manual mini-format:  "# Topic" then "- Subtopic | content | obj1; obj2"
function parseTopics(text) {
  const topics = []; let cur = null;
  for (const raw of text.split('\n')) {
    const t = raw.trim(); if (!t) continue;
    if (t.startsWith('#')) { cur = { title: t.replace(/^#+/, '').trim(), subtopics: [] }; topics.push(cur); }
    else if (t.startsWith('-') && cur) {
      const p = t.replace(/^-/, '').split('|').map((s) => s.trim());
      cur.subtopics.push({ title: p[0], content: p[1] || undefined, objectives: p[2] ? p[2].split(';').map((s) => s.trim()).filter(Boolean) : undefined });
    }
  }
  return topics;
}

export default function SyllabusPage() {
  const [subjects, setSubjects] = useState(null);
  const [modal, setModal] = useState(false);
  const [method, setMethod] = useState('pdf');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  // form state
  const [exam, setExam] = useState('WASSCE');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [aims, setAims] = useState('');
  const [topicsText, setTopicsText] = useState('');
  const [file, setFile] = useState(null);

  const show = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 4000); };

  const load = useCallback(async () => {
    try { const r = await apiGet('/api/adaptive/syllabus/subjects'); setSubjects(r?.data ?? r ?? []); }
    catch (e) { setSubjects([]); show(e.message || 'Failed to load', 'error'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const reset = () => { setName(''); setCode(''); setAims(''); setTopicsText(''); setFile(null); };

  const ingestDoc = async (doc) => {
    const r = await apiPost('/api/adaptive/syllabus/ingest', { doc });
    return r?.data ?? r;
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (method === 'manual') {
        if (!name.trim()) throw new Error('Subject name is required');
        const topics = parseTopics(topicsText);
        if (!topics.length) throw new Error('Add at least one topic (use "# Topic" lines)');
        const res = await ingestDoc({ exam, name: name.trim(), code: code.trim() || undefined, aims: aims.trim() || undefined, topics });
        show(`Saved ${res.subtopics} subtopics under ${res.topics} topics`);
      } else if (method === 'csv') {
        if (!file) throw new Error('Choose a CSV file');
        const docs = csvToDocs(await file.text());
        let subs = 0; for (const d of docs) { const r = await ingestDoc(d); subs += r.subtopics; }
        show(`Imported ${docs.length} subject(s), ${subs} subtopics`);
      } else {
        if (!file) throw new Error('Choose a PDF file');
        const fd = new FormData();
        fd.append('file', file);
        fd.append('exam', exam);
        if (name.trim()) fd.append('name', name.trim());
        const r = await fetch(`${API}/api/adaptive/syllabus/ingest-pdf`, {
          method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'admin' }, body: fd,
        });
        const j = await r.json();
        if (!r.ok || !j.success) throw new Error(j.message || 'Extraction failed');
        show(`Extracted “${j.data.name}” — ${j.data.topics} topics, ${j.data.subtopics} subtopics`);
      }
      setModal(false); reset(); load();
    } catch (e) { show(e.message || 'Upload failed', 'error'); }
    finally { setBusy(false); }
  };

  const remove = async (slug, name) => {
    if (!window.confirm(`Delete the “${name}” syllabus? This removes its topics and embeddings.`)) return;
    try { await apiDelete(`/api/adaptive/syllabus/${slug}`); setSubjects((s) => s.filter((x) => x.slug !== slug)); show('Deleted'); }
    catch (e) { show(e.message || 'Delete failed', 'error'); }
  };

  const TH = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', padding: '10px 14px', textAlign: 'left', fontFamily: FONT };
  const TD = { fontSize: 13, color: INK, padding: '13px 14px', fontFamily: FONT, borderBottom: `1px solid ${BORDER}` };
  const inp = { width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' };
  const METHODS = [{ k: 'pdf', label: 'PDF', icon: FileText }, { k: 'csv', label: 'CSV', icon: Table2 }, { k: 'manual', label: 'Manual', icon: PenLine }];

  return (
    <PageLayout title="Syllabus" subtitle="Upload WAEC / JAMB / NECO syllabuses — extracted and saved for agents to teach from">
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <Btn variant="primary" onClick={() => { reset(); setModal(true); }}><Plus size={15} style={{ marginRight: 6 }} />Add syllabus</Btn>
        </div>

        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', overflowX: 'auto' }}>
          {subjects === null ? (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>{[1, 2, 3, 4].map((i) => <Skeleton key={i} height={44} />)}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead><tr style={{ background: LIGHT }}>
                <th style={TH}>Exam</th><th style={TH}>Subject</th><th style={TH}>Code</th><th style={TH}>Topics</th><th style={{ ...TH, textAlign: 'right' }}></th>
              </tr></thead>
              <tbody>
                {subjects.length === 0 ? (
                  <tr><td colSpan={5} style={{ ...TD, textAlign: 'center', color: MUTED, borderBottom: 'none', padding: '40px 14px' }}>
                    <BookMarked size={30} style={{ opacity: 0.4, marginBottom: 8 }} /><div>No syllabuses yet — add WAEC, JAMB or NECO to get started.</div>
                  </td></tr>
                ) : subjects.map((s) => (
                  <tr key={`${s.exam}-${s.slug}`}>
                    <td style={TD}><span style={{ fontWeight: 700, fontSize: 11, padding: '2px 8px', borderRadius: 20, background: `${PURPLE}15`, color: PURPLE }}>{s.exam}</span></td>
                    <td style={{ ...TD, fontWeight: 700 }}>{s.name}</td>
                    <td style={{ ...TD, color: MUTED }}>{s.code || '—'}</td>
                    <td style={TD}>{s.topic_count ?? 0}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <button onClick={() => remove(s.slug, s.name)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED }}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={modal} onClose={() => !busy && setModal(false)} title="Add syllabus" width={620}>
        {/* method tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {METHODS.map((m) => (
            <button key={m.k} onClick={() => setMethod(m.k)}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', borderRadius: 10, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 700, border: `1.5px solid ${method === m.k ? AMBER : BORDER}`, background: method === m.k ? `${AMBER}12` : WHITE, color: method === m.k ? AMBER : MUTED }}>
              <m.icon size={15} />{m.label}
            </button>
          ))}
        </div>

        {(method === 'pdf' || method === 'manual') && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <select value={exam} onChange={(e) => setExam(e.target.value)} style={{ ...inp, flex: '0 0 130px' }}>
              {EXAMS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={method === 'pdf' ? 'Subject name (optional — AI infers it)' : 'Subject name (e.g. Physics)'} style={inp} />
          </div>
        )}

        {method === 'manual' && (
          <>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Subject code (optional)" style={{ ...inp, marginBottom: 10 }} />
            <textarea value={aims} onChange={(e) => setAims(e.target.value)} placeholder="Aims / preamble (optional)" rows={2} style={{ ...inp, marginBottom: 10, resize: 'vertical' }} />
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 6, fontFamily: FONT }}>
              Topics — one <b># Topic</b> per line, then <b>- Subtopic | content | objective 1; objective 2</b>
            </div>
            <textarea value={topicsText} onChange={(e) => setTopicsText(e.target.value)} rows={8}
              placeholder={'# Motion\n- Equations of motion | v=u+at, s=ut+½at² | Apply equations of motion; Interpret v–t graphs\n- Newton\'s laws | The three laws | State the three laws; Apply F=ma'}
              style={{ ...inp, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }} />
          </>
        )}

        {method === 'csv' && (
          <>
            <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 10, fontFamily: FONT, lineHeight: 1.6 }}>
              CSV columns: <code>exam, subject, code, topic, subtopic, content, objectives</code> (objectives separated by <code>;</code>). One row per subtopic; rows are grouped into subjects & topics automatically.
            </div>
            <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ fontFamily: FONT, fontSize: 13 }} />
          </>
        )}

        {method === 'pdf' && (
          <>
            <div style={{ fontSize: 12.5, color: MUTED, margin: '4px 0 10px', fontFamily: FONT, lineHeight: 1.6 }}>
              Upload the official syllabus PDF. The text is extracted and structured by AI into topics, subtopics and objectives, then saved. <b>Text-based PDFs only</b> (scanned images won't extract).
            </div>
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ fontFamily: FONT, fontSize: 13 }} />
          </>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <Btn variant="secondary" onClick={() => setModal(false)} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} disabled={busy}>
            <Upload size={14} style={{ marginRight: 6 }} />{busy ? (method === 'pdf' ? 'Extracting…' : 'Saving…') : 'Upload & save'}
          </Btn>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
