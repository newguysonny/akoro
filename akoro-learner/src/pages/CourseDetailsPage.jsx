import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { API } from "../services/api.js";
import {
  Brain, Star, Calendar, CalendarPlus, Clock, Users, Video,
  ChevronLeft, ChevronDown, Play, Mic,
  BookOpen, Target, Swords, MessageSquare, Send, Heart,
  Shield, Award, Zap, Radio, MonitorPlay, UserCheck,
  CheckCircle2, Lock, TrendingUp, ThumbsUp, Flag,
  Sparkles, ArrowRight, X, Plus, ExternalLink,
  Crown, Flame, Trophy, Timer, Activity, BarChart2,
  ChevronRight, Bolt, Globe, ShoppingCart, Bell,
  Volume2, VolumeX, Maximize, SkipForward, SkipBack,
  Eye, PlayCircle
} from "lucide-react";

const Styles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap');
    .cdp *{box-sizing:border-box;margin:0;padding:0}
    .cdp{font-family:'DM Sans',sans-serif;background:#F7F5F2;color:#1A1A2E}
    .cdp .font-serif{font-family:'Instrument Serif',Georgia,serif}
    .cdp .font-syne{font-family:'Syne',sans-serif}
    @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.75)}}
    @keyframes livePulse{0%,100%{opacity:1}50%{opacity:.35}}
    @keyframes commentIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes popIn{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}
    @keyframes glow{0%,100%{box-shadow:0 0 12px rgba(232,136,74,.4)}50%{box-shadow:0 0 28px rgba(232,136,74,.7)}}
    @keyframes correctFlash{0%{background:#E8F8EE}100%{background:transparent}}
    @keyframes wrongFlash{0%{background:#FEE2E2}100%{background:transparent}}
    @keyframes xpPop{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-30px) scale(1.3)}}
    @keyframes scrollTicker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
    .cdp .fade-up{animation:fadeUp .55s ease both}
    .cdp .comment-in{animation:commentIn .3s ease both}
    .cdp .live-pulse{animation:livePulse 1.3s ease infinite}
    .cdp .card{background:#fff;border:1px solid #EDE8E1;border-radius:20px}
    .cdp .lift{transition:transform .2s,box-shadow .2s}
    .cdp .lift:hover{transform:translateY(-3px);box-shadow:0 10px 30px rgba(0,0,0,.07)}
    .cdp .swipe-track{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding-bottom:4px;scrollbar-width:none}
    .cdp .swipe-track::-webkit-scrollbar{display:none}
    .cdp .swipe-item{flex:0 0 min(300px,82vw);scroll-snap-align:start}
    @media(min-width:480px){.cdp .swipe-item{flex:0 0 min(320px,70vw)}}
    @media(min-width:640px){.cdp .swipe-item{flex:0 0 min(340px,46vw)}}
    @media(min-width:1024px){.cdp .swipe-item{flex:0 0 min(360px,31%)}}
    .cdp .battle-feed{height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;scrollbar-width:thin;scrollbar-color:#444 transparent}
    .cdp .battle-feed::-webkit-scrollbar{width:3px}
    .cdp .battle-feed::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
    .cdp .agent-ring{box-shadow:0 0 0 2px #fff,0 0 0 4px #E8884A}
    .cdp .agent-ring-blue{box-shadow:0 0 0 2px #fff,0 0 0 4px #3B82F6}
    .cdp .tab-active{background:#1A1A2E;color:#fff}
    .cdp .tab-inactive{background:transparent;color:#6B6B80}
    .cdp .tab-inactive:hover{background:#F0ECE6;color:#1A1A2E}
    .cdp .prog-bar{height:4px;background:#EDE8E1;border-radius:4px;overflow:hidden}
    .cdp .prog-fill{height:100%;background:#E8884A;border-radius:4px;transition:width .5s ease}
    .cdp .hp-bar-wrap{height:10px;background:rgba(255,255,255,.15);border-radius:6px;overflow:hidden}
    .cdp .hp-bar-fill{height:100%;border-radius:6px;transition:width .6s ease}
    .cdp .vs-badge{width:36px;height:36px;border-radius:50%;background:#1A1A2E;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.25)}
    .cdp .section-label{display:inline-flex;align-items:center;gap:8px;font-family:'Syne',sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#E8884A;margin-bottom:10px}
    .cdp .section-label::before{content:'';width:18px;height:2px;background:#E8884A;flex-shrink:0}
    .cdp .ticker-wrap{overflow:hidden;white-space:nowrap}
    .cdp .ticker-inner{display:inline-flex;gap:48px;animation:scrollTicker 28s linear infinite}
    .cdp .ans-opt{transition:all .2s;cursor:pointer;border:1.5px solid rgba(255,255,255,.15);border-radius:14px;padding:12px 16px;background:rgba(255,255,255,.06);color:#E8E2D9;font-size:14px;font-weight:500;text-align:left;width:100%}
    .cdp .ans-opt:hover{background:rgba(255,255,255,.12);border-color:rgba(232,136,74,.5)}
    .cdp .ans-opt.correct{background:rgba(16,185,129,.2);border-color:#10B981;color:#6EF7C8;animation:correctFlash .5s ease}
    .cdp .ans-opt.wrong{background:rgba(239,68,68,.15);border-color:#EF4444;color:#FCA5A5;animation:wrongFlash .5s ease}
    .cdp .ans-opt.revealed{background:rgba(16,185,129,.1);border-color:rgba(16,185,129,.3);color:#6EF7C8}
    .cdp .ans-opt:disabled{cursor:default}
    .cdp .xp-pop{position:absolute;pointer-events:none;font-weight:800;font-size:18px;animation:xpPop .9s ease forwards}
    .cdp .scroll-tabs{display:flex;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
    .cdp .scroll-tabs::-webkit-scrollbar{display:none}
    .cdp .video-player{position:relative;background:#000;overflow:hidden;aspect-ratio:16/9;width:100%}
    .cdp .video-controls{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.85));padding:12px 16px 14px;opacity:0;transition:opacity .3s}
    .cdp .video-player:hover .video-controls,.cdp .video-player.paused .video-controls{opacity:1}
    .cdp .video-progress{height:4px;background:rgba(255,255,255,.3);border-radius:4px;cursor:pointer;transition:height .15s;margin-bottom:10px}
    .cdp .video-progress:hover{height:6px}
    .cdp .type-toggle{display:inline-flex;background:#F0ECE6;border-radius:100px;padding:3px;gap:2px}
    .cdp .type-pill{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:100px;font-size:12px;font-weight:700;cursor:pointer;transition:all .2s;border:none;white-space:nowrap}
    .cdp .type-pill-active{background:#1A1A2E;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.12)}
    .cdp .type-pill-inactive{background:transparent;color:#6B6B80}
    .cdp .type-pill-inactive:hover{color:#1A1A2E}
    .cdp .announce-card{border-left:3px solid #E8884A;background:#FFFAF5;border-radius:0 16px 16px 0;padding:16px}
    .cdp .hero-grid{display:flex;flex-direction:column;gap:20px}
    @media(min-width:640px){.cdp .hero-grid{flex-direction:row;align-items:center}}
    .cdp .about-grid{display:grid;grid-template-columns:1fr;gap:20px}
    @media(min-width:1024px){.cdp .about-grid{grid-template-columns:1fr 1fr 1fr}}
    .cdp .about-main{grid-column:1}
    @media(min-width:1024px){.cdp .about-main{grid-column:span 2}}
    .cdp .teachers-grid{display:grid;grid-template-columns:1fr;gap:20px}
    @media(min-width:640px){.cdp .teachers-grid{grid-template-columns:1fr 1fr}}
    .cdp .stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media(min-width:640px){.cdp .stats-grid{grid-template-columns:repeat(4,1fr)}}
    .cdp .nav-inner{max-width:1100px;margin:0 auto;padding:0 16px;height:56px;display:flex;align-items:center;gap:10px}
    @media(min-width:480px){.cdp .nav-inner{padding:0 20px;gap:12px}}
    .cdp .page-content{max-width:1100px;margin:0 auto;padding:20px 16px 80px;display:flex;flex-direction:column;gap:40px}
    @media(min-width:480px){.cdp .page-content{padding:28px 20px 80px;gap:52px}}
    .cdp .hero-actions{display:flex;flex-direction:column;gap:10px;width:100%}
    @media(min-width:400px){.cdp .hero-actions{flex-direction:row;flex-wrap:wrap}}
    @media(min-width:640px){.cdp .hero-actions{flex-direction:column;width:auto;min-width:180px}}
    .cdp .action-btns{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
    .cdp .tab-row{display:flex;gap:4px;padding:4px;background:#F0ECE6;border-radius:16px;width:fit-content;margin-bottom:24px;flex-wrap:wrap}
    .cdp .battle-modal-inner{width:100%;max-width:680px;border-radius:24px;overflow:hidden;display:flex;flex-direction:column;max-height:95vh;max-height:95dvh}
    @media(min-width:640px){.cdp .battle-modal-inner{border-radius:28px}}
    .cdp .scoreboard-agents{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:4px}
    .cdp .agent-col{flex:1;text-align:center;min-width:0}
    .cdp .vs-col{display:flex;flex-direction:column;align-items:center;gap:4px;padding:0 6px;flex-shrink:0}
    @media(min-width:400px){.cdp .vs-col{padding:0 10px}}
    .cdp .leaderboard-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;transition:all .2s}
    @media(min-width:480px){.cdp .leaderboard-item{gap:12px;padding:12px 14px}}
    .cdp .video-bar{background:#0d1220;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px}
    @media(min-width:480px){.cdp .video-bar{padding:10px 20px}}
    .cdp .enrolled-tab-btn{display:inline-flex;align-items:center;padding:12px 0;margin-right:18px;border-top:none;border-left:none;border-right:none;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;transition:all .2s;background:none;flex-shrink:0}
    @media(min-width:480px){.cdp .enrolled-tab-btn{margin-right:24px}}
    .cdp .module-lesson-row{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid #EDE8E1;transition:colors .2s}
    @media(min-width:480px){.cdp .module-lesson-row{gap:12px;padding:12px 20px}}
  `}</style>
);

const SectionLabel = ({ children }) => <div className="section-label">{children}</div>;

const Btn = ({ children, v = "amber", size = "md", onClick, className = "", disabled }) => {
  const base = "inline-flex items-center gap-2 font-semibold rounded-full border cursor-pointer transition-all duration-200 whitespace-nowrap";
  const sz = { sm: "px-4 py-2 text-[12px]", md: "px-5 py-2.5 text-sm", lg: "px-8 py-3.5 text-[15px]" };
  const vs = {
    amber:   "bg-[#E8884A] border-[#E8884A] text-white shadow-[0_4px_16px_rgba(232,136,74,.28)] hover:brightness-105 hover:-translate-y-px",
    dark:    "bg-[#1A1A2E] border-[#1A1A2E] text-white hover:bg-[#2D2D44] hover:-translate-y-px",
    outline: "bg-white border-[#D4CEC4] text-[#3A3A52] hover:border-[#E8884A] hover:text-[#E8884A]",
    ghost:   "bg-transparent border-transparent text-[#6B6B80] hover:text-[#1A1A2E]",
    green:   "bg-[#10B981] border-[#10B981] text-white hover:brightness-105 hover:-translate-y-px",
    red:     "bg-red-500 border-red-500 text-white hover:brightness-105",
    glass:   "bg-white/10 border-white/20 text-white hover:bg-white/20",
  };
  return <button onClick={onClick} disabled={disabled} className={`${base} ${sz[size]} ${vs[v]} ${className} ${disabled?"opacity-40 cursor-not-allowed":""}`}>{children}</button>;
};

const Avatar = ({ emoji, bg = "#EDE8E1", size = 40, ring }) => (
  <div style={{ width:size, height:size, background:bg, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.44 }}
    className={ring==="amber"?"agent-ring":ring==="blue"?"agent-ring-blue":""}>
    {emoji}
  </div>
);

const LiveBadge = () => (
  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
    <span className="w-1.5 h-1.5 rounded-full bg-white live-pulse"/>LIVE
  </span>
);

const PlatformBadge = ({ p }) => {
  const cfg = { zoom:["#2D8CFF","Zoom"], meet:["#34A853","Google Meet"], teams:["#5B5EA6","MS Teams"] }[p]||["#6B6B80",p];
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-white text-[10px] font-bold" style={{background:cfg[0]}}><Video size={9}/>{cfg[1]}</span>;
};

const StarRow = ({ rating, count }) => (
  <span className="flex items-center gap-1.5 text-xs text-[#6B6B80]">
    <span className="flex">{[...Array(5)].map((_,i)=><Star key={i} size={11} fill={i<Math.round(rating)?"#E8884A":"none"} stroke={i<Math.round(rating)?"none":"#C9C5BE"} strokeWidth={1.5}/>)}</span>
    <strong className="text-[#1A1A2E]">{rating}</strong>{count&&<span>({count})</span>}
  </span>
);

const ALL_AGENTS = [
  { id:"nexus",  name:"Nexus",  emoji:"🤖", owner:"You",         ownerEmoji:"👤",   bg:"#FEF0E6", color:"#E8884A", isYou:true },
  { id:"pythia", name:"Pythia", emoji:"🔮", owner:"Dr. Amara",   ownerEmoji:"👩🏾‍💻", bg:"#EDE8F8", color:"#7C3AED", isTeacher:true },
  { id:"axiom",  name:"Axiom",  emoji:"⚡", owner:"Mr. Tobi",    ownerEmoji:"👨🏾‍🎓", bg:"#FFF4C8", color:"#D97706", isTeacher:true },
  { id:"zeno",   name:"Zeno",   emoji:"🌀", owner:"Chukwuemeka", ownerEmoji:"👦🏾",  bg:"#D4EAD8", color:"#059669" },
  { id:"ada",    name:"Ada",    emoji:"✨", owner:"Ngozi",       ownerEmoji:"👧🏾",  bg:"#E4D4F0", color:"#7C3AED" },
  { id:"sigma",  name:"Sigma",  emoji:"🔺", owner:"Babatunde",   ownerEmoji:"👨🏾",  bg:"#C8D8E8", color:"#2563EB" },
  { id:"lyra",   name:"Lyra",   emoji:"🌙", owner:"Amaka",       ownerEmoji:"👧🏾",  bg:"#F0E4C8", color:"#D97706" },
  { id:"kira",   name:"Kira",   emoji:"💎", owner:"Emeka",       ownerEmoji:"👨🏾",  bg:"#F8E8FF", color:"#9333EA" },
];

const QUESTIONS = [
  { q:"Find dy/dx if y = sin(3x² + 2x)", opts:["cos(3x² + 2x)","(6x + 2)cos(3x² + 2x)","sin(6x + 2)","−cos(3x² + 2x)"], ans:1, topic:"Chain Rule", xp:40 },
  { q:"What is lim(x→0) sin(x)/x?", opts:["0","∞","1","Undefined"], ans:2, topic:"Limits", xp:35 },
  { q:"Integrate ∫ 3x² dx", opts:["6x + C","x³ + C","x³","3x³ + C"], ans:1, topic:"Integration", xp:30 },
  { q:"If f(x) = e^(2x), what is f'(x)?", opts:["e^(2x)","2e^x","2e^(2x)","e^x"], ans:2, topic:"Differentiation", xp:35 },
  { q:"Solve: dy/dx = 2y, given y(0) = 3", opts:["y = 3e^(2x)","y = 2e^(3x)","y = 3 + 2x","y = e^(2x)"], ans:0, topic:"Differential Equations", xp:50 },
  { q:"What is the product rule for d/dx[u·v]?", opts:["u'v'","u'v + uv'","uv' − u'v","(u'v')/(u+v)"], ans:1, topic:"Product Rule", xp:30 },
  { q:"Find ∫ cos(x) dx", opts:["−sin(x) + C","sin(x) + C","cos(x) + C","tan(x) + C"], ans:1, topic:"Integration", xp:25 },
  { q:"What is the derivative of ln(x)?", opts:["x","1/x","e^x","ln(x)/x"], ans:1, topic:"Differentiation", xp:30 },
  { q:"Find lim(x→∞) 1/x", opts:["1","∞","0","Undefined"], ans:2, topic:"Limits", xp:25 },
  { q:"If y = x⁴ − 3x² + 7, find y''", opts:["4x³ − 6x","12x² − 6","x⁵ − x³","4x² − 3"], ans:1, topic:"Differentiation", xp:40 },
  { q:"∫ e^x dx = ?", opts:["e^(x+1)/(x+1)","e^x + C","xe^x + C","1/e^x + C"], ans:1, topic:"Integration", xp:30 },
  { q:"Chain rule: d/dx[f(g(x))] = ?", opts:["f'(x)·g'(x)","f(g'(x))","f'(g(x))·g'(x)","f'(g(x)) + g'(x)"], ans:2, topic:"Chain Rule", xp:35 },
  { q:"Quotient rule: d/dx[u/v] = ?", opts:["(u'v + uv')/v²","(u'v − uv')/v²","u'/v'","(uv' − u'v)/v²"], ans:1, topic:"Quotient Rule", xp:40 },
  { q:"Evaluate ∫₀¹ x dx", opts:["1","1/2","2","0"], ans:1, topic:"Definite Integrals", xp:35 },
  { q:"What is the second derivative of sin(x)?", opts:["cos(x)","−cos(x)","−sin(x)","sin(x)"], ans:2, topic:"Higher Derivatives", xp:40 },
];

const generateBattles = () => {
  const pairs = [[0,1],[2,3],[4,5],[6,7],[1,3],[0,4],[2,6],[5,7],[3,6],[1,5],[0,7],[2,4],[0,3],[4,6],[1,7]];
  const statusPool = ["live","live","live","live","live","upcoming","upcoming","completed","completed","completed"];
  const topicNames = ["Chain Rule Gauntlet","Limits Speed Round","Integration Masters","Differential Equations Duel","Product Rule Sprint","Quotient Rule Challenge","Higher Derivatives Battle","Definite Integrals Race","Mixed Calculus Cup","WAEC Prep Battle","Trig Derivatives Duel","Implicit Differentiation Match"];
  return pairs.map(([ai,bi],i)=>{
    const status=statusPool[i%statusPool.length];
    const a=ALL_AGENTS[ai],b=ALL_AGENTS[bi];
    const aScore=status==="upcoming"?0:Math.floor(Math.random()*10)+2;
    const bScore=status==="upcoming"?0:Math.floor(Math.random()*10)+2;
    const winner=status==="completed"?(aScore>bScore?a.id:b.id):null;
    return {id:i+1,topic:topicNames[i%topicNames.length],question:QUESTIONS[i%QUESTIONS.length],currentQNum:status==="live"?Math.floor(Math.random()*8)+1:0,totalQ:15,status,agentA:{...a,score:aScore,hp:winner===b.id?0:status==="upcoming"?100:Math.max(20,100-bScore*6)},agentB:{...b,score:bScore,hp:winner===a.id?0:status==="upcoming"?100:Math.max(20,100-aScore*6)},winner,startedAgo:status==="live"?Math.floor(Math.random()*8)+1:null,startsIn:status==="upcoming"?`${Math.floor(Math.random()*50)+5}m`:null,viewers:status==="live"?Math.floor(Math.random()*40)+5:0,xpPool:Math.floor(Math.random()*300)+100};
  });
};

const BattleModal = ({ battle: initialBattle, onClose }) => {
  const [battle] = useState(initialBattle);
  const [qIdx, setQIdx] = useState(initialBattle.status==="live"?initialBattle.currentQNum-1:0);
  const [phase, setPhase] = useState(initialBattle.status==="upcoming"?"countdown":"question");
  const [selected, setSelected] = useState(null);
  const [agentPicked, setAgentPicked] = useState(null);
  const [timer, setTimer] = useState(15);
  const [aScore, setAScore] = useState(initialBattle.agentA.score);
  const [bScore, setBScore] = useState(initialBattle.agentB.score);
  const [aHp, setAHp] = useState(initialBattle.agentA.hp);
  const [bHp, setBHp] = useState(initialBattle.agentB.hp);
  const [log, setLog] = useState([]);
  const [xpGained, setXpGained] = useState(0);
  const [showXp, setShowXp] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [myStreak, setMyStreak] = useState(0);
  const [tickerItems, setTickerItems] = useState([]);
  const [currentTab, setCurrentTab] = useState("watch");
  const logRef = useRef(null);
  const timerRef = useRef(null);
  const questionRef = useRef(qIdx);
  questionRef.current = qIdx;
  const q = QUESTIONS[qIdx%QUESTIONS.length];
  const isCompleted = phase==="over"||initialBattle.status==="completed";

  useEffect(()=>{
    const msgs=ALL_AGENTS.map(a=>`${a.emoji} ${a.name} is battling in ${Math.floor(Math.random()*5)+1} active matches`).concat(["🏆 Nexus just won a Chain Rule battle!","⚡ Axiom answered 5 in a row correctly!","🔥 12 battles live right now in this class","💎 Kira is on a 7-answer streak!","🌀 Zeno defeated Sigma in Limits Speed Round"]);
    setTickerItems([...msgs,...msgs]);
  },[]);

  useEffect(()=>{
    if(phase!=="countdown")return;
    if(countdown<=0){setPhase("question");setTimer(15);return;}
    const t=setTimeout(()=>setCountdown(c=>c-1),1000);
    return()=>clearTimeout(t);
  },[phase,countdown]);

  useEffect(()=>{
    if(phase!=="question")return;
    if(timer<=0){autoReveal();return;}
    timerRef.current=setTimeout(()=>setTimer(t=>t-1),1000);
    return()=>clearTimeout(timerRef.current);
  },[phase,timer]);

  const addLog=(msg,type="neutral")=>{
    setLog(prev=>[...prev.slice(-40),{msg,type,ts:new Date().toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}]);
    setTimeout(()=>{if(logRef.current)logRef.current.scrollTop=logRef.current.scrollHeight;},50);
  };

  const autoReveal=useCallback(()=>{
    clearTimeout(timerRef.current);
    const correctIdx=q.ans;
    const aCorrect=Math.random()>0.32;
    const bCorrect=Math.random()>0.28;
    const aPick=aCorrect?correctIdx:(correctIdx+1+Math.floor(Math.random()*3))%4;
    const bPick=bCorrect?correctIdx:(correctIdx+2+Math.floor(Math.random()*3))%4;
    setAgentPicked({a:aPick,b:bPick,correct:correctIdx});
    setPhase("revealing");
    if(aCorrect){setAScore(s=>s+1);setBHp(h=>Math.max(0,h-8));addLog(`✅ ${battle.agentA.name} answered CORRECTLY — ${q.opts[correctIdx]}`,"success");}
    else addLog(`❌ ${battle.agentA.name} answered wrong — chose ${q.opts[aPick]}`,"error");
    if(bCorrect){setBScore(s=>s+1);setAHp(h=>Math.max(0,h-8));addLog(`✅ ${battle.agentB.name} answered CORRECTLY — ${q.opts[correctIdx]}`,"success");}
    else addLog(`❌ ${battle.agentB.name} answered wrong — chose ${q.opts[bPick]}`,"error");
    if(aCorrect&&bCorrect)addLog(`⚡ Both agents correct! Speed will decide!`,"neutral");
    if(!aCorrect&&!bCorrect)addLog(`😬 Both agents wrong! Free question!`,"neutral");
    setTimeout(()=>{
      const newQIdx=questionRef.current+1;
      if(newQIdx>=QUESTIONS.length||aHp<=0||bHp<=0){setPhase("over");addLog("🏁 Battle complete!","neutral");return;}
      setQIdx(newQIdx);setSelected(null);setAgentPicked(null);setTimer(15);setPhase("question");
      addLog(`━━━ Q${newQIdx+1}: ${QUESTIONS[newQIdx%QUESTIONS.length].topic} ━━━`,"topic");
    },2800);
  },[q,battle.agentA.name,battle.agentB.name]);

  const handleAnswer=(idx)=>{
    if(phase!=="question"||selected!==null)return;
    setSelected(idx);clearTimeout(timerRef.current);
    if(idx===q.ans){const gain=q.xp+myStreak*5;setXpGained(g=>g+gain);setMyStreak(s=>s+1);setShowXp(true);addLog(`🎯 YOU answered correctly! +${gain} XP`,"you");setTimeout(()=>setShowXp(false),900);}
    else{setMyStreak(0);addLog(`You chose wrong. Correct: ${q.opts[q.ans]}`,"error");}
    setTimeout(()=>autoReveal(),600);
  };

  const rematch=()=>{setQIdx(0);setAScore(0);setBScore(0);setAHp(100);setBHp(100);setLog([]);setSelected(null);setAgentPicked(null);setPhase("countdown");setCountdown(3);};
  const timerPct=(timer/15)*100;
  const timerColor=timer>8?"#10B981":timer>4?"#F59E0B":"#EF4444";
  const aWinning=aScore>bScore;
  const finalWinner=aScore>=bScore?battle.agentA:battle.agentB;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-2 sm:p-5" style={{background:"rgba(0,0,0,.82)",backdropFilter:"blur(8px)"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="battle-modal-inner" style={{background:"linear-gradient(160deg,#0f1320,#141c2e,#1a1430)",border:"1px solid rgba(255,255,255,.1)"}}>
        <div className="ticker-wrap bg-black/30 py-2 border-b border-white/10">
          <div className="ticker-inner text-[10px] text-white/50 font-semibold tracking-wide">{tickerItems.map((t,i)=><span key={i} className="px-6">⚔️ {t}</span>)}</div>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div className="flex items-center gap-3">
            {!isCompleted&&phase!=="countdown"&&<LiveBadge/>}
            {isCompleted&&<span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-white/10 text-white/60">COMPLETED</span>}
            <span className="text-white font-syne font-bold text-sm">{battle.topic}</span>
            <span className="text-white/40 text-xs">#{battle.id}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-white/50 text-xs flex items-center gap-1"><Users size={11}/>{battle.viewers} watching</span>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:bg-white/20 hover:text-white transition-all"><X size={15}/></button>
          </div>
        </div>
        <div className="flex gap-1 px-5 pt-3 pb-0">
          {["watch","stats","log"].map(t=>(
            <button key={t} onClick={()=>setCurrentTab(t)} className={`px-4 py-1.5 rounded-full text-xs font-semibold capitalize transition-all ${currentTab===t?"bg-[#E8884A] text-white":"bg-white/10 text-white/50 hover:bg-white/15 hover:text-white"}`}>
              {t==="watch"?"⚔️ Battle":t==="stats"?"📊 Stats":"📋 Log"}
            </button>
          ))}
        </div>

        {currentTab==="watch"&&(
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            <div className="rounded-2xl p-4" style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)"}}>
              <div className="scoreboard-agents">
                <div className="agent-col">
                  <div style={{width:52,height:52,background:battle.agentA.bg,borderRadius:"50%",margin:"0 auto 8px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,boxShadow:aWinning?`0 0 20px ${battle.agentA.color}88`:"none",transition:"box-shadow .4s"}}>{battle.agentA.emoji}</div>
                  <div className="text-white font-bold text-sm">{battle.agentA.name}</div>
                  <div className="text-white/40 text-[10px]">{battle.agentA.owner}</div>
                  {battle.agentA.isTeacher&&<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#E8884A]/20 text-[#E8884A] font-bold">TEACHER</span>}
                  {battle.agentA.isYou&&<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-white font-bold">YOU</span>}
                  <div className="font-syne text-3xl font-extrabold mt-2" style={{color:battle.agentA.color}}>{aScore}</div>
                  <div className="mt-2"><div className="hp-bar-wrap"><div className="hp-bar-fill" style={{width:aHp+"%",background:aHp>50?"#10B981":aHp>25?"#F59E0B":"#EF4444"}}/></div><div className="text-[10px] text-white/40 mt-0.5">{aHp} HP</div></div>
                </div>
                <div className="vs-col">
                  <div className="vs-badge text-sm">VS</div>
                  {!isCompleted&&phase==="question"&&(
                    <div className="relative w-10 h-10 mt-1">
                      <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90"><circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="3"/><circle cx="18" cy="18" r="15" fill="none" stroke={timerColor} strokeWidth="3" strokeDasharray="94.2" strokeDashoffset={94.2*(1-timerPct/100)} strokeLinecap="round" style={{transition:"stroke-dashoffset .9s linear,stroke .3s"}}/></svg>
                      <div className="absolute inset-0 flex items-center justify-center font-syne font-extrabold text-sm" style={{color:timerColor}}>{timer}</div>
                    </div>
                  )}
                  {!isCompleted&&<div className="text-white/40 text-[10px] text-center">Q{qIdx+1}/{QUESTIONS.length}</div>}
                  {isCompleted&&<div className="text-[10px] text-white/40">Final</div>}
                </div>
                <div className="agent-col">
                  <div style={{width:52,height:52,background:battle.agentB.bg,borderRadius:"50%",margin:"0 auto 8px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26}}>{battle.agentB.emoji}</div>
                  <div className="text-white font-bold text-sm">{battle.agentB.name}</div>
                  <div className="text-white/40 text-[10px]">{battle.agentB.owner}</div>
                  {battle.agentB.isTeacher&&<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#E8884A]/20 text-[#E8884A] font-bold">TEACHER</span>}
                  {battle.agentB.isYou&&<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-white font-bold">YOU</span>}
                  <div className="font-syne text-3xl font-extrabold mt-2" style={{color:battle.agentB.color}}>{bScore}</div>
                  <div className="mt-2"><div className="hp-bar-wrap"><div className="hp-bar-fill" style={{width:bHp+"%",background:bHp>50?"#10B981":bHp>25?"#F59E0B":"#EF4444"}}/></div><div className="text-[10px] text-white/40 mt-0.5">{bHp} HP</div></div>
                </div>
              </div>
            </div>
            {phase==="countdown"&&<div className="flex flex-col items-center justify-center py-10 gap-2"><div className="text-white/50 text-sm font-semibold mb-2">Battle starting</div><div className="font-syne text-8xl font-extrabold text-[#E8884A]" style={{textShadow:"0 0 40px rgba(232,136,74,.6)"}}>{countdown||"GO!"}</div><div className="text-white/40 text-sm mt-2">Get ready to compete!</div></div>}
            {phase==="over"&&<div className="flex flex-col items-center justify-center py-6 gap-3"><Trophy size={40} color="#E8884A"/><div className="font-serif text-white text-2xl text-center">{finalWinner.name} wins!</div><div className="text-white/50 text-sm">{aScore}–{bScore} final score</div>{xpGained>0&&<div className="px-4 py-2 rounded-full bg-[#E8884A]/20 text-[#E8884A] font-bold text-sm">+{xpGained} XP earned</div>}<div className="flex gap-2 mt-2"><Btn v="glass" size="sm" onClick={rematch}>⚔️ Rematch</Btn><Btn v="amber" size="sm" onClick={onClose}>Done</Btn></div></div>}
            {(phase==="question"||phase==="revealing")&&!isCompleted&&(
              <div className="relative">
                {showXp&&<div className="xp-pop text-[#E8884A] left-1/2 top-0" style={{zIndex:10,transform:"translateX(-50%)"}}>+{q.xp+myStreak*5} XP!</div>}
                <div className="rounded-2xl p-4 mb-3" style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)"}}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#E8884A]/20 text-[#E8884A]">{q.topic}</span>
                    <span className="text-[10px] text-white/40">+{q.xp} XP</span>
                    {myStreak>1&&<span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400">🔥 {myStreak}× streak!</span>}
                  </div>
                  <div className="text-white font-semibold text-base leading-snug">{q.q}</div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {q.opts.map((opt,i)=>{
                    let cls="ans-opt";
                    if(phase==="revealing"&&agentPicked){if(i===q.ans)cls+=" revealed";else if(i===selected&&selected!==q.ans)cls+=" wrong";}
                    if(selected===i&&phase==="question")cls+=" border-[#E8884A] bg-white/10";
                    return(
                      <button key={i} className={cls} onClick={()=>handleAnswer(i)} disabled={selected!==null||phase==="revealing"}>
                        <span className="flex items-center gap-3"><span className="w-6 h-6 rounded-full border border-white/20 flex items-center justify-center text-[11px] font-bold text-white/50 flex-shrink-0">{["A","B","C","D"][i]}</span>{opt}</span>
                        {phase==="revealing"&&agentPicked&&(
                          <span className="flex gap-1 mt-1.5">
                            {agentPicked.a===i&&<span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{background:battle.agentA.color+"33",color:battle.agentA.color}}>{battle.agentA.emoji}</span>}
                            {agentPicked.b===i&&<span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{background:battle.agentB.color+"33",color:battle.agentB.color}}>{battle.agentB.emoji}</span>}
                            {selected===i&&<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white">You</span>}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {selected===null&&phase==="question"&&<div className="mt-3 text-center text-white/40 text-xs">Pick an answer to compete — or watch the agents battle!</div>}
              </div>
            )}
            {isCompleted&&<div className="rounded-2xl p-5 text-center" style={{background:"rgba(255,255,255,.05)"}}><Trophy size={28} color="#E8884A" className="mx-auto mb-2"/><div className="text-white font-bold mb-1">{battle.agentA.score>battle.agentB.score?battle.agentA.name:battle.agentB.name} won</div><div className="text-white/50 text-sm">{battle.agentA.score}–{battle.agentB.score}</div><Btn v="amber" size="sm" className="mt-4" onClick={rematch}>⚔️ Play rematch</Btn></div>}
          </div>
        )}
        {currentTab==="stats"&&(
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              {[{label:"Total XP this battle",val:xpGained+(battle.xpPool||0),color:"#E8884A"},{label:"Questions answered",val:qIdx,color:"#10B981"},{label:"Your streak",val:`${myStreak}🔥`,color:"#F59E0B"},{label:"Viewers watching",val:battle.viewers,color:"#3B82F6"}].map(({label,val,color})=>(
                <div key={label} className="rounded-2xl p-4" style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)"}}><div className="font-syne text-2xl font-extrabold mb-1" style={{color}}>{val}</div><div className="text-white/40 text-[11px]">{label}</div></div>
              ))}
            </div>
            <div className="rounded-2xl p-4" style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)"}}>
              <div className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">Head to head</div>
              {[{label:"Score",aVal:aScore,bVal:bScore},{label:"HP remaining",aVal:aHp,bVal:bHp},{label:"Accuracy",aVal:aScore>0?Math.round((aScore/Math.max(qIdx,1))*100)+"%":"—",bVal:bScore>0?Math.round((bScore/Math.max(qIdx,1))*100)+"%":"—"}].map(({label,aVal,bVal})=>(
                <div key={label} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                  <span className="font-syne font-bold text-sm w-8 text-center" style={{color:battle.agentA.color}}>{aVal}</span>
                  <span className="flex-1 text-center text-white/40 text-xs">{label}</span>
                  <span className="font-syne font-bold text-sm w-8 text-center" style={{color:battle.agentB.color}}>{bVal}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {currentTab==="log"&&(
          <div className="flex-1 px-5 py-4 flex flex-col">
            <div ref={logRef} className="battle-feed flex-1">
              {log.length===0&&<div className="text-white/30 text-sm text-center py-8">Battle log will appear here as questions progress...</div>}
              {log.map((entry,i)=>(
                <div key={i} className="comment-in flex items-start gap-2 text-xs">
                  <span className="text-white/30 flex-shrink-0 font-mono">{entry.ts}</span>
                  <span className={entry.type==="success"?"text-green-400":entry.type==="error"?"text-red-400":entry.type==="you"?"text-[#E8884A]":entry.type==="topic"?"text-white/60 font-bold":"text-white/50"}>{entry.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs text-white/40">
            <span className="flex items-center gap-1"><Flame size={11} className="text-orange-400"/>24/7 Knowledge Battle</span>
            <span>·</span>
            <span className="flex items-center gap-1"><BookOpen size={11}/>Further Maths class</span>
          </div>
          <div className="flex items-center gap-2"><Btn v="glass" size="sm"><Swords size={11}/>Challenge</Btn></div>
        </div>
      </div>
    </div>
  );
};

const ChallengesSection = () => {
  const [battles] = useState(()=>generateBattles());
  const [watching, setWatching] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [leaderTab, setLeaderTab] = useState("wins");
  const liveBattles=battles.filter(b=>b.status==="live");
  const upcomingBattles=battles.filter(b=>b.status==="upcoming");
  const completedBattles=battles.filter(b=>b.status==="completed");
  const leaderboard=ALL_AGENTS.map(ag=>{
    const wins=completedBattles.filter(b=>b.winner===ag.id).length;
    const losses=completedBattles.filter(b=>(b.agentA.id===ag.id||b.agentB.id===ag.id)&&b.winner!==ag.id).length;
    const liveCount=liveBattles.filter(b=>b.agentA.id===ag.id||b.agentB.id===ag.id).length;
    const totalScore=battles.filter(b=>b.agentA.id===ag.id).reduce((s,b)=>s+b.agentA.score,0)+battles.filter(b=>b.agentB.id===ag.id).reduce((s,b)=>s+b.agentB.score,0);
    return {...ag,wins,losses,liveCount,totalScore};
  }).sort((a,b)=>leaderTab==="wins"?b.wins-a.wins:b.totalScore-a.totalScore);

  const HPBar=({hp,color})=>(
    <div className="w-full h-1.5 bg-[#EDE8E1] rounded-full overflow-hidden"><div className="h-full rounded-full transition-all duration-500" style={{width:hp+"%",background:color}}/></div>
  );

  const BattleCard=({b})=>{
    const aWin=b.status==="completed"&&b.winner===b.agentA.id;
    const bWin=b.status==="completed"&&b.winner===b.agentB.id;
    return(
      <div className="swipe-item">
        <div className={`card lift p-5 h-full flex flex-col gap-3 ${b.status==="live"?"border-[#E8884A]":""}`} style={b.status==="live"?{background:"linear-gradient(140deg,#FFFAF5,#FFF7EE)"}:{}}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-[#1A1A2E] leading-snug mb-0.5">{b.topic}</h4>
              <div className="flex items-center gap-1.5 flex-wrap">
                {b.status==="live"&&<LiveBadge/>}
                {b.status==="upcoming"&&<span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FEF0E6] border border-[#FACCA8] text-[#E8884A]">Q{b.currentQNum||"—"} · in {b.startsIn}</span>}
                {b.status==="completed"&&<span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#E8F8EE] text-[#2AA76E]">Ended</span>}
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F0ECE6] text-[#9490A0]">{b.question.topic}</span>
              </div>
            </div>
            {b.status==="live"&&<span className="text-[10px] text-[#9490A0] flex items-center gap-1 flex-shrink-0"><Users size={10}/>{b.viewers}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 text-center">
              <div className="relative inline-block"><Avatar emoji={b.agentA.emoji} bg={b.agentA.bg} size={42} ring={b.agentA.isYou?"amber":undefined}/>{aWin&&<div className="absolute -top-2 -right-2 text-base">👑</div>}</div>
              <div className="text-[11px] font-bold text-[#1A1A2E] mt-1">{b.agentA.name}</div>
              <div className="text-[10px] text-[#9490A0]">{b.agentA.owner}</div>
              {b.agentA.isTeacher&&<div className="text-[9px] text-[#E8884A] font-bold">Teacher</div>}
              {b.agentA.isYou&&<div className="text-[9px] text-white bg-[#1A1A2E] px-1.5 rounded-full inline-block">You</div>}
              <div className="font-syne font-extrabold text-xl mt-0.5" style={{color:b.agentA.color}}>{b.agentA.score}</div>
              <HPBar hp={b.agentA.hp} color={b.agentA.color}/>
            </div>
            <div className="vs-badge">VS</div>
            <div className="flex-1 text-center">
              <div className="relative inline-block"><Avatar emoji={b.agentB.emoji} bg={b.agentB.bg} size={42} ring={b.agentB.isYou?"amber":undefined}/>{bWin&&<div className="absolute -top-2 -right-2 text-base">👑</div>}</div>
              <div className="text-[11px] font-bold text-[#1A1A2E] mt-1">{b.agentB.name}</div>
              <div className="text-[10px] text-[#9490A0]">{b.agentB.owner}</div>
              {b.agentB.isTeacher&&<div className="text-[9px] text-[#E8884A] font-bold">Teacher</div>}
              {b.agentB.isYou&&<div className="text-[9px] text-white bg-[#1A1A2E] px-1.5 rounded-full inline-block">You</div>}
              <div className="font-syne font-extrabold text-xl mt-0.5" style={{color:b.agentB.color}}>{b.agentB.score}</div>
              <HPBar hp={b.agentB.hp} color={b.agentB.color}/>
            </div>
          </div>
          {b.status==="live"&&(
            <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#EDE8E1]">
              <div className="text-[10px] font-bold uppercase text-[#9490A0] tracking-wider mb-1">Q{b.currentQNum} / {b.totalQ}</div>
              <div className="text-xs text-[#3A3A52] font-medium leading-snug line-clamp-2">{b.question.q}</div>
              <div className="w-full bg-[#EDE8E1] rounded-full h-1 mt-2"><div className="h-1 rounded-full bg-[#E8884A]" style={{width:`${(b.currentQNum/b.totalQ)*100}%`}}/></div>
            </div>
          )}
          <div className="mt-auto flex gap-2">
            <button onClick={()=>setWatching(b)} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-full text-xs font-bold transition-all" style={{background:b.status==="live"?"#E8884A":"#1A1A2E",color:"#fff",border:"none",cursor:"pointer"}}>
              {b.status==="live"?<><Activity size={12}/>Watch live</>:b.status==="upcoming"?<><Play size={12}/>Preview</>:<><Trophy size={12}/>View result</>}
            </button>
            {b.status==="live"&&<button onClick={()=>setWatching(b)} className="px-3 py-2 rounded-full text-xs font-bold bg-[#FAF8F5] border border-[#EDE8E1] text-[#6B6B80] hover:border-[#E8884A] hover:text-[#E8884A] transition-all"><Swords size={12}/></button>}
          </div>
        </div>
      </div>
    );
  };

  return(
    <section>
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div><SectionLabel>24/7 Knowledge Battles</SectionLabel><h2 className="font-serif text-xl sm:text-2xl lg:text-3xl text-[#1A1A2E]">Agent vs Agent — <em className="text-[#E8884A]" style={{fontStyle:"italic"}}>always on</em></h2><p className="text-[#6B6B80] text-sm mt-1">Agents battle around the clock based on this class's curriculum. Watch, compete, or challenge anyone.</p></div>
        <div className="flex gap-2 flex-wrap"><Btn v="amber" size="sm"><Swords size={13}/>New challenge</Btn></div>
      </div>
      <div className="stats-grid mb-6">
        {[{icon:<Activity size={16} color="#EF4444"/>,val:liveBattles.length,label:"Live battles",color:"rgba(239,68,68,.08)",border:"rgba(239,68,68,.2)"},{icon:<Clock size={16} color="#E8884A"/>,val:upcomingBattles.length,label:"Starting soon",color:"rgba(232,136,74,.08)",border:"rgba(232,136,74,.2)"},{icon:<Trophy size={16} color="#10B981"/>,val:completedBattles.length,label:"Completed today",color:"rgba(16,185,129,.08)",border:"rgba(16,185,129,.2)"},{icon:<Users size={16} color="#3B82F6"/>,val:ALL_AGENTS.length,label:"Agents active",color:"rgba(59,130,246,.08)",border:"rgba(59,130,246,.2)"}].map(({icon,val,label,color,border})=>(
          <div key={label} className="rounded-2xl p-4 flex items-center gap-3" style={{background:color,border:`1px solid ${border}`}}>{icon}<div><div className="font-syne font-extrabold text-xl text-[#1A1A2E]">{val}</div><div className="text-[11px] text-[#6B6B80]">{label}</div></div></div>
        ))}
      </div>
      <div className="flex gap-1.5 mb-4 p-1 bg-[#F0ECE6] rounded-xl w-fit">
        {[["all","All battles"],["live","🔴 Live now"]].map(([k,l])=>(
          <button key={k} onClick={()=>setFilterStatus(k)} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${filterStatus===k?"tab-active":"tab-inactive"}`}>{l}</button>
        ))}
      </div>
      {filterStatus==="all"&&liveBattles.length>0&&<div className="flex items-center gap-2 mb-3"><div className="w-2 h-2 rounded-full bg-red-500 live-pulse"/><span className="text-xs font-bold text-red-500 uppercase tracking-wider">Live now · {liveBattles.length} battles</span></div>}
      <div className="swipe-track mb-6">{(filterStatus==="live"?liveBattles:battles).map(b=><BattleCard key={b.id} b={b}/>)}</div>
      {filterStatus==="all"&&(
        <>
          <div className="flex items-center gap-2 mb-3 mt-2"><Clock size={13} color="#E8884A"/><span className="text-xs font-bold text-[#E8884A] uppercase tracking-wider">Starting soon · {upcomingBattles.length} scheduled</span></div>
          <div className="swipe-track mb-6">{upcomingBattles.map(b=><BattleCard key={b.id} b={b}/>)}</div>
          <div className="flex items-center gap-2 mb-3"><Trophy size={13} color="#6B6B80"/><span className="text-xs font-bold text-[#6B6B80] uppercase tracking-wider">Completed today · {completedBattles.length} results</span></div>
          <div className="swipe-track mb-8">{completedBattles.map(b=><BattleCard key={b.id} b={b}/>)}</div>
        </>
      )}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div><div className="font-syne font-bold text-[#1A1A2E] text-sm">Class Leaderboard</div><div className="text-[11px] text-[#9490A0]">Rankings based on this class's battles</div></div>
          <div className="flex gap-1 p-0.5 bg-[#F0ECE6] rounded-xl">{[["wins","Wins"],["score","Score"]].map(([k,l])=><button key={k} onClick={()=>setLeaderTab(k)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${leaderTab===k?"tab-active":"tab-inactive"}`}>{l}</button>)}</div>
        </div>
        <div className="flex flex-col gap-1">
          {leaderboard.slice(0,6).map((ag,i)=>(
            <div key={ag.id} className={`leaderboard-item ${ag.isYou?"bg-[#FEF0E6] border border-[#FACCA8]":"hover:bg-[#FAF8F5]"}`}>
              <div className="font-syne font-extrabold text-lg w-6 text-center" style={{color:i===0?"#F59E0B":i===1?"#9CA3AF":i===2?"#CD7C2F":"#C9C5BE"}}>{i===0?"👑":i+1}</div>
              <Avatar emoji={ag.emoji} bg={ag.bg} size={34} ring={ag.isYou?"amber":undefined}/>
              <div className="flex-1 min-w-0"><div className="text-sm font-bold text-[#1A1A2E] flex items-center gap-1.5">{ag.name}{ag.isTeacher&&<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#FEF0E6] text-[#E8884A] font-bold">Teacher</span>}{ag.isYou&&<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#1A1A2E] text-white font-bold">You</span>}</div><div className="text-[11px] text-[#9490A0]">{ag.owner} · {ag.liveCount>0?<span className="text-red-500 font-semibold">{ag.liveCount} live</span>:"idle"}</div></div>
              <div className="text-right"><div className="font-syne font-extrabold text-base" style={{color:ag.isYou?"#E8884A":"#1A1A2E"}}>{leaderTab==="wins"?ag.wins:ag.totalScore}</div><div className="text-[10px] text-[#9490A0]">{leaderTab==="wins"?`${ag.losses}L`:"pts"}</div></div>
            </div>
          ))}
        </div>
      </div>
      {watching&&<BattleModal battle={watching} onClose={()=>setWatching(null)}/>}
    </section>
  );
};

const RevisionSection = () => {
  const sessions=[
    {id:1,topic:"Chain Rule deep-dive",host:"Chukwuemeka O.",hostEmoji:"👦🏾",hostBg:"#D4EAD8",time:"Starts in 12 min",participants:8,max:12,subject:"Differentiation",status:"starting",platform:"meet"},
    {id:2,topic:"Integration by Parts Q&A",host:"Ngozi A.",hostEmoji:"👧🏾",hostBg:"#E4D4F0",time:"Live now",participants:6,max:10,subject:"Integration",status:"live",platform:"zoom"},
    {id:3,topic:"Differential Equations Study Hall",host:"Tobi M.",hostEmoji:"👦🏾",hostBg:"#C8D8E8",time:"Tomorrow · 4 PM",participants:0,max:15,subject:"ODEs",status:"upcoming",platform:"teams"},
    {id:4,topic:"WAEC Past Papers Sprint",host:"Amaka S.",hostEmoji:"👧🏾",hostBg:"#F0E4C8",time:"Sat · 10 AM",participants:0,max:20,subject:"Exam prep",status:"upcoming",platform:"zoom"},
  ];
  return(
    <section>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <div><SectionLabel>Peer Revision</SectionLabel><h2 className="font-serif text-xl sm:text-2xl lg:text-3xl text-[#1A1A2E]">Group review sessions <em className="text-[#E8884A]" style={{fontStyle:"italic"}}>by students</em></h2></div>
        <Btn v="amber" size="sm"><Plus size={13}/>Host a session</Btn>
      </div>
      <div className="swipe-track">
        {sessions.map(s=>(
          <div key={s.id} className="swipe-item">
            <div className="card lift p-5 h-full flex flex-col gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  {s.status==="live"&&<LiveBadge/>}
                  {s.status==="starting"&&<span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#FEF0E6] border border-[#FACCA8] text-[#E8884A]">Starting soon</span>}
                  {s.status==="upcoming"&&<span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#F0ECE6] text-[#9490A0]">Upcoming</span>}
                  <PlatformBadge p={s.platform}/>
                </div>
                <h4 className="text-sm font-bold text-[#1A1A2E]">{s.topic}</h4>
                <span className="text-[11px] font-semibold text-[#E8884A]">{s.subject}</span>
              </div>
              <div className="flex items-center gap-2.5"><Avatar emoji={s.hostEmoji} bg={s.hostBg} size={32}/><div><div className="text-xs font-semibold">{s.host}</div><div className="text-[11px] text-[#9490A0] flex items-center gap-1"><Clock size={10}/>{s.time}</div></div></div>
              <div><div className="flex justify-between text-[11px] text-[#9490A0] mb-1.5"><span><Users size={10} className="inline mr-1"/>{s.participants}/{s.max}</span><span>{Math.round((s.participants/s.max)*100)}% full</span></div><div className="prog-bar"><div className="prog-fill" style={{width:`${(s.participants/s.max)*100}%`}}/></div></div>
              <div className="mt-auto">
                {s.status==="live"&&<Btn v="green" className="w-full justify-center" size="sm"><Video size={12}/>Join</Btn>}
                {s.status==="starting"&&<Btn v="amber" className="w-full justify-center" size="sm"><Video size={12}/>Join early</Btn>}
                {s.status==="upcoming"&&<Btn v="outline" className="w-full justify-center" size="sm"><CalendarPlus size={12}/>Reserve</Btn>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const REVIEW_AVATARS = ["👦🏾","👧🏾","👨🏾‍💼","👩🏻","🧑🏽","👨🏿","👩🏾"];
const REVIEW_BGS = ["#D4EAD8","#E4D4F0","#C8D8E8","#F0E4C8","#F8E8FF","#FFE8C0"];
const ReviewsSection = ({ reviews: realReviews }) => {
  const DEFAULT_REVIEWS=[
    {emoji:"👦🏾",bg:"#D4EAD8",name:"Chukwuemeka O.",role:"SS3, Lagos",rating:5,date:"2 days ago",text:"Dr. Amara breaks down chain rule in a way that finally clicked. Agent battles keep me sharp.",result:"D7 → B2"},
    {emoji:"👧🏾",bg:"#E4D4F0",name:"Ngozi A.",role:"SS2, Abuja",rating:5,date:"1 week ago",text:"Live sessions are interactive, not just lectures. The group revision rooms are unreal for accountability.",result:"+38 pts JAMB mock"},
    {emoji:"👨🏾‍💼",bg:"#C8D8E8",name:"Babatunde F.",role:"A-Level, UK",rating:4,date:"2 weeks ago",text:"Solid class. AI agent feedback on answers feels like a personal tutor. Would love more practice Q.",result:"C → A* target"},
    {emoji:"👩🏻",bg:"#F0E4C8",name:"Zainab I.",role:"University yr1, Kano",rating:5,date:"3 weeks ago",text:"Failed first-year calculus twice. Started this class and I finally get it. Spaced repetition is magic.",result:"Passed resit"},
  ];
  const reviews = realReviews?.length
    ? realReviews.map((r,i)=>({ emoji:REVIEW_AVATARS[i%REVIEW_AVATARS.length], bg:REVIEW_BGS[i%REVIEW_BGS.length], name:r.name, role:"Student", rating:r.rating, date:r.date, text:r.text, result:null }))
    : DEFAULT_REVIEWS;
  return(
    <section>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <div><SectionLabel>Reviews</SectionLabel><h2 className="font-serif text-xl sm:text-2xl lg:text-3xl text-[#1A1A2E]">What students <em className="text-[#E8884A]" style={{fontStyle:"italic"}}>actually say</em></h2></div>
        <Btn v="outline" size="sm">Write a review</Btn>
      </div>
      <div className="swipe-track">
        {reviews.map((r,i)=>(
          <div key={i} className="swipe-item">
            <div className="card lift p-5 h-full flex flex-col gap-4">
              <div className="flex items-center gap-3"><Avatar emoji={r.emoji} bg={r.bg} size={40}/><div><div className="text-sm font-bold">{r.name}</div><div className="text-[11px] text-[#9490A0]">{r.role}</div></div><span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#E8F8EE] text-[#2AA76E]">Verified</span></div>
              <div className="flex items-center justify-between"><div className="flex">{[...Array(r.rating)].map((_,j)=><Star key={j} size={12} fill="#E8884A" strokeWidth={0}/>)}</div><span className="text-[11px] text-[#9490A0]">{r.date}</span></div>
              <p className="text-sm text-[#3A3A52] leading-relaxed italic flex-1">"{r.text}"</p>
              {r.result&&<div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FEF0E6] text-[#E8884A] text-[11px] font-bold mt-auto"><TrendingUp size={10}/>{r.result}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

/* ─── MODULE DATA (fallback) ─── */
const DEFAULT_MODULES = [
  { title:"Module 1: Foundations of Calculus", lessons:[
    {title:"Introduction to limits",        duration:"9min",  done:true,  type:"video"},
    {title:"Continuity & discontinuities",  duration:"11min", done:true,  type:"video"},
    {title:"The concept of a derivative",   duration:"13min", done:true,  type:"video"},
    {title:"Quiz: Limits",                  duration:"—",     done:true,  type:"quiz"},
  ]},
  { title:"Module 2: Differentiation Techniques", lessons:[
    {title:"Chain Rule",                    duration:"14min", done:true,  type:"video"},
    {title:"Product & Quotient Rule",       duration:"16min", done:true,  type:"video"},
    {title:"Implicit Differentiation",      duration:"12min", done:false, type:"video"},
    {title:"Quiz: Differentiation",         duration:"—",     done:false, type:"quiz"},
  ]},
  { title:"Module 3: Integration", lessons:[
    {title:"Antiderivatives",               duration:"11min", done:false, type:"video"},
    {title:"Integration by Substitution",   duration:"15min", done:false, type:"video"},
    {title:"Integration by Parts",          duration:"18min", done:false, type:"video"},
    {title:"Definite Integrals",            duration:"13min", done:false, type:"video"},
  ]},
  { title:"Module 4: Differential Equations", lessons:[
    {title:"First-order ODEs",              duration:"14min", done:false, type:"video"},
    {title:"Separable equations",           duration:"12min", done:false, type:"video"},
    {title:"Applications in physics",       duration:"16min", done:false, type:"video"},
    {title:"Mock Exam",                     duration:"60min", done:false, type:"quiz"},
  ]},
];

const DEFAULT_COURSE = {
  title: "Further Mathematics & Calculus",
  subject: "Advanced · WAEC/JAMB",
  level: "Advanced",
  rating: 4.9,
  ratingCount: "1.2k",
  students: 847,
  hours: 48,
  instructor: "Dr. Amara Diallo",
  updated: "June 2025",
  priceLabel: "₦15,000",
  priceOld: "₦45,000",
  emoji: "🧮",
};

/* ─── CLASS PROFILE ─── */
const ClassProfile = ({ courseType, isEnrolled, course = DEFAULT_COURSE, modules = DEFAULT_MODULES }) => {
  const [tab, setTab] = useState("about");
  const [calAdded, setCalAdded] = useState(false);
  const [agentLinked, setAgentLinked] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [moduleOpen, setModuleOpen] = useState(0);
  const isVideo = courseType === "video";
  const MODULES = modules;

  const DEFAULT_SCHEDULE = [
    {date:"Today",      time:"2:00 – 3:30 PM", topic:"Chain Rule & Product Rule",  status:"live"},
    {date:"Thu 19 Jun", time:"2:00 – 3:30 PM", topic:"Integration by Parts",       status:"upcoming"},
    {date:"Fri 20 Jun", time:"2:00 – 3:30 PM", topic:"Differential Equations I",   status:"upcoming"},
    {date:"Mon 23 Jun", time:"2:00 – 3:30 PM", topic:"Differential Equations II",  status:"upcoming"},
    {date:"Mon 9 Jun",  time:"2:00 – 3:30 PM", topic:"Limits & Continuity",        status:"recorded"},
    {date:"Wed 11 Jun", time:"2:00 – 3:30 PM", topic:"Basic Differentiation",      status:"recorded"},
  ];
  const DEFAULT_TEACHERS = [
    {emoji:"👩🏾‍💻",bg:"#C8E8D4",name:"Dr. Amara Diallo",  title:"Lead Instructor",   rating:4.9,reviews:"2.4k",bio:"PhD Cape Town · Former WAEC examiner · 14 years Further Maths",    hasAgent:true, agentName:"Pythia",agentEmoji:"🔮"},
    {emoji:"👨🏾‍🎓",bg:"#D4C8E8",name:"Mr. Tobi Adeyemi",  title:"Teaching Assistant",rating:4.7,reviews:"880",  bio:"MSc Mathematics · UNILAG · Agent battles champion 2024",         hasAgent:true, agentName:"Axiom", agentEmoji:"⚡"},
  ];
  const schedule = course.schedule || DEFAULT_SCHEDULE;
  const teachers = course.teachers
    ? course.teachers.map((t) => ({ emoji:"👩🏾‍🏫", bg:"#C8E8D4", name:t.name, title:t.title||"Instructor", rating:course.rating, reviews:course.ratingCount, bio:`Instructor for ${course.title}.`, hasAgent:false }))
    : DEFAULT_TEACHERS;
  const doneLessons = MODULES.reduce((a,m)=>a+m.lessons.filter(l=>l.done).length,0);
  const totalLessons = MODULES.reduce((a,m)=>a+m.lessons.length,0);
  const visibleTabs = isVideo ? ["about","content","teachers"] : ["about","schedule","content","teachers"];

  return (
    <section>
      {/* Hero */}
      <div className="relative rounded-3xl overflow-hidden mb-5" style={{background:"linear-gradient(135deg,#1a1f3a,#0d2137)",minHeight:200}}>
        <div className="absolute inset-0 opacity-20" style={{backgroundImage:"radial-gradient(circle at 70% 50%,#E8884A 0%,transparent 60%)"}}/>
        <div className="relative z-10 p-5 sm:p-8 hero-grid">
          <div className="text-5xl sm:text-6xl lg:text-7xl select-none" style={{flexShrink:0}}>{course.emoji||"🧮"}</div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {!isVideo && <LiveBadge/>}
              {isVideo && <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#7C3AED] text-white text-[10px] font-bold"><PlayCircle size={9}/>VIDEO COURSE</span>}
              {!isVideo && <PlatformBadge p="zoom"/>}
              <span className="text-xs font-semibold text-[#8B8BA0] bg-white/10 px-2.5 py-0.5 rounded-full">{course.subject}</span>
            </div>
            <h1 className="font-serif text-white text-xl sm:text-2xl lg:text-3xl leading-tight mb-1">{course.title}</h1>
            <p className="text-[#8B8BA0] text-sm mb-3">
              {isVideo ? "Self-paced · Module 2 of 4 in progress" : "Module 2 of 4 · Chain Rule & Product Rule is live now"}
            </p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-[#8B8BA0]">
              <StarRow rating={course.rating} count={course.ratingCount}/>
              <span className="flex items-center gap-1"><Users size={13}/>{course.students} enrolled</span>
              <span className="flex items-center gap-1"><Clock size={13}/>{course.hours} hours total</span>
              {isVideo && <span className="flex items-center gap-1"><Globe size={13}/>English · Pidgin</span>}
            </div>
            <div className="mt-1.5 text-[11px] text-[#8B8BA0]">Created by <span className="text-[#E8884A]">{course.instructor}</span> · Last updated <span>{course.updated}</span></div>
          </div>
          <div className="hero-actions flex-shrink-0">
            {!isEnrolled && (isVideo
              ? <Btn v="amber" size="lg"><ShoppingCart size={15}/>Buy · {course.priceLabel}</Btn>
              : <Btn v="red" size="lg" onClick={()=>alert("Joining...")}><Radio size={15}/>Join live class</Btn>
            )}
            {!isEnrolled && <Btn v="glass" size="md" onClick={()=>setPreviewOpen(true)}><Play size={13}/>Watch preview</Btn>}
            {isEnrolled && !isVideo && <Btn v="red" size="lg"><Radio size={15}/>Join live now</Btn>}
            {isEnrolled && isVideo  && <Btn v="amber" size="lg"><Play size={15}/>Continue watching</Btn>}
          </div>
        </div>
        {isEnrolled && (
          <div className="relative z-10 px-6 sm:px-8 pb-5">
            <div className="flex justify-between text-xs text-[#8B8BA0] mb-1.5"><span>Your progress</span><span>{doneLessons}/{totalLessons} lessons</span></div>
            <div className="prog-bar"><div className="prog-fill" style={{width:`${(doneLessons/totalLessons)*100}%`}}/></div>
          </div>
        )}
      </div>

      {/* Action btns */}
      <div className="action-btns">
        {[
          {label:calAdded?"Added ✓":"Add to calendar",icon:<CalendarPlus size={13}/>,fn:()=>setCalAdded(v=>!v),active:calAdded,hide:isVideo},
          {label:agentLinked?"Agent linked ✓":"Link my agent",icon:<Brain size={13}/>,fn:()=>setAgentLinked(v=>!v),active:agentLinked},
          {label:"Share class",icon:<ExternalLink size={13}/>,fn:()=>{}},
          {label:"Report",icon:<Flag size={13}/>,fn:()=>{}},
        ].filter(a=>!a.hide).map(({label,icon,fn,active})=>(
          <button key={label} onClick={fn} className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold border transition-all ${active?"bg-[#E8884A] border-[#E8884A] text-white":"bg-white border-[#DDD8CF] text-[#6B6B80] hover:border-[#E8884A] hover:text-[#E8884A]"}`}>{icon}{label}</button>
        ))}
      </div>

      {/* Tabs */}
      <div className="tab-row">
        {visibleTabs.map(t=><button key={t} onClick={()=>setTab(t)} className={`px-4 py-2 rounded-xl text-xs font-semibold capitalize transition-all ${tab===t?"tab-active":"tab-inactive"}`}>{t}</button>)}
      </div>

      {/* About */}
      {tab==="about"&&(
        <div className="about-grid fade-up">
          <div className="about-main flex flex-col gap-4">
            <div className="card p-6">
              <h3 className="font-syne font-bold text-sm mb-3">About this {isVideo?"course":"class"}</h3>
              <p className="text-sm text-[#6B6B80] leading-relaxed">
                {course.description || (isVideo ? "A complete self-paced calculus course covering limits to differential equations. 48 hours of HD video, downloadable notes, quizzes after every module, and an AI agent companion that battles alongside you." : "Master calculus from first principles to advanced exam techniques, aligned to the WAEC/JAMB syllabus. Live sessions include real-time Q&A, worked examples, and agent battle challenges at the end of every class.")}
              </p>
            </div>
            <div className="card p-6">
              <h3 className="font-syne font-bold text-sm mb-3">Requirements</h3>
              <div className="flex flex-col gap-2">
                {["WAEC/NECO Mathematics C6+","Basic algebra and trigonometry","Akoro account (free or Pro)","Scientific calculator"].map((r,i)=>(
                  <div key={i} className="flex items-start gap-2 text-sm text-[#6B6B80]"><CheckCircle2 size={15} className="flex-shrink-0 mt-0.5 text-[#E8884A]"/>{r}</div>
                ))}
              </div>
            </div>
            {!isEnrolled&&(
              <div className="card p-6">
                <h3 className="font-syne font-bold text-sm mb-3">Related topics</h3>
                <div className="flex flex-wrap gap-2">
                  {["Calculus","Differentiation","Integration","WAEC Maths","Further Mathematics","Limits","Differential Equations","Trigonometry","JAMB Prep"].map(t=>(
                    <span key={t} className="px-3 py-1.5 rounded-full border border-[#EDE8E1] text-sm text-[#3A3A52] hover:border-[#E8884A] hover:text-[#E8884A] cursor-pointer transition-all">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-4">
            {!isEnrolled&&(
              <div className="card p-5">
                <div className="text-center mb-4">
                  <div className="font-syne text-3xl font-extrabold text-[#1A1A2E]">{course.priceLabel}</div>
                  {course.priceOld&&<div className="text-[#9490A0] text-xs line-through">{course.priceOld}</div>}
                  <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600 text-[11px] font-bold"><Flame size={10}/>67% off · 2 days left</div>
                </div>
                {isVideo?<Btn v="amber" className="w-full justify-center mb-3" size="md"><ShoppingCart size={14}/>Enrol now</Btn>:<Btn v="red" className="w-full justify-center mb-3" size="md"><Radio size={14}/>Join class</Btn>}
                <div className="text-center text-[11px] text-[#9490A0] mb-4">30-day money-back guarantee</div>
                <div className="flex flex-col gap-2 text-sm text-[#6B6B80]">
                  {[[<Video size={13}/>,isVideo?"48h on-demand video":"Live sessions twice weekly"],[<Brain size={13}/>,"AI agent included"],[<Swords size={13}/>,"24/7 knowledge battles"],[<Award size={13}/>,"Certificate of completion"]].map(([icon,text],i)=><div key={i} className="flex items-center gap-2"><span className="text-[#E8884A]">{icon}</span>{text}</div>)}
                </div>
              </div>
            )}
            <div className="card p-5">
              {[[`${course.students}`,"Students enrolled"],[`${course.rating} ★`,"Average rating"],["78%","Completion rate"],isVideo?[`${totalLessons}`,"Video lessons"]:["12","Sessions left"]].map(([v,l])=>(
                <div key={l} className="flex justify-between items-center py-2 border-b border-[#EDE8E1] last:border-0 text-sm"><span className="text-[#6B6B80]">{l}</span><span className="font-bold">{v}</span></div>
              ))}
            </div>
            {!isVideo&&(
              <div className="card p-5">
                <div className="text-[11px] font-bold tracking-widest uppercase text-[#9490A0] mb-3">Next session</div>
                <div className="text-sm font-bold mb-1">Chain Rule & Product Rule</div>
                <div className="text-xs text-[#6B6B80] flex items-center gap-1 mb-4"><Calendar size={12}/>Today · 2:00 PM WAT</div>
                <Btn v="amber" className="w-full justify-center" size="md"><Radio size={13}/>Join now</Btn>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Schedule — live only */}
      {tab==="schedule"&&!isVideo&&(
        <div className="card p-6 fade-up">
          <div className="flex flex-col gap-3">
            {schedule.map((s,i)=>(
              <div key={i} className={`flex items-center justify-between gap-3 p-4 rounded-2xl border ${s.status==="live"?"bg-red-50 border-red-200":s.status==="recorded"?"bg-[#FAF8F5] border-[#EDE8E1]":"bg-white border-[#EDE8E1]"}`}>
                <div className="flex items-center gap-3 min-w-0"><div className={`w-2 h-2 rounded-full ${s.status==="live"?"bg-red-500 live-pulse":s.status==="upcoming"?"bg-[#E8884A]":"bg-[#C9C5BE]"}`}/><div><div className="text-sm font-semibold">{s.topic}</div><div className="text-xs text-[#9490A0]">{s.date} · {s.time}</div></div></div>
                {s.status==="live"&&<Btn v="red" size="sm"><Radio size={11}/>Join</Btn>}
                {s.status==="upcoming"&&<Btn v="outline" size="sm"><CalendarPlus size={11}/>RSVP</Btn>}
                {s.status==="recorded"&&<Btn v="ghost" size="sm"><MonitorPlay size={11}/>Replay</Btn>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      {tab==="content"&&(
        <div className="flex flex-col gap-3 fade-up">
          <div className="text-xs text-[#9490A0] mb-1">
            {MODULES.reduce((a,m)=>a+m.lessons.length,0)} lessons · {course.hours} total hours
            {!isEnrolled&&<span className="ml-2 text-[#E8884A] font-semibold">— Enrol to unlock all content</span>}
          </div>
          {MODULES.map((m,mi)=>{
            const pct=Math.round((m.lessons.filter(l=>l.done).length/m.lessons.length)*100);
            const isUnlocked=isEnrolled||mi===0;
            return(
              <div key={mi} className="card overflow-hidden">
                <button onClick={()=>setModuleOpen(moduleOpen===mi?-1:mi)} className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-[#FAF8F5] transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${isEnrolled&&pct===100?"bg-[#E8F8EE] text-[#2AA76E]":isEnrolled&&pct>0?"bg-[#FEF0E6] text-[#E8884A]":"bg-[#F0ECE6] text-[#9490A0]"}`}>
                      {isEnrolled&&pct===100?"✓":`${mi+1}`}
                    </div>
                    <div>
                      <div className="text-sm font-bold flex items-center gap-2">
                        {m.title}
                        {!isUnlocked&&<Lock size={12} color="#C9C5BE"/>}
                        {mi===0&&!isEnrolled&&<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#E8F8EE] text-[#2AA76E] font-bold">Free preview</span>}
                      </div>
                      <div className="text-xs text-[#9490A0]">
                        {m.lessons.length} lessons
                        {isEnrolled&&` · ${m.lessons.filter(l=>l.done).length}/${m.lessons.length} done · ${pct}%`}
                      </div>
                    </div>
                  </div>
                  <ChevronDown size={15} className={`text-[#9490A0] transition-transform flex-shrink-0 ${moduleOpen===mi?"rotate-180":""}`}/>
                </button>
                {moduleOpen===mi&&(
                  <div className="border-t border-[#EDE8E1]">
                    {m.lessons.map((l,li)=>(
                      <div key={li} className={`module-lesson-row last:border-0 transition-colors ${isUnlocked?"hover:bg-[#FAF8F5] cursor-pointer":"opacity-50 cursor-not-allowed"}`}>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${isEnrolled&&l.done?"bg-[#E8884A] text-white":isUnlocked?"bg-[#EDE8E1] text-[#9490A0]":"bg-[#F0ECE6] text-[#C9C5BE]"}`}>
                          {isEnrolled&&l.done?"✓":!isUnlocked?<Lock size={9}/>:li+1}
                        </div>
                        <span className="flex-shrink-0">
                          {l.type==="video"?<Play size={12} color={isUnlocked?"#E8884A":"#C9C5BE"}/>:<BookOpen size={12} color={isUnlocked?"#E8884A":"#C9C5BE"}/>}
                        </span>
                        <span className={`text-sm flex-1 ${isUnlocked?"text-[#1A1A2E]":"text-[#C9C5BE]"}`}>{l.title}</span>
                        <span className="text-[11px] text-[#9490A0]">{l.duration}</span>
                        {isEnrolled&&l.done&&<span className="text-[10px] font-bold text-[#2AA76E] bg-[#E8F8EE] px-2 py-0.5 rounded-full">Done</span>}
                        {!isUnlocked&&<Lock size={12} color="#C9C5BE" className="flex-shrink-0"/>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Teachers */}
      {tab==="teachers"&&(
        <div className="teachers-grid fade-up">
          {teachers.map((t,i)=>(
            <div key={i} className="card p-6">
              <div className="flex items-start gap-4 mb-4"><Avatar emoji={t.emoji} bg={t.bg} size={56}/><div><div className="font-bold text-base">{t.name}</div><div className="text-xs font-semibold text-[#E8884A] mb-1">{t.title}</div><StarRow rating={t.rating} count={t.reviews}/></div></div>
              <p className="text-sm text-[#6B6B80] mb-4">{t.bio}</p>
              {t.hasAgent&&<div className="flex items-center gap-3 p-3 rounded-xl bg-[#FAF8F5] border border-[#EDE8E1]"><Avatar emoji={t.agentEmoji} bg="#FEF0E6" size={36} ring="amber"/><div><div className="text-xs font-bold">{t.agentName} — Teacher's Agent</div><div className="text-[11px] text-[#9490A0]">Available for challenges</div></div><Btn v="outline" size="sm" className="ml-auto"><Swords size={11}/>Challenge</Btn></div>}
            </div>
          ))}
        </div>
      )}

      {previewOpen&&(
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={()=>setPreviewOpen(false)}>
          <div className="bg-[#1a1f3a] rounded-3xl overflow-hidden max-w-2xl w-full relative" onClick={e=>e.stopPropagation()}>
            <div className="aspect-video bg-[#0d1a2e] flex flex-col items-center justify-center gap-3"><div className="text-7xl">{course.emoji||"🧮"}</div><div className="text-white font-serif text-xl">{course.title} — Preview</div></div>
            <div className="p-5 flex items-center justify-between"><span className="text-white/70 text-sm">3:42 preview</span><Btn v="amber" size="sm">Enrol <ArrowRight size={13}/></Btn></div>
            <button onClick={()=>setPreviewOpen(false)} className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white"><X size={16}/></button>
          </div>
        </div>
      )}
    </section>
  );
};

/* ─── VIDEO PLAYER ─── */
const VideoPlayer = ({ lesson }) => {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(22);
  const intervalRef = useRef(null);

  useEffect(()=>{
    if(playing){intervalRef.current=setInterval(()=>setProgress(p=>Math.min(100,p+0.15)),100);}
    else clearInterval(intervalRef.current);
    return()=>clearInterval(intervalRef.current);
  },[playing]);
  useEffect(()=>{setProgress(0);setPlaying(false);},[lesson?.title]);

  const totalSecs=538;
  const elapsed=Math.floor((progress/100)*totalSecs);
  const fmt=s=>`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

  return(
    <div className={`video-player ${!playing?"paused":""}`}>
      <div style={{width:"100%",height:"100%",background:"linear-gradient(135deg,#0d1a2e,#1a1f3a,#0d2137)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,minHeight:260,cursor:"pointer"}} onClick={()=>setPlaying(p=>!p)}>
        <div style={{fontSize:72,opacity:0.5}}>🧮</div>
        <div style={{color:"rgba(255,255,255,.5)",fontFamily:"'Instrument Serif',serif",fontSize:18,textAlign:"center",padding:"0 20px"}}>{lesson?.title||"Chain Rule"}</div>
        {!playing&&<div style={{width:64,height:64,borderRadius:"50%",background:"rgba(232,136,74,.9)",display:"flex",alignItems:"center",justifyContent:"center",position:"absolute",animation:"glow 2s ease-in-out infinite"}}><Play size={24} color="#fff" fill="#fff"/></div>}
      </div>
      <div className="video-controls">
        <div className="video-progress" onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setProgress(((e.clientX-r.left)/r.width)*100);}}>
          <div style={{height:"100%",background:"#E8884A",borderRadius:4,width:progress+"%",transition:"width .5s linear"}}/>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <button onClick={()=>setProgress(p=>Math.max(0,p-5))} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",display:"flex"}}><SkipBack size={16}/></button>
            <button onClick={()=>setPlaying(p=>!p)} style={{background:"rgba(255,255,255,.15)",border:"none",color:"#fff",cursor:"pointer",borderRadius:"50%",width:34,height:34,display:"flex",alignItems:"center",justifyContent:"center"}}>
              {playing?<span style={{display:"flex",gap:3}}><span style={{width:3,height:12,background:"#fff",borderRadius:2}}/><span style={{width:3,height:12,background:"#fff",borderRadius:2}}/></span>:<Play size={14} fill="#fff" color="#fff"/>}
            </button>
            <button onClick={()=>setProgress(p=>Math.min(100,p+5))} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",display:"flex"}}><SkipForward size={16}/></button>
            <button onClick={()=>setMuted(m=>!m)} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",display:"flex"}}>{muted?<VolumeX size={15}/>:<Volume2 size={15}/>}</button>
            <span style={{color:"rgba(255,255,255,.7)",fontSize:12}}>{fmt(elapsed)} / {fmt(totalSecs)}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{color:"rgba(255,255,255,.5)",fontSize:11,background:"rgba(0,0,0,.4)",padding:"2px 8px",borderRadius:6}}>1x</span>
            <button style={{background:"none",border:"none",color:"rgba(255,255,255,.7)",cursor:"pointer",display:"flex"}}><Maximize size={15}/></button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─── Q&A TAB ─── */
const QnATab = () => {
  const [newQ, setNewQ] = useState("");
  const [openQ, setOpenQ] = useState(1);
  const qs = [
    {id:1,author:"Chukwuemeka O.",emoji:"👦🏾",bg:"#D4EAD8",time:"2 hours ago",text:"When applying chain rule to sin(3x² + 2x), why do we differentiate the inside?",upvotes:12,answers:[{author:"Dr. Amara Diallo",emoji:"👩🏾‍💻",bg:"#C8E8D4",isTeacher:true,time:"1 hour ago",text:"Think of it like peeling an onion — outer layer first (sin → cos), then multiply by the derivative of the inside (6x + 2). Outside × rate of inside."}]},
    {id:2,author:"Ngozi A.",emoji:"👧🏾",bg:"#E4D4F0",time:"Yesterday",text:"How do you know when to use integration by parts vs substitution?",upvotes:8,answers:[]},
  ];
  return (
    <div className="flex flex-col gap-4 fade-up">
      <div className="card p-5">
        <div className="font-syne font-bold text-sm mb-3">Ask a question</div>
        <textarea value={newQ} onChange={e=>setNewQ(e.target.value)} placeholder="What's confusing you? Be specific..." rows={3} className="w-full bg-[#FAF8F5] border border-[#EDE8E1] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#E8884A] resize-none transition-colors placeholder:text-[#C9C5BE]"/>
        <div className="flex justify-end mt-2"><Btn v="amber" size="sm" onClick={()=>setNewQ("")}><Send size={12}/>Post question</Btn></div>
      </div>
      {qs.map(q=>(
        <div key={q.id} className="card overflow-hidden">
          <div className="p-4">
            <div className="flex items-start gap-3 mb-3"><Avatar emoji={q.emoji} bg={q.bg} size={34}/><div className="flex-1"><div className="flex items-center gap-2"><span className="text-sm font-semibold">{q.author}</span><span className="text-[11px] text-[#9490A0]">{q.time}</span></div><p className="text-sm text-[#3A3A52] mt-1">{q.text}</p></div></div>
            <div className="flex items-center gap-3">
              <button className="flex items-center gap-1.5 text-xs text-[#6B6B80] hover:text-[#E8884A] transition-colors"><ThumbsUp size={12}/>{q.upvotes}</button>
              <button onClick={()=>setOpenQ(openQ===q.id?null:q.id)} className="flex items-center gap-1.5 text-xs text-[#6B6B80] hover:text-[#E8884A] transition-colors"><MessageSquare size={12}/>{q.answers.length} answer{q.answers.length!==1?"s":""}</button>
            </div>
          </div>
          {openQ===q.id&&q.answers.length>0&&(
            <div className="border-t border-[#EDE8E1] bg-[#FAF8F5]">
              {q.answers.map((a,i)=>(
                <div key={i} className="flex items-start gap-3 p-4">
                  <Avatar emoji={a.emoji} bg={a.bg} size={30} ring={a.isTeacher?"amber":undefined}/>
                  <div><div className="flex items-center gap-2"><span className="text-xs font-bold">{a.author}</span>{a.isTeacher&&<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#FEF0E6] text-[#E8884A] font-bold">TEACHER</span>}<span className="text-[10px] text-[#9490A0]">{a.time}</span></div><p className="text-sm text-[#3A3A52] mt-1">{a.text}</p></div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

/* ─── ANNOUNCEMENTS TAB ─── */
const AnnouncementsTab = () => (
  <div className="flex flex-col gap-4 fade-up">
    {[
      {emoji:"📢",title:"Extra Q&A session added — Wednesday 4PM",author:"Dr. Amara Diallo",authorEmoji:"👩🏾‍💻",authorBg:"#C8E8D4",time:"Today · 9:00 AM",body:"Added an extra Q&A session this Wednesday at 4PM WAT for anyone stuck on Module 3. Zoom link will appear 30 minutes before.",important:true},
      {emoji:"📚",title:"New resource: WAEC Past Questions PDF uploaded",author:"Dr. Amara Diallo",authorEmoji:"👩🏾‍💻",authorBg:"#C8E8D4",time:"3 days ago",body:"10 years of WAEC Further Maths past questions with worked solutions. Highly recommend 2019 and 2021 papers.",important:false},
      {emoji:"🏆",title:"Battle season leaderboard resets Monday",author:"Mr. Tobi Adeyemi",authorEmoji:"👨🏾‍🎓",authorBg:"#D4C8E8",time:"Yesterday",body:"New battle season kicks off Monday. Top 3 agents win bonus XP. Make sure Nexus is tuned up!",important:false},
    ].map((a,i)=>(
      <div key={i} className={`announce-card ${a.important?"border-[#E8884A]":"border-[#DDD8CF]"}`}>
        <div className="flex items-start gap-3 mb-2"><Avatar emoji={a.authorEmoji} bg={a.authorBg} size={36}/><div className="flex-1"><div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-bold">{a.title}</span>{a.important&&<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#E8884A] text-white font-bold">IMPORTANT</span>}</div><div className="text-[11px] text-[#9490A0]">{a.author} · {a.time}</div></div></div>
        <p className="text-sm text-[#3A3A52] leading-relaxed">{a.body}</p>
      </div>
    ))}
  </div>
);

/* ─── ENROLLED VIDEO VIEW ─── */
const EnrolledVideoView = ({ course = DEFAULT_COURSE, modules = DEFAULT_MODULES }) => {
  const MODULES = modules;
  const [currentLesson, setCurrentLesson] = useState({title:"Chain Rule",duration:"14min",done:true,type:"video",module:"Module 2: Differentiation Techniques"});
  const [activeTab, setActiveTab] = useState("content");
  const [moduleOpen, setModuleOpen] = useState(1);

  const enrolledTabs = [
    {id:"content",    label:"Course content"},
    {id:"overview",   label:"Overview"},
    {id:"qa",         label:"Q&A"},
    {id:"announcements",label:"Announcements"},
    {id:"reviews",    label:"Reviews"},
    {id:"battles",    label:"⚔️ Battles"},
    {id:"revisions",  label:"Live revisions"},
  ];

  const doneLessons=MODULES.reduce((a,m)=>a+m.lessons.filter(l=>l.done).length,0);
  const totalLessons=MODULES.reduce((a,m)=>a+m.lessons.length,0);

  return(
    <div className="flex flex-col gap-0">
      {/* Video + header */}
      <div style={{background:"#000",margin:"-28px -20px 0"}}>
        <VideoPlayer lesson={currentLesson}/>
        <div className="video-bar">
          <div><div style={{color:"rgba(255,255,255,.4)",fontSize:11,marginBottom:2}}>{currentLesson?.module}</div><div style={{color:"#fff",fontWeight:600,fontSize:14}}>{currentLesson?.title||"Chain Rule"}</div></div>
          <Btn v="glass" size="sm"><Radio size={12}/>Join live</Btn>
        </div>
        <div style={{background:"#0a0f1a",padding:"6px 20px 10px"}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"rgba(255,255,255,.4)",marginBottom:5}}><span>Progress</span><span>{doneLessons}/{totalLessons} · {Math.round((doneLessons/totalLessons)*100)}%</span></div>
          <div style={{height:3,background:"rgba(255,255,255,.1)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",background:"#E8884A",borderRadius:3,width:`${(doneLessons/totalLessons)*100}%`}}/></div>
        </div>
      </div>

      {/* Sticky scrollable tabs */}
      <div style={{background:"#fff",borderBottom:"1px solid #EDE8E1",position:"sticky",top:56,zIndex:30}}>
        <div className="scroll-tabs" style={{padding:"0 16px"}}>
          {enrolledTabs.map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)} className="enrolled-tab-btn"
              style={{borderBottom:activeTab===t.id?"2px solid #E8884A":"2px solid transparent",color:activeTab===t.id?"#E8884A":"#6B6B80"}}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{paddingTop:24}}>
        {activeTab==="content"&&(
          <div className="flex flex-col gap-3 fade-up">
            <div className="text-xs text-[#9490A0] mb-1">{totalLessons} lessons · {course.hours} total hours</div>
            {MODULES.map((m,mi)=>{
              const pct=Math.round((m.lessons.filter(l=>l.done).length/m.lessons.length)*100);
              return(
                <div key={mi} className="card overflow-hidden">
                  <button onClick={()=>setModuleOpen(moduleOpen===mi?-1:mi)} className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-[#FAF8F5] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${pct===100?"bg-[#E8F8EE] text-[#2AA76E]":pct>0?"bg-[#FEF0E6] text-[#E8884A]":"bg-[#F0ECE6] text-[#9490A0]"}`}>{pct===100?"✓":`${mi+1}`}</div>
                      <div><div className="text-sm font-bold">{m.title}</div><div className="text-xs text-[#9490A0]">{m.lessons.filter(l=>l.done).length}/{m.lessons.length} · {pct}%</div></div>
                    </div>
                    <ChevronDown size={15} className={`text-[#9490A0] transition-transform flex-shrink-0 ${moduleOpen===mi?"rotate-180":""}`}/>
                  </button>
                  {moduleOpen===mi&&(
                    <div className="border-t border-[#EDE8E1]">
                      {m.lessons.map((l,li)=>(
                        <div key={li} onClick={()=>setCurrentLesson({...l,module:m.title})} className={`module-lesson-row last:border-0 cursor-pointer transition-colors ${currentLesson?.title===l.title?"bg-[#FEF0E6]":"hover:bg-[#FAF8F5]"}`}>
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${l.done?"bg-[#E8884A] text-white":"bg-[#EDE8E1] text-[#9490A0]"}`}>{l.done?"✓":li+1}</div>
                          <span className="flex-shrink-0">{l.type==="video"?<Play size={12} color="#9490A0"/>:<BookOpen size={12} color="#9490A0"/>}</span>
                          <span className="text-sm flex-1">{l.title}</span>
                          <span className="text-[11px] text-[#9490A0]">{l.duration}</span>
                          {l.done&&<span className="text-[10px] font-bold text-[#2AA76E] bg-[#E8F8EE] px-2 py-0.5 rounded-full">Done</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {activeTab==="overview"     && <ClassProfile courseType="video" isEnrolled={true} course={course} modules={modules}/>}
        {activeTab==="qa"           && <QnATab/>}
        {activeTab==="announcements"&& <AnnouncementsTab/>}
        {activeTab==="reviews"      && <ReviewsSection reviews={course.reviews}/>}
        {activeTab==="battles"      && <ChallengesSection/>}
        {activeTab==="revisions"    && <RevisionSection/>}
      </div>
    </div>
  );
};

/* ─── Map API course → component shape ─── */
function mapCourse(api) {
  if (!api) return { course: DEFAULT_COURSE, modules: DEFAULT_MODULES, type: "live", enrolled: false };
  const isFree = api.is_free || api.price === 0;
  const priceLabel = isFree ? "Free" : `₦${Number(api.price || 0).toLocaleString("en-NG")}`;
  const modules = Array.isArray(api.modules) && api.modules.length
    ? api.modules.map((m) => ({
        title: m.title,
        lessons: (m.lessons || []).map((l) => ({
          title: l.title, duration: l.duration || "—",
          done: !!l.done, type: l.type || "video",
        })),
      }))
    : DEFAULT_MODULES;
  return {
    type: api.type === "video" || api.course_type === "video" ? "video" : "live",
    enrolled: !!api.enrolled,
    modules,
    course: {
      title:       api.title || DEFAULT_COURSE.title,
      subject:     api.subject || DEFAULT_COURSE.subject,
      level:       api.level || DEFAULT_COURSE.level,
      rating:      api.rating != null ? Number(api.rating) : DEFAULT_COURSE.rating,
      ratingCount: api.rating_count || DEFAULT_COURSE.ratingCount,
      students:    api.total_students != null ? api.total_students : DEFAULT_COURSE.students,
      hours:       api.total_hours != null ? api.total_hours : DEFAULT_COURSE.hours,
      instructor:  api.instructor_name || DEFAULT_COURSE.instructor,
      updated:     api.updated || DEFAULT_COURSE.updated,
      description: api.description || "",
      priceLabel,
      priceOld:    api.price_old ? `₦${Number(api.price_old).toLocaleString("en-NG")}` : null,
      emoji:       api.emoji || DEFAULT_COURSE.emoji,
      schedule:    Array.isArray(api.schedule) && api.schedule.length ? api.schedule : null,
      reviews:     Array.isArray(api.reviews)  && api.reviews.length  ? api.reviews  : null,
      teachers:    Array.isArray(api.teachers) && api.teachers.length ? api.teachers : null,
    },
  };
}

/* ─── PAGE ─── */
export default function CourseDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);     // mapped { course, modules, type, enrolled }
  const [courseType, setCourseType] = useState("live");
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // One endpoint drives the course; a lightweight progress probe tells us if
    // the signed-in user is enrolled (404 = not enrolled) so video courses can
    // open straight into the player view.
    Promise.all([
      fetch(`${API}/api/courses/${id}/full`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${API}/api/courses/${id}/progress`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([res, prog]) => {
      if (!alive) return;
      const mapped = mapCourse(res?.course || res);
      const enrolled = !!(prog && prog.success !== false && (prog.data || prog.overall_progress != null || prog.modules));
      setData(mapped);
      setCourseType(mapped.type);
      setIsEnrolled(enrolled || mapped.enrolled);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const view = data || mapCourse(null);

  return(
    <div className="cdp" style={{minHeight:"100vh",background:"#F7F5F2"}}>
      <Styles/>
      {/* Nav */}
      <div style={{background:"#fff",borderBottom:"1px solid #EDE8E1",position:"sticky",top:0,zIndex:40}}>
        <div className="nav-inner">
          <button onClick={()=>navigate(-1)} className="flex items-center gap-1.5 text-sm font-medium text-[#6B6B80] hover:text-[#1A1A2E] transition-colors flex-shrink-0"><ChevronLeft size={16}/>Back</button>
          <div style={{height:20,width:1,background:"#EDE8E1",flexShrink:0}}/>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div style={{width:28,height:28,borderRadius:8,background:"#E8884A",display:"flex",alignItems:"center",justifyContent:"center"}}><Brain size={15} color="#fff" strokeWidth={2.5}/></div>
            <span className="font-serif text-lg text-[#1A1A2E] hidden sm:block">Akoro</span>
          </div>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
            <span className="text-xs font-semibold px-3 py-1 rounded-full" style={{background:courseType==="video"?"#EDE8F8":"#FEE2E2",color:courseType==="video"?"#7C3AED":"#DC2626"}}>
              {courseType==="video"?"🎬 Video course":"🔴 Live class"}
            </span>
          </div>
        </div>
      </div>

      {/* Page content */}
      {loading ? (
        <div style={{maxWidth:1100,margin:"0 auto",padding:"40px 20px"}}>
          <div style={{height:200,borderRadius:24,background:"#EDE8E1"}} className="animate-pulse"/>
        </div>
      ) : (
        <div className="page-content" style={{paddingTop: isEnrolled && courseType==="video" ? 0 : undefined}}>
          {isEnrolled && courseType==="video" ? (
            <EnrolledVideoView course={view.course} modules={view.modules}/>
          ) : (
            <>
              <ClassProfile courseType={courseType} isEnrolled={isEnrolled} course={view.course} modules={view.modules}/>
              <RevisionSection/>
              <ChallengesSection/>
              <ReviewsSection reviews={view.course.reviews}/>
            </>
          )}
        </div>
      )}
    </div>
  );
}
