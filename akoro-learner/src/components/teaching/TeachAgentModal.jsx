import { useState, useRef, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, STUDENT_ID } from '../../constants.js';
import { API, apiGet, apiPost } from '../../services/api.js';
import { buildInitialBlocks, buildMockQueue, buildContinuationHistory } from '../../services/mockBlocks.js';
const AGENT_CONFIG = { name: '', emoji: '🤖', guideName: 'NaNa Esumai', guideEmoji: '🧠', guideRenderStyle: {} };
import { XIcon, SparkleIcon, ZapIcon, BrainIcon } from '../common/Icons.jsx';
import SessionChatView from './SessionChatView.jsx';

function TeachAgentModal({ session, config, onClose }) {
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
  // Initialize blocks synchronously — never hang on API call
  const [blocks,     setBlocks]     = useState(() => {
    if (mode === "continuation" && prevSessId) {
      return buildContinuationHistory({
        topic, subject,
        id:            prevSessId,
        subtopicList:  session?.subtopicList  || config?.subtopics  || [],
        avgConfidence: session?.avgConfidence || session?.progress  || 70,
        daysSince:     session?.daysSince     || 0,
      }, agentNm, agentEm);
    }
    if (config) return buildInitialBlocks(config, agentNm, agentEm, guideNm, guideEm);
    return [
      { type:"guide", agent:guideNm, emoji:guideEm, phase:"Teach · ready",
        text:`Let's start teaching **${topic}**. Explain it as simply as possible.` },
      { type:"student-agent", agent:agentNm, emoji:agentEm,
        phase:`${agentNm} · ready to learn`, confidence:10,
        text:`I'm ready to learn about ${topic}. Please teach me!` },
    ];
  });
  const [input,      setInput]      = useState("");
  const [recording,  setRecording]  = useState(false);
  const [seconds,    setSeconds]    = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [activeTab,  setActiveTab]  = useState("chat");
  const [summary,    setSummary]    = useState(null);
  const [wsReady,    setWsReady]    = useState(false);
  const timerRef      = useRef(null);
  const wsRef         = useRef(null);
  const mockQueueRef  = useRef([]);
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

  const userTurns = blocks.filter(b => b.type === "user" && !b.faded).length;
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  useEffect(() => {
    if (config) mockQueueRef.current = buildMockQueue(config, agentNm, agentEm, guideNm, guideEm);

    // Background API call — blocks already shown, just replace if real data returns
    const loadAndInit = async () => {
      if (mode === "continuation" && prevSessId) {
        try {
          const data = await apiGet(`/api/adaptive/sessions/${prevSessId}/history`);
          if (data.historyBlocks?.length) {
            setBlocks([
              ...data.historyBlocks,
              { type:"system-divider", label:"Continuing from here" },
            ]);
          }
        } catch { /* keep mock history already shown */ }
      } else if (config) {
        // Fresh session — try to get real initial blocks from API
        try {
          const data = await apiPost("/api/adaptive/teaching/start", {
            topic, subject, subtopics: config.subtopics,
            objectives: config.objectives, studentId: STUDENT_ID,
          });
          if (data.sessionId) setSessionId(data.sessionId);
          if (data.blocks?.length) setBlocks(data.blocks);
        } catch { /* keep mock initial blocks already shown */ }
      }
    };
    loadAndInit();

    // Connect WebSocket
    const WS_URL = (typeof VITE_API_URL !== "undefined" ? VITE_API_URL : "https://akoro.app");
    if (typeof window !== "undefined" && window.io) {
      const ws = window.io(WS_URL, { transports:["websocket","polling"] });
      wsRef.current = ws;

      ws.on("connect", () => {
        ws.emit("start_adaptive_session", {
          studentId:      STUDENT_ID,
          topic,          subject,
          mode,
          sessionId:      prevSessId,
          teacherAgentId: config?.teacherAgentId || session?.teacherAgentId || AGENT_CONFIG.teacherAgentId,
          userId:         STUDENT_ID,
        });
      });

      ws.on("session_ready", d => {
        setSessionId(d.sessionId);
        setWsReady(true);
        if (d.historyBlocks?.length) {
          setBlocks(prev => {
            const fresh = prev.filter(b => !b.faded && b.type !== "system-divider");
            return [...d.historyBlocks, { type:"system-divider", label:"Continuing from here" }, ...fresh];
          });
        }
      });

      // Backward compat
      ws.on("student_session_ready", d => { setSessionId(d.sessionId); setWsReady(true); });

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
      ws.on("student_done", ()=>{});
      ws.on("guide_done",   ()=>{});
      ws.on("error", err => { console.warn("[TeachModal WS]", err.message); setLoading(false); });

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

    // Use WebSocket if connected
    if (wsRef.current?.connected && wsReady) {
      wsRef.current.emit("teacher_message", { message: text, modality });
      return;
    }

    // REST fallback
    if (sessionId) {
      try {
        const data = await apiPost("/api/adaptive/teaching/message", {
          sessionId, message: text, studentId: STUDENT_ID, modality,
        });
        if (data.blocks?.length) {
          setBlocks(prev=>[...prev,...data.blocks]);
          setLoading(false);
          const agentBlock = data.blocks.find(b => b.type === "student-agent");
          maybeSpeak(agentBlock?.text);
          return;
        }
      } catch { /* fall through to mock */ }
    }

    // Mock queue fallback
    const next = mockQueueRef.current.shift();
    setTimeout(() => {
      const responseBlocks = next || [{
        type:"guide", agent:guideNm, emoji:guideEm, phase:"Good progress",
        text:`${agentNm} is processing. Keep going — give a real-world example.`,
      }];
      setBlocks(prev => [...prev, ...responseBlocks]);
      setLoading(false);
      const agentBlock = responseBlocks.find(b => b.type === "student-agent");
      maybeSpeak(agentBlock?.text);
    }, 800);
  };

  const generateSummary = async () => {
    setActiveTab("summary");
    setLoading(true);
    if (sessionId) {
      try {
        const data = await apiPost("/api/adaptive/teaching/summary", { sessionId, studentId: STUDENT_ID });
        if (data.summary) { setSummary(data.summary); setLoading(false); return; }
      } catch { /* fall through */ }
    }
    setSummary({
      teachingScore: 72 + Math.floor(Math.random()*18),
      xpEarned:      80 + Math.floor(Math.random()*60),
      agentFeedback: `Good explanation of ${topic}! ${agentNm} picked up the key concepts well.`,
      keyConcepts:   config?.subtopics?.slice(0,3) || [topic],
      strengthAreas: ["Clear cause-and-effect explanations", "Good use of examples"],
      gapsIdentified:["Secondary interactions could be deeper", "Edge cases not explored"],
    });
    setLoading(false);
  };

  // Summary view — own fullscreen container
  if (activeTab === "summary") {
    const sc = SUBJECT_COLORS[subject?.toLowerCase()] || BRAND;
    return (
      <div style={{ position:"fixed",inset:0,zIndex:3000,background:"#080812",
        display:"flex",flexDirection:"column",fontFamily:"'Nunito',sans-serif" }}>
        <div style={{ display:"flex",alignItems:"center",background:"rgba(255,255,255,.04)",
          borderBottom:"1px solid rgba(255,255,255,.06)",paddingTop:52 }}>
          {["chat","summary"].map(t=>(
            <button key={t} onClick={()=>setActiveTab(t)}
              style={{ flex:1,padding:"10px 0",background:"none",border:"none",cursor:"pointer",
                fontSize:12,fontWeight:activeTab===t?800:600,
                color:activeTab===t?sc:"#475569",
                borderBottom:`2px solid ${activeTab===t?sc:"transparent"}`,
                fontFamily:"'Nunito',sans-serif",transition:"all .2s" }}>
              {t==="chat"?"💬 Teaching Chat":"✨ Session Summary"}
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
              <p style={{ fontSize:14,fontWeight:700,color:"#475569",margin:0 }}>Generating session summary…</p>
            </div>
          ):summary&&(
            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              <div style={{ background:`linear-gradient(135deg,${sc}22,${sc}10)`,border:`1.5px solid ${sc}30`,borderRadius:18,padding:"18px 16px" }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
                  <div><p style={{ fontSize:11,fontWeight:800,color:sc,margin:"0 0 3px",letterSpacing:.4 }}>TEACHING SCORE</p><p style={{ fontSize:38,fontWeight:900,color:"#F1F5F9",margin:0,fontFamily:"monospace" }}>{summary.teachingScore}<span style={{ fontSize:16,color:"#475569" }}>/100</span></p></div>
                  <div style={{ textAlign:"right" }}><p style={{ fontSize:10,fontWeight:700,color:"#475569",margin:"0 0 4px" }}>XP Earned</p><div style={{ display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end" }}><ZapIcon size={14} color={GOLD}/><span style={{ fontSize:20,fontWeight:900,color:GOLD }}>{summary.xpEarned}</span></div></div>
                </div>
              </div>
              <div style={{ background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"14px" }}>
                <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:8 }}><BrainIcon size={13} color={sc}/><span style={{ fontSize:10.5,fontWeight:800,color:sc,letterSpacing:.3 }}>AGENT FEEDBACK</span></div>
                <p style={{ fontSize:13,fontWeight:600,color:"#CBD5E1",margin:0,lineHeight:1.6 }}>{summary.agentFeedback}</p>
              </div>
              {summary.keyConcepts?.length>0&&(
                <div style={{ background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"14px" }}>
                  <p style={{ fontSize:10.5,fontWeight:800,color:"#94A3B8",margin:"0 0 10px",letterSpacing:.3 }}>📌 KEY CONCEPTS</p>
                  <div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>{summary.keyConcepts.map((c,i)=><div key={i} style={{ background:`${sc}18`,border:`1px solid ${sc}30`,borderRadius:8,padding:"4px 11px" }}><span style={{ fontSize:11.5,fontWeight:700,color:sc }}>{c}</span></div>)}</div>
                </div>
              )}
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <div style={{ background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.20)",borderRadius:14,padding:"12px" }}><p style={{ fontSize:10,fontWeight:800,color:GREEN,margin:"0 0 8px",letterSpacing:.3 }}>✅ STRENGTHS</p>{summary.strengthAreas?.map((s,i)=><p key={i} style={{ fontSize:11.5,fontWeight:600,color:"#A7F3D0",margin:"0 0 4px",lineHeight:1.4 }}>· {s}</p>)}</div>
                <div style={{ background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.20)",borderRadius:14,padding:"12px" }}><p style={{ fontSize:10,fontWeight:800,color:GOLD,margin:"0 0 8px",letterSpacing:.3 }}>⚡ GAPS</p>{summary.gapsIdentified?.map((g,i)=><p key={i} style={{ fontSize:11.5,fontWeight:600,color:"#FDE68A",margin:"0 0 4px",lineHeight:1.4 }}>· {g}</p>)}</div>
              </div>
              <button onClick={onClose} style={{ padding:"13px",borderRadius:14,border:"none",background:`linear-gradient(135deg,${sc},${sc}CC)`,fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif",marginBottom:8 }}>Save & Close Session</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Chat view — SessionChatView is the root, no wrapper needed
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
      onClose={onClose}
    />
  );
}



export default TeachAgentModal;
