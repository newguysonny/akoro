import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { BRAND, RED, GREEN, GOLD, STUDENT_ID } from '../../constants.js';
import { API, apiGet, apiPost, apiPatch, apiDelete, streamPost } from '../../services/api.js';
import { socketOptions } from '../../client/socket';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { ZapIcon, BrainIcon, SparkleIcon, XIcon, Icon } from '../../components/common/Icons.jsx';
import { AgentAvatar } from '../../components/common/AgentAvatar.jsx';
import FortizoChatComposer, { ModelSwitch } from '../../components/common/FortizoChatComposer.jsx';
import { chatPicker, applyModelPick, applyModePick } from './lib/chatModels.js';
import { useSentinel, pagedStatusText } from '../../lib/usePagedList.js';

/* One gutter for the conversation and the composer, so messages line up with the input box. */
const CHAT_GUTTER = 16;
/* Messages per history page: the newest on open, then a page per scroll to the top. */
const HISTORY_PAGE = 10;
/* Agent replies have no bubble, so they sit a little further in than the gutter. */
const REPLY_INSET = 12;   // 28px from the edge — the Claude app's reading margin
import RichText from '../../components/common/RichText.jsx';
import CopyMessageButton from '../../components/common/CopyMessageButton.jsx';
import { copyTextFrom } from '../../components/common/CopyMessageButton.jsx';
import { useTaskAPI } from '../../hooks/useTaskAPI.js';
import { NoAgentSheet, isNoAgentError } from '../battles/index.js';
import { confirmDialog } from '../../components/common/ConfirmHost.jsx';
import AgentStatsTab from '../../components/tabs/AgentStatsTab.jsx';
import { AGENT_CHAT_STOP_ENDPOINT, agentChatEndpoint, createAgentChatTurnId } from './lib/agentChatEndpoint.js';
import StreamCaret from '../../components/common/StreamCaret.jsx';
import Spinner from '../../components/common/Spinner.jsx';
import { useInFlight } from '../../hooks/useInFlight.js';
import StudyPrepChatCard from '../../components/tabs/studyPrep/StudyPrepChatCard.jsx';
import PlannerNotes from './components/PlannerNotes.jsx';
import AgentCheckCard from './components/AgentCheckCard.jsx';
import TraceBlocks from './components/TraceBlocks.jsx';
import { applyTraceEvent, blocksFromSavedTrace, promoteActivity, settleRunning, splitWakes, studyPrepEventBlocks, workflowRunBlocks } from '../../lib/agentChatTrace.js';
import { CHAT_STARTERS, cleanIdeas, cleanMaterials, protegeMoves } from './lib/chatIdeas.js';
import { useNavigate, useLocation } from 'react-router-dom';
import NeedsYouList, { useNeedsYou } from './components/NeedsYouList.jsx';
import ReplyRating, { ratableId, useReplyRatings } from './components/ReplyRating.jsx';
import { AgentCards, ChallengeRequestCards } from '../network/index.js';
import ConfirmChangeCard from './components/ConfirmChangeCard.jsx';
import IngestCard from './components/IngestCard.jsx';
import ChatFilesStrip from './components/ChatFilesStrip.jsx';
import ApprovalButtons from './components/ApprovalButtons.jsx';
import ProposalPreview from './components/ProposalPreview.jsx';
import { addSimilar, attachIngestRecords, chatFiles, chooseFolder, chooseSubject, dismissSimilar, filesOf, getIngest, isLibraryFile, readChatRecord, readIngestRecords, restoreIngest, similarFor, startIngest, undoIngest, uploadChatFile } from '../../lib/chatUploads.js';
import { deleteRecord } from '../../services/recordsApi.js';
import SimilarPicker from './components/SimilarPicker.jsx';
import { useVoiceAnswer } from '../../hooks/useVoiceAnswer.js';
import { useSpeakReply } from './hooks/useSpeakReply.js';

const QUICK_PROMPTS = [
  { text:"Create a task for me", key:"agent.qp_create" },
  { text:"What's due today?",    key:"agent.qp_due" },
  { text:"Quiz me on Algebra",   key:"agent.qp_quiz" },
  { text:"Check my progress",    key:"agent.qp_progress" },
  { text:"Explain Mitosis",      key:"agent.qp_explain" },
  { text:"Help with an essay",   key:"agent.qp_essay" },
];
const DEV_VIEW_KEY = 'ak.agentChat.devView';

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

const FIND_SIMILAR = "Find similar material";   // the API's structureChips label
const MATERIAL_ICON = { study_tool:"ti-layout-grid", choice:"ti-paperclip", folder:"ti-folder", blog:"ti-article", my_blog:"ti-pencil", course:"ti-school", record:"ti-paperclip", topic:"ti-chalkboard", activity:"ti-list-check" };

/* Each suggestion kind's label and icon in Suggestions (the ready kinds, §7.16.3). */
const SUGG_KIND = {
  goal: ["agent.sugg_goal", "ti-target"], conversation: ["agent.sugg_chat", "ti-message-circle"], session: ["agent.proposal_kind_session", "ti-clock"],
  practice: ["agent.proposal_kind_practice", "ti-pencil"], task: ["agent.sugg_task", "ti-clipboard"],
  quiz_from_records: ["agent.kind_quiz", "ti-list-check"], teach_weak_topic: ["agent.kind_teach", "ti-school"], study_plan: ["agent.kind_plan", "ti-calendar-event"],
  revision_battle: ["agent.kind_check", "ti-swords"], follow_up_question: ["agent.kind_follow_up", "ti-message-circle"], goal_nudge: ["agent.kind_goal_step", "ti-target"],
  fix_it: ["agent.kind_fix_it", "ti-tool"],
  idea: ["agent.ideas", "ti-bulb"],
};

/* Ideas: the icon for what it builds, and for where it came from. */
/* A turn the client has seen but the server may still be saving. Kept per
   session so a refresh in the seconds before "saved" does not lose the reply:
   it is shown as pending and reconciled until the transcript has it. */
const pendingKey = (sid) => `ak_pending_turn:${sid}`;
function readPendingTurn(sid) {
  try {
    const p = JSON.parse(localStorage.getItem(pendingKey(sid)) || "null");
    if (!p || Date.now() - Number(p.at || 0) > 5 * 60_000) return null;
    return p;
  } catch { return null; }
}
function writePendingTurn(sid, patch) {
  try {
    const cur = readPendingTurn(sid) || {};
    localStorage.setItem(pendingKey(sid), JSON.stringify({ ...cur, ...patch, at: cur.at || Date.now() }));
  } catch { /* private mode */ }
}
function clearPendingTurn(sid) { try { localStorage.removeItem(pendingKey(sid)); } catch { /* private mode */ } }

