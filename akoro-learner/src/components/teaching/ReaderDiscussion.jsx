/**
 * ReaderDiscussion.jsx — the community's group chat, live in the reader.
 *
 * One discussion per community, OWNED by the community (never by the
 * content): a persistent edu.community_discussions thread that follows
 * the community's materials everywhere. When connected content opens in
 * the reader — the PDF, the audio lecture, the video, the doc — members
 * chat here in real time, like a group chat:
 *
 *   history  GET  /api/communities/:id/discussion/messages  (REST, paged)
 *   post     POST /api/communities/:id/discussion/messages  (REST — the
 *            single write path; the API broadcasts to the socket.io room
 *            `discussion:<communityId>`)
 *   live     window.io → join-discussion (membership-verified server-side)
 *            → `discussion:message` events append live
 *
 * Multiple communities holding the same content: a chip row switches
 * between their discussions — each community's room stays its own.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { API } from '../../services/api.js';
import { fetchDiscussionMessages, postDiscussionMessage } from '../../services/communityApi.js';
import { BRAND, STUDENT_ID } from '../../constants.js';

const MAX_BODY = 2000;   // the server trims/caps the same way

const timeLabel = (iso) => {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};

export default function ReaderDiscussion({ communities = [] }) {
  const [activeId, setActiveId] = useState(communities[0]?.id || null);
  const active = useMemo(
    () => communities.find((c) => c.id === activeId) || communities[0] || null,
    [communities, activeId],
  );

  const [messages, setMessages] = useState(null);   // null = loading history
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef  = useRef(null);
  const stickRef = useRef(true);   // autoscroll only while the learner sits at the bottom
  // Message ids already shown — the POST response and the socket echo of
  // your own message are the same row; it must land once.
  const seenRef  = useRef(new Set());

  const merge = (incoming) => {
    setMessages((prev) => {
      const fresh = incoming.filter((m) => m?.id && !seenRef.current.has(m.id));
      if (!fresh.length) return prev;
      fresh.forEach((m) => seenRef.current.add(m.id));
      return [...(prev || []), ...fresh]
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    });
  };

  /* History — per community, reloaded when the chip switches. */
  useEffect(() => {
    if (!active) return;
    let dead = false;
    setMessages(null); setErr(''); setHasMore(false);
    seenRef.current = new Set();
    fetchDiscussionMessages(active.id).then((d) => {
      if (dead) return;
      if (!d) {
        setErr("Couldn't load the discussion — check your connection and try again.");
        setMessages([]);
        return;
      }
      seenRef.current = new Set((d.messages || []).map((m) => m.id));
      setMessages(d.messages || []);
      setHasMore(!!d.hasMore);
    });
    return () => { dead = true; };
  }, [active?.id]);

  /* Realtime — one socket per active discussion; the server only joins
     the room after checking this user's membership. A reconnect fires
     "connect" again, so the room survives connection flaps. */
  useEffect(() => {
    if (!active || typeof window === 'undefined' || !window.io) return;
    const room = active.id;
    const s = window.io(API, { transports: ['websocket', 'polling'], withCredentials: true });
    s.on('connect', () => s.emit('join-discussion', room));
    s.on('discussion:message', (p) => { if (p?.communityId === room && p.message) merge([p.message]); });
    s.on('discussion:error', (e) => {
      if (e?.code === 'not_member') setErr(e.message || 'Join this community to join its discussion.');
    });
    return () => { s.emit('leave-discussion', room); s.disconnect(); };
  }, [active?.id]);

  /* Follow the tail — unless the reader scrolled up to re-read. */
  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages?.length, active?.id]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const loadEarlier = async () => {
    if (!active || loadingEarlier || !messages?.length) return;
    setLoadingEarlier(true);
    const d = await fetchDiscussionMessages(active.id, { before: messages[0].createdAt });
    if (d?.messages?.length) {
      (d.messages || []).forEach((m) => seenRef.current.add(m.id));
      setMessages((prev) => [...(d.messages || []), ...(prev || [])]);
      setHasMore(!!d.hasMore);
    }
    setLoadingEarlier(false);
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending || !active) return;
    setSending(true);
    try {
      const m = await postDiscussionMessage(active.id, body.slice(0, MAX_BODY));
      if (m) merge([m]);
      setText('');
      stickRef.current = true;
    } catch (e) {
      setErr(e?.message || "Couldn't post — try again.");
    } finally {
      setSending(false);
    }
  };

  if (!active) return null;

  const chip = (c) => (
    <button key={c.id} type="button" onClick={() => { stickRef.current = true; setActiveId(c.id); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
        padding: '5px 12px', borderRadius: 100, cursor: 'pointer',
        fontSize: 11.5, fontWeight: 800, fontFamily: "'Nunito',sans-serif",
        border: `1.5px solid ${c.id === active.id ? BRAND : 'var(--ak-border2, #E5E7EB)'}`,
        background: c.id === active.id ? `${BRAND}16` : 'transparent',
        color: c.id === active.id ? BRAND : 'var(--ak-text-sub)',
      }}>
      <span>{c.emoji || '👥'}</span>{c.name}
    </button>
  );

  const bubble = (m, i) => {
    const mine = m.author?.id === STUDENT_ID;
    const prev = messages[i - 1];
    const grouped = prev && prev.author?.id === m.author?.id
      && (new Date(m.createdAt) - new Date(prev.createdAt)) < 5 * 60 * 1000;
    return (
      <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: grouped ? 3 : 12 }}>
        {!mine && (
          <span style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, marginRight: 8, alignSelf: 'flex-end',
            background: m.author?.avatarUrl ? `url(${m.author.avatarUrl}) center/cover` : `linear-gradient(135deg, ${BRAND}, #4C1DCC)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {!m.author?.avatarUrl && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900 }}>{(m.author?.name || 'L').charAt(0).toUpperCase()}</span>}
          </span>
        )}
        <div style={{ maxWidth: '78%', minWidth: 0 }}>
          {!mine && !grouped && (
            <p style={{ margin: '0 0 3px 2px', fontSize: 10.5, fontWeight: 800, color: 'var(--ak-text-sub)' }}>{m.author?.name || 'Learner'}</p>
          )}
          <div style={{
            padding: '8px 12px', borderRadius: 16, position: 'relative',
            borderTopRightRadius: mine && grouped ? 5 : 16,
            borderTopLeftRadius: !mine && grouped ? 5 : 16,
            background: mine ? `linear-gradient(135deg, ${BRAND}, #4C1DCC)` : 'var(--ak-surface)',
            border: mine ? 'none' : '1px solid var(--ak-border2, #E5E7EB)',
            boxShadow: '0 1px 2px rgba(15,23,42,.05)',
          }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              color: mine ? '#fff' : 'var(--ak-text)', fontFamily: "'Nunito',sans-serif" }}>{m.body}</p>
            <p style={{ margin: '3px 2px 0', fontSize: 9.5, fontWeight: 700, textAlign: 'right',
              color: mine ? 'rgba(255,255,255,.72)' : 'var(--ak-text-sub)' }}>{timeLabel(m.createdAt)}</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: "'Nunito',sans-serif" }}>
      {/* Header — whose chat this is. The discussion is the community's,
          so the line says so: the same conversation rides every content
          the community is connected to. */}
      <div style={{ paddingBottom: 10, marginBottom: 8, borderBottom: '1px solid var(--ak-border2, #E5E7EB)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 34, height: 34, borderRadius: 12, flexShrink: 0, fontSize: 17,
            background: `${BRAND}16`, border: `1px solid ${BRAND}38`,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{active.emoji || '👥'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{active.name}</p>
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-sub)' }}>
              Community discussion{active.memberCount != null ? ` · ${active.memberCount} member${active.memberCount === 1 ? '' : 's'}` : ''} — rides every connected content
            </p>
          </div>
          <span className="ti ti-messages" style={{ fontSize: 16, color: BRAND, flexShrink: 0 }}/>
        </div>
        {communities.length > 1 && (
          <div style={{ display: 'flex', gap: 7, marginTop: 9, overflowX: 'auto', scrollbarWidth: 'none' }}>
            {communities.map(chip)}
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={listRef} onScroll={onScroll}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 2px 8px' }}>
        {hasMore && (
          <button type="button" onClick={loadEarlier} disabled={loadingEarlier}
            style={{ alignSelf: 'center', margin: '2px 0 8px', padding: '6px 14px', borderRadius: 100,
              border: '1px solid var(--ak-border2, #E5E7EB)', background: 'var(--ak-surface)', cursor: 'pointer',
              fontSize: 11, fontWeight: 800, color: 'var(--ak-text-sub)', fontFamily: 'inherit' }}>
            {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
          </button>
        )}
        {messages === null ? (
          <p style={{ margin: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)' }}>Loading the discussion…</p>
        ) : messages.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', padding: '18px 10px' }}>
            <span className="ti ti-messages" style={{ fontSize: 26, color: BRAND, opacity: 0.5 }}/>
            <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>No messages yet</p>
            <p style={{ margin: '3px 0 0', fontSize: 11.5, fontWeight: 600, color: 'var(--ak-text-sub)', lineHeight: 1.55 }}>
              Start the conversation — every member of {active.name} sees it here, on this content and every other one it's connected to.
            </p>
          </div>
        ) : messages.map(bubble)}
      </div>

      {err && (
        <p style={{ margin: '6px 0', padding: '7px 12px', borderRadius: 10, background: 'rgba(239,68,68,.1)',
          border: '1px solid rgba(239,68,68,.3)', fontSize: 11.5, fontWeight: 700, color: '#B91C1C' }}>{err}</p>
      )}

      {/* Composer — group-chat input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid var(--ak-border2, #E5E7EB)' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          maxLength={MAX_BODY}
          placeholder={`Message ${active.name}…`}
          className="folio-form-field"
          style={{ flex: 1, minWidth: 0, border: '1px solid var(--ak-border2, #E5E7EB)', borderRadius: 100,
            padding: '10px 16px', fontSize: 13, background: 'var(--ak-surface)', color: 'var(--ak-text)',
            outline: 'none', fontFamily: "'Nunito',sans-serif" }}
        />
        <button type="button" onClick={send} disabled={sending || !text.trim()} aria-label="Send"
          style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, cursor: sending || !text.trim() ? 'default' : 'pointer',
            border: 'none', opacity: sending || !text.trim() ? 0.5 : 1,
            background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="ti ti-send" style={{ fontSize: 15, color: '#fff' }}/>
        </button>
      </div>
    </div>
  );
}
