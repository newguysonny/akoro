import { useState, useRef, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, AGENT_STYLES } from '../../constants.js';
import { MicIcon, SendIcon, XIcon, BrainIcon, SparkleIcon, ZapIcon, Icon } from '../common/Icons.jsx';
import BlockRenderer from '../sessions/BlockRenderer.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';

/* ── Mic level meter ──────────────────────────────────────────────
   Twelve segments lit in proportion to RMS loudness. Segments rather than a
   continuous bar because movement is the signal: a bar sliding smoothly near
   zero still looks like it might be doing something, while a row of segments
   that never lights past the first is unmistakably not hearing you. */
function MicMeter({ level = 0 }) {
  const SEGMENTS = 12;
  const lit = Math.round(Math.max(0, Math.min(1, level)) * SEGMENTS);
  return (
    <div style={{ display:"flex", gap:2, alignItems:"flex-end", height:8 }} aria-hidden="true">
      {Array.from({ length: SEGMENTS }).map((_, i) => (
        <div key={i} style={{
          flex:1, borderRadius:1,
          /* Taller toward the right, so loud reads as loud at a glance. */
          height: 3 + (i / SEGMENTS) * 5,
          background: i < lit
            /* Amber at the top of the range: worth knowing, not an error. */
            ? (i > SEGMENTS - 3 ? "#FBBF24" : "#34D399")
            : "rgba(255,255,255,.13)",
          transition: "background 60ms linear",
        }}/>
      ))}
    </div>
  );
}

