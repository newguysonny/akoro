import AkoroLogo from '../../components/common/AkoroLogo.jsx';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { API } from '../../services/api.js';
import { COUNTRIES, NG_STATES } from '../../data/locations.js';

const AMBER = '#E8884A';
const RED   = '#EF4444';
const EDUCATION_LEVELS = ['Nursery / Pre-school', 'Primary', 'Junior Secondary', 'Senior Secondary'];
const OWNERSHIP_TYPES  = ['Private', 'Public / Government', 'Faith-based / Mission', 'Community'];
const CURRICULA        = ['Nigerian (WAEC/NECO)', 'British / Cambridge', 'Montessori', 'American', 'International Baccalaureate', 'Mixed / Other'];
const GENDER_TYPES     = ['Mixed', 'Boys only', 'Girls only'];
const BOARDING_TYPES   = ['Day only', 'Boarding only', 'Day & Boarding'];
const STUDENT_BANDS    = ['1 – 100', '101 – 300', '301 – 600', '601 – 1,000', '1,000+'];
const GUIDE_EMOJIS     = ['🧠', '🎓', '📚', '🤖', '💡', '🦉', '⚡', '🌟', '🔮', '🚀', '🎯', '📘'];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, markOnboarded, logout } = useAuth();

  const [step, setStep]     = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  // School Info
  const [schoolName, setSchoolName] = useState(user?.fullName || '');
  const [phone, setPhone]           = useState('');
  const [country, setCountry]       = useState('Nigeria');
  const [state, setState]           = useState('');
  const [lga, setLga]               = useState('');
  const [city, setCity]             = useState('');
  const [street, setStreet]         = useState('');
  // Academic
  const [levels, setLevels]         = useState([]);
  const [ownership, setOwnership]   = useState('');
  const [curriculum, setCurriculum] = useState('');
  const [yearEst, setYearEst]       = useState('');
  const [gender, setGender]         = useState('');
  const [boarding, setBoarding]     = useState('');
  const [studentBand, setStudentBand] = useState('');
  // Agent Setup
  const [agentName, setAgentName]   = useState('');
  const [agentEmoji, setAgentEmoji] = useState('🧠');

  const toggleLevel = (l) => setLevels((prev) => prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]);

  const ngStates = country === 'Nigeria' ? Object.keys(NG_STATES) : [];
  const lgaOptions = country === 'Nigeria' ? (NG_STATES[state] || []) : [];

  const STEPS = ['School Info', 'Academic', 'Agent Setup'];

  const validateStep = () => {
    setErr('');
    if (step === 0 && !schoolName.trim()) { setErr('Please enter your school name'); return false; }
    if (step === 0 && !phone.trim()) { setErr('Please enter a phone number'); return false; }
    if (step === 0 && !country) { setErr('Please choose a country'); return false; }
    if (step === 0 && !state.trim()) { setErr('Please enter your state'); return false; }
    if (step === 1 && levels.length === 0) { setErr('Select at least one education level you offer'); return false; }
    return true;
  };
  const next = () => { if (validateStep()) setStep(s => s + 1); };
  const back = () => { setErr(''); setStep(s => s - 1); };

  const finish = async () => {
    if (!validateStep()) return;
    setSaving(true); setErr('');
    try {
      const addressLine = [street.trim(), city.trim(), lga.trim(), state.trim(), country].filter(Boolean).join(', ');
      const res = await fetch(`${API}/api/profiles/me`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'school' },
        body: JSON.stringify({
          fullName: schoolName.trim(), schoolName: schoolName.trim(), country,
          teachingGuide: agentName.trim() || undefined, guideEmoji: agentEmoji,
          onboardingCompleted: true,
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || 'Could not save your setup'); }

      const existing = await fetch(`${API}/api/school`, { credentials: 'include', headers: { 'X-Akoro-Portal': 'school' } });
      if (!existing.ok) {
        await fetch(`${API}/api/profiles/schools`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'school' },
          body: JSON.stringify({
            name: schoolName.trim(), phone: phone.trim() || undefined,
            country, state: state.trim() || undefined, lga: lga.trim() || undefined, city: city.trim() || undefined,
            address: addressLine || undefined,
            educationLevels: levels, ownershipType: ownership || undefined, curriculum: curriculum || undefined,
            yearEstablished: yearEst ? Number(yearEst) : undefined, genderType: gender || undefined,
            boardingType: boarding || undefined, studentBand: studentBand || undefined,
          }),
        });
      }
      markOnboarded();
      navigate('/', { replace: true });
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const inp = { width: '100%', padding: '11px 14px', borderRadius: 12, border: '1.5px solid #EDE8E1', outline: 'none', fontSize: 14, fontFamily: "'DM Sans', sans-serif", color: '#1A1A2E', boxSizing: 'border-box', background: '#fff' };
  const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: '#1A1A2E', marginBottom: 6 };
  const chip = (active) => ({ padding: '8px 14px', borderRadius: 99, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${active ? AMBER : '#EDE8E1'}`, background: active ? AMBER : '#fff', color: active ? '#fff' : '#6B6B80', fontFamily: "'DM Sans', sans-serif", transition: 'all .15s' });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#FAF8F5', padding: '24px 20px', fontFamily: "'DM Sans', sans-serif" }}>
      {/* Escape hatch: never get stuck on onboarding */}
      <button onClick={logout} style={{ position: 'fixed', top: 16, right: 18, zIndex: 50, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(255,255,255,0.92)', color: '#6B6B80', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Log out</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <AkoroLogo size={40} radius={12} />
        <div>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#1A1A2E', display: 'block' }}>Akoro</span>
          <span style={{ fontSize: 11, color: '#9490A0', display: 'block', marginTop: -2 }}>School Portal</span>
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: 460, marginBottom: 16, display: 'flex', gap: 8 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ flex: 1 }}>
            <div style={{ height: 5, borderRadius: 99, background: i <= step ? AMBER : '#EDE8E1', transition: 'background .2s' }} />
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 6, color: i === step ? '#1A1A2E' : '#9490A0' }}>{s}</div>
          </div>
        ))}
      </div>

      <div style={{ width: '100%', maxWidth: 460, background: '#fff', borderRadius: 24, padding: '28px 26px', boxShadow: '0 4px 32px rgba(0,0,0,.07)', border: '1px solid #EDE8E1' }}>
        {step === 0 && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1A1A2E', margin: '0 0 4px', fontFamily: "'Instrument Serif', serif" }}>Welcome 👋</h1>
            <p style={{ fontSize: 13, color: '#6B6B80', margin: '0 0 22px' }}>Tell us about your school.</p>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>School name</label>
              <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="Akoro International School" style={inp} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Phone number</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234 800 000 0000" style={inp} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Country</label>
              <select value={country} onChange={(e) => { setCountry(e.target.value); setState(''); setLga(''); }} style={{ ...inp, cursor: 'pointer' }}>
                {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={lbl}>State / Region</label>
                {ngStates.length ? (
                  <select value={state} onChange={(e) => { setState(e.target.value); setLga(''); }} style={{ ...inp, cursor: 'pointer' }}>
                    <option value="">Select state…</option>{ngStates.map((s) => <option key={s}>{s}</option>)}
                  </select>
                ) : (
                  <input value={state} onChange={(e) => setState(e.target.value)} placeholder="Lagos" style={inp} />
                )}
              </div>
              <div>
                <label style={lbl}>LGA / District</label>
                {lgaOptions.length ? (
                  <select value={lga} onChange={(e) => setLga(e.target.value)} disabled={!state} style={{ ...inp, cursor: state ? 'pointer' : 'not-allowed', opacity: state ? 1 : 0.6 }}>
                    <option value="">{state ? 'Select LGA…' : 'Pick a state first'}</option>{lgaOptions.map((l) => <option key={l}>{l}</option>)}
                  </select>
                ) : (
                  <input value={lga} onChange={(e) => setLga(e.target.value)} placeholder="Ikeja" style={inp} />
                )}
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Town / City</label>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ikeja GRA" style={inp} />
            </div>
            <div style={{ marginBottom: 4 }}>
              <label style={lbl}>Street address</label>
              <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="12 Education Crescent" style={inp} />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1A1A2E', margin: '0 0 4px', fontFamily: "'Instrument Serif', serif" }}>Academics</h1>
            <p style={{ fontSize: 13, color: '#6B6B80', margin: '0 0 20px' }}>What does your school offer?</p>

            <label style={lbl}>Education levels <span style={{ fontWeight: 500, color: '#9490A0' }}>(select all that apply)</span></label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '2px 0 18px' }}>
              {EDUCATION_LEVELS.map((l) => (
                <button key={l} type="button" onClick={() => toggleLevel(l)} style={chip(levels.includes(l))}>{l}</button>
              ))}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>School type</label>
              <select value={ownership} onChange={(e) => setOwnership(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                <option value="">Select…</option>{OWNERSHIP_TYPES.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={lbl}>Curriculum</label>
                <select value={curriculum} onChange={(e) => setCurriculum(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">Select…</option>{CURRICULA.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Year established</label>
                <input type="number" value={yearEst} onChange={(e) => setYearEst(e.target.value)} placeholder="1998" style={inp} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={lbl}>Students are</label>
                <select value={gender} onChange={(e) => setGender(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">Select…</option>{GENDER_TYPES.map((g) => <option key={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Boarding</label>
                <select value={boarding} onChange={(e) => setBoarding(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">Select…</option>{BOARDING_TYPES.map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 4 }}>
              <label style={lbl}>Approximate number of students</label>
              <select value={studentBand} onChange={(e) => setStudentBand(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                <option value="">Select…</option>{STUDENT_BANDS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1A1A2E', margin: '0 0 4px', fontFamily: "'Instrument Serif', serif" }}>Your school assistant 🤖</h1>
            <p style={{ fontSize: 13, color: '#6B6B80', margin: '0 0 20px' }}>Give your school's AI assistant a name and face. It helps students learn and answers their questions.</p>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
              <div style={{ width: 72, height: 72, borderRadius: 20, background: '#FAF8F5', border: '1.5px solid #EDE8E1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>{agentEmoji}</div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Assistant name <span style={{ fontWeight: 500, color: '#9490A0' }}>(optional)</span></label>
              <input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="e.g. Ako, Tutor, MySchool AI" style={inp} />
            </div>

            <label style={lbl}>Pick an avatar</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
              {GUIDE_EMOJIS.map((em) => (
                <button key={em} type="button" onClick={() => setAgentEmoji(em)} style={{ width: 46, height: 46, borderRadius: 12, fontSize: 22, cursor: 'pointer', background: agentEmoji === em ? '#FFF3EA' : '#fff', border: `1.5px solid ${agentEmoji === em ? AMBER : '#EDE8E1'}` }}>{em}</button>
              ))}
            </div>
          </>
        )}

        {err && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', margin: '18px 0 0', fontSize: 13, fontWeight: 600, color: RED }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          {step > 0 && (
            <button onClick={back} style={{ padding: '13px 20px', borderRadius: 14, border: '1.5px solid #EDE8E1', background: '#fff', color: '#6B6B80', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>Back</button>
          )}
          <button
            onClick={step === STEPS.length - 1 ? finish : next}
            disabled={saving}
            style={{ flex: 1, padding: '13px', borderRadius: 14, border: 'none', background: saving ? '#EDE8E1' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9490A0' : '#fff', fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif", boxShadow: saving ? 'none' : `0 4px 14px ${AMBER}44` }}
          >
            {saving ? 'Setting up…' : step === STEPS.length - 1 ? 'Finish setup' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
