import { useRef, useEffect } from 'react';
import { Ico } from '../../theme/Ico.jsx';
import { BRAND, RED, GREEN, GOLD } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';

/**
 * AssessmentChat — renders the Sergeant proctored-exam transcript.
 *
 * Typed blocks mirror the backend's assessment_turn shape:
 *   proctor-banner | sergeant | question | user | hint | proctor-flag
 * Plus a composer at the bottom. Kept self-contained (not SessionChatView)
 * because the assessment block vocabulary differs from teaching.
 */
function AssessmentChat({ blocks, input, onInputChange, onSend, loading, disabled, progress,
  voiceMode = false, onToggleVoiceMode, listening = false, interim = "", onToggleListening }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [blocks, loading]);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", fontFamily:"'Nunito',sans-serif" }}>
      {progress?.total > 0 && (
        <div style={{ padding:"8px 14px", borderBottom:"1px solid rgba(255,255,255,.06)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
            <span style={{ fontSize:11, fontWeight:800, color:"#94A3B8" }}>Question {Math.min(progress.index+1, progress.total)} of {progress.total}</span>
          </div>
          <div style={{ height:5, borderRadius:5, background:"rgba(255,255,255,.08)", overflow:"hidden" }}>
            <div style={{ width:`${Math.round((progress.index/progress.total)*100)}%`, height:"100%", background:BRAND, transition:"width .4s" }} />
          </div>
        </div>
      )}

      <div style={{ flex:1, overflowY:"auto", padding:"14px", display:"flex", flexDirection:"column", gap:10 }}>
        {blocks.map((b, i) => <Block key={i} b={b} />)}
        {loading && (
          <div style={{ display:"flex", gap:5, padding:"6px 2px" }}>
            {[0,1,2].map(d => <span key={d} style={{ width:7, height:7, borderRadius:"50%", background:"#475569",
              animation:`pulse-dot 1s ease-in-out ${d*0.15}s infinite` }} />)}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {voiceMode && (interim || listening) && (
        <div style={{ padding:"6px 14px", fontSize:12.5, fontWeight:600, color: interim ? "#E2E8F0" : "#64748B",
          fontStyle: interim ? "normal" : "italic" }}>
          {interim || "Listening…"}
        </div>
      )}

      <div style={{ padding:"10px 12px", borderTop:"1px solid rgba(255,255,255,.06)", display:"flex", gap:8, alignItems:"center" }}>
        {/* Voice mode toggle */}
        {onToggleVoiceMode && (
          <button onClick={onToggleVoiceMode} disabled={disabled} title="Voice mode"
            style={{ width:40, height:40, flexShrink:0, borderRadius:12, cursor: disabled?"default":"pointer",
              border:`1px solid ${voiceMode ? BRAND : "rgba(255,255,255,.12)"}`,
              background: voiceMode ? tint(13, BRAND) : "rgba(255,255,255,.05)",
              color: voiceMode ? BRAND : "#94A3B8", fontSize:17 }}><Ico ti="ti-volume" size={17} /></button>
        )}

        {voiceMode ? (
          <button onClick={onToggleListening} disabled={disabled || loading}
            style={{ flex:1, padding:"11px", borderRadius:12, border:"none", cursor:(disabled||loading)?"default":"pointer",
              background: listening ? `linear-gradient(135deg,${RED},${RED}CC)` : `linear-gradient(135deg,${BRAND},${BRAND}CC)`,
              color:"#fff", fontSize:13.5, fontWeight:800, fontFamily:"'Nunito',sans-serif",
              display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
            {listening
              ? <><span style={{ width:9, height:9, borderRadius:"50%", background:"#fff", animation:"pulse-dot 1s ease-in-out infinite" }} /> Stop & submit</>
              : <><Ico ti="ti-microphone" size={13} style={{ verticalAlign: '-2px' }} /> Hold to answer</>}
          </button>
        ) : (
          <>
            <input
              value={input}
              onChange={e => onInputChange(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
              disabled={disabled || loading}
              placeholder={disabled ? "Assessment ended" : "Type your answer…"}
              style={{ flex:1, background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)",
                borderRadius:12, padding:"11px 14px", color:"#F1F5F9", fontSize:14, fontFamily:"'Nunito',sans-serif", outline:"none" }} />
            <button onClick={onSend} disabled={disabled || loading || !input.trim()}
              style={{ padding:"0 18px", borderRadius:12, border:"none", cursor: (disabled||loading||!input.trim()) ? "default":"pointer",
                background: (disabled||loading||!input.trim()) ? "rgba(255,255,255,.08)" : `linear-gradient(135deg,${BRAND},${BRAND}CC)`,
                color:"#fff", fontSize:13, fontWeight:800, fontFamily:"'Nunito',sans-serif" }}>Send</button>
          </>
        )}
      </div>
    </div>
  );
}

function Block({ b }) {
  switch (b.type) {
    case "proctor-banner":
      return <div style={{ background:"rgba(108,59,255,.1)", border:"1px solid rgba(108,59,255,.25)", borderRadius:12,
        padding:"10px 12px", fontSize:11.5, fontWeight:700, color:"#C4B5FD", textAlign:"center" }}><Ico ti="ti-shield-exclamation" size={12} style={{ verticalAlign: '-2px' }} /> {b.text}</div>;

    case "sergeant":
      return (
        <div style={{ alignSelf:"flex-start", maxWidth:"88%", background:"rgba(255,255,255,.05)",
          border:"1px solid rgba(255,255,255,.08)", borderRadius:"14px 14px 14px 4px", padding:"10px 13px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
            <span style={{ fontSize:14, display: 'inline-flex' }}>{b.emoji ? <Ico ti="ti-bolt" size={14} color={C.brand} /> : <Ico ti="ti-bolt" size={14} color={C.brand} />}</span>
            <span style={{ fontSize:11, fontWeight:800, color:GOLD }}>{b.agent || "Sergeant"}</span>
            {b.score != null && (
              <span style={{ marginLeft:"auto", fontSize:10.5, fontWeight:900,
                color: b.correct ? GREEN : (b.score>=50 ? GOLD : RED) }}>{b.score}/100</span>
            )}
          </div>
          <p style={{ margin:0, fontSize:13.5, fontWeight:600, color:"#E2E8F0", lineHeight:1.5 }}>{b.text}</p>
        </div>
      );

    case "question":
      return (
        <div style={{ alignSelf:"flex-start", maxWidth:"92%", background:"rgba(108,59,255,.08)",
          border:"1px solid rgba(108,59,255,.22)", borderRadius:14, padding:"12px 14px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
            <span style={{ fontSize:10.5, fontWeight:800, color:BRAND, letterSpacing:.3 }}>QUESTION {b.idx}/{b.total}</span>
            {b.difficulty && <span style={{ fontSize:10, fontWeight:700, color:"#94A3B8" }}>{b.difficulty}</span>}
          </div>
          <p style={{ margin:0, fontSize:14.5, fontWeight:700, color:"#F1F5F9", lineHeight:1.5 }}>{b.text}</p>
        </div>
      );

    case "user":
      return (
        <div style={{ alignSelf:"flex-end", maxWidth:"88%", background:`linear-gradient(135deg,${BRAND},${BRAND}DD)`,
          borderRadius:"14px 14px 4px 14px", padding:"10px 13px" }}>
          <p style={{ margin:0, fontSize:13.5, fontWeight:600, color:"#fff", lineHeight:1.5 }}>{b.text}</p>
        </div>
      );

    case "hint":
      return <div style={{ alignSelf:"flex-start", maxWidth:"88%", background:"rgba(245,158,11,.08)",
        border:"1px solid rgba(245,158,11,.22)", borderRadius:12, padding:"9px 12px", fontSize:12.5, fontWeight:600, color:"#FDE68A" }}><Ico ti="ti-bulb" size={12} style={{ verticalAlign: '-2px' }} /> {b.text}</div>;

    case "proctor-flag":
      return <div style={{ alignSelf:"center", background:"rgba(248,113,113,.1)", border:"1px solid rgba(248,113,113,.25)",
        borderRadius:10, padding:"7px 12px", fontSize:11, fontWeight:700, color:"#FCA5A5", textAlign:"center" }}><Ico ti="ti-alert-triangle" size={12} style={{ verticalAlign: '-2px' }} /> {b.text}</div>;

    case "system-divider":
      return <div style={{ alignSelf:"center", fontSize:11, fontWeight:700, color:"#64748B", padding:"4px 0" }}>{b.label}</div>;

    default:
      return null;
  }
}

export default AssessmentChat;
