import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Icon } from '../components/common/Icons.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { useLang, SUPPORTED_LANGUAGES } from '../contexts/LanguageContext.jsx';
import { API } from '../services/api.js';
import { isHigherEdUI, setCachedTier } from '../utils/studyLevel.js';
import AkoroLogo from '../components/common/AkoroLogo.jsx';

const BRAND  = '#6C3BFF';
const RED    = '#EF4444';
const ACCENTS = [BRAND, '#3B82F6', '#10B981', '#E8884A', '#EC4899', '#F59E0B', '#EF4444', '#8B5CF6'];
const GUIDE_EMOJIS = ['🧠', '🤖', '👾', '🦉', '🎓', '⚡', '🌟', '🔮', '🦋', '🎯', '🚀', '💡'];
const STUDY_LEVELS = ['Primary', 'Junior Secondary', 'Senior Secondary', 'University', 'Adult learner'];
// Class/year options shown in the dropdown, dependent on the chosen study level.
const CLASSES_BY_LEVEL = {
  'Primary':           ['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'],
  'Junior Secondary':  ['JSS 1', 'JSS 2', 'JSS 3'],
  'Senior Secondary':  ['SSS 1', 'SSS 2', 'SSS 3'],
  'University':        ['100 Level', '200 Level', '300 Level', '400 Level', '500 Level', 'Postgraduate'],
  'Adult learner':     [],
};
/* The list was Further Mathematics, English Literature, Computer Science — a
   UK sixth-form shape, on a platform built around the Nigerian curriculum
   (NERDC schemes, NCEE papers, JSS/SSS classes). A JSS1 learner could not pick
   Basic Science or Social Studies at all, which are two of the four their class
   actually teaches. Junior-secondary cores added, seniors kept. */
const SUBJECT_OPTIONS = [
  'Mathematics', 'English Language', 'Basic Science', 'Basic Technology',
  'Social Studies', 'Civic Education', 'Agricultural Science', 'Computer Studies',
  'Business Studies', 'Home Economics', 'Cultural and Creative Arts',
  'Physics', 'Chemistry', 'Biology', 'Further Mathematics', 'Economics',
  'Geography', 'History', 'Government', 'Literature in English',
  'Christian Religious Studies', 'Islamic Religious Studies',
  'French', 'Yoruba', 'Igbo', 'Hausa',
];

/* Shown in a teacher card in place of their profile photo when they don't
   have one (or it fails to load). */
const TEACHER_PLACEHOLDER = '/placeholder-teacher.jpg';

/**
 * TeacherCard — discover-hub style card for the teacher step:
 * profile photo on top (or the branded placeholder), class badge over the
 * photo, teacher name + school beneath, subject chips and class size.
 * Click to select; click again to clear.
 */
