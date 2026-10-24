import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, ClipboardList, UserCheck, GraduationCap, Presentation, NotebookPen, Library as LibraryIcon } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal } from '../components/Primitives.jsx';
import ExamResources, { useExamResources } from '../components/library/ExamResources.jsx';
import { apiGet, apiDelete } from '../services/api.js';
import { GREEN } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';
import Loading from "../components/Loading.jsx";

const FONTF = C.font;

/* kind → display config */
const KINDS = [
  { key: 'all',        label: 'All',          icon: LibraryIcon, ti: 'ti-books' },
  { key: 'lesson_plan',label: 'Lesson Plans', icon: NotebookPen, ti: 'ti-notebook' },
  { key: 'worksheet',  label: 'Worksheets',   icon: FileText, ti: 'ti-file-text' },
  { key: 'report',     label: 'Reports',      icon: ClipboardList, ti: 'ti-clipboard-list' },
  { key: 'assessment', label: 'Assessments',  icon: GraduationCap, ti: 'ti-school' },
  { key: 'attendance', label: 'Attendance',   icon: UserCheck, ti: 'ti-user-check' },
  { key: 'interactive',label: 'Interactive',  icon: Presentation, ti: 'ti-presentation' },
  // What the teaching tools save when the agent runs them from chat.
  { key: 'podcast',        label: 'Podcasts',       ti: 'ti-headphones' },
  { key: 'lesson-hooks',   label: 'Lesson hooks',   ti: 'ti-bulb' },
  { key: 'misconceptions', label: 'Misconceptions', ti: 'ti-brain' },
  { key: 'real-world',     label: 'Real-world',     ti: 'ti-world' },
  { key: 'vocabulary',     label: 'Vocabulary',     ti: 'ti-letter-case' },
  { key: 'activity',       label: 'Activity packs', ti: 'ti-sparkles' },
  { key: 'assignment',     label: 'Assignment sheets', ti: 'ti-pencil' },
];
const CREATE_STARTS = [
  { label: 'Lesson plan', fill: 'Make a lesson plan on  for JSS1, 40 minutes' },
  { label: 'Podcast', fill: 'Make a 5 minute podcast about  for ' },
  { label: 'Lesson hooks', fill: 'Give me lesson hooks for ' },
  { label: 'Vocabulary list', fill: 'Make a vocabulary list for ' },
];
const isTeaching = (row) => String(row?.tool || '').startsWith('teaching_');
const KIND_META = Object.fromEntries(KINDS.map((k) => [k.key, k]));
KIND_META['lesson-plan'] = KIND_META.lesson_plan;   // the teaching tool's key for the same thing

const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
};

