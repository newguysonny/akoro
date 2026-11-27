import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ico } from '../theme/Ico.jsx';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Txa, Sel, FileUploadZone, Toast } from '../components/Primitives.jsx';
import TrainingProgress from '../components/TrainingProgress.jsx';
import LiveRecorder from '../components/LiveRecorder.jsx';
import { uploadTraining } from '../services/trainingApi.js';
import { useStatsAPI } from '../hooks/useStatsAPI.js';
import { useInstructorSocket } from '../hooks/useWebSocket.js';
import { apiGet, apiPost } from '../services/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { GREEN, RED, PURPLE, BLUE } from '../constants.js';
import { C, tint } from '../theme/colors.js';

const bdr = (w, c) => `${w}px solid ${c}`;

/* Icons render; the paired emoji is what agent_emoji stores (cross-app compat). */
const AGENT_AVATARS = [['ti-robot', '🤖'], ['ti-eye', '🔮'], ['ti-bolt', '⚡'], ['ti-orbit', '🌀'], ['ti-sparkles', '✨'], ['ti-triangle', '🔺'], ['ti-moon', '🌙'], ['ti-diamond', '💎'], ['ti-feather', '🦊'], ['ti-brain', '🧠'], ['ti-rocket', '🚀'], ['ti-target', '🎯']];

const CHAT_INIT = [
  { id: 1, from: 'agent', text: "Good morning! I'm ready to help — training, quizzes, reminders, or student reports. What do you need?", time: '8:01 AM' },
];

const REPLIES = [
  'Understood! Working on it now.',
  "Done! Here's what I've prepared...",
  'Great question. Based on my training, here\'s the best approach...',
  'Updated course materials. Anything else?',
  'Battle report updated — ranked #3 this week!',
];

const now = () => new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });

