import { useState, useRef, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, STUDENT_ID } from '../../constants.js';
import { apiGet, apiPost, apiDelete, streamPost } from '../../services/api.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { ZapIcon, BrainIcon, SparkleIcon, XIcon, Icon } from '../common/Icons.jsx';
import FortizoChatComposer from '../common/FortizoChatComposer.jsx';
import RichText from '../common/RichText.jsx';
import CopyMessageButton from '../common/CopyMessageButton.jsx';
import { useTaskAPI } from '../../hooks/useTaskAPI.js';
import NoAgentSheet, { isNoAgentError } from '../battles/NoAgentSheet.jsx';
import { confirmDialog } from '../common/ConfirmHost.jsx';
import AgentStatsTab from './AgentStatsTab.jsx';
import { agentChatEndpoint, createAgentChatTurnId } from '../../lib/agentChatEndpoint.js';
import StreamCaret from '../common/StreamCaret.jsx';
import Spinner from '../common/Spinner.jsx';
import { useInFlight } from '../../hooks/useInFlight.js';
import StudyPrepChatCard from './studyPrep/StudyPrepChatCard.jsx';
import { fetchActiveStudyPrepSession } from '../../services/studyPrepApi.js';

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

/* Collapsible "Thought process" — the reasoning model's streamed summary.
   While the thoughts are still streaming it sits open (with a live shimmer);
   once the answer starts (or the learner toggles it) it collapses. */
function ThoughtBlock({ thinking, streaming }) {
  const { t } = useLang();
  const [open, setOpen] = useState(null);            // null = follow the stream
  const expanded = open ?? streaming;
  if (!thinking && !streaming) return null;
  return (
    <div style={{ marginBottom: 6, borderRadius: 12, border: "1px solid var(--ak-border)", background: "var(--ak-surface-hover)", overflow: "hidden" }}>
      <button onClick={() => setOpen(!expanded)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", background: "none", border: "none", cursor: "pointer", fontFamily: "'Nunito',sans-serif" }}>
        <Icon name="ti-brain" size={12}/>
        <span style={{ flex: 1, textAlign: "left", fontSize: 11, fontWeight: 800, color: "var(--ak-text-muted)", letterSpacing: .2 }}>{t('agent.thought_process')}</span>
        {streaming && expanded
          ? <span style={{ width: 7, height: 7, borderRadius: '50%', background: BRAND, display: 'inline-block', animation: 'pulse-dot 1.2s ease-in-out infinite' }}/>
          : <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="var(--ak-text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform .15s" }}><polyline points="6 9 12 15 18 9"/></svg>}
      </button>
      {expanded && (
        <div style={{ maxHeight: 150, overflowY: "auto", padding: "2px 12px 9px", fontSize: 11.5, lineHeight: 1.55, color: "var(--ak-text-muted)", whiteSpace: "pre-wrap", fontStyle: "italic" }}>
          {thinking || "…"}{streaming && expanded && <StreamCaret/>}
        </div>
      )}
    </div>
  );
}