/* A study tool chat made (saved as a reader tab): kind, document, count — Open goes to the reader on that tab. */
const OUTPUT_ICON = { quiz: "ti-list-check", flashcards: "ti-cards", summary: "ti-align-left", podcast: "ti-headphones" };
const OUTPUT_KIND = { quiz: "Quiz", flashcards: "Flashcards", summary: "Summary", podcast: "Podcast" };
function StudyOutputCard({ m, onOpen }) {
  const tool = m.tool || "quiz";
  const making = tool === "podcast" && /being made/i.test(m.sub || "");
  const name = String(m.title || "").replace(/^[^·]+·\s*/, "");
  const tint = tool === "podcast" ? { bg: "#F4A62A1f", fg: "#C77D0A" } : { bg: `${BRAND}14`, fg: BRAND };
  return (
    <button type="button" data-material="study_output" data-tool={tool} onClick={onOpen}
      style={{ display:"flex",alignItems:"center",gap:11,width:"100%",maxWidth:460,padding:"10px 12px",borderRadius:14,border:`1px solid ${BRAND}26`,background:"var(--ak-surface)",cursor:"pointer",fontFamily:"'Nunito',sans-serif",textAlign:"left",boxShadow:"0 1px 2px rgba(20,10,60,.04)" }}>
      <span style={{ width:38,height:38,borderRadius:10,background:tint.bg,color:tint.fg,display:"grid",placeItems:"center",flexShrink:0 }}><Icon name={OUTPUT_ICON[tool]||"ti-file"} size={20}/></span>
      <span style={{ display:"grid",minWidth:0,flex:1 }}>
        <span style={{ fontSize:10,fontWeight:900,letterSpacing:".04em",color:BRAND,textTransform:"uppercase" }}>{OUTPUT_KIND[tool]||tool}</span>
        <span style={{ fontSize:13,fontWeight:800,color:"var(--ak-text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{name}</span>
        <span style={{ fontSize:11,fontWeight:600,color:"var(--ak-text-sub)" }}>
          {making&&<span style={{ display:"inline-block",width:6,height:6,borderRadius:"50%",background:"#C77D0A",marginRight:5,verticalAlign:1 }}/>}
          {making ? m.sub : `${m.sub ? `${m.sub} · ` : ""}saved in the reader`}
        </span>
      </span>
      <span style={{ display:"flex",alignItems:"center",gap:3,color:BRAND,fontSize:12,fontWeight:800,flexShrink:0 }}>Open <Icon name="ti-chevron-right" size={13}/></span>
    </button>
  );
}

const IDEA_ICON = { quiz: "ti-list-check", teach: "ti-school", plan: "ti-calendar-event", notes: "ti-notes", battle: "ti-swords", chat: "ti-message-circle" };
const IDEA_FROM = { record: "ti-paperclip", goal: "ti-target", weak: "ti-chart-line", note: "ti-bookmark" };

function AgentChatTab({
  onStartTeach, onTeachTopic, onStartExamPrep, onOpenConceptTracker, onOpenAdaptiveControls, agentNameProp, agentEmojiProp, onChatActive,
  agentOnline = false, agentAutonomyLoaded = false, agentAutonomySaving = false,
  onToggleAgentAutonomy,
  agentActivity = null,
}) {
  const { t } = useLang();
  const navigate = useNavigate();
  const initName  = agentNameProp  || '';
  const initEmoji = agentEmojiProp || '🤖';

  // Greeting message — uses real agent name from parent
  const greeting = (name, emoji) => ({
    id:1, from:"agent",
    text: t('agent.greeting').replace('{user}','').replace('Hi !','Hi!').replace('{name}',name),
    time: new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),
  });

  const [messages,   setMessages]   = useState(() => [greeting(initName, initEmoji)]);
  // Each study-prep session's steps, reported by its card: they show in the
  // trace of the turn they happened in, not in the card.
  const [studyPrepEvents, setStudyPrepEvents] = useState({});
  const onStudyPrepEvents = useCallback((sessionId, events) => {
    setStudyPrepEvents((previous) => (previous[sessionId] === events ? previous : { ...previous, [sessionId]: events }));
  }, []);
  // A workflow card is pinned above the message box while it runs, and goes
  // back to its message when it is waiting for the learner or done.
  const [runningPrep, setRunningPrep] = useState({});
  // Developer view: the workflow planner's notes, live, as thinking rows under the card's message.
  const [prepNotes, setPrepNotes] = useState({});
  const onStudyPrepNotes = useCallback((sessionId, env) => {
    setPrepNotes((previous) => {
      const list = previous[sessionId] || [];
      // Iterations restart at 1 in each wake: a note is one decision of one run.
      if (list.some((n) => n.payload?.iteration === env.payload?.iteration && (n.payload?.wakeId || null) === (env.payload?.wakeId || null))) return previous;
      return { ...previous, [sessionId]: [...list, env] };
    });
  }, []);
  // The workflow's run as the agent's own turn under the card's message: thought → tool → what it said, per decision.
  // After the plan is ready, each wake is its own agent message: the planning run stays under the card's message.
  const notesOf = (sid, wakeId = null) => (devView ? (prepNotes[sid] || []).filter((n) => (n.payload?.wakeId || null) === wakeId) : []);
  const workflowRun = (sid) => {
    const reported = studyPrepEvents[sid];
    if (!reported?.v3) return [];
    const { before, wakes } = splitWakes(reported.v3);
    return workflowRunBlocks(before, { notes: notesOf(sid), running: !wakes.size && !!runningPrep[sid] });
  };
  const wakeEvents = (sid, wakeId) => {
    const reported = studyPrepEvents[sid];
    return (reported?.v3 ? splitWakes(reported.v3).wakes.get(wakeId)?.events : null) || [];
  };
  const wakeRun = (sid, wakeId) => {
    const reported = studyPrepEvents[sid];
    const wake = reported?.v3 ? splitWakes(reported.v3).wakes.get(wakeId) : null;
    if (!wake) return null;
    return workflowRunBlocks(wake.events, { notes: notesOf(sid, wakeId), running: wake.open && !!runningPrep[sid] });
  };
  const onStudyPrepRunning = useCallback((sessionId, running) => {
    setRunningPrep((previous) => (!!previous[sessionId] === running ? previous : { ...previous, [sessionId]: running }));
  }, []);
  // A card's steps, split by turn: from this card's message (the first card
  // of the session takes everything before it) up to the session's next card.
  // The running card of this chat (its latest one), and the message it moves out of.
  const prepCards = messages.filter((m) => m.from !== "me" && m.studyPrepSessionId);
  const pinnedPrep = [...prepCards].reverse().find((m) => runningPrep[m.studyPrepSessionId])?.studyPrepSessionId || null;
  const lastPrepCardIdOf = (sid) => [...prepCards].reverse().find((m) => m.studyPrepSessionId === sid)?.id ?? null;
  const lastPrepCardId = pinnedPrep ? lastPrepCardIdOf(pinnedPrep) : null;
  const studyPrepSteps = (msg) => {
    const sessionId = msg.from !== "me" && msg.studyPrepSessionId;
    if (!sessionId || !studyPrepEvents[sessionId]) return [];
    const msgAt = (m) => Date.parse(m.at || "") || (typeof m.id === "number" ? Math.floor(m.id) : 0);
    const cards = messages.filter((m) => m.from !== "me" && m.studyPrepSessionId === sessionId);
    const index = cards.indexOf(msg);
    const range = { from: index <= 0 ? 0 : msgAt(msg), to: index >= 0 && cards[index + 1] ? msgAt(cards[index + 1]) : Infinity };
    // Phase 3: a workflow's steps live in its card (it streams them); only an
    // older API's session steps still join the chat's trace.
    const reported = studyPrepEvents[sessionId];
    return reported.v3 ? [] : studyPrepEventBlocks(reported, range);
  };
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
  // The model menu: the API's modes + model catalogue (GET /chat/models).
  const [serverModels, setServerModels] = useState(null);
  const [modelNotice, setModelNotice] = useState("");
  const [chatModelId, setChatModelId] = useState(() => { try { return localStorage.getItem('ak_chat_model') || null; } catch { return null; } });
  useEffect(() => {
    let alive = true;
    apiGet('/api/adaptive/chat/models').then(d => {
      if (!alive || !(Array.isArray(d?.modes) || Array.isArray(d?.models))) return;
      setServerModels(d);
      // The pick saved on the server (any device) wins over this browser's copy.
      const saved = d?.picker?.saved;
      if (saved && 'modelId' in saved) {
        setChatModelId(saved.modelId || null);
        try { if (saved.modelId) localStorage.setItem('ak_chat_model', saved.modelId); else localStorage.removeItem('ak_chat_model'); } catch { /* private mode */ }
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const [researchMode, setResearchMode] = useState(false);
  const [attachments,  setAttachments]  = useState([]);
  // Chat uploads saved to the Library (§7.17): ingest id → its state. One message's files can make several (one per folder).
  const [ingests, setIngests] = useState({});
  const putIngest = useCallback((x, { restored = false } = {}) => {
    if (!x?.id) return;
    // An Undo holds until a Restore: a late progress step of the read never revives it.
    setIngests((prev) => (!restored && prev[x.id]?.state === 'undone' && x.state !== 'undone') ? prev : { ...prev, [x.id]: { ...prev[x.id], ...x } });
  }, []);
  // "Files in this chat": what this conversation brought into the Library.
  const [chatFileList, setChatFileList] = useState([]);   // {id, file, name, size, previewUrl}
  const [attachError,  setAttachError]  = useState("");
  const [statusLabel,  setStatusLabel]  = useState("");   // streaming phase ("Searching the syllabus…")
  // A turn streams as interleaved thinking / tool / text steps (Grand Plan
  // §13.4). `running` spans the WHOLE turn (loading only covers the wait for
  // the first step); while it is true the send arrow is a ■ stop button.
  const [running,      setRunning]      = useState(false);
  const [inboxCount,   setInboxCount]   = useState(0);   // agent-network inbox: unread messages + unseen answers
  const runningRef = useRef(false);
  useEffect(() => { runningRef.current = running; }, [running]);
  // The records behind each ingest this client sent, so a scan/photo whose
  // read failed can be re-read here (the browser's lane) when the card or
  // the agent's retry asks for it.
  const ingestRecordsRef = useRef(new Map());
  // Developer view: raw tool name / arguments / output on each tool row.
  // A per-device preference — storage can be unavailable, so never required.
  const [devView, setDevView] = useState(() => { try { return localStorage.getItem(DEV_VIEW_KEY) === '1'; } catch { return false; } });
  const toggleDevView = () => setDevView((on) => {
    try { localStorage.setItem(DEV_VIEW_KEY, on ? '0' : '1'); } catch { /* preference only */ }
    return !on;
  });
  const abortRef       = useRef(null);
  const turnIdRef      = useRef(null);
  // Scrolling: follow new output only while the learner is already at the
  // bottom; otherwise offer a floating ↓ "jump to latest" button.
  const atBottomRef    = useRef(true);
  const [showJump,     setShowJump]     = useState(false);
  // History loads a page at a time: the newest HISTORY_PAGE messages on open,
  // the page before them each time the learner scrolls to the top.
  const olderRef       = useRef({ hasMore: false, before: null, loading: false });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const prependRef     = useRef(null);   // the scroll position to keep while older messages are added
  const skipFollowRef  = useRef(false);
  const fileInputRef   = useRef(null);
  // The composer's gate IS the Library's gate (one source): what the
  // Library can keep (isLibraryFile), as many files as one ingest holds
  // (the API's INGEST_LIMITS.FILES), up to the Library's per-file cap.
  const MAX_FILES      = 5;
  const MAX_FILE_MB    = 500;
  const attachJobsRef  = useRef(new Map());   // attachment id → { controller, readPromise, settleRead }

  const patchAttachment = useCallback((id, patch) => {
    setAttachments(prev => prev.map(a => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  // One picked file's life in the composer: upload at once (its progress
  // rides the tile), then read it here in the browser — both while the
  // learner composes. Send waits for the upload only; the read settles
  // the job's readPromise, which the post-send pipeline awaits instead of
  // ever reading the file twice. A removed tile aborts its upload and
  // takes its record back out of the Library.
  const runAttachJob = useCallback((entry, { readOnly = false } = {}) => {
    const { id, file } = entry;
    const controller = new AbortController();
    let settleRead;
    const readPromise = new Promise((res) => { settleRead = res; });
    attachJobsRef.current.set(id, { controller, readPromise, settleRead });
    const gone = () => !attachJobsRef.current.has(id);
    (async () => {
      let record = readOnly ? entry.record : null;
      try {
        if (!record) {
          patchAttachment(id, { status: "uploading", progress: 0, error: null, stage: null });
          record = await uploadChatFile(file, {
            signal: controller.signal,
            onProgress: (pct) => { if (!gone()) patchAttachment(id, { progress: pct }); },
          });
          if (gone()) { deleteRecord(record.id).catch(() => {}); settleRead({ pages: 0, failed: false, error: null }); return; }
          patchAttachment(id, { status: "extracting", progress: 100, recordId: record.id, record });
        } else {
          patchAttachment(id, { status: "extracting", error: null, stage: null });
        }
        const read = await readChatRecord(record);
        settleRead(read);
        if (gone()) return;
        patchAttachment(id, read.failed
          ? { status: "failed", stage: "read", error: read.error }
          : { status: "ready", stage: null, error: null, readPages: read.pages });
      } catch (e) {
        settleRead({ pages: 0, failed: true, error: e?.message || "Upload failed." });
        if (gone() || controller.signal.aborted) return;
        patchAttachment(id, { status: "failed", stage: record ? "read" : "upload", error: e?.message || "Upload failed." });
      }
    })();
  }, [patchAttachment]);

  const addAttachments = (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    setAttachError("");
    const room = MAX_FILES - attachments.length;
    if (room <= 0) { setAttachError(t('agent.attach_too_many').replace('{max}', MAX_FILES)); return; }
    const accepted = [], rejected = [];
    files.forEach((f) => {
      if (!isLibraryFile(f) || f.size > MAX_FILE_MB * 1024 * 1024) rejected.push(f);
      else if (accepted.length < room) accepted.push(f);
    });
    if (rejected.length) setAttachError(t('agent.attach_rejected').replace('{max}', MAX_FILE_MB));
    if (accepted.length) {
      const entries = accepted.map((f, i) => ({
        id: Date.now() + "-" + i + "-" + Math.random().toString(36).slice(2, 7),
        file: f, name: f.name, size: f.size,
        previewUrl: /^image\//.test(f.type) ? URL.createObjectURL(f) : null,
        status: "uploading", progress: 0, recordId: null, record: null, error: null, stage: null,
      }));
      setAttachments(prev => [...prev, ...entries]);
      entries.forEach((e) => runAttachJob(e));
    }
  };

  const removeAttachment = (id) => {
    const job = attachJobsRef.current.get(id);
    if (job) { job.controller.abort(); job.settleRead({ pages: 0, failed: false, error: null }); attachJobsRef.current.delete(id); }
    setAttachments(prev => {
      const hit = prev.find(a => a.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      // Picked but never sent: take its Library record back out, so
      // removing a tile leaves nothing behind — as it did when the
      // upload waited for Send.
      if (hit?.recordId) deleteRecord(hit.recordId).catch(() => {});
      return prev.filter(a => a.id !== id);
    });
  };

  const retryAttachment = (id) => {
    const entry = attachments.find(a => a.id === id);
    if (!entry || entry.status !== "failed") return;
    runAttachJob(entry, { readOnly: entry.stage === "read" && !!entry.record });
  };

  // ── Persistent chat sessions ───────────────────────────────────────────────
  const [sessions,      setSessions]      = useState([]);
  const [sessionId,     setSessionId]     = useState(null);
  // Changes waiting for the learner's OK (self-tooling S6): refetched when the chat opens or a reply lands.
  const [pendingChanges, setPendingChanges] = useState([]);
  const lastPhase = messages[messages.length - 1]?.phase;
  useEffect(() => {
    if (lastPhase && lastPhase !== "done") return;   // after a reply settles, not mid-stream
    let gone = false;
    apiGet('/api/self-tooling/confirmations')
      .then((r) => { if (!gone) setPendingChanges(((r?.data || r)?.pending) || []); })
      .catch(() => {});
    return () => { gone = true; };
  }, [sessionId, messages.length, lastPhase]);
  // The Agent inbox indicator (status row, right side): unread agent-network
  // messages + answers the learner hasn't seen. Tell-only inbox reports no
  // longer post into the chat — this count is how the learner knows. Refreshed
  // when a turn settles (opening the inbox clears it server-side), on a timer,
  // and when a decision card lands (socket handler below).
  const refetchInboxCount = useCallback(async () => {
    try { const d = await apiGet('/api/agent-network/inbox/count'); setInboxCount(d?.data?.total ?? 0); } catch {}
  }, []);
  useEffect(() => { refetchInboxCount(); }, [refetchInboxCount, sessionId, messages.length, lastPhase]);
  useEffect(() => {
    const iv = setInterval(refetchInboxCount, 60000);
    const onVis = () => { if (document.visibilityState === "visible") refetchInboxCount(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [refetchInboxCount]);
  const openAgentInbox = () => { if (innerTab !== "chat") setInnerTab("chat"); if (!running) sendMessage("What's in my agent inbox?"); };
  const [drawerOpen,    setDrawerOpen]    = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  /* Drawer list paging (scroll-to-fetch-more, 20 at a time): the total
     comes from the server; the cursor lives in a ref because creates and
     deletes mutate the list between page fetches. */
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const sessionsPageRef = useRef({ cursor: null, done: true, loading: false });
  // A failed history load must never look like an EMPTY history — that exact
  // confusion hid the persistence bug for weeks ("my chats are gone" vs "the
  // list didn't load"). { kind:"sessions" } = the past-chats list failed;
  // { kind:"messages", sessionId } = one conversation's messages failed.
  const [historyError,  setHistoryError]  = useState(null);
  const sessionIdRef = useRef(null);
  const creatingRef  = useRef(null);   // in-flight create → avoids double sessions
  const setSession = (id) => { sessionIdRef.current = id; setSessionId(id); };

  const CHAT_BASE = "/api/adaptive/chat";

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const d = await apiGet(`${CHAT_BASE}/sessions?limit=20`);
      const page = d?.sessions ?? [];
      setSessions(page);
      setSessionsTotal(typeof d?.total === "number" ? d.total : page.length);
      sessionsPageRef.current = { cursor: d?.nextCursor || null, done: !d?.nextCursor, loading: false };
      setHistoryError(null);
      return page;
    } catch {
      // apiGet only throws when BOTH the network and the offline cache came
      // up empty — show the banner so "couldn't load" is never mistaken for
      // "you have no past chats".
      setHistoryError({ kind: "sessions" });
      return [];
    }
    finally { setSessionsLoading(false); }
  };

  /* The drawer's next page. The cursor is value-based (last_message_at,
     id), so a chat created or deleted above it never shifts the pages. */
  const loadMoreSessions = async () => {
    const st = sessionsPageRef.current;
    if (st.loading || st.done || !st.cursor) return;
    st.loading = true;
    try {
      const d = await apiGet(`${CHAT_BASE}/sessions?limit=20&cursor=${encodeURIComponent(st.cursor)}`);
      const page = d?.sessions ?? [];
      st.cursor = d?.nextCursor || null;
      st.done = !d?.nextCursor;
      if (typeof d?.total === "number") setSessionsTotal(d.total);
      setSessions((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...page.filter((s) => !seen.has(s.id))];
      });
    } catch { /* keep what's shown — the sentinel can retry */ }
    st.loading = false;
  };
  const sessionsSentinelRef = useSentinel(loadMoreSessions, sessionsTotal > sessions.length);

  // Lazily create a session on first message; concurrency-safe.
  const ensureSession = async (firstText) => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (creatingRef.current) return creatingRef.current;
    creatingRef.current = (async () => {
      try {
        const d = await apiPost(`${CHAT_BASE}/sessions`, { title: firstText || "" });
        const id = d?.session?.id ?? null;
        if (id) { setSession(id); setSessions(prev => [d.session, ...prev]); setSessionsTotal(n => n + 1); }
        return id;
      } catch { return null; }
      finally { creatingRef.current = null; }
    })();
    return creatingRef.current;
  };

  const fromSaved = (m) => ({
    id: m.id,
    from: m.role === "user" ? "me" : "agent",
    text: m.text,
    time: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    at: m.created_at,
    ...(m.role !== "user" && Array.isArray(m.trace) ? { blocks: blocksFromSavedTrace(m.trace) } : {}),
    ...(m.role !== "user" && m.meta?.proposal ? { proposal: m.meta.proposal } : {}),
    // A suggestion's report: a study plan comes back as its plan card (§7.16.2 "Report").
    ...(m.role !== "user" && m.meta?.studyPrepSessionId ? { studyPrepSessionId: m.meta.studyPrepSessionId } : {}),
    // The agent woke on a Study Prep step (approve, a new topic, a marked check…): its run is this message.
    ...(m.role !== "user" && m.meta?.studyPrepWake?.wakeId ? { studyPrepWake: m.meta.studyPrepWake } : {}),
    // An Agent Check's run message carries its own card.
    ...(m.role !== "user" && m.meta?.agentCheck?.battleId ? { agentCheck: m.meta.agentCheck } : {}),
    ...(m.role !== "user" && Array.isArray(m.meta?.materials) && m.meta.materials.length ? { materials: cleanMaterials(m.meta.materials) } : {}),
    ...(m.role !== "user" && (m.meta?.ingests?.length || m.meta?.ingest?.id) ? (() => {
      const ids = (Array.isArray(m.meta.ingests) ? m.meta.ingests.map((x) => x?.id) : [m.meta.ingest.id]).filter(Boolean);
      return { ingestId: ids[0], ingestIds: ids };
    })() : {}),
    ...(m.role !== "user" && Array.isArray(m.meta?.ideas) && m.meta.ideas.length ? { ideas: cleanIdeas(m.meta.ideas) } : {}),
    // The Akoro team approved a tool while the learner was away: Run it now starts the agent's turn.
    ...(m.role !== "user" && m.meta?.runTool?.label ? { runTool: m.meta.runTool } : {}),
  });

  // Which chat the learner asked for last: a slower load of an earlier choice
  // (the resume on mount) must never replace a New chat or a later pick.
  const openSeqRef = useRef(0);
  const pendingTriesRef = useRef(new Map());
  const choseChatRef = useRef(false);
  const openSession = async (id, { auto = false, force = false } = {}) => {
    setDrawerOpen(false);
    if (id === sessionIdRef.current && !force) return;
    if (!auto) choseChatRef.current = true;
    const seq = ++openSeqRef.current;
    try {
      const d = await apiGet(`${CHAT_BASE}/sessions/${id}/messages?limit=${HISTORY_PAGE}`);
      if (seq !== openSeqRef.current) return;
      const msgs = (d?.messages ?? []).map(fromSaved);
      const pending = readPendingTurn(id);
      const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
      const savedReply = pending?.reply && msgs.some((m) => m.from === "agent" && norm(m.text) === norm(pending.reply));
      if (savedReply) { clearPendingTurn(id); pendingTriesRef.current.delete(id); }
      const withPending = pending?.reply && !savedReply
        ? [...msgs, { id: `pending-${pending.turnId || "turn"}`, from: "agent", text: pending.reply,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            at: new Date().toISOString(), pendingSave: true, blocks: [] }]
        : msgs;
      setSession(id);
      atBottomRef.current = true;
      olderRef.current = { hasMore: !!d?.hasMore, before: msgs[0]?.at || null, loading: false };
      setLoadingOlder(false);
      setMessages(withPending.length ? withPending : [greeting(agentName, agentEmoji)]);
      setHistoryError(null);
      // The reply was seen but the transcript does not have it yet: look again
      // shortly, up to three times, without hiding it meanwhile.
      if (pending?.reply && !savedReply) {
        const tries = pendingTriesRef.current.get(id) || 0;
        if (tries < 3) {
          pendingTriesRef.current.set(id, tries + 1);
          setTimeout(() => openSession(id, { auto: true, force: true }), tries === 0 ? 3000 : 8000);
        }
      }
    } catch {
      // Keep the current view, but SAY so — a silent failure here looks
      // exactly like "this conversation is empty" and learners conclude
      // their chat is gone. The transcript is safe server-side.
      setHistoryError({ kind: "messages", sessionId: id });
    }
  };

  // A scheduled or posted agent message landed in one of the learner's chats
  // ("message me here in 10 minutes"). If it is the open chat, show it now —
  // without a reload — and refresh the drawer either way.
  useEffect(() => {
    if (typeof window === "undefined" || !window.io) return;
    let socket;
    try {
      socket = window.io(API, socketOptions({ portal: "student" }));
      const subscribe = () => socket.emit("subscribe-student", STUDENT_ID);
      subscribe();
      socket.on("connect", subscribe);
      const onReady = async (data) => {
        loadSessions().catch(() => {});
        if (!data?.sessionId || data.sessionId !== sessionIdRef.current) return;
        try {
          // The ping carries the message itself (agent messages, proactive cards): shown at
          // once. Otherwise the new message is among the newest: one page is enough.
          const d = data.message?.id ? { messages: [data.message] }
            : await apiGet(`${CHAT_BASE}/sessions/${data.sessionId}/messages?limit=${HISTORY_PAGE}`);
          if (data.sessionId !== sessionIdRef.current) return;
          setMessages((prev) => {
            const ids = new Set(prev.map((m) => m.id));
            const texts = new Set(prev.map((m) => m.text));
            // A wake's opening line repeats ("A new topic started"): those are told apart by id, not text.
            const fresh = (d?.messages ?? [])
              .filter((m) => m.role !== "user" && !ids.has(m.id) && (m.meta?.studyPrepWake || !texts.has(m.text)))
              .map((m) => ({ id: m.id, from: "agent", text: m.text, ...(m.meta?.proposal ? { proposal: m.meta.proposal } : {}),
                ...(m.meta?.studyPrepWake?.wakeId ? { studyPrepWake: m.meta.studyPrepWake } : {}),
                ...(m.meta?.agentCheck?.battleId ? { agentCheck: m.meta.agentCheck } : {}),
                ...(m.meta?.runTool?.label ? { runTool: m.meta.runTool } : {}),
                at: m.created_at, time: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }));
            return fresh.length ? [...prev, ...fresh] : prev;
          });
        } catch { /* it is saved — opening the chat again shows it */ }
      };
      socket.on("chat_follow_up_ready", (data) => { onReady(data); if (data?.proposalId) refetchInbox(); refetchInboxCount(); });
      // A card tap started the agent's continuation turn and its outcome
      // message just landed in a chat: show it the same way.
      socket.on("agent_chat_updated", onReady);
      return () => { socket.off("chat_follow_up_ready", onReady); socket.off("agent_chat_updated", onReady); socket.off("connect", subscribe); };
    } catch { /* WS unavailable — the notification still links to the chat */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retry the exact load that failed: the sessions list, or the one
  // conversation that could not be opened.
  const retryHistoryLoad = () => {
    const failed = historyError;
    setHistoryError(null);
    if (failed?.kind === "messages" && failed.sessionId) openSession(failed.sessionId);
    else loadSessions().then((list) => { if (list.length && !sessionIdRef.current) openSession(list[0].id); });
  };

  const newChat = () => {
    choseChatRef.current = true;
    openSeqRef.current += 1;   // a chat still loading doesn't come back over this one
    setDrawerOpen(false);
    setSession(null);
    olderRef.current = { hasMore: false, before: null, loading: false };
    setLoadingOlder(false);
    setMessages([greeting(agentName, agentEmoji)]);
    setHistoryError(null);
  };

  // The page before the oldest message shown, kept in place on screen.
  const loadOlder = async () => {
    const page = olderRef.current;
    const id = sessionIdRef.current;
    if (!id || !page.hasMore || page.loading || !page.before) return;
    page.loading = true; setLoadingOlder(true);
    try {
      const d = await apiGet(`${CHAT_BASE}/sessions/${id}/messages?limit=${HISTORY_PAGE}&before=${encodeURIComponent(page.before)}`);
      if (id !== sessionIdRef.current) return;
      const older = (d?.messages ?? []).map(fromSaved);
      olderRef.current = { hasMore: !!d?.hasMore && older.length > 0, before: older[0]?.at || page.before, loading: false };
      const el = feedRef.current;
      if (el) prependRef.current = { height: el.scrollHeight, top: el.scrollTop };
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        const fresh = older.filter((m) => !ids.has(m.id));
        return fresh.length ? [...fresh, ...prev] : prev;
      });
    } catch {
      // Try again on the next scroll to the top.
      if (id === sessionIdRef.current) olderRef.current = { ...page, loading: false };
    } finally {
      if (id === sessionIdRef.current) setLoadingOlder(false);
    }
  };

  const removeSession = async (id, e) => {
    e?.stopPropagation?.();
    setSessions(prev => prev.filter(s => s.id !== id));
    setSessionsTotal(n => Math.max(0, n - 1));
    try { await apiDelete(`${CHAT_BASE}/sessions/${id}`); } catch { /* ignore */ }
    if (id === sessionIdRef.current) newChat();
  };

  // ── Copy a whole session from its row in the drawer ────────────────────────
  // Pulls the FULL conversation from the server (not just what's on screen),
  // formats it role-labelled for pasting into research/notes, and copies via
  // the shared clipboard helper. The row's icon flips to a check on success;
  // a failed copy/fetch leaves it untouched — this must never throw into the
  // tab (same contract as the per-message copy button).
  const [copiedId, setCopiedId] = useState(null);
  // Row options — one kebab per session opens a small menu: copy, rename,
  // delete. menuFor = the session id whose menu is open; renamingId = the
  // session being renamed inline (the row's title becomes an editor).
  const [menuFor,    setMenuFor]    = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");

  // The row options menu closes on any outside click; Escape also cancels
  // an in-progress rename. Declared AFTER menuFor/renamingId: the deps array
  // is read during render, so an earlier position threw a TDZ ReferenceError
  // ("Cannot access 'menuFor' before initialization") and crashed the tab.
  useEffect(() => {
    if (!menuFor && !renamingId) return undefined;
    const close = (e) => { if (!e.target.closest?.("[data-session-menu]")) setMenuFor(null); };
    const onKey = (e) => { if (e.key === "Escape") { setMenuFor(null); setRenamingId(null); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", onKey); };
  }, [menuFor, renamingId]);
  const saveRename = async (s) => {
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!title || title === s.title) return;
    try {
      const d = await apiPatch(`${CHAT_BASE}/sessions/${s.id}`, { title });
      if (d?.session?.title) setSessions(prev => prev.map(x => (x.id === s.id ? { ...x, title: d.session.title } : x)));
    } catch { /* keep the old title — a failed rename is silent, like delete */ }
  };
  const copySession = async (s, e) => {
    e?.stopPropagation?.();
    try {
      // The clipboard write starts inside the tap; the transcript fills it.
      const copied = await copyTextFrom(async () => {
        const d = await apiGet(`${CHAT_BASE}/sessions/${s.id}/messages`, { cache: false });
        const msgs = d?.messages ?? [];
        if (!msgs.length) return "";
        const stamp = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
        const body = msgs.map(m => `${m.role === "user" ? "You" : "Agent"} (${stamp(m.created_at)}):\n${m.text ?? ""}`).join("\n\n");
        return `${s.title || "Agent chat"}\n${msgs.length} message${msgs.length === 1 ? "" : "s"} · copied ${new Date().toLocaleString()}\n\n${body}`;
      });
      if (!copied) return;
      setCopiedId(s.id);
      setTimeout(() => setCopiedId((cur) => (cur === s.id ? null : cur)), 1400);
    } catch { /* leave the icon untouched */ }
  };

  // On mount: load the session list and resume the most recent conversation
  // so a refresh doesn't lose the chat.
  useEffect(() => {
    (async () => {
      const list = await loadSessions();
      if (list.length && !sessionIdRef.current && !choseChatRef.current) openSession(list[0].id, { auto: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { tasks, createTask, updateTask, toggleTask, deleteTask, refetch: refetchTasks } = useTaskAPI();

  // The one inbox (Grand Plan §7.16): the agent's chat suggestions and the
  // background planner's proposals in one list, each idea once. Accepting
  // does what the kind says — a task, a goal, a scheduled check-in, or the
  // conversation started here; dismissing asks why, so the agent learns
  // what not to offer again. Nothing runs until the learner accepts.
  const [inbox,setInbox]=useState([]);
  const [dismissReasons,setDismissReasons]=useState(["not_useful","wrong_time","too_much","already_doing"]);
  const [inboxBusyRef,setInboxBusyRef]=useState(null);
  const [askWhy,setAskWhy]=useState(null);   // the ref whose dismiss reasons are showing
  const [ideaSheet,setIdeaSheet]=useState(null);   // { type:"inbox", item } — the bottom sheet's subject (ideas arrive via the inbox too)
  const [sheetLike,setSheetLike]=useState(false);  // "More like this" tapped in the open sheet
  const openIdeaSheet=(type,item)=>{ setIdeaSheet({type,item}); setSheetLike(false); };
  const closeIdeaSheet=()=>{ setIdeaSheet(null); setAskWhy(null); };
  // What accepting an inbox idea actually creates — the sheet's "What's included".
  const includedLines=(it)=>{
    const k=it.kind;
    const head = k==="conversation"||k==="follow_up_question" ? [t('agent.included_chat'), t('agent.included_chat_sub')]
      : k==="goal"||k==="goal_nudge" ? [t('agent.included_goal'), null]
      : k==="session"||k==="teach_weak_topic" ? [t('agent.included_session'), null]
      : k==="practice"||k==="quiz_from_records" ? [t('agent.included_practice'), null]
      : k==="revision_battle" ? [t('agent.included_battle'), null]
      : k==="fix_it" ? [t('agent.included_fix'), null]
      : [t('agent.included_task'), null];
    return [head, [t('agent.included_nothing_else'), null]];
  };
  const suggestionCount=inbox.length;
  const refetchInbox=async()=>{ try{ const d=await apiGet('/api/agent/proposals/inbox'); setInbox(Array.isArray(d?.data)?d.data:[]); if(Array.isArray(d?.reasons)) setDismissReasons(d.reasons.filter(r=>r!=="other")); }catch{} };
  useEffect(()=>{ refetchInbox(); },[]);
  // Needs you (Phase 18 item 2): one list of what waits for the learner, from the server.
  const needsYou=useNeedsYou();
  // Ratings on replies (Phase 18 item 4): the learner's own, never shown to the agent.
  const [replyRatings,setReplyRating]=useReplyRatings(messages);
  // ?tasks=needs|suggestions (Home's Needs you card): open that Tasks list.
  const location=useLocation();
  useEffect(()=>{
    const want=new URLSearchParams(location.search).get('tasks');
    if(want!=='needs'&&want!=='suggestions') return;
    setInnerTab('tasks'); setTaskFilter(want);
    if(want==='needs') needsYou.reload();
  },[location.search]); // eslint-disable-line react-hooks/exhaustive-deps
  const openNeed=(it)=>{
    const href=it?.action?.href||'';
    if(href.includes('inbox=')){ setTaskFilter('suggestions'); return; }
    if(href==='/app?tab=agent'||href==='/?tab=agent'){ setInnerTab('chat'); return; }
    if(href) navigate(href);
  };
  const acceptIdea=async(it)=>{
    if(inboxBusyRef) return;
    setInboxBusyRef(it.ref); setListError("");
    try {
      const d=await apiPost(`/api/agent/proposals/inbox/${encodeURIComponent(it.ref)}/accept`,{});
      const r=d?.data||{};
      setInbox(prev=>prev.filter(x=>x.ref!==it.ref));
      afterAccept(r, r.kind||it.kind, it.title);
    } catch(e){ setListError(e?.message||t('agent.proposal_failed')); refetchInbox(); }
    finally{ setInboxBusyRef(null); }
  };
  const dismissIdea=async(it,reason)=>{
    if(inboxBusyRef) return;
    setInboxBusyRef(it.ref); setListError(""); setAskWhy(null);
    const previous=inbox;
    setInbox(prev=>prev.filter(x=>x.ref!==it.ref));
    try { await apiPost(`/api/agent/proposals/inbox/${encodeURIComponent(it.ref)}/dismiss`,{ reason: reason||"other" }); }
    catch(e){ setInbox(previous); setListError(e?.message||t('agent.proposal_failed')); }
    finally{ setInboxBusyRef(null); }
  };

  // After Yes (§7.16.2 "Report"): the result lands in the thread it was offered in. The server
  // posts it there (shown here when that chat is open); accepted from Suggestions, it comes back
  // as a view shown where the learner is. A follow-up carries on as their own chat message.
  const afterAccept=(r,kind,title)=>{
    if(kind==="follow_up_question"||kind==="conversation"){ setInnerTab("chat"); sendMessage(r.prompt||title); return; }
    if(["task","practice","goal_nudge","fix_it"].includes(kind)) refetchTasks();
    if(r.report){
      if(r.report.session_id===sessionIdRef.current){ const post=fromSaved({ ...r.report, role:"agent" }); setMessages(prev=>prev.some(m=>m.id===post.id)?prev:[...prev,post]); setInnerTab("chat"); }
      return;
    }
    const v=r.reportView;
    if(v){
      const t2=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
      setMessages(prev=>[...prev,{ id:Date.now()+Math.random(), from:"agent", text:v.text, time:t2,
        ...(v.meta?.materials?.length?{ materials:cleanMaterials(v.meta.materials) }:{}),
        ...(v.meta?.studyPrepSessionId?{ studyPrepSessionId:v.meta.studyPrepSessionId }:{}) }]);
      setInnerTab("chat");   // the report is where the learner looks next
      return;
    }
    if(kind==="session") pushAgent(t('agent.proposal_done_session'));
    else if(kind==="goal") pushAgent(t('agent.proposal_done_goal').replace('{title}',r.goal?.title||r.title||title));
    else pushAgent(t('agent.suggestion_added').replace('{title}',r.task?.title||r.title||title));
  };

  // A suggestion the agent posted into this chat (D49): the same one is in
  // Suggestions — a decision in either place shows in both.
  const decidePosted=async(msg,action)=>{
    const ref=`p:${msg.proposal.id}`;
    if(inboxBusyRef) return;
    setInboxBusyRef(ref); setListError("");
    const mark=(status)=>setMessages(prev=>prev.map(m=>m.id===msg.id?{...m,proposal:{...m.proposal,status}}:m));
    try {
      if(action==="accept"){
        const d=await apiPost(`/api/agent/proposals/inbox/${encodeURIComponent(ref)}/accept`,{});
        mark("executed");
        afterAccept(d?.data||{}, msg.proposal.kind, msg.proposal.title);
      } else {
        await apiPost(`/api/agent/proposals/inbox/${encodeURIComponent(ref)}/dismiss`,{ reason: action });
        mark("dismissed");
      }
      setInbox(prev=>prev.filter(x=>x.ref!==ref));
    } catch(e){
      // Already decided (from Suggestions, or another device): show it as done with.
      if(e?.status===404||/already decided|expired/i.test(e?.message||"")) mark("decided");
      else setListError(e?.message||t('agent.proposal_failed'));
    } finally { setInboxBusyRef(null); }
  };

  const pushAgent = (text) => {
    const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages(prev => [...prev, { id: Date.now() + Math.random(), from: "agent", text, time: t }]);
  };

  const PRI_COLOR = {high:RED,medium:GOLD,low:GREEN};
  const PRI_LABEL = {high:t('agent.pri_high_label'),medium:t('agent.pri_medium_label'),low:t('agent.pri_low_label')};
  const PRI_BG    = {high:`${RED}15`,medium:`${GOLD}15`,low:`${GREEN}15`};

  const [showWaiting, setShowWaiting] = useState(false);

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

  // Follow new output only while already at the bottom (the reference
  // behaviour); scrolled up to read, the view stays put and ↓ appears.
  const scrollToLatest=(smooth=false)=>{
    const el=feedRef.current; if(!el) return;
    if(smooth&&el.scrollTo) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); else el.scrollTop=el.scrollHeight;
    atBottomRef.current=true; setShowJump(false);
  };
  const onFeedScroll=()=>{
    const el=feedRef.current; if(!el) return;
    const fromBottom=el.scrollHeight-el.scrollTop-el.clientHeight;
    const atBottom=fromBottom<80;
    atBottomRef.current=atBottom;
    // Scrolled up a screen's worth (to read back): ↓ returns to the latest message.
    setShowJump(!atBottom&&fromBottom>Math.min(300,el.clientHeight*0.5));
    if(el.scrollTop<80) loadOlder();
  };
  // Older messages went in above: keep what the learner was reading in place.
  // A first page too short to scroll fetches the next one straight away.
  useLayoutEffect(()=>{
    const el=feedRef.current; if(!el) return;
    const kept=prependRef.current;
    if(kept){
      prependRef.current=null;
      el.scrollTop=el.scrollHeight-kept.height+kept.top;
      skipFollowRef.current=true;
    }
    if(el.scrollHeight<=el.clientHeight+10&&olderRef.current.hasMore) loadOlder();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[messages]);
  useEffect(()=>{
    if(!feedRef.current) return;
    if(skipFollowRef.current){ skipFollowRef.current=false; return; }
    if(atBottomRef.current) feedRef.current.scrollTop=feedRef.current.scrollHeight;
    else setShowJump(true);
  },[messages,loading]);

  // Tell the dashboard whether the CHAT surface is showing (vs tasks/stats/
  // self-study sub-tabs): the Now-Studying bar hides on chat only, per spec.
  // Unmount also reports false so the bar returns when we leave this tab.
  useEffect(() => {
    onChatActive?.(innerTab === "chat");
    return () => onChatActive?.(false);
  }, [innerTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // A suggestion chip puts its text in the message box — the learner can
  // change it, then send. Nothing is sent for them.
  const composerWrapRef=useRef(null);

  /* ── Voice: talk to your protégé ─────────────────────────────────────
     The mic records, /api/voice/transcribe turns it into words, and the
     words go through the SAME chat as typing — so the protégé's rules
     (taught knowledge only, Teach me, the teaching guide) hold by voice
     too. A reply to something said aloud is read aloud. */
  const sendRef=useRef(null);
  const voiceTurnRef=useRef(false);
  const mic=useVoiceAnswer({ onTranscript:(said)=>{ voiceTurnRef.current=true; sendRef.current?.(said); } });
  const tts=useSpeakReply({ voice:'nova' });
  // "Always read replies aloud" — the composer's audio switch, remembered on
  // this device. Off, only replies to something said aloud are spoken.
  const [readAloud,setReadAloud]=useState(()=>{ try { return localStorage.getItem('ak_read_aloud')==='1'; } catch { return false; } });
  const toggleReadAloud=()=>setReadAloud(on=>{
    const next=!on;
    try { localStorage.setItem('ak_read_aloud', next?'1':'0'); } catch { /* private mode — still works this session */ }
    if(!next) tts.stop();
    return next;
  });
  const applyIdea=(fill)=>{
    // "Find similar material" under an upload's reply opens the picker there (D52), not a chat turn.
    const last = messages[messages.length - 1];
    if (fill === FIND_SIMILAR && last?.ingestId) { openSimilar(last); return; }
    setInput(fill);
    requestAnimationFrame(()=>{
      const el=composerWrapRef.current?.querySelector('textarea,input[type="text"],input:not([type])');
      if(el){ el.focus(); try { el.setSelectionRange(fill.length, fill.length); } catch { /* not a text field */ } }
    });
  };

  // "Find similar material": message id → { loading | candidates | done, added }.
  const [similar, setSimilar] = useState({});
  const openSimilar = async (msg) => {
    setSimilar((prev) => ({ ...prev, [msg.id]: { loading: true } }));
    const r = await similarFor(msg.ingestId).catch(() => null);
    if (r?.data) putIngest(r.data);
    setSimilar((prev) => ({ ...prev, [msg.id]: { candidates: r?.candidates || [] } }));
  };
  const finishSimilar = async (msg, keys) => {
    const r = keys ? await addSimilar(msg.ingestId, keys).catch(() => null) : { data: await dismissSimilar(msg.ingestId).catch(() => null), added: [] };
    if (r?.data) putIngest(r.data);
    setSimilar((prev) => ({ ...prev, [msg.id]: { done: true, added: r?.added || [] } }));
  };
  // Agent-driven uploads (2026-11-16): the files were uploaded when they
  // were picked; this only scores the attach-time reads onto the ingest
  // (extraction state). The agent then reads, sorts and files the upload
  // with its own tools inside the turn — no structure call, no server post.
  const runIngest = async (ingest, entries) => {
    const items = entries.map((e) => ({ record: e.record, read: attachJobsRef.current.get(e.id)?.readPromise || null }));
    await readIngestRecords(ingest, items, putIngest).catch(() => {});
  };
  // While a turn runs, the agent's tools move the upload's card server-side
  // (steps, folder, state): poll the batch so it lands live, not on reopen.
  const pollTurnIngests = async (ids) => {
    const wanted = [...new Set(ids)].filter(Boolean);
    for (let i = 0; i < 90 && wanted.length; i++) {
      await new Promise((ok) => setTimeout(ok, 4000));
      const states = await Promise.all(wanted.map((id) => getIngest(id).catch(() => null)));
      states.forEach((x) => { if (x) putIngest(x); });
      if (states.every((x) => x && (x.state === 'failed' || x.state === 'undone' || (x.state === 'ready' && x.folder)))) return;
      if (!runningRef.current && i > 2) return;
    }
  };
  // Re-run the browser's read for an upload's records (scans and photos are
  // read in the app's lane), scoring it onto the ingest as usual.
  const rereadIngest = async (id) => {
    const records = ingestRecordsRef.current.get(id) || [];
    if (!records.length) return;
    const one = ingests[id] || { id };
    await readIngestRecords(one, records.map((record) => ({ record })), putIngest).catch(() => {});
  };
  // "Read it again" on the card: re-read here when this client holds the
  // records, then hand it to the agent — it retries and files in its turn.
  const readAgain = async (id) => {
    await rereadIngest(id);
    const one = ingests[id];
    await sendMessage(`Read my upload again — ${(one?.names || []).join(', ') || 'the file on the card'}`);
  };
  // A reopened chat: each saved reply's upload cards read their current state.
  useEffect(() => {
    const missing = [...new Set(messages.flatMap((m) => m.ingestIds || (m.ingestId ? [m.ingestId] : [])).filter((id) => id && !ingests[id]))];
    for (const id of missing.slice(0, 15)) getIngest(id).then((x) => putIngest(x)).catch(() => {});
  }, [messages]);   // eslint-disable-line react-hooks/exhaustive-deps
  // "Files in this chat" follows the chat and its uploads settling (read, moved, undone, restored).
  const filingKey = Object.values(ingests).filter((x) => x.chatSessionId === sessionIdRef.current)
    .map((x) => `${x.id}:${x.state}:${x.folder?.id || ''}`).join('|');
  // One upload, one card: several messages can carry the same ingest (the
  // turn's reply carries its id, and so does the server's "filed" post) —
  // the FIRST carrier in the conversation renders its steps and card; the
  // rest show as plain text. Without this the whole Saving → Filing →
  // Reading run showed twice around the reply (seen live 2026-11-16).
  const ingestClaims = (() => {
    const claimed = new Set(); const byMsg = new Map();
    for (const m of messages) {
      const ids = (m.ingestIds || (m.ingestId ? [m.ingestId] : [])).filter((id) => id && !claimed.has(id));
      ids.forEach((id) => claimed.add(id));
      byMsg.set(m.id, ids);
    }
    return byMsg;
  })();
  useEffect(() => {
    const sid = sessionIdRef.current;
    if (!sid) { setChatFileList([]); return; }
    let alive = true;
    chatFiles(sid).then((files) => { if (alive && sessionIdRef.current === sid) setChatFileList(files); }).catch(() => {});
    return () => { alive = false; };
  }, [sessionId, filingKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  // After Approve or Confirm on a card the chat carries on, so the agent follows through where the learner can see it:
  // approved → it runs the tool (thinking, tools, the Confirm card); confirmed → it checks what changed and what's left.
  // After the learner's choice the SERVER posts the follow-up into the chat; the
  // card is removed from the UI (not kept showing "Done"). No client continuation.
  const onCardDone=(what,card)=>{
    const cid=card?.confirmationId;
    if(!cid) return;
    setMessages(prev=>prev.flatMap(m=>m.confirm?.confirmationId!==cid?[m]:(m.text?[{...m,confirm:null}]:[])));
    setPendingChanges(prev=>prev.filter(c=>c.confirmationId!==cid));
  };
  const sendMessage=async(overrideText)=>{
    // Attachments can be sent with an empty message — a friendly default text
    // stands in so the model (and the transcript) knows what's being asked.
    const raw=(overrideText??input).trim();
    const text=raw || (attachments.length ? t('agent.attach_default_msg') : "");
    if(!text||loading||running) return;
    // Send waits for uploads (the composer disables it too): a file still
    // going up has no Library record to point the turn at yet. A read may
    // still be running — it finishes beside the turn, never blocking it.
    if(!overrideText && attachments.some(a=>a.status==="uploading")) return;
    // Talking here is choosing this chat: the resume on mount must not swap it out.
    if(!sessionIdRef.current){ choseChatRef.current=true; openSeqRef.current+=1; }
    if(!overrideText) setInput("");
    const spokenTurn=voiceTurnRef.current; voiceTurnRef.current=false;
    tts.stop();
    atBottomRef.current=true; setShowJump(false);   // your own message always brings you to the bottom
    const ts=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    // Only files that reached the Library ride this message; a tile whose
    // upload failed stays in the box, its retry still on it.
    const sentEntries=attachments.filter(a=>a.recordId&&a.record);
    const userMsg={id:Date.now(),from:"me",text,time:ts,attachments:sentEntries.map(a=>({name:a.name,previewUrl:a.previewUrl}))};
    setMessages(prev=>[...prev,userMsg]); setLoading(true); setRunning(true);
    setAttachError(""); setStatusLabel("");

    // Every learner turn uses the one unified Agent endpoint. It creates an
    // owned session before the request, then the API—not browser intent regexes
    // or separate persistence writes—selects direct tutoring or an authorised
    // tool and commits the completed turn.
    const sid = await ensureSession(text);
    if (!sid) {
      pushAgent(t('agent.error_connection'));
      setLoading(false); setRunning(false);
      return;
    }
    // Files go to the Library too (D51): they were uploaded when they were
    // picked, so this only sorts them — one upload per folder — and points
    // each ingest at the records that already exist. The attach is awaited,
    // so the turn below and each read find the files on their ingest.
    const batch = sentEntries.length ? await startIngest({ files: sentEntries.map((a) => a.file), ask: text, chatSessionId: sid }).catch(() => []) : [];
    for (const one of batch) {
      putIngest(one);
      const entries = filesOf(one, sentEntries);
      ingestRecordsRef.current.set(one.id, entries.map((e) => e.record));
      const attached = await attachIngestRecords(one, entries.map((e) => e.record)).catch(() => null);
      if (attached) putIngest(attached);
      void runIngest(one, entries);
    }
    if (batch.length) void pollTurnIngests(batch.map((b) => b.id));
    // Sent attachments are consumed by this message: their tiles leave the
    // box NOW, as the send commits — not when the reply lands. (They used
    // to be cleared at the end of this routine, so a long turn left them
    // sitting in the composer looking unsent.) A failed tile was never in
    // sentEntries, so it stays in the box, its retry still on it. The
    // preview URLs are revoked at the end of the turn as before — the
    // message bubble still shows them.
    if (sentEntries.length) {
      const sentIds = new Set(sentEntries.map((a) => a.id));
      setAttachments((prev) => prev.filter((a) => !sentIds.has(a.id)));
    }
    const ingest = batch[0] || null;
    const ingestIds = batch.map((x) => x.id);
    const mode = thinkMode ? "think" : researchMode ? "research" : "default";
    const statusKey = { grounding:'agent.status_grounding', attachments:'agent.status_attachments', thinking:'agent.status_thinking', synthesis:'agent.status_synthesis' };
    // No file bytes ride the turn any more: the payload points at the
    // ingests, and the API reads each file from its Library record.
    const history = messages.map(m => ({ role: m.from === "me" ? "user" : "assistant", content: m.text }));
    // A retry keeps the same opaque key for this send, allowing the server's
    // durable turn contract to repair a partial write without duplicate rows.
    const turnId = createAgentChatTurnId();
    turnIdRef.current = turnId;
    writePendingTurn(sid, { turnId, text, reply: "" });
    // The picked model rides the standard mode only (the server checks it and
    // remembers it on this chat; null = the default model).
    const modelPick = mode === "default" ? { model: chatModelId || null } : {};
    const payload = { message: text, inlineSuggestions: true, history: history.slice(-24), agentName, mode, ...modelPick,
      conversationId: sid, turnId,
      ...(ingest ? { ingestId: ingest.id, ingestIds } : {}),
      ...(devView ? { developer: true } : {}) };
    const t2=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const replyId=Date.now()+Math.random();
    let started=false;
    const ensureBubble=()=>{
      if(started) return;
      started=true;
      setLoading(false);   // hide typing dots — the bubble now carries the text
      setMessages(prev=>[...prev,{id:replyId,from:"agent",text:"",time:t2,thinking:"",phase:"thinking",blocks:[],...(ingest?{ingestId:ingest.id,ingestIds}:{})}]);
    };
    // Every step of the turn (thinking, tool, text between steps) folds into
    // the reply's ordered block list — interleaved as many times as it runs.
    const appendTrace=(event,data)=>{
      ensureBubble();
      setStatusLabel("");
      // The last step's streamed words were the answer: they become the reply.
      if(event==="activity_promote"){
        setMessages(prev=>prev.map(m=>{
          if(m.id!==replyId) return m;
          const { blocks, text } = promoteActivity(m.blocks, data?.id);
          return {...m,blocks:settleRunning(blocks,Date.now()),text:m.text+text,phase:"answering"};
        }));
        return;
      }
      setMessages(prev=>prev.map(m=>m.id===replyId?{...m,blocks:applyTraceEvent(m.blocks,event,data,Date.now())}:m));
    };
    // Think-mode reasoning summary streams live into its own thinking row.
    const appendThinking=(chunk)=>appendTrace("thinking",{ text: chunk });
    const appendDelta=(chunk)=>{
      ensureBubble();
      setStatusLabel("");
      setMessages(prev=>prev.map(m=>m.id===replyId?{...m,text:m.text+chunk,phase:"answering",
        blocks:m.phase==="answering"?m.blocks:settleRunning(m.blocks,Date.now())}:m));
    };
    const controller=typeof AbortController!=="undefined"?new AbortController():null;
    abortRef.current=controller;
    let finalReply="";
    let turnTools=[];   // what ran this turn — the chips follow it (a not-taught reply gets "ask your teaching guide")
    let gotDone=false;
    let inlineIdeas=false;   // the stream already carried this reply's chips
    // A turn that started but never got its "done" (the stream errored or the
    // connection closed mid-way): stop the spinners, say what happened, and
    // keep what already arrived. It used to stay "thinking" for ever.
    const settleBroken=(message)=>{
      setMessages(prev=>prev.map(m=>m.id===replyId?{...m,phase:"done",interrupted:true,
        blocks:settleRunning(m.blocks,Date.now(),{ stopped:true }),
        text:(m.text?`${m.text}\n\n`:"")+`_${message}_`}:m));
    };
    try {
      finalReply = await streamPost(agentChatEndpoint({ stream: true }), payload, {
        signal: controller?.signal,
        onTrace: appendTrace,
        onDelta: appendDelta,
        onThinking: appendThinking,
        onStatus: (s)=>{
          // A pick outside the plan (§7.11.5a): the default answered; say why and drop the pick.
          if(s?.step==="model"&&s?.label){ setModelNotice(s.label); setChatModelId(null); try{ localStorage.removeItem('ak_chat_model'); }catch{ /* private mode */ } return; }
          if(!started) setStatusLabel(t(statusKey[s?.step]||"") || s?.label || "");
        },
        // The confirm / permission card shows as soon as the tool made it — not after the whole reply.
        onCard: (c)=>{ if(!c?.confirm?.confirmationId) return; ensureBubble(); setMessages(prev=>prev.map(m=>m.id===replyId?{...m,confirm:c.confirm}:m)); },
        // The chips arrive on the same stream (no second request).
        onSuggestions: (list)=>{ inlineIdeas=true; const ideas=cleanIdeas(list); if(ideas.length) setMessages(prev=>prev.map(m=>m.id===replyId?{...m,ideas}:m)); },
        // The stored reply's id (ratings), sent once the save finishes — after done.
        onSaved: ({ messageId })=>{
          clearPendingTurn(sid);
          setMessages(prev=>prev.map(m=>m.id===replyId
            ? { ...m, ...(messageId ? { serverId: messageId } : {}), pendingSave: false }
            : (m.pendingSave ? { ...m, pendingSave: false } : m)));
        },
        onDone: ({ reply, syllabus, pastQuestions, thinking, toolExecutions, trace, stopped, messageId })=>{
          gotDone=true;
          ensureBubble(); setStatusLabel("");
          // Settle every step; if the live steps never arrived (an older API),
          // fall back to the saved trace the done event carries.
          setMessages(prev=>prev.map(m=>m.id===replyId?{...m,blocks:m.blocks?.length?settleRunning(m.blocks,Date.now()):blocksFromSavedTrace(trace)}:m));
          // Study-prep sessions ride the reply as a session echo (the
          // activity-draft pattern) — render the interactive session card.
          const studyPrepSession = (toolExecutions || []).find((entry) => entry?.session?.id && entry?.success)?.session || null;
          if (reply != null) writePendingTurn(sid, { turnId, reply });
          setMessages(prev=>prev.map(m=>m.id===replyId?{...m,...(reply!=null?{text:reply}:{}),thinking:thinking||m.thinking,syllabus:syllabus||[],pastQuestions:pastQuestions||[],phase:"done",...(stopped?{stopped:true}:{}),...(messageId?{serverId:messageId}:{}),...(studyPrepSession?{studyPrepSessionId:studyPrepSession.id}:{}),...protegeMoves(toolExecutions)}:m));
          turnTools=toolExecutions||[];
          if ((toolExecutions || []).some((entry) => entry?.tool === "retry_extraction" && entry?.success)) ingestIds.forEach((id) => void rereadIngest(id));
          if ((toolExecutions || []).some((entry) => entry?.tool === "create_task" && entry?.success)) refetchTasks();
          if ((toolExecutions || []).some((entry) => entry?.tool === "suggest_help" && entry?.success)) refetchInbox();
        },
      });
      if(!started){ // stream produced nothing — show fallback text
        finalReply=t('agent.fallback');
        setMessages(prev=>[...prev,{id:replyId,from:"agent",text:finalReply,time:t2}]);
      } else if(!gotDone){
        // The connection closed before the end. The server still saves the
        // full reply — it shows when the chat is reopened.
        settleBroken("The connection dropped while the agent was working. The reply is saved as soon as it finishes — reopening in a moment will show it.");
        finalReply="";
      }
    } catch (err) {
      setStatusLabel("");
      if(controller?.signal.aborted){
        // ■ Stop: keep what already streamed, mark the turn stopped. Never
        // fall back to the non-streaming retry — that would re-run the turn.
        ensureBubble();
        setMessages(prev=>prev.map(m=>m.id===replyId?{...m,phase:"done",stopped:true,
          blocks:settleRunning(m.blocks,Date.now(),{ stopped:true })}:m));
      }
      // Failed part-way (the server sent an error event): say so instead of
      // leaving the reply spinning.
      else if(started && !gotDone){
        settleBroken(err?.message || t('agent.error_connection'));
        finalReply="";
      }
      // Streaming failed before any token — retry the same idempotent turn in
      // normal JSON form, then show a connection error only if that also fails.
      else if(!started){
        try {
          const data = await apiPost(agentChatEndpoint(), payload);
          finalReply = data.reply || data.response || t('agent.fallback');
          writePendingTurn(sid, { turnId, reply: finalReply });
          setMessages(prev=>[...prev,{id:replyId,from:"agent",text:finalReply,time:t2,
            thinking:data.thinking||"",syllabus:data.syllabus||[],pastQuestions:data.pastQuestions||[],
            blocks:blocksFromSavedTrace(data.trace),...protegeMoves(data?.toolExecutions),...(ingest?{ingestId:ingest.id,ingestIds}:{})}]);
          turnTools=data?.toolExecutions||[];
          const studyPrepSessionFallback = (data?.toolExecutions || []).find((entry) => entry?.session?.id && entry?.success)?.session || null;
          if (studyPrepSessionFallback) {
            setMessages(prev=>prev.map(m=>m.id===replyId?{...m,studyPrepSessionId:studyPrepSessionFallback.id}:m));
          }
          if ((data?.toolExecutions || []).some((entry) => entry?.tool === "retry_extraction" && entry?.success)) ingestIds.forEach((id) => void rereadIngest(id));
          if ((data?.toolExecutions || []).some((entry) => entry?.tool === "create_task" && entry?.success)) refetchTasks();
          if ((data?.toolExecutions || []).some((entry) => entry?.tool === "suggest_help" && entry?.success)) refetchInbox();
        } catch {
          finalReply="";
          setMessages(prev=>[...prev,{id:replyId,from:"agent",text:t('agent.error_connection'),time:t2}]);
        }
      }
    }
    // Said aloud → answered aloud; with "always read aloud" on, every reply.
    if((spokenTurn||readAloud) && finalReply && !controller?.signal.aborted) tts.speak(replyId, finalReply);
    // Suggestions for every reply: three follow-ups, asked for AFTER the
    // reply has arrived (it never waits on them); a failure is just no chips.
    if(finalReply && !controller?.signal.aborted && !inlineIdeas){
      apiPost('/api/adaptive/chat/suggestions', { ask: text, reply: finalReply, role: 'student',
        tools: turnTools.map((x)=>({ tool: x?.tool, topic: x?.teach?.topic || x?.guide?.teach?.topic || null })),
        conversationId: sid,   // the chips are saved with the reply, so a refresh keeps them
        ...(batch.length ? { attachments: batch.flatMap((x)=>(x.names||[]).map((name)=>({ name, kind: x.kind }))) } : {}) })
        .then((r)=>{
          const ideas=cleanIdeas(r?.suggestions);
          if(ideas.length) setMessages(prev=>prev.map(m=>m.id===replyId?{...m,ideas}:m));
        })
        .catch(()=>{});
    }
    // Free the sent files' preview URLs (their tiles left the box when
    // the send committed, above).
    sentEntries.forEach(a=>a.previewUrl&&URL.revokeObjectURL(a.previewUrl));
    setLoading(false);
    setRunning(false);
    abortRef.current=null;
    turnIdRef.current=null;
  };

  sendRef.current=sendMessage;

  // ■ Stop: tell the server to stop THIS turn first (a dropped connection alone
  // never stops it — the server finishes and saves the full reply so a retry
  // replays it), then end the stream here. The server stops at its next
  // checkpoint (between tool steps, or mid-answer) and saves the turn as stopped.
  const stopTurn=async()=>{
    const controller=abortRef.current, turnId=turnIdRef.current;
    if(!controller) return;
    try { if(turnId) await apiPost(AGENT_CHAT_STOP_ENDPOINT, { turnId }); } catch { /* best effort */ }
    controller.abort();
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
  // Models (available ones, then "Coming soon") and the Thinking /
  // Research modes, as this deployment is set up (GET /chat/models).
  const picker = chatPicker(serverModels, { mode: selectedChatMode, modelId: chatModelId });
  const currentPick = { mode: selectedChatMode, modelId: chatModelId };
  const labelOfModel = (id) => (serverModels?.models || []).find(m => m.id === id)?.label || "that model";
  const chooseModel = optionId => {
    const next = applyModelPick(optionId, currentPick, serverModels);
    if (next === currentPick) return;
    const reset = next.mode !== selectedChatMode;
    setChatModelId(next.modelId);
    setThinkMode(next.mode === "think");
    setResearchMode(next.mode === "research");
    setModelNotice(reset ? `Thinking isn't available for ${labelOfModel(next.modelId || (serverModels?.models || []).find(m=>m.default)?.id)} — using Default.` : "");
    try { if (next.modelId) localStorage.setItem('ak_chat_model', next.modelId); else localStorage.removeItem('ak_chat_model'); } catch { /* private mode */ }
  };
  const chooseMode = optionId => {
    const next = applyModePick(optionId, currentPick, serverModels);
    if (next.mode === selectedChatMode) return;
    setThinkMode(next.mode === "think");
    setResearchMode(next.mode === "research");
    setModelNotice("");
  };
  // A saved mode can be unsupported by the model this device opens on.
  useEffect(() => {
    if (!serverModels || selectedChatMode === "default") return;
    const picked = (serverModels.models || []).find(m => m.id === chatModelId && m.available)
      || (serverModels.models || []).find(m => m.default);
    if (picked && picked.modes && picked.modes[selectedChatMode] === false) {
      setThinkMode(false); setResearchMode(false);
      setModelNotice(`${selectedChatMode === "think" ? "Thinking" : "Research"} isn't available for ${picked.label} — using Default.`);
    }
  }, [serverModels, chatModelId, selectedChatMode]);

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
        <style>{`@media (max-width:768px){.ak-inbox-word{display:none}}`}</style>
        <button onClick={openAgentInbox} title={t('agent.inbox')} aria-label={t('agent.inbox')} style={{ marginLeft:"auto",flexShrink:0,display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",padding:"2px 0",fontFamily:"'Nunito',sans-serif",color:inboxCount>0?BRAND:"var(--ak-text-muted)" }}>
          <Icon name="ti-inbox" size={14}/>
          <span className="ak-inbox-word" style={{ fontSize:11,fontWeight:800 }}>{t('agent.inbox')}</span>
          <span style={{ fontSize:10,fontWeight:900,background:inboxCount>0?BRAND:"var(--ak-border)",color:inboxCount>0?"#fff":"var(--ak-text-muted)",borderRadius:8,padding:"1px 6px" }}>{inboxCount}</span>
        </button>
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
          {historyError&&(
            /* "Couldn't load" ≠ "you have no history": a warm, non-alarming
               banner (nothing was lost — retry) instead of a silent empty
               chat. Retry repeats the exact load that failed. */
            <div style={{ display:"flex",alignItems:"center",gap:8,margin:"10px 16px 0",padding:"9px 12px",borderRadius:12,background:`${GOLD}14`,border:`1px solid ${GOLD}45`,flexShrink:0 }}>
              <span style={{ flex:1,fontSize:11.5,fontWeight:700,color:GOLD,lineHeight:1.45 }}>{t('agent.history_load_error')}</span>
              <button onClick={retryHistoryLoad} style={{ flexShrink:0,border:"none",background:`${GOLD}1A`,color:GOLD,cursor:"pointer",fontSize:11,fontWeight:900,whiteSpace:"nowrap",padding:"5px 10px",borderRadius:8,fontFamily:"'Nunito',sans-serif" }}>{t('agent.history_retry')}</button>
            </div>
          )}
          <ChatFilesStrip files={chatFileList} gutter={CHAT_GUTTER} onOpen={(f)=>navigate(`/library?record=${encodeURIComponent(f.recordId)}`)}/>
          {/* The feed: your messages in a grey box; the agent's turn unboxed —
              thinking rows, tool rows/groups and text interleaved as the turn
              ran, then the reply (Grand Plan §13.4). */}
          <div style={{ flex:1,position:"relative",display:"flex",flexDirection:"column",minHeight:0 }}>
          <div ref={feedRef} onScroll={onFeedScroll} style={{ flex:1,overflowY:"auto",padding:`14px ${CHAT_GUTTER}px`,display:"flex",flexDirection:"column",gap:14 }}>
            {loadingOlder&&(
              <div role="status" style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:7,fontSize:11.5,fontWeight:700,color:"var(--ak-text-muted)" }}>
                <style>{'@keyframes ak-trace-spin{to{transform:rotate(360deg)}}'}</style>
                <span aria-hidden style={{ width:11,height:11,borderRadius:"50%",border:`1.6px solid ${BRAND}40`,borderTopColor:BRAND,display:"inline-block",animation:"ak-trace-spin .8s linear infinite" }}/>
                Loading earlier messages…
              </div>
            )}
            {messages.map((msg,mi)=>{
              const isMe=msg.from==="me";
              const thinkingStream=!isMe&&msg.phase==="thinking";
              // Chips under the newest reply only: starters on a fresh chat (they
              // show what the agent can do), then each reply's follow-ups.
              const chipIdeas=!isMe&&mi===messages.length-1&&!running&&!(msg.studyPrepSessionId&&runningPrep[msg.studyPrepSessionId])
                ? (messages.length===1 ? CHAT_STARTERS.map(c=>({ label:t(c.labelKey)||c.label, fill:t(c.fillKey)||c.fill })) : (msg.ideas||[]))
                : [];
              if(isMe) return (
                <div key={msg.id} style={{ display:"flex",flexDirection:"column",alignItems:"flex-end" }}>
                  <div style={{ maxWidth:"86%",padding:"10px 14px",borderRadius:14,background:"var(--ak-surface-hover)",border:"1px solid var(--ak-border)",color:"var(--ak-text)",fontSize:14,lineHeight:1.55,fontWeight:500,whiteSpace:"pre-wrap",wordBreak:"break-word" }}>{msg.text}</div>
                  {msg.attachments?.length>0&&(
                    <div style={{ display:"flex",flexWrap:"wrap",gap:5,marginTop:5,justifyContent:"flex-end" }}>
                      {msg.attachments.map((a,i)=>a.previewUrl
                        ? <img key={i} src={a.previewUrl} alt={a.name} style={{ width:52,height:52,objectFit:"cover",borderRadius:10,border:"1px solid var(--ak-border2)" }}/>
                        : <span key={i} style={{ display:"inline-flex",alignItems:"center",gap:4,maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:10.5,fontWeight:700,padding:"4px 9px",borderRadius:20,background:"var(--ak-surface-hover)",border:"1px solid var(--ak-border)",color:"var(--ak-text-sub)" }}><Icon name="ti-file-text" size={10}/> {a.name}</span>)}
                    </div>
                  )}
                  <div style={{ fontSize:10,color:"var(--ak-text-muted)",marginTop:3,display:"flex",alignItems:"center",gap:4 }}>
                    {msg.time}
                    {msg.pendingSave && <span title="The server is still saving this reply">· Saving…</span>}
                    <CopyMessageButton text={msg.text} />
                  </div>
                </div>
              );
              if(msg.studyPrepWake){
                const wake=msg.studyPrepWake;
                const run=wakeRun(wake.sessionId,wake.wakeId)||[];
                const byLearner=["plan_confirmed","plan_adjusted","teach_back"].includes(wake.trigger);
                return (
                  <div key={msg.id} data-workflow-wake={wake.trigger} style={{ display:"flex",flexDirection:"column",alignItems:"stretch",minWidth:0,paddingLeft:REPLY_INSET,gap:6 }}>
                    {byLearner&&<div style={{ alignSelf:"flex-end",display:"inline-flex",alignItems:"center",gap:6,padding:"5px 11px",borderRadius:11,border:"1px dashed var(--ak-border2)",background:"var(--ak-surface-hover)",color:"var(--ak-text-sub)",fontSize:12,fontWeight:800 }}><Icon name="ti-circle-check" size={13}/>{wake.label||msg.text}</div>}
                    {run.length>0&&<div data-workflow-run=""><TraceBlocks blocks={run}/></div>}
                    {msg.agentCheck&&<AgentCheckCard check={msg.agentCheck} events={wakeEvents(wake.sessionId,wake.wakeId)} onWatch={(id)=>navigate(`/app?tab=battles&battle=${encodeURIComponent(id)}`)}/>}
                    <div style={{ fontSize:10,color:"var(--ak-text-muted)" }}>{msg.time}</div>
                  </div>
                );
              }
              return (
                <div key={msg.id} style={{ display:"flex",flexDirection:"column",alignItems:"stretch",minWidth:0,paddingLeft:REPLY_INSET }}>
                  {(msg.blocks?.length>0||studyPrepSteps(msg).length>0)&&<TraceBlocks blocks={[...(msg.blocks||[]),...studyPrepSteps(msg)]}/>}
                  {!msg.blocks?.length&&!studyPrepSteps(msg).length&&(msg.thinking||thinkingStream)&&<ThoughtBlock thinking={msg.thinking} streaming={thinkingStream}/>}
                  {/* An answer from the teaching guide, not from what the learner taught. */}
                  {msg.guide&&(
                    <div style={{ display:"inline-flex",alignSelf:"flex-start",alignItems:"center",gap:6,margin:"0 0 6px",padding:"4px 10px",borderRadius:20,background:"rgba(232,136,74,.12)",border:"1px solid rgba(232,136,74,.4)",color:"#B45309",fontSize:11.5,fontWeight:800 }}>
                      <Icon name="ti-school" size={12}/> {t('agent.from_guide').replace('{guide}', msg.guide.name||'NaNa')}
                    </div>
                  )}
                  {!isMe&&(ingestClaims.get(msg.id)||[]).some((id)=>ingests[id])&&(
                    <div data-ingest-cards="" style={{ display:"flex",flexDirection:"column",gap:8,margin:"0 0 10px" }}>
                      {(ingestClaims.get(msg.id)||[]).filter((id)=>ingests[id]).map((id)=>(
                        <IngestCard key={id} ingest={ingests[id]}
                          onOpenFolder={(fid)=>navigate(`/library?folder=${encodeURIComponent(fid)}`)}
                          onUndo={async()=>{ const r=await undoIngest(id).catch(()=>null); if(r) putIngest(r); }}
                          onRestore={async()=>{ const r=await restoreIngest(id).catch(()=>null); if(r) putIngest(r,{restored:true}); }}
                          onChooseFolder={async(fid)=>{ const r=await chooseFolder(id,fid).catch(()=>null); if(r) putIngest(r); }}
                          onChooseSubject={async(subject)=>{ const r=await chooseSubject(id,subject).catch(()=>null); if(r) putIngest(r); }}
                          onReadAgain={()=>readAgain(id)}/>
                      ))}
                    </div>
                  )}
                  {msg.text&&(
                    <div style={{ fontSize:14.5,lineHeight:1.55,color:"var(--ak-text)",fontWeight:500,wordBreak:"break-word" }}><RichText text={msg.text} size={14.5} lineHeight={1.55}/>{msg.phase==="answering"&&<StreamCaret/>}</div>
                  )}
                  {msg.agents?.length>0&&<AgentCards agents={msg.agents} onFill={applyIdea}/>}
                  {msg.requests?.length>0&&<ChallengeRequestCards requests={msg.requests} mine={!!msg.requestsMine}/>}
                  {msg.confirm&&<ConfirmChangeCard confirm={msg.confirm} onDone={onCardDone}/>}
                  {/* Approved by the Akoro team while away: one tap runs it in a normal turn (gone once the chat moves on). */}
                  {msg.runTool&&!messages.slice(messages.indexOf(msg)+1).some((m)=>m.from==="me")&&(
                    <button type="button" disabled={loading||running} onClick={()=>sendMessage(`Run "${msg.runTool.label}" now.`)}
                      style={{ display:"inline-flex",alignItems:"center",gap:6,marginTop:10,padding:"7px 14px",borderRadius:999,border:"none",background:BRAND,color:"#fff",fontSize:12.5,fontWeight:900,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>
                      <Icon name="ti-player-play" size={13}/> Run it now
                    </button>
                  )}
                  {/* Not taught yet — the learner can teach it now. */}
                  {msg.teach&&onTeachTopic&&(
                    <div style={{ display:"flex",alignItems:"center",gap:10,marginTop:10,padding:"10px 12px",borderRadius:14,background:`${BRAND}0D`,border:`1px solid ${BRAND}33` }}>
                      <span style={{ width:34,height:34,borderRadius:10,background:`${BRAND}1A`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}><Icon name="ti-chalkboard" size={17} color={BRAND}/></span>
                      <div style={{ flex:1,minWidth:0 }}>
                        <p style={{ margin:0,fontSize:13,fontWeight:900,color:"var(--ak-text)" }}>{t('agent.teach_title').replace('{topic}', msg.teach.topic)}</p>
                        <p style={{ margin:"2px 0 0",fontSize:11.5,fontWeight:600,color:"var(--ak-text-muted)",lineHeight:1.4 }}>{t('agent.teach_sub')}</p>
                      </div>
                      <button type="button" onClick={()=>onTeachTopic(msg.teach)}
                        style={{ padding:"8px 14px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:12.5,fontWeight:900,cursor:"pointer",fontFamily:"'Nunito',sans-serif",flexShrink:0 }}>
                        {t('agent.teach_cta')}
                      </button>
                    </div>
                  )}
                  {msg.stopped&&(
                    <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:4,fontSize:11.5,fontWeight:700,color:"var(--ak-text-muted)" }}>
                      <span style={{ width:8,height:8,borderRadius:2,background:"var(--ak-text-muted)",display:"inline-block" }}/>{t('agent.stopped')}
                    </div>
                  )}
                  {!isMe&&msg.studyPrepSessionId&&lastPrepCardIdOf(msg.studyPrepSessionId)!==msg.id
                    ? <div data-workflow-earlier-card="" style={{ display:"flex",alignItems:"center",gap:6,marginTop:6,fontSize:11.5,fontWeight:750,color:"var(--ak-text-muted)" }}><Icon name="ti-arrow-down" size={13}/>Study Prep — continued further down</div>
                    : !isMe&&msg.studyPrepSessionId&&(pinnedPrep===msg.studyPrepSessionId&&lastPrepCardId===msg.id
                    ? <div data-workflow-pinned-note="" style={{ display:"flex",alignItems:"center",gap:6,marginTop:6,fontSize:11.5,fontWeight:750,color:"var(--ak-text-muted)" }}><Icon name="ti-pin" size={13}/>Study Prep is running — pinned above the message box</div>
                    : <StudyPrepChatCard sessionId={msg.studyPrepSessionId} onEvents={onStudyPrepEvents} onRunning={onStudyPrepRunning} developer={devView} onNotes={onStudyPrepNotes} conversationId={sessionId}/>)}
                  {!isMe&&msg.proposal?.status==="proposed"&&msg.proposal.preview&&<ProposalPreview preview={msg.proposal.preview}/>}
                  {!isMe&&msg.proposal&&(msg.proposal.status==="proposed"?(
                    /* The one approval row (Allow / Reject / Later) — Later keeps it pending in Needs you. */
                    <ApprovalButtons busy={inboxBusyRef===`p:${msg.proposal.id}`} onAllow={()=>decidePosted(msg,"accept")} onReject={()=>decidePosted(msg,"not_useful")}/>
                  ):(
                    <div style={{ display:"inline-flex",alignItems:"center",gap:5,marginTop:8,fontSize:11.5,fontWeight:800,color:msg.proposal.status==="executed"?GREEN:"var(--ak-text-muted)" }}>
                      <Icon name={msg.proposal.status==="executed"?"ti-circle-check":"ti-circle-x"} size={13}/>
                      {t(msg.proposal.status==="executed"?'agent.posted_done':msg.proposal.status==="failed"?'agent.proposal_failed':'agent.posted_closed')}
                    </div>
                  ))}
                  {/* Materials the tools found — each opens the material (or teaches the topic). */}
                  {!isMe&&msg.materials?.length>0&&(
                    <div aria-label={t('agent.materials')} style={{ display:"flex",flexWrap:"wrap",gap:6,marginTop:8 }}>
                      {msg.materials.map((m)=>m.kind==='study_output'&&m.href?(
                        // What chat made (quiz, flashcards, summary, podcast): a saved reader tab — tap opens the reader on it (preview approved 2026-11-07).
                        <StudyOutputCard key={m.href} m={m} onOpen={()=>navigate(m.href)}/>
                      ):m.sub&&m.kind==='blog_passage'?(
                        // A blog passage the answer used: the post and its section, opening the post (preview approved 2026-11-07).
                        <button key={m.href} type="button" data-material={m.kind} onClick={()=>navigate(m.href)}
                          style={{ display:"flex",alignItems:"center",gap:7,maxWidth:"100%",padding:"6px 10px",borderRadius:12,border:"1px solid var(--ak-border2)",background:"var(--ak-surface)",cursor:"pointer",fontFamily:"'Nunito',sans-serif",textAlign:"left" }}>
                          <span style={{ fontSize:10,fontWeight:900,color:BRAND,background:`${BRAND}18`,borderRadius:5,padding:"1px 5px",flexShrink:0 }}>Blog</span>
                          <span style={{ display:"grid",minWidth:0 }}>
                            <span style={{ fontSize:12,fontWeight:800,color:"var(--ak-text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{m.title}</span>
                            <span style={{ fontSize:10.5,color:"var(--ak-text-sub)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{m.sub}</span>
                          </span>
                        </button>
                      ):(
                        <button key={m.href||(m.teach?`t:${m.teach.topic}`:`r:${m.reply}`)} type="button" data-material={m.kind}
                          onClick={()=>{ if(m.href) navigate(m.href); else if(m.reply) sendMessage(m.reply); else if(onTeachTopic) onTeachTopic(m.teach); }}
                          disabled={!m.href&&!m.reply&&!onTeachTopic} title={m.href?t('agent.materials'):m.reply?m.reply:t('agent.syllabus_hint')}
                          style={{ display:"inline-flex",alignItems:"center",gap:5,maxWidth:"100%",padding:"6px 11px",borderRadius:20,border:`1.5px solid ${BRAND}40`,background:"var(--ak-surface)",color:BRAND,fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                          <Icon name={MATERIAL_ICON[m.kind]||"ti-arrow-up-right"} size={12}/>
                          <span style={{ overflow:"hidden",textOverflow:"ellipsis" }}>{m.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!isMe&&similar[msg.id]&&(
                    <SimilarPicker state={similar[msg.id]} folderName={ingests[msg.ingestId]?.folder?.name}
                      onAdd={(keys)=>finishSimilar(msg, keys)} onDismiss={()=>finishSimilar(msg, null)} onOpen={(href)=>navigate(href)}/>
                  )}
                  {!isMe&&msg.syllabus?.length>0&&(
                    <div style={{ display:"flex",flexWrap:"wrap",gap:5,marginTop:5 }}>
                      {msg.syllabus.map((s,i)=>(
                        <button type="button" key={i} disabled={!onTeachTopic} onClick={()=>onTeachTopic?.({ topic:s.topic, subject:s.subject||'' })}
                          title={`${s.exam?s.exam+" ":""}${s.subject} — ${s.topic} · ${t('agent.syllabus_hint')}`} style={{ cursor:onTeachTopic?"pointer":"default",fontFamily:"'Nunito',sans-serif",display:"inline-flex",alignItems:"center",gap:4,fontSize:10.5,fontWeight:800,padding:"3px 9px",borderRadius:20,background:`${BRAND}12`,border:`1px solid ${BRAND}30`,color:BRAND,maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                          <Icon name="ti-book" size={10}/> {s.exam?`${s.exam} · `:""}{s.topic}
                        </button>
                      ))}
                    </div>
                  )}
                  {!isMe&&msg.pastQuestions?.length>0&&(
                    <div style={{ display:"flex",flexWrap:"wrap",gap:5,marginTop:5 }}>
                      {msg.pastQuestions.map((s,i)=>(
                        <button type="button" key={i} onClick={()=>applyIdea(t('agent.past_q_fill').replace('{paper}', `${s.exam}${s.year?` ${s.year}`:""}`).replace('{topic}', s.topic||s.subject||''))}
                          title={`${s.exam} ${s.year||""}${s.subject?` · ${s.subject}`:""}${s.topic?` — ${s.topic}`:""}`} style={{ cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"inline-flex",alignItems:"center",gap:4,fontSize:10.5,fontWeight:800,padding:"3px 9px",borderRadius:20,background:"rgba(232,136,74,.12)",border:"1px solid rgba(232,136,74,.35)",color:"#B45309",maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                          <Icon name="ti-edit" size={10}/> {s.exam}{s.year?` ${s.year}`:""}{s.topic?` · ${s.topic}`:""}
                        </button>
                      ))}
                    </div>
                  )}
                  {chipIdeas.length>0&&(
                    <div aria-label={messages.length===1?t('agent.try_asking'):t('agent.try_next')} style={{ display:"flex",flexWrap:"wrap",alignItems:"center",gap:6,marginTop:10 }}>
                      <span style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:11,fontWeight:800,color:"var(--ak-text-muted)" }}>
                        <Icon name="ti-bulb" size={12}/> {messages.length===1?t('agent.try_asking'):t('agent.try_next')}
                      </span>
                      {chipIdeas.map(it=>(
                        <button key={it.label} type="button" onClick={()=>applyIdea(it.fill)} title={t('agent.idea_hint')}
                          style={{ padding:"7px 12px",borderRadius:20,border:`1.5px solid ${BRAND}40`,background:`${BRAND}0D`,color:BRAND,fontSize:12.5,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif",textAlign:"left",lineHeight:1.3 }}>
                          {it.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize:10,color:"var(--ak-text-muted)",marginTop:3,display:"flex",alignItems:"center",gap:4,flexWrap:"wrap" }}>
                    {msg.time}
                    {msg.text&&<CopyMessageButton text={msg.text} />}
                    {msg.text&&msg.phase!=="answering"&&msg.phase!=="thinking"&&(
                      <button type="button" onClick={()=>tts.speakingId===msg.id?tts.stop():tts.speak(msg.id,msg.text)}
                        title={tts.speakingId===msg.id?t('agent.listen_stop'):t('agent.listen')} aria-label={tts.speakingId===msg.id?t('agent.listen_stop'):t('agent.listen')}
                        style={{ background:"none",border:"none",cursor:"pointer",padding:3,display:"inline-flex",alignItems:"center",color:tts.speakingId===msg.id?BRAND:"var(--ak-text-muted)" }}>
                        {tts.loadingId===msg.id?<Spinner size={11}/>:<Icon name={tts.speakingId===msg.id?"ti-player-stop":"ti-volume"} size={13}/>}
                      </button>
                    )}
                    {msg.text&&msg.phase!=="answering"&&msg.phase!=="thinking"&&ratableId(msg)&&(
                      <ReplyRating messageId={ratableId(msg)} value={replyRatings[ratableId(msg)]} onChange={(v)=>setReplyRating(ratableId(msg),v)}/>
                    )}
                  </div>
                  {/* The agent keeps working after its reply: the workflow's run, live (thought → tool → its words). */}
                  {!isMe&&msg.studyPrepSessionId&&lastPrepCardIdOf(msg.studyPrepSessionId)===msg.id&&(()=>{ const run=workflowRun(msg.studyPrepSessionId); return run.length>0&&<div data-workflow-run="" style={{ marginTop:10 }}>{devView?<TraceBlocks blocks={run}/>:<PlannerNotes blocks={run}/>}</div>; })()}
                </div>
              );
            })}
            {loading&&(
              <div style={{ display:"flex",alignItems:"center",gap:8,color:"var(--ak-text-muted)",fontSize:12.5,fontWeight:600 }}>
                <span style={{ display:"flex",gap:5 }}>{[0,.25,.5].map((d,i)=><span key={i} style={{ width:6,height:6,borderRadius:"50%",background:BRAND,display:"inline-block",animation:`bounce-dot .7s ease-in-out ${d}s infinite alternate` }}/>)}</span>
                {statusLabel&&<span>{statusLabel}</span>}
              </div>
            )}
          </div>
          {showJump&&(
            <button type="button" onClick={()=>scrollToLatest(true)} title={t('agent.jump_latest')} aria-label={t('agent.jump_latest')}
              style={{ position:"absolute",bottom:12,left:"50%",transform:"translateX(-50%)",width:36,height:36,borderRadius:"50%",background:"var(--ak-surface)",border:"1px solid var(--ak-border2)",boxShadow:"0 4px 14px rgba(15,23,42,.16)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",padding:0,zIndex:5 }}>
              <Icon name="ti-arrow-down" size={17} color="var(--ak-text)"/>
            </button>
          )}
          </div>
          <div style={{ padding:`10px ${CHAT_GUTTER}px 12px`,borderTop:"1px solid var(--ak-border)",background:"var(--ak-surface)",flexShrink:0 }}>
            {(mic.recording||mic.transcribing||mic.micError||tts.speakError)&&(
              <div role="status" style={{ display:"flex",alignItems:"center",gap:8,margin:"0 0 8px",padding:"7px 11px",borderRadius:10,
                background:mic.micError||tts.speakError?"rgba(239,68,68,.10)":`${BRAND}10`,border:`1px solid ${mic.micError||tts.speakError?`${RED}35`:`${BRAND}30`}` }}>
                {mic.recording&&<><style>{"@keyframes ak-rec-pulse{0%,100%{opacity:1}50%{opacity:.25}}"}</style><span style={{ width:8,height:8,borderRadius:"50%",background:RED,animation:"ak-rec-pulse 1.2s infinite ease-in-out",flexShrink:0 }}/></>}
                <span style={{ flex:1,fontSize:11.5,fontWeight:700,color:mic.micError||tts.speakError?RED:BRAND }}>
                  {mic.micError||tts.speakError||(mic.recording?t('agent.voice_listening'):t('agent.voice_transcribing'))}
                </span>
                {tts.speakError&&<button onClick={tts.clearSpeakError} style={{ border:"none",background:"transparent",color:RED,cursor:"pointer",fontSize:13,fontWeight:900,padding:0 }}>×</button>}
              </div>
            )}
            {attachError&&(
              <div style={{ display:"flex",alignItems:"center",gap:8,margin:"0 0 8px",padding:"7px 11px",borderRadius:10,background:"rgba(239,68,68,.10)",border:`1px solid ${RED}35` }}>
                <span style={{ flex:1,fontSize:11,fontWeight:700,color:RED }}>{attachError}</span>
                <button onClick={()=>setAttachError("")} style={{ border:"none",background:"transparent",color:RED,cursor:"pointer",fontSize:13,fontWeight:900,padding:0 }}>×</button>
              </div>
            )}
            {/* Attachments render as tiles INSIDE the composer box (below). */}
            {/* Changes still waiting for the learner's OK: one slim bar, never cards stacked under the latest turn. (A study prep in progress is not shown here: the Needs-you tab and the home workflow card carry it.) */}
            {(()=>{
              const waiting=pendingChanges.filter((c)=>c.sessionId&&c.sessionId===sessionId&&!messages.some((m)=>m.confirm?.confirmationId===c.confirmationId));
              if(!waiting.length) return null;
              const bar={ display:"flex",alignItems:"center",gap:8,padding:"7px 11px",borderRadius:12,border:"1px solid var(--ak-border)",background:"var(--ak-surface-hover)",fontSize:12,fontWeight:800,color:"var(--ak-text)",fontFamily:"'Nunito',sans-serif" };
              const btn={ marginLeft:"auto",padding:"5px 12px",borderRadius:999,border:"none",background:BRAND,color:"#fff",fontSize:11.5,fontWeight:900,cursor:"pointer",fontFamily:"'Nunito',sans-serif" };
              return (
                <div data-open-bar="" style={{ display:"flex",flexDirection:"column",gap:6,margin:"0 0 8px" }}>
                  {waiting.length>0&&<div style={bar}><Icon name="ti-shield-check" size={14} color={BRAND}/><span>{waiting.length} change{waiting.length===1?"":"s"} waiting for your OK</span>
                    <button type="button" style={btn} onClick={()=>setShowWaiting((v)=>!v)}>{showWaiting?"Hide":"Show"}</button></div>}
                  {waiting.length>0&&showWaiting&&<div style={{ maxHeight:"36vh",overflowY:"auto" }}>{waiting.map((c)=><ConfirmChangeCard key={c.confirmationId} confirm={c} onDone={onCardDone}/>)}</div>}
                </div>
              );
            })()}
            {pinnedPrep && (
              <div data-workflow-pinned="" style={{ width:"min(560px,100%)",maxHeight:"42vh",overflowY:"auto",margin:"0 0 8px",boxShadow:"0 4px 18px rgba(30,20,60,.12)",borderRadius:14 }}>
                <StudyPrepChatCard sessionId={pinnedPrep} onEvents={onStudyPrepEvents} onRunning={onStudyPrepRunning} pinned developer={devView} onNotes={onStudyPrepNotes} conversationId={sessionId}/>
              </div>
            )}
            <div ref={composerWrapRef}>
            <FortizoChatComposer
              newlineOnTouchEnter
              value={input}
              onChange={setInput}
              onSend={()=>sendMessage()}
              placeholder={t('agent.ask_anything').replace('{name}', shownName)}
              disabled={running}
              running={running}
              onStop={stopTurn}
              stopLabel={t('agent.stop')}
              attachmentAction={()=>fileInputRef.current?.click()}
              attachmentLabel={t('agent.attach_add')}
              attachments={attachments}
              onAttachmentRemove={removeAttachment}
              onAttachmentRetry={retryAttachment}
              voiceAction={()=>{ if(mic.recording) mic.stop(); else { tts.stop(); mic.start(); } }}
              voiceActive={mic.recording}
              voiceLabel={mic.recording?t('agent.voice_stop'):mic.transcribing?t('agent.voice_transcribing'):t('agent.voice_start')}
              audioAction={toggleReadAloud}
              audioActive={readAloud}
              audioToggle
              audioIcon={readAloud?'ti-volume':'ti-volume-off'}
              audioLabel={readAloud?t('agent.read_aloud_on'):t('agent.read_aloud_off')}
              hideModelMenu
              sendDisabled={(!input.trim()&&!attachments.length)||attachments.some(a=>a.status==="uploading")}
            />
            </div>
            {/* The model switch — the LLM behind the next message. */}
            <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:8 }}>
              <ModelSwitch modelId={picker.modelSelectedId} modelLabel={picker.modelLabel} modelOptions={picker.modelOptions}
                onModelChange={chooseModel} disabled={running} icon="ti-cpu" tier={picker.tier}
                title="Choose a model" menuLabel="Models" ariaPrefix="Model"/>
              <ModelSwitch modelId={picker.modeSelectedId} modelLabel={picker.modeLabel} modelOptions={picker.modeOptions}
                onModelChange={chooseMode} disabled={running} icon="ti-bolt"
                title="Choose a mode" menuLabel="Modes" ariaPrefix="Mode"/>
            </div>
            {modelNotice&&(
              <div data-model-notice="" role="status" style={{ display:"flex",alignItems:"flex-start",gap:6,marginTop:6,padding:"7px 10px",borderRadius:10,background:"#F59E0B14",color:"#B45309",fontSize:11.5,fontWeight:700,lineHeight:1.4,fontFamily:"'Nunito',sans-serif" }}>
                <Icon name="ti-info-circle" size={14} color="#B45309" style={{ marginTop:1 }}/>
                <span style={{ flex:1 }}>{modelNotice}</span>
                <button type="button" aria-label="Dismiss" onClick={()=>setModelNotice("")} style={{ border:0,background:"transparent",color:"inherit",cursor:"pointer",padding:0,display:"flex" }}><Icon name="ti-x" size={13} color="#B45309"/></button>
              </div>
            )}
            <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,audio/*,video/*,.docx,.pptx,.txt,.md,.csv,.mp3,.m4a,.aac,.wav,.ogg,.flac,.mp4,.m4v,.mov,.webm,.mkv" style={{ display:"none" }} onChange={e=>{addAttachments(e.target.files); e.target.value="";}}/>
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
            <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>{[["pending",t('agent.to_do')],["done",t('agent.done')],["needs",t('agent.needs_you')],["suggestions",t('agent.suggestions')]].map(([k,l])=><button key={k} onClick={()=>{ setTaskFilter(k); if(k==="needs") needsYou.reload(); }} style={{ padding:"5px 12px",borderRadius:20,border:`1.5px solid ${taskFilter===k?BRAND:"var(--ak-border2)"}`,background:taskFilter===k?`${BRAND}10`:"transparent",color:taskFilter===k?BRAND:"var(--ak-text-muted)",fontSize:11.5,fontWeight:700,cursor:"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",gap:5 }}>{k==="needs"&&<Icon name="ti-bell-ringing" size={12}/>}{l}{k==="needs"&&needsYou.count>0&&<span style={{ fontSize:9,fontWeight:900,background:taskFilter===k?BRAND:"var(--ak-border)",color:taskFilter===k?"#fff":"var(--ak-text-muted)",borderRadius:8,padding:"1px 5px" }}>{needsYou.count}</span>}{k==="suggestions"&&suggestionCount>0&&<span style={{ fontSize:9,fontWeight:900,background:taskFilter===k?BRAND:"var(--ak-border)",color:taskFilter===k?"#fff":"var(--ak-text-muted)",borderRadius:8,padding:"1px 5px" }}>{suggestionCount}</span>}</button>)}</div>
            {taskFilter!=="suggestions"&&taskFilter!=="needs"&&<button onClick={openNewTask} style={{ display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:20,border:"none",background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,color:"#fff",fontSize:11.5,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>
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
            {taskFilter==="needs"?(
              <NeedsYouList state={needsYou} onOpen={openNeed}/>
            ):taskFilter==="suggestions"?(
              suggestionCount===0?<div style={{ textAlign:"center",padding:"32px 16px",color:"var(--ak-text-muted)" }}><Icon name="ti-bulb" size={40} color="var(--ak-text-muted)" style={{opacity:.3}}/><p style={{ fontSize:13,fontWeight:700,marginTop:8,maxWidth:260,marginInline:"auto",lineHeight:1.5 }}>{t('agent.suggestions_empty')}</p></div>
              :(<>{inbox.map(it=>{
                const planner=it.source==="planner";
                const isIdea=it.source==="idea";
                const accent=planner?GOLD:BRAND;
                const kindKey=isIdea?"agent.ideas":(SUGG_KIND[it.kind]?.[0]||"agent.sugg_task");
                const kindIcon=isIdea?(IDEA_ICON[it.icon]||"ti-bulb"):(SUGG_KIND[it.kind]?.[1]||"ti-clipboard");
                return (
                <button key={it.ref} type="button" onClick={()=>openIdeaSheet("inbox",it)} style={{ display:"block",width:"100%",textAlign:"left",padding:"12px 14px",borderRadius:14,background:"var(--ak-surface)",border:"1px solid var(--ak-border)",marginBottom:8,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>
                  <span style={{ display:"flex",alignItems:"center",gap:6,marginBottom:6,flexWrap:"wrap" }}>
                    <span style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:9.5,fontWeight:900,padding:"2px 8px",borderRadius:20,background:`${accent}12`,border:`1px solid ${accent}35`,color:accent,letterSpacing:.3,textTransform:"uppercase" }}><Icon name={kindIcon} size={10}/>{t(kindKey)}</span>
                    {planner&&<span style={{ fontSize:10,color:"var(--ak-text-muted)",fontWeight:700 }}>{t('agent.proposals_from_review')}</span>}
                    <span style={{ fontSize:10,color:"var(--ak-text-muted)",fontWeight:600 }}>{relTime(it.createdAt)}</span>
                    <Icon name="ti-chevron-right" size={14} color="var(--ak-text-muted)" style={{ marginLeft:"auto" }}/>
                  </span>
                  <span style={{ display:"block",fontSize:13.5,fontWeight:700,color:"var(--ak-text)",lineHeight:1.45 }}>{it.title}</span>
                  {it.why&&<span style={{ display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",fontSize:12,color:"var(--ak-text-sub)",marginTop:3,lineHeight:1.5 }}>{it.why}</span>}
                  {isIdea&&it.context?.label&&<span style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:10.5,fontWeight:800,color:"var(--ak-text-muted)",background:"var(--ak-surface-hover)",borderRadius:20,padding:"2px 8px",marginTop:6 }}><Icon name={IDEA_FROM[it.context.kind]||"ti-sparkles"} size={10}/> {it.context.label}</span>}
                </button>
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
        <div className="ak-bottom-sheet" style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:2100,background:"var(--ak-surface)",borderRadius:"22px 22px 0 0",padding:"0 20px 52px",boxShadow:"0 -8px 40px rgba(0,0,0,.14)",animation:"sheet-up .3s cubic-bezier(.32,1.2,.64,1)",fontFamily:"'Nunito',sans-serif",maxHeight:"80vh",overflowY:"auto" }}>
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
      {ideaSheet&&(()=>{ const {item:it}=ideaSheet;
        const planner=it.source==="planner";
        const isIdea=it.source==="idea";
        const accent=planner?GOLD:BRAND;
        const kindKey=isIdea?"agent.ideas":(SUGG_KIND[it.kind]?.[0]||"agent.sugg_task");
        const kindIcon=isIdea?(IDEA_ICON[it.icon]||"ti-bulb"):(SUGG_KIND[it.kind]?.[1]||"ti-clipboard");
        const busy=inboxBusyRef===it.ref;
        const anyBusy=!!inboxBusyRef;
        const ctaLabel=isIdea?t('agent.ideas_do'):(it.yes||t(it.kind==="conversation"||it.kind==="follow_up_question"?'agent.sugg_start_chat':it.kind==="goal"||it.kind==="goal_nudge"?'agent.sugg_add_goal':planner?'agent.proposal_approve':'agent.suggestion_accept'));
        const lines=isIdea?[[t('agent.included_idea_chat'),t('agent.included_idea_chat_sub')],[t('agent.included_idea_expiry'),null]]:includedLines(it);
        const showReasons=askWhy===it.ref;
        return (
        <><div onClick={closeIdeaSheet} style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(6,6,18,.55)",backdropFilter:"blur(5px)" }}/>
        <div className="ak-bottom-sheet" style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:2100,background:"var(--ak-surface)",borderRadius:"22px 22px 0 0",padding:"0 20px 40px",boxShadow:"0 -8px 40px rgba(0,0,0,.14)",animation:"sheet-up .3s cubic-bezier(.32,1.2,.64,1)",fontFamily:"'Nunito',sans-serif",maxHeight:"84vh",overflowY:"auto" }}>
          <div style={{ width:38,height:4,borderRadius:2,background:"var(--ak-border3)",margin:"14px auto 16px" }}/>
          <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
            <><span style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:9.5,fontWeight:900,padding:"2px 8px",borderRadius:20,background:`${accent}12`,border:`1px solid ${accent}35`,color:accent,letterSpacing:.3,textTransform:"uppercase" }}><Icon name={kindIcon} size={10}/>{t(kindKey)}</span>{planner&&<span style={{ fontSize:10,color:"var(--ak-text-muted)",fontWeight:700 }}>{t('agent.proposals_from_review')}</span>}{isIdea&&it.context?.label&&<span style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:10.5,fontWeight:800,color:"var(--ak-text-muted)",background:"var(--ak-surface-hover)",borderRadius:20,padding:"2px 8px" }}><Icon name={IDEA_FROM[it.context.kind]||"ti-sparkles"} size={10}/> {it.context.label}</span>}<span style={{ fontSize:10,color:"var(--ak-text-muted)",fontWeight:600 }}>{relTime(it.createdAt)}</span></>
          </div>
          <p style={{ fontSize:17,fontWeight:900,color:"var(--ak-text)",margin:"10px 0 0",lineHeight:1.3 }}>{it.title}</p>
          {it.why&&<p style={{ fontSize:13,color:"var(--ak-text-sub)",margin:"7px 0 0",lineHeight:1.55 }}>{it.why}</p>}
          <p style={{ fontSize:13.5,fontWeight:900,color:"var(--ak-text)",margin:"18px 0 4px" }}>{t('agent.whats_included')}</p>
          {lines.map(([head,sub],i)=>(
            <div key={i} style={{ display:"flex",gap:9,padding:"5px 0",alignItems:"flex-start" }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0,marginTop:2 }}><polyline points="20 6 9 17 4 12"/></svg>
              <span style={{ fontSize:13,fontWeight:700,color:"var(--ak-text)",lineHeight:1.45 }}>{head}{sub&&<span style={{ display:"block",fontSize:11.5,color:"var(--ak-text-muted)",fontWeight:600,marginTop:1 }}>{sub}</span>}</span>
            </div>
          ))}
          {it.preview&&<div style={{ marginTop:8 }}><ProposalPreview preview={it.preview}/></div>}
          {showReasons?(
          <div style={{ marginTop:18 }}>
            <p style={{ fontSize:11.5,fontWeight:800,color:"var(--ak-text-sub)",margin:"0 0 7px" }}>{t('agent.dismiss_why')}</p>
            <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
              {dismissReasons.map(r=>(
                <button key={r} type="button" onClick={()=>{ closeIdeaSheet(); dismissIdea(it,r); }} disabled={anyBusy} style={{ padding:"6px 12px",borderRadius:20,border:"1px solid var(--ak-border2)",background:"var(--ak-surface-hover)",color:"var(--ak-text)",fontSize:11.5,fontWeight:700,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{t(`agent.dismiss_${r}`)}</button>
              ))}
              <button type="button" onClick={()=>{ closeIdeaSheet(); dismissIdea(it,"other"); }} disabled={anyBusy} style={{ padding:"6px 12px",borderRadius:20,border:"none",background:"none",color:"var(--ak-text-muted)",fontSize:11.5,fontWeight:700,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>{t('agent.dismiss_skip')}</button>
            </div>
          </div>
          ):(
          <>
          <div style={{ display:"flex",gap:10,marginTop:20 }}>
            <button type="button" onClick={()=>{ setAskWhy(it.ref); }} disabled={anyBusy} style={{ padding:"13px 20px",borderRadius:999,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface)",fontSize:13.5,fontWeight:800,color:"var(--ak-text)",cursor:anyBusy?"wait":"pointer",fontFamily:"'Nunito',sans-serif" }}>{t('agent.dismiss_btn')}</button>
            <button type="button" onClick={()=>{ closeIdeaSheet(); acceptIdea(it); }} disabled={anyBusy} style={{ flex:1,padding:"13px",borderRadius:999,border:"none",background:anyBusy?"var(--ak-border)":`linear-gradient(135deg,${BRAND},#4C1DCC)`,fontSize:13.5,fontWeight:800,color:"#fff",cursor:anyBusy?"wait":"pointer",fontFamily:"'Nunito',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:7 }}>
              {busy?<Spinner size={13} color="#fff"/>:<svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>}{ctaLabel}
            </button>
          </div>
          <div style={{ display:"flex",gap:10,marginTop:14,borderTop:"1px solid var(--ak-border)",paddingTop:14 }}>
            <button type="button" onClick={()=>setSheetLike(true)} style={{ flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:7,padding:"10px 0",borderRadius:999,border:`1.5px solid ${sheetLike?BRAND:"var(--ak-border2)"}`,background:sheetLike?`${BRAND}10`:"var(--ak-surface)",color:sheetLike?BRAND:"var(--ak-text-sub)",fontSize:12.5,fontWeight:800,cursor:"pointer",fontFamily:"'Nunito',sans-serif" }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12H4a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h3zm0 0 4.2-7.1c1.5 0 2.6 1.3 2.3 2.8L12.6 10H19a2 2 0 0 1 2 2.4l-1.2 7.6a2 2 0 0 1-2 1.6H7"/></svg>{t('agent.more_like_this')}
            </button>
            <button type="button" onClick={()=>{ closeIdeaSheet(); dismissIdea(it,"not_useful"); }} disabled={anyBusy} style={{ flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:7,padding:"10px 0",borderRadius:999,border:"1.5px solid var(--ak-border2)",background:"var(--ak-surface)",color:"var(--ak-text-sub)",fontSize:12.5,fontWeight:800,cursor:anyBusy?"wait":"pointer",fontFamily:"'Nunito',sans-serif" }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3zm0 0-4.2 7.1c-1.5 0-2.6-1.3-2.3-2.8l.9-4.3H5a2 2 0 0 1-2-2.4l1.2-7.6A2 2 0 0 1 6.2 2.4H17"/></svg>{t('agent.not_interested')}
            </button>
          </div>
          </>
          )}
        </div></>
        ); })()}
      <NoAgentSheet open={needsAgent} onClose={()=>setNeedsAgent(false)} defaultName={agentName||'My Agent'} onCreated={saveTask}/>
      {/* Chat sessions drawer (hamburger) */}
      {drawerOpen&&(
        <><div onClick={()=>setDrawerOpen(false)} style={{ position:"fixed",inset:0,zIndex:2000,background:"rgba(6,6,18,.55)",backdropFilter:"blur(5px)" }}/>
        <div style={{ position:"fixed",top:0,bottom:0,left:0,zIndex:2100,width:"min(86vw,320px)",background:"var(--ak-surface)",boxShadow:"6px 0 40px rgba(0,0,0,.18)",animation:"drawer-in .28s cubic-bezier(.32,1,.64,1)",fontFamily:"'Nunito',sans-serif",display:"flex",flexDirection:"column" }}>
          <style>{`@keyframes drawer-in{from{transform:translateX(-100%)}to{transform:translateX(0)}}.ak-sess-menu-item:hover{background:var(--ak-surface-hover)}`}</style>
          <div style={{ display:"flex",alignItems:"center",gap:12,padding:"16px 16px 13px",borderBottom:"1px solid var(--ak-border)",flexShrink:0 }}>
            <div style={{ width:46,height:46,borderRadius:"50%",background:`${BRAND}15`,border:`2px solid ${BRAND}`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",flexShrink:0 }}>
              <AgentAvatar emoji={agentEmoji} size={30}/><div style={{ position:"absolute",bottom:0,right:0,width:12,height:12,borderRadius:"50%",background:agentOnline?GREEN:"var(--ak-text-muted)",border:"2px solid #fff",animation:agentOnline?"pulse-dot 2s ease-in-out infinite":"none" }}/>
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
              historyError?.kind==="sessions"?(
                /* The list failed to load — NOT the same as having no chats. */
                <div style={{ textAlign:"center",padding:"28px 16px",color:GOLD }}>
                  <Icon name="ti-cloud-off" size={34} color={GOLD} style={{opacity:.5}}/>
                  <p style={{ fontSize:12.5,fontWeight:700,marginTop:8,lineHeight:1.5 }}>{t('agent.history_load_error')}</p>
                  <button onClick={retryHistoryLoad} style={{ marginTop:10,border:"none",background:`${GOLD}1A`,color:GOLD,cursor:"pointer",fontSize:11,fontWeight:900,padding:"6px 14px",borderRadius:8,fontFamily:"'Nunito',sans-serif" }}>{t('agent.history_retry')}</button>
                </div>
              ):(
                <div style={{ textAlign:"center",padding:"28px 16px",color:"var(--ak-text-muted)" }}><Icon name="ti-message-circle" size={34} color="var(--ak-text-muted)" style={{opacity:.3}}/><p style={{ fontSize:12.5,fontWeight:700,marginTop:8 }}>{t('agent.no_chats')}</p></div>
              )
            ):sessions.map((s)=>{
              const active=s.id===sessionId;
              // The options menu opens IN the list, under its row — never floated
              // above or below it, where the scrolling list clipped it (a short
              // list on a phone cut the menu off entirely).
              return (
                <div key={s.id} style={{ marginBottom:2 }}>
                <div onClick={()=>openSession(s.id)} style={{ display:"flex",alignItems:"center",gap:8,padding:"10px 10px",borderRadius:10,cursor:renamingId===s.id?"default":"pointer",background:active?`${BRAND}12`:"transparent",border:`1px solid ${active?`${BRAND}30`:"transparent"}` }}>
                  {renamingId===s.id?(
                    <div data-session-menu onClick={(e)=>e.stopPropagation()} style={{ display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0 }}>
                      <input autoFocus value={renameDraft} onChange={(e)=>setRenameDraft(e.target.value)}
                        onKeyDown={(e)=>{ if(e.key==="Enter") saveRename(s); else if(e.key==="Escape") setRenamingId(null); }}
                        maxLength={80} aria-label="Chat name"
                        style={{ flex:1,minWidth:0,fontSize:13,fontWeight:700,color:"var(--ak-text)",background:"var(--ak-surface-hover)",border:`1.5px solid ${BRAND}55`,borderRadius:8,padding:"6px 9px",outline:"none",fontFamily:"'Nunito',sans-serif" }}/>
                      <button type="button" onClick={()=>saveRename(s)} title="Save name" aria-label="Save name" style={{ background:"none",border:"none",cursor:"pointer",padding:4,display:"flex",flexShrink:0 }}><Icon name="ti-check" size={15} color={GREEN}/></button>
                      <button type="button" onClick={()=>setRenamingId(null)} title={t('common.cancel')||"Cancel"} aria-label={t('common.cancel')||"Cancel"} style={{ background:"none",border:"none",cursor:"pointer",padding:4,display:"flex",flexShrink:0 }}><Icon name="ti-x" size={15} color="var(--ak-text-muted)"/></button>
                    </div>
                  ):(
                    <>
                      <div style={{ flex:1,minWidth:0 }}>
                        <p style={{ fontSize:13,fontWeight:active?800:700,color:active?BRAND:"var(--ak-text)",margin:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{s.title||t('agent.new_chat')}</p>
                        <p style={{ fontSize:10.5,color:"var(--ak-text-muted)",margin:"2px 0 0" }}>{relTime(s.last_message_at)}</p>
                      </div>
                      <button data-session-menu onClick={(e)=>{ e.stopPropagation(); setMenuFor(menuFor===s.id?null:s.id); }} title="Chat options" aria-label="Chat options" aria-expanded={menuFor===s.id} style={{ background:"none",border:"none",cursor:"pointer",padding:5,display:"flex",flexShrink:0,opacity:.6 }}>
                        <Icon name="ti-dots-vertical" size={14} color="var(--ak-text-muted)"/>
                      </button>
                    </>
                  )}
                </div>
                  {menuFor===s.id&&renamingId!==s.id&&(
                    <div data-session-menu role="menu" aria-label="Chat options" onClick={(e)=>e.stopPropagation()} style={{ margin:"4px 4px 8px",background:"var(--ak-surface)",border:"1px solid var(--ak-border2)",borderRadius:12,boxShadow:"0 6px 18px rgba(15,23,42,.14)",padding:4,animation:"drawer-in .16s ease" }}>
                      {[
                        { key:"copy",   icon:copiedId===s.id?"ti-check":"ti-copy",  label:copiedId===s.id?"Copied":"Copy chat", color:copiedId===s.id?GREEN:"var(--ak-text)", run:()=>{ setMenuFor(null); copySession(s); } },
                        { key:"rename", icon:"ti-pencil", label:"Rename", color:"var(--ak-text)", run:()=>{ setMenuFor(null); setRenamingId(s.id); setRenameDraft(s.title||""); } },
                        { key:"delete", icon:"ti-trash",  label:"Delete", color:RED, run:(e)=>{ setMenuFor(null); removeSession(s.id,e); } },
                      ].map(it=>(
                        <button key={it.key} type="button" role="menuitem" className="ak-sess-menu-item" onClick={(e)=>it.run(e)} style={{ display:"flex",alignItems:"center",gap:9,width:"100%",padding:"11px 12px",borderRadius:8,border:"none",background:"none",cursor:"pointer",fontFamily:"'Nunito',sans-serif",textAlign:"left" }}>
                          <Icon name={it.icon} size={14} color={it.color}/>
                          <span style={{ fontSize:12.5,fontWeight:800,color:it.color }}>{it.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {sessionsTotal > 20 && (
              <div ref={sessionsSentinelRef} style={{ textAlign:"center",fontSize:11.5,fontWeight:700,color:"var(--ak-text-muted)",padding:"12px 0 4px" }}>
                {pagedStatusText({ shown: sessions.length, total: sessionsTotal, hasMore: sessionsTotal > sessions.length })}
              </div>
            )}
          </div>
          <div style={{ borderTop:"1px solid var(--ak-border)",padding:"10px 16px",flexShrink:0 }}>
            <button type="button" role="switch" aria-checked={devView} onClick={toggleDevView}
              style={{ display:"flex",alignItems:"center",gap:10,width:"100%",background:"none",border:"none",padding:"4px 0",cursor:"pointer",fontFamily:"'Nunito',sans-serif",textAlign:"left" }}>
              <Icon name="ti-code" size={15} color="var(--ak-text-muted)"/>
              <span style={{ flex:1,minWidth:0 }}>
                <span style={{ display:"block",fontSize:12.5,fontWeight:800,color:"var(--ak-text)" }}>{t('agent.dev_view')}</span>
                <span style={{ display:"block",fontSize:10.5,color:"var(--ak-text-muted)" }}>{t('agent.dev_view_hint')}</span>
              </span>
              <span aria-hidden style={{ width:32,height:18,borderRadius:9,background:devView?BRAND:"var(--ak-border2)",position:"relative",transition:"background .15s",flexShrink:0 }}>
                <span style={{ position:"absolute",top:2,left:devView?16:2,width:14,height:14,borderRadius:"50%",background:"#fff",transition:"left .15s" }}/>
              </span>
            </button>
          </div>
        </div></>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════ */

export default AgentChatTab;
