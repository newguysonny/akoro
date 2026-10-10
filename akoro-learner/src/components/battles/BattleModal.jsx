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
import { useLang } from '../../contexts/LanguageContext.jsx';
import { XIcon, UsersIcon, TrophyIcon, FlameIcon, BookIcon, PlayIcon, ZapIcon, Icon } from '../common/Icons.jsx';
import { AgentAvatar } from '../common/AgentAvatar.jsx';
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

export default function BattleModal({ battle: initialBattle, onClose, onMinimize }) {
  const { user } = useAuth();
  const { t } = useLang();
  const myId = user?.id;
  const battleId = initialBattle?.id;

  const [status,       setStatus]       = useState(initialBattle?.status || 'scheduled');
  const [participants, setParticipants] = useState([]);
  const [question,     setQuestion]     = useState(null);
  const [reveal,       setReveal]       = useState(null);
  const [selected,     setSelected]     = useState(null);
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
  const [battleType,   setBattleType]   = useState(initialBattle?.type ?? initialBattle?.battleType ?? null);
  const [verdict,      setVerdict]      = useState(null);   // Sergeant's, when the battle ends

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
      if (st) {
        setStatus(st.status);
        setParticipants((st.participants || []).map(mapStateP));
        setViewerCount(st.viewer_count || 0);
        if (st.battleType) setBattleType(st.battleType);
      }
      if (lg?.logs?.length) setLog(lg.logs.map((e) => ({ msg: e.message, ts: e.created_at ? new Date(e.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '' })));
      if (qd?.questions?.length) {
        // `total` is the battle's real length. The array now holds only the
        // questions actually in play — unplayed ones are withheld so nobody can
        // read ahead — so counting it would show "3 of 3" mid-battle.
        setTotalQ(qd.total ?? qd.questions.length);
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
      pushLog(`Battle started — ${d.participants?.length || 0} agents`);
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
    s.on('battle:verdict', (d) => { if (!d?.battleId || d.battleId === battleId) setVerdict(d?.verdict || null); });
    s.on('battle:over', (d) => { setOver(d); setStatus('completed'); pushLog('Battle complete!'); });

    // Deliberately silent: a heartbeat that misses is replaced by the next one
    // 20s later, and telling the learner mid-battle that one ping failed would
    // be noise about something that already fixed itself.
    const hb = setInterval(() => { apiPost(`${B}/battles/${battleId}/heartbeat`, {}).catch(() => {}); }, 20000);
    apiPost(`${B}/battles/${battleId}/heartbeat`, {}).catch(() => {});

    return () => { clearInterval(hb); try { s.emit('leave-battle', battleId); s.disconnect(); } catch { /* noop */ } };
  }, [battleId]);

  // Keep the latest values reachable from socket/interval closures.
  const selectedRef = useRef(null); selectedRef.current = selected;
  const questionRef = useRef(null); questionRef.current = question;
  const revealRef   = useRef(null); revealRef.current = reveal;

  // Safety net: while live, re-sync from REST every 12s so a dropped socket
  // event (or a battle progressing without a delivered emit) still surfaces —
  // scoreboard refreshes, and the current unanswered question is recovered.
  useEffect(() => {
    if (status !== 'live' || !battleId) return;
    const iv = setInterval(async () => {
      const st = await apiGet(`${B}/battles/${battleId}/state`).catch(() => null);
      if (st?.battleType) setBattleType(st.battleType);
      if (st) { setStatus(st.status); setParticipants((st.participants || []).map(mapStateP)); if (st.viewer_count != null) setViewerCount(st.viewer_count); }
      if (!questionRef.current || (selectedRef.current != null && !revealRef.current)) {
        const qd = await apiGet(`${B}/battles/${battleId}/questions`).catch(() => null);
        const active = qd?.questions?.find((q) => q.correctAnswerIndex == null);
        if (active && active.questionOrder !== questionRef.current?.questionOrder) {
          setQuestion({ questionOrder: active.questionOrder, questionText: active.questionText, options: active.options, topic: active.topic, xpValue: active.xpValue, timeLimitMs: 15000 });
          setReveal(null); setSelected(null); setMyResult(null);
          qStartRef.current = Date.now();
        }
      }
    }, 12000);
    return () => clearInterval(iv);
  }, [status, battleId]);

  useEffect(() => {
    if (status !== 'live' || !question || reveal || timer <= 0) return;
    const t = setTimeout(() => setTimer((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [status, question, reveal, timer]);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const iAmParticipant = participants.some((p) => p.userId === myId);
  // Every battle is fought by the AGENTS, study review included. Yours answers
  // from what you have actually learned — its odds come from your own per-topic
  // confidence — and you watch. Nothing in the arena is tappable.
  //
  // The type comes from the SERVER (/battles/:id/state), not from the card that
  // opened this: accepting an invitation opens the arena with only an id and a
  // status, so the card cannot be relied on to carry it.
  const isReview = battleType === 'review';
  const isClassroom = (initialBattle?.battleType === 'classroom') || participants.length > 2;
  // "Bolt vs Nova" for a 1v1, "Bolt vs your agent and 23 more" for a group —
  // from who is actually seated, so it holds for a battle opened from anywhere.
  const lineupText = (() => {
    const players = participants.filter((p) => p.role !== 'teacher');
    const mine = players.find((p) => p.userId === myId);
    const others = players.filter((p) => p.userId !== myId);
    if (!others.length) return '';
    const lead = others.find((p) => p.agentName === initialBattle?.lineup?.leadAgent) || others[0];
    if (!mine) return players.length === 2 ? `${players[0].agentName} vs ${players[1].agentName}` : `${players.length} agents`;
    if (players.length === 2) return `${lead.agentName} vs ${mine.agentName}`;
    return `${lead.agentName} vs your agent${others.length > 1 ? ` and ${others.length - 1} more` : ''}`;
  })();
  const sorted = [...participants].sort((a, b) => b.score - a.score || b.hp - a.hp);
  const me  = participants.find((p) => p.userId === myId);
  const A   = me || sorted[0];
  const Bp  = participants.find((p) => p.userId !== myId) || sorted[1];
  const teacher  = participants.find((p) => p.role === 'teacher');
  const students = participants.filter((p) => p !== teacher).sort((a, b) => b.score - a.score || b.hp - a.hp);
  const curOrder = question?.questionOrder ?? (answered.length ? Math.max(...answered.map((a) => a.order)) : 0);

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
    <div style={{ width: big ? 52 : 42, height: big ? 52 : 42, borderRadius: '50%', background: `${p?.agentColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 0 16px ${p?.agentColor}66` }}><AgentAvatar emoji={p?.agentEmoji} size={big ? 34 : 28}/></div>
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
      <span style={{ fontSize: 12, width: 18, textAlign: 'center' }}>{rank === 0 ? <Icon name="ti-medal" size={12} color={GOLD}/> : rank === 1 ? <Icon name="ti-medal" size={12} color="#C0C0C0"/> : rank === 2 ? <Icon name="ti-medal" size={12} color="#CD7F32"/> : rank + 1}</span>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${p.agentColor}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><AgentAvatar emoji={p.agentEmoji} size={19}/></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.agentName}</span>
          {p.userId === myId && <span style={{ fontSize: 8, fontWeight: 900, padding: '1px 5px', borderRadius: 20, background: 'rgba(232,136,74,.30)', color: '#E8884A' }}>YOU</span>}
          {p.streak >= 2 && <span style={{ fontSize: 9, color: "#FB923C", display: "inline-flex", alignItems: "center", gap: 2 }}><Icon name="ti-flame" size={9} color="#FB923C"/>{p.streak}</span>}
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
            {tickerItems.map((tk, i) => <span key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', fontWeight: 600, padding: "0 24px" }}><Icon name="ti-swords" size={10}/> {tk}</span>)}
          </div>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {isLive && <LiveBadge />}
            {isCompleted && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: 'rgba(255,255,255,.10)', color: 'rgba(255,255,255,.55)' }}>COMPLETED</span>}
            {!isLive && !isCompleted && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 20, background: 'rgba(108,59,255,.25)', color: '#A78BFA' }}>LOBBY</span>}
            <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{initialBattle?.title || initialBattle?.topic || 'Battle'}</span>
              {lineupText && <span style={{ color: 'rgba(255,255,255,.5)', fontWeight: 700, fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lineupText}</span>}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', display: 'flex', alignItems: 'center', gap: 4 }}><UsersIcon size={11} color="rgba(255,255,255,.45)" />{viewerCount || participants.length}</span>
            {/* Minimize — park the battle on the Now-Studying bar. The engine
                keeps running while it's parked, so this is non-destructive;
                hidden once completed (nothing left to continue). */}
            {onMinimize && !isCompleted && (
              <button onClick={onMinimize} aria-label={t('now.minimize')} title={t('now.minimize')}
                style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,.10)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.6)" strokeWidth="2.6" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            )}
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
                          <div style={{ width: 44, height: 44, borderRadius: '50%', background: `${teacher.agentColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 0 16px ${teacher.agentColor}66` }}><AgentAvatar emoji={teacher.agentEmoji} size={29}/></div>
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
                    {me?.streak >= 2 && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: 'rgba(249,115,22,.20)', color: "#FB923C", display: "inline-flex", alignItems: "center", gap: 2 }}><Icon name="ti-flame" size={10} color="#FB923C"/>{me.streak}× streak</span>}
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
                        <div key={i} style={{ ...optBtn, border, background: bg, color, cursor: 'default' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid rgba(255,255,255,.20)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.45)', flexShrink: 0 }}>{['A', 'B', 'C', 'D', 'E'][i]}</span>{opt}
                          </span>
                          {pickers.length > 0 && (
                            <span style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                              {pickers.map((a, j) => <span key={j} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: a.userId === myId ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.08)', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 4 }}><AgentAvatar emoji={a.agentEmoji} size={11}/> {a.userId === myId ? 'You' : a.agentName}</span>)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,.35)' }}>
                    {iAmParticipant && !isReview && (me?.hp ?? 100) <= 0
                      ? 'Your agent is out of HP — you are watching as a spectator'
                      : iAmParticipant
                      ? (isReview ? 'Your agent is working through your review' : 'Your agent is answering — watch it play')
                      : 'You + APOS + re watching this battle'}
                  </div>
                  {reveal?.judge && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)' }}>
                      <Icon name="ti-gavel" size={15} color={GOLD} />
                      <div style={{ fontSize: 12, lineHeight: 1.45, color: '#E2E8F0' }}><b style={{ color: GOLD }}>{reveal.judge.judge || 'Sergeant'}</b> · {reveal.judge.answer}{reveal.judge.why ? ` — ${reveal.judge.why}` : ''}</div>
                    </div>
                  )}
                  {myResult && <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12.5, fontWeight: 800, color: myResult.is_correct ? '#4ADE80' : '#F87171' }}>{myResult.is_correct ? <><Icon name="ti-check" size={12} color="#4ADE80"/> Your agent got it — +${myResult.xp_gained} XP</> : <><Icon name="ti-x" size={12} color="#F87171"/> Your agent got it wrong</>}</div>}
                </div>
              )}

              {isLive && !question && <div style={{ ...panel, textAlign: 'center', color: 'rgba(255,255,255,.4)', fontSize: 12.5 }}>Next question loading…</div>}

              {/* Review result — a review has no winner, so the panel below
                  rendered nothing at all for one: a finished review showed no
                  score and no XP, just an empty arena. */}
              {isCompleted && isReview && results?.type === 'review' && (
                <div style={{ ...panel, textAlign: 'center' }}>
                  <Icon name="ti-clipboard" size={34} color="rgba(255,255,255,.35)"/>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#F1F5F9', marginTop: 4 }}>
                    {results.score?.correct} of {results.score?.total} correct
                  </div>
                  <div style={{
                    fontSize: 26, fontWeight: 900, marginTop: 2,
                    color: (results.score?.percent ?? 0) >= 50 ? '#4ADE80' : '#F87171',
                  }}>{results.score?.percent}%</div>
                  {(results.score?.unanswered > 0) && (
                    <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.45)', marginTop: 3 }}>
                      {results.score.unanswered} not answered (no notes on it, no credit, or out of time)
                    </div>
                  )}
                  {results.battle?.duration_formatted && (
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>
                      Duration {results.battle.duration_formatted}
                    </div>
                  )}
                  {/* The per-question XP the agent earned along the way, plus
                      what the review paid at the end — one number, because a
                      learner does not care which half it came from. */}
                  {(myXp + (results.learner?.xpEarned ?? 0)) > 0 && (
                    <div style={{ display: 'inline-block', marginTop: 8, padding: '4px 14px', borderRadius: 20, background: 'rgba(232,136,74,.20)', color: '#E8884A', fontWeight: 800, fontSize: 13 }}>
                      +{myXp + (results.learner?.xpEarned ?? 0)} XP earned
                    </div>
                  )}
                  {/* Weakest topics first — the one thing a learner can act on. */}
                  {results.byTopic?.length > 1 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 12 }}>
                      {results.byTopic.slice(0, 4).map(t => (
                        <span key={t.topic} style={{
                          fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                          background: t.percent >= 50 ? 'rgba(16,185,129,.16)' : 'rgba(239,68,68,.14)',
                          color: t.percent >= 50 ? '#6EF7C8' : '#FCA5A5',
                        }}>{t.topic} {t.correct}/{t.total}</span>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 10 }}>
                    Every question is in the Questions tab
                  </div>
                </div>
              )}

              {/* Winner */}
              {isCompleted && winner && !isReview && (
                <div style={{ ...panel, textAlign: 'center' }}>
                  <TrophyIcon size={38} color={GOLD} />
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#F1F5F9', marginTop: 6 }}>{winner.agentName} wins!</div>
                  {over?.durationFormatted && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>Duration {over.durationFormatted}</div>}
                  {myXp > 0 && <div style={{ display: 'inline-block', marginTop: 8, padding: '4px 14px', borderRadius: 20, background: 'rgba(232,136,74,.20)', color: '#E8884A', fontWeight: 800, fontSize: 13 }}>+{myXp} XP earned</div>}
                  {(verdict || results?.judge?.verdict) && (
                    <div style={{ marginTop: 12, textAlign: 'left', display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)' }}>
                      <Icon name="ti-gavel" size={16} color={GOLD} />
                      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#E2E8F0' }}><b style={{ color: GOLD }}>Sergeant's verdict</b><br />{verdict || results.judge.verdict}</div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── STATS ── */}
          {tab === 'stats' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[['Your XP this battle', myXp, '#E8884A'], ['Questions answered', myAnswered, GREEN], ['Your streak', `${me?.streak || 0}`, GOLD], ['Viewers', viewerCount || participants.length, '#3B82F6']].map(([label, val, color]) => (
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
                    {entry.myPick != null && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, padding: '1px 8px', borderRadius: 20, background: entry.myCorrect ? 'rgba(16,185,129,.18)' : 'rgba(239,68,68,.18)', color: entry.myCorrect ? "#4ADE80" : "#F87171", display:"inline-flex",alignItems:"center",gap:3 }}><Icon name={entry.myCorrect ? "ti-check" : "ti-x"} size={10}/>{entry.myCorrect ? 'Correct' : 'Wrong'}</span>}
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
          {isLive && iAmParticipant && <span style={{ fontSize: 11, fontWeight: 700, color: '#E8884A', display: 'flex', alignItems: 'center', gap: 5 }}><ZapIcon size={11} color="#E8884A" />{isReview ? 'Your review — your agent is answering' : 'Your agent is playing'}</span>}
        </div>
      </div>
    </div>
  );
}
