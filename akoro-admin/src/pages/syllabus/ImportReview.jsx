/*
 * ImportReview — a syllabus import draft, as the importer read it, for an
 * admin to check before it goes live (Publish writes it into the syllabus the
 * agents teach from; Discard drops it). Topics fold open; each subtopic shows
 * its content, the NOTES column and any objectives.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, FileText, X, Send, Trash2 } from 'lucide-react';
import { Btn, Skeleton } from '../../components/Primitives.jsx';
import { apiGet, apiPost, apiDelete } from '../../services/api.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, PURPLE, FONT } from '../../constants.js';
import { confirmDialog } from '../../components/ConfirmHost.jsx';

const chip = (bg, color) => ({ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: bg, color, fontFamily: FONT, whiteSpace: 'nowrap' });

function Stat({ label, value }) {
  return (
    <div style={{ flex: '1 1 90px', background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: INK, fontFamily: FONT }}>{value ?? '—'}</div>
      <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>{label}</div>
    </div>
  );
}

function Topic({ topic, index, open, onToggle }) {
  const objectives = topic.subtopics.reduce((n, s) => n + (s.objectives?.length || 0), 0);
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, background: WHITE, overflow: 'hidden' }}>
      <button type="button" onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: open ? '#FAF8F5' : WHITE, border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: FONT }}>
        {open ? <ChevronDown size={16} color={MUTED} /> : <ChevronRight size={16} color={MUTED} />}
        <span style={{ fontSize: 12, fontWeight: 800, color: MUTED, minWidth: 22 }}>{index + 1}</span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 800, color: INK }}>{topic.title}</span>
        {topic.section && <span style={chip(`${PURPLE}12`, PURPLE)}>{topic.section}</span>}
        <span style={{ fontSize: 12, color: MUTED }}>{topic.subtopics.length} subtopics{objectives ? ` · ${objectives} objectives` : ''}</span>
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${BORDER}` }}>
          {topic.subtopics.map((s, i) => (
            <div key={i} style={{ padding: '11px 14px 11px 48px', borderTop: i ? `1px solid ${BORDER}` : 'none', display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 14 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, fontFamily: FONT }}>{s.title}</div>
                {s.content && <div style={{ fontSize: 12.5, color: INK, opacity: 0.85, marginTop: 4, lineHeight: 1.55, fontFamily: FONT }}>{s.content.split('; ').map((part, k) => <div key={k}>{part}</div>)}</div>}
                {s.objectives?.length > 0 && (
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: INK, lineHeight: 1.5, fontFamily: FONT }}>{s.objectives.map((o, k) => <li key={k}>{o}</li>)}</ul>
                )}
              </div>
              <div style={{ minWidth: 0, fontSize: 12, color: MUTED, lineHeight: 1.55, fontFamily: FONT, borderLeft: `2px solid ${s.notes ? `${AMBER}55` : 'transparent'}`, paddingLeft: 10 }}>
                {s.notes ? <><div style={{ fontSize: 10.5, fontWeight: 800, color: AMBER, textTransform: 'uppercase', marginBottom: 2 }}>Notes</div>{s.notes}</> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ImportReview({ importId, onClose, onChanged, show }) {
  const [row, setRow] = useState(null);
  const [open, setOpen] = useState(() => new Set([0]));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => apiGet(`/api/adaptive/syllabus/imports/${importId}`).then((r) => { if (alive) setRow(r?.data || null); }).catch((e) => show?.(e.message, 'error'));
    load();
    const t = setInterval(() => { if (row?.status === 'extracting') load(); }, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [importId, row?.status]);   // eslint-disable-line react-hooks/exhaustive-deps

  const doc = row?.doc;
  const st = row?.stats || {};
  const papers = doc?.paper_structure?.papers || [];
  const publish = async () => {
    if (!await confirmDialog(`Publish “${doc.exam} ${doc.name}”? It replaces any live ${doc.exam} ${doc.name} syllabus the agents teach from.`)) return;
    setBusy(true);
    try { const r = await apiPost(`/api/adaptive/syllabus/imports/${importId}/publish`, {}); show?.(`Published — ${r?.data?.topics ?? ''} topics, ${r?.data?.subtopics ?? ''} subtopics`); onChanged?.(); onClose(); }
    catch (e) { show?.(e.message || 'Publish failed', 'error'); }
    finally { setBusy(false); }
  };
  const discard = async () => {
    if (!await confirmDialog('Discard this import? Nothing live changes.')) return;
    try { await apiDelete(`/api/adaptive/syllabus/imports/${importId}`); onChanged?.(); onClose(); } catch (e) { show?.(e.message, 'error'); }
  };

  return (
    <div role="dialog" aria-label="Syllabus import review" style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,.45)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '28px 16px', overflowY: 'auto' }}>
      <div style={{ width: 'min(980px, 100%)', background: '#F7F5F2', borderRadius: 18, boxShadow: '0 20px 60px rgba(0,0,0,.25)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', background: WHITE, borderBottom: `1px solid ${BORDER}` }}>
          <FileText size={20} color={AMBER} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: INK, fontFamily: FONT }}>{doc ? `${doc.exam} · ${doc.name}` : 'Syllabus import'}{doc?.code ? <span style={{ color: MUTED, fontWeight: 600 }}> · {doc.code}</span> : null}</div>
            <div style={{ fontSize: 12, color: MUTED, fontFamily: FONT }}>{row?.source_file || ''}{row?.created_at ? ` · imported ${new Date(row.created_at).toLocaleString()}` : ''}</div>
          </div>
          {row && <span style={chip(row.status === 'draft' ? `${AMBER}18` : row.status === 'published' ? `${GREEN}18` : '#E5E7EB', row.status === 'draft' ? AMBER : row.status === 'published' ? GREEN : MUTED)}>{row.status === 'draft' ? 'Draft — not live' : row.status}</span>}
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: MUTED }}><X size={18} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!row ? <Skeleton height={200} /> : row.status === 'extracting' ? (
            <div style={{ padding: 30, textAlign: 'center', color: MUTED, fontFamily: FONT }}>Reading the syllabus… {row.progress?.done != null ? `part ${row.progress.done} of ${row.progress.of}` : ''}</div>
          ) : row.status === 'failed' ? (
            <div style={{ padding: 16, borderRadius: 12, background: '#FEF2F2', color: '#991B1B', fontFamily: FONT, fontSize: 13 }}>{row.error}</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Stat label="Pages read" value={st.pages} />
                <Stat label="Topics" value={st.topics} />
                <Stat label="Subtopics" value={st.subtopics} />
                <Stat label="With notes" value={st.withNotes} />
                <Stat label="Objectives" value={st.objectives} />
              </div>

              {(row.warnings || []).length > 0 ? (
                <div style={{ padding: '11px 14px', borderRadius: 12, background: '#FEF3C7', border: '1px solid #FDE68A', fontFamily: FONT }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800, color: '#92400E' }}><AlertTriangle size={14} color="#D97706" /> Check before publishing</div>
                  {row.warnings.map((w, i) => <div key={i} style={{ fontSize: 12.5, color: '#92400E', marginTop: 4 }}>{w.text}</div>)}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: GREEN, fontFamily: FONT }}><CheckCircle2 size={14} /> Every page was read; no problems found. Skim the topics below, then publish.</div>
              )}

              {(doc.aims || papers.length > 0) && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                  {doc.aims && (
                    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', marginBottom: 6, fontFamily: FONT }}>Aims</div>
                      <div style={{ fontSize: 12.5, color: INK, lineHeight: 1.6, fontFamily: FONT }}>{doc.aims.split('; ').map((a, i) => <div key={i}>{a}</div>)}</div>
                    </div>
                  )}
                  {papers.length > 0 && (
                    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', marginBottom: 6, fontFamily: FONT }}>Scheme of examination</div>
                      {papers.map((p, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', borderTop: i ? `1px solid ${BORDER}` : 'none', fontFamily: FONT }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: INK, minWidth: 64 }}>{p.name}</div>
                          <div style={{ fontSize: 12.5, color: INK }}>
                            {[p.type, p.questions ? `${p.questions} questions` : null, p.marks ? `${p.marks} marks` : null, p.duration_min ? `${p.duration_min} min` : null].filter(Boolean).join(' · ')}
                            {p.notes && <div style={{ color: MUTED, fontSize: 12 }}>{p.notes}</div>}
                          </div>
                        </div>
                      ))}
                      {(doc.sections || []).length > 0 && <div style={{ marginTop: 8, fontSize: 12, color: MUTED, fontFamily: FONT }}>{doc.sections.map((s) => `${s.name}: ${s.for}`).join(' · ')}</div>}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK, fontFamily: FONT }}>Topics</div>
                <button type="button" onClick={() => setOpen(open.size === doc.topics.length ? new Set() : new Set(doc.topics.map((_, i) => i)))} style={{ border: 'none', background: 'none', color: AMBER, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: FONT }}>{open.size === doc.topics.length ? 'Collapse all' : 'Expand all'}</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {doc.topics.map((t, i) => (
                  <Topic key={i} topic={t} index={i} open={open.has(i)} onToggle={() => setOpen((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
                ))}
              </div>
            </>
          )}
        </div>

        {row?.status === 'draft' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '14px 20px', background: WHITE, borderTop: `1px solid ${BORDER}`, position: 'sticky', bottom: 0 }}>
            <Btn variant="secondary" onClick={discard} disabled={busy}><Trash2 size={14} style={{ marginRight: 6 }} />Discard</Btn>
            <Btn variant="primary" onClick={publish} disabled={busy}><Send size={14} style={{ marginRight: 6 }} />{busy ? 'Publishing…' : 'Publish to the syllabus'}</Btn>
          </div>
        )}
      </div>
    </div>
  );
}
