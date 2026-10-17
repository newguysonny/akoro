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
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BookOpen, Pencil, FolderKanban, MonitorPlay, Swords, ListChecks, Plus, Users,
  Clock, Trash2, ChevronRight, Sparkles, Loader2, CheckCircle2, Info, ArrowUp, ArrowDown, BarChart3, Check,  AlertTriangle, Download } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Txa, Sel, Badge, Toast } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiPatch, apiDelete, apiBlob } from '../services/api.js';
import AudiencePicker, { audienceBody, parseHandles, BLANK_AUDIENCE } from '../components/AudiencePicker.jsx';
import PlanEditor from '../components/PlanEditor.jsx';
import PaperBuilder from '../components/paper/PaperBuilder.jsx';
import PaperView from '../components/paper/PaperView.jsx';
import { removeRef, AR_OPTIONS, TF_OPTIONS } from '../lib/paper.js';
import { downloadActivityPdf } from '../lib/activityPdf.js';
import { printPaperHtml } from '../components/paper/PaperFrame.jsx';
import BattleForm from '../components/battles/BattleForm.jsx';
import { useBattlesAPI } from '../hooks/useBattlesAPI.js';
import { useCoursesAPI } from '../hooks/useCoursesAPI.js';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, RED, FONT } from '../constants.js';
import { confirmDialog } from '../components/ConfirmHost.jsx';
import ActivityPreviewPanel from '../components/ActivityPreviewPanel.jsx';

const SUBJECTS = [
  'Mathematics', 'English Language', 'Basic Science', 'Basic Technology',
  'Social Studies', 'Civic Education', 'Agricultural Science', 'Computer Studies',
  'Business Studies', 'Biology', 'Chemistry', 'Physics', 'Geography', 'History',
];

