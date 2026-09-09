/**
 * SelfStudyPage — assign an AI self-study topic to learners.
 *
 * The flow mirrors how a teacher actually plans: name the topic, let the AI
 * draft the subtopics and objectives, EDIT them (nothing is assigned until you
 * approve it), then choose who gets it — one learner, several, or the whole
 * class. Each learner then works through it with their own agent, and what they
 * produce is an ordinary agent session, so it shows up in their Sessions list
 * and feeds revision like everything else.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Plus, BookOpen, Sparkles, Users, Clock, Trash2, Pencil, ChevronRight,
  Search, Loader2, X, CheckCircle2,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Txa, Sel, Badge, Toast } from '../components/Primitives.jsx';
import PlanEditor from '../components/PlanEditor.jsx';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';
import AudiencePicker, { audienceBody, parseHandles, BLANK_AUDIENCE } from '../components/AudiencePicker.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, RED, FONT } from '../constants.js';
import { confirmDialog } from '../components/ConfirmHost.jsx';

const SUBJECTS = [
  'Mathematics', 'English Language', 'Basic Science', 'Basic Technology',
  'Social Studies', 'Civic Education', 'Agricultural Science', 'Computer Studies',
  'Business Studies', 'Biology', 'Chemistry', 'Physics', 'Geography', 'History',
];

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ── Create / edit modal ─────────────────────────────────────────────────── */
const BLANK = {
  title: '', subject: 'Basic Science', topic: '', instructions: '',
  difficulty: 'intermediate', dueAt: '', classId: '',
  audience: BLANK_AUDIENCE,
  subtopics: [], objectives: {},
};

