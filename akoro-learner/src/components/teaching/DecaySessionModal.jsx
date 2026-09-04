import { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import { BRAND, RED, GREEN, GOLD, STUDENT_ID } from '../../constants.js';
import { acquireActivityLock } from '../../utils/activityLock.js';
import { API } from '../../services/api.js';
const AGENT_CONFIG = { name: '', emoji: '🤖' };
import SessionChatView from './SessionChatView.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';

function DecaySessionModal({ alert, onClose, agentProfile }) {
  // Hold the activity lock so an auto-reload can't interrupt a decay session.
  useEffect(() => acquireActivityLock(), []);
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
  const [prepNote, setPrepNote] = useState('');   // shown while the lesson is being prepared
  const [input,     setInput]     = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds,   setSeconds]   = useState(0);
  const [loading,   setLoading]   = useState(false);
  const [wsReady,   setWsReady]   = useState(false);
  // Socket lifecycle for the connection chip: "connecting" | "connected" | "reconnecting"
  const [connState, setConnState] = useState("connecting");
  const timerRef    = useRef(null);
  const wsRef       = useRef(null);
  const sessionIdRef = useRef(null);   // live session id — drives seamless resume on reconnect
  const pendingSendRef = useRef(null); // message typed during a drop — flushed on reconnect

  const userTurns = blocks.filter(b => b.type === "user" && !b.faded).length;
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  useEffect(() => {
    // Connect WebSocket for streaming. Import the socket client directly
    // (don't depend on a global window.io that may be unset in some builds).
    const connect = io || (typeof window !== "undefined" ? window.io : null);
    if (connect) {
      const ws = connect(API, { transports:["websocket","polling"], withCredentials:true });
      wsRef.current = ws;

      const startSession = () => ws.emit("start_adaptive_session", {
        studentId:      STUDENT_ID,
        subject,        topic,
        mode:           "decay",
        notificationId: alert.id,
        userId:         STUDENT_ID,
      });

      ws.on("connect", () => {
        setConnState("connected");
        // Seamless resume on reconnect — re-bind to the surviving orchestrator
        // rather than restarting the re-teach.
        if (sessionIdRef.current) {
          ws.emit("resume_session", {
            sessionId: sessionIdRef.current,
            studentId: STUDENT_ID,
            userId:    STUDENT_ID,
          });
        } else {
          startSession();
        }
      });

      ws.on("session_resumed", () => {
        setWsReady(true); setInitLoading(false);
        const p = pendingSendRef.current;
        if (p) { pendingSendRef.current = null; ws.emit("teacher_message", { message: p.text }); }
      });

      ws.on("resume_failed", () => {
        sessionIdRef.current = null;
        setBlocks(prev => prev.length
          ? [...prev, { type:"system-divider", label:"Reconnected — starting a new session" }]
          : prev);
        startSession();
      });

      // Connection dropped or failing — show a reconnecting chip. Socket.IO
      // auto-reconnects and re-fires "connect" on success.
      ws.on("disconnect",    () => { setConnState("reconnecting"); setLoading(false); });
      ws.on("connect_error", () => setConnState("reconnecting"));
      ws.io?.on?.("reconnect_attempt", () => setConnState("reconnecting"));

      // New unified event
      // Server acks immediately — show progress instead of a blank wait.
      ws.on("session_preparing", d => setPrepNote(`Preparing your lesson on ${d.topic}…`));
      ws.on("session_ready", d => {
        setSessionId(d.sessionId);
        sessionIdRef.current = d.sessionId;
        setWsReady(true);
        setInitLoading(false); setPrepNote('');
        const gName  = d.guideProfile?.name  || "NaNa Esumai";
        const gEmoji = d.guideProfile?.emoji || "🧠";
        const opening = d.openingBlocks?.length
          ? d.openingBlocks
          : d.message
          ? [{ type:"guide", agent:gName, emoji:gEmoji, phase:"Revision · ready", text:d.message }]
          : [];
        if (d.historyBlocks?.length) setBlocks(prev => [...prev.filter(b => !b.faded), ...d.historyBlocks, ...opening]);
        else if (opening.length) setBlocks(prev => prev.length ? [...prev, ...opening] : opening);

        // Flush a message typed during the drop, if any.
        const p = pendingSendRef.current;
        if (p) { pendingSendRef.current = null; ws.emit("teacher_message", { message: p.text }); }
      });
      // Backward compat
      ws.on("student_session_ready", d => { setSessionId(d.sessionId); sessionIdRef.current = d.sessionId; setWsReady(true); setInitLoading(false); });

      ws.on("typing_start", () => setLoading(true));

      ws.on("turn_complete", ({ blocks: newBlocks }) => {
        setLoading(false);
        if (newBlocks?.length) setBlocks(prev => [...prev, ...newBlocks]);
      });

      ws.on("student_done", () => {});
      ws.on("guide_done",   () => {});
      ws.on("error", err => {
        console.warn("[DecayModal WS]", err.message);
        setLoading(false);
        if (!sessionIdRef.current) {
          setInitLoading(false);
          setBlocks(prev => prev.some(b => b.type === "system-divider") ? prev : [...prev, {
            type:"system-divider",
            label: err?.message ? `Couldn't start the session: ${err.message}` : "Couldn't start the session. Please try again.",
          }]);
        }
      });
    } else {
      // No realtime transport available — the session can't run.
      setInitLoading(false);
      setConnState("reconnecting");
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

    // Not connected right now. With a resumable session, hold the message and
    // send it on reconnect; otherwise surface an honest failure.
    if (sessionIdRef.current) {
      pendingSendRef.current = { text };
      return;
    }
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
      connState={connState}
      onClose={onClose}
    />
  );
}

/* ══════════════════════════════════ */

export default DecaySessionModal;
