import { useCallback, useEffect, useMemo, useState } from 'react';

import { BRAND, GREEN, RED } from '../constants.js';
import {
  adjustStudyPrepPlan, advanceStudyPrepTopic, confirmStudyPrepPlan, confirmStudyPrepTeachBack,
  concludeStudyPrepSession, deferStudyPrepTopic, fetchActiveStudyPrepSession, fetchStudyPrepSession,
  generateStudyPrepPractice, resumeStudyPrepSession, retryStudyPrepDeferred, startStudyPrepSession,
  submitStudyPrepPractice,
} from '../services/studyPrepApi.js';

/**
 * Study Prep — the learner-visible study session loop (Master Plan §4.10).
 *
 * The harness owns every state change; this page renders what happened and
 * presses the human gates: plan confirmation, teach-back confirmation, and
 * the topic choices. The plan card reproduces the reference sketch (S1
 * step 13). Agent intent renders as "agent says:" — visually distinct,
 * never bolded, never factual-styled. Elapsed times are the real recorded
 * durations, never padded.
 */

const clean = (value, maximum) => String(value || '').replace(/[\r\n\x00]+/g, ' ').trim().slice(0, maximum);

const TOPIC_STATUS_STYLE = {
  queued:     { background: 'var(--ak-surface-hover)', color: 'var(--ak-text-muted)' },
  active:     { background: `${BRAND}18`, color: BRAND, borderColor: `${BRAND}55` },
  understood: { background: `${GREEN}15`, color: GREEN, borderColor: `${GREEN}45` },
  flagged_gap:{ background: '#FEF3C7', color: '#B45309', borderColor: '#F59E0B55' },
  capped_out: { background: `${RED}12`, color: RED, borderColor: `${RED}40` },
  deferred:   { background: 'var(--ak-surface-hover)', color: 'var(--ak-text-muted)' },
};
const TOPIC_STATUS_LABEL = {
  queued: 'queued', active: 'active', understood: 'understood',
  flagged_gap: 'gap flagged', capped_out: 'capped out', deferred: 'deferred',
};

