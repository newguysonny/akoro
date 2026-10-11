import React, { useState, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, difficultyStyle, subjectStyle, AVATAR_FALLBACK } from '../../constants.js';
import { XIcon, ZapIcon, StarIcon, Icon } from '../common/Icons.jsx';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../services/api.js';

/**
 * Time left to accept, ticking.
 *
 * Only a SCHEDULED battle has a deadline, and it is the moment the battle
 * starts — there is nothing to accept after that. An unscheduled invitation has
 * none and waits until it is answered, so it must not show a clock at all: the
 * hour it used to count down was a default nobody chose, and when it hit zero
 * the card vanished from the tab.
 */
function useCountdown(expiresAt) {
  const [left, setLeft] = useState(() => remaining(expiresAt));
  useEffect(() => {
    if (!expiresAt) { setLeft(null); return; }
    setLeft(remaining(expiresAt));
    // Every 30s: a minute-resolution label does not need a per-second timer
    // burning battery behind a sheet the learner may leave open.
    const id = setInterval(() => setLeft(remaining(expiresAt)), 30_000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

function remaining(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt) - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, ms);
}

export function formatLeft(ms) {
  if (ms == null) return null;
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return mins % 60 ? `${hrs}h ${mins % 60}m` : `${hrs}h`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function ChallengeModal({ challenge, onAccept, onDecline, onClose }) {
  const { t } = useLang();
  const msLeft = useCountdown(challenge.expiresAt);
  const navigate = useNavigate();
  // Can I join? Coins for my agent's answers, and the creator's minimum XP
  // (a review has no XP gate). Asked before Accept, so a learner who is short
  // sees why instead of accepting into a battle their agent can't play.
  const [entry, setEntry] = useState(null);
  useEffect(() => {
    let alive = true;
    apiGet(`/api/battle/battles/${challenge.id}/entry`, { cache: false })
      .then((r) => { if (alive) setEntry(r?.data ?? r); }).catch(() => {});
    return () => { alive = false; };
  }, [challenge.id]);
  const short = entry && !entry.ok;
  const subj=subjectStyle(challenge.subject),sc=subj.color,diff=difficultyStyle(challenge.difficulty),isImmediate=challenge.battleType==="immediate",isClassroom=challenge.battleType==="classroom";
  const isReviewCard=challenge.battleType==="review";
  const typePill=isReviewCard?{label:"STUDY REVIEW",bg:"rgba(59,130,246,.10)",color:"#3B82F6",border:"rgba(59,130,246,.25)"}:isClassroom?{label:t('challenge.classroom'),bg:"rgba(16,185,129,.10)",color:"#10B981",border:"rgba(16,185,129,.25)"}:isImmediate?{label:t('challenge.immediate'),bg:"rgba(239,68,68,.10)",color:RED,border:"rgba(239,68,68,.25)"}:{label:t('challenge.scheduled'),bg:"rgba(108,59,255,.10)",color:BRAND,border:"rgba(108,59,255,.25)"};
  return (
    <><div onClick={onClose} style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(6,6,18,.72)",backdropFilter:"blur(8px)" }}/><div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:2100,background:"var(--ak-surface)",borderRadius:"24px 24px 0 0",padding:"0 0 40px",boxShadow:"0 -8px 40px rgba(0,0,0,.18)",animation:"sheet-up .32s cubic-bezier(.32,1.2,.64,1)",fontFamily:"'Nunito',sans-serif",maxHeight:"88vh",overflowY:"auto" }}>
      <div style={{ width:38,height:4,borderRadius:2,background:"var(--ak-border2)",margin:"14px auto 0" }}/><div style={{ padding:"18px 20px 0" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8,padding:"9px 14px",borderRadius:12,background:typePill.bg,border:`1px solid ${typePill.border}`,marginBottom:16 }}>
          <div style={{ flex:1 }}><div style={{ fontSize:11,fontWeight:900,color:typePill.color,marginBottom:2 }}>{typePill.label}</div><div style={{ fontSize:11,fontWeight:600,color:"var(--ak-text-sub)" }}>{isReviewCard?"Your teacher set a review of what you know. Your agent works through it from your notes — no winner, a mark sheet at the end.":isClassroom?t('challenge.hint_classroom')
            :isImmediate?t('challenge.hint_immediate')
            :challenge.scheduledFor?`${t('challenge.hint_scheduled')} · ${new Date(challenge.scheduledFor).toLocaleString([], {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`
            :t('challenge.hint_scheduled')}</div></div>
          {isClassroom?<div style={{ width:32,height:32,borderRadius:"50%",background:"#10B981",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><Icon name="ti-school" size={16} color="#fff"/></div>:isImmediate?<div style={{ width:32,height:32,borderRadius:"50%",background:RED,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><ZapIcon size={16} color="#fff"/></div>:<div style={{ width:32,height:32,borderRadius:"50%",background:BRAND,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><Icon name="ti-calendar" size={16} color="#fff"/></div>}
        </div>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
          <div style={{ display:"flex",alignItems:"center",gap:12 }}><div style={{ position:"relative" }}><img src={challenge.avatar || AVATAR_FALLBACK} alt="" style={{ width:48,height:48,borderRadius:"50%",objectFit:"cover",border:`2.5px solid ${sc}` }}/><div style={{ position:"absolute",bottom:0,right:0,width:16,height:16,borderRadius:"50%",background:isClassroom?"#10B981":isImmediate?RED:BRAND,border:"2px solid var(--ak-surface)",display:"flex",alignItems:"center",justifyContent:"center" }}><ZapIcon size={8} color="var(--ak-surface)"/></div></div>
            <div><p style={{ fontSize:15,fontWeight:900,color:"var(--ak-text)",margin:0 }}>{challenge.challenger}</p><div style={{ display:"flex",alignItems:"center",gap:4,marginTop:2 }}><StarIcon size={11} color={GOLD}/><span style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-muted)" }}>{[challenge.rating, challenge.badge].filter(Boolean).join(' · ') || t('challenge.challenged_you')}</span></div></div></div>
          <div style={{ background:diff.bg,borderRadius:8,padding:"4px 11px",display:"flex",alignItems:"center",gap:5 }}><div style={{ width:6,height:6,borderRadius:"50%",background:diff.color }}/><span style={{ fontSize:10,fontWeight:800,color:diff.color }}>{diff.label}</span></div>
        </div>
        <div style={{ display:"inline-flex",alignItems:"center",gap:6,background:`${sc}14`,border:`1px solid ${sc}28`,borderRadius:8,padding:"5px 12px",marginBottom:12 }}><Icon name={subj.icon} size={14} color={sc}/><span style={{ fontSize:12,fontWeight:700,color:sc }}>{subj.label}</span>{challenge.topic&&<span style={{ fontSize:11,fontWeight:600,color:"var(--ak-text-muted)" }}>· {challenge.topic}</span>}</div>
        <p style={{ fontSize:17,fontWeight:900,color:"var(--ak-text)",margin:"0 0 6px" }}>{challenge.title}</p>
        {challenge.description&&<p style={{ fontSize:13.5,fontWeight:600,color:"var(--ak-text-sec)",lineHeight:1.6,margin:"0 0 12px" }}>{challenge.description}</p>}
        {/* What you are actually agreeing to. The sheet showed the prize and
            the clock but never how many questions, nor who set it. */}
        <p style={{ fontSize:12,fontWeight:600,color:"var(--ak-text-muted)",margin:"0 0 18px" }}>
          {challenge.totalQuestions?`${challenge.totalQuestions} ${t('challenge.questions')} · `:''}
          {(challenge.participants?.length ?? challenge.participantCount ?? 0)} {t('battles.agents')} {t('challenge.in_battle')}
        </p>
        {isClassroom&&challenge.participants&&(
          <div style={{ marginBottom:16,padding:"12px 14px",background:"rgba(16,185,129,.06)",borderRadius:14,border:"1px solid rgba(16,185,129,.20)" }}>
            <p style={{ fontSize:10,fontWeight:800,color:"#10B981",margin:"0 0 10px",letterSpacing:.3,display:"flex",alignItems:"center",gap:5 }}><Icon name="ti-users" size={12} color="#10B981"/>STUDENT AGENTS COMPETING</p>
            <div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>
              {challenge.participants.map(p=><div key={p.id} style={{ display:"flex",alignItems:"center",gap:6,background:"var(--ak-surface)",borderRadius:20,padding:"4px 10px 4px 4px",border:"1px solid var(--ak-border2)" }}><div style={{ width:24,height:24,borderRadius:"50%",background:p.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13 }}>{p.emoji}</div><div><div style={{ fontSize:10.5,fontWeight:800,color:"var(--ak-text)" }}>{p.name}{p.isYou&&<span style={{ marginLeft:4,fontSize:9,fontWeight:900,color:BRAND,background:`${BRAND}15`,borderRadius:4,padding:"0 4px" }}>{t('rankings.you')}</span>}</div><div style={{ fontSize:9.5,color:"var(--ak-text-muted)" }}>{p.owner}</div></div></div>)}
            </div>
          </div>
        )}
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16 }}>
          {[{label:t('challenge.xp_prize'),value:challenge.xpPrize,icon:"ti-bolt"},
            {label:t('challenge.time_limit'),value:challenge.timeLimit,icon:"ti-stopwatch"},
            // Third tile: the deadline, and only if there is one. It used to
            // read "Expires In 58 min" on every battle — an hour nobody set.
            challenge.expiresAt
              ? {label:t('challenge.accept_before'),value:formatLeft(msLeft),icon:"ti-alarm"}
              : {label:t('challenge.deadline'),value:t('challenge.no_deadline'),icon:"ti-infinity"}
           ].map(({label,value,icon})=>(
            <div key={label} style={{ background:"var(--ak-bg)",borderRadius:12,padding:"10px",border:"1px solid var(--ak-border)",textAlign:"center" }}><p style={{ fontSize:10,fontWeight:600,color:"var(--ak-text-muted)",margin:"0 0 3px",display:"flex",alignItems:"center",justifyContent:"center",gap:4 }}><Icon name={icon} size={12} color="var(--ak-text-muted)"/>{label}</p><p style={{ fontSize:12,fontWeight:900,color:"var(--ak-text)",margin:0 }}>{value}</p></div>
          ))}
        </div>
        {/* The rules of the arena, before stepping in: what a miss costs. */}
        {!isReviewCard&&(()=>{ const h=challenge.hpPerMiss??10; return (
          <div style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:12,background:"rgba(239,68,68,.06)",border:"1px solid rgba(239,68,68,.18)",marginBottom:16 }}>
            <Icon name="ti-heart" size={18} color={RED}/>
            <div style={{ fontSize:12,fontWeight:700,color:"var(--ak-text-sec)",lineHeight:1.45 }}>
              {h>0?<><b style={{ color:"var(--ak-text)" }}>−{h} HP per miss.</b> Your agent starts on 100 HP; after {Math.ceil(100/h)} misses it's out and watches the rest, unranked.</>
                :<><b style={{ color:"var(--ak-text)" }}>No HP lost for misses.</b> Nobody can be knocked out.</>}
              <span style={{ display:"block",fontSize:11,fontWeight:600,color:"var(--ak-text-muted)",marginTop:2 }}>A miss is a wrong answer, or none — no notes on it, no token credit, or out of time.</span>
            </div>
          </div>); })()}
        {entry&&(
          <div style={{ padding:"10px 12px",borderRadius:12,background:short?"rgba(239,68,68,.06)":"rgba(16,185,129,.06)",border:`1px solid ${short?"rgba(239,68,68,.22)":"rgba(16,185,129,.22)"}`,marginBottom:16 }}>
            <div style={{ fontSize:11,fontWeight:900,color:short?RED:GREEN,letterSpacing:.3,marginBottom:6 }}>{short?"NOT ENOUGH TO JOIN":"YOU CAN JOIN"}</div>
            {[
              { ok: entry.coins.have>=entry.coins.need, icon:"ti-coin", text:`About ${entry.coins.need} coins for your agent's answers`, have:`you have ${entry.coins.have}` },
              ...(entry.xp.need>0?[{ ok: entry.xp.have>=entry.xp.need, icon:"ti-bolt", text:`${entry.xp.need} XP to enter`, have:`you have ${entry.xp.have}` }]:[]),
            ].map((r)=>(
              <div key={r.text} style={{ display:"flex",alignItems:"center",gap:8,fontSize:12,fontWeight:700,color:"var(--ak-text-sec)",marginTop:3 }}>
                <Icon name={r.ok?"ti-circle-check":"ti-circle-x"} size={15} color={r.ok?GREEN:RED}/><span style={{ flex:1 }}>{r.text}</span><span style={{ fontSize:11,color:"var(--ak-text-muted)" }}>{r.have}</span>
              </div>
            ))}
            {entry.review&&<div style={{ fontSize:11,fontWeight:600,color:"var(--ak-text-muted)",marginTop:6 }}>A review checks what you know — no XP needed, and you get a free coin for taking part.</div>}
            {short&&entry.coins.have<entry.coins.need&&<button onClick={()=>navigate('/wallet')} style={{ marginTop:8,padding:"7px 14px",borderRadius:20,border:`1.5px solid ${BRAND}40`,background:`${BRAND}0A`,color:BRAND,fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"inline-flex",alignItems:"center",gap:5 }}><Icon name="ti-coin" size={13} color={BRAND}/>Top up coins</button>}
          </div>
        )}
        <div style={{ display:"flex",gap:10 }}>
          <button onClick={onDecline} style={{ flex:1,padding:"14px",borderRadius:14,border:"1.5px solid var(--ak-border2)",background:"var(--ak-bg)",fontSize:14,fontWeight:800,color:"var(--ak-text-sub)",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{t('challenge.decline')}</button>
          <button onClick={onAccept} disabled={short} title={short?entry.message:undefined} style={{ flex:1.8,padding:"14px",borderRadius:14,border:"none",opacity:short?.45:1,cursor:short?"not-allowed":"pointer",background:isClassroom?"linear-gradient(135deg,#10B981,#059669)":isImmediate?`linear-gradient(135deg,${RED},#DC2626)`:`linear-gradient(135deg,${BRAND},#4C1DCC)`,fontSize:14,fontWeight:800,color:"#fff",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}><ZapIcon size={15} color="#fff"/>{t('challenge.accept')}</button>
        </div>
      </div></div></>
  );
}

/* ══════════════════════════════════════════════════════ */

export default ChallengeModal;
