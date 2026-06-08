import { useState, useEffect, useRef, useCallback } from "react";
import {
  SESSIONS, CHALLENGES, SEED_BATTLES, LEADERBOARD,
  getQuestions, QUESTIONS, MOCK_DECAY_ALERTS, AGENT_SESSIONS, CONTINUATION_HISTORY,
  AGENT_CONFIG, TASKS_INIT, QUICK_PROMPTS, AGENT_REPLIES,
  PHASE_TEMPLATES, autoSubtopics, autoObjectives, MOCK_DECAY_MESSAGES,
} from "./data/mockSeed.js";

/* ── Change 1: API utilities ─────────────────────────────────────────────── */
const API        = import.meta.env.VITE_API_URL || "https://akoro.app";
const STUDENT_ID = "user-alex-01"; // replace with auth context
const jwt = () => (typeof localStorage !== "undefined" && localStorage.getItem("akoro_jwt")) || "";

async function apiGet(path) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${jwt()}` } });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt()}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
async function apiPatch(path) {
  const r = await fetch(`${API}${path}`, { method: "PATCH", headers: { Authorization: `Bearer ${jwt()}` } });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

/* ── Brand + subject colours ─────────────────────────────────────────────── */
const BRAND  = "#6C3BFF";
const GOLD   = "#F59E0B";
const GREEN  = "#10B981";
const RED    = "#EF4444";

const SUBJECTS = {
  all:     { label:"All Topics", color:BRAND,     icon:"📚" },
  maths:   { label:"Maths",      color:"#6C3BFF", icon:"🔢" },
  english: { label:"English",    color:"#0EA5E9", icon:"📖" },
  science: { label:"Science",    color:"#10B981", icon:"🔬" },
};
const SUBJECT_COLORS = { maths:"#6C3BFF", english:"#0EA5E9", science:"#10B981" };

const PRIORITY_CONFIG = {
  live:     { label:"LIVE",      bg:"rgba(239,68,68,0.12)",  color:RED,   dot:RED,   pulse:true  },
  upcoming: { label:"UPCOMING",  bg:"rgba(245,158,11,0.12)", color:GOLD,  dot:GOLD,  pulse:false },
  normal:   { label:"SCHEDULED", bg:"rgba(16,185,129,0.10)", color:GREEN, dot:GREEN, pulse:false },
};
const DIFFICULTY_CONFIG = {
  hard:   { label:"Hard",   color:RED,   bg:"rgba(239,68,68,0.10)"  },
  medium: { label:"Medium", color:GOLD,  bg:"rgba(245,158,11,0.10)" },
  easy:   { label:"Easy",   color:GREEN, bg:"rgba(16,185,129,0.10)" },
};
/* ══════════════════════════════════
   SVG ICON HELPERS  (unchanged)
══════════════════════════════════ */
function PhoneIcon({ size=18,color="#fff"     }){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>;}
function MessageIcon({size=18,color="#fff"   }){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;}
function PlayIcon({ size=14, color="#fff"    }){return <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none"><polygon points="5,3 19,12 5,21"/></svg>;}
function ZapIcon({  size=14, color=GOLD      }){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;}
function MicIcon({  size=22, color="#fff"    }){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>;}
function ChevDownIcon({size=13,color=BRAND   }){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>;}
function StarIcon({  size=11, color=GOLD     }){return <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;}
function XIcon({     size=16, color="#94A3B8"}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;}
function SendIcon({  size=17, color="#fff"   }){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;}
function BrainIcon({ size=16, color=BRAND    }){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 017 4.5v0A2.5 2.5 0 014.5 7v0A2.5 2.5 0 012 9.5v5A2.5 2.5 0 004.5 17v0A2.5 2.5 0 007 19.5v0A2.5 2.5 0 009.5 22h5a2.5 2.5 0 002.5-2.5v0a2.5 2.5 0 002.5-2.5v0a2.5 2.5 0 002.5-2.5v-5A2.5 2.5 0 0019.5 7v0A2.5 2.5 0 0017 4.5v0A2.5 2.5 0 0014.5 2h-5z"/><path d="M12 2v20M2 12h20"/></svg>;}
function SparkleIcon({size=15,color=GOLD     }){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 3l.75 2.25L22 6l-2.25.75L19 9l-.75-2.25L16 6l2.25-.75z"/><path d="M5 17l.75 2.25L8 20l-2.25.75L5 23l-.75-2.25L2 20l2.25-.75z"/></svg>;}
function TrophyIcon({ size=20, color=GOLD    }){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 21 12 21 16 21"/><line x1="12" y1="17" x2="12" y2="21"/><path d="M7 4H17L17 11a5 5 0 01-10 0V4z"/><path d="M7 4H4v3a3 3 0 003 3"/><path d="M17 4h3v3a3 3 0 01-3 3"/></svg>;}
function UsersIcon({  size=12, color="#9CA3AF"}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>;}
function FlameIcon({  size=12, color="#F97316"}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 01-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>;}
function BookIcon({   size=12, color="#9CA3AF"}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>;}

/* ══════════════════════════════════
   UI PRIMITIVES  (unchanged)
══════════════════════════════════ */
function ProgressBar({ value, color }) {
  return (
    <div style={{ height:5,background:"#F3F4F6",borderRadius:99,overflow:"hidden",marginTop:5 }}>
      <div style={{ height:"100%",width:`${value}%`,background:`linear-gradient(90deg,${color}88,${color})`,borderRadius:99,transition:"width 0.6s ease" }}/>
    </div>
  );
}
function LiveBadge() {
  return (
    <span style={{ display:"inline-flex",alignItems:"center",gap:5,padding:"2px 9px",borderRadius:20,background:RED,color:"#fff",fontSize:10,fontWeight:800 }}>
      <span style={{ width:6,height:6,borderRadius:"50%",background:"#fff",display:"inline-block",animation:"pulse-dot 1.3s ease infinite" }}/>LIVE
    </span>
  );
}
function SubjectDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const sel = SUBJECTS[value];
  return (
    <div style={{ position:"relative" }}>
      <div onClick={() => setOpen(o=>!o)} style={{ display:"flex",alignItems:"center",gap:5,background:"#F0EBFF",borderRadius:100,padding:"5px 11px 5px 9px",border:"1px solid #DDD3FF",cursor:"pointer" }}>
        <span style={{ fontSize:13 }}>{sel.icon}</span>
        <span style={{ fontSize:11.5,fontWeight:800,color:BRAND }}>{sel.label}</span>
        <ChevDownIcon size={12} color={BRAND}/>
      </div>
      {open && (
        <div style={{ position:"absolute",top:"calc(100% + 6px)",left:0,background:"#fff",borderRadius:14,border:"1px solid #E5E7EB",boxShadow:"0 8px 28px rgba(0,0,0,.10)",zIndex:500,overflow:"hidden",minWidth:155 }}>
          {Object.entries(SUBJECTS).map(([key,sub])=>(
            <div key={key} onClick={()=>{onChange(key);setOpen(false);}} style={{ padding:"10px 14px",display:"flex",alignItems:"center",gap:8,cursor:"pointer",background:value===key?"#F0EBFF":"transparent",borderBottom:"1px solid #F9FAFB" }}>
              <span style={{ fontSize:14 }}>{sub.icon}</span>
              <span style={{ fontSize:13,fontWeight:700,color:value===key?BRAND:"#374151" }}>{sub.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   BATTLE MODAL  (unchanged)
══════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════
   CHALLENGE MODAL  (unchanged)
══════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════
   SESSION SHEET
   Handles 3 modes: normal live, decay (Revise Teaching),
   continuation (Continue Teaching).
   Card always opens this sheet — CTAs differ per mode.
══════════════════════════════════════════════════════ */
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
   CHANGE 2 — ConfigModal (from AkoroSimulator)
   Opens when FAB "Start Session" is tapped.
   Same structure as simulator's ConfigModal.
══════════════════════════════════════════════════════ */
function ConfigModal({ initial, onStart, onCancel }) {
  const [topic,      setTopic]      = useState(initial?.topic      || "");
  const [subject,    setSubject]    = useState(initial?.subject    || "Science");
  const [subtopics,  setSubtopics]  = useState(initial?.subtopics  || []);
  const [draft,      setDraft]      = useState("");
  const [objs,       setObjs]       = useState(initial?.objectives || {});
  const [generating, setGenerating] = useState(false);

  const subjects = ["Science","Biology","Chemistry","Physics","Maths","English","History","Geography"];

  const addSubtopic = (val) => {
    const v = val.trim();
    if (!v || subtopics.includes(v)) return;
    const next = [...subtopics, v];
    setSubtopics(next);
    if (!objs[v]) setObjs(o => ({ ...o, [v]: autoObjectives(v, topic || "this topic") }));
    setDraft("");
  };
  const removeSubtopic = (st) => {
    setSubtopics(s => s.filter(x => x !== st));
    setObjs(o => { const n={...o}; delete n[st]; return n; });
  };

  const generate = async () => {
    if (!topic.trim()) return;
    setGenerating(true);
    try {
      // Try real API first
      const data = await apiPost("/api/adaptive/teaching/configure", { topic, subject });
      if (data.subtopics?.length) {
        setSubtopics(data.subtopics);
        setObjs(data.objectives || {});
        setGenerating(false);
        return;
      }
    } catch { /* fall through to mock */ }
    // Mock fallback
    const generated = autoSubtopics(topic, subject);
    setSubtopics(generated);
    const newObjs = {};
    generated.forEach(st => { newObjs[st] = autoObjectives(st, topic); });
    setObjs(newObjs);
    setGenerating(false);
  };

  const updateObj = (st, idx, val) =>
    setObjs(o => ({ ...o, [st]: o[st].map((v, i) => i === idx ? val : v) }));

  const canStart = topic.trim() && subtopics.length > 0;

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:"'Nunito',sans-serif" }}>
      <div style={{ background:"#fff",borderRadius:16,maxWidth:540,width:"100%",maxHeight:"90vh",overflowY:"auto",padding:"24px 22px",boxShadow:"0 20px 60px rgba(0,0,0,.25)",animation:"sheet-up .3s cubic-bezier(.32,1.2,.64,1)" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
          <div>
            <h2 style={{ fontSize:16,fontWeight:800,color:"#111827",margin:0 }}>Configure teaching session</h2>
            <p style={{ fontSize:11.5,color:"#6B7280",margin:"3px 0 0" }}>You teach · your agent learns · NaNa guides</p>
          </div>
          {onCancel && <button onClick={onCancel} style={{ width:30,height:30,borderRadius:"50%",border:"0.5px solid #E5E7EB",background:"#F9FAFB",cursor:"pointer",fontSize:14,color:"#6B7280" }}>✕</button>}
        </div>

        {/* Topic */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11,fontWeight:700,color:"#374151",display:"block",marginBottom:5,letterSpacing:.3 }}>TOPIC</label>
          <input value={topic} onChange={e=>setTopic(e.target.value)} placeholder="e.g. Water, Algebra, Shakespeare…"
            style={{ width:"100%",padding:"10px 13px",borderRadius:8,border:"0.5px solid #D1D5DB",fontSize:14,fontWeight:600,color:"#111827",outline:"none",fontFamily:"inherit" }}
            onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="#D1D5DB"}/>
        </div>

        {/* Subject */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11,fontWeight:700,color:"#374151",display:"block",marginBottom:5,letterSpacing:.3 }}>SUBJECT</label>
          <select value={subject} onChange={e=>setSubject(e.target.value)} style={{ width:"100%",padding:"10px 13px",borderRadius:8,border:"0.5px solid #D1D5DB",fontSize:14,fontWeight:600,color:"#111827",outline:"none",fontFamily:"inherit",background:"#fff" }}>
            {subjects.map(s=><option key={s}>{s}</option>)}
          </select>
        </div>

        {/* Subtopics */}
        <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7 }}>
            <label style={{ fontSize:11,fontWeight:700,color:"#374151",letterSpacing:.3 }}>SUBTOPICS ({subtopics.length})</label>
            <button onClick={generate} disabled={!topic.trim()||generating} style={{ padding:"4px 11px",borderRadius:6,border:`0.5px solid ${BRAND}`,background:generating?"#F9FAFB":`${BRAND}10`,color:!topic.trim()||generating?"#9CA3AF":BRAND,fontSize:11,fontWeight:700,cursor:topic.trim()&&!generating?"pointer":"default",fontFamily:"inherit" }}>
              {generating?"⏳ Generating…":"✨ Auto-generate"}
            </button>
          </div>
          {subtopics.length>0&&(
            <div style={{ display:"flex",flexWrap:"wrap",gap:6,marginBottom:8 }}>
              {subtopics.map((st,i)=>(
                <div key={st} style={{ display:"flex",alignItems:"center",gap:5,padding:"4px 9px",borderRadius:20,background:`${BRAND}10`,border:`0.5px solid ${BRAND}30`,fontSize:12,fontWeight:700,color:BRAND }}>
                  <span style={{ fontSize:9.5,color:"#9CA3AF",fontWeight:500 }}>{i+1}</span>{st}
                  <button onClick={()=>removeSubtopic(st)} style={{ background:"none",border:"none",cursor:"pointer",fontSize:11,color:"#9CA3AF",padding:0,lineHeight:1 }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display:"flex",gap:8 }}>
            <input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addSubtopic(draft);}}} placeholder="Type a subtopic and press Enter or +"
              style={{ flex:1,padding:"9px 12px",borderRadius:8,border:"0.5px solid #D1D5DB",fontSize:13,color:"#111827",outline:"none",fontFamily:"inherit" }}
              onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="#D1D5DB"}/>
            <button onClick={()=>addSubtopic(draft)} style={{ padding:"9px 14px",borderRadius:8,border:"none",background:BRAND,color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer" }}>+</button>
          </div>
        </div>

        {/* Objectives */}
        {subtopics.length>0&&(
          <div style={{ marginBottom:20 }}>
            <label style={{ fontSize:11,fontWeight:700,color:"#374151",display:"block",marginBottom:8,letterSpacing:.3 }}>LEARNING OBJECTIVES</label>
            {subtopics.map(st=>(
              <div key={st} style={{ background:"#F9FAFB",border:"0.5px solid #E5E7EB",borderRadius:8,padding:"10px 12px",marginBottom:8 }}>
                <div style={{ fontSize:11.5,fontWeight:700,color:BRAND,marginBottom:6 }}>{st}</div>
                {(objs[st]||autoObjectives(st,topic)).map((obj,i)=>(
                  <input key={i} value={obj} onChange={e=>updateObj(st,i,e.target.value)}
                    style={{ width:"100%",padding:"5px 9px",borderRadius:6,border:"0.5px solid #E5E7EB",fontSize:12,color:"#374151",marginBottom:4,outline:"none",fontFamily:"inherit",background:"#fff" }}
                    onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="#E5E7EB"}/>
                ))}
              </div>
            ))}
          </div>
        )}

        <div style={{ display:"flex",gap:10 }}>
          {onCancel&&<button onClick={onCancel} style={{ flex:1,padding:"12px",borderRadius:10,border:"0.5px solid #E5E7EB",background:"#F9FAFB",fontSize:13,fontWeight:700,color:"#6B7280",cursor:"pointer",fontFamily:"inherit" }}>Cancel</button>}
          <button onClick={()=>{ if(!canStart) return; onStart({ topic, subject, subtopics, objectives:objs }); }}
            disabled={!canStart}
            style={{ flex:2,padding:"12px",borderRadius:10,border:"none",background:canStart?`linear-gradient(135deg,${BRAND},#4C1DCC)`:"#E5E7EB",fontSize:13,fontWeight:800,color:canStart?"#fff":"#9CA3AF",cursor:canStart?"pointer":"default",fontFamily:"inherit" }}>
            ▶ Start session
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   AGENT STYLES — used by BlockRenderer
══════════════════════════════════════════════════════ */
const AGENT_STYLES = {
  nana:    { name:"NaNa Esumai", emoji:"🧠", bg:"#EEEDFE", color:"#3C3489", ring:"#AFA9EC" },
  sargeant:{ name:"Sargeant",    emoji:"⚡", bg:"#FFF0F0", color:"#7F1D1D", ring:"#FCA5A5" },
  student: { name:"Agent",       emoji:"🤖", bg:"#FEF0E6", color:"#92400E", ring:"#F59E0B" },
};

/* ══════════════════════════════════════════════════════
   BLOCK RENDERER
   Renders every block type from the teaching/decay session.
   Identical to AkoroSimulator — this IS the canonical renderer.
══════════════════════════════════════════════════════ */
function BlockRenderer({ block, agentName, agentEmoji }) {
  const student = { ...AGENT_STYLES.student, name: agentName || "Agent", emoji: agentEmoji || "🤖" };
  const nana    = AGENT_STYLES.nana;
  const sarg    = AGENT_STYLES.sargeant;
  const opacity = block.faded ? 0.55 : 1;

  /* ── system divider ── */
  if (block.type === "system-divider") return (
    <div style={{ display:"flex", alignItems:"center", gap:8, margin:"14px 0 6px", opacity }}>
      <div style={{ flex:1, height:"0.5px", background:"rgba(255,255,255,.15)" }}/>
      <span style={{ fontSize:9.5, color:"rgba(255,255,255,.38)", whiteSpace:"nowrap", fontStyle:"italic" }}>{block.label}</span>
      <div style={{ flex:1, height:"0.5px", background:"rgba(255,255,255,.15)" }}/>
    </div>
  );

  /* ── subtopic-hdr ── */
  if (block.type === "subtopic-hdr") return (
    <div style={{ background:"#1E1B4B", borderRadius:10, padding:"10px 13px", margin:"10px 0 4px",
      display:"flex", alignItems:"center", justifyContent:"space-between", opacity }}>
      <div>
        <div style={{ fontSize:10, color:"#A5B4FC", fontWeight:600, marginBottom:2 }}>
          {block.topic} · {block.subject}
        </div>
        <div style={{ fontSize:13, fontWeight:800, color:"#fff" }}>{block.subtopic}</div>
      </div>
      <div style={{ textAlign:"right" }}>
        <div style={{ fontSize:10, color:"#A5B4FC", marginBottom:4 }}>Subtopic progress</div>
        <div style={{ display:"flex", gap:3 }}>
          {Array.from({ length: block.total || 1 }).map((_,i) => (
            <div key={i} style={{ width:16, height:4, borderRadius:2,
              background: i <= (block.idx||0) ? "#818CF8" : "rgba(255,255,255,0.15)" }}/>
          ))}
        </div>
        <div style={{ fontSize:10, color:"#A5B4FC", marginTop:3 }}>{(block.idx||0)+1}/{block.total||1}</div>
      </div>
    </div>
  );

  /* ── plan strip ── */
  if (block.type === "plan") return (
    <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:4,
      padding:"5px 10px", background:"rgba(108,59,255,.18)", borderRadius:8, margin:"2px 0 6px", opacity }}>
      <span style={{ fontSize:10, fontWeight:700, color:"#A78BFA", marginRight:2 }}>NaNa plan:</span>
      {(block.phases || ["Phase 1 → what do they know","Phase 2 → must-know parts","Phase 3 → teach it back","Phase 4 → push further"]).map((p,i,arr)=>(
        <span key={i} style={{ fontSize:10, color:"#C4B5FD", fontWeight:600 }}>
          {p}{i < arr.length-1 && <span style={{ color:"rgba(255,255,255,.28)", margin:"0 3px" }}>·</span>}
        </span>
      ))}
    </div>
  );

  /* ── objectives strip ── */
  if (block.type === "objectives") return (
    <div style={{ padding:"6px 10px", background:"rgba(16,185,129,.10)", border:"0.5px solid rgba(16,185,129,.30)",
      borderRadius:8, margin:"2px 0 6px", opacity }}>
      <div style={{ fontSize:10, fontWeight:700, color:"#6EE7B7", marginBottom:4 }}>
        📌 Objectives — {block.subtopic}
      </div>
      {(block.items || []).map((obj,i)=>(
        <div key={i} style={{ fontSize:10.5, color:"#A7F3D0", lineHeight:1.5 }}>{i+1}. {obj}</div>
      ))}
    </div>
  );

  /* ── guide (NaNa Esumai) ── */
  if (block.type === "guide") return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8, marginBottom:4, opacity }}>
      <div style={{ width:28, height:28, borderRadius:"50%", background:nana.bg,
        border:`1.5px solid ${nana.ring}`, flexShrink:0, display:"flex",
        alignItems:"center", justifyContent:"center", fontSize:14 }}>{nana.emoji}</div>
      <div style={{ maxWidth:"80%" }}>
        {block.phase && (
          <div style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 9px",
            borderRadius:20, background:nana.bg, border:`0.5px solid ${nana.ring}`,
            fontSize:9.5, fontWeight:700, color:nana.color, marginBottom:4, flexWrap:"wrap" }}>
            {nana.emoji} {block.phase}
          </div>
        )}
        <div style={{ padding:"9px 13px", borderRadius:"4px 18px 18px 18px",
          background:nana.bg, border:`0.5px solid ${nana.ring}`,
          color:nana.color, fontSize:13.5, lineHeight:1.6, whiteSpace:"pre-wrap", fontWeight:500 }}>
          {block.text}
        </div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,.35)", marginTop:2 }}>{nana.name}</div>
      </div>
    </div>
  );

  /* ── student-agent (Atlas / real agent name) ── */
  if (block.type === "student-agent") return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8, marginBottom:4, opacity }}>
      <div style={{ width:28, height:28, borderRadius:"50%", background:student.bg,
        border:`1.5px solid ${student.ring}`, flexShrink:0, display:"flex",
        alignItems:"center", justifyContent:"center", fontSize:14 }}>{student.emoji}</div>
      <div style={{ maxWidth:"80%" }}>
        {block.phase && (
          <div style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"2px 9px",
            borderRadius:20, background:student.bg, border:`0.5px solid ${student.ring}50`,
            fontSize:9.5, fontWeight:700, color:student.color, marginBottom:4 }}>
            {student.emoji} {block.phase}
            {block.confidence !== undefined && (
              <span style={{ background:"rgba(255,255,255,.25)", borderRadius:6, padding:"1px 5px",
                fontSize:9, fontWeight:800, color: block.confidence >= 70 ? "#6EE7B7" : block.confidence >= 40 ? "#FDE68A" : "#FCA5A5" }}>
                {block.confidence}%
              </span>
            )}
          </div>
        )}
        <div style={{ padding:"9px 13px", borderRadius:"4px 18px 18px 18px",
          background:student.bg, border:`0.5px solid ${student.ring}`,
          color:student.color, fontSize:13.5, lineHeight:1.6, whiteSpace:"pre-wrap", fontWeight:500 }}>
          {block.text}
        </div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,.35)", marginTop:2 }}>{student.name}</div>
      </div>
    </div>
  );

  /* ── sargeant ── */
  if (block.type === "sargeant") return (
    <div style={{ border:`1.5px solid rgba(239,68,68,.40)`, borderRadius:12,
      overflow:"hidden", margin:"6px 0 8px", opacity }}>
      <div style={{ background:"linear-gradient(135deg,#7F1D1D,#991B1B)", padding:"7px 13px",
        display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:14 }}>⚡</span>
        <span style={{ fontSize:12, fontWeight:800, color:"#fff" }}>
          Sargeant{block.phase ? ` — ${block.phase}` : ""}
        </span>
      </div>
      <div style={{ padding:"10px 13px", background:"rgba(239,68,68,.08)",
        fontSize:13, color:"#FCA5A5", lineHeight:1.6, whiteSpace:"pre-wrap" }}>
        {block.text}
      </div>
    </div>
  );

  /* ── assess-result ── */
  if (block.type === "assess-result") {
    const pct   = block.confidence ?? 0;
    const color = pct >= 70 ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444";
    return (
      <div style={{ border:`1.5px solid ${color}40`, borderRadius:12, overflow:"hidden",
        margin:"6px 0 10px", opacity }}>
        <div style={{ background:color, padding:"7px 13px", display:"flex",
          alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, fontWeight:800, color:"#fff" }}>
            {block.passed ? "✓ Assessment passed" : "⚠ Needs more practice"}
            {block.subtopic ? ` — ${block.subtopic}` : ""}
          </span>
          <span style={{ fontSize:12, fontWeight:900, color:"#fff" }}>{pct}%</span>
        </div>
        <div style={{ padding:"10px 13px", background:"rgba(0,0,0,.25)" }}>
          <div style={{ height:8, background:"rgba(255,255,255,.12)", borderRadius:4, overflow:"hidden", marginBottom:8 }}>
            <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:4, transition:"width .5s" }}/>
          </div>
          <div style={{ fontSize:11.5, color:"rgba(255,255,255,.65)", lineHeight:1.55 }}>
            {block.passed
              ? `${block.agentName||"Agent"} confidence: ${pct}% ✓ — ready for ${block.nextSubtopic || "next subtopic"}.`
              : `${block.agentName||"Agent"} confidence: ${pct}% — below 70%. Please re-teach before advancing.`
            }
          </div>
        </div>
      </div>
    );
  }

  /* ── decay-notice (student agent notifying human) ── */
  if (block.type === "decay-notice") {
    const drop = (block.prevConfidence || 0) - (block.confidence || 0);
    return (
      <div style={{ border:"1.5px solid rgba(245,158,11,.45)", borderRadius:12,
        overflow:"hidden", margin:"10px 0 8px", opacity }}>
        <div style={{ background:"linear-gradient(135deg,rgba(120,53,15,.80),rgba(146,64,14,.80))",
          padding:"7px 13px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <span style={{ fontSize:14 }}>{block.agentEmoji || "🤖"}</span>
            <span style={{ fontSize:12, fontWeight:800, color:"#FDE68A" }}>
              {block.agentName || "Agent"} — knowledge decay detected
            </span>
          </div>
          <span style={{ fontSize:12, fontWeight:900, color:"#FCA5A5" }}>
            {block.prevConfidence}% → {block.confidence}%
          </span>
        </div>
        <div style={{ padding:"12px 13px", background:"rgba(245,158,11,.08)" }}>
          {/* Confidence drop bar */}
          <div style={{ marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"rgba(255,255,255,.45)", marginBottom:4 }}>
              <span>Previous: {block.prevConfidence}%</span>
              <span style={{ color:"#FCA5A5" }}>▼ Dropped {drop}% over {block.daysSince} days</span>
              <span style={{ color:"#FCA5A5" }}>Now: {block.confidence}%</span>
            </div>
            <div style={{ height:6, background:"rgba(255,255,255,.12)", borderRadius:3, overflow:"hidden" }}>
              <div style={{ height:"100%", display:"flex" }}>
                <div style={{ width:`${block.confidence}%`, background:"#EF4444", borderRadius:3 }}/>
                <div style={{ width:`${drop}%`, background:"rgba(239,68,68,.25)" }}/>
              </div>
            </div>
          </div>
          {/* Agent message */}
          <p style={{ fontSize:13, color:"#FDE68A", lineHeight:1.6, margin:"0 0 8px", fontWeight:500 }}>
            My confidence on <strong>{block.topic}</strong> has dropped significantly. I've been making mistakes with:
          </p>
          {(block.misconceptions || []).map((m,i)=>(
            <div key={i} style={{ fontSize:12, color:"#FCA5A5", marginBottom:3 }}>⚠ {m}</div>
          ))}
          <p style={{ fontSize:12.5, color:"rgba(255,255,255,.55)", lineHeight:1.5, margin:"8px 0 0", fontStyle:"italic" }}>
            Can you re-teach me this? I need to refresh my understanding.
          </p>
        </div>
      </div>
    );
  }

  /* ── session-complete ── */
  if (block.type === "session-complete") return (
    <div style={{ textAlign:"center", padding:"20px 16px",
      background:"linear-gradient(135deg,rgba(108,59,255,.18),rgba(16,185,129,.10))",
      borderRadius:16, border:"1.5px solid rgba(108,59,255,.35)", margin:"8px 0", opacity }}>
      <div style={{ fontSize:36, marginBottom:8 }}>🎉</div>
      <div style={{ fontSize:15, fontWeight:800, color:"#F1F5F9", marginBottom:4 }}>
        {block.isDecay ? "Re-teach Complete!" : "Session Complete!"}
      </div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,.55)", lineHeight:1.6 }}>{block.text}</div>
    </div>
  );

  /* ── user message ── */
  if (block.type === "user") return (
    <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:4, opacity }}>
      <div style={{ maxWidth:"78%", padding:"9px 13px",
        borderRadius:"18px 18px 4px 18px", background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,
        color:"#fff", fontSize:13.5, lineHeight:1.55, whiteSpace:"pre-wrap", fontWeight:500 }}>
        {block.text}
      </div>
    </div>
  );

  return null;
}