/* ── The activity types — the rail of the workbench ──────────────────────── */
const ACTIVITY_TYPES = [
  {
    key: 'self_study', name: 'Self study', icon: BookOpen, color: PURPLE,
    blurb: 'A topic each learner works through with their own AI agent.',
    note: ['Practice that adapts to each learner.',
      'Assign a topic; every learner gets their own agent session and goes at their own pace. Use it for revision, catch-up after an absence, or stretch work that should not wait for you.'],
    planLabel: 'Study plan',
    planHint: 'Subtopics the learner will move through, in order.',
  },
  {
    key: 'assignment', name: 'Assignment', icon: Pencil, color: BLUE,
    blurb: 'Set work with a deadline and a clear task breakdown.',
    note: ['One measurable check for understanding.',
      'Questions or tasks every learner answers on their own. Use it right after a lesson, when you want evidence of what stuck — the AI drafts the task breakdown, you correct it before anything is sent.'],
    planLabel: 'Task breakdown',
    planHint: 'The tasks or question areas learners must complete.',
  },
  {
    key: 'project', name: 'Project', icon: FolderKanban, color: GREEN,
    blurb: 'A deliverable learners build over days, not minutes.',
    note: ['When depth matters more than speed.',
      'Research, an artefact, a presentation. Use it when the process is the point: the AI drafts milestones, you set the bar, and learners work toward a finished thing you can assess.'],
    planLabel: 'Milestones & requirements',
    planHint: 'The stages a finished project must pass through.',
  },
  {
    key: 'live_course', name: 'Live course', icon: MonitorPlay, color: AMBER,
    blurb: 'You, live, at a scheduled time with a join link.',
    note: ['First exposure belongs to a human.',
      'A scheduled session with a start time and a link. Use it for introducing something new, discussion, and anything learners cannot do alone — then let assignments and self study carry the practice.'],
    planLabel: null,
    planHint: null,
  },
  {
    key: 'battle', name: 'Battle', icon: Swords, color: RED,
    blurb: 'A timed quiz duel from your question bank — the same battle form.',
    note: ['Energy that makes recall competitive.',
      'Timed questions, an XP prize, a leaderboard moment. Use it to revise a finished topic — the competition surfaces who recalls what, faster than a quiz ever will.'],
    planLabel: null,
    planHint: null,
  },
  {
    key: 'multi_stage', name: 'Multi stage', icon: ListChecks, color: '#A855F7',
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
  padding: '7px 10px', borderRadius: 8, border: `1px solid ${BORDER}`,
  fontFamily: FONT, fontSize: 12, fontWeight: 600, color: INK, outline: 'none', background: WHITE,
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
      padding: '9px 11px', borderRadius: 10, border: `1.5px solid ${BORDER}`, background: WHITE,
      cursor: 'pointer', fontFamily: FONT, textAlign: 'left',
    }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: INK }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 10.5, color: MUTED2, marginTop: 1 }}>{hint}</span>}
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

      {/* Marking — the assignment's necessary fields (reference: assignment
          generation and creator.md). Everything question-level is drafted
          by the AI onto each question; the instructor always overrides. */}
      {type === 'assignment' && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: 12, background: WHITE }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, marginBottom: 10 }}>Marking</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
            <div>
              <Inp label="Total points *" type="number" min={1} value={form.totalPoints}
                onChange={e => setField('totalPoints', e.target.value)} placeholder="e.g. 20" />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {[10, 20, 50, 100].map(v => (
                  <button key={v} type="button" onClick={() => setField('totalPoints', String(v))}
                    style={{
                      padding: '4px 10px', borderRadius: 100, cursor: 'pointer', fontFamily: FONT,
                      fontSize: 11, fontWeight: 800,
                      border: `1.5px solid ${Number(form.totalPoints) === v ? BLUE : BORDER}`,
                      background: Number(form.totalPoints) === v ? '#EFF6FF' : WHITE,
                      color: Number(form.totalPoints) === v ? BLUE : MUTED,
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
            <div style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, marginBottom: 6 }}>Question types</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {QUESTION_TYPES.map(qt => {
                const on = form.questionTypes.includes(qt);
                return (
                  <button key={qt} type="button"
                    onClick={() => setForm(f => ({ ...f, questionTypes: on ? f.questionTypes.filter(x => x !== qt) : [...f.questionTypes, qt] }))}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 100,
                      cursor: 'pointer', fontFamily: FONT, fontSize: 11.5, fontWeight: 800,
                      border: `1.5px solid ${on ? BLUE : BORDER}`,
                      background: on ? '#EFF6FF' : WHITE,
                      color: on ? BLUE : MUTED,
                    }}>
                    {on && <Check size={11} />} {qt}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 10.5, color: MUTED2, fontFamily: FONT, marginTop: 5 }}>
              The AI uses exactly these when drafting the questions — tick as many as you want.
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT }}>
                Rubric
                {form.rubric.length > 0 && (
                  <span style={{ color: MUTED2, fontWeight: 600 }}>
                    {' '}— {form.rubric.reduce((n, r) => n + (Number(r.points) || 0), 0)}
                    {Number(form.totalPoints) ? ` of ${form.totalPoints}` : ''} points
                  </span>
                )}
              </div>
              <Btn size="sm" variant="secondary" type="button" onClick={draftRubric} disabled={rubricDrafting}>
                {rubricDrafting
                  ? <><Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> Drafting…</>
                  : <><Sparkles size={13} /> {form.rubric.length ? 'Redraft with AI' : 'Draft with AI'}</>}
              </Btn>
            </div>
            {form.rubric.length === 0 ? (
              <div style={{ fontSize: 10.5, color: MUTED2, fontFamily: FONT }}>
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
                      style={{ border: 'none', background: 'none', color: MUTED2, cursor: 'pointer', fontSize: 15, padding: '2px 5px' }} title="Remove criterion">×</button>
                  </div>
                ))}
                <button type="button" onClick={() => setForm(f => ({ ...f, rubric: [...f.rubric, { criterion: '', points: '' }] }))}
                  style={{ border: 'none', background: 'none', color: PURPLE, cursor: 'pointer', fontSize: 11, fontWeight: 800, fontFamily: FONT, textAlign: 'left', padding: '2px 0' }}>+ criterion</button>
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
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: '10px 12px 12px', background: form.questions.length ? WHITE : 'transparent' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT }}>Questions <span style={{ color: MUTED2, fontWeight: 600 }}>(optional)</span></div>
              <div style={{ fontSize: 10.5, color: MUTED2, fontFamily: FONT, marginTop: 2 }}>
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
                    ? <><Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> Drafting…</>
                    : <><Sparkles size={13} /> {form.questions.length ? 'Redraft questions' : 'Draft questions'}</>}
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
                <Plus size={13} /> Add question
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
            <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 9, background: '#FFF7ED', border: '1px solid #FED7AA', fontSize: 11.5, fontWeight: 700, color: '#B45309', fontFamily: FONT }}>
              <AlertTriangle size={12} color="#B45309" style={{ verticalAlign: '-2px', marginRight: 3 }} />{qWarning} Edit below, or draft again.
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
                    <span style={{ display: 'flex', flexShrink: 0 }}><meta.icon size={14} color={meta.color} /></span>
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
export function DetailPage({ activity, onDeleted, onClose }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const meta = byKey(activity?.type || 'self_study');

  useEffect(() => {
    if (!activity?.id) { setData(null); return; }
    apiGet(`/api/self-study/${activity.id}`).then(d => setData(d?.data ?? null)).catch(() => setData(null));
  }, [activity?.id]);

  const STATUS = {
    assigned: { color: MUTED,  bg: LIGHT,     label: 'Not started' },
    started:  { color: BLUE,   bg: '#EFF6FF', label: 'In progress' },
    complete: { color: GREEN,  bg: '#DCFCE7', label: 'Complete' },
  };

  const del = async () => {
    if (!await confirmDialog(`Delete “${activity.title}”? Learners keep any session they already started.`)) return;
    try { await apiDelete(`/api/self-study/${activity.id}`); onDeleted(); onClose(); } catch { /* leave it */ }
  };
  const [pdfErr, setPdfErr] = useState(false);
  const questions = data?.details?.questions ?? [];
  const isJourney = (data?.type || activity?.type) === 'multi_stage';
  const canPdf = !!data && (isJourney || questions.length > 0 || (data.subtopics ?? []).length > 0);
  // Same sheet the preview prints: the paper with its answer key, or the
  // plan/stages when the activity never had questions.
  // An activity with questions downloads as the paper (the assignment
  // template): the learners' paper, or the teacher copy with the marking scheme.
  const printPaper = (copy) => {
    setPdfErr(false);
    apiBlob(`/api/self-study/${data.id}/paper.html?copy=${copy}&embed=1`)
      .then((b) => b.text())
      .then((html) => printPaperHtml(html, `${data.title || 'Assignment'}${copy === 'teacher' ? ' — marking scheme' : ''}`))
      .catch(() => setPdfErr(true));
  };
  const downloadPdf = () => {
    if (questions.length) { printPaper('student'); return; }
    try {
      downloadActivityPdf({
        draft: {
          title: data.title,
          type: data.type,
          payload: {
            subject: data.subject,
            topic: data.topic,
            difficulty: data.difficulty,
            due_at: data.due_at,
            instructions: data.instructions,
            subtopics: data.subtopics,
            objectives: data.objectives,
            details: data.details,
          },
        },
        meta: byKey(data.type || activity?.type || 'self_study') || {},
        shown: questions.length ? { status: 'ready', paper: data.details } : null,
        audience: {},
      });
      setPdfErr(false);
    } catch { setPdfErr(true); }
  };
  if (!activity?.id) return (
    <PageLayout title="Activity" subtitle="Details">
      <div style={{ fontFamily: FONT, color: MUTED }}>This activity is no longer available.</div>
      <div style={{ marginTop: 14 }}><Btn onClick={() => onClose()}>Back to activities</Btn></div>
    </PageLayout>
  );

  return (
    <PageLayout title={data?.title || activity?.title || 'Activity'} subtitle="Activity details">
      <div style={{ maxWidth: 640, margin: '0 auto', fontFamily: FONT }}>
        <button onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14, background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontSize: 12.5, fontWeight: 700, fontFamily: FONT, padding: 0 }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to activities
        </button>
      {!data ? (
        <div style={{ fontSize: 13, color: MUTED, fontFamily: FONT, padding: '10px 0' }}>Loading…</div>
      ) : (
        <div style={{ fontFamily: FONT }}>
          {/* The brief — same data the self-study detail shows, whatever the kind. */}
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>
            <meta.icon size={12} color={meta.color} style={{ verticalAlign: '-2px', marginRight: 4 }} />{data.subject} · {data.topic}
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

          {/* Questions riding with the brief — learners answer these on submit. */}
          {(data.details?.questions ?? []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: MUTED2, marginBottom: 7 }}>
                QUESTIONS · {(data.details.questions ?? []).length}
              </div>
              <PaperView details={data.details} showKey style={{ padding: '14px 16px' }} />
            </div>
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
                        <span style={{ fontSize: 13, fontWeight: 900, color: '#6B7280' }}>{(t.full_name || 'L').trim().charAt(0).toUpperCase()}</span>
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

          {pdfErr && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 11px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, fontWeight: 700, color: RED, fontFamily: FONT, marginTop: 12 }}>
              <AlertTriangle size={13} /> Couldn't build the PDF — try again.
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn size="sm" variant="secondary" onClick={downloadPdf} disabled={!canPdf}
                title="Download this activity as a PDF">
                <Download size={13} /> {questions.length ? 'Download paper' : 'Download PDF'}
              </Btn>
              {questions.length > 0 && (
                <Btn size="sm" variant="secondary" onClick={() => printPaper('teacher')} title="Download the marking scheme (teacher copy)">
                  <Download size={13} /> Marking scheme
                </Btn>
              )}
              <Btn size="sm" variant="secondary" onClick={del}><Trash2 size={13} /> Delete activity</Btn>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn size="sm" variant="secondary" onClick={() => navigate(`/self-study/${activity.id}/analytics`)}>
                <BarChart3 size={13} /> Analytics
              </Btn>
              <Btn size="sm" variant="secondary" onClick={onClose}>Close</Btn>
            </div>
          </div>
        </div>
      )}
      </div>
    </PageLayout>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