/* ─── Detail renderer (per kind) ──────────────────────────────────── */
function ArtifactDetail({ output }) {
  const c = output?.content || {};
  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 11, fontWeight: 900, color: C.brand, letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 6px' }}>{title}</p>
      {children}
    </div>
  );
  const List = ({ items }) => (
    <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {(items || []).map((it, i) => <li key={i} style={{ fontSize: 13, color: C.ink, lineHeight: 1.5 }}>{it}</li>)}
    </ul>
  );

  switch (output?.kind) {
    case 'lesson_plan':
      return (
        <div>
          {c.objectives?.length > 0 && <Section title="Objectives"><List items={c.objectives} /></Section>}
          {c.lessonHook && <Section title="Lesson Hook"><p style={{ fontSize: 13, color: C.ink, margin: 0, lineHeight: 1.55 }}>{c.lessonHook}</p></Section>}
          {c.materials?.length > 0 && <Section title="Materials"><List items={c.materials} /></Section>}
          {c.phases?.length > 0 && (
            <Section title="Lesson Flow">
              {c.phases.map((p, i) => (
                <div key={i} style={{ marginBottom: 8, padding: '8px 12px', background: C.bg, borderRadius: 10 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{p.name} · {p.minutes} min</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{p.activity}</div>
                </div>
              ))}
            </Section>
          )}
          {c.differentiation && (
            <Section title="Differentiation">
              <p style={{ fontSize: 13, color: C.ink, margin: 0 }}><b>Support:</b> {c.differentiation.support}</p>
              <p style={{ fontSize: 13, color: C.ink, margin: '4px 0 0' }}><b>Stretch:</b> {c.differentiation.stretch}</p>
            </Section>
          )}
          {c.realWorldConnections?.length > 0 && <Section title="Real World Connections"><List items={c.realWorldConnections} /></Section>}
          {c.commonMisconceptions?.length > 0 && <Section title="Common Misconceptions"><List items={c.commonMisconceptions} /></Section>}
          {c.assessment && <Section title="Assessment"><p style={{ fontSize: 13, color: C.ink, margin: 0 }}>{c.assessment}</p></Section>}
          {c.homework && <Section title="Homework"><p style={{ fontSize: 13, color: C.ink, margin: 0 }}>{c.homework}</p></Section>}
        </div>
      );
    case 'worksheet':
    case 'assessment':
      return (
        <div>
          {c.instructions && <p style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>{c.instructions}</p>}
          {c.realWorldConnections?.length > 0 && <Section title="Real World Connections"><List items={c.realWorldConnections} /></Section>}
          {c.commonMisconceptions?.length > 0 && <Section title="Common Misconceptions"><List items={c.commonMisconceptions} /></Section>}
          {(c.questions || []).map((q, i) => (
            <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{q.n}. {q.question} {q.marks ? <span style={{ color: C.muted2, fontWeight: 600 }}>({q.marks} mks)</span> : null}</div>
              {q.options?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 5 }}>
                  {q.options.map((o, j) => <span key={j} style={{ fontSize: 12.5, color: C.muted }}>{o}</span>)}
                </div>
              )}
              {q.answer && <div style={{ fontSize: 12.5, color: GREEN, marginTop: 5, fontWeight: 600 }}>✓ {q.answer}</div>}
              {q.markScheme && <div style={{ fontSize: 12, color: C.muted2, marginTop: 3 }}>Mark scheme: {q.markScheme}</div>}
            </div>
          ))}
        </div>
      );
    case 'report':
      return (
        <div>
          <Section title="Comment"><p style={{ fontSize: 14, color: C.ink, lineHeight: 1.6, margin: 0 }}>{c.comment}</p></Section>
          {c.strengths?.length > 0 && <Section title="Strengths"><List items={c.strengths} /></Section>}
          {c.targets?.length > 0 && <Section title="Targets"><List items={c.targets} /></Section>}
        </div>
      );
    case 'attendance':
      return (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: GREEN, background: `${GREEN}15`, padding: '4px 10px', borderRadius: 8 }}>{c.present} present</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.muted, background: C.bg, padding: '4px 10px', borderRadius: 8 }}>{c.absent} absent</span>
          </div>
          {(c.register || []).map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 13, color: C.ink }}>{s.name}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: s.present ? GREEN : C.muted2 }}>{s.present ? 'Present' : 'Absent'}</span>
            </div>
          ))}
        </div>
      );
    case 'interactive':
      return (
        <div>
          {c.gamma?.url && <a href={c.gamma.url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginBottom: 14, fontSize: 13, fontWeight: 800, color: C.brand }}>Open in Gamma →</a>}
          {(c.slides || []).map((s, i) => (
            <div key={i} style={{ marginBottom: 10, padding: '10px 12px', background: C.bg, borderRadius: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{s.n}. {s.heading}</div>
              {s.bullets?.length > 0 && <List items={s.bullets} />}
              {s.activity && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{s.activity}</div>}
              {s.checkQuestion && <div style={{ fontSize: 12, color: C.muted2, marginTop: 2 }}>{s.checkQuestion}</div>}
            </div>
          ))}
        </div>
      );
    default:
      return <pre style={{ fontSize: 12, color: C.muted, whiteSpace: 'pre-wrap' }}>{JSON.stringify(c, null, 2)}</pre>;
  }
}

