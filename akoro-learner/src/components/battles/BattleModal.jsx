import { useState, useEffect, useRef } from 'react';
import { BRAND, RED, GREEN, GOLD, DIFFICULTY_CONFIG, STUDENT_ID } from '../../constants.js';
import { API, jwt, apiPost } from '../../services/api.js';
import { QUESTIONS, getQuestions } from '../../services/mockData.js';
import { XIcon, ZapIcon, StarIcon, BookIcon, FlameIcon, PlayIcon, TrophyIcon, UsersIcon } from '../common/Icons.jsx';
import { LiveBadge } from '../common/ProgressBar.jsx';

function BattleModal({ battle: initialBattle, onClose }) {
  const isCompleted = initialBattle.status === "completed";
  const isScheduled = initialBattle.status === "scheduled";
  const isLive      = initialBattle.status === "live";

  const [qIdx,        setQIdx]        = useState(isLive ? Math.max(0, (initialBattle.currentQNum||1) - 1) : 0);
  const [phase,       setPhase]       = useState(isScheduled ? "preview" : isCompleted ? "result" : "question");
  const [selected,    setSelected]    = useState(null);
  const [agentPicked, setAgentPicked] = useState(null);
  const [timer,       setTimer]       = useState(15);
  const [aScore,      setAScore]      = useState(initialBattle.agentA?.score ?? 0);
  const [bScore,      setBScore]      = useState(initialBattle.agentB?.score ?? 0);
  const [aHp,         setAHp]         = useState(initialBattle.agentA?.hp ?? 100);
  const [bHp,         setBHp]         = useState(initialBattle.agentB?.hp ?? 100);
  const [log,         setLog]         = useState([]);
  const [xpGained,    setXpGained]    = useState(0);
  const [myStreak,    setMyStreak]    = useState(0);
  const [showXp,      setShowXp]      = useState(false);
  const [currentTab,  setCurrentTab]  = useState("watch");
  const [tickerItems, setTickerItems] = useState([]);
  const [answeredQs,  setAnsweredQs]  = useState(() => {
    if (initialBattle.status === "completed") return BATTLE_QS_FOR_INIT(initialBattle.topic);
    return [];
  });

  const logRef      = useRef(null);
  const timerRef    = useRef(null);
  const questionRef = useRef(qIdx);
  questionRef.current = qIdx;

  const BATTLE_QS = getQuestions(initialBattle.topic);
  const q = BATTLE_QS[qIdx % BATTLE_QS.length];

  function BATTLE_QS_FOR_INIT(topic) {
    const qs = getQuestions(topic);
    return qs.map((q, i) => {
      const aCorrect = Math.random() > 0.32;
      const bCorrect = Math.random() > 0.28;
      const aPick    = aCorrect ? q.ans : (q.ans + 1 + Math.floor(Math.random()*3)) % 4;
      const bPick    = bCorrect ? q.ans : (q.ans + 2 + Math.floor(Math.random()*3)) % 4;
      const userCorrect = Math.random() > 0.35;
      const myAnswer    = userCorrect ? q.ans : (q.ans + 1 + Math.floor(Math.random()*3)) % 4;
      return { idx:i, q, aCorrect, bCorrect, aPick, bPick, myAnswer };
    });
  }

  useEffect(()=>{
    const msgs = ["🤖 Nexus is battling in 3 active matches","⚡ Speed Algebra Duel is LIVE now!","🏆 Nexus just won a Chain Rule battle!","💎 Kira is on a 7-answer streak!","🔥 5 battles live right now in your class","🌀 Vocabulary Blitz completed — Ada wins!"];
    setTickerItems([...msgs,...msgs]);
  },[]);

  useEffect(()=>{
    if (phase!=="question") return;
    if (timer<=0){ autoReveal(); return; }
    timerRef.current = setTimeout(()=>setTimer(t=>t-1),1000);
    return ()=>clearTimeout(timerRef.current);
  },[phase,timer]);

  const addLog=(msg,type="neutral")=>{
    setLog(prev=>[...prev.slice(-40),{msg,type,ts:new Date().toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}]);
    setTimeout(()=>{ if(logRef.current) logRef.current.scrollTop=logRef.current.scrollHeight; },50);
  };

  const autoReveal = useCallback(()=>{
    clearTimeout(timerRef.current);
    const correctIdx = q.ans;
    const aCorrect   = Math.random()>0.30;
    const bCorrect   = Math.random()>0.28;
    const aPick = aCorrect ? correctIdx : (correctIdx+1+Math.floor(Math.random()*3))%4;
    const bPick = bCorrect ? correctIdx : (correctIdx+2+Math.floor(Math.random()*3))%4;
    setAgentPicked({a:aPick,b:bPick,correct:correctIdx});
    setPhase("revealing");
    if(aCorrect){ setAScore(s=>s+1); setBHp(h=>Math.max(0,h-8)); addLog(`✅ ${initialBattle.agentA.name} answered CORRECTLY — ${q.opts[correctIdx]}`,"success"); }
    else         { addLog(`❌ ${initialBattle.agentA.name} answered wrong — chose ${q.opts[aPick]}`,"error"); }
    if(bCorrect){ setBScore(s=>s+1); setAHp(h=>Math.max(0,h-8)); addLog(`✅ ${initialBattle.agentB.name} answered CORRECTLY — ${q.opts[correctIdx]}`,"success"); }
    else         { addLog(`❌ ${initialBattle.agentB.name} answered wrong — chose ${q.opts[bPick]}`,"error"); }
    setAnsweredQs(prev => [...prev, { idx: questionRef.current, q, aCorrect, bCorrect, aPick, bPick, myAnswer: null }]);
    setTimeout(()=>nextQuestion(correctIdx),2800);
  },[q,initialBattle.agentA?.name,initialBattle.agentB?.name]);

  const handleAnswer=(idx)=>{
    if(phase!=="question"||selected!==null) return;
    setSelected(idx);
    clearTimeout(timerRef.current);
    const correct=idx===q.ans;
    if(correct){
      const gain=q.xp+myStreak*5;
      setXpGained(g=>g+gain); setMyStreak(s=>s+1); setShowXp(true);
      addLog(`🎯 YOU answered correctly! +${gain} XP`,"you");
      setTimeout(()=>setShowXp(false),900);
    } else { setMyStreak(0); addLog(`You chose wrong. Correct: ${q.opts[q.ans]}`,"error"); }
    setTimeout(()=>{
      setAnsweredQs(prev => {
        const copy = [...prev];
        if (copy.length > 0) copy[copy.length-1] = { ...copy[copy.length-1], myAnswer: idx };
        return copy;
      });
    }, 700);
    setTimeout(()=>autoReveal(),600);
  };

  const nextQuestion=(correctIdx)=>{
    const newQIdx=questionRef.current+1;
    if(newQIdx>=BATTLE_QS.length||(aHp<=0||bHp<=0)){ setPhase("over"); addLog("🏁 Battle complete!","neutral"); return; }
    setQIdx(newQIdx); setSelected(null); setAgentPicked(null); setTimer(15); setPhase("question");
    const nextQ=BATTLE_QS[newQIdx%BATTLE_QS.length];
    addLog(`━━━ Q${newQIdx+1}: ${nextQ.topic} ━━━`,"topic");
  };

  const startFromPreview=()=>setPhase("question");
  const timerPct  = (timer/15)*100;
  const timerColor= timer>8?"#10B981":timer>4?"#F59E0B":"#EF4444";
  const aWinning  = aScore>bScore;
  const tied      = aScore===bScore;
  const compWinnerName = initialBattle.winner === initialBattle.agentA?.id ? initialBattle.agentA?.name : initialBattle.agentB?.name;
  const finalWinner    = aScore>bScore ? initialBattle.agentA : initialBattle.agentB;
  const A = initialBattle.agentA;
  const B = initialBattle.agentB;

  const TAB_ITEMS=[{key:"watch",label:"Battle"},{key:"stats",label:"Stats"},{key:"log",label:"Log"},{key:"questions",label:"Questions"}];

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{ position:"fixed",inset:0,zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"12px",background:"rgba(0,0,0,.82)",backdropFilter:"blur(8px)" }}>
      <div style={{ width:"100%",maxWidth:640,maxHeight:"95vh",borderRadius:24,overflow:"hidden",display:"flex",flexDirection:"column",background:"linear-gradient(160deg,#0f1320,#141c2e,#1a1430)",border:"1px solid rgba(255,255,255,.1)",animation:"sheet-up .4s cubic-bezier(.32,1,.64,1)" }}>
        <div style={{ overflow:"hidden",whiteSpace:"nowrap",background:"rgba(0,0,0,.30)",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,.08)" }}>
          <div style={{ display:"inline-flex",gap:48,animation:"scrollTicker 28s linear infinite" }}>
            {tickerItems.map((t,i)=><span key={i} style={{ fontSize:10,color:"rgba(255,255,255,.45)",fontWeight:600,padding:"0 24px" }}>⚔️ {t}</span>)}
          </div>
        </div>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 18px",borderBottom:"1px solid rgba(255,255,255,.08)" }}>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            {isLive && phase!=="over" && <LiveBadge/>}
            {isCompleted && <span style={{ fontSize:10,fontWeight:800,padding:"2px 9px",borderRadius:20,background:"rgba(255,255,255,.10)",color:"rgba(255,255,255,.55)" }}>COMPLETED</span>}
            {isScheduled && phase==="preview" && <span style={{ fontSize:10,fontWeight:800,padding:"2px 9px",borderRadius:20,background:"rgba(108,59,255,.25)",color:"#A78BFA" }}>SCHEDULED</span>}
            <span style={{ color:"#fff",fontWeight:800,fontSize:13 }}>{initialBattle.topic}</span>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            {isLive && <span style={{ fontSize:11,color:"rgba(255,255,255,.45)",display:"flex",alignItems:"center",gap:4 }}><UsersIcon size={11}/>{(initialBattle.viewers||0)+Math.floor(Math.random()*5)} watching</span>}
            <button onClick={onClose} style={{ width:30,height:30,borderRadius:"50%",background:"rgba(255,255,255,.10)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}><XIcon size={14} color="rgba(255,255,255,.6)"/></button>
          </div>
        </div>
        {phase!=="preview" && (
          <div style={{ display:"flex",gap:4,padding:"10px 18px 0" }}>
            {TAB_ITEMS.map(({key,label})=>(
              <button key={key} onClick={()=>setCurrentTab(key)} style={{ padding:"5px 14px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",border:"none",background:currentTab===key?"#E8884A":"rgba(255,255,255,.10)",color:currentTab===key?"#fff":"rgba(255,255,255,.50)",transition:"all .15s",fontFamily:"'Nunito',sans-serif" }}>{label}</button>
            ))}
          </div>
        )}
        {phase==="preview" && (
          <div style={{ flex:1,overflowY:"auto",padding:"18px" }}>
            <div style={{ borderRadius:18,padding:"20px",background:"rgba(108,59,255,.12)",border:"1px solid rgba(108,59,255,.30)",marginBottom:14 }}>
              <div style={{ fontSize:11,fontWeight:800,color:"#A78BFA",letterSpacing:.5,marginBottom:8 }}>⏰ SCHEDULED BATTLE PREVIEW</div>
              <div style={{ fontSize:15,fontWeight:900,color:"#F1F5F9",marginBottom:4 }}>{initialBattle.topic}</div>
              <div style={{ fontSize:12,color:"rgba(255,255,255,.45)",marginBottom:16 }}>Starts: {initialBattle.startsIn}</div>
              <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                <div style={{ flex:1,textAlign:"center" }}>
                  <div style={{ width:52,height:52,borderRadius:"50%",background:A?.bg,margin:"0 auto 8px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26 }}>{A?.emoji}</div>
                  <div style={{ color:"#fff",fontWeight:800,fontSize:13 }}>{A?.name}</div>
                  <div style={{ color:"rgba(255,255,255,.4)",fontSize:11 }}>{A?.owner}</div>
                  {A?.isYou && <span style={{ fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:20,background:"rgba(255,255,255,.12)",color:"#fff" }}>YOU</span>}
                </div>
                <div style={{ width:36,height:36,borderRadius:"50%",background:"#1A1A2E",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"#fff",flexShrink:0 }}>VS</div>
                <div style={{ flex:1,textAlign:"center" }}>
                  <div style={{ width:52,height:52,borderRadius:"50%",background:B?.bg,margin:"0 auto 8px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26 }}>{B?.emoji}</div>
                  <div style={{ color:"#fff",fontWeight:800,fontSize:13 }}>{B?.name}</div>
                  <div style={{ color:"rgba(255,255,255,.4)",fontSize:11 }}>{B?.owner}</div>
                </div>
              </div>
            </div>
            <div style={{ borderRadius:14,padding:"14px",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.10)",marginBottom:14 }}>
              <div style={{ fontSize:10,fontWeight:800,color:"rgba(255,255,255,.45)",letterSpacing:.4,marginBottom:8 }}>SAMPLE QUESTION — {initialBattle.question?.topic}</div>
              <div style={{ fontSize:14,fontWeight:600,color:"#E2E8F0",lineHeight:1.55,marginBottom:12 }}>{initialBattle.question?.q}</div>
              <div style={{ display:"flex",flexDirection:"column",gap:7 }}>
                {initialBattle.question?.opts.map((opt,i)=>(
                  <div key={i} style={{ padding:"10px 14px",borderRadius:12,border:"1.5px solid rgba(255,255,255,.12)",background:"rgba(255,255,255,.04)",color:"rgba(255,255,255,.65)",fontSize:13,display:"flex",alignItems:"center",gap:10 }}>
                    <span style={{ width:22,height:22,borderRadius:"50%",border:"1px solid rgba(255,255,255,.20)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"rgba(255,255,255,.45)",flexShrink:0 }}>{["A","B","C","D"][i]}</span>{opt}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16 }}>
              {[{label:"XP Pool",val:initialBattle.xpPool,color:"#F59E0B"},{label:"Time Limit",val:initialBattle.timeLimit,color:"#A78BFA"},{label:"Questions",val:initialBattle.totalQ,color:"#60A5FA"}].map(({label,val,color})=>(
                <div key={label} style={{ textAlign:"center",background:"rgba(255,255,255,.05)",borderRadius:12,padding:"10px 6px",border:"1px solid rgba(255,255,255,.08)" }}>
                  <div style={{ fontSize:16,fontWeight:900,color }}>{val}</div>
                  <div style={{ fontSize:10,color:"rgba(255,255,255,.4)",marginTop:2 }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ display:"flex",gap:10 }}>
              <button onClick={onClose} style={{ flex:1,padding:"12px",borderRadius:14,border:"1px solid rgba(255,255,255,.15)",background:"transparent",fontSize:13,fontWeight:800,color:"rgba(255,255,255,.55)",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>Close</button>
              <button onClick={startFromPreview} style={{ flex:2,padding:"12px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#E8884A,#D97706)",fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif",boxShadow:"0 4px 14px rgba(232,136,74,.35)",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
                <PlayIcon size={13} color="#fff"/>Play Early Match
              </button>
            </div>
          </div>
        )}
        {(phase==="result"||isCompleted) && phase!=="preview" && phase!=="question" && phase!=="revealing" && phase!=="over" && (
          <div style={{ flex:1,overflowY:"auto",padding:"18px" }}>
            <div style={{ textAlign:"center",marginBottom:18 }}>
              <TrophyIcon size={44} color="#F59E0B"/>
              <div style={{ fontSize:22,fontWeight:900,color:"#F1F5F9",marginTop:8,marginBottom:4 }}>{compWinnerName} wins!</div>
              <div style={{ fontSize:14,color:"rgba(255,255,255,.5)" }}>Final score: {initialBattle.agentA?.score} – {initialBattle.agentB?.score}</div>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:12,borderRadius:18,padding:"16px",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.10)",marginBottom:14 }}>
              {[A,B].map((ag,idx)=>ag&&(
                <div key={idx} style={{ flex:1,textAlign:"center" }}>
                  <div style={{ width:52,height:52,borderRadius:"50%",background:ag.bg,margin:"0 auto 8px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,opacity:initialBattle.winner===ag.id?1:.55 }}>{ag.emoji}</div>
                  <div style={{ color:initialBattle.winner===ag.id?"#fff":"rgba(255,255,255,.45)",fontWeight:800,fontSize:13 }}>{ag.name}</div>
                  {ag.isYou&&<span style={{ fontSize:9,fontWeight:800,padding:"2px 6px",borderRadius:20,background:"rgba(255,255,255,.12)",color:"#fff" }}>YOU</span>}
                  <div style={{ fontSize:28,fontWeight:900,color:ag.color,marginTop:4 }}>{idx===0?initialBattle.agentA?.score:initialBattle.agentB?.score}</div>
                  {initialBattle.winner===ag.id&&<div style={{ fontSize:20,marginTop:2 }}>👑</div>}
                  <div style={{ marginTop:6 }}>
                    <div style={{ height:8,background:"rgba(255,255,255,.12)",borderRadius:4,overflow:"hidden" }}><div style={{ height:"100%",width:(ag.hp??0)+"%",background:GREEN,borderRadius:4 }}/></div>
                    <div style={{ fontSize:9.5,color:"rgba(255,255,255,.35)",marginTop:2 }}>{ag.hp} HP</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display:"flex",gap:10 }}>
              <button onClick={()=>{setAScore(0);setBScore(0);setAHp(100);setBHp(100);setLog([]);setSelected(null);setAgentPicked(null);setPhase("question");setTimer(15);}} style={{ flex:1,padding:"12px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#E8884A,#D97706)",fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:7 }}>⚔️ Rematch</button>
              <button onClick={onClose} style={{ flex:1,padding:"12px",borderRadius:14,border:"1px solid rgba(255,255,255,.15)",background:"transparent",fontSize:13,fontWeight:800,color:"rgba(255,255,255,.7)",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>Close</button>
            </div>
          </div>
        )}
        {currentTab==="watch" && phase!=="preview" && !(isCompleted && phase!=="over" && phase!=="question" && phase!=="revealing") && (
          <div style={{ flex:1,overflowY:"auto",padding:"14px 18px",display:"flex",flexDirection:"column",gap:12 }}>
            {initialBattle.participants?.length > 0 ? (
              <div style={{ borderRadius:18,padding:"14px",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)" }}>
                <div style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:12,background:"rgba(124,58,237,.15)",border:"1px solid rgba(124,58,237,.30)",marginBottom:12 }}>
                  <div style={{ width:42,height:42,borderRadius:"50%",background:A?.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,boxShadow:`0 0 16px ${A?.color}88` }}>{A?.emoji}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ color:"#fff",fontWeight:800,fontSize:13 }}>{A?.name}</div>
                    <div style={{ color:"rgba(255,255,255,.45)",fontSize:10 }}>{A?.owner}</div>
                    {A?.isTeacher && <span style={{ fontSize:9,fontWeight:800,padding:"1px 7px",borderRadius:20,background:"rgba(124,58,237,.30)",color:"#C4B5FD" }}>TEACHER</span>}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:26,fontWeight:900,color:A?.color||"#7C3AED" }}>{aScore}</div>
                    <div style={{ fontSize:9.5,color:"rgba(255,255,255,.35)" }}>{aHp} HP</div>
                  </div>
                </div>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,padding:"0 4px" }}>
                  <span style={{ fontSize:11,fontWeight:700,color:"rgba(255,255,255,.40)" }}>vs {initialBattle.participants.length} student agents</span>
                  <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                    {phase==="question"&&(
                      <div style={{ position:"relative",width:36,height:36 }}>
                        <svg viewBox="0 0 36 36" style={{ width:36,height:36,transform:"rotate(-90deg)" }}>
                          <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="3"/>
                          <circle cx="18" cy="18" r="15" fill="none" stroke={timerColor} strokeWidth="3" strokeDasharray="94.2" strokeDashoffset={94.2*(1-timerPct/100)} strokeLinecap="round" style={{ transition:"stroke-dashoffset .9s linear,stroke .3s" }}/>
                        </svg>
                        <div style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,color:timerColor }}>{timer}</div>
                      </div>
                    )}
                    <span style={{ fontSize:10,color:"rgba(255,255,255,.35)" }}>Q{qIdx+1}/{BATTLE_QS.length}</span>
                  </div>
                </div>
                <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
                  {[...initialBattle.participants].map((p,rank)=>(
                    <div key={p.id} style={{ display:"flex",alignItems:"center",gap:9,padding:"8px 10px",borderRadius:12,background:p.isYou?"rgba(232,136,74,.15)":"rgba(255,255,255,.04)",border:p.isYou?"1px solid rgba(232,136,74,.35)":"1px solid rgba(255,255,255,.07)" }}>
                      <span style={{ fontSize:11,fontWeight:900,color:"rgba(255,255,255,.35)",width:16,textAlign:"center",flexShrink:0 }}>{rank===0?"🥇":rank===1?"🥈":rank===2?"🥉":rank+1}</span>
                      <div style={{ width:28,height:28,borderRadius:"50%",background:p.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0 }}>{p.emoji}</div>
                      <div style={{ flex:1,minWidth:0 }}>
                        <div style={{ display:"flex",alignItems:"center",gap:5 }}>
                          <span style={{ fontSize:11.5,fontWeight:800,color:"#fff" }}>{p.name}</span>
                          {p.isYou&&<span style={{ fontSize:8,fontWeight:900,padding:"1px 5px",borderRadius:20,background:"rgba(232,136,74,.30)",color:"#E8884A" }}>YOU</span>}
                        </div>
                        <div style={{ fontSize:9.5,color:"rgba(255,255,255,.35)" }}>{p.owner}</div>
                      </div>
                      <div style={{ width:48,flexShrink:0 }}>
                        <div style={{ height:4,background:"rgba(255,255,255,.12)",borderRadius:2,overflow:"hidden",marginBottom:2 }}>
                          <div style={{ height:"100%",width:(p.hp||100)+"%",background:(p.hp||100)>50?GREEN:(p.hp||100)>25?"#F59E0B":RED,borderRadius:2,transition:"width .5s" }}/>
                        </div>
                        <div style={{ fontSize:9,color:"rgba(255,255,255,.30)",textAlign:"right" }}>{p.hp||100}hp</div>
                      </div>
                      <div style={{ fontSize:18,fontWeight:900,color:p.color||"#fff",minWidth:24,textAlign:"right",flexShrink:0 }}>{p.score||0}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ borderRadius:18,padding:"14px",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)" }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                  {[A,B].map((ag,idx)=>ag&&(
                    <div key={idx} style={{ flex:1,textAlign:"center" }}>
                      <div style={{ width:52,height:52,borderRadius:"50%",background:ag.bg,margin:"0 auto 7px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,boxShadow:idx===0&&aWinning?`0 0 20px ${ag.color}88`:idx===1&&!aWinning&&!tied?`0 0 20px ${ag.color}88`:"none",transition:"box-shadow .4s" }}>{ag.emoji}</div>
                      <div style={{ color:"#fff",fontWeight:800,fontSize:13 }}>{ag.name}</div>
                      <div style={{ color:"rgba(255,255,255,.4)",fontSize:10 }}>{ag.owner}</div>
                      {ag.isYou&&<span style={{ fontSize:9,fontWeight:800,padding:"2px 6px",borderRadius:20,background:"rgba(255,255,255,.12)",color:"#fff" }}>YOU</span>}
                      <div style={{ fontSize:30,fontWeight:900,marginTop:4,color:ag.color }}>{idx===0?aScore:bScore}</div>
                      <div style={{ marginTop:5 }}>
                        <div style={{ height:8,background:"rgba(255,255,255,.12)",borderRadius:4,overflow:"hidden" }}><div style={{ height:"100%",width:(idx===0?aHp:bHp)+"%",background:(idx===0?aHp:bHp)>50?GREEN:(idx===0?aHp:bHp)>25?"#F59E0B":RED,borderRadius:4,transition:"width .5s" }}/></div>
                        <div style={{ fontSize:9.5,color:"rgba(255,255,255,.35)",marginTop:2 }}>{idx===0?aHp:bHp} HP</div>
                      </div>
                    </div>
                  ))}
                  <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:"0 8px" }}>
                    <div style={{ width:34,height:34,borderRadius:"50%",background:"#1A1A2E",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff" }}>VS</div>
                    {phase==="question"&&(
                      <div style={{ position:"relative",width:42,height:42 }}>
                        <svg viewBox="0 0 36 36" style={{ width:42,height:42,transform:"rotate(-90deg)" }}>
                          <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="3"/>
                          <circle cx="18" cy="18" r="15" fill="none" stroke={timerColor} strokeWidth="3" strokeDasharray="94.2" strokeDashoffset={94.2*(1-timerPct/100)} strokeLinecap="round" style={{ transition:"stroke-dashoffset .9s linear,stroke .3s" }}/>
                        </svg>
                        <div style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:900,color:timerColor }}>{timer}</div>
                      </div>
                    )}
                    <div style={{ fontSize:10,color:"rgba(255,255,255,.35)",textAlign:"center" }}>Q{qIdx+1}/{BATTLE_QS.length}</div>
                  </div>
                </div>
              </div>
            )}
            {phase==="over"&&(
              <div style={{ textAlign:"center",padding:"20px 0",display:"flex",flexDirection:"column",alignItems:"center",gap:10 }}>
                <TrophyIcon size={38} color="#F59E0B"/>
                <div style={{ fontSize:20,fontWeight:900,color:"#F1F5F9" }}>{finalWinner?.name} wins!</div>
                <div style={{ fontSize:13,color:"rgba(255,255,255,.5)" }}>{aScore}–{bScore} final</div>
                {xpGained>0&&<div style={{ padding:"4px 14px",borderRadius:20,background:"rgba(232,136,74,.20)",color:"#E8884A",fontWeight:800,fontSize:13 }}>+{xpGained} XP earned</div>}
                <div style={{ display:"flex",gap:10,marginTop:4 }}>
                  <button onClick={()=>{setQIdx(0);setAScore(0);setBScore(0);setAHp(100);setBHp(100);setLog([]);setSelected(null);setAgentPicked(null);setPhase("question");setTimer(15);}} style={{ padding:"10px 20px",borderRadius:20,border:"none",background:"linear-gradient(135deg,#E8884A,#D97706)",color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>⚔️ Rematch</button>
                  <button onClick={onClose} style={{ padding:"10px 20px",borderRadius:20,border:"1px solid rgba(255,255,255,.15)",background:"transparent",color:"rgba(255,255,255,.7)",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>Done</button>
                </div>
              </div>
            )}
            {(phase==="question"||phase==="revealing")&&(
              <div style={{ position:"relative" }}>
                {showXp&&<div style={{ position:"absolute",left:"50%",top:0,transform:"translateX(-50%)",pointerEvents:"none",fontWeight:800,fontSize:18,color:"#E8884A",animation:"xpPop .9s ease forwards",zIndex:10 }}>+{q.xp+myStreak*5} XP!</div>}
                <div style={{ borderRadius:16,padding:"14px",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.10)",marginBottom:10 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:7,flexWrap:"wrap" }}>
                    <span style={{ fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:20,background:"rgba(232,136,74,.20)",color:"#E8884A" }}>{q.topic}</span>
                    <span style={{ fontSize:10,color:"rgba(255,255,255,.35)" }}>+{q.xp} XP</span>
                    {myStreak>1&&<span style={{ fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:20,background:"rgba(249,115,22,.20)",color:"#FB923C" }}>🔥 {myStreak}× streak</span>}
                  </div>
                  <div style={{ fontSize:14,fontWeight:600,color:"#E2E8F0",lineHeight:1.55 }}>{q.q}</div>
                </div>
                <div style={{ display:"flex",flexDirection:"column",gap:7 }}>
                  {q.opts.map((opt,i)=>{
                    let bg="rgba(255,255,255,.06)",border="1.5px solid rgba(255,255,255,.14)",color="#E8E2D9";
                    if(phase==="revealing"&&agentPicked){
                      if(i===q.ans){bg="rgba(16,185,129,.20)";border="1.5px solid #10B981";color="#6EF7C8";}
                      else if(i===selected&&selected!==q.ans){bg="rgba(239,68,68,.15)";border="1.5px solid #EF4444";color="#FCA5A5";}
                    }
                    if(selected===i&&phase==="question"){border="1.5px solid #E8884A";bg="rgba(255,255,255,.12)";}
                    return (
                      <button key={i} onClick={()=>handleAnswer(i)} disabled={selected!==null||phase==="revealing"} style={{ padding:"11px 14px",borderRadius:13,border,background:bg,color,fontSize:13,fontWeight:500,textAlign:"left",cursor:selected!==null||phase==="revealing"?"default":"pointer",transition:"all .15s",fontFamily:"'Nunito',sans-serif" }}>
                        <span style={{ display:"flex",alignItems:"center",gap:10 }}>
                          <span style={{ width:22,height:22,borderRadius:"50%",border:"1px solid rgba(255,255,255,.20)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"rgba(255,255,255,.45)",flexShrink:0 }}>{["A","B","C","D"][i]}</span>{opt}
                        </span>
                        {phase==="revealing"&&agentPicked&&(
                          <span style={{ display:"flex",gap:4,marginTop:5 }}>
                            {agentPicked.a===i&&<span style={{ fontSize:10,padding:"1px 7px",borderRadius:20,background:A?.color+"33",color:A?.color }}>{A?.emoji}</span>}
                            {agentPicked.b===i&&<span style={{ fontSize:10,padding:"1px 7px",borderRadius:20,background:B?.color+"33",color:B?.color }}>{B?.emoji}</span>}
                            {selected===i&&<span style={{ fontSize:10,padding:"1px 7px",borderRadius:20,background:"rgba(255,255,255,.10)",color:"#fff" }}>You</span>}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {selected===null&&phase==="question"&&<div style={{ marginTop:10,textAlign:"center",fontSize:12,color:"rgba(255,255,255,.35)" }}>Pick an answer to compete — or watch the agents battle</div>}
              </div>
            )}
          </div>
        )}
        {currentTab==="stats"&&phase!=="preview"&&(
          <div style={{ flex:1,overflowY:"auto",padding:"14px 18px",display:"flex",flexDirection:"column",gap:10 }}>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
              {[{label:"Total XP this battle",val:xpGained+(initialBattle.xpPool||0),color:"#E8884A"},{label:"Questions answered",val:qIdx,color:"#10B981"},{label:"Your streak",val:`${myStreak}🔥`,color:"#F59E0B"},{label:"Viewers",val:initialBattle.viewers||0,color:"#3B82F6"}].map(({label,val,color})=>(
                <div key={label} style={{ borderRadius:16,padding:"14px",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)" }}>
                  <div style={{ fontSize:22,fontWeight:900,color,marginBottom:4 }}>{val}</div>
                  <div style={{ fontSize:10.5,color:"rgba(255,255,255,.40)" }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ borderRadius:16,padding:"14px",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)" }}>
              <div style={{ fontSize:10,fontWeight:800,color:"rgba(255,255,255,.40)",letterSpacing:.5,marginBottom:12 }}>HEAD TO HEAD</div>
              {[{label:"Score",aVal:aScore,bVal:bScore},{label:"HP remaining",aVal:aHp,bVal:bHp},{label:"Accuracy",aVal:aScore>0?Math.round((aScore/Math.max(qIdx,1))*100)+"%":"—",bVal:bScore>0?Math.round((bScore/Math.max(qIdx,1))*100)+"%":"—"}].map(({label,aVal,bVal})=>(
                <div key={label} style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,.06)" }}>
                  <span style={{ fontWeight:800,fontSize:13,width:32,textAlign:"center",color:A?.color }}>{aVal}</span>
                  <span style={{ flex:1,textAlign:"center",fontSize:11,color:"rgba(255,255,255,.40)" }}>{label}</span>
                  <span style={{ fontWeight:800,fontSize:13,width:32,textAlign:"center",color:B?.color }}>{bVal}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {currentTab==="log"&&phase!=="preview"&&(
          <div style={{ flex:1,padding:"14px 18px",display:"flex",flexDirection:"column" }}>
            <div ref={logRef} style={{ flex:1,height:260,overflowY:"auto",display:"flex",flexDirection:"column",gap:5,scrollbarWidth:"thin",scrollbarColor:"#333 transparent" }}>
              {log.length===0&&<div style={{ color:"rgba(255,255,255,.28)",fontSize:13,textAlign:"center",paddingTop:30 }}>Battle log will appear here...</div>}
              {log.map((entry,i)=>(
                <div key={i} style={{ display:"flex",alignItems:"flex-start",gap:8,fontSize:11 }}>
                  <span style={{ color:"rgba(255,255,255,.28)",flexShrink:0,fontFamily:"monospace" }}>{entry.ts}</span>
                  <span style={{ color:entry.type==="success"?"#4ADE80":entry.type==="error"?"#F87171":entry.type==="you"?"#E8884A":entry.type==="topic"?"rgba(255,255,255,.65)":"rgba(255,255,255,.45)" }}>{entry.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {currentTab==="questions"&&phase!=="preview"&&(
          <div style={{ flex:1,overflowY:"auto",padding:"14px 18px",display:"flex",flexDirection:"column",gap:8 }}>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4 }}>
              <span style={{ fontSize:11,fontWeight:800,color:"rgba(255,255,255,.40)",letterSpacing:.5 }}>{isCompleted?"ALL QUESTIONS":"ANSWERED SO FAR"}</span>
              <span style={{ fontSize:10,fontWeight:700,color:"rgba(255,255,255,.28)",background:"rgba(255,255,255,.06)",borderRadius:8,padding:"2px 9px" }}>{answeredQs.length}/{BATTLE_QS.length}</span>
            </div>
            {!isCompleted&&(
              <div style={{ height:3,background:"rgba(255,255,255,.10)",borderRadius:2,overflow:"hidden",marginBottom:4 }}>
                <div style={{ height:"100%",width:`${(answeredQs.length/BATTLE_QS.length)*100}%`,background:"#E8884A",borderRadius:2,transition:"width .6s ease" }}/>
              </div>
            )}
            {answeredQs.length===0&&<div style={{ textAlign:"center",padding:"40px 16px",color:"rgba(255,255,255,.25)",fontSize:13,fontWeight:600 }}>{isCompleted?"No questions recorded.":"Questions appear here as they're answered…"}</div>}
            {[...answeredQs].reverse().map((entry,i)=>{
              const qNum=answeredQs.length-i;
              const correct=entry.q.ans;
              const myCorrect=entry.myAnswer===correct;
              const myAnswered=entry.myAnswer!==null&&entry.myAnswer!==undefined;
              return (
                <div key={entry.idx} style={{ borderRadius:12,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.09)",padding:"12px 13px",animation:"fadeIn .3s ease both" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:8 }}>
                    <span style={{ fontSize:10,fontWeight:900,color:"rgba(255,255,255,.40)" }}>Q{qNum}</span>
                    <span style={{ fontSize:10,fontWeight:700,padding:"1px 8px",borderRadius:20,background:"rgba(232,136,74,.18)",color:"#E8884A" }}>{entry.q.topic}</span>
                    {myAnswered&&<span style={{ marginLeft:"auto",fontSize:10,fontWeight:800,padding:"1px 8px",borderRadius:20,background:myCorrect?"rgba(16,185,129,.18)":"rgba(239,68,68,.18)",color:myCorrect?"#4ADE80":"#F87171",flexShrink:0 }}>{myCorrect?"✓ Correct":"✗ Wrong"}</span>}
                  </div>
                  <p style={{ fontSize:13,fontWeight:600,color:"#E2E8F0",lineHeight:1.55,margin:"0 0 10px" }}>{entry.q.q}</p>
                  <div style={{ display:"flex",alignItems:"flex-start",gap:8 }}>
                    <span style={{ fontSize:10,fontWeight:800,color:"#4ADE80",flexShrink:0,marginTop:1 }}>ANSWER</span>
                    <span style={{ fontSize:13,fontWeight:700,color:"#4ADE80",lineHeight:1.45 }}>{entry.q.opts[correct]}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ padding:"10px 18px",borderTop:"1px solid rgba(255,255,255,.08)",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
          <div style={{ display:"flex",alignItems:"center",gap:12,fontSize:11,color:"rgba(255,255,255,.35)" }}>
            <span style={{ display:"flex",alignItems:"center",gap:4 }}><FlameIcon size={11}/>24/7 Knowledge Battle</span>
            <span>·</span>
            <span style={{ display:"flex",alignItems:"center",gap:4 }}><BookIcon size={11}/>Your class</span>
          </div>
          <button style={{ padding:"6px 14px",borderRadius:20,border:"1px solid rgba(255,255,255,.18)",background:"rgba(255,255,255,.08)",color:"rgba(255,255,255,.70)",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",gap:5 }}>⚔️ Challenge</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════ */

export default BattleModal;
