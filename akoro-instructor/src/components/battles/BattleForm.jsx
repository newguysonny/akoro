import { useState, useEffect } from 'react';
import { Btn, Inp, Txa, Sel } from '../Primitives.jsx';
import AudiencePicker, { parseHandles, BLANK_AUDIENCE } from '../AudiencePicker.jsx';
import { apiGet } from '../../services/api.js';
import { RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

/* datetime-local wants local wall-clock, not the ISO Z string. */
function toLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const BLANK = {
  courseId: '', title: '', topic: '', description: '',
  kind: 'course',            // 'course' | 'class'
  questionSource: 'auto',    // 'auto' | 'bank' | 'ai'
  classId: '', subject: '',  // class battles only
  audience: BLANK_AUDIENCE,
  totalQuestions: '15', duration: '15', xpPrize: '200', hpPerMiss: '10', minXp: '0',
  difficulty: 'intermediate', scheduledAt: '', expiresInMinutes: '60',
  // Recurring (battle/series.js): days of the week, a time, an end date and time.
  repeats: false, days: [], repeatTime: '16:00', repeatUntil: '',
};

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * BattleForm — the full battle creation form, self-contained: battle type,
 * course or class + subject, audience, questions, difficulty, schedule.
 * Renders inline (Activities workbench) or inside the Battles page modal —
 * one implementation, two hosts. `onSubmit(form)` receives the validated
 * form; the host owns the API call.
 */
export default function BattleForm({ onSubmit, onCancel, courses = [], editing = null, submitLabel, embedded = false }) {
  const [form, setForm]     = useState(BLANK);
  const [classes, setClasses] = useState([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Classes carry their own subjects, which is what a class battle draws
  // questions from — so one fetch answers both "which class?" and "which
  // subject?". Both hosts mount this form only when it's visible, so
  // mount == shown: fetch once, no `open` prop needed.
  useEffect(() => {
    setClassesLoading(true);
    apiGet('/api/battle/my-classes')
      .then(d => setClasses(d?.data ?? []))
      .catch(() => setClasses([]))
      .finally(() => setClassesLoading(false));
  }, []);

  const chosenClass = classes.find(c => c.id === form.classId);

  // Reset on mount, seeded from the battle being edited (and again if the
  // host swaps in a different battle or the course list arrives late).
  useEffect(() => {
    setError('');
    if (editing) {
      setForm({
        ...BLANK,
        // Edit what it is: a class battle or review has no course, and keeping
        // kind 'course' blocked Save with "Pick a course."
        kind: editing.type === 'review' ? 'review' : (editing.scope === 'class' || editing.classroomId) ? 'class' : 'course',
        courseId: editing.courseId || '',
        classId: editing.classroomId || '',
        subject: editing.subject || '',
        title: editing.title || '',
        topic: editing.topic || '',
        description: editing.description || '',
        totalQuestions: String(editing.totalQuestions || 15),
        duration: String(editing.durationMin || 15),
        xpPrize: String(editing.xpPool || 200),
        hpPerMiss: String(editing.hpPerMiss ?? 10),
        minXp: String(editing.entry?.minXp ?? 0),
        difficulty: editing.difficulty || 'intermediate',
        scheduledAt: editing.scheduledAt ? toLocalInput(editing.scheduledAt) : '',
      });
    } else {
      setForm({ ...BLANK, courseId: courses[0]?.id || '' });
    }
  }, [editing, courses]);

  useEffect(() => {
    if (!classes.length) return;
    setForm(f => {
      if (f.classId && classes.some(c => c.id === f.classId)) return f;
      const first = classes[0];
      return { ...f, classId: first.id, subject: first.subjects?.[0] ?? '' };
    });
  }, [classes]);

  useEffect(() => {
    if (!chosenClass) return;
    setForm(f => (chosenClass.subjects?.includes(f.subject)
      ? f : { ...f, subject: chosenClass.subjects?.[0] ?? '' }));
  }, [chosenClass]);   // eslint-disable-line react-hooks/exhaustive-deps


  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!editing && (form.kind === 'class' || form.kind === 'review')) {
      if (!form.classId) return setError('Pick a class.');
      if (!form.subject) return setError('Pick a subject — the questions are drawn from one.');
    } else if (!editing && !form.courseId) return setError('Pick a course.');
    // A review is one learner being checked, not a group being set work.
    if (!editing && form.kind === 'review') {
      const picked = form.audience.selected.length + parseHandles(form.audience.typed).length;
      if (form.audience.mode !== 'picked' || picked !== 1) {
        return setError('A study review is for one learner — choose exactly one.');
      }
    }
    if (!form.title.trim()) return setError('Give the battle a title.');
    if (!editing && form.repeats) {
      if (form.kind === 'review') return setError('A study review is set once; it does not repeat.');
      if (!form.days.length) return setError('Pick the days it repeats on.');
      if (!form.repeatUntil) return setError('Pick when the series ends.');
    }
    if (!editing) {
      const aud = form.audience;
      if (aud.mode === 'class' && !aud.classroomId) return setError('Pick which class this is for.');
      if (aud.mode === 'picked' && !(aud.selected.length + parseHandles(aud.typed).length))
        return setError('Choose at least one learner, or send it to a course or class.');
    }

    setLoading(true);
    try {
      await onSubmit(form);
      onCancel?.();   // the host closes its modal / resets the panel
    } catch (err) {
      setError(err?.message || 'Could not save the battle.');
    } finally {
      setLoading(false);
    }
  };

  return (
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Battle type first: it decides where the questions come from, and
            therefore what every field below means. A course battle draws on
            that course's question bank; a class battle draws on the
            past-questions bank for a subject the class studies. */}
        {!editing && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, marginBottom: 7 }}>Battle type *</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { key: 'course', label: 'Course battle', hint: courses.length ? "From a course's question bank" : 'No courses yet', off: !courses.length },
                { key: 'class',  label: 'Class battle',  hint: classesLoading ? 'Loading…' : classes.length ? 'From a class subject' : 'No classes yet', off: !classesLoading && !classes.length },
                // Not a contest: one learner, no opponent, no winner — a mark
                // sheet at the end saying what they knew.
                { key: 'review', label: 'Study review',  hint: classesLoading ? 'Loading…' : classes.length ? 'One learner, mark sheet' : 'No classes yet', off: !classesLoading && !classes.length },
              ].map(o => (
                <button key={o.key} type="button" disabled={o.off}
                  onClick={() => setField('kind', o.key)}
                  style={{
                    flex: 1, padding: '9px 8px', borderRadius: 10, textAlign: 'left',
                    border: `1.5px solid ${form.kind === o.key ? C.brand : C.border}`,
                    background: form.kind === o.key ? tint(7) : C.surface,
                    cursor: o.off ? 'not-allowed' : 'pointer', opacity: o.off ? 0.5 : 1,
                    fontFamily: C.font,
                  }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: form.kind === o.key ? C.brand : C.ink }}>{o.label}</div>
                  <div style={{ fontSize: 10.5, color: C.muted }}>{o.hint}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {(form.kind === 'course' || (editing && form.courseId)) ? (
          <Sel label="Course *" value={form.courseId} onChange={e => setField('courseId', e.target.value)} disabled={!!editing}>
            <option value="">Select a course…</option>
            {courses.map(c => <option key={c.id} value={c.id}>{c.title || c.name}</option>)}
          </Sel>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Sel label="Class *" value={form.classId} onChange={e => setField('classId', e.target.value)} disabled={!!editing}>
              {classesLoading && <option value="">Loading classes…</option>}
              {classes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.student_count ? ` — ${c.student_count} learners` : ''}
                </option>
              ))}
            </Sel>
            {/* Fixed once made: the questions are already written for this class and subject. */}
            <Sel label="Subject *" value={form.subject} onChange={e => setField('subject', e.target.value)} disabled={!!editing}>
              {(chosenClass?.subjects ?? []).length === 0 && <option value="">No subjects set</option>}
              {(chosenClass?.subjects ?? []).map(sub => <option key={sub} value={sub}>{sub}</option>)}
            </Sel>
          </div>
        )}

        <Inp label="Battle Title *" value={form.title} onChange={e => setField('title', e.target.value)} placeholder="e.g. Photosynthesis Showdown" />
        <Inp label="Topic" value={form.topic} onChange={e => setField('topic', e.target.value)} placeholder="e.g. Photosynthesis" />
        <Txa label="Description" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="What will learners be tested on?" rows={2} />

        {/* The scope is already settled above, so this only asks WHO within it —
            offering "a class" again here would be the same question with two
            possible answers. */}
        {!editing && (
          <AudiencePicker
            value={form.audience}
            onChange={(v) => setField('audience', v)}
            // A review has no "everyone" — it is one learner by definition, so
            // offering the whole class here would be offering something the
            // server will refuse.
            modes={form.kind === 'review' ? ['picked'] : ['course', 'picked']}
            allLabel={form.kind !== 'course'
              ? { label: 'Everyone in the class', hint: 'All active members' }
              : { label: 'Everyone on the course', hint: 'All active enrolments' }}
            rosterUrl={form.kind !== 'course'
              ? (form.classId ? `/api/battle/classes/${form.classId}/roster` : null)
              : (form.courseId ? `/api/battle/courses/${form.courseId}/roster` : null)}
            requireAgent
          />
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
          <Inp label="Questions" type="number" min="1" value={form.totalQuestions} onChange={e => setField('totalQuestions', e.target.value)} disabled={!!editing} title={editing ? 'The questions are already written — make a new battle to change how many.' : undefined} />
          <Inp label="Duration (min)" type="number" min="1" value={form.duration} onChange={e => setField('duration', e.target.value)} />
          <Inp label="XP prize" type="number" min="0" value={form.xpPrize} onChange={e => setField('xpPrize', e.target.value)} />
          {/* What a miss costs — like marks per question. Learners see it before they accept. */}
          <Inp label="HP lost per miss" type="number" min="0" max="50" value={form.hpPerMiss} onChange={e => setField('hpPerMiss', e.target.value)} />
        </div>
        {/* Entry requirement for a battle. A review checks knowledge — never gated on XP. */}
        {form.kind !== 'review' && (
          <Inp label="Minimum XP to join (0 = open to all)" type="number" min="0" value={form.minXp} onChange={e => setField('minXp', e.target.value)} />
        )}
        <div style={{ fontSize: 11, color: C.muted, fontFamily: C.font, marginTop: -6 }}>
          {(() => {
            const h = Math.min(50, Math.max(0, parseInt(form.hpPerMiss, 10) || 0));
            return h ? `Every agent starts on 100 HP and loses ${h} for each question it misses — out after ${Math.ceil(100 / h)} misses (then it watches, unranked).`
              : 'No HP lost for misses — nobody can be knocked out.';
          })()}
        </div>
        {/* Duration is shared across the questions, so say what each one gets.
            The number on its own told a teacher nothing — and until now it did
            nothing either: every battle ran at a hard 15 seconds a question
            whatever was typed here. */}
        <div style={{ fontSize: 11, color: C.muted, fontFamily: C.font, marginTop: -6 }}>
          {(() => {
            const q = parseInt(form.totalQuestions, 10);
            const m = parseInt(form.duration, 10);
            if (!q || !m) return 'Duration is shared across the questions.';
            const secs = Math.min(180, Math.max(8, Math.floor((m * 60) / q)));
            const clamped = secs !== Math.floor((m * 60) / q);
            return `≈ ${secs}s per question${clamped ? ' (clamped to the 8–180s range)' : ''}`;
          })()}
        </div>

        {!editing && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, marginBottom: 7 }}>Questions *</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { key: 'auto', label: 'Bank + AI', hint: 'Real questions first, AI for the rest' },
                { key: 'bank', label: 'Question bank only', hint: 'Past papers / your bank' },
                { key: 'ai',   label: 'Generate with AI',   hint: 'Written in the bank\u2019s style' },
              ].map(o => (
                <button key={o.key} type="button" onClick={() => setField('questionSource', o.key)} style={{
                  flex: 1, padding: '9px 8px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                  border: `1.5px solid ${form.questionSource === o.key ? C.brand : C.border}`,
                  background: form.questionSource === o.key ? tint(7) : C.surface, fontFamily: C.font,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: form.questionSource === o.key ? C.brand : C.ink }}>{o.label}</div>
                  <div style={{ fontSize: 10.5, color: C.muted }}>{o.hint}</div>
                </button>
              ))}
            </div>
            {form.questionSource !== 'bank' && (
              <div style={{ fontSize: 10.5, color: C.muted2, fontFamily: C.font, marginTop: 5, lineHeight: 1.45 }}>
                Generated questions are modelled on real exam questions for this subject and cost coins.
                Nothing is charged if generation fails.
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Sel label="Difficulty" value={form.difficulty} onChange={e => setField('difficulty', e.target.value)}>
            <option value="easy">Easy</option>
            <option value="intermediate">Medium</option>
            <option value="hard">Hard</option>
          </Sel>
          {!form.repeats && <Inp label="Schedule for (optional)" type="datetime-local" value={form.scheduledAt} onChange={e => setField('scheduledAt', e.target.value)} />}
        </div>

        {!editing && form.kind !== 'review' && (
          <div style={{ fontFamily: C.font }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 800, color: C.ink, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.repeats} onChange={e => setField('repeats', e.target.checked)} />
              <Ico ti="ti-repeat" size={14} color={C.brand} /> Repeats
            </label>
            {form.repeats && (
              <div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: C.bg }}>
                <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
                  {DAY_LETTERS.map((l, d) => {
                    const on = form.days.includes(d);
                    return (
                      <button key={d} type="button" aria-label={DAY_NAMES[d]} aria-pressed={on}
                        onClick={() => setField('days', on ? form.days.filter((x) => x !== d) : [...form.days, d].sort())}
                        style={{ flex: 1, height: 34, borderRadius: 9, cursor: 'pointer', fontFamily: C.font, fontSize: 12, fontWeight: 900,
                          border: `1.5px solid ${on ? C.brand : C.border}`, background: on ? C.brand : C.surface, color: on ? '#fff' : C.muted }}>{l}</button>
                    );
                  })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 10 }}>
                  <Inp label="Starts at" type="time" value={form.repeatTime} onChange={e => setField('repeatTime', e.target.value)} />
                  <Inp label="Ends" type="datetime-local" value={form.repeatUntil} onChange={e => setField('repeatUntil', e.target.value)} />
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
                  Everyone picked is in every one automatically; a learner can skip one or opt out. Each one is set up an hour before it starts, with fresh questions.
                </div>
              </div>
            )}
          </div>
        )}

        {error && <div style={{ fontSize: 12, color: RED, fontWeight: 700, fontFamily: C.font }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          {onCancel && <Btn variant="secondary" type="button" onClick={onCancel}>Cancel</Btn>}
          <Btn type="submit" disabled={loading || !form.title.trim() || (!editing && form.kind === 'course' && !form.courseId)}>
            {loading ? 'Saving…' : submitLabel || (editing ? 'Save changes' : 'Create Battle')}
          </Btn>
        </div>
      </form>
  );
}
