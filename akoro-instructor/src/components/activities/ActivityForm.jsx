/**
 * The activity DRAFT editor + shared helpers (types, paper cleaning).
 *
 * Activities are no longer created from a page of forms — the agent prepares
 * a draft in chat (prepare_activity) and this form is what edits that draft
 * inside the preview panel before the instructor assigns it. Everything that
 * the preview panel and the paper versions need lives here.
 */
import { useState, useEffect } from 'react';
import { BookOpen, Pencil, FolderKanban, MonitorPlay, Swords, ListChecks } from 'lucide-react';
import { Btn, Inp, Txa, Sel } from '../Primitives.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import AudiencePicker, { audienceBody, parseHandles, BLANK_AUDIENCE } from '../AudiencePicker.jsx';
import PlanEditor from '../PlanEditor.jsx';
import PaperBuilder from '../paper/PaperBuilder.jsx';
import { removeRef, AR_OPTIONS, TF_OPTIONS } from '../../lib/paper.js';
import { GREEN, PURPLE, BLUE, RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const SUBJECTS = [
  'Mathematics', 'English Language', 'Basic Science', 'Basic Technology',
  'Social Studies', 'Civic Education', 'Agricultural Science', 'Computer Studies',
  'Business Studies', 'Biology', 'Chemistry', 'Physics', 'Geography', 'History',
];

/* ── The activity types — the rail of the workbench ──────────────────────── */
const ACTIVITY_TYPES = [
  {
    key: 'self_study', name: 'Self study', icon: BookOpen, ti: 'ti-book', color: PURPLE,
    blurb: 'A topic each learner works through with their own AI agent.',
    note: ['Practice that adapts to each learner.',
      'Assign a topic; every learner gets their own agent session and goes at their own pace. Use it for revision, catch-up after an absence, or stretch work that should not wait for you.'],
    planLabel: 'Study plan',
    planHint: 'Subtopics the learner will move through, in order.',
  },
  {
    key: 'assignment', name: 'Assignment', icon: Pencil, ti: 'ti-pencil', color: BLUE,
    blurb: 'Set work with a deadline and a clear task breakdown.',
    note: ['One measurable check for understanding.',
      'Questions or tasks every learner answers on their own. Use it right after a lesson, when you want evidence of what stuck — the AI drafts the task breakdown, you correct it before anything is sent.'],
    planLabel: 'Task breakdown',
    planHint: 'The tasks or question areas learners must complete.',
  },
  {
    key: 'project', name: 'Project', icon: FolderKanban, ti: 'ti-layout-kanban', color: GREEN,
    blurb: 'A deliverable learners build over days, not minutes.',
    note: ['When depth matters more than speed.',
      'Research, an artefact, a presentation. Use it when the process is the point: the AI drafts milestones, you set the bar, and learners work toward a finished thing you can assess.'],
    planLabel: 'Milestones & requirements',
    planHint: 'The stages a finished project must pass through.',
  },
  {
    key: 'live_course', name: 'Live course', icon: MonitorPlay, ti: 'ti-device-tv', color: C.brand,
    blurb: 'You, live, at a scheduled time with a join link.',
    note: ['First exposure belongs to a human.',
      'A scheduled session with a start time and a link. Use it for introducing something new, discussion, and anything learners cannot do alone — then let assignments and self study carry the practice.'],
    planLabel: null,
    planHint: null,
  },
  {
    key: 'battle', name: 'Battle', icon: Swords, ti: 'ti-swords', color: RED,
    blurb: 'A timed quiz duel from your question bank — the same battle form.',
    note: ['Energy that makes recall competitive.',
      'Timed questions, an XP prize, a leaderboard moment. Use it to revise a finished topic — the competition surfaces who recalls what, faster than a quiz ever will.'],
    planLabel: null,
    planHint: null,
  },
  {
    key: 'multi_stage', name: 'Multi stage', icon: ListChecks, ti: 'ti-list-check', color: '#A855F7',
    blurb: 'Chain activities into one journey: learn, practise, compete.',
    note: ['One journey, several kinds of work.',
      'Chain self study, assignments, projects and battles into an ordered path — e.g. study the topic, then the assignment, then the battle. Learners see the roadmap; each step is real, tracked work.'],
    planLabel: null,
    planHint: null,
  },
];

const byKey = (k) => ACTIVITY_TYPES.find(t => t.key === k);
export { ACTIVITY_TYPES as WORKBENCH_TYPES, byKey };

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ── Creation form — the AI Self Study form, adapted per type ────────────── */
const Q_INP = {
  padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`,
  fontFamily: C.font, fontSize: 12, fontWeight: 600, color: C.ink, outline: 'none', background: C.surface,
};
const BLANK = {
  title: '', subject: 'Basic Science', topic: '', instructions: '',
  difficulty: 'intermediate', dueAt: '', classId: '',
  audience: BLANK_AUDIENCE,
  scheduledAt: '', durationMins: '60',
  subtopics: [], objectives: {},
  questionRequest: '',   // the teacher's words: "5 questions, 3 MCQ, 2 direct theory"
  questions: [],   // optional: [{q, options?, correct?, section?, passage?, figure?}] — learners answer on submit
  // The paper layout (reference/question-layout-for-activity): sections
  // with instructions and passages several questions share.
  sections: [],    // [{ title, instructions }]
  passages: [],    // [{ title, text }]
  // Assignment marking shape (reference: assignment generation and
  // creator.md). Only these are asked of the instructor; the question-level
  // fields (text, type, max_points, difficulty, cognitive level) are
  // drafted by the AI onto each question.
  totalPoints: '',           // '' | numeric string — the assignment is marked out of this
  aiAutoAllocate: true,      // AI splits the total across questions
  aiAutoGrade: false,        // AI drafts marks per answer for approval
  questionTypes: ['MCQ', 'Short answer'],
  rubric: [],                // [{ criterion, points }]
};
const BLANK_QUESTION = { q: '', kind: 'mcq', options: ['', ''], correct: 0, type: '', max_points: null, difficulty: '', cognitive_level: '' };

/* The question types the AI may use when drafting — the instructor ticks
   as many as they want; the draft uses exactly those. */
const QUESTION_TYPES = ['MCQ', 'Short answer', 'Essay', 'Coding', 'Diagram'];

/* Clean the builder's rows into what rides in details.questions — only
   complete questions travel, so a half-filled row is simply ignored.
   Question-level marking fields (type, max_points, difficulty, cognitive
   level) ride along when present: the learner contract reads q/options,
   everything else is workbench + grading detail. */
export function cleanQuestions(raw) {
  return (raw ?? [])
    .map((row) => {
      const q = (row.q || '').trim();
      if (!q && row.format !== 'assertion_reason') return null;
      const extra = {
        ...(row.type ? { type: row.type } : {}),
        ...(row.max_points !== '' && row.max_points != null ? { max_points: Number(row.max_points) || 0 } : {}),
        ...(row.difficulty ? { difficulty: row.difficulty } : {}),
        ...(row.cognitive_level ? { cognitive_level: row.cognitive_level } : {}),
        ...(Number.isInteger(row.section) ? { section: row.section } : {}),
        ...(Number.isInteger(row.passage) ? { passage: row.passage } : {}),
        ...(row.figure && (row.figure.src || row.figure.svg) ? { figure: row.figure } : {}),
        ...(!row.figure && row.figure_note ? { figure_note: row.figure_note } : {}),
        ...(row.format === 'case_study' ? { format: 'case_study' } : {}),
        ...(typeof row.answer === 'string' && row.answer.trim() ? { answer: row.answer.trim() } : {}),   // a model answer (graders see it, learners don't)
        // The paper template's fields ride along (how it's answered on paper, the marking-scheme line).
        ...(row.answer_space ? { answer_space: row.answer_space } : {}),
        ...(typeof row.marking === 'string' && row.marking.trim() ? { marking: row.marking.trim() } : {}),
      };
      // Kinds with a fixed shape (question.format).
      if (row.format === 'assertion_reason') {
        const assertion = (row.assertion || '').trim(), reason = (row.reason || '').trim();
        if (!assertion || !reason) return null;
        return { ...extra, q: `Assertion: ${assertion}\nReason: ${reason}`, format: 'assertion_reason', assertion, reason,
          options: [...AR_OPTIONS], correct: Math.min(Math.max(Number(row.correct) || 0, 0), 3) };
      }
      if (row.format === 'true_false') return { q, ...extra, format: 'true_false', options: [...TF_OPTIONS], correct: Number(row.correct) === 1 ? 1 : 0 };
      if (row.kind === 'label') {
        const labels = [...new Set((row.labels ?? []).map(l => (l || '').trim()).filter(Boolean))];
        if (!labels.length) return null;
        const answer = Object.fromEntries(labels.map(l => [l, (row.answer?.[l] || '').trim()]).filter(([, v]) => v));
        return { q, ...extra, format: 'label', labels, ...(Object.keys(answer).length ? { answer } : {}) };
      }
      if (row.kind === 'mcq') {
        const options = (row.options ?? []).map(o => (o || '').trim()).filter(Boolean);
        if (options.length < 2) return null;
        const correct = Math.min(Math.max(Number(row.correct) || 0, 0), options.length - 1);
        return { q, options, correct, ...extra };
      }
      return { q, ...extra };
    })
    .filter(Boolean)
    .slice(0, 30);   // the API's limit (questionPaper.js)
}

/* The paper layout that rides beside the questions: empty sections and
   passages are dropped (references kept in step), and so is the whole
   layout when no question uses it. → { questions, sections?, passages? } */
export function cleanPaper(form) {
  let questions = form.questions ?? [];
  let sections = (form.sections ?? []).map(s => ({ title: (s.title || '').trim(), instructions: (s.instructions || '').trim() }));
  let passages = (form.passages ?? []).map(p => ({ title: (p.title || '').trim(), text: (p.text || '').trim() }));
  for (let i = sections.length - 1; i >= 0; i--) if (!sections[i].title && !sections[i].instructions) { questions = removeRef(questions, 'section', i); sections = sections.filter((_, j) => j !== i); }
  for (let i = passages.length - 1; i >= 0; i--) if (!passages[i].text) { questions = removeRef(questions, 'passage', i); passages = passages.filter((_, j) => j !== i); }
  const clean = cleanQuestions(questions);
  return {
    questions: clean,
    ...(sections.length && clean.some(q => Number.isInteger(q.section)) ? { sections } : {}),
    ...(passages.length && clean.some(q => Number.isInteger(q.passage)) ? { passages } : {}),
  };
}

/* Stored questions (details.questions, a draft version) → the builder's rows. */
export function rowsFromQuestions(questions) {
  return (questions ?? []).map((q) => {
    const obj = q && typeof q === 'object' ? q : { q: String(q ?? '') };
    const opts = Array.isArray(obj.options) && obj.options.length >= 2 ? obj.options : null;
    return {
      ...BLANK_QUESTION,
      q: obj.q || obj.text || '',
      kind: opts ? 'mcq' : 'open',
      options: opts || ['', ''],
      correct: opts ? Math.min(Math.max(Number(obj.correct) || 0, 0), opts.length - 1) : 0,
      type: obj.type || '', max_points: obj.max_points ?? null,
      difficulty: obj.difficulty || '', cognitive_level: obj.cognitive_level || '',
      ...(Number.isInteger(obj.section) ? { section: obj.section } : {}),
      ...(Number.isInteger(obj.passage) ? { passage: obj.passage } : {}),
      figure: obj.figure || null,
      ...(obj.figure_note ? { figure_note: obj.figure_note } : {}),
      ...(obj.format ? { format: obj.format } : {}),
      ...(obj.format === 'assertion_reason' ? { assertion: obj.assertion || '', reason: obj.reason || '' } : {}),
      ...(obj.format === 'label' ? { kind: 'label', labels: Array.isArray(obj.labels) ? obj.labels : [], answer: obj.answer && typeof obj.answer === 'object' ? obj.answer : {} } : {}),
      ...(typeof obj.answer === 'string' ? { answer: obj.answer } : {}),
      ...(obj.answer_space ? { answer_space: obj.answer_space } : {}),
      ...(obj.marking ? { marking: obj.marking } : {}),
    };
  });
}

/* A small on/off switch for the AI marking toggles — reads as a switch, not
   a button, so "AI auto-grade: on" is one glance. */
function MarkingToggle({ on, onChange, label, hint }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%',
      padding: '9px 11px', borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.surface,
      cursor: 'pointer', fontFamily: C.font, textAlign: 'left',
    }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.ink }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{hint}</span>}
      </span>
      <span style={{ width: 38, height: 22, borderRadius: 100, background: on ? GREEN : '#E5E7EB', position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .15s' }} />
      </span>
    </button>
  );
}

export function ActivityForm({ type, onAssigned, initial = null, savePayload = null }) {
  const meta = byKey(type);
  const isLive = type === 'live_course';
  const [form, setForm] = useState(() => (initial ? { ...BLANK, ...initial } : BLANK));
  const [classes, setClasses] = useState([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [qDrafting, setQDrafting] = useState(false);          // AI drafting the questions
  const [qWarning, setQWarning] = useState('');               // the draft missed the request (count / mix)
  const [rubricDrafting, setRubricDrafting] = useState(false); // AI drafting the rubric
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
      .then(d => {
        const list = d?.data ?? [];
        setClasses(list);
        // One class: pre-select it. A controlled select with no empty-value
        // option DISPLAYS the only class while the state stays '' — the
        // option already looks chosen, so picking it never fires onChange
        // and submit is stuck on "Pick a class." with nothing to select.
        if (list.length === 1) setForm(f => (f.classId ? f : { ...f, classId: list[0].id }));
      })
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

  /* Assignment: draft the questions with the marking built in — point
     allocation, per-question difficulty and cognitive level, MCQ options.
     Uses the marking shape above (total points, question types) and the
     approved task breakdown as question areas. */
  const draftQuestions = async () => {
    if (!form.topic.trim()) return setError('Enter a topic first — the questions are built from it.');
    setError(''); setQDrafting(true);
    try {
      const d = await apiPost('/api/self-study/assignment-draft/questions', {
        topic: form.topic.trim(), subject: form.subject,
        request: (form.questionRequest || '').trim(),
        total_points: Number(form.totalPoints) || null,
        question_types: form.questionTypes,
        difficulty: form.difficulty,
        subtopics: form.subtopics.map(s => s.trim()).filter(Boolean),
      });
      const qs = rowsFromQuestions(d?.data?.questions);
      const sections = (d?.data?.sections ?? []).map(s => ({ title: s.title || '', instructions: s.instructions || '' }));
      const passages = (d?.data?.passages ?? []).map(p => ({ title: p.title || '', text: p.text || '' }));
      setQWarning(d?.data?.warning || '');
      if (!qs.length) throw new Error('The AI returned no questions — try again, or add them yourself.');
      setForm(f => {
        // No total set yet? Adopt the AI's allocation as the total.
        const sum = qs.reduce((n, q) => n + (Number(q.max_points) || 0), 0);
        return {
          ...f, questions: qs, sections, passages,
          title: f.title || `${f.topic.trim()} — ${meta.name.toLowerCase()}`,
          totalPoints: f.totalPoints || (sum ? String(sum) : f.totalPoints),
        };
      });
    } catch (e) {
      setError(e?.message || 'Could not draft the questions.');
    } finally { setQDrafting(false); }
  };

  /* Assignment: draft the rubric — criteria with points (or percentage
     weights until a total is set). */
  const draftRubric = async () => {
    if (!form.topic.trim()) return setError('Enter a topic first — the rubric is built from it.');
    setError(''); setRubricDrafting(true);
    try {
      const d = await apiPost('/api/self-study/assignment-draft/rubric', {
        topic: form.topic.trim(), subject: form.subject,
        total_points: Number(form.totalPoints) || null,
        question_types: form.questionTypes,
      });
      const rub = (d?.data?.rubric ?? [])
        .map(r => ({ criterion: r.criterion || '', points: Number(r.points) || 0 }))
        .filter(r => r.criterion.trim());
      if (!rub.length) throw new Error('The AI returned no rubric — try again, or write the criteria yourself.');
      setForm(f => ({ ...f, rubric: rub }));
    } catch (e) {
      setError(e?.message || 'Could not draft the rubric.');
    } finally { setRubricDrafting(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) return setError('Give it a title.');
    if (!form.topic.trim()) return setError(`Enter the ${isLive ? 'session focus' : 'topic'}.`);
    // An assignment is marked work — the total is what its questions and
    // rubric are allocated out of (reference: assignment generation and
    // creator.md).
    if (type === 'assignment' && !Number(form.totalPoints))
      return setError('Set the total points — the questions and rubric are marked out of it.');
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
        details: {
          ...(isLive
            ? { scheduled_at: new Date(form.scheduledAt).toISOString(), duration_mins: Number(form.durationMins) || 60 }
            : {}),
          ...(!isLive && cleanQuestions(form.questions).length ? cleanPaper(form) : {}),
          // The assignment's marking shape — only the necessary fields from
          // the workbench; question-level detail already rides on each
          // drafted question above.
          ...(type === 'assignment' ? {
            total_points: Number(form.totalPoints) || null,
            ai_auto_allocate_points: !!form.aiAutoAllocate,
            ai_auto_grade: !!form.aiAutoGrade,
            question_types: form.questionTypes,
            rubric: form.rubric
              .filter(r => (r.criterion || '').trim())
              .map(r => ({ criterion: r.criterion.trim(), points: Number(r.points) || 0 })),
          } : {}),
        },
      };
      if (!isLive) { body.subtopics = clean; body.objectives = objectives; body.difficulty = form.difficulty; }

      const t = audienceBody(form.audience);
      const payload = {
        ...body, ...t,
        // "Everyone" resolves against classroom_id, so it has to travel with
        // the target rather than sit beside it (the self-study rule).
        classroom_id: t.whole_class ? form.classId : null,
      };
      // The workbench posts the bench; the chat preview's copy posts the
      // draft-assign approval — same payload shape, same form, no fork.
      const d = savePayload ? await savePayload(payload) : await apiPost('/api/self-study', payload);
      setDone(`Assigned to ${d?.data?.assigned ?? 0} learner${d?.data?.assigned === 1 ? '' : 's'}`);
      setForm({ ...BLANK, classId: form.classId });
      onAssigned(d?.data?.assigned ?? 0);
    } catch (err) {
      setError(err?.message || 'Could not assign it.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: C.font }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: tint(9, meta.color), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Ico lucide={meta.icon} ti={meta.ti} size={19} color={meta.color} />
        </div>
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 900, color: C.ink }}>New {meta.name.toLowerCase()}</div>
          <div style={{ fontSize: 11.5, color: C.muted }}>{meta.blurb}</div>
        </div>
      </div>

      {done && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px', borderRadius: 10, background: '#DCFCE7', border: `1px solid ${tint(30, GREEN)}`, fontSize: 12.5, fontWeight: 800, color: GREEN }}>
          <Ico ti="ti-circle-check" size={14} /> {done}
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
            <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font }}>{meta.planLabel} *</div>
            <Btn size="sm" variant="secondary" type="button" onClick={draft} disabled={drafting}>
              {drafting
                ? <><Ico ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} /> Drafting…</>
                : <><Ico ti="ti-sparkles" size={13} /> {form.subtopics.length ? 'Redraft with AI' : 'Draft with AI'}</>}
            </Btn>
          </div>
          <PlanEditor
            subtopics={form.subtopics} objectives={form.objectives}
            onChange={(subtopics, objectives) => setForm(f => ({ ...f, subtopics, objectives }))}
          />
          <div style={{ fontSize: 10.5, color: C.muted2, fontFamily: C.font, marginTop: 6 }}>
            {meta.planHint} Nothing is assigned until you save — edit or remove anything the AI drafted.
          </div>
        </div>
      )}

      {/* Marking — the assignment's necessary fields (reference: assignment
          generation and creator.md). Everything question-level is drafted
          by the AI onto each question; the instructor always overrides. */}
      {type === 'assignment' && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, background: C.surface }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, marginBottom: 10 }}>Marking</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
            <div>
              <Inp label="Total points *" type="number" min={1} value={form.totalPoints}
                onChange={e => setField('totalPoints', e.target.value)} placeholder="e.g. 20" />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {[10, 20, 50, 100].map(v => (
                  <button key={v} type="button" onClick={() => setField('totalPoints', String(v))}
                    style={{
                      padding: '4px 10px', borderRadius: 100, cursor: 'pointer', fontFamily: C.font,
                      fontSize: 11, fontWeight: 800,
                      border: `1.5px solid ${Number(form.totalPoints) === v ? BLUE : C.border}`,
                      background: Number(form.totalPoints) === v ? '#EFF6FF' : C.surface,
                      color: Number(form.totalPoints) === v ? BLUE : C.muted,
                    }}>{v}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'flex-end' }}>
              <MarkingToggle label="AI allocates points" hint="Splits the total across questions by difficulty."
                on={form.aiAutoAllocate} onChange={v => setField('aiAutoAllocate', v)} />
              <MarkingToggle label="AI auto-grade" hint="Drafts a mark per answer for you to approve."
                on={form.aiAutoGrade} onChange={v => setField('aiAutoGrade', v)} />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, marginBottom: 6 }}>Question types</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {QUESTION_TYPES.map(qt => {
                const on = form.questionTypes.includes(qt);
                return (
                  <button key={qt} type="button"
                    onClick={() => setForm(f => ({ ...f, questionTypes: on ? f.questionTypes.filter(x => x !== qt) : [...f.questionTypes, qt] }))}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 100,
                      cursor: 'pointer', fontFamily: C.font, fontSize: 11.5, fontWeight: 800,
                      border: `1.5px solid ${on ? BLUE : C.border}`,
                      background: on ? '#EFF6FF' : C.surface,
                      color: on ? BLUE : C.muted,
                    }}>
                    {on && <Ico ti="ti-check" size={11} />} {qt}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 10.5, color: C.muted2, fontFamily: C.font, marginTop: 5 }}>
              The AI uses exactly these when drafting the questions — tick as many as you want.
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font }}>
                Rubric
                {form.rubric.length > 0 && (
                  <span style={{ color: C.muted2, fontWeight: 600 }}>
                    {' '}— {form.rubric.reduce((n, r) => n + (Number(r.points) || 0), 0)}
                    {Number(form.totalPoints) ? ` of ${form.totalPoints}` : ''} points
                  </span>
                )}
              </div>
              <Btn size="sm" variant="secondary" type="button" onClick={draftRubric} disabled={rubricDrafting}>
                {rubricDrafting
                  ? <><Ico ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} /> Drafting…</>
                  : <><Ico ti="ti-sparkles" size={13} /> {form.rubric.length ? 'Redraft with AI' : 'Draft with AI'}</>}
              </Btn>
            </div>
            {form.rubric.length === 0 ? (
              <div style={{ fontSize: 10.5, color: C.muted2, fontFamily: C.font }}>
                Criteria the marks are shared across — draft them with AI or add your own.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {form.rubric.map((r, ri) => (
                  <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <input value={r.criterion} onChange={e => setForm(f => ({ ...f, rubric: f.rubric.map((x, i) => i === ri ? { ...x, criterion: e.target.value } : x) }))}
                      placeholder={`Criterion ${ri + 1}, e.g. Correctness`} style={{ flex: 1, ...Q_INP }} />
                    <input type="number" min={0} value={r.points} onChange={e => setForm(f => ({ ...f, rubric: f.rubric.map((x, i) => i === ri ? { ...x, points: e.target.value } : x) }))}
                      title="Points for this criterion" style={{ ...Q_INP, width: 74 }} />
                    <button type="button" onClick={() => setForm(f => ({ ...f, rubric: f.rubric.filter((_, i) => i !== ri) }))}
                      style={{ border: 'none', background: 'none', color: C.muted2, cursor: 'pointer', fontSize: 15, padding: '2px 5px' }} title="Remove criterion">×</button>
                  </div>
                ))}
                <button type="button" onClick={() => setForm(f => ({ ...f, rubric: [...f.rubric, { criterion: '', points: '' }] }))}
                  style={{ border: 'none', background: 'none', color: PURPLE, cursor: 'pointer', fontSize: 11, fontWeight: 800, fontFamily: C.font, textAlign: 'left', padding: '2px 0' }}>+ criterion</button>
              </div>
            )}
          </div>
        </div>
      )}

      {isLive && (
        <Inp label="Holds on *" type="datetime-local" value={form.scheduledAt} onChange={e => setField('scheduledAt', e.target.value)} />
      )}

      {/* Questions (optional) — when set, learners answer these on the
          activity's details page before they can submit. */}
      {!isLive && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 12px 12px', background: form.questions.length ? C.surface : 'transparent' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font }}>Questions <span style={{ color: C.muted2, fontWeight: 600 }}>(optional)</span></div>
              <div style={{ fontSize: 10.5, color: C.muted2, fontFamily: C.font, marginTop: 2 }}>
                {form.questions.length
                  ? `${cleanQuestions(form.questions).length} question${cleanQuestions(form.questions).length === 1 ? '' : 's'} will ride with this activity — learners answer them on submit.`
                  : type === 'assignment'
                    ? 'Say what you want below and draft them with AI — or add your own.'
                    : 'Add questions and learners answer them in the app instead of a free-text answer.'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {type === 'assignment' && (
                <Btn size="sm" variant="secondary" type="button" onClick={draftQuestions} disabled={qDrafting}>
                  {qDrafting
                    ? <><Ico ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} /> Drafting…</>
                    : <><Ico ti="ti-sparkles" size={13} /> {form.questions.length ? 'Redraft questions' : 'Draft questions'}</>}
                </Btn>
              )}
              <Btn size="sm" variant="secondary" type="button"
                onClick={() => setForm(f => {
                  // A new question joins the section (and passage) the last one is in.
                  const last = f.questions[f.questions.length - 1];
                  const at = {
                    ...(Number.isInteger(last?.section) ? { section: last.section } : {}),
                    ...(Number.isInteger(last?.passage) ? { passage: last.passage } : {}),
                  };
                  return { ...f, questions: [...f.questions, { ...BLANK_QUESTION, options: ['', ''], ...at }] };
                })}>
                <Ico ti="ti-plus" size={13} /> Add question
              </Btn>
            </div>
          </div>
          {/* The teacher's own words drive the draft: count, mix, diagrams, marks. */}
          {type === 'assignment' && (
            <input value={form.questionRequest || ''} onChange={e => setField('questionRequest', e.target.value)} maxLength={1500}
              aria-label="Describe the questions"
              placeholder="Describe the questions, e.g. 5 questions — 3 MCQ, 2 direct theory, one with a diagram"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (!qDrafting) draftQuestions(); } }}
              style={{ ...Q_INP, width: '100%', boxSizing: 'border-box', marginTop: 9, fontSize: 12.5 }} />
          )}
          {qWarning && (
            <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 9, background: C.brandSoft, border: '1px solid #FED7AA', fontSize: 11.5, fontWeight: 700, color: '#B45309', fontFamily: C.font }}>
              <Ico ti="ti-alert-triangle" size={12} color="#B45309" style={{ verticalAlign: '-2px', marginRight: 3 }} />{qWarning} Edit below, or draft again.
            </div>
          )}
          {form.questions.length > 0 && (
            <PaperBuilder
              questions={form.questions} sections={form.sections ?? []} passages={form.passages ?? []}
              assignment={type === 'assignment'} title={form.topic}
              onChange={patch => setForm(f => ({ ...f, ...patch }))} />
          )}
        </div>
      )}

      {/* Who — the class, then who within it. */}
      <div>
        <Sel label="Class *" value={form.classId} onChange={e => setField('classId', e.target.value)}>
          {classesLoading && <option value="">Loading classes…</option>}
          {!classesLoading && !classes.length && <option value="">No classes set up yet</option>}
          {!classesLoading && classes.length > 0 && <option value="">Choose a class…</option>}
          {classes.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}{c.student_count ? ` — ${c.student_count} learner${c.student_count === 1 ? '' : 's'}` : ''}
            </option>
          ))}
        </Sel>
        {!classesLoading && !classes.length && (
          <div style={{ fontSize: 11, color: C.muted2, fontFamily: C.font, marginTop: 5 }}>
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

      {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700, fontFamily: C.font }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <Btn type="submit" disabled={saving}>
          {saving ? 'Assigning…' : <><Ico ti="ti-users" size={14} /> Assign to learners</>}
        </Btn>
      </div>
    </form>
  );
}

