/*
 * DecayReviewModal — a Decay Review (Grand Plan §10, Phase 8), step by step:
 * a short check on what the learner's agent still remembers → retained, or
 * quick recall questions (hints on request, scored on the server) → a retest
 * → re-teaching the agent if recall wasn't enough → the last retest. Each step
 * stays on screen in order (turns, not one card replacing another). The
 * re-teaching step is the existing decay teaching session.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import DecaySessionModal from './DecaySessionModal.jsx';
import { APP_HOME } from '../../config/target.js';

const NUNITO = "'Nunito',sans-serif";
const WAITING = ['created', 'inspecting', 'diagnostic', 'evaluating', 'decayed', 'retained', 'retest', 'adapt_strategy'];
const unwrap = (r) => r?.review || r?.data?.review || null;

function Step({ icon, title, children, tone = 'default' }) {
  const ring = tone === 'good' ? '#10B98155' : tone === 'bad' ? '#F59E0B55' : 'var(--ak-border)';
  return (
    <div style={{ padding: '12px 13px', borderRadius: 14, background: 'var(--ak-surface)', border: `1px solid ${ring}`, fontFamily: NUNITO }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)' }}>
        <Icon name={icon} size={16} color={BRAND} />{title}
      </div>
      {children && <div style={{ marginTop: 7, fontSize: 12.5, fontWeight: 650, color: 'var(--ak-text-sub)', lineHeight: 1.55 }}>{children}</div>}
    </div>
  );
}

export default function DecayReviewModal({ alert, agentProfile, onClose, onMinimize }) {
  const navigate = useNavigate();
  const [review, setReview] = useState(null);
  const [err, setErr] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [teaching, setTeaching] = useState(false);
  const started = useRef(false);
  const agentName = agentProfile?.name || 'your agent';

  // The Review tap starts (or reopens) the review; opened by its workflowId
  // (a dashboard descriptor, §13.1) it loads that review and starts nothing.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const load = alert.workflowId
      ? apiGet(`/api/adaptive/decay-reviews/${encodeURIComponent(alert.workflowId)}`)
      : apiPost('/api/adaptive/decay-reviews', { topic: alert.topic, subject: alert.subject, notificationId: alert.id });
    load.then((r) => setReview(unwrap(r))).catch((e) => setErr(e?.message || 'Could not start the review.'));
  }, [alert]);
  // While a check runs, follow it.
  useEffect(() => {
    if (!review?.workflowId || !WAITING.includes(review.state) || teaching) return undefined;
    const t = setInterval(() => apiGet(`/api/adaptive/decay-reviews/${review.workflowId}`).then((r) => setReview(unwrap(r) || review)).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [review?.workflowId, review?.state, teaching]);   // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (path, body) => {
    setBusy(true); setErr('');
    try { const r = await apiPost(`/api/adaptive/decay-reviews/${review.workflowId}/${path}`, body || {}); setReview(unwrap(r)); }
    catch (e) { setErr(e?.message || 'That did not go through.'); }
    finally { setBusy(false); }
  };
  const submit = async () => { if (!answer.trim()) return; const a = answer; setAnswer(''); await act('answer', { answer: a }); };

  // The re-teaching step: the decay teaching session, tied to this review (its end starts the last retest).
  if (teaching && review) {
    return <DecaySessionModal alert={{ ...alert, id: null }} reviewWorkflowId={review.workflowId} agentProfile={agentProfile} onMinimize={onMinimize}
      onClose={() => { setTeaching(false); apiGet(`/api/adaptive/decay-reviews/${review.workflowId}`).then((r) => setReview(unwrap(r))).catch(() => {}); }} />;
  }

  const r = review;
  const check = r?.check;
  const retest = r?.retest;
  const round = r?.retrieval?.current;
  const watch = (id) => navigate(`${APP_HOME}?tab=battles&battle=${encodeURIComponent(id)}`);
  const pct = (s) => `${Math.round((Number(s) || 0) * 100)}%`;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }} role="dialog" aria-label="Decay review">
      <div style={{ width: 'min(560px,100%)', maxHeight: '92vh', overflowY: 'auto', background: 'var(--ak-bg)', borderRadius: 18, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ak-text)', fontFamily: NUNITO }}>Review: {alert.topic || r?.topic}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ak-text-muted)', fontFamily: NUNITO }}>{alert.subject || r?.subject || ''}</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 4 }}><Icon name="ti-x" size={18} /></button>
        </div>

        {!r && !err && <Step icon="ti-loader-2" title="Starting the review…" />}
        {check && (
          <Step icon="ti-brain" title={`A short check on what ${agentName} remembers`} tone={check.score == null ? 'default' : check.score >= 0.7 ? 'good' : 'bad'}>
            {check.score == null
              ? <>Three questions, answered from what you taught. <button type="button" onClick={() => watch(check.battleId)} style={{ border: 0, background: 'transparent', color: BRAND, fontWeight: 850, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Watch it</button></>
              : <>{check.correct} of {check.total} ({pct(check.score)}) — {check.score >= 0.7 ? 'still remembered.' : 'some of it has faded.'}</>}
          </Step>
        )}
        {(r?.retrieval?.done || []).map((d, i) => (
          <Step key={i} icon="ti-bulb" title={`Recall ${i + 1}: ${d.question}`} tone={d.outcome === 'incorrect' ? 'bad' : 'good'}>
            {d.outcome === 'correct' ? 'Right.' : d.outcome === 'partial' ? 'Partly right.' : 'Not quite.'} {d.feedback} {d.outcome !== 'correct' && d.keyShown ? <><br /><strong>Answer:</strong> {d.keyShown}</> : null}
          </Step>
        ))}
        {round && r.state === 'intervention' && (
          <Step icon="ti-bulb" title={`Recall ${r.retrieval.round} of ${r.retrieval.of}: ${round.question}`}>
            {round.hints.map((h, i) => <div key={i} style={{ marginTop: 4 }}><strong>{i === 0 ? 'Hint' : 'Bigger hint'}:</strong> {h}</div>)}
            <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} placeholder="Your answer, in your own words"
              style={{ width: '100%', marginTop: 8, borderRadius: 10, border: '1px solid var(--ak-border2)', padding: 8, fontFamily: NUNITO, fontSize: 13, background: 'var(--ak-surface)', color: 'var(--ak-text)', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" disabled={busy || !answer.trim()} onClick={submit} style={{ padding: '7px 14px', borderRadius: 999, border: 'none', background: BRAND, color: '#fff', fontWeight: 900, fontSize: 12.5, cursor: 'pointer', fontFamily: NUNITO }}>{busy ? '…' : 'Answer'}</button>
              <button type="button" disabled={busy || round.hintLevel >= 2} onClick={() => act('hint')} style={{ padding: '7px 14px', borderRadius: 999, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontWeight: 900, fontSize: 12.5, cursor: 'pointer', fontFamily: NUNITO }}>{round.hintLevel === 0 ? 'Show a hint' : 'Bigger hint'}</button>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ak-text-muted)' }}>A hint lowers what a right answer counts for.</div>
          </Step>
        )}
        {retest && (
          <Step icon="ti-refresh" title={`The retest${r.retests > 1 ? ' (last one)' : ''}`} tone={retest.score == null ? 'default' : retest.score >= 0.7 ? 'good' : 'bad'}>
            {retest.score == null
              ? <>{agentName} answers again. <button type="button" onClick={() => watch(retest.battleId)} style={{ border: 0, background: 'transparent', color: BRAND, fontWeight: 850, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Watch it</button></>
              : <>{retest.correct} of {retest.total} ({pct(retest.score)}).</>}
          </Step>
        )}
        {r?.state === 'intervention' && r.teaching?.needed && (
          <Step icon="ti-school" title="Recall wasn't enough — re-teach it" tone="bad">
            Teach {agentName} {r.teaching.gaps?.length ? r.teaching.gaps.map((g) => g.toLowerCase()).join(', ') : alert.topic} again. One last retest follows when you finish.
            <div style={{ marginTop: 8 }}><button type="button" onClick={() => setTeaching(true)} style={{ padding: '7px 14px', borderRadius: 999, border: 'none', background: BRAND, color: '#fff', fontWeight: 900, fontSize: 12.5, cursor: 'pointer', fontFamily: NUNITO }}>Re-teach it</button></div>
          </Step>
        )}
        {r?.state === 'completed' && r.outcome && (
          <Step icon={r.outcome.retained ? 'ti-circle-check' : 'ti-clock'} title={r.outcome.retained ? 'Still remembered — reinforced' : 'Not retained yet'} tone={r.outcome.retained ? 'good' : 'bad'}>
            {r.outcome.retained ? 'It will fade more slowly now.' : 'What you did still counts — it comes back for review sooner.'}
            {r.outcome.nextReviewDue ? ` Next review: ${new Date(r.outcome.nextReviewDue).toLocaleDateString([], { day: 'numeric', month: 'short' })}.` : ''}
          </Step>
        )}
        {err && <div style={{ fontSize: 12, fontWeight: 800, color: '#EF4444', fontFamily: NUNITO }}>{err}</div>}
      </div>
    </div>
  );
}