/* ─── Main page ───────────────────────────────────────────────────── */
export default function LibraryPage() {
  const navigate = useNavigate();
  const exam = useExamResources();
  const [tab, setTab]         = useState('resources');   // resources | exam
  const [kind, setKind]       = useState('all');
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]       = useState(null);   // full artifact in modal
  const [openLoading, setOpenLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    // Lesson plans were saved as `lesson_plan` before the teaching tools and as `lesson-plan` since.
    const kinds = kind === 'all' ? [''] : kind === 'lesson_plan' ? ['lesson_plan', 'lesson-plan'] : [kind];
    Promise.all(kinds.map((k) => apiGet(`/api/instructor/tools/outputs${k ? `?kind=${k}` : ''}`).then((res) => res.outputs || [])))
      .then((lists) => setItems(lists.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  const removeOutput = async (row, e) => {
    e.stopPropagation();
    setItems((xs) => xs.filter((x) => x.id !== row.id));
    try { await apiDelete(`/api/teaching/tools/outputs/${row.id}`); } catch { load(); }
  };

  const openArtifact = async (row) => {
    // A teaching tool's result is a page of its own, like an activity.
    if (isTeaching(row)) { navigate(`/library/${row.id}`); return; }
    setOpenLoading(true);
    setOpen({ ...row });
    try {
      const res = await apiGet(`/api/instructor/tools/outputs/${row.id}`);
      setOpen(res.output);
    } catch { /* keep the row-level data */ }
    finally { setOpenLoading(false); }
  };

  return (
    <PageLayout
      title="Library"
      subtitle="What your agent has created, and your exam resources"
      action={<Btn size="sm" onClick={() => navigate('/chat', { state: { prefill: '' } })}><Ico ti="ti-sparkles" size={14} /> Create in chat</Btn>}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* Resources / Exam resources */}
        <div role="tablist" style={{ display: 'flex', background: C.surface, borderRadius: 12, padding: 4, marginBottom: 16, border: `1px solid ${C.border}`, gap: 4 }}>
          {[['resources', 'My resources'], ['exam', `Exam resources${exam.items && exam.items.length ? ` (${exam.items.length})` : ''}`]].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{
              flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', background: tab === k ? C.brand : 'transparent',
              color: tab === k ? '#fff' : C.muted2, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONTF,
            }}>{label}</button>
          ))}
        </div>

        {tab === 'exam' && <ExamResources items={exam.items} />}

        {/* Kind filter */}
        {tab === 'resources' && <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 8, marginBottom: 16, scrollbarWidth: 'none' }}>
          {KINDS.map((k) => {
            const active = kind === k.key;
            return (
              <button key={k.key} onClick={() => setKind(k.key)} style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 20,
                border: `1.5px solid ${active ? C.brand : C.border}`, background: active ? tint(10) : C.surface,
                color: active ? C.brand : C.muted, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONTF, whiteSpace: 'nowrap',
              }}>
                <Ico lucide={k.icon} ti={k.ti} size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{k.label}
              </button>
            );
          })}
        </div>}

        {/* List */}
        {tab === 'resources' && (loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2, 3].map((i) => <div key={i} style={{ height: 64, borderRadius: 14, background: C.tagBg, animation: 'pulse-dot 1.5s ease-in-out infinite' }} />)}
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '56px 24px', color: C.muted2 }}>
            <Ico ti="ti-books" size={40} color="#D1D5DB" style={{ marginBottom: 14 }} />
            <p style={{ fontSize: 15, fontWeight: 700, color: C.muted, margin: '0 0 4px' }}>Nothing saved yet</p>
            <p style={{ fontSize: 13, margin: '0 0 14px' }}>Ask your agent to create a lesson plan, podcast or hooks — it'll appear here.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {CREATE_STARTS.map((c) => (
                <button key={c.label} onClick={() => navigate('/chat', { state: { prefill: c.fill } })} style={{ padding: '6px 13px', borderRadius: 20, border: `1.5px solid ${C.border}`, background: C.surface, color: C.brand, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONTF }}>{c.label}</button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((row) => {
              const meta = KIND_META[row.kind] || { label: row.kind };
              return (
                <button key={row.id} onClick={() => openArtifact(row)} style={{
                  display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', width: '100%',
                  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '13px 15px',
                  cursor: 'pointer', fontFamily: FONTF, boxShadow: '0 1px 4px rgba(0,0,0,.04)',
                }}>
                  <div style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 11, background: tint(7), display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico lucide={meta.icon} ti={meta.ti || 'ti-file-text'} size={20} color={C.brand} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title || meta.label}</div>
                    <div style={{ fontSize: 12, color: C.muted2, marginTop: 2 }}>{meta.label}{row.subject ? ` · ${row.subject}` : ''} · {fmtDate(row.created_at)}</div>
                  </div>
                  {isTeaching(row) && <span role="button" tabIndex={0} title="Delete" aria-label="Delete" onClick={(e) => removeOutput(row, e)} style={{ color: C.muted2, padding: 6, display: 'flex', flexShrink: 0 }}><Ico ti="ti-trash" size={15} /></span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Detail modal */}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.title || (KIND_META[open.kind] || {}).label || 'Artifact'}` : ''} width={600}>
        {openLoading && !open?.content ? (
          <Loading label="Loading the resource…" />
        ) : open ? <ArtifactDetail output={open} /> : null}
      </Modal>
    </PageLayout>
  );
}
