/**
 * AiChatPage — the standalone AI assistant opened from the public school
 * website's chat widget. A single full-screen chat (NO sidebar, NO training,
 * NO agent editing) for students, teachers and admins of the school. Reuses
 * the same educational tutor backend as the in-app Agent Chat.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, LogOut, Loader2 } from 'lucide-react';
import { apiPost } from '../services/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, FONT } from '../constants.js';

const GREETING = "Hi! I'm your school's AI study assistant. Ask me anything — explain a topic, help with homework, prep for exams, or plan a lesson. What would you like to explore?";

export default function AiChatPage() {
  const { user, logout } = useAuth();
  const isStudent = user?.role === 'student';
  const firstName = (user?.fullName || '').split(' ')[0] || '';
  const [messages, setMessages] = useState([{ from: 'agent', text: GREETING }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || busy) return;
    setText('');
    const next = [...messages, { from: 'me', text: body }];
    setMessages(next);
    setBusy(true);
    try {
      const history = next.map((m) => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text })).slice(-8);
      const data = await apiPost('/api/adaptive/chat/tutor', {
        message: body, history, agentName: 'Akoro', role: isStudent ? 'student' : 'instructor',
      });
      setMessages((p) => [...p, { from: 'agent', text: data.reply || data.response || "I'm here to help — could you rephrase that?" }]);
    } catch {
      setMessages((p) => [...p, { from: 'agent', text: 'Sorry — I had trouble responding just now. Please try again.' }]);
    } finally { setBusy(false); }
  }, [text, busy, messages, isStudent]);

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
    </div>
  );
}
