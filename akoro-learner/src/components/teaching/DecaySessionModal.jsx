import { useState, useRef, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, STUDENT_ID } from '../../constants.js';
import { API,  apiPost } from '../../services/api.js';
import { AGENT_CONFIG, MOCK_DECAY_MESSAGES, autoObjectives, autoSubtopics } from '../../services/mockData.js';
import { buildDecayHistory, buildMockQueue } from '../../services/mockBlocks.js';
import SessionChatView from './SessionChatView.jsx';

function DecaySessionModal({ alert, onClose, agentProfile }) {
  const agentNm  = agentProfile?.name  || AGENT_CONFIG.name;
  const agentEm  = agentProfile?.emoji || AGENT_CONFIG.emoji;
  const subject  = alert.subject;
  const topic    = alert.topic;

  // Load history synchronously on first render — no blank screen wait
  const [sessionId, setSessionId] = useState(null);
  const [blocks,    setBlocks]    = useState(() => buildDecayHistory(alert, agentNm, agentEm));
  const [input,     setInput]     = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds,   setSeconds]   = useState(0);
  const [loading,   setLoading]   = useState(false);
  const [wsReady,   setWsReady]   = useState(false);
  const timerRef    = useRef(null);
  const wsRef       = useRef(null);
  const mockQueueRef = useRef([]);

  const userTurns = blocks.filter(b => b.type === "user" && !b.faded).length;
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  useEffect(() => {
    const decayConfig = { topic, subject, subtopics:[topic], objectives:{ [topic]: autoObjectives(topic, topic) } };
    mockQueueRef.current = buildMockQueue(decayConfig, agentNm, agentEm);

    // Connect WebSocket for streaming
    const WS_URL = (typeof VITE_API_URL !== "undefined" ? VITE_API_URL : "https://akoro.app");
    if (typeof window !== "undefined" && window.io) {
      const ws = window.io(WS_URL, { transports:["websocket","polling"] });
      wsRef.current = ws;

      ws.on("connect", () => {
        ws.emit("start_adaptive_session", {
          studentId:      STUDENT_ID,
          subject,        topic,
          mode:           "decay",
          notificationId: alert.id,
          userId:         STUDENT_ID,
        });
      });

      // New unified event
      ws.on("session_ready", d => {
        setSessionId(d.sessionId);
        setWsReady(true);
        if (d.historyBlocks?.length) setBlocks(d.historyBlocks);
      });
      // Backward compat
      ws.on("student_session_ready", d => { setSessionId(d.sessionId); setWsReady(true); });

      ws.on("typing_start", () => setLoading(true));

      ws.on("turn_complete", ({ blocks: newBlocks }) => {
        setLoading(false);
        if (newBlocks?.length) setBlocks(prev => [...prev, ...newBlocks]);
      });

      ws.on("student_done", () => {});
      ws.on("guide_done",   () => {});
      ws.on("error", err => { console.warn("[DecayModal WS]", err.message); setLoading(false); });
    } else {
      // No WS — try REST
      apiPost("/api/adaptive/decay/session/start", {
        studentId: STUDENT_ID, subject, topic, notificationId: alert.id,
      }).then(d => {
        if (d.sessionId) setSessionId(d.sessionId);
        if (d.historyBlocks?.length) setBlocks(d.historyBlocks);
      }).catch(()=>{});
    }

    return () => {
      wsRef.current?.emit("end_session");
      wsRef.current?.disconnect();
      clearInterval(timerRef.current);
    };
  }, []);

  const toggleRecording = () => {
    if (recording) {
      clearInterval(timerRef.current);
      setRecording(false);
      handleSend(`[🎙 Voice note – ${fmt(seconds)}] Explained verbally.`);
      setSeconds(0);
    } else {
      setRecording(true);
      timerRef.current = setInterval(() => setSeconds(s => s+1), 1000);
    }
  };

  const handleSend = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    if (!overrideText) setInput("");
    setBlocks(prev => [...prev, { type:"user", text }]);
    setLoading(true);

    // Use WebSocket if connected
    if (wsRef.current?.connected && wsReady) {
      wsRef.current.emit("teacher_message", { message: text });
      return;
    }

    // REST fallback — same teaching/message endpoint
    if (sessionId) {
      try {
        const data = await apiPost("/api/adaptive/teaching/message", {
          sessionId, message: text, studentId: STUDENT_ID,
        });
        if (data.blocks?.length) { setBlocks(prev=>[...prev,...data.blocks]); setLoading(false); return; }
      } catch { /* fall through */ }
    }

    // Mock fallback
    const next = mockQueueRef.current.shift();
    setTimeout(() => {
      if (next?.length) {
        setBlocks(prev => [...prev, ...next]);
      } else {
        const newConf = Math.min(alert.confidence + (userTurns+1)*12, 85);
        setBlocks(prev => [...prev, {
          type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Re-teach progress",
          text:`${agentNm} is rebuilding the knowledge. Address the ${alert.misconceptions?.[0]||"gap"} specifically.`,
        }, {
          type:"student-agent", agent:agentNm, emoji:agentEm,
          phase:`${agentNm} · re-learning · ${newConf}%`, confidence:newConf,
          text:`That clears things up. The distinction is becoming clearer now.`,
        }]);
      }
      setLoading(false);
    }, 800);
  };

  return (
    <SessionChatView
      blocks={blocks}
      loading={loading}
      input={input}
      onInputChange={setInput}
      onSend={handleSend}
      topic={topic}
      subject={subject}
      agentName={agentNm}
      agentEmoji={agentEm}
      mode="decay"
      userTurns={userTurns}
      showSummarize={false}
      recording={recording}
      onToggleRecording={toggleRecording}
      seconds={seconds}
      onClose={onClose}
    />
  );
}

/* ══════════════════════════════════ */

export default DecaySessionModal;
