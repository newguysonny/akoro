import { useState, useRef, useEffect } from 'react';
import CopyMessageButton from "../../../components/common/CopyMessageButton.jsx";
import RichText from "../../../components/common/RichText.jsx";
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, AGENT_STYLES } from '../../../constants.js';
import { MicIcon, XIcon, BrainIcon, SparkleIcon, ZapIcon, ChevDownIcon, Icon } from '../../../components/common/Icons.jsx';
import FortizoChatComposer from '../../../components/common/FortizoChatComposer.jsx';
import QuoteChip from '../../../components/common/QuoteChip.jsx';
import { parseQuoted } from '../../../lib/quotedMessage.js';
import StreamCaret from '../../../components/common/StreamCaret.jsx';
import BlockRenderer from '../../../components/sessions/BlockRenderer.jsx';
import LessonCheckCard from './LessonCheckCard.jsx';
import { citeLabel, toReaderCite } from '../../../lib/askAnswer.js';
import { Answer } from './ReaderAsk.jsx';
import { AgentAvatar } from '../../../components/common/AgentAvatar.jsx';
import { useLang } from '../../../contexts/LanguageContext.jsx';

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
            ? (i > SEGMENTS - 3 ? "var(--ak-warn-text)" : "var(--ak-success-text)")
            : "var(--ak-tag-bg)",
          transition: "background 60ms linear",
        }}/>
      ))}
    </div>
  );
}

/**
 * The guide's ideas for the learner's next message — from the protégé's latest
 * reply (block.guide.ideas) or the session's opening (a "guide-ideas" block),
 * only while nothing newer has been said. A tap puts the idea in the message
 * box to edit or send; the guide itself never posts in the chat.
 */
function GuideIdeas({ blocks, onPick }) {
  let g = null;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === "user") break;
    if (b.type === "student-agent") { g = b.guide?.ideas?.length ? b.guide : null; break; }
    if (b.type === "guide-ideas") { g = b; break; }
  }
  if (!g?.ideas?.length) return null;
  return (
    <div data-guide-ideas="" style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:5, width:"100%", margin:"2px 0 4px" }} aria-label="Ideas from your guide">
      {g.hint && <div style={{ flexBasis:"100%", fontSize:11, fontWeight:600, color:"var(--ak-text-muted)", lineHeight:1.4, marginBottom:1 }}>{g.hint}</div>}
      <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:10.5, fontWeight:800, color:"var(--ak-text-muted)", fontFamily:"'Nunito',sans-serif" }}>
        <Icon name="ti-school" size={11}/> Guide
      </span>
      {g.ideas.map((idea) => (
        <button key={idea} type="button" onClick={() => onPick?.(idea)} title="Tap to put it in the message box — change it if you like, then send"
          style={{ padding:"4px 10px", borderRadius:20, background:"var(--ak-surface)", border:`1.5px solid ${AGENT_STYLES.nana.ring}55`,
            color:AGENT_STYLES.nana.color, fontSize:11.5, fontWeight:600, cursor:"pointer", fontFamily:"'Nunito',sans-serif", textAlign:"left", lineHeight:1.3 }}>
          {idea}
        </button>
      ))}
    </div>
  );
}