function AgentChatTab({
  onStartTeach, onStartExamPrep, onOpenConceptTracker, onOpenAdaptiveControls, agentNameProp, agentEmojiProp, onChatActive,
  agentOnline = false, agentAutonomyLoaded = false, agentAutonomySaving = false,
  onToggleAgentAutonomy,
  agentActivity = null,
}) {
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
  const [innerTab,   setInnerTab]   = useState("chat");
  const shownName = agentName || t('agent.learning_agent');
  // The status line: Idle is the resting state — it swaps to the live
  // background label ("Reviewing your goals…") while the agent works,
  // and says offline when the consent is off. Transient states first.
  const autonomyStatus = !agentAutonomyLoaded ? "Checking agent…"
    : agentAutonomySaving ? "Saving…"
    : !agentOnline ? "Agent offline"
    : agentActivity || "Idle";
  const [taskOpen,   setTaskOpen]   = useState(false);
  const [taskFilter, setTaskFilter] = useState("pending");
  const [tTitle,     setTTitle]     = useState("");
  const [tDesc,      setTDesc]      = useState("");
  const [tPriority,  setTPriority]  = useState("medium");
  const [tDueAt,     setTDueAt]     = useState("");     // datetime-local wall-clock
  const [tEditing,   setTEditing]   = useState(null);   // task being edited, or null
  const [tError,     setTError]     = useState("");   // inside the task sheet
  const [listError,  setListError]  = useState("");   // on the task list itself
  const [needsAgent, setNeedsAgent] = useState(false);
  const feedRef = useRef(null);

  // ── Chat modes (Think / Research) + attachments ────────────────────────────
  // Modes are exclusive: Think for careful reasoning, Research for a deeper,
  // sourced study-guide answer. The choice persists across messages until the
  // learner taps the pill again.
  const [thinkMode,    setThinkMode]    = useState(false);
  const [researchMode, setResearchMode] = useState(false);
  const [attachments,  setAttachments]  = useState([]);   // {id, file, name, size, previewUrl}
  const [attachError,  setAttachError]  = useState("");
  const [statusLabel,  setStatusLabel]  = useState("");   // streaming phase ("Searching the syllabus…")
  const fileInputRef   = useRef(null);
  const MAX_FILES      = 4;
  const MAX_FILE_MB    = 5;
  const isSupportedFile = (f) =>
    /^image\//.test(f.type) || f.type === "application/pdf" ||
    /\.(txt|md|csv)$/i.test(f.name);

  const addAttachments = (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    setAttachError("");
    const room = MAX_FILES - attachments.length;
    if (room <= 0) { setAttachError(t('agent.attach_too_many').replace('{max}', MAX_FILES)); return; }
    const accepted = [], rejected = [];
    files.forEach((f) => {
      if (!isSupportedFile(f) || f.size > MAX_FILE_MB * 1024 * 1024) rejected.push(f);
      else if (accepted.length < room) accepted.push(f);
    });
    if (rejected.length) setAttachError(t('agent.attach_rejected').replace('{max}', MAX_FILE_MB));
    if (accepted.length) {
      setAttachments(prev => [...prev, ...accepted.map((f, i) => ({
        id: Date.now() + "-" + i, file: f, name: f.name, size: f.size,
        previewUrl: /^image\//.test(f.type) ? URL.createObjectURL(f) : null,
      }))]);
    }
  };

  const removeAttachment = (id) => {
    setAttachments(prev => {
      const hit = prev.find(a => a.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter(a => a.id !== id);
    });
  };

  // File → data URL for the API (images go to vision; PDFs get decoded
  // server-side for text extraction / scan OCR).
  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });

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

  const { tasks, createTask, updateTask, toggleTask, deleteTask, refetch: refetchTasks,
    suggestions, refetchSuggestions, acceptSuggestion: acceptSuggestionApi, dismissSuggestion: dismissSuggestionApi } = useTaskAPI();

  // Full Autonomy (level 2): the background planner's proposals land in the
  // SAME inbox as chat suggestions. Only approval executes — the backend
  // replays the proposal through the exact tool the chat itself uses.
  const [proposals,setProposals]=useState([]);
  const [proposalBusyId,setProposalBusyId]=useState(null);
  const pendingProposals=proposals.filter(p=>p.status==="proposed");
  const suggestionCount=suggestions.length+pendingProposals.length;
  const refetchProposals=async()=>{ try{ const d=await apiGet('/api/agent/proposals'); setProposals(Array.isArray(d?.data)?d.data:[]); }catch{} };
  useEffect(()=>{ refetchProposals(); },[]);
  const approveProposal=async(p)=>{
    if(proposalBusyId) return;
    setProposalBusyId(p.id); setListError("");
    try {
      const d=await apiPost(`/api/agent/proposals/${p.id}/approve`,{});
      setProposals(prev=>prev.map(x=>x.id===p.id?{...x,status:'executed'}:x));
      if(p.kind==='session') pushAgent(t('agent.proposal_done_session'));
      else if(p.kind==='goal') pushAgent(t('agent.proposal_done_goal').replace('{title}',d?.data?.title||p.title));
      else { pushAgent(t('agent.proposal_done_task').replace('{title}',d?.data?.title||p.title)); refetchTasks(); }
    } catch(e){ setListError(e?.message||t('agent.proposal_failed')); refetchProposals(); }
    finally{ setProposalBusyId(null); }
  };
  const dismissProposal=async(p)=>{
    if(proposalBusyId) return;
    setProposalBusyId(p.id); setListError("");
    try { await apiPost(`/api/agent/proposals/${p.id}/dismiss`,{}); setProposals(prev=>prev.filter(x=>x.id!==p.id)); }
    catch(e){ setListError(e?.message||t('agent.proposal_failed')); }
    finally{ setProposalBusyId(null); }
  };

  // Agent suggestions: accept turns the idea into a real task (the agent
  // confirms it in the transcript, like a task the learner assigned); dismiss
  // just closes the idea. Both are optimistic and server-reconciled.
  const acceptSuggestion=async(sg)=>{
    setListError("");
    try {
      const d=await acceptSuggestionApi(sg);
      pushAgent(t('agent.suggestion_added').replace('{title}',d?.task?.title||sg.title));
    } catch(e){ setListError(e?.message||"Couldn't add that suggestion."); refetchSuggestions(); }
  };
  const dismissSuggestion=async(sg)=>{
    setListError("");
    try { await dismissSuggestionApi(sg.id); }
    catch(e){ setListError(e?.message||"Couldn't dismiss that suggestion."); }
  };

  const pushAgent = (text) => {
    const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages(prev => [...prev, { id: Date.now() + Math.random(), from: "agent", text, time: t }]);
  };

  const PRI_COLOR = {high:RED,medium:GOLD,low:GREEN};
  const PRI_LABEL = {high:t('agent.pri_high_label'),medium:t('agent.pri_medium_label'),low:t('agent.pri_low_label')};
  const PRI_BG    = {high:`${RED}15`,medium:`${GOLD}15`,low:`${GREEN}15`};

  // The study-prep session is the durable layer — it outlives chats. On mount,
  // restore an active session as an agent message carrying the session card,
  // exactly like a fresh start_study_prep_session tool echo would.
  useEffect(() => {
    let cancelled = false;
    fetchActiveStudyPrepSession()
      .then((response) => {
        if (cancelled || !response?.session?.id) return;
        setMessages((prev) => prev.some((m) => m.studyPrepSessionId === response.session.id) ? prev : [...prev, {
          id: `study-prep-${response.session.id}`,
          from: "agent",
          text: "Your study-prep session is active — pick up where you left off:",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          phase: "done",
          studyPrepSessionId: response.session.id,
        }]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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

  // Tell the dashboard whether the CHAT surface is showing (vs tasks/stats/
  // self-study sub-tabs): the Now-Studying bar hides on chat only, per spec.
  // Unmount also reports false so the bar returns when we leave this tab.
  useEffect(() => {
    onChatActive?.(innerTab === "chat");
    return () => onChatActive?.(false);
  }, [innerTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage=async(overrideText)=>{
    // Attachments can be sent with an empty message — a friendly default text
    // stands in so the model (and the transcript) knows what's being asked.
    const raw=(overrideText??input).trim();
    const text=raw || (attachments.length ? t('agent.attach_default_msg') : "");
    if(!text||loading) return;
    if(!overrideText) setInput("");
    const ts=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const userMsg={id:Date.now(),from:"me",text,time:ts,attachments:attachments.map(a=>({name:a.name,previewUrl:a.previewUrl}))};
    const sentAttachments=attachments;
    setMessages(prev=>[...prev,userMsg]); setLoading(true);
    setAttachError(""); setStatusLabel("");

    // Every learner turn uses the one unified Agent endpoint. It creates an
    // owned session before the request, then the API—not browser intent regexes
    // or separate persistence writes—selects direct tutoring or an authorised
    // tool and commits the completed turn.
    const sid = await ensureSession(text);
    if (!sid) {
      pushAgent(t('agent.error_connection'));
      setLoading(false);
      return;
    }
    const mode = thinkMode ? "think" : researchMode ? "research" : "default";
    const statusKey = { grounding:'agent.status_grounding', attachments:'agent.status_attachments', thinking:'agent.status_thinking', synthesis:'agent.status_synthesis' };
    const attachmentsPayload = await Promise.all(sentAttachments.map(async (a) => ({
      name: a.name, type: a.file.type || "", dataUrl: await fileToDataUrl(a.file),
    })));
    const history = messages.map(m => ({ role: m.from === "me" ? "user" : "assistant", content: m.text }));
    // A retry keeps the same opaque key for this send, allowing the server's
    // durable turn contract to repair a partial write without duplicate rows.
    const turnId = createAgentChatTurnId();
    const payload = { message: text, history: history.slice(-24), agentName, mode,
      conversationId: sid, turnId,
      ...(attachmentsPayload.length ? { attachments: attachmentsPayload } : {}) };
    const t2=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const replyId=Date.now()+Math.random();
    let started=false;
    const ensureBubble=()=>{
      if(started) return;
      started=true;
      setLoading(false);   // hide typing dots — the bubble now carries the text
      setMessages(prev=>[...prev,{id:replyId,from:"agent",text:"",time:t2,thinking:"",phase:"thinking"}]);
    };
    const appendThinking=(chunk)=>{
      ensureBubble();
      setMessages(prev=>prev.map(m=>m.id===replyId?{...m,thinking:m.thinking+chunk}:m));
    };
    const appendDelta=(chunk)=>{
      ensureBubble();
      setStatusLabel("");
      setMessages(prev=>prev.map(m=>m.id===replyId?{...m,text:m.text+chunk,phase:"answering"}:m));
    };
    let finalReply="";
    try {
      finalReply = await streamPost(agentChatEndpoint({ stream: true }), payload, {
        onDelta: appendDelta,
        onThinking: appendThinking,
        onStatus: (s)=>{ if(!started) setStatusLabel(t(statusKey[s?.step]||"") || s?.label || ""); },
        onDone: ({ reply, syllabus, pastQuestions, thinking, toolExecutions })=>{
          ensureBubble(); setStatusLabel("");
          // Study-prep sessions ride the reply as a session echo (the
          // activity-draft pattern) — render the interactive session card.
          const studyPrepSession = (toolExecutions || []).find((entry) => entry?.session?.id && entry?.success)?.session || null;
          setMessages(prev=>prev.map(m=>m.id===replyId?{...m,...(reply!=null?{text:reply}:{}),thinking:thinking||m.thinking,syllabus:syllabus||[],pastQuestions:pastQuestions||[],phase:"done",...(studyPrepSession?{studyPrepSessionId:studyPrepSession.id}:{})}:m));
          if ((toolExecutions || []).some((entry) => entry?.tool === "create_task" && entry?.success)) refetchTasks();
          if ((toolExecutions || []).some((entry) => entry?.tool === "suggest_help" && entry?.success)) refetchSuggestions();
        },
      });
      if(!started){ // stream produced nothing — show fallback text
        finalReply=t('agent.fallback');
        setMessages(prev=>[...prev,{id:replyId,from:"agent",text:finalReply,time:t2}]);
      }
    } catch {
      // Streaming failed before any token — retry the same idempotent turn in
      // normal JSON form, then show a connection error only if that also fails.
      setStatusLabel("");
      if(!started){
        try {
          const data = await apiPost(agentChatEndpoint(), payload);
          finalReply = data.reply || data.response || t('agent.fallback');
          setMessages(prev=>[...prev,{id:replyId,from:"agent",text:finalReply,time:t2,
            thinking:data.thinking||"",syllabus:data.syllabus||[],pastQuestions:data.pastQuestions||[]}]);
          const studyPrepSessionFallback = (data?.toolExecutions || []).find((entry) => entry?.session?.id && entry?.success)?.session || null;
          if (studyPrepSessionFallback) {
            setMessages(prev=>prev.map(m=>m.id===replyId?{...m,studyPrepSessionId:studyPrepSessionFallback.id}:m));
          }
          if ((data?.toolExecutions || []).some((entry) => entry?.tool === "create_task" && entry?.success)) refetchTasks();
          if ((data?.toolExecutions || []).some((entry) => entry?.tool === "suggest_help" && entry?.success)) refetchSuggestions();
        } catch {
          finalReply="";
          setMessages(prev=>[...prev,{id:replyId,from:"agent",text:t('agent.error_connection'),time:t2}]);
        }
      }
    }
    // Attachments are consumed by this message; free the preview URLs.
    sentAttachments.forEach(a=>a.previewUrl&&URL.revokeObjectURL(a.previewUrl));
    setAttachments([]);
    setLoading(false);
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
    setListError("");
    const okToDelete = await confirmDialog({
      title: 'Delete this task?',
      message: `“${tk.title}” will be removed.`,
    });
    if(!okToDelete) return;
    try { await deleteTask(tk.id); }
    catch(e){ setListError(e?.message||"Couldn't delete that task."); }
  };

  const { busy: taskSaving, run: runTaskSave } = useInFlight();
  const addTask=()=>runTaskSave(async()=>{
    if(!tTitle.trim()) return;
    setTError("");
    try { await saveTask(); }
    catch(err){
      // No agent yet is a setup step, not a failure to report.
      if(isNoAgentError(err)) setNeedsAgent(true);
      else setTError(err?.message||"Could not save the task. Please try again.");
    }
  });

  const saveTask=async()=>{
    const ts=new Date().toLocaleTimeString('en-GB',{hour:"2-digit",minute:"2-digit"});
    const dueAt=tDueAt?new Date(tDueAt).toISOString():null;
    if(tEditing){
      await updateTask({ id:tEditing.id, title:tTitle, description:tDesc, priority:tPriority, dueAt });
    } else {
      await createTask({ title:tTitle, description:tDesc, priority:tPriority, dueAt });
      const taskSaved = t('agent.task_assigned').replace('{title}',tTitle).replace('{priority}',PRI_LABEL[tPriority]);
      const autonomyNote = dueAt
        ? agentOnline
          ? "\n\nYour agent is online and may open one helpful chat when this task becomes due. It will not complete the task for you."
          : "\n\nThis task has a due time, but your agent is offline. Tap “Agent offline” above to allow one helpful chat when it becomes due."
        : "";
      setMessages(prev=>[...prev,{id:Date.now(),from:"agent",text:taskSaved+autonomyNote,time:ts}]);
    }
    closeTaskSheet();
    if(!tEditing) setTaskFilter("pending");
    if(innerTab!=="tasks") setInnerTab("tasks");
  };

  const filteredTasks=tasks.filter(tk=>taskFilter==="done"?tk.status==="done":tk.status!=="done");
  // One toggle in the air at a time — racing toggles on a slow connection
  // left tasks in To-do even though the learner had ticked them done.
  const { busy: toggleBusy, run: runToggle } = useInFlight();
  const toggleOne = (id) => runToggle(() => toggleTask(id).catch(e => setListError(e?.message || "Couldn't update that task.")));
  const pendingCount=tasks.filter(tk=>tk.status!=="done").length;
  const doneCount=tasks.filter(tk=>tk.status==="done").length;
  const highCount=tasks.filter(tk=>tk.priority==="high"&&tk.status!=="done").length;

  // The menu presents existing, server-recognised chat modes. It does not
  // choose a model in the browser: the API remains the authority that routes
  // the supported mode and any authorised tool work.
  const selectedChatMode = thinkMode ? "think" : researchMode ? "research" : "default";
  const chatModes = [
    { id:"default", label:"Standard", description:"Balanced learning support" },
    { id:"think", label:t('agent.mode_think'), description:t('agent.mode_think_hint') },
    { id:"research", label:t('agent.mode_research'), description:t('agent.mode_research_hint') },
  ];
  const selectedChatModeLabel = chatModes.find(option => option.id === selectedChatMode)?.label || "Standard";
  const chooseChatMode = mode => {
    setThinkMode(mode === "think");
    setResearchMode(mode === "research");
  };

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
      {/* The chat header (avatar, name, online status) lives in the sessions
          drawer now — the conversation gets the room, and agent identity is
          one hamburger away. Customisation lives on the Settings page. */}
      <div style={{ display:"flex",borderBottom:"1px solid var(--ak-border)",background:"var(--ak-surface)",flexShrink:0 }}>
        {[{key:"chat",label:t('agent.chat'),icon:"ti-message-circle",badge:null},{key:"tasks",label:t('agent.tasks'),icon:"ti-clipboard",badge:pendingCount},{key:"stats",label:t('agent.stats'),icon:"ti-chart-bar",badge:null}].map(({key,label,icon,badge})=>(
          <button key={key} onClick={()=>setInnerTab(key)} style={{ flex:1,padding:"9px 4px 10px",background:"none",border:"none",cursor:"pointer",fontSize:11.5,fontWeight:innerTab===key?800:600,color:innerTab===key?BRAND:"var(--ak-text-muted)",borderBottom:`2.5px solid ${innerTab===key?BRAND:"transparent"}`,transition:"all .2s",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:4 }}>
            <Icon name={icon} size={13}/>{label}
            {badge>0&&<span style={{ fontSize:9,fontWeight:900,background:innerTab===key?BRAND:"var(--ak-border)",color:innerTab===key?"#fff":"var(--ak-text-muted)",borderRadius:8,padding:"1px 5px" }}>{badge}</span>}
          </button>
        ))}
      </div>
      {/* Background status — visible right in the chat, not only in the
          drawer: Idle by default, swapping live to the background label
          ("Reviewing your goals…") while the agent works. */}
      <div style={{ display:"flex",alignItems:"center",gap:6,padding:"6px 16px",background:"var(--ak-surface)",borderBottom:"1px solid var(--ak-border)",flexShrink:0 }}>
        <span style={{ width:6,height:6,borderRadius:"50%",flexShrink:0,background:agentActivity?BRAND:"var(--ak-text-muted)",animation:agentActivity?"pulse-dot 1.4s ease-in-out infinite":"none" }}/>
        <span style={{ fontSize:10.5,fontWeight:agentActivity?800:600,color:agentActivity?BRAND:"var(--ak-text-muted)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>
          {autonomyStatus}
        </span>
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
              const thinkingStream=!isMe&&msg.phase==="thinking";
              return (
                <div key={msg.id} style={{ display:"flex",justifyContent:isMe?"flex-end":"flex-start",alignItems:"flex-end",gap:8 }}>
                  {!isMe&&<div style={{ width:30,height:30,borderRadius:"50%",background:`${BRAND}15`,border:`1.5px solid ${BRAND}40`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>{agentEmoji}</div>}
                  <div style={{ maxWidth:"78%" }}>
                    {!isMe&&(msg.thinking||thinkingStream)&&<ThoughtBlock thinking={msg.thinking} streaming={thinkingStream}/>}
                    {(!msg.phase||msg.text)&&(
                      <div style={{ padding:"10px 14px",borderRadius:isMe?"18px 18px 4px 18px":"4px 18px 18px 18px",background:isMe?`linear-gradient(135deg,${BRAND},#4C1DCC)`:"var(--ak-surface-hover)",border:isMe?"none":`1px solid ${BRAND}25`,color:isMe?"#fff":"var(--ak-text)",fontSize:13.5,lineHeight:1.6,fontWeight:500 }}>{isMe?<span style={{whiteSpace:"pre-wrap"}}>{msg.text}</span>:<RichText text={msg.text}/>}{msg.phase==="answering"&&<StreamCaret/>}</div>
                    )}
                    {isMe&&msg.attachments?.length>0&&(
                      <div style={{ display:"flex",flexWrap:"wrap",gap:5,marginTop:5,justifyContent:"flex-end" }}>
                        {msg.attachments.map((a,i)=>a.previewUrl
                          ? <img key={i} src={a.previewUrl} alt={a.name} style={{ width:52,height:52,objectFit:"cover",borderRadius:10,border:"1px solid rgba(255,255,255,.4)" }}/>
                          : <span key={i} style={{ display:"inline-flex",alignItems:"center",gap:4,maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:10.5,fontWeight:700,padding:"4px 9px",borderRadius:20,background:"rgba(255,255,255,.18)",color:"#fff" }}><Icon name="ti-file-text" size={10}/> {a.name}</span>)}
                      </div>
                    )}
                    {!isMe&&msg.studyPrepSessionId&&<StudyPrepChatCard sessionId={msg.studyPrepSessionId}/>}
                    {!isMe&&msg.syllabus?.length>0&&(
                      <div style={{ display:"flex",flexWrap:"wrap",gap:5,marginTop:5 }}>
                        {msg.syllabus.map((s,i)=>(
                          <span key={i} title={`${s.exam?s.exam+" ":""}${s.subject} — ${s.topic}`} style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:10.5,fontWeight:800,padding:"3px 9px",borderRadius:20,background:`${BRAND}12`,border:`1px solid ${BRAND}30`,color:BRAND,maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                            <Icon name="ti-book" size={10}/> {s.exam?`${s.exam} · `:""}{s.topic}
                          </span>
                        ))}
                      </div>
                    )}
                    {!isMe&&msg.pastQuestions?.length>0&&(
                      <div style={{ display:"flex",flexWrap:"wrap",gap:5,marginTop:5 }}>
                        {msg.pastQuestions.map((s,i)=>(
                          <span key={i} title={`${s.exam} ${s.year||""}${s.subject?` · ${s.subject}`:""}${s.topic?` — ${s.topic}`:""}`} style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:10.5,fontWeight:800,padding:"3px 9px",borderRadius:20,background:"rgba(232,136,74,.12)",border:"1px solid rgba(232,136,74,.35)",color:"#B45309",maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                            <Icon name="ti-edit" size={10}/> {s.exam}{s.year?` ${s.year}`:""}{s.topic?` · ${s.topic}`:""}
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize:10,color:"var(--ak-text-muted)",marginTop:3,display:"flex",alignItems:"center",gap:4,justifyContent:isMe?"flex-end":"flex-start" }}>
                      {msg.time}
                      <CopyMessageButton text={msg.text} />
                    </div>
                  </div>
                </div>
              );
            })}
            {loading&&<div style={{ display:"flex",alignItems:"flex-end",gap:8 }}><div style={{ width:30,height:30,borderRadius:"50%",background:`${BRAND}15`,border:`1.5px solid ${BRAND}40`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>{agentEmoji}</div><div style={{ padding:"12px 16px",borderRadius:"4px 18px 18px 18px",background:"var(--ak-surface-hover)",border:`1px solid ${BRAND}25`,display:"flex",gap:8,alignItems:"center" }}>{[0,.25,.5].map((d,i)=><div key={i} style={{ width:6,height:6,borderRadius:"50%",background:BRAND,animation:`bounce-dot .7s ease-in-out ${d}s infinite alternate` }}/>)}</div></div>}
            {loading&&statusLabel&&<div style={{ display:"flex",alignItems:"center",gap:6,margin:"-6px 0 0 38px" }}><span style={{ width:7,height:7,borderRadius:"50%",background:BRAND,display:"inline-block",animation:"pulse-dot 1.4s ease-in-out infinite" }}/><span style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-muted)" }}>{statusLabel}</span></div>}
          </div>
          <div style={{ padding:"10px 16px 12px",borderTop:"1px solid var(--ak-border)",background:"var(--ak-surface)",flexShrink:0 }}>
            {attachError&&(
              <div style={{ display:"flex",alignItems:"center",gap:8,margin:"0 0 8px",padding:"7px 11px",borderRadius:10,background:"rgba(239,68,68,.10)",border:`1px solid ${RED}35` }}>
                <span style={{ flex:1,fontSize:11,fontWeight:700,color:RED }}>{attachError}</span>
                <button onClick={()=>setAttachError("")} style={{ border:"none",background:"transparent",color:RED,cursor:"pointer",fontSize:13,fontWeight:900,padding:0 }}>×</button>
              </div>
            )}
            {attachments.length>0&&(
              <div style={{ display:"flex",flexWrap:"wrap",gap:7,margin:"0 0 9px" }}>
                {attachments.map(a=>(
                  <div key={a.id} style={{ position:"relative" }}>
                    {a.previewUrl
                      ? <img src={a.previewUrl} alt={a.name} style={{ width:54,height:54,objectFit:"cover",borderRadius:12,border:"1.5px solid var(--ak-border2)",display:"block" }}/>
                      : <div style={{ maxWidth:170,display:"flex",alignItems:"center",gap:5,padding:"10px 30px 10px 11px",borderRadius:12,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)" }}>
                          <Icon name="ti-file-text" size={15}/>
                          <span style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sub)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{a.name}</span>
                        </div>}
                    <button onClick={()=>removeAttachment(a.id)} title={t('agent.attach_remove')} aria-label={t('agent.attach_remove')} style={{ position:"absolute",top:-6,right:-6,width:19,height:19,borderRadius:"50%",border:"none",background:"var(--ak-text)",color:"var(--ak-surface)",fontSize:10,fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 1px 4px rgba(0,0,0,.25)" }}><Icon name="ti-x" size={10}/></button>
                  </div>
                ))}
              </div>
            )}
            <FortizoChatComposer
              value={input}
              onChange={setInput}
              onSend={()=>sendMessage()}
              placeholder={t('agent.ask_anything').replace('{name}', shownName)}
              disabled={loading}
              attachmentAction={()=>fileInputRef.current?.click()}
              attachmentLabel={t('agent.attach_add')}
              voiceLabel="Voice input is not available in AI Chat yet"
              audioLabel="Audio notes are not available in AI Chat yet"
              modelId={selectedChatMode}
              modelLabel={selectedChatModeLabel}
              modelOptions={chatModes}
              onModelChange={chooseChatMode}
              sendDisabled={!input.trim()&&!attachments.length}
            />
            {/* Think and Research now live in the Fortizo-style model menu.
                The remaining learning/session actions stay in their familiar row. */}
            <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:9 }}>
              <button type="button" onClick={()=>onStartExamPrep?.()} disabled={loading || !onStartExamPrep} title="Start generated exam-style practice" style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 10px",borderRadius:20,border:`1px solid ${GREEN}45`,background:`${GREEN}10`,fontSize:10.5,fontWeight:800,color:GREEN,cursor:loading?"not-allowed":"pointer",fontFamily:"'Nunito',sans-serif",flexShrink:0 }}>
                <Icon name="ti-clipboard-check" size={12}/> Practice
              </button>
              <button type="button" onClick={()=>onOpenConceptTracker?.()} disabled={!onOpenConceptTracker} title="View learning tracker" style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 10px",borderRadius:20,border:`1px solid ${BRAND}35`,background:`${BRAND}0D`,fontSize:10.5,fontWeight:800,color:BRAND,cursor:"pointer",fontFamily:"'Nunito',sans-serif",flexShrink:0 }}>
                <Icon name="ti-chart-bar" size={12}/> Progress
              </button>
              <button type="button" onClick={()=>onOpenAdaptiveControls?.()} disabled={!onOpenAdaptiveControls} title="Open adaptive learning controls" style={{ width:29,height:29,padding:0,borderRadius:"50%",border:"1px solid var(--ak-border2)",background:"var(--ak-surface-hover)",color:"var(--ak-text-muted)",cursor:"pointer",flexShrink:0 }}>
                <Icon name="ti-adjustments" size={13}/>
              </button>
              <div style={{ flex:1 }}/>
              <button onClick={()=>setTaskOpen(true)} style={{ display:"flex",alignItems:"center",gap:4,padding:"6px 12px",borderRadius:20,border:`1px solid ${GOLD}40`,background:`${GOLD}12`,fontSize:10.5,fontWeight:800,color:"#B45309",cursor:"pointer",fontFamily:"'Nunito',sans-serif",flexShrink:0 }}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>{t('agent.task')}
              </button>
            </div>
            <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf,.txt,.md,.csv" style={{ display:"none" }} onChange={e=>{addAttachments(e.target.files); e.target.value="";}}/>
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
            <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>{[["pending",t('agent.to_do')],["done",t('agent.done')],["suggestions",t('agent.suggestions')]].map(([k,l])=><button key={k} onClick={()=>setTaskFilter(k)} style={{ padding:"5px 12px",borderRadius:20,border:`1.5px solid ${taskFilter===k?BRAND:"var(--ak-border2)"}`,background:taskFilter===k?`${BRAND}10`:"transparent",color:taskFilter===k?BRAND:"var(--ak-text-muted)",fontSize:11.5,fontWeight:700,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",gap:5 }}>{l}{k==="suggestions"&&suggestionCount>0&&<span style={{ fontSize:9,fontWeight:900,background:taskFilter===k?BRAND:"var(--ak-border)",color:taskFilter===k?"#fff":"var(--ak-text-muted)",borderRadius:8,padding:"1px 5px" }}>{suggestionCount}</span>}</button>)}</div>
            {taskFilter!=="suggestions"&&<button onClick={openNewTask} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:11.5,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>{t('agent.new_task')}
            </button>}
          </div>
          {listError&&(
            <div style={{ margin:"0 16px 8px",padding:"9px 12px",borderRadius:12,background:"rgba(239,68,68,.10)",border:`1px solid ${RED}35`,display:"flex",alignItems:"center",gap:8 }}>
              <span style={{ flex:1,fontSize:11.5,fontWeight:700,color:RED }}>{listError}</span>
              <button onClick={()=>setListError("")} style={{ border:"none",background:"transparent",color:RED,cursor:"pointer",fontSize:14,fontWeight:900 }}>×</button>
            </div>
          )}
          <div style={{ flex:1,padding:"0 16px 16px",display:"flex",flexDirection:"column",gap:8 }}>
            {taskFilter==="suggestions"?(
              suggestionCount===0?<div style={{ textAlign:"center",padding:"32px 16px",color:"var(--ak-text-muted)" }}><Icon name="ti-bulb" size={40} color="var(--ak-text-muted)" style={{opacity:.3}}/><p style={{ fontSize:13,fontWeight:700,marginTop:8,maxWidth:260,marginInline:"auto",lineHeight:1.5 }}>{t('agent.suggestions_empty')}</p></div>
              :(<>{pendingProposals.length>0&&<div style={{ marginBottom:10 }}>
              <p style={{ fontSize:10,fontWeight:900,color:"var(--ak-text-muted)",textTransform:"uppercase",letterSpacing:.5,margin:"2px 2px 8px" }}>{t('agent.proposals_from_review')}</p>
              {pendingProposals.map(p=>{
                const pkKey=p.kind==="session"?"agent.proposal_kind_session":p.kind==="practice"?"agent.proposal_kind_practice":p.kind==="goal"?"agent.proposal_kind_goal":"agent.proposal_kind_task";
                const pkIcon=p.kind==="session"?"ti-clock":p.kind==="practice"?"ti-pencil":p.kind==="goal"?"ti-target":"ti-clipboard";
                return (
                <div key={p.id} style={{ padding:"12px 14px",borderRadius:14,background:"var(--ak-surface)",border:`1px dashed ${GOLD}70`,marginBottom:8 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:6,flexWrap:"wrap" }}>
                    <span style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:9.5,fontWeight:900,padding:"2px 8px",borderRadius:20,background:`${GOLD}15`,border:`1px solid ${GOLD}40`,color:GOLD,letterSpacing:.3,textTransform:"uppercase" }}><Icon name={pkIcon} size={10}/>{t(pkKey)}</span>
                    <span style={{ fontSize:10,color:"var(--ak-text-muted)",fontWeight:600 }}>{relTime(p.created_at)}</span>
                  </div>
                  <p style={{ fontSize:13.5,fontWeight:700,color:"var(--ak-text)",margin:"0 0 4px",lineHeight:1.45 }}>{p.title}</p>
                  {p.rationale&&<p style={{ fontSize:12,color:"var(--ak-text-sub)",margin:"0 0 10px",lineHeight:1.5 }}>{p.rationale}</p>}
                  <div style={{ display:"flex",alignItems:"center",gap:7 }}>
                    <button onClick={()=>approveProposal(p)} disabled={!!proposalBusyId} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:"none",background:proposalBusyId?"var(--ak-border)":`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:11,fontWeight:800,cursor:proposalBusyId?"wait":"pointer",opacity:proposalBusyId&&proposalBusyId!==p.id?0.55:1,fontFamily:"'Nunito',sans-serif" }}>
                      {proposalBusyId===p.id?<Spinner size={11} color="#fff"/>:<svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>}{t('agent.proposal_approve')}
                    </button>
                    <button onClick={()=>dismissProposal(p)} disabled={!!proposalBusyId} title={t('agent.proposal_dismiss')} aria-label={t('agent.proposal_dismiss')} style={{ width:27,height:27,borderRadius:"50%",border:"1px solid var(--ak-border2)",background:"var(--ak-surface-hover)",color:"var(--ak-text-muted)",cursor:proposalBusyId?"wait":"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Icon name="ti-x" size={12}/></button>
                    <span style={{ fontSize:10,color:"var(--ak-text-muted)",fontWeight:600,fontStyle:"italic" }}>{t('agent.proposals_sub')}</span>
                  </div>
                </div>
                );
              })}
            </div>}{suggestions.map(sg=>{
                const kindKey=sg.kind==="goal"?"agent.sugg_goal":sg.kind==="conversation"?"agent.sugg_chat":"agent.sugg_task";
                const kindIcon=sg.kind==="goal"?"ti-target":sg.kind==="conversation"?"ti-message-circle":"ti-clipboard";
                return (
                <div key={sg.id} style={{ padding:"12px 14px",borderRadius:14,background:"var(--ak-surface)",border:`1px dashed ${BRAND}45` }}>
                  <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:6 }}>
                    <span style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:9.5,fontWeight:900,padding:"2px 8px",borderRadius:20,background:`${BRAND}12`,border:`1px solid ${BRAND}30`,color:BRAND,letterSpacing:.3,textTransform:"uppercase" }}><Icon name={kindIcon} size={10}/>{t(kindKey)}</span>
                    <span style={{ fontSize:10,color:"var(--ak-text-muted)",fontWeight:600 }}>{relTime(sg.created_at)}</span>
                  </div>
                  <p style={{ fontSize:13.5,fontWeight:700,color:"var(--ak-text)",margin:"0 0 4px",lineHeight:1.45 }}>{sg.title}</p>
                  {sg.rationale&&<p style={{ fontSize:12,color:"var(--ak-text-sub)",margin:"0 0 10px",lineHeight:1.5 }}>{sg.rationale}</p>}
                  <div style={{ display:"flex",alignItems:"center",gap:7 }}>
                    <button onClick={()=>acceptSuggestion(sg)} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>
                      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>{t('agent.suggestion_accept')}
                    </button>
                    <button onClick={()=>dismissSuggestion(sg)} title={t('agent.suggestion_dismiss')} aria-label={t('agent.suggestion_dismiss')} style={{ width:27,height:27,borderRadius:"50%",border:"1px solid var(--ak-border2)",background:"var(--ak-surface-hover)",color:"var(--ak-text-muted)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}><Icon name="ti-x" size={12}/></button>
                    <span style={{ fontSize:10,color:"var(--ak-text-muted)",fontWeight:600,fontStyle:"italic" }}>{t('agent.suggestions_sub')}</span>
                  </div>
                </div>
                );
              })}</>)
            ):(taskFilter==="done"||taskFilter==="pending")&&(
            filteredTasks.length===0?<div style={{ textAlign:"center",padding:"32px 16px",color:"var(--ak-text-muted)" }}><Icon name="ti-clipboard" size={40} color="var(--ak-text-muted)" style={{opacity:.3}}/><p style={{ fontSize:13,fontWeight:700,marginTop:8 }}>{taskFilter==="done"?t('agent.no_completed'):t('agent.all_done')}</p></div>:filteredTasks.map(tk=>(
              <div key={tk.id} style={{ display:"flex",alignItems:"flex-start",gap:11,padding:"12px 14px",borderRadius:14,background:"var(--ak-surface)",border:"1px solid var(--ak-border)",opacity:tk.status==="done"?.6:1 }}>
                <button onClick={()=>toggleOne(tk.id)} disabled={toggleBusy} style={{ marginTop:2,width:22,height:22,borderRadius:6,border:`2px solid ${tk.status==="done"?GREEN:"var(--ak-border3)"}`,background:tk.status==="done"?GREEN:"var(--ak-surface)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0 }}>
                  {tk.status==="done"&&<svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
                <div style={{ flex:1,minWidth:0 }}>
                  <p style={{ fontSize:13.5,fontWeight:tk.status==="done"?500:700,color:tk.status==="done"?"var(--ak-text-muted)":"var(--ak-text)",textDecoration:tk.status==="done"?"line-through":"none",margin:"0 0 4px" }}>{tk.title}</p>
                  {tk.description&&<p style={{ fontSize:12,color:"var(--ak-text-sub)",margin:"0 0 5px",lineHeight:1.45 }}>{tk.description}</p>}
                  <div style={{ display:"flex",alignItems:"center",gap:7,flexWrap:"wrap" }}>
                    <span style={{ fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:20,background:PRI_BG[tk.priority],color:PRI_COLOR[tk.priority] }}>{PRI_LABEL[tk.priority]}</span>
                    {tk.due_at&&<span style={{ fontSize:10,fontWeight:700,color:new Date(tk.due_at)<new Date()&&tk.status!=="done"?RED:"var(--ak-text-muted)" }}>
                      <Icon name="ti-calendar" size={10}/> {new Date(tk.due_at).toLocaleDateString()} {new Date(tk.due_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}{new Date(tk.due_at)<new Date()&&tk.status!=="done"?" · Overdue":""}
                    </span>}
                    {tk.is_recurring&&<span style={{ fontSize:10,fontWeight:700,color:BRAND }}><Icon name="ti-refresh" size={10}/> repeats</span>}
                  </div>
                </div>
                <div style={{ display:"flex",gap:5,flexShrink:0 }}>
                  <button onClick={()=>openEditTask(tk)} disabled={tk.status==="running"} title="Edit"
                    style={{ width:26,height:26,borderRadius:8,border:"1px solid var(--ak-border2)",background:"var(--ak-surface-hover)",cursor:tk.status==="running"?"not-allowed":"pointer",opacity:tk.status==="running"?.4:1,fontSize:11 }}><Icon name="ti-edit" size={11}/></button>
                  <button onClick={()=>removeTask(tk)} disabled={tk.status==="running"} title="Delete"
                    style={{ width:26,height:26,borderRadius:8,border:"1px solid var(--ak-border2)",background:"var(--ak-surface-hover)",cursor:tk.status==="running"?"not-allowed":"pointer",opacity:tk.status==="running"?.4:1,fontSize:11 }}><Icon name="ti-trash" size={11}/></button>
                </div>
              </div>
            )))}
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
          <p style={{ fontSize:16,fontWeight:900,color:"var(--ak-text)",margin:"0 0 6px" }}>{tEditing?<><Icon name="ti-edit" size={13}/> Edit task</>:<><Icon name="ti-clipboard" size={13}/> {t('agent.assign_to')} {agentName}</>}</p>
          <p style={{ fontSize:12,color:"var(--ak-text-muted)",margin:"0 0 20px",lineHeight:1.5 }}>{t('agent.assign_sub')}</p>
          <div style={{ marginBottom:14 }}><label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sub)",display:"block",marginBottom:6,letterSpacing:.3 }}>{t('agent.task_title')}</label><input className="ak-chat-input" value={tTitle} onChange={e=>setTTitle(e.target.value)} placeholder={t('agent.task_title_ph')} style={{ width:"100%",padding:"11px 14px",borderRadius:12,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",fontSize:13.5,fontWeight:600,color:"var(--ak-text)",fontFamily:"'Nunito',sans-serif",outline:"none",boxSizing:"border-box" }} onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="var(--ak-border2)"}/></div>
          <div style={{ marginBottom:18 }}><label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sub)",display:"block",marginBottom:6,letterSpacing:.3 }}>{t('agent.description')} <span style={{ fontSize:10,fontWeight:500,color:"var(--ak-text-muted)" }}>{t('common.optional')}</span></label><textarea className="ak-chat-input" value={tDesc} onChange={e=>setTDesc(e.target.value)} placeholder={t('agent.desc_ph')} rows={3} style={{ width:"100%",padding:"11px 14px",borderRadius:12,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",fontSize:13,color:"var(--ak-text)",fontFamily:"'Nunito',sans-serif",outline:"none",resize:"none",lineHeight:1.5,boxSizing:"border-box" }} onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="var(--ak-border2)"}/></div>
          <div style={{ marginBottom:22 }}><label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sub)",display:"block",marginBottom:8,letterSpacing:.3 }}>{t('agent.priority')}</label><div style={{ display:"flex",gap:8 }}>{[["high",t('agent.pri_high')],["medium",t('agent.pri_medium')],["low",t('agent.pri_low')]].map(([k,l])=><button key={k} onClick={()=>setTPriority(k)} style={{ flex:1,padding:"9px 6px",borderRadius:12,border:`1.5px solid ${tPriority===k?PRI_COLOR[k]:"var(--ak-border2)"}`,background:tPriority===k?`${PRI_COLOR[k]}10`:"var(--ak-surface-hover)",fontSize:12,fontWeight:800,color:tPriority===k?PRI_COLOR[k]:"var(--ak-text-sub)",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{l}</button>)}</div></div>
          <div style={{ marginBottom:22 }}>
            <label style={{ fontSize:11,fontWeight:700,color:"var(--ak-text-sub)",display:"block",marginBottom:6,letterSpacing:.3 }}>
              <Icon name="ti-calendar" size={12}/> Due at <span style={{ fontSize:10,fontWeight:500,color:"var(--ak-text-muted)" }}>{t('common.optional')}</span>
            </label>
            <input type="datetime-local" value={tDueAt} onChange={e=>setTDueAt(e.target.value)}
              style={{ width:"100%",padding:"11px 14px",borderRadius:12,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",fontSize:13.5,fontWeight:600,color:"var(--ak-text)",fontFamily:"'Nunito',sans-serif",outline:"none",boxSizing:"border-box" }}/>
            <p style={{ fontSize:10.5,color:"var(--ak-text-muted)",margin:"5px 0 0",lineHeight:1.45 }}>
              Leave empty to keep this as a manual task. With a precise due time, your Agent online setting may open one helpful chat when it becomes due; it never runs or completes the task.
            </p>
          </div>
          {tError&&<p style={{ fontSize:12,fontWeight:800,color:RED,margin:"0 0 12px" }}>{tError}</p>}
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={closeTaskSheet} style={{ flex:1,padding:"13px",borderRadius:14,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface-hover)",fontSize:13,fontWeight:800,color:"var(--ak-text-sub)",cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{t('common.cancel')}</button>
            <button onClick={addTask} disabled={taskSaving || !tTitle.trim()} style={{ flex:1.6,padding:"13px",borderRadius:14,border:"none",background:tTitle.trim()?`linear-gradient(135deg,${BRAND},#4C1DCC)`:"var(--ak-border2)",fontSize:13,fontWeight:800,color:tTitle.trim()?"#fff":"var(--ak-text-muted)",cursor:(tTitle.trim()&&!taskSaving)?"pointer":"default",opacity:taskSaving?.8:1,fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:7 }}>
              {taskSaving
                ? <Spinner size={13} color={tTitle.trim() ? '#fff' : 'var(--ak-text-muted)'}/>
                : <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={tTitle.trim()?"#fff":"var(--ak-text-muted)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              {tEditing?'Save changes':t('agent.assign_task')}
            </button>
          </div>
        </div></>
      )}
      <NoAgentSheet open={needsAgent} onClose={()=>setNeedsAgent(false)} defaultName={agentName||'My Agent'} onCreated={saveTask}/>
      {/* Chat sessions drawer (hamburger) */}
      {drawerOpen&&(
        <><div onClick={()=>setDrawerOpen(false)} style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(6,6,18,.55)",backdropFilter:"blur(5px)" }}/>
        <div style={{ position:"fixed",top:0,bottom:0,left:0,zIndex:2100,width:"min(86vw,320px)",background:"var(--ak-surface)",boxShadow:"6px 0 40px rgba(0,0,0,.18)",animation:"drawer-in .28s cubic-bezier(.32,1,.64,1)",fontFamily:"'Nunito',sans-serif",display:"flex",flexDirection:"column" }}>
          <style>{`@keyframes drawer-in{from{transform:translateX(-100%)}to{transform:translateX(0)}}`}</style>
          <div style={{ display:"flex",alignItems:"center",gap:12,padding:"16px 16px 13px",borderBottom:"1px solid var(--ak-border)",flexShrink:0 }}>
            <div style={{ width:46,height:46,borderRadius:"50%",background:`${BRAND}15`,border:`2px solid ${BRAND}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:23,position:"relative",flexShrink:0 }}>
              {agentEmoji}<div style={{ position:"absolute",bottom:0,right:0,width:12,height:12,borderRadius:"50%",background:agentOnline?GREEN:"var(--ak-text-muted)",border:"2px solid #fff",animation:agentOnline?"pulse-dot 2s ease-in-out infinite":"none" }}/>
            </div>
            <div style={{ flex:1,minWidth:0 }}>
              <p style={{ fontSize:14.5,fontWeight:900,color:"var(--ak-text)",margin:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{shownName}</p>
              <button type="button" onClick={onToggleAgentAutonomy} disabled={!agentAutonomyLoaded||agentAutonomySaving||!onToggleAgentAutonomy}
                aria-pressed={agentOnline} aria-label={agentOnline?"Turn autonomous Agent offline":"Turn autonomous Agent online"}
                title={agentOnline?"Agent online: due-task check-ins and the background planner run while you're away.":"Agent offline: tap to bring it online."}
                style={{ display:"flex",alignItems:"center",gap:4,background:"none",border:0,padding:0,marginTop:2,cursor:agentAutonomyLoaded&&!agentAutonomySaving&&onToggleAgentAutonomy?"pointer":"wait",fontFamily:"'Nunito',sans-serif" }}>
                <span style={{ width:5,height:5,borderRadius:"50%",background:agentOnline?GREEN:"var(--ak-text-muted)",display:"inline-block" }}/>
                <span style={{ fontSize:10.5,fontWeight:agentActivity?800:600,color:agentActivity?BRAND:"var(--ak-text-muted)",display:"inline-flex",alignItems:"center",gap:4 }}>
                  {agentActivity&&<span style={{ width:5,height:5,borderRadius:"50%",background:BRAND,display:"inline-block",animation:"pulse-dot 1.4s ease-in-out infinite"}}/>}
                  {autonomyStatus}
                </span>
              </button>
            </div>
          </div>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px 12px",flexShrink:0 }}>
            <p style={{ fontSize:13,fontWeight:900,letterSpacing:.4,textTransform:"uppercase",color:"var(--ak-text-muted)",margin:0 }}>{t('agent.chats')}</p>
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
              <div style={{ textAlign:"center",padding:"28px 16px",color:"var(--ak-text-muted)" }}><Icon name="ti-message-circle" size={34} color="var(--ak-text-muted)" style={{opacity:.3}}/><p style={{ fontSize:12.5,fontWeight:700,marginTop:8 }}>{t('agent.no_chats')}</p></div>
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
