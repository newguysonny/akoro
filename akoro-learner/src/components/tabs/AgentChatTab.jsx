import { useState, useRef, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, STUDENT_ID } from '../../constants.js';
import { API,  apiGet, apiPost, apiPatch } from '../../services/api.js';
import { SendIcon, ZapIcon, BrainIcon, SparkleIcon, XIcon } from '../common/Icons.jsx';
import { useTaskAPI } from '../../hooks/useTaskAPI.js';
import { formatTaskOutputs } from '../../utils/formatTaskOutput.js';
import AgentStatsTab from './AgentStatsTab.jsx';

// Detect when a chat message should run an agentic task (student tools).
// Mirrors the backend intent keywords so the agent acts instead of just chatting.
const TASK_INTENTS = [
  /\bquiz me\b/i, /\btest me\b/i, /\bpractice questions?\b/i,
  /\bexplain\b/i, /\bwhat is\b/i, /\bteach me\b/i, /\bhelp me understand\b/i,
  /\bstudy plan\b/i, /\brevision plan\b/i, /\bplan my\b/i,
  /\bremind me\b/i, /\bset a reminder\b/i,
  /\bchallenge\b/i, /\bduel\b/i, /\bcompete with\b/i,
];
const isTaskIntent = (text) => TASK_INTENTS.some((re) => re.test(text));

const QUICK_PROMPTS = ["Create a task for me","What's due today?","Quiz me on Algebra","Check my progress","Explain Mitosis","Help with an essay"];
const AGENT_REPLIES = {
  "Create a task for me":"Sure! What do you need to get done? Tell me the subject and what it's about — I'll add it to your task list.",
  "What's due today?":"📋 Let me check your task list for today's items. Use the Tasks tab to see everything that's pending.",
  "Quiz me on Algebra":"Let's go! 🎯\n\nQ1: Solve for x: 3x + 7 = 22\n\nType your answer and I'll check it, then move to the next question.",
  "Check my progress":"I'll pull up your progress now. Check the Stats tab for a full breakdown of your recent activity.",
  "Explain Mitosis":"Great topic! 🔬\n\nMitosis is how a cell divides into two identical daughters. 4 main phases:\n\n1. Prophase — chromosomes condense\n2. Metaphase — chromosomes line up\n3. Anaphase — chromosomes pulled apart\n4. Telophase — two new nuclei form\n\nWant me to quiz you on this?",
  "Help with an essay":"Happy to help! 📝 Tell me the topic or paste in what you have so far, and I'll give you feedback or help you structure your argument.",
};
const AGENT_AVATARS = ["🤖","🧠","👾","🦉","🎓","⚡","🌟","🔮","🦋","🎯","🚀","💡"];
const AGENT_LEVEL = 12;
// Local agent config constants (no mock dependency)
const AGENT_CONFIG = { name: '', level: AGENT_LEVEL, avatars: AGENT_AVATARS };

