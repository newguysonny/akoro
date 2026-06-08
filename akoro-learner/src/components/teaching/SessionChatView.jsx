import { useState, useRef, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS } from '../../constants.js';
import { MicIcon, SendIcon, XIcon, BrainIcon, SparkleIcon, ZapIcon } from '../common/Icons.jsx';
import BlockRenderer from '../sessions/BlockRenderer.jsx';

function SessionChatView({
  blocks, loading, input, onInputChange, onSend,
  topic, subject, agentName, agentEmoji, mode,
  userTurns, onSummarize, showSummarize,
  recording, onToggleRecording, seconds,
  voiceStreaming, interimText, onToggleVoice,
  onClose,
}) {
  const sc      = SUBJECT_COLORS[subject?.toLowerCase?.()] || BRAND;
  const scrollRef = useRef(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  useEffect(()=>{
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [blocks, loading]);

  const handleKey = e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
  };

  const handleCloseRequest = () => {
    // If human has sent at least 1 message, confirm before closing
    if (userTurns > 0) setConfirmClose(true);
    else onClose();
  };

  return (
    <div style={{ position:"fixed",inset:0,zIndex:3000,background:"#080812",
      display:"flex",flexDirection:"column",fontFamily:"'Nunito',sans-serif",
      animation:"sheet-up .36s cubic-bezier(.32,1.1,.64,1)" }}>

      {/* Header */}
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"52px 20px 14px",borderBottom:"1px solid rgba(255,255,255,.06)" }}>
        <div>
          <div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:3 }}>
            <div style={{ width:7,height:7,borderRadius:"50%",background:sc,animation:"pulse-dot 1.4s ease-in-out infinite" }}/>
            <span style={{ fontSize:10.5,fontWeight:800,color:sc,letterSpacing:.5 }}>
              {mode === "decay" ? "DECAY RE-TEACH" : "LEARN BY TEACHING"}
            </span>
          </div>
          <p style={{ fontSize:15,fontWeight:900,color:"#F1F5F9",margin:0 }}>{topic}</p>
          <p style={{ fontSize:11,fontWeight:600,color:"#475569",margin:0 }}>
            {subject} · {agentEmoji} {agentName} · NaNa Esumai 🧠 · Sargeant ⚡
          </p>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          {showSummarize && (
            <div onClick={onSummarize}
              style={{ display:"flex",alignItems:"center",gap:5,background:`${sc}22`,
                border:`1px solid ${sc}44`,borderRadius:12,padding:"7px 12px",cursor:"pointer" }}>
              <SparkleIcon size={13} color={sc}/>
              <span style={{ fontSize:11,fontWeight:800,color:sc }}>Summarize</span>
            </div>
          )}
          <div onClick={handleCloseRequest}
            style={{ width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,.07)",
              display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}>
            <XIcon size={15} color="#64748B"/>
          </div>
        </div>
      </div>

      {/* Blocks */}
      <div ref={scrollRef} style={{ flex:1,overflowY:"auto",padding:"14px 16px",
        display:"flex",flexDirection:"column",gap:8 }}>
        {blocks.map((b,i) => (
          <BlockRenderer key={i} block={b} agentName={agentName} agentEmoji={agentEmoji}/>
        ))}
        {loading && (
          <div style={{ display:"flex",alignItems:"flex-end",gap:8 }}>
            <div style={{ width:28,height:28,borderRadius:"50%",background:AGENT_STYLES.nana.bg,
              border:`1.5px solid ${AGENT_STYLES.nana.ring}`,flexShrink:0,
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:14 }}>🧠</div>
            <div style={{ padding:"12px 16px",borderRadius:"4px 18px 18px 18px",
              background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",
              display:"flex",gap:5,alignItems:"center" }}>
              {[0,.25,.5].map((d,i)=>(
                <div key={i} style={{ width:6,height:6,borderRadius:"50%",background:sc,
                  animation:`bounce-dot .8s ease-in-out ${d}s infinite alternate` }}/>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div style={{ padding:"10px 14px 28px",background:"rgba(255,255,255,.03)",
        borderTop:"1px solid rgba(255,255,255,.06)" }}>

        {/* ── Voice Streaming mode — live transcript ── */}
        {voiceStreaming && (
          <div style={{ display:"flex",alignItems:"flex-start",gap:10,marginBottom:8 }}>
            {/* Pulsing mic indicator */}
            <div style={{ display:"flex",alignItems:"center",gap:7,flexShrink:0,
              background:`${RED}22`,border:`1.5px solid ${RED}`,
              borderRadius:12,padding:"8px 13px",cursor:"pointer" }}
              onClick={onToggleVoice}>
              <div style={{ width:8,height:8,borderRadius:"50%",background:RED,
                animation:"pulse-dot 0.7s ease-in-out infinite" }}/>
              <span style={{ fontSize:11,fontWeight:800,color:RED }}>Stop</span>
            </div>
            {/* Live transcript */}
            <div style={{ flex:1,background:"rgba(255,255,255,.07)",
              border:"1.5px solid rgba(255,255,255,.15)",borderRadius:12,
              padding:"8px 12px",minHeight:40,display:"flex",alignItems:"center" }}>
              {interimText
                ? <span style={{ fontSize:13,fontWeight:600,color:"#94A3B8",
                    fontStyle:"italic",lineHeight:1.5 }}>{interimText}</span>
                : <span style={{ fontSize:12,fontWeight:600,color:"#475569" }}>
                    Listening… speak now
                  </span>
              }
            </div>
          </div>
        )}

        {/* ── Audio blob mode — timer ── */}
        {recording && !voiceStreaming && (
          <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:8 }}>
            <div onClick={onToggleRecording}
              style={{ display:"flex",alignItems:"center",gap:7,flex:1,
                background:`${RED}22`,border:`1.5px solid ${RED}`,
                borderRadius:12,padding:"8px 14px",cursor:"pointer" }}>
              <div style={{ width:24,height:24,borderRadius:"50%",background:RED,
                border:`1.5px solid ${RED}`,display:"flex",alignItems:"center",
                justifyContent:"center",animation:"pulse-dot 1s ease-in-out infinite",flexShrink:0 }}>
                <MicIcon size={12} color="#fff"/>
              </div>
              <span style={{ fontSize:12,fontWeight:800,color:RED }}>● {fmt(seconds)} — Tap to stop</span>
            </div>
          </div>
        )}

        {/* ── Normal mode — text input + two voice buttons ── */}
        {!recording && !voiceStreaming && (
          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8 }}>
            {/* Audio button — hold to record full blob */}
            <div onClick={onToggleRecording}
              style={{ display:"flex",alignItems:"center",gap:5,flexShrink:0,
                background:"rgba(255,255,255,.07)",border:"1.5px solid rgba(255,255,255,.10)",
                borderRadius:12,padding:"9px 11px",cursor:"pointer",transition:"all .2s" }}>
              <MicIcon size={13} color="#64748B"/>
              <span style={{ fontSize:10,fontWeight:700,color:"#64748B" }}>Audio</span>
            </div>
            {/* Text input */}
            <div style={{ flex:1,display:"flex",alignItems:"center",
              background:"rgba(255,255,255,.07)",border:"1.5px solid rgba(255,255,255,.10)",
              borderRadius:12,padding:"8px 12px" }}>
              <input value={input} onChange={e=>onInputChange(e.target.value)}
                onKeyDown={handleKey}
                placeholder={`Explain to ${agentName}…`}
                style={{ flex:1,background:"none",border:"none",outline:"none",
                  fontSize:13,fontWeight:600,color:"#CBD5E1",
                  fontFamily:"'Nunito',sans-serif" }}/>
            </div>
            {/* Send when typing — Voice when not */}
            {input.trim() ? (
              <div onClick={()=>onSend()}
                style={{ width:40,height:40,borderRadius:12,flexShrink:0,
                  background:`linear-gradient(135deg,${sc},${sc}BB)`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  cursor:"pointer",transition:"all .2s" }}>
                <SendIcon size={16} color="#fff"/>
              </div>
            ) : onToggleVoice ? (
              <div onClick={onToggleVoice}
                style={{ display:"flex",alignItems:"center",gap:5,flexShrink:0,
                  background:`${RED}18`,border:`1.5px solid ${RED}44`,
                  borderRadius:12,padding:"9px 11px",cursor:"pointer",transition:"all .2s" }}>
                <div style={{ width:8,height:8,borderRadius:"50%",background:RED }}/>
                <span style={{ fontSize:10,fontWeight:700,color:RED }}>Voice</span>
              </div>
            ) : (
              <div onClick={()=>onSend()}
                style={{ width:40,height:40,borderRadius:12,flexShrink:0,
                  background:"rgba(255,255,255,.06)",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  cursor:"pointer",transition:"all .2s" }}>
                <SendIcon size={16} color="#475569"/>
              </div>
            )}
          </div>
        )}

        {/* Turn counter */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between" }}>
          <span style={{ fontSize:10.5,fontWeight:600,color:"#334155" }}>
            {mode === "decay" ? "Re-teach turns" : mode === "continuation" ? "Continuation turns" : "Teaching turns"}: {userTurns} / 4
          </span>
          <div style={{ display:"flex",gap:3 }}>
            {[0,1,2,3].map(i=>(
              <div key={i} style={{ width:18,height:4,borderRadius:2,
                background:i<userTurns?sc:"rgba(255,255,255,.10)",transition:"background .3s" }}/>
            ))}
          </div>
        </div>
      </div>

      {/* ── Confirm close modal ── */}
      {confirmClose&&(
        <><div onClick={()=>setConfirmClose(false)}
          style={{ position:"absolute",inset:0,zIndex:100,background:"rgba(0,0,0,.65)",backdropFilter:"blur(4px)" }}/>
        <div style={{ position:"absolute",bottom:0,left:0,right:0,zIndex:101,
          background:"#111827",borderRadius:"20px 20px 0 0",padding:"28px 22px 36px",
          fontFamily:"'Nunito',sans-serif",animation:"sheet-up .25s ease" }}>
          <div style={{ width:36,height:4,borderRadius:2,background:"rgba(255,255,255,.15)",margin:"0 auto 22px" }}/>
          <p style={{ fontSize:16,fontWeight:900,color:"#F1F5F9",margin:"0 0 8px",textAlign:"center" }}>End this session?</p>
          <p style={{ fontSize:13,color:"#64748B",margin:"0 0 24px",textAlign:"center",lineHeight:1.6 }}>
            Your teaching is not complete yet.{"\n"}Progress will be saved automatically.
          </p>
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={()=>setConfirmClose(false)}
              style={{ flex:1,padding:"13px",borderRadius:14,border:"1px solid rgba(255,255,255,.12)",
                background:"rgba(255,255,255,.06)",fontSize:13,fontWeight:800,color:"#94A3B8",
                cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>
              Keep Teaching
            </button>
            <button onClick={()=>{ setConfirmClose(false); onClose(); }}
              style={{ flex:1.2,padding:"13px",borderRadius:14,border:"none",
                background:`linear-gradient(135deg,${RED},#DC2626)`,
                fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",
                fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
              <XIcon size={13} color="#fff"/>End Session
            </button>
          </div>
        </div></>
      )}
    </div>
  );
}


export default SessionChatView;
