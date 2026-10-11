import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send, Plus, Brain, CheckSquare, X, Paperclip, Camera,
  Upload, FileText, ScanLine, Loader, CheckCircle2,
  History, Copy, Check, Lightbulb, MoreVertical, Pencil, Trash2, CloudOff,  Bot, Lock } from 'lucide-react';
import { PageLayout, useIsMobile } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Txa, Sel, FileUploadZone, Toast } from '../components/Primitives.jsx';
import TrainingProgress from '../components/TrainingProgress.jsx';
import LiveRecorder from '../components/LiveRecorder.jsx';
import { uploadTraining } from '../services/trainingApi.js';
import { useStatsAPI } from '../hooks/useStatsAPI.js';
import { useInstructorSocket } from '../hooks/useWebSocket.js';
import { apiGet, apiPost, apiDelete, API } from '../services/api.js';
import ActivityPreviewPanel from '../components/ActivityPreviewPanel.jsx';
import DraftCard from '../components/paper/DraftCard.jsx';
import { chatIdeas, STARTERS } from '../lib/chatIdeas.js';
import FortizoChatComposer from '../components/common/FortizoChatComposer.jsx';
import RichText from '../components/common/RichText.jsx';

/* Subtle per-message copy affordance: copies the exact text, flips to a
   check briefly. Clipboard API with an execCommand fallback for old
   webviews; a failure never throws into the chat. */
async function copyPlainText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch { return false; }
}

function CopyMsgButton({ text }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      title="Copy message"
      aria-label="Copy message"
      onClick={async () => {
        if (await copyPlainText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 18, padding: 0, border: 'none', background: 'transparent',
        cursor: 'pointer', color: MUTED2, opacity: .6, borderRadius: 5,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = .6; }}
    >
      {done ? <Check size={12} color={GREEN} /> : <Copy size={12} />}
    </button>
  );
}

import { useAuth } from '../contexts/AuthContext.jsx';
import {
  AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, PURPLE, BLUE, FONT,
} from '../constants.js';

const bdr = (w, c) => `${w}px solid ${c}`;

const CHAT_INIT = [
  { id: 1, from: 'agent', text: "Good morning! I'm ready to help — training, quizzes, reminders, or student reports. What do you need?", time: '8:01 AM' },
];

// Prompt chips (STARTERS, lib/chatIdeas.js): one tap fills the composer —
// the instructor completes the class, subject or audience before sending
// (the agent never guesses one). After that, each reply brings its own.

// Chat modes map to the unified agent endpoint's `mode` — the same trio the
// learner app offers. The label never reaches the API; the id does.
const CHAT_MODES = [
  { id: 'default', label: 'Standard', description: 'Balanced everyday support' },
  { id: 'think', label: 'Deep think', description: 'Slower, step-by-step reasoning' },
  { id: 'research', label: 'Research', description: 'Leans on syllabus and past questions' },
];

const REPLIES = [
  'Understood! Working on it now.',
  "Done! Here's what I've prepared...",
  'Great question. Based on my training, here\'s the best approach...',
  'Updated course materials. Anything else?',
  'Battle report updated — ranked #3 this week!',
];

const now = () => new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });

// Compact relative time for the sessions drawer ("now", "5m", "3h", "2d") —
// same wording as the learner app's drawer so both sides read the same.
const relTime = (iso) => {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)    return 'now';
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

// Quick commands — the learner chat's header chips: one tap sends the
// prompt straight to the agent; they never touch the composer.
const QUICK_COMMANDS = [
  'Draft a quiz for my class',
  'Prepare an assignment',
  'How did the last assignment go?',
  "Plan this week's revision",
  'Summarise my submissions',
];