function SessionChatView({
  blocks, loading, loadingNote = '', input, onInputChange, onSend,
  topic, subject, agentName, agentEmoji, mode, reference = null,
  userTurns, onSummarize, showSummarize,
  recording, onToggleRecording, seconds,
  voiceStreaming, interimText, voiceLevel = 0, onToggleVoice,
  cognitive,
  guideLabel, onSwitchAgent, switching,
  connState = "connected",
  onClose,
  onMinimize,
}) {
  const { t } = useLang();
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
              {mode === "decay" ? t('teaching.mode_decay') : t('teaching.mode_teach')}
            </span>
            {connState !== "connected" && (
              <span style={{ display:"inline-flex",alignItems:"center",gap:5,
                fontSize:9.5,fontWeight:800,letterSpacing:.4,
                color: connState === "connecting" ? "#FBBF24" : "#F87171",
                background: connState === "connecting" ? "rgba(251,191,36,.12)" : "rgba(248,113,113,.12)",
                border:`1px solid ${connState === "connecting" ? "rgba(251,191,36,.3)" : "rgba(248,113,113,.3)"}`,
                borderRadius:20,padding:"2px 8px" }}>
                <span style={{ width:5,height:5,borderRadius:"50%",
                  background: connState === "connecting" ? "#FBBF24" : "#F87171",
                  animation:"pulse-dot 1s ease-in-out infinite" }}/>
                {connState === "connecting"
                  ? (t('teaching.connecting') || 'Connecting…')
                  : (t('teaching.reconnecting') || 'Reconnecting…')}
              </span>
            )}
          </div>
          <p style={{ fontSize:15,fontWeight:900,color:"#F1F5F9",margin:0 }}>{topic}</p>
          <p style={{ fontSize:11,fontWeight:600,color:"#475569",margin:0 }}>
            {subject} · {agentEmoji} {agentName} · {guideLabel || "NaNa Esumai 🧠 · Sargeant ⚡"}
          </p>
          {reference && (
            <div title={`Session reference: ${reference.name}`} style={{ display:"inline-flex",alignItems:"center",gap:4,maxWidth:"100%",marginTop:6,padding:"3px 7px",borderRadius:20,background:"rgba(52,211,153,.10)",border:"1px solid rgba(52,211,153,.25)",color:"#6EE7B7" }}>
              <Icon name="ti-paperclip" size={10}/>
              <span style={{ fontSize:9.5,fontWeight:800,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{reference.name}</span>
            </div>
          )}
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          {onSwitchAgent && (
            <div onClick={switching ? undefined : onSwitchAgent}
              style={{ display:"flex",alignItems:"center",gap:5,background:"rgba(255,255,255,.07)",
                border:"1px solid rgba(255,255,255,.12)",borderRadius:12,padding:"7px 11px",
                cursor:switching?"default":"pointer",opacity:switching?.6:1 }}>
              <span style={{ fontSize:12 }}>⇄</span>
              <span style={{ fontSize:11,fontWeight:800,color:"#CBD5E1" }}>{switching ? t('teaching.switching') : t('teaching.switch')}</span>
            </div>
          )}
          {showSummarize && (
            <div onClick={onSummarize}
              style={{ display:"flex",alignItems:"center",gap:5,background:`${sc}22`,
                border:`1px solid ${sc}44`,borderRadius:12,padding:"7px 12px",cursor:"pointer" }}>
              <SparkleIcon size={13} color={sc}/>
              <span style={{ fontSize:11,fontWeight:800,color:sc }}>{t('teaching.summarize')}</span>
            </div>
          )}
          {/* Minimize — keep the session running, park it on the Now-Studying
              bar. Non-destructive, so no confirm like close. */}
          {onMinimize && (
            <div onClick={onMinimize} role="button" aria-label={t('now.minimize')} title={t('now.minimize')}
              style={{ width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,.07)",
                display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2.6" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </div>
          )}
          <div onClick={handleCloseRequest}
            style={{ width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,.07)",
              display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}>
            <XIcon size={15} color="#64748B"/>
          </div>
        </div>
      </div>

      {/* Live cognitive state — agent's understanding & confusion this turn */}
      {cognitive && (cognitive.understanding != null || cognitive.confusion != null) && (
        <div style={{ display:"flex",alignItems:"center",gap:14,padding:"9px 20px",
          borderBottom:"1px solid rgba(255,255,255,.06)",background:"rgba(255,255,255,.02)" }}>
          {[
            { label:t('teaching.understanding'), val:Math.round(cognitive.understanding ?? 0), color:GREEN },
            { label:t('teaching.confusion'),     val:Math.round(cognitive.confusion ?? 0),     color:GOLD  },
          ].map(({label,val,color}) => (
            <div key={label} style={{ flex:1,minWidth:0 }}>
              <div style={{ display:"flex",justifyContent:"space-between",marginBottom:4 }}>
                <span style={{ fontSize:9.5,fontWeight:800,color:"#64748B",letterSpacing:.4,textTransform:"uppercase" }}>{label}</span>
                <span style={{ fontSize:10,fontWeight:900,color }}>{val}%</span>
              </div>
              <div style={{ height:5,borderRadius:4,background:"rgba(255,255,255,.07)",overflow:"hidden" }}>
                <div style={{ height:"100%",width:`${Math.max(0,Math.min(100,val))}%`,background:color,
                  borderRadius:4,transition:"width .5s cubic-bezier(.4,0,.2,1)" }}/>
              </div>
            </div>
          ))}
          {cognitive.phase != null && (
            <span style={{ fontSize:9.5,fontWeight:800,color:BRAND,background:`${BRAND}22`,
              padding:"3px 9px",borderRadius:20,whiteSpace:"nowrap",flexShrink:0 }}>
              Phase {cognitive.phase}
            </span>
          )}
        </div>
      )}

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
              display:"flex",gap:8,alignItems:"center" }}>
              {loadingNote && <span style={{ fontSize:12.5,fontWeight:600,color:"var(--ak-text-muted)" }}>{loadingNote}</span>}
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
              <span style={{ fontSize:11,fontWeight:800,color:RED }}>{t('teaching.stop')}</span>
            </div>
            {/* Live transcript, with a level meter above it.
                A mic with no meter cannot be told apart from a mic that is not
                working — "is it hearing me?" is the first thing anyone wants to
                know, and before this the only answer was to keep talking and
                hope words appeared. */}
            <div style={{ flex:1,background:"rgba(255,255,255,.07)",
              border:"1.5px solid rgba(255,255,255,.15)",borderRadius:12,
              padding:"7px 12px",minHeight:40,display:"flex",flexDirection:"column",
              justifyContent:"center",gap:6 }}>
              <MicMeter level={voiceLevel}/>
              {interimText
                ? <span style={{ fontSize:13,fontWeight:600,color:"#94A3B8",
                    fontStyle:"italic",lineHeight:1.5 }}>{interimText}</span>
                : <span style={{ fontSize:12,fontWeight:600,color:"#475569" }}>
                    {voiceLevel > 0.06 ? t('teaching.listening') : "Speak now\u2026"}
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
              <span style={{ fontSize:12,fontWeight:800,color:RED,display:'inline-flex',alignItems:'center',gap:5 }}><span style={{ width:7,height:7,borderRadius:'50%',background:'currentColor',display:'inline-block' }}/> {fmt(seconds)} — {t('teaching.tap_to_stop')}</span>
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
              <span style={{ fontSize:10,fontWeight:700,color:"#64748B" }}>{t('teaching.audio')}</span>
            </div>
            {/* Text input */}
            <div style={{ flex:1,display:"flex",alignItems:"center",
              background:"rgba(255,255,255,.07)",border:"1.5px solid rgba(255,255,255,.10)",
              borderRadius:12,padding:"8px 12px" }}>
              <input value={input} onChange={e=>onInputChange(e.target.value)}
                onKeyDown={handleKey}
                placeholder={t('teaching.explain_ph').replace('{name}', agentName)}
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
                <span style={{ fontSize:10,fontWeight:700,color:RED }}>{t('teaching.voice')}</span>
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
            {mode === "decay" ? t('teaching.reteach_turns') : mode === "continuation" ? t('teaching.continuation_turns') : t('teaching.teaching_turns')}: {userTurns} / 4
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
          <p style={{ fontSize:16,fontWeight:900,color:"#F1F5F9",margin:"0 0 8px",textAlign:"center" }}>{t('teaching.end_session_q')}</p>
          <p style={{ fontSize:13,color:"#64748B",margin:"0 0 24px",textAlign:"center",lineHeight:1.6 }}>
            {t('teaching.not_complete')}{"\n"}{t('teaching.progress_saved')}
          </p>
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={()=>setConfirmClose(false)}
              style={{ flex:1,padding:"13px",borderRadius:14,border:"1px solid rgba(255,255,255,.12)",
                background:"rgba(255,255,255,.06)",fontSize:13,fontWeight:800,color:"#94A3B8",
                cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>
              {t('teaching.keep_teaching')}
            </button>
            <button onClick={()=>{ setConfirmClose(false); onClose(); }}
              style={{ flex:1.2,padding:"13px",borderRadius:14,border:"none",
                background:`linear-gradient(135deg,${RED},#DC2626)`,
                fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",
                fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
              <XIcon size={13} color="#fff"/>{t('teaching.end_session')}
            </button>
          </div>
        </div></>
      )}
    </div>
  );
}


export default SessionChatView;