function TeacherCard({ teacher, selected, accent, onPick }) {
  const { t } = useLang();
  const [imgFailed, setImgFailed] = useState(false);
  const hasPhoto = !imgFailed && !!teacher.avatar_url;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      style={{
        textAlign: 'left', background: 'var(--ak-surface)', cursor: 'pointer',
        borderRadius: 14, padding: 6, display: 'flex', flexDirection: 'column',
        border: selected ? `2px solid ${accent}` : '1.5px solid var(--ak-border)',
        boxShadow: selected ? `0 4px 14px ${accent}33` : 'none',
        transition: 'border .15s, box-shadow .15s', fontFamily: "'Nunito',sans-serif",
      }}
    >
      {/* Photo — teacher profile picture or placeholder image */}
      <div style={{ width: '100%', aspectRatio: '16/10', borderRadius: 10, overflow: 'hidden',
        position: 'relative', background: 'linear-gradient(135deg,#EDE9FE,#DDD3FF)', flexShrink: 0 }}>
        <img
          src={hasPhoto ? teacher.avatar_url : TEACHER_PLACEHOLDER}
          alt={teacher.full_name || 'Teacher'}
          loading="lazy"
          onError={() => setImgFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        {teacher.class_name && (
          <span style={{ position: 'absolute', bottom: 6, right: 6, maxWidth: '72%', fontSize: 9,
            fontWeight: 900, color: accent, background: '#fff', padding: '3px 7px', borderRadius: 6,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            boxShadow: '0 1px 3px rgba(17,12,40,.12)' }}>{teacher.class_name}</span>
        )}
        {selected && (
          <span style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: '50%',
            background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 900, boxShadow: '0 1px 4px rgba(17,12,40,.25)' }}><Icon name="ti-check" size={12} color="#fff"/></span>
        )}
      </div>
      <div style={{ padding: '7px 5px 6px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)', lineHeight: 1.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {teacher.full_name || 'Teacher'}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {teacher.school_name || `@${teacher.username || 'teacher'}`}
        </div>
        {teacher.subjects?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {teacher.subjects.slice(0, 2).map(s => (
              <span key={s} style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-sec)',
                background: 'var(--ak-tag-bg)', borderRadius: 99, padding: '2px 7px', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{s}</span>
            ))}
            {teacher.subjects.length > 2 && (
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-muted)',
                background: 'var(--ak-tag-bg)', borderRadius: 99, padding: '2px 7px' }}>+{teacher.subjects.length - 2}</span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--ak-text-sec)' }}>
          {teacher.student_count > 0
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="ti-users" size={11}/> {teacher.student_count} {t('onboarding.students')}</span>
            : <span style={{ color: BRAND, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="ti-plant" size={11}/> {t('onboarding.teacher_new')}</span>}
          {teacher.classroom_count > 0 && (
            <span style={{ color: 'var(--ak-text-muted)' }}>· {teacher.classroom_count} {t('onboarding.classes')}</span>
          )}
        </div>
      </div>
    </button>
  );
}

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
  const [teachersLoading, setTeachersLoading] = useState(true);
  const [teacherId, setTeacherId]   = useState('');   // '' = self-study, no teacher
  // Step 3 — teacher picker: free-text search over the loaded directory.
  // The whole directory (≤500) is already in memory, so filtering is instant
  // and also covers school + subjects, not just the name.
  const [teacherQuery, setTeacherQuery] = useState('');
  // Step 2 — student agent
  // What the teacher already told us. Pre-filled, never assumed: the learner
  // still walks every step and can change any of it.
  const [prefill, setPrefill] = useState(null);

  const [agentName,  setAgentName]  = useState('');
  const [agentEmoji, setAgentEmoji] = useState('🤖');

  const toggleSubject = (s) =>
    setSubjects(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const filteredTeachers = useMemo(() => {
    const q = teacherQuery.trim().toLowerCase();
    if (!q) return teachers;
    const tokens = q.split(/\s+/);
    return teachers.filter(tt => {
      const hay = [tt.full_name, tt.username, tt.school_name, tt.class_name, ...(tt.subjects || [])]
        .filter(Boolean).join(' ').toLowerCase();
      return tokens.every(tok => hay.includes(tok));
    });
  }, [teachers, teacherQuery]);

  useEffect(() => {
    fetch(`${API}/api/profiles/directory/teachers`, { credentials: 'include' })
      .then(r => r.json()).then(j => setTeachers(j.data || []))
      .catch(() => {})
      .finally(() => setTeachersLoading(false));
  }, []);

  /* A learner their teacher added has already been told apart: their school,
     their year, their subjects and who teaches them are all on file. Making
     them retype it invites a near-miss ("JSS1" for "JSS 1") that then matches
     nothing. Fill it in, say where it came from, and let them edit. */
  useEffect(() => {
    fetch(`${API}/api/profiles/onboarding-prefill`, { credentials: 'include' })
      .then(r => r.json())
      .then(j => {
        const p = j?.data;
        if (!p || !p.className) return;
        setPrefill(p);
        // Only fill what the learner hasn't already touched.
        setStudyLevel(v => v || p.studyLevel || '');
        setYearGroup(v  => v || p.yearGroup  || '');
        setSchoolName(v => v || p.schoolName || '');
        if (p.teacherId) setTeacherId(v => v || p.teacherId);
        // Selected as-is, not filtered against the canonical list: a school that
        // teaches something we didn't think of must not have it silently
        // dropped from its own learners' profiles.
        if (p.subjects?.length) setSubjects(v => (v.length ? v : p.subjects));
      })
      .catch(() => {});
  }, []);

  const STEPS = [t('onboarding.step_profile'), t('onboarding.step_agent'), t('onboarding.step_teacher'), t('onboarding.step_prefs')];

  const validateStep = () => {
    setErr('');
    if (step === 0) {
      if (!fullName.trim())   { setErr(t('onboarding.err_name')); return false; }
      if (!studyLevel)        { setErr(t('onboarding.err_level')); return false; }
    }
    if (step === 1) {
      if (!agentName.trim())  { setErr(t('onboarding.err_agent')); return false; }
    }
    // A teacher is required (unless none exist yet to choose from).
    if (step === 2 && teachers.length > 0 && !teacherId) {
      setErr(t('onboarding.err_teacher')); return false;
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

      // Seed the UI-tier cache with the level the learner just chose, so
      // even the very first dashboard load renders the right tier with no
      // school-UI flash (studyLevel.js cache + useStudyTier.js revalidate).
      setCachedTier(isHigherEdUI({ studyLevel }) ? 'higher' : 'school');

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
      {/* Responsive rules: teacher grid is 2 cols on mobile, 3 on tablet+
          (the card widens on tablet so the 3-up grid has room). */}
      <style>{`
        .ob-card-wrap { width: 100%; max-width: 460px; }
        .ob-teachers-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        @media (min-width: 640px) {
          .ob-card-wrap { max-width: 700px; }
          .ob-teachers-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        }
      `}</style>
      {/* Escape hatch: never get stuck on onboarding */}
      <button onClick={logout} style={{ position: 'fixed', top: 16, right: 18, zIndex: 50, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(255,255,255,0.92)', color: '#6B6B80', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Log out</button>

      {/* Brand + progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <AkoroLogo size={36} radius={11}/>
        <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--ak-text)' }}>Akoro</span>
      </div>

      <div className="ob-card-wrap" style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ flex: 1 }}>
            <div style={{ height: 5, borderRadius: 99, background: i <= step ? accentColor : 'var(--ak-border2)', transition: 'background .2s' }}/>
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 6, color: i === step ? 'var(--ak-text)' : 'var(--ak-text-muted)' }}>{s}</div>
          </div>
        ))}
      </div>

      {/* Card */}
      <div className="ob-card-wrap" style={{ background: 'var(--ak-surface)', borderRadius: 24,
        padding: '28px 26px', boxShadow: '0 4px 32px rgba(0,0,0,.10)', border: '1px solid var(--ak-border)' }}>

        {step === 0 && (
          <>
            <h1 style={{ fontSize: 21, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 4px' }}>{t('onboarding.welcome')}</h1>
            <p style={{ fontSize: 13, color: 'var(--ak-text-sub)', margin: '0 0 22px' }}>{t('onboarding.setup_profile')}</p>

            {prefill && (
              <div style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 18,
                padding: '11px 13px', borderRadius: 12,
                background: `${BRAND}0d`, border: `1px solid ${BRAND}33`,
              }}>
                <Icon name="ti-school" size={15} color={BRAND}/>
                <div style={{ fontSize: 12, color: 'var(--ak-text-sub)', lineHeight: 1.5 }}>
                  We filled some of this in from <strong>{prefill.source}</strong>
                  {prefill.className ? <> — you're in <strong>{prefill.className}</strong></> : null}.
                  Change anything that isn't right.
                </div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>{t('onboarding.full_name')}</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder={t('onboarding.name_ph')} style={inp}/>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>{t('onboarding.study_level')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {STUDY_LEVELS.map(l => <span key={l} onClick={() => { setStudyLevel(l); setYearGroup(''); }} style={chip(studyLevel === l)}>{l}</span>)}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={lbl}>{t('onboarding.year_class')} <span style={{ fontWeight: 500, color: 'var(--ak-text-muted)' }}>({t('common.optional')})</span></label>
                {(() => {
                  const classes = CLASSES_BY_LEVEL[studyLevel] || [];
                  const disabled = !studyLevel || classes.length === 0;
                  return (
                    <select
                      value={yearGroup}
                      onChange={e => setYearGroup(e.target.value)}
                      disabled={disabled}
                      style={{ ...inp, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
                    >
                      <option value="">
                        {!studyLevel ? 'Choose a level first' : classes.length ? 'Select class…' : 'Not applicable'}
                      </option>
                      {classes.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  );
                })()}
              </div>
              <div>
                <label style={lbl}>{t('onboarding.school')} <span style={{ fontWeight: 500, color: 'var(--ak-text-muted)' }}>({t('common.optional')})</span></label>
                <input value={schoolName} onChange={e => setSchoolName(e.target.value)} placeholder={t('onboarding.school_ph')} style={inp}/>
              </div>
            </div>
            <div>
              <label style={lbl}>{t('onboarding.subjects_studying')} <span style={{ fontWeight: 500, color: 'var(--ak-text-muted)' }}>({t('common.optional')})</span></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {/* The school's own subjects first, then the rest — so a learner
                    sees what their class actually teaches at the top, and any
                    subject we don't carry still appears and can be removed. */}
                {[...new Set([...(prefill?.subjects ?? []), ...SUBJECT_OPTIONS])].map(s => (
                  <span key={s} onClick={() => toggleSubject(s)} style={chip(subjects.includes(s))}>{s}</span>
                ))}
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
            <h1 style={{ fontSize: 21, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 4px' }}>{t('onboarding.teacher_title')}</h1>
            <p style={{ fontSize: 13, color: 'var(--ak-text-sub)', margin: '0 0 18px' }}>{t('onboarding.teacher_desc')}</p>

            {teachersLoading ? (
              <div className="ob-teachers-grid" style={{ maxHeight: 340, overflowY: 'auto', padding: 2 }}>
                {[0, 1, 2, 3].map(i => (
                  <div key={i} style={{ borderRadius: 14, border: '1.5px solid var(--ak-border)',
                    background: 'var(--ak-surface)', overflow: 'hidden', opacity: .6 }}>
                    <div style={{ width: '100%', aspectRatio: '16/10', background: 'var(--ak-border)' }} />
                    <div style={{ height: 11, margin: 10, borderRadius: 4, background: 'var(--ak-border)' }} />
                    <div style={{ height: 8, width: '60%', margin: '0 10px 11px', borderRadius: 4, background: 'var(--ak-border)' }} />
                  </div>
                ))}
              </div>
            ) : teachers.length > 0 ? (
              <>
                {/* Search — instant, client-side over the loaded directory, so it
                    also matches school, class and subjects, not just names. */}
                <div style={{ position: 'relative', marginBottom: 12 }}>
                  <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: 0.55, pointerEvents: 'none' }}><Icon name="ti-search" size={14}/></span>
                  <input
                    value={teacherQuery}
                    onChange={e => setTeacherQuery(e.target.value)}
                    placeholder={t('onboarding.teacher_search')}
                    style={{ ...inp, paddingLeft: 38, paddingRight: teacherQuery ? 36 : 14 }}
                  />
                  {teacherQuery && (
                    <button onClick={() => setTeacherQuery('')} aria-label="Clear search" style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'var(--ak-tag-bg)', color: 'var(--ak-text-sec)', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}><Icon name="ti-x" size={11}/></button>
                  )}
                </div>

                {filteredTeachers.length > 0 ? (
                  <div className="ob-teachers-grid" style={{ maxHeight: 340, overflowY: 'auto', padding: 2 }} aria-label="Choose your teacher">
                    {filteredTeachers.map(tt => (
                      <TeacherCard key={tt.id} teacher={tt} selected={teacherId === tt.id} accent={accentColor}
                        onPick={() => { setTeacherId(teacherId === tt.id ? '' : tt.id); setErr(''); }} />
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: '20px 16px', borderRadius: 14, background: 'var(--ak-tag-bg)',
                    border: '1px dashed var(--ak-border2)', textAlign: 'center' }}>
                    <div style={{ marginBottom: 6 }}><Icon name="ti-search" size={22} color="var(--ak-text-sec)"/></div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-sec)' }}>{t('onboarding.teacher_no_match')}</div>
                    <button onClick={() => setTeacherQuery('')} style={{ marginTop: 10, padding: '7px 16px', borderRadius: 99,
                      border: 'none', background: accentColor, color: '#fff', fontSize: 12, fontWeight: 800,
                      cursor: 'pointer', fontFamily: 'inherit' }}>{t('onboarding.teacher_clear')}</button>
                  </div>
                )}

                {teacherId && (
                  <p style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', margin: '10px 2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="ti-circle-check" size={14} color="#10B981"/>
                    <span>
                      {prefill?.teacherId === teacherId
                        ? <>{prefill.teacherName} already has you in <strong>{prefill.className}</strong>.</>
                        : t('onboarding.teacher_pending_note')}
                    </span>
                  </p>
                )}
              </>
            ) : (
              <div style={{ padding: '22px 18px', borderRadius: 14, background: 'var(--ak-tag-bg)',
                border: '1px dashed var(--ak-border2)', textAlign: 'center' }}>
                <div style={{ marginBottom: 8 }}><Icon name="ti-school" size={26} color="var(--ak-text-sec)"/></div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-sec)', lineHeight: 1.5 }}>
                  {t('onboarding.teacher_none')}
                </div>
              </div>
            )}
          </>
        )}

        {step === 3 && (
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
          <button onClick={step === STEPS.length - 1 ? finish : next} disabled={saving} style={{ flex: 1, padding: '13px',
            borderRadius: 14, border: 'none', background: saving ? 'var(--ak-tag-bg)' : `linear-gradient(135deg,${accentColor},#4C1DCC)`,
            color: saving ? 'var(--ak-text-muted)' : '#fff', fontSize: 14, fontWeight: 800,
            cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'Nunito',sans-serif",
            boxShadow: saving ? 'none' : `0 4px 14px ${accentColor}44` }}>
            {step === STEPS.length - 1 ? (saving ? t('onboarding.setting_up') : t('onboarding.finish')) : t('onboarding.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}
