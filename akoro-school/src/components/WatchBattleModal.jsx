/**
 * WatchBattleModal — watch a battle as it runs.
 *
 * Teachers could create battles and, since the participants drawer, see who
 * accepted — but the thing itself was invisible to them. A battle ran for
 * fifteen minutes in a room they could not enter, and all they ever saw was the
 * result afterwards.
 *
 * This is deliberately NOT the learner's BattleModal. A learner is in the
 * fight: they pick answers, their HP drops, the clock is theirs. A teacher is
 * watching one — so there is no answer input, and instead the things a teacher
 * actually wants: the standings, what each agent chose on the question just
 * revealed, and a running commentary.
 *
 * Everything is driven by the same engine the learner app watches:
 *   sockets — battle:started / battle:question / battle:state /
 *             battle:reveal  / battle:log      / battle:over
 *   REST    — GET /battles/:id/state | log | results
 *
 * REST first, then sockets: opening this mid-battle must show the current
 * standings immediately rather than an empty box until the next event fires.
 */
import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { apiGet, apiPost } from '../services/api.js';
import { socketOptions } from '../client/socket';
import { WS_URL } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';
import { GREEN, PURPLE, BLUE, RED } from '../constants.js';
import { confirmDialog } from './ConfirmHost.jsx';

const B = '/api/battle';

const mapP = (p) => ({
  userId:     p.user_id ?? p.userId,
  agentName:  p.user_agents?.agent_name  ?? p.agentName  ?? 'Agent',
  agentEmoji: p.user_agents?.agent_emoji ?? p.agentEmoji ?? '🤖',
  agentColor: p.user_agents?.agent_color ?? p.agentColor ?? PURPLE,
  score:      p.score ?? 0,
  hp:         p.hp ?? 100,
  streak:     p.current_streak ?? p.streak ?? 0,
  role:       p.role ?? null,
});