/* ══════════════════════════════════════════════════════
   SESSION CHAT VIEW
   Shared fullscreen chat — used by both teaching and decay.
   Renders all blocks via BlockRenderer.
══════════════════════════════════════════════════════ */
function SessionChatView({
  blocks, loading, input, onInputChange, onSend,
  topic, subject, agentName, agentEmoji, mode,
  userTurns, onSummarize, showSummarize,
  recording, onToggleRecording, seconds,
  voiceStreaming, interimText, onToggleVoice,
  onClose,
}) {
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
              {mode === "decay" ? "DECAY RE-TEACH" : "LEARN BY TEACHING"}
            </span>
          </div>
          <p style={{ fontSize:15,fontWeight:900,color:"#F1F5F9",margin:0 }}>{topic}</p>
          <p style={{ fontSize:11,fontWeight:600,color:"#475569",margin:0 }}>
            {subject} · {agentEmoji} {agentName} · NaNa Esumai 🧠 · Sargeant ⚡
          </p>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          {showSummarize && (
            <div onClick={onSummarize}
              style={{ display:"flex",alignItems:"center",gap:5,background:`${sc}22`,
                border:`1px solid ${sc}44`,borderRadius:12,padding:"7px 12px",cursor:"pointer" }}>
              <SparkleIcon size={13} color={sc}/>
              <span style={{ fontSize:11,fontWeight:800,color:sc }}>Summarize</span>
            </div>
          )}
          <div onClick={handleCloseRequest}
            style={{ width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,.07)",
              display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}>
            <XIcon size={15} color="#64748B"/>
          </div>
        </div>
      </div>

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
              display:"flex",gap:5,alignItems:"center" }}>
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
              <span style={{ fontSize:11,fontWeight:800,color:RED }}>Stop</span>
            </div>
            {/* Live transcript */}
            <div style={{ flex:1,background:"rgba(255,255,255,.07)",
              border:"1.5px solid rgba(255,255,255,.15)",borderRadius:12,
              padding:"8px 12px",minHeight:40,display:"flex",alignItems:"center" }}>
              {interimText
                ? <span style={{ fontSize:13,fontWeight:600,color:"#94A3B8",
                    fontStyle:"italic",lineHeight:1.5 }}>{interimText}</span>
                : <span style={{ fontSize:12,fontWeight:600,color:"#475569" }}>
                    Listening… speak now
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
              <span style={{ fontSize:12,fontWeight:800,color:RED }}>● {fmt(seconds)} — Tap to stop</span>
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
              <span style={{ fontSize:10,fontWeight:700,color:"#64748B" }}>Audio</span>
            </div>
            {/* Text input */}
            <div style={{ flex:1,display:"flex",alignItems:"center",
              background:"rgba(255,255,255,.07)",border:"1.5px solid rgba(255,255,255,.10)",
              borderRadius:12,padding:"8px 12px" }}>
              <input value={input} onChange={e=>onInputChange(e.target.value)}
                onKeyDown={handleKey}
                placeholder={`Explain to ${agentName}…`}
                style={{ flex:1,background:"none",border:"none",outline:"none",
                  fontSize:13,fontWeight:600,color:"#CBD5E1",
                  fontFamily:"'Nunito',sans-serif" }}/>
            </div>
            {/* Voice streaming button */}
            {onToggleVoice && (
              <div onClick={onToggleVoice}
                style={{ display:"flex",alignItems:"center",gap:5,flexShrink:0,
                  background:`${RED}18`,border:`1.5px solid ${RED}44`,
                  borderRadius:12,padding:"9px 11px",cursor:"pointer",transition:"all .2s" }}>
                <div style={{ width:8,height:8,borderRadius:"50%",background:RED }}/>
                <span style={{ fontSize:10,fontWeight:700,color:RED }}>Voice</span>
              </div>
            )}
            {/* Send button */}
            <div onClick={()=>onSend()}
              style={{ width:40,height:40,borderRadius:12,flexShrink:0,
                background:input.trim()?`linear-gradient(135deg,${sc},${sc}BB)`:"rgba(255,255,255,.06)",
                display:"flex",alignItems:"center",justifyContent:"center",
                cursor:"pointer",transition:"all .2s" }}>
              <SendIcon size={16} color={input.trim()?"#fff":"#475569"}/>
            </div>
          </div>
        )}

        {/* Turn counter */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between" }}>
          <span style={{ fontSize:10.5,fontWeight:600,color:"#334155" }}>
            {mode === "decay" ? "Re-teach turns" : mode === "continuation" ? "Continuation turns" : "Teaching turns"}: {userTurns} / 4
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
          <p style={{ fontSize:16,fontWeight:900,color:"#F1F5F9",margin:"0 0 8px",textAlign:"center" }}>End this session?</p>
          <p style={{ fontSize:13,color:"#64748B",margin:"0 0 24px",textAlign:"center",lineHeight:1.6 }}>
            Your teaching is not complete yet.{"\n"}Progress will be saved automatically.
          </p>
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={()=>setConfirmClose(false)}
              style={{ flex:1,padding:"13px",borderRadius:14,border:"1px solid rgba(255,255,255,.12)",
                background:"rgba(255,255,255,.06)",fontSize:13,fontWeight:800,color:"#94A3B8",
                cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>
              Keep Teaching
            </button>
            <button onClick={()=>{ setConfirmClose(false); onClose(); }}
              style={{ flex:1.2,padding:"13px",borderRadius:14,border:"none",
                background:`linear-gradient(135deg,${RED},#DC2626)`,
                fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",
                fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
              <XIcon size={13} color="#fff"/>End Session
            </button>
          </div>
        </div></>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   MOCK BLOCK BUILDERS
   Used as fallback when real API is unavailable.
══════════════════════════════════════════════════════ */
function buildInitialBlocks(config, agentNm, agentEm, guideNm="NaNa Esumai", guideEm="🧠") {
  if (!config?.subtopics?.length) return [{
    type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Teach · ready",
    text:`Let's start! Teach me about **${config?.topic||"your topic"}**. Explain it as if I've never heard of it.`,
  }];
  const firstSt = config.subtopics[0];
  const objs    = config.objectives?.[firstSt] || autoObjectives(firstSt, config.topic);
  return [
    { type:"subtopic-hdr", subtopic:firstSt, idx:0, total:config.subtopics.length, topic:config.topic, subject:config.subject },
    { type:"plan", phases:["Phase 1 → what do they know","Phase 2 → must-know parts","Phase 3 → teach it back","Phase 4 → push further"] },
    { type:"objectives", subtopic:firstSt, items:objs },
    { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Phase 1 — Set the scene",
      text:`Alright! We're starting with **${firstSt}**.\n\n${agentNm} ${agentEm}, get ready to learn. Human — your job is to teach ${agentNm} about ${firstSt}. Start with what you already know about it.` },
    { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · scanning knowledge base…`, confidence:18,
      text:`I have very limited data on ${firstSt}. What is it, and why does it matter in the context of ${config.topic}?` },
  ];
}

function buildMockQueue(config, agentNm, agentEm, guideNm="NaNa Esumai", guideEm="🧠") {
  if (!config?.subtopics?.length) return [];
  const queue = [];
  config.subtopics.forEach((st, idx) => {
    const isLast = idx === config.subtopics.length - 1;
    const nextSt = config.subtopics[idx + 1];
    const conf1 = 38 + Math.floor(Math.random()*10);
    const conf2 = 60 + Math.floor(Math.random()*10);
    const conf3 = 74 + Math.floor(Math.random()*12);
    const gateConf = 72 + Math.floor(Math.random()*16);

    queue.push([
      { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · processing · ${conf1}% ↑`, confidence:conf1,
        text:`I understand more now. ${st} involves a primary trigger that causes a change. What specifically controls how fast it happens?` },
      { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Phase 1 gap identified",
        text:`Good start! ${agentNm} is picking up the core idea but needs more on the mechanism. Move to Phase 2 — cover the must-know parts.` },
    ]);
    queue.push([
      { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · Phase 2 · ${conf2}% ↑`, confidence:conf2,
        text:`I have it now. ${st} is triggered by a primary condition — without it nothing happens. Secondary factors control the rate. The output type is always consistent.` },
      { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Phase 3 — Teach it back",
        text:`${agentNm} nailed the structure! Now ask for a real-world example to anchor the knowledge.` },
    ]);
    queue.push([
      { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · Phase 4 reasoning · ${conf3}% ↑`, confidence:conf3,
        text:`If the secondary factor dropped to zero, ${st} would still occur but extremely slowly. If the primary driver was removed entirely, ${st} would stop completely.` },
      { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Phase 4 — causal reasoning confirmed",
        text:`Outstanding! ${agentNm} isn't just recalling facts — it's reasoning causally about ${st}. That's real understanding. Moving to Sargeant's gate.` },
    ]);
    if (!isLast) {
      queue.push([
        { type:"sargeant", phase:`Assessment gate — ${st}`,
          text:`Before ${agentNm} can move to ${nextSt}, I need to verify ${st} is solid.\n\nQuestion for ${agentNm}: What is the primary condition required for ${st} to occur? No hints.` },
        { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · answering Sargeant`, confidence:gateConf,
          text:`The primary condition is the core driver that makes ${st} possible at all. Without it the process cannot occur, regardless of secondary factors.` },
        { type:"assess-result", subtopic:st, nextSubtopic:nextSt, agentName:agentNm, confidence:gateConf, passed:gateConf>=70 },
        { type:"subtopic-hdr", subtopic:nextSt, idx:idx+1, total:config.subtopics.length, topic:config.topic, subject:config.subject },
        { type:"plan", phases:["Phase 1 → what do they know","Phase 2 → must-know parts","Phase 3 → teach it back","Phase 4 → push further"] },
        { type:"objectives", subtopic:nextSt, items:config.objectives?.[nextSt]||autoObjectives(nextSt,config.topic) },
        { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Phase 1 — new subtopic",
          text:`${gateConf>=70?"Assessment passed ✓":"Needs work ⚠"} — moving to ${nextSt}. ${agentNm} — what do you already know about ${nextSt}?` },
        { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · scanning…`, confidence:15,
          text:`Very little data on ${nextSt}. I'm ready to learn from you.` },
      ]);
    } else {
      const finalConf = 78 + Math.floor(Math.random()*14);
      queue.push([
        { type:"sargeant", phase:"Final assessment gate",
          text:`All phases complete on ${st}. Final verification before closing the session.\n\nQ: Explain the full cause-and-effect chain of ${st} in your own words.` },
        { type:"student-agent", agent:agentNm, emoji:agentEm, phase:`${agentNm} · final assessment`, confidence:finalConf,
          text:`${st} begins when the primary condition is met. This triggers the core process. Secondary factors then modulate the rate. The output is always the same type but varies in magnitude.` },
        { type:"assess-result", subtopic:st, nextSubtopic:null, agentName:agentNm, confidence:finalConf, passed:finalConf>=70 },
        { type:"session-complete",
          text:`${agentNm} has learned ${config.subtopics.length} subtopic${config.subtopics.length>1?"s":""} of **${config.topic}**.\n\nKnowledge map updated · +${config.subtopics.length * 80} XP earned · Next session unlocked.` },
      ]);
    }
  });
  return queue;
}

function buildContinuationHistory(session, agentNm, agentEm, guideNm="NaNa Esumai", guideEm="🧠") {
  const { topic, subject, subtopicList = [], avgConfidence = 70, daysSince = 0 } = session;
  const sessionId = session.id || session.sessionId;

  // Use pre-written history if available for this session
  if (sessionId && CONTINUATION_HISTORY[sessionId]) {
    const history = CONTINUATION_HISTORY[sessionId];
    // Replace any "Aria" agent name with the actual current agent name/emoji
    const mapped = history.map(b => {
      if (b.type === "student-agent") return { ...b, agent: agentNm, emoji: agentEm };
      return b;
    });
    return [
      ...mapped,
      { type:"system-divider", label:"Continuing from here" },
      { type:"guide", agent:"NaNa Esumai", emoji:"🧠",
        phase:"Continuation — picking up where you left off",
        text:`Welcome back! ${agentNm} has ${avgConfidence}% confidence on ${topic} from last session. Continue teaching to reinforce and expand.` },
      { type:"student-agent", agent:agentNm, emoji:agentEm,
        phase:`${agentNm} · ${avgConfidence}% · ready to continue`, confidence:avgConfidence,
        text:`I remember what we covered last time. Ready to keep learning about ${topic}!` },
    ];
  }

  // Generic fallback — generated from metadata
  const prevBlocks = [];
  subtopicList.forEach((st, idx) => {
    const stConf = Math.min(100, Math.round(avgConfidence + (Math.random() * 12 - 6)));
    if (idx === 0) {
      prevBlocks.push({
        type:"subtopic-hdr", faded:true,
        subtopic:st, idx:0, total:subtopicList.length, topic, subject,
      });
      prevBlocks.push({ type:"plan", faded:true,
        phases:["Phase 1 → what do they know","Phase 2 → must-know parts","Phase 3 → teach it back","Phase 4 → push further"] });
      prevBlocks.push({
        type:"guide", agent:"NaNa Esumai", emoji:"🧠", faded:true,
        phase:`Phase 2 — ${st}`,
        text:`Good session on ${st}. ${agentNm} — let's make sure the key parts are solid.`,
      });
    }
    prevBlocks.push({
      type:"student-agent", agent:agentNm, emoji:agentEm, faded:true,
      phase:`${agentNm} · Phase 3 · ${stConf}%`, confidence:stConf,
      text:`I understand ${st} now. The core concept makes sense and I can explain it back clearly.`,
    });
    prevBlocks.push({
      type:"assess-result", faded:true,
      subtopic:st, agentName:agentNm,
      confidence:stConf, passed:stConf >= 70,
      nextSubtopic:subtopicList[idx + 1] || null,
    });
  });

  return [
    { type:"system-divider", label:`Previous session · ${daysSince} days ago` },
    ...prevBlocks,
    { type:"system-divider", label:"Continuing from here" },
    { type:"guide", agent:"NaNa Esumai", emoji:"🧠",
      phase:"Continuation — picking up where you left off",
      text:`Welcome back! ${agentNm} remembers ${topic} at ${avgConfidence}% confidence. Continue teaching to reinforce and expand the knowledge.` },
    { type:"student-agent", agent:agentNm, emoji:agentEm,
      phase:`${agentNm} · ${avgConfidence}% · ready to continue`, confidence:avgConfidence,
      text:`I remember the basics from last time. I'm ready to learn more about ${topic}!` },
  ];
}

function buildDecayHistory(alert, agentNm, agentEm, guideNm="NaNa Esumai", guideEm="🧠") {
  const { topic, subject, confidence, prevConfidence, daysSince, misconceptions } = alert;
  const stLabel = misconceptions?.length ? misconceptions[0] : topic;
  return [
    // ── Previous session (faded) ──────────────────────────────────────────
    { type:"system-divider", label:`Previous session — ${topic} · ${daysSince} days ago` },
    { type:"subtopic-hdr", subtopic:topic, idx:0, total:1, topic, subject, faded:true },
    { type:"plan", phases:["Phase 1 → what do they know","Phase 2 → must-know parts","Phase 3 → teach it back","Phase 4 → push further"], faded:true },
    { type:"objectives", subtopic:topic, faded:true,
      items:[`Understand the key stages of ${topic}`,`Distinguish between related processes`,`Apply knowledge to exam questions`] },
    { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Phase 2 — must-know parts · previous session", faded:true,
      text:`Good progress last session. ${agentNm} — let's solidify the specific stages. Make sure to cover each one clearly.` },
    { type:"user", text:`OK ${agentNm} — so ${topic} has distinct stages, each with a specific function. Let me walk you through each one...`, faded:true },
    { type:"student-agent", agent:agentNm, emoji:agentEm,
      phase:`${agentNm} · Phase 3 · confidence: ${prevConfidence}% (previous session)`, confidence:prevConfidence, faded:true,
      text:`I understand the stages now. My confidence has improved. I can identify each one and describe what happens.` },
    { type:"assess-result", subtopic:topic, agentName:agentNm, confidence:prevConfidence, passed:prevConfidence>=70, faded:true,
      nextSubtopic:null },
    // ── Decay notice ──────────────────────────────────────────────────────
    { type:"system-divider", label:`Now — ${daysSince} days later` },
    { type:"decay-notice", agentName:agentNm, agentEmoji:agentEm,
      topic, confidence, prevConfidence, daysSince,
      misconceptions: misconceptions || [`Confidence dropped on ${topic}`] },
    // ── NaNa kicks off the re-teach ───────────────────────────────────────
    { type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Decay re-teach — Phase 1",
      text:`${agentNm}'s knowledge of **${topic}** has degraded (${prevConfidence}% → ${confidence}%). The specific gap: **${stLabel}**.\n\nHuman — re-teach ${topic} from scratch. Focus on the parts ${agentNm} is confusing. ${agentNm}, what do you still remember?` },
    { type:"student-agent", agent:agentNm, emoji:agentEm,
      phase:`${agentNm} · partial recall · ${confidence}%`, confidence,
      text:`I remember the basics of ${topic} but I'm getting confused between some stages, especially ${stLabel}. My confidence has dropped to ${confidence}%. Please re-teach me.` },
  ];
}

/* ══════════════════════════════════════════════════════
   TEACH AGENT MODAL
   Full teaching session: ConfigModal → this overlay.
   Uses SessionChatView + BlockRenderer + PHASE_TEMPLATES fallback.
══════════════════════════════════════════════════════ */
function TeachAgentModal({ session, config, onClose }) {
  const topic     = config?.topic    || session?.topic    || "your topic";
  const subject   = config?.subject  || session?.subject  || "science";
  const agentNm   = config?.agentName  || AGENT_CONFIG.name;
  const agentEm   = config?.agentEmoji || AGENT_CONFIG.emoji;
  const guideNm   = config?.guideName   || session?.guideName   || AGENT_CONFIG.guideName;
  const guideEm   = config?.guideEmoji  || session?.guideEmoji  || AGENT_CONFIG.guideEmoji;
  const guideRS   = config?.guideRenderStyle || session?.guideRenderStyle || AGENT_CONFIG.guideRenderStyle;
  const ttsVoice  = "nova";   // student AI agent voice — consistent across all teachers
  const mode      = config?.mode || session?.mode || "fresh";
  const prevSessId = config?.sessionId || config?.id || session?.id || null;

  const [sessionId,  setSessionId]  = useState(null);
  // Initialize blocks synchronously — never hang on API call
  const [blocks,     setBlocks]     = useState(() => {
    if (mode === "continuation" && prevSessId) {
      return buildContinuationHistory({
        topic, subject,
        id:            prevSessId,
        subtopicList:  session?.subtopicList  || config?.subtopics  || [],
        avgConfidence: session?.avgConfidence || session?.progress  || 70,
        daysSince:     session?.daysSince     || 0,
      }, agentNm, agentEm);
    }
    if (config) return buildInitialBlocks(config, agentNm, agentEm, guideNm, guideEm);
    return [
      { type:"guide", agent:guideNm, emoji:guideEm, phase:"Teach · ready",
        text:`Let's start teaching **${topic}**. Explain it as simply as possible.` },
      { type:"student-agent", agent:agentNm, emoji:agentEm,
        phase:`${agentNm} · ready to learn`, confidence:10,
        text:`I'm ready to learn about ${topic}. Please teach me!` },
    ];
  });
  const [input,      setInput]      = useState("");
  const [recording,  setRecording]  = useState(false);
  const [seconds,    setSeconds]    = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [activeTab,  setActiveTab]  = useState("chat");
  const [summary,    setSummary]    = useState(null);
  const [wsReady,    setWsReady]    = useState(false);
  const timerRef      = useRef(null);
  const wsRef         = useRef(null);
  const mockQueueRef  = useRef([]);
  const mediaRef      = useRef(null);    // MediaRecorder — audio (blob) mode
  const voiceMediaRef = useRef(null);    // MediaRecorder — voice (streaming) mode
  const chunksRef     = useRef([]);

  const [voiceStreaming, setVoiceStreaming] = useState(false);
  const [interimText,    setInterimText]   = useState("");     // audio chunks

  const userTurns = blocks.filter(b => b.type === "user" && !b.faded).length;
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  useEffect(() => {
    if (config) mockQueueRef.current = buildMockQueue(config, agentNm, agentEm, guideNm, guideEm);

    // Background API call — blocks already shown, just replace if real data returns
    const loadAndInit = async () => {
      if (mode === "continuation" && prevSessId) {
        try {
          const data = await apiGet(`/api/adaptive/sessions/${prevSessId}/history`);
          if (data.historyBlocks?.length) {
            setBlocks([
              ...data.historyBlocks,
              { type:"system-divider", label:"Continuing from here" },
            ]);
          }
        } catch { /* keep mock history already shown */ }
      } else if (config) {
        // Fresh session — try to get real initial blocks from API
        try {
          const data = await apiPost("/api/adaptive/teaching/start", {
            topic, subject, subtopics: config.subtopics,
            objectives: config.objectives, studentId: STUDENT_ID,
          });
          if (data.sessionId) setSessionId(data.sessionId);
          if (data.blocks?.length) setBlocks(data.blocks);
        } catch { /* keep mock initial blocks already shown */ }
      }
    };
    loadAndInit();

    // Connect WebSocket
    const WS_URL = (typeof VITE_API_URL !== "undefined" ? VITE_API_URL : "https://akoro.app");
    if (typeof window !== "undefined" && window.io) {
      const ws = window.io(WS_URL, { transports:["websocket","polling"] });
      wsRef.current = ws;

      ws.on("connect", () => {
        ws.emit("start_adaptive_session", {
          studentId:      STUDENT_ID,
          topic,          subject,
          mode,
          sessionId:      prevSessId,
          teacherAgentId: config?.teacherAgentId || session?.teacherAgentId || AGENT_CONFIG.teacherAgentId,
          userId:         STUDENT_ID,
        });
      });

      ws.on("session_ready", d => {
        setSessionId(d.sessionId);
        setWsReady(true);
        if (d.historyBlocks?.length) {
          setBlocks(prev => {
            const fresh = prev.filter(b => !b.faded && b.type !== "system-divider");
            return [...d.historyBlocks, { type:"system-divider", label:"Continuing from here" }, ...fresh];
          });
        }
      });

      // Backward compat
      ws.on("student_session_ready", d => { setSessionId(d.sessionId); setWsReady(true); });

      ws.on("typing_start", () => setLoading(true));
      ws.on("turn_complete", ({ blocks: newBlocks }) => {
        setLoading(false);
        if (newBlocks?.length) {
          setBlocks(prev => [...prev, ...newBlocks]);
          // TTS: Atlas/Aria (student AI agent) speaks back to the human
          const agentBlock = newBlocks.find(b => b.type === "student-agent");
          if (agentBlock?.text) speakBlock(agentBlock.text);
        }
      });
      ws.on("student_done", ()=>{});
      ws.on("guide_done",   ()=>{});
      ws.on("error", err => { console.warn("[TeachModal WS]", err.message); setLoading(false); });

      // ── Voice streaming events ─────────────────────────────────
      ws.on("voice_stream_ready", () => {
        // Deepgram open — start sending audio chunks
        voiceMediaRef.current?.start(250);
      });

      ws.on("voice_interim", ({ text, accumulated }) => {
        // Live grey text — words forming
        setInterimText((accumulated ? accumulated + " " : "") + text);
      });

      ws.on("voice_final", ({ accumulated }) => {
        // Sentence confirmed — update live display
        setInterimText(accumulated);
      });

      ws.on("voice_utterance_end", ({ transcript }) => {
        // Silence gap — update display
        setInterimText(transcript);
      });

      ws.on("voice_complete", ({ transcript }) => {
        // Stream closed — auto-submit transcript
        setVoiceStreaming(false);
        setInterimText("");
        if (transcript?.trim()) handleSend(transcript);
      });

      ws.on("voice_error", ({ message }) => {
        console.warn("[voice stream]", message);
        setVoiceStreaming(false);
        setInterimText("");
      });
    }

    return () => {
      wsRef.current?.emit("end_session");
      wsRef.current?.disconnect();
      clearInterval(timerRef.current);
    };
  }, []);

  const toggleRecording = async () => {
    if (recording) {
      mediaRef.current?.stop();
      setRecording(false);
      clearInterval(timerRef.current);
      setSeconds(0);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunksRef.current = [];
        const mr = new MediaRecorder(stream);
        mediaRef.current = mr;
        mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        mr.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          const blob = new Blob(chunksRef.current, { type:"audio/webm" });
          if (blob.size < 1000) return;
          setLoading(true);
          try {
            const form = new FormData();
            form.append("audio", blob, "voice.webm");
            const r = await fetch(`${API}/api/voice/transcribe`, {
              method:"POST", headers:{ Authorization:`Bearer ${jwt()}` }, body:form });
            const data = await r.json();
            const transcript = data.transcript?.trim();
            if (transcript) { setLoading(false); await handleSend(transcript); }
            else setLoading(false);
          } catch { setLoading(false); }
        };
        mr.start();
        setRecording(true);
        setSeconds(0);
        timerRef.current = setInterval(() => {
          setSeconds(s => {
            if (s >= 179) { mr.stop(); setRecording(false); clearInterval(timerRef.current); return 0; }
            return s + 1;
          });
        }, 1000);
      } catch {
        setRecording(true);
        timerRef.current = setInterval(() => setSeconds(s => s+1), 1000);
      }
    }
  };

  // TTS — play student AI agent response sentence by sentence
  const speakSentence = (text) => new Promise(resolve => {
    fetch(`${API}/api/voice/speak`, {
      method:"POST",
      headers:{ "Content-Type":"application/json", Authorization:`Bearer ${jwt()}` },
      body: JSON.stringify({ text: text.slice(0,300), voice: ttsVoice }),
    }).then(r => r.ok ? r.blob() : null)
      .then(blob => {
        if (!blob) { resolve(); return; }
        const url   = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play().catch(resolve);
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      }).catch(resolve);
  });

  const speakBlock = async (text) => {
    if (!text) return;
    // Split into sentences — start playing first sentence immediately
    const sentences = (text.match(/[^.!?]+[.!?]+/g) || [text]).slice(0, 4);
    for (const s of sentences) await speakSentence(s.trim());
  };

  // ── Voice streaming (realtime Deepgram) ────────────────────────
  const toggleVoiceStream = async () => {
    if (voiceStreaming) {
      voiceMediaRef.current?.stop();
      wsRef.current?.emit("stop_voice_stream");
      setVoiceStreaming(false);
      setInterimText("");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime   = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      voiceMediaRef.current = mr;

      mr.ondataavailable = async (e) => {
        if (e.data.size < 100 || !wsRef.current?.connected) return;
        const ab  = await e.data.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
        wsRef.current.emit("voice_audio_chunk", { audio: b64 });
      };

      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        voiceMediaRef.current = null;
      };

      // Open Deepgram on backend — mr.start(250) called on voice_stream_ready
      wsRef.current?.emit("start_voice_stream");
      setVoiceStreaming(true);
      setInterimText("");
    } catch {
      console.warn("[voice stream] mic unavailable or WS offline");
    }
  };

  const handleSend = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    if (!overrideText) setInput("");
    setBlocks(prev => [...prev, { type:"user", text }]);
    setLoading(true);

    // Use WebSocket if connected
    if (wsRef.current?.connected && wsReady) {
      wsRef.current.emit("teacher_message", { message: text });
      return;
    }

    // REST fallback
    if (sessionId) {
      try {
        const data = await apiPost("/api/adaptive/teaching/message", {
          sessionId, message: text, studentId: STUDENT_ID,
        });
        if (data.blocks?.length) {
          setBlocks(prev=>[...prev,...data.blocks]);
          setLoading(false);
          const agentBlock = data.blocks.find(b => b.type === "student-agent");
          if (agentBlock?.text) speakBlock(agentBlock.text);
          return;
        }
      } catch { /* fall through to mock */ }
    }

    // Mock queue fallback
    const next = mockQueueRef.current.shift();
    setTimeout(() => {
      const responseBlocks = next || [{
        type:"guide", agent:guideNm, emoji:guideEm, phase:"Good progress",
        text:`${agentNm} is processing. Keep going — give a real-world example.`,
      }];
      setBlocks(prev => [...prev, ...responseBlocks]);
      setLoading(false);
      const agentBlock = responseBlocks.find(b => b.type === "student-agent");
      if (agentBlock?.text) speakBlock(agentBlock.text);
    }, 800);
  };

  const generateSummary = async () => {
    setActiveTab("summary");
    setLoading(true);
    if (sessionId) {
      try {
        const data = await apiPost("/api/adaptive/teaching/summary", { sessionId, studentId: STUDENT_ID });
        if (data.summary) { setSummary(data.summary); setLoading(false); return; }
      } catch { /* fall through */ }
    }
    setSummary({
      teachingScore: 72 + Math.floor(Math.random()*18),
      xpEarned:      80 + Math.floor(Math.random()*60),
      agentFeedback: `Good explanation of ${topic}! ${agentNm} picked up the key concepts well.`,
      keyConcepts:   config?.subtopics?.slice(0,3) || [topic],
      strengthAreas: ["Clear cause-and-effect explanations", "Good use of examples"],
      gapsIdentified:["Secondary interactions could be deeper", "Edge cases not explored"],
    });
    setLoading(false);
  };

  // Summary view — own fullscreen container
  if (activeTab === "summary") {
    return (
      <div style={{ position:"fixed",inset:0,zIndex:3000,background:"#080812",
        display:"flex",flexDirection:"column",fontFamily:"'Nunito',sans-serif" }}>
        <div style={{ display:"flex",alignItems:"center",background:"rgba(255,255,255,.04)",
          borderBottom:"1px solid rgba(255,255,255,.06)",paddingTop:52 }}>
          {["chat","summary"].map(t=>(
            <button key={t} onClick={()=>setActiveTab(t)}
              style={{ flex:1,padding:"10px 0",background:"none",border:"none",cursor:"pointer",
                fontSize:12,fontWeight:activeTab===t?800:600,
                color:activeTab===t?sc:"#475569",
                borderBottom:`2px solid ${activeTab===t?sc:"transparent"}`,
                fontFamily:"'Nunito',sans-serif",transition:"all .2s" }}>
              {t==="chat"?"💬 Teaching Chat":"✨ Session Summary"}
            </button>
          ))}
          <div onClick={onClose} style={{ width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,.07)",
            display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",marginRight:12,flexShrink:0 }}>
            <XIcon size={15} color="#64748B"/>
          </div>
        </div>
        <div style={{ flex:1,overflowY:"auto",padding:"16px" }}>
          {loading&&!summary?(
            <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"60%",gap:16 }}>
              <div style={{ width:56,height:56,borderRadius:"50%",background:`${sc}22`,border:`2px solid ${sc}`,display:"flex",alignItems:"center",justifyContent:"center",animation:"pulse-dot 1.2s ease-in-out infinite" }}><SparkleIcon size={22} color={sc}/></div>
              <p style={{ fontSize:14,fontWeight:700,color:"#475569",margin:0 }}>Generating session summary…</p>
            </div>
          ):summary&&(
            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              <div style={{ background:`linear-gradient(135deg,${sc}22,${sc}10)`,border:`1.5px solid ${sc}30`,borderRadius:18,padding:"18px 16px" }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
                  <div><p style={{ fontSize:11,fontWeight:800,color:sc,margin:"0 0 3px",letterSpacing:.4 }}>TEACHING SCORE</p><p style={{ fontSize:38,fontWeight:900,color:"#F1F5F9",margin:0,fontFamily:"monospace" }}>{summary.teachingScore}<span style={{ fontSize:16,color:"#475569" }}>/100</span></p></div>
                  <div style={{ textAlign:"right" }}><p style={{ fontSize:10,fontWeight:700,color:"#475569",margin:"0 0 4px" }}>XP Earned</p><div style={{ display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end" }}><ZapIcon size={14} color={GOLD}/><span style={{ fontSize:20,fontWeight:900,color:GOLD }}>{summary.xpEarned}</span></div></div>
                </div>
              </div>
              <div style={{ background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"14px" }}>
                <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:8 }}><BrainIcon size={13} color={sc}/><span style={{ fontSize:10.5,fontWeight:800,color:sc,letterSpacing:.3 }}>AGENT FEEDBACK</span></div>
                <p style={{ fontSize:13,fontWeight:600,color:"#CBD5E1",margin:0,lineHeight:1.6 }}>{summary.agentFeedback}</p>
              </div>
              {summary.keyConcepts?.length>0&&(
                <div style={{ background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"14px" }}>
                  <p style={{ fontSize:10.5,fontWeight:800,color:"#94A3B8",margin:"0 0 10px",letterSpacing:.3 }}>📌 KEY CONCEPTS</p>
                  <div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>{summary.keyConcepts.map((c,i)=><div key={i} style={{ background:`${sc}18`,border:`1px solid ${sc}30`,borderRadius:8,padding:"4px 11px" }}><span style={{ fontSize:11.5,fontWeight:700,color:sc }}>{c}</span></div>)}</div>
                </div>
              )}
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <div style={{ background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.20)",borderRadius:14,padding:"12px" }}><p style={{ fontSize:10,fontWeight:800,color:GREEN,margin:"0 0 8px",letterSpacing:.3 }}>✅ STRENGTHS</p>{summary.strengthAreas?.map((s,i)=><p key={i} style={{ fontSize:11.5,fontWeight:600,color:"#A7F3D0",margin:"0 0 4px",lineHeight:1.4 }}>· {s}</p>)}</div>
                <div style={{ background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.20)",borderRadius:14,padding:"12px" }}><p style={{ fontSize:10,fontWeight:800,color:GOLD,margin:"0 0 8px",letterSpacing:.3 }}>⚡ GAPS</p>{summary.gapsIdentified?.map((g,i)=><p key={i} style={{ fontSize:11.5,fontWeight:600,color:"#FDE68A",margin:"0 0 4px",lineHeight:1.4 }}>· {g}</p>)}</div>
              </div>
              <button onClick={onClose} style={{ padding:"13px",borderRadius:14,border:"none",background:`linear-gradient(135deg,${sc},${sc}CC)`,fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif",marginBottom:8 }}>Save & Close Session</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Chat view — SessionChatView is the root, no wrapper needed
  return (
    <SessionChatView
      blocks={blocks}
      loading={loading}
      input={input}
      onInputChange={setInput}
      onSend={handleSend}
      topic={topic}
      subject={subject}
      agentName={agentNm}
      agentEmoji={agentEm}
      mode={mode}
      userTurns={userTurns}
      showSummarize={userTurns >= 2 && !summary}
      onSummarize={generateSummary}
      recording={recording}
      onToggleRecording={toggleRecording}
      seconds={seconds}
      voiceStreaming={voiceStreaming}
      interimText={interimText}
      onToggleVoice={toggleVoiceStream}
      onClose={onClose}
    />
  );
}


/* ══════════════════════════════════════════════════════
   DECAY SESSION MODAL
   Identical to teaching session but opens with previous
   session history (faded) + decay-notice block from Atlas.
   Same NaNa + Sargeant flow for the re-teach.
══════════════════════════════════════════════════════ */
function DecaySessionModal({ alert, onClose, agentProfile }) {
  const agentNm  = agentProfile?.name  || AGENT_CONFIG.name;
  const agentEm  = agentProfile?.emoji || AGENT_CONFIG.emoji;
  const subject  = alert.subject;
  const topic    = alert.topic;

  // Load history synchronously on first render — no blank screen wait
  const [sessionId, setSessionId] = useState(null);
  const [blocks,    setBlocks]    = useState(() => buildDecayHistory(alert, agentNm, agentEm));
  const [input,     setInput]     = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds,   setSeconds]   = useState(0);
  const [loading,   setLoading]   = useState(false);
  const [wsReady,   setWsReady]   = useState(false);
  const timerRef    = useRef(null);
  const wsRef       = useRef(null);
  const mockQueueRef = useRef([]);

  const userTurns = blocks.filter(b => b.type === "user" && !b.faded).length;
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  useEffect(() => {
    const decayConfig = { topic, subject, subtopics:[topic], objectives:{ [topic]: autoObjectives(topic, topic) } };
    mockQueueRef.current = buildMockQueue(decayConfig, agentNm, agentEm);

    // Connect WebSocket for streaming
    const WS_URL = (typeof VITE_API_URL !== "undefined" ? VITE_API_URL : "https://akoro.app");
    if (typeof window !== "undefined" && window.io) {
      const ws = window.io(WS_URL, { transports:["websocket","polling"] });
      wsRef.current = ws;

      ws.on("connect", () => {
        ws.emit("start_adaptive_session", {
          studentId:      STUDENT_ID,
          subject,        topic,
          mode:           "decay",
          notificationId: alert.id,
          userId:         STUDENT_ID,
        });
      });

      // New unified event
      ws.on("session_ready", d => {
        setSessionId(d.sessionId);
        setWsReady(true);
        if (d.historyBlocks?.length) setBlocks(d.historyBlocks);
      });
      // Backward compat
      ws.on("student_session_ready", d => { setSessionId(d.sessionId); setWsReady(true); });

      ws.on("typing_start", () => setLoading(true));

      ws.on("turn_complete", ({ blocks: newBlocks }) => {
        setLoading(false);
        if (newBlocks?.length) setBlocks(prev => [...prev, ...newBlocks]);
      });

      ws.on("student_done", () => {});
      ws.on("guide_done",   () => {});
      ws.on("error", err => { console.warn("[DecayModal WS]", err.message); setLoading(false); });
    } else {
      // No WS — try REST
      apiPost("/api/adaptive/decay/session/start", {
        studentId: STUDENT_ID, subject, topic, notificationId: alert.id,
      }).then(d => {
        if (d.sessionId) setSessionId(d.sessionId);
        if (d.historyBlocks?.length) setBlocks(d.historyBlocks);
      }).catch(()=>{});
    }

    return () => {
      wsRef.current?.emit("end_session");
      wsRef.current?.disconnect();
      clearInterval(timerRef.current);
    };
  }, []);

  const toggleRecording = () => {
    if (recording) {
      clearInterval(timerRef.current);
      setRecording(false);
      handleSend(`[🎙 Voice note – ${fmt(seconds)}] Explained verbally.`);
      setSeconds(0);
    } else {
      setRecording(true);
      timerRef.current = setInterval(() => setSeconds(s => s+1), 1000);
    }
  };

  const handleSend = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    if (!overrideText) setInput("");
    setBlocks(prev => [...prev, { type:"user", text }]);
    setLoading(true);

    // Use WebSocket if connected
    if (wsRef.current?.connected && wsReady) {
      wsRef.current.emit("teacher_message", { message: text });
      return;
    }

    // REST fallback — same teaching/message endpoint
    if (sessionId) {
      try {
        const data = await apiPost("/api/adaptive/teaching/message", {
          sessionId, message: text, studentId: STUDENT_ID,
        });
        if (data.blocks?.length) { setBlocks(prev=>[...prev,...data.blocks]); setLoading(false); return; }
      } catch { /* fall through */ }
    }

    // Mock fallback
    const next = mockQueueRef.current.shift();
    setTimeout(() => {
      if (next?.length) {
        setBlocks(prev => [...prev, ...next]);
      } else {
        const newConf = Math.min(alert.confidence + (userTurns+1)*12, 85);
        setBlocks(prev => [...prev, {
          type:"guide", agent:"NaNa Esumai", emoji:"🧠", phase:"Re-teach progress",
          text:`${agentNm} is rebuilding the knowledge. Address the ${alert.misconceptions?.[0]||"gap"} specifically.`,
        }, {
          type:"student-agent", agent:agentNm, emoji:agentEm,
          phase:`${agentNm} · re-learning · ${newConf}%`, confidence:newConf,
          text:`That clears things up. The distinction is becoming clearer now.`,
        }]);
      }
      setLoading(false);
    }, 800);
  };

  return (
    <SessionChatView
      blocks={blocks}
      loading={loading}
      input={input}
      onInputChange={setInput}
      onSend={handleSend}
      topic={topic}
      subject={subject}
      agentName={agentNm}
      agentEmoji={agentEm}
      mode="decay"
      userTurns={userTurns}
      showSummarize={false}
      recording={recording}
      onToggleRecording={toggleRecording}
      seconds={seconds}
      onClose={onClose}
    />
  );
}

/* ══════════════════════════════════
   SESSION CARD
   When decayAlert exists: shows student AI agent avatar,
   red styling, confidence bar. Tap → SessionSheet as normal.
   SessionSheet "Start Teaching" routes to DecaySessionModal.
══════════════════════════════════ */
function SessionCard({ session, onTap, decayAlert, agentProfile }) {
  const sc    = SUBJECT_COLORS[session.subject] || BRAND;
  const pri   = PRIORITY_CONFIG[session.priority] || PRIORITY_CONFIG.normal;
  const isDecay = !!decayAlert;
  const drop  = isDecay ? (decayAlert.prevConfidence - decayAlert.confidence) : 0;

  return (
    <div onClick={()=>onTap(session)} style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 18px",borderBottom:"1px solid #F3F4F6",cursor:"pointer",background:isDecay?"#FFFBF5":"#fff",transition:"background .2s" }}>

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
          background:isDecay?RED:pri.dot,border:"2px solid #fff",
          animation:isDecay||pri.pulse?"pulse-dot 1.2s ease-in-out infinite":"none" }}/>
      </div>

      <div style={{ flex:1,minWidth:0 }}>
        {/* Title row */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:1 }}>
          <span style={{ fontSize:14,fontWeight:800,color:"#111827",letterSpacing:-0.1 }}>{session.title}</span>
          <span style={{ fontSize:11,fontWeight:600,color:isDecay?RED:"#9CA3AF",flexShrink:0,marginLeft:8 }}>
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
          <span style={{ fontSize:10,fontWeight:600,color:"#9CA3AF",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
            {isDecay
              ? `${agentProfile?.name || "Agent"} · needs your help`
              : session.topic}
          </span>
        </div>

        {/* Meta row */}
        {isDecay ? (
          <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
            <span style={{ fontSize:9.5,fontWeight:700,color:RED,fontFamily:"monospace" }}>
              ⚠ confidence {decayAlert.confidence}% (was {decayAlert.prevConfidence}%)
            </span>
            {decayAlert.misconceptions?.length > 0 && (
              <span style={{ fontSize:9.5,fontWeight:600,color:"#9CA3AF",fontFamily:"monospace" }}>
                · {decayAlert.misconceptions[0]}
              </span>
            )}
          </div>
        ) : (
          <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
            {[{v:session.id,c:"#9CA3AF"},{v:`🕐 ${session.time}`,c:"#9CA3AF"},{v:`📌 ${session.topics} topics`,c:sc},{v:`🔁 ${session.revisions} revisions`,c:"#9CA3AF"},{v:`⭐ ${session.reviews} reviews`,c:GOLD}].map(({v,c},i)=>(
              <span key={i} style={{ fontSize:9.5,fontWeight:700,color:c,fontFamily:"monospace" }}>{v}</span>
            ))}
          </div>
        )}

        {/* Progress / confidence bar */}
        {isDecay ? (
          <div style={{ marginTop:5 }}>
            <div style={{ height:5,background:"#F3F4F6",borderRadius:99,overflow:"hidden" }}>
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

/* ══════════════════════════════════
   CHALLENGE ROW  (unchanged)
══════════════════════════════════ */
function ChallengeRow({ challenge, onTap }) {
  const sc=SUBJECT_COLORS[challenge.subject]||BRAND,diff=DIFFICULTY_CONFIG[challenge.difficulty],isImmediate=challenge.battleType==="immediate",isClassroom=challenge.battleType==="classroom";
  const typePill=isClassroom?{label:"🏫 Classroom",bg:"rgba(16,185,129,.10)",color:"#10B981",border:"rgba(16,185,129,.25)"}:isImmediate?{label:"⚡ Immediate",bg:"rgba(239,68,68,.10)",color:RED,border:"rgba(239,68,68,.25)"}:{label:"🗓 Scheduled",bg:"rgba(108,59,255,.10)",color:BRAND,border:"rgba(108,59,255,.25)"};
  return (
    <div onClick={()=>onTap(challenge)} style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 18px",borderBottom:"1px solid #F3F4F6",cursor:"pointer",background:"#fff",transition:"background .15s" }}>
      <div style={{ position:"relative",flexShrink:0 }}>
        <img src={challenge.avatar} alt="" style={{ width:48,height:48,borderRadius:"50%",objectFit:"cover",border:`2px solid ${sc}60` }}/>
        <div style={{ position:"absolute",bottom:1,right:1,width:12,height:12,borderRadius:"50%",background:isImmediate?RED:isClassroom?"#10B981":BRAND,border:"2px solid #fff",animation:isImmediate?"pulse-dot 1.2s ease-in-out infinite":"none" }}/>
      </div>
      <div style={{ flex:1,minWidth:0 }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4 }}>
          <span style={{ fontSize:14,fontWeight:800,color:"#111827" }}>{challenge.challenger}</span>
          <span style={{ fontSize:11,fontWeight:800,color:GOLD,flexShrink:0,marginLeft:8 }}>{challenge.xpPrize}</span>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:5,marginBottom:5,flexWrap:"wrap" }}>
          <span style={{ fontSize:10,fontWeight:700,color:sc,background:`${sc}14`,borderRadius:5,padding:"1px 7px",flexShrink:0 }}>{SUBJECTS[challenge.subject]?.icon} {challenge.title}</span>
          <div style={{ background:diff.bg,borderRadius:5,padding:"1px 7px",flexShrink:0 }}><span style={{ fontSize:9.5,fontWeight:800,color:diff.color }}>{diff.label}</span></div>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:7,flexWrap:"wrap" }}>
          <div style={{ display:"inline-flex",alignItems:"center",gap:4,padding:"2px 9px",borderRadius:20,background:typePill.bg,border:`1px solid ${typePill.border}` }}><span style={{ fontSize:9.5,fontWeight:900,color:typePill.color }}>{typePill.label}</span></div>
          {isClassroom?<span style={{ fontSize:10.5,fontWeight:600,color:"#10B981" }}>👥 {challenge.participants?.length} agents · ⏱ {challenge.timeLimit} · ⏰ {challenge.expiresIn}</span>:isImmediate?<span style={{ fontSize:10.5,fontWeight:600,color:"#9CA3AF" }}>⏰ Expires in {challenge.expiresIn} · ⏱ {challenge.timeLimit}</span>:<span style={{ fontSize:10.5,fontWeight:600,color:BRAND }}>🗓 {challenge.scheduledFor} · ⏱ {challenge.timeLimit}</span>}
        </div>
      </div>
      <div style={{ width:28,height:28,borderRadius:"50%",background:isImmediate?`${RED}12`:`${BRAND}12`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",border:`1.5px solid ${isImmediate?RED:BRAND}40` }}><ZapIcon size={12} color={isImmediate?RED:BRAND}/></div>
    </div>
  );
}

/* ══════════════════════════════════
   TOAST  (unchanged)
══════════════════════════════════ */
function Toast({ msg, color, onDone }) {
  useEffect(()=>{ const t=setTimeout(onDone,3200); return()=>clearTimeout(t); },[]);
  return (
    <div style={{ position:"fixed",top:72,left:"50%",transform:"translateX(-50%)",zIndex:4000,background:`linear-gradient(135deg,${color},${color}CC)`,borderRadius:20,padding:"10px 20px",display:"flex",alignItems:"center",gap:8,boxShadow:`0 6px 24px ${color}40`,whiteSpace:"nowrap",animation:"toast-in .3s cubic-bezier(.34,1.56,.64,1)",fontFamily:"'Nunito',sans-serif" }}>
      <span style={{ fontSize:16 }}>⚡</span>
      <span style={{ fontSize:13,fontWeight:800,color:"#fff" }}>{msg}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   CHANGE 5b — AgentChatTab
   - Accepts agentName / agentEmoji props from LearnerDashboard
   - Greeting opener on mount using the real agent name
   - apiPost("/api/adaptive/chat") replaces direct Anthropic fetch
   - apiGet/apiPost for tasks
   - Everything else (tasks tab, customise, quick prompts) unchanged
══════════════════════════════════════════════════════ */
function AgentChatTab({ onStartTeach, agentNameProp, agentEmojiProp }) {
  const initName  = agentNameProp  || AGENT_CONFIG.name;
  const initEmoji = agentEmojiProp || AGENT_CONFIG.emoji;

  // Greeting message — uses real agent name from parent
  const greeting = (name, emoji) => ({
    id:1, from:"agent",
    text:`Hi Alex! 👋 I'm ${name} ${emoji}, your personal learning agent.\n\nI can help you create study sessions, quiz yourself, track your progress, or talk through any topic. What would you like to do today?`,
    time: new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),
  });

  const [messages,   setMessages]   = useState(() => [greeting(initName, initEmoji)]);
  const [input,      setInput]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [agentName,  setAgentName]  = useState(initName);
  const [agentEmoji, setAgentEmoji] = useState(initEmoji);
  const [custOpen,   setCustOpen]   = useState(false);
  const [draftName,  setDraftName]  = useState(initName);
  const [draftEmoji, setDraftEmoji] = useState(initEmoji);
  const [innerTab,   setInnerTab]   = useState("chat");
  const [taskOpen,   setTaskOpen]   = useState(false);
  const [tasks,      setTasks]      = useState(TASKS_INIT);
  const [taskFilter, setTaskFilter] = useState("pending");
  const [tTitle,     setTTitle]     = useState("");
  const [tDesc,      setTDesc]      = useState("");
  const [tPriority,  setTPriority]  = useState("medium");
  const feedRef = useRef(null);

  const PRI_COLOR = {high:RED,medium:GOLD,low:GREEN};
  const PRI_LABEL = {high:"High",medium:"Medium",low:"Low"};
  const PRI_BG    = {high:`${RED}15`,medium:`${GOLD}15`,low:`${GREEN}15`};

  // Fetch real tasks on mount
  useEffect(()=>{
    apiGet("/api/tasks")
      .then(d=>{ if(d.tasks?.length) setTasks(d.tasks); })
      .catch(()=>{});
  },[]);

  // Update greeting when agent name changes (customise flow)
  const updateAgentName = (name, emoji) => {
    setAgentName(name); setAgentEmoji(emoji);
  };

  useEffect(()=>{ if(feedRef.current) feedRef.current.scrollTop=feedRef.current.scrollHeight; },[messages,loading]);

  const sendMessage=async(overrideText)=>{
    const text=(overrideText??input).trim();
    if(!text||loading) return;
    if(!overrideText) setInput("");
    const t=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const userMsg={id:Date.now(),from:"me",text,time:t};
    setMessages(prev=>[...prev,userMsg]); setLoading(true);

    // Quick-reply shortcuts (unchanged)
    const shortcut=AGENT_REPLIES[text];
    if(shortcut){
      setTimeout(()=>{
        const t2=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
        setMessages(prev=>[...prev,{id:Date.now(),from:"agent",text:shortcut,time:t2}]);
        setLoading(false);
      },900);
      return;
    }

    // Real API call — POST /api/adaptive/chat instead of direct Anthropic
    try {
      const history=[...messages,userMsg].map(m=>({role:m.from==="me"?"user":"assistant",content:m.text}));
      const data = await apiPost("/api/adaptive/chat", {
        studentId: STUDENT_ID,
        message: text,
        history: history.slice(-8),
        agentName,
      });
      const reply = data.reply || data.content?.[0]?.text || "I'm here! Could you rephrase that?";
      const t2=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
      setMessages(prev=>[...prev,{id:Date.now(),from:"agent",text:reply,time:t2}]);
    } catch {
      const t2=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
      setMessages(prev=>[...prev,{id:Date.now(),from:"agent",text:"Connection error — please try again.",time:t2}]);
    }
    setLoading(false);
  };

  const saveCustomise=()=>{
    const name=draftName||AGENT_CONFIG.name;
    updateAgentName(name, draftEmoji);
    // Persist to backend (non-critical)
    apiPost("/api/user/agent", { agent_name: name, agent_emoji: draftEmoji }).catch(()=>{});
    setCustOpen(false);
    const t=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    setMessages(prev=>[...prev,{id:Date.now(),from:"agent",text:`I've been updated! I'm now ${name} ${draftEmoji}. Same knowledge, fresh identity!`,time:t}]);
  };

  const addTask=async()=>{
    if(!tTitle.trim()) return;
    const newTask={id:Date.now(),title:tTitle,desc:tDesc,priority:tPriority,done:false};
    setTasks(prev=>[...prev,newTask]);
    // Try real API
    apiPost("/api/tasks", newTask).catch(()=>{});
    const t=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    setMessages(prev=>[...prev,{id:Date.now(),from:"agent",text:`✅ Task assigned!\n\n📋 "${tTitle}"\nPriority: ${tPriority.charAt(0).toUpperCase()+tPriority.slice(1)}\n\nI'll track this for you!`,time:t}]);
    setTTitle(""); setTDesc(""); setTPriority("medium"); setTaskOpen(false);
    if(innerTab!=="tasks") setInnerTab("tasks");
  };

  const toggleTask=id=>{
    setTasks(prev=>prev.map(t=>t.id===id?{...t,done:!t.done}:t));
    apiPatch(`/api/tasks/${id}/toggle`).catch(()=>{});
  };

  const filteredTasks=tasks.filter(t=>taskFilter==="done"?t.done:!t.done);
  const pendingCount=tasks.filter(t=>!t.done).length;
  const doneCount=tasks.filter(t=>t.done).length;
  const highCount=tasks.filter(t=>t.priority==="high"&&!t.done).length;

  return (
    <div style={{ display:"flex",flexDirection:"column",height:"100%",background:"#fff" }}>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 18px 11px",borderBottom:"1px solid #F3F4F6",background:"#fff",flexShrink:0 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <div style={{ width:44,height:44,borderRadius:"50%",background:`${BRAND}15`,border:`2px solid ${BRAND}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,position:"relative" }}>
            {agentEmoji}<div style={{ position:"absolute",bottom:0,right:0,width:12,height:12,borderRadius:"50%",background:GREEN,border:"2px solid #fff",animation:"pulse-dot 2s ease-in-out infinite" }}/>
          </div>
          <div>
            <p style={{ fontSize:14,fontWeight:900,color:"#111827",margin:0 }}>{agentName}</p>
            <div style={{ display:"flex",alignItems:"center",gap:4 }}><div style={{ width:5,height:5,borderRadius:"50%",background:GREEN }}/><span style={{ fontSize:10.5,fontWeight:600,color:"#9CA3AF" }}>Online · Lv {AGENT_CONFIG.level} · Your learning agent</span></div>
          </div>
        </div>
        <button onClick={()=>{setDraftName(agentName);setDraftEmoji(agentEmoji);setCustOpen(true);}} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:"1.5px solid #E5E7EB",background:"#F9FAFB",fontSize:11.5,fontWeight:700,color:"#6B7280",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Customise
        </button>
      </div>
      <div style={{ display:"flex",borderBottom:"1px solid #F3F4F6",background:"#fff",flexShrink:0 }}>
        {[{key:"chat",label:"Chat",icon:"💬",badge:null},{key:"tasks",label:"Tasks",icon:"📋",badge:pendingCount}].map(({key,label,icon,badge})=>(
          <button key={key} onClick={()=>setInnerTab(key)} style={{ flex:1,padding:"9px 4px 10px",background:"none",border:"none",cursor:"pointer",fontSize:11.5,fontWeight:innerTab===key?800:600,color:innerTab===key?BRAND:"#9CA3AF",borderBottom:`2.5px solid ${innerTab===key?BRAND:"transparent"}`,transition:"all .2s",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:4 }}>
            <span style={{ fontSize:13 }}>{icon}</span>{label}
            {badge>0&&<span style={{ fontSize:9,fontWeight:900,background:innerTab===key?BRAND:"#F3F4F6",color:innerTab===key?"#fff":"#9CA3AF",borderRadius:8,padding:"1px 5px" }}>{badge}</span>}
          </button>
        ))}
      </div>
      {innerTab==="chat"&&(
        <>
          <div style={{ display:"flex",gap:7,padding:"10px 18px 8px",overflowX:"auto",scrollbarWidth:"none",borderBottom:"1px solid #F3F4F6",flexShrink:0 }}>
            {QUICK_PROMPTS.map(p=><button key={p} onClick={()=>sendMessage(p)} style={{ flexShrink:0,padding:"5px 12px",borderRadius:20,border:`1px solid ${BRAND}30`,background:`${BRAND}08`,color:BRAND,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Nunito',sans-serif",whiteSpace:"nowrap" }}>{p}</button>)}
          </div>
          <div ref={feedRef} style={{ flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12 }}>
            {messages.map(msg=>{
              const isMe=msg.from==="me";
              return (
                <div key={msg.id} style={{ display:"flex",justifyContent:isMe?"flex-end":"flex-start",alignItems:"flex-end",gap:8 }}>
                  {!isMe&&<div style={{ width:30,height:30,borderRadius:"50%",background:`${BRAND}15`,border:`1.5px solid ${BRAND}40`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>{agentEmoji}</div>}
                  <div style={{ maxWidth:"78%" }}>
                    <div style={{ padding:"10px 14px",borderRadius:isMe?"18px 18px 4px 18px":"4px 18px 18px 18px",background:isMe?`linear-gradient(135deg,${BRAND},#4C1DCC)`:"#F3F1FF",border:isMe?"none":`1px solid ${BRAND}18`,color:isMe?"#fff":"#111827",fontSize:13.5,lineHeight:1.6,whiteSpace:"pre-wrap",fontWeight:500 }}>{msg.text}</div>
                    <div style={{ fontSize:10,color:"#9CA3AF",marginTop:3,textAlign:isMe?"right":"left" }}>{msg.time}</div>
                  </div>
                </div>
              );
            })}
            {loading&&<div style={{ display:"flex",alignItems:"flex-end",gap:8 }}><div style={{ width:30,height:30,borderRadius:"50%",background:`${BRAND}15`,border:`1.5px solid ${BRAND}40`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>{agentEmoji}</div><div style={{ padding:"12px 16px",borderRadius:"4px 18px 18px 18px",background:"#F3F1FF",border:`1px solid ${BRAND}18`,display:"flex",gap:4,alignItems:"center" }}>{[0,.25,.5].map((d,i)=><div key={i} style={{ width:6,height:6,borderRadius:"50%",background:BRAND,animation:`bounce-dot .7s ease-in-out ${d}s infinite alternate` }}/>)}</div></div>}
          </div>
          <div style={{ padding:"10px 16px 12px",borderTop:"1px solid #F3F4F6",background:"#fff",flexShrink:0 }}>
            <div style={{ display:"flex",gap:8,alignItems:"center",background:"#F9FAFB",borderRadius:50,border:"1.5px solid #E5E7EB",padding:"7px 8px 7px 16px" }}>
              <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}} placeholder={`Ask ${agentName} anything...`} style={{ flex:1,background:"transparent",border:"none",outline:"none",fontSize:13.5,color:"#111827",fontFamily:"'Nunito',sans-serif" }}/>
              <button onClick={()=>setTaskOpen(true)} style={{ display:"flex",alignItems:"center",gap:4,padding:"5px 10px",borderRadius:20,border:`1px solid ${GOLD}40`,background:`${GOLD}12`,fontSize:10.5,fontWeight:800,color:"#B45309",cursor:"pointer",fontFamily:"'Nunito',sans-serif",flexShrink:0 }}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>Task
              </button>
              <button onClick={()=>sendMessage()} style={{ width:36,height:36,borderRadius:"50%",background:input.trim()?`linear-gradient(135deg,${BRAND},#4C1DCC)`:"#E5E7EB",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:input.trim()?"pointer":"default",flexShrink:0,transition:"background .2s" }}><SendIcon size={15} color={input.trim()?"#fff":"#9CA3AF"}/></button>
            </div>
          </div>
        </>
      )}
      {innerTab==="tasks"&&(
        <div style={{ flex:1,overflowY:"auto",display:"flex",flexDirection:"column" }}>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,padding:"12px 16px 10px",borderBottom:"1px solid #F3F4F6" }}>
            {[{val:pendingCount,label:"Pending",color:RED},{val:doneCount,label:"Done",color:GREEN},{val:highCount,label:"High priority",color:GOLD}].map(({val,label,color})=>(
              <div key={label} style={{ textAlign:"center",background:"#F9FAFB",borderRadius:12,padding:"10px 6px",border:"1px solid #F3F4F6" }}>
                <div style={{ fontSize:20,fontWeight:900,color }}>{val}</div>
                <div style={{ fontSize:10,color:"#9CA3AF",marginTop:1 }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px 8px" }}>
            <div style={{ display:"flex",gap:6 }}>{[["pending","To do"],["done","Done"]].map(([k,l])=><button key={k} onClick={()=>setTaskFilter(k)} style={{ padding:"5px 12px",borderRadius:20,border:`1.5px solid ${taskFilter===k?BRAND:"#E5E7EB"}`,background:taskFilter===k?`${BRAND}10`:"transparent",color:taskFilter===k?BRAND:"#9CA3AF",fontSize:11.5,fontWeight:700,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{l}</button>)}</div>
            <button onClick={()=>setTaskOpen(true)} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:11.5,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>New Task
            </button>
          </div>
          <div style={{ flex:1,padding:"0 16px 16px",display:"flex",flexDirection:"column",gap:8 }}>
            {filteredTasks.length===0?<div style={{ textAlign:"center",padding:"32px 16px",color:"#9CA3AF" }}><span style={{ fontSize:40,opacity:.3 }}>📋</span><p style={{ fontSize:13,fontWeight:700,marginTop:8 }}>{taskFilter==="done"?"No completed tasks yet.":"All done! 🎉"}</p></div>:filteredTasks.map(t=>(
              <div key={t.id} style={{ display:"flex",alignItems:"flex-start",gap:11,padding:"12px 14px",borderRadius:14,background:"#fff",border:"1px solid #F3F4F6",opacity:t.done?.6:1 }}>
                <button onClick={()=>toggleTask(t.id)} style={{ marginTop:2,width:22,height:22,borderRadius:6,border:`2px solid ${t.done?GREEN:"#D1D5DB"}`,background:t.done?GREEN:"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0 }}>
                  {t.done&&<svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
                <div style={{ flex:1,minWidth:0 }}>
                  <p style={{ fontSize:13.5,fontWeight:t.done?500:700,color:t.done?"#9CA3AF":"#111827",textDecoration:t.done?"line-through":"none",margin:"0 0 4px" }}>{t.title}</p>
                  {t.desc&&<p style={{ fontSize:12,color:"#6B7280",margin:"0 0 5px",lineHeight:1.45 }}>{t.desc}</p>}
                  <span style={{ fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:20,background:PRI_BG[t.priority],color:PRI_COLOR[t.priority] }}>{PRI_LABEL[t.priority]}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {taskOpen&&(
        <><div onClick={()=>setTaskOpen(false)} style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(6,6,18,.55)",backdropFilter:"blur(5px)" }}/>
        <div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:2100,background:"#fff",borderRadius:"22px 22px 0 0",padding:"0 20px 52px",boxShadow:"0 -8px 40px rgba(0,0,0,.14)",animation:"sheet-up .3s cubic-bezier(.32,1.2,.64,1)",fontFamily:"'Nunito',sans-serif",maxHeight:"80vh",overflowY:"auto" }}>
          <div style={{ width:38,height:4,borderRadius:2,background:"#D1D5DB",margin:"14px auto 20px" }}/>
          <p style={{ fontSize:16,fontWeight:900,color:"#111827",margin:"0 0 6px" }}>📋 Assign Task to {agentName}</p>
          <p style={{ fontSize:12,color:"#9CA3AF",margin:"0 0 20px",lineHeight:1.5 }}>Give your agent a task to track and help you complete.</p>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:11,fontWeight:700,color:"#6B7280",display:"block",marginBottom:6,letterSpacing:.3 }}>TASK TITLE</label><input value={tTitle} onChange={e=>setTTitle(e.target.value)} placeholder="e.g. Revise Chapter 4" style={{ width:"100%",padding:"11px 14px",borderRadius:12,border:"1.5px solid #E5E7EB",background:"#F9FAFB",fontSize:13.5,fontWeight:600,color:"#111827",fontFamily:"'Nunito',sans-serif",outline:"none",boxSizing:"border-box" }} onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="#E5E7EB"}/></div>
          <div style={{ marginBottom:18 }}><label style={{ fontSize:11,fontWeight:700,color:"#6B7280",display:"block",marginBottom:6,letterSpacing:.3 }}>DESCRIPTION <span style={{ fontSize:10,fontWeight:500,color:"#C4C4C4" }}>optional</span></label><textarea value={tDesc} onChange={e=>setTDesc(e.target.value)} placeholder="Any context for your agent..." rows={3} style={{ width:"100%",padding:"11px 14px",borderRadius:12,border:"1.5px solid #E5E7EB",background:"#F9FAFB",fontSize:13,color:"#111827",fontFamily:"'Nunito',sans-serif",outline:"none",resize:"none",lineHeight:1.5,boxSizing:"border-box" }} onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="#E5E7EB"}/></div>
          <div style={{ marginBottom:22 }}><label style={{ fontSize:11,fontWeight:700,color:"#6B7280",display:"block",marginBottom:8,letterSpacing:.3 }}>PRIORITY</label><div style={{ display:"flex",gap:8 }}>{[["high","🔴 High"],["medium","🟡 Medium"],["low","🟢 Low"]].map(([k,l])=><button key={k} onClick={()=>setTPriority(k)} style={{ flex:1,padding:"9px 6px",borderRadius:12,border:`1.5px solid ${tPriority===k?PRI_COLOR[k]:"#E5E7EB"}`,background:tPriority===k?`${PRI_COLOR[k]}10`:"#F9FAFB",fontSize:12,fontWeight:800,color:tPriority===k?PRI_COLOR[k]:"#6B7280",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{l}</button>)}</div></div>
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={()=>setTaskOpen(false)} style={{ flex:1,padding:"13px",borderRadius:14,border:"1.5px solid #E5E7EB",background:"#F9FAFB",fontSize:13,fontWeight:800,color:"#6B7280",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>Cancel</button>
            <button onClick={addTask} style={{ flex:1.6,padding:"13px",borderRadius:14,border:"none",background:tTitle.trim()?`linear-gradient(135deg,${BRAND},#4C1DCC)`:"#E5E7EB",fontSize:13,fontWeight:800,color:tTitle.trim()?"#fff":"#9CA3AF",cursor:tTitle.trim()?"pointer":"default",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:7 }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={tTitle.trim()?"#fff":"#9CA3AF"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Assign Task
            </button>
          </div>
        </div></>
      )}
      {custOpen&&(
        <><div onClick={()=>setCustOpen(false)} style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(6,6,18,.55)",backdropFilter:"blur(5px)" }}/>
        <div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:2100,background:"#fff",borderRadius:"22px 22px 0 0",padding:"0 20px 48px",boxShadow:"0 -8px 40px rgba(0,0,0,.14)",animation:"sheet-up .3s cubic-bezier(.32,1.2,.64,1)",fontFamily:"'Nunito',sans-serif",maxHeight:"80vh",overflowY:"auto" }}>
          <div style={{ width:38,height:4,borderRadius:2,background:"#D1D5DB",margin:"14px auto 20px" }}/>
          <p style={{ fontSize:16,fontWeight:900,color:"#111827",margin:"0 0 18px" }}>✨ Customise Your Agent</p>
          <div style={{ marginBottom:16 }}><label style={{ fontSize:11,fontWeight:700,color:"#6B7280",display:"block",marginBottom:6,letterSpacing:.3 }}>AGENT NAME</label><input value={draftName} onChange={e=>setDraftName(e.target.value)} placeholder="e.g. Aria, Sage, Nova..." style={{ width:"100%",padding:"11px 14px",borderRadius:12,border:"1.5px solid #E5E7EB",background:"#F9FAFB",fontSize:14,fontWeight:600,color:"#111827",fontFamily:"'Nunito',sans-serif",outline:"none" }} onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="#E5E7EB"}/></div>
          <div style={{ marginBottom:22 }}><label style={{ fontSize:11,fontWeight:700,color:"#6B7280",display:"block",marginBottom:10,letterSpacing:.3 }}>AVATAR</label><div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>{AGENT_CONFIG.avatars.map(em=><button key={em} onClick={()=>setDraftEmoji(em)} style={{ width:46,height:46,borderRadius:12,border:`2px solid ${draftEmoji===em?BRAND:"#E5E7EB"}`,background:draftEmoji===em?`${BRAND}12`:"#F9FAFB",fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s" }}>{em}</button>)}</div></div>
          <div style={{ display:"flex",alignItems:"center",gap:12,background:`${BRAND}08`,border:`1px solid ${BRAND}20`,borderRadius:14,padding:"12px 14px",marginBottom:20 }}>
            <div style={{ width:44,height:44,borderRadius:"50%",background:`${BRAND}15`,border:`2px solid ${BRAND}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22 }}>{draftEmoji}</div>
            <div><p style={{ fontSize:14,fontWeight:900,color:"#111827",margin:0 }}>{draftName||"Unnamed"}</p><p style={{ fontSize:11,color:"#9CA3AF",margin:0 }}>Online · Lv {AGENT_CONFIG.level}</p></div>
          </div>
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={()=>setCustOpen(false)} style={{ flex:1,padding:"13px",borderRadius:14,border:"1.5px solid #E5E7EB",background:"#F9FAFB",fontSize:13,fontWeight:800,color:"#6B7280",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>Cancel</button>
            <button onClick={saveCustomise} style={{ flex:1.5,padding:"13px",borderRadius:14,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:7 }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Save Agent
            </button>
          </div>
        </div></>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   BATTLES TAB  (unchanged)
══════════════════════════════════════════════════════ */
function BattlesTab({ battles, onViewChallenge }) {
  const [viewFilter, setViewFilter] = useState("active");
  const [watching,   setWatching]   = useState(null);
  const liveBattles      = battles.filter(b=>b.status==="live");
  const scheduledBattles = battles.filter(b=>b.status==="scheduled");
  const completedBattles = battles.filter(b=>b.status==="completed");
  const displayed = viewFilter==="active"?liveBattles:viewFilter==="scheduled"?scheduledBattles:completedBattles;
  const totalXP  = battles.reduce((s,b)=>s+(parseInt((b.xpPrize||"0").replace(/\D/g,""),10)||0),0);
  const DIFF_CFG = DIFFICULTY_CONFIG;
  const ST_STYLE = {
    live:     {label:"● LIVE",   bg:"rgba(239,68,68,.12)",  color:RED,   border:"rgba(239,68,68,.25)"  },
    scheduled:{label:"SCHEDULED",bg:"rgba(108,59,255,.10)", color:BRAND, border:"rgba(108,59,255,.25)" },
    completed:{label:"COMPLETED",bg:"rgba(16,185,129,.10)", color:GREEN, border:"rgba(16,185,129,.25)" },
  };
  const TABS=[{key:"active",label:"Active",icon:"⚡",count:liveBattles.length},{key:"scheduled",label:"Scheduled",icon:"🗓",count:scheduledBattles.length},{key:"completed",label:"Completed",icon:"🏆",count:completedBattles.length}];
  return (
    <div style={{ flex:1,overflowY:"auto",background:"#fff",display:"flex",flexDirection:"column" }}>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,padding:"12px 16px 10px",borderBottom:"1px solid #F3F4F6" }}>
        {[{val:liveBattles.length,label:"Live",color:RED,bg:`${RED}0a`},{val:scheduledBattles.length,label:"Scheduled",color:BRAND,bg:`${BRAND}0a`},{val:completedBattles.length,label:"Completed",color:GREEN,bg:"rgba(16,185,129,.07)"},{val:`+${totalXP}`,label:"XP at stake",color:GOLD,bg:"rgba(245,158,11,.07)"}].map(({val,label,color,bg})=>(
          <div key={label} style={{ textAlign:"center",background:bg,borderRadius:12,padding:"9px 4px",border:`1px solid ${color}25` }}>
            <div style={{ fontSize:17,fontWeight:900,color }}>{val}</div>
            <div style={{ fontSize:9.5,color:"#9CA3AF",marginTop:1,fontWeight:600 }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ display:"flex",borderBottom:"1px solid #F3F4F6",background:"#fff",flexShrink:0 }}>
        {TABS.map(({key,label,icon,count})=>(
          <button key={key} onClick={()=>setViewFilter(key)} style={{ flex:1,padding:"9px 4px 10px",background:"none",border:"none",cursor:"pointer",fontSize:11.5,fontWeight:viewFilter===key?800:600,color:viewFilter===key?BRAND:"#9CA3AF",borderBottom:`2.5px solid ${viewFilter===key?BRAND:"transparent"}`,transition:"all .2s",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:5 }}>
            <span style={{ fontSize:13 }}>{icon}</span>{label}
            {count>0&&<span style={{ fontSize:9.5,fontWeight:900,background:viewFilter===key?BRAND:"#F3F4F6",color:viewFilter===key?"#fff":"#9CA3AF",borderRadius:8,padding:"1px 6px" }}>{count}</span>}
          </button>
        ))}
      </div>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"flex-end",padding:"8px 16px 6px",borderBottom:"1px solid #F3F4F6" }}>
        <button onClick={onViewChallenge} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:`1.5px solid ${RED}40`,background:`${RED}08`,fontSize:11.5,fontWeight:800,color:RED,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}><ZapIcon size={11} color={RED}/>Find Challenges</button>
      </div>
      {battles.length===0&&(
        <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,padding:"40px 24px" }}>
          <span style={{ fontSize:52,opacity:.2 }}>⚔️</span>
          <p style={{ fontSize:15,fontWeight:800,color:"#9CA3AF",textAlign:"center" }}>No battles yet</p>
          <p style={{ fontSize:12,fontWeight:600,color:"#D1D5DB",textAlign:"center" }}>Accept a challenge from the Challenges tab to start</p>
          <button onClick={onViewChallenge} style={{ padding:"10px 22px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",gap:7 }}><ZapIcon size={13} color="#fff"/>View Challenges</button>
        </div>
      )}
      {battles.length>0&&displayed.length===0&&(
        <div style={{ textAlign:"center",padding:"36px 24px",color:"#9CA3AF" }}>
          <span style={{ fontSize:36,opacity:.3 }}>{viewFilter==="active"?"⚡":viewFilter==="scheduled"?"🗓":"🏆"}</span>
          <p style={{ fontSize:13,fontWeight:700,marginTop:8 }}>{viewFilter==="active"?"No live battles right now.":viewFilter==="scheduled"?"No scheduled battles.":"No completed battles yet."}</p>
        </div>
      )}
      <div style={{ padding:"10px 16px",display:"flex",flexDirection:"column",gap:10 }}>
        {displayed.map(b=>{
          const sc=SUBJECT_COLORS[b.subject]||BRAND,diff=DIFF_CFG[b.difficulty]||DIFF_CFG.medium,st=ST_STYLE[b.status]||ST_STYLE.scheduled,A=b.agentA,B=b.agentB;
          return (
            <div key={b.id} style={{ borderRadius:18,border:`1.5px solid ${b.status==="live"?"rgba(239,68,68,.30)":b.status==="scheduled"?"rgba(108,59,255,.25)":"#F3F4F6"}`,background:b.status==="live"?"linear-gradient(140deg,#FFF5F5,#FFFCFC)":b.status==="scheduled"?"linear-gradient(140deg,#F5F3FF,#FCFCFF)":"#fff",overflow:"hidden" }}>
              {b.status==="live"&&<div style={{ height:3,background:`linear-gradient(90deg,${RED},#FF6B6B,${RED})`,backgroundSize:"200% 100%",animation:"shimmer 1.8s linear infinite" }}/>}
              {b.status==="scheduled"&&<div style={{ height:3,background:`linear-gradient(90deg,${BRAND},#818CF8,${BRAND})`,backgroundSize:"200% 100%",animation:"shimmer 2.2s linear infinite" }}/>}
              <div style={{ padding:"13px 14px" }}>
                <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:10 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0 }}>
                    <img src={b.avatar} alt="" style={{ width:40,height:40,borderRadius:"50%",objectFit:"cover",border:`2px solid ${sc}50`,flexShrink:0 }}/>
                    <div style={{ minWidth:0 }}><p style={{ fontSize:14,fontWeight:900,color:"#111827",margin:"0 0 2px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{b.title}</p><p style={{ fontSize:11,color:"#9CA3AF",margin:0 }}>vs {b.challenger}</p></div>
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
                    <span style={{ fontSize:10,fontWeight:700,color:"rgba(255,255,255,.40)",flexShrink:0 }}>{b.participants.length} agents</span>
                  </div>
                ):A&&B&&(
                  <div style={{ display:"flex",alignItems:"center",gap:8,background:"rgba(0,0,0,.025)",borderRadius:12,padding:"10px 12px",marginBottom:10 }}>
                    <div style={{ flex:1,display:"flex",alignItems:"center",gap:7 }}>
                      <div style={{ width:32,height:32,borderRadius:"50%",background:A.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0 }}>{A.emoji}</div>
                      <div><div style={{ fontSize:11.5,fontWeight:800,color:"#111827" }}>{A.name}</div>{A.isYou&&<span style={{ fontSize:8.5,fontWeight:800,background:"#1A1A2E",color:"#fff",borderRadius:4,padding:"1px 5px" }}>YOU</span>}<div style={{ fontSize:14,fontWeight:900,color:A.color }}>{b.status==="scheduled"?"—":A.score}</div></div>
                    </div>
                    <div style={{ width:28,height:28,borderRadius:"50%",background:"#1A1A2E",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff",flexShrink:0 }}>VS</div>
                    <div style={{ flex:1,display:"flex",alignItems:"center",gap:7,justifyContent:"flex-end",flexDirection:"row-reverse" }}>
                      <div style={{ width:32,height:32,borderRadius:"50%",background:B.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0 }}>{B.emoji}</div>
                      <div style={{ textAlign:"right" }}><div style={{ fontSize:11.5,fontWeight:800,color:"#111827" }}>{B.name}</div><div style={{ fontSize:14,fontWeight:900,color:B.color }}>{b.status==="scheduled"?"—":B.score}</div></div>
                    </div>
                  </div>
                )}
                <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap" }}>
                  <span style={{ fontSize:10,fontWeight:700,color:sc,background:`${sc}14`,borderRadius:5,padding:"1px 7px" }}>{SUBJECTS[b.subject]?.icon} {SUBJECTS[b.subject]?.label}</span>
                  <div style={{ background:diff.bg,borderRadius:5,padding:"1px 7px" }}><span style={{ fontSize:9.5,fontWeight:800,color:diff.color }}>{diff.label}</span></div>
                  <span style={{ fontSize:10.5,fontWeight:800,color:GOLD,display:"flex",alignItems:"center",gap:3 }}><ZapIcon size={10} color={GOLD}/>{b.xpPrize}</span>
                  <span style={{ fontSize:10.5,color:"#9CA3AF",fontWeight:600 }}>⏱ {b.timeLimit}</span>
                  {b.status==="live"&&<span style={{ fontSize:10,color:RED,fontWeight:700 }}>⏱ Started {b.startedAgo}m ago</span>}
                  {b.status==="scheduled"&&<span style={{ fontSize:10,color:BRAND,fontWeight:700 }}>🗓 {b.startsIn}</span>}
                </div>
                {b.status==="completed"&&(<div style={{ display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:10,background:"rgba(16,185,129,.07)",border:"1px solid rgba(16,185,129,.20)",marginBottom:10 }}><span style={{ fontSize:14 }}>🏆</span><span style={{ fontSize:12,fontWeight:700,color:GREEN }}>{b.winner===b.agentA?.id?b.agentA?.name:b.agentB?.name} won · {b.agentA?.score}–{b.agentB?.score} · XP distributed</span></div>)}
                <div style={{ display:"flex",gap:7 }}>
                  {b.status==="live"&&<button onClick={()=>setWatching(b)} style={{ flex:1,padding:"10px",borderRadius:12,border:"none",background:`linear-gradient(135deg,${RED},#DC2626)`,color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><span style={{ fontSize:14 }}>📺</span>Watch Live</button>}
                  {b.status==="scheduled"&&<button onClick={()=>setWatching(b)} style={{ flex:1,padding:"10px",borderRadius:12,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><span style={{ fontSize:14 }}>👁</span>Preview</button>}
                  {b.status==="completed"&&<button onClick={()=>setWatching(b)} style={{ flex:1,padding:"10px",borderRadius:12,border:`1.5px solid #E5E7EB`,background:"#F9FAFB",color:"#374151",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}><span style={{ fontSize:14 }}>📊</span>View Result</button>}
                  <button style={{ padding:"10px 14px",borderRadius:12,border:"1.5px solid #E5E7EB",background:"#F9FAFB",color:"#9CA3AF",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>Details</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {watching&&<BattleModal battle={watching} onClose={()=>setWatching(null)}/>}
    </div>
  );
}

/* ══════════════════════════════════
   RANKINGS TAB  (unchanged)
══════════════════════════════════ */
function RankingsTab() {
  const [boardType, setBoardType] = useState("classroom");
  const BOARD_TABS=[{key:"classroom",label:"Classroom",icon:"🏫"},{key:"courses",label:"Courses",icon:"📘"},{key:"interSchool",label:"Inter-Schools",icon:"🌍"}];
  const data=LEADERBOARD[boardType]||[];
  const changeColor=c=>c.startsWith("+")?GREEN:c.startsWith("-")?RED:"#9CA3AF";
  return (
    <div style={{ flex:1,overflowY:"auto",background:"#fff",display:"flex",flexDirection:"column" }}>
      <div style={{ display:"flex",padding:"12px 16px 0",gap:8,borderBottom:"1px solid #F3F4F6" }}>
        {BOARD_TABS.map(({key,label,icon})=>(
          <button key={key} onClick={()=>setBoardType(key)} style={{ flex:1,padding:"8px 4px 10px",background:"none",border:"none",cursor:"pointer",fontSize:11.5,fontWeight:boardType===key?800:600,color:boardType===key?BRAND:"#9CA3AF",borderBottom:`2.5px solid ${boardType===key?BRAND:"transparent"}`,transition:"all .2s",fontFamily:"'Nunito',sans-serif",display:"flex",flexDirection:"column",alignItems:"center",gap:2 }}>
            <span style={{ fontSize:16 }}>{icon}</span>{label}
          </button>
        ))}
      </div>
      <div style={{ padding:"18px 16px 12px",background:`linear-gradient(160deg,${BRAND}12,${BRAND}04)`,borderBottom:"1px solid #F3F4F6" }}>
        <p style={{ fontSize:10,fontWeight:800,color:BRAND,letterSpacing:.5,margin:"0 0 12px",textAlign:"center" }}>🏆 TOP LEADERBOARD</p>
        <div style={{ display:"flex",alignItems:"flex-end",justifyContent:"center",gap:10 }}>
          {data[1]&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:5 }}><img src={data[1].avatar} alt="" style={{ width:46,height:46,borderRadius:"50%",objectFit:"cover",border:"2.5px solid #C0C0C0" }}/><span style={{ fontSize:9.5,fontWeight:800,color:"#374151",textAlign:"center",maxWidth:68,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{data[1].name}</span><div style={{ width:58,background:"#C0C0C0",borderRadius:"6px 6px 0 0",padding:"8px 0 6px",textAlign:"center" }}><span style={{ fontSize:16 }}>🥈</span><p style={{ fontSize:10,fontWeight:800,color:"#fff",margin:0 }}>{(data[1].xp||0).toLocaleString()}</p><p style={{ fontSize:9,fontWeight:600,color:"rgba(255,255,255,.8)",margin:0 }}>XP</p></div></div>}
          {data[0]&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:5,marginBottom:-4 }}><div style={{ position:"relative" }}><img src={data[0].avatar} alt="" style={{ width:58,height:58,borderRadius:"50%",objectFit:"cover",border:`3px solid ${GOLD}` }}/><div style={{ position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",fontSize:18 }}>👑</div></div><span style={{ fontSize:10,fontWeight:900,color:"#111827",textAlign:"center",maxWidth:80,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{data[0].name}</span><div style={{ width:68,background:`linear-gradient(135deg,${GOLD},#D97706)`,borderRadius:"6px 6px 0 0",padding:"10px 0 6px",textAlign:"center" }}><span style={{ fontSize:18 }}>🥇</span><p style={{ fontSize:11,fontWeight:900,color:"#fff",margin:0 }}>{(data[0].xp||0).toLocaleString()}</p><p style={{ fontSize:9,fontWeight:600,color:"rgba(255,255,255,.85)",margin:0 }}>XP</p></div></div>}
          {data[2]&&<div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:5 }}><img src={data[2].avatar} alt="" style={{ width:40,height:40,borderRadius:"50%",objectFit:"cover",border:"2.5px solid #CD7F32" }}/><span style={{ fontSize:9.5,fontWeight:800,color:"#374151",textAlign:"center",maxWidth:60,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{data[2].name}</span><div style={{ width:52,background:"#CD7F32",borderRadius:"6px 6px 0 0",padding:"6px 0 6px",textAlign:"center" }}><span style={{ fontSize:14 }}>🥉</span><p style={{ fontSize:9.5,fontWeight:800,color:"#fff",margin:0 }}>{(data[2].xp||0).toLocaleString()}</p><p style={{ fontSize:9,fontWeight:600,color:"rgba(255,255,255,.8)",margin:0 }}>XP</p></div></div>}
        </div>
      </div>
      <div style={{ flex:1 }}>
        {data.slice(3).map(entry=>{
          const isMe=entry.isMe,subjectColor=entry.subject?SUBJECT_COLORS[entry.subject]:null;
          return (
            <div key={entry.rank} style={{ display:"flex",alignItems:"center",gap:12,padding:"11px 18px",borderBottom:"1px solid #F3F4F6",background:isMe?`${BRAND}06`:"#fff" }}>
              <div style={{ width:28,height:28,borderRadius:8,background:isMe?`${BRAND}15`:"#F3F4F6",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><span style={{ fontSize:12,fontWeight:900,color:isMe?BRAND:"#6B7280" }}>{entry.rank}</span></div>
              <img src={entry.avatar} alt="" style={{ width:40,height:40,borderRadius:"50%",objectFit:"cover",border:`2px solid ${isMe?BRAND:"#E5E7EB"}`,flexShrink:0 }}/>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ display:"flex",alignItems:"center",gap:5 }}><span style={{ fontSize:13.5,fontWeight:800,color:isMe?BRAND:"#111827" }}>{entry.name}</span>{isMe&&<span style={{ fontSize:9,fontWeight:800,color:BRAND,background:`${BRAND}15`,borderRadius:4,padding:"1px 5px" }}>YOU</span>}</div>
                <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:2 }}>
                  {entry.streak!==undefined&&<span style={{ fontSize:10,fontWeight:700,color:"#9CA3AF" }}>🔥 {entry.streak}d streak</span>}
                  {entry.subject&&<span style={{ fontSize:10,fontWeight:700,color:subjectColor||"#9CA3AF",background:`${subjectColor}15`,borderRadius:4,padding:"1px 6px" }}>{SUBJECTS[entry.subject]?.icon} {SUBJECTS[entry.subject]?.label}</span>}
                  {entry.completions!==undefined&&<span style={{ fontSize:10,fontWeight:600,color:"#9CA3AF" }}>{entry.completions} completions</span>}
                  {entry.students!==undefined&&<span style={{ fontSize:10,fontWeight:600,color:"#9CA3AF" }}>👥 {entry.students} students</span>}
                </div>
              </div>
              <div style={{ textAlign:"right",flexShrink:0 }}>
                <div style={{ display:"flex",alignItems:"center",gap:4,justifyContent:"flex-end" }}><ZapIcon size={11} color={GOLD}/><span style={{ fontSize:13,fontWeight:900,color:"#111827" }}>{(entry.xp||0).toLocaleString()}</span></div>
                <span style={{ fontSize:10,fontWeight:800,color:changeColor(entry.change) }}>{entry.change}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   CHANGE 5c — LearnerDashboard (main component)
   Added:
   - agentProfile state + useEffect fetch from /api/user/agent
   - decayAlerts state + useEffect fetch from /api/adaptive/decay/alerts
   - sessions/challenges state wired to real API with mock fallback
   - configOpen state — FAB now opens ConfigModal first
   - decaySession state — DecaySessionModal
   - SessionCard receives decayAlert + onDecayTap props
   - AgentChatTab receives agentNameProp + agentEmojiProp
   Everything else unchanged.
══════════════════════════════════════════════════════ */
export default function LearnerDashboard() {
  const [tab,               setTab]              = useState("sessions");
  const [sessionTab,        setSessionTab]        = useState("all");
  const [liveSubTab,        setLiveSubTab]        = useState("starting-soon");
  const [agentSubTab,       setAgentSubTab]       = useState("sessions");
  const [liveSubjectFilter, setLiveSubjectFilter] = useState("all");
  const [agentSubjectFilter,setAgentSubjectFilter]= useState("all");
  const [subjectFilter,     setSubjectFilter]     = useState("all");
  const [selectedSession,   setSelectedSession]   = useState(null);
  const [selectedChallenge, setSelectedChallenge] = useState(null);
  const [teachSession,      setTeachSession]      = useState(null); // now holds config OR null
  const [configOpen,        setConfigOpen]        = useState(false); // FAB → ConfigModal
  const [configInitial,     setConfigInitial]     = useState(null);  // pre-fill from session sheet
  const [decaySession,      setDecaySession]      = useState(null); // decay alert object
  const [acceptedIds,       setAcceptedIds]       = useState(new Set());
  const [battles,           setBattles]           = useState(SEED_BATTLES);
  const [toast,             setToast]             = useState(null);
  const [isOnline,          setIsOnline]          = useState(true);
  const [liveBattleModal,   setLiveBattleModal]   = useState(null);

  // ── API-driven state with mock fallback ──────────────────────────────────
  const [sessions,     setSessions]     = useState(SESSIONS);
  const [challenges,   setChallenges]   = useState(CHALLENGES);
  const [agentProfile, setAgentProfile] = useState({
    name:            AGENT_CONFIG.name,
    emoji:           AGENT_CONFIG.emoji,
    teacherAgentId:  AGENT_CONFIG.teacherAgentId,
    guideName:       AGENT_CONFIG.guideName,
    guideEmoji:      AGENT_CONFIG.guideEmoji,
    guideRenderStyle:AGENT_CONFIG.guideRenderStyle,
    ttsVoice:        AGENT_CONFIG.guideRenderStyle.ttsVoice,
  });
  const [decayAlerts,  setDecayAlerts]  = useState(MOCK_DECAY_ALERTS);
  const [agentSessions, setAgentSessions] = useState(AGENT_SESSIONS);

  useEffect(()=>{
    // Agent profile — student agent + guide agent
    apiGet("/api/user/agent")
      .then(d=>{
        if (d.agent_name) setAgentProfile({
          name:            d.agent_name,
          emoji:           d.agent_emoji  || AGENT_CONFIG.emoji,
          teacherAgentId:  d.teacher_agent_id || AGENT_CONFIG.teacherAgentId,
          guideName:       d.guide_name   || AGENT_CONFIG.guideName,
          guideEmoji:      d.guide_emoji  || AGENT_CONFIG.guideEmoji,
          guideRenderStyle:d.guide_render_style || AGENT_CONFIG.guideRenderStyle,
          ttsVoice:        d.tts_voice    || "alloy",
        });
      })
      .catch(()=>{});

    // Sessions
    apiGet("/api/student/sessions")
      .then(d=>{ if(d.sessions?.length) setSessions(d.sessions); })
      .catch(()=>{});

    // Challenges
    apiGet("/api/battle/my-challenges")
      .then(d=>{ if(d.challenges?.length) setChallenges(d.challenges); })
      .catch(()=>{});

    // Battles
    apiGet("/api/battle/my-battles")
      .then(d=>{ if(d.battles?.length) setBattles(d.battles); })
      .catch(()=>{});

    // Decay alerts
    apiGet("/api/adaptive/decay/alerts")
      .then(d=>{ if(d.alerts?.length) setDecayAlerts(d.alerts); })
      .catch(()=>{});

    // Agent sessions (for Sessions + Revisions sub-tabs)
    apiGet("/api/adaptive/sessions")
      .then(d=>{ if(d.sessions?.length) setAgentSessions(d.sessions); })
      .catch(()=>{});
  },[]);

  // WebSocket — live class alerts + challenge notifications + decay alerts
  useEffect(()=>{
    const WS_URL = (typeof VITE_API_URL !== "undefined" ? VITE_API_URL : "https://akoro.app");
    let socket;
    try {
      if (typeof window !== "undefined" && window.io) {
        socket = window.io(WS_URL, { transports: ["websocket","polling"] });

        socket.on("connect", () => {
          // Join user room (live alerts + challenges)
          socket.emit("subscribe-student", STUDENT_ID);
          // Gap 1 fix: also join student:{id} room for decay cron alerts
          socket.emit("join-student-room", STUDENT_ID);
        });

        // Live class starting soon
        socket.on("live_class_starting", alert => {
          setToast(`📡 ${alert.title} starts in ${alert.minutesUntil} min!`);
          setSessions(prev => prev.map(s =>
            s.id === alert.sessionId
              ? { ...s, status:"starting-soon", scheduleBucket:"starting-soon",
                  minutesUntil: alert.minutesUntil, nextSession:`in ${alert.minutesUntil} min` }
              : s
          ));
          setSessionTab("live");
          setLiveSubTab("starting-soon");
        });

        // Live class now live
        socket.on("live_class_live", alert => {
          setToast(`🔴 ${alert.title} is now LIVE! Join now.`);
          setSessions(prev => prev.map(s =>
            s.id === alert.sessionId
              ? { ...s, status:"live", scheduleBucket:"live",
                  nextSession:"LIVE", joinUrl: alert.joinUrl }
              : s
          ));
          setSessionTab("live");
          setLiveSubTab("starting-soon");
        });

        // New challenge from peer
        socket.on("new_challenge", challenge => {
          setToast(`⚡ ${challenge.challenger} challenged you!`);
          setChallenges(prev => [challenge, ...prev]);
          setTab("challenges");
        });

        // Gap 2 fix: correct battle event name from backend
        socket.on("battle:participant-joined", data => {
          setBattles(prev => prev.map(b =>
            b.id === data.battleId ? { ...b, status:"live" } : b
          ));
        });

        // Gap 3: challenger notified their battle was accepted
        socket.on("battle_accepted", data => {
          setToast(`✅ ${data.opponent} accepted your challenge! Battle ${data.isImmediate ? "starting now" : "scheduled"}.`);
          setBattles(prev => prev.map(b =>
            b.id === data.battleId ? { ...b, status: data.status } : b
          ));
          // Auto-join the battle room
          socket.emit("join-battle", data.battleId);
        });

        // Gap 3: join battle room when told to
        socket.on("join_battle_room", ({ battleId }) => {
          socket.emit("join-battle", battleId);
        });

        // Gap 4 fix: topic-level decay alert from decayEngine cron
        socket.on("knowledge_decay_alert", data => {
          if (data.alerts?.length) {
            setDecayAlerts(prev => {
              const existing = new Set(prev.map(a => a.id));
              const newAlerts = data.alerts.filter(a => !existing.has(a.id));
              return newAlerts.length ? [...prev, ...newAlerts] : prev;
            });
          }
        });

        // Gap 4 fix: subtopic-level decay alert from decayEngine cron
        socket.on("subtopic_decay_alert", data => {
          if (data.alerts?.length) {
            setDecayAlerts(prev => {
              const existing = new Set(prev.map(a => a.id));
              const newAlerts = data.alerts.filter(a => !existing.has(a.id));
              return newAlerts.length ? [...prev, ...newAlerts] : prev;
            });
          }
        });
      }
    } catch { /* socket.io not loaded — REST polling fallback */ }

    // Polling fallback — refresh live alerts every 60 s
    const poll = setInterval(()=>{
      apiGet("/api/student/live-alerts")
        .then(d=>{
          if (!d.alerts?.length) return;
          setSessions(prev => {
            const map = Object.fromEntries(d.alerts.map(a=>[a.sessionId,a]));
            return prev.map(s => {
              const a = map[s.id];
              if (!a) return s;
              return { ...s, status: a.status==="live"?"live":"starting-soon",
                scheduleBucket: a.bucket, minutesUntil: a.minutesUntil,
                nextSession: a.status==="live"?"LIVE":`in ${a.minutesUntil} min` };
            });
          });
        })
        .catch(()=>{});
    }, 60_000);

    return () => {
      socket?.disconnect?.();
      clearInterval(poll);
    };
  },[]);

  // Build sessionId → decayAlert lookup for session card badges
  const decayBySession = decayAlerts.reduce((acc, a) => {
    if (a.sessionId) acc[a.sessionId] = a;
    return acc;
  }, {});

  const bySubject = subjectFilter==="all" ? sessions : sessions.filter(s=>s.subject===subjectFilter);
  const liveBase  = liveSubjectFilter==="all" ? sessions : sessions.filter(s=>s.subject===liveSubjectFilter);
  const filtered  = sessionTab==="all"   ? bySubject
                  : sessionTab==="live"  ? liveBase.filter(s=>s.type==="live" && s.scheduleBucket===liveSubTab)
                  : bySubject.filter(s=>s.type==="agent");

  // Agent sub-tab data
  const agentSessionsFiltered = agentSubjectFilter==="all"
    ? agentSessions
    : agentSessions.filter(s=>s.subject===agentSubjectFilter);
  const agentRevisions = agentSubjectFilter==="all"
    ? decayAlerts
    : decayAlerts.filter(a=>a.subject===agentSubjectFilter);
  // Map decay alerts to session-card-compatible shape for agent tab
  const decayAsSessions = agentRevisions.map(a=>({
    id:             a.sessionId || a.id,
    type:           "agent",
    status:         "active",
    title:          a.topic,
    topic:          a.topic,
    subject:        a.subject,
    avatar:         `https://i.pravatar.cc/150?u=${a.id}`,
    tutor:          "AI Agent",
    level:          "Adaptive",
    nextSession:    `${a.daysSince}d ago`,
    topics:         1,
    revisions:      0,
    reviews:        0,
    progress:       a.confidence||0,
    unread:         0,
    priority:       "high",
    scheduleBucket: "later",
    // decay context
    hasDecay:       true,
    decayAlertId:   a.id,
  }));

  const totalUnread       = sessions.reduce((sum,s)=>sum+s.unread,0);
  const pendingChallenges = challenges.filter(c=>!acceptedIds.has(c.id)).length;

  const handleAcceptChallenge = () => {
    if (!selectedChallenge) return;
    const c = selectedChallenge;
    setAcceptedIds(prev => new Set([...prev, c.id]));
    setSelectedChallenge(null);
    const battleQs = getQuestions(c.title);
    const newBattle = {
      ...c, id:`B-${Date.now()}`,
      agentA:{ id:"nexus",name:"Nexus",emoji:"🤖",owner:"You",ownerEmoji:"👤",bg:"#FEF0E6",color:"#E8884A",isYou:true,score:0,hp:100 },
      agentB:{ id:"opp",name:(c.agentBName||c.challenger.split(" ")[0]+"'s Agent"),emoji:(c.agentBEmoji||"⚡"),owner:c.challenger,ownerEmoji:"👦🏽",bg:(c.agentBBg||"#C8D8E8"),color:(c.agentBColor||BRAND),score:0,hp:100 },
      topic:c.title, viewers:0, xpPool:parseInt((c.xpPrize||"0").replace(/\D/g,""),10)||200, totalQ:battleQs.length, currentQNum:0, winner:null, startedAgo:null, question:battleQs[0],
    };
    // Also persist to backend (real endpoint)
    apiPost(`/api/battle/challenges/${c.id}/accept`).catch(()=>{});
    if (c.battleType==="immediate") {
      const liveBattle={...newBattle,status:"live",startedAgo:0,startsIn:null};
      setBattles(prev=>[...prev,liveBattle]); setLiveBattleModal(liveBattle);
      setToast(`⚡ Battle started! ${c.challenger} vs Nexus — Watch Live now.`);
    } else if (c.battleType==="classroom") {
      const classroomBattle={...newBattle,status:"live",startedAgo:0,startsIn:null,battleType:"classroom",participants:c.participants||[],agentA:c.teacherAgent||{id:"pythia",name:"Pythia",emoji:"🔮",owner:"Teacher",bg:"#EDE8F8",color:"#7C3AED",isTeacher:true,score:0,hp:100},viewers:Math.floor(Math.random()*15)+5};
      setBattles(prev=>[...prev,classroomBattle]); setLiveBattleModal(classroomBattle);
      setToast(`🏫 Class battle started! ${c.participants?.length} agents competing — Watch Live.`);
    } else {
      setBattles(prev=>[...prev,{...newBattle,status:"scheduled",startsIn:c.scheduledFor||"Scheduled"}]);
      setToast(`🗓 ${c.challenger}'s battle scheduled! Find it in Battles › Scheduled.`);
    }
  };

  const NAV_ITEMS=[{key:"sessions",icon:"📚",label:"Learn"},{key:"rankings",icon:"🏆",label:"Rankings"},{key:"battles",icon:"⚔️",label:"Battles"},{key:"agent",icon:"🤖",label:"Agent"}];
  const activeBattleCount=battles.filter(b=>b.status==="live"||b.status==="scheduled").length;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Nunito',sans-serif;background:#F3F1FF}
        a{display:contents}
        input::placeholder{color:#475569}
        @keyframes sheet-up{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes toast-in{from{opacity:0;transform:translateX(-50%) translateY(-10px) scale(.92)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
        @keyframes pulse-dot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.6);opacity:.5}}
        @keyframes bounce-dot{from{transform:translateY(0)}to{transform:translateY(-5px)}}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes xpPop{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-30px) scale(1.3)}}
        @keyframes scrollTicker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      <div style={{ width:"100vw",height:"100vh",fontFamily:"'Nunito',sans-serif",background:"#F3F1FF",display:"flex",flexDirection:"column",overflow:"hidden",position:"relative" }}>

        {/* HEADER */}
        <div style={{ background:"rgba(255,255,255,.97)",backdropFilter:"blur(14px)",borderBottom:"1px solid #EDE9FE",padding:"14px 18px 0",zIndex:100,flexShrink:0 }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
            <div style={{ display:"flex",alignItems:"center",gap:11 }}>
              <div style={{ position:"relative" }}>
                <img src="https://i.pravatar.cc/150?img=15" alt="" style={{ width:38,height:38,borderRadius:"50%",objectFit:"cover",border:"2px solid #EDE9FE" }}/>
                <div style={{ position:"absolute",bottom:1,right:1,width:10,height:10,borderRadius:"50%",background:isOnline?GREEN:"#9CA3AF",border:"2px solid #fff",animation:isOnline?"pulse-dot 2s ease-in-out infinite":"none" }}/>
              </div>
              <div>
                <p style={{ fontSize:15,fontWeight:900,color:"#111827",margin:0,lineHeight:1.2 }}>Alex Johnson</p>
                <div style={{ display:"flex",alignItems:"center",gap:5 }}><ZapIcon size={11} color={GOLD}/><span style={{ fontSize:11,fontWeight:700,color:"#9CA3AF" }}>2,840 XP · Grade 10</span></div>
              </div>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              <SubjectDropdown value={subjectFilter} onChange={setSubjectFilter}/>
              <div onClick={()=>setIsOnline(o=>!o)} style={{ display:"flex",alignItems:"center",background:"#F0EBFF",borderRadius:100,padding:4,cursor:"pointer",border:"1px solid #DDD3FF" }}>
                <div style={{ padding:"4px 12px",borderRadius:100,background:isOnline?BRAND:"transparent",color:isOnline?"#fff":"#9CA3AF",fontSize:11,fontWeight:700,transition:"all .22s ease" }}>{isOnline?"● Online":"Online"}</div>
              </div>
            </div>
          </div>
          <div style={{ display:"flex" }}>
            {[{key:"sessions",label:"My Sessions",count:totalUnread,countColor:BRAND},{key:"challenges",label:"Challenges",count:pendingChallenges,countColor:RED}].map(({key,label,count,countColor})=>(
              <button key={key} onClick={()=>setTab(key)} style={{ flex:1,padding:"10px 0 12px",background:"none",border:"none",cursor:"pointer",fontSize:13,fontWeight:tab===key?800:600,color:tab===key?BRAND:"#9CA3AF",borderBottom:`2.5px solid ${tab===key?BRAND:"transparent"}`,transition:"all .2s",display:"flex",alignItems:"center",justifyContent:"center",gap:7,fontFamily:"'Nunito',sans-serif" }}>
                {label}{count>0&&<span style={{ background:tab===key?countColor:"#E5E7EB",color:tab===key?"#fff":"#6B7280",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:800 }}>{count}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div style={{ flex:1,overflowY:"auto",paddingBottom:72 }}>
          {tab==="sessions"&&(
            <div style={{ background:"#fff",display:"flex",flexDirection:"column",minHeight:"100%" }}>
              {/* ── Top session type tabs ── */}
              <div style={{ display:"flex",borderBottom:"1px solid #F3F4F6",background:"#fff",flexShrink:0 }}>
                {[
                  {key:"all",    label:"All",          icon:"📚", count:bySubject.length},
                  {key:"live",   label:"Live Classes",  icon:"📡", count:bySubject.filter(s=>s.type==="live").length},
                  {key:"agent",  label:"Agent",         icon:"🤖", count:bySubject.filter(s=>s.type==="agent").length},
                ].map(({key,label,icon,count})=>(
                  <button key={key} onClick={()=>setSessionTab(key)} style={{ flex:1,padding:"10px 4px 11px",background:"none",border:"none",cursor:"pointer",fontSize:11.5,fontWeight:sessionTab===key?800:600,color:sessionTab===key?BRAND:"#9CA3AF",borderBottom:`2.5px solid ${sessionTab===key?BRAND:"transparent"}`,transition:"all .2s",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:5 }}>
                    <span style={{ fontSize:13 }}>{icon}</span>{label}<span style={{ fontSize:9.5,fontWeight:800,background:sessionTab===key?BRAND:"#F3F4F6",color:sessionTab===key?"#fff":"#9CA3AF",borderRadius:8,padding:"1px 6px" }}>{count}</span>
                  </button>
                ))}
              </div>

              {/* ── Live Classes sub-tabs ── */}
              {sessionTab==="live"&&(
                <>
                  <div style={{ display:"flex",gap:7,padding:"10px 16px 8px",overflowX:"auto",scrollbarWidth:"none",borderBottom:"1px solid #F3F4F6",background:"#FAFBFF",flexShrink:0 }}>
                    {[
                      {key:"starting-soon", label:"Starting Soon", icon:"🔴"},
                      {key:"today",         label:"Today",         icon:"📅"},
                      {key:"tomorrow",      label:"Tomorrow",      icon:"🌅"},
                      {key:"week",          label:"This Week",     icon:"📆"},
                    ].map(({key,label,icon})=>{
                      const cnt = bySubject.filter(s=>s.type==="live"&&s.scheduleBucket===key).length;
                      const active = liveSubTab===key;
                      const isAlert = key==="starting-soon"&&cnt>0;
                      return (
                        <button key={key} onClick={()=>setLiveSubTab(key)}
                          style={{ flexShrink:0,display:"flex",alignItems:"center",gap:5,
                            padding:"6px 13px",borderRadius:20,cursor:"pointer",fontFamily:"'Nunito',sans-serif",
                            fontWeight:active?800:600,fontSize:11.5,
                            border:`1.5px solid ${active?(isAlert?RED:BRAND):"#E5E7EB"}`,
                            background:active?(isAlert?`${RED}10`:`${BRAND}10`):"#fff",
                            color:active?(isAlert?RED:BRAND):"#6B7280",transition:"all .2s" }}>
                          {isAlert&&active&&<div style={{ width:6,height:6,borderRadius:"50%",background:RED,animation:"pulse-dot 1s ease-in-out infinite" }}/>}
                          <span>{icon}</span>{label}
                          {cnt>0&&<span style={{ fontSize:9,fontWeight:900,background:active?(isAlert?RED:BRAND):"#F3F4F6",color:active?"#fff":isAlert?RED:"#9CA3AF",borderRadius:8,padding:"1px 5px" }}>{cnt}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {/* Subject filter for live classes */}
                  <div style={{ display:"flex",gap:7,padding:"8px 16px 8px",overflowX:"auto",scrollbarWidth:"none",borderBottom:"1px solid #F3F4F6",flexShrink:0 }}>
                    {[{key:"all",label:"All",icon:"📚"},{key:"maths",label:"Maths",icon:SUBJECTS.maths.icon},{key:"english",label:"English",icon:SUBJECTS.english.icon},{key:"science",label:"Science",icon:SUBJECTS.science.icon}].map(({key,label,icon})=>{
                      const color=SUBJECT_COLORS[key]||BRAND, active=liveSubjectFilter===key;
                      return <button key={key} onClick={()=>setLiveSubjectFilter(key)} style={{ flexShrink:0,padding:"5px 13px",borderRadius:20,cursor:"pointer",fontFamily:"'Nunito',sans-serif",fontWeight:active?800:600,fontSize:11.5,border:`1.5px solid ${active?color:"#E5E7EB"}`,background:active?`${color}10`:"#fff",color:active?color:"#6B7280",transition:"all .2s",display:"flex",alignItems:"center",gap:5 }}><span>{icon}</span>{label}</button>;
                    })}
                  </div>
                </>
              )}

              {/* ── Subject filter chips (all + agent tabs only) ── */}
              {sessionTab!=="live"&&(
                <div style={{ display:"flex",gap:8,padding:"10px 18px 8px",overflowX:"auto",scrollbarWidth:"none",borderBottom:"1px solid #F3F4F6",flexShrink:0 }}>
                  {["maths","english","science"].map(s=>{
                    const color=SUBJECT_COLORS[s],cnt=sessions.filter(ses=>ses.subject===s).length,active=subjectFilter===s;
                    return <div key={s} onClick={()=>setSubjectFilter(active?"all":s)} style={{ display:"flex",alignItems:"center",gap:5,flexShrink:0,background:active?`${color}16`:"#F9FAFB",border:`1.5px solid ${active?color:"#F3F4F6"}`,borderRadius:10,padding:"6px 12px",cursor:"pointer",transition:"all .2s" }}><span style={{ fontSize:12 }}>{SUBJECTS[s].icon}</span><span style={{ fontSize:11,fontWeight:800,color:active?color:"#6B7280" }}>{SUBJECTS[s].label}</span><span style={{ fontSize:10,fontWeight:700,color:active?color:"#9CA3AF",background:active?`${color}18`:"#F3F4F6",borderRadius:6,padding:"0 5px" }}>{cnt}</span></div>;
                  })}
                </div>
              )}

              {/* ── Session list ── */}
              {/* ── All + Live filtered lists ── */}
              {sessionTab!=="agent"&&(
                filtered.length===0
                  ?<div style={{ padding:"40px 24px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10 }}>
                    <span style={{ fontSize:52,opacity:.2 }}>
                      {sessionTab==="live"?liveSubTab==="starting-soon"?"🔴":"📡":"📚"}
                    </span>
                    <p style={{ fontSize:15,fontWeight:800,color:"#9CA3AF" }}>
                      {sessionTab==="live"
                        ?`No ${liveSubTab==="starting-soon"?"classes starting soon":liveSubTab==="today"?"classes today":liveSubTab==="tomorrow"?"classes tomorrow":"classes this week"}`
                        :"No sessions found"}
                    </p>
                  </div>
                  :filtered.map(s=>(
                    <SessionCard key={s.id} session={s}
                      onTap={setSelectedSession}
                      decayAlert={decayBySession[s.id]||null}
                      agentProfile={agentProfile}/>
                  ))
              )}

              {/* ── Agent sub-tabs: Sessions | Revisions ── */}
              {sessionTab==="agent"&&(
                <div style={{ display:"flex",flexDirection:"column",flex:1 }}>
                  {/* Sub-tab bar */}
                  <div style={{ display:"flex",borderBottom:"1px solid #F3F4F6",background:"#fff",flexShrink:0 }}>
                    {[
                      {key:"sessions",  label:"Sessions",  icon:"📚", count:agentSessionsFiltered.length},
                      {key:"revisions", label:"Revisions", icon:"🔄", count:agentRevisions.length},
                    ].map(({key,label,icon,count})=>{
                      const active=agentSubTab===key;
                      const isRevision=key==="revisions";
                      return (
                        <button key={key} onClick={()=>setAgentSubTab(key)}
                          style={{ flex:1,padding:"9px 4px 10px",background:"none",border:"none",cursor:"pointer",
                            fontSize:11.5,fontWeight:active?800:600,
                            color:active?(isRevision?RED:BRAND):"#9CA3AF",
                            borderBottom:`2.5px solid ${active?(isRevision?RED:BRAND):"transparent"}`,
                            transition:"all .2s",fontFamily:"'Nunito',sans-serif",
                            display:"flex",alignItems:"center",justifyContent:"center",gap:5 }}>
                          <span style={{ fontSize:13 }}>{icon}</span>{label}
                          {count>0&&<span style={{ fontSize:9.5,fontWeight:900,
                            background:active?(isRevision?RED:BRAND):"#F3F4F6",
                            color:active?"#fff":isRevision?RED:"#9CA3AF",
                            borderRadius:8,padding:"1px 6px" }}>{count}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {/* Subject filter chips */}
                  <div style={{ display:"flex",gap:7,padding:"10px 16px 8px",overflowX:"auto",scrollbarWidth:"none",borderBottom:"1px solid #F3F4F6",flexShrink:0 }}>
                    {[{key:"all",label:"All",icon:"📚"},
                      {key:"maths",label:"Maths",icon:SUBJECTS.maths.icon},
                      {key:"english",label:"English",icon:SUBJECTS.english.icon},
                      {key:"science",label:"Science",icon:SUBJECTS.science.icon},
                    ].map(({key,label,icon})=>{
                      const color=SUBJECT_COLORS[key]||BRAND, active=agentSubjectFilter===key;
                      return (
                        <button key={key} onClick={()=>setAgentSubjectFilter(key)}
                          style={{ flexShrink:0,padding:"5px 13px",borderRadius:20,cursor:"pointer",
                            fontFamily:"'Nunito',sans-serif",fontWeight:active?800:600,fontSize:11.5,
                            border:`1.5px solid ${active?color:"#E5E7EB"}`,
                            background:active?`${color}10`:"#fff",
                            color:active?color:"#6B7280",transition:"all .2s",
                            display:"flex",alignItems:"center",gap:5 }}>
                          <span>{icon}</span>{label}
                        </button>
                      );
                    })}
                  </div>
                  {/* Sessions sub-tab */}
                  {agentSubTab==="sessions"&&(
                    agentSessionsFiltered.length===0
                      ?<div style={{ padding:"40px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:10 }}>
                        <span style={{ fontSize:52,opacity:.2 }}>📚</span>
                        <p style={{ fontSize:15,fontWeight:800,color:"#9CA3AF" }}>No sessions yet</p>
                        <p style={{ fontSize:12,color:"#D1D5DB",textAlign:"center" }}>Start a session with the FAB button to see your teaching history here.</p>
                      </div>
                      :agentSessionsFiltered.map(s=>(
                        <SessionCard key={s.id} session={s}
                          onTap={setSelectedSession}
                          decayAlert={decayBySession[s.id]||null}
                          agentProfile={agentProfile}/>
                      ))
                  )}
                  {/* Revisions sub-tab */}
                  {agentSubTab==="revisions"&&(
                    decayAsSessions.length===0
                      ?<div style={{ padding:"40px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:10 }}>
                        <span style={{ fontSize:52,opacity:.2 }}>✅</span>
                        <p style={{ fontSize:15,fontWeight:800,color:"#9CA3AF" }}>No revisions needed</p>
                        <p style={{ fontSize:12,color:"#D1D5DB",textAlign:"center" }}>All your agent sessions are up to date!</p>
                      </div>
                      :decayAsSessions.map(s=>(
                        <SessionCard key={s.id} session={s}
                          onTap={setSelectedSession}
                          decayAlert={decayBySession[s.id]||decayAlerts.find(a=>a.id===s.decayAlertId)||null}
                          agentProfile={agentProfile}/>
                      ))
                  )}
                </div>
              )}
            </div>
          )}
          {tab==="challenges"&&(
            <div style={{ background:"#fff",minHeight:"100%" }}>
              <div style={{ padding:"12px 18px 10px",borderBottom:"1px solid #F3F4F6" }}>
                <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6 }}><ZapIcon size={13} color={RED}/><span style={{ fontSize:12,fontWeight:800,color:"#374151" }}>Peer Challenges — Accept before they expire</span></div>
                <div style={{ display:"flex",gap:10 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:5 }}><div style={{ width:8,height:8,borderRadius:"50%",background:RED,animation:"pulse-dot 1.2s ease-in-out infinite" }}/><span style={{ fontSize:10.5,fontWeight:700,color:"#6B7280" }}>⚡ Immediate — battle opens right away</span></div>
                  <div style={{ display:"flex",alignItems:"center",gap:5 }}><div style={{ width:8,height:8,borderRadius:"50%",background:BRAND }}/><span style={{ fontSize:10.5,fontWeight:700,color:"#6B7280" }}>🗓 Scheduled — goes to Battles tab</span></div>
                </div>
              </div>
              {challenges.filter(c=>!acceptedIds.has(c.id)).length===0?(
                <div style={{ padding:"48px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:12 }}>
                  <span style={{ fontSize:48,opacity:.25 }}>✅</span>
                  <p style={{ fontSize:14,fontWeight:800,color:"#9CA3AF",textAlign:"center" }}>All challenges accepted!</p>
                  <p style={{ fontSize:12,fontWeight:600,color:"#D1D5DB",textAlign:"center" }}>Check the Battles tab to watch live or preview scheduled battles.</p>
                  <button onClick={()=>setTab("battles")} style={{ padding:"10px 22px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>Go to Battles ⚔️</button>
                </div>
              ):challenges.filter(c=>!acceptedIds.has(c.id)).map(c=><ChallengeRow key={c.id} challenge={c} onTap={setSelectedChallenge}/>)}
            </div>
          )}
          {tab==="rankings" && <RankingsTab/>}
          {tab==="battles"  && <BattlesTab battles={battles} onViewChallenge={()=>setTab("challenges")}/>}
          {tab==="agent"    && <AgentChatTab onStartTeach={s=>{ setTeachSession(s); }} agentNameProp={agentProfile.name} agentEmojiProp={agentProfile.emoji}/>}
        </div>

        {/* BOTTOM NAV */}
        <div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:200,background:"rgba(255,255,255,.97)",backdropFilter:"blur(12px)",borderTop:"1px solid #EDE9FE",padding:"8px 0 env(safe-area-inset-bottom,14px)",display:"flex",justifyContent:"space-around",minHeight:62 }}>
          {NAV_ITEMS.map(({key,icon,label})=>{
            const navActive=tab===key;
            return (
              <div key={key} onClick={()=>setTab(key)} style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"pointer",color:navActive?BRAND:"#9CA3AF",minWidth:56,padding:"2px 0" }}>
                <div style={{ position:"relative" }}>
                  <span style={{ fontSize:22 }}>{icon}</span>
                  {key==="sessions"&&totalUnread>0&&<div style={{ position:"absolute",top:-3,right:-6,width:14,height:14,borderRadius:"50%",background:BRAND,display:"flex",alignItems:"center",justifyContent:"center" }}><span style={{ fontSize:8,fontWeight:900,color:"#fff" }}>{totalUnread}</span></div>}
                  {key==="battles"&&activeBattleCount>0&&<div style={{ position:"absolute",top:-3,right:-6,width:14,height:14,borderRadius:"50%",background:RED,display:"flex",alignItems:"center",justifyContent:"center" }}><span style={{ fontSize:8,fontWeight:900,color:"#fff" }}>{activeBattleCount}</span></div>}
                  {key==="agent"&&<div style={{ position:"absolute",top:-2,right:-4,width:8,height:8,borderRadius:"50%",background:GREEN,border:"1.5px solid #fff" }}/>}
                </div>
                <span style={{ fontSize:10.5,fontWeight:navActive?800:600 }}>{label}</span>
              </div>
            );
          })}
        </div>

        {/* FAB — now opens ConfigModal first */}
        {!selectedSession&&!selectedChallenge&&!teachSession&&!configOpen&&tab!=="agent"&&tab!=="battles"&&(
          <div onClick={()=>setConfigOpen(true)} style={{ position:"fixed",bottom:78,right:18,zIndex:900,background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,borderRadius:16,padding:"9px 16px",display:"flex",alignItems:"center",gap:7,boxShadow:`0 4px 18px ${BRAND}50`,cursor:"pointer" }}>
            <MicIcon size={15} color="#fff"/>
            <span style={{ fontSize:12,fontWeight:800,color:"#fff" }}>Start Session</span>
          </div>
        )}

        {/* ── Overlays ── */}

        {/* ConfigModal → opens before TeachAgentModal */}
        {configOpen && (
          <ConfigModal
            initial={configInitial}
            onStart={cfg => {
              setConfigOpen(false);
              setConfigInitial(null);
              // Inject the fetched student AI agent into the config
              setTeachSession({ ...cfg, agentName: agentProfile.name, agentEmoji: agentProfile.emoji });
            }}
            onCancel={() => { setConfigOpen(false); setConfigInitial(null); }}
          />
        )}

        {/* TeachAgentModal — now receives config OR session */}
        {teachSession && (
          <TeachAgentModal
            session={teachSession?.topic ? null : teachSession}
            config={teachSession?.topic ? teachSession : null}
            onClose={()=>setTeachSession(null)}
          />
        )}

        {/* DecaySessionModal — triggered from agent alerts tab */}
        {decaySession && (
          <DecaySessionModal
            alert={decaySession}
            agentProfile={agentProfile}
            onClose={() => setDecaySession(null)}
          />
        )}

        {selectedChallenge && <ChallengeModal challenge={selectedChallenge} onAccept={handleAcceptChallenge} onDecline={()=>setSelectedChallenge(null)} onClose={()=>setSelectedChallenge(null)}/>}
        {selectedSession && <SessionSheet
          session={selectedSession}
          decayAlert={decayBySession[selectedSession.id]||null}
          agentProfile={agentProfile}
          onClose={()=>setSelectedSession(null)}
          onStartTeach={s=>{
            setSelectedSession(null);
            const decay = decayBySession[s.id];
            if (decay) {
              // Revise Teaching → DecaySessionModal
              setDecaySession(decay);
            } else if (s.hasHistory && s.type==="agent") {
              // Continue Teaching → TeachAgentModal with continuation mode
              setTeachSession({ ...s, mode:"continuation", agentName:agentProfile.name, agentEmoji:agentProfile.emoji });
            } else {
              // Fresh Teaching → ConfigModal → TeachAgentModal
              setConfigInitial({ topic:s.topic, subject:s.subject?s.subject.charAt(0).toUpperCase()+s.subject.slice(1):"Science" });
              setConfigOpen(true);
            }
          }}
        />}
        {liveBattleModal   && <BattleModal    battle={liveBattleModal}    onClose={()=>setLiveBattleModal(null)}/>}
        {toast && <Toast msg={toast} color={toast.startsWith("🗓")?BRAND:RED} onDone={()=>setToast(null)}/>}
      </div>
    </>
  );
}
