/**
 * PastQuestionsPage — the past questions & answers bank.
 *
 * Three views, because the work has three shapes:
 *   Papers  — browse and filter what's in the bank, add a paper, publish it
 *   Paper   — every question in one paper, edit answers, verify, delete
 *   Review  — the cross-paper queue of unverified questions
 *
 * VERIFICATION is the spine of this screen. Anything the vision parser wrote
 * lands unverified and is held out of student practice, so the review queue is
 * where a person turns a machine guess into an answer key. That is why the
 * verify control is one click and always visible, rather than buried in an edit
 * form.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Library, Plus, Search, CheckCircle2, AlertTriangle, Trash2, Upload, Loader2,
  ArrowLeft, Image as ImageIcon, Sparkles, FileText, Filter,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Inp, Sel, Txa, Modal, Toast, Badge, Skeleton } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiPatch, apiDelete, API } from '../services/api.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../constants.js';
import { confirmDialog } from '../components/ConfirmHost.jsx';

const STATUS_COLOR = { draft: MUTED, review: AMBER, published: GREEN };
const DIFFICULTY = ['', 'easy', 'medium', 'hard'];

// Figures are served from the API's static /uploads, so a stored path needs the
// API origin in front of it. Absolute URLs (R2 and friends) pass through.
const imgSrc = (u) => (!u ? null : /^https?:\/\//i.test(u) ? u : `${API}${u}`);

export default function PastQuestionsPage() {
  const [view, setView] = useState('papers');       // papers | paper | review
  const [paperId, setPaperId] = useState(null);
  const [toast, setToast] = useState(null);
  const say = (message, type = 'success') => setToast({ message, type });

  return (
    <PageLayout
      title="Past Questions"
      subtitle="WAEC · NECO · JAMB · NCEE — the question bank agents and students draw from"
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[['papers', 'Papers', Library], ['review', 'Review queue', AlertTriangle]].map(([k, label, Icon]) => (
          <button key={k} onClick={() => { setView(k); setPaperId(null); }} style={tab(view === k)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {view === 'papers' && !paperId && (
        <Papers onOpen={(id) => { setPaperId(id); setView('paper'); }} onToast={say} />
      )}
      {view === 'paper' && paperId && (
        <Paper id={paperId} onBack={() => { setPaperId(null); setView('papers'); }} onToast={say} />
      )}
      {view === 'review' && <ReviewQueue onToast={say} />}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

/* ══════════════════════ Papers ══════════════════════ */