/* ── AI drafts strip — the human approval surface ────────────────────────────
   Drafts the agent prepared (instructor chat or a python agent task run) sit
   here until a human previews and assigns or discards them. Nothing reaches a
   learner from this strip without the instructor's Preview → Assign. */
function DraftsStrip({ refreshKey, onResolved }) {
  const [drafts, setDrafts]     = useState([]);
  const [routines, setRoutines] = useState([]);
  const navigate = useNavigate();
  const [loading, setLoading]   = useState(true);

  const load = useCallback(() => {
    apiGet('/api/self-study/drafts')
      .then(d => setDrafts(d?.data?.drafts ?? []))
      .catch(() => setDrafts([]))
      .finally(() => setLoading(false));
  }, []);
  const loadRoutines = useCallback(() => {
    apiGet('/api/self-study/routines')
      .then(d => setRoutines(d?.data?.routines ?? []))
      .catch(() => setRoutines([]));
  }, []);
  useEffect(() => { load(); loadRoutines(); }, [load, loadRoutines, refreshKey]);

  const flipRoutine = (r) => apiPatch(`/api/self-study/routines/${r.id}`, { status: r.status === 'active' ? 'paused' : 'active' }).then(loadRoutines).catch(() => {});
  const dropRoutine = (r) => apiDelete(`/api/self-study/routines/${r.id}`).then(loadRoutines).catch(() => {});
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (loading || (!drafts.length && !routines.length)) return null;
  return (
    <div style={{ background: `${PURPLE}08`, border: '1px solid rgba(168,85,247,.3)', borderRadius: 14, padding: '12px 16px', marginBottom: 18, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Sparkles size={14} color={PURPLE} />
        <span style={{ fontSize: 12, fontWeight: 900, color: PURPLE, letterSpacing: .3 }}>
          {drafts.length} AI-prepared draft{drafts.length === 1 ? '' : 's'} awaiting your review
        </span>
        <span style={{ fontSize: 11, color: MUTED2 }}>— nothing was sent to learners.</span>
      </div>
      {/* Weekly routines — preparation is automated, assignment stays human. */}
      {routines.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: drafts.length ? 8 : 0 }}>
          <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: .4, color: MUTED2, textTransform: 'uppercase' }}>Weekly routines</span>
          {routines.map(r => (
            <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 11px', borderRadius: 20, background: WHITE, border: `1px solid ${BORDER}`, fontSize: 11, fontWeight: 700, color: MUTED, fontFamily: FONT }}>
              <span style={{ color: r.status === 'active' ? GREEN : MUTED2 }}>{'\u{1F501}'}</span>
              {DAY[r.day_of_week]} · {r.title}
              <button onClick={() => flipRoutine(r)} title={r.status === 'active' ? 'Pause' : 'Resume'}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 10.5, fontWeight: 800, color: r.status === 'active' ? AMBER : GREEN, fontFamily: FONT, padding: '2px 4px' }}>
                {r.status === 'active' ? 'Pause' : 'Resume'}
              </button>
              <button onClick={() => dropRoutine(r)} title="Cancel routine"
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: RED, fontFamily: FONT, padding: '2px 5px' }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {drafts.map(d => (
          <button key={d.id} onClick={() => navigate(`/activities?draft=${d.id}`)}
            title="Preview this draft — assigning is your call"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20,
              border: '1px solid rgba(168,85,247,.45)', background: WHITE, color: PURPLE,
              fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, maxWidth: 320 }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</span>
            <span style={{ fontSize: 9.5, fontWeight: 900, background: 'rgba(168,85,247,.14)', padding: '1px 7px', borderRadius: 8, textTransform: 'uppercase', flexShrink: 0 }}>
              {(d.type || '').replace('_', ' ')}
            </span>
            Preview
          </button>
        ))}
      </div>
      )}
    </div>
  );
}