function AgentChatTab({ onStartTeach, agentNameProp, agentEmojiProp }) {
  const initName  = agentNameProp  || '';
  const initEmoji = agentEmojiProp || '🤖';

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
  const [taskFilter, setTaskFilter] = useState("pending");
  const [tTitle,     setTTitle]     = useState("");
  const [tDesc,      setTDesc]      = useState("");
  const [tPriority,  setTPriority]  = useState("medium");
  const feedRef = useRef(null);

  const { tasks, loading: tasksLoading, createTask, toggleTask, deleteTask, getOutputs } = useTaskAPI();

  // Socket for instant task results; resolvers map taskId → fn called on push.
  const socketRef       = useRef(null);
  const taskResolvers   = useRef(new Map());

  const pushAgent = (text) => {
    const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages(prev => [...prev, { id: Date.now() + Math.random(), from: "agent", text, time: t }]);
  };

  // Connect to the backend WebSocket and listen for task lifecycle events.
  // The worker emits task.completed / task.failed to room user:<studentId>.
  useEffect(() => {
    let socket;
    try {
      if (typeof window !== 'undefined' && window.io) {
        socket = window.io(API, { transports: ['websocket', 'polling'] });
        socketRef.current = socket;
        socket.on('connect', () => {
          socket.emit('subscribe-student', STUDENT_ID);
          socket.emit('join-student-room',  STUDENT_ID);
        });
        socket.on('task.completed', (p) => { const r = taskResolvers.current.get(p?.taskId); if (r) r({}); });
        socket.on('task.failed',    (p) => { const r = taskResolvers.current.get(p?.taskId); if (r) r({ failed: true }); });
      }
    } catch { /* WS unavailable — polling still works */ }
    return () => socket?.disconnect?.();
  }, []);

  // Resolve as soon as EITHER the socket pushes completion OR polling finds
  // outputs (whichever is first), with a hard timeout. Deduped via `settled`.
  const waitForTask = (taskId, { timeoutMs = 60000, intervalMs = 2500 } = {}) =>
    new Promise((resolve) => {
      let settled = false;
      const cleanup = () => taskResolvers.current.delete(taskId);
      const finish  = (val) => { if (!settled) { settled = true; cleanup(); resolve(val); } };

      // Fast path: socket push
      taskResolvers.current.set(taskId, async (evt) => {
        if (evt?.failed) return finish({ failed: true });
        const outputs = await getOutputs(taskId);
        finish({ outputs });
      });

      // Fallback path: poll
      const deadline = Date.now() + timeoutMs;
      const tick = async () => {
        if (settled) return;
        const outputs = await getOutputs(taskId);
        if (outputs.length) return finish({ outputs });
        const fresh = await apiGet(`/api/tasks/${taskId}`).catch(() => null);
        if (fresh?.task?.status === 'failed') return finish({ failed: true });
        if (Date.now() > deadline) return finish({ timedOut: true });
        setTimeout(tick, intervalMs);
      };
      setTimeout(tick, intervalMs);
    });

  const PRI_COLOR = {high:RED,medium:GOLD,low:GREEN};
  const PRI_LABEL = {high:"High",medium:"Medium",low:"Low"};
  const PRI_BG    = {high:`${RED}15`,medium:`${GOLD}15`,low:`${GREEN}15`};

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

    // Agentic task intents ("quiz me", "explain…", "study plan", "remind me",
    // "challenge…") run a real task and stream the result back into the chat.
    if(isTaskIntent(text)){
      pushAgent("On it — let me work on that for you… ⏳");
      try {
        const task = await createTask({ title: text, priority: "medium" });
        if(!task?.id) throw new Error("no task");
        const { outputs, failed, timedOut } = await waitForTask(task.id);
        if(failed){
          pushAgent("Hmm, I ran into a problem doing that. Mind rephrasing or trying again?");
        } else if(timedOut){
          pushAgent("That's taking longer than usual — I'll keep working. Check the Tasks tab in a moment for the result.");
        } else {
          const texts = formatTaskOutputs(outputs);
          if(texts.length) texts.forEach(pushAgent);
          else pushAgent("All done! Check the Tasks tab for the details.");
        }
      } catch {
        pushAgent("I couldn't start that task — please try again.");
      }
      setLoading(false);
      return;
    }

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
    const name=draftName||agentName||'My Agent';
    updateAgentName(name, draftEmoji);
    // Persist to backend (non-critical)
    apiPost("/api/user/agent", { agent_name: name, agent_emoji: draftEmoji }).catch(()=>{});
    setCustOpen(false);
    const t=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    setMessages(prev=>[...prev,{id:Date.now(),from:"agent",text:`I've been updated! I'm now ${name} ${draftEmoji}. Same knowledge, fresh identity!`,time:t}]);
  };

  const addTask=async()=>{
    if(!tTitle.trim()) return;
    const t=new Date().toLocaleTimeString('en-GB',{hour:"2-digit",minute:"2-digit"});
    await createTask({ title:tTitle, description:tDesc, priority:tPriority });
    setMessages(prev=>[...prev,{id:Date.now(),from:"agent",text:`✅ Task assigned!\n\n📋 "${tTitle}"\nPriority: ${tPriority.charAt(0).toUpperCase()+tPriority.slice(1)}\n\nI'll track this for you!`,time:t}]);
    setTTitle(""); setTDesc(""); setTPriority("medium"); setTaskOpen(false);
    if(innerTab!=="tasks") setInnerTab("tasks");
  };

  const filteredTasks=tasks.filter(t=>taskFilter==="done"?t.status==="done":t.status!=="done");
  const pendingCount=tasks.filter(t=>t.status!=="done").length;
  const doneCount=tasks.filter(t=>t.status==="done").length;
  const highCount=tasks.filter(t=>t.priority==="high"&&t.status!=="done").length;

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
        {[{key:"chat",label:"Chat",icon:"💬",badge:null},{key:"tasks",label:"Tasks",icon:"📋",badge:pendingCount},{key:"stats",label:"Stats",icon:"📊",badge:null}].map(({key,label,icon,badge})=>(
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
              <div key={t.id} style={{ display:"flex",alignItems:"flex-start",gap:11,padding:"12px 14px",borderRadius:14,background:"#fff",border:"1px solid #F3F4F6",opacity:t.status==="done"?.6:1 }}>
                <button onClick={()=>toggleTask(t.id)} style={{ marginTop:2,width:22,height:22,borderRadius:6,border:`2px solid ${t.status==="done"?GREEN:"#D1D5DB"}`,background:t.status==="done"?GREEN:"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0 }}>
                  {t.status==="done"&&<svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
                <div style={{ flex:1,minWidth:0 }}>
                  <p style={{ fontSize:13.5,fontWeight:t.status==="done"?500:700,color:t.status==="done"?"#9CA3AF":"#111827",textDecoration:t.status==="done"?"line-through":"none",margin:"0 0 4px" }}>{t.title}</p>
                  {t.description&&<p style={{ fontSize:12,color:"#6B7280",margin:"0 0 5px",lineHeight:1.45 }}>{t.description}</p>}
                  <span style={{ fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:20,background:PRI_BG[t.priority],color:PRI_COLOR[t.priority] }}>{PRI_LABEL[t.priority]}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {innerTab==="stats"&&(
        <AgentStatsTab studentId={STUDENT_ID} agentName={agentName} agentEmoji={agentEmoji} onStartTeach={onStartTeach}/>
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

/* ══════════════════════════════════════════════════════ */

export default AgentChatTab;
