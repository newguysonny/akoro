/**
 * ActivitiesPage — create activities and assign them to learners, laid out
 * exactly like Tools & Assets: a left rail of activity types plus a "when to
 * use it" note, a right card holding the creation form, and a full-width strip
 * of past activities underneath.
 *
 * The form is the AI Self Study form generalised: name the topic, let the AI
 * draft the plan, EDIT it (nothing is assigned until you approve), then choose
 * who gets it — one learner, several, or the whole class. Self study, an
 * assignment and a project all build a plan; a live course swaps the plan for
 * a schedule.
 *
 * All four kinds travel through the same endpoint the self-study page has
 * always used (/api/self-study), separated by `type` — so targeting,
 * notifications, per-learner progress and the learner's Activity feed come for
 * free, and past work here reads the same rows that page wrote.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, Pencil, FolderKanban, MonitorPlay, Plus, Users, Clock, Trash2,
  ChevronRight, Sparkles, Loader2, CheckCircle2, Info,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Txa, Sel, Badge, Toast } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';
import AudiencePicker, { audienceBody, parseHandles, BLANK_AUDIENCE } from '../components/AudiencePicker.jsx';
import PlanEditor from '../components/PlanEditor.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, RED, FONT } from '../constants.js';
import { confirmDialog } from '../components/ConfirmHost.jsx';

const SUBJECTS = [
  'Mathematics', 'English Language', 'Basic Science', 'Basic Technology',
  'Social Studies', 'Civic Education', 'Agricultural Science', 'Computer Studies',
  'Business Studies', 'Biology', 'Chemistry', 'Physics', 'Geography', 'History',
];

/* ── The activity types — the rail of the workbench ──────────────────────── */
const ACTIVITY_TYPES = [
  {
    key: 'self_study', emoji: '📖', name: 'Self study', icon: BookOpen, color: PURPLE,
    blurb: 'A topic each learner works through with their own AI agent.',
    note: ['Practice that adapts to each learner.',
      'Assign a topic; every learner gets their own agent session and goes at their own pace. Use it for revision, catch-up after an absence, or stretch work that should not wait for you.'],
    planLabel: 'Study plan',
    planHint: 'Subtopics the learner will move through, in order.',
  },
  {
    key: 'assignment', emoji: '✏️', name: 'Assignment', icon: Pencil, color: BLUE,
    blurb: 'Set work with a deadline and a clear task breakdown.',
    note: ['One measurable check for understanding.',
      'Questions or tasks every learner answers on their own. Use it right after a lesson, when you want evidence of what stuck — the AI drafts the task breakdown, you correct it before anything is sent.'],
    planLabel: 'Task breakdown',
    planHint: 'The tasks or question areas learners must complete.',
  },
  {
    key: 'project', emoji: '🗂️', name: 'Project', icon: FolderKanban, color: GREEN,
    blurb: 'A deliverable learners build over days, not minutes.',
    note: ['When depth matters more than speed.',
      'Research, an artefact, a presentation. Use it when the process is the point: the AI drafts milestones, you set the bar, and learners work toward a finished thing you can assess.'],
    planLabel: 'Milestones & requirements',
    planHint: 'The stages a finished project must pass through.',
  },
  {
    key: 'live_course', emoji: '📺', name: 'Live course', icon: MonitorPlay, color: AMBER,
    blurb: 'You, live, at a scheduled time with a join link.',
    note: ['First exposure belongs to a human.',
      'A scheduled session with a start time and a link. Use it for introducing something new, discussion, and anything learners cannot do alone — then let assignments and self study carry the practice.'],
    planLabel: null,
    planHint: null,
  },
];

const byKey = (k) => ACTIVITY_TYPES.find(t => t.key === k);

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ── Creation form — the AI Self Study form, adapted per type ────────────── */
const BLANK = {
  title: '', subject: 'Basic Science', topic: '', instructions: '',
  difficulty: 'intermediate', dueAt: '', classId: '',
  audience: BLANK_AUDIENCE,
  scheduledAt: '', durationMins: '60',
  subtopics: [], objectives: {},
};

