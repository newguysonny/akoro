/**
 * AgentSessionViewer.jsx — "Agent session" on a course details page.
 *
 * The session is a CHAT first, exactly like the teaching session: the
 * learner and their agent talk over the lesson, and the lesson VIDEO is
 * the content — one tap away in the content box that sits on top of the
 * composer.
 *
 *   · Mobile — the chat is the session surface. Tapping the content box
 *     opens the reader (SessionReaderModal, media mode) full-screen over
 *     it; the reader's chat button comes straight back here.
 *   · Desktop/tablet — the Fortizo split: reader left, chat right,
 *     side by side from the moment the session opens.
 *
 * One timeline with the course player: the reader fetches the same stream
 * seam (GET /api/lessons/:id), resumes from last_position_seconds, and
 * persists position (~10s) and completion (within 5s of the end).
 *
 * The session PARKS on the Now-Studying bar (title + course, progress
 * following the video, snapshot {slug, lessonId} so the bar reopens this
 * session on the exact lesson). Guests don't park.
 *
 * Honest states live in the content box — the chat works regardless of
 * whether the video is available: "Opening the lesson…" while loading,
 * "Video coming soon" when the lesson has no video, the real error when
 * the stream is inaccessible. Generated tools say so honestly too (a
 * video carries no extractable text); Q&A and Discussion work regardless.
 */

import { useEffect, useRef, useState } from 'react';
import SessionReaderModal, { useIsMobileView } from '../teaching/SessionReaderModal.jsx';
import SessionChatPane from './SessionChatPane.jsx';
import { API, apiGet, apiPost, streamPost } from '../../services/api.js';
import { agentChatEndpoint, createAgentChatTurnId } from '../../lib/agentChatEndpoint.js';
import { setNowStudying, updateNowProgress } from '../../utils/nowStudying.js';
import { BRAND, RED } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';

