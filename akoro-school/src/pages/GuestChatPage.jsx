/**
 * GuestChatPage — public AI Admissions Counselor for prospective families.
 * No login. Reads ?host= (the school website), talks to the public
 * /api/school/site/guest-chat endpoint (school resolved by host).
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';
import { API } from '../services/api.js';

const FONT = C.font;
const BRAND = C.brand;
const GREETING = "Hi! I'm the admissions assistant. Ask me anything about the school — programmes, fees, admissions — or I can book you a campus tour. How can I help?";
const CHIPS = ['What grades do you offer?', 'How much is tuition?', 'Book a campus tour', 'How do I apply?'];

export default function GuestChatPage() {
  const host = (() => { try { return new URLSearchParams(window.location.search).get('host') || ''; } catch { return ''; } })();
  const [messages, setMessages] = useState([{ from: 'agent', text: GREETING }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);

  const ask = useCallback(async (body) => {
    const q = (body ?? text).trim();
    if (!q || busy) return;
    setText('');
    const next = [...messages, { from: 'me', text: q }];
    setMessages(next); setBusy(true);
    try {
      const history = next.map((m) => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text })).slice(-8);
      const r = await fetch(`${API}/api/school/site/guest-chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'school' },
        body: JSON.stringify({ host, message: q, history }),
      });
      const d = await r.json();
      setMessages((p) => [...p, { from: 'agent', text: d.reply || d.error || "Sorry, I couldn't answer that — please contact the school office." }]);
    } catch {
      setMessages((p) => [...p, { from: 'agent', text: 'Sorry — I had trouble responding. Please try again.' }]);
    } finally { setBusy(false); }
  }, [text, busy, messages, host]);

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', fontFamily: FONT, background: C.bg }}>
      <div style={{ flexShrink: 0, padding: '16px 18px', borderBottom: `1px solid ${C.border}`, background: C.surface, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: tint(8, BRAND), display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND }}><Ico ti="ti-robot" size={19} /></div>
        <div><div style={{ fontSize: 15, fontWeight: 900, color: '#1A1A2E' }}>Admissions Assistant</div>
          <div style={{ fontSize: 11.5, color: C.muted }}>Ask about the school · book a tour</div></div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.from === 'me' ? 'flex-end' : 'flex-start' }}>
            <div style={{ maxWidth: '82%', padding: '10px 14px', borderRadius: m.from === 'me' ? '18px 18px 4px 18px' : '4px 18px 18px 18px', background: m.from === 'me' ? BRAND : C.surface, color: m.from === 'me' ? '#fff' : C.ink, border: m.from === 'me' ? 'none' : `1px solid ${C.border}`, fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', fontWeight: 500 }}>{m.text}</div>
          </div>
        ))}
        {busy && <div style={{ fontSize: 12, color: C.muted2, paddingLeft: 6 }}>typing…</div>}
        {messages.length <= 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {CHIPS.map((c) => <button key={c} onClick={() => ask(c)} style={{ background: C.surface, border: '1px solid #DDD3FF', borderRadius: 100, padding: '6px 13px', fontSize: 12.5, fontWeight: 700, color: BRAND, cursor: 'pointer', fontFamily: FONT }}>{c}</button>)}
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, padding: '10px 14px 14px', borderTop: `1px solid ${C.border}`, background: C.surface }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: C.brandSoft, borderRadius: 50, border: `1.5px solid ${C.border}`, padding: '6px 8px 6px 16px' }}>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(); }} placeholder="Ask about admissions…" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: C.ink, fontFamily: FONT }} />
          <button onClick={() => ask()} disabled={busy || !text.trim()} style={{ width: 38, height: 38, borderRadius: '50%', background: text.trim() ? BRAND : C.borderSoft, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: text.trim() ? 'pointer' : 'default' }}><Ico ti="ti-send" size={16} color="#fff" /></button>
        </div>
      </div>
    </div>
  );
}
