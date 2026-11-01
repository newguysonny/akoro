/**
 * OnboardingPage (instructor) — setup as one conversation with Ako, no AI call.
 *
 * A scripted chat: Ako asks, the instructor answers through the chat composer (typing, a chip, or a pick in
 * an in-chat card that stages its answer as the draft) and the send arrow commits. The script and its rules
 * are pure (lib/onboardingChat.js). Saved by the two requests the old form made, so nothing downstream
 * changes. School search: type in the composer, a search box in the chat mirrors it, matching schools appear
 * beneath. There is no Back: it is one chat the instructor can scroll, and the bar follows what they read.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { API } from '../../services/api.js';
import AkoroLogo from '../../components/common/AkoroLogo.jsx';
import FortizoChatComposer from '../../components/common/FortizoChatComposer.jsx';
import AkoMascot from './onboarding/AkoMascot.jsx';
import { SearchBox, SchoolResults, GuideCard, SummaryCard } from './onboarding/Cards.jsx';
import {
  STEP_IDS, SUBJECT_OPTIONS, emptyAnswers, firstName, answerText, stepError, missingRequired, progressOf,
  profilePayload, filterSchools, subjectsDraft,
} from '../../lib/onboardingChat.js';
import './onboarding/onboarding.css';

const HEADERS = { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'instructor' };
const SUBJECTS_SHOWN = 9;

/** **bold** → <strong>; nothing else is interpreted. */
function Rich({ text }) {
  return String(text).split(/(\*\*.+?\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, markOnboarded, logout } = useAuth();

  // What the instructor has said so far. The ref mirrors it so the script can read the latest value mid-flow.
  const [ans, setAns] = useState(() => emptyAnswers(user?.fullName || ''));
  const ansRef = useRef(ans);
  const patch = useCallback((p) => { ansRef.current = { ...ansRef.current, ...p }; setAns(ansRef.current); }, []);

  const [log, setLog] = useState([]);             // the transcript: Ako's lines, cards and the instructor's replies
  const [stepIdx, setStepIdx] = useState(0);
  const [viewStep, setViewStep] = useState(0);    // the step being read (the bar follows scroll)
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [moreSubjects, setMoreSubjects] = useState(false);
  const [schools, setSchools] = useState([]);
  const [schoolsLoading, setSchoolsLoading] = useState(true);

  const chatRef = useRef(null);
  const timers = useRef([]);
  const alive = useRef(true);
  const seq = useRef(0);
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);

  const stepId = STEP_IDS[stepIdx];
  const busy = typing || saving;
  // A school is required — unless the directory is empty, then there is none to choose yet.
  const schoolsAvailable = schoolsLoading || schools.length > 0;

  useEffect(() => {
    fetch(`${API}/api/profiles/directory/schools`, { credentials: 'include', headers: { 'X-Akoro-Portal': 'instructor' } })
      .then((r) => r.json()).then((j) => setSchools(j.data || [])).catch(() => {}).finally(() => setSchoolsLoading(false));
  }, []);

  /* ── the conversation engine ── */
  const nid = () => `m${++seq.current}`;
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.current.push(id); };
  const tell = (text) => setLog((l) => [...l, { id: nid(), who: 'me', text }]);
  /** Ako types for a moment, then says each line (or shows a card). `step` marks where the bar should point. */
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
      ['School', a.schoolId ? `${a.schoolName} · request sent` : 'Not joined yet'],
      ['Subjects', a.subjects.length === 1 ? a.subjects[0] : `${a.subjects.length} picked`],
      ['Teaching guide', a.guideName.trim() || 'Unnamed'],
    ];
  };

  const ask = useCallback((idx) => {
    const id = STEP_IDS[idx];
    const a = ansRef.current;
    setStepIdx(idx); setViewStep(idx); setErr(''); setDraft(''); setMoreSubjects(false);
    let lines = []; let after;
    if (id === 'name') {
      lines = [{ text: "Hi, I'm **Ako** — I'll set up your instructor profile in about a minute. It's a quick chat, no long forms." },
        { text: 'First, what should your students call you? Type your name below and send.' }];
      if (a.name) after = () => setDraft(a.name);
    }
    if (id === 'school') lines = schools.length || schoolsLoading
      ? [{ text: `Nice to meet you, ${firstName(a.name)}. Which school do you teach at?`, dim: "Required — type its name in the composer to search, tap your school, then send. The school admin will approve your request to join." }]
      : [{ text: `Nice to meet you, ${firstName(a.name)}. No schools are on Akoro yet — you can keep going and join one later.` }];
    if (id === 'subjects') lines = [{ text: 'What do you teach?', dim: "Required — tap every subject you'll build courses and agents for, then send." }];
    if (id === 'guide') lines = [{ text: 'Last one. Every instructor gets a **teaching guide** — the AI helper your students learn with.' },
      { text: 'Pick its face here and type a name in the composer, then send. Not sure yet? Skip the name — you can change it any time.' }];
    if (id === 'done') lines = [{ text: `You're all set, ${firstName(a.name)}! Here's your setup:` }, { card: 'summary', rows: summaryRows() },
      { text: schoolsLoading || !a.schoolId ? 'Your dashboard is ready when you are.' : "Your dashboard is ready when you are — the school admin will approve your request to join." }];
    say(lines, idx, after);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say, schools.length, schoolsLoading]);

  useEffect(() => {
    alive.current = true;
    ask(0);
    return () => { alive.current = false; timers.current.forEach(clearTimeout); timers.current = []; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── saving: the same two requests the form made ── */
  const save = async () => {
    setSaving(true); setFailed(false); setErr('');
    const a = ansRef.current;
    try {
      const res = await fetch(`${API}/api/profiles/me`, { method: 'PATCH', credentials: 'include', headers: HEADERS, body: JSON.stringify(profilePayload(a)) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || 'Could not save your setup'); }
      // Request to join the chosen school (approval by the school admin).
      if (a.schoolId) {
        await fetch(`${API}/api/profiles/me/school-request`, { method: 'POST', credentials: 'include', headers: HEADERS, body: JSON.stringify({ school_id: a.schoolId }) }).catch(() => {});
      }
      setSaving(false);
      ask(STEP_IDS.indexOf('done'));
    } catch (e) {
      setSaving(false); setFailed(true);
      say([{ text: `I couldn't save that just yet. ${e.message || ''}` }], null);
    }
  };

  const start = () => {
    if (launching) return;
    setLaunching(true);
    markOnboarded();
    navigate('/', { replace: true });
  };

  /* ── what the instructor can do at each step ── */
  const goNext = () => ask(stepIdx + 1);

  const send = () => {
    if (busy || launching) return;
    const id = stepId;
    if (id === 'name') patch({ name: draft.trim() });
    if (id === 'guide') patch({ guideName: draft.trim() });
    const problem = stepError(id, ansRef.current, { schoolsAvailable });
    if (problem) { setErr(problem); return; }
    tell(answerText(id, ansRef.current));
    if (id === 'guide') {
      // Everything required must have been collected by now; if not, say what is missing instead of saving half a profile.
      const missing = missingRequired(ansRef.current, { schoolsAvailable });
      if (missing.length) { setErr(missing[0][1]); return; }
      save(); return;
    }
    goNext();
  };

  const pickSchool = (sc) => {
    const same = ansRef.current.schoolId === sc.id;
    patch({ schoolId: same ? '' : sc.id, schoolName: same ? '' : sc.name });
    setDraft(same ? '' : sc.name);
  };
  const continueWithoutSchool = () => { if (busy) return; tell("I'll join a school later"); goNext(); };
  const toggleSubject = (s) => {
    const cur = ansRef.current.subjects;
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    patch({ subjects: next }); setDraft(subjectsDraft(next));
  };
  const skipGuideName = () => {
    if (busy) return;
    patch({ guideName: '' });
    tell(answerText('guide', ansRef.current));
    save();
  };

  /* ── composer wiring ── */
  const onComposerChange = (v) => {
    if (busy) return;
    if (stepId === 'name' || stepId === 'guide') setDraft(v);
    if (stepId === 'school') { setDraft(v); patch({ schoolId: '', schoolName: '' }); }   // typing searches; a tap on a result is the pick
  };
  const sendDisabled = busy || launching || ({
    name: !draft.trim(),
    school: schoolsAvailable ? !ans.schoolId : true,   // required; with no schools yet, the Continue chip is the way on
    subjects: ans.subjects.length === 0,
    guide: !draft.trim(),
    done: true,
  }[stepId] ?? true);
  const placeholder = busy ? 'One moment…' : ({
    name: 'Type your name…',
    school: ans.schoolId ? 'Send to pick this school' : 'Type to search for your school…',
    subjects: 'Tap your subjects above',
    guide: "Name your guide (or skip)…",
    done: "You're all set — welcome to Akoro",
  }[stepId] || 'Message Ako…');

  const subjectList = SUBJECT_OPTIONS;
  const matches = useMemo(() => filterSchools(schools, draft), [schools, draft]);
  const focusComposer = () => document.querySelector('.ob-composer input')?.focus();

  /* ── chips above the composer ── */
  const chip = (label, onClick, { on = false, skip = false, go = false, key } = {}) => (
    <button key={key || label} type="button" onClick={onClick} className={`ob-chip${on ? ' on' : ''}${skip ? ' skip' : ''}${go ? ' go' : ''}`}>{label}</button>
  );
  const chips = (() => {
    if (typing || saving || launching) return null;
    if (failed) return chip('Try again', save, { go: true });
    if (stepId === 'school' && !schoolsLoading && !schools.length) return chip('Continue without a school', continueWithoutSchool, { go: true });
    if (stepId === 'subjects') {
      const shown = moreSubjects ? subjectList : subjectList.slice(0, SUBJECTS_SHOWN);
      const extra = subjectList.length - SUBJECTS_SHOWN;
      return [
        ...shown.map((s) => chip(s, () => toggleSubject(s), { on: ans.subjects.includes(s) })),
        extra > 0 && chip(moreSubjects ? 'Show fewer' : `+ ${extra} more`, () => setMoreSubjects((m) => !m), { skip: true, key: 'more' }),
      ];
    }
    if (stepId === 'guide') return chip('Skip the name', skipGuideName, { skip: true });
    if (stepId === 'done') return chip(launching ? 'Opening your dashboard…' : 'Go to dashboard →', start, { go: true });
    return null;
  })();

  /* ── the live card for the step being asked (replaced by the instructor's reply once sent) ── */
  const card = (() => {
    if (typing || saving) return null;
    if (stepId === 'school') {
      if (schoolsLoading) return <div className="ob-empty">Finding schools…</div>;
      if (!schools.length) return null;
      return (
        <>
          <SearchBox value={draft} placeholder="Search by school name" onFocusComposer={focusComposer}/>
          <SchoolResults schools={matches} query={draft} selectedId={ans.schoolId} onPick={pickSchool} noMatchText="No school matches that — check the spelling, or ask your school admin to register on Akoro."/>
        </>
      );
    }
    if (stepId === 'guide') return <GuideCard emoji={ans.guideEmoji} onPick={(em) => patch({ guideEmoji: em })}/>;
    return null;
  })();

  /* ── keep the latest line in view; the bar follows where the instructor is reading ── */
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [log.length, typing, stepIdx, schoolsLoading, reduced, draft]);
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
          <div className="ob-logo"><AkoroLogo size={28} radius={0}/>Akoro<span className="ob-sub">Instructor</span></div>
          <button type="button" className="ob-signout" onClick={logout}>Sign out</button>
        </div>
        <div className="ob-prog" role="progressbar" aria-valuemin={1} aria-valuemax={STEP_IDS.length} aria-valuenow={progress.number}>
          <div className="ob-bar"><i style={{ width: `${progress.pct}%` }}/></div>
          <div className="ob-lbl">{progress.done ? 'All done' : `Step ${progress.number} of ${STEP_IDS.length}`}</div>
        </div>

        <div className="ob-chat" ref={chatRef} onScroll={spy} role="log" aria-live="polite">
          {log.map((m) => {
            if (m.who === 'me') return <div key={m.id} className="ob-me">{m.text}</div>;
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
            value={stepId === 'subjects' ? subjectsDraft(ans.subjects) : draft} onChange={onComposerChange} onSend={send} placeholder={placeholder}
            disabled={launching || stepId === 'done'} sendDisabled={sendDisabled} modelLabel="Ako"/>
        </div>
        <div className="ob-foot"><a href="/privacy" target="_blank" rel="noreferrer">Privacy</a><a href="/terms" target="_blank" rel="noreferrer">Terms</a></div>
      </div>
    </div>
  );
}