function ActivityForm({ type, onAssigned }) {
  const meta = byKey(type);
  const isLive = type === 'live_course';
  const [form, setForm] = useState(BLANK);
  const [classes, setClasses] = useState([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);      // "Assigned to N learners" banner
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    setDone(null); setError('');               // switching types clears the slate
  }, [type]);

  useEffect(() => {
    setClassesLoading(true);
    apiGet('/api/instructor/classrooms')
      .then(d => setClasses(d?.data ?? []))
      .catch(() => setClasses([]))
      .finally(() => setClassesLoading(false));
  }, []);

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
        title: f.title || `${f.topic.trim()} — ${meta.name.toLowerCase()}`,
      }));
    } catch (e) {
      setError(e?.message || 'Could not draft the plan. You can still add the pieces yourself.');
    } finally { setDrafting(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) return setError('Give it a title.');
    if (!form.topic.trim()) return setError(`Enter the ${isLive ? 'session focus' : 'topic'}.`);
    if (!form.classId) return setError('Pick a class.');
    const aud = form.audience;
    if (aud.mode === 'class' && !aud.classroomId) return setError('Pick which class this is for.');
    if (aud.mode === 'picked' && !(aud.selected.length + parseHandles(aud.typed).length))
      return setError('Choose at least one learner, or send it to the whole class.');
    if (!isLive && !form.subtopics.filter(s => s.trim()).length)
      return setError(`The ${meta.planLabel.toLowerCase()} needs at least one entry — draft it or add one.`);
    if (isLive && !form.scheduledAt) return setError('Pick the date and time the session holds.');

    setSaving(true);
    try {
      const dueIso = form.dueAt ? new Date(form.dueAt).toISOString() : null;
      const clean = form.subtopics.map(s => s.trim()).filter(Boolean);
      const objectives = {};
      for (const st of clean) objectives[st] = (form.objectives[st] ?? []).map(o => o.trim()).filter(Boolean);
      const body = {
        type,
        title: form.title.trim(), subject: form.subject, topic: form.topic.trim(),
        instructions: form.instructions || null,
        due_at: dueIso,
        details: isLive
          ? { scheduled_at: new Date(form.scheduledAt).toISOString(), duration_mins: Number(form.durationMins) || 60 }
          : {},
      };
      if (!isLive) { body.subtopics = clean; body.objectives = objectives; body.difficulty = form.difficulty; }

      const t = audienceBody(form.audience);
      const payload = {
        ...body, ...t,
        // "Everyone" resolves against classroom_id, so it has to travel with
        // the target rather than sit beside it (the self-study rule).
        classroom_id: t.whole_class ? form.classId : null,
      };
      const d = await apiPost('/api/self-study', payload);
      setDone(`Assigned to ${d?.data?.assigned ?? 0} learner${d?.data?.assigned === 1 ? '' : 's'}`);
      setForm({ ...BLANK, classId: form.classId });
      onAssigned();
    } catch (err) {
      setError(err?.message || 'Could not assign it.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: `${meta.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <meta.icon size={19} color={meta.color} />
        </div>
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 900, color: INK }}>New {meta.name.toLowerCase()}</div>
          <div style={{ fontSize: 11.5, color: MUTED }}>{meta.blurb}</div>
        </div>
      </div>

      {done && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px', borderRadius: 10, background: '#DCFCE7', border: '1px solid #BBF7D0', fontSize: 12.5, fontWeight: 800, color: GREEN }}>
          <CheckCircle2 size={14} /> {done}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Sel label="Subject *" value={form.subject} onChange={e => setField('subject', e.target.value)}>
          {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
        </Sel>
        {!isLive && (
          <Sel label="Difficulty" value={form.difficulty} onChange={e => setField('difficulty', e.target.value)}>
            <option value="easy">Easy</option>
            <option value="intermediate">Medium</option>
            <option value="hard">Hard</option>
          </Sel>
        )}
        {isLive && (
          <Sel label="Duration" value={form.durationMins} onChange={e => setField('durationMins', e.target.value)}>
            {['30', '45', '60', '90', '120'].map(m => <option key={m} value={m}>{m} minutes</option>)}
          </Sel>
        )}
      </div>

      <Inp label={isLive ? 'Session focus *' : 'Topic *'} value={form.topic} onChange={e => setField('topic', e.target.value)}
        placeholder={isLive ? 'e.g. Introduction to Algebra' : 'e.g. Photosynthesis'} />
      <Inp label="Title *" value={form.title} onChange={e => setField('title', e.target.value)} placeholder="What learners will see" />
      <Txa label="Instructions to learners" value={form.instructions} onChange={e => setField('instructions', e.target.value)}
        placeholder={isLive ? 'e.g. Join with your notebook — we start on time.' : 'e.g. Work through this before Friday’s lesson.'} rows={2} />

      {/* The plan — self study, assignment and project build one; a live
          course is a moment in the timetable instead. */}
      {!isLive && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT }}>{meta.planLabel} *</div>
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
            {meta.planHint} Nothing is assigned until you save — edit or remove anything the AI drafted.
          </div>
        </div>
      )}

      {isLive && (
        <Inp label="Holds on *" type="datetime-local" value={form.scheduledAt} onChange={e => setField('scheduledAt', e.target.value)} />
      )}

      {/* Who — the class, then who within it. */}
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

      <Inp label="Due (optional)" type="datetime-local" value={form.dueAt} onChange={e => setField('dueAt', e.target.value)} />

      {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700, fontFamily: FONT }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <Btn type="submit" disabled={saving}>
          {saving ? 'Assigning…' : <><Users size={14} /> Assign to learners</>}
        </Btn>
      </div>
    </form>
  );
}