export default function StudyPrepPage() {
  const [view, setView] = useState(null);           // { session, topics, events, loop? }
  const [attempt, setAttempt] = useState(null);      // the open practice's public questions
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);        // last submit outcome
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [dropPick, setDropPick] = useState({});
  const [form, setForm] = useState({ goal: '', subject: '', classLevel: 'JSS1', examBoard: 'WAEC' });

  const apply = useCallback((response) => {
    if (response?.session) {
      setView(response);
      if (!response.attempt) return;
      setAttempt(response.attempt); setAnswers({}); setResult(null);
    }
  }, []);

  const run = async (action, { onResult } = {}) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await action();
      if (onResult) onResult(response);
      else apply(response);
      return response;
    } catch (err) {
      setError(err?.message || err?.error || 'That action could not complete.');
      return null;
    } finally { setBusy(false); }
  };

  // On mount, restore the active session if one exists (the harness keeps
  // every state server-side; the page only renders it).
  useEffect(() => {
    let cancelled = false;
    fetchActiveStudyPrepSession()
      .then((response) => { if (!cancelled && response?.session) setView(response); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const session = view?.session || null;
  const topics = view?.topics || [];
  const events = view?.events || [];
  const activeTopic = topics.find(topic => topic.status === 'active') || null;
  const estimate = session?.estimate || null;

  const start = (event) => {
    event.preventDefault();
    const goal = clean(form.goal, 300);
    const subject = clean(form.subject, 180);
    if (goal.length < 3 || subject.length < 2) { setError('Say what you are preparing for, and the subject.'); return; }
    void run(() => startStudyPrepSession({ ...form, goal, subject }));
  };

  const confirmPlan = () => void run(() => confirmStudyPrepPlan(session.id), {
    onResult: (response) => { setView(previous => ({ ...previous, session: response.session, topics: response.topics })); setAdjusting(false); },
  });

  const saveAdjust = () => {
    const drop = Object.keys(dropPick).filter(key => dropPick[key]);
    if (!drop.length) { setAdjusting(false); return; }
    void run(() => adjustStudyPrepPlan(session.id, drop), {
      onResult: (response) => { setView(previous => ({ ...previous, session: response.session })); setAdjusting(false); setDropPick({}); },
    });
  };

  const generate = (mode) => void run(() => generateStudyPrepPractice(session.id, activeTopic.id, mode), {
    onResult: (response) => {
      setView(previous => ({ ...previous, session: response.session, topics: previous.topics.map(topic => topic.id === response.topic.id ? response.topic : topic) }));
      setAttempt(response.attempt); setAnswers({}); setResult(null);
    },
  });

  const submit = () => {
    if (!attempt) return;
    if (Object.keys(answers).length !== attempt.questions.length) { setError('Choose one answer for every question before submitting.'); return; }
    void run(() => submitStudyPrepPractice(session.id, activeTopic.id, attempt.questions.map(question => ({ questionId: question.id, answerIndex: answers[question.id] }))), {
      onResult: (response) => {
        setResult(response);
        setView(previous => ({ ...previous, session: response.session, topics: previous.topics.map(topic => topic.id === response.topic.id ? response.topic : topic) }));
        setAttempt(null);
      },
    });
  };

  const teachBackDone = () => void run(() => confirmStudyPrepTeachBack(session.id, activeTopic.id), {
    onResult: (response) => setView(previous => ({ ...previous, topics: previous.topics.map(topic => topic.id === response.topic.id ? response.topic : topic) })),
  });

  const advance = () => void run(() => advanceStudyPrepTopic(session.id), {
    onResult: (response) => {
      setView(previous => ({ ...previous, topics: previous.topics.map(topic => topic.id === response.topic.id ? response.topic : topic) }));
      setResult(null); setAttempt(null);
    },
  });

  const defer = () => void run(() => deferStudyPrepTopic(session.id, activeTopic?.id, 'attempt_cap_reached'), {
    onResult: () => { setResult(null); void refresh(); },
  });

  const retryDeferred = (topicId) => void run(() => retryStudyPrepDeferred(session.id, topicId), {
    onResult: () => void refresh(),
  });

  const conclude = () => void run(() => concludeStudyPrepSession(session.id), {
    onResult: (response) => setView(previous => ({ ...previous, session: response.session })),
  });

  const resume = () => void run(() => resumeStudyPrepSession(session.id), {
    onResult: (response) => setView(previous => ({ ...previous, session: response.session })),
  });

  const refresh = () => fetchStudyPrepSession(session.id).then(setView).catch(() => {});

  const feed = useMemo(() => [...events].reverse().slice(0, 60), [events]);

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '22px 14px 60px', display: 'grid', gap: 16 }}>
      <header style={{ display: 'grid', gap: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>Study Prep</h1>
        <p style={{ fontSize: 12.5, color: 'var(--ak-text-muted)', margin: 0, lineHeight: 1.5 }}>
          An agent plans your revision, the harness keeps the rules, and you approve every step. Practice is generated exam-style — never a historical past paper.
        </p>
      </header>

      {error && <div role="alert" style={errorBox}>{error}</div>}
      {notice && <div role="status" style={noticeBox}>{notice}</div>}

      {/* ── no session: the start form ─────────────────────────────────── */}
      {!session && (
        <form onSubmit={start} style={card}>
          <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ak-text)' }}>Prepare for an exam</div>
          <p style={body}>Tell the agent what you are preparing for. It inspects the syllabus and your recorded knowledge, then proposes a plan — nothing is charged until you approve it.</p>
          <label style={label}>What are you preparing for?<input required minLength={3} maxLength={300} value={form.goal} onChange={e => setForm({ ...form, goal: e.target.value })} placeholder="e.g. My whole-term Basic Science exam" style={input} /></label>
          <label style={label}>Subject<input required maxLength={180} value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="e.g. Basic Science" style={input} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={label}>Class level
              <select value={form.classLevel} onChange={e => setForm({ ...form, classLevel: e.target.value })} style={input}>
                {['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'].map(level => <option key={level} value={level}>{level}</option>)}
              </select>
            </label>
            <label style={label}>Exam board
              <select value={form.examBoard} onChange={e => setForm({ ...form, examBoard: e.target.value })} style={input}>
                {['WAEC', 'NECO', 'JAMB'].map(board => <option key={board} value={board}>{board}</option>)}
              </select>
            </label>
          </div>
          <button disabled={busy} style={primary}>{busy ? 'Planning…' : 'Plan my revision'}</button>
        </form>
      )}

      {/* ── the plan card (reference sketch, S1 step 13) ────────────────── */}
      {session && ['planning', 'awaiting_confirmation'].includes(session.status) && (
        <section style={{ ...card, borderColor: `${BRAND}45` }}>
          <div style={{ textAlign: 'center', display: 'grid', gap: 3 }}>
            <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 1.2, color: 'var(--ak-text)' }}>YOUR {session.subject.toUpperCase()} PLAN</div>
            <div style={caption}>{(session.plan || []).length} topics{estimate ? ` · estimated cost: ${estimate.totalCoins} coins (practice ${estimate.practiceCoins} + planning ${estimate.loopCoins})` : ''}</div>
          </div>
          {!adjusting ? (
            <>
              <ol style={{ margin: '14px 0', paddingLeft: 22, display: 'grid', gap: 7 }}>
                {(session.plan || []).map(topic => <li key={topic.syllabusTopicId} style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ak-text-sub)' }}>{topic.label}</li>)}
              </ol>
              {session.status === 'awaiting_confirmation' ? (
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button type="button" disabled={busy} onClick={confirmPlan} style={primary}>Approve & Start</button>
                  <button type="button" disabled={busy} onClick={() => setAdjusting(true)} style={secondary}>Adjust</button>
                </div>
              ) : <p style={{ ...caption, textAlign: 'center' }}>The agent is still planning…</p>}
            </>
          ) : (
            <>
              <p style={body}>Untick any topic you want to leave for later. The cost estimate updates when you save.</p>
              <div style={{ display: 'grid', gap: 7, margin: '10px 0' }}>
                {(session.plan || []).map(topic => (
                  <label key={topic.syllabusTopicId} style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13, color: 'var(--ak-text-sub)', fontWeight: 700, padding: '8px 10px', border: '1px solid var(--ak-border2)', borderRadius: 10 }}>
                    <input type="checkbox" checked={!!dropPick[topic.syllabusTopicId]} onChange={e => setDropPick({ ...dropPick, [topic.syllabusTopicId]: e.target.checked })} />
                    {topic.position}. {topic.label}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button type="button" disabled={busy} onClick={saveAdjust} style={primary}>Save adjustment</button>
                <button type="button" onClick={() => { setAdjusting(false); setDropPick({}); }} style={secondary}>Cancel</button>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── paused banner ──────────────────────────────────────────────── */}
      {session?.status === 'paused' && (
        <section style={{ ...card, borderColor: `${RED}45`, background: `${RED}08` }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ak-text)' }}>
            {session.pausedReason === 'agent_loop_cap' ? 'I got stuck — tap to retry or adjust.'
              : session.pausedReason === 'insufficient_balance' ? 'Not enough coins to continue.'
                : 'Paused.'}
          </div>
          <p style={body}>
            {session.pausedReason === 'insufficient_balance'
              ? 'Top up your wallet and come back — your progress is kept exactly where you left it.'
              : 'Your progress is kept. Resume when you are ready.'}
          </p>
          <button type="button" disabled={busy} onClick={resume} style={primary}>Resume session</button>
        </section>
      )}

      {/* ── the topic loop ─────────────────────────────────────────────── */}
      {session && ['topic_active', 'replanning'].includes(session.status) && (
        <>
          <section style={card}>
            <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)', marginBottom: 10 }}>TOPICS</div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {topics.map(topic => {
                const style = TOPIC_STATUS_STYLE[topic.status] || TOPIC_STATUS_STYLE.queued;
                return (
                  <span key={topic.id} title={topic.status} style={{ ...chip, background: style.background, color: style.color, borderColor: style.borderColor || 'var(--ak-border2)' }}>
                    {topic.position}. {topic.label} · {TOPIC_STATUS_LABEL[topic.status] || topic.status}
                    {topic.status === 'deferred' && !topic.deferredRetryUsed && (
                      <button type="button" disabled={busy} onClick={() => retryDeferred(topic.id)} style={{ marginLeft: 6, border: 0, background: 'transparent', color: 'inherit', fontWeight: 900, cursor: 'pointer', textDecoration: 'underline', fontSize: 11 }}>retry</button>
                    )}
                  </span>
                );
              })}
            </div>
          </section>

          {activeTopic && (
            <section style={{ ...card, borderColor: `${BRAND}40` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)' }}>{activeTopic.label}</div>
                <div style={caption}>attempt {activeTopic.attemptsUsed + (attempt ? 0 : 0)}{activeTopic.learnerConfirmedReady ? ' · teach-back confirmed' : ''}</div>
              </div>

              {!attempt && !result && (
                <div style={{ display: 'grid', gap: 9, marginTop: 12 }}>
                  <p style={body}>A short diagnostic comes first — it shows what you already know before any teaching.</p>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button type="button" disabled={busy} onClick={() => generate('diagnostic')} style={primary}>Start diagnostic (2 coins)</button>
                  </div>
                </div>
              )}

              {attempt && (
                <div style={{ display: 'grid', gap: 13, marginTop: 12 }}>
                  <div style={caption}>Attempt {attempt.attemptNumber} · answer every question, then submit — the server scores it.</div>
                  {attempt.questions.map((question, questionIndex) => (
                    <div key={question.id} style={questionBox}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', lineHeight: 1.45 }}>{questionIndex + 1}. {question.question}</div>
                      {question.objective && <div style={{ ...caption, marginTop: 4 }}>Objective: {question.objective}</div>}
                      <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>
                        {question.options.map((option, optionIndex) => (
                          <label key={optionIndex} style={{ ...optionStyle, borderColor: answers[question.id] === optionIndex ? BRAND : 'var(--ak-border2)', background: answers[question.id] === optionIndex ? `${BRAND}12` : 'var(--ak-surface)' }}>
                            <input type="radio" name={question.id} checked={answers[question.id] === optionIndex} onChange={() => setAnswers({ ...answers, [question.id]: optionIndex })} /> <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button type="button" disabled={busy} onClick={submit} style={primary}>{busy ? 'Recording…' : 'Submit answers'}</button>
                </div>
              )}

              {result && (
                <div style={{ display: 'grid', gap: 11, marginTop: 12 }}>
                  <div style={{ ...resultBox, borderColor: result.passed ? `${GREEN}70` : `${RED}50` }}>
                    <div style={{ fontSize: 26, fontWeight: 900, color: result.passed ? GREEN : RED }}>{Math.round((result.score || 0) * 100)}%</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)' }}>{result.correct} of {result.total} correct</div>
                    <div style={caption}>{result.passed ? 'Threshold reached — topic understood.' : result.outcome === 'capped_out' ? 'Attempt cap reached.' : 'Below the pass mark — teach it back, then take a fresh retest.'}</div>
                  </div>
                  {result.outcome === 'retest_offered' && !activeTopic.learnerConfirmedReady && (
                    <div style={{ ...questionBox, background: 'var(--ak-surface-hover)' }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)' }}>Teach it back</div>
                      <p style={body}>Explain {activeTopic.label} out loud or in writing, in your own words — evaporation, transpiration, the whole story. This is retrieval practice for you; the retest unlocks only when YOU say you have taught it back.</p>
                      <button type="button" disabled={busy} onClick={teachBackDone} style={primary}>I've taught it back — unlock retest</button>
                    </div>
                  )}
                  {activeTopic.learnerConfirmedReady && !attempt && result.outcome === 'retest_offered' && (
                    <button type="button" disabled={busy} onClick={() => generate('retest')} style={primary}>Start fresh retest (2 coins)</button>
                  )}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {result.outcome === 'understood' && <button type="button" disabled={busy} onClick={advance} style={primary}>Next topic</button>}
                    {result.outcome === 'capped_out' && <button type="button" disabled={busy} onClick={defer} style={secondary}>Defer this topic</button>}
                    {['understood', 'capped_out'].includes(result.outcome) && <button type="button" disabled={busy} onClick={conclude} style={secondary}>Conclude session</button>}
                  </div>
                </div>
              )}
            </section>
          )}

          {!activeTopic && (
            <section style={card}>
              <p style={body}>No topic is active right now.</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" disabled={busy} onClick={advance} style={primary}>Move to the next topic</button>
                <button type="button" disabled={busy} onClick={conclude} style={secondary}>Conclude session</button>
              </div>
            </section>
          )}
        </>
      )}

      {/* ── completed summary ──────────────────────────────────────────── */}
      {session && ['completed', 'cancelled', 'abandoned'].includes(session.status) && (
        <section style={card}>
          <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)' }}>
            {session.status === 'completed' ? 'Session complete' : 'Session ended'}
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', margin: '10px 0' }}>
            {topics.map(topic => {
              const style = TOPIC_STATUS_STYLE[topic.status] || TOPIC_STATUS_STYLE.queued;
              return <span key={topic.id} style={{ ...chip, background: style.background, color: style.color, borderColor: style.borderColor || 'var(--ak-border2)' }}>{topic.label} · {TOPIC_STATUS_LABEL[topic.status] || topic.status}</span>;
            })}
          </div>
          <p style={body}>Understanding is recorded from your attempts — future sessions and your teacher's gap report build on it.</p>
          <button type="button" onClick={() => { setView(null); setForm({ goal: '', subject: session.subject, classLevel: session.classLevel, examBoard: session.examBoard }); }} style={secondary}>Start a new session</button>
        </section>
      )}

      {/* ── the agent activity feed (replay: never re-runs the LLM) ─────── */}
      {session && events.length > 0 && (
        <section style={card}>
          <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)', marginBottom: 10 }}>ACTIVITY</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {feed.map(event => (
              <div key={event.sequence} style={{ display: 'grid', gap: 2 }}>
                {event.agentIntent && (
                  <div style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--ak-text-muted)', fontWeight: 500 }}>
                    agent says: {event.agentIntent}
                    {event.durationMs != null && <span style={{ marginLeft: 6, opacity: 0.7 }}>({event.durationMs} ms)</span>}
                  </div>
                )}
                {event.narrative && (
                  <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--ak-text-sub)', lineHeight: 1.5 }}>
                    {event.eventType === 'harness_decision' ? '✓ ' : event.eventType === 'engine_result' ? '📊 ' : event.eventType === 'human_gate' ? '👤 ' : ''}
                    {event.narrative}
                  </div>
                )}
                {!event.narrative && !event.agentIntent && (
                  <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)' }}>
                    {event.eventType}{event.tool ? ` · ${event.tool}` : ''}{event.action ? ` · ${event.action}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── house styles (inline objects, CSS variables — matches the assessment modal) ──
const card = { background: 'var(--ak-surface)', border: '1px solid var(--ak-border2)', borderRadius: 16, padding: 16, display: 'grid', gap: 8 };
const caption = { fontSize: 11, color: 'var(--ak-text-muted)', fontWeight: 650, lineHeight: 1.4 };
const body = { fontSize: 12.5, lineHeight: 1.55, color: 'var(--ak-text-sub)', margin: 0 };
const label = { display: 'grid', gap: 5, fontSize: 11, fontWeight: 800, color: 'var(--ak-text-sub)' };
const input = { width: '100%', boxSizing: 'border-box', padding: '10px 11px', borderRadius: 10, border: '1px solid var(--ak-border2)', background: 'var(--ak-surface-hover)', color: 'var(--ak-text)', font: 'inherit' };
const primary = { border: 0, borderRadius: 11, padding: '11px 14px', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', fontWeight: 850, fontSize: 12.5, cursor: 'pointer' };
const secondary = { border: '1px solid var(--ak-border2)', borderRadius: 11, padding: '10px 14px', background: 'var(--ak-surface-hover)', color: 'var(--ak-text-sub)', fontWeight: 800, fontSize: 12.5, cursor: 'pointer' };
const errorBox = { padding: '9px 11px', marginBottom: 4, borderRadius: 10, background: `${RED}12`, color: RED, border: `1px solid ${RED}35`, fontSize: 12, fontWeight: 700 };
const noticeBox = { padding: '9px 11px', marginBottom: 4, borderRadius: 10, background: `${GREEN}12`, color: GREEN, border: `1px solid ${GREEN}35`, fontSize: 12, fontWeight: 700 };
const chip = { display: 'inline-flex', alignItems: 'center', padding: '5px 10px', borderRadius: 999, border: '1px solid', fontSize: 11.5, fontWeight: 800 };
const questionBox = { border: '1px solid var(--ak-border)', borderRadius: 13, padding: 12 };
const optionStyle = { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 9px', border: '1px solid', borderRadius: 9, fontSize: 12.5, color: 'var(--ak-text-sub)', cursor: 'pointer' };
const resultBox = { border: '1px solid', borderRadius: 13, padding: 15, display: 'grid', gap: 3, background: 'var(--ak-surface-hover)' };