/* URL shell — the draft/detail pages are their own COMPONENTS, so navigating
   list → detail → list never changes one component's hook count (hooks were
   previously declared after these early returns: opening a card crashed the
   page with "rendered fewer hooks than expected"). */
export default function ActivitiesPage() {
  const location = useLocation();
  const [sp] = useSearchParams();
  // The dedicated pages are PATHS (/activities/detail, /activities/draft) —
  // branch on the pathname, falling back to the query for ?draft=?detail=
  // links. (Branching on the query alone made every card click a no-op: the
  // route matched, the shell fell through, and the list just re-rendered.)
  const onDetail = location.pathname.endsWith('/detail');
  const onDraft = location.pathname.endsWith('/draft');
  const draftId = sp.get('draft');
  const detailId = sp.get('detail') || (onDetail ? ((location.state || {}).activity || {}).id : null);
  if (onDraft || draftId) return <DraftRoute draftId={draftId} />;
  if (onDetail || detailId) return <DetailRoute detailId={detailId} />;
  return <ActivitiesHome />;
}

/* The AI-prepared draft opens as a DEDICATED PAGE (its own URL), not a modal. */
function DraftRoute({ draftId }) {
  const navigate = useNavigate();
  if (!draftId) {
    return (
      <PageLayout title="AI-prepared activity" subtitle="Review & assign — human-in-the-loop">
        <div style={{ fontFamily: FONT, color: MUTED }}>No draft was specified.</div>
        <div style={{ marginTop: 14 }}><Btn onClick={() => navigate('/activities')}>Back to activities</Btn></div>
      </PageLayout>
    );
  }
  return (
    <PageLayout title="AI-prepared activity" subtitle="Review & assign — human-in-the-loop">
      <div style={{ height: 'calc(100vh - 190px)', minHeight: 460 }}>
        <ActivityPreviewPanel
          draftId={draftId}
          onClose={() => navigate(-1)}
          onResolved={() => navigate('/activities')}
        />
      </div>
    </PageLayout>
  );
}

