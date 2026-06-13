import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { API } from '../../services/api.js';

const AMBER = '#E8884A';
const RED   = '#EF4444';
const SUBJECT_OPTIONS = ['Mathematics', 'Further Mathematics', 'Physics', 'Chemistry', 'Biology',
  'Computer Science', 'English Language', 'English Literature', 'Economics', 'Geography', 'History'];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, markOnboarded } = useAuth();

  const [step, setStep]   = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr]     = useState('');

  const [fullName, setFullName]     = useState(user?.fullName || '');
  const [schoolName, setSchoolName] = useState('');
  const [subjects, setSubjects]     = useState([]);
  const [headline, setHeadline]     = useState('');

  const toggleSubject = (s) =>
    setSubjects(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const STEPS = ['Profile', 'Teaching focus'];

  const validateStep = () => {
    setErr('');
    if (step === 0 && !fullName.trim()) { setErr('Please enter your name'); return false; }
    if (step === 1 && subjects.length === 0) { setErr('Pick at least one subject you teach'); return false; }
    return true;
  };

  const next = () => { if (validateStep()) setStep(s => s + 1); };
  const back = () => { setErr(''); setStep(s => s - 1); };

  const finish = async () => {
    if (!validateStep()) return;
    setSaving(true); setErr('');
    try {
      const res = await fetch(`${API}/api/profiles/me`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName:    fullName.trim(),
          schoolName:  schoolName.trim() || undefined,
          subjects,
          onboardingCompleted: true,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || 'Could not save your setup');
      }
      markOnboarded();
      navigate('/', { replace: true });
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const inp = {
    width: '100%', padding: '11px 14px', borderRadius: 12,
    border: '1.5px solid #EDE8E1', outline: 'none', fontSize: 14,
    fontFamily: "'DM Sans', sans-serif", color: '#1A1A2E', boxSizing: 'border-box', background: '#fff',
  };
  const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: '#1A1A2E', marginBottom: 6 };
  const chip = (active) => ({
    padding: '8px 14px', borderRadius: 99, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? AMBER : '#EDE8E1'}`,
    background: active ? AMBER : '#fff', color: active ? '#fff' : '#6B6B80',
    fontFamily: "'DM Sans', sans-serif", transition: 'all .15s',
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', background: '#FAF8F5', padding: '24px 20px', fontFamily: "'DM Sans', sans-serif" }}>

      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: `linear-gradient(135deg, ${AMBER}, #D4651E)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, boxShadow: `0 4px 14px ${AMBER}44` }}>🎓</div>
        <div>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#1A1A2E', display: 'block' }}>Akoro</span>
          <span style={{ fontSize: 11, color: '#9490A0', display: 'block', marginTop: -2 }}>Instructor Portal</span>
        </div>
      </div>

      {/* Progress */}
      <div style={{ width: '100%', maxWidth: 460, marginBottom: 16, display: 'flex', gap: 8 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ flex: 1 }}>
            <div style={{ height: 5, borderRadius: 99, background: i <= step ? AMBER : '#EDE8E1', transition: 'background .2s' }}/>
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 6, color: i === step ? '#1A1A2E' : '#9490A0' }}>{s}</div>
          </div>
        ))}
      </div>

      {/* Card */}
      <div style={{ width: '100%', maxWidth: 460, background: '#fff', borderRadius: 24, padding: '28px 26px',
        boxShadow: '0 4px 32px rgba(0,0,0,.07)', border: '1px solid #EDE8E1' }}>

        {step === 0 && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1A1A2E', margin: '0 0 4px', fontFamily: "'Instrument Serif', serif" }}>Welcome, tutor 👋</h1>
            <p style={{ fontSize: 13, color: '#6B6B80', margin: '0 0 22px' }}>Tell students a little about you.</p>

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Full name</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Dr. Amara Osei" style={inp}/>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>School / institution <span style={{ fontWeight: 500, color: '#9490A0' }}>(optional)</span></label>
              <input value={schoolName} onChange={e => setSchoolName(e.target.value)} placeholder="Westwood Academy" style={inp}/>
            </div>
            <div>
              <label style={lbl}>Short headline <span style={{ fontWeight: 500, color: '#9490A0' }}>(optional)</span></label>
              <input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="A-Level Maths examiner, 12 yrs" style={inp}/>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1A1A2E', margin: '0 0 4px', fontFamily: "'Instrument Serif', serif" }}>What do you teach?</h1>
            <p style={{ fontSize: 13, color: '#6B6B80', margin: '0 0 22px' }}>Pick the subjects you'll build courses and agents for.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {SUBJECT_OPTIONS.map(s => <span key={s} onClick={() => toggleSubject(s)} style={chip(subjects.includes(s))}>{s}</span>)}
            </div>
          </>
        )}

        {err && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10,
            padding: '10px 14px', marginTop: 18, fontSize: 13, fontWeight: 700, color: RED }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
          {step > 0 && (
            <button onClick={back} disabled={saving} style={{ flex: '0 0 auto', padding: '13px 20px', borderRadius: 14,
              border: '1.5px solid #EDE8E1', background: '#fff', color: '#6B6B80', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>← Back</button>
          )}
          <button onClick={step === STEPS.length - 1 ? finish : next} disabled={saving} style={{ flex: 1, padding: '13px',
            borderRadius: 14, border: 'none', background: saving ? '#EDE8E1' : `linear-gradient(135deg, ${AMBER}, #D4651E)`,
            color: saving ? '#9490A0' : '#fff', fontSize: 14, fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif",
            boxShadow: saving ? 'none' : `0 4px 14px ${AMBER}44` }}>
            {step === STEPS.length - 1 ? (saving ? 'Setting up…' : 'Finish & go to dashboard') : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
