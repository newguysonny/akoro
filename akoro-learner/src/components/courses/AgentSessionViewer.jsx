/**
 * AgentSessionViewer.jsx — "Agent session" on a course details page.
 *
 * A real TEACHING session over the lesson video: the learner and their
 * agent run the same WebSocket teach-back flow a "Start teaching" session
 * runs (confidence, turn budget, continuation, revision history) — with the
 * LESSON VIDEO as the material:
 *
 *   · The content box above the composer shows the lesson — one tap opens
 *     the reader (video + Generate tools + Q&A), mobile full-screen over
 *     the chat, desktop/tablet side by side (the Fortizo split).
 *   · One timeline with the course player: the reader fetches the same
 *     stream seam (GET /api/lessons/:id), resumes from
 *     last_position_seconds, and persists position (~10s) and completion
 *     (within 5s of the end).
 *   · The session PARKS on the Now-Studying bar (type 'course', snapshot
 *     {slug, lessonId}) so the bar reopens it on the exact lesson.
 *     Guests get an honest sign-in prompt instead of a broken session.
 *   · Continuation: the teaching session's id is remembered per lesson
 *     (sessionStorage, 24h), so reopening continues the thread.
 *
 * Honest states live in the content box — the chat works regardless of
 * whether the video is available: "Opening the lesson…" while loading,
 * "Video coming soon" when the lesson has no video, the real error when
 * the stream is inaccessible.
 */

import { useEffect, useRef, useState } from 'react';
import TeachAgentModal from '../teaching/TeachAgentModal.jsx';
import { API } from '../../services/api.js';
import { startLessonTranscription, getLessonTranscriptionStatus } from '../../services/recordsApi.js';
import { setNowStudying, updateNowProgress } from '../../utils/nowStudying.js';
import { BRAND } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';

/* sessionStorage continuation — one teaching thread per lesson, 24h. */
const sidKey = (lid) => `akoro_teach_sid_lesson_${lid || 'x'}`;
const readStoredSid = (lid) => {
  try {
    const raw = JSON.parse(sessionStorage.getItem(sidKey(lid)) || 'null');
    return raw?.sid && Date.now() - (raw.at || 0) < 86_400_000 ? raw.sid : null;
  } catch { return null; }
};
const storeSid = (lid, sid) => {
  try { sid ? sessionStorage.setItem(sidKey(lid), JSON.stringify({ sid, at: Date.now() })) : sessionStorage.removeItem(sidKey(lid)); }
  catch { /* private mode */ }
};

