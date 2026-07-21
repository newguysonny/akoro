/**
 * AiChatPage — the standalone AI assistant opened from the public school
 * website's chat widget. A single full-screen chat (NO sidebar, NO training,
 * NO agent editing) for students, teachers and admins of the school. Reuses
 * the same educational tutor backend as the in-app Agent Chat.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, LogOut, Loader2, Plus, Camera, Upload, FileText, Loader, Mic, ClipboardCheck } from 'lucide-react';
import AssessmentPicker from './ai-chat/AssessmentPicker.jsx';
import AssessmentRoom from '../components/assessment/AssessmentRoom.jsx';
import { API, apiPost } from '../services/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Modal, FileUploadZone, Btn, Txa } from '../components/Primitives.jsx';
import VoiceChatPanel from '../components/voice/VoiceChatPanel.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, FONT } from '../constants.js';

const GREETING = "Hi! I'm your school's AI study assistant. Ask me anything — explain a topic, help with homework, prep for exams, or plan a lesson. What would you like to explore?";

const SITE_KEY = 'akoro_ai_return';

export default function AiChatPage() {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';

  // Remember the school website that opened this chat so "Sign out" returns
  // there instead of the portal's /signin. The referrer is captured once on
  // first mount (before it can be lost) and cached for the session.
  useEffect(() => {
    try {
      if (!sessionStorage.getItem(SITE_KEY) && document.referrer) {
        const ref = new URL(document.referrer);
        if (ref.origin !== window.location.origin) sessionStorage.setItem(SITE_KEY, ref.origin);
      }
    } catch { /* ignore */ }
  }, []);

  // Log out, then send the user back to the school website homepage they came
  // from (falls back to the portal sign-in if we don't know the origin).
  const logout = useCallback(async () => {
    try { await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' }); } catch { /* ignore */ }
    try { localStorage.removeItem('akoro_user'); } catch { /* ignore */ }
    let dest = '/signin';
    try { dest = sessionStorage.getItem(SITE_KEY) || dest; } catch { /* ignore */ }
    window.location.href = dest;
  }, []);
  const firstName = (user?.fullName || '').split(' ')[0] || '';
  const [messages, setMessages] = useState([{ from: 'agent', text: GREETING }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  // Attachment modal (Photo/Image OCR · Upload file · Upload document)
  const [attachMenu, setAttachMenu]   = useState(false);
  const [attachModal, setAttachModal] = useState(false);
  const [attachType, setAttachType]   = useState('ocr'); // 'ocr' | 'file' | 'doc'
  const [ocrText, setOcrText]         = useState('');
  const [ocrRunning, setOcrRunning]   = useState(false);
  const [ocrError, setOcrError]       = useState('');
  const [attachFile, setAttachFile]   = useState(null);
  const [voiceMode, setVoiceMode]     = useState(false);
  const [assessOpen, setAssessOpen]   = useState(false);
  const [assessment, setAssessment]   = useState(null);  // active proctored exam

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);

  const openAttach = (type) => {
    setAttachMenu(false);
    if (type === 'voice') { setVoiceMode(true); return; }
    if (type === 'assessment') { setAssessOpen(true); return; }
    setAttachType(type); setAttachModal(true); setOcrText(''); setOcrError(''); setAttachFile(null);
  };

  // Launch a proctored assessment on the chosen subject/topic. The proctored
  // exam room reuses the platform assessment gateway (start_assessment).
  const startAssessment = useCallback((opt) => {
    setAssessOpen(false);
    const objectives = (opt.syllabus || []).map((s) => s.topic).filter(Boolean);
    setAssessment({ topic: opt.topic || opt.subject, subject: opt.subject, objectives });
  }, []);

  const handleOcrUploaded = useCallback(async ({ id }) => {
    setOcrRunning(true); setOcrError('');
    try {
      const { pollOcr } = await import('../services/uploadApi.js');
      const txt = await pollOcr(id);
      setOcrText(txt || '');
    } catch (err) {
      setOcrError(err.message || 'Could not extract text from that image.');
    } finally { setOcrRunning(false); }
  }, []);

  const handleAttachUploaded = useCallback(({ fileUrl, fileName }) => {
    setAttachFile({ fileUrl, fileName });
  }, []);

  const ATTACH_ITEMS = [
    { type: 'ocr', icon: <Camera size={15} color={GREEN} />,   label: 'Photo / Image OCR', desc: 'Scan & extract text' },
    { type: 'file', icon: <Upload size={15} color={PURPLE} />, label: 'Upload file',        desc: 'PDF, Word, Excel…' },
    { type: 'doc', icon: <FileText size={15} color={BLUE} />,  label: 'Upload document',    desc: 'Lesson notes, worksheets' },
    { type: 'voice', icon: <Mic size={15} color={AMBER} />,    label: 'Voice Chat',         desc: 'Talk to the assistant live' },
    ...(isStudent ? [{ type: 'assessment', icon: <ClipboardCheck size={15} color={PURPLE} />, label: 'Assessment', desc: 'Proctored — today’s subjects & topics' }] : []),
  ];

  // A finished voice exchange (from Deepgram's ConversationText events) gets
  // appended into the regular chat history so it's visible after switching back.
  const handleVoiceExchange = useCallback(({ role, content }) => {
    setMessages((p) => [...p, { from: role === 'assistant' ? 'agent' : 'me', text: content }]);
  }, []);

  const ask = useCallback(async (body) => {
    if (!body || busy) return;
    setBusy(true);
    const next = [...messages, { from: 'me', text: body }];
    setMessages(next);
    try {
      const history = next.map((m) => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text })).slice(-8);
      const data = await apiPost('/api/adaptive/chat/tutor', {
        message: body, history, agentName: 'Akoro', role: isStudent ? 'student' : 'instructor',
      });
      setMessages((p) => [...p, { from: 'agent', text: data.reply || data.response || "I'm here to help — could you rephrase that?" }]);
    } catch {
      setMessages((p) => [...p, { from: 'agent', text: 'Sorry — I had trouble responding just now. Please try again.' }]);
    } finally { setBusy(false); }
  }, [busy, messages, isStudent]);

  const send = useCallback(() => {
    const body = text.trim();
    if (!body || busy) return;
    setText('');
    ask(body);
  }, [text, busy, ask]);

  const sendAttachment = useCallback(() => {
    let body = '';
    if (attachType === 'ocr') {
      if (!ocrText.trim()) return;
      body = `Here's text I scanned from an image — please help me with it:\n\n${ocrText.trim()}`;
    } else {
      if (!attachFile) return;
      body = `I've attached a ${attachType === 'doc' ? 'document' : 'file'}: ${attachFile.fileName}\n${attachFile.fileUrl}\n\nPlease take a look and help me with it.`;
    }
    setAttachModal(false);
    setOcrText(''); setAttachFile(null); setOcrError('');
    ask(body);
  }, [attachType, ocrText, attachFile, ask]);

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: LIGHT, fontFamily: FONT }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: WHITE, borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Bot size={22} color={WHITE} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: INK }}>AI Study Assistant</div>
          <div style={{ fontSize: 11.5, color: GREEN, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN }} /> Online{firstName ? ` · ${firstName}` : ''}
          </div>
        </div>
        <button onClick={logout} title="Sign out" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 9, border: `1px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
          <LogOut size={13} /> Sign out
        </button>
      </header>

      {assessOpen && <AssessmentPicker onClose={() => setAssessOpen(false)} onStart={startAssessment} />}
      {assessment && (
        <AssessmentRoom
          topic={assessment.topic} subject={assessment.subject} objectives={assessment.objectives}
          studentId={user?.id} onClose={() => setAssessment(null)} />
      )}
      {voiceMode ? (
        <VoiceChatPanel onClose={() => setVoiceMode(false)} onExchange={handleVoiceExchange} />
      ) : (
      <>
      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '18px 16px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.from === 'me' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '82%', padding: '11px 14px', borderRadius: 16, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                background: m.from === 'me' ? `linear-gradient(135deg, ${AMBER}, #D4651E)` : WHITE,
                color: m.from === 'me' ? WHITE : INK,
                border: m.from === 'me' ? 'none' : `1px solid ${BORDER}`,
                borderBottomRightRadius: m.from === 'me' ? 4 : 16,
                borderBottomLeftRadius: m.from === 'me' ? 16 : 4,
              }}>{m.text}</div>
            </div>
          ))}
          {busy && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{ padding: '11px 14px', borderRadius: 16, borderBottomLeftRadius: 4, background: WHITE, border: `1px solid ${BORDER}`, color: MUTED2, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> Thinking…
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div style={{ flexShrink: 0, padding: '12px 16px', background: WHITE, borderTop: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
          {/* Attachment + menu */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {attachMenu && (
              <>
                <div onClick={() => setAttachMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
                <div style={{ position: 'absolute', bottom: 52, left: 0, zIndex: 11, width: 240, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,.14)', overflow: 'hidden' }}>
                  {ATTACH_ITEMS.map((it) => (
                    <button key={it.type} onClick={() => openAttach(it.type)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 13px', border: 'none', borderBottom: `1px solid ${BORDER}`, background: WHITE, cursor: 'pointer', textAlign: 'left', fontFamily: FONT }}>
                      <span style={{ width: 30, height: 30, borderRadius: 8, background: LIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{it.icon}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: INK }}>{it.label}</span>
                        <span style={{ display: 'block', fontSize: 11, color: MUTED2 }}>{it.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <button onClick={() => setAttachMenu((v) => !v)} title="Attach" style={{ width: 44, height: 44, borderRadius: 12, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={20} style={{ transform: attachMenu ? 'rotate(45deg)' : 'none', transition: 'transform .15s' }} />
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder="Ask your AI assistant…"
            style={{ flex: 1, resize: 'none', maxHeight: 140, padding: '11px 14px', borderRadius: 12, border: `1.5px solid ${BORDER}`, fontSize: 14, fontFamily: FONT, color: INK, outline: 'none', lineHeight: 1.5, background: WHITE }}
          />
          <button onClick={send} disabled={!text.trim() || busy} style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, border: 'none', background: (!text.trim() || busy) ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: (!text.trim() || busy) ? '#9CA3AF' : WHITE, cursor: (!text.trim() || busy) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Send size={18} />
          </button>
        </div>
        <p style={{ maxWidth: 760, margin: '8px auto 0', fontSize: 10.5, color: MUTED2, textAlign: 'center' }}>AI can make mistakes — check important information.</p>
      </div>
      </>
      )}

      {/* Attachment modal */}
      <Modal
        open={attachModal}
        onClose={() => setAttachModal(false)}
        title={attachType === 'ocr' ? '📷 Photo / Image OCR' : attachType === 'doc' ? '📄 Upload Document' : '📎 Upload File'}
      >
        {attachType === 'ocr' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FileUploadZone label="Upload an image to scan & extract text" accept="image/*" onUploaded={handleOcrUploaded} />
            {ocrRunning && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: MUTED }}>
                <Loader size={14} style={{ animation: 'spin .8s linear infinite' }} /> Extracting text…
              </div>
            )}
            {ocrError && <p style={{ fontSize: 12.5, color: '#EF4444', margin: 0 }}>{ocrError}</p>}
            {ocrText && (
              <>
                <Txa label="Extracted text (edit before sending)" rows={6} value={ocrText} onChange={(e) => setOcrText(e.target.value)} />
                <Btn onClick={sendAttachment} disabled={!ocrText.trim()}>Send to assistant</Btn>
              </>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FileUploadZone
              label={attachType === 'doc' ? 'Upload a lesson note, worksheet or document' : 'Upload a PDF, Word, Excel or other file'}
              accept={attachType === 'doc' ? '.pdf,.doc,.docx,.pptx,.xlsx,.txt' : '*'}
              onUploaded={handleAttachUploaded}
            />
            <Btn onClick={sendAttachment} disabled={!attachFile}>Attach &amp; send</Btn>
          </div>
        )}
      </Modal>
    </div>
  );
}
