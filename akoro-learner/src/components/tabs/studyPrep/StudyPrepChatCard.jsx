import { useCallback, useEffect, useState } from 'react';

import { BRAND, GREEN, RED } from '../../../constants.js';
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
const TOPIC_STATUS_LABEL = {
  queued: 'queued', active: 'active', understood: 'understood',
  flagged_gap: 'gap flagged', capped_out: 'capped out', deferred: 'deferred',
};

export default function StudyPrepChatCard({ sessionId }) {
  const [view, setView] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [dropPick, setDropPick] = useState({});

  useEffect(() => {
    let cancelled = false;
    fetchStudyPrepSession(sessionId)
      .then((response) => { if (!cancelled && response?.session) setView(response); })
      .catch(() => { if (!cancelled) setError('This study session could not be loaded.'); });
    return () => { cancelled = true; };
  }, [sessionId]);

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

  if (!view) {
    return (
      <div style={{ ...card, padding: 12, marginTop: 6 }}>
        <div style={caption}>Loading your study session…</div>
        {error && <div style={{ ...caption, color: RED }}>{error}</div>}
      </div>
    );
  }

  const session = view.session;
  const topics = view.topics || [];
  const events = view.events || [];
  const activeTopic = topics.find((topic) => topic.status === 'active') || null;
  const estimate = session.estimate;

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
    setResult(null); setAttempt(null);
  });

  const defer = () => void run(() => deferStudyPrepTopic(session.id, activeTopic?.id, 'attempt_cap_reached'), () => { setResult(null); refresh(); });
  const retryDeferred = (topicId) => void run(() => retryStudyPrepDeferred(session.id, topicId), refresh);
  const conclude = () => void run(() => concludeStudyPrepSession(session.id), (response) => setView((previous) => ({ ...previous, session: response.session })));
  const resume = () => void run(() => resumeStudyPrepSession(session.id), (response) => setView((previous) => ({ ...previous, session: response.session })));

  return (
    <div style={{ ...card, marginTop: 6, maxWidth: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--ak-text)' }}>🎯 Study Prep · {session.subject}</div>
        <div style={caption}>{session.status.replace(/_/g, ' ')}</div>
      </div>
      {error && <div role="alert" style={errorBox}>{error}</div>}

      {/* ── the plan card: Approve & Start / Adjust (the only spend gate) ── */}
      {['planning', 'awaiting_confirmation'].includes(session.status) && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ textAlign: 'center', display: 'grid', gap: 2, padding: '4px 0' }}>
            <div style={{ fontSize: 13.5, fontWeight: 900, letterSpacing: 1, color: 'var(--ak-text)' }}>YOUR {session.subject.toUpperCase()} PLAN</div>
            <div style={caption}>{(session.plan || []).length} topics{estimate ? ` · estimated cost: ${estimate.totalCoins} coins` : ''}</div>
          </div>
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

          {activeTopic && (
            <div style={{ display: 'grid', gap: 8, padding: '9px 10px', border: '1px solid var(--ak-border2)', borderRadius: 11, background: 'var(--ak-surface-hover)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)' }}>{activeTopic.label}</div>
                <div style={caption}>{activeTopic.learnerConfirmedReady ? 'teach-back confirmed' : `attempt ${activeTopic.attemptsUsed}`}</div>
              </div>

              {!attempt && !result && (
                <div style={{ display: 'grid', gap: 7 }}>
                  <div style={caption}>A short diagnostic comes first — it shows what you already know.</div>
                  <div><button type="button" disabled={busy} onClick={() => generate('diagnostic')} style={primary}>Start diagnostic (2 coins)</button></div>
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

              {result && (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 22, fontWeight: 900, color: result.passed ? GREEN : RED }}>{Math.round((result.score || 0) * 100)}%</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ak-text)' }}>{result.correct} of {result.total} correct</span>
                  </div>
                  <div style={caption}>{result.passed ? 'Threshold reached — topic understood.' : result.outcome === 'capped_out' ? 'Attempt cap reached.' : 'Below the pass mark — teach it back, then take a fresh retest.'}</div>
                  {result.outcome === 'retest_offered' && !activeTopic.learnerConfirmedReady && (
                    <div style={{ display: 'grid', gap: 6, padding: '8px 9px', border: '1px dashed var(--ak-border2)', borderRadius: 9 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--ak-text)' }}>Teach it back</div>
                      <div style={caption}>Explain {activeTopic.label} in your own words — out loud or in writing. It is retrieval practice for you; the retest unlocks only when YOU confirm.</div>
                      <div><button type="button" disabled={busy} onClick={teachBackDone} style={primary}>I've taught it back — unlock retest</button></div>
                    </div>
                  )}
                  {activeTopic.learnerConfirmedReady && !attempt && result.outcome === 'retest_offered' && (
                    <div><button type="button" disabled={busy} onClick={() => generate('retest')} style={primary}>Start fresh retest (2 coins)</button></div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {result.outcome === 'understood' && <button type="button" disabled={busy} onClick={advance} style={primary}>Next topic</button>}
                    {result.outcome === 'capped_out' && <button type="button" disabled={busy} onClick={defer} style={secondary}>Defer this topic</button>}
                    {['understood', 'capped_out'].includes(result.outcome) && <button type="button" disabled={busy} onClick={conclude} style={secondary}>Conclude session</button>}
                  </div>
                </div>
              )}
            </div>
          )}

          {!activeTopic && (
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
          <div style={{ fontSize: 12.5, fontWeight: 900, color: 'var(--ak-text)' }}>{session.status === 'completed' ? 'Session complete 🎉' : 'Session ended'}</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {topics.map((topic) => {
              const style = TOPIC_STATUS_STYLE[topic.status] || TOPIC_STATUS_STYLE.queued;
              return <span key={topic.id} style={{ ...chip, background: style.background, color: style.color, border: `1px solid ${style.border}` }}>{topic.label} · {TOPIC_STATUS_LABEL[topic.status] || topic.status}</span>;
            })}
          </div>
          <div style={caption}>Understanding is recorded from your attempts — future sessions and your teacher's gap report build on it.</div>
        </div>
      )}

      {/* ── the activity log: replay only, honest pacing ───────────────── */}
      {events.length > 0 && (
        <details style={{ marginTop: 2 }}>
          <summary style={{ ...caption, cursor: 'pointer', fontWeight: 800 }}>Activity ({events.length})</summary>
          <div style={{ display: 'grid', gap: 6, marginTop: 7, maxHeight: 220, overflowY: 'auto' }}>
            {[...events].reverse().map((event) => (
              <div key={event.sequence} style={{ display: 'grid', gap: 1 }}>
                {event.agentIntent && (
                  <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--ak-text-muted)', fontWeight: 500 }}>
                    agent says: {event.agentIntent}
                    {event.durationMs != null && <span style={{ marginLeft: 5, opacity: 0.7 }}>({event.durationMs} ms)</span>}
                  </div>
                )}
                {event.narrative && (
                  <div style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--ak-text-sub)', lineHeight: 1.45 }}>
                    {event.eventType === 'harness_decision' ? '✓ ' : event.eventType === 'engine_result' ? '📊 ' : event.eventType === 'human_gate' ? '👤 ' : ''}{event.narrative}
                  </div>
                )}
                {!event.narrative && !event.agentIntent && (
                  <div style={{ fontSize: 10.5, color: 'var(--ak-text-muted)' }}>{event.eventType}{event.tool ? ` · ${event.tool}` : ''}{event.action ? ` · ${event.action}` : ''}</div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
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
