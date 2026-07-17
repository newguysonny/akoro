/**
 * BattleModal — real-time battle arena.
 * ─────────────────────────────────────────────────────────────
 * UI mirrors the reference ELearn design (scrolling ticker + the
 * Battle / Stats / Log / Questions tabs), but every value is driven by the
 * live backend engine (BullMQ worker + socket.io), not local simulation:
 *   sockets:  battle:started / battle:question / battle:state /
 *             battle:reveal / battle:log / battle:over
 *   REST:     GET  /battles/:id/state|questions|log|results
 *             POST /battles/:id/answer|start|heartbeat
 */
import { useState, useEffect, useRef } from 'react';
import { BRAND, RED, GREEN, GOLD } from '../../constants.js';
import { API, apiGet, apiPost } from '../../services/api.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { XIcon, UsersIcon, TrophyIcon, FlameIcon, BookIcon, PlayIcon, ZapIcon } from '../common/Icons.jsx';
import { LiveBadge } from '../common/ProgressBar.jsx';

const B = '/api/battle';
const FONT = "'Nunito', sans-serif";

const mapStateP = (p) => ({
  userId: p.user_id ?? p.userId,
  agentName: p.user_agents?.agent_name ?? p.agentName ?? 'Agent',
  agentEmoji: p.user_agents?.agent_emoji ?? p.agentEmoji ?? '🤖',
  agentColor: p.user_agents?.agent_color ?? p.agentColor ?? '#7C3AED',
  role: p.role,
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
  const [myXp,         setMyXp]         = useState(0);
  const [timer,        setTimer]        = useState(0);
  const [log,          setLog]          = useState([]);
  const [answered,     setAnswered]     = useState([]);   // for the Questions tab
  const [over,         setOver]         = useState(null);
  const [results,      setResults]      = useState(null);
  const [viewerCount,  setViewerCount]  = useState(0);
  const [totalQ,       setTotalQ]       = useState(initialBattle?.totalQ || 0);
  const [tab,          setTab]          = useState('watch');
  const [notice,       setNotice]       = useState(null);

  const qStartRef  = useRef(0);
  const logRef     = useRef(null);
  const answeredIx = useRef(new Set());

  const pushLog = (msg, ts) => setLog((prev) => [...prev.slice(-100), { msg, ts: ts || new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }]);

  const recordAnswered = (q, correctIndex, mySel) => {
    if (!q || answeredIx.current.has(q.questionOrder)) return;
    answeredIx.current.add(q.questionOrder);
    setAnswered((prev) => [...prev, {
      order: q.questionOrder, text: q.questionText, options: q.options || [],
      topic: q.topic, correctIndex, myPick: mySel, myCorrect: mySel != null && mySel === correctIndex,
    }]);
  };

  // Initial snapshot + reconnect recovery.
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
      if (st) { setStatus(st.status); setParticipants((st.participants || []).map(mapStateP)); setViewerCount(st.viewer_count || 0); }
      if (lg?.logs?.length) setLog(lg.logs.map((e) => ({ msg: e.message, ts: e.created_at ? new Date(e.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '' })));
      if (qd?.questions?.length) {
        setTotalQ(qd.questions.length);
        // Seed the Questions tab with anything already answered/revealed.
        qd.questions.forEach((q) => {
          if (q.correctAnswerIndex != null || q.myAnswer != null) {
            answeredIx.current.add(q.questionOrder);
            setAnswered((prev) => [...prev, { order: q.questionOrder, text: q.questionText, options: q.options || [], topic: q.topic, correctIndex: q.correctAnswerIndex, myPick: q.myAnswer, myCorrect: q.isCorrect }]);
          }
        });
        setMyXp(qd.questions.reduce((s, q) => s + (q.xpGained || 0), 0));
        // Restore the current live question on reconnect.
        if (st?.status === 'live') {
          const active = qd.questions.find((q) => q.correctAnswerIndex == null);
          if (active) {
            setQuestion((prev) => prev || { questionOrder: active.questionOrder, questionText: active.questionText, options: active.options, topic: active.topic, xpValue: active.xpValue, timeLimitMs: 15000 });
            qStartRef.current = Date.now();
            if (active.myAnswer != null) { setSelected(active.myAnswer); setMyResult({ is_correct: active.isCorrect, xp_gained: active.xpGained || 0 }); }
          }
        }
      }
    })();
    return () => { alive = false; };
  }, [battleId]);

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
      if (q.questionOrder > totalQ) setTotalQ(q.questionOrder);
    });
    s.on('battle:state', (d) => setParticipants((d.participants || []).map(mapStateP)));
    s.on('battle:reveal', (d) => {
      setReveal(d);
      setQuestion((q) => { if (q && q.questionOrder === d.questionOrder) recordAnswered(q, d.correctIndex, selectedRef.current); return q; });
    });
    s.on('battle:log', (e) => pushLog(e.message, e.timestamp));
    s.on('battle:over', (d) => { setOver(d); setStatus('completed'); pushLog('🏁 Battle complete!'); });

    const hb = setInterval(() => { apiPost(`${B}/battles/${battleId}/heartbeat`, {}).catch(() => {}); }, 20000);
    apiPost(`${B}/battles/${battleId}/heartbeat`, {}).catch(() => {});

    return () => { clearInterval(hb); try { s.emit('leave-battle', battleId); s.disconnect(); } catch { /* noop */ } };
  }, [battleId]);

  // Keep the latest `selected` reachable from the socket closure.
  const selectedRef = useRef(null);
  selectedRef.current = selected;

  useEffect(() => {
    if (status !== 'live' || !question || reveal || timer <= 0) return;
    const t = setTimeout(() => setTimer((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [status, question, reveal, timer]);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const iAmParticipant = participants.some((p) => p.userId === myId);
  const isClassroom = (initialBattle?.battleType === 'classroom') || participants.length > 2;
  const sorted = [...participants].sort((a, b) => b.score - a.score || b.hp - a.hp);
  const me  = participants.find((p) => p.userId === myId);
  const A   = me || sorted[0];
  const Bp  = participants.find((p) => p.userId !== myId) || sorted[1];
  const teacher  = participants.find((p) => p.role === 'teacher');
  const students = participants.filter((p) => p !== teacher).sort((a, b) => b.score - a.score || b.hp - a.hp);
  const curOrder = question?.questionOrder ?? (answered.length ? Math.max(...answered.map((a) => a.order)) : 0);

  const answer = async (idx) => {
    if (selected !== null || reveal || !question || answering || !iAmParticipant) return;
    setSelected(idx); setAnswering(true);
    try {
      const d = await apiPost(`${B}/battles/${battleId}/answer`, {
        question_order: question.questionOrder, selected_index: idx, response_time_ms: Date.now() - qStartRef.current,
      });
      setMyResult(d);
      if (d?.xp_gained) setMyXp((x) => x + d.xp_gained);
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
  const timerPct = totalQ ? (timer / Math.max(1, Math.round((question?.timeLimitMs || 15000) / 1000))) * 100 : 0;
  const timerColor = timer > 8 ? GREEN : timer > 4 ? GOLD : RED;

  // Ticker fed by the real event log (falls back to a couple of lines).
  const tickerBase = log.length ? log.slice(-8).map((l) => l.msg) : ['Live knowledge battle in progress', 'Answer fast to earn bonus XP', 'Agents compete on your class curriculum'];
  const tickerItems = [...tickerBase, ...tickerBase];

  const myAnswered = answered.length;
  const myAccuracy = myAnswered ? Math.round((answered.filter((a) => a.myCorrect).length / myAnswered) * 100) : 0;

  const panel = { borderRadius: 16, padding: 14, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)' };
  const optBtn = { padding: '11px 14px', borderRadius: 13, fontSize: 13, fontWeight: 500, textAlign: 'left', fontFamily: FONT, width: '100%' };

  const TAB_ITEMS = [['watch', 'Battle'], ['stats', 'Stats'], ['log', 'Log'], ['questions', 'Questions']];

  const AgentPill = ({ p, big }) => (
    <div style={{ width: big ? 52 : 42, height: big ? 52 : 42, borderRadius: '50%', background: `${p?.agentColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: big ? 26 : 22, flexShrink: 0, boxShadow: `0 0 16px ${p?.agentColor}66` }}>{p?.agentEmoji}</div>
  );

  const TimerRing = () => (
    <div style={{ position: 'relative', width: 34, height: 34 }}>
      <svg viewBox="0 0 36 36" style={{ width: 34, height: 34, transform: 'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke={timerColor} strokeWidth="3" strokeDasharray="94.2" strokeDashoffset={94.2 * (1 - timerPct / 100)} strokeLinecap="round" style={{ transition: 'stroke-dashoffset .9s linear' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: timerColor }}>{timer}</div>
    </div>
  );

  const StudentRow = ({ p, rank }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 12, background: p.userId === myId ? 'rgba(232,136,74,.15)' : 'rgba(255,255,255,.04)', border: p.userId === myId ? '1px solid rgba(232,136,74,.35)' : '1px solid rgba(255,255,255,.07)' }}>
      <span style={{ fontSize: 12, width: 18, textAlign: 'center' }}>{rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank + 1}</span>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${p.agentColor}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{p.agentEmoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.agentName}</span>
          {p.userId === myId && <span style={{ fontSize: 8, fontWeight: 900, padding: '1px 5px', borderRadius: 20, background: 'rgba(232,136,74,.30)', color: '#E8884A' }}>YOU</span>}
          {p.streak >= 2 && <span style={{ fontSize: 9, color: '#FB923C' }}>🔥{p.streak}</span>}
        </div>
        <div style={{ height: 4, marginTop: 3, background: 'rgba(255,255,255,.12)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${p.hp}%`, background: p.hp > 50 ? GREEN : p.hp > 25 ? GOLD : RED, borderRadius: 2, transition: 'width .5s' }} />
        </div>
      </div>
      <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', minWidth: 24, textAlign: 'right' }}>{p.score}</div>
    </div>
  );

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(8px)', fontFamily: FONT }}>
      <style>{`@keyframes bm-ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}@keyframes bm-up{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div style={{ width: '100%', maxWidth: 640, maxHeight: '95vh', borderRadius: 24, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'linear-gradient(160deg,#0f1320,#141c2e,#1a1430)', border: '1px solid rgba(255,255,255,.1)', animation: 'bm-up .35s cubic-bezier(.32,1,.64,1)' }}>

        {/* Notification ticker */}
        <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', background: 'rgba(0,0,0,.30)', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'inline-flex', gap: 48, animation: 'bm-ticker 28s linear infinite' }}>
            {tickerItems.map((tk, i) => <span key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', fontWeight: 600, padding: '0 24px' }}>⚔️ {tk}</span>)}
          </div>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {isLive && <LiveBadge />}
            {isCompleted && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: 'rgba(255,255,255,.10)', color: 'rgba(255,255,255,.55)' }}>COMPLETED</span>}
            {!isLive && !isCompleted && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: 'rgba(108,59,255,.25)', color: '#A78BFA' }}>LOBBY</span>}
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{initialBattle?.title || initialBattle?.topic || 'Battle'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', display: 'flex', alignItems: 'center', gap: 4 }}><UsersIcon size={11} color="rgba(255,255,255,.45)" />{viewerCount || participants.length}</span>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,.10)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><XIcon size={14} color="rgba(255,255,255,.6)" /></button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 18px 0' }}>
          {TAB_ITEMS.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{ padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none', background: tab === key ? '#E8884A' : 'rgba(255,255,255,.10)', color: tab === key ? '#fff' : 'rgba(255,255,255,.50)', fontFamily: FONT }}>{label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* ── BATTLE ── */}
          {tab === 'watch' && (
            <>
              {/* Lobby / start */}
              {!isLive && !isCompleted && (
                <div style={{ ...panel }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ flex: 1, textAlign: 'center' }}>{A && <><AgentPill p={A} big /><div style={{ color: '#fff', fontWeight: 800, fontSize: 12.5, marginTop: 6 }}>{A.agentName}{A.userId === myId ? ' (you)' : ''}</div></>}</div>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#1A1A2E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff' }}>VS</div>
                    <div style={{ flex: 1, textAlign: 'center' }}>{Bp && <><AgentPill p={Bp} big /><div style={{ color: '#fff', fontWeight: 800, fontSize: 12.5, marginTop: 6 }}>{Bp.agentName}</div></>}</div>
                  </div>
                  <div style={{ textAlign: 'center', marginTop: 14 }}>
                    <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.6)', marginBottom: 10 }}>Waiting for the battle to start…</div>
                    <button onClick={startBattle} style={{ padding: '10px 18px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#E8884A,#D97706)', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'inline-flex', alignItems: 'center', gap: 7 }}><PlayIcon size={13} color="#fff" />Start battle</button>
                    {notice && <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.5)', marginTop: 8 }}>{notice}</div>}
                  </div>
                </div>
              )}

              {/* Scoreboard */}
              {(isLive || isCompleted) && (
                <div style={panel}>
                  {sorted.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '18px 0', color: 'rgba(255,255,255,.35)', fontSize: 12.5 }}>Waiting for participants…</div>
                  ) : isClassroom ? (
                    <>
                      {/* Teacher card */}
                      {teacher && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12, background: 'rgba(124,58,237,.16)', border: '1px solid rgba(124,58,237,.32)', marginBottom: 12 }}>
                          <div style={{ width: 44, height: 44, borderRadius: '50%', background: `${teacher.agentColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0, boxShadow: `0 0 16px ${teacher.agentColor}66` }}>{teacher.agentEmoji}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: '#fff', fontWeight: 800, fontSize: 13.5 }}>{teacher.agentName}</div>
                            <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 7px', borderRadius: 20, background: 'rgba(124,58,237,.35)', color: '#C4B5FD' }}>TEACHER</span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 24, fontWeight: 900, color: teacher.agentColor }}>{teacher.score}</div>
                            <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,.35)' }}>{teacher.hp} HP</div>
                          </div>
                        </div>
                      )}
                      {/* vs N student agents + timer + question count */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '0 4px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.40)' }}>vs {students.length} student agent{students.length === 1 ? '' : 's'}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {isLive && question && !reveal && <TimerRing />}
                          {totalQ > 0 && <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>Q{curOrder}/{totalQ}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {students.map((p, rank) => <StudentRow key={p.userId} p={p} rank={rank} />)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,.45)', letterSpacing: .4 }}>{isCompleted ? 'FINAL STANDINGS' : 'HEAD TO HEAD'}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {totalQ > 0 && <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>Q{curOrder}/{totalQ}</span>}
                          {isLive && question && !reveal && <TimerRing />}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        {[A, Bp].map((ag, idx) => ag && (
                          <div key={idx} style={{ flex: 1, textAlign: 'center' }}>
                            <AgentPill p={ag} big />
                            <div style={{ color: '#fff', fontWeight: 800, fontSize: 12.5, marginTop: 6 }}>{ag.agentName}</div>
                            {ag.userId === myId && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 20, background: 'rgba(255,255,255,.12)', color: '#fff' }}>YOU</span>}
                            <div style={{ fontSize: 30, fontWeight: 900, marginTop: 4, color: ag.agentColor }}>{ag.score}</div>
                            <div style={{ marginTop: 5 }}>
                              <div style={{ height: 8, background: 'rgba(255,255,255,.12)', borderRadius: 4, overflow: 'hidden' }}><div style={{ height: '100%', width: `${ag.hp}%`, background: ag.hp > 50 ? GREEN : ag.hp > 25 ? GOLD : RED, borderRadius: 4, transition: 'width .5s' }} /></div>
                              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>{ag.hp} HP</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Live question */}
              {isLive && question && (
                <div style={panel}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: 'rgba(232,136,74,.20)', color: '#E8884A' }}>Q{question.questionOrder}{totalQ ? `/${totalQ}` : ''}{question.topic ? ` · ${question.topic}` : ''}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>+{question.xpValue} XP</span>
                    {me?.streak >= 2 && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: 'rgba(249,115,22,.20)', color: '#FB923C' }}>🔥 {me.streak}× streak</span>}
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
                          style={{ ...optBtn, border, background: bg, color, cursor: (!iAmParticipant || selected !== null || reveal) ? 'default' : 'pointer' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid rgba(255,255,255,.20)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.45)', flexShrink: 0 }}>{['A', 'B', 'C', 'D', 'E'][i]}</span>{opt}
                          </span>
                          {pickers.length > 0 && (
                            <span style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                              {pickers.map((a, j) => <span key={j} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: a.userId === myId ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.08)', color: '#fff' }}>{a.agentEmoji} {a.userId === myId ? 'You' : a.agentName}</span>)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {!iAmParticipant && <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,.35)' }}>👁 You’re watching — pick nothing, just spectate</div>}
                  {myResult?.error && <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: '#FCA5A5' }}>{myResult.error}</div>}
                  {myResult && !myResult.error && <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12.5, fontWeight: 800, color: myResult.is_correct ? '#4ADE80' : '#F87171' }}>{myResult.is_correct ? `✓ Correct! +${myResult.xp_gained} XP` : '✗ Wrong answer'}</div>}
                </div>
              )}

              {isLive && !question && <div style={{ ...panel, textAlign: 'center', color: 'rgba(255,255,255,.4)', fontSize: 12.5 }}>Next question loading…</div>}

              {/* Winner */}
              {isCompleted && winner && (
                <div style={{ ...panel, textAlign: 'center' }}>
                  <TrophyIcon size={38} color={GOLD} />
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#F1F5F9', marginTop: 6 }}>{winner.agentName} wins!</div>
                  {over?.durationFormatted && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>Duration {over.durationFormatted}</div>}
                  {myXp > 0 && <div style={{ display: 'inline-block', marginTop: 8, padding: '4px 14px', borderRadius: 20, background: 'rgba(232,136,74,.20)', color: '#E8884A', fontWeight: 800, fontSize: 13 }}>+{myXp} XP earned</div>}
                </div>
              )}
            </>
          )}

          {/* ── STATS ── */}
          {tab === 'stats' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[['Your XP this battle', myXp, '#E8884A'], ['Questions answered', myAnswered, GREEN], ['Your streak', `${me?.streak || 0}🔥`, GOLD], ['Viewers', viewerCount || participants.length, '#3B82F6']].map(([label, val, color]) => (
                  <div key={label} style={panel}><div style={{ fontSize: 22, fontWeight: 900, color, marginBottom: 4 }}>{val}</div><div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.40)' }}>{label}</div></div>
                ))}
              </div>
              {!isClassroom && A && Bp && (
                <div style={panel}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,.40)', letterSpacing: .5, marginBottom: 12 }}>HEAD TO HEAD</div>
                  {[['Score', A.score, Bp.score], ['HP remaining', A.hp, Bp.hp], ['Streak', A.streak, Bp.streak]].map(([label, av, bv]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                      <span style={{ fontWeight: 800, fontSize: 13, width: 40, textAlign: 'center', color: A.agentColor }}>{av}</span>
                      <span style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,.40)' }}>{label}</span>
                      <span style={{ fontWeight: 800, fontSize: 13, width: 40, textAlign: 'center', color: Bp.agentColor }}>{bv}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
                    <span style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,.40)' }}>Your accuracy: <b style={{ color: '#fff' }}>{myAccuracy}%</b></span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── LOG ── */}
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

          {/* ── QUESTIONS ── */}
          {tab === 'questions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,.40)', letterSpacing: .5 }}>{isCompleted ? 'ALL QUESTIONS' : 'ANSWERED SO FAR'}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.28)', background: 'rgba(255,255,255,.06)', borderRadius: 8, padding: '2px 9px' }}>{answered.length}{totalQ ? `/${totalQ}` : ''}</span>
              </div>
              {answered.length === 0 && <div style={{ textAlign: 'center', padding: '40px 16px', color: 'rgba(255,255,255,.25)', fontSize: 13, fontWeight: 600 }}>{isCompleted ? 'No questions recorded.' : 'Questions appear here as they’re revealed…'}</div>}
              {[...answered].sort((a, b) => b.order - a.order).map((entry) => (
                <div key={entry.order} style={{ borderRadius: 12, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.09)', padding: '12px 13px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 900, color: 'rgba(255,255,255,.40)' }}>Q{entry.order}</span>
                    {entry.topic && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 20, background: 'rgba(232,136,74,.18)', color: '#E8884A' }}>{entry.topic}</span>}
                    {entry.myPick != null && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, padding: '1px 8px', borderRadius: 20, background: entry.myCorrect ? 'rgba(16,185,129,.18)' : 'rgba(239,68,68,.18)', color: entry.myCorrect ? '#4ADE80' : '#F87171' }}>{entry.myCorrect ? '✓ Correct' : '✗ Wrong'}</span>}
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0', lineHeight: 1.55, margin: '0 0 10px' }}>{entry.text}</p>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#4ADE80', flexShrink: 0, marginTop: 1 }}>ANSWER</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#4ADE80', lineHeight: 1.45 }}>{entry.correctIndex != null ? entry.options[entry.correctIndex] : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 18px', borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'rgba(255,255,255,.35)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FlameIcon size={11} color="#F97316" />Live knowledge battle</span>
            <span>·</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><BookIcon size={11} color="rgba(255,255,255,.35)" />Your class</span>
          </div>
          {isLive && iAmParticipant && <span style={{ fontSize: 11, fontWeight: 700, color: '#E8884A', display: 'flex', alignItems: 'center', gap: 5 }}><ZapIcon size={11} color="#E8884A" />You’re in this battle</span>}
        </div>
      </div>
    </div>
  );
}
