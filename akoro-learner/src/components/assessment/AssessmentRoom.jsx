import { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import { BRAND, RED, GREEN, GOLD, getStudentId } from '../../constants.js';
import { acquireActivityLock } from '../../utils/activityLock.js';
import { API } from '../../services/api.js';
import { useProctoring } from '../../hooks/useProctoring.js';
import { useVoiceSession } from '../../hooks/useVoiceSession.js';
import VoiceExam from './VoiceExam.jsx';
import { XIcon } from '../common/Icons.jsx';

/**
 * AssessmentRoom — the proctored Session Assessment Gateway.
 *
 * Three phases:
 *   consent  → register the identity reference photo, then begin
 *   exam     → split view: webcam + proctor meter (left) / Sergeant Q&A (right)
 *   summary  → final cheat-aware verdict
 *
 * The proctoring hook captures frames locally and we forward them over the
 * same socket the Q&A runs on; the backend returns proctor_result (live meter)
 * and assessment_turn (Q&A) on that connection.
 */
function AssessmentRoom({ topic, subject, objectives = [], questionCount = 5, onClose }) {
  // Hold the activity lock so an auto-reload can't interrupt the assessment.
  useEffect(() => acquireActivityLock(), []);
  const [phase,   setPhase]   = useState("consent");   // consent | exam | summary
  const [blocks,  setBlocks]  = useState([]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [ready,   setReady]   = useState(false);
  const [progress, setProgress] = useState({ index: 0, total: questionCount });
  const [proctor, setProctor] = useState({ probability: 0, level: "clear", active: [], escalations: [] });
  const [summary, setSummary] = useState(null);
  const [terminated, setTerminated] = useState(null);
  const [refSaving, setRefSaving] = useState(false);

  const [voiceMode, setVoiceMode] = useState(false);
  const [lastAnswer, setLastAnswer] = useState("");   // echo the just-sent answer
  const wsRef = useRef(null);
  const assessIdRef = useRef(null);
  const pendingRef = useRef(null);   // answer awaiting a server turn (survives reconnects)
  const spokenRef = useRef(0);       // index of last block spoken aloud

  // Submit one answer (shared by text composer and voice transcript). We queue
  // it so a socket reconnect (which drops the server-side binding) can re-send
  // it after resume instead of silently losing it. The server echoes the user
  // block back in assessment_turn, so we don't add it optimistically.
  const submitAnswer = (text) => {
    const t = (text || "").trim();
    if (!t || !assessIdRef.current) return;   // no live session yet
    pendingRef.current = t;
    setLastAnswer(t);
    setLoading(true);
    wsRef.current?.emit("assessment_message", { message: t });
  };

  // Voice I/O over the same socket — auto-submits the spoken answer.
  const { listening, interim, speaking, voiceError, startListening, stopListening, speak, stopSpeaking, primeAudio } = useVoiceSession({
    wsRef,
    ttsVoice: "alloy",
    onTranscript: (text) => submitAnswer(text),
  });

  // When voice mode is on, read each new Sergeant question/feedback aloud.
  useEffect(() => {
    if (!voiceMode) return;
    for (let i = spokenRef.current; i < blocks.length; i++) {
      const b = blocks[i];
      if (b && (b.type === "question" || b.type === "sergeant" || b.type === "hint") && b.text) {
        speak(b.text);
      }
    }
    spokenRef.current = blocks.length;
  }, [blocks, voiceMode, speak]);

  const toggleVoiceMode = () => {
    setVoiceMode(v => {
      const next = !v;
      if (!next) { stopListening(); stopSpeaking(); }
      else { primeAudio(); spokenRef.current = blocks.length; }   // unlock TTS in this tap; don't replay backlog
      return next;
    });
  };

  // Local proctoring tier — only active once the exam is running.
  const { videoRef, canvasRef, status, signals, captureReference, FRAME_W, FRAME_H } = useProctoring({
    enabled: phase === "consent" || phase === "exam",
    onFrame: ({ frame, signals }) => {
      if (phase === "exam") wsRef.current?.emit("proctor_frame", { frame, signals });
    },
  });

  useEffect(() => {
    // Declare the portal so the socket auth middleware picks the student
    // session cookie — voice STT/TTS require an authenticated socket
    // (socket.data.user), unlike the text Q&A which does not.
    const ws = io(API, { transports: ["websocket", "polling"], withCredentials: true, auth: { portal: "student" } });
    wsRef.current = ws;

    // Mobile connections flap: on every (re)connect, re-bind the live session
    // on the server — otherwise answers/frames emitted after a blip are
    // attached to a socket the server doesn't associate with the assessment.
    ws.on("connect", () => {
      if (assessIdRef.current) ws.emit("resume_assessment", { assessmentId: assessIdRef.current });
    });

    ws.on("reference_saved", () => { setRefSaving(false); _beginExam(); });
    ws.on("assessment_ready", d => {
      assessIdRef.current = d.assessmentId;
      setReady(true);
      setBlocks(d.openingBlocks || []);
      setProgress({ index: 0, total: d.totalQuestions || questionCount });
    });
    ws.on("proctor_result", d => setProctor(d));
    ws.on("assessment_typing", () => setLoading(true));
    ws.on("assessment_turn", d => {
      setLoading(false);
      pendingRef.current = null;   // answer landed
      if (d.blocks?.length) setBlocks(prev => [...prev, ...d.blocks]);
      if (d.progress) setProgress(d.progress);
    });
    // A reconnect re-binds the socket to the live session; re-send any answer
    // that was dropped mid-flight so the exam never stalls on a network blip.
    ws.on("assessment_resumed", () => {
      if (pendingRef.current) ws.emit("assessment_message", { message: pendingRef.current });
    });
    ws.on("assessment_summary", d => { setSummary(d); setPhase("summary"); setLoading(false); });
    ws.on("assessment_terminated", d => { setTerminated(d); });
    ws.on("assessment_error", e => {
      console.warn("[assessment]", e.message);
      setLoading(false);
      // Surface it in the chat instead of failing silently; a dropped session
      // also triggers an immediate resume attempt.
      if (e.code === "no_session" && assessIdRef.current) {
        ws.emit("resume_assessment", { assessmentId: assessIdRef.current });
      }
      if (e.message) setBlocks(prev => [...prev, { type: "proctor-flag", text: e.message }]);
    });

    return () => { ws.emit("end_assessment"); ws.disconnect(); };
  }, []);

  // ── Identity registration → start ──────────────────────────
  const registerAndStart = () => {
    // This tap is the user gesture that unlocks TTS playback — prime it now and
    // run the exam in voice-agent mode (questions read aloud automatically).
    primeAudio();
    setVoiceMode(true);
    spokenRef.current = blocks.length;
    const img = captureReference();
    if (!img) { _beginExam(); return; }   // no camera — proceed without identity
    setRefSaving(true);
    wsRef.current?.emit("register_reference", { studentId: getStudentId(), image: img });
  };

  const _beginExam = () => {
    setPhase("exam");
    const sid = getStudentId();
    wsRef.current?.emit("start_assessment", {
      studentId: sid, topic, subject, objectives, questionCount, userId: sid,
    });
  };

  const handleSend = () => {
    if (!input.trim() || loading || !assessIdRef.current) return;
    submitAnswer(input);
    setInput("");
  };

  // ── Consent / identity capture screen ──────────────────────
  if (phase === "consent") {
    return (
      <Shell onClose={onClose} title="Proctored Assessment">
        <div style={{ maxWidth:460, margin:"0 auto", padding:"8px 4px", textAlign:"center" }}>
          <div style={{ borderRadius:18, overflow:"hidden", background:"#000", marginBottom:16,
            border:"2px solid rgba(255,255,255,.1)", aspectRatio:"4/3" }}>
            <video ref={videoRef} muted playsInline style={{ width:"100%", height:"100%", objectFit:"cover", transform:"scaleX(-1)" }} />
            <canvas ref={canvasRef} width={FRAME_W} height={FRAME_H} style={{ display:"none" }} />
          </div>
          <h2 style={{ fontSize:18, fontWeight:900, color:"#F1F5F9", margin:"0 0 8px" }}>{topic}</h2>
          <p style={{ fontSize:13, fontWeight:600, color:"#94A3B8", lineHeight:1.6, margin:"0 0 18px" }}>
            Sergeant will assess you on <b style={{ color:"#CBD5E1" }}>{topic}</b>. This session is proctored:
            keep your face in frame, stay alone, and no phones or notes. We'll capture a reference photo to verify your identity.
          </p>
          <button onClick={registerAndStart} disabled={status !== "running" || refSaving}
            style={{ width:"100%", padding:"14px", borderRadius:14, border:"none",
              cursor: status==="running" ? "pointer":"default",
              background: status==="running" ? `linear-gradient(135deg,${BRAND},${BRAND}CC)` : "rgba(255,255,255,.08)",
              color:"#fff", fontSize:14, fontWeight:800, fontFamily:"'Nunito',sans-serif" }}>
            {refSaving ? "Verifying…" : status==="running" ? "Capture photo & begin" :
              status==="denied" ? "Camera permission needed" : "Preparing camera…"}
          </button>
          {status === "denied" && (
            <button onClick={_beginExam} style={{ marginTop:10, background:"none", border:"none", color:"#64748B",
              fontSize:12, fontWeight:700, cursor:"pointer", textDecoration:"underline" }}>Continue without camera</button>
          )}
        </div>
      </Shell>
    );
  }

  // ── Summary ────────────────────────────────────────────────
  if (phase === "summary" && summary) {
    const vColor = { pass: GREEN, fail: RED, flagged: GOLD, terminated: RED }[summary.verdict] || GOLD;
    return (
      <Shell onClose={onClose} title="Assessment Result">
        <div style={{ maxWidth:480, margin:"0 auto", display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ background:`${vColor}1A`, border:`1.5px solid ${vColor}40`, borderRadius:18, padding:"20px 18px", textAlign:"center" }}>
            <p style={{ fontSize:11, fontWeight:800, color:vColor, margin:"0 0 6px", letterSpacing:.5 }}>{summary.verdict.toUpperCase()}</p>
            <p style={{ fontSize:44, fontWeight:900, color:"#F1F5F9", margin:0, fontFamily:"monospace" }}>
              {summary.assessmentScore}<span style={{ fontSize:18, color:"#475569" }}>/100</span>
            </p>
          </div>
          <Stat label="Integrity (cheat probability)" value={`${Math.round((summary.cheatProbability||0)*100)}%`}
            color={summary.cheatProbability>=0.4 ? RED : GREEN} />
          <Stat label="Questions answered" value={`${summary.questionsAnswered}/${summary.totalQuestions}`} color="#CBD5E1" />
          <Stat label="Hints used" value={summary.hintsUsed} color="#CBD5E1" />
          {summary.cheatEvents?.length > 0 && (
            <div style={{ background:"rgba(248,113,113,.08)", border:"1px solid rgba(248,113,113,.2)", borderRadius:12, padding:"12px" }}>
              <p style={{ fontSize:10.5, fontWeight:800, color:RED, margin:"0 0 8px", letterSpacing:.3 }}>PROCTORING FLAGS</p>
              {summary.cheatEvents.slice(0,8).map((e,i) => (
                <p key={i} style={{ fontSize:11.5, fontWeight:600, color:"#FCA5A5", margin:"0 0 3px" }}>
                  · {e.type.replace(/_/g," ")} ({e.severity})
                </p>
              ))}
            </div>
          )}
          <div style={{ background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.08)", borderRadius:14, padding:"14px" }}>
            <p style={{ fontSize:10.5, fontWeight:800, color:GOLD, margin:"0 0 8px", letterSpacing:.3 }}>SERGEANT'S VERDICT</p>
            <p style={{ fontSize:13, fontWeight:600, color:"#CBD5E1", margin:0, lineHeight:1.6 }}>{summary.verdictDetail}</p>
          </div>
          <button onClick={onClose} style={{ padding:"13px", borderRadius:14, border:"none",
            background:`linear-gradient(135deg,${BRAND},${BRAND}CC)`, color:"#fff", fontSize:13, fontWeight:800,
            cursor:"pointer", fontFamily:"'Nunito',sans-serif" }}>Done</button>
        </div>
      </Shell>
    );
  }

  // ── Exam (split view) ──────────────────────────────────────
  return (
    <Shell onClose={onClose} title={`Assessment · ${topic}`}>
      {terminated && (
        <div style={{ background:"rgba(248,113,113,.12)", border:"1px solid rgba(248,113,113,.3)", borderRadius:12,
          padding:"10px 14px", marginBottom:12, fontSize:12.5, fontWeight:700, color:"#FCA5A5", textAlign:"center" }}>
          ⚠ {terminated.reason} This attempt has been flagged for review.
        </div>
      )}
      <VoiceExam
        videoRef={videoRef} canvasRef={canvasRef} status={status} signals={signals}
        proctor={proctor} frameW={FRAME_W} frameH={FRAME_H}
        blocks={blocks} progress={progress} lastAnswer={lastAnswer} voiceError={voiceError}
        listening={listening} interim={interim} speaking={speaking}
        loading={loading} disabled={!assessIdRef.current || Boolean(terminated)}
        onToggleListening={listening ? stopListening : startListening}
        input={input} onInputChange={setInput} onSend={handleSend} />
    </Shell>
  );
}

function Shell({ children, onClose, title }) {
  return (
    <div style={{ position:"fixed", inset:0, zIndex:3000, background:"#080812",
      display:"flex", flexDirection:"column", fontFamily:"'Nunito',sans-serif" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"calc(env(safe-area-inset-top, 0px) + 12px) 14px 12px", borderBottom:"1px solid rgba(255,255,255,.06)" }}>
        <span style={{ fontSize:14, fontWeight:900, color:"#F1F5F9" }}>{title}</span>
        <div onClick={onClose} style={{ width:34, height:34, borderRadius:"50%", background:"rgba(255,255,255,.07)",
          display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
          <XIcon size={15} color="#64748B" />
        </div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"14px" }}>{children}</div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
      background:"rgba(255,255,255,.04)", borderRadius:12, padding:"11px 14px" }}>
      <span style={{ fontSize:12.5, fontWeight:700, color:"#94A3B8" }}>{label}</span>
      <span style={{ fontSize:14, fontWeight:900, color }}>{value}</span>
    </div>
  );
}

export default AssessmentRoom;