export default function AgentSessionViewer({ course, lesson, onClose }) {
  const isMobile = useIsMobileView();

  /* Video stream — same seam as the course player. */
  const [state, setState] = useState(lesson?.id ? 'loading' : 'empty');  // loading | ready | error | empty
  const [err, setErr]     = useState('');
  const [stream, setStream] = useState(null);                            // { url, lastPosition }
  const [videoPct, setVideoPct] = useState(lesson?.done ? 100 : (lesson?.progress || 0));
  const [retry, setRetry] = useState(0);
  const completedRef = useRef(false);

  /* On desktop/tablet the reader opens beside the chat the moment the
     stream is ready (auto, once); on mobile the chat comes first and the
     content box opens the reader on demand. */
  const [readerOpen, setReaderOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (state === 'ready' && !isMobile && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setReaderOpen(true);
    }
  }, [state, isMobile]);

  /* Now-Studying parking (signed-in learners only — guests have no bar). */
  const uid  = (() => { try { return (JSON.parse(localStorage.getItem('akoro_user')) || {}).id || null; } catch { return null; } })();
  const barId = course?.id && lesson?.id ? `course-${course.id}-${lesson.id}` : null;

  useEffect(() => {
    if (uid && barId) {
      setNowStudying(uid, {
        type: 'course', id: barId,
        title: lesson?.title || course?.title || 'Lesson',
        sub: course?.title || 'Course',
        emoji: 'ti-video',
        progress: lesson?.done ? 100 : (lesson?.progress || 0),
        snapshot: { slug: course?.slug, lessonId: lesson?.id },
      });
    }
    // Park once per session — the bar id already encodes course + lesson,
    // and the parent holds course/lesson in state (their fields change
    // together with the id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barId, uid]);

  /* ── The chat pump — lives HERE so the conversation survives the pane
     moving between the desktop split and the standalone surface. Same
     seam as the dashboard agent chat: own a session, stream turns,
     plain-JSON fallback, honest connection errors. ── */
  const [agent, setAgent] = useState({ name: 'NaNa Esumai', emoji: '🤖' });
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [messages, setMessages] = useState(() => [
    { id: 1, from: 'agent', text: 'Hi! I\u2019m your agent \u2014 ask me anything about this lesson while you watch.', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
  ]);
  const chatSessionRef  = useRef(null);
  const chatCreatingRef = useRef(null);

  const chatTitle = `${course?.title || 'Course'} · ${lesson?.title || 'Lesson'}`;

  /* The learner's agent, best effort — the dashboard shows the same name. */
  useEffect(() => {
    let alive = true;
    apiGet('/api/user/agent')
      .then((res) => {
        const d = res?.data ?? res;
        if (!alive || !d?.agent_name) return;
        setAgent({ name: d.agent_name, emoji: d.agent_emoji || '🤖' });
        setMessages((prev) => prev.map((m, i) => (i === 0 ? { ...m, text: `Hi! I'm ${d.agent_name} ${d.agent_emoji || '🤖'} — ask me anything about this lesson while you watch.` } : m)));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  /* Lazily create the chat session on first message; concurrency-safe. */
  const ensureChatSession = async (firstText) => {
    if (chatSessionRef.current) return chatSessionRef.current;
    if (chatCreatingRef.current) return chatCreatingRef.current;
    chatCreatingRef.current = (async () => {
      try {
        const d = await apiPost('/api/adaptive/chat/sessions', { title: firstText ? `${chatTitle} — ${firstText}` : chatTitle });
        const id = d?.session?.id ?? null;
        if (id) chatSessionRef.current = id;
        return id;
      } catch { return null; }
      finally { chatCreatingRef.current = null; }
    })();
    return chatCreatingRef.current;
  };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput('');
    setMessages((prev) => [...prev, { id: Date.now(), from: 'me', text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
    setChatLoading(true);

    const sid = await ensureChatSession(text);
    if (!sid) {
      setMessages((prev) => [...prev, { id: Date.now() + 1, from: 'agent', text: 'I couldn\u2019t reach the chat service. Check your connection and try again.', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
      setChatLoading(false);
      return;
    }

    const history = messages.map((m) => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text })).slice(-24);
    const payload = { message: text, history, agentName: agent.name, mode: 'default', conversationId: sid, turnId: createAgentChatTurnId() };
    const replyId = Date.now() + Math.random();
    let started = false;
    const ensureBubble = () => {
      if (started) return;
      started = true;
      setChatLoading(false);
      setMessages((prev) => [...prev, { id: replyId, from: 'agent', text: '', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
    };
    const appendDelta = (chunk) => {
      ensureBubble();
      setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, text: m.text + chunk } : m)));
    };

    try {
      const finalReply = await streamPost(agentChatEndpoint({ stream: true }), payload, { onDelta: appendDelta });
      if (!started) {
        setMessages((prev) => [...prev, { id: replyId, from: 'agent', text: finalReply || 'Hmm, I came back empty. Try asking again?', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
      } else if (typeof finalReply === 'string' && finalReply) {
        setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, text: finalReply } : m)));
      }
    } catch {
      // Stream died before any token — retry the same idempotent turn as JSON.
      if (!started) {
        try {
          const data = await apiPost(agentChatEndpoint(), payload);
          setMessages((prev) => [...prev, { id: replyId, from: 'agent', text: data?.reply || data?.response || 'I couldn\u2019t reach the chat service. Check your connection and try again.', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
        } catch {
          setMessages((prev) => [...prev, { id: replyId, from: 'agent', text: 'I couldn\u2019t reach the chat service. Check your connection and try again.', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
        }
      }
    } finally {
      setChatLoading(false);
    }
  };

  /* The same stream fetch the course player performs — one timeline. */
  useEffect(() => {
    let alive = true;
    completedRef.current = false;
    setStream(null);
    setErr('');
    if (!lesson?.id) { setState('empty'); return; }
    setState('loading');
    fetch(`${API}/api/lessons/${lesson.id}`, { credentials: 'include' })
      .then(async (r) => {
        if (!alive) return null;
        if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'You may need to enrol to watch this lesson.' : 'Couldn\u2019t load this lesson.');
        return r.json();
      })
      .then((res) => {
        if (!alive) return;
        const d = res?.data || res || {};
        if (!d.video_url) { setState('empty'); return; }   // lesson exists, video not published yet
        setStream({ url: d.video_url, lastPosition: d.progress?.last_position_seconds || 0 });
        setState('ready');
      })
      .catch((e) => { if (alive) { setErr(e?.message || 'Couldn\u2019t load this lesson.'); setState('error'); } });
    return () => { alive = false; };
    // Keyed on the lesson identity + explicit retries.
  }, [lesson?.id, retry]);

  /* Persist position/completion — the same endpoints and rules the
     course player uses (every ~10s, complete within 5s of the end). */
  const saveProgress = ({ time, duration }) => {
    if (!lesson?.id || !Number.isFinite(duration) || duration <= 0) return;
    const position = Math.floor(time || 0);
    fetch(`${API}/api/lessons/${lesson.id}/progress`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position }),
    }).catch(() => {});
    const pct = Math.max(0, Math.min(100, Math.round((position / duration) * 100)));
    if (pct !== videoPct) setVideoPct(pct);
    if (uid && barId) updateNowProgress(uid, barId, pct);
    if (!completedRef.current && position >= duration - 5) {
      completedRef.current = true;
      fetch(`${API}/api/lessons/${lesson.id}/complete`, { method: 'POST', credentials: 'include' }).catch(() => {});
      setVideoPct(100);
      if (uid && barId) updateNowProgress(uid, barId, 100);
    }
  };

  const lessonTitle = lesson?.title || course?.title || 'Lesson';
  const courseTitle = course?.title || 'Course';

  /* ── The content box — one tap from the chat to the material ── */
  const contentBox = (
    <div style={{ padding: '0 14px 10px', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => state === 'ready' && setReaderOpen(true)}
        disabled={state !== 'ready'}
        title={state === 'ready' ? 'Open the lesson' : state === 'loading' ? 'Opening the lesson…' : state === 'empty' ? 'Video coming soon' : err}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px',
          borderRadius: 14, cursor: state === 'ready' ? 'pointer' : 'default',
          background: 'var(--ak-surface)', border: `1.5px solid ${state === 'ready' ? `${BRAND}45` : 'var(--ak-border2)'}`,
          opacity: state === 'ready' ? 1 : 0.75, textAlign: 'left',
          fontFamily: "'Nunito',sans-serif",
        }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: state === 'error' ? 'rgba(239,68,68,.12)' : `${BRAND}16` }}>
          {state === 'loading' && <Icon name="ti-loader-2" size={16} color={BRAND} style={{ animation: 'sesc-spin 1s linear infinite' }}/>}
          {state === 'ready'   && <Icon name="ti-player-play" size={15} color={BRAND}/>}
          {state === 'empty'   && <Icon name="ti-video-off" size={16} color="var(--ak-text-sub)"/>}
          {state === 'error'   && <Icon name="ti-cloud-off" size={16} color={RED}/>}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {lessonTitle}
          </span>
          <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-sub)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {state === 'loading' ? 'Opening the lesson…'
              : state === 'empty' ? 'Video coming soon — this lesson has no video yet'
              : state === 'error' ? err
              : `${courseTitle} · tap to watch`}
          </span>
          {state === 'ready' && (
            <span style={{ display: 'block', height: 3.5, borderRadius: 99, background: 'var(--ak-tag-bg)', marginTop: 5, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${videoPct}%`, borderRadius: 99, background: `linear-gradient(90deg,${BRAND}AA,${BRAND})`, transition: 'width .4s' }}/>
            </span>
          )}
        </span>
        {state === 'ready' && <Icon name="ti-chevron-right" size={15} color="var(--ak-text-sub)" style={{ flexShrink: 0 }}/>}
        {state === 'error' && (
          <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setRetry((r) => r + 1); }}
            style={{ fontSize: 10.5, fontWeight: 800, color: BRAND, flexShrink: 0, padding: '4px 8px', borderRadius: 99, background: `${BRAND}12` }}>
            Retry
          </span>
        )}
      </button>
    </div>
  );

  const chatPane = (
    <SessionChatPane
      title={`${courseTitle} · ${lessonTitle}`}
      agent={agent}
      messages={messages}
      input={chatInput}
      loading={chatLoading}
      contentBox={contentBox}
      onClose={onClose}
      onInputChange={setChatInput}
      onSend={sendChat}
    />
  );

  /* Desktop split: the chat lives INSIDE the reader's right column — the
     pane is mounted exactly once either way, so the conversation (and its
     scroll) survives every view switch. */
  const showReader = readerOpen && !!stream;   // never an empty reader pane
  const split = !isMobile && showReader;

  return (
    <>
      {/* The chat surface — the session's home. On mobile the reader
          covers it while open (audio keeps playing underneath). */}
      {!split && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3050, background: 'var(--ak-bg)', display: 'flex', justifyContent: 'center', animation: 'sheet-up .32s cubic-bezier(.32,1.1,.64,1)' }}>
          <div style={{ width: '100%', maxWidth: 560, height: '100%', minHeight: 0, borderLeft: '1px solid var(--ak-border)', borderRight: '1px solid var(--ak-border)' }}>
            {chatPane}
          </div>
        </div>
      )}

      {/* The reader — the material. Mobile: full-screen over the chat,
          its chat button returns to the chat. Desktop: the split. */}
      {showReader && (
        <SessionReaderModal
          docTitle={courseTitle}
          sourceName={`Agent session · ${lessonTitle}`}
          pages={[]}
          onClose={() => setReaderOpen(false)}
          onOpenChat={() => setReaderOpen(false)}
          chatNode={split ? chatPane : null}
          media={stream ? {
            kind: 'video',
            src: stream.url,
            title: lessonTitle,
            startAt: stream.lastPosition,
            onTimeUpdate: saveProgress,
            // Course streams are presigned and expiring — no download seam here.
          } : null}
        />
      )}
    </>
  );
}
