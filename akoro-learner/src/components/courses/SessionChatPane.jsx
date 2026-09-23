/**
 * SessionChatPane.jsx — the chat column of a learning session (presentational).
 *
 * The teaching session has always had one (its WebSocket chat); course agent
 * sessions now get the same shape through the learner's real Agent chat
 * seam — POST /api/adaptive/chat/sessions to own the conversation, then the
 * unified agent endpoint (streaming, with a plain JSON fallback) for every
 * turn. No mock replies: connection problems say so honestly.
 *
 * The pump lives in the PARENT (AgentSessionViewer) so the conversation
 * survives the pane moving between the desktop split (reader's right
 * column) and the standalone surface (mobile / reader closed) — this pane
 * is pure UI and remounts freely.
 *
 * Above the composer sits the session's CONTENT BOX (passed in as a node) —
 * the one-tap way from the chat to the material and back.
 *
 * UI strings are hardcoded English like the rest of the reader family.
 */

import { useEffect, useRef } from 'react';
import { BRAND } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';

export default function SessionChatPane({ title, agent, messages, input, loading, contentBox = null, onClose, onInputChange, onSend }) {

  /* Keep the newest message in view. */
  const listRef = useRef(null);
  useEffect(() => {
    try { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); } catch { /* ignore */ }
  }, [messages, loading]);

  const bubble = (m) => (
    <div key={m.id} style={{ display: 'flex', justifyContent: m.from === 'me' ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '82%', padding: '9px 13px', borderRadius: 15,
        borderBottomRightRadius: m.from === 'me' ? 5 : 15,
        borderBottomLeftRadius:  m.from === 'me' ? 15 : 5,
        background:  m.from === 'me' ? BRAND : 'var(--ak-surface)',
        border:      m.from === 'me' ? 'none' : '1px solid var(--ak-border2)',
        color:       m.from === 'me' ? '#fff' : 'var(--ak-text)',
        fontSize: 13, lineHeight: 1.55, fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {m.text}
        <div style={{ fontSize: 9.5, fontWeight: 700, opacity: 0.65, marginTop: 3, textAlign: m.from === 'me' ? 'right' : 'left' }}>{m.time}</div>
      </div>
    </div>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--ak-bg)', fontFamily: "'Nunito',sans-serif", minWidth: 0 }}>
      <style>{`
        @keyframes sesc-dot { 0%,80%,100% { transform: translateY(0); opacity:.45 } 40% { transform: translateY(-3px); opacity:1 } }
        @keyframes sesc-spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Header — the session, not the chat */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--ak-border)', flexShrink: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${BRAND}18`, border: `1.5px solid ${BRAND}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
          {agent.emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)', truncate: true, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.name}</div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-sub)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        </div>
        <button onClick={onClose} title="Close the session" aria-label="Close the session"
          style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--ak-tag-bg)', color: 'var(--ak-text-sub)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="ti-x" size={14} color="var(--ak-text-sub)"/>
        </button>
      </div>

      {/* Messages */}
      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 14px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map(bubble)}
        {loading && (
          <div style={{ display: 'flex', gap: 4, padding: '9px 13px', borderRadius: 15, borderBottomLeftRadius: 5, background: 'var(--ak-surface)', border: '1px solid var(--ak-border2)', width: 'fit-content' }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ak-text-sub)', animation: 'sesc-dot 1.1s infinite', animationDelay: `${i * 0.15}s` }}/>
            ))}
          </div>
        )}
      </div>

      {/* The session's content — one tap from the chat to the material. */}
      {contentBox}

      {/* Composer */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 14px calc(env(safe-area-inset-bottom, 0px) + 12px)', borderTop: '1px solid var(--ak-border)', flexShrink: 0 }}>
        <input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSend()}
          placeholder="Ask about this lesson…"
          aria-label="Ask about this lesson"
          style={{ flex: 1, minWidth: 0, padding: '11px 15px', borderRadius: 14, border: '1.5px solid var(--ak-border2)', background: 'var(--ak-input-bg)', color: 'var(--ak-text)', fontSize: 13, fontWeight: 600, outline: 'none', fontFamily: "'Nunito',sans-serif" }}
          onFocus={(e) => (e.target.style.borderColor = BRAND)}
          onBlur={(e) => (e.target.style.borderColor = 'var(--ak-border2)')}
        />
        <button onClick={() => onSend()} disabled={loading || !input.trim()} aria-label="Send message"
          style={{ width: 42, height: 42, borderRadius: 14, border: 'none', background: BRAND, color: '#fff', cursor: loading || !input.trim() ? 'default' : 'pointer', opacity: loading || !input.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="ti-send" size={16} color="#fff"/>
        </button>
      </div>
    </div>
  );
}
