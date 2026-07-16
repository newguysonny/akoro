import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { useLang, SUPPORTED_LANGUAGES } from '../contexts/LanguageContext.jsx';
import { API } from '../services/api.js';
import AkoroLogo from '../components/common/AkoroLogo.jsx';

const BRAND  = '#6C3BFF';
const RED    = '#EF4444';
const ACCENTS = [BRAND, '#3B82F6', '#10B981', '#E8884A', '#EC4899', '#F59E0B', '#EF4444', '#8B5CF6'];
const GUIDE_EMOJIS = ['🧠', '🤖', '👾', '🦉', '🎓', '⚡', '🌟', '🔮', '🦋', '🎯', '🚀', '💡'];
const STUDY_LEVELS = ['Primary', 'Junior Secondary', 'Senior Secondary', 'University', 'Adult learner'];
const SUBJECT_OPTIONS = ['Mathematics', 'Further Mathematics', 'Physics', 'Chemistry', 'Biology',
  'Computer Science', 'English Language', 'English Literature', 'Economics', 'Geography', 'History'];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, markOnboarded, logout } = useAuth();
  const { displayMode, accentColor, setMode, setAccent } = useTheme();
  const { language, setLanguage, t } = useLang();

  const [step, setStep]   = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr]     = useState('');

  // Step 1 — profile
  const [fullName, setFullName]     = useState(user?.fullName || '');
  const [yearGroup, setYearGroup]   = useState('');
  const [studyLevel, setStudyLevel] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [subjects, setSubjects]     = useState([]);
  const [teachers, setTeachers]     = useState([]);
  const [teacherId, setTeacherId]   = useState('');   // '' = self-study, no teacher
  // Step 2 — student agent
  const [agentName,  setAgentName]  = useState('');
  const [agentEmoji, setAgentEmoji] = useState('🤖');

  const toggleSubject = (s) =>
    setSubjects(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  useEffect(() => {
    fetch(`${API}/api/profiles/directory/teachers`, { credentials: 'include' })
      .then(r => r.json()).then(j => setTeachers(j.data || [])).catch(() => {});
  }, []);

  const STEPS = [t('onboarding.step_profile'), t('onboarding.step_agent'), t('onboarding.step_prefs')];

  const validateStep = () => {
    setErr('');
    if (step === 0) {
      if (!fullName.trim())   { setErr(t('onboarding.err_name')); return false; }
      if (!studyLevel)        { setErr(t('onboarding.err_level')); return false; }
    }
    if (step === 1) {
      if (!agentName.trim())  { setErr(t('onboarding.err_agent')); return false; }
    }
    return true;
  };

  const next = () => { if (validateStep()) setStep(s => s + 1); };
  const back = () => { setErr(''); setStep(s => s - 1); };

  const finish = async () => {
    if (!validateStep()) return;
    setSaving(true); setErr('');
    try {
      // 1. Save profile fields to users table
      const profileRes = await fetch(`${API}/api/profiles/me`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName:            fullName.trim(),
          yearGroup:           yearGroup.trim() || undefined,
          studyLevel,
          schoolName:          schoolName.trim() || undefined,
          subjects,
          language,
          displayMode,
          accentColor,
          onboardingCompleted: true,
        }),
      });
      if (!profileRes.ok) {
        const j = await profileRes.json().catch(() => ({}));
        throw new Error(j.message || t('onboarding.err_profile'));
      }

      // 2. Save student AI agent to user_agents table (separate from instructor teaching guide)
      const agentPayload = {
        agent_name:  agentName.trim() || `Agent_${user?.username || 'me'}`,
        agent_emoji: agentEmoji,
        study_level: studyLevel || undefined,
        year_group:  yearGroup.trim() || undefined,
        subjects:    subjects.length ? subjects : undefined,
      };
      const agentRes = await fetch(`${API}/api/user/agent`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentPayload),
      });
      if (!agentRes.ok) {
        const j = await agentRes.json().catch(() => ({}));
        throw new Error(j.message || 'Could not save your agent. Please try again.');
      }

      // 3. Request to join the chosen teacher's class (teacher approves).
      if (teacherId) {
        await fetch(`${API}/api/profiles/me/teacher-request`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacher_id: teacherId }),
        }).catch(() => {});
      }

      markOnboarded();
      navigate('/app', { replace: true });
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  /* ── shared styles ── */
  const inp = {
    width: '100%', padding: '11px 14px', borderRadius: 12,
    border: '1.5px solid var(--ak-border2)', outline: 'none', fontSize: 14,
    fontFamily: "'Nunito',sans-serif", color: 'var(--ak-text)',
    background: 'var(--ak-input-bg)', boxSizing: 'border-box',
  };
  const lbl = { display: 'block', fontSize: 12, fontWeight: 800, color: 'var(--ak-text-sec)', marginBottom: 6 };
  const chip = (active) => ({
    padding: '8px 14px', borderRadius: 99, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? accentColor : 'var(--ak-border2)'}`,
    background: active ? accentColor : 'var(--ak-surface)',
    color: active ? '#fff' : 'var(--ak-text-sec)', fontFamily: "'Nunito',sans-serif",
    transition: 'all .15s',
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', background: 'var(--ak-bg)', padding: '24px 20px', fontFamily: "'Nunito',sans-serif" }}>
      {/* Escape hatch: never get stuck on onboarding */}
      <button onClick={logout} style={{ position: 'fixed', top: 16, right: 18, zIndex: 50, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(255,255,255,0.92)', color: '#6B6B80', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Log out</button>

      {/* Brand + progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <AkoroLogo size={36} radius={11}/>
        <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--ak-text)' }}>Akoro</span>
      </div>

      <div style={{ width: '100%', maxWidth: 460, marginBottom: 16, display: 'flex', gap: 8 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ flex: 1 }}>
            <div style={{ height: 5, borderRadius: 99, background: i <= step ? accentColor : 'var(--ak-border2)', transition: 'background .2s' }}/>
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 6, color: i === step ? 'var(--ak-text)' : 'var(--ak-text-muted)' }}>{s}</div>
          </div>
        ))}
      </div>

      {/* Card */}
      <div style={{ width: '100%', maxWidth: 460, background: 'var(--ak-surface)', borderRadius: 24,
        padding: '28px 26px', boxShadow: '0 4px 32px rgba(0,0,0,.10)', border: '1px solid var(--ak-border)' }}>

        {step === 0 && (
          <>
            <h1 style={{ fontSize: 21, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 4px' }}>{t('onboarding.welcome')}</h1>
            <p style={{ fontSize: 13, color: 'var(--ak-text-sub)', margin: '0 0 22px' }}>{t('onboarding.setup_profile')}</p>

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>{t('onboarding.full_name')}</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder={t('onboarding.name_ph')} style={inp}/>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>{t('onboarding.study_level')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {STUDY_LEVELS.map(l => <span key={l} onClick={() => setStudyLevel(l)} style={chip(studyLevel === l)}>{l}</span>)}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={lbl}>{t('onboarding.year_class')} <span style={{ fontWeight: 500, color: 'var(--ak-text-muted)' }}>({t('common.optional')})</span></label>
                <input value={yearGroup} onChange={e => setYearGroup(e.target.value)} placeholder={t('onboarding.year_ph')} style={inp}/>
              </div>
              <div>
                <label style={lbl}>{t('onboarding.school')} <span style={{ fontWeight: 500, color: 'var(--ak-text-muted)' }}>({t('common.optional')})</span></label>
                <input value={schoolName} onChange={e => setSchoolName(e.target.value)} placeholder={t('onboarding.school_ph')} style={inp}/>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={lbl}>Your teacher <span style={{ fontWeight: 500, color: 'var(--ak-text-muted)' }}>(you can choose later)</span></label>
              <select value={teacherId} onChange={e => setTeacherId(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                <option value="">I'm learning on my own</option>
                {teachers.map(tt => <option key={tt.id} value={tt.id}>{tt.full_name}{tt.school_name ? ` · ${tt.school_name}` : ''}</option>)}
              </select>
              {teacherId && <p style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', margin: '6px 2px 0' }}>Your teacher will approve your request to join their class.</p>}
            </div>
            <div>
              <label style={lbl}>{t('onboarding.subjects_studying')} <span style={{ fontWeight: 500, color: 'var(--ak-text-muted)' }}>({t('common.optional')})</span></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {SUBJECT_OPTIONS.map(s => <span key={s} onClick={() => toggleSubject(s)} style={chip(subjects.includes(s))}>{s}</span>)}
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 style={{ fontSize: 21, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 4px' }}>{t('onboarding.meet_agent')}</h1>
            <p style={{ fontSize: 13, color: 'var(--ak-text-sub)', margin: '0 0 22px' }}>{t('onboarding.agent_desc')}</p>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
              <div style={{ width: 76, height: 76, borderRadius: 22, background: `linear-gradient(135deg,${accentColor},#4C1DCC)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, boxShadow: `0 6px 20px ${accentColor}44` }}>
                {agentEmoji}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>{t('onboarding.agent_name')}</label>
              <input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder={t('onboarding.agent_name_ph')} style={inp}/>
            </div>
            <div>
              <label style={lbl}>{t('onboarding.pick_avatar')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {GUIDE_EMOJIS.map(em => (
                  <button key={em} onClick={() => setAgentEmoji(em)} style={{
                    width: 44, height: 44, borderRadius: 12, fontSize: 22, cursor: 'pointer',
                    border: `2px solid ${agentEmoji === em ? accentColor : 'var(--ak-border2)'}`,
                    background: agentEmoji === em ? `${accentColor}18` : 'var(--ak-surface)',
                  }}>{em}</button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 style={{ fontSize: 21, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 4px' }}>{t('onboarding.make_yours')}</h1>
            <p style={{ fontSize: 13, color: 'var(--ak-text-sub)', margin: '0 0 22px' }}>{t('onboarding.appearance')}</p>

            <div style={{ marginBottom: 18 }}>
              <label style={lbl}>{t('onboarding.language')}</label>
              <select value={language} onChange={e => setLanguage(e.target.value)} style={inp}>
                {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.label}>{l.label}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={lbl}>{t('onboarding.theme')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['light', 'dark', 'system'].map(m => (
                  <span key={m} onClick={() => setMode(m)} style={{ ...chip(displayMode === m), textTransform: 'capitalize', flex: 1, textAlign: 'center' }}>{m}</span>
                ))}
              </div>
            </div>
            <div>
              <label style={lbl}>{t('onboarding.accent_colour')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {ACCENTS.map(c => (
                  <button key={c} onClick={() => setAccent(c)} style={{
                    width: 36, height: 36, borderRadius: '50%', background: c, cursor: 'pointer',
                    border: accentColor === c ? '3px solid var(--ak-text)' : '3px solid transparent',
                    boxShadow: `0 2px 8px ${c}55`,
                  }}/>
                ))}
              </div>
            </div>
          </>
        )}

        {err && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10,
            padding: '10px 14px', marginTop: 18, fontSize: 13, fontWeight: 700, color: RED }}>{err}</div>
        )}

        {/* Nav */}
        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
          {step > 0 && (
            <button onClick={back} disabled={saving} style={{ flex: '0 0 auto', padding: '13px 20px', borderRadius: 14,
              border: '1.5px solid var(--ak-border2)', background: 'var(--ak-surface)', color: 'var(--ak-text-sec)',
              fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>{t('onboarding.back')}</button>
          )}
          <button onClick={step === 2 ? finish : next} disabled={saving} style={{ flex: 1, padding: '13px',
            borderRadius: 14, border: 'none', background: saving ? 'var(--ak-tag-bg)' : `linear-gradient(135deg,${accentColor},#4C1DCC)`,
            color: saving ? 'var(--ak-text-muted)' : '#fff', fontSize: 14, fontWeight: 800,
            cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'Nunito',sans-serif",
            boxShadow: saving ? 'none' : `0 4px 14px ${accentColor}44` }}>
            {step === 2 ? (saving ? t('onboarding.setting_up') : t('onboarding.finish')) : t('onboarding.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}