export default function WatchBattleModal({ battle, onClose, onEnded }) {
  const battleId = battle?.id;

  const [status,   setStatus]   = useState(battle?.status ?? 'lobby');
  const [people,   setPeople]   = useState([]);
  const [question, setQuestion] = useState(null);
  const [reveal,   setReveal]   = useState(null);
  const [log,      setLog]      = useState([]);
  const [over,     setOver]     = useState(null);
  const [viewers,  setViewers]  = useState(0);
  const [error,    setError]    = useState(null);
  const [ending,   setEnding]   = useState(false);

  const logBox = useRef(null);
  const push = (msg, ts) => setLog((prev) => [
    ...prev.slice(-120),
    { msg, ts: ts || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
  ]);

  // ── Snapshot ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!battleId) return;
    let live = true;
    (async () => {
      const [st, lg] = await Promise.all([
        apiGet(`${B}/battles/${battleId}/state`).catch((e) => { setError(e.message); return null; }),
        apiGet(`${B}/battles/${battleId}/log`).catch(() => null),
      ]);
      if (!live) return;
      if (st) {
        setStatus(st.status ?? 'lobby');
        setPeople((st.participants ?? []).map(mapP));
        setViewers(st.viewer_count ?? 0);
      }
      // `logs`, which is what the route returns — not `log`.
      const rows = lg?.logs ?? [];
      if (Array.isArray(rows)) {
        setLog(rows.slice(-120).map((e) => ({
          msg: e.message,
          ts: new Date(e.created_at ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        })));
      }
    })();
    return () => { live = false; };
  }, [battleId]);

  /**
   * Final standings, once it is done.
   *
   * The socket's battle:over and the REST /results do NOT agree on shape —
   * battle:over sends {winner:{agentEmoji}, durationFormatted}, /results sends
   * {winner:{…no emoji}, battle:{duration_formatted}, scoreboard}. Reading one
   * shape rendered the other half-blank, and which you got depended on whether
   * you had the modal open when it finished. Normalise here, once.
   */
  useEffect(() => {
    if (!battleId || status !== 'completed' || over) return;
    apiGet(`${B}/battles/${battleId}/results`)
      .then((r) => setOver({
        // null when there is none: every agent knocked out, a team tie, or a review.
        winner: r.winner ? {
          ...r.winner,
          agentEmoji: r.winner?.agentEmoji
            ?? r.scoreboard?.find((p) => p.userId === r.winner?.userId)?.agentEmoji
            ?? 'trophy',
        } : null,
        durationFormatted: r.durationFormatted ?? r.battle?.duration_formatted ?? null,
        finalScores: r.scoreboard ?? [],
        verdict: r.judge?.verdict ?? null,
        // A review answers with a mark sheet, not a scoreboard.
        review: r.type === 'review' ? { correct: r.score?.correct ?? 0, total: r.score?.total ?? 0, percent: r.score?.percent ?? 0, learner: r.learner?.fullName || r.learner?.agentName || null } : null,
      }))
      .catch(() => {});
  }, [battleId, status, over]);

  // ── Live ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!battleId) return;
    const s = io(WS_URL, socketOptions({ portal: 'school' }));
    const join = () => s.emit('join-battle', battleId);
    s.on('connect', join);
    join();

    s.on('battle:started', (d) => {
      setStatus('live');
      setPeople((d.participants ?? []).map(mapP));
      push('Battle started');
    });
    s.on('battle:question',  (q) => { setQuestion(q); setReveal(null); });
    s.on('battle:state',     (d) => setPeople((d.participants ?? []).map(mapP)));
    s.on('battle:reveal',    (d) => setReveal(d));
    // Sergeant, the platform's judge, gives the verdict a moment after the end.
    s.on('battle:verdict',   (d) => setOver((o) => (o ? { ...o, verdict: d?.verdict ?? null } : o)));
    s.on('battle:log',       (e) => push(e.message, e.timestamp));
    s.on('battle:over',      (d) => { setOver(d); setStatus('completed'); push('Battle complete'); });
    s.on('battle:cancelled', () => { setStatus('cancelled'); push('Battle cancelled — not enough players accepted'); });
    s.on('viewer:count',     (d) => setViewers(d?.count ?? 0));

    return () => { try { s.emit('leave-battle', battleId); s.disconnect(); } catch { /* already gone */ } };
  }, [battleId]);

  // A dropped socket event must not leave a teacher staring at a stale board,
  // so re-read the standings while it is running.
  useEffect(() => {
    if (status !== 'live' || !battleId) return;
    const id = setInterval(async () => {
      const st = await apiGet(`${B}/battles/${battleId}/state`).catch(() => null);
      if (!st) return;
      setPeople((st.participants ?? []).map(mapP));
      setViewers(st.viewer_count ?? 0);
      if (st.status !== 'live') setStatus(st.status);
    }, 12000);
    return () => clearInterval(id);
  }, [status, battleId]);

  useEffect(() => { if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight; }, [log]);

  const endNow = async () => {
    if (!await confirmDialog({
      title: 'End this battle now?',
      message: 'Scores are kept and the results are published as they stand.',
      confirmLabel: 'End battle', danger: true,
    })) return;
    setEnding(true);
    try {
      await apiPost(`${B}/battles/${battleId}/end`, {});
      push('Ended by you');
      onEnded?.();
    } catch (e) { setError(e.message); }
    finally { setEnding(false); }
  };

  if (!battleId) return null;

  // The hosting teacher is in the room, not in the standings.
  const ranked  = [...people].filter((p) => p.role !== 'teacher').sort((a, b) => b.score - a.score || b.hp - a.hp);
  const leader  = ranked[0]?.score ?? 0;
  const isLive  = status === 'live';
  const waiting = ['lobby', 'scheduled'].includes(status);

  // What each agent picked on the question just revealed. This is the teaching
  // signal — "eleven of them chose B" says more than any final score.
  const picks = reveal?.answers ?? [];

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(10,10,20,.55)', backdropFilter: 'blur(3px)' }} />
      <div style={{
        position: 'fixed', zIndex: 3001, top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 'min(880px, 94vw)', maxHeight: '90vh', overflowY: 'auto',
        background: C.surface, borderRadius: 18, boxShadow: '0 24px 60px rgba(0,0,0,.24)', fontFamily: C.font,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px',
          borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.surface, zIndex: 1,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>{battle.title}</div>
            <div style={{ fontSize: 11.5, color: C.muted }}>
              {battle.subject || battle.topic}
              {battle.totalQuestions ? ` · ${battle.totalQuestions} questions` : ''}
              {viewers ? ` · ${viewers} watching` : ''}
            </div>
          </div>
          {isLive && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, background: '#FEE2E2',
              color: RED, fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 20,
            }}>
              <Ico ti="ti-radio" size={11} /> LIVE
            </span>
          )}
          {isLive && battle.mine && (
            <button onClick={endNow} disabled={ending} title="End the battle now"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.border}`,
                background: C.surface, color: RED, fontSize: 11.5, fontWeight: 700, padding: '5px 11px',
                borderRadius: 8, cursor: ending ? 'default' : 'pointer', opacity: ending ? 0.6 : 1,
              }}>
              <Ico ti="ti-square" size={11} /> {ending ? 'Ending…' : 'End now'}
            </button>
          )}
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.muted, padding: 4 }}>
            <Ico ti="ti-x" size={18} />
          </button>
        </div>

        {error && (
          <div style={{ margin: '14px 20px 0', padding: '10px 12px', borderRadius: 10, background: '#FEE2E2', color: RED, fontSize: 12.5 }}>
            {error}
          </div>
        )}

        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 18 }}>
          {/* ── Standings ─────────────────────────────────────────────── */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 9, letterSpacing: .3 }}>
              <Ico ti="ti-users" size={11} style={{ marginRight: 4, verticalAlign: -1 }} />STANDINGS
            </div>
            {ranked.length === 0 ? (
              <div style={{ fontSize: 12.5, color: C.muted }}>
                {waiting ? 'Waiting for learners to accept — nobody is in yet.' : 'No participants.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {ranked.map((p, i) => (
                  <div key={p.userId} style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px',
                    border: `1px solid ${i === 0 && leader > 0 ? C.brand : C.border}`, borderRadius: 10,
                    background: i === 0 && leader > 0 ? '#FFFBEB' : C.surface,
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: C.muted, width: 16 }}>{i + 1}</span>
                    <span style={{ fontSize: 17 }}>{(() => { const ti = p.agentEmoji === '🏆' ? 'ti-trophy' : 'ti-users'; return <Ico ti={ti} size={16} color={p.agentColor || C.brand} />; })()}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{p.agentName}</div>
                      {/* HP is the learner-facing health bar; for a teacher it
                          reads as "still standing", which is what matters. */}
                      <div style={{ height: 4, borderRadius: 4, background: C.bg, marginTop: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(0, Math.min(100, p.hp))}%`, height: '100%', background: p.hp > 40 ? GREEN : RED }} />
                      </div>
                    </div>
                    {p.streak > 1 && <span style={{ fontSize: 10.5, fontWeight: 700, color: C.brand, display: 'inline-flex', alignItems: 'center', gap: 2 }}><Ico ti="ti-flame" size={11} color={C.brand} />{p.streak}</span>}
                    <span style={{ fontSize: 13, fontWeight: 900, color: p.agentColor }}>{p.score}</span>
                  </div>
                ))}
              </div>
            )}

            {over && (
              <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: '#FFFBEB', border: `1px solid ${tint(27)}` }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: C.brand, marginBottom: 6 }}>
                  <Ico ti="ti-trophy" size={11} style={{ marginRight: 4, verticalAlign: -1 }} />RESULT
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>
                  {over.review
                    ? `${over.review.learner ? `${over.review.learner}: ` : ''}${over.review.correct} of ${over.review.total} correct (${over.review.percent}%)`
                    : over.reviewScore
                    ? `${over.reviewScore.correct} of ${over.reviewScore.total} correct`
                    : over.winner?.agentName
                    ? `${over.winner.agentEmoji ?? ''} ${over.winner.agentName} won with ${over.winner.score ?? 0}`
                    : over.team
                    ? (over.team.winner ? `Team ${over.team.winner} won` : 'The teams tied')
                    : 'No winner — every agent ran out of HP'}
                </div>
                {over.durationFormatted && (
                  <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>Lasted {over.durationFormatted}</div>
                )}
                {over.verdict && (
                  <div style={{ fontSize: 12, color: C.ink, marginTop: 8, lineHeight: 1.5 }}>
                    <Ico ti="ti-gavel" size={11} style={{ marginRight: 4, verticalAlign: -1, color: C.brand }} /><b>Sergeant's verdict:</b> {over.verdict}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── The question, and what they made of it ────────────────── */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 9, letterSpacing: .3 }}>CURRENT QUESTION</div>
            {!question ? (
              <div style={{ fontSize: 12.5, color: C.muted, padding: '10px 0' }}>
                {waiting ? 'Not started yet.' : status === 'completed' ? 'Finished.' : 'Waiting for the next question…'}
              </div>
            ) : (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 13 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: PURPLE, marginBottom: 5 }}>
                  Q{question.questionOrder}{question.topic ? ` · ${question.topic}` : ''}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, lineHeight: 1.45, marginBottom: 10 }}>
                  {question.questionText}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {(question.options ?? []).map((opt, ix) => {
                    // Only after the reveal — before it, the teacher's screen
                    // could be over a learner's shoulder.
                    const isRight = reveal && reveal.questionOrder === question.questionOrder && reveal.correctIndex === ix;
                    const chose   = reveal && reveal.questionOrder === question.questionOrder
                      ? picks.filter((a) => a.selectedIndex === ix).length : 0;
                    return (
                      <div key={ix} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 9,
                        border: `1px solid ${isRight ? GREEN : C.border}`,
                        background: isRight ? '#DCFCE7' : C.surface,
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: isRight ? GREEN : C.muted }}>
                          {String.fromCharCode(65 + ix)}
                        </span>
                        <span style={{ flex: 1, fontSize: 12, color: C.ink }}>{opt}</span>
                        {chose > 0 && (
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: isRight ? GREEN : C.muted }}>{chose}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {reveal?.judge && reveal.questionOrder === question.questionOrder && (
                  <div style={{ marginTop: 9, fontSize: 11.5, color: C.ink, lineHeight: 1.45 }}>
                    <Ico ti="ti-gavel" size={11} style={{ marginRight: 4, verticalAlign: -1, color: C.brand }} /><b>Sergeant:</b> {reveal.judge.answer}{reveal.judge.why ? ` — ${reveal.judge.why}` : ''}
                  </div>
                )}
              </div>
            )}

            <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, margin: '16px 0 8px', letterSpacing: .3 }}>COMMENTARY</div>
            <div ref={logBox} style={{
              height: 168, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 12,
              padding: 11, background: C.bg, display: 'flex', flexDirection: 'column', gap: 5,
            }}>
              {log.length === 0
                ? <div style={{ fontSize: 12, color: C.muted }}>Nothing yet.</div>
                : log.map((l, i) => (
                    <div key={i} style={{ fontSize: 11.5, color: C.ink, lineHeight: 1.4 }}>
                      <span style={{ color: C.muted, marginRight: 6 }}>{l.ts}</span>{l.msg}
                    </div>
                  ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