export default function AgentSessionViewer({ course, lesson, onClose }) {
  /* Video stream — same seam as the course player. */
  const [state, setState] = useState(lesson?.id ? 'loading' : 'empty');  // loading | ready | error | empty
  const [err, setErr]     = useState('');
  const [stream, setStream] = useState(null);                            // { url, lastPosition }
  const [videoPct, setVideoPct] = useState(lesson?.done ? 100 : (lesson?.progress || 0));
  const completedRef = useRef(false);

  /* Guests can't run teaching sessions — say so instead of failing dark. */
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
    // Park once per session — the bar id already encodes course + lesson.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barId, uid]);

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
    // Keyed on the lesson identity — reopening the session retries naturally.
  }, [lesson?.id]);

  /* ── The transcript lane ──────────────────────────────────────────────
     A course video transcribes ONCE (shared cache keyed by the lesson):
     the first learner to ask pays for it, everyone after grounds
     instantly. Cached → the session opens already grounded; not cached →
     the reader offers, and the transcript grounds on arrival. */
  const [avState, setAvState] = useState('idle');        // idle | running | ready | failed
  const [avTranscript, setAvTranscript] = useState(null);
  const [avError, setAvError] = useState(null);
  const [avReference, setAvReference] = useState(null);  // grounds the agent

  /* Cached transcript on open — one status call, instant ground. */
  useEffect(() => {
    let cancelled = false;
    if (!lesson?.id || state !== 'ready') return;
    getLessonTranscriptionStatus(lesson.id).then((d) => {
      if (cancelled) return;
      const segs = d?.transcript?.segments || [];
      if (segs.length) {
        setAvTranscript({ segments: segs });
        setAvReference({
          name: lesson?.title || 'Lesson video',
          text: (d.transcript.text || segs.map((s) => (s.speaker ? `[${s.speaker}] ${s.text}` : s.text)).join('\n\n')).slice(0, 12_000),
        });
        setAvState('ready');
      }
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id, state]);

  /* The offer → poll → ground flow (same shape the library records use). */
  const startTranscription = async () => {
    if (!lesson?.id || avState === 'running' || avState === 'ready') return;
    setAvState('running');
    setAvError(null);
    try {
      // 409 is fine — someone else's job is already running; it is shared.
      await startLessonTranscription(lesson.id).catch(() => {});
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000));
        const d = await getLessonTranscriptionStatus(lesson.id);
        if (d?.job && !d.job.running) {
          if (d.job.result?.ok === false) throw new Error(d.job.result.error || 'Transcription failed.');
          if (!d.transcript?.segments?.length && !d.job.running) break;   // done but empty → final read below
        }
        if (d?.transcript?.segments?.length) {
          const segs = d.transcript.segments;
          setAvTranscript({ segments: segs });
          setAvReference({
            name: lesson?.title || 'Lesson video',
            text: (d.transcript.text || segs.map((s) => (s.speaker ? `[${s.speaker}] ${s.text}` : s.text)).join('\n\n')).slice(0, 12_000),
          });
          setAvState('ready');
          return;
        }
      }
      const d = await getLessonTranscriptionStatus(lesson.id);
      if (!d?.transcript?.segments?.length) throw new Error('No speech came out of this video.');
    } catch (e) {
      setAvState('failed');
      setAvError(e?.message || 'Transcription failed.');
    }
  };

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

  /* ── Guests: honest sign-in prompt, no dark failure ── */
  if (!uid) {
    return (
      <div role="dialog" aria-label="Sign in to start an agent session"
        style={{ position: 'fixed', inset: 0, zIndex: 3100, background: 'var(--ak-bg)', display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'Nunito',sans-serif",
          animation: 'sheet-up .32s cubic-bezier(.32,1.1,.64,1)' }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: `${BRAND}18`, border: `1px solid ${BRAND}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <Icon name="ti-lock" size={22} color={BRAND}/>
        </div>
        <p style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 6px' }}>Agent sessions need an account</p>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)', margin: '0 0 18px', maxWidth: 300, textAlign: 'center', lineHeight: 1.55 }}>
          Sign in to teach your agent over “{lessonTitle}” — your agent remembers every session.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <a href={`/signin?next=/course/${course?.slug || ''}`} style={{ textDecoration: 'none', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', fontSize: 12.5, fontWeight: 800, padding: '11px 20px', borderRadius: 100, fontFamily: "'Nunito',sans-serif" }}>Sign in</a>
          <button onClick={onClose} style={{ background: 'var(--ak-tag-bg)', border: 'none', borderRadius: 100,
            padding: '10px 22px', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sub)', cursor: 'pointer',
            fontFamily: "'Nunito',sans-serif" }}>Close</button>
        </div>
      </div>
    );
  }

  /* ── The teaching session, with the lesson video as its material ── */
  const content = {
    state,
    err,
    box: {
      icon: 'ti-player-play',
      title: lessonTitle,
      sub: state === 'loading' ? 'Opening the lesson…'
        : state === 'empty' ? 'Video coming soon — this lesson has no video yet'
        : state === 'error' ? err
        : avState === 'ready' ? `${courseTitle} · transcript attached — tap to watch`
        : `${courseTitle} · tap to watch`,
    },
    pct: state === 'ready' ? videoPct : null,
    docTitle: courseTitle,
    sourceName: `Agent session · ${lessonTitle}`,
    media: stream ? {
      kind: 'video',
      src: stream.url,
      title: lessonTitle,
      startAt: stream.lastPosition,
      onTimeUpdate: saveProgress,
      // Course streams are presigned and expiring — no download seam here.
    } : null,
    transcript: avState === 'ready' ? avTranscript : null,
    onTranscribe: stream && avState !== 'ready' ? startTranscription : null,
    transcribeState: avState === 'failed' ? 'failed' : avState === 'running' ? 'running' : 'idle',
    transcribeError: avError,
    pages: [],
  };

  /* A remembered session id (24h) makes reopening a lesson CONTINUE its
     teaching thread — same continuation the Learn shelf gives. */
  const priorSid = readStoredSid(lesson?.id);

  return (
    <TeachAgentModal
      config={{
        chatState: 'agent',
        topic: lessonTitle,
        subject: course?.subject || 'General',
        ...(priorSid ? { sessionId: priorSid, mode: 'continuation' } : {}),
        ...(avReference ? { reference: avReference } : {}),
      }}
      content={content}
      onClose={onClose}
      onMinimize={onClose}
      onSessionSaved={(sid) => storeSid(lesson?.id, sid)}
    />
  );
}
