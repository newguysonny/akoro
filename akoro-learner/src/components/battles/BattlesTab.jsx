import React, { useState } from 'react';
import { BRAND, RED, GREEN, GOLD, difficultyStyle, subjectStyle, AVATAR_FALLBACK } from '../../constants.js';
import { ZapIcon, StarIcon } from '../common/Icons.jsx';
import BattleModal from './BattleModal.jsx';
import CreateBattleSheet from './CreateBattleSheet.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';

function ChallengeRow({ challenge, onTap }) {
  const { t } = useLang();
  const subj=subjectStyle(challenge.subject),sc=subj.color,diff=difficultyStyle(challenge.difficulty),isImmediate=challenge.battleType==="immediate",isClassroom=challenge.battleType==="classroom";
  const typePill=isClassroom?{label:`🏫 ${t('battles.classroom')}`,bg:"rgba(16,185,129,.10)",color:"#10B981",border:"rgba(16,185,129,.25)"}:isImmediate?{label:`⚡ ${t('battles.immediate')}`,bg:"rgba(239,68,68,.10)",color:RED,border:"rgba(239,68,68,.25)"}:{label:`🗓 ${t('battles.scheduled')}`,bg:"rgba(108,59,255,.10)",color:BRAND,border:"rgba(108,59,255,.25)"};
  return (
    <div onClick={()=>onTap(challenge)} style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 18px",borderBottom:"1px solid var(--ak-border)",cursor:"pointer",background:"var(--ak-surface)",transition:"background .15s" }}>
      <div style={{ position:"relative",flexShrink:0 }}>
        <img src={challenge.avatar || AVATAR_FALLBACK} alt="" style={{ width:48,height:48,borderRadius:"50%",objectFit:"cover",border:`2px solid ${sc}60` }}/>
        <div style={{ position:"absolute",bottom:1,right:1,width:12,height:12,borderRadius:"50%",background:isImmediate?RED:isClassroom?"#10B981":BRAND,border:"2px solid #fff",animation:isImmediate?"pulse-dot 1.2s ease-in-out infinite":"none" }}/>
      </div>
      <div style={{ flex:1,minWidth:0 }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4 }}>
          <span style={{ fontSize:14,fontWeight:800,color:"var(--ak-text)" }}>{challenge.challenger}</span>
          <span style={{ fontSize:11,fontWeight:800,color:GOLD,flexShrink:0,marginLeft:8 }}>{challenge.xpPrize}</span>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:5,marginBottom:5,flexWrap:"wrap" }}>
          <span style={{ fontSize:10,fontWeight:700,color:sc,background:`${sc}14`,borderRadius:5,padding:"1px 7px",flexShrink:0 }}>{subj.icon} {challenge.title}</span>
          <div style={{ background:diff.bg,borderRadius:5,padding:"1px 7px",flexShrink:0 }}><span style={{ fontSize:9.5,fontWeight:800,color:diff.color }}>{diff.label}</span></div>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:7,flexWrap:"wrap" }}>
          <div style={{ display:"inline-flex",alignItems:"center",gap:4,padding:"2px 9px",borderRadius:20,background:typePill.bg,border:`1px solid ${typePill.border}` }}><span style={{ fontSize:9.5,fontWeight:900,color:typePill.color }}>{typePill.label}</span></div>
          {isClassroom?<span style={{ fontSize:10.5,fontWeight:600,color:"#10B981" }}>👥 {(challenge.participants?.length ?? challenge.participantCount ?? 0)} {t('battles.agents')} · ⏱ {challenge.timeLimit} · ⏰ {challenge.expiresIn}</span>:isImmediate?<span style={{ fontSize:10.5,fontWeight:600,color:"var(--ak-text-muted)" }}>⏰ {t('battles.expires_in')} {challenge.expiresIn} · ⏱ {challenge.timeLimit}</span>:<span style={{ fontSize:10.5,fontWeight:600,color:BRAND }}>🗓 {challenge.scheduledFor} · ⏱ {challenge.timeLimit}</span>}
        </div>
      </div>
      <div style={{ width:28,height:28,borderRadius:"50%",background:isImmediate?`${RED}12`:`${BRAND}12`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",border:`1.5px solid ${isImmediate?RED:BRAND}40` }}><ZapIcon size={12} color={isImmediate?RED:BRAND}/></div>
    </div>
  );
}


