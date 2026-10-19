import { useCallback, useEffect, useMemo, useState } from 'react';

import { BRAND, GREEN, RED } from '../../../constants.js';
import BattleModal from '../../battles/BattleModal.jsx';
import { Icon } from '../../common/Icons.jsx';
import { studyPrepCardHead, workflowCardSteps } from '../../../lib/agentChatTrace.js';
import { cacheEvents, cachedEvents, openWorkflowStream, rememberSeen, seenSequence } from '../../../lib/workflowStream.js';
import { WorkflowHead, WorkflowSteps } from './WorkflowSteps.jsx';
import {
  adjustStudyPrepPlan, advanceStudyPrepTopic, confirmStudyPrepPlan, confirmStudyPrepTeachBack,
  concludeStudyPrepSession, deferStudyPrepTopic, fetchStudyPrepSession, generateStudyPrepPractice,
  resumeStudyPrepSession, retryStudyPrepDeferred, submitStudyPrepPractice,
} from '../../../services/studyPrepApi.js';

/**
 * StudyPrepChatCard — the study-prep session rendered INSIDE the Agent Chat
 * tab (the instructor activity-draft pattern: the tool execution rides with
 * the reply as a session echo, and the chat renders the interactive card).
 *
 * The card is the session's human-gate surface: plan confirmation, teach-back
 * confirmation, answers and topic choices all happen here through the harness
 * REST endpoints. The model never confirms, advances or generates — plan-only
 * in chat, by design. Answer keys never reach the client; scores come back
 * from the Education Engine.
 */

const TOPIC_STATUS_STYLE = {
  queued: { background: 'var(--ak-surface-hover)', color: 'var(--ak-text-muted)', border: 'var(--ak-border2)' },
  active: { background: `${BRAND}15`, color: BRAND, border: `${BRAND}55` },
  understood: { background: `${GREEN}14`, color: GREEN, border: `${GREEN}45` },
  flagged_gap: { background: '#FEF3C7', color: '#B45309', border: '#F59E0B55' },
  capped_out: { background: `${RED}12`, color: RED, border: `${RED}40` },
  deferred: { background: 'var(--ak-surface-hover)', color: 'var(--ak-text-muted)', border: 'var(--ak-border2)' },
};
/** Live events that move the session: the card re-reads it on these. */
const STATE_EVENTS = new Set([
  'workflow.state_changed', 'workflow.paused', 'workflow.resumed', 'workflow.completed', 'workflow.cancelled',
  'topic.state_changed', 'assessment.completed', 'learner.action_received', 'decision.accepted',
]);

const TOPIC_STATUS_LABEL = {
  queued: 'queued', active: 'active', understood: 'understood',
  flagged_gap: 'gap flagged', capped_out: 'capped out', deferred: 'deferred',
};

/** Session views and "away" counts kept across a card moving between the chat and the pinned spot. */
const viewCache = new Map();
const awayCache = new Map();

/**
 * pinned: the compact card docked above the message box while the workflow
 * runs (head + latest steps). onRunning(sessionId, running) tells the chat
 * whether to pin it.
 */