export default function ChatPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { getAgent, updateAgent } = useStatsAPI();
  const { on, off } = useInstructorSocket(user?.id);

  const [messages, setMessages]   = useState(CHAT_INIT);
  const [input, setInput]         = useState('');
  const [isTask, setIsTask]       = useState(false);
  const [taskChips, setTaskChips] = useState([]);
  const [toast, setToast]         = useState(null);
  const [myTools, setMyTools]     = useState([]);   // unlocked Tools & Assets

  const [agentName, setAgentName]   = useState('Your Agent');
  const [agentEmoji, setAgentEmoji] = useState('🔮');
  const [agentLevel, setAgentLevel] = useState(1);
  const [agentId, setAgentId]       = useState(null);

  const [trainModal, setTrainModal]   = useState(false);
  const [custModal, setCustModal]     = useState(false);
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

  const [draftName, setDraftName]   = useState('');
  const [draftEmoji, setDraftEmoji] = useState('🔮');

  const feedRef   = useRef(null);
  const attachRef = useRef(null);
  const inputRef  = useRef(null);

  // ── Load agent profile ──
  useEffect(() => {
    getAgent()
      .then((res) => {
        const agent = res?.data?.agent ?? res?.data?.user_agents?.[0] ?? res?.data;
        if (agent) {
          if (agent.id) setAgentId(agent.id);
          setAgentName(agent.agent_name ?? 'Your Agent');
          setAgentEmoji(agent.agent_emoji ?? '🔮');
          setAgentLevel(agent.level ?? agent.total_xp ? Math.floor((agent.total_xp ?? 0) / 500) + 1 : 1);
          setDraftName(agent.agent_name ?? '');
          setDraftEmoji(agent.agent_emoji ?? '🔮');
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

  const pushAgent = useCallback((text) => {
    setMessages((prev) => [...prev, { id: Date.now() + Math.random(), from: 'agent', text, time: now() }]);
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
      // Normal AI chat — OpenAI educational tutor (no tasks/tools)
      try {
        const history = [...messages, { from: 'me', text: bodyText }]
          .map((m) => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text }))
          .slice(-8);
        const data = await apiPost('/api/adaptive/chat/agent', {
          message: bodyText, history, agentName, role: 'instructor',
        });
        pushAgent(data.reply || data.response || "I'm here to help with teaching and your subjects — what would you like to explore?");
      } catch (e) {
        console.warn('[chat] tutor reply failed:', e.message);
        pushAgent('Sorry — I had trouble responding just now. Please try again.');
      }
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
      setToast({ message: 'Set up your agent (Edit) before training.', type: 'error' });
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

  // ── Save agent customisation ──
  const saveAgent = async () => {
    setAgentName(draftName || agentName);
    setAgentEmoji(draftEmoji);
    setCustModal(false);
    try {
      await updateAgent({ agent_name: draftName || agentName, agent_emoji: draftEmoji });
      setToast({ message: 'Agent updated', type: 'success' });
    } catch (e) {
      console.warn('[chat] agent update failed:', e.message);
      setToast({ message: 'Saved locally (offline)', type: 'info' });
    }
  };

  const hasInput = taskChips.length > 0 || input.trim().length > 0;

  return (
    <PageLayout title="Agent Chat" subtitle={`${agentName} · Lv ${agentLevel}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <style>{`
        .ci-task-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px 3px 9px;border-radius:20px;background:linear-gradient(135deg,${tint(18, C.brand)},${tint(14, C.brand)});border:1.5px solid ${tint(50, C.brand)};color:${C.brand};font-size:11px;font-weight:700;white-space:nowrap;flex-shrink:0}
        .ci-task-chip button{display:flex;align-items:center;background:none;border:none;cursor:pointer;padding:0;color:${C.brand};opacity:.7;line-height:1}
        .ci-qp{flex-shrink:0;padding:5px 11px;border-radius:20px;border:1.5px solid ${C.border};background:#fff;color:${C.muted};font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:${C.font};transition:all .15s;display:inline-flex;align-items:center;gap:4px}
        .ci-qp:hover{border-color:${C.brand};color:${C.brand}}
        .ci-qp.active{border-color:${C.brand};color:${C.brand};background:${tint(12, C.brand)}}
        .ci-qp.ci-tool{border-color:rgba(16,185,129,.4);color:${GREEN};background:rgba(16,185,129,.08)}
        .ci-qp.ci-tool.active{border-color:${GREEN};background:rgba(16,185,129,.16)}
        .ci-quickbar{display:flex;gap:6px;overflow-x:auto;padding-bottom:10px;scrollbar-width:none}
        .ci-quickbar::-webkit-scrollbar{display:none}
        .ci-attach-menu{position:absolute;bottom:48px;left:0;background:#fff;border-radius:16px;border:1px solid ${C.border};box-shadow:0 8px 32px rgba(0,0,0,.12);padding:8px;min-width:210px;z-index:50}
        .ci-attach-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;cursor:pointer;border:none;background:transparent;width:100%;font-family:${C.font};text-align:left}
        .ci-attach-item:hover{background:${C.bg}}
        .ci-typing{display:inline-block;width:6px;height:6px;border-radius:50%;background:${C.muted2};margin:0 2px;animation:ciTyping 1.4s infinite ease-in-out}
        @keyframes ciTyping{0%,80%,100%{transform:scale(0);opacity:0}40%{transform:scale(1);opacity:1}}
      `}</style>

      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 150px)' }}>

        {/* Agent header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: C.surface, borderRadius: 16, border: bdr(1, C.border), marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#FEF0E6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21, boxShadow: `0 0 0 2px #fff, 0 0 0 3.5px ${C.brand}` }}><Ico ti="ti-robot" size={21} color={C.brand} /></div>
            <div>
              <div style={{ fontWeight: 800, color: C.ink, fontSize: 15 }}>{agentName}</div>
              <div style={{ fontSize: 11, color: trainingInChat ? C.brand : GREEN, display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: trainingInChat ? C.brand : GREEN, display: 'inline-block' }} />
                {trainingInChat ? 'Training in progress…' : `Online · Lv ${agentLevel}`}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn variant="secondary" size="sm" onClick={() => { setDraftName(agentName); setDraftEmoji(agentEmoji); setCustModal(true); }}><Ico ti="ti-edit" size={13} />Edit</Btn>
            <Btn variant="primary" size="sm" onClick={() => setTrainModal(true)}><Ico ti="ti-brain" size={13} />Train</Btn>
          </div>
        </div>

        {/* Tool commands — only the instructor's UNLOCKED Tools & Assets show
            here. A new agent has none until items are purchased. */}
        <div className="ci-quickbar">
          {myTools.length > 0 ? (
            myTools.map((t) => {
              const active = taskChips.includes(t.name);
              return (
                <button key={t.id} className={'ci-qp ci-tool' + (active ? ' active' : '')} onClick={() => (active ? removeChip(t.name) : handleQuickPrompt(t.name))} title={t.description}>
                  <span style={{ fontSize: 11 }}>{t.emoji}</span>{t.name}{active && <Ico ti="ti-x" size={9} />}
                </button>
              );
            })
          ) : (
            <button className="ci-qp" onClick={() => navigate('/marketplace')} title="Unlock tools & assets for your agent">
              <Ico ti="ti-lock-open" size={13} /> Unlock tools
            </button>
          )}
        </div>

        {/* Message feed */}
        <div ref={feedRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 2px' }}>
          {messages.map((msg) => {
            const isMe = msg.from === 'me';
            const chips = msg.chips || [];
            const textPart = chips.length ? msg.text.replace(chips.join(' · '), '').replace(/^\n/, '').trim() : msg.text;
            return (
              <div key={msg.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8 }}>
                {!isMe && <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#FEF0E6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}><Ico ti="ti-robot" size={15} color={C.brand} /></div>}
                <div style={{ maxWidth: '80%' }}>
                  {isMe && msg.isTask && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 20, background: tint(12, C.brand), border: `1.5px solid ${tint(35, C.brand)}`, color: C.brand, fontSize: 11, fontWeight: 700 }}><Ico ti="ti-square-check" size={10} />Task assigned</span>
                    </div>
                  )}
                  <div style={{
                    padding: '10px 13px',
                    borderRadius: isMe ? '17px 17px 4px 17px' : '17px 17px 17px 4px',
                    background: isMe ? (msg.isTask ? `linear-gradient(135deg,${C.brand},${C.brandDeep})` : C.ink) : C.tagBg,
                    color: isMe ? '#fff' : C.ink, fontSize: 13, lineHeight: 1.55,
                  }}>
                    {chips.length > 0 && (
                      <div style={{ marginBottom: textPart ? 6 : 0, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {chips.map((c) => (
                          <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 20, background: 'rgba(255,255,255,.25)', border: '1px solid rgba(255,255,255,.4)', fontSize: 10.5, fontWeight: 700, color: '#fff' }}><Ico ti="ti-square-check" size={9} />{c}</span>
                        ))}
                      </div>
                    )}
                    {textPart && <span style={{ whiteSpace: 'pre-wrap' }}>{textPart}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted2, marginTop: 3, textAlign: isMe ? 'right' : 'left' }}>{msg.time}</div>
                </div>
              </div>
            );
          })}

          {trainingInChat && !trainRunId && (
            <div style={{ background: C.ink, borderRadius: 20, padding: 24, color: '#fff', fontFamily: C.font }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Uploading recording…</div>
              <div style={{ height: 6, background: 'rgba(255,255,255,.1)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${uploadPct}%`, borderRadius: 3, background: `linear-gradient(90deg, ${C.brand}, ${PURPLE})`, transition: 'width .2s' }} />
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
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#FEF0E6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}><Ico ti="ti-robot" size={15} color={C.brand} /></div>
              <div style={{ padding: '10px 15px', borderRadius: '17px 17px 17px 4px', background: C.tagBg, display: 'flex', gap: 2 }}>
                <span className="ci-typing" /><span className="ci-typing" style={{ animationDelay: '.2s' }} /><span className="ci-typing" style={{ animationDelay: '.4s' }} />
              </div>
            </div>
          )}
        </div>

        {/* Input bar */}
        <div style={{ paddingTop: 10 }}>
          {isTask && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderRadius: 10, background: tint(10, C.brand), border: bdr(1, tint(30, C.brand)), marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Ico ti="ti-square-check" size={12} color={C.brand} /><span style={{ fontSize: 11.5, fontWeight: 700, color: C.brand }}>Sending as task</span></div>
              <button onClick={() => { setIsTask(false); setTaskChips([]); }} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: C.muted, fontFamily: C.font, fontWeight: 600 }}><Ico ti="ti-x" size={11} />Clear</button>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: C.bg, borderRadius: taskChips.length > 0 ? 18 : 50, border: bdr(1.5, isTask ? C.brand : C.border), padding: taskChips.length > 0 ? '10px 10px 8px 12px' : '6px 8px', minHeight: 50 }}>
            <div ref={attachRef} style={{ position: 'relative', flexShrink: 0, alignSelf: 'flex-end' }}>
              <button onClick={() => setAttachMenu((p) => !p)} style={{ width: 32, height: 32, borderRadius: '50%', background: attachMenu ? tint(15, C.brand) : C.surface, border: bdr(1, attachMenu ? C.brand : C.border), display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <Ico ti="ti-plus" size={14} color={attachMenu ? C.brand : C.muted2} />
              </button>
              {attachMenu && (
                <div className="ci-attach-menu">
                  {[
                    { icon: <Ico ti="ti-camera" size={15} color={GREEN} />, label: 'Photo / Image OCR', desc: 'Scan & extract text', act: () => { setAttachType('ocr'); setAttachModal(true); setAttachMenu(false); } },
                    { icon: <Ico ti="ti-upload" size={15} color={PURPLE} />, label: 'Upload file', desc: 'PDF, Word, Excel…', act: () => { setAttachType('file'); setAttachModal(true); setAttachMenu(false); } },
                    { icon: <Ico ti="ti-file-text" size={15} color={BLUE} />, label: 'Upload document', desc: 'Lesson notes, worksheets', act: () => { setAttachType('doc'); setAttachModal(true); setAttachMenu(false); } },
                  ].map((item) => (
                    <button key={item.label} className="ci-attach-item" onClick={item.act}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{item.icon}</div>
                      <div><div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{item.label}</div><div style={{ fontSize: 11, color: C.muted }}>{item.desc}</div></div>
                    </button>
                  ))}
                  <div style={{ height: 1, background: C.border, margin: '4px 0' }} />
                  <button className="ci-attach-item" onClick={() => { setTaskModal(true); setAttachMenu(false); }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: tint(10, C.brand), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ico ti="ti-square-check" size={15} color={C.brand} /></div>
                    <div><div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>Assign task</div><div style={{ fontSize: 11, color: C.muted }}>Create a structured task</div></div>
                  </button>
                </div>
              )}
            </div>

            <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, minWidth: 0 }}>
              {taskChips.map((chip) => (
                <span key={chip} className="ci-task-chip"><Ico ti="ti-square-check" size={9} />{chip}<button onClick={() => removeChip(chip)} tabIndex={-1}><Ico ti="ti-x" size={9} /></button></span>
              ))}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                  if (e.key === 'Backspace' && input === '' && taskChips.length > 0) removeChip(taskChips[taskChips.length - 1]);
                }}
                placeholder={taskChips.length > 0 ? 'Add a note… (optional)' : `Ask ${agentName} anything…`}
                style={{ flex: 1, minWidth: 80, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: C.ink, fontFamily: C.font, padding: '2px 0' }}
              />
            </div>

            <button onClick={() => setIsTask((p) => !p)} title="Mark as task" style={{ width: 30, height: 30, borderRadius: '50%', background: isTask ? tint(15, C.brand) : C.bg, border: bdr(1, isTask ? C.brand : C.border), display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, alignSelf: 'flex-end' }}>
              <Ico ti="ti-square-check" size={13} color={isTask ? C.brand : C.muted2} />
            </button>
            <button onClick={send} disabled={!hasInput} style={{ width: 34, height: 34, borderRadius: '50%', background: hasInput ? C.brand : C.border, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: hasInput ? 'pointer' : 'default', flexShrink: 0, alignSelf: 'flex-end' }}>
              <Ico ti="ti-send" size={14} color="#fff" />
            </button>
          </div>
        </div>
      </div>

      {/* Task modal */}
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
          }}><Ico ti="ti-send" size={14} />Assign task</Btn>
        </div>
      </Modal>

      {/* Attach modal */}
      <Modal open={attachModal} onClose={() => { setAttachModal(false); setOcrText(''); setOcrRunning(false); setOcrError(''); setAttachFile(null); }} title={attachType === 'ocr' ? 'Photo / Image OCR' : attachType === 'doc' ? 'Upload Document' : 'Upload File'}>
        {attachType === 'ocr' ? (
          <div>
            <FileUploadZone label="Upload an image to scan" accept="image/*" onUploaded={handleOcrUploaded} />
            {ocrRunning && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0', fontSize: 13, color: C.muted }}>
                <Ico ti="ti-loader" size={13} className="spinner" /> Extracting text…
              </div>
            )}
            {ocrError && <p style={{ fontSize: 12, color: RED, margin: '12px 0', fontWeight: 600 }}>{ocrError}</p>}
            {ocrText && (
              <>
                <Txa label="Extracted text — edit if needed" value={ocrText} onChange={(e) => setOcrText(e.target.value)} rows={5} />
                <Btn variant="primary" style={{ width: '100%' }} onClick={sendAttachment}><Ico ti="ti-send" size={13} />Send to {agentName}</Btn>
              </>
            )}
          </div>
        ) : (
          <div>
            <FileUploadZone label={attachType === 'doc' ? 'Upload a document' : 'Upload a file'} accept={attachType === 'doc' ? '.pdf,.doc,.docx,.pptx,.xlsx' : '*'} onUploaded={handleAttachUploaded} />
            <Btn variant="primary" style={{ width: '100%', marginTop: 14 }} onClick={sendAttachment} disabled={!attachFile}><Ico ti="ti-paperclip" size={13} />Attach & send</Btn>
          </div>
        )}
      </Modal>

      {/* Train modal */}
      <Modal open={trainModal} onClose={() => setTrainModal(false)} title="Train Your Agent">
        <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.55, marginBottom: 16 }}>Upload content for {agentName} to learn from.</p>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {[['audio', 'Audio', 'Voice & lectures'], ['video', 'Video', 'Recordings'], ['live', 'Live', 'Stream from device']].map(([k, l, d]) => (
            <button key={k} onClick={() => { setTrainType(k); setTrainFile(null); }} style={{ flex: 1, padding: '10px 6px', borderRadius: 12, border: bdr(1.5, trainType === k ? C.brand : C.border), background: trainType === k ? tint(8, C.brand) : C.surface, cursor: 'pointer', textAlign: 'center', fontFamily: C.font }}>
              <div style={{ fontSize: 16, marginBottom: 3 }}>{l.split(' ')[0]}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: trainType === k ? C.brand : C.ink }}>{l.split(' ').slice(1).join(' ')}</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{d}</div>
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
        <Btn variant="primary" style={{ width: '100%' }} onClick={startTraining}><Ico ti="ti-brain" size={14} />Start training {agentName}</Btn>
      </Modal>

      {/* Customise modal */}
      <Modal open={custModal} onClose={() => setCustModal(false)} title="Customise Your Agent">
        <Inp label="Agent name" placeholder="e.g. Pythia" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 8 }}>Pick an avatar</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {AGENT_AVATARS.map(([ti, em]) => (
              <button key={em} onClick={() => setDraftEmoji(em)} style={{ width: 44, height: 44, borderRadius: 12, border: bdr(2, draftEmoji === em ? C.brand : C.border), background: draftEmoji === em ? tint(10, C.brand) : C.bg, fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti={ti} size={22} color={draftEmoji === em ? C.brand : C.muted2} /></button>
            ))}
          </div>
        </div>
        <Btn variant="primary" style={{ width: '100%' }} onClick={saveAgent}><Ico ti="ti-circle-check" size={14} />Save agent</Btn>
      </Modal>
    </PageLayout>
  );
}