function BattlesTab({ battles, onViewChallenge, onBattleCreated }) {
  const { t } = useLang();
  const [viewFilter, setViewFilter] = useState("active");
  const [watching,   setWatching]   = useState(null);
  const [creating,   setCreating]   = useState(false);
  const liveBattles      = battles.filter(b=>b.status==="live");
  // A battle you have made but nobody has accepted yet. It used to last five
  // seconds, so nothing showed it; now every battle waits for its invitations,
  // and a lobby can sit for the whole invite window. Without this the battle
  // you just created appears NOWHERE — not live, not scheduled, not completed.
  const waitingBattles   = battles.filter(b=>b.status==="lobby");
  const scheduledBattles = battles.filter(b=>b.status==="scheduled");
  const completedBattles = battles.filter(b=>b.status==="completed");
  const displayed = viewFilter==="active"?[...liveBattles,...waitingBattles]
                   :viewFilter==="scheduled"?scheduledBattles:completedBattles;
  const totalXP  = battles.reduce((s,b)=>s+(parseInt((b.xpPrize||"0").replace(/\D/g,""),10)||0),0);
  
  const ST_STYLE = {
    live:     {label:"● LIVE",   bg:"rgba(239,68,68,.12)",  color:RED,   border:"rgba(239,68,68,.25)"  },
    scheduled:{label:"SCHEDULED",bg:"rgba(108,59,255,.10)", color:BRAND, border:"rgba(108,59,255,.25)" },
    completed:{label:"COMPLETED",bg:"rgba(16,185,129,.10)", color:GREEN, border:"rgba(16,185,129,.25)" },
    lobby:    {label:"WAITING",  bg:"rgba(245,158,11,.12)", color:GOLD,  border:"rgba(245,158,11,.28)" },
  };
  const TABS=[{key:"active",label:t('battles.active'),icon:"⚡",count:liveBattles.length+waitingBattles.length},{key:"scheduled",label:t('battles.scheduled'),icon:"🗓",count:scheduledBattles.length},{key:"completed",label:t('battles.completed'),icon:"🏆",count:completedBattles.length}];
  return (
    <div style={{ flex:1,overflowY:"auto",background:"var(--ak-surface)",display:"flex",flexDirection:"column" }}>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,padding:"12px 16px 10px",borderBottom:"1px solid var(--ak-border)" }}>
        {[{val:liveBattles.length,label:t('battles.live'),color:RED,bg:`${RED}0a`},{val:scheduledBattles.length,label:t('battles.scheduled'),color:BRAND,bg:`${BRAND}0a`},{val:completedBattles.length,label:t('battles.completed'),color:GREEN,bg:"rgba(16,185,129,.07)"},{val:`+${totalXP}`,label:t('battles.xp_at_stake'),color:GOLD,bg:"rgba(245,158,11,.07)"}].map(({val,label,color,bg})=>(
          <div key={label} style={{ textAlign:"center",background:bg,borderRadius:12,padding:"9px 4px",border:`1px solid ${color}25` }}>
            <div style={{ fontSize:17,fontWeight:900,color }}>{val}</div>
            <div style={{ fontSize:9.5,color:"var(--ak-text-muted)",marginTop:1,fontWeight:600 }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ display:"flex",borderBottom:"1px solid var(--ak-border)",background:"var(--ak-surface)",flexShrink:0 }}>
        {TABS.map(({key,label,icon,count})=>(
          <button key={key} onClick={()=>setViewFilter(key)} style={{ flex:1,padding:"9px 4px 10px",background:"none",border:"none",cursor:"pointer",fontSize:11.5,fontWeight:viewFilter===key?800:600,color:viewFilter===key?BRAND:"var(--ak-text-muted)",borderBottom:`2.5px solid ${viewFilter===key?BRAND:"transparent"}`,transition:"all .2s",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:5 }}>
            <span style={{ fontSize:13 }}>{icon}</span>{label}
            {count>0&&<span style={{ fontSize:9.5,fontWeight:900,background:viewFilter===key?BRAND:"var(--ak-border)",color:viewFilter===key?"#fff":"var(--ak-text-muted)",borderRadius:8,padding:"1px 6px" }}>{count}</span>}
          </button>
        ))}
      </div>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"8px 16px 6px",borderBottom:"1px solid var(--ak-border)" }}>
        <button onClick={()=>setCreating(true)} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,fontSize:11.5,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>⚔️ Start a battle</button>
        <button onClick={onViewChallenge} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:`1.5px solid ${RED}40`,background:`${RED}08`,fontSize:11.5,fontWeight:800,color:RED,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}><ZapIcon size={11} color={RED}/>{t('battles.find_challenges')}</button>
      </div>
      {battles.length===0&&(
        <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,padding:"40px 24px" }}>
          <span style={{ fontSize:52,opacity:.2 }}>⚔️</span>
          <p style={{ fontSize:15,fontWeight:800,color:"var(--ak-text-muted)",textAlign:"center" }}>{t('battles.empty')}</p>
          <p style={{ fontSize:12,fontWeight:600,color:"var(--ak-text-muted)",textAlign:"center" }}>{t('battles.empty_hint')}</p>
          <button onClick={onViewChallenge} style={{ padding:"10px 22px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",gap:7 }}><ZapIcon size={13} color="#fff"/>{t('battles.view_challenges')}</button>
        </div>
      )}
      {battles.length>0&&displayed.length===0&&(
        <div style={{ textAlign:"center",padding:"36px 24px",color:"var(--ak-text-muted)" }}>
          <span style={{ fontSize:36,opacity:.3 }}>{viewFilter==="active"?"⚡":viewFilter==="scheduled"?"🗓":"🏆"}</span>
          <p style={{ fontSize:13,fontWeight:700,marginTop:8 }}>{viewFilter==="active"?t('battles.none_live'):viewFilter==="scheduled"?t('battles.none_scheduled'):t('battles.none_completed')}</p>
        </div>
      )}
      <div style={{ padding:"10px 16px",display:"flex",flexDirection:"column",gap:10 }}>
        {displayed.map(b=>{
          const bs=subjectStyle(b.subject),sc=bs.color,diff=difficultyStyle(b.difficulty),st=ST_STYLE[b.status]||ST_STYLE.scheduled,A=b.agentA,B=b.agentB;
          return (
            <div key={b.id} style={{ borderRadius:18,border:`1.5px solid ${b.status==="live"?"rgba(239,68,68,.30)":b.status==="scheduled"?"rgba(108,59,255,.25)":"var(--ak-border)"}`,background:b.status==="live"?"linear-gradient(140deg,#FFF5F5,#FFFCFC)":b.status==="scheduled"?"linear-gradient(140deg,#F5F3FF,#FCFCFF)":"var(--ak-surface)",overflow:"hidden" }}>
              {b.status==="live"&&<div style={{ height:3,background:`linear-gradient(90deg,${RED},#FF6B6B,${RED})`,backgroundSize:"200% 100%",animation:"shimmer 1.8s linear infinite" }}/>}
              {b.status==="scheduled"&&<div style={{ height:3,background:`linear-gradient(90deg,${BRAND},#818CF8,${BRAND})`,backgroundSize:"200% 100%",animation:"shimmer 2.2s linear infinite" }}/>}
              <div style={{ padding:"13px 14px" }}>
                <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:10 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0 }}>
                    <img src={b.avatar || AVATAR_FALLBACK} alt="" style={{ width:40,height:40,borderRadius:"50%",objectFit:"cover",border:`2px solid ${sc}50`,flexShrink:0 }}/>
                    <div style={{ minWidth:0 }}><p style={{ fontSize:14,fontWeight:900,color:"var(--ak-text)",margin:"0 0 2px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{b.title}</p><p style={{ fontSize:11,color:"var(--ak-text-muted)",margin:0 }}>vs {b.challenger}</p></div>
                  </div>
                  <div style={{ background:st.bg,borderRadius:8,padding:"3px 9px",border:`1px solid ${st.border}`,flexShrink:0,display:"flex",alignItems:"center",gap:4 }}>
                    {b.status==="live"&&<div style={{ width:5,height:5,borderRadius:"50%",background:RED,animation:"pulse-dot 1s ease-in-out infinite" }}/>}
                    <span style={{ fontSize:9.5,fontWeight:900,color:st.color,letterSpacing:.3 }}>{st.label}</span>
                  </div>
                </div>
                {b.battleType==="classroom"&&b.participants?.length>0?(
                  <div style={{ display:"flex",alignItems:"center",gap:6,background:"rgba(16,185,129,.06)",borderRadius:12,padding:"8px 10px",marginBottom:10,border:"1px solid rgba(16,185,129,.18)" }}>
                    <span style={{ fontSize:10,fontWeight:800,color:"#10B981",flexShrink:0 }}>🏫 CLASS</span>
                    <div style={{ display:"flex",gap:5,flexWrap:"wrap",flex:1 }}>{b.participants.map(p=><div key={p.id} title={`${p.name} · ${p.owner}`} style={{ width:26,height:26,borderRadius:"50%",background:p.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,border:p.isYou?"2px solid #E8884A":"1px solid rgba(255,255,255,.3)",flexShrink:0 }}>{p.emoji}</div>)}</div>
                    <span style={{ fontSize:10,fontWeight:700,color:"rgba(255,255,255,.40)",flexShrink:0 }}>{b.participants.length} {t('battles.agents')}</span>
                  </div>
                ):A&&B&&(
                  <div style={{ display:"flex",alignItems:"center",gap:8,background:"rgba(0,0,0,.025)",borderRadius:12,padding:"10px 12px",marginBottom:10 }}>
                    <div style={{ flex:1,display:"flex",alignItems:"center",gap:7 }}>
                      <div style={{ width:32,height:32,borderRadius:"50%",background:A.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0 }}>{A.emoji}</div>
                      <div><div style={{ fontSize:11.5,fontWeight:800,color:"var(--ak-text)" }}>{A.name}</div>{A.isYou&&<span style={{ fontSize:8.5,fontWeight:800,background:"#1A1A2E",color:"#fff",borderRadius:4,padding:"1px 5px" }}>{t('battles.you')}</span>}<div style={{ fontSize:14,fontWeight:900,color:A.color }}>{b.status==="scheduled"||b.status==="lobby"?"—":A.score}</div></div>
                    </div>
                    <div style={{ width:28,height:28,borderRadius:"50%",background:"#1A1A2E",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff",flexShrink:0 }}>{t('battles.vs')}</div>
                    <div style={{ flex:1,display:"flex",alignItems:"center",gap:7,justifyContent:"flex-end",flexDirection:"row-reverse" }}>
                      <div style={{ width:32,height:32,borderRadius:"50%",background:B.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0 }}>{B.emoji}</div>
                      <div style={{ textAlign:"right" }}><div style={{ fontSize:11.5,fontWeight:800,color:"var(--ak-text)" }}>{B.name}</div><div style={{ fontSize:14,fontWeight:900,color:B.color }}>{b.status==="scheduled"||b.status==="lobby"?"—":B.score}</div></div>
                    </div>
                  </div>
                )}
                <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap" }}>
                  <span style={{ fontSize:10,fontWeight:700,color:sc,background:`${sc}14`,borderRadius:5,padding:"1px 7px" }}>{bs.icon} {bs.label}</span>
                  <div style={{ background:diff.bg,borderRadius:5,padding:"1px 7px" }}><span style={{ fontSize:9.5,fontWeight:800,color:diff.color }}>{diff.label}</span></div>
                  <span style={{ fontSize:10.5,fontWeight:800,color:GOLD,display:"flex",alignItems:"center",gap:3 }}><ZapIcon size={10} color={GOLD}/>{b.xpPrize}</span>
                  <span style={{ fontSize:10.5,color:"var(--ak-text-muted)",fontWeight:600 }}>⏱ {b.timeLimit}</span>
                  {b.status==="live"&&<span style={{ fontSize:10,color:RED,fontWeight:700 }}>{t('battles.started_ago').replace('{min}',b.startedAgo)}</span>}
                  {b.status==="scheduled"&&<span style={{ fontSize:10,color:BRAND,fontWeight:700 }}>🗓 {b.startsIn}</span>}
                  {b.status==="lobby"&&<span style={{ fontSize:10,color:GOLD,fontWeight:700 }}>⏳ Waiting for players to accept</span>}
                </div>
                {b.status==="completed"&&(<div style={{ display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:10,background:"rgba(16,185,129,.07)",border:"1px solid rgba(16,185,129,.20)",marginBottom:10 }}><span style={{ fontSize:14 }}>🏆</span><span style={{ fontSize:12,fontWeight:700,color:GREEN }}>{t('battles.result').replace('{winner}',b.winner===b.agentA?.id?b.agentA?.name:b.agentB?.name).replace('{a}',b.agentA?.score).replace('{b}',b.agentB?.score)}</span></div>)}
                <div style={{ display:"flex",gap:7 }}>
                  {b.status==="live"&&<button onClick={()=>setWatching(b)} style={{ flex:1,padding:"10px",borderRadius:12,border:"none",background:`linear-gradient(135deg,${RED},#DC2626)`,color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><span style={{ fontSize:14 }}>📺</span>{t('battles.watch_live')}</button>}
                  {b.status==="scheduled"&&<button onClick={()=>setWatching(b)} style={{ flex:1,padding:"10px",borderRadius:12,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><span style={{ fontSize:14 }}>👁</span>{t('battles.preview')}</button>}
                  {b.status==="completed"&&<button onClick={()=>setWatching(b)} style={{ flex:1,padding:"10px",borderRadius:12,border:`1.5px solid var(--ak-border2)`,background:"var(--ak-surface-hover)",color:"var(--ak-text-sec)",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><span style={{ fontSize:14 }}>📊</span>{t('battles.view_result')}</button>}
                  <button style={{ padding:"10px 14px",borderRadius:12,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",color:"var(--ak-text-muted)",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{t('battles.details')}</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {watching&&<BattleModal battle={watching} onClose={()=>setWatching(null)}/>}
      {creating&&<CreateBattleSheet onClose={()=>setCreating(false)} onCreated={onBattleCreated}/>}
    </div>
  );
}

/* ══════════════════════════════════ */

export { ChallengeRow, BattlesTab };
export default BattlesTab;
