import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BRAND, GREEN, RED } from '../../../constants.js';
import BattleModal from '../../battles/BattleModal.jsx';
import { Icon } from '../../common/Icons.jsx';
import { countdownLabel, studyPrepCardHead, wakeOpen, workflowCardSteps } from '../../../lib/agentChatTrace.js';
import { cacheEvents, cachedEvents, openWorkflowStream, rememberSeen, seenSequence } from '../../../lib/workflowStream.js';
import { WorkflowHead, WorkflowSteps } from './WorkflowSteps.jsx';
import {
  adjustStudyPrepPlan, advanceStudyPrepTopic, approveMoreStudyPrepCoins, approveStudyPrepTeaching, confirmStudyPrepPlan, confirmStudyPrepTeachBack,
  concludeStudyPrepSession, deferStudyPrepTopic, fetchStudyPrepSession, generateStudyPrepPractice,
  resumeStudyPrepSession, retryStudyPrepDeferred, submitStudyPrepPractice, cancelStudyPrepSession, answerStudyPrepStrategy,
} from '../../../services/studyPrepApi.js';
import ApprovalButtons from '../agentChat/ApprovalButtons.jsx';
import { DevLine, ScoreRing } from '../agentChat/StreamCards.jsx';

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
  'topic.state_changed', 'assessment.completed', 'assessment.started', 'learner.action_received', 'decision.accepted',
  // The agent's wake ended: re-read for the next check's countdown.
  'operation.completed',
  // Phase 6: the teaching session — offered, set up, under way, finished.
  'learner.action_required', 'workflow.handoff_created', 'teaching.phase_changed', 'workflow.handoff_completed',
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
export default function StudyPrepChatCard({ sessionId, onEvents, onRunning, pinned = false, developer = false, onNotes, conversationId = null }) {
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
  // The answer to the agent's strategy offer, as the card shows it after Allow / Reject.
  const [offerDone, setOfferDone] = useState(null);
  const [dropPick, setDropPick] = useState({});
  const [order, setOrder] = useState(null);
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
      // Developer view: the planner's notes per decision — shown by the chat, outside this card.
      developer,
      onLive: (env) => { if (env?.type === 'agent.narration') onNotes?.(sessionId, env); },
    });
    return close;
  }, [workflowId, refresh, setAway, developer, onNotes, sessionId]);

  // With a workflow stream the steps are the card's own; an older API's
  // session steps still go to the chat's trace (AgentChatTab), as before.
  const events = view?.events;
  useEffect(() => {
    if (wfEvents) onEvents?.(sessionId, { v3: wfEvents });
    // An older API (no workflow) still sends its steps to the chat's trace; with a workflow they wait for the stream.
    else if (events && !workflowId) onEvents?.(sessionId, events);
  }, [sessionId, events, wfEvents, onEvents, workflowId]);

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
  // After the plan: the agent working on a wake (approve, a new topic, a marked check…) also runs.
  const waking = !!wfEvents && wakeOpen(wfEvents);
  const running = !!wfEvents && (planningNow || checkRunning || waking);

  // The next Agent Check starts by itself (a minute after its topic or the teach-back): the countdown.
  const nextCheck = view?.nextCheck || null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const counting = !!nextCheck?.at && !nextCheck.overEstimate && !checkRunning;
  useEffect(() => {
    if (!counting) return undefined;
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [counting]);
  const dueIn = counting ? Date.parse(nextCheck.at) - nowMs : null;
  // Due: the server starts it within a few seconds — re-read until it has.
  useEffect(() => {
    if (!counting || dueIn > 0) return undefined;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [counting, dueIn != null && dueIn <= 0, refresh]);
  // The server starts a due check (its sweep runs every 15 s); if it hasn't 25 s after, this card does (inside the approved coins only — counting excludes past them).
  const fallbackFor = useRef(null);
  useEffect(() => {
    if (!counting || dueIn == null || dueIn > -25000) return;
    const key = `${nextCheck.topicId}:${nextCheck.at}`;
    if (fallbackFor.current === key) return;
    fallbackFor.current = key;
    generateStudyPrepPractice(sessionId, nextCheck.topicId, nextCheck.mode).then(refresh, refresh);
  }, [counting, dueIn, nextCheck, sessionId, refresh]);
  // Phase 6: the teaching session offered after a missed check — it sets itself up after a minute.
  const teaching = view?.teaching || null;
  const offering = teaching?.state === 'proposed' && !!teaching.autoApproveAt;
  useEffect(() => {
    if (!offering) return undefined;
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [offering]);
  const offerIn = offering ? Date.parse(teaching.autoApproveAt) - nowMs : null;
  // Past its minute the server's sweep sets it up (every 15 s): re-read until it has.
  useEffect(() => {
    if (!offering || offerIn > 0) return undefined;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [offering, offerIn != null && offerIn <= 0, refresh]);
  // Pinned while the agent works, while its next check counts down, and while the teaching session waits for an OK.
  useEffect(() => { onRunning?.(sessionId, running || counting || offering); }, [sessionId, running, counting, offering, onRunning]);
  const steps = useMemo(() => workflowCardSteps(wfEvents || [], { running }), [wfEvents, running]);

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

  const confirmPlan = () => void run(() => confirmStudyPrepPlan(session.id, conversationId), (response) => {
    setView((previous) => ({ ...previous, session: response.session, topics: response.topics }));
    setAdjusting(false);
  });

  // A strategy the agent offered (Phase 4a, preview approved 2026-11-07): Allow runs it, Reject records no, Later waits.
  const offer = view.strategyOffer || null;
  const offerResult = (execution) => {
    const fx = execution?.effect || {};
    if (!execution?.executed) return execution?.operation === 'teach' ? 'Saved — it’s used in your next teaching session.' : 'Saved — I’ll use it from your next step.';
    if (execution.operation === 'schedule') return `${(fx.scheduled || []).length || 'Some'} short reviews added to your chat.`;
    if (execution.operation === 'replan') return 'Your remaining topics are re-ordered.';
    if (execution.operation === 'offline_export') return 'A summary and self-test are saved to your Records.';
    return 'Done.';
  };
  const answerOffer = (accepted) => void run(() => answerStudyPrepStrategy(session.id, offer.topicId, offer.strategy, accepted), (response) => {
    setOfferDone(accepted ? offerResult(response?.execution) : 'Okay — I won’t use that one.');
    refresh();
  });
  const offerBlock = offer && !offerDone ? (
    <div data-strategy-offer={offer.strategy} style={{ display: 'grid', gap: 6, padding: '10px 11px', borderRadius: 12, background: `${BRAND}0A`, border: `1px solid ${BRAND}30` }}>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5, fontWeight: 900, color: BRAND }}><Icon name="ti-bulb" size={15} color={BRAND}/>Try it differently: {offer.name}</div>
      <div style={{ fontSize: 12, color: 'var(--ak-text)', lineHeight: 1.45 }}>{offer.summary}</div>
      {offer.allowDoes && <div style={caption}>{offer.allowDoes}</div>}
      <ApprovalButtons onAllow={() => answerOffer(true)} onReject={() => answerOffer(false)} busy={busy} busyLabel="Working…" style={{ marginTop: 2 }}/>
    </div>
  ) : offerDone ? (
    <div data-strategy-done="" style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12, fontWeight: 800, color: '#047857', background: '#10B98114', borderRadius: 10, padding: '8px 10px' }}><Icon name="ti-circle-check" size={14} color="#047857"/>{offerDone}</div>
  ) : null;

  // Reject on the plan card ends this Study Prep before anything is spent (Allow / Reject / Later, 2026-11-06).
  const rejectPlan = () => void run(() => cancelStudyPrepSession(session.id), () => refresh());

  const planIds = (session.plan || []).map((topic) => topic.syllabusTopicId);
  const shownOrder = order || planIds;
  const move = (id, by) => {
    const list = [...shownOrder];
    const at = list.indexOf(id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= list.length) return;
    [list[at], list[to]] = [list[to], list[at]];
    setOrder(list);
  };
  const saveAdjust = () => {
    const drop = Object.keys(dropPick).filter((key) => dropPick[key]);
    const reordered = order && order.join('|') !== planIds.join('|') ? order.filter((id) => !dropPick[id]) : null;
    if (!drop.length && !reordered) { setAdjusting(false); setOrder(null); return; }
    void run(() => adjustStudyPrepPlan(session.id, drop, { order: reordered, conversationId }), (response) => {
      setView((previous) => ({ ...previous, session: response.session }));
      setAdjusting(false); setDropPick({}); setOrder(null);
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

  const teachBackDone = () => void run(() => confirmStudyPrepTeachBack(session.id, activeTopic.id, conversationId), (response) => {
    setView((previous) => ({ ...previous, topics: previous.topics.map((topic) => topic.id === response.topic.id ? response.topic : topic) }));
    refresh();
  });
  const approveTeaching = () => void run(() => approveStudyPrepTeaching(session.id, activeTopic.id, conversationId), (response) => {
    setView((previous) => ({ ...previous, teaching: response.teaching || previous.teaching }));
    refresh();
  });

  // The Agent Check runs in Battles, with its own card in the chat (and its link there): here, one tracking line.
  const checkRunningLine = (
    <div data-check-running="" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: '#FFF5F5', border: '1px solid #FECACA', fontSize: 12, fontWeight: 800, color: '#B91C1C' }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: RED, flexShrink: 0 }} />
      {shownTopic?.checkMode === 'retest' ? 'Retest running in Battles' : 'Agent Check running in Battles'}
    </div>
  );

  // Phase 6: the teaching session as the card shows it — ONE tracking line, and the OK while it waits for one.
  // Everything else (what was missed, the session's parts, the agent's report) is in the chat.
  const teachingLine = teaching && ({
    proposed: offerIn != null && offerIn > 0 ? `Teaching session offered · sets itself up in ${countdownLabel(offerIn)}` : 'Setting up your teaching session…',
    scheduled: 'Teaching session on your dashboard',
    teaching_active: teaching.progress?.of ? `Teaching · ${teaching.progress.done || 0} of ${teaching.progress.of} parts taught` : 'Teaching on your dashboard',
    adapt_strategy: teaching.progress?.of ? `Teaching · ${teaching.progress.done || 0} of ${teaching.progress.of} parts taught` : 'Teaching on your dashboard',
  })[teaching.state];
  const teachingTrack = teachingLine && activeTopic && (
    <div data-teaching-handoff={teaching.state} style={{ display: 'grid', gap: 7, padding: '8px 10px', borderRadius: 10, background: `${BRAND}0F`, border: `1px solid ${BRAND}30` }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, fontWeight: 800, color: BRAND }}>
        <Icon name={teaching.state === 'proposed' ? 'ti-clock' : 'ti-school'} size={15} color={BRAND}/>
        <span>{teachingLine}</span>
      </div>
      {teaching.progress?.of > 0 && (
        <div data-teaching-progress="" aria-hidden="true" style={{ height: 6, borderRadius: 6, background: 'var(--ak-border2)', overflow: 'hidden' }}>
          <i style={{ display: 'block', height: '100%', width: `${Math.round(100 * Math.min(1, (teaching.progress.done || 0) / teaching.progress.of))}%`, background: BRAND }}/>
        </div>
      )}
      {teaching.state === 'proposed' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} onClick={approveTeaching} style={primary}>Confirm teaching session</button>
          <button type="button" disabled={busy} onClick={teachBackDone} style={{ border: 0, background: 'transparent', color: 'var(--ak-text-muted)', fontWeight: 800, fontSize: 11, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>I taught it elsewhere</button>
        </div>
      )}
    </div>
  );

  // Past the approved coins nothing runs by itself — not a check, not the agent's turn: the learner approves more first.
  const coins = view.coins || null;
  const outOfCoins = agentMode && session.status === 'topic_active' && !!coins && (coins.wakeDecisions < 1 || !!nextCheck?.overEstimate);
  const approveMore = () => void run(() => approveMoreStudyPrepCoins(session.id, conversationId), () => refresh());
  const coinsAsk = outOfCoins && (
    <div data-over-estimate="" style={{ display: 'grid', gap: 6, padding: '8px 10px', borderRadius: 10, background: '#FFF7ED', border: '1px solid #F59E0B55' }}>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12, fontWeight: 800, color: '#B45309' }}>
        <Icon name="ti-coin" size={15} color="#B45309"/> You've used {coins.spent} of the {coins.approved} coins you approved.
      </div>
      <div style={caption}>The agent's turns and the Agent Checks stop here until you say so — nothing goes past what you approved.</div>
      <div><button type="button" disabled={busy} onClick={approveMore} style={primary}>Approve 10 more coins</button></div>
    </div>
  );

  // The next check, as the card offers it: a countdown with Start now (past the approved coins, the ask above instead).
  const checkStarter = (fallback) => {
    if (!agentMode || !nextCheck || nextCheck.topicId !== activeTopic?.id) return fallback;
    if (nextCheck.overEstimate) return coinsAsk || fallback;
    return (
      <div data-auto-start="" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: `${BRAND}0F`, border: `1px solid ${BRAND}30` }}>
        <Icon name="ti-clock" size={15} color={BRAND}/>
        <span style={{ fontSize: 12, fontWeight: 800, color: BRAND }}>
          {dueIn != null && dueIn > 0 ? `Agent Check starts in ${countdownLabel(dueIn)}` : 'Starting the Agent Check…'} · {nextCheck.coins ?? 2} coins
        </span>
        <button type="button" disabled={busy} onClick={() => generate(nextCheck.mode)} style={{ ...primary, marginLeft: 'auto', padding: '7px 11px' }}>Start now</button>
      </div>
    );
  };

  const advance = () => void run(() => advanceStudyPrepTopic(session.id, conversationId), (response) => {
    setView((previous) => ({ ...previous, topics: previous.topics.map((topic) => topic.id === response.topic.id ? response.topic : topic) }));
    setResult(null); setAttempt(null); setNoNotes(false);
  });

  const defer = () => void run(() => deferStudyPrepTopic(session.id, shownTopic?.id, 'attempt_cap_reached'), () => { setResult(null); refresh(); });
  const retryDeferred = (topicId) => void run(() => retryStudyPrepDeferred(session.id, topicId), refresh);
  const conclude = () => void run(() => concludeStudyPrepSession(session.id), (response) => setView((previous) => ({ ...previous, session: response.session })));
  const resume = () => void run(() => resumeStudyPrepSession(session.id), (response) => setView((previous) => ({ ...previous, session: response.session })));

  return (
    <div style={{ ...card, marginTop: 6, maxWidth: '100%' }}>
      {wfEvents || workflowId ? <WorkflowHead head={head} subject={session.subject}/> : (
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
      {offerBlock}
      {developer && <DevLine parts={['study_prep', session.status, workflowId ? `wf ${String(workflowId).slice(0, 8)}` : null, wfEvents?.length ? `seq ${wfEvents[wfEvents.length - 1]?.sequence ?? wfEvents.length}` : null, activeTopic?.label || null, coins ? `coins ${coins.spent}/${coins.approved}` : null]}/>}

      {/* Pinned (running): the head and the latest steps only — the full card is back at its message once it settles. */}
      {pinned ? (checkLive ? (wfEvents ? checkRunningLine : <button type="button" onClick={watch} style={primary}>Watch the Agent Check</button>) : (counting ? checkStarter(null) : (teachingTrack || coinsAsk))) : <>

      {/* ── the plan card: Allow / Reject / Later (the only spend gate); "Change the plan first" adjusts ── */}
      {/* With a workflow, an empty plan isn't shown while it plans — the steps above are the progress. */}
      {(session.status === 'awaiting_confirmation' || (session.status === 'planning' && (!workflowId || session.plan?.length > 0))) && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ textAlign: 'center', display: 'grid', gap: 2, padding: '4px 0' }}>
            <div style={{ fontSize: 13.5, fontWeight: 900, letterSpacing: 1, color: 'var(--ak-text)' }}>YOUR {session.subject.toUpperCase()} PLAN</div>
            <div style={caption}>{(session.plan || []).length} topics{estimate ? ` · estimated cost: ${estimate.totalCoins} coins` : ''}</div>
          </div>
          {/* No real syllabus for this class + subject: the plan is made from an AI-drafted outline (§8.7). Always said. */}
          {session.syllabusLabel && (
            <div role="note" style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, fontWeight: 700, lineHeight: 1.45, color: 'var(--ak-text-sub)', padding: '7px 10px', borderRadius: 9, background: 'var(--ak-surface2, rgba(124,58,237,.06))', border: '1px solid var(--ak-border2)' }}>
              <span className={`ti ${session.syllabusLabelKind === 'documents' ? 'ti-folder' : 'ti-info-circle'}`} aria-hidden="true" style={{ fontSize: 14, marginTop: 1 }} />
              <span>{session.syllabusLabel}</span>
            </div>
          )}
          {!adjusting ? (
            <>
              <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 5 }}>
                {(session.plan || []).map((topic) => <li key={topic.syllabusTopicId} style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-sub)' }}>{topic.label}</li>)}
              </ol>
              {session.status === 'awaiting_confirmation' && (
                <div data-plan-decision="" style={{ display: 'grid', gap: 2 }}>
                  <ApprovalButtons onAllow={confirmPlan} onReject={rejectPlan} busy={busy} busyLabel="Starting…" />
                  <button type="button" disabled={busy} onClick={() => setAdjusting(true)} style={{ justifySelf: 'start', border: 0, background: 'transparent', color: BRAND, fontWeight: 800, fontSize: 11.5, cursor: 'pointer', padding: '4px 0', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="ti-adjustments" size={13} color={BRAND}/>Change the plan first</button>
                </div>
              )}
              {session.status === 'planning' && !workflowId && <div style={caption}>The agent is still planning…</div>}
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 5 }}>
                <div style={caption}>Tick a topic to drop it; the arrows change the order (it's checked again).</div>
                {shownOrder.map((id, index) => {
                  const topic = (session.plan || []).find((t) => t.syllabusTopicId === id);
                  if (!topic) return null;
                  return (
                    <div key={id} data-adjust-topic={id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--ak-text-sub)', fontWeight: 700, padding: '6px 9px', border: '1px solid var(--ak-border2)', borderRadius: 9 }}>
                      <input type="checkbox" aria-label={`Drop ${topic.label}`} checked={!!dropPick[id]} onChange={(event) => setDropPick({ ...dropPick, [id]: event.target.checked })} />
                      <span style={{ flex: 1, textDecoration: dropPick[id] ? 'line-through' : 'none' }}>{index + 1}. {topic.label}</span>
                      <button type="button" aria-label={`Move ${topic.label} up`} disabled={index === 0} onClick={() => move(id, -1)} style={arrow}><Icon name="ti-chevron-up" size={14}/></button>
                      <button type="button" aria-label={`Move ${topic.label} down`} disabled={index === shownOrder.length - 1} onClick={() => move(id, 1)} style={arrow}><Icon name="ti-chevron-down" size={14}/></button>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" disabled={busy} onClick={saveAdjust} style={primary}>Save adjustment</button>
                <button type="button" onClick={() => { setAdjusting(false); setDropPick({}); setOrder(null); }} style={secondary}>Cancel</button>
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

          {outOfCoins && !nextCheck?.overEstimate && coinsAsk}
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
                      <div style={caption}>{(noNotes || shownTopic.checkMode === 'skipped')
                        ? `Your agent has no notes on ${shownTopic.label} yet, so there's nothing to check. Teach it first — nothing was charged.`
                        : 'Your agent is checked first: your teaching guide asks, your agent answers only from what you taught it, and Sergeant judges every answer.'}</div>
                      {checkStarter(<div><button type="button" disabled={busy} onClick={() => generate('diagnostic')} style={primary}>Start Agent Check (2 coins)</button></div>)}
                    </>
                  )}
                </div>
              )}

              {checkLive && wfEvents && checkRunningLine}
              {checkLive && !wfEvents && (
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
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <ScoreRing score={shownResult.score} correct={shownResult.correct} total={shownResult.total} passed={shownResult.passed} />
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
                  {shownResult.outcome === 'retest_offered' && !shownTopic.learnerConfirmedReady && teachingTrack}
                  {shownResult.outcome === 'retest_offered' && !shownTopic.learnerConfirmedReady && !teachingTrack && (
                    <div style={{ display: 'grid', gap: 6, padding: '8px 9px', border: '1px dashed var(--ak-border2)', borderRadius: 9 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--ak-text)' }}>Teach it back</div>
                      <div style={caption}>Explain {shownTopic.label} in your own words — out loud or in writing. It is retrieval practice for you; the retest unlocks only when YOU confirm.</div>
                      <div><button type="button" disabled={busy} onClick={teachBackDone} style={primary}>I've taught it back — unlock retest</button></div>
                    </div>
                  )}
                  {shownTopic.learnerConfirmedReady && !attempt && shownResult.outcome === 'retest_offered' && checkStarter(
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
const arrow = { border: '1px solid var(--ak-border2)', borderRadius: 7, background: 'var(--ak-surface)', color: 'var(--ak-text-sub)', padding: '3px 5px', cursor: 'pointer', display: 'flex' };
const chip = { display: 'inline-flex', alignItems: 'center', padding: '4px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800 };
const optionStyle = { display: 'flex', gap: 7, alignItems: 'flex-start', padding: '7px 8px', border: '1px solid', borderRadius: 8, fontSize: 12, color: 'var(--ak-text-sub)', cursor: 'pointer' };
