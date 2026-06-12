import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, PRIORITY_CONFIG, STUDENT_ID } from '../constants.js';
import { apiGet, apiPost, apiPatch } from '../services/api.js';
import { useLang } from '../contexts/LanguageContext.jsx';

// Components
import SessionCard    from '../components/sessions/SessionCard.jsx';
import SessionSheet   from '../components/sessions/SessionSheet.jsx';
import BlockRenderer  from '../components/sessions/BlockRenderer.jsx';
import TeachAgentModal   from '../components/teaching/TeachAgentModal.jsx';
import DecaySessionModal from '../components/teaching/DecaySessionModal.jsx';
import ConfigModal       from '../components/teaching/ConfigModal.jsx';
import BattleModal       from '../components/battles/BattleModal.jsx';
import ChallengeModal    from '../components/battles/ChallengeModal.jsx';
import { BattlesTab, ChallengeRow } from '../components/battles/BattlesTab.jsx';
import AgentChatTab  from '../components/tabs/AgentChatTab.jsx';
import RankingsTab   from '../components/tabs/RankingsTab.jsx';
import DiscoveryTab  from '../components/tabs/DiscoveryTab.jsx';
import Toast         from '../components/common/Toast.jsx';
import { ProgressBar, LiveBadge } from '../components/common/ProgressBar.jsx';
import { ZapIcon, MicIcon, ChevDownIcon } from '../components/common/Icons.jsx';
import React from 'react';

// Hooks
import { useWebSocket }    from '../hooks/useWebSocket.js';
import { useAgentProfile } from '../hooks/useAgentProfile.js';
import { useSessionAPI }   from '../hooks/useSessionAPI.js';
import { useDecayAlerts }  from '../hooks/useDecayAlerts.js';
import { useBattleAPI }    from '../hooks/useBattleAPI.js';

