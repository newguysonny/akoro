/**
 * OnboardingPage — the learner's setup as one conversation with Ako (no AI call).
 *
 * A scripted chat: Ako asks, the learner answers through the chat composer (typing, a quick-reply
 * chip above it, or a pick in an in-chat card that stages its answer as the draft), and the send
 * arrow commits. The script and its rules are pure (lib/onboardingChat.js); the three saves are
 * the ones the old form made, so nothing downstream changes. There is no Back: it is one chat the
 * learner can scroll, and the progress bar follows what they are reading.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { useLang, SUPPORTED_LANGUAGES } from '../contexts/LanguageContext.jsx';
import { API } from '../services/api.js';
import { isHigherEdUI, setCachedTier } from '../utils/studyLevel.js';
import AkoroLogo from '../components/common/AkoroLogo.jsx';
import FortizoChatComposer from '../components/common/FortizoChatComposer.jsx';
import AkoMascot from './onboarding/AkoMascot.jsx';
import { TermsCard, AgentCard, TeacherCards, SearchBox, SchoolResults, PrefsCard, SummaryCard } from './onboarding/Cards.jsx';
import { DISCIPLINES } from './settings/shared.jsx';
import {
  STEP_IDS, STUDY_LEVELS, classesFor, subjectChoices, emptyAnswers, firstName, answerText, stepError, progressOf,
  profilePayload, agentPayload, applyPrefill, filterTeachers, filterSchools, missingRequired, subjectsDraft, subjectsLabel,
} from '../lib/onboardingChat.js';
import { APP_HOME } from '../config/target.js';
import './onboarding/onboarding.css';

const BRAND = '#6C3BFF';
const ACCENTS = [BRAND, '#3B82F6', '#10B981', '#E8884A', '#EC4899', '#F59E0B', '#EF4444', '#8B5CF6'];
const ACCENT_NAMES = ['Purple', 'Blue', 'Green', 'Orange', 'Pink', 'Amber', 'Red', 'Violet'];
const SUBJECTS_SHOWN = 9;

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const fill = (text, vars = {}) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

/** **bold** → <strong>; nothing else is interpreted. */
function Rich({ text }) {
  return String(text).split(/(\*\*.+?\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, markOnboarded, logout } = useAuth();
  const { displayMode, accentColor, setMode, setAccent, isDark } = useTheme();
  const { language, setLanguage, t } = useLang();
  const tf = useCallback((key, vars) => fill(t(`onboarding.${key}`), vars), [t]);
  const tr = (key) => t(`onboarding.${key}`);

  // What the learner has said so far. The ref mirrors it so the script can read the latest value mid-flow.
  const [ans, setAns] = useState(emptyAnswers);
  const ansRef = useRef(ans);
  const patch = useCallback((p) => { ansRef.current = { ...ansRef.current, ...p }; setAns(ansRef.current); }, []);

  const [log, setLog] = useState([]);             // the transcript: Ako's lines, cards and the learner's replies
  const [stepIdx, setStepIdx] = useState(0);
  const [viewStep, setViewStep] = useState(0);    // the step the learner is reading (the bar follows scroll)
  const [sub, setSub] = useState('');             // inside the level step: 'prefill' | 'level' | 'class'
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [moreSubjects, setMoreSubjects] = useState(false);
  const [teacherQuery, setTeacherQuery] = useState('');
  const [teachers, setTeachers] = useState([]);
  const [teachersLoading, setTeachersLoading] = useState(true);
  const [schools, setSchools] = useState([]);
  const prefillRef = useRef(null);

  const chatRef = useRef(null);
  const timers = useRef([]);
  const alive = useRef(true);
  const seq = useRef(0);
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);

  const stepId = STEP_IDS[stepIdx];
  const busy = typing || saving;
  // A teacher is required — unless the directory is empty, then there is no one to choose yet.
  const teachersAvailable = teachersLoading || teachers.length > 0;

  /* ── directory + teacher-added prefill (unchanged requests) ── */
  useEffect(() => {
    fetch(`${API}/api/profiles/directory/teachers`, { credentials: 'include' })
      .then((r) => r.json()).then((j) => setTeachers(j.data || []))
      .catch(() => {}).finally(() => setTeachersLoading(false));
  }, []);
  useEffect(() => {
    fetch(`${API}/api/profiles/directory/schools`, { credentials: 'include' })
      .then((r) => r.json()).then((j) => setSchools(j.data || [])).catch(() => {});
  }, []);
  /* A learner their teacher added already has a class, school, subjects and teacher on file. Fill it in,
     say where it came from, and let them change it — a retyped "JSS1" for "JSS 1" would match nothing. */
  useEffect(() => {
    fetch(`${API}/api/profiles/onboarding-prefill`, { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        const p = j?.data;
        if (!p || !p.className) return;
        prefillRef.current = p;
        ansRef.current = applyPrefill(ansRef.current, p);
        setAns(ansRef.current);
      })
      .catch(() => {});
  }, []);

  /* ── the conversation engine ── */
  const nid = () => `m${++seq.current}`;
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.current.push(id); };
  const tell = (text) => setLog((l) => [...l, { id: nid(), who: 'me', text }]);
  // Higher education reads the level as a tier: programme/discipline instead
  // of school subjects, lecturers instead of teachers. Defined before any
  // render-time closure that reads it.
  const higherEd = isHigherEdUI({ studyLevel: ans.level });
  /** Ako types for a moment, then says each line (or shows a card). `step` marks where the stepper should point. */
  const say = useCallback((lines, step, then) => {
    setTyping(true);
    later(() => {
      if (!alive.current) return;
      setLog((l) => [...l, ...lines.map((ln, i) => ({ id: nid(), who: 'ako', ...ln, step: i === 0 ? step : undefined }))]);
      setTyping(false);
      then?.();
    }, reduced ? 0 : 560);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const summaryRows = () => {
    const a = ansRef.current;
    return [
      [tr('chat_sum_class'), a.cls ? `${a.cls} · ${a.level}` : a.level],
      [tr('chat_sum_school'), a.school || tr('chat_sum_own')],
      [tr(higherEd ? 'chat_sum_discipline' : 'chat_sum_subjects'),
        higherEd ? (a.discipline || tr('chat_sum_later')) : (a.subjects.length ? tf('chat_sum_picked', { n: a.subjects.length }) : tr('chat_sum_later'))],
      [tr('chat_sum_agent'), a.agentName],
      [tr(higherEd ? 'chat_sum_lecturer' : 'chat_sum_teacher'), a.teacherId ? tr('chat_sum_requested') : tr('chat_sum_none')],
    ];
  };

  const ask = useCallback((idx) => {
    const id = STEP_IDS[idx];
    const a = ansRef.current;
    const p = prefillRef.current;
    setStepIdx(idx); setViewStep(idx); setErr(''); setSub(''); setDraft(''); setTeacherQuery(''); setMoreSubjects(false);
    let lines = []; let after;
    if (id === 'welcome') lines = [{ text: tr('chat_hi') }, { text: tr('chat_promise'), dim: tr('chat_tick_hint') }];
    if (id === 'name') lines = [{ text: tr('chat_name_q') }];
    if (id === 'level') {
      if (p && a.level && a.cls) { lines = [{ text: tf('chat_prefill_q', { source: p.source || 'your teacher', class: a.cls }) }]; after = () => setSub('prefill'); }
      else { lines = [{ text: tf('chat_level_q', { name: firstName(a.name) }) }]; after = () => setSub('level'); }
    }
    if (id === 'school') {
      if (a.school) { lines = [{ text: tf('chat_school_prefill', { school: a.school }) }]; after = () => setDraft(a.school); }
      else lines = [{ text: tr('chat_school_q'), dim: tr('chat_school_hint') }];
    }
    if (id === 'subjects') {
      const q = higherEd
        ? { text: tr('chat_discipline_q'), dim: tr('chat_discipline_hint') }
        : { text: tr('chat_subjects_q'), dim: tr('chat_subjects_hint') };
      lines = [q];
      // A school record may carry school subjects; they are not disciplines,
      // so higher-ed starts this step clean.
      after = () => {
        if (higherEd) { setDraft(ansRef.current.discipline || ''); return; }
        setDraft(subjectsDraft(ansRef.current.subjects));
      };
    }
    if (id === 'agent') lines = [{ text: tr('chat_agent_q1') }, { text: tr('chat_agent_q2') }];
    if (id === 'teacher') {
      lines = teachers.length || teachersLoading
        ? [{ text: tr(higherEd ? 'chat_lecturer_q' : 'chat_teacher_q'), dim: tr(higherEd ? 'chat_lecturer_hint' : 'chat_teacher_hint') }]
        : [{ text: t('onboarding.teacher_none') }];
      if (p?.teacherId && a.teacherId === p.teacherId) lines.push({ text: tf('chat_teacher_prefilled', { teacher: p.teacherName || a.teacherName, class: p.className }) });
    }
    if (id === 'prefs') lines = [{ text: tr('chat_prefs_q') }];
    if (id === 'done') lines = [{ text: tf('chat_done_q', { name: firstName(a.name) }) }, { card: 'summary', rows: summaryRows() }, { text: tr('chat_done_q2') }];
    say(lines, idx, after);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say, tf, higherEd]);

  useEffect(() => {
    alive.current = true;
    ask(0);
    return () => { alive.current = false; timers.current.forEach(clearTimeout); timers.current = []; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── saving: the same three requests the form made ── */
  const save = async () => {
    setSaving(true); setFailed(false); setErr('');
    const a = ansRef.current;
    try {
      const profileRes = await fetch(`${API}/api/profiles/me`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profilePayload(a, { language, displayMode, accentColor })),
      });
      if (!profileRes.ok) { const j = await profileRes.json().catch(() => ({})); throw new Error(j.message || t('onboarding.err_profile')); }
      const agentRes = await fetch(`${API}/api/user/agent`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentPayload(a, user?.username)),
      });
      if (!agentRes.ok) { const j = await agentRes.json().catch(() => ({})); throw new Error(j.message || 'Could not save your agent. Please try again.'); }
      if (a.teacherId) {
        await fetch(`${API}/api/profiles/me/teacher-request`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacher_id: a.teacherId }),
        }).catch(() => {});
      }
      setSaving(false);
      ask(STEP_IDS.indexOf('done'));
    } catch (e) {
      setSaving(false); setFailed(true);
      say([{ text: tf('chat_save_err', { error: e.message || '' }) }], null);
    }
  };

  const start = () => {
    if (launching) return;
    setLaunching(true);
    // Seed the UI-tier cache with the level just chosen, so even the first dashboard load renders the
    // right tier with no school-UI flash (studyLevel.js cache + useStudyTier.js revalidate).
    setCachedTier(isHigherEdUI({ studyLevel: ansRef.current.level }) ? 'higher' : 'school');
    markOnboarded();
    navigate(APP_HOME, { replace: true });
  };

  /* ── what the learner can do at each step ── */
  const goNext = () => ask(stepIdx + 1);
  const replyFor = (id) => {
    const a = ansRef.current;
    if (id === 'school' && !a.school.trim()) return tr('chat_own');
    return answerText(id, a, { language, theme: cap(displayMode), accent: ACCENT_NAMES[Math.max(0, ACCENTS.indexOf(accentColor))] });
  };

  const send = () => {
    if (busy || launching) return;
    const id = stepId;
    if (id === 'name') patch({ name: draft.trim() });
    if (id === 'school') patch({ school: draft.trim() });
    if (id === 'agent') patch({ agentName: draft.trim() });
    if (id === 'level') {
      if (sub !== 'class' || !ansRef.current.cls) return;
    }
    const problem = stepError(id, ansRef.current, { teachersAvailable });
    if (problem) { setErr(t(problem)); return; }
    tell(replyFor(id));
    if (id === 'prefs') {
      // Everything required must have been collected by now; if not, say what is missing instead of saving half a profile.
      const missing = missingRequired(ansRef.current, { teachersAvailable });
      if (missing.length) { setErr(t(missing[0][1])); return; }
      save(); return;
    }
    goNext();
  };

  const pickLevel = (level) => {
    if (busy) return;
    // Switching tier must not carry the other tier's answers across:
    // school subjects are not disciplines, and vice versa.
    patch({ level, cls: '', subjects: [], discipline: '' });
    tell(level);
    const classes = classesFor(level);
    if (!classes.length) { goNext(); return; }
    setSub('');                                     // chips hide while Ako asks the class
    say([{ text: tr('chat_class_q') }], stepIdx, () => setSub('class'));
  };
  const pickClass = (cls) => { patch({ cls }); setDraft(cls); };
  const prefillYes = () => { if (busy) return; tell(answerText('level', ansRef.current)); goNext(); };
  const prefillNo = () => {
    if (busy) return;
    patch({ level: '', cls: '' }); tell(tr('chat_prefill_no')); setSub('');
    say([{ text: tf('chat_level_q', { name: firstName(ansRef.current.name) }) }], stepIdx, () => setSub('level'));
  };
  const skipClass = () => { if (busy) return; patch({ cls: '' }); tell(tr('chat_skip')); goNext(); };
  const skipSubjects = () => {
    if (busy) return;
    patch({ subjects: [], discipline: '' });
    // Higher ed is skipping a discipline, not school subjects.
    tell(higherEd ? tr('chat_discipline_later') : subjectsLabel([]));
    goNext();
  };
  const continueWithoutTeacher = () => { if (busy) return; tell(tr('chat_teacher_continue')); goNext(); };
  const skipSchool = () => { if (busy) return; patch({ school: '' }); tell(tr('chat_own')); goNext(); };
  const toggleDiscipline = (d) => {
    const same = ansRef.current.discipline === d;
    patch({ discipline: same ? '' : d, subjects: [] });
    setDraft(same ? '' : d);
  };
  const toggleSubject = (s) => {
    const cur = ansRef.current.subjects;
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    patch({ subjects: next }); setDraft(subjectsDraft(next));
  };
  const pickTeacher = (tt) => {
    const same = ansRef.current.teacherId === tt.id;
    patch({ teacherId: same ? '' : tt.id, teacherName: same ? '' : (tt.full_name || '') });
  };

  /* ── composer wiring ── */
  const composerValue = (() => {
    if (stepId === 'welcome') return ans.agreed ? answerText('welcome', ans) : '';
    if (stepId === 'teacher') return ans.teacherName || teacherQuery;   // typing searches; a pick replaces the text and is what send commits
    return draft;
  })();
  const onComposerChange = (v) => {
    if (busy) return;
    if (stepId === 'name' || stepId === 'school') setDraft(v);   // school: typing searches, a tap on a result replaces it
    if (stepId === 'agent') { setDraft(v); patch({ agentName: v }); }
    if (stepId === 'teacher') { setTeacherQuery(v); patch({ teacherId: '', teacherName: '' }); }
  };
  const sendDisabled = busy || launching || ({
    welcome: !ans.agreed,
    name: !draft.trim(),
    level: sub !== 'class' || !ans.cls,
    school: !draft.trim(),
    subjects: false,
    agent: !draft.trim(),
    teacher: teachersAvailable ? !ans.teacherId : true,   // required; with no teachers yet, the Continue chip is the way on
    prefs: false,
    done: true,
  }[stepId] ?? true);
  const placeholder = busy ? tr('chat_ph_busy') : ({
    welcome: tr('chat_ph_terms'),
    name: tr('chat_ph_name'),
    level: tr('chat_ph_chip'),
    school: tr('chat_ph_school'),
    subjects: tr(higherEd ? 'chat_ph_discipline' : 'chat_ph_subjects'),
    agent: tr('chat_ph_agent'),
    teacher: ans.teacherId ? tr('chat_ph_teacher_pick') : tr(higherEd ? 'chat_ph_lecturer' : 'chat_ph_teacher'),
    prefs: tr('chat_ph_prefs'),
    done: tr('chat_ph_done'),
  }[stepId] || tr('chat_ph_default'));

  const focusComposer = () => document.querySelector('.ob-composer textarea')?.focus();
  const teacherList = useMemo(() => filterTeachers(teachers, teacherQuery), [teachers, teacherQuery]);
  const subjectList = useMemo(() => subjectChoices(prefillRef.current?.subjects, ans.level), [ans.level, stepIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  const disciplineList = DISCIPLINES;

  /* ── chips above the composer ── */
  const chip = (label, onClick, { on = false, skip = false, go = false, key } = {}) => (
    <button key={key || label} type="button" onClick={onClick} className={`ob-chip${on ? ' on' : ''}${skip ? ' skip' : ''}${go ? ' go' : ''}`}
      style={on || go ? { background: accentColor, borderColor: accentColor } : undefined}>{label}</button>
  );
  const chips = (() => {
    if (typing || saving || launching) return null;
    if (failed) return chip(tr('chat_retry'), save, { go: true });
    if (stepId === 'level') {
      if (sub === 'prefill') return [chip(tr('chat_prefill_yes'), prefillYes, { go: true }), chip(tr('chat_prefill_no'), prefillNo)];
      if (sub === 'level') return STUDY_LEVELS.map((l) => chip(l, () => pickLevel(l)));
      if (sub === 'class') return [...classesFor(ans.level).map((c) => chip(c, () => pickClass(c), { on: ans.cls === c })), chip(tr('chat_skip'), skipClass, { skip: true, key: 'skip-class' })];
    }
    if (stepId === 'school') return chip(tr('chat_own'), skipSchool, { skip: true });
    if (stepId === 'subjects') {
      const source = higherEd ? disciplineList : subjectList;
      const shown = moreSubjects ? source : source.slice(0, SUBJECTS_SHOWN);
      const extra = source.length - SUBJECTS_SHOWN;
      return [
        ...shown.map((s) => chip(s, () => (higherEd ? toggleDiscipline(s) : toggleSubject(s)), {
          on: higherEd ? ans.discipline === s : ans.subjects.includes(s),
        })),
        chip(tr('chat_skip_subjects'), skipSubjects, { skip: true, key: 'skip-subjects' }),
        extra > 0 && chip(moreSubjects ? tr('chat_fewer') : tf('chat_more', { n: extra }), () => setMoreSubjects((m) => !m), { skip: true, key: 'more' }),
      ];
    }
    if (stepId === 'teacher') return !teachersLoading && !teachers.length ? chip(tr('chat_teacher_continue'), continueWithoutTeacher, { go: true }) : null;   // required: no skip while teachers exist
    if (stepId === 'done') return chip(launching ? tr('chat_opening') : tr('chat_start'), start, { go: true });
    return null;
  })();

  /* ── the live card for the step being asked (replaced by the learner's reply once sent) ── */
  const card = (() => {
    if (typing || saving) return null;
    if (stepId === 'welcome') {
      const parts = t('onboarding.chat_terms').split(/(\{terms\}|\{privacy\})/);
      const label = parts.map((p, i) => p === '{terms}'
        ? <a key={i} href="/terms" target="_blank" rel="noreferrer">{t('onboarding.chat_terms_link')}</a>
        : p === '{privacy}' ? <a key={i} href="/privacy" target="_blank" rel="noreferrer">{t('onboarding.chat_privacy_link')}</a> : p);
      return <TermsCard checked={ans.agreed} accent={accentColor} label={label} onChange={(v) => { patch({ agreed: v }); setErr(''); }}/>;
    }
    if (stepId === 'school') {
      return (
        <>
          <SearchBox value={draft} placeholder={tr('chat_search_school')} accent={accentColor} onFocusComposer={focusComposer}/>
          <SchoolResults schools={filterSchools(schools, draft)} query={draft} selectedName={draft} accent={accentColor}
            listedLabel={tr('chat_school_listed')} noMatchText={tr('chat_school_nomatch')} onPick={(sc) => setDraft(sc.name)}/>
        </>
      );
    }
    if (stepId === 'agent') return <AgentCard emoji={ans.agentEmoji} accent={accentColor} onPick={(em) => patch({ agentEmoji: em })}/>;
    if (stepId === 'teacher') {
      if (teachersLoading) return <div className="ob-empty">{tr('chat_loading_teachers')}</div>;
      if (!teachers.length) return null;
      return (
        <>
          <SearchBox value={ans.teacherName || teacherQuery} placeholder={tr('chat_search_teacher')} accent={accentColor} onFocusComposer={focusComposer}/>
          <TeacherCards teachers={teacherList} selectedId={ans.teacherId} onPick={pickTeacher} accent={accentColor} emptyText={t('onboarding.teacher_no_match')}/>
        </>
      );
    }
    if (stepId === 'prefs') {
      return <PrefsCard labels={{ language: t('onboarding.language'), theme: t('onboarding.theme'), accent: t('onboarding.accent_colour') }}
        languages={SUPPORTED_LANGUAGES} language={language} onLanguage={setLanguage} mode={displayMode} onMode={setMode}
        accents={ACCENTS} accent={accentColor} onAccent={setAccent}/>;
    }
    return null;
  })();

  /* ── keep the latest line in view; the bar follows where the learner is reading ── */
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [log.length, typing, stepIdx, sub, teachersLoading, reduced, draft, teacherQuery]);   // draft/query: the match list below changes as they type
  const spy = () => {
    const el = chatRef.current;
    if (!el) return;
    let view = 0;
    const mid = el.scrollTop + el.clientHeight * 0.3;
    el.querySelectorAll('[data-step]').forEach((r) => { if (r.offsetTop <= mid) view = Number(r.getAttribute('data-step')); });
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) view = stepIdx;
    setViewStep(view);
  };

  const progress = progressOf(viewStep);

  return (
    <div className="ob-root">
      <div className="ob-shell">
        <div className="ob-head">
          <div className="ob-logo"><AkoroLogo size={28} radius={0}/>Akoro</div>
          <button type="button" className="ob-signout" onClick={logout}>{tr('chat_signout')}</button>
        </div>
        <div className="ob-prog" role="progressbar" aria-valuemin={1} aria-valuemax={STEP_IDS.length} aria-valuenow={progress.number}>
          <div className="ob-bar"><i style={{ width: `${progress.pct}%`, background: `linear-gradient(90deg,${accentColor},#9B7BFF)` }}/></div>
          <div className="ob-lbl">{progress.done ? tr('chat_all_done') : tf('chat_step_of', { n: progress.number, total: STEP_IDS.length })}</div>
        </div>

        <div className="ob-chat" ref={chatRef} onScroll={spy} role="log" aria-live="polite">
          {log.map((m) => {
            if (m.who === 'me') return <div key={m.id} className="ob-me" style={{ background: `linear-gradient(135deg,${accentColor},#7D52FF)` }}>{m.text}</div>;
            if (m.card === 'summary') return <div key={m.id} className="ob-row"><div className="ob-spacer"/><SummaryCard rows={m.rows}/></div>;
            return (
              <div key={m.id} className="ob-row" data-step={m.step ?? undefined}>
                <AkoMascot/>
                <div className="ob-bubble"><Rich text={m.text}/>{m.dim && <span className="dim">{m.dim}</span>}</div>
              </div>
            );
          })}
          {typing && <div className="ob-row"><AkoMascot/><div className="ob-typing" aria-label="Ako is typing"><i/><i/><i/></div></div>}
          {card && <div className="ob-row"><div className="ob-spacer"/><div className="ob-card">{card}</div></div>}
          {err && <div className="ob-err" role="alert">{err}</div>}
        </div>

        <div className="ob-q">{chips}</div>
        <div className="ob-composer">
          <FortizoChatComposer
            value={composerValue} onChange={onComposerChange} onSend={send} placeholder={placeholder}
            disabled={launching || stepId === 'done'} sendDisabled={sendDisabled} modelLabel="Ako" dark={!!isDark}/>
        </div>
        <div className="ob-foot"><a href="/contact" target="_blank" rel="noreferrer">Help</a><a href="/privacy" target="_blank" rel="noreferrer">Privacy</a></div>
      </div>
    </div>
  );
}
