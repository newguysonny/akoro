/**
 * useBattleModal — the battle arena's state, sockets, API calls and timers.
 *
 * Split out of BattleModal so the modal itself is only the shell (ticker,
 * header, tabs, footer). The JSX and every value it renders are unchanged.
 */
import { useState, useEffect, useRef } from 'react';
import { RED, GREEN, GOLD } from '../../../constants.js';
import { API, apiGet, apiPost } from '../../../services/api.js';
import { socketOptions } from '../../../client/socket';
import { useAuth } from '../../../contexts/AuthContext.jsx';
import { useLang } from '../../../contexts/LanguageContext.jsx';

const B = '/api/battle';
const mapStateP = (p) => ({
  userId: p.user_id ?? p.userId,
  agentName: p.user_agents?.agent_name ?? p.agentName ?? 'Agent',
  agentEmoji: p.user_agents?.agent_emoji ?? p.agentEmoji ?? '🤖',
  agentColor: p.user_agents?.agent_color ?? p.agentColor ?? '#7C3AED',
  role: p.role,
  score: p.score ?? 0, hp: p.hp ?? 100, streak: p.current_streak ?? p.streak ?? 0,
});

export default function useBattleModal({ battle: initialBattle }) {
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
  // 'guide': a review the learner asked their teaching guide for (battle/guideReview.js).
  const [reviewHost,   setReviewHost]   = useState(initialBattle?.reviewHost ?? null);
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
        if (st.reviewHost) setReviewHost(st.reviewHost);
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
    const s = window.io(API, socketOptions({ portal: 'student' }));
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
      // My agent's answer comes in the reveal — the learner never taps, so
      // `selected` stays empty and the Questions tab showed no pick at all.
      const mine = (d.answers || []).find((a) => a.userId === myIdRef.current);
      const myPick = mine?.selectedIndex ?? selectedRef.current;
      if (mine) {
        setSelected(mine.selectedIndex);
        setMyResult({ is_correct: !!mine.isCorrect, xp_gained: mine.xpGained || 0 });
        if (mine.isCorrect && mine.xpGained) setMyXp((x) => x + mine.xpGained);
      }
      setQuestion((q) => { if (q && q.questionOrder === d.questionOrder) recordAnswered(q, d.correctIndex, myPick); return q; });
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
  const myIdRef = useRef(null); myIdRef.current = myId;
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
      if (st?.reviewHost) setReviewHost(st.reviewHost);
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
  // An Agent Check (D45) reads like a review: one seat, a mark sheet, no
  // winner — the agent answers from the learner's notes.
  const isCheck = battleType === 'check';
  const isReview = battleType === 'review' || isCheck;
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
  const isCompletedStatus = status === 'completed';
  const sorted = [...participants].filter((p) => p.role !== 'teacher').sort((a, b) => b.score - a.score || b.hp - a.hp);
  const me  = participants.find((p) => p.userId === myId);
  const A   = me || sorted[0];
  const Bp  = participants.find((p) => p.userId !== myId && p.role !== 'teacher') || sorted[1];
  const teacher  = participants.find((p) => p.role === 'teacher');
  // Final standings go by the rank the battle gave — a knocked-out agent is
  // unranked and sits below everyone ranked, whatever its score.
  const finalRank = new Map(((results?.scoreboard || over?.finalScores) || []).map((r) => [r.userId, r.rank]));
  const byStanding = (a, b) => {
    if (isCompletedStatus && finalRank.size) {
      const ra = finalRank.get(a.userId) ?? Infinity, rb = finalRank.get(b.userId) ?? Infinity;
      if (ra !== rb) return ra - rb;
    }
    return b.score - a.score || b.hp - a.hp;
  };
  const students = participants.filter((p) => p !== teacher).sort(byStanding);
  const curOrder = question?.questionOrder ?? (answered.length ? Math.max(...answered.map((a) => a.order)) : 0);

  const startBattle = async () => {
    try { await apiPost(`${B}/battles/${battleId}/start`, {}); setNotice('Starting…'); }
    catch (e) { setNotice(/404/.test(e.message) ? 'Only the creator can start' : e?.message || 'Could not start'); }
  };

  const isLive = status === 'live';
  const isCompleted = status === 'completed';
  const scoreboard = results?.scoreboard;
  // Only a real winner: none when every agent was knocked out, in a team tie, or a review.
  const winner = (results?.winner?.agentName ? results.winner : null) || (over?.winner?.agentName ? over.winner : null);
  const judgeVerdict = verdict || results?.judge?.verdict || null;
  const timerPct = totalQ ? (timer / Math.max(1, Math.round((question?.timeLimitMs || 15000) / 1000))) * 100 : 0;
  const timerColor = timer > 8 ? GREEN : timer > 4 ? GOLD : RED;

  // Ticker fed by the real event log (falls back to a couple of lines).
  const tickerBase = log.length ? log.slice(-8).map((l) => l.msg) : ['Live knowledge battle in progress', 'Answer fast to earn bonus XP', 'Agents compete on your class curriculum'];
  const tickerItems = [...tickerBase, ...tickerBase];

  const myAnswered = answered.length;
  const myAccuracy = myAnswered ? Math.round((answered.filter((a) => a.myCorrect).length / myAnswered) * 100) : 0;

  return {
    status, participants, question, reveal, selected, myResult, myXp, timer, log, answered,
    over, results, viewerCount, totalQ, tab, setTab, notice, battleType, reviewHost, verdict,
    battleId, myId, initialBattle, logRef, t,
    iAmParticipant, isCheck, isReview, isClassroom, lineupText, isCompletedStatus,
    sorted, me, A, Bp, teacher, students, curOrder,
    startBattle, isLive, isCompleted, scoreboard, winner, judgeVerdict,
    timerPct, timerColor, tickerItems, myAnswered, myAccuracy,
  };
}
