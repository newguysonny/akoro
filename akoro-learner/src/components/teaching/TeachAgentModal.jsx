import { useState, useRef, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, STUDENT_ID } from '../../constants.js';
import { API, apiGet } from '../../services/api.js';
const AGENT_CONFIG = { name: '', emoji: '🤖', guideName: 'NaNa Esumai', guideEmoji: '🧠', guideRenderStyle: {} };
import { XIcon, SparkleIcon, ZapIcon, BrainIcon } from '../common/Icons.jsx';
import SessionChatView from './SessionChatView.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';

function TeachAgentModal({ session, config, onClose }) {
  const { t } = useLang();
  const topic     = config?.topic    || session?.topic    || "your topic";
  const subject   = config?.subject  || session?.subject  || "science";
  const agentNm   = config?.agentName  || AGENT_CONFIG.name;
  const agentEm   = config?.agentEmoji || AGENT_CONFIG.emoji;
  const guideNm   = config?.guideName   || session?.guideName   || AGENT_CONFIG.guideName   || "NaNa Esumai";
  const guideEm   = config?.guideEmoji  || session?.guideEmoji  || AGENT_CONFIG.guideEmoji  || "🧠";
  const guideRS   = config?.guideRenderStyle || session?.guideRenderStyle || AGENT_CONFIG.guideRenderStyle || {};
  const ttsVoice  = "nova";   // student AI agent voice — consistent across all teachers
  const mode      = config?.mode || session?.mode || "fresh";
  const prevSessId = config?.sessionId || config?.id || session?.id || null;

  const [sessionId,  setSessionId]  = useState(null);
  // The session is driven entirely over the WebSocket (start_adaptive_session →
  // session_ready, teacher_message → turn_complete, request_summary →
  // session_summary). Blocks start empty and a loading state shows until the
  // server responds — no REST, no fabricated content.
  const [blocks,     setBlocks]     = useState([]);
  const [initLoading, setInitLoading] = useState(true);
  const [input,      setInput]      = useState("");
  const [recording,  setRecording]  = useState(false);
  const [seconds,    setSeconds]    = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [activeTab,  setActiveTab]  = useState("chat");
  const [summary,    setSummary]    = useState(null);
  const [summaryErr, setSummaryErr] = useState("");
  const [wsReady,    setWsReady]    = useState(false);
  // Socket lifecycle for the connection chip: "connecting" | "connected" | "reconnecting"
  const [connState,  setConnState]  = useState("connecting");
  const timerRef      = useRef(null);
  const wsRef         = useRef(null);
  const sessionIdRef  = useRef(null);   // live session id — drives seamless resume on reconnect
  const pendingSendRef = useRef(null);  // message typed during a drop — flushed on reconnect
  const mediaRef      = useRef(null);    // MediaRecorder — audio (blob) mode
  const voiceMediaRef = useRef(null);    // PCM capture handle — voice (streaming) mode
  const voiceReadyRef = useRef(false);   // backend STT connection open
  const chunksRef     = useRef([]);
  // How the human delivered their last message: 'text' | 'audio' | 'live'.
  // The agent mirrors this — text gets text, voice gets voice.
  const lastModalityRef = useRef("text");
  const speakSeqRef     = useRef(0);     // bumped per turn — stops stale speech queues

  // Streaming TTS refs
  const ttsAudioRef = useRef(null);   // current <audio> element
  const ttsMsRef    = useRef(null);   // MediaSource
  const ttsSbRef    = useRef(null);   // SourceBuffer
  const ttsQueueRef = useRef([]);     // pending ArrayBuffers while SourceBuffer is busy
  const ttsDoneRef  = useRef(false);  // server signalled stream complete

  const stopTts = () => {
    wsRef.current?.emit("stop_tts_stream");
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      try { URL.revokeObjectURL(ttsAudioRef.current.src); } catch {}
      ttsAudioRef.current = null;
    }
    ttsMsRef.current    = null;
    ttsSbRef.current    = null;
    ttsQueueRef.current = [];
    ttsDoneRef.current  = false;
  };

  const streamTts = (text, seq) => {
    if (!wsRef.current?.connected || !text) return;
    stopTts();

    const ms    = new MediaSource();
    const audio = new Audio();
    ttsAudioRef.current = audio;
    ttsMsRef.current    = ms;
    ttsQueueRef.current = [];
    ttsDoneRef.current  = false;

    audio.src = URL.createObjectURL(ms);

    ms.addEventListener("sourceopen", () => {
      let sb;
      try { sb = ms.addSourceBuffer("audio/mpeg"); }
      catch { return; }
      ttsSbRef.current = sb;

      const flush = () => {
        if (sb.updating || ttsQueueRef.current.length === 0) return;
        sb.appendBuffer(ttsQueueRef.current.shift());
      };

      sb.addEventListener("updateend", () => {
        if (ttsSbRef.current !== sb) return;
        if (ttsQueueRef.current.length > 0) { flush(); return; }
        if (ttsDoneRef.current && !sb.updating) {
          try { ms.endOfStream(); } catch {}
        }
      });

      // Drain anything queued before sourceopen fired
      flush();
    }, { once: true });

    audio.play().catch(() => {});
    wsRef.current.emit("start_tts_stream", { text, voice: ttsVoice, seq });
  };

  const maybeSpeak = (text) => {
    if (lastModalityRef.current !== "text" && text) streamTts(text, speakSeqRef.current);
  };

  const [voiceStreaming, setVoiceStreaming] = useState(false);
  const [interimText,    setInterimText]   = useState("");     // audio chunks
  const [cogState,       setCogState]      = useState(null);   // live cognitive state

  // Mid-session teacher switching
  const [guide,        setGuide]        = useState({ name: guideNm, emoji: guideEm });
  const [currentPair,  setCurrentPair]  = useState("nana-esumai");
  const [switchOpen,   setSwitchOpen]   = useState(false);
  const [switching,    setSwitching]    = useState(false);
  const [agentChoices, setAgentChoices] = useState(null);   // null = not yet loaded

  const userTurns = blocks.filter(b => b.type === "user" && !b.faded).length;
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  useEffect(() => {
    // Connect WebSocket — the session lives entirely here.
    if (typeof window !== "undefined" && window.io) {
      const ws = window.io(API, { transports:["websocket","polling"] });
      wsRef.current = ws;

      const startSession = () => ws.emit("start_adaptive_session", {
        studentId:      STUDENT_ID,
        topic,          subject,
        mode,
        sessionId:      prevSessId,
        teacherAgentId: config?.teacherAgentId || session?.teacherAgentId || AGENT_CONFIG.teacherAgentId,
        userId:         STUDENT_ID,
      });

      ws.on("connect", () => {
        setConnState("connected");
        // Seamless resume: if we already have a live session, re-bind to it
        // instead of starting a fresh one. The backend keeps the orchestrator
        // alive through a short grace window after a drop.
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

      // Resumed onto the same orchestrator — local blocks are already intact,
      // so just re-enable sending and flush any message typed during the drop.
      ws.on("session_resumed", () => {
        setWsReady(true); setInitLoading(false);
        const p = pendingSendRef.current;
        if (p) { pendingSendRef.current = null; ws.emit("teacher_message", { message: p.text, modality: p.modality }); }
      });

      // Orchestrator gone (server restart / different instance / grace expired)
      // — fall back to a fresh session, marking the break in the transcript.
      ws.on("resume_failed", () => {
        sessionIdRef.current = null;
        setBlocks(prev => prev.length
          ? [...prev, { type:"system-divider", label:"Reconnected — starting a new session" }]
          : prev);
        startSession();
      });

      // Connection dropped or failing — surface a reconnecting chip. Socket.IO
      // auto-reconnects; on success the "connect" handler above resumes.
      ws.on("disconnect",     () => { setConnState("reconnecting"); setLoading(false); });
      ws.on("connect_error",  () => setConnState("reconnecting"));
      ws.io?.on?.("reconnect_attempt", () => setConnState("reconnecting"));

      ws.on("session_ready", d => {
        setSessionId(d.sessionId);
        sessionIdRef.current = d.sessionId;
        setWsReady(true);
        setInitLoading(false);
        const gName  = d.guideProfile?.name  || guideNm;
        const gEmoji = d.guideProfile?.emoji || guideEm;
        if (d.guideProfile?.name) setGuide({ name: d.guideProfile.name, emoji: gEmoji });
        if (d.agentPairId) setCurrentPair(d.agentPairId);

        // Prefer the structured opening (subtopic header + phase plan +
        // objectives checklist + guide card) the backend now sends; fall back
        // to a single guide block from the opening message if absent.
        const opening = d.openingBlocks?.length
          ? d.openingBlocks
          : d.message
          ? [{ type:"guide", agent:gName, emoji:gEmoji, phase:"Teach · ready", text:d.message }]
          : [];

        if (d.historyBlocks?.length) {
          setBlocks(prev => {
            const fresh = prev.filter(b => !b.faded && b.type !== "system-divider");
            return [...d.historyBlocks, { type:"system-divider", label:"Continuing from here" }, ...fresh, ...opening];
          });
        } else if (opening.length) {
          // Append (not replace) when a transcript already exists — e.g. a
          // fresh start after resume_failed should keep the prior messages.
          setBlocks(prev => prev.length ? [...prev, ...opening] : opening);
        }

        // Flush a message the user typed during the drop, if any.
        const p = pendingSendRef.current;
        if (p) { pendingSendRef.current = null; ws.emit("teacher_message", { message: p.text, modality: p.modality }); }
      });

      // Backward compat
      ws.on("student_session_ready", d => { setSessionId(d.sessionId); sessionIdRef.current = d.sessionId; setWsReady(true); setInitLoading(false); });

      // Summary delivered over the socket (replaces REST /teaching/summary).
      ws.on("session_summary", ({ summary }) => { setSummary(summary); setLoading(false); });
      ws.on("summary_error", ({ message }) => {
        console.warn("[TeachModal] summary failed:", message);
        setLoading(false);
        setSummaryErr("We couldn't generate your session summary right now. Please try again.");
      });

      ws.on("typing_start", () => setLoading(true));
      ws.on("turn_complete", ({ blocks: newBlocks, currentPhase }) => {
        setLoading(false);
        if (newBlocks?.length) {
          setBlocks(prev => [...prev, ...newBlocks]);
          // TTS only when the human used voice — modality mirrors input.
          const agentBlock = newBlocks.find(b => b.type === "student-agent");
          maybeSpeak(agentBlock?.text);
          // Instant understanding read from the agent block; confusion comes
          // from the authoritative state snapshot we request below.
          if (agentBlock?.confidence != null)
            setCogState(prev => ({ ...prev, understanding: agentBlock.confidence, phase: currentPhase ?? prev?.phase }));
        }
        ws.emit("get_state");   // pull full cognitive snapshot for this turn
      });

      // Live cognitive state — both the push (state_update) and the
      // explicit snapshot (state_snapshot) resolve to the same shape.
      const applyState = (state) => {
        if (!state) return;
        const c = state.cognitive || state;
        setCogState(prev => ({
          understanding: c.understanding ?? prev?.understanding ?? 0,
          confusion:     c.confusion     ?? prev?.confusion     ?? 0,
          phase:         state.session?.phase ?? prev?.phase ?? null,
        }));
      };
      ws.on("state_update",   (state) => applyState(state));
      ws.on("state_snapshot", ({ state }) => applyState(state));

      // ── Mid-session teacher switching ──────────────────────────
      ws.on("agent_pair_switching", () => { setSwitching(true); setLoading(true); });
      ws.on("agent_pair_switched", d => {
        setSwitching(false);
        setLoading(false);
        setSwitchOpen(false);
        stopTts();                       // silence the previous teacher
        if (d.guideProfile?.name) setGuide({ name: d.guideProfile.name, emoji: d.guideProfile.emoji || "🧠" });
        if (d.agentPairId) setCurrentPair(d.agentPairId);
        const newGuideName = d.guideProfile?.name || "your guide";
        setBlocks(prev => [
          ...prev,
          { type:"system-divider", label:`Switched to ${newGuideName}` },
          ...(d.message ? [{ type:"guide", agent:newGuideName, emoji:d.guideProfile?.emoji || "🧠",
              phase:"New teacher · ready", text:d.message }] : []),
        ]);
      });
      ws.on("student_done", ()=>{});
      ws.on("guide_done",   ()=>{});
      ws.on("error", err => {
        console.warn("[TeachModal WS]", err.message);
        setLoading(false); setSwitching(false);
        // If the session never came up, surface the failure instead of leaving
        // the user on a silent spinner.
        if (!sessionIdRef.current) {
          setInitLoading(false);
          setBlocks(prev => prev.some(b => b.type === "system-divider") ? prev : [...prev, {
            type:"system-divider",
            label: err?.message ? `Couldn't start the session: ${err.message}` : "Couldn't start the session. Please try again.",
          }]);
        }
      });

      // ── Voice streaming events ─────────────────────────────────
      ws.on("voice_stream_ready", () => {
        // OpenAI realtime transcription open — start sending PCM chunks
        voiceReadyRef.current = true;
      });

      ws.on("voice_interim", ({ text, accumulated }) => {
        // Live grey text — words forming
        setInterimText((accumulated ? accumulated + " " : "") + text);
      });

      ws.on("voice_final", ({ accumulated }) => {
        // Sentence confirmed — update live display
        setInterimText(accumulated);
      });

      ws.on("voice_utterance_end", ({ transcript }) => {
        // Silence gap — update display
        setInterimText(transcript);
      });

      ws.on("voice_complete", ({ transcript }) => {
        // Stream closed — auto-submit transcript
        setVoiceStreaming(false);
        setInterimText("");
        if (transcript?.trim()) handleSend(transcript, "live");
      });

      ws.on("voice_error", ({ message }) => {
        console.warn("[voice stream]", message);
        setVoiceStreaming(false);
        setInterimText("");
      });

      // ── Streaming TTS events ───────────────────────────────────
      ws.on("tts_audio_chunk", ({ chunk, seq }) => {
        if (seq !== speakSeqRef.current) return;  // stale turn
        const bytes = Uint8Array.from(atob(chunk), c => c.charCodeAt(0));
        const sb    = ttsSbRef.current;
        if (!sb) {
          // sourceopen hasn't fired yet — queue for later flush
          ttsQueueRef.current.push(bytes.buffer);
          return;
        }
        if (sb.updating) {
          ttsQueueRef.current.push(bytes.buffer);
        } else {
          sb.appendBuffer(bytes.buffer);
        }
      });

      ws.on("tts_stream_done", ({ seq }) => {
        if (seq !== speakSeqRef.current) return;
        ttsDoneRef.current = true;
        const sb = ttsSbRef.current;
        if (sb && !sb.updating && ttsQueueRef.current.length === 0) {
          try { ttsMsRef.current?.endOfStream(); } catch {}
        }
      });

      ws.on("tts_stream_stopped", () => {
        // Backend confirmed abort — ensure local state is clean
        if (ttsAudioRef.current) {
          ttsAudioRef.current.pause();
          try { URL.revokeObjectURL(ttsAudioRef.current.src); } catch {}
          ttsAudioRef.current = null;
        }
        ttsMsRef.current  = null;
        ttsSbRef.current  = null;
        ttsDoneRef.current = false;
        ttsQueueRef.current = [];
      });

      ws.on("tts_error", ({ message }) => {
        console.warn("[tts stream]", message);
      });
    } else {
      // No realtime transport available — the session can't run.
      setInitLoading(false);
      setConnState("reconnecting");
    }

    return () => {
      stopTts();
      wsRef.current?.emit("end_session");
      wsRef.current?.disconnect();
      clearInterval(timerRef.current);
    };
  }, []);

  const toggleRecording = async () => {
    if (recording) {
      mediaRef.current?.stop();
      setRecording(false);
      clearInterval(timerRef.current);
      setSeconds(0);
    } else {
      stopTts(); // barge-in: stop agent speech before user records
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunksRef.current = [];
        const mr = new MediaRecorder(stream);
        mediaRef.current = mr;
        mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        mr.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          const blob = new Blob(chunksRef.current, { type:"audio/webm" });
          if (blob.size < 1000) return;
          setLoading(true);
          try {
            const form = new FormData();
            form.append("audio", blob, "voice.webm");
            const r = await fetch(`${API}/api/voice/transcribe`, {
              method:"POST", credentials:"include", body:form });
            const data = await r.json();
            const transcript = data.transcript?.trim();
            if (transcript) { setLoading(false); await handleSend(transcript, "audio"); }
            else setLoading(false);
          } catch { setLoading(false); }
        };
        mr.start();
        setRecording(true);
        setSeconds(0);
        timerRef.current = setInterval(() => {
          setSeconds(s => {
            if (s >= 179) { mr.stop(); setRecording(false); clearInterval(timerRef.current); return 0; }
            return s + 1;
          });
        }, 1000);
      } catch {
        setRecording(true);
        timerRef.current = setInterval(() => setSeconds(s => s+1), 1000);
      }
    }
  };

  // ── Voice streaming (OpenAI realtime transcription) ────────────
  // Captures raw PCM16 mono @ 24kHz — the format OpenAI realtime expects.
  const toggleVoiceStream = async () => {
    if (voiceStreaming) {
      voiceMediaRef.current?.stop();
      voiceMediaRef.current = null;
      wsRef.current?.emit("stop_voice_stream");
      setVoiceStreaming(false);
      setInterimText("");
      return;
    }
    stopTts(); // barge-in: stop agent speech before going live
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const ctx    = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      const source = ctx.createMediaStreamSource(stream);
      const proc   = ctx.createScriptProcessor(4096, 1, 1);

      proc.onaudioprocess = (e) => {
        if (!voiceReadyRef.current || !wsRef.current?.connected) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]));
          i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        const bytes = new Uint8Array(i16.buffer);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        wsRef.current.emit("voice_audio_chunk", { audio: btoa(bin) });
      };

      source.connect(proc);
      proc.connect(ctx.destination);

      voiceMediaRef.current = {
        stop() {
          voiceReadyRef.current = false;
          try { proc.disconnect(); source.disconnect(); } catch {}
          stream.getTracks().forEach(t => t.stop());
          ctx.close().catch(() => {});
        },
      };

      // Open OpenAI realtime on backend — chunks flow once voice_stream_ready fires
      wsRef.current?.emit("start_voice_stream");
      setVoiceStreaming(true);
      setInterimText("");
    } catch {
      console.warn("[voice stream] mic unavailable or WS offline");
    }
  };

  const handleSend = async (overrideText, modality = "text") => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    if (!overrideText) setInput("");
    lastModalityRef.current = modality;
    speakSeqRef.current += 1;            // invalidate any queued speech from the prior turn
    setBlocks(prev => [...prev, { type:"user", text, modality }]);
    setLoading(true);

    // The session runs entirely over the WebSocket.
    if (wsRef.current?.connected && wsReady) {
      wsRef.current.emit("teacher_message", { message: text, modality });
      return;
    }

    // Not connected right now. If we have a resumable session, hold the message
    // and send it the moment we reconnect — the chip shows "Reconnecting…" and
    // the spinner stays up. Otherwise surface an honest failure.
    if (sessionIdRef.current) {
      pendingSendRef.current = { text, modality };
      return;
    }
    setBlocks(prev => [...prev, {
      type:"system-divider",
      label:"Lost connection to your tutor. Please reopen the session to continue.",
    }]);
    setLoading(false);
  };

  // ── Agent switching ────────────────────────────────────────────
  const openSwitch = async () => {
    setSwitchOpen(true);
    if (agentChoices) return;            // cached
    try {
      const d = await apiGet(`/api/adaptive/marketplace/my-agents/${STUDENT_ID}`);
      const platform = (d.platformAgents || []).map(p => ({
        id: p.id, name: p.name, avatar: p.avatar || "🧠", subject: p.subject, kind: "platform",
      }));
      const trained = (d.purchasedAgents || []).map(p => ({
        id: p.id, name: p.name, avatar: p.avatar || "🎓", subject: p.subject, teacher: p.teacherName, kind: "trained",
      }));
      setAgentChoices([...platform, ...trained]);
      if (d.defaultPairId) setCurrentPair(prev => prev === "nana-esumai" ? d.defaultPairId : prev);
    } catch {
      setAgentChoices([{ id: "nana-esumai", name: "NaNa Esumai & Sargeant", avatar: "🧠", subject: "All subjects", kind: "platform" }]);
    }
  };

  const performSwitch = (pairId) => {
    if (pairId === currentPair || switching) { setSwitchOpen(false); return; }
    if (!wsRef.current?.connected) return;
    setSwitching(true);
    wsRef.current.emit("switch_agent_pair", { newAgentPairId: pairId, topic, userId: STUDENT_ID });
  };

  const generateSummary = () => {
    setActiveTab("summary");
    setSummaryErr("");
    // Summary is generated over the WebSocket; session_summary / summary_error
    // events (registered above) resolve it.
    if (wsRef.current?.connected && wsReady) {
      setSummary(null);
      setLoading(true);
      wsRef.current.emit("request_summary");
    } else {
      setSummaryErr("We couldn't reach your tutor to generate a summary. Please try again.");
    }
  };

  // Summary view — own fullscreen container
  if (activeTab === "summary") {
    const sc = SUBJECT_COLORS[subject?.toLowerCase()] || BRAND;
    return (
      <div style={{ position:"fixed",inset:0,zIndex:3000,background:"#080812",
        display:"flex",flexDirection:"column",fontFamily:"'Nunito',sans-serif" }}>
        <div style={{ display:"flex",alignItems:"center",background:"rgba(255,255,255,.04)",
          borderBottom:"1px solid rgba(255,255,255,.06)",paddingTop:52 }}>
          {["chat","summary"].map(tab=>(
            <button key={tab} onClick={()=>setActiveTab(tab)}
              style={{ flex:1,padding:"10px 0",background:"none",border:"none",cursor:"pointer",
                fontSize:12,fontWeight:activeTab===tab?800:600,
                color:activeTab===tab?sc:"#475569",
                borderBottom:`2px solid ${activeTab===tab?sc:"transparent"}`,
                fontFamily:"'Nunito',sans-serif",transition:"all .2s" }}>
              {tab==="chat" ? t('teaching.tab_chat') : t('teaching.tab_summary')}
            </button>
          ))}
          <div onClick={onClose} style={{ width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,.07)",
            display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",marginRight:12,flexShrink:0 }}>
            <XIcon size={15} color="#64748B"/>
          </div>
        </div>
        <div style={{ flex:1,overflowY:"auto",padding:"16px" }}>
          {loading&&!summary?(
            <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"60%",gap:16 }}>
              <div style={{ width:56,height:56,borderRadius:"50%",background:`${sc}22`,border:`2px solid ${sc}`,display:"flex",alignItems:"center",justifyContent:"center",animation:"pulse-dot 1.2s ease-in-out infinite" }}><SparkleIcon size={22} color={sc}/></div>
              <p style={{ fontSize:14,fontWeight:700,color:"#475569",margin:0 }}>{t('teaching.generating_summary')}</p>
            </div>
          ):summaryErr?(
            <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"60%",gap:14,padding:"0 24px",textAlign:"center" }}>
              <p style={{ fontSize:14,fontWeight:700,color:"#94A3B8",margin:0,lineHeight:1.6 }}>{summaryErr}</p>
              <button onClick={generateSummary} style={{ padding:"11px 22px",borderRadius:12,border:"none",background:`linear-gradient(135deg,${sc},${sc}CC)`,fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{t('common.retry') || 'Try again'}</button>
            </div>
          ):summary&&(
            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              <div style={{ background:`linear-gradient(135deg,${sc}22,${sc}10)`,border:`1.5px solid ${sc}30`,borderRadius:18,padding:"18px 16px" }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
                  <div><p style={{ fontSize:11,fontWeight:800,color:sc,margin:"0 0 3px",letterSpacing:.4 }}>{t('teaching.teaching_score')}</p><p style={{ fontSize:38,fontWeight:900,color:"#F1F5F9",margin:0,fontFamily:"monospace" }}>{summary.teachingScore}<span style={{ fontSize:16,color:"#475569" }}>/100</span></p></div>
                  <div style={{ textAlign:"right" }}><p style={{ fontSize:10,fontWeight:700,color:"#475569",margin:"0 0 4px" }}>{t('teaching.xp_earned')}</p><div style={{ display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end" }}><ZapIcon size={14} color={GOLD}/><span style={{ fontSize:20,fontWeight:900,color:GOLD }}>{summary.xpEarned}</span></div></div>
                </div>
              </div>
              <div style={{ background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"14px" }}>
                <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:8 }}><BrainIcon size={13} color={sc}/><span style={{ fontSize:10.5,fontWeight:800,color:sc,letterSpacing:.3 }}>{t('teaching.agent_feedback')}</span></div>
                <p style={{ fontSize:13,fontWeight:600,color:"#CBD5E1",margin:0,lineHeight:1.6 }}>{summary.agentFeedback}</p>
              </div>
              {summary.keyConcepts?.length>0&&(
                <div style={{ background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"14px" }}>
                  <p style={{ fontSize:10.5,fontWeight:800,color:"#94A3B8",margin:"0 0 10px",letterSpacing:.3 }}>{t('teaching.key_concepts')}</p>
                  <div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>{summary.keyConcepts.map((c,i)=><div key={i} style={{ background:`${sc}18`,border:`1px solid ${sc}30`,borderRadius:8,padding:"4px 11px" }}><span style={{ fontSize:11.5,fontWeight:700,color:sc }}>{c}</span></div>)}</div>
                </div>
              )}
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <div style={{ background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.20)",borderRadius:14,padding:"12px" }}><p style={{ fontSize:10,fontWeight:800,color:GREEN,margin:"0 0 8px",letterSpacing:.3 }}>{t('teaching.strengths')}</p>{summary.strengthAreas?.map((s,i)=><p key={i} style={{ fontSize:11.5,fontWeight:600,color:"#A7F3D0",margin:"0 0 4px",lineHeight:1.4 }}>· {s}</p>)}</div>
                <div style={{ background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.20)",borderRadius:14,padding:"12px" }}><p style={{ fontSize:10,fontWeight:800,color:GOLD,margin:"0 0 8px",letterSpacing:.3 }}>{t('teaching.gaps')}</p>{summary.gapsIdentified?.map((g,i)=><p key={i} style={{ fontSize:11.5,fontWeight:600,color:"#FDE68A",margin:"0 0 4px",lineHeight:1.4 }}>· {g}</p>)}</div>
              </div>
              <button onClick={onClose} style={{ padding:"13px",borderRadius:14,border:"none",background:`linear-gradient(135deg,${sc},${sc}CC)`,fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif",marginBottom:8 }}>{t('teaching.save_close')}</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Chat view — SessionChatView is the root, no wrapper needed
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
        mode={mode}
        userTurns={userTurns}
        showSummarize={userTurns >= 2 && !summary}
        onSummarize={generateSummary}
        recording={recording}
        onToggleRecording={toggleRecording}
        seconds={seconds}
        voiceStreaming={voiceStreaming}
        interimText={interimText}
        onToggleVoice={toggleVoiceStream}
        cognitive={cogState}
        guideLabel={`${guide.emoji} ${guide.name}`}
        onSwitchAgent={wsReady ? openSwitch : null}
        switching={switching}
        connState={connState}
        onClose={onClose}
      />

      {switchOpen && (
        <div onClick={() => !switching && setSwitchOpen(false)}
          style={{ position:"fixed",inset:0,zIndex:3200,background:"rgba(6,6,18,.6)",
            backdropFilter:"blur(5px)",display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:"#0F0F1C",width:"100%",maxWidth:540,maxHeight:"78vh",overflowY:"auto",
              borderRadius:"22px 22px 0 0",fontFamily:"'Nunito',sans-serif",
              animation:"sheet-up .28s cubic-bezier(.34,1.4,.6,1)",border:"1px solid rgba(255,255,255,.08)" }}>
            <div style={{ padding:"12px 0 4px",display:"flex",justifyContent:"center" }}>
              <div style={{ width:38,height:4,borderRadius:4,background:"rgba(255,255,255,.18)" }}/>
            </div>
            <div style={{ padding:"6px 18px 26px" }}>
              <p style={{ fontSize:16,fontWeight:900,color:"#F1F5F9",margin:"4px 0 3px" }}>{t('teaching.switch_teacher')}</p>
              <p style={{ fontSize:12,fontWeight:600,color:"#64748B",margin:"0 0 16px",lineHeight:1.5 }}>
                {t('teaching.switch_sub')}
              </p>
              {!agentChoices ? (
                [0,1].map(i => <div key={i} style={{ height:64,borderRadius:14,background:"rgba(255,255,255,.04)",marginBottom:9 }}/>)
              ) : (
                <div style={{ display:"flex",flexDirection:"column",gap:9 }}>
                  {agentChoices.map(a => {
                    const active = a.id === currentPair;
                    return (
                      <button key={a.id} onClick={() => performSwitch(a.id)} disabled={switching || active}
                        style={{ display:"flex",alignItems:"center",gap:12,textAlign:"left",
                          background:active?"rgba(108,59,255,.16)":"rgba(255,255,255,.04)",
                          border:`1.5px solid ${active?BRAND:"rgba(255,255,255,.08)"}`,borderRadius:14,
                          padding:"12px 14px",cursor:(switching||active)?"default":"pointer",width:"100%" }}>
                        <div style={{ width:42,height:42,borderRadius:12,flexShrink:0,display:"flex",
                          alignItems:"center",justifyContent:"center",fontSize:22,background:"rgba(255,255,255,.06)" }}>{a.avatar}</div>
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ fontSize:13.5,fontWeight:800,color:"#F1F5F9",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{a.name}</div>
                          <div style={{ fontSize:11,fontWeight:600,color:"#64748B",marginTop:2 }}>
                            {a.kind === "platform" ? t('teaching.platform_default') : (a.teacher ? `by ${a.teacher}` : t('teaching.trained_agent'))}{a.subject ? ` · ${a.subject}` : ""}
                          </div>
                        </div>
                        {active && <span style={{ fontSize:10,fontWeight:900,color:BRAND,background:`${BRAND}22`,padding:"3px 9px",borderRadius:20,flexShrink:0 }}>{t('teaching.current')}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}



export default TeachAgentModal;
