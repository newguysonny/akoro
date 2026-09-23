/**
 * AgentSessionViewer.jsx — "Agent session" on a course details page.
 *
 * The learner and their agent sit over the COURSE VIDEO in the same
 * session reader the teaching sessions and library records use: the tab
 * strip, the Generate tools, Q&A and Discussion boards — with the video
 * itself as the content, driven by the shared toolbar (play/pause, ±10s,
 * 0.75×–2× speed).
 *
 * The video comes from the same seam the course player uses
 * (GET /api/lessons/:id → video_url), resumes from the learner's last
 * position, and persists position/completion the same way (progress
 * every ~10s, complete near the end) — so watching here and watching in
 * the course player are one continuous timeline, not two.
 *
 * Word on tools: a video carries no extractable text, so generated tools
 * say so honestly (the Q&A and Discussion boards work regardless — the
 * learner can ask their agent over what they're watching).
 */

import { useEffect, useRef, useState } from 'react';
import SessionReaderModal from '../teaching/SessionReaderModal.jsx';
import { API } from '../../services/api.js';
import { Icon } from '../common/Icons.jsx';
import { BRAND, RED } from '../../constants.js';

export default function AgentSessionViewer({ course, lesson, onClose }) {
  const [state, setState] = useState(lesson?.id ? 'loading' : 'empty');  // loading | ready | error | empty
  const [err, setErr]     = useState('');
  const [stream, setStream] = useState(null);                            // { url, lastPosition }
  const completedRef = useRef(false);

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
  }, [lesson?.id]);

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
    if (!completedRef.current && position >= duration - 5) {
      completedRef.current = true;
      fetch(`${API}/api/lessons/${lesson.id}/complete`, { method: 'POST', credentials: 'include' }).catch(() => {});
    }
  };

  /* Loading / error / empty overlays — the viewer's own family. */
  if (state !== 'ready') {
    const isErr = state === 'error';
    return (
      <div role="dialog" aria-label="Opening agent session"
        style={{ position: 'fixed', inset: 0, zIndex: 3100, background: 'var(--ak-bg)', display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'Nunito',sans-serif",
          animation: 'sheet-up .32s cubic-bezier(.32,1.1,.64,1)' }}>
        <div style={{ width: 46, height: 46, borderRadius: 14,
          background: isErr ? 'rgba(239,68,68,.12)' : `${BRAND}18`,
          border: isErr ? '1px solid rgba(239,68,68,.3)' : `1px solid ${BRAND}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <Icon name={isErr ? 'ti-cloud-off' : 'ti-video'} size={22} color={isErr ? RED : BRAND}/>
        </div>
        <p style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--ak-text)', margin: '0 0 6px', textAlign: 'center', padding: '0 20px' }}>
          {lesson?.title || course?.title || 'Agent session'}
        </p>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0, maxWidth: 300, textAlign: 'center', lineHeight: 1.55 }}>
          {state === 'loading' ? (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span className="ti ti-loader-2" style={{ fontSize: 14, color: BRAND, animation: 'spin 1s linear infinite' }}/>
            Opening the lesson with your agent…
          </span>)
          : state === 'empty' ? 'Video coming soon — this lesson has no video yet.'
          : err}
        </p>
        <button onClick={onClose} style={{ marginTop: 18, background: 'var(--ak-tag-bg)', border: 'none', borderRadius: 100,
          padding: '10px 22px', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-sub)', cursor: 'pointer',
          fontFamily: "'Nunito',sans-serif" }}>Close</button>
      </div>
    );
  }

  return (
    <SessionReaderModal
      docTitle={course?.title || 'Course'}
      sourceName={`Agent session${lesson?.title ? ` · ${lesson.title}` : ''}`}
      pages={[]}
      onClose={onClose}
      media={{
        kind: 'video',
        src: stream.url,
        title: lesson?.title || course?.title || 'Lesson',
        startAt: stream.lastPosition,
        onTimeUpdate: saveProgress,
        // Course streams are presigned and expiring — no download seam here.
      }}
    />
  );
}
