/**
 * BattleModal — real-time battle arena.
 * ─────────────────────────────────────────────────────────────
 * Driven entirely by the backend battle engine (BullMQ worker + socket.io):
 *   · joins the `battle:<id>` room and renders server events
 *       battle:started / battle:question / battle:state / battle:reveal /
 *       battle:log / battle:over
 *   · submits answers via POST /api/battle/battles/:id/answer
 *   · shows the final scoreboard from GET /api/battle/battles/:id/results
 * No local simulation — scores, HP, XP and the winner all come from the server.
 */
import { useState, useEffect, useRef } from 'react';
import { RED, GREEN, GOLD } from '../../constants.js';
import { API, apiGet, apiPost } from '../../services/api.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { XIcon, FlameIcon, TrophyIcon, UsersIcon } from '../common/Icons.jsx';
import { LiveBadge } from '../common/ProgressBar.jsx';

const B = '/api/battle';
const FONT = "'Nunito', sans-serif";

const mapStateP = (p) => ({
  userId: p.user_id ?? p.userId,
  agentName: p.user_agents?.agent_name ?? p.agentName ?? 'Agent',
  agentEmoji: p.user_agents?.agent_emoji ?? p.agentEmoji ?? '🤖',
  agentColor: p.user_agents?.agent_color ?? p.agentColor ?? '#7C3AED',
  score: p.score ?? 0, hp: p.hp ?? 100, streak: p.current_streak ?? p.streak ?? 0,
});

