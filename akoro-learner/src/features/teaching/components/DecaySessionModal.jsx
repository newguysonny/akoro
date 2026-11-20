import { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import { BRAND, RED, GREEN, GOLD } from '../../../constants.js';
import { acquireActivityLock } from '../../../utils/activityLock.js';
import { useWakeLock } from '../../../hooks/useWakeLock.js';
import { API } from '../../../services/api.js';
import { socketOptions } from '../../../client/socket';
const AGENT_CONFIG = { name: '', emoji: '🤖' };
import SessionChatView from './SessionChatView.jsx';
import WhiteboardModal from './WhiteboardModal.jsx';
import { useLang } from '../../../contexts/LanguageContext.jsx';

function DecaySessionModal({ alert, onClose, onMinimize, agentProfile, reviewWorkflowId = null }) {
  // Hold the activity lock so an auto-reload can't interrupt a decay session.
  useEffect(() => acquireActivityLock(), []);
  // Keep the screen awake through the revision session (no-op where the
  // Wake Lock API is unsupported).
  useWakeLock();
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
  // Streaming tokens for the turn in flight (same contract as TeachAgentModal).
  const [liveStudent, setLiveStudent] = useState(null);
  const [liveGuide,   setLiveGuide]   = useState(null);
  const clearLiveStream = () => { setLiveStudent(null); setLiveGuide(null); };
  // Socket lifecycle for the connection chip: "connecting" | "connected" | "reconnecting"
  const [connState, setConnState] = useState("connecting");
  const [boardOpen, setBoardOpen] = useState(false);   // sketchpad over the session
  const timerRef    = useRef(null);
  const wsRef       = useRef(null);
  // A minimized re-teach reopens with its live id: resume the surviving
  // orchestrator first; if the grace window has passed, continue from the
  // SAVED session row rather than restarting the re-teach cold.
  const sessionIdRef = useRef(alert?.resumeSessionId || null);   // live session id — resume on reconnect AND minimize→restore
  const pendingSendRef = useRef(null); // message typed during a drop — flushed on reconnect
  // True the moment the learner minimizes: the unmount cleanup must NOT end
  // the server session then — a park keeps it resumable.
  const parkedRef   = useRef(false);

  const userTurns = blocks.filter(b => b.type === "user" && !b.faded).length;
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  useEffect(() => {
    // Connect WebSocket for streaming. Import the socket client directly
    // (don't depend on a global window.io that may be unset in some builds).
    const connect = io || (typeof window !== "undefined" ? window.io : null);
    if (connect) {
      const ws = connect(API, socketOptions({ portal: "student" }));
      wsRef.current = ws;

      // The server derives the learner from the authenticated socket. Do not
      // send a browser-controlled user or student identifier with a lesson.
      // A parked session whose resume failed continues from its saved row —
      // the re-teach conversation must survive minimize — instead of
      // restarting the decay review from scratch.
      let resumeFailed = false;
      const parkedSid  = sessionIdRef.current;
      const startSession = () => ws.emit("start_adaptive_session", {
        subject,        topic,
        mode:           resumeFailed && parkedSid ? "continuation" : "decay",
        ...(resumeFailed && parkedSid ? { sessionId: parkedSid } : { notificationId: alert.id }),
        // The re-teaching step of a Decay Review (Phase 8): its end starts the review's last retest.
        ...(reviewWorkflowId ? { decayReviewWorkflowId: reviewWorkflowId } : {}),
      });

      ws.on("connect", () => {
        setConnState("connected");
        // Seamless resume on reconnect — re-bind to the surviving orchestrator
        // rather than restarting the re-teach.
        if (sessionIdRef.current) {
          ws.emit("resume_session", { sessionId: sessionIdRef.current });
        } else {
          startSession();
        }
      });

      ws.on("session_resumed", (d) => {
        setWsReady(true); setInitLoading(false);
        // Remounted from a minimize with empty local blocks — rebuild the
        // transcript from the saved history the resume carried. A mere
        // reconnect keeps its intact blocks.
        if (d?.historyBlocks?.length) setBlocks(prev => prev.length ? prev : d.historyBlocks);
        const p = pendingSendRef.current;
        if (p) { pendingSendRef.current = null; ws.emit("teacher_message", { message: p.text }); }
      });

      ws.on("resume_failed", () => {
        sessionIdRef.current = null;
        resumeFailed = !!parkedSid;
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
          ? [{ type:"guide", agent:gName, emoji:gEmoji, text:d.message }]
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

      // Streaming token feedback — protégé/guide replies draw as they are
      // generated; turn_complete replaces the live bubbles with real blocks.
      ws.on("student_token", (d) => setLiveStudent(prev => (prev || "") + (d?.token ?? d?.text ?? "")));
      ws.on("guide_token",   (d) => setLiveGuide(prev => (prev || "") + (d?.token ?? d?.text ?? "")));

      ws.on("turn_complete", ({ blocks: newBlocks }) => {
        setLoading(false);
        clearLiveStream();
        if (newBlocks?.length) setBlocks(prev => [...prev, ...newBlocks]);
      });

      ws.on("student_done", () => {});
      ws.on("guide_done",   () => {});
      ws.on("error", err => {
        console.warn("[DecayModal WS]", err.message);
        setLoading(false);
        clearLiveStream();
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
      // Only a real close ends the re-teach. A MINIMIZE parked it instead:
      // the transcript is already saved per turn and the disconnect grace
      // window keeps the orchestrator resumable — ending here would kill the
      // session the Now-Studying bar is about to offer back.
      if (!parkedRef.current) wsRef.current?.emit("end_session");
      wsRef.current?.disconnect();
      clearInterval(timerRef.current);
    };
  }, []);

  // ── Minimize = park, not end ──────────────────────────────────────────
  // The live context rides up to the parent so the bar restores THIS
  // session — resume it while the grace window holds, continue from its
  // saved history afterwards. Either way, nothing is lost.
  const handleMinimize = () => {
    parkedRef.current = true;
    if (sessionIdRef.current) wsRef.current?.emit("park_session");
    onMinimize?.({ sessionId: sessionIdRef.current, mode: "decay", topic, subject });
  };

  const toggleRecording = () => {
    if (recording) {
      clearInterval(timerRef.current);
      setRecording(false);
      handleSend(`[${t('teaching.voice_note')} – ${fmt(seconds)}] ${t('teaching.explained_verbally')}`);
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
    <>
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
      onMinimize={handleMinimize}
      recording={recording}
      onToggleRecording={toggleRecording}
      seconds={seconds}
      connState={connState}
      onOpenBoard={() => setBoardOpen(true)}
      liveStudent={liveStudent}
      liveGuide={liveGuide}
      onClose={onClose}
    />
    {boardOpen && <WhiteboardModal topic={topic} subject={subject} onClose={() => setBoardOpen(false)} />}
    </>
  );
}

/* ══════════════════════════════════ */

export default DecaySessionModal;