export default function StudyPrepChatCard({ sessionId, onEvents, onRunning, pinned = false }) {
  const [view, setViewState] = useState(() => viewCache.get(sessionId) || null);
  const setView = useCallback((next) => setViewState((previous) => {
    const value = typeof next === 'function' ? next(previous) : next;
    if (value) viewCache.set(sessionId, value);
    return value;
  }), [sessionId]);
  const [attempt, setAttempt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [dropPick, setDropPick] = useState({});
  const [noNotes, setNoNotes] = useState(false);
  const [watching, setWatching] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;
    // One silent retry: this load fires right after a heavy streaming chat
    // turn, where a transient 429/auth blip is the usual culprit — the session
    // itself is almost always fine. Only after both attempts show the error.
    const load = (attempt) => {
      fetchStudyPrepSession(sessionId)
        .then((response) => { if (!cancelled && response?.session) { setView(response); setError(''); } })
        .catch((err) => {
          if (cancelled) return;
          if (attempt === 0) { retryTimer = setTimeout(() => load(1), 1500); return; }
          console.warn('[study-prep] session load failed:', err?.code || '', err?.message || err);
          setError(err?.message || err?.error || 'This study session could not be loaded.');
        });
    };
    load(0);
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, [sessionId, reloadKey]);

  const run = async (action, onResult) => {
    setBusy(true); setError('');
    try {
      const response = await action();
      if (onResult) onResult(response);
      return response;
    } catch (err) {
      setError(err?.message || err?.error || 'That action could not complete.');
      return null;
    } finally { setBusy(false); }
  };

  const refresh = useCallback(() => {
    fetchStudyPrepSession(sessionId).then((response) => { if (response?.session) setView(response); }).catch(() => {});
  }, [sessionId]);

  // Phase 3: the session's steps arrive live from its workflow's event stream
  // (replayed from the start, then pushed). Without a workflow — an older API —
  // the session view's own event list is used, as before.
  const workflowId = view?.session?.workflowId || null;
  const [wfEvents, setWfEvents] = useState(() => (workflowId && cachedEvents(workflowId)) || null);
  const [away, setAwayState] = useState(() => awayCache.get(sessionId) || 0);
  const setAway = useCallback((n) => { awayCache.set(sessionId, n); setAwayState(n); }, [sessionId]);
  useEffect(() => {
    if (!workflowId) return undefined;
    const seen = seenSequence(workflowId);
    let list = cachedEvents(workflowId) || [];
    // Picking up from steps this card already had (it moved): everything that arrives is new.
    const resumed = list.length > 0;
    if (resumed) setWfEvents(list);
    const close = openWorkflowStream({
      workflowId,
      after: list.length ? list[list.length - 1].sequence : -1,
      onEvent: (event, { live }) => {
        list = [...list, event];
        cacheEvents(workflowId, list);
        setWfEvents(list);
        rememberSeen(workflowId, event.sequence);
        // A step that moves the session: re-read it so the card's buttons match.
        if ((live || resumed) && STATE_EVENTS.has(event.type)) refresh();
      },
      // "While you were away": steps this device hadn't shown yet.
      onCaughtUp: (replayed) => { if (!resumed && seen != null && replayed.length) setAway(workflowCardSteps(replayed.filter((e) => e.sequence > seen)).length); },
      onError: () => setWfEvents(null),
    });
    return close;
  }, [workflowId, refresh, setAway]);

  // With a workflow stream the steps are the card's own; an older API's
  // session steps still go to the chat's trace (AgentChatTab), as before.
  const events = view?.events;
  useEffect(() => {
    if (wfEvents) onEvents?.(sessionId, { v3: wfEvents });
    else if (events) onEvents?.(sessionId, events);
  }, [sessionId, events, wfEvents, onEvents]);

  // An Agent Check runs on the server; the card picks up its score when it lands.
  const checkRunning = !!view?.topics?.some((topic) => topic.status === 'active' && topic.checkBattleId && !topic.checkScoredAt);
  useEffect(() => {
    if (!checkRunning) return undefined;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [checkRunning, refresh]);

  // Running = the workflow is working right now: planning (with a step in
  // the last few minutes — a session left in planning isn't running), or an
  // Agent Check under way. While running, the chat pins the card.
  const status = view?.session?.status;
  const lastAt = wfEvents?.length ? Date.parse(wfEvents[wfEvents.length - 1].timestamp || '') || 0 : 0;
  const planningNow = ['planning', 'replanning'].includes(status) && Date.now() - lastAt < 3 * 60_000;
  const running = !!wfEvents && (planningNow || checkRunning);
  const steps = useMemo(() => workflowCardSteps(wfEvents || [], { running }), [wfEvents, running]);
  useEffect(() => { onRunning?.(sessionId, running); }, [sessionId, running, onRunning]);

  if (!view) {
    return (
      <div style={{ ...card, padding: 12, marginTop: 6 }}>
        <div style={caption}>{error ? 'This study session could not be loaded.' : 'Loading your study session…'}</div>
        {error && (
          <div style={{ ...caption, color: RED }}>
            {error}
            {' '}<button type="button" onClick={() => { setError(''); setReloadKey((key) => key + 1); }} style={{ border: 0, background: 'transparent', color: 'inherit', fontWeight: 900, cursor: 'pointer', textDecoration: 'underline', fontSize: 10.5, padding: 0 }}>try again</button>
          </div>
        )}
      </div>
    );
  }

  const session = view.session;
  const topics = view.topics || [];
  const activeTopic = topics.find((topic) => topic.status === 'active') || null;
  const estimate = session.estimate;
  // D45: practice is the Agent Check — the protégé answers from the learner's
  // notes in a battle the learner watches; the Engine's score lands on the topic.
  const agentMode = !!view.agentCheck;
  // A check that settled its topic still shows its result until the learner moves on.
  const lastSettled = [...topics].filter((topic) => topic.status !== 'queued').sort((a, b) => b.position - a.position)[0];
  const shownTopic = activeTopic || (agentMode && lastSettled?.checkScoredAt && ['understood', 'capped_out'].includes(lastSettled.status) ? lastSettled : null);
  const checkResult = agentMode && shownTopic?.checkScoredAt && shownTopic.checkResult ? {
    ...shownTopic.checkResult,
    passed: shownTopic.status === 'understood',
    outcome: shownTopic.status === 'understood' || shownTopic.status === 'capped_out' ? shownTopic.status : 'retest_offered',
  } : null;
  const shownResult = agentMode ? checkResult : result;
  const checkLive = agentMode && !!shownTopic?.checkBattleId && !shownTopic.checkScoredAt;
  const head = studyPrepCardHead(session.status, activeTopic?.label || null);
  const watch = () => setWatching({ id: shownTopic.checkBattleId, title: `Agent Check: ${shownTopic.label}`, topic: shownTopic.label, status: 'lobby', type: 'check' });

  const confirmPlan = () => void run(() => confirmStudyPrepPlan(session.id), (response) => {
    setView((previous) => ({ ...previous, session: response.session, topics: response.topics }));
    setAdjusting(false);
  });

  const saveAdjust = () => {
    const drop = Object.keys(dropPick).filter((key) => dropPick[key]);
    if (!drop.length) { setAdjusting(false); return; }
    void run(() => adjustStudyPrepPlan(session.id, drop), (response) => {
      setView((previous) => ({ ...previous, session: response.session }));
      setAdjusting(false); setDropPick({});
    });
  };

  const generate = (mode) => void run(() => generateStudyPrepPractice(session.id, activeTopic.id, mode), (response) => {
    setView((previous) => ({ ...previous, session: response.session, topics: previous.topics.map((topic) => topic.id === response.topic.id ? response.topic : topic) }));
    setNoNotes(!!response.skipped);
    if (agentMode) return;
    setAttempt(response.attempt); setAnswers({}); setResult(null);
  });

  const submit = () => {
    if (!attempt) return;
    if (Object.keys(answers).length !== attempt.questions.length) { setError('Choose one answer for every question before submitting.'); return; }
    void run(() => submitStudyPrepPractice(session.id, activeTopic.id, attempt.questions.map((question) => ({ questionId: question.id, answerIndex: answers[question.id] }))), (response) => {
      setResult(response);
      setView((previous) => ({ ...previous, session: response.session, topics: previous.topics.map((topic) => topic.id === response.topic.id ? response.topic : topic) }));
      setAttempt(null);
    });
  };

  const teachBackDone = () => void run(() => confirmStudyPrepTeachBack(session.id, activeTopic.id), (response) => {
    setView((previous) => ({ ...previous, topics: previous.topics.map((topic) => topic.id === response.topic.id ? response.topic : topic) }));
  });

  const advance = () => void run(() => advanceStudyPrepTopic(session.id), (response) => {
    setView((previous) => ({ ...previous, topics: previous.topics.map((topic) => topic.id === response.topic.id ? response.topic : topic) }));
    setResult(null); setAttempt(null); setNoNotes(false);
  });

  const defer = () => void run(() => deferStudyPrepTopic(session.id, shownTopic?.id, 'attempt_cap_reached'), () => { setResult(null); refresh(); });
  const retryDeferred = (topicId) => void run(() => retryStudyPrepDeferred(session.id, topicId), refresh);
  const conclude = () => void run(() => concludeStudyPrepSession(session.id), (response) => setView((previous) => ({ ...previous, session: response.session })));
  const resume = () => void run(() => resumeStudyPrepSession(session.id), (response) => setView((previous) => ({ ...previous, session: response.session })));

  return (
    <div style={{ ...card, marginTop: 6, maxWidth: '100%' }}>
      {wfEvents ? <WorkflowHead head={head} subject={session.subject}/> : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="ti-target" size={15} color={BRAND}/> Study Prep · {session.subject}</div>
          <div style={caption}>{session.status.replace(/_/g, ' ')}</div>
        </div>
      )}
      {away > 0 && (
        <div data-workflow-away={away} role="status" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderRadius: 10, background: `${BRAND}12`, border: `1px solid ${BRAND}30`, color: BRAND, fontSize: 12, fontWeight: 800 }}>
          <Icon name="ti-refresh" size={14} color={BRAND}/> While you were away · {away} step{away === 1 ? '' : 's'}
          <button type="button" aria-label="Dismiss" onClick={() => setAway(0)} style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex' }}><Icon name="ti-x" size={13} color={BRAND}/></button>
        </div>
      )}
      {wfEvents && <WorkflowSteps steps={steps} limit={pinned ? 4 : 8}/>}
      {error && <div role="alert" style={errorBox}>{error}</div>}

      {/* Pinned (running): the head and the latest steps only — the full card is back at its message once it settles. */}
      {pinned ? (checkLive && <button type="button" onClick={watch} style={primary}>Watch the Agent Check</button>) : <>

      {/* ── the plan card: Approve & Start / Adjust (the only spend gate) ── */}
      {['planning', 'awaiting_confirmation'].includes(session.status) && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ textAlign: 'center', display: 'grid', gap: 2, padding: '4px 0' }}>
            <div style={{ fontSize: 13.5, fontWeight: 900, letterSpacing: 1, color: 'var(--ak-text)' }}>YOUR {session.subject.toUpperCase()} PLAN</div>
            <div style={caption}>{(session.plan || []).length} topics{estimate ? ` · estimated cost: ${estimate.totalCoins} coins` : ''}</div>
          </div>
          {/* No real syllabus for this class + subject: the plan is made from an AI-drafted outline (§8.7). Always said. */}
          {session.syllabusLabel && (
            <div role="note" style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, fontWeight: 700, lineHeight: 1.45, color: 'var(--ak-text-sub)', padding: '7px 10px', borderRadius: 9, background: 'var(--ak-surface2, rgba(124,58,237,.06))', border: '1px solid var(--ak-border2)' }}>
              <span className="ti ti-info-circle" aria-hidden="true" style={{ fontSize: 14, marginTop: 1 }} />
              <span>{session.syllabusLabel}</span>
            </div>
          )}
          {!adjusting ? (
            <>
              <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 5 }}>
                {(session.plan || []).map((topic) => <li key={topic.syllabusTopicId} style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-sub)' }}>{topic.label}</li>)}
              </ol>
              {session.status === 'awaiting_confirmation' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" disabled={busy} onClick={confirmPlan} style={primary}>Approve & Start</button>
                  <button type="button" disabled={busy} onClick={() => setAdjusting(true)} style={secondary}>Adjust</button>
                </div>
              )}
              {session.status === 'planning' && <div style={caption}>The agent is still planning…</div>}
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 5 }}>
                {(session.plan || []).map((topic) => (
                  <label key={topic.syllabusTopicId} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--ak-text-sub)', fontWeight: 700, padding: '6px 9px', border: '1px solid var(--ak-border2)', borderRadius: 9 }}>
                    <input type="checkbox" checked={!!dropPick[topic.syllabusTopicId]} onChange={(event) => setDropPick({ ...dropPick, [topic.syllabusTopicId]: event.target.checked })} />
                    {topic.position}. {topic.label}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" disabled={busy} onClick={saveAdjust} style={primary}>Save adjustment</button>
                <button type="button" onClick={() => { setAdjusting(false); setDropPick({}); }} style={secondary}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── paused: honest copy, resumable ─────────────────────────────── */}
      {session.status === 'paused' && (
        <div style={{ display: 'grid', gap: 7 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>
            {session.pausedReason === 'agent_loop_cap' ? 'I got stuck — tap to retry or adjust.'
              : session.pausedReason === 'insufficient_balance' ? 'Not enough coins to continue.'
                : 'Paused.'}
          </div>
          <div style={caption}>{session.pausedReason === 'insufficient_balance' ? 'Top up your wallet and resume — your progress is kept exactly where you left it.' : 'Your progress is kept. Resume when you are ready.'}</div>
          <div><button type="button" disabled={busy} onClick={resume} style={primary}>Resume session</button></div>
        </div>
      )}

      {/* ── the topic loop ─────────────────────────────────────────────── */}
      {['topic_active', 'replanning'].includes(session.status) && (
        <div style={{ display: 'grid', gap: 9 }}>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {topics.map((topic) => {
              const style = TOPIC_STATUS_STYLE[topic.status] || TOPIC_STATUS_STYLE.queued;
              return (
                <span key={topic.id} style={{ ...chip, background: style.background, color: style.color, border: `1px solid ${style.border}` }}>
                  {topic.position}. {topic.label} · {TOPIC_STATUS_LABEL[topic.status] || topic.status}
                  {topic.status === 'deferred' && !topic.deferredRetryUsed && (
                    <button type="button" disabled={busy} onClick={() => retryDeferred(topic.id)} style={{ marginLeft: 5, border: 0, background: 'transparent', color: 'inherit', fontWeight: 900, cursor: 'pointer', textDecoration: 'underline', fontSize: 10.5 }}>retry</button>
                  )}
                </span>
              );
            })}
          </div>

          {shownTopic && (
            <div style={{ display: 'grid', gap: 8, padding: '9px 10px', border: '1px solid var(--ak-border2)', borderRadius: 11, background: 'var(--ak-surface-hover)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)' }}>{shownTopic.label}</div>
                <div style={caption}>{shownTopic.learnerConfirmedReady ? 'teach-back confirmed' : `attempt ${shownTopic.attemptsUsed}`}</div>
              </div>

              {!attempt && !shownResult && !checkLive && (
                <div style={{ display: 'grid', gap: 7 }}>
                  {!agentMode ? (
                    <>
                      <div style={caption}>A short diagnostic comes first — it shows what you already know.</div>
                      <div><button type="button" disabled={busy} onClick={() => generate('diagnostic')} style={primary}>Start diagnostic (2 coins)</button></div>
                    </>
                  ) : (
                    <>
                      <div style={caption}>{noNotes
                        ? `Your agent has no notes on ${shownTopic.label} yet, so there's nothing to check. Teach it first — nothing was charged.`
                        : 'Your agent is checked first: your teaching guide asks, your agent answers only from what you taught it, and Sergeant judges every answer.'}</div>
                      <div><button type="button" disabled={busy} onClick={() => generate('diagnostic')} style={primary}>Start Agent Check (2 coins)</button></div>
                    </>
                  )}
                </div>
              )}

              {checkLive && (
                <div style={{ display: 'grid', gap: 7 }}>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>
                    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: RED, flexShrink: 0 }} />
                    Agent Check running
                  </div>
                  <div><button type="button" onClick={watch} style={primary}>Watch the battle</button></div>
                </div>
              )}

              {attempt && (
                <div style={{ display: 'grid', gap: 10 }}>
                  {attempt.questions.map((question, questionIndex) => (
                    <div key={question.id}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', lineHeight: 1.45 }}>{questionIndex + 1}. {question.question}</div>
                      <div style={{ display: 'grid', gap: 5, marginTop: 7 }}>
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

              {shownResult && !checkLive && (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 22, fontWeight: 900, color: shownResult.passed ? GREEN : RED }}>{Math.round((shownResult.score || 0) * 100)}%</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ak-text)' }}>{agentMode ? `Your agent answered ${shownResult.correct} of ${shownResult.total} from your notes` : `${shownResult.correct} of ${shownResult.total} correct`}</span>
                  </div>
                  <div style={caption}>
                    {agentMode && shownResult.guessed > 0 && `It had to guess on ${shownResult.guessed} — a guess doesn't count. `}
                    {shownResult.passed ? 'Threshold reached — topic understood.' : shownResult.outcome === 'capped_out' ? 'Attempt cap reached.' : 'Below the pass mark — teach it back, then take a fresh retest.'}
                  </div>
                  {agentMode && shownResult.gaps?.length > 0 && (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {shownResult.gaps.map((gap, index) => (
                        <span key={gap} style={{ ...chip, background: '#FEF3C7', color: '#B45309', border: '1px solid #F59E0B55' }}>{index === 0 ? `Not in your notes: ${gap}` : gap}</span>
                      ))}
                    </div>
                  )}
                  {shownResult.outcome === 'retest_offered' && !shownTopic.learnerConfirmedReady && (
                    <div style={{ display: 'grid', gap: 6, padding: '8px 9px', border: '1px dashed var(--ak-border2)', borderRadius: 9 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--ak-text)' }}>Teach it back</div>
                      <div style={caption}>Explain {shownTopic.label} in your own words — out loud or in writing. It is retrieval practice for you; the retest unlocks only when YOU confirm.</div>
                      <div><button type="button" disabled={busy} onClick={teachBackDone} style={primary}>I've taught it back — unlock retest</button></div>
                    </div>
                  )}
                  {shownTopic.learnerConfirmedReady && !attempt && shownResult.outcome === 'retest_offered' && (
                    <div><button type="button" disabled={busy} onClick={() => generate('retest')} style={primary}>{agentMode ? 'Start a fresh Agent Check (2 coins)' : 'Start fresh retest (2 coins)'}</button></div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {shownResult.outcome === 'understood' && <button type="button" disabled={busy} onClick={advance} style={primary}>Next topic</button>}
                    {shownResult.outcome === 'capped_out' && <button type="button" disabled={busy} onClick={defer} style={secondary}>Defer this topic</button>}
                    {['understood', 'capped_out'].includes(shownResult.outcome) && <button type="button" disabled={busy} onClick={conclude} style={secondary}>Conclude session</button>}
                  </div>
                </div>
              )}
            </div>
          )}

          {!shownTopic && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" disabled={busy} onClick={advance} style={primary}>Move to the next topic</button>
              <button type="button" disabled={busy} onClick={conclude} style={secondary}>Conclude session</button>
            </div>
          )}
        </div>
      )}

      {/* ── ended ──────────────────────────────────────────────────────── */}
      {['completed', 'cancelled', 'abandoned'].includes(session.status) && (
        <div style={{ display: 'grid', gap: 7 }}>
          <div style={{ fontSize: 12.5, fontWeight: 900, color: 'var(--ak-text)' }}>{session.status === 'completed' ? 'Session complete' : 'Session ended'}</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {topics.map((topic) => {
              const style = TOPIC_STATUS_STYLE[topic.status] || TOPIC_STATUS_STYLE.queued;
              return <span key={topic.id} style={{ ...chip, background: style.background, color: style.color, border: `1px solid ${style.border}` }}>{topic.label} · {TOPIC_STATUS_LABEL[topic.status] || topic.status}</span>;
            })}
          </div>
          <div style={caption}>Understanding is recorded from your attempts — future sessions and your teacher's gap report build on it.</div>
        </div>
      )}

      </>}

      {watching && <BattleModal battle={watching} onClose={() => { setWatching(null); refresh(); }} />}
    </div>
  );
}

// ── compact chat-card styles (house system: CSS variables, BRAND/GREEN/RED) ──
const card = { background: 'var(--ak-surface)', border: `1px solid ${BRAND}35`, borderRadius: 14, padding: 12, display: 'grid', gap: 9, width: 'min(560px, 100%)' };
const caption = { fontSize: 10.5, color: 'var(--ak-text-muted)', fontWeight: 650, lineHeight: 1.45 };
const primary = { border: 0, borderRadius: 10, padding: '9px 12px', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', fontWeight: 850, fontSize: 11.5, cursor: 'pointer' };
const secondary = { border: '1px solid var(--ak-border2)', borderRadius: 10, padding: '8px 12px', background: 'var(--ak-surface-hover)', color: 'var(--ak-text-sub)', fontWeight: 800, fontSize: 11.5, cursor: 'pointer' };
const errorBox = { padding: '8px 10px', borderRadius: 9, background: `${RED}12`, color: RED, border: `1px solid ${RED}35`, fontSize: 11.5, fontWeight: 700 };
const chip = { display: 'inline-flex', alignItems: 'center', padding: '4px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800 };
const optionStyle = { display: 'flex', gap: 7, alignItems: 'flex-start', padding: '7px 8px', border: '1px solid', borderRadius: 8, fontSize: 12, color: 'var(--ak-text-sub)', cursor: 'pointer' };