function Papers({ onOpen, onToast }) {
  const [exams, setExams] = useState([]);
  const [papers, setPapers] = useState(null);
  const [exam, setExam] = useState('');
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [embedding, setEmbedding] = useState(false);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (exam) qs.set('exam', exam);
    if (status) qs.set('status', status);
    apiGet(`/api/past-questions/papers?${qs}`).then((r) => setPapers(r.data || [])).catch(() => setPapers([]));
  }, [exam, status]);

  useEffect(() => {
    apiGet('/api/past-questions/exams').then((r) => setExams(r.data || [])).catch(() => setExams([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Questions written by SQL seed carry no embedding, so they're invisible to
  // semantic search until this runs. Bounded per call, hence the loop.
  const reembed = async () => {
    setEmbedding(true);
    try {
      let total = 0, remaining = 1, guard = 0;
      while (remaining > 0 && guard++ < 40) {
        const r = await apiPost('/api/past-questions/reembed', { limit: 100 });
        total += r.data?.embedded || 0;
        remaining = r.data?.remaining ?? 0;
        if (!r.data?.embedded) break;      // nothing moving — stop rather than spin
      }
      onToast(`Embedded ${total} question${total === 1 ? '' : 's'}${remaining ? ` · ${remaining} still to go` : ''}`);
    } catch (e) { onToast(e.message || 'Could not embed', 'error'); }
    finally { setEmbedding(false); }
  };

  return (
    <>
      {/* Exam catalog */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10, marginBottom: 22 }}>
        {exams.map((e) => (
          <button key={e.slug} onClick={() => setExam(exam === e.slug ? '' : e.slug)}
            style={{ ...card, textAlign: 'left', cursor: 'pointer', borderColor: exam === e.slug ? AMBER : BORDER, padding: '13px 15px' }}>
            <div style={{ fontSize: 20 }}>{e.emoji}</div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: INK, marginTop: 4 }}>{e.name}</div>
            <div style={{ fontSize: 11.5, color: MUTED }}>
              {e.paperCount ? `${e.paperCount} paper${e.paperCount === 1 ? '' : 's'}` : 'No papers yet'}
            </div>
            {e.years?.length > 0 && (
              <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{e.years.slice(0, 4).join(' · ')}</div>
            )}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <Filter size={15} color={MUTED} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={select}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="review">In review</option>
          <option value="published">Published</option>
        </select>
        {exam && <Badge color={AMBER}>{exam.toUpperCase()} <span onClick={() => setExam('')} style={{ cursor: 'pointer' }}>×</span></Badge>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Btn variant="secondary" onClick={reembed} disabled={embedding}>
            {embedding ? <Loader2 size={14} style={spinStyle} /> : <Sparkles size={14} />} Rebuild search index
          </Btn>
          <Btn onClick={() => setAdding(true)}><Plus size={14} /> New paper</Btn>
        </div>
      </div>

      {papers === null ? <Skeleton height={180} />
        : papers.length === 0 ? <Empty text="No papers match those filters." />
        : (
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
              <thead>
                <tr style={{ background: LIGHT }}>
                  {['Exam', 'Year', 'Paper', 'Subject', 'Status', ''].map((h) => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {papers.map((p) => (
                  <tr key={p.id} style={{ borderTop: `1px solid ${BORDER}`, cursor: 'pointer' }} onClick={() => onOpen(p.id)}>
                    <td style={td}><b>{p.exam_slug?.toUpperCase()}</b></td>
                    <td style={td}>{p.year}</td>
                    <td style={td}>{p.title}{p.variant ? <span style={{ color: MUTED }}> · {p.variant}</span> : null}</td>
                    <td style={{ ...td, color: MUTED }}>{p.subject || '—'}</td>
                    <td style={td}><Badge color={STATUS_COLOR[p.status]}>{p.status}</Badge></td>
                    <td style={{ ...td, textAlign: 'right', color: MUTED, fontSize: 12 }}>Open →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <NewPaperModal open={adding} exams={exams} onClose={() => setAdding(false)}
        onSaved={(p) => { setAdding(false); onToast('Paper created'); onOpen(p.id); }} onToast={onToast} />
    </>
  );
}

function NewPaperModal({ open, exams, onClose, onSaved, onToast }) {
  const [f, setF] = useState({ examSlug: 'ncee', year: new Date().getFullYear(), title: '', subject: '', variant: '', paperCode: '', durationMin: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.title.trim()) return onToast('Give the paper a title', 'error');
    setBusy(true);
    try {
      const r = await apiPost('/api/past-questions/papers', { ...f, year: Number(f.year), durationMin: Number(f.durationMin) || null });
      onSaved(r.data);
    } catch (e) { onToast(e.message || 'Could not create', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New paper">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Sel label="Exam" value={f.examSlug} onChange={(e) => setF({ ...f, examSlug: e.target.value })}>
          {exams.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
        </Sel>
        <Inp label="Year" type="number" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} />
        <div style={{ gridColumn: '1 / -1' }}>
          <Inp label="Title" placeholder="Paper I — Achievement Test" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        <Inp label="Subject (optional)" placeholder="Leave blank for multi-subject papers" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
        <Inp label="Variant" placeholder="Aptitude" value={f.variant} onChange={(e) => setF({ ...f, variant: e.target.value })} />
        <Inp label="Paper code" placeholder="Paper I" value={f.paperCode} onChange={(e) => setF({ ...f, paperCode: e.target.value })} />
        <Inp label="Duration (min)" type="number" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy}>{busy ? 'Creating…' : 'Create'}</Btn>
      </div>
    </Modal>
  );
}

/* ══════════════════════ One paper ══════════════════════ */

function Paper({ id, onBack, onToast }) {
  const [paper, setPaper] = useState(null);
  const [ingesting, setIngesting] = useState(false);

  const load = useCallback(() => {
    apiGet(`/api/past-questions/papers/${id}`).then((r) => setPaper(r.data)).catch(() => setPaper(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (status) => {
    try { await apiPatch(`/api/past-questions/papers/${id}`, { status }); setPaper((p) => ({ ...p, status })); onToast(`Paper set to ${status}`); }
    catch (e) { onToast(e.message || 'Could not update', 'error'); }
  };

  if (paper === false) return <Empty text="That paper could not be loaded." />;
  if (!paper) return <Skeleton height={300} />;

  const qs = paper.questions || [];
  const unverified = qs.filter((q) => !q.verified).length;
  const unanswered = qs.filter((q) => !q.answer).length;
  const bySection = {};
  for (const q of qs) (bySection[q.section_id || 'none'] ||= []).push(q);
  const passageById = Object.fromEntries((paper.passages || []).map((p) => [p.id, p]));

  return (
    <>
      <button onClick={onBack} style={{ ...ghost, marginBottom: 14 }}><ArrowLeft size={13} /> All papers</button>

      <div style={{ ...card, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: INK }}>
              {paper.exam_slug?.toUpperCase()} {paper.year} — {paper.title}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>
              {qs.length} questions · {qs.length - unanswered} answered · {qs.length - unverified} verified
              {paper.meta?.answer_source && <> · <i>{paper.meta.answer_source}</i></>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Badge color={STATUS_COLOR[paper.status]}>{paper.status}</Badge>
            {paper.status !== 'published'
              ? <Btn onClick={() => setStatus('published')}>Publish</Btn>
              : <Btn variant="secondary" onClick={() => setStatus('draft')}>Unpublish</Btn>}
            <Btn variant="secondary" onClick={() => setIngesting(true)}><Upload size={14} /> Ingest scan</Btn>
          </div>
        </div>

        {unverified > 0 && (
          <div style={warn}>
            <AlertTriangle size={14} color={AMBER} />
            {unverified} question{unverified === 1 ? '' : 's'} not yet verified — these are hidden from student practice until checked.
          </div>
        )}
      </div>

      {(paper.sections || []).map((s) => (
        <div key={s.id} style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: INK, marginBottom: 3 }}>
            {s.part ? `${s.part} · ` : ''}{s.title}
          </div>
          {s.instructions && <div style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>{s.instructions}</div>}
          {(bySection[s.id] || []).map((q) => (
            <QuestionRow key={q.id} q={q} passage={passageById[q.passage_id]} onChanged={load} onToast={onToast} />
          ))}
        </div>
      ))}

      {bySection.none?.length > 0 && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: INK, marginBottom: 8 }}>Unsectioned</div>
          {bySection.none.map((q) => <QuestionRow key={q.id} q={q} onChanged={load} onToast={onToast} />)}
        </div>
      )}

      <IngestModal open={ingesting} paperId={id} onClose={() => setIngesting(false)}
        onImported={() => { setIngesting(false); load(); }} onToast={onToast} />
    </>
  );
}

function QuestionRow({ q, passage, onChanged, onToast }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(q);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(q); }, [q]);

  const save = async (patch) => {
    setBusy(true);
    try {
      await apiPatch(`/api/past-questions/questions/${q.id}`, patch);
      onToast('Saved');
      onChanged();
    } catch (e) { onToast(e.message || 'Could not save', 'error'); }
    finally { setBusy(false); }
  };

  const del = async () => {
    if (!await confirmDialog(`Delete question ${q.number}? This cannot be undone.`)) return;
    try { await apiDelete(`/api/past-questions/questions/${q.id}`); onToast('Deleted'); onChanged(); }
    catch (e) { onToast(e.message || 'Could not delete', 'error'); }
  };

  return (
    <div style={{ ...card, padding: '12px 15px', marginBottom: 8, borderColor: q.verified ? BORDER : `${AMBER}66` }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 30, fontSize: 13, fontWeight: 900, color: MUTED, flexShrink: 0 }}>{q.number}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.55 }}>{q.stem}</div>

          {q.image_url && (
            <img src={imgSrc(q.image_url)} alt="figure"
              style={{ maxWidth: 260, marginTop: 8, border: `1px solid ${BORDER}`, borderRadius: 8, background: WHITE }} />
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {(q.options || []).map((o) => (
              <span key={o.label} style={{
                fontSize: 11.5, padding: '3px 9px', borderRadius: 7,
                background: q.answer === o.label ? `${GREEN}18` : LIGHT,
                color: q.answer === o.label ? GREEN : MUTED,
                fontWeight: q.answer === o.label ? 800 : 600,
              }}>{o.label}. {o.text}</span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 9, flexWrap: 'wrap', fontSize: 11.5, color: MUTED }}>
            {q.verified
              ? <Badge color={GREEN}>verified</Badge>
              : <Badge color={AMBER}>needs review</Badge>}
            {!q.answer && <Badge color={RED}>no answer</Badge>}
            {q.topic && <span>{q.topic}</span>}
            {q.difficulty && <span>· {q.difficulty}</span>}
            {passage && <span>· {passage.label}</span>}
            <button onClick={() => setOpen((v) => !v)} style={{ ...linkBtn, marginLeft: 'auto' }}>{open ? 'Close' : 'Edit'}</button>
            {!q.verified && q.answer && (
              <button onClick={() => save({ verified: true })} disabled={busy} style={{ ...linkBtn, color: GREEN }}>
                <CheckCircle2 size={12} /> Verify
              </button>
            )}
            <button onClick={del} style={{ ...linkBtn, color: RED }}><Trash2 size={12} /></button>
          </div>

          {open && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}`, display: 'grid', gap: 10 }}>
              <Txa label="Question" rows={2} value={f.stem || ''} onChange={(e) => setF({ ...f, stem: e.target.value })} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 }}>
                <Sel label="Answer" value={f.answer || ''} onChange={(e) => setF({ ...f, answer: e.target.value })}>
                  <option value="">— none —</option>
                  {(q.options || []).map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
                </Sel>
                <Sel label="Difficulty" value={f.difficulty || ''} onChange={(e) => setF({ ...f, difficulty: e.target.value })}>
                  {DIFFICULTY.map((d) => <option key={d} value={d}>{d || '— none —'}</option>)}
                </Sel>
                <Inp label="Topic" value={f.topic || ''} onChange={(e) => setF({ ...f, topic: e.target.value })} />
                <Inp label="Subject" value={f.subject || ''} onChange={(e) => setF({ ...f, subject: e.target.value })} />
              </div>
              <Txa label="Explanation" rows={3} value={f.explanation || ''} onChange={(e) => setF({ ...f, explanation: e.target.value })} />
              <Inp label="Figure URL" placeholder="/uploads/past-questions/…" value={f.image_url || ''} onChange={(e) => setF({ ...f, image_url: e.target.value })} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Btn variant="secondary" onClick={() => { setF(q); setOpen(false); }}>Cancel</Btn>
                <Btn disabled={busy} onClick={() => save({
                  stem: f.stem, answer: f.answer || null, explanation: f.explanation || null,
                  difficulty: f.difficulty || null, topic: f.topic || null, subject: f.subject || null,
                  imageUrl: f.image_url || null,
                })}>{busy ? 'Saving…' : 'Save'}</Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════ Ingest a scan ══════════════════════ */

function IngestModal({ open, paperId, onClose, onImported, onToast }) {
  const [file, setFile] = useState(null);
  const [range, setRange] = useState({ from: 1, to: 4 });
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [ingestId, setIngestId] = useState(null);
  const fileRef = useRef(null);

  const reset = () => { setFile(null); setParsed(null); setIngestId(null); setRange({ from: 1, to: 4 }); };

  const parse = async () => {
    if (!file) return onToast('Attach the scanned PDF first', 'error');
    setBusy(true); setParsed(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('pageFrom', range.from);
      fd.append('pageTo', range.to);
      const res = await fetch(`${API}/api/past-questions/papers/${paperId}/ingest`, {
        method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'admin' }, body: fd,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Ingest failed');
      setParsed(j.data);
      setIngestId(j.data?.ingestId || null);
    } catch (e) { onToast(e.message || 'Could not parse', 'error'); }
    finally { setBusy(false); }
  };

  const importIt = async () => {
    setBusy(true);
    try {
      const r = await apiPost(`/api/past-questions/ingests/${ingestId}/import`, { parsed });
      onToast(`Imported ${r.data?.imported || 0} questions — all unverified until checked`);
      reset(); onImported();
    } catch (e) { onToast(e.message || 'Could not import', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Ingest a scanned paper" width={640}>
      <p style={{ fontSize: 12.5, color: MUTED, marginTop: 0 }}>
        Scanned papers have no text layer, so pages are rasterised and read by the vision model — up to
        8 pages a pass. Nothing is written until you review the parse and import it, and everything
        imported stays unverified until a person checks it.
      </p>

      <input ref={fileRef} type="file" accept="application/pdf" style={{ display: 'none' }}
        onChange={(e) => { setFile(e.target.files?.[0] || null); setParsed(null); }} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Btn variant="secondary" onClick={() => fileRef.current?.click()}>
          <FileText size={14} /> {file ? file.name.slice(0, 28) : 'Choose PDF'}
        </Btn>
        <Inp label="From page" type="number" containerStyle={{ width: 110 }} value={range.from}
          onChange={(e) => setRange({ ...range, from: Number(e.target.value) })} />
        <Inp label="To page" type="number" containerStyle={{ width: 110 }} value={range.to}
          onChange={(e) => setRange({ ...range, to: Number(e.target.value) })} />
        <Btn onClick={parse} disabled={busy || !file}>
          {busy && !parsed ? <Loader2 size={14} style={spinStyle} /> : <Sparkles size={14} />} Parse pages
        </Btn>
      </div>

      {parsed && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${BORDER}`, paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: INK, marginBottom: 8 }}>
            Found {parsed.questions?.length || 0} questions
            {parsed.sections?.length ? ` · ${parsed.sections.length} sections` : ''}
            {parsed.passages?.length ? ` · ${parsed.passages.length} passages` : ''}
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', border: `1px solid ${BORDER}`, borderRadius: 10, padding: 12, background: LIGHT }}>
            {(parsed.questions || []).map((q, i) => (
              <div key={i} style={{ marginBottom: 10, fontSize: 12.5 }}>
                <b>{q.number}.</b> {q.stem}
                {q.isDiagram && <Badge color={PURPLE} style={{ marginLeft: 6 }}>diagram</Badge>}
                <div style={{ color: MUTED, marginTop: 3 }}>
                  {(q.options || []).map((o) => `${o.label}. ${o.text}`).join('   ')}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <Btn variant="secondary" onClick={() => setParsed(null)}>Discard</Btn>
            <Btn onClick={importIt} disabled={busy || !ingestId}>{busy ? 'Importing…' : 'Import as unverified'}</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ══════════════════════ Review queue ══════════════════════ */

function ReviewQueue({ onToast }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    apiGet('/api/past-questions/review')
      .then((r) => setRows((r.data || []).map((q) => ({ ...q, paper: q.past_papers || {} }))))
      .catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const verify = async (id) => {
    try { await apiPatch(`/api/past-questions/questions/${id}`, { verified: true }); setRows((p) => p.filter((x) => x.id !== id)); onToast('Verified'); }
    catch (e) { onToast(e.message || 'Could not verify', 'error'); }
  };

  if (rows === null) return <Skeleton height={220} />;
  const filtered = q ? rows.filter((r) => (r.stem || '').toLowerCase().includes(q.toLowerCase())) : rows;

  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <Search size={15} color={MUTED} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by wording…" style={{ ...select, flex: 1, maxWidth: 320 }} />
        <span style={{ fontSize: 12.5, color: MUTED, marginLeft: 'auto' }}>{filtered.length} awaiting review</span>
      </div>

      {filtered.length === 0
        ? <Empty text="Nothing waiting — every question in the bank has been checked." />
        : filtered.map((r) => (
          <div key={r.id} style={{ ...card, padding: '12px 15px', marginBottom: 8, borderColor: `${AMBER}66` }}>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 4 }}>
              {r.paper.exam_slug?.toUpperCase()} {r.paper.year} · {r.paper.title} · Q{r.number}
            </div>
            <div style={{ fontSize: 13.5, color: INK }}>{r.stem}</div>
            {r.image_url && (
              <img src={imgSrc(r.image_url)} alt="figure"
                style={{ maxWidth: 240, marginTop: 8, border: `1px solid ${BORDER}`, borderRadius: 8 }} />
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {(r.options || []).map((o) => (
                <span key={o.label} style={{ fontSize: 11.5, padding: '3px 9px', borderRadius: 7, background: r.answer === o.label ? `${GREEN}18` : LIGHT, color: r.answer === o.label ? GREEN : MUTED }}>
                  {o.label}. {o.text}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 9 }}>
              {r.answer
                ? <span style={{ fontSize: 12, color: GREEN, fontWeight: 800 }}>Proposed answer: {r.answer}</span>
                : <span style={{ fontSize: 12, color: RED, fontWeight: 800 }}>No answer — open the paper to set one</span>}
              {r.answer && (
                <button onClick={() => verify(r.id)} style={{ ...linkBtn, color: GREEN, marginLeft: 'auto' }}>
                  <CheckCircle2 size={13} /> Verify
                </button>
              )}
            </div>
          </div>
        ))}
    </>
  );
}

/* ══════════════════════ bits ══════════════════════ */

const Empty = ({ text }) => (
  <div style={{ ...card, textAlign: 'center', padding: '46px 20px', color: MUTED, fontSize: 13.5 }}>
    <ImageIcon size={22} color={BORDER} style={{ marginBottom: 8 }} />
    <div>{text}</div>
  </div>
);

const card = { background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18, fontFamily: FONT };
const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: .5 };
const td = { padding: '11px 14px', fontSize: 13, color: INK };
const tab = (on) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: `1px solid ${on ? AMBER : BORDER}`, background: on ? `${AMBER}12` : WHITE, color: on ? AMBER : MUTED, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT });
const ghost = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 9, border: `1px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT };
const linkBtn = { display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: BLUE, fontSize: 11.5, fontWeight: 800, fontFamily: FONT, padding: 0 };
const spinStyle = { animation: 'spin .8s linear infinite' };
const select = { padding: '8px 12px', borderRadius: 9, border: `1px solid ${BORDER}`, fontSize: 13, fontFamily: FONT, color: INK, background: WHITE };
const warn = { display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, padding: '9px 12px', borderRadius: 9, background: `${AMBER}0F`, border: `1px solid ${AMBER}33`, color: INK, fontSize: 12.5, fontWeight: 600 };