function SessionChatView({
  blocks, loading, loadingNote = '', input, onInputChange, onSend,
  // A reader passage quoted into the next message (lib/quotedMessage.js).
  quote = null, onQuoteClear,
  topic, subject, agentName, agentEmoji, mode, reference = null,
  userTurns, onSummarize, showSummarize,
  recording, onToggleRecording, seconds,
  voiceStreaming, interimText, voiceLevel = 0, onToggleVoice,
  cognitive,
  guideLabel, onSwitchAgent, switching,
  connState = "connected",
  ended = false,   // the session completed — the composer closes and the guide's next-step pills go away
  onClose,
  onMinimize,
  // Reader split (Fortizo concept): when embedded, this view is the right
  // column of the session reader instead of a full-screen sheet. All state
  // still lives in the parent — only the shell changes.
  embedded = false,
  // Opens the Fortizo-style reader (book icon in the composer). Absent →
  // no book control is rendered.
  onOpenReader,
  onOpenBoard,
  // The session's MATERIAL — a compact box above the composer showing what
  // the content is (record, lesson video…), one tap from the chat to the
  // reader and back. Absent → not rendered (plain teaching session).
  materialBox = null,
  // The FINAL CHECK strip — the end-of-session verdict's own strip, stacked
  // directly above the material strip (its own strip, never shared).
  // Absent → not rendered (no check running on this session).
  finalCheckBox = null,
  // Streaming token feedback — the Protégé / Guide reply for the turn in
  // flight, accumulated token-by-token by the host from student_token /
  // guide_token events. Non-null renders a live bubble with a caret.
  liveStudent = null,
  liveGuide = null,
  // Citation chips on the protégé's messages (document-grounded sessions):
  // called with the reader's jump shape. Absent → chips render inert.
  onCite = null,
}) {
  const { t } = useLang();
  const sc      = SUBJECT_COLORS[subject?.toLowerCase?.()] || BRAND;
  const scrollRef = useRef(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  useEffect(()=>{
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [blocks, loading, liveStudent, liveGuide]);

  const handleKey = e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
  };

  const handleCloseRequest = () => {
    // If human has sent at least 1 message, confirm before closing
    if (userTurns > 0) setConfirmClose(true);
    else onClose();
  };

  return (
    <div style={{ position: embedded ? "relative" : "fixed", inset: embedded ? "auto" : 0,
      width: "100%", height: embedded ? "100%" : undefined,
      zIndex: embedded ? "auto" : 3000, background:"var(--ak-bg)",
      display:"flex",flexDirection:"column",fontFamily:"'Nunito',sans-serif",
      animation:"sheet-up .36s cubic-bezier(.32,1.1,.64,1)" }}>

      {/* Header — a dedicated full-width top bar keeps the mode toggle and
          the round session controls on one row in EVERY state. The icons
          used to ride the left column's toggle row, whose width follows the
          topic/subtitle content: aligned while loading, then drifting (or
          wrapping) out of the row once the real topic and the Switch /
          Summarize block landed. */}
      <div style={{
        padding: embedded ? "12px 16px 12px" : "calc(env(safe-area-inset-top, 0px) + 14px) 20px 12px",borderBottom:"1px solid var(--ak-border)" }}>
        {/* Top bar: mode label + conn state <-> round session controls. */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:5 }}>
          <div style={{ display:"flex",alignItems:"center",gap:7,flexWrap:"wrap",minWidth:0 }}>
            <>
                <div style={{ width:7,height:7,borderRadius:"50%",background:sc,animation:"pulse-dot 1.4s ease-in-out infinite" }}/>
                <span style={{ fontSize:10.5,fontWeight:800,color:sc,letterSpacing:.5 }}>
                  {mode === "decay" ? t('teaching.mode_decay') : t('teaching.mode_teach')}
                </span>
              </>
            {connState !== "connected" && (
              <span style={{ display:"inline-flex",alignItems:"center",gap:5,
                fontSize:9.5,fontWeight:800,letterSpacing:.4,
                color: connState === "connecting" ? "var(--ak-warn-text)" : "var(--ak-danger-text)",
                background: connState === "connecting" ? "rgba(251,191,36,.12)" : "rgba(248,113,113,.12)",
                border:`1px solid ${connState === "connecting" ? "rgba(251,191,36,.3)" : "rgba(248,113,113,.3)"}`,
                borderRadius:20,padding:"2px 8px" }}>
                <span style={{ width:5,height:5,borderRadius:"50%",
                  background: connState === "connecting" ? "var(--ak-warn-text)" : "var(--ak-danger-text)",
                  animation:"pulse-dot 1s ease-in-out infinite" }}/>
                {connState === "connecting"
                  ? (t('teaching.connecting') || 'Connecting…')
                  : (t('teaching.reconnecting') || 'Reconnecting…')}
              </span>
            )}
          </div>
          {/* The round session controls: always top-right on the toggle's
              row, whatever loads below. Minimize parks the session on the
              Now-Studying bar — non-destructive, so no confirm like close. */}
          <div style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
            {onMinimize && (
              <div onClick={onMinimize} role="button" aria-label={t('now.minimize')} title={t('now.minimize')}
                style={{ width:36,height:36,borderRadius:"50%",background:"var(--ak-tag-bg)",
                  display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-muted)" strokeWidth="2.6" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </div>
            )}
            <div onClick={handleCloseRequest}
              style={{ width:36,height:36,borderRadius:"50%",background:"var(--ak-tag-bg)",
                display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}>
              <XIcon size={15} color="var(--ak-text-muted)"/>
            </div>
          </div>
        </div>
        {/* Content row: the topic block, with the labelled actions beside it. */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:8 }}>
          <div style={{ minWidth:0 }}>
            <p style={{ fontSize:15,fontWeight:900,color:"var(--ak-text)",margin:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{topic}</p>
            <p style={{ fontSize:11,fontWeight:600,color:"var(--ak-text-muted)",margin:0 }}>
              {`${subject} · ${agentName}${guideLabel ? ` · ${guideLabel}` : " · NaNa Esumai · Sargeant"}`}
            </p>
            {reference && (
              <div title={`Session reference: ${reference.name}`} style={{ display:"inline-flex",alignItems:"center",gap:4,maxWidth:"100%",marginTop:6,padding:"3px 7px",borderRadius:20,background:"rgba(52,211,153,.10)",border:"1px solid rgba(52,211,153,.25)",color:"var(--ak-success-text)" }}>
                <Icon name="ti-paperclip" size={10}/>
                <span style={{ fontSize:9.5,fontWeight:800,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{reference.name}</span>
              </div>
            )}
          </div>
          {(onSwitchAgent || showSummarize) && (
          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
            {onSwitchAgent && (
              <div onClick={switching ? undefined : onSwitchAgent}
                style={{ display:"flex",alignItems:"center",gap:5,background:"var(--ak-tag-bg)",
                  border:"1px solid var(--ak-border2)",borderRadius:12,padding:"7px 11px",
                  cursor:switching?"default":"pointer",opacity:switching?.6:1 }}>
                <span style={{ fontSize:12 }}>⇄</span>
                <span style={{ fontSize:11,fontWeight:800,color:"var(--ak-text-sec)" }}>{switching ? t('teaching.switching') : t('teaching.switch')}</span>
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
          </div>
          )}
        </div>
      </div>

      {/* Live cognitive state — agent's understanding & confusion this turn.
          Guide mode has no protégé agent, so there is nothing to measure. */}
      {cognitive && (cognitive.understanding != null || cognitive.confusion != null) && (
        <div style={{ display:"flex",alignItems:"center",gap:14,padding:"9px 20px",
          borderBottom:"1px solid var(--ak-border)",background:"var(--ak-tag-bg)" }}>
          {[
            { label:t('teaching.understanding'), val:Math.round(cognitive.understanding ?? 0), color:GREEN },
            { label:t('teaching.confusion'),     val:Math.round(cognitive.confusion ?? 0),     color:GOLD  },
          ].map(({label,val,color}) => (
            <div key={label} style={{ flex:1,minWidth:0 }}>
              <div style={{ display:"flex",justifyContent:"space-between",marginBottom:4 }}>
                <span style={{ fontSize:9.5,fontWeight:800,color:"var(--ak-text-muted)",letterSpacing:.4,textTransform:"uppercase" }}>{label}</span>
                <span style={{ fontSize:10,fontWeight:900,color }}>{val}%</span>
              </div>
              <div style={{ height:5,borderRadius:4,background:"var(--ak-tag-bg)",overflow:"hidden" }}>
                <div style={{ height:"100%",width:`${Math.max(0,Math.min(100,val))}%`,background:color,
                  borderRadius:4,transition:"width .5s cubic-bezier(.4,0,.2,1)" }}/>
              </div>
            </div>
          ))}
          {cognitive.phase != null && (
            <span style={{ fontSize:9.5,fontWeight:800,color:BRAND,background:`${BRAND}22`,
              padding:"3px 9px",borderRadius:20,whiteSpace:"nowrap",flexShrink:0 }}>
              Phase {String(cognitive.phase).replace(/^PHASE_/i, "")}
            </span>
          )}
        </div>
      )}

      {/* Blocks — or the local guide chat when toggled to LEARNING WITH GUIDE */}
      <div ref={scrollRef} style={{ flex:1,overflowY:"auto",padding:"14px 16px",
        display:"flex",flexDirection:"column",gap:8 }}>
        {blocks.map((b,i) => b.type === "lesson-check" ? (
          <LessonCheckCard key={i} assessment={b.assessment} agentName={agentName || 'Your agent'} topic={b.topic || ''} onTeachNext={onInputChange}/>
        ) : (
          <BlockRenderer key={i} block={b} agentName={agentName} agentEmoji={agentEmoji} onCite={onCite}/>
        ))}
        {/* The guide doesn't speak in the conversation: its ideas for what to say next sit under the protégé's latest reply. */}
        {!loading && !liveStudent && !ended && <GuideIdeas blocks={blocks} onPick={onInputChange}/>}
        {/* ── Streaming token feedback — the turn in flight, drawn as it is
            generated. Styles mirror BlockRenderer's protégé / guide bubbles
            so the finished block simply replaces this in place. ── */}
        {liveStudent != null && liveStudent !== "" && (
          <div style={{ display:"flex",alignItems:"flex-end",gap:8,marginBottom:4 }}>
            <div style={{ width:28,height:28,borderRadius:"50%",background:AGENT_STYLES.student.bg,
              border:`1.5px solid ${AGENT_STYLES.student.ring}`,flexShrink:0,
              display:"flex",alignItems:"center",justifyContent:"center" }}><AgentAvatar emoji={agentEmoji || AGENT_STYLES.student.emoji} size={19}/></div>
            <div style={{ maxWidth:"84%",padding:"9px 13px",borderRadius:"4px 18px 18px 18px",
              background:AGENT_STYLES.student.bg,border:`1px solid ${AGENT_STYLES.student.ring}`,
              color:AGENT_STYLES.student.color,fontSize:13.5,lineHeight:1.6,
              whiteSpace:"pre-wrap",fontWeight:500 }}>
              {liveStudent}<StreamCaret/>
            </div>
          </div>
        )}
        {/* No live guide bubble: the guide's tip arrives as ideas on the protégé's reply. */}
        {loading && !liveStudent && !liveGuide && (
          <div style={{ display:"flex",alignItems:"flex-end",gap:8 }}>
            <div style={{ width:28,height:28,borderRadius:"50%",background:AGENT_STYLES.nana.bg,
              border:`1.5px solid ${AGENT_STYLES.nana.ring}`,flexShrink:0,
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:14 }}>🧠</div>
            <div style={{ padding:"12px 16px",borderRadius:"4px 18px 18px 18px",
              background:"var(--ak-tag-bg)",border:"1px solid var(--ak-border)",
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
      <div style={{ padding: embedded ? "10px 14px 12px" : "10px 14px 28px",background:"var(--ak-tag-bg)",
        borderTop:"1px solid var(--ak-border)" }}>

        {/* ── Voice Streaming mode — live transcript (teaching mode only —
            the guide session is UI-only, so it has no voice backend) ── */}
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
            <div style={{ flex:1,background:"var(--ak-tag-bg)",
              border:"1.5px solid var(--ak-border2)",borderRadius:12,
              padding:"7px 12px",minHeight:40,display:"flex",flexDirection:"column",
              justifyContent:"center",gap:6 }}>
              <MicMeter level={voiceLevel}/>
              {interimText
                ? <span style={{ fontSize:13,fontWeight:600,color:"var(--ak-text-sub)",
                    fontStyle:"italic",lineHeight:1.5 }}>{interimText}</span>
                : <span style={{ fontSize:12,fontWeight:600,color:"var(--ak-text-muted)" }}>
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

        {/* Fortizo reference composer — compact icon rail, adapted to Akoro.
            The teaching WebSocket currently accepts text and the two existing
            voice paths only, so the attachment control is intentionally visible
            but unavailable rather than pretending to upload a file. The book
            control opens the session reader (Fortizo split: reader left, this
            chat right on desktop/tablet; full-screen modal on mobile).
            Guide mode: text only — voice/audio have no backend there yet. */}
        {finalCheckBox && (
          <div style={{ marginBottom:6 }}>{finalCheckBox}</div>
        )}
        {materialBox && (
          <div>{materialBox}</div>
        )}
        <div style={{ marginBottom:8 }}>
          <FortizoChatComposer
            value={input}
            onChange={onInputChange}
            onSend={onSend}
            disabled={ended}
            placeholder={ended ? 'Session complete' : quote ? 'Ask about this passage…' : t('teaching.explain_ph').replace('{name}', agentName)}
            quote={quote}
            onQuoteClear={onQuoteClear}
            bookAction={onOpenReader}
              boardAction={onOpenBoard}
            bookLabel="Open reading material"
            hideVoice
            audioIcon="ti-microphone"
            audioAction={onToggleRecording}
            audioLabel={t('teaching.audio')}
            attachmentUnavailable
            attachmentLabel="Attachments are not available in teaching sessions yet"
            modelLabel="Adaptive"
            modelLabelDescription="The teaching guide selects the response mode"
            sendDisabled={ended || (!input.trim() && !quote)}
          />
        </div>

        {/* Turn counter */}
        {
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between" }}>
          <span style={{ fontSize:10.5,fontWeight:600,color:"var(--ak-text-muted)" }}>
            {mode === "decay" ? t('teaching.reteach_turns') : mode === "continuation" ? t('teaching.continuation_turns') : t('teaching.teaching_turns')}: {userTurns}{userTurns <= 4 ? " / 4" : ""}
          </span>
          <div style={{ display:"flex",gap:3 }}>
            {[0,1,2,3].map(i=>(
              <div key={i} style={{ width:18,height:4,borderRadius:2,
                background:i<userTurns?sc:"var(--ak-tag-bg)",transition:"background .3s" }}/>
            ))}
          </div>
        </div>
        }
      </div>

      {/* ── Confirm close modal ── */}
      {confirmClose&&(
        <><div onClick={()=>setConfirmClose(false)}
          style={{ position:"absolute",inset:0,zIndex:100,background:"rgba(0,0,0,.65)",backdropFilter:"blur(4px)" }}/>
        <div className="ak-bottom-sheet-in" style={{ position:"absolute",bottom:0,left:0,right:0,zIndex:101,
          background:"var(--ak-surface)",borderRadius:"20px 20px 0 0",padding:"28px 22px 36px",
          fontFamily:"'Nunito',sans-serif",animation:"sheet-up .25s ease" }}>
          <div style={{ width:36,height:4,borderRadius:2,background:"var(--ak-tag-bg)",margin:"0 auto 22px" }}/>
          <p style={{ fontSize:16,fontWeight:900,color:"var(--ak-text)",margin:"0 0 8px",textAlign:"center" }}>{t('teaching.end_session_q')}</p>
          <p style={{ fontSize:13,color:"var(--ak-text-muted)",margin:"0 0 24px",textAlign:"center",lineHeight:1.6 }}>
            {t('teaching.not_complete')}{"\n"}{t('teaching.progress_saved')}
          </p>
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={()=>setConfirmClose(false)}
              style={{ flex:1,padding:"13px",borderRadius:14,border:"1px solid var(--ak-border2)",
                background:"var(--ak-tag-bg)",fontSize:13,fontWeight:800,color:"var(--ak-text-sub)",
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