/* ── Past activities — one strip per type, mirroring past generations ────── */
function PastActivities({ type, refreshKey, onOpen }) {
  const meta = byKey(type);
  const [past, setPast] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    // Same rows the AI Self Study page wrote — filtered to this type.
    apiGet('/api/self-study')
      .then(d => setPast((d?.data ?? []).filter(a => (a.type || 'self_study') === type)))
      .catch(() => setPast([]));
  }, [type]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const remove = async (a, e) => {
    e.stopPropagation();
    if (!await confirmDialog(`Delete “${a.title}”? Learners keep any session they already started.`)) return;
    const before = past;
    setPast(p => p.filter(x => x.id !== a.id));
    try { await apiDelete(`/api/self-study/${a.id}`); }
    catch { setPast(before); }
  };

  if (past && past.length === 0) return null;   // none of this type yet — hide the strip

  const fmtDate = (iso) => {
    if (!iso) return null;
    try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch { return null; }
  };

  return (
    <div style={{ marginTop: 22, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 18px', fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>Past {meta.name.toLowerCase()} activities</div>
        <div style={{ fontSize: 11, color: MUTED2 }}>swipe →</div>
      </div>

      {past === null ? (
        <div style={{ display: 'flex', gap: 12 }}>{[0, 1, 2].map(i => <div key={i} style={{ flex: '0 0 224px', height: 128, borderRadius: 12, background: LIGHT }} />)}</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4, scrollSnapType: 'x proximity' }}>
          {past.map(a => {
            const p = a.progress ?? { assigned: 0, started: 0, complete: 0 };
            const due = a.details?.scheduled_at || a.due_at;
            const when = fmtDate(due || a.created_at);
            const whenLabel = a.details?.scheduled_at ? 'Holds' : a.due_at ? 'Due' : 'Created';
            const dueDate = due ? new Date(due) : null;
            const overdue = dueDate && dueDate < new Date() && p.complete < p.assigned;
            const pct = p.assigned ? Math.round((p.complete / p.assigned) * 100) : 0;
            return (
              <div key={a.id} onClick={() => onOpen(a)} title="See who's done it"
                style={{ flex: '0 0 auto', width: 224, scrollSnapAlign: 'start', cursor: 'pointer', border: `1px solid ${overdue ? '#FECACA' : BORDER}`, borderRadius: 12, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 6 }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = meta.color; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = overdue ? '#FECACA' : BORDER; }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 14 }}>{meta.emoji}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                  </span>
                  <button onClick={(e) => remove(a, e)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED2, padding: 0, flexShrink: 0 }}><Trash2 size={13} /></button>
                </div>
                <span style={{ fontSize: 10, fontWeight: 800, color: meta.color }}>{a.subject}</span>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  <Badge color={BLUE} bg="#EFF6FF"><Users size={10} style={{ marginRight: 2 }} />{p.assigned} assigned</Badge>
                  <Badge color={AMBER} bg="#FFF7ED">{p.started} started</Badge>
                  <Badge color={GREEN} bg="#DCFCE7"><CheckCircle2 size={10} style={{ marginRight: 2 }} />{p.complete} done</Badge>
                </div>
                {/* Same progress bar the self-study cards carry. */}
                <div style={{ height: 6, borderRadius: 3, background: LIGHT, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${AMBER}, ${GREEN})`, transition: 'width .3s' }} />
                </div>
                <div style={{ fontSize: 10, color: overdue ? RED : MUTED2, marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={10} />{whenLabel} {when || '—'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Per-learner progress modal — same brief view the self-study page uses ── */
function DetailModal({ open, onClose, activity, onDeleted }) {
  const [data, setData] = useState(null);
  const meta = byKey(activity?.type || 'self_study');

  useEffect(() => {
    if (!open || !activity?.id) { setData(null); return; }
    apiGet(`/api/self-study/${activity.id}`).then(d => setData(d?.data ?? null)).catch(() => setData(null));
  }, [open, activity?.id]);

  const STATUS = {
    assigned: { color: MUTED,  bg: LIGHT,     label: 'Not started' },
    started:  { color: BLUE,   bg: '#EFF6FF', label: 'In progress' },
    complete: { color: GREEN,  bg: '#DCFCE7', label: 'Complete' },
  };

  const del = async () => {
    if (!await confirmDialog(`Delete “${activity.title}”? Learners keep any session they already started.`)) return;
    try { await apiDelete(`/api/self-study/${activity.id}`); onDeleted(); onClose(); } catch { /* leave it */ }
  };

  return (
    <Modal open={open} onClose={onClose} title={activity?.title || 'Activity'} width={500}>
      {!data ? (
        <div style={{ fontSize: 13, color: MUTED, fontFamily: FONT, padding: '10px 0' }}>Loading…</div>
      ) : (
        <div style={{ fontFamily: FONT }}>
          {/* The brief — same data the self-study detail shows, whatever the kind. */}
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>
            {meta.emoji} {data.subject} · {data.topic}
            {data.difficulty ? ` · ${data.difficulty}` : ''}
          </div>

          {data.details?.scheduled_at && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: AMBER, marginBottom: 10 }}>
              <Clock size={12} />
              Holds {new Date(data.details.scheduled_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              {data.details.duration_mins ? ` · ${data.details.duration_mins} minutes` : ''}
            </div>
          )}
          {data.due_at && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 10 }}>
              <Clock size={12} /> Due {new Date(data.due_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}

          {data.instructions && (
            <div style={{ fontSize: 12, color: MUTED, background: LIGHT, borderRadius: 10, padding: '9px 12px', marginBottom: 12, lineHeight: 1.55 }}>{data.instructions}</div>
          )}

          {/* The plan — the subtopics and objectives the teacher approved,
              labelled the way the creation form labelled them. */}
          {(data.subtopics ?? []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: MUTED2, marginBottom: 7 }}>
                {(byKey(data.type || 'self_study')?.planLabel || 'Plan').toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {(data.subtopics ?? []).map((st, i) => (
                  <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 11px', background: WHITE }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, background: `${meta.color}18`, color: meta.color, fontSize: 10.5, fontWeight: 900, textAlign: 'center', lineHeight: '18px' }}>{i + 1}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{st}</span>
                    </div>
                    {(data.objectives?.[st] ?? []).length > 0 && (
                      <div style={{ paddingLeft: 26, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {data.objectives[st].map((o, j) => (
                          <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: MUTED }}>
                            <span style={{ width: 3.5, height: 3.5, borderRadius: '50%', background: MUTED2, flexShrink: 0 }} />{o}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Who has it, and where each of them stands. */}
          {(() => {
            const targets = data.targets ?? [];
            const done = targets.filter(t => t.status === 'complete').length;
            const pct = targets.length ? Math.round((done / targets.length) * 100) : 0;
            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: MUTED2 }}>ASSIGNED LEARNERS</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>{done} of {targets.length} done</div>
                </div>
                {targets.length > 0 && (
                  <div style={{ height: 6, borderRadius: 3, background: LIGHT, overflow: 'hidden', marginBottom: 10 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${AMBER}, ${GREEN})`, transition: 'width .3s' }} />
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                  {targets.map(t => {
                    const st = STATUS[t.status] || STATUS.assigned;
                    return (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', border: `1px solid ${BORDER}`, borderRadius: 10, background: WHITE }}>
                        <span style={{ fontSize: 16 }}>{t.emoji || '🧑‍🎓'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{t.full_name}</div>
                          <div style={{ fontSize: 11, color: MUTED }}>@{t.username}</div>
                        </div>
                        <Badge color={st.color} bg={st.bg}>{st.label}</Badge>
                      </div>
                    );
                  })}
                  {targets.length === 0 && (
                    <div style={{ fontSize: 12, color: MUTED, padding: '10px 0' }}>Nobody is assigned yet.</div>
                  )}
                </div>
              </div>
            );
          })()}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            <Btn size="sm" variant="secondary" onClick={del}><Trash2 size={13} /> Delete activity</Btn>
            <Btn size="sm" variant="secondary" onClick={onClose}>Close</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function ActivitiesPage() {
  const [key, setKey] = useState('self_study');
  const [refreshKey, setRefreshKey] = useState(0);
  const [detail, setDetail] = useState(null);
  const [toast, setToast] = useState(null);

  const meta = byKey(key);
  const note = meta.note;

  return (
    <PageLayout
      title="Activities"
      subtitle="Create work, assign it to learners, and see what has been done"
      action={<Btn size="sm" onClick={() => setRefreshKey(k => k + 1)}><Plus size={14} /> Refresh</Btn>}
    >
      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left rail — the activity types */}
        <aside style={{ width: 268, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: MUTED2, padding: '8px 13px 6px', fontFamily: FONT }}>ACTIVITY TYPES</div>
            {ACTIVITY_TYPES.map(t => {
              const on = t.key === key;
              return (
                <button key={t.key} onClick={() => setKey(t.key)} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left',
                  padding: '11px 13px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: on ? t.color : 'transparent', color: on ? WHITE : MUTED,
                  fontSize: 13.5, fontWeight: on ? 700 : 600, fontFamily: FONT, transition: 'all .12s',
                }}
                  onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = LIGHT; }}
                  onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{t.emoji}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block' }}>{t.name}</span>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 600, lineHeight: 1.4, marginTop: 2, color: on ? 'rgba(255,255,255,.82)' : MUTED2 }}>{t.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {note && (
            <div style={{ background: `${AMBER}0A`, border: `1px solid ${AMBER}33`, borderRadius: 14, padding: '13px 15px', fontFamily: FONT }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Info size={13} color={AMBER} />
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: AMBER }}>WHEN TO USE IT</span>
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, marginBottom: 5 }}>{note[0]}</div>
              <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.55 }}>{note[1]}</div>
            </div>
          )}
        </aside>

        {/* Right card — the creation form for the picked type */}
        <section style={{ flex: 1, minWidth: 300, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '22px 24px' }}>
          <ActivityForm key={key} type={key} onAssigned={() => setRefreshKey(k => k + 1)} />
        </section>
      </div>

      <PastActivities type={key} refreshKey={refreshKey} onOpen={(a) => setDetail(a)} />
      <DetailModal open={!!detail} activity={detail} onClose={() => setDetail(null)}
        onDeleted={() => { setRefreshKey(k => k + 1); setToast({ message: 'Activity deleted', type: 'success' }); }} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