function SubjectDropdown({ value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const sel = SUBJECTS[value] || SUBJECTS.all;
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

export default function LearnerDashboard() {
  const navigate = useNavigate();
  const { t } = useLang();
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
  const [battles,           setBattles]           = useState([]);
  const [toast,             setToast]             = useState(null);
  const [isOnline,          setIsOnline]          = useState(true);
  const [liveBattleModal,   setLiveBattleModal]   = useState(null);

  // ── API-driven state ─────────────────────────────────────────────────────
  const [sessions,     setSessions]     = useState([]);
  const [challenges,   setChallenges]   = useState([]);
  const [agentProfile, setAgentProfile] = useState({
    name:             '',
    emoji:            '🤖',
    teacherAgentId:   'nana-sargeant',
    guideName:        'NaNa Esumai',
    guideEmoji:       '🧠',
    guideRenderStyle: {
      bubbleBg:"rgba(124,58,237,0.10)", bubbleBorder:"#7C3AED",
      labelColor:"#7C3AED", ttsVoice:"alloy", assessStyle:"gentle",
    },
    ttsVoice: "alloy",
  });
  const [decayAlerts,  setDecayAlerts]  = useState([]);
  const [agentSessions, setAgentSessions] = useState([]);
  const [userProfile,  setUserProfile]  = useState(null);

  useEffect(()=>{
    // User profile — name, avatar, year group, XP for the header
    apiGet("/api/profiles/me")
      .then(d=>{ if(d?.id||d?.data?.id) setUserProfile(d.data||d); })
      .catch(()=>{});

    // Agent profile — student agent + guide agent
    apiGet("/api/user/agent")
      .then(d=>{
        if (d.agent_name) setAgentProfile({
          name:            d.agent_name,
          emoji:           d.agent_emoji  || '🤖',
          teacherAgentId:  d.teacher_agent_id || 'nana-sargeant',
          guideName:       d.guide_name   || 'NaNa Esumai',
          guideEmoji:      d.guide_emoji  || '🧠',
          guideRenderStyle:d.guide_render_style || {
            bubbleBg:"rgba(124,58,237,0.10)", bubbleBorder:"#7C3AED",
            labelColor:"#7C3AED", ttsVoice:"alloy", assessStyle:"gentle",
          },
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
    const newBattle = {
      ...c, id:`B-${Date.now()}`,
      agentA:{ id:"nexus",name:"Nexus",emoji:"🤖",owner:"You",ownerEmoji:"👤",bg:"#FEF0E6",color:"#E8884A",isYou:true,score:0,hp:100 },
      agentB:{ id:"opp",name:(c.agentBName||c.challenger.split(" ")[0]+"'s Agent"),emoji:(c.agentBEmoji||"⚡"),owner:c.challenger,ownerEmoji:"👦🏽",bg:(c.agentBBg||"#C8D8E8"),color:(c.agentBColor||BRAND),score:0,hp:100 },
      topic:c.title, viewers:0, xpPool:parseInt((c.xpPrize||"0").replace(/\D/g,""),10)||200, totalQ:0, currentQNum:0, winner:null, startedAgo:null, question:null,
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

  const NAV_ITEMS=[{key:"sessions",icon:"📚",label:t('nav.learn')},{key:"discovery",icon:"🧭",label:t('nav.discover')},{key:"rankings",icon:"🏆",label:t('nav.rankings')},{key:"battles",icon:"⚔️",label:t('nav.battles')},{key:"agent",icon:"🤖",label:t('nav.agent')}];
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

      <div style={{ width:"100vw",height:"100vh",fontFamily:"'Nunito',sans-serif",background:"var(--ak-bg)",display:"flex",flexDirection:"column",overflow:"hidden",position:"relative" }}>

        {/* HEADER */}
        <div style={{ background:"var(--ak-surface)",backdropFilter:"blur(14px)",borderBottom:"1px solid var(--ak-border)",padding:"14px 18px 0",zIndex:100,flexShrink:0 }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
            <div style={{ display:"flex",alignItems:"center",gap:11 }}>
              <div style={{ position:"relative",cursor:"pointer" }} onClick={()=>navigate("/settings")}>
                {userProfile?.avatarUrl
                  ? <img src={userProfile.avatarUrl} alt="" style={{ width:38,height:38,borderRadius:"50%",objectFit:"cover",border:"2px solid #EDE9FE" }}/>
                  : <div style={{ width:38,height:38,borderRadius:"50%",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:15,fontWeight:900,border:"2px solid #EDE9FE" }}>
                      {(userProfile?.fullName||userProfile?.username||"?").trim().charAt(0).toUpperCase()}
                    </div>}
                <div style={{ position:"absolute",bottom:1,right:1,width:10,height:10,borderRadius:"50%",background:isOnline?GREEN:"#9CA3AF",border:"2px solid #fff",animation:isOnline?"pulse-dot 2s ease-in-out infinite":"none" }}/>
              </div>
              <div>
                <p style={{ fontSize:15,fontWeight:900,color:"var(--ak-text)",margin:0,lineHeight:1.2 }}>{userProfile?.fullName||userProfile?.username||"…"}</p>
                <div style={{ display:"flex",alignItems:"center",gap:5 }}><ZapIcon size={11} color={GOLD}/><span style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-muted)" }}>{(userProfile?.agent?.xpEarned ?? 0).toLocaleString()} XP{userProfile?.yearGroup?` · ${userProfile.yearGroup}`:""}</span></div>
              </div>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              <button onClick={()=>navigate("/live")} title="Live Classes"
                style={{ display:"flex",alignItems:"center",gap:5,background:"#F0EBFF",border:"1px solid #DDD3FF",borderRadius:100,padding:"6px 12px",cursor:"pointer",color:BRAND,fontSize:11,fontWeight:800,fontFamily:"'Nunito',sans-serif" }}>
                🎥 Live
              </button>
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
            <div style={{ background:"var(--ak-surface)",display:"flex",flexDirection:"column",minHeight:"100%" }}>
              {/* ── Top session type tabs ── */}
              <div style={{ display:"flex",borderBottom:"1px solid var(--ak-border)",background:"var(--ak-surface)",flexShrink:0 }}>
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
            <div style={{ background:"var(--ak-surface)",minHeight:"100%" }}>
              <div style={{ padding:"12px 18px 10px",borderBottom:"1px solid var(--ak-border)" }}>
                <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6 }}><ZapIcon size={13} color={RED}/><span style={{ fontSize:12,fontWeight:800,color:"var(--ak-text-sec)" }}>Peer Challenges — Accept before they expire</span></div>
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
          {tab==="discovery" && <DiscoveryTab/>}
          {tab==="rankings" && <RankingsTab/>}
          {tab==="battles"  && <BattlesTab battles={battles} onViewChallenge={()=>setTab("challenges")}/>}
          {tab==="agent"    && <AgentChatTab onStartTeach={s=>{ setTeachSession(s); }} agentNameProp={agentProfile.name} agentEmojiProp={agentProfile.emoji}/>}
        </div>

        {/* BOTTOM NAV */}
        <div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:200,background:"var(--ak-surface)",backdropFilter:"blur(12px)",borderTop:"1px solid var(--ak-border)",padding:"8px 0 env(safe-area-inset-bottom,14px)",display:"flex",justifyContent:"space-around",minHeight:62 }}>
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
        {!selectedSession&&!selectedChallenge&&!teachSession&&!configOpen&&tab!=="agent"&&tab!=="battles"&&tab!=="discovery"&&(
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
