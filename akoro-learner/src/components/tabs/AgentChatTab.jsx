import { useState, useRef, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, STUDENT_ID } from '../../constants.js';
import { API,  apiGet, apiPost, apiPatch, apiDelete, streamPost } from '../../services/api.js';
import { putAgent } from '../../services/settingsApi.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
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

const QUICK_PROMPTS = [
  { text:"Create a task for me", key:"agent.qp_create" },
  { text:"What's due today?",    key:"agent.qp_due" },
  { text:"Quiz me on Algebra",   key:"agent.qp_quiz" },
  { text:"Check my progress",    key:"agent.qp_progress" },
  { text:"Explain Mitosis",      key:"agent.qp_explain" },
  { text:"Help with an essay",   key:"agent.qp_essay" },
];
// Compact relative time for the sessions drawer ("now", "5m", "3h", "2d").
const relTime = (iso) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)     return "now";
  if (s < 3600)   return `${Math.floor(s/60)}m`;
  if (s < 86400)  return `${Math.floor(s/3600)}h`;
  if (s < 604800) return `${Math.floor(s/86400)}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
};

const AGENT_AVATARS = ["🤖","🧠","👾","🦉","🎓","⚡","🌟","🔮","🦋","🎯","🚀","💡"];
const AGENT_CONFIG = { name: '', avatars: AGENT_AVATARS };

function AgentChatTab({ onStartTeach, agentNameProp, agentEmojiProp }) {
  const { t } = useLang();
  const initName  = agentNameProp  || '';
  const initEmoji = agentEmojiProp || '🤖';

  // Greeting message — uses real agent name from parent
  const greeting = (name, emoji) => ({
    id:1, from:"agent",
    text: t('agent.greeting').replace('{user}','').replace('Hi !','Hi!').replace('{name}',name).replace('{emoji}',emoji),
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
  const shownName = agentName || t('agent.learning_agent');
  const [taskOpen,   setTaskOpen]   = useState(false);
  const [taskFilter, setTaskFilter] = useState("pending");
  const [tTitle,     setTTitle]     = useState("");
  const [tDesc,      setTDesc]      = useState("");
  const [tPriority,  setTPriority]  = useState("medium");
  const [tDueAt,     setTDueAt]     = useState("");     // datetime-local wall-clock
  const [tEditing,   setTEditing]   = useState(null);   // task being edited, or null
  const feedRef = useRef(null);

  // ── Persistent chat sessions ───────────────────────────────────────────────
  const [sessions,      setSessions]      = useState([]);
  const [sessionId,     setSessionId]     = useState(null);
  const [drawerOpen,    setDrawerOpen]    = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const sessionIdRef = useRef(null);
  const creatingRef  = useRef(null);   // in-flight create → avoids double sessions
  const setSession = (id) => { sessionIdRef.current = id; setSessionId(id); };

  const CHAT_BASE = "/api/adaptive/chat";

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const d = await apiGet(`${CHAT_BASE}/sessions`);
      setSessions(d?.sessions ?? []);
      return d?.sessions ?? [];
    } catch { return []; }
    finally { setSessionsLoading(false); }
  };

  // Lazily create a session on first message; concurrency-safe.
  const ensureSession = async (firstText) => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (creatingRef.current) return creatingRef.current;
    creatingRef.current = (async () => {
      try {
        const d = await apiPost(`${CHAT_BASE}/sessions`, { title: firstText || "" });
        const id = d?.session?.id ?? null;
        if (id) { setSession(id); setSessions(prev => [d.session, ...prev]); }
        return id;
      } catch { return null; }
      finally { creatingRef.current = null; }
    })();
    return creatingRef.current;
  };

  const persistToSession = async (sid, role, text) => {
    if (!sid || !text) return;
    try { await apiPost(`${CHAT_BASE}/sessions/${sid}/messages`, { role, text }); }
    catch { /* non-critical — chat still works in-memory */ }
  };

  const openSession = async (id) => {
    setDrawerOpen(false);
    if (id === sessionIdRef.current) return;
    try {
      const d = await apiGet(`${CHAT_BASE}/sessions/${id}/messages`);
      const msgs = (d?.messages ?? []).map(m => ({
        id: m.id,
        from: m.role === "user" ? "me" : "agent",
        text: m.text,
        time: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }));
      setSession(id);
      setMessages(msgs.length ? msgs : [greeting(agentName, agentEmoji)]);
    } catch { /* keep current view on failure */ }
  };

  const newChat = () => {
    setDrawerOpen(false);
    setSession(null);
    setMessages([greeting(agentName, agentEmoji)]);
  };

  const removeSession = async (id, e) => {
    e?.stopPropagation?.();
    setSessions(prev => prev.filter(s => s.id !== id));
    try { await apiDelete(`${CHAT_BASE}/sessions/${id}`); } catch { /* ignore */ }
    if (id === sessionIdRef.current) newChat();
  };

  // On mount: load the session list and resume the most recent conversation
  // so a refresh doesn't lose the chat.
  useEffect(() => {
    (async () => {
      const list = await loadSessions();
      if (list.length && !sessionIdRef.current) openSession(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { tasks, loading: tasksLoading, createTask, updateTask, toggleTask, deleteTask, getOutputs } = useTaskAPI();

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
        socket = window.io(API, { transports: ['websocket', 'polling'], withCredentials: true });
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
  const PRI_LABEL = {high:t('agent.pri_high_label'),medium:t('agent.pri_medium_label'),low:t('agent.pri_low_label')};
  const PRI_BG    = {high:`${RED}15`,medium:`${GOLD}15`,low:`${GREEN}15`};

  // Update greeting when agent name changes (customise flow)
  const updateAgentName = (name, emoji) => {
    setAgentName(name); setAgentEmoji(emoji);
  };

  // The parent fetches the agent profile asynchronously; if it resolves after
  // this tab mounts, sync the incoming name/emoji so the header isn't blank.
  useEffect(() => {
    if (agentNameProp && agentNameProp !== agentName) {
      setAgentName(agentNameProp);
      setMessages(prev => (prev.length === 1 && prev[0].id === 1
        ? [greeting(agentNameProp, agentEmojiProp || agentEmoji)]
        : prev));
    }
    if (agentEmojiProp && agentEmojiProp !== agentEmoji) setAgentEmoji(agentEmojiProp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentNameProp, agentEmojiProp]);

  useEffect(()=>{ if(feedRef.current) feedRef.current.scrollTop=feedRef.current.scrollHeight; },[messages,loading]);

  const sendMessage=async(overrideText)=>{
    const text=(overrideText??input).trim();
    if(!text||loading) return;
    if(!overrideText) setInput("");
    const ts=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const userMsg={id:Date.now(),from:"me",text,time:ts};
    setMessages(prev=>[...prev,userMsg]); setLoading(true);

    // Persist the user message (creating the session on first send). Errors are
    // swallowed inside the helpers so the chat still works offline.
    const sid = await ensureSession(text);
    persistToSession(sid, "user", text);
    // Show an agent bubble AND persist it, so a refresh reloads the same text.
    const say = (txt) => { pushAgent(txt); persistToSession(sid, "agent", txt); };

    // Agentic task intents ("quiz me", "explain…", "study plan", "remind me",
    // "challenge…") run a real task and stream the result back into the chat.
    if(isTaskIntent(text)){
      pushAgent(t('agent.error_working'));   // transient status — not persisted
      try {
        const task = await createTask({ title: text, priority: "medium" });
        if(!task?.id) throw new Error("no task");
        const { outputs, failed, timedOut } = await waitForTask(task.id);
        if(failed){
          say(t('agent.error_problem'));
        } else if(timedOut){
          say(t('agent.error_timeout'));
        } else {
          const texts = formatTaskOutputs(outputs);
          if(texts.length) texts.forEach(say);
          else say(t('agent.all_done_tasks'));
        }
      } catch {
        say(t('agent.error_task'));
      }
      setLoading(false);
      return;
    }

    // Normal AI chat — OpenAI educational tutor (no tasks/tools).
    // Stream tokens so the reply starts appearing immediately; fall back to a
    // plain request if the stream can't be established.
    const history=[...messages,userMsg].map(m=>({role:m.from==="me"?"user":"assistant",content:m.text}));
    const payload={ message: text, history: history.slice(-8), agentName, role: "student" };
    const t2=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const replyId=Date.now()+Math.random();
    let started=false;
    const ensureBubble=()=>{
      if(started) return;
      started=true;
      setLoading(false);   // hide typing dots — the bubble now carries the text
      setMessages(prev=>[...prev,{id:replyId,from:"agent",text:"",time:t2}]);
    };
    const appendDelta=(chunk)=>{
      ensureBubble();
      setMessages(prev=>prev.map(m=>m.id===replyId?{...m,text:m.text+chunk}:m));
    };
    let finalReply="";
    try {
      finalReply = await streamPost("/api/adaptive/chat/tutor?stream=1", payload, {
        onDelta: appendDelta,
        onDone: ({ reply, syllabus })=>{ ensureBubble(); setMessages(prev=>prev.map(m=>m.id===replyId?{...m,...(reply!=null?{text:reply}:{}),syllabus:syllabus||[]}:m)); },
      });
      if(!started){ // stream produced nothing — show fallback text
        finalReply=t('agent.fallback');
        setMessages(prev=>[...prev,{id:replyId,from:"agent",text:finalReply,time:t2}]);
      }
    } catch {
      // Streaming failed before any token — try a normal request, then error.
      if(!started){
        try {
          const data = await apiPost("/api/adaptive/chat/tutor", payload);
          finalReply = data.reply || data.response || t('agent.fallback');
          setMessages(prev=>[...prev,{id:replyId,from:"agent",text:finalReply,time:t2,syllabus:data.syllabus||[]}]);
        } catch {
          finalReply="";
          setMessages(prev=>[...prev,{id:replyId,from:"agent",text:t('agent.error_connection'),time:t2}]);
        }
      }
    }
    if(finalReply && finalReply.trim()) persistToSession(sid, "agent", finalReply);
    setLoading(false);
  };

  const saveCustomise=()=>{
    const name=draftName||agentName||'My Agent';
    updateAgentName(name, draftEmoji);
    // Persist to backend (non-critical). The endpoint is a PUT upsert; POST 404s.
    putAgent({ name, emoji: draftEmoji }).catch(()=>{});
    setCustOpen(false);
    const t2=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    setMessages(prev=>[...prev,{id:Date.now(),from:"agent",text:t('agent.updated').replace('{name}',name).replace('{emoji}',draftEmoji),time:t2}]);
  };

  // datetime-local gives local wall-clock; the API wants ISO.
  const toLocalInput=(iso)=>{ if(!iso) return ""; const d=new Date(iso); if(Number.isNaN(d.getTime())) return "";
    const p=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

  const closeTaskSheet=()=>{ setTaskOpen(false); setTEditing(null); setTTitle(""); setTDesc(""); setTPriority("medium"); setTDueAt(""); };

  const openNewTask=()=>{ setTEditing(null); setTTitle(""); setTDesc(""); setTPriority("medium"); setTDueAt(""); setTaskOpen(true); };

  const openEditTask=(tk)=>{
    setTEditing(tk); setTTitle(tk.title||""); setTDesc(tk.description||"");
    setTPriority(tk.priority||"medium"); setTDueAt(toLocalInput(tk.due_at)); setTaskOpen(true);
  };

  const removeTask=async(tk)=>{
    if(!window.confirm(t('agent.confirm_delete')?.includes('agent.') ? `Delete “${tk.title}”?` : t('agent.confirm_delete'))) return;
    await deleteTask(tk.id);
  };

  const addTask=async()=>{
    if(!tTitle.trim()) return;
    const ts=new Date().toLocaleTimeString('en-GB',{hour:"2-digit",minute:"2-digit"});
    const dueAt=tDueAt?new Date(tDueAt).toISOString():null;
    if(tEditing){
      await updateTask({ id:tEditing.id, title:tTitle, description:tDesc, priority:tPriority, dueAt });
    } else {
      await createTask({ title:tTitle, description:tDesc, priority:tPriority, dueAt });
      setMessages(prev=>[...prev,{id:Date.now(),from:"agent",text:t('agent.task_assigned').replace('{title}',tTitle).replace('{priority}',PRI_LABEL[tPriority]),time:ts}]);
    }
    closeTaskSheet();
    if(innerTab!=="tasks") setInnerTab("tasks");
  };

  const filteredTasks=tasks.filter(tk=>taskFilter==="done"?tk.status==="done":tk.status!=="done");
  const pendingCount=tasks.filter(tk=>tk.status!=="done").length;
  const doneCount=tasks.filter(tk=>tk.status==="done").length;
  const highCount=tasks.filter(tk=>tk.priority==="high"&&tk.status!=="done").length;

  return (
    <div style={{ display:"flex",flexDirection:"column",height:"100%",background:"var(--ak-surface)" }}>
      {/* Ensure chat/task inputs stay readable in dark mode (WebKit text-fill + placeholder) */}
      <style>{`
        .ak-chat-input, .ak-chat-input input, .ak-chat-input textarea {
          color: var(--ak-text);
          -webkit-text-fill-color: var(--ak-text);
          caret-color: var(--ak-accent, #6C3BFF);
        }
        .ak-chat-input::placeholder, .ak-chat-input input::placeholder, .ak-chat-input textarea::placeholder {
          color: var(--ak-text-muted);
          -webkit-text-fill-color: var(--ak-text-muted);
          opacity: 1;
        }
      `}</style>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 18px 11px",borderBottom:"1px solid var(--ak-border)",background:"var(--ak-surface)",flexShrink:0 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <div style={{ width:44,height:44,borderRadius:"50%",background:`${BRAND}15`,border:`2px solid ${BRAND}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,position:"relative" }}>
            {agentEmoji}<div style={{ position:"absolute",bottom:0,right:0,width:12,height:12,borderRadius:"50%",background:GREEN,border:"2px solid #fff",animation:"pulse-dot 2s ease-in-out infinite" }}/>
          </div>
          <div>
            <p style={{ fontSize:14,fontWeight:900,color:"var(--ak-text)",margin:0 }}>{shownName}</p>
            <div style={{ display:"flex",alignItems:"center",gap:4 }}><div style={{ width:5,height:5,borderRadius:"50%",background:GREEN }}/><span style={{ fontSize:10.5,fontWeight:600,color:"var(--ak-text-muted)" }}>{`${t('common.online')} · ${t('agent.learning_agent')}`}</span></div>
          </div>
        </div>
        <button onClick={()=>{setDraftName(agentName);setDraftEmoji(agentEmoji);setCustOpen(true);}} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",fontSize:11.5,fontWeight:700,color:"var(--ak-text-sub)",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-sub)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>{t('agent.customise')}
        </button>
      </div>
      <div style={{ display:"flex",borderBottom:"1px solid var(--ak-border)",background:"var(--ak-surface)",flexShrink:0 }}>
        {[{key:"chat",label:t('agent.chat'),icon:"💬",badge:null},{key:"tasks",label:t('agent.tasks'),icon:"📋",badge:pendingCount},{key:"stats",label:t('agent.stats'),icon:"📊",badge:null}].map(({key,label,icon,badge})=>(
          <button key={key} onClick={()=>setInnerTab(key)} style={{ flex:1,padding:"9px 4px 10px",background:"none",border:"none",cursor:"pointer",fontSize:11.5,fontWeight:innerTab===key?800:600,color:innerTab===key?BRAND:"var(--ak-text-muted)",borderBottom:`2.5px solid ${innerTab===key?BRAND:"transparent"}`,transition:"all .2s",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:4 }}>
            <span style={{ fontSize:13 }}>{icon}</span>{label}
            {badge>0&&<span style={{ fontSize:9,fontWeight:900,background:innerTab===key?BRAND:"var(--ak-border)",color:innerTab===key?"#fff":"var(--ak-text-muted)",borderRadius:8,padding:"1px 5px" }}>{badge}</span>}
          </button>
        ))}
      </div>
      {innerTab==="chat"&&(
        <>
          <div style={{ display:"flex",alignItems:"center",gap:7,padding:"10px 18px 8px",overflowX:"auto",scrollbarWidth:"none",borderBottom:"1px solid var(--ak-border)",flexShrink:0 }}>
            <button onClick={()=>{loadSessions();setDrawerOpen(true);}} title={t('agent.chats')} aria-label={t('agent.chats')} style={{ flexShrink:0,width:30,height:30,borderRadius:9,border:"1px solid var(--ak-border2)",background:"var(--ak-surface-hover)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",padding:0 }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-sub)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <div style={{ width:1,height:18,background:"var(--ak-border)",flexShrink:0 }}/>
            {QUICK_PROMPTS.map(p=><button key={p.text} onClick={()=>sendMessage(p.text)} style={{ flexShrink:0,padding:"5px 12px",borderRadius:20,border:`1px solid ${BRAND}30`,background:`${BRAND}08`,color:BRAND,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Nunito',sans-serif",whiteSpace:"nowrap" }}>{t(p.key)}</button>)}
          </div>
          <div ref={feedRef} style={{ flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12 }}>
            {messages.map(msg=>{
              const isMe=msg.from==="me";
              return (
                <div key={msg.id} style={{ display:"flex",justifyContent:isMe?"flex-end":"flex-start",alignItems:"flex-end",gap:8 }}>
                  {!isMe&&<div style={{ width:30,height:30,borderRadius:"50%",background:`${BRAND}15`,border:`1.5px solid ${BRAND}40`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>{agentEmoji}</div>}
                  <div style={{ maxWidth:"78%" }}>
                    <div style={{ padding:"10px 14px",borderRadius:isMe?"18px 18px 4px 18px":"4px 18px 18px 18px",background:isMe?`linear-gradient(135deg,${BRAND},#4C1DCC)`:"var(--ak-surface-hover)",border:isMe?"none":`1px solid ${BRAND}25`,color:isMe?"#fff":"var(--ak-text)",fontSize:13.5,lineHeight:1.6,whiteSpace:"pre-wrap",fontWeight:500 }}>{msg.text}</div>
                    {!isMe&&msg.syllabus?.length>0&&(
                      <div style={{ display:"flex",flexWrap:"wrap",gap:5,marginTop:5 }}>
                        {msg.syllabus.map((s,i)=>(
                          <span key={i} title={`${s.exam?s.exam+" ":""}${s.subject} — ${s.topic}`} style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:10.5,fontWeight:800,padding:"3px 9px",borderRadius:20,background:`${BRAND}12`,border:`1px solid ${BRAND}30`,color:BRAND,maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                            📘 {s.exam?`${s.exam} · `:""}{s.topic}
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize:10,color:"var(--ak-text-muted)",marginTop:3,textAlign:isMe?"right":"left" }}>{msg.time}</div>
                  </div>
                </div>
              );
            })}
            {loading&&<div style={{ display:"flex",alignItems:"flex-end",gap:8 }}><div style={{ width:30,height:30,borderRadius:"50%",background:`${BRAND}15`,border:`1.5px solid ${BRAND}40`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>{agentEmoji}</div><div style={{ padding:"12px 16px",borderRadius:"4px 18px 18px 18px",background:"var(--ak-surface-hover)",border:`1px solid ${BRAND}25`,display:"flex",gap:4,alignItems:"center" }}>{[0,.25,.5].map((d,i)=><div key={i} style={{ width:6,height:6,borderRadius:"50%",background:BRAND,animation:`bounce-dot .7s ease-in-out ${d}s infinite alternate` }}/>)}</div></div>}
          </div>
          <div style={{ padding:"10px 16px 12px",borderTop:"1px solid var(--ak-border)",background:"var(--ak-surface)",flexShrink:0 }}>
            <div style={{ display:"flex",gap:8,alignItems:"center",background:"var(--ak-surface-hover)",borderRadius:50,border:"1.5px solid var(--ak-border2)",padding:"7px 8px 7px 16px" }}>
              <input className="ak-chat-input" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}} placeholder={t('agent.ask_anything').replace('{name}', shownName)} style={{ flex:1,background:"transparent",border:"none",outline:"none",fontSize:13.5,color:"var(--ak-text)",fontFamily:"'Nunito',sans-serif" }}/>
              <button onClick={()=>setTaskOpen(true)} style={{ display:"flex",alignItems:"center",gap:4,padding:"5px 10px",borderRadius:20,border:`1px solid ${GOLD}40`,background:`${GOLD}12`,fontSize:10.5,fontWeight:800,color:"#B45309",cursor:"pointer",fontFamily:"'Nunito',sans-serif",flexShrink:0 }}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>{t('agent.task')}
              </button>
              <button onClick={()=>sendMessage()} style={{ width:36,height:36,borderRadius:"50%",background:input.trim()?`linear-gradient(135deg,${BRAND},#4C1DCC)`:"var(--ak-border2)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:input.trim()?"pointer":"default",flexShrink:0,transition:"background .2s" }}><SendIcon size={15} color={input.trim()?"#fff":"var(--ak-text-muted)"}/></button>
            </div>
          </div>
        </>
      )}
      {innerTab==="tasks"&&(
        <div style={{ flex:1,overflowY:"auto",display:"flex",flexDirection:"column" }}>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,padding:"12px 16px 10px",borderBottom:"1px solid var(--ak-border)" }}>
            {[{val:pendingCount,label:t('agent.pending'),color:RED},{val:doneCount,label:t('agent.done'),color:GREEN},{val:highCount,label:t('agent.high_priority'),color:GOLD}].map(({val,label,color})=>(
              <div key={label} style={{ textAlign:"center",background:"var(--ak-surface-hover)",borderRadius:12,padding:"10px 6px",border:"1px solid var(--ak-border)" }}>
                <div style={{ fontSize:20,fontWeight:900,color }}>{val}</div>
                <div style={{ fontSize:10,color:"var(--ak-text-muted)",marginTop:1 }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px 8px" }}>
            <div style={{ display:"flex",gap:6 }}>{[["pending",t('agent.to_do')],["done",t('agent.done')]].map(([k,l])=><button key={k} onClick={()=>setTaskFilter(k)} style={{ padding:"5px 12px",borderRadius:20,border:`1.5px solid ${taskFilter===k?BRAND:"var(--ak-border2)"}`,background:taskFilter===k?`${BRAND}10`:"transparent",color:taskFilter===k?BRAND:"var(--ak-text-muted)",fontSize:11.5,fontWeight:700,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{l}</button>)}</div>
            <button onClick={openNewTask} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:11.5,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>{t('agent.new_task')}
            </button>
          </div>
          <div style={{ flex:1,padding:"0 16px 16px",display:"flex",flexDirection:"column",gap:8 }}>
            {filteredTasks.length===0?<div style={{ textAlign:"center",padding:"32px 16px",color:"var(--ak-text-muted)" }}><span style={{ fontSize:40,opacity:.3 }}>📋</span><p style={{ fontSize:13,fontWeight:700,marginTop:8 }}>{taskFilter==="done"?t('agent.no_completed'):t('agent.all_done')}</p></div>:filteredTasks.map(tk=>(
              <div key={tk.id} style={{ display:"flex",alignItems:"flex-start",gap:11,padding:"12px 14px",borderRadius:14,background:"var(--ak-surface)",border:"1px solid var(--ak-border)",opacity:tk.status==="done"?.6:1 }}>
                <button onClick={()=>toggleTask(tk.id)} style={{ marginTop:2,width:22,height:22,borderRadius:6,border:`2px solid ${tk.status==="done"?GREEN:"var(--ak-border3)"}`,background:tk.status==="done"?GREEN:"var(--ak-surface)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0 }}>
                  {tk.status==="done"&&<svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
                <div style={{ flex:1,minWidth:0 }}>
                  <p style={{ fontSize:13.5,fontWeight:tk.status==="done"?500:700,color:tk.status==="done"?"var(--ak-text-muted)":"var(--ak-text)",textDecoration:tk.status==="done"?"line-through":"none",margin:"0 0 4px" }}>{tk.title}</p>
                  {tk.description&&<p style={{ fontSize:12,color:"var(--ak-text-sub)",margin:"0 0 5px",lineHeight:1.45 }}>{tk.description}</p>}
                  <div style={{ display:"flex",alignItems:"center",gap:7,flexWrap:"wrap" }}>
                    <span style={{ fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:20,background:PRI_BG[tk.priority],color:PRI_COLOR[tk.priority] }}>{PRI_LABEL[tk.priority]}</span>
                    {tk.due_at&&<span style={{ fontSize:10,fontWeight:700,color:new Date(tk.due_at)<new Date()&&tk.status!=="done"?RED:"var(--ak-text-muted)" }}>
                      🗓 {new Date(tk.due_at).toLocaleDateString()} {new Date(tk.due_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                    </span>}
                    {tk.is_recurring&&<span style={{ fontSize:10,fontWeight:700,color:BRAND }}>🔁 repeats</span>}
                  </div>
                </div>
                <div style={{ display:"flex",gap:5,flexShrink:0 }}>
                  <button onClick={()=>openEditTask(tk)} disabled={tk.status==="running"} title="Edit"
                    style={{ width:26,height:26,borderRadius:8,border:"1px solid var(--ak-border2)",background:"var(--ak-surface-hover)",cursor:tk.status==="running"?"not-allowed":"pointer",opacity:tk.status==="running"?.4:1,fontSize:11 }}>✏️</button>
                  <button onClick={()=>removeTask(tk)} disabled={tk.status==="running"} title="Delete"
                    style={{ width:26,height:26,borderRadius:8,border:"1px solid var(--ak-border2)",background:"var(--ak-surface-hover)",cursor:tk.status==="running"?"not-allowed":"pointer",opacity:tk.status==="running"?.4:1,fontSize:11 }}>🗑</button>
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
        <><div onClick={closeTaskSheet} style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(6,6,18,.55)",backdropFilter:"blur(5px)" }}/>
        <div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:2100,background:"var(--ak-surface)",borderRadius:"22px 22px 0 0",padding:"0 20px 52px",boxShadow:"0 -8px 40px rgba(0,0,0,.14)",animation:"sheet-up .3s cubic-bezier(.32,1.2,.64,1)",fontFamily:"'Nunito',sans-serif",maxHeight:"80vh",overflowY:"auto" }}>
          <div style={{ width:38,height:4,borderRadius:2,background:"var(--ak-border3)",margin:"14px auto 20px" }}/>
          <p style={{ fontSize:16,fontWeight:900,color:"var(--ak-text)",margin:"0 0 6px" }}>{tEditing?`✏️ Edit task`:`📋 ${t('agent.assign_to')} ${agentName}`}</p>
          <p style={{ fontSize:12,color:"var(--ak-text-muted)",margin:"0 0 20px",lineHeight:1.5 }}>{t('agent.assign_sub')}</p>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sub)",display:"block",marginBottom:6,letterSpacing:.3 }}>{t('agent.task_title')}</label><input className="ak-chat-input" value={tTitle} onChange={e=>setTTitle(e.target.value)} placeholder={t('agent.task_title_ph')} style={{ width:"100%",padding:"11px 14px",borderRadius:12,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",fontSize:13.5,fontWeight:600,color:"var(--ak-text)",fontFamily:"'Nunito',sans-serif",outline:"none",boxSizing:"border-box" }} onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="var(--ak-border2)"}/></div>
          <div style={{ marginBottom:18 }}><label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sub)",display:"block",marginBottom:6,letterSpacing:.3 }}>{t('agent.description')} <span style={{ fontSize:10,fontWeight:500,color:"var(--ak-text-muted)" }}>{t('common.optional')}</span></label><textarea className="ak-chat-input" value={tDesc} onChange={e=>setTDesc(e.target.value)} placeholder={t('agent.desc_ph')} rows={3} style={{ width:"100%",padding:"11px 14px",borderRadius:12,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",fontSize:13,color:"var(--ak-text)",fontFamily:"'Nunito',sans-serif",outline:"none",resize:"none",lineHeight:1.5,boxSizing:"border-box" }} onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="var(--ak-border2)"}/></div>
          <div style={{ marginBottom:22 }}><label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sub)",display:"block",marginBottom:8,letterSpacing:.3 }}>{t('agent.priority')}</label><div style={{ display:"flex",gap:8 }}>{[["high",t('agent.pri_high')],["medium",t('agent.pri_medium')],["low",t('agent.pri_low')]].map(([k,l])=><button key={k} onClick={()=>setTPriority(k)} style={{ flex:1,padding:"9px 6px",borderRadius:12,border:`1.5px solid ${tPriority===k?PRI_COLOR[k]:"var(--ak-border2)"}`,background:tPriority===k?`${PRI_COLOR[k]}10`:"var(--ak-surface-hover)",fontSize:12,fontWeight:800,color:tPriority===k?PRI_COLOR[k]:"var(--ak-text-sub)",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{l}</button>)}</div></div>
          <div style={{ marginBottom:22 }}>
            <label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sub)",display:"block",marginBottom:6,letterSpacing:.3 }}>
              🗓 Run at <span style={{ fontSize:10,fontWeight:500,color:"var(--ak-text-muted)" }}>{t('common.optional')}</span>
            </label>
            <input type="datetime-local" value={tDueAt} onChange={e=>setTDueAt(e.target.value)}
              style={{ width:"100%",padding:"11px 14px",borderRadius:12,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",fontSize:13.5,fontWeight:600,color:"var(--ak-text)",fontFamily:"'Nunito',sans-serif",outline:"none",boxSizing:"border-box" }}/>
            <p style={{ fontSize:10.5,color:"var(--ak-text-muted)",margin:"5px 0 0",lineHeight:1.45 }}>
              Leave empty and your agent starts right away. Pick a date and time to schedule it.
            </p>
          </div>
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={closeTaskSheet} style={{ flex:1,padding:"13px",borderRadius:14,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",fontSize:13,fontWeight:800,color:"var(--ak-text-sub)",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{t('common.cancel')}</button>
            <button onClick={addTask} style={{ flex:1.6,padding:"13px",borderRadius:14,border:"none",background:tTitle.trim()?`linear-gradient(135deg,${BRAND},#4C1DCC)`:"var(--ak-border2)",fontSize:13,fontWeight:800,color:tTitle.trim()?"#fff":"var(--ak-text-muted)",cursor:tTitle.trim()?"pointer":"default",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:7 }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={tTitle.trim()?"#fff":"var(--ak-text-muted)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>{tEditing?'Save changes':t('agent.assign_task')}
            </button>
          </div>
        </div></>
      )}
      {custOpen&&(
        <><div onClick={()=>setCustOpen(false)} style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(6,6,18,.55)",backdropFilter:"blur(5px)" }}/>
        <div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:2100,background:"var(--ak-surface)",borderRadius:"22px 22px 0 0",padding:"0 20px 48px",boxShadow:"0 -8px 40px rgba(0,0,0,.14)",animation:"sheet-up .3s cubic-bezier(.32,1.2,.64,1)",fontFamily:"'Nunito',sans-serif",maxHeight:"80vh",overflowY:"auto" }}>
          <div style={{ width:38,height:4,borderRadius:2,background:"var(--ak-border3)",margin:"14px auto 20px" }}/>
          <p style={{ fontSize:16,fontWeight:900,color:"var(--ak-text)",margin:"0 0 18px" }}>{t('agent.customise_title')}</p>
          <div style={{ marginBottom:16 }}><label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sub)",display:"block",marginBottom:6,letterSpacing:.3 }}>{t('agent.agent_name')}</label><input className="ak-chat-input" value={draftName} onChange={e=>setDraftName(e.target.value)} placeholder={t('agent.name_ph')} style={{ width:"100%",padding:"11px 14px",borderRadius:12,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",fontSize:14,fontWeight:600,color:"var(--ak-text)",fontFamily:"'Nunito',sans-serif",outline:"none" }} onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="var(--ak-border2)"}/></div>
          <div style={{ marginBottom:22 }}><label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sub)",display:"block",marginBottom:10,letterSpacing:.3 }}>{t('agent.avatar')}</label><div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>{AGENT_CONFIG.avatars.map(em=><button key={em} onClick={()=>setDraftEmoji(em)} style={{ width:46,height:46,borderRadius:12,border:`2px solid ${draftEmoji===em?BRAND:"var(--ak-border2)"}`,background:draftEmoji===em?`${BRAND}12`:"var(--ak-surface-hover)",fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s" }}>{em}</button>)}</div></div>
          <div style={{ display:"flex",alignItems:"center",gap:12,background:`${BRAND}08`,border:`1px solid ${BRAND}20`,borderRadius:14,padding:"12px 14px",marginBottom:20 }}>
            <div style={{ width:44,height:44,borderRadius:"50%",background:`${BRAND}15`,border:`2px solid ${BRAND}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22 }}>{draftEmoji}</div>
            <div><p style={{ fontSize:14,fontWeight:900,color:"var(--ak-text)",margin:0 }}>{draftName||t('agent.unnamed')}</p><p style={{ fontSize:11,color:"var(--ak-text-muted)",margin:0 }}>{t('common.online')}</p></div>
          </div>
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={()=>setCustOpen(false)} style={{ flex:1,padding:"13px",borderRadius:14,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",fontSize:13,fontWeight:800,color:"var(--ak-text-sub)",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{t('common.cancel')}</button>
            <button onClick={saveCustomise} style={{ flex:1.5,padding:"13px",borderRadius:14,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:7 }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>{t('agent.save_agent')}
            </button>
          </div>
        </div></>
      )}
      {/* Chat sessions drawer (hamburger) */}
      {drawerOpen&&(
        <><div onClick={()=>setDrawerOpen(false)} style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(6,6,18,.55)",backdropFilter:"blur(5px)" }}/>
        <div style={{ position:"fixed",top:0,bottom:0,left:0,zIndex:2100,width:"min(86vw,320px)",background:"var(--ak-surface)",boxShadow:"6px 0 40px rgba(0,0,0,.18)",animation:"drawer-in .28s cubic-bezier(.32,1,.64,1)",fontFamily:"'Nunito',sans-serif",display:"flex",flexDirection:"column" }}>
          <style>{`@keyframes drawer-in{from{transform:translateX(-100%)}to{transform:translateX(0)}}`}</style>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 16px 12px",borderBottom:"1px solid var(--ak-border)",flexShrink:0 }}>
            <p style={{ fontSize:15,fontWeight:900,color:"var(--ak-text)",margin:0 }}>{t('agent.chats')}</p>
            <button onClick={()=>setDrawerOpen(false)} style={{ background:"none",border:"none",cursor:"pointer",padding:4,display:"flex" }}><XIcon size={17} color="var(--ak-text-muted)"/></button>
          </div>
          <div style={{ padding:"12px 16px",flexShrink:0 }}>
            <button onClick={newChat} style={{ width:"100%",padding:"11px",borderRadius:12,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:7 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>{t('agent.new_chat')}
            </button>
          </div>
          <div style={{ flex:1,overflowY:"auto",padding:"0 10px 16px" }}>
            {sessionsLoading&&sessions.length===0?(
              <p style={{ textAlign:"center",fontSize:12,color:"var(--ak-text-muted)",padding:"20px 0" }}>{t('common.loading')}</p>
            ):sessions.length===0?(
              <div style={{ textAlign:"center",padding:"28px 16px",color:"var(--ak-text-muted)" }}><span style={{ fontSize:34,opacity:.3 }}>💬</span><p style={{ fontSize:12.5,fontWeight:700,marginTop:8 }}>{t('agent.no_chats')}</p></div>
            ):sessions.map(s=>{
              const active=s.id===sessionId;
              return (
                <div key={s.id} onClick={()=>openSession(s.id)} style={{ display:"flex",alignItems:"center",gap:8,padding:"10px 10px",borderRadius:10,cursor:"pointer",background:active?`${BRAND}12`:"transparent",border:`1px solid ${active?`${BRAND}30`:"transparent"}`,marginBottom:2 }}>
                  <div style={{ flex:1,minWidth:0 }}>
                    <p style={{ fontSize:13,fontWeight:active?800:700,color:active?BRAND:"var(--ak-text)",margin:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{s.title||t('agent.new_chat')}</p>
                    <p style={{ fontSize:10.5,color:"var(--ak-text-muted)",margin:"2px 0 0" }}>{relTime(s.last_message_at)}</p>
                  </div>
                  <button onClick={(e)=>removeSession(s.id,e)} title={t('common.delete')} style={{ background:"none",border:"none",cursor:"pointer",padding:5,display:"flex",flexShrink:0,opacity:.6 }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                </div>
              );
            })}
          </div>
        </div></>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════ */

export default AgentChatTab;