export default function ChatPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { getProfile, updateAgent } = useStatsAPI();
  const { on, off } = useInstructorSocket(user?.id);

  const [messages, setMessages]   = useState(CHAT_INIT);
  const [input, setInput]         = useState('');
  const [isTask, setIsTask]       = useState(false);
  const [chatMode, setChatMode]   = useState('default');
  const [taskChips, setTaskChips] = useState([]);
  const [toast, setToast]         = useState(null);
  const [myTools, setMyTools]     = useState([]);   // unlocked Tools & Assets

  const [agentName, setAgentName]   = useState('Your Agent');
  const [agentEmoji, setAgentEmoji] = useState('🤖');
  const [agentLevel, setAgentLevel] = useState(1);
  const [agentId, setAgentId]       = useState(null);

  const [trainModal, setTrainModal]   = useState(false);
  const [taskModal, setTaskModal]     = useState(false);
  const [attachModal, setAttachModal] = useState(false);
  const [attachMenu, setAttachMenu]   = useState(false);

  const [trainType, setTrainType]   = useState('audio');
  const [trainSubj, setTrainSubj]   = useState('Mathematics');
  const [trainFile, setTrainFile]   = useState(null);
  const [trainRunId, setTrainRunId] = useState(null);
  const [uploadPct, setUploadPct]   = useState(0);
  const [trainingInChat, setTrainingInChat] = useState(false);

  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc]   = useState('');
  const [taskPri, setTaskPri]     = useState('high');

  const [attachType, setAttachType] = useState('file');
  const [ocrText, setOcrText]       = useState('');
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrError, setOcrError]     = useState('');
  const [attachFile, setAttachFile] = useState(null);

  const feedRef   = useRef(null);
  const attachRef = useRef(null);
  const inputRef  = useRef(null);

  // ── Durable conversations ────────────────────────────────────────────────
  // The instructor chat shares the learner session store: the server owns the
  // transcript, a refresh (or a return visit) resumes the last conversation,
  // and every agent turn carries conversationId + turnId so drafts prepared in
  // this chat are stamped with its session.
  const [chatSessions, setChatSessions] = useState([]);
  const [drawerOpen, setDrawerOpen]     = useState(false);
  // Drawer parity with the learner chat: loading ≠ error ≠ empty, and each
  // row carries its own options (copy / rename / delete) instead of a bare X.
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [historyError, setHistoryError]       = useState(false);
  const [copiedId, setCopiedId]               = useState(null);
  // One kebab per session opens a small menu IN the list, under its row —
  // never floated, where the scrolling list clipped it. renamingId = the
  // session whose title is an inline editor; deleteArmId = the two-tap
  // delete confirm (tap Delete → the item turns into "Tap again to delete").
  const [menuFor, setMenuFor]       = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteArmId, setDeleteArmId] = useState(null);
  const chatSessionRef     = useRef(null);
  const creatingSessionRef = useRef(null);
  const CHAT_BASE = '/api/adaptive/chat';
  const newTurnId = () => `turn_${(globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`)}`;

  const ensureChatSession = (firstText) => {
    if (chatSessionRef.current) return Promise.resolve(chatSessionRef.current);
    if (creatingSessionRef.current) return creatingSessionRef.current;
    creatingSessionRef.current = apiPost(`${CHAT_BASE}/sessions`, { title: firstText || '' })
      .then((d) => {
        const id = d?.session?.id ?? null;
        if (id) { chatSessionRef.current = id; setChatSessions((prev) => [d.session, ...prev]); }
        return id;
      })
      .catch((e) => {
        // A failed session create used to vanish — sends then went out with no
        // conversationId and NOTHING was ever persisted, so history always
        // looked like a brand-new chat. Surface it.
        console.warn('[chat] session create failed:', e?.message);
        return null;
      })
      .finally(() => { creatingSessionRef.current = null; });
    return creatingSessionRef.current;
  };

  const loadChatSessions = () => apiGet(`${CHAT_BASE}/sessions`)
    .then((d) => { const list = d?.sessions ?? []; setChatSessions(list); return list; })
    .catch(() => []);

  const openChatSession = async (id) => {
    setDrawerOpen(false);
    if (id === chatSessionRef.current) return;
    try {
      const d = await apiGet(`${CHAT_BASE}/sessions/${id}/messages`);
      // Cards ride the persisted message meta — a reload rebuilds the same
      // topic/draft previews the live reply rendered, not a flat transcript.
      const msgs = (d?.messages ?? []).map((m) => ({
        id: m.id,
        from: m.role === 'user' ? 'me' : 'agent',
        text: m.text,
        time: new Date(m.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
        ...(Array.isArray(m.meta?.previews) && m.meta.previews.length ? { previews: m.meta.previews } : {}),
        ...(Array.isArray(m.meta?.tools) && m.meta.tools.length ? { tools: m.meta.tools } : {}),
      }));
      chatSessionRef.current = id;
      setMessages(msgs.length ? msgs : CHAT_INIT);
    } catch (e) {
      // History failures were once silent — the instructor just saw a fresh
      // chat and had no way to know the load failed. Say it out loud.
      console.warn('[chat] open history failed:', e?.message);
      setToast({ type: 'error', message: 'Could not load that conversation — try again in a moment.' });
    }
  };

  const newChat = () => { setDrawerOpen(false); chatSessionRef.current = null; setMessages(CHAT_INIT); setInput(''); };

  const removeChatSession = async (id) => {
    setChatSessions((prev) => prev.filter((x) => x.id !== id));
    try { await apiDelete(`${CHAT_BASE}/sessions/${id}`); } catch { /* ignore */ }
    if (chatSessionRef.current === id) newChat();
  };

  // ── Drawer row options — the learner chat's exact machinery ────────────────
  const saveRename = async (s) => {
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!title || title === s.title) return;
    try {
      const d = await apiPatch(`${CHAT_BASE}/sessions/${s.id}`, { title });
      if (d?.session?.title) setChatSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, title: d.session.title } : x)));
    } catch { /* keep the old title — a failed rename is silent, like delete */ }
  };

  const copySession = async (s) => {
    try {
      const d = await apiGet(`${CHAT_BASE}/sessions/${s.id}/messages`);
      const msgs = d?.messages ?? [];
      if (!msgs.length) return;
      const stamp = (iso) => { try { return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
      const body = msgs.map((m) => `${m.role === 'user' ? 'You' : 'Agent'} (${stamp(m.created_at)}):\n${m.text ?? ''}`).join('\n\n');
      const out = `${s.title || 'Agent chat'}\n${msgs.length} message${msgs.length === 1 ? '' : 's'} · copied ${new Date().toLocaleString()}\n\n${body}`;
      if (!(await copyPlainText(out))) return;
      setCopiedId(s.id);
      setTimeout(() => setCopiedId((cur) => (cur === s.id ? null : cur)), 1400);
    } catch { /* leave the icon untouched — a failed copy never toasts */ }
  };

  // The options menu closes on any outside click; Escape also cancels an
  // in-progress rename or armed delete. (Order matters: declared after the
  // states above — the learner tab once crashed on exactly this TDZ.)
  useEffect(() => {
    if (!menuFor && !renamingId) return undefined;
    const close = (e) => { if (!e.target.closest?.('[data-session-menu]')) { setMenuFor(null); setDeleteArmId(null); } };
    const onKey = (e) => { if (e.key === 'Escape') { setMenuFor(null); setRenamingId(null); setDeleteArmId(null); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [menuFor, renamingId]);

  // An armed delete disarms itself — a stray tap can't leave a landmine.
  useEffect(() => {
    if (!deleteArmId) return undefined;
    const t = setTimeout(() => setDeleteArmId(null), 2500);
    return () => clearTimeout(t);
  }, [deleteArmId]);

  // On mount: load the session list and resume the most recent conversation
  // so a refresh (or tomorrow's visit) picks up exactly where things stopped.
  useEffect(() => {
    (async () => {
      const list = await loadChatSessions();
      if (list.length && !chatSessionRef.current) openChatSession(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load agent profile ──
  useEffect(() => {
    getProfile()
      .then((res) => {
        const agent = res?.data?.agent ?? res?.data?.user_agents?.[0] ?? res?.data;
        if (agent) {
          if (agent.id) setAgentId(agent.id);
          setAgentName(agent.agent_name ?? 'Your Agent');
          setAgentEmoji(agent.agent_emoji ?? '🤖');
          setAgentLevel(agent.level ?? agent.total_xp ? Math.floor((agent.total_xp ?? 0) / 500) + 1 : 1);
        }
      })
      .catch((e) => console.warn('[chat] profile load failed, using defaults:', e.message));
  }, []); // eslint-disable-line

  // ── Load unlocked Tools & Assets (shown as quick-prompt pills) ──
  const loadMyTools = useCallback(() => {
    apiGet('/api/instructor/tools')
      .then((res) => {
        const owned = [...(res.tools || []), ...(res.assets || [])].filter((i) => i.owned);
        setMyTools(owned);
      })
      .catch(() => {});
  }, []);
  useEffect(() => { loadMyTools(); }, [loadMyTools]);

  // ── WebSocket: agent task completion pushes a reply ──
  useEffect(() => {
    const handler = (evt) => {
      pushAgent(evt?.message ?? evt?.text ?? 'Task completed.');
    };
    on('task.completed', handler);
    return () => off('task.completed', handler);
  }, [on, off]);

  // ── WebSocket: a tool was unlocked → refresh pills + notify ──
  useEffect(() => {
    const handler = (evt) => {
      loadMyTools();
      if (evt?.toolName) setToast({ message: `${evt.toolName} unlocked`, type: 'success' });
    };
    on('tool_unlocked', handler);
    return () => off('tool_unlocked', handler);
  }, [on, off, loadMyTools]);

  // ── auto-scroll ──
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages, trainingInChat]);

  // ── close attach menu on outside click ──
  useEffect(() => {
    const h = (e) => { if (attachRef.current && !attachRef.current.contains(e.target)) setAttachMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const pushAgent = useCallback((text, extra = {}) => {
    const id = Date.now() + Math.random();
    setMessages((prev) => [...prev, { id, from: 'agent', text, time: now(), ...extra }]);
    return id;
  }, []);

  const pushMe = useCallback((text, task = false, chips = []) => {
    setMessages((prev) => [...prev, { id: Date.now() + Math.random(), from: 'me', text, time: now(), isTask: task, chips }]);
  }, []);

  const handleQuickPrompt = (p) => {
    if (taskChips.includes(p)) return;
    setTaskChips((prev) => [...prev, p]);
    setIsTask(true);
    inputRef.current && inputRef.current.focus();
  };

  const removeChip = (chip) => {
    setTaskChips((prev) => {
      const next = prev.filter((c) => c !== chip);
      if (next.length === 0 && !input.trim()) setIsTask(false);
      return next;
    });
  };

  // ── Send message — persists as a task when isTask ──
  const send = async () => {
    const hasChips = taskChips.length > 0;
    const hasText = input.trim().length > 0;
    if (!hasChips && !hasText) return;

    const chipText = hasChips ? taskChips.join(' · ') : null;
    const bodyText = [chipText, hasText ? input.trim() : null].filter(Boolean).join('\n');
    const chips = [...taskChips];
    const asTask = isTask;

    pushMe(bodyText, asTask, chips);
    setInput(''); setIsTask(false); setTaskChips([]);

    if (asTask) {
      try {
        await apiPost('/api/tasks', { title: bodyText, description: chipText ?? '', priority: 'medium' });
        pushAgent(`Got it! Task logged: "${chipText ?? bodyText.slice(0, 40)}". I'll get started right away.`);
      } catch (e) {
        console.warn('[chat] task create failed:', e.message);
        pushAgent(REPLIES[Math.floor(Math.random() * REPLIES.length)]);
      }
    } else {
      // Normal AI chat — the unified agent endpoint (sendText below).
      await sendText(bodyText);
    }
  };

  // ── The AI turn — the learner chat's exact contract ──────────────────────
  // A failed session create STOPS the send (a null conversationId used to
  // ride through and the exchange was silently never persisted); history is
  // the mapped conversation window (slice(-24), like the learners — the new
  // message rides in `message`, never duplicated into history); and the
  // turn key is created ONCE per send and REUSED on the quiet retry, so the
  // server's durable-turn contract repairs a partial write instead of
  // writing the exchange twice.
  // Stop = abort the in-flight stream (the learner composer's ■ affordance).
  const stopTurn = () => { abortRef.current?.abort(); };

  const sendText = async (bodyText) => {
    const history = messages
      .map((m) => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text }))
      .slice(-24);
    const sid = await ensureChatSession(bodyText);
    if (!sid) {
      pushAgent('I could not save this conversation — check your connection and try again.');
      return;
    }
    const turnId = newTurnId();
    setRunning(true);
    abortRef.current = new AbortController();
    const attemptTurn = async () => {
      try {
        return await sendStreaming({ message: bodyText, history, agentName, role: 'instructor', conversationId: sid, turnId, mode: chatMode }, setAiStatus, abortRef.current?.signal);
      } catch (streamErr) {
        console.warn('[chat] stream unavailable, using JSON reply:', streamErr.message);
        return await apiPost('/api/adaptive/chat/agent', { message: bodyText, history, agentName, role: 'instructor', conversationId: sid, turnId, mode: chatMode });
      } finally { setAiStatus(''); }
    };
    let data;
    try {
      data = await attemptTurn();
    } catch (e) {
      if (e?.name === 'AbortError') {
        // The instructor pressed Stop — user intent, never retried. The turn
        // key stays with the server: if the reply lands there anyway, history
        // restores it; this view just ends the turn honestly.
        setRunning(false); setAiStatus(''); abortRef.current = null;
        pushAgent('Stopped.');
        return;
      }
      // One quiet retry with the SAME turn key — the server repairs the
      // partial turn instead of duplicating it (learner parity).
      try {
        setAiStatus('Thinking…');
        await new Promise((r) => setTimeout(r, 1200));
        data = await attemptTurn();
      } catch {
        setRunning(false); setAiStatus(''); abortRef.current = null;
        console.warn('[chat] tutor reply failed:', e.message);
        pushAgent('Sorry — I had trouble responding just now. Please try again.');
        return;
      }
    }
    setRunning(false); abortRef.current = null;
      // Human-in-the-loop: a successful prepare/revise execution rides
      // with the reply as a draft echo — render its Preview affordance.
      const previews = (data.toolExecutions || [])
        .filter((x) => (x.tool === 'prepare_activity' && x.success || x.tool === 'revise_activity_draft' && x.success) && x.draft)
        .map((x) => x.draft);
      (data.toolExecutions || [])
        .filter((x) => x.tool === 'revise_activity_draft' && x.success && x.draft)
        .forEach((x) => {
          setDraftRevisions((prev) => ({ ...prev, [x.draft.id]: (prev[x.draft.id] || 0) + 1 }));
          if (x.draft.version) setPreviewVersion(null);   // an open preview jumps to the new version's tab
        });
      const replyText = data.reply || data.response || "I'm here to help with teaching and your subjects — what would you like to explore?";
      const tools = (data.toolExecutions || []).map((x) => x.tool);
      const replyId = pushAgent(replyText, { ...(previews.length ? { previews } : {}), tools });
      // Suggestions for every reply. A draft's come from its own questions
      // (see chatIdeas, under the message); any other reply asks the agent
      // for three follow-ups AFTER it has arrived — the reply never waits.
      if (!previews.length) {
        apiPost('/api/adaptive/chat/suggestions', { ask: bodyText, reply: replyText, role: 'instructor' })
          .then((r) => {
            const ideas = (r?.suggestions || []).map((t) => ({ label: t, fill: t }));
            if (ideas.length) setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, ideas } : m)));
          })
          .catch(() => { /* no chips this time */ });
      }
  };

  // ── Training — real backend pipeline (/api/adaptive/training) ──
  const startTraining = async () => {
    if (!trainFile) {
      setToast({
        message: trainType === 'live'
          ? 'Record a lesson first, then start training.'
          : 'Choose an audio or video file to train on first.',
        type: 'info',
      });
      return;
    }
    if (!user?.id || !agentId) {
      setToast({ message: 'Set up your agent in Profile → Agent before training.', type: 'error' });
      return;
    }

    const file = trainFile;
    setTrainModal(false);
    setTrainingInChat(true);
    setTrainRunId(null);
    setUploadPct(0);
    pushMe(`Start training on ${trainSubj} — ${file.name}`);

    try {
      const { runId } = await uploadTraining({
        file, teacherId: user.id, agentId, subject: trainSubj,
        sessionTitle: file.name,
        onProgress: setUploadPct,
      });
      if (!runId) throw new Error('No run id returned');
      setTrainRunId(runId); // TrainingProgress takes over via polling
    } catch (e) {
      console.warn('[chat] training upload failed:', e.message);
      setTrainingInChat(false);
      setTrainFile(null);
      pushAgent(`Training couldn't start: ${e.message}. Please try again.`);
    }
  };

  const handleTrainingComplete = (summary) => {
    setTrainingInChat(false);
    setTrainRunId(null);
    setTrainFile(null);
    if (!summary) { pushAgent(`Training complete! ${agentName} has absorbed your material.`); return; }

    const seg = summary.segmentBreakdown || {};
    const segLines = Object.entries(seg).map(([k, v]) => `• ${v} ${k.replace(/_/g, ' ')}`).join('\n');
    pushAgent(
      `Training complete!\n\n${agentName} learned from ${summary.fileOriginal || 'your recording'} on ${summary.subject || trainSubj}.\n\n` +
      `• ${summary.chunksStored ?? 0} knowledge chunks embedded\n` +
      (segLines ? segLines + '\n' : '') +
      `• Teaching style: ${summary.styleProfile?.pattern || 'captured'} · ${summary.styleProfile?.tone || ''}\n` +
      (summary.orchestration?.flowType ? `• Unique ${summary.orchestration.flowType} flow with ${summary.orchestration.phaseCount} phases\n` : '') +
      `\n+${summary.xpEarned ?? 0} XP earned. Ready to support your students!`
    );
  };

  const handleTrainingError = () => {
    setTrainingInChat(false);
    setTrainRunId(null);
    setTrainFile(null);
    pushAgent('Training run failed during processing. Please check the file and try again.');
  };

  // ── Attachment / OCR ──
  // The image is uploaded by FileUploadZone; on completion we extract text via
  // the backend (Claude Vision) and poll for the result.
  const handleOcrUploaded = async ({ id }) => {
    setOcrRunning(true);
    setOcrError('');
    try {
      const { pollOcr } = await import('../services/uploadApi.js');
      const text = await pollOcr(id);
      setOcrText(text);
    } catch (e) {
      setOcrError(e.message || 'Could not extract text');
    } finally {
      setOcrRunning(false);
    }
  };

  const handleAttachUploaded = ({ fileUrl, fileName }) => {
    setAttachFile({ fileUrl, fileName });
  };

  const sendAttachment = () => {
    if (attachType === 'ocr' && ocrText) {
      pushMe('Scanned image · OCR result:\n\n' + ocrText);
    } else if (attachFile) {
      pushMe(`Attachment sent · ${attachFile.fileName}`);
    } else {
      pushMe('Attachment sent');
    }
    setAttachModal(false); setOcrText(''); setOcrRunning(false); setOcrError(''); setAttachFile(null);
    setTimeout(() => pushAgent("Got it! I've received your attachment and I'm processing it now."), 700);
  };

  // ── Human-in-the-loop preview — side-by-side with the chat ──────────────
  const [previewDraft, setPreviewDraft] = useState(null);   // draft id or null
  const [previewVersion, setPreviewVersion] = useState(null);   // the assignment version the card opened
  const [previewType, setPreviewType] = useState(null);
  const [aiStatus, setAiStatus] = useState('');
  const [running, setRunning] = useState(false);   // a turn is in flight — the composer's send becomes a stop
  const abortRef = useRef(null);                 // aborts the in-flight stream (user Stop)             // live tool status ("Resolving your class…")
  const [draftStates, setDraftStates] = useState({});       // { [id]: 'assigned'|'discarded' }
  const [draftsById, setDraftsById] = useState({});         // the draft each card loaded — its ideas read it
  const [draftRevisions, setDraftRevisions] = useState({}); // { [id]: bump count }
  // Resolutions are pushed as chat messages: the instructor sees the outcome,
  // and because replies ride the history, the agent knows it too next turn —
  // it can then confirm to the instructor that the work was assigned (the
  // LEARNERS are notified by the platform itself at assign time, not by the agent).
  const resolveDraft = (id, state) => {
    setDraftStates((prev) => ({ ...prev, [id]: state }));
    pushAgent(state === 'assigned'
      ? 'Assigned — the learners on this draft have been notified and it is on their Activities feed.'
      : 'Draft discarded — nothing was sent to anyone.');
  };

  // Streaming status: the agent endpoint speaks SSE (status events while the
  // tool loop runs — drafting plans, resolving classes). Falls back to the
  // plain JSON reply if the stream never starts; the reply handling after is
  // identical for both.
  const sendStreaming = async (payload, onStatus, signal) => {
    const res = await fetch(`${API}/api/adaptive/chat/agent?stream=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal,
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error('Streaming is not available');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', finalData = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
        const isDone = block.split('\n').some((l) => l.startsWith('event: done'));
        if (!dataLine) continue;
        try {
          const evt = JSON.parse(dataLine.slice(6));
          if (isDone) finalData = evt;
          else onStatus(evt.label || '');
        } catch { /* keep-alive or partial frame */ }
      }
    }
    if (!finalData) throw new Error('The stream ended without a reply');
    return finalData;
  };

  const isMobile = useIsMobile();
  const hasInput = taskChips.length > 0 || input.trim().length > 0;

  return (
    <PageLayout title="Agent Chat" subtitle={`${agentName} · Lv ${agentLevel}`} hideTopBarOnMobile>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <style>{`
        .ci-task-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px 3px 9px;border-radius:20px;background:linear-gradient(135deg,rgba(232,136,74,.18),rgba(240,160,75,.14));border:1.5px solid rgba(232,136,74,.5);color:${AMBER};font-size:11px;font-weight:700;white-space:nowrap;flex-shrink:0}
        .ci-task-chip button{display:flex;align-items:center;background:none;border:none;cursor:pointer;padding:0;color:${AMBER};opacity:.7;line-height:1}
        .ci-qp{flex-shrink:0;padding:5px 11px;border-radius:20px;border:1.5px solid ${BORDER};background:#fff;color:${MUTED};font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:${FONT};transition:all .15s;display:inline-flex;align-items:center;gap:4px}
        .ci-qp:hover{border-color:${AMBER};color:${AMBER}}
        .ci-qp.active{border-color:${AMBER};color:${AMBER};background:rgba(232,136,74,.12)}
        .ci-qp.ci-tool{border-color:rgba(16,185,129,.4);color:${GREEN};background:rgba(16,185,129,.08)}
        .ci-qp.ci-tool.active{border-color:${GREEN};background:rgba(16,185,129,.16)}
        .ci-quickbar{display:flex;gap:6px;overflow-x:auto;padding-bottom:10px;scrollbar-width:none}
        .ci-quickbar::-webkit-scrollbar{display:none}
        .ci-attach-menu{position:absolute;bottom:48px;left:0;background:#fff;border-radius:16px;border:1px solid ${BORDER};box-shadow:0 8px 32px rgba(0,0,0,.12);padding:8px;min-width:210px;z-index:50}
        .ci-attach-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;cursor:pointer;border:none;background:transparent;width:100%;font-family:${FONT};text-align:left}
        .ci-attach-item:hover{background:${LIGHT}}
        .ci-typing{display:inline-block;width:6px;height:6px;border-radius:50%;background:${MUTED2};margin:0 2px;animation:ciTyping 1.4s infinite ease-in-out}
        @keyframes ciTyping{0%,80%,100%{transform:scale(0);opacity:0}40%{transform:scale(1);opacity:1}}
        /* Fortizo split (matches the learner's reader + session view): the
           preview docks BESIDE the chat from 768px up — a laptop at 125%
           zoom is still a two-pane screen, never a modal. Only phones and
           small tablets (the learner's useIsMobileView threshold) take
           over the full screen. */
        @media (max-width: 767px){
          .ci-preview-panel{position:fixed;inset:0;width:100%!important;z-index:400;background:#F7F5F1;padding:12px}
        }
      `}</style>

      <div style={{ maxWidth: previewDraft ? 'min(1180px, 97vw)' : 720, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', height: isMobile ? 'calc(100vh - 86px)' : 'calc(100vh - 150px)' }}>
        <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 0 }}>
        <div className="ci-chat-col" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* The learner chat's header row: the hamburger opens the sessions
            drawer (the list reloads on every open — never stale) and the
            quick-command chips scroll. Agent identity lives in the drawer;
            the conversation gets the room. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 14px 8px', overflowX: 'auto', scrollbarWidth: 'none', borderBottom: `1px solid ${BORDER}`, flexShrink: 0, background: WHITE }}>
          <button onClick={() => { loadChatSessions(); setDrawerOpen(true); }} title="Chats" aria-label="Chats"
            style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 9, border: `1px solid ${BORDER}`, background: LIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <div style={{ width: 1, height: 18, background: BORDER, flexShrink: 0 }} />
          {QUICK_COMMANDS.map((p) => (
            <button key={p} onClick={() => sendText(p)}
              style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 20, border: `1px solid ${AMBER}30`, background: `${AMBER}08`, color: AMBER, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' }}>{p}</button>
          ))}
        </div>

        {/* Tool commands — only the instructor's UNLOCKED Tools & Assets show
            here. A new agent has none until items are purchased. */}
        <div className="ci-quickbar">
          {myTools.length > 0 ? (
            myTools.map((t) => {
              const active = taskChips.includes(t.name);
              return (
                <button key={t.id} className={'ci-qp ci-tool' + (active ? ' active' : '')} onClick={() => (active ? removeChip(t.name) : handleQuickPrompt(t.name))} title={t.description}>
                  <span style={{ fontSize: 10, fontWeight: 900, color: MUTED }}>{(t.name || 'T').charAt(0).toUpperCase()}</span>{t.name}{active && <X size={9} />}
                </button>
              );
            })
          ) : (
            <button className="ci-qp" onClick={() => navigate('/marketplace')} title="Unlock tools & assets for your agent">
              <Lock size={11} style={{ verticalAlign: '-2px', marginRight: 3 }} />Unlock tools
            </button>
          )}
        </div>

        {/* Message feed */}
        <div ref={feedRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 2px' }}>
          {messages.map((msg, mi) => {
            const isMe = msg.from === 'me';
            const isLatestReply = !isMe && mi === messages.length - 1 && mi > 0;
            const chips = msg.chips || [];
            const textPart = chips.length ? msg.text.replace(chips.join(' · '), '').replace(/^\n/, '').trim() : msg.text;
            return (
              <div key={msg.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8 }}>
                {!isMe && <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#FEF0E6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}><Bot size={15} color={AMBER} /></div>}
                <div style={{ maxWidth: '80%' }}>
                  {isMe && msg.isTask && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 20, background: 'rgba(232,136,74,.12)', border: '1.5px solid rgba(232,136,74,.35)', color: AMBER, fontSize: 11, fontWeight: 700 }}><CheckSquare size={10} />Task assigned</span>
                    </div>
                  )}
                  <div style={{
                    padding: '10px 13px',
                    borderRadius: isMe ? '17px 17px 4px 17px' : '17px 17px 17px 4px',
                    background: isMe ? (msg.isTask ? 'linear-gradient(135deg,#E8884A,#F0A04B)' : INK) : '#F0ECE6',
                    color: isMe ? WHITE : INK, fontSize: 13, lineHeight: 1.55,
                  }}>
                    {chips.length > 0 && (
                      <div style={{ marginBottom: textPart ? 6 : 0, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {chips.map((c) => (
                          <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 20, background: 'rgba(255,255,255,.25)', border: '1px solid rgba(255,255,255,.4)', fontSize: 10.5, fontWeight: 700, color: '#fff' }}><CheckSquare size={9} />{c}</span>
                        ))}
                      </div>
                    )}
                    {textPart && (isMe
                      ? <span style={{ whiteSpace: 'pre-wrap' }}>{textPart}</span>
                      : <RichText text={textPart} color={INK} />)}
                  </div>
                  {!isMe && (msg.previews || []).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      {msg.previews.map((d, pi) => (
                        <DraftCard key={`${d.id}-${d.version || 0}`} preview={d} state={draftStates[d.id]}
                          onDraft={(dr) => setDraftsById((prev) => (prev[dr.id] === dr ? prev : { ...prev, [dr.id]: dr }))}
                          label={msg.previews.length > 1 ? `Preview ${pi + 1}` : 'Preview'}
                          onOpen={(id, version) => { setPreviewDraft(id); setPreviewVersion(version); setPreviewType(d.type); }} />
                      ))}
                    </div>
                  )}
                  {/* Suggestions — under the newest reply only; a tap fills the message box. */}
                  {isLatestReply && (() => {
                    const last = (msg.previews || []).at(-1);
                    const ideas = last
                      ? chatIdeas({ latest: { draft: draftsById[last.id], version: last.version, state: draftStates[last.id] }, tools: msg.tools || [] })
                      : msg.ideas?.length ? msg.ideas
                        : (msg.tools || []).includes('check_activity_outcomes') ? chatIdeas({ tools: msg.tools }) : [];
                    if (!ideas.length) return null;
                    return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }} aria-label="Suggestions">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, color: MUTED2, fontFamily: FONT }}><Lightbulb size={11} /> {last ? 'Ideas' : 'Try next'}</span>
                        {ideas.map((it) => (
                          <button key={it.label} type="button" className="ci-qp" onClick={() => { setInput(it.fill); inputRef.current?.focus(); }}
                            title="Tap to put it in the message box — change it if you like, then send">
                            {it.label}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                  <div style={{ fontSize: 10, color: MUTED2, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                    {msg.time}
                    <CopyMsgButton text={textPart} />
                  </div>
                </div>
              </div>
            );
          })}

          {trainingInChat && !trainRunId && (
            <div style={{ background: INK, borderRadius: 20, padding: 24, color: WHITE, fontFamily: FONT }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Uploading recording…</div>
              <div style={{ height: 6, background: 'rgba(255,255,255,.1)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${uploadPct}%`, borderRadius: 3, background: `linear-gradient(90deg, ${AMBER}, ${PURPLE})`, transition: 'width .2s' }} />
              </div>
              <div style={{ textAlign: 'right', fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 6 }}>{uploadPct}%</div>
            </div>
          )}
          {trainingInChat && trainRunId && (
            <TrainingProgress
              runId={trainRunId}
              agentName={agentName}
              onComplete={handleTrainingComplete}
              onError={handleTrainingError}
            />
          )}

          {!trainingInChat && messages[messages.length - 1]?.from === 'me' && !messages[messages.length - 1]?.isTask && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#FEF0E6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}><Bot size={15} color={AMBER} /></div>
              <div style={{ padding: '10px 15px', borderRadius: '17px 17px 17px 4px', background: '#F0ECE6', display: 'flex', gap: 2 }}>
                <span className="ci-typing" /><span className="ci-typing" style={{ animationDelay: '.2s' }} /><span className="ci-typing" style={{ animationDelay: '.4s' }} />
              </div>
            </div>
          )}
          {!trainingInChat && aiStatus && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '-4px 0 0 36px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: AMBER, display: 'inline-block', animation: 'ciTyping 1.4s infinite ease-in-out' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, fontFamily: FONT }}>{aiStatus}</span>
            </div>
          )}
        </div>

        {/* Input bar */}
        <div style={{ paddingTop: 10 }}>
          {!isTask && input === '' && !messages.some((m) => m.from === 'me') && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8 }}>
              {STARTERS.map((chip) => (
                <button key={chip.label} className="ci-qp" onClick={() => { setInput(chip.fill); inputRef.current?.focus(); }}
                  title="Tap to fill the composer — complete the details before sending">
                  {chip.label}
                </button>
              ))}
            </div>
          )}
          {isTask && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderRadius: 10, background: 'rgba(232,136,74,.1)', border: bdr(1, 'rgba(232,136,74,.3)'), marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><CheckSquare size={12} color={AMBER} /><span style={{ fontSize: 11.5, fontWeight: 700, color: AMBER }}>Sending as task</span></div>
              <button onClick={() => { setIsTask(false); setTaskChips([]); }} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: MUTED, fontFamily: FONT, fontWeight: 600 }}><X size={11} />Clear</button>
            </div>
          )}

          {/* Tool chips (unlocked agent tools) render above the composer. */}
          {taskChips.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingBottom: 8 }}>
              {taskChips.map((chip) => (
                <span key={chip} className="ci-task-chip"><CheckSquare size={9} />{chip}<button onClick={() => removeChip(chip)} tabIndex={-1}><X size={9} /></button></span>
              ))}
            </div>
          )}

          <div style={{ position: 'relative' }}>
            <FortizoChatComposer
              value={input}
              onChange={setInput}
              onSend={send}
              inputRef={inputRef}
              placeholder={taskChips.length > 0 ? 'Add a note… (optional)' : `Ask ${agentName} anything…`}
              disabled={running}
              running={running}
              onStop={stopTurn}
              stopLabel="Stop"
              sendDisabled={!hasInput}
              taskAction={() => setIsTask((p) => !p)}
              taskActive={isTask}
              taskLabel="Mark as task"
              attachmentAction={() => setAttachMenu((p) => !p)}
              attachmentLabel="Attach — photo OCR, file, or document"
              voiceLabel="Voice input is not available in the instructor console yet"
              audioLabel="Audio notes are not available in the instructor console yet"
              modelId={chatMode}
              modelLabel={CHAT_MODES.find((o) => o.id === chatMode)?.label || 'Standard'}
              modelOptions={CHAT_MODES}
              onModelChange={setChatMode}
              modelLabelDescription="Choose a supported chat mode"
            />
            {attachMenu && (
              <div className="ci-attach-menu">
                  {[
                    { icon: <Camera size={15} color={GREEN} />, label: 'Photo / Image OCR', desc: 'Scan & extract text', act: () => { setAttachType('ocr'); setAttachModal(true); setAttachMenu(false); } },
                    { icon: <Upload size={15} color={PURPLE} />, label: 'Upload file', desc: 'PDF, Word, Excel…', act: () => { setAttachType('file'); setAttachModal(true); setAttachMenu(false); } },
                    { icon: <FileText size={15} color={BLUE} />, label: 'Upload document', desc: 'Lesson notes, worksheets', act: () => { setAttachType('doc'); setAttachModal(true); setAttachMenu(false); } },
                  ].map((item) => (
                    <button key={item.label} className="ci-attach-item" onClick={item.act}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: LIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{item.icon}</div>
                      <div><div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{item.label}</div><div style={{ fontSize: 11, color: MUTED }}>{item.desc}</div></div>
                    </button>
                  ))}
                  <div style={{ height: 1, background: BORDER, margin: '4px 0' }} />
                  <button className="ci-attach-item" onClick={() => { setTaskModal(true); setAttachMenu(false); }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(232,136,74,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><CheckSquare size={15} color={AMBER} /></div>
                    <div><div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>Assign task</div><div style={{ fontSize: 11, color: MUTED }}>Create a structured task</div></div>
                  </button>
                </div>
              )}
            </div>
        </div>
        </div>

        {previewDraft && (
          <div className="ci-preview-panel" style={{ width: previewType === 'assignment' ? 600 : 430, maxWidth: previewType === 'assignment' ? '58vw' : '46vw', flexShrink: 0, minHeight: 0 }}>
            <ActivityPreviewPanel
              draftId={previewDraft}
              initialVersion={previewVersion}
              revision={draftRevisions[previewDraft] || 0}
              onClose={() => setPreviewDraft(null)}
              onResolved={resolveDraft}
            />
          </div>
        )}
        </div>
      </div>

      {/* Task modal */}
      {/* Sessions drawer — the learner chat's drawer, instructor-dressed:
          full-height panel with backdrop, agent header, New chat, Train agent,
          and a session list where loading ≠ error ≠ empty and every row has
          copy / rename / delete under its own kebab. */}
      {drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(23,23,23,.5)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 2100, width: 'min(86vw, 320px)', background: WHITE, boxShadow: '6px 0 40px rgba(23,23,23,.2)', animation: 'ci-drawer-in .28s cubic-bezier(.32,1,.64,1)', fontFamily: FONT, display: 'flex', flexDirection: 'column' }}>
            <style>{`@keyframes ci-drawer-in{from{transform:translateX(-100%)}to{transform:translateX(0)}}.ci-sess-item:hover{background:${LIGHT}}`}</style>
            {/* Agent header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 13px', borderBottom: bdr(1, BORDER), flexShrink: 0 }}>
              <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#FEF0E6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 23, boxShadow: `0 0 0 2px #fff, 0 0 0 3.5px ${AMBER}`, flexShrink: 0 }}><Bot size={23} color={AMBER} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14.5, fontWeight: 900, color: INK, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agentName}</p>
                <div style={{ fontSize: 11, color: trainingInChat ? AMBER : GREEN, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: trainingInChat ? AMBER : GREEN, display: 'inline-block', animation: trainingInChat ? 'pulse-dot 1.4s ease-in-out infinite' : 'none' }} />
                  {trainingInChat ? 'Training in progress…' : `Online · Lv ${agentLevel}`}
                </div>
              </div>
              <button onClick={() => setDrawerOpen(false)} title="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}><X size={17} color={MUTED2} /></button>
            </div>
            {/* New chat + Train agent */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', flexShrink: 0 }}>
              <button onClick={newChat} style={{ width: '100%', padding: 11, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#E8884A,#F0A04B)', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <Plus size={14} strokeWidth={2.6} /> New chat
              </button>
              <button onClick={() => { setTrainModal(true); }} disabled={trainingInChat} title={trainingInChat ? 'Training already in progress' : 'Train your agent on a lesson recording or document'}
                style={{ width: '100%', padding: 11, borderRadius: 12, border: bdr(1.5, trainingInChat ? BORDER : `${AMBER}66`), background: trainingInChat ? LIGHT : 'rgba(232,136,74,.07)', color: trainingInChat ? MUTED2 : AMBER, fontSize: 13, fontWeight: 800, cursor: trainingInChat ? 'wait' : 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <Brain size={14} /> {trainingInChat ? 'Training in progress…' : 'Train agent'}
              </button>
            </div>
            {/* Sessions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 6px', flexShrink: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 900, letterSpacing: .5, textTransform: 'uppercase', color: MUTED2, margin: 0 }}>Chats</p>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 16px' }}>
              {sessionsLoading && chatSessions.length === 0 ? (
                <p style={{ textAlign: 'center', fontSize: 12, color: MUTED2, padding: '20px 0' }}>Loading…</p>
              ) : chatSessions.length === 0 ? (
                historyError ? (
                  <div style={{ textAlign: 'center', padding: '28px 16px', color: AMBER }}>
                    <CloudOff size={34} style={{ opacity: .5 }} />
                    <p style={{ fontSize: 12.5, fontWeight: 700, marginTop: 8, lineHeight: 1.5 }}>Couldn&apos;t load your chat history — check your connection. Your chats are safe.</p>
                    <button onClick={retryHistoryLoad} style={{ marginTop: 10, border: 'none', background: 'rgba(232,136,74,.1)', color: AMBER, cursor: 'pointer', fontSize: 11, fontWeight: 900, padding: '6px 14px', borderRadius: 8, fontFamily: FONT }}>Try again</button>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '28px 16px', color: MUTED2 }}>
                    <History size={34} style={{ opacity: .3 }} />
                    <p style={{ fontSize: 12.5, fontWeight: 700, marginTop: 8 }}>No chats yet. Conversations with your agent will appear here.</p>
                  </div>
                )
              ) : chatSessions.map((s) => {
                const active = s.id === chatSessionRef.current;
                return (
                  <div key={s.id} style={{ marginBottom: 2 }}>
                    <div onClick={() => openChatSession(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', borderRadius: 10, cursor: renamingId === s.id ? 'default' : 'pointer', background: active ? 'rgba(232,136,74,.12)' : 'transparent', border: bdr(1, active ? `${AMBER}30` : 'transparent') }}>
                      {renamingId === s.id ? (
                        <div data-session-menu onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                          <input autoFocus value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveRename(s); else if (e.key === 'Escape') setRenamingId(null); }}
                            maxLength={80} aria-label="Chat name"
                            style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: INK, background: LIGHT, border: bdr(1.5, `${AMBER}55`), borderRadius: 8, padding: '6px 9px', outline: 'none', fontFamily: FONT }} />
                          <button type="button" onClick={() => saveRename(s)} title="Save name" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', flexShrink: 0 }}><Check size={15} color={GREEN} /></button>
                          <button type="button" onClick={() => setRenamingId(null)} title="Cancel" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', flexShrink: 0 }}><X size={15} color={MUTED2} /></button>
                        </div>
                      ) : (
                        <>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 13, fontWeight: active ? 800 : 700, color: active ? AMBER : INK, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title || 'New chat'}</p>
                            <p style={{ fontSize: 10.5, color: MUTED2, margin: '2px 0 0' }}>{relTime(s.last_message_at)}</p>
                          </div>
                          <button data-session-menu onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === s.id ? null : s.id); setDeleteArmId(null); }} title="Chat options" aria-expanded={menuFor === s.id}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, display: 'flex', flexShrink: 0, opacity: .6 }}>
                            <MoreVertical size={14} color={MUTED2} />
                          </button>
                        </>
                      )}
                    </div>
                    {menuFor === s.id && renamingId !== s.id && (
                      <div data-session-menu role="menu" aria-label="Chat options" onClick={(e) => e.stopPropagation()} style={{ margin: '4px 4px 8px', background: WHITE, border: bdr(1, BORDER), borderRadius: 12, boxShadow: '0 6px 18px rgba(23,23,23,.14)', padding: 4, animation: 'ci-drawer-in .16s ease' }}>
                        {[
                          { key: 'copy',   icon: copiedId === s.id ? Check : Copy,   label: copiedId === s.id ? 'Copied' : 'Copy chat', color: copiedId === s.id ? GREEN : INK, run: () => { setMenuFor(null); copySession(s); } },
                          { key: 'rename', icon: Pencil, label: 'Rename', color: INK, run: () => { setMenuFor(null); setRenamingId(s.id); setRenameDraft(s.title || ''); } },
                          deleteArmId === s.id
                            ? { key: 'delete', icon: Trash2, label: 'Tap again to delete', color: RED, run: () => { setMenuFor(null); setDeleteArmId(null); removeChatSession(s.id); } }
                            : { key: 'delete', icon: Trash2, label: 'Delete', color: RED, run: () => setDeleteArmId(s.id) },
                        ].map((it) => (
                          <button key={it.key} type="button" role="menuitem" className="ci-sess-item" onClick={it.run}
                            style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '11px 12px', borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT, textAlign: 'left' }}>
                            <it.icon size={14} color={it.color} />
                            <span style={{ fontSize: 12.5, fontWeight: 800, color: it.color }}>{it.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <Modal open={taskModal} onClose={() => setTaskModal(false)} title="Create Task for Agent">
        <Inp label="Task title" placeholder="e.g. Generate quiz for Module 3" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
        <FileUploadZone label="Attach files (optional)" accept=".pdf,.doc,.docx,.pptx,.jpg,.png" />
        <Txa label="Description" placeholder="Describe what you want the agent to do…" value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} rows={3} />
        <Sel label="Priority" value={taskPri} onChange={(e) => setTaskPri(e.target.value)}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Sel>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="secondary" style={{ flex: 1 }} onClick={() => setTaskModal(false)}>Cancel</Btn>
          <Btn variant="primary" style={{ flex: 1 }} onClick={async () => {
            if (!taskTitle.trim()) return;
            pushMe('Task: ' + taskTitle + (taskDesc ? '\n' + taskDesc : ''), true);
            const title = taskTitle, desc = taskDesc, pri = taskPri;
            setTaskModal(false); setTaskTitle(''); setTaskDesc('');
            try {
              await apiPost('/api/tasks', { title, description: desc, priority: pri });
              pushAgent(`Got it! Task logged: "${title}". I'll get started right away.`);
            } catch (e) {
              console.warn('[chat] task create failed:', e.message);
              pushAgent(`Task "${title}" noted.`);
            }
          }}><Send size={14} />Assign task</Btn>
        </div>
      </Modal>

      {/* Attach modal */}
      <Modal open={attachModal} onClose={() => { setAttachModal(false); setOcrText(''); setOcrRunning(false); setOcrError(''); setAttachFile(null); }} title={attachType === 'ocr' ? 'Photo / Image OCR' : attachType === 'doc' ? 'Upload Document' : 'Upload File'}>
        {attachType === 'ocr' ? (
          <div>
            <FileUploadZone label="Upload an image to scan" accept="image/*" onUploaded={handleOcrUploaded} />
            {ocrRunning && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0', fontSize: 13, color: MUTED }}>
                <Loader size={13} className="spinner" /> Extracting text…
              </div>
            )}
            {ocrError && <p style={{ fontSize: 12, color: RED, margin: '12px 0', fontWeight: 600 }}>{ocrError}</p>}
            {ocrText && (
              <>
                <Txa label="Extracted text — edit if needed" value={ocrText} onChange={(e) => setOcrText(e.target.value)} rows={5} />
                <Btn variant="primary" style={{ width: '100%' }} onClick={sendAttachment}><Send size={13} />Send to {agentName}</Btn>
              </>
            )}
          </div>
        ) : (
          <div>
            <FileUploadZone label={attachType === 'doc' ? 'Upload a document' : 'Upload a file'} accept={attachType === 'doc' ? '.pdf,.doc,.docx,.pptx,.xlsx' : '*'} onUploaded={handleAttachUploaded} />
            <Btn variant="primary" style={{ width: '100%', marginTop: 14 }} onClick={sendAttachment} disabled={!attachFile}><Paperclip size={13} />Attach & send</Btn>
          </div>
        )}
      </Modal>

      {/* Train modal */}
      <Modal open={trainModal} onClose={() => setTrainModal(false)} title="Train Your Agent">
        <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, marginBottom: 16 }}>Upload content for {agentName} to learn from.</p>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {[['audio', 'Audio', 'Voice & lectures'], ['video', 'Video', 'Recordings'], ['live', 'Live', 'Stream from device']].map(([k, l, d]) => (
            <button key={k} onClick={() => { setTrainType(k); setTrainFile(null); }} style={{ flex: 1, padding: '10px 6px', borderRadius: 12, border: bdr(1.5, trainType === k ? AMBER : BORDER), background: trainType === k ? 'rgba(232,136,74,.08)' : WHITE, cursor: 'pointer', textAlign: 'center', fontFamily: FONT }}>
              <div style={{ fontSize: 16, marginBottom: 3 }}>{l.split(' ')[0]}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: trainType === k ? AMBER : INK }}>{l.split(' ').slice(1).join(' ')}</div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{d}</div>
            </button>
          ))}
        </div>
        {trainType !== 'live' && (
          <FileUploadZone
            label={trainFile ? `Selected: ${trainFile.name}` : `Upload ${trainType} file`}
            accept={trainType === 'audio' ? 'audio/*' : 'video/*'}
            upload={false}
            onFile={setTrainFile}
          />
        )}
        {trainType === 'live' && <LiveRecorder onRecorded={setTrainFile} />}
        <Sel label="Assign to subject" value={trainSubj} onChange={(e) => setTrainSubj(e.target.value)}>
          {['Mathematics', 'Chemistry', 'Physics', 'Biology', 'English', 'Economics', 'Computer Science', 'General'].map((s) => <option key={s} value={s}>{s}</option>)}
        </Sel>
        <Btn variant="primary" style={{ width: '100%' }} onClick={startTraining}><Brain size={14} />Start training {agentName}</Btn>
      </Modal>
    </PageLayout>
  );
}
