import React from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, PRIORITY_CONFIG } from '../../constants.js';
import { ProgressBar } from '../common/ProgressBar.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';

function SessionCard({ session, onTap, decayAlert, agentProfile }) {
  const { t } = useLang();
  const sc    = SUBJECT_COLORS[session.subject] || BRAND;
  const pri   = PRIORITY_CONFIG[session.priority] || PRIORITY_CONFIG.normal;
  const isDecay = !!decayAlert;
  const drop  = isDecay ? (decayAlert.prevConfidence - decayAlert.confidence) : 0;

  return (
    <div onClick={()=>onTap(session)} style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 18px",borderBottom:"1px solid var(--ak-border)",cursor:"pointer",background:isDecay?"#FFFBF5":"var(--ak-surface)",transition:"background .2s" }}>

      {/* Avatar — agent emoji for decay, tutor photo otherwise */}
      <div style={{ position:"relative",flexShrink:0 }}>
        {isDecay ? (
          <div style={{ width:48,height:48,borderRadius:"50%",background:`${BRAND}15`,
            border:`2px solid ${RED}`,display:"flex",alignItems:"center",
            justifyContent:"center",fontSize:24 }}>
            {agentProfile?.emoji || "🤖"}
          </div>
        ) : (
          <img src={session.avatar} alt="" style={{ width:48,height:48,borderRadius:"50%",objectFit:"cover",border:`2px solid ${sc}50` }}/>
        )}
        <div style={{ position:"absolute",bottom:1,right:1,width:12,height:12,borderRadius:"50%",
          background:isDecay?RED:pri.dot,border:"2px solid var(--ak-surface)",
          animation:isDecay||pri.pulse?"pulse-dot 1.2s ease-in-out infinite":"none" }}/>
      </div>

      <div style={{ flex:1,minWidth:0 }}>
        {/* Title row */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:1 }}>
          <span style={{ fontSize:14,fontWeight:800,color:"var(--ak-text)",letterSpacing:-0.1 }}>{session.title}</span>
          <span style={{ fontSize:11,fontWeight:600,color:isDecay?RED:"var(--ak-text-muted)",flexShrink:0,marginLeft:8 }}>
            {isDecay ? `${decayAlert.daysSince}d ago` : session.nextSession}
          </span>
        </div>

        {/* Name + subtitle row */}
        <div style={{ display:"flex",alignItems:"center",gap:5,marginBottom:3 }}>
          <span style={{ fontSize:10,fontWeight:700,
            color:isDecay?RED:sc,
            background:isDecay?`${RED}12`:`${sc}14`,
            borderRadius:5,padding:"1px 7px",flexShrink:0 }}>
            {SUBJECTS[session.subject]?.icon} {isDecay ? decayAlert.topic : SUBJECTS[session.subject]?.label}
          </span>
          <span style={{ fontSize:10,fontWeight:600,color:"var(--ak-text-muted)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
            {isDecay
              ? `${agentProfile?.name || t('card.agent')} · ${t('card.needs_your_help')}`
              : session.topic}
          </span>
        </div>

        {/* Meta row */}
        {isDecay ? (
          <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
            <span style={{ fontSize:9.5,fontWeight:700,color:RED,fontFamily:"monospace" }}>
              ⚠ {t('card.confidence')} {decayAlert.confidence}% ({t('card.was')} {decayAlert.prevConfidence}%)
            </span>
            {decayAlert.misconceptions?.length > 0 && (
              <span style={{ fontSize:9.5,fontWeight:600,color:"var(--ak-text-muted)",fontFamily:"monospace" }}>
                · {decayAlert.misconceptions[0]}
              </span>
            )}
          </div>
        ) : (
          <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
            {[{v:session.id,c:"var(--ak-text-muted)"},{v:`🕐 ${session.time}`,c:"var(--ak-text-muted)"},{v:`📌 ${session.topics} ${t('card.topics')}`,c:sc},{v:`🔁 ${session.revisions} ${t('card.revisions')}`,c:"var(--ak-text-muted)"},{v:`⭐ ${session.reviews} ${t('card.reviews')}`,c:GOLD}].map(({v,c},i)=>(
              <span key={i} style={{ fontSize:9.5,fontWeight:700,color:c,fontFamily:"monospace" }}>{v}</span>
            ))}
          </div>
        )}

        {/* Progress / confidence bar */}
        {isDecay ? (
          <div style={{ marginTop:5 }}>
            <div style={{ height:5,background:"var(--ak-tag-bg)",borderRadius:99,overflow:"hidden" }}>
              <div style={{ height:"100%",width:`${decayAlert.confidence}%`,
                background:`linear-gradient(90deg,${RED}88,${RED})`,borderRadius:99 }}/>
            </div>
          </div>
        ) : session.progress > 0 ? (
          <ProgressBar value={session.progress} color={sc}/>
        ) : null}
      </div>

      {/* Right indicator */}
      {isDecay ? (
        <div style={{ width:20,height:20,borderRadius:"50%",background:`${RED}15`,flexShrink:0,
          display:"flex",alignItems:"center",justifyContent:"center",
          border:`1.5px solid ${RED}40`,animation:"pulse-dot 1.5s ease-in-out infinite" }}>
          <span style={{ fontSize:10 }}>⚠</span>
        </div>
      ) : session.unread > 0 ? (
        <div style={{ width:20,height:20,borderRadius:"50%",background:sc,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center" }}>
          <span style={{ fontSize:10,fontWeight:800,color:"#fff" }}>{session.unread}</span>
        </div>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════ */

export default SessionCard;
