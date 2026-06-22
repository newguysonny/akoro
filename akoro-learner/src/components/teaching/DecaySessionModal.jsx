import { useState, useRef, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, STUDENT_ID } from '../../constants.js';
import { API,  apiPost } from '../../services/api.js';
const AGENT_CONFIG = { name: '', emoji: '🤖' };
import SessionChatView from './SessionChatView.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';

function DecaySessionModal({ alert, onClose, agentProfile }) {
  const { t } = useLang();
  const agentNm  = agentProfile?.name  || AGENT_CONFIG.name;
  const agentEm  = agentProfile?.emoji || AGENT_CONFIG.emoji;
  const subject  = alert.subject;
  const topic    = alert.topic;

  // The re-teach session is built by the backend (session_ready WebSocket
  // event or the REST /decay/session/start endpoint). Start empty.
  const [sessionId, setSessionId] = useState(null);
  const [blocks,    setBlocks]    = useState([]);
  const [initLoading, setInitLoading] = useState(true);
  const [input,     setInput]     = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds,   setSeconds]   = useState(0);
  const [loading,   setLoading]   = useState(false);
  const [wsReady,   setWsReady]   = useState(false);
  const timerRef    = useRef(null);
  const wsRef       = useRef(null);

  const userTurns = blocks.filter(b => b.type === "user" && !b.faded).length;
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  useEffect(() => {
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
        setInitLoading(false);
        if (d.historyBlocks?.length) setBlocks(d.historyBlocks);
      });
      // Backward compat
      ws.on("student_session_ready", d => { setSessionId(d.sessionId); setWsReady(true); setInitLoading(false); });

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
      }).catch(err => console.warn("[DecayModal] session start failed:", err.message))
        .finally(() => setInitLoading(false));
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
      handleSend(`[🎙 ${t('teaching.voice_note')} – ${fmt(seconds)}] ${t('teaching.explained_verbally')}`);
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
      } catch (err) {
        console.warn("[DecayModal] message failed:", err.message);
      }
    }

    // No live connection and no REST session — surface the failure honestly.
    setBlocks(prev => [...prev, {
      type:"system-divider",
      label:"Couldn't reach the tutor. Check your connection and try again.",
    }]);
    setLoading(false);
  };

  return (
    <SessionChatView
      blocks={blocks}
      loading={loading || (initLoading && blocks.length === 0)}
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
