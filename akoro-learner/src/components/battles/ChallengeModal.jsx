import React from 'react';
import { BRAND, RED, GREEN, GOLD, DIFFICULTY_CONFIG, SUBJECT_COLORS, SUBJECTS } from '../../constants.js';
import { XIcon, ZapIcon, StarIcon } from '../common/Icons.jsx';

function ChallengeModal({ challenge, onAccept, onDecline, onClose }) {
  const sc=SUBJECT_COLORS[challenge.subject]||BRAND,diff=DIFFICULTY_CONFIG[challenge.difficulty],isImmediate=challenge.battleType==="immediate",isClassroom=challenge.battleType==="classroom";
  const typePill=isClassroom?{label:"🏫 Classroom battle",bg:"rgba(16,185,129,.10)",color:"#10B981",border:"rgba(16,185,129,.25)"}:isImmediate?{label:"⚡ Immediate battle",bg:"rgba(239,68,68,.10)",color:RED,border:"rgba(239,68,68,.25)"}:{label:"🗓 Scheduled battle",bg:"rgba(108,59,255,.10)",color:BRAND,border:"rgba(108,59,255,.25)"};
  return (
    <><div onClick={onClose} style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(6,6,18,.72)",backdropFilter:"blur(8px)" }}/><div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:2100,background:"#fff",borderRadius:"24px 24px 0 0",padding:"0 0 40px",boxShadow:"0 -8px 40px rgba(0,0,0,.18)",animation:"sheet-up .32s cubic-bezier(.32,1.2,.64,1)",fontFamily:"'Nunito',sans-serif",maxHeight:"88vh",overflowY:"auto" }}>
      <div style={{ width:38,height:4,borderRadius:2,background:"#D1D5DB",margin:"14px auto 0" }}/><div style={{ padding:"18px 20px 0" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8,padding:"9px 14px",borderRadius:12,background:typePill.bg,border:`1px solid ${typePill.border}`,marginBottom:16 }}>
          <div style={{ flex:1 }}><div style={{ fontSize:11,fontWeight:900,color:typePill.color,marginBottom:2 }}>{typePill.label}</div><div style={{ fontSize:11,fontWeight:600,color:"#6B7280" }}>{isClassroom?`Accept → join the class battle · ${challenge.participants?.length} agents competing`:isImmediate?"Accept → battle starts immediately in Watch Live":`Accept → added to Battles › Scheduled · Starts ${challenge.scheduledFor}`}</div></div>
          {isClassroom?<div style={{ width:32,height:32,borderRadius:"50%",background:"#10B981",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:16 }}>🏫</div>:isImmediate?<div style={{ width:32,height:32,borderRadius:"50%",background:RED,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><ZapIcon size={16} color="#fff"/></div>:<div style={{ width:32,height:32,borderRadius:"50%",background:BRAND,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:16 }}>🗓</div>}
        </div>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
          <div style={{ display:"flex",alignItems:"center",gap:12 }}><div style={{ position:"relative" }}><img src={challenge.avatar} alt="" style={{ width:48,height:48,borderRadius:"50%",objectFit:"cover",border:`2.5px solid ${sc}` }}/><div style={{ position:"absolute",bottom:0,right:0,width:16,height:16,borderRadius:"50%",background:isClassroom?"#10B981":isImmediate?RED:BRAND,border:"2px solid #fff",display:"flex",alignItems:"center",justifyContent:"center" }}><ZapIcon size={8} color="#fff"/></div></div>
            <div><p style={{ fontSize:15,fontWeight:900,color:"#111827",margin:0 }}>{challenge.challenger}</p><div style={{ display:"flex",alignItems:"center",gap:4,marginTop:2 }}><StarIcon size={11} color={GOLD}/><span style={{ fontSize:11,fontWeight:700,color:"#9CA3AF" }}>{challenge.rating} · {challenge.badge}</span></div></div></div>
          <div style={{ background:diff.bg,borderRadius:8,padding:"4px 11px",display:"flex",alignItems:"center",gap:5 }}><div style={{ width:6,height:6,borderRadius:"50%",background:diff.color }}/><span style={{ fontSize:10,fontWeight:800,color:diff.color }}>{diff.label}</span></div>
        </div>
        <div style={{ display:"inline-flex",alignItems:"center",gap:6,background:`${sc}14`,border:`1px solid ${sc}28`,borderRadius:8,padding:"5px 12px",marginBottom:12 }}><span style={{ fontSize:13 }}>{SUBJECTS[challenge.subject]?.icon}</span><span style={{ fontSize:12,fontWeight:700,color:sc }}>{SUBJECTS[challenge.subject]?.label}</span></div>
        <p style={{ fontSize:17,fontWeight:900,color:"#111827",margin:"0 0 6px" }}>{challenge.title}</p>
        <p style={{ fontSize:13.5,fontWeight:600,color:"#374151",lineHeight:1.6,margin:"0 0 18px" }}>{challenge.description}</p>
        {isClassroom&&challenge.participants&&(
          <div style={{ marginBottom:16,padding:"12px 14px",background:"rgba(16,185,129,.06)",borderRadius:14,border:"1px solid rgba(16,185,129,.20)" }}>
            <p style={{ fontSize:10,fontWeight:800,color:"#10B981",margin:"0 0 10px",letterSpacing:.3 }}>👥 STUDENT AGENTS COMPETING</p>
            <div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>
              {challenge.participants.map(p=><div key={p.id} style={{ display:"flex",alignItems:"center",gap:6,background:"#fff",borderRadius:20,padding:"4px 10px 4px 4px",border:"1px solid #E5E7EB" }}><div style={{ width:24,height:24,borderRadius:"50%",background:p.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13 }}>{p.emoji}</div><div><div style={{ fontSize:10.5,fontWeight:800,color:"#111827" }}>{p.name}{p.isYou&&<span style={{ marginLeft:4,fontSize:9,fontWeight:900,color:BRAND,background:`${BRAND}15`,borderRadius:4,padding:"0 4px" }}>YOU</span>}</div><div style={{ fontSize:9.5,color:"#9CA3AF" }}>{p.owner}</div></div></div>)}
            </div>
          </div>
        )}
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16 }}>
          {[{label:"XP Prize",value:challenge.xpPrize,icon:"⚡"},{label:"Time Limit",value:challenge.timeLimit,icon:"⏱"},{label:isClassroom?"Expires In":isImmediate?"Expires In":"Starts",value:isClassroom?challenge.expiresIn:isImmediate?challenge.expiresIn:challenge.scheduledFor,icon:isClassroom?"⏰":isImmediate?"🔥":"🗓"}].map(({label,value,icon})=>(
            <div key={label} style={{ background:"#F9FAFB",borderRadius:12,padding:"10px",border:"1px solid #F3F4F6",textAlign:"center" }}><p style={{ fontSize:10,fontWeight:600,color:"#9CA3AF",margin:"0 0 3px" }}>{icon} {label}</p><p style={{ fontSize:12,fontWeight:900,color:"#111827",margin:0 }}>{value}</p></div>
          ))}
        </div>
        <div style={{ display:"flex",gap:10 }}>
          <button onClick={onDecline} style={{ flex:1,padding:"14px",borderRadius:14,border:"1.5px solid #E5E7EB",background:"#F9FAFB",fontSize:14,fontWeight:800,color:"#6B7280",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>Decline</button>
          <button onClick={onAccept} style={{ flex:1.8,padding:"14px",borderRadius:14,border:"none",background:isClassroom?"linear-gradient(135deg,#10B981,#059669)":isImmediate?`linear-gradient(135deg,${RED},#DC2626)`:`linear-gradient(135deg,${BRAND},#4C1DCC)`,fontSize:14,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}><ZapIcon size={15} color="#fff"/>{isClassroom?"Join Class Battle":isImmediate?"Accept & Watch Live":"Accept & Schedule"}</button>
        </div>
      </div></div></>
  );
}

/* ══════════════════════════════════════════════════════ */

export default ChallengeModal;