export default function BattleModal({ battle: initialBattle, onClose }) {
  const { user } = useAuth();
  const myId = user?.id;
  const battleId = initialBattle?.id;

  const [status,       setStatus]       = useState(initialBattle?.status || 'scheduled');
  const [participants, setParticipants] = useState([]);
  const [question,     setQuestion]     = useState(null);
  const [reveal,       setReveal]       = useState(null);
  const [selected,     setSelected]     = useState(null);
  const [answering,    setAnswering]    = useState(false);
  const [myResult,     setMyResult]     = useState(null);
  const [timer,        setTimer]        = useState(0);
  const [log,          setLog]          = useState([]);
  const [over,         setOver]         = useState(null);
  const [results,      setResults]      = useState(null);
  const [tab,          setTab]          = useState('watch');
  const [notice,       setNotice]       = useState(null);

  const qStartRef = useRef(0);
  const logRef    = useRef(null);

  const pushLog = (msg, ts) => setLog((prev) => [...prev.slice(-80), { msg, ts: ts || new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }]);

  // Initial snapshot + reconnect recovery: pull state, past log, and (for a
  // live battle) the current question so a mid-battle refresh restores the view
  // instead of showing a blank arena until the next socket tick.
  useEffect(() => {
    if (!battleId) return;
    let alive = true;
    (async () => {
      const [st, qd, lg] = await Promise.all([
        apiGet(`${B}/battles/${battleId}/state`).catch(() => null),
        apiGet(`${B}/battles/${battleId}/questions`).catch(() => null),
        apiGet(`${B}/battles/${battleId}/log`).catch(() => null),
      ]);
      if (!alive) return;
      if (st) { setStatus(st.status); setParticipants((st.participants || []).map(mapStateP)); }
      if (lg?.logs?.length) {
        setLog(lg.logs.map((e) => ({ msg: e.message, ts: e.created_at ? new Date(e.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '' })));
      }
      if (st?.status === 'live' && qd?.questions?.length) {
        const active = qd.questions.find((q) => q.correctAnswerIndex == null); // not yet revealed
        if (active) {
          setQuestion((prev) => prev || {
            questionOrder: active.questionOrder, questionText: active.questionText,
            options: active.options, topic: active.topic, xpValue: active.xpValue, timeLimitMs: 15000,
          });
          qStartRef.current = Date.now();
          if (active.myAnswer != null) { setSelected(active.myAnswer); setMyResult({ is_correct: active.isCorrect, xp_gained: active.xpGained || 0 }); }
        }
      }
    })();
    return () => { alive = false; };
  }, [battleId]);

  // Completed → final scoreboard.
  useEffect(() => {
    if (status !== 'completed' || !battleId) return;
    apiGet(`${B}/battles/${battleId}/results`).then(setResults).catch(() => {});
  }, [status, battleId]);

  // Live socket wiring.
  useEffect(() => {
    if (!battleId || typeof window === 'undefined' || !window.io) return;
    const s = window.io(API, { transports: ['websocket', 'polling'], withCredentials: true });
    const join = () => s.emit('join-battle', battleId);
    s.on('connect', join); join();

    s.on('battle:started', (d) => {
      setStatus('live');
      setParticipants((d.participants || []).map(mapStateP));
      pushLog(`⚔️ Battle started — ${d.participants?.length || 0} agents`);
    });
    s.on('battle:question', (q) => {
      setQuestion(q); setReveal(null); setSelected(null); setMyResult(null);
      qStartRef.current = Date.now();
      setTimer(Math.max(1, Math.round((q.timeLimitMs || 15000) / 1000)));
    });
    s.on('battle:state', (d) => setParticipants((d.participants || []).map(mapStateP)));
    s.on('battle:reveal', (d) => setReveal(d));
    s.on('battle:log', (e) => pushLog(e.message, e.timestamp));
    s.on('battle:over', (d) => { setOver(d); setStatus('completed'); pushLog('🏁 Battle complete!'); });

    const hb = setInterval(() => { apiPost(`${B}/battles/${battleId}/heartbeat`, {}).catch(() => {}); }, 20000);
    apiPost(`${B}/battles/${battleId}/heartbeat`, {}).catch(() => {});

    return () => { clearInterval(hb); try { s.emit('leave-battle', battleId); s.disconnect(); } catch { /* noop */ } };
  }, [battleId]);

  // Question countdown (display only; the server owns the real deadline).
  useEffect(() => {
    if (status !== 'live' || !question || reveal || timer <= 0) return;
    const t = setTimeout(() => setTimer((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [status, question, reveal, timer]);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const iAmParticipant = participants.some((p) => p.userId === myId);
  const sorted = [...participants].sort((a, b) => b.score - a.score || b.hp - a.hp);

  const answer = async (idx) => {
    if (selected !== null || reveal || !question || answering) return;
    setSelected(idx); setAnswering(true);
    try {
      const d = await apiPost(`${B}/battles/${battleId}/answer`, {
        question_order: question.questionOrder,
        selected_index: idx,
        response_time_ms: Date.now() - qStartRef.current,
      });
      setMyResult(d);
    } catch (e) {
      setMyResult({ error: /409/.test(e.message) ? 'Already answered' : /400/.test(e.message) ? 'Battle not live' : 'Could not submit' });
    } finally { setAnswering(false); }
  };

  const startBattle = async () => {
    try { await apiPost(`${B}/battles/${battleId}/start`, {}); setNotice('Starting…'); }
    catch (e) { setNotice(/400/.test(e.message) ? 'Need at least 2 participants' : /404/.test(e.message) ? 'Only the creator can start' : 'Could not start'); }
  };

  const isLive = status === 'live';
  const isCompleted = status === 'completed';
  const scoreboard = results?.scoreboard;
  const winner = results?.winner || over?.winner;

  const panel = { borderRadius: 16, padding: 14, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)' };
  const timerColor = timer > 8 ? GREEN : timer > 4 ? '#F59E0B' : RED;

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(8px)', fontFamily: FONT }}>
      <div style={{ width: '100%', maxWidth: 640, maxHeight: '95vh', borderRadius: 24, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'linear-gradient(160deg,#0f1320,#141c2e,#1a1430)', border: '1px solid rgba(255,255,255,.1)', animation: 'sheet-up .4s cubic-bezier(.32,1,.64,1)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {isLive && <LiveBadge />}
            {isCompleted && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: 'rgba(255,255,255,.10)', color: 'rgba(255,255,255,.55)' }}>COMPLETED</span>}
            {!isLive && !isCompleted && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: 'rgba(108,59,255,.25)', color: '#A78BFA' }}>LOBBY</span>}
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{initialBattle?.title || initialBattle?.topic || 'Battle'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', display: 'flex', alignItems: 'center', gap: 4 }}><UsersIcon size={11} />{participants.length}</span>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,.10)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><XIcon size={14} color="rgba(255,255,255,.6)" /></button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 18px 0' }}>
          {[['watch', 'Battle'], ['log', 'Log'], ['results', 'Results']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{ padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none', background: tab === key ? '#E8884A' : 'rgba(255,255,255,.10)', color: tab === key ? '#fff' : 'rgba(255,255,255,.50)', fontFamily: FONT }}>{label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'watch' && (
            <>
              {/* Scoreboard */}
              <div style={panel}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,.45)', letterSpacing: .4 }}>{isCompleted ? 'FINAL STANDINGS' : 'LIVE SCOREBOARD'}</span>
                  {isLive && question && !reveal && (
                    <span style={{ fontSize: 12, fontWeight: 900, color: timerColor }}>⏱ {timer}s</span>
                  )}
                </div>
                {sorted.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '18px 0', color: 'rgba(255,255,255,.35)', fontSize: 12.5 }}>Waiting for participants…</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {sorted.map((p, rank) => (
                      <div key={p.userId} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 12, background: p.userId === myId ? 'rgba(232,136,74,.15)' : 'rgba(255,255,255,.04)', border: p.userId === myId ? '1px solid rgba(232,136,74,.35)' : '1px solid rgba(255,255,255,.07)' }}>
                        <span style={{ fontSize: 12, width: 18, textAlign: 'center', flexShrink: 0 }}>{rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank + 1}</span>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${p.agentColor}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{p.agentEmoji}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.agentName}</span>
                            {p.userId === myId && <span style={{ fontSize: 8, fontWeight: 900, padding: '1px 5px', borderRadius: 20, background: 'rgba(232,136,74,.30)', color: '#E8884A' }}>YOU</span>}
                            {p.streak >= 2 && <span style={{ fontSize: 9, color: '#FB923C' }}>🔥{p.streak}</span>}
                          </div>
                          <div style={{ height: 4, marginTop: 3, background: 'rgba(255,255,255,.12)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${p.hp}%`, background: p.hp > 50 ? GREEN : p.hp > 25 ? '#F59E0B' : RED, borderRadius: 2, transition: 'width .5s' }} />
                          </div>
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', minWidth: 24, textAlign: 'right' }}>{p.score}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Lobby / start */}
              {!isLive && !isCompleted && (
                <div style={{ ...panel, textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.7)', marginBottom: 10 }}>Waiting for the battle to start…</div>
                  <button onClick={startBattle} style={{ padding: '10px 18px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#E8884A,#D97706)', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Start battle</button>
                  {notice && <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.5)', marginTop: 8 }}>{notice}</div>}
                </div>
              )}

              {/* Live question */}
              {isLive && question && (
                <div style={panel}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: 'rgba(232,136,74,.20)', color: '#E8884A' }}>Q{question.questionOrder}{question.topic ? ` · ${question.topic}` : ''}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>+{question.xpValue} XP</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#E2E8F0', lineHeight: 1.55, marginBottom: 12 }}>{question.questionText}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {(question.options || []).map((opt, i) => {
                      let bg = 'rgba(255,255,255,.06)', border = '1.5px solid rgba(255,255,255,.14)', color = '#E8E2D9';
                      if (reveal) {
                        if (i === reveal.correctIndex) { bg = 'rgba(16,185,129,.20)'; border = '1.5px solid #10B981'; color = '#6EF7C8'; }
                        else if (i === selected) { bg = 'rgba(239,68,68,.15)'; border = '1.5px solid #EF4444'; color = '#FCA5A5'; }
                      } else if (selected === i) { border = '1.5px solid #E8884A'; bg = 'rgba(255,255,255,.12)'; }
                      const pickers = reveal?.answers?.filter((a) => a.selectedIndex === i) || [];
                      return (
                        <button key={i} onClick={() => answer(i)} disabled={!iAmParticipant || selected !== null || !!reveal || answering}
                          style={{ padding: '11px 14px', borderRadius: 13, border, background: bg, color, fontSize: 13, fontWeight: 500, textAlign: 'left', cursor: (!iAmParticipant || selected !== null || reveal) ? 'default' : 'pointer', fontFamily: FONT }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid rgba(255,255,255,.20)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.45)', flexShrink: 0 }}>{['A', 'B', 'C', 'D', 'E'][i]}</span>{opt}
                          </span>
                          {pickers.length > 0 && (
                            <span style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                              {pickers.map((a, j) => <span key={j} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'rgba(255,255,255,.10)', color: '#fff' }}>{a.agentEmoji} {a.agentName}</span>)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {!iAmParticipant && <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,.35)' }}>👁 You’re watching this battle</div>}
                  {myResult?.error && <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: '#FCA5A5' }}>{myResult.error}</div>}
                  {myResult && !myResult.error && <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12.5, fontWeight: 800, color: myResult.is_correct ? '#4ADE80' : '#F87171' }}>{myResult.is_correct ? `✓ Correct! +${myResult.xp_gained} XP` : '✗ Wrong answer'}</div>}
                </div>
              )}

              {isLive && !question && (
                <div style={{ ...panel, textAlign: 'center', color: 'rgba(255,255,255,.4)', fontSize: 12.5 }}>Next question loading…</div>
              )}

              {/* Winner banner */}
              {isCompleted && winner && (
                <div style={{ ...panel, textAlign: 'center' }}>
                  <TrophyIcon size={38} color={GOLD} />
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#F1F5F9', marginTop: 6 }}>{winner.agentName} wins!</div>
                  {over?.durationFormatted && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>Duration {over.durationFormatted}</div>}
                </div>
              )}
            </>
          )}

          {tab === 'log' && (
            <div ref={logRef} style={{ flex: 1, minHeight: 260, maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {log.length === 0 && <div style={{ color: 'rgba(255,255,255,.28)', fontSize: 13, textAlign: 'center', paddingTop: 30 }}>Battle events will appear here…</div>}
              {log.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11.5 }}>
                  <span style={{ color: 'rgba(255,255,255,.28)', flexShrink: 0, fontFamily: 'monospace' }}>{e.ts}</span>
                  <span style={{ color: 'rgba(255,255,255,.6)' }}>{e.msg}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'results' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!scoreboard ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: 'rgba(255,255,255,.35)', fontSize: 12.5 }}>{isCompleted ? 'Loading results…' : 'Results appear when the battle ends.'}</div>
              ) : scoreboard.map((p) => (
                <div key={p.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, ...panel, padding: '11px 13px', background: p.isMe ? 'rgba(232,136,74,.12)' : 'rgba(255,255,255,.05)' }}>
                  <span style={{ fontSize: 14, width: 22, textAlign: 'center' }}>{p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : p.rank}</span>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: `${p.agentColor}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{p.agentEmoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#fff' }}>{p.agentName}{p.isMe && ' (you)'}{p.isWinner && ' 👑'}</div>
                    <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.4)' }}>{p.correctAnswers}/{p.correctAnswers + p.wrongAnswers} correct · {p.accuracy}% · streak {p.maxStreak}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: '#fff' }}>{p.score}</div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#E8884A' }}>+{p.xpEarned} XP</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '10px 18px', borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'rgba(255,255,255,.35)' }}>
          <FlameIcon size={11} /> Live knowledge battle
        </div>
      </div>
    </div>
  );
}