function AssignModal({ open, onClose, onSubmit, editing }) {
  const [form, setForm]   = useState(BLANK);
  const [classes, setClasses] = useState([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setClassesLoading(true);
    apiGet('/api/instructor/classrooms')
      .then(d => setClasses(d?.data ?? []))
      .catch(() => setClasses([]))
      .finally(() => setClassesLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setForm({
        ...BLANK,
        title: editing.title || '', subject: editing.subject || 'Basic Science',
        topic: editing.topic || '', instructions: editing.instructions || '',
        difficulty: editing.difficulty || 'intermediate',
        dueAt: toLocalInput(editing.due_at),
        classId: editing.classroom_id || '',
        subtopics: editing.subtopics ?? [], objectives: editing.objectives ?? {},
      });
    } else {
      setForm({ ...BLANK, classId: classes[0]?.id || '' });
    }
  }, [open, editing, classes]);

  const draft = async () => {
    if (!form.topic.trim()) return setError('Enter a topic first — that is what the plan is built from.');
    setError(''); setDrafting(true);
    try {
      const d = await apiPost('/api/self-study/plan', { topic: form.topic.trim(), subject: form.subject });
      const p = d?.data ?? {};
      setForm(f => ({
        ...f,
        subtopics: p.subtopics ?? [],
        objectives: p.objectives ?? {},
        title: f.title || `${f.topic.trim()} — self study`,
      }));
    } catch (e) {
      setError(e?.message || 'Could not draft the plan. You can still add subtopics yourself.');
    } finally {
      setDrafting(false);
    }
  };


  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) return setError('Give the assignment a title.');
    if (!form.topic.trim()) return setError('Enter the topic learners will study.');
    if (!editing && !form.classId) return setError('Pick a class.');
    if (!editing) {
      const aud = form.audience;
      if (aud.mode === 'class' && !aud.classroomId) return setError('Pick which class this is for.');
      if (aud.mode === 'picked' && !(aud.selected.length + parseHandles(aud.typed).length))
        return setError('Choose at least one learner, or send it to a course or class.');
    }
    if (!form.subtopics.filter(s => s.trim()).length)
      return setError('The plan needs at least one subtopic — draft it or add one.');

    setLoading(true);
    try { await onSubmit(form); onClose(); }
    catch (err) { setError(err?.message || 'Could not save the assignment.'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit self study' : 'New AI self study'} width={580}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Sel label="Subject *" value={form.subject} onChange={e => setField('subject', e.target.value)}>
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </Sel>
          <Sel label="Difficulty" value={form.difficulty} onChange={e => setField('difficulty', e.target.value)}>
            <option value="easy">Easy</option>
            <option value="intermediate">Medium</option>
            <option value="hard">Hard</option>
          </Sel>
        </div>

        <Inp label="Topic *" value={form.topic} onChange={e => setField('topic', e.target.value)} placeholder="e.g. Photosynthesis" />
        <Inp label="Title *" value={form.title} onChange={e => setField('title', e.target.value)} placeholder="What learners will see" />
        <Txa label="Instructions to learners" value={form.instructions} onChange={e => setField('instructions', e.target.value)}
          placeholder="e.g. Work through this before Friday's lesson." rows={2} />

        {/* Plan */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT }}>Study plan *</div>
            <Btn size="sm" variant="secondary" type="button" onClick={draft} disabled={drafting}>
              {drafting
                ? <><Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> Drafting…</>
                : <><Sparkles size={13} /> {form.subtopics.length ? 'Redraft with AI' : 'Draft with AI'}</>}
            </Btn>
          </div>
          <PlanEditor
            subtopics={form.subtopics} objectives={form.objectives}
            onChange={(subtopics, objectives) => setForm(f => ({ ...f, subtopics, objectives }))}
          />
          <div style={{ fontSize: 10.5, color: MUTED2, fontFamily: FONT, marginTop: 6 }}>
            Nothing is assigned until you save — edit or remove anything the AI drafted.
          </div>
        </div>

        {/* Who — a class, then who within it. Self study needs no course: it is
            a topic a learner works through with their own agent, not something
            attached to an enrolment. Asking for a course made teachers pick one
            that had nothing to do with the work. */}
        {!editing && (
          <div>
            <Sel label="Class *" value={form.classId} onChange={e => setField('classId', e.target.value)}>
              {classesLoading && <option value="">Loading classes…</option>}
              {!classesLoading && !classes.length && <option value="">No classes set up yet</option>}
              {classes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.student_count ? ` — ${c.student_count} learner${c.student_count === 1 ? '' : 's'}` : ''}
                </option>
              ))}
            </Sel>
            {!classesLoading && !classes.length && (
              <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT, marginTop: 5 }}>
                Create one under Academics → Classes, then come back.
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <AudiencePicker
                value={form.audience}
                onChange={(v) => setField('audience', v)}
                modes={['course', 'picked']}
                allLabel={{ label: 'Everyone in the class', hint: 'All active members' }}
                rosterUrl={form.classId ? `/api/instructor/classrooms/${form.classId}/students` : null}
              />
            </div>
          </div>
        )}

        <Inp label="Due (optional)" type="datetime-local" value={form.dueAt} onChange={e => setField('dueAt', e.target.value)} />

        {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700, fontFamily: FONT }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={loading}>{loading ? 'Saving…' : editing ? 'Save changes' : 'Assign'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ── Per-learner progress drawer ─────────────────────────────────────────── */
function DetailModal({ open, onClose, assignmentId }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!open || !assignmentId) { setData(null); return; }
    apiGet(`/api/self-study/${assignmentId}`).then(d => setData(d?.data ?? null)).catch(() => setData(null));
  }, [open, assignmentId]);

  const STATUS = {
    assigned: { color: MUTED,  bg: LIGHT,     label: 'Not started' },
    started:  { color: BLUE,   bg: '#EFF6FF', label: 'In progress' },
    complete: { color: GREEN,  bg: '#DCFCE7', label: 'Complete' },
  };

  return (
    <Modal open={open} onClose={onClose} title={data?.title || 'Self study'} width={500}>
      {!data ? (
        <div style={{ fontSize: 13, color: MUTED, fontFamily: FONT, padding: '10px 0' }}>Loading…</div>
      ) : (
        <div style={{ fontFamily: FONT }}>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
            {data.subject} · {data.topic} · {(data.subtopics ?? []).length} subtopics
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
            {(data.targets ?? []).map(t => {
              const s = STATUS[t.status] || STATUS.assigned;
              return (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px',
                  border: `1px solid ${BORDER}`, borderRadius: 10, background: WHITE,
                }}>
                  <span style={{ fontSize: 16 }}>{t.emoji || '🧑‍🎓'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{t.full_name}</div>
                    <div style={{ fontSize: 11, color: MUTED }}>@{t.username}</div>
                  </div>
                  <Badge color={s.color} bg={s.bg}>{s.label}</Badge>
                </div>
              );
            })}
            {(data.targets ?? []).length === 0 && (
              <div style={{ fontSize: 12, color: MUTED, padding: '10px 0' }}>Nobody is assigned yet.</div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ── Card ────────────────────────────────────────────────────────────────── */
function AssignmentCard({ a, onOpen, onEdit, onDelete }) {
  const p = a.progress ?? { assigned: 0, started: 0, complete: 0 };
  const pct = p.assigned ? Math.round((p.complete / p.assigned) * 100) : 0;
  const due = a.due_at ? new Date(a.due_at) : null;
  const overdue = due && due < new Date() && p.complete < p.assigned;

  return (
    <div style={{
      background: WHITE, border: `1px solid ${overdue ? '#FECACA' : BORDER}`,
      borderRadius: 16, padding: '18px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: `${PURPLE}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <BookOpen size={19} color={PURPLE} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK, fontFamily: FONT }}>{a.title}</div>
          <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>{a.subject} · {a.topic}</div>
        </div>
        <button onClick={() => onEdit(a)} title="Edit"
          style={{ background: 'none', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '5px 6px', cursor: 'pointer', color: MUTED, display: 'flex' }}>
          <Pencil size={13} />
        </button>
        <button onClick={() => onDelete(a)} title="Delete"
          style={{ background: 'none', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '5px 6px', cursor: 'pointer', color: RED, display: 'flex' }}>
          <Trash2 size={13} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Badge color={BLUE} bg="#EFF6FF"><Users size={10} style={{ marginRight: 2 }} />{p.assigned} assigned</Badge>
        <Badge color={AMBER} bg="#FFF7ED">{p.started} in progress</Badge>
        <Badge color={GREEN} bg="#DCFCE7"><CheckCircle2 size={10} style={{ marginRight: 2 }} />{p.complete} done</Badge>
        {due && (
          <Badge color={overdue ? RED : MUTED} bg={overdue ? '#FEE2E2' : LIGHT}>
            <Clock size={10} style={{ marginRight: 2 }} />
            {due.toLocaleDateString()} {due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Badge>
        )}
      </div>

      <div style={{ height: 6, borderRadius: 3, background: LIGHT, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${AMBER}, ${GREEN})`, transition: 'width .3s' }} />
      </div>

      <Btn size="sm" variant="secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => onOpen(a)}>
        See who's done it <ChevronRight size={13} />
      </Btn>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function SelfStudyPage() {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail]   = useState(null);
  const [toast, setToast]     = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    try {
      const d = await apiGet('/api/self-study');
      setItems(d?.data ?? []);
    } catch (e) {
      console.warn('Self study API error:', e);
      setItems([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (form) => {
    const dueIso = form.dueAt ? new Date(form.dueAt).toISOString() : null;
    const clean = form.subtopics.map(s => s.trim()).filter(Boolean);
    const objectives = {};
    for (const st of clean) objectives[st] = (form.objectives[st] ?? []).map(o => o.trim()).filter(Boolean);

    const body = {
      title: form.title.trim(), subject: form.subject, topic: form.topic.trim(),
      subtopics: clean, objectives,
      instructions: form.instructions || null,
      difficulty: form.difficulty, due_at: dueIso,
    };

    if (editing) {
      await apiPatch(`/api/self-study/${editing.id}`, body);
      showToast('Self study updated');
    } else {
      const d = await apiPost('/api/self-study', {
        ...body,
        // The class is the scope; audienceBody says who within it. "Everyone"
        // resolves against classroom_id, so it has to travel with the target
        // rather than sit beside it.
        ...(() => {
          const t = audienceBody(form.audience);
          return { ...t, classroom_id: t.whole_class ? form.classId : null };
        })(),
      });
      showToast(`Assigned to ${d?.data?.assigned ?? 0} learner${d?.data?.assigned === 1 ? '' : 's'}`);
    }
    setEditing(null);
    load();
  };

  const handleDelete = async (a) => {
    if (!await confirmDialog(`Delete “${a.title}”? Learners keep any session they already started.`)) return;
    const before = items;
    setItems(is => is.filter(x => x.id !== a.id));
    try { await apiDelete(`/api/self-study/${a.id}`); showToast('Assignment deleted'); }
    catch (e) { setItems(before); showToast(e?.message || 'Could not delete it', 'error'); }
  };

  const openNew  = () => { setEditing(null); setModal(true); };
  const openEdit = (a) => { setEditing(a); setModal(true); };

  const totals = items.reduce((acc, a) => {
    const p = a.progress ?? {};
    acc.assigned += p.assigned ?? 0; acc.started += p.started ?? 0; acc.complete += p.complete ?? 0;
    return acc;
  }, { assigned: 0, started: 0, complete: 0 });

  return (
    <PageLayout
      title="AI Self Study"
      subtitle="Assign a topic for learners to work through with their own AI agent"
      action={<Btn size="sm" onClick={openNew}><Plus size={14} /> New self study</Btn>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Assignments', value: items.length, color: PURPLE },
          { label: 'Learners assigned', value: totals.assigned, color: BLUE },
          { label: 'In progress', value: totals.started, color: AMBER },
          { label: 'Completed', value: totals.complete, color: GREEN },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: FONT }}>{loading ? '—' : value}</div>
            <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>{label}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 210, borderRadius: 16 }} />)}
        </div>
      ) : items.length === 0 ? (
        <div style={{ background: WHITE, border: `1px dashed ${BORDER}`, borderRadius: 16, padding: '48px', textAlign: 'center' }}>
          <BookOpen size={32} color={MUTED} style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 6px', fontWeight: 700 }}>No self study assigned yet</p>
          <p style={{ fontSize: 12.5, color: MUTED2, fontFamily: FONT, margin: '0 0 16px', maxWidth: 420, marginInline: 'auto', lineHeight: 1.55 }}>
            Pick a topic, let the AI draft the subtopics and objectives, edit them, then send it to
            one learner or the whole class. Each learner works through it with their own agent.
          </p>
          <Btn onClick={openNew}><Plus size={14} /> Create your first one</Btn>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {items.map(a => (
            <AssignmentCard key={a.id} a={a} onOpen={x => setDetail(x.id)} onEdit={openEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <AssignModal
        open={modal} onClose={() => { setModal(false); setEditing(null); }}
        onSubmit={handleSubmit} editing={editing}
      />
      <DetailModal open={!!detail} onClose={() => setDetail(null)} assignmentId={detail} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
