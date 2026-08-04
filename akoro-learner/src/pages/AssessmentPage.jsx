import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND, RED, SUBJECTS, getStudentId } from '../constants.js';
import AssessmentRoom from '../components/assessment/AssessmentRoom.jsx';

const FONT = "'Nunito', sans-serif";

const SUBJECT_OPTIONS = Object.entries(SUBJECTS)
  .filter(([k]) => k !== 'all')
  .map(([k, v]) => ({ value: k, label: v.label, icon: v.icon }));

const DIFFICULTY_OPTIONS = [
  { value: '', label: 'Mixed (default)' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

const QUESTION_OPTIONS = [3, 5, 7, 10];

export default function AssessmentPage() {
  const navigate = useNavigate();

  // form state
  const [topic,       setTopic]       = useState('');
  const [subject,     setSubject]     = useState('');
  const [objectives,  setObjectives]  = useState('');
  const [questionCount, setQuestionCount] = useState(5);
  const [error,       setError]       = useState('');

  // when form is submitted we pass this to AssessmentRoom
  const [session, setSession] = useState(null);

  function handleStart(e) {
    e.preventDefault();
    if (!topic.trim()) { setError('Please enter a topic.'); return; }
    setError('');
    setSession({
      studentId:     getStudentId(),
      topic:         topic.trim(),
      subject:       subject || null,
      objectives:    objectives.trim()
                       ? objectives.split('\n').map(s => s.trim()).filter(Boolean)
                       : [],
      questionCount,
    });
  }

  // Full-screen assessment room (replaces this page content)
  if (session) {
    return (
      <div style={{ position:'fixed', inset:0, zIndex:999, background:'#0F172A' }}>
        <AssessmentRoom
          topic={session.topic}
          subject={session.subject}
          objectives={session.objectives}
          questionCount={session.questionCount}
          onClose={() => { setSession(null); navigate('/app'); }}
        />
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0F172A', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
      fontFamily: FONT,
    }}>
      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'rgba(255,255,255,.04)',
        border: '1px solid rgba(255,255,255,.08)',
        borderRadius: 20, padding: '32px 28px',
      }}>
        {/* Header */}
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⚡</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#F1F5F9' }}>
            Live Assessment
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748B', fontWeight: 600 }}>
            Sergeant will conduct your exam. Your webcam is required.
          </p>
        </div>

        <form onSubmit={handleStart} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Topic */}
          <Field label="Topic *">
            <input
              value={topic}
              onChange={e => { setTopic(e.target.value); setError(''); }}
              placeholder="e.g. Quadratic equations, World War II, Photosynthesis…"
              style={inputStyle}
            />
          </Field>

          {/* Subject */}
          <Field label="Subject">
            <select value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle}>
              <option value="">— Select subject (optional) —</option>
              {SUBJECT_OPTIONS.map(s => (
                <option key={s.value} value={s.value}>{s.icon} {s.label}</option>
              ))}
            </select>
          </Field>

          {/* Question count */}
          <Field label="Number of questions">
            <div style={{ display: 'flex', gap: 8 }}>
              {QUESTION_OPTIONS.map(n => (
                <button
                  key={n} type="button"
                  onClick={() => setQuestionCount(n)}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 10, fontFamily: FONT,
                    fontSize: 13, fontWeight: 800, cursor: 'pointer',
                    border: `1.5px solid ${questionCount === n ? BRAND : 'rgba(255,255,255,.1)'}`,
                    background: questionCount === n ? `${BRAND}22` : 'rgba(255,255,255,.04)',
                    color: questionCount === n ? BRAND : '#94A3B8',
                    transition: 'all .15s',
                  }}
                >{n}</button>
              ))}
            </div>
          </Field>

          {/* Learning objectives */}
          <Field label="Learning objectives (optional)" hint="One per line — helps Sergeant focus questions">
            <textarea
              value={objectives}
              onChange={e => setObjectives(e.target.value)}
              placeholder={"Understand the quadratic formula\nSolve word problems involving quadratics"}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }}
            />
          </Field>

          {error && (
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: RED }}>{error}</p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => navigate('/app')}
              style={{
                flex: 1, padding: '12px', borderRadius: 12, fontFamily: FONT,
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                border: '1px solid rgba(255,255,255,.1)',
                background: 'rgba(255,255,255,.05)', color: '#94A3B8',
              }}
            >Cancel</button>
            <button
              type="submit"
              style={{
                flex: 2, padding: '12px', borderRadius: 12, fontFamily: FONT,
                fontSize: 13.5, fontWeight: 800, cursor: 'pointer',
                border: 'none',
                background: `linear-gradient(135deg, ${BRAND}, ${BRAND}CC)`,
                color: '#fff',
              }}
            >⚡ Start assessment</button>
          </div>
        </form>

        <p style={{ margin: '20px 0 0', textAlign: 'center', fontSize: 11.5, color: '#475569', fontWeight: 600 }}>
          Your webcam will be monitored throughout the exam for integrity.
        </p>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 800, color: '#94A3B8', letterSpacing: .4 }}>
        {label.toUpperCase()}
      </label>
      {children}
      {hint && <p style={{ margin: 0, fontSize: 11, color: '#475569', fontWeight: 600 }}>{hint}</p>}
    </div>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,.05)',
  border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 10, padding: '10px 13px',
  color: '#F1F5F9', fontSize: 13.5, fontFamily: "'Nunito', sans-serif",
  outline: 'none',
};
