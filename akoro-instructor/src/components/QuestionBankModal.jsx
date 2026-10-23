/**
 * QuestionBankModal — manage a course's reusable battle question bank.
 * Wraps the battle-module endpoints:
 *   GET/POST /api/battle/courses/:courseId/questions-bank
 *   PUT/DELETE /api/battle/questions-bank/:id
 *   POST /api/battle/courses/:courseId/questions-bank/generate  (AI)
 */
import { useState, useEffect, useCallback } from 'react';
import { Trash2, Sparkles, Plus } from 'lucide-react';
import { Ico } from '../theme/Ico.jsx';
import { Modal, Btn, Inp, Sel, Txa, Toast, Skeleton } from './Primitives.jsx';
import { useBattlesAPI } from '../hooks/useBattlesAPI.js';
import { useCoursesAPI } from '../hooks/useCoursesAPI.js';
import { C, tint } from '../theme/colors.js';

const BLANK = { question_text: '', options: ['', '', '', ''], correct_answer_index: 0, topic: '', difficulty: 'intermediate', xp_value: 35 };

export default function QuestionBankModal({ open, onClose }) {
  const { getQuestionBank, addBankQuestion, deleteBankQuestion, generateBank } = useBattlesAPI();
  const { getCourses } = useCoursesAPI();

  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [gen, setGen] = useState({ topic: '', subject: '', difficulty: 'intermediate', count: 10 });
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const notify = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    if (!open) return;
    getCourses().then((d) => {
      const list = d?.data || d?.courses || d || [];
      setCourses(list);
      if (list.length && !courseId) setCourseId(list[0].id);
    }).catch(() => {});
  }, [open]);

  const load = useCallback(() => {
    if (!courseId) return;
    setLoading(true);
    getQuestionBank(courseId)
      .then((d) => setQuestions(d?.questions || []))
      .catch(() => setQuestions([]))
      .finally(() => setLoading(false));
  }, [courseId]);

  useEffect(() => { if (open && courseId) load(); }, [open, courseId, load]);

  const setOpt = (i, v) => setForm((f) => ({ ...f, options: f.options.map((o, j) => j === i ? v : o) }));

  const addQuestion = async () => {
    if (!form.question_text.trim() || form.options.some((o) => !o.trim())) return notify('Fill the question and all 4 options', 'error');
    setBusy(true);
    try {
      await addBankQuestion(courseId, { ...form, xp_value: parseInt(form.xp_value) || 35 });
      setForm(BLANK); notify('Question added'); load();
    } catch (e) { notify(e.message || 'Could not add question', 'error'); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    setQuestions((q) => q.filter((x) => x.id !== id));
    try { await deleteBankQuestion(id); } catch { load(); }
  };

  const generate = async () => {
    if (!gen.topic.trim() || !gen.subject.trim()) return notify('Topic and subject are required', 'error');
    setGenBusy(true);
    try {
      const r = await generateBank(courseId, { ...gen, count: parseInt(gen.count) || 10 });
      notify(`Generated ${r?.inserted ?? ''} questions`.trim()); load();
    } catch (e) { notify(e.message || 'Generation failed', 'error'); }
    finally { setGenBusy(false); }
  };

  if (!open) return null;
  const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 };
  const label = { fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 6, display: 'block', fontFamily: C.font };

  return (
    <Modal open={open} onClose={onClose} title="Battle Question Bank" width={640}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '72vh', overflowY: 'auto' }}>
        <div>
          <label style={label}>Course</label>
          <Sel value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            {courses.length === 0 && <option value="">No courses</option>}
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Sel>
        </div>

        {/* AI generate */}
        <div style={{ ...card, background: tint(4), borderColor: '#E9D8FF' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><Ico lucide={Sparkles} ti="ti-sparkles" size={14} /> Generate with AI</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Inp label="Topic" value={gen.topic} onChange={(e) => setGen({ ...gen, topic: e.target.value })} placeholder="e.g. Chain Rule" />
            <Inp label="Subject" value={gen.subject} onChange={(e) => setGen({ ...gen, subject: e.target.value })} placeholder="e.g. Further Maths" />
            <Sel label="Difficulty" value={gen.difficulty} onChange={(e) => setGen({ ...gen, difficulty: e.target.value })}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </Sel>
            <Inp label="How many" type="number" value={gen.count} onChange={(e) => setGen({ ...gen, count: e.target.value })} />
          </div>
          <Btn onClick={generate} disabled={genBusy || !courseId} style={{ marginTop: 10 }}><Ico lucide={Sparkles} ti="ti-sparkles" size={13} /> {genBusy ? 'Generating…' : 'Generate questions'}</Btn>
        </div>

        {/* Manual add */}
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginBottom: 10 }}>Add a question</div>
          <Txa label="Question" value={form.question_text} onChange={(e) => setForm({ ...form, question_text: e.target.value })} rows={2} placeholder="Question text" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
            {form.options.map((o, i) => (
              <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${form.correct_answer_index === i ? '#10B981' : C.border}`, borderRadius: 8, padding: '4px 8px', background: form.correct_answer_index === i ? '#F0FFF6' : C.surface }}>
                <input type="radio" checked={form.correct_answer_index === i} onChange={() => setForm({ ...form, correct_answer_index: i })} title="Correct answer" />
                <input value={o} onChange={(e) => setOpt(i, e.target.value)} placeholder={`Option ${['A', 'B', 'C', 'D'][i]}`}
                  style={{ border: 'none', outline: 'none', flex: 1, fontFamily: C.font, fontSize: 13, background: 'transparent', color: C.ink }} />
              </label>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Select the radio next to the correct option.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 10 }}>
            <Inp label="Topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
            <Sel label="Difficulty" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </Sel>
            <Inp label="XP" type="number" value={form.xp_value} onChange={(e) => setForm({ ...form, xp_value: e.target.value })} />
          </div>
          <Btn onClick={addQuestion} disabled={busy || !courseId} style={{ marginTop: 10 }}><Ico lucide={Plus} ti="ti-plus" size={13} /> {busy ? 'Adding…' : 'Add question'}</Btn>
        </div>

        {/* List */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8 }}>{questions.length} question{questions.length === 1 ? '' : 's'} in bank</div>
          {loading ? <Skeleton height={80} /> : questions.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', color: C.muted, fontSize: 13 }}>No questions yet. Add or generate some above.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {questions.map((q) => (
                <div key={q.id} style={{ ...card, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4 }}>{q.question_text}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>
                      ✓ {q.options?.[q.correct_answer_index]} · <span style={{ textTransform: 'capitalize' }}>{q.difficulty}</span>{q.topic ? ` · ${q.topic}` : ''} · {q.xp_value} XP{q.is_ai_generated ? ' · AI' : ''}
                    </div>
                  </div>
                  <button onClick={() => remove(q.id)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', padding: 4 }}><Ico lucide={Trash2} ti="ti-trash" size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
