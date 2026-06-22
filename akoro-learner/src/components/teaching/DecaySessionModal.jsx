import { useState, useRef, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, STUDENT_ID } from '../../constants.js';
import { API } from '../../services/api.js';
const AGENT_CONFIG = { name: '', emoji: '🤖' };
import SessionChatView from './SessionChatView.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';

function DecaySessionModal({ alert, onClose, agentProfile }) {
  const { t } = useLang();
  const agentNm  = agentProfile?.name  || AGENT_CONFIG.name;
  const agentEm  = agentProfile?.emoji || AGENT_CONFIG.emoji;
  const subject  = alert.subject;
  const topic    = alert.topic;

  // The re-teach session runs entirely over the WebSocket (mode "decay").
  // Start empty; session_ready populates it.
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
    if (typeof window !== "undefined" && window.io) {
      const ws = window.io(API, { transports:["websocket","polling"] });
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
        const gName  = d.guideProfile?.name  || "NaNa Esumai";
        const gEmoji = d.guideProfile?.emoji || "🧠";
        const opening = d.message
          ? [{ type:"guide", agent:gName, emoji:gEmoji, phase:"Re-teach · ready", text:d.message }]
          : [];
        if (d.historyBlocks?.length) setBlocks([...d.historyBlocks, ...opening]);
        else if (opening.length) setBlocks(opening);
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
      // No realtime transport available — the session can't run.
      setInitLoading(false);
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

    // The session runs entirely over the WebSocket.
    if (wsRef.current?.connected && wsReady) {
      wsRef.current.emit("teacher_message", { message: text });
      return;
    }

    // No live connection — surface the failure honestly.
    setBlocks(prev => [...prev, {
      type:"system-divider",
      label:"Lost connection to your tutor. Please reopen the session to continue.",
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
