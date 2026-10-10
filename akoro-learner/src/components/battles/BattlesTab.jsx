import React, { useState, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, difficultyStyle, subjectStyle, AVATAR_FALLBACK } from '../../constants.js';
import { ZapIcon, StarIcon, Icon } from '../common/Icons.jsx';
import { AgentAvatar } from '../common/AgentAvatar.jsx';
import BattleModal from './BattleModal.jsx';
import { formatLeft } from './ChallengeModal.jsx';
import CreateBattleSheet from './CreateBattleSheet.jsx';
import ParticipantsSheet from './ParticipantsSheet.jsx';
import { rematchBattle, joinDaily, skipDaily } from '../../services/agentNetworkApi.js';
import { useLang } from '../../contexts/LanguageContext.jsx';

function ChallengeRow({ challenge, onTap }) {
  const { t } = useLang();
  const subj=subjectStyle(challenge.subject),sc=subj.color,diff=difficultyStyle(challenge.difficulty),isImmediate=challenge.battleType==="immediate",isClassroom=challenge.battleType==="classroom";
  // Only a scheduled battle has a deadline. The row used to print the server's
  // expiresIn unconditionally, so an invitation that never expires still
  // advertised an hour and then disappeared when it ran out.
  const deadline=challenge.expiresAt?formatLeft(Math.max(0,new Date(challenge.expiresAt)-Date.now())):null;
  const typePill=isClassroom?{label:t('battles.classroom'),bg:"rgba(16,185,129,.10)",color:"#10B981",border:"rgba(16,185,129,.25)"}:isImmediate?{label:t('battles.immediate'),bg:"rgba(239,68,68,.10)",color:RED,border:"rgba(239,68,68,.25)"}:{label:t('battles.scheduled'),bg:"rgba(108,59,255,.10)",color:BRAND,border:"rgba(108,59,255,.25)"};
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
          <span style={{ fontSize:10,fontWeight:700,color:sc,background:`${sc}14`,borderRadius:5,padding:"1px 7px",flexShrink:0,display:"inline-flex",alignItems:"center",gap:4 }}><Icon name={subj.icon} size={11} color={sc}/>{challenge.title}</span>
          <div style={{ background:diff.bg,borderRadius:5,padding:"1px 7px",flexShrink:0 }}><span style={{ fontSize:9.5,fontWeight:800,color:diff.color }}>{diff.label}</span></div>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:7,flexWrap:"wrap" }}>
          <div style={{ display:"inline-flex",alignItems:"center",gap:4,padding:"2px 9px",borderRadius:20,background:typePill.bg,border:`1px solid ${typePill.border}` }}><span style={{ fontSize:9.5,fontWeight:900,color:typePill.color }}>{typePill.label}</span></div>
          {isClassroom?<span style={{ fontSize:10.5,fontWeight:600,color:"#10B981",display:"inline-flex",alignItems:"center",gap:4 }}><Icon name="ti-users" size={11} color="#10B981"/>{(challenge.participants?.length ?? challenge.participantCount ?? 0)} {t('battles.agents')} · <Icon name="ti-stopwatch" size={10} color="#10B981"/>{challenge.timeLimit}{deadline&&<> · <Icon name="ti-alarm" size={10} color="#10B981"/>{deadline}</>}</span>:isImmediate?<span style={{ fontSize:10.5,fontWeight:600,color:"var(--ak-text-muted)",display:"inline-flex",alignItems:"center",gap:4 }}>{deadline&&<><Icon name="ti-alarm" size={10} color="var(--ak-text-muted)"/>{t('battles.expires_in')} {deadline} ·</>} <Icon name="ti-stopwatch" size={10} color="var(--ak-text-muted)"/>{challenge.timeLimit}</span>:<span style={{ fontSize:10.5,fontWeight:600,color:BRAND,display:"inline-flex",alignItems:"center",gap:4 }}><Icon name="ti-calendar" size={11} color={BRAND}/>{challenge.scheduledFor?new Date(challenge.scheduledFor).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—'} · <Icon name="ti-stopwatch" size={10} color={BRAND}/>{challenge.timeLimit}</span>}
        </div>
      </div>
      <div style={{ width:28,height:28,borderRadius:"50%",background:isImmediate?`${RED}12`:`${BRAND}12`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",border:`1.5px solid ${isImmediate?RED:BRAND}40` }}><ZapIcon size={12} color={isImmediate?RED:BRAND}/></div>
    </div>
  );
}


/**
 * The one line a finished battle gets.
 *
 * This used to be built from b.winner / b.agentA / b.agentB, none of which the
 * API has ever sent — so every completed card read "undefined won ·
 * undefined–undefined · XP distributed". They are sent now, but a card can
 * still arrive before them (an older cached payload, a battle with no
 * participants left), so nothing here assumes they exist: no data, no line.
 */
function resultLine(b, t) {
  // A review has no winner. What it has is a mark.
  // No HP, no ranking: my agent was knocked out and watched the rest.
  if (b.myHp != null && b.myHp <= 0 && b.myRank == null) {
    return `Out of HP · unranked${b.myScore ? ` · ${b.myScore} right before that` : ''}`;
  }
  // The daily battle: everyone in the subject that day — where did I place?
  if (b.daily && b.myRank != null) {
    return `You placed #${b.myRank} of ${b.participantCount || 1} · ${b.myScore ?? 0}/${b.totalQuestions} correct`;
  }
  if (b.review) {
    return t('battles.review_result')
      .replace('{correct}', b.review.correct)
      .replace('{total}', b.review.total);
  }
  const A = b.agentA, B = b.agentB;
  if (!A) return null;
  const winner = b.winner === A.id ? A : b.winner === B?.id ? B : null;
  if (!winner || !B) {
    // Finished, but not as a duel we can narrate — show the learner their own
    // score rather than inventing a scoreline.
    return b.myScore != null ? t('battles.your_score').replace('{score}', b.myScore) : null;
  }
  return t('battles.result')
    .replace('{winner}', winner.name)
    .replace('{a}', A.score)
    .replace('{b}', B.score);
}

/**
 * Who it is against, by agent:
 *   1v1    "Bolt vs Nova"                      (theirs vs mine)
 *   group  "Bolt vs your agent and 23 more"
 * Falls back to the challenger's name for an older payload without a lineup.
 */
export function matchup(b) {
  const l = b.lineup;
  if (!l || !l.total) return b.challenger ? `vs ${b.challenger}` : '';
  const mine = l.myAgent || 'your agent';
  if (!l.others) return b.daily ? `${mine} · waiting for more agents` : mine;
  const lead = l.leadAgent || 'An agent';
  if (l.total === 2) return `${lead} vs ${l.myAgent || 'your agent'}`;
  const more = l.others - 1;
  return `${lead} vs your agent${more > 0 ? ` and ${more} more` : ''}`;
}

/**
 * The VS row: the creator's agent on the left, the other side on the right —
 *   1v1    Bolt  vs  Nova
 *   group  Bolt  vs  Nova (you)  · and 23 more
 * When I created it, I'm on the left and the first agent to accept is on the
 * right. A daily battle has no creator: the first agent in leads it.
 */
function versus(b) {
  const l = b.lineup;
  if (l?.me && l?.lead) {
    const me = { ...l.me, isYou: true }, lead = l.lead;
    const [A, B] = l.iCreated ? [me, lead] : [lead, me];
    return { A, B, more: Math.max(0, (l.others || 0) - 1) };
  }
  // Older payloads: the finished battle's top two.
  if (b.agentA && b.agentB) return { A: b.agentA, B: b.agentB, more: 0 };
  return null;
}

function BattlesTab({ battles, onViewChallenge, onBattleCreated }) {
  const { t } = useLang();
  const [viewFilter, setViewFilter] = useState("active");
  const [watching,   setWatching]   = useState(null);
  const [rosterOf,   setRosterOf]   = useState(null);   // battle whose roster is open
  const [creating,   setCreating]   = useState(false);
  const [rematchMsg, setRematchMsg] = useState({});
  // The daily battle is a real battle that recurs every day at 7 PM: opening
  // Battles takes a seat in the next one (never undoing a skip), and it then
  // shows up in these lists and plays in the same arena as any other battle.
  const [dailySeat, setDailySeat] = useState(null);
  const [dailyBusy, setDailyBusy] = useState(false);
  // Re-checked whenever no daily battle is upcoming — so once today's is over,
  // tomorrow's is scheduled without leaving the tab.
  const dailyUpcoming = battles.some(b => b.daily && ["scheduled","lobby","live"].includes(b.status) && b.myState === "accepted");
  useEffect(() => {
    if (dailyUpcoming) return undefined;
    let alive = true;
    joinDaily({ auto: true }).then((r) => { if (!alive) return; setDailySeat(r); if (r?.joined) onBattleCreated?.(); }).catch(() => {});
    return () => { alive = false; };
  }, [dailyUpcoming]); // eslint-disable-line react-hooks/exhaustive-deps
  const dailyAction = (fn) => { setDailyBusy(true); fn().then((r) => { setDailySeat(r); onBattleCreated?.(); }).catch(() => {}).finally(() => setDailyBusy(false)); };
  // Only battles I am actually IN. An invitation I have not answered belongs in
  // Challenges — it was appearing in both places at once, so a learner saw the
  // same battle twice and Active implied they had joined something they had
  // not. myState is null when I created it (a creator holds a seat already) and
  // 'accepted' once I have taken mine.
  const mine = battles.filter(b => b.myState == null || b.myState === "accepted");
  const liveBattles      = mine.filter(b=>b.status==="live");
  // A battle waiting on its invitations. It used to last five seconds, so
  // nothing showed it; now every battle waits, and a lobby can sit for the
  // whole invite window — without this the battle you just created, or just
  // accepted, appears NOWHERE.
  const waitingBattles   = mine.filter(b=>b.status==="lobby");
  const scheduledBattles = mine.filter(b=>b.status==="scheduled");
  const completedBattles = mine.filter(b=>b.status==="completed");
  // A skipped day has no seat to show, so it gets a line to join again.
  const dailySkipped = dailySeat?.status==="skipped" && !mine.some(b=>b.id===dailySeat.battleId);
  const displayed = viewFilter==="active"?[...liveBattles,...waitingBattles]
                   :viewFilter==="scheduled"?scheduledBattles:completedBattles;
  const totalXP  = mine.reduce((s,b)=>s+(parseInt((b.xpPrize||"0").replace(/\D/g,""),10)||0),0);
  
  const ST_STYLE = {
    live:     {label:"● LIVE",   bg:"rgba(239,68,68,.12)",  color:RED,   border:"rgba(239,68,68,.25)"  },
    scheduled:{label:"SCHEDULED",bg:"rgba(108,59,255,.10)", color:BRAND, border:"rgba(108,59,255,.25)" },
    completed:{label:"COMPLETED",bg:"rgba(16,185,129,.10)", color:GREEN, border:"rgba(16,185,129,.25)" },
    lobby:    {label:"WAITING",  bg:"rgba(245,158,11,.12)", color:GOLD,  border:"rgba(245,158,11,.28)" },
  };
  const TABS=[{key:"active",label:t('battles.active'),icon:"ti-bolt",count:liveBattles.length+waitingBattles.length},{key:"scheduled",label:t('battles.scheduled'),icon:"ti-calendar",count:scheduledBattles.length},{key:"completed",label:t('battles.completed'),icon:"ti-trophy",count:completedBattles.length}];
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
            <Icon name={icon} size={13} color={viewFilter===key?BRAND:"var(--ak-text-muted)"}/>{label}
            {count>0&&<span style={{ fontSize:9.5,fontWeight:900,background:viewFilter===key?BRAND:"var(--ak-border)",color:viewFilter===key?"#fff":"var(--ak-text-muted)",borderRadius:8,padding:"1px 6px" }}>{count}</span>}
          </button>
        ))}
      </div>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"8px 16px 6px",borderBottom:"1px solid var(--ak-border)" }}>
        <button onClick={()=>setCreating(true)} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,fontSize:11.5,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}><Icon name="ti-swords" size={13} color="#fff"/>Start a battle</button>
        <button onClick={onViewChallenge} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:`1.5px solid ${RED}40`,background:`${RED}08`,fontSize:11.5,fontWeight:800,color:RED,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}><ZapIcon size={11} color={RED}/>{t('battles.find_challenges')}</button>
      </div>
      {viewFilter==="scheduled"&&dailySkipped&&(
        <div style={{ margin:"10px 16px 0",display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:14,border:"1.5px dashed var(--ak-border2)",background:"var(--ak-surface-hover)" }}>
          <Icon name="ti-calendar-repeat" size={18} color="var(--ak-text-muted)"/>
          <span style={{ flex:1,fontSize:12,fontWeight:700,color:"var(--ak-text-muted)" }}>You're sitting out the next daily battle.</span>
          <button onClick={()=>dailyAction(()=>joinDaily({}))} disabled={dailyBusy} style={{ padding:"6px 12px",borderRadius:20,border:`1.5px solid ${BRAND}40`,background:`${BRAND}0A`,color:BRAND,fontSize:11.5,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>Join</button>
        </div>
      )}
      {mine.length===0&&!dailySkipped&&(
        <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,padding:"40px 24px" }}>
          <Icon name="ti-swords" size={52} color="var(--ak-text-muted)" style={{opacity:.2}}/>
          <p style={{ fontSize:15,fontWeight:800,color:"var(--ak-text-muted)",textAlign:"center" }}>{t('battles.empty')}</p>
          <p style={{ fontSize:12,fontWeight:600,color:"var(--ak-text-muted)",textAlign:"center" }}>{t('battles.empty_hint')}</p>
          <button onClick={onViewChallenge} style={{ padding:"10px 22px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",gap:7 }}><ZapIcon size={13} color="#fff"/>{t('battles.view_challenges')}</button>
        </div>
      )}
      {mine.length>0&&displayed.length===0&&!(viewFilter==="scheduled"&&dailySkipped)&&(
        <div style={{ textAlign:"center",padding:"36px 24px",color:"var(--ak-text-muted)" }}>
          <Icon name={viewFilter==="active"?"ti-bolt":viewFilter==="scheduled"?"ti-calendar":"ti-trophy"} size={36} color="var(--ak-text-muted)" style={{opacity:.3}}/>
          <p style={{ fontSize:13,fontWeight:700,marginTop:8 }}>{viewFilter==="active"?t('battles.none_live'):viewFilter==="scheduled"?t('battles.none_scheduled'):t('battles.none_completed')}</p>
        </div>
      )}
      <div style={{ padding:"10px 16px",display:"flex",flexDirection:"column",gap:10 }}>
        {displayed.map(b=>{
          const bs=subjectStyle(b.subject),sc=bs.color,diff=difficultyStyle(b.difficulty),st=ST_STYLE[b.status]||ST_STYLE.scheduled,vs=versus(b);
          return (
            <div key={b.id} style={{ borderRadius:18,border:`1.5px solid ${b.status==="live"?"rgba(239,68,68,.30)":b.status==="scheduled"?"rgba(108,59,255,.25)":"var(--ak-border)"}`,background:b.status==="live"?"linear-gradient(140deg,#FFF5F5,#FFFCFC)":b.status==="scheduled"?"linear-gradient(140deg,#F5F3FF,#FCFCFF)":"var(--ak-surface)",overflow:"hidden" }}>
              {b.status==="live"&&<div style={{ height:3,background:`linear-gradient(90deg,${RED},#FF6B6B,${RED})`,backgroundSize:"200% 100%",animation:"shimmer 1.8s linear infinite" }}/>}
              {b.status==="scheduled"&&<div style={{ height:3,background:`linear-gradient(90deg,${BRAND},#818CF8,${BRAND})`,backgroundSize:"200% 100%",animation:"shimmer 2.2s linear infinite" }}/>}
              <div style={{ padding:"13px 14px" }}>
                <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:10 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0 }}>
                    {b.daily
                      ?<span style={{ width:40,height:40,borderRadius:12,background:`${BRAND}12`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><Icon name="ti-calendar-repeat" size={20} color={BRAND}/></span>
                      :<img src={b.avatar || AVATAR_FALLBACK} alt="" style={{ width:40,height:40,borderRadius:"50%",objectFit:"cover",border:`2px solid ${sc}50`,flexShrink:0 }}/>}
                    <div style={{ minWidth:0 }}><p style={{ fontSize:14,fontWeight:900,color:"var(--ak-text)",margin:"0 0 2px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{b.title}</p><p style={{ fontSize:11,color:"var(--ak-text-muted)",margin:0 }}>{b.daily?`Every day at ${b.scheduledFor?new Date(b.scheduledFor).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'7 PM'}${vs?'':` · ${matchup(b)}`}`:(!vs&&matchup(b))}</p></div>
                  </div>
                  <div style={{ background:st.bg,borderRadius:8,padding:"3px 9px",border:`1px solid ${st.border}`,flexShrink:0,display:"flex",alignItems:"center",gap:4 }}>
                    {b.status==="live"&&<div style={{ width:5,height:5,borderRadius:"50%",background:RED,animation:"pulse-dot 1s ease-in-out infinite" }}/>}
                    <span style={{ fontSize:9.5,fontWeight:900,color:st.color,letterSpacing:.3 }}>{st.label}</span>
                  </div>
                </div>
                {b.battleType==="classroom"&&b.participants?.length>0?(
                  <div style={{ display:"flex",alignItems:"center",gap:6,background:"rgba(16,185,129,.06)",borderRadius:12,padding:"8px 10px",marginBottom:10,border:"1px solid rgba(16,185,129,.18)" }}>
                    <span style={{ fontSize:10,fontWeight:800,color:"#10B981",flexShrink:0,display:"inline-flex",alignItems:"center",gap:4 }}><Icon name="ti-school" size={11} color="#10B981"/>CLASS</span>
                    <div style={{ display:"flex",gap:5,flexWrap:"wrap",flex:1 }}>{b.participants.map(p=><div key={p.id} title={`${p.name} · ${p.owner}`} style={{ width:26,height:26,borderRadius:"50%",background:p.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,border:p.isYou?"2px solid #E8884A":"1px solid rgba(255,255,255,.3)",flexShrink:0 }}>{p.emoji}</div>)}</div>
                    <span style={{ fontSize:10,fontWeight:700,color:"rgba(255,255,255,.40)",flexShrink:0 }}>{b.participants.length} {t('battles.agents')}</span>
                  </div>
                ):vs&&(
                  <div style={{ display:"flex",alignItems:"center",gap:8,background:"rgba(0,0,0,.025)",borderRadius:12,padding:"10px 12px",marginBottom:10 }}>
                    <div style={{ flex:1,minWidth:0,display:"flex",alignItems:"center",gap:7 }}>
                      <div style={{ width:32,height:32,borderRadius:"50%",background:vs.A.bg||`${BRAND}14`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><AgentAvatar emoji={vs.A.emoji} size={22}/></div>
                      <div style={{ minWidth:0 }}><div style={{ fontSize:11.5,fontWeight:800,color:"var(--ak-text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{vs.A.name}{vs.A.isYou&&<span style={{ marginLeft:4,fontSize:8.5,fontWeight:800,background:"#1A1A2E",color:"#fff",borderRadius:4,padding:"1px 5px" }}>{t('battles.you')}</span>}</div><div style={{ fontSize:14,fontWeight:900,color:vs.A.color||"var(--ak-text)" }}>{b.status==="scheduled"||b.status==="lobby"?"—":vs.A.score}</div></div>
                    </div>
                    <div style={{ width:28,height:28,borderRadius:"50%",background:"#1A1A2E",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff",flexShrink:0 }}>{t('battles.vs')}</div>
                    <div style={{ flex:1,minWidth:0,display:"flex",alignItems:"center",gap:7,justifyContent:"flex-end",flexDirection:"row-reverse" }}>
                      <div style={{ width:32,height:32,borderRadius:"50%",background:vs.B.bg||`${BRAND}14`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><AgentAvatar emoji={vs.B.emoji} size={22}/></div>
                      <div style={{ textAlign:"right",minWidth:0 }}>
                        <div style={{ fontSize:11.5,fontWeight:800,color:"var(--ak-text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{vs.B.name}{vs.B.isYou&&<span style={{ marginLeft:4,fontSize:8.5,fontWeight:800,background:"#1A1A2E",color:"#fff",borderRadius:4,padding:"1px 5px" }}>{t('battles.you')}</span>}</div>
                        <div style={{ fontSize:14,fontWeight:900,color:vs.B.color||"var(--ak-text)" }}>{b.status==="scheduled"||b.status==="lobby"?"—":vs.B.score}</div>
                        {vs.more>0&&<div style={{ fontSize:9.5,fontWeight:700,color:"var(--ak-text-muted)" }}>and {vs.more} more</div>}
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap" }}>
                  <span style={{ fontSize:10,fontWeight:700,color:sc,background:`${sc}14`,borderRadius:5,padding:"1px 7px",display:"inline-flex",alignItems:"center",gap:4 }}><Icon name={bs.icon} size={11} color={sc}/>{bs.label}</span>
                  <div style={{ background:diff.bg,borderRadius:5,padding:"1px 7px" }}><span style={{ fontSize:9.5,fontWeight:800,color:diff.color }}>{diff.label}</span></div>
                  <span style={{ fontSize:10.5,fontWeight:800,color:GOLD,display:"flex",alignItems:"center",gap:3 }}><ZapIcon size={10} color={GOLD}/>{b.xpPrize}</span>
                  <span style={{ fontSize:10.5,color:"var(--ak-text-muted)",fontWeight:600,display:"inline-flex",alignItems:"center",gap:4 }}><Icon name="ti-stopwatch" size={10} color="var(--ak-text-muted)"/>{b.timeLimit}</span>
                  {b.status==="live"&&b.startedAgo!=null&&<span style={{ fontSize:10,color:RED,fontWeight:700 }}>{t('battles.started_ago').replace('{min}',b.startedAgo)}</span>}
                  {b.status==="scheduled"&&b.startsIn&&<span style={{ fontSize:10,color:BRAND,fontWeight:700,display:"inline-flex",alignItems:"center",gap:4 }}><Icon name="ti-calendar" size={11} color={BRAND}/>{b.startsIn}</span>}
                  {b.status==="lobby"&&<span style={{ fontSize:10,color:GOLD,fontWeight:700,display:"inline-flex",alignItems:"center",gap:4 }}><Icon name="ti-hourglass" size={11} color={GOLD}/>Waiting for players to accept</span>}
                </div>
                {b.status==="completed"&&resultLine(b,t)&&(<div style={{ display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:10,background:"rgba(16,185,129,.07)",border:"1px solid rgba(16,185,129,.20)",marginBottom:10 }}><Icon name={b.review?"ti-clipboard":"ti-trophy"} size={15} color={GREEN}/><span style={{ fontSize:12,fontWeight:700,color:GREEN }}>{resultLine(b,t)}</span></div>)}
                <div style={{ display:"flex",gap:7 }}>
                  {b.status==="live"&&<button onClick={()=>setWatching(b)} style={{ flex:1,padding:"10px",borderRadius:12,border:"none",background:`linear-gradient(135deg,${RED},#DC2626)`,color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><Icon name="ti-player-play" size={14} color="#fff"/>{t('battles.watch_live')}</button>}
                  {b.status==="scheduled"&&<button onClick={()=>setWatching(b)} style={{ flex:1,padding:"10px",borderRadius:12,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><Icon name="ti-eye" size={14} color="#fff"/>{t('battles.preview')}</button>}
                  {b.status==="completed"&&<button onClick={()=>setWatching(b)} style={{ flex:1,padding:"10px",borderRadius:12,border:`1.5px solid var(--ak-border2)`,background:"var(--ak-surface-hover)",color:"var(--ak-text-sec)",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><Icon name="ti-chart-bar" size={14} color="var(--ak-text-sub)"/>{t('battles.view_result')}</button>}
                  {b.daily&&b.status==="scheduled"&&<button onClick={()=>dailyAction(skipDaily)} disabled={dailyBusy} title="Sit this one out" style={{ padding:"10px 12px",borderRadius:12,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",color:"var(--ak-text-muted)",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",gap:5 }}><Icon name="ti-player-skip-forward" size={13} color="var(--ak-text-muted)"/>Skip</button>}
                  {b.status==="completed"&&!b.review&&!b.daily&&<button onClick={()=>{ setRematchMsg((m)=>({...m,[b.id]:'…'})); rematchBattle(b.id).then(()=>{ setRematchMsg((m)=>({...m,[b.id]:'Rematch sent'})); onBattleCreated?.(); }).catch((e)=>setRematchMsg((m)=>({...m,[b.id]:e?.message||'Could not rematch'}))); }} disabled={!!rematchMsg[b.id]} title={rematchMsg[b.id]||'Same battle, same agents'} style={{ padding:"10px 12px",borderRadius:12,border:`1.5px solid ${BRAND}40`,background:`${BRAND}0A`,color:BRAND,fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",gap:5 }}><Icon name="ti-refresh" size={13} color={BRAND}/>{rematchMsg[b.id]||'Rematch'}</button>}
                  <button onClick={()=>setRosterOf(b)} style={{ padding:"10px 14px",borderRadius:12,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",color:"var(--ak-text-muted)",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{t('battles.details')}</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {watching&&<BattleModal battle={watching} onClose={()=>setWatching(null)}/>}
      {creating&&<CreateBattleSheet onClose={()=>setCreating(false)} onCreated={onBattleCreated}/>}
      {rosterOf&&<ParticipantsSheet battle={rosterOf} onClose={()=>setRosterOf(null)}/>}
    </div>
  );
}

/* ══════════════════════════════════ */

export { ChallengeRow, BattlesTab };
export default BattlesTab;
