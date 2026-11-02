import React from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, PRIORITY_CONFIG } from '../../constants.js';
import { PlayIcon, PhoneIcon, MessageIcon } from '../common/Icons.jsx';
import { ProgressBar } from '../common/ProgressBar.jsx';

function SessionSheet({ session, onClose, onStartTeach, decayAlert, agentProfile }) {
  const sc           = SUBJECT_COLORS[session.subject] || BRAND;
  const pri          = PRIORITY_CONFIG[session.priority] || { dot:BRAND, bg:`${BRAND}10`, color:BRAND, label:"Upcoming", pulse:false };
  const isDecay      = !!decayAlert;
  const isContinuation = !isDecay && session.type === "agent" && !!session.hasHistory;
  const drop         = isDecay ? (decayAlert.prevConfidence||0) - (decayAlert.confidence||0) : 0;

  const ctaLabel = isDecay       ? "Revise Teaching"
    : isContinuation             ? "Continue Teaching"
    : session.type === "live"    ? "Join Live"
    :                              "Start Teaching";

  const ctaBg = isDecay
    ? `linear-gradient(135deg,${RED},#DC2626)`
    : isContinuation
    ? `linear-gradient(135deg,#10B981,#059669)`
    : `linear-gradient(135deg,${sc},${sc}CC)`;

  return (
    <><div onClick={onClose} style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(6,6,18,.55)",backdropFilter:"blur(5px)" }}/>
    <div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:2100,background:"#fff",borderRadius:"22px 22px 0 0",padding:"0 20px 40px",boxShadow:"0 -8px 40px rgba(0,0,0,.14)",animation:"sheet-up .3s cubic-bezier(.32,1.2,.64,1)",fontFamily:"'Nunito',sans-serif",maxHeight:"88vh",overflowY:"auto" }}>
      <div style={{ width:38,height:4,borderRadius:2,background:"#D1D5DB",margin:"14px auto 18px" }}/>

      {/* Header */}
      <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:14 }}>
        {(isDecay||isContinuation) ? (
          <div style={{ width:46,height:46,borderRadius:"50%",background:`${BRAND}15`,
            border:`2px solid ${isDecay?RED:GREEN}`,display:"flex",alignItems:"center",
            justifyContent:"center",fontSize:24,flexShrink:0 }}>
            {agentProfile?.emoji||"🤖"}
          </div>
        ) : (
          <img src={session.avatar} alt="" style={{ width:46,height:46,borderRadius:"50%",objectFit:"cover",border:`2px solid ${sc}` }}/>
        )}
        <div style={{ flex:1 }}>
          <p style={{ fontSize:15,fontWeight:900,color:"#111827",margin:0 }}>{session.title}</p>
          <p style={{ fontSize:11.5,color:"#9CA3AF",margin:0,fontWeight:600 }}>
            {isDecay ? `${agentProfile?.name||"Agent"} · needs your help`
              : isContinuation ? `${agentProfile?.name||"Agent"} · ${session.daysSince||0}d ago`
              : `${session.tutor||""} · ${session.level||""}`}
          </p>
        </div>
        <div style={{ background:isDecay?`${RED}12`:isContinuation?`${GREEN}12`:pri.bg,borderRadius:8,padding:"5px 12px",display:"flex",alignItems:"center",gap:5 }}>
          {(isDecay||isContinuation||pri.pulse)&&<div style={{ width:6,height:6,borderRadius:"50%",background:isDecay?RED:isContinuation?GREEN:pri.dot,animation:"pulse-dot 1.2s ease-in-out infinite" }}/>}
          <span style={{ fontSize:11,fontWeight:800,color:isDecay?RED:isContinuation?GREEN:pri.color }}>
            {isDecay?"REVIEW":isContinuation?"CONTINUE":pri.label}
          </span>
        </div>
      </div>

      {/* Topic badge */}
      <div style={{ display:"inline-flex",alignItems:"center",gap:6,
        background:isDecay?`${RED}10`:isContinuation?`${GREEN}10`:`${sc}12`,
        border:`1px solid ${isDecay?`${RED}30`:isContinuation?`${GREEN}30`:`${sc}25`}`,
        borderRadius:8,padding:"5px 12px",marginBottom:12 }}>
        <span style={{ fontSize:13 }}>{SUBJECTS[session.subject]?.icon}</span>
        <span style={{ fontSize:12,fontWeight:700,color:isDecay?RED:isContinuation?GREEN:sc }}>{session.topic}</span>
      </div>

      {/* DECAY details */}
      {isDecay&&(<>
        <div style={{ background:"#FFF5F5",borderRadius:14,border:"1px solid rgba(239,68,68,.20)",padding:"12px 14px",marginBottom:12 }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6 }}>
            <span style={{ fontSize:11,fontWeight:700,color:"#6B7280" }}>Confidence</span>
            <span style={{ fontSize:12,fontWeight:900,color:RED }}>{decayAlert.confidence}%{" "}
              <span style={{ fontSize:10,fontWeight:600,color:"#9CA3AF" }}>(was {decayAlert.prevConfidence}%)</span>
            </span>
          </div>
          <div style={{ height:6,background:"#F3F4F6",borderRadius:99,overflow:"hidden",marginBottom:6 }}>
            <div style={{ height:"100%",width:`${decayAlert.confidence}%`,background:`linear-gradient(90deg,${RED}88,${RED})`,borderRadius:99 }}/>
          </div>
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:10,fontWeight:600,color:"#9CA3AF" }}>
            <span style={{ color:RED }}>▼ dropped {drop}%</span>
            <span>{decayAlert.daysSince} days since last session</span>
          </div>
        </div>
        {decayAlert.misconceptions?.length>0&&(
          <div style={{ background:"#FFF7ED",border:"1px solid rgba(245,158,11,.25)",borderRadius:14,padding:"12px 14px",marginBottom:12 }}>
            <p style={{ fontSize:11,fontWeight:800,color:"#92400E",margin:"0 0 8px",letterSpacing:.3 }}>⚠ Flagged gaps</p>
            {decayAlert.misconceptions.map((m,i)=><p key={i} style={{ fontSize:12.5,color:"#7C2D12",margin:"0 0 4px",fontWeight:600 }}>· {m}</p>)}
          </div>
        )}
        <div style={{ background:"#F9FAFB",borderRadius:14,border:"1px solid #F3F4F6",padding:"11px 14px",marginBottom:14 }}>
          <p style={{ fontSize:11,fontWeight:700,color:"#6B7280",margin:"0 0 8px" }}>Session stats</p>
          <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
            {[{icon:"📌",val:`${session.topics||0} topics`,label:"to review and refresh"},
              {icon:"🔁",val:`${session.revisions||0} re-teaches`,label:"completed so far"},
              {icon:"⭐",val:`${session.reviews||0} assessments`,label:"passed with Sargeant"}
            ].map(({icon,val,label})=>(
              <div key={icon} style={{ display:"flex",alignItems:"center",gap:8 }}>
                <span style={{ fontSize:13 }}>{icon}</span>
                <span style={{ fontSize:12,fontWeight:800,color:"#111827" }}>{val}</span>
                <span style={{ fontSize:11,color:"#9CA3AF" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </>)}

      {/* CONTINUATION details */}
      {isContinuation&&(<>
        <div style={{ background:"#F0FDF4",borderRadius:14,border:"1px solid rgba(16,185,129,.20)",padding:"12px 14px",marginBottom:12 }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6 }}>
            <span style={{ fontSize:11,fontWeight:700,color:"#6B7280" }}>Avg Confidence</span>
            <span style={{ fontSize:12,fontWeight:900,color:GREEN }}>{session.avgConfidence||session.progress||0}%</span>
          </div>
          <div style={{ height:6,background:"#F3F4F6",borderRadius:99,overflow:"hidden",marginBottom:6 }}>
            <div style={{ height:"100%",width:`${session.avgConfidence||session.progress||0}%`,background:`linear-gradient(90deg,${GREEN}88,${GREEN})`,borderRadius:99 }}/>
          </div>
          <p style={{ fontSize:10,fontWeight:600,color:"#9CA3AF",margin:0 }}>
            Last taught {session.daysSince===0?"today":session.daysSince===1?"yesterday":`${session.daysSince||0} days ago`}
          </p>
        </div>
        {session.subtopicList?.length>0&&(
          <div style={{ background:"#F9FAFB",border:"1px solid #F3F4F6",borderRadius:14,padding:"11px 14px",marginBottom:12 }}>
            <p style={{ fontSize:11,fontWeight:700,color:"#6B7280",margin:"0 0 8px" }}>Subtopics covered</p>
            <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
              {session.subtopicList.map((st,i)=>(
                <span key={i} style={{ fontSize:11,fontWeight:700,color:sc,background:`${sc}12`,borderRadius:8,padding:"3px 9px",border:`1px solid ${sc}25` }}>{st}</span>
              ))}
            </div>
          </div>
        )}
        <div style={{ background:"#F9FAFB",borderRadius:14,border:"1px solid #F3F4F6",padding:"11px 14px",marginBottom:14 }}>
          <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
            {[{icon:"📌",val:`${session.topics||0} subtopics`,label:"in this session"},
              {icon:"🔁",val:`${session.revisions||0} assessments`,label:"with Sargeant"},
              {icon:"⭐",val:`${session.reviews||0} passed`,label:"above 70% confidence"}
            ].map(({icon,val,label})=>(
              <div key={icon} style={{ display:"flex",alignItems:"center",gap:8 }}>
                <span style={{ fontSize:13 }}>{icon}</span>
                <span style={{ fontSize:12,fontWeight:800,color:"#111827" }}>{val}</span>
                <span style={{ fontSize:11,color:"#9CA3AF" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </>)}

      {/* NORMAL session details */}
      {!isDecay&&!isContinuation&&(<>
        <p style={{ fontSize:14,color:"#374151",fontWeight:600,lineHeight:1.6,marginBottom:14 }}>{session.description}</p>
        {session.progress>0&&(
          <div style={{ background:"#F9FAFB",borderRadius:14,border:"1px solid #F3F4F6",padding:"11px 14px",marginBottom:14 }}>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4 }}>
              <span style={{ fontSize:11,fontWeight:700,color:"#6B7280" }}>Your Progress</span>
              <span style={{ fontSize:13,fontWeight:900,color:sc }}>{session.progress}%</span>
            </div>
            <ProgressBar value={session.progress} color={sc}/>
          </div>
        )}
        {session.type==="live"&&(
          <div style={{ display:"flex",gap:10,marginBottom:14 }}>
            <a href="tel:" style={{ textDecoration:"none",flex:1 }}><button style={{ width:"100%",padding:"11px",borderRadius:14,border:"none",background:`linear-gradient(135deg,${GREEN},#059669)`,fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:7 }}><PhoneIcon size={15}/>Call Tutor</button></a>
            <a href="sms:" style={{ textDecoration:"none",flex:1 }}><button style={{ width:"100%",padding:"11px",borderRadius:14,border:"1.5px solid #E5E7EB",background:"#F9FAFB",fontSize:13,fontWeight:800,color:"#374151",cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:7 }}><MessageIcon size={15} color="#374151"/>Message</button></a>
          </div>
        )}
      </>)}

      {/* CTA buttons */}
      <div style={{ display:"flex",gap:10 }}>
        <button onClick={onClose} style={{ flex:1,padding:"13px",borderRadius:14,border:"1.5px solid #E5E7EB",background:"#F9FAFB",fontSize:13,fontWeight:800,color:"#6B7280",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>Close</button>
        <button onClick={()=>{onClose();onStartTeach(session);}}
          style={{ flex:1.5,padding:"13px",borderRadius:14,border:"none",background:ctaBg,
            fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif",
            display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
          <PlayIcon size={13}/>{ctaLabel}
        </button>
      </div>
    </div></>
  );
}


/* ══════════════════════════════════════════════════════

export default SessionSheet;