/* Past-activity details — a dedicated page (its own URL), not a modal. */
function DetailRoute({ detailId }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = (location.state || {}).activity;
  return <DetailPage activity={fromState || { id: detailId }} onDeleted={() => navigate('/activities')} onClose={() => navigate(-1)} />;
}

function ActivitiesHome() {
  const navigate = useNavigate();
  const [key, setKey] = useState('self_study');
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState(null);

  const meta = byKey(key);
  const note = meta.note;

  return (
    <PageLayout
      title="Activities"
      subtitle="Create work, assign it to learners, and see what has been done"
      action={<Btn size="sm" onClick={() => setRefreshKey(k => k + 1)}><Plus size={14} /> Refresh</Btn>}
    >
      <DraftsStrip refreshKey={refreshKey} onResolved={() => setRefreshKey(k => k + 1)} />
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
                  <span style={{ fontSize: 12, fontWeight: 900, flexShrink: 0, marginTop: 1, color: 'rgba(255,255,255,.85)' }}>{(t.name || 'T').trim().charAt(0).toUpperCase()}</span>
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
          {key === 'battle'
            ? <BattlePanel onDone={() => setRefreshKey(k => k + 1)} />
            : key === 'multi_stage'
              ? <MultiStageForm onAssigned={() => setRefreshKey(k => k + 1)} />
              : <ActivityForm key={key} type={key} onAssigned={() => setRefreshKey(k => k + 1)} />}
        </section>
      </div>

      {key === 'battle'
        ? <BattlePastStrip refreshKey={refreshKey} />
        : <PastActivities type={key} refreshKey={refreshKey} onOpen={(a) => navigate('/activities/detail', { state: { activity: a } })} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}


/* ── Battle panel — the same battle creation form, inline ────────────────── */
function BattlePanel({ onDone }) {
  const { createBattle, getBattles } = useBattlesAPI();
  const { getCourses } = useCoursesAPI();
  const [courses, setCourses] = useState([]);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState('');

  const getCoursesRef = useRef(getCourses);
  getCoursesRef.current = getCourses;
  useEffect(() => {
    getCoursesRef.current().then(d => setCourses(d?.data ?? [])).catch(() => setCourses([]));
  }, []);

  const submit = async (form) => {
    setError('');
    const scheduledIso = form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null;
    const res = await createBattle({
      kind: form.kind, courseId: form.courseId, classId: form.classId,
      question_source: form.questionSource,
      ...(form.kind !== 'course' ? { subject: form.subject } : {}),
      ...(form.kind === 'review' ? { mode: 'review' } : {}),
      title: form.title.trim(),
      description: form.description || null,
      topic: form.topic || null,
      difficulty: form.difficulty,
      total_questions: parseInt(form.totalQuestions, 10) || 15,
      time_limit_seconds: (parseInt(form.duration, 10) || 15) * 60,
      xp_prize: parseInt(form.xpPrize, 10) || 200,
      expires_in_minutes: parseInt(form.expiresInMinutes, 10) || 60,
      scheduled_for: scheduledIso,
      ...audienceBody(form.audience),
    });
    const d = res?.data ?? res ?? {};   // invite responses are top-level bodies
    const bits = [];
    if (d.skipped?.not_enrolled?.length) bits.push(`not on this course: ${d.skipped.not_enrolled.join(', ')}`);
    if (d.skipped?.not_in_class?.length)  bits.push(`not in this class: ${d.skipped.not_in_class.join(', ')}`);
    if (d.skipped?.no_agent?.length)     bits.push(`no agent yet: ${d.skipped.no_agent.join(', ')}`);
    const src = d.generated ? `${d.fromBank} from the bank + ${d.generated} generated` : `${d.questions} questions`;
    setToast({ message: `Battle created — ${d.invited} challenged, ${src}${bits.length ? `. Left out — ${bits.join('; ')}` : ''}`, type: 'success' });
    setTimeout(() => setToast(null), 4200);
    onDone();
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: `${RED}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Swords size={19} color={RED} />
        </div>
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 900, color: INK }}>New battle</div>
          <div style={{ fontSize: 11.5, color: MUTED }}>The same battle you create on the Battles page — timed questions, XP, leaderboard.</div>
        </div>
      </div>
      {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700, fontFamily: FONT, marginBottom: 8 }}>{error}</div>}
      <BattleForm onSubmit={submit} courses={courses} submitLabel="Create battle" embedded />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

/* ── Past battles — read-only strip; management lives on the Battles page ── */
const BATTLE_STATUS = {
  live:      { color: GREEN, bg: '#DCFCE7', label: 'Live' },
  scheduled: { color: BLUE,  bg: '#EFF6FF', label: 'Scheduled' },
  completed: { color: MUTED, bg: LIGHT,     label: 'Completed' },
  draft:     { color: MUTED, bg: LIGHT,     label: 'Draft' },
};

function BattlePastStrip({ refreshKey }) {
  const { getBattles } = useBattlesAPI();
  const [past, setPast] = useState(null);
  const getBattlesRef = useRef(getBattles);
  getBattlesRef.current = getBattles;

  useEffect(() => {
    getBattlesRef.current().then(d => setPast(d?.data ?? [])).catch(() => setPast([]));
  }, [refreshKey]);

  if (past && past.length === 0) return null;

  return (
    <div style={{ marginTop: 22, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 18px', fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>Past battles</div>
        <div style={{ fontSize: 11, color: MUTED2 }}>manage on the Battles page</div>
      </div>
      {past === null ? (
        <div style={{ display: 'flex', gap: 12 }}>{[0, 1, 2].map(i => <div key={i} style={{ flex: '0 0 224px', height: 96, borderRadius: 12, background: LIGHT }} />)}</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4, scrollSnapType: 'x proximity' }}>
          {past.slice(0, 12).map(b => {
            const st = BATTLE_STATUS[b.status] || BATTLE_STATUS.draft;
            return (
              <div key={b.id} style={{ flex: '0 0 auto', width: 224, scrollSnapAlign: 'start', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ display: 'flex', flexShrink: 0 }}><Swords size={14} color="#DC2626" /></span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</span>
                </div>
                <Badge color={st.color} bg={st.bg}>{st.label}</Badge>
                <div style={{ fontSize: 10, color: MUTED2, marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={10} />{b.scheduled_start || b.scheduledAt ? fmtWhen(b.scheduled_start || b.scheduledAt) : b.topic || '—'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function fmtWhen(iso) {
  try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

/* ── Multi-stage composer — several activities chained as one journey ────── */
const STAGE_KINDS = [
  { key: 'self_study', label: 'Self study' },
  { key: 'assignment', label: 'Assignment' },
  { key: 'project',    label: 'Project' },
  { key: 'battle',     label: 'Battle' },
];

function MultiStageForm({ onAssigned }) {
  const [title, setTitle]           = useState('');
  const [stages, setStages]         = useState([]);
  const [classes, setClasses]       = useState([]);
  const [classId, setClassId]       = useState('');
  const [audience, setAudience]     = useState(BLANK_AUDIENCE);
  const [dueAt, setDueAt]           = useState('');
  const [battleFor, setBattleFor]   = useState(null);   // stage key awaiting a battle
  const [draftingKey, setDraftingKey] = useState(null);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [done, setDone]             = useState(null);

  useEffect(() => {
    apiGet('/api/instructor/classrooms')
      .then(d => setClasses(d?.data ?? []))
      .catch(() => setClasses([]));
  }, []);
  useEffect(() => { if (classes.length && !classId) setClassId(classes[0].id); }, [classes, classId]);

  const addStage = (kind) => setStages(ss => [...ss, {
    key: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    kind, title: '', topic: '', subject: 'Basic Science', instructions: '',
    subtopics: [], objectives: {}, battle: null,
  }]);
  const patchStage = (key, patch) => setStages(ss => ss.map(st => st.key === key ? { ...st, ...patch } : st));
  const removeStage = (key) => setStages(ss => ss.filter(st => st.key !== key));
  const moveStage = (i, dir) => setStages(ss => {
    const next = [...ss];
    const j = i + dir;
    if (j < 0 || j >= next.length) return ss;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const draftStage = async (stage) => {
    if (!stage.topic.trim()) return setError('Enter the stage topic first.');
    setError(''); setDraftingKey(stage.key);
    try {
      const d = await apiPost('/api/self-study/plan', { topic: stage.topic.trim(), subject: stage.subject });
      const pl = d?.data ?? {};
      patchStage(stage.key, {
        subtopics: pl.subtopics ?? [],
        objectives: pl.objectives ?? {},
        title: stage.title || `${stage.topic.trim()} — ${STAGE_KINDS.find(k => k.key === stage.kind)?.label.toLowerCase()}`,
      });
    } catch (e) { setError(e?.message || 'Could not draft the plan.'); }
    finally { setDraftingKey(null); }
  };

  const battleCreated = async (form, battleId) => {
    // The stage keeps the battle's id + title; the battle itself is already
    // live for its audience — the journey references it, in order, and the
    // learner's participation in it completes the stage.
    const stage = stages.find(st => st.key === battleFor);
    if (stage) patchStage(stage.key, {
      battle: { title: form.title.trim(), kind: form.kind, battleId: battleId ?? null },
      title: stage.title || form.title.trim(),
    });
    setBattleFor(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!title.trim()) return setError('Give the journey a title.');
    if (!stages.length) return setError('Add at least one stage.');
    if (!classId) return setError('Pick a class.');
    const aud = audience;
    if (aud.mode === 'class' && !aud.classroomId) return setError('Pick which class this is for.');
    if (aud.mode === 'picked' && !(aud.selected.length + parseHandles(aud.typed).length))
      return setError('Choose at least one learner, or send it to the whole class.');
    const badStage = stages.find(st => st.kind !== 'battle' && (!st.title.trim() || !st.topic.trim()));
    if (badStage) return setError('Every stage needs a title and a topic.');
    const noBattle = stages.find(st => st.kind === 'battle' && !st.battle);
    if (noBattle) return setError('Create the battle for every battle stage before assigning.');

    setSaving(true);
    try {
      const dueIso = dueAt ? new Date(dueAt).toISOString() : null;
      const refs = [];
      for (const st of stages) {
        if (st.kind === 'battle') {
          refs.push({ kind: 'battle', title: st.battle.title });
          continue;
        }
        const clean = st.subtopics.map(x => x.trim()).filter(Boolean);
        const objectives = {};
        for (const x of clean) objectives[x] = (st.objectives[x] ?? []).map(o => o.trim()).filter(Boolean);
        const t = audienceBody(audience);
        const d = await apiPost('/api/self-study', {
          type: st.kind,
          title: st.title.trim(), subject: st.subject, topic: st.topic.trim(),
          instructions: st.instructions || null,
          subtopics: clean, objectives,
          due_at: dueIso,
          ...t,
          classroom_id: t.whole_class ? classId : null,
        });
        refs.push({ kind: st.kind, refId: d?.data?.id ?? null, title: st.title.trim() });
      }
      const t = audienceBody(audience);
      await apiPost('/api/self-study', {
        type: 'multi_stage',
        title: title.trim(),
        subject: stages.find(st => st.kind !== 'battle')?.subject || 'General',
        topic: title.trim(),
        instructions: `A ${refs.length}-step journey: ${refs.map(r => r.title).join(' → ')}`,
        due_at: dueIso,
        details: { stages: refs },
        ...t,
        classroom_id: t.whole_class ? classId : null,
      });
      setDone(`Journey assigned — ${refs.length} stage${refs.length === 1 ? '' : 's'}, in order.`);
      setTitle(''); setStages([]); setDueAt(''); setAudience(BLANK_AUDIENCE);
      onAssigned();
    } catch (err) {
      setError(err?.message || 'Could not assign the journey.');
    } finally { setSaving(false); }
  };

  return (
    <>
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: '#A855F718', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ListChecks size={19} color="#A855F7" />
        </div>
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 900, color: INK }}>New multi-stage activity</div>
          <div style={{ fontSize: 11.5, color: MUTED }}>Chain activities into one ordered journey — learners see the roadmap.</div>
        </div>
      </div>

      {done && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px', borderRadius: 10, background: '#DCFCE7', border: '1px solid #BBF7D0', fontSize: 12.5, fontWeight: 800, color: GREEN }}>
          <CheckCircle2 size={14} /> {done}
        </div>
      )}

      <Inp label="Journey title *" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Photosynthesis: learn it, prove it, win it" />

      {/* Stages */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 8 }}>Stages * <span style={{ fontWeight: 600, color: MUTED2 }}>— learners do them top to bottom</span></div>
        {stages.length === 0 && (
          <div style={{ padding: '18px', textAlign: 'center', border: `1px dashed ${BORDER}`, borderRadius: 12, background: LIGHT, fontSize: 12, color: MUTED }}>
            No stages yet — add the first one below.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {stages.map((st, i) => {
            const meta = STAGE_KINDS.find(k => k.key === st.kind);
            return (
              <div key={st.key} style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 14px', background: WHITE }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: st.kind === 'battle' ? 0 : 10 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, background: '#A855F718', color: '#A855F7', fontSize: 11, fontWeight: 900, textAlign: 'center', lineHeight: '22px' }}>{i + 1}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>{meta.label}</span>
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={() => moveStage(i, -1)} disabled={i === 0} title="Move up"
                    style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? BORDER : MUTED, display: 'flex', padding: 2 }}><ArrowUp size={13} /></button>
                  <button type="button" onClick={() => moveStage(i, 1)} disabled={i === stages.length - 1} title="Move down"
                    style={{ background: 'none', border: 'none', cursor: i === stages.length - 1 ? 'default' : 'pointer', color: i === stages.length - 1 ? BORDER : MUTED, display: 'flex', padding: 2 }}><ArrowDown size={13} /></button>
                  <button type="button" onClick={() => removeStage(st.key)} title="Remove stage"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, display: 'flex', padding: 2 }}><Trash2 size={13} /></button>
                </div>

                {st.kind === 'battle' ? (
                  st.battle
                    ? <div style={{ fontSize: 12, fontWeight: 700, color: GREEN }}>{st.battle.title} — battle is live for its audience</div>
                    : <Btn size="sm" variant="secondary" type="button" onClick={() => setBattleFor(st.key)}>
                        <Swords size={13} /> Create the battle for this stage
                      </Btn>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <Sel value={st.subject} onChange={e => patchStage(st.key, { subject: e.target.value })} label="Subject *">
                        {SUBJECTS.map(x => <option key={x} value={x}>{x}</option>)}
                      </Sel>
                      <Inp label="Stage title *" value={st.title} onChange={e => patchStage(st.key, { title: e.target.value })} placeholder="What learners see" />
                    </div>
                    <Inp label="Topic *" value={st.topic} onChange={e => patchStage(st.key, { topic: e.target.value })} placeholder="e.g. Photosynthesis" />
                    <Txa label="Instructions" value={st.instructions} onChange={e => patchStage(st.key, { instructions: e.target.value })} rows={2} style={{ marginTop: 8 }} />

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 0 6px' }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: INK }}>Stage plan *</div>
                      <Btn size="sm" variant="secondary" type="button" onClick={() => draftStage(st)} disabled={draftingKey === st.key}>
                        {draftingKey === st.key
                          ? <><Loader2 size={12} style={{ animation: 'spin .8s linear infinite' }} /> Drafting…</>
                          : <><Sparkles size={12} /> {st.subtopics.length ? 'Redraft' : 'Draft with AI'}</>}
                      </Btn>
                    </div>
                    <PlanEditor
                      subtopics={st.subtopics} objectives={st.objectives}
                      onChange={(subtopics, objectives) => patchStage(st.key, { subtopics, objectives })}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {STAGE_KINDS.map(k => (
            <button key={k.key} type="button" onClick={() => addStage(k.key)}
              style={{ padding: '7px 13px', borderRadius: 20, border: `1px solid ${BORDER}`, background: WHITE, cursor: 'pointer', fontSize: 11.5, fontWeight: 800, color: INK, fontFamily: FONT }}>
              + {k.label}
            </button>
          ))}
        </div>
      </div>

      {/* Who — shared by every stage */}
      <div>
        <Sel label="Class *" value={classId} onChange={e => setClassId(e.target.value)}>
          {classes.length === 0 && <option value="">No classes set up yet</option>}
          {classes.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}{c.student_count ? ` — ${c.student_count} learner${c.student_count === 1 ? '' : 's'}` : ''}
            </option>
          ))}
        </Sel>
        <div style={{ marginTop: 12 }}>
          <AudiencePicker
            value={audience} onChange={setAudience}
            modes={['course', 'picked']}
            allLabel={{ label: 'Everyone in the class', hint: 'All active members' }}
            rosterUrl={classId ? `/api/instructor/classrooms/${classId}/students` : null}
          />
        </div>
      </div>

      <Inp label="Due for every stage (optional)" type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} />

      {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700, fontFamily: FONT }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <Btn type="submit" disabled={saving}>
          {saving ? 'Assigning…' : <><ListChecks size={14} /> Assign journey</>}
        </Btn>
      </div>

    </form>

    {/* The same battle creation form, in a modal, for battle stages — a
        sibling of the journey form: a form must never nest inside a form. */}
    <BattleStageModal open={!!battleFor} onClose={() => setBattleFor(null)} onCreated={battleCreated} />
    </>
  );
}

function BattleStageModal({ open, onClose, onCreated }) {
  const { createBattle } = useBattlesAPI();
  const { getCourses } = useCoursesAPI();
  const [courses, setCourses] = useState([]);
  const getCoursesRef = useRef(getCourses);
  getCoursesRef.current = getCourses;
  useEffect(() => { if (open) getCoursesRef.current().then(d => setCourses(d?.data ?? [])).catch(() => setCourses([])); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Stage battle" width={540}>
      <BattleForm
        courses={courses} submitLabel="Create battle for this stage"
        onSubmit={async (form) => {
          // The journey needs the battle's id: stage completion is derived
          // from this learner's participant row in a FINISHED battle.
          const res = await createBattleForStage(form, createBattle);
          const battleId = res?.battle_id ?? res?.data?.battle_id ?? null;
          onCreated(form, battleId);
          onClose();
        }}
        onCancel={onClose}
      />
    </Modal>
  );
}

async function createBattleForStage(form, createBattle) {
  const scheduledIso = form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null;
  return createBattle({
    kind: form.kind, courseId: form.courseId, classId: form.classId,
    question_source: form.questionSource,
    ...(form.kind !== 'course' ? { subject: form.subject } : {}),
    ...(form.kind === 'review' ? { mode: 'review' } : {}),
    title: form.title.trim(),
    description: form.description || null,
    topic: form.topic || null,
    difficulty: form.difficulty,
    total_questions: parseInt(form.totalQuestions, 10) || 15,
    time_limit_seconds: (parseInt(form.duration, 10) || 15) * 60,
    xp_prize: parseInt(form.xpPrize, 10) || 200,
    expires_in_minutes: parseInt(form.expiresInMinutes, 10) || 60,
    scheduled_for: scheduledIso,
    ...audienceBody(form.audience),
  });
}
