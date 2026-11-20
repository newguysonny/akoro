/**
 * Course details — lesson video player and curriculum.
 */
import { useState, useEffect, useRef } from 'react';
import { Play, BookOpen, ChevronDown, Lock, Check, MoreVertical } from 'lucide-react';
import { API } from '../../../services/api.js';
import { BRAND } from '../../../constants.js';
import { Icon } from '../../../components/common/Icons.jsx';
import { card, MUTED2, FONT, INK, BORDER } from './parts-rules.js';

/* ── HLS video player ─────────────────────────────────────── */
function VideoPlayer({ lesson, courseEmoji = 'ti-book' }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const saveRef = useRef(0);
  const [stream, setStream] = useState(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    let alive = true;
    if (!lesson?.id) { setStream(null); setStatus('empty'); return; }
    setStatus('loading');
    fetch(`${API}/api/lessons/${lesson.id}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (!alive) return;
        const d = res?.data || res || {};
        if (!d.video_url) { setStream(null); setStatus('empty'); return; }
        setStream({ url: d.video_url, lastPosition: d.progress?.last_position_seconds || 0 });
        setStatus('ready');
      })
      .catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; };
  }, [lesson?.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream?.url) return;
    let cancelled = false;
    const start = () => {
      if (stream.lastPosition && stream.lastPosition < (video.duration || Infinity)) {
        try { video.currentTime = stream.lastPosition; } catch { /* ignore */ }
      }
    };
    const isHls = /\.m3u8($|\?)/i.test(stream.url);
    let detach = () => {};
    (async () => {
      if (isHls) {
        const Hls = (await import('hls.js')).default;
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true });
          hlsRef.current = hls;
          hls.loadSource(stream.url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, start);
          detach = () => { try { hls.destroy(); } catch { /* ignore */ } hlsRef.current = null; };
          return;
        }
      }
      video.src = stream.url;
      video.addEventListener('loadedmetadata', start, { once: true });
      detach = () => { video.removeAttribute('src'); video.load?.(); };
    })();
    return () => { cancelled = true; detach(); };
  }, [stream]);

  const onTime = () => {
    const video = videoRef.current;
    if (!video || !lesson?.id || !video.duration) return;
    const now = Date.now();
    if (now - saveRef.current < 10000) return;
    saveRef.current = now;
    const position = Math.floor(video.currentTime);
    fetch(`${API}/api/lessons/${lesson.id}/progress`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position }) }).catch(() => {});
    if (position >= video.duration - 5) fetch(`${API}/api/lessons/${lesson.id}/complete`, { method: 'POST', credentials: 'include' }).catch(() => {});
  };

  return (
    <div style={{ position: 'relative', background: '#000', aspectRatio: '16/9', width: '100%' }}>
      {status === 'ready' && stream?.url ? (
        <video ref={videoRef} controls playsInline onTimeUpdate={onTime} style={{ width: '100%', height: '100%', background: '#000' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', minHeight: 240, background: 'linear-gradient(135deg,#0d1a2e,#1a1f3a,#0d2137)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div style={{ fontSize: 64, opacity: 0.5 }}>{courseEmoji?.startsWith('ti-') ? <Icon name={courseEmoji} size={64}/> : (courseEmoji || <Icon name="ti-book" size={64}/>)}</div>
          <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 16, fontWeight: 800, textAlign: 'center', padding: '0 20px' }}>{lesson?.title || 'Lesson'}</div>
          <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 12 }}>{status === 'loading' ? 'Loading stream…' : status === 'error' ? "Couldn't load this lesson" : 'Video coming soon'}</div>
        </div>
      )}
    </div>
  );
}

/* ── curriculum (shared) ──────────────────────────────────── */
function Curriculum({ modules, isEnrolled, hours, onPick, currentTitle, onLessonMore }) {
  const [open, setOpen] = useState(0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: MUTED2 }}>
        {modules.reduce((a, m) => a + m.lessons.length, 0)} lessons · {hours} total hours
        {!isEnrolled && <span style={{ marginLeft: 8, color: BRAND, fontWeight: 800 }}>— Enrol to unlock all content</span>}
      </div>
      {modules.map((m, mi) => {
        const done = m.lessons.filter((l) => l.done).length;
        const pct = Math.round((done / m.lessons.length) * 100);
        const unlocked = isEnrolled || mi === 0;
        return (
          <div key={mi} style={{ ...card, overflow: 'hidden' }}>
            <button onClick={() => setOpen(open === mi ? -1 : mi)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: 16, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: FONT }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, background: isEnrolled && pct === 100 ? '#E8F8EE' : isEnrolled && pct > 0 ? `${BRAND}18` : '#F0ECE6', color: isEnrolled && pct === 100 ? '#2AA76E' : isEnrolled && pct > 0 ? BRAND : MUTED2 }}>{isEnrolled && pct === 100 ? <Check size={11} /> : mi + 1}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: INK, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {m.title}{!unlocked && <Lock size={12} color="#C9C5BE" />}
                    {mi === 0 && !isEnrolled && <span style={{ fontSize: 9, fontWeight: 900, padding: '1px 7px', borderRadius: 100, background: '#E8F8EE', color: '#2AA76E' }}>Free preview</span>}
                  </div>
                  <div style={{ fontSize: 12, color: MUTED2 }}>{m.lessons.length} lessons{isEnrolled && ` · ${done}/${m.lessons.length} done · ${pct}%`}</div>
                </div>
              </div>
              <ChevronDown size={15} color={MUTED2} style={{ transform: open === mi ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }} />
            </button>
            {open === mi && (
              <div style={{ borderTop: `1px solid ${BORDER}` }}>
                {m.lessons.map((l, li) => {
                  const active = currentTitle && l.title === currentTitle;
                  const clickable = unlocked && l.type === 'video' && onPick;
                  return (
                    <div key={li} onClick={() => clickable && onPick({ ...l, module: m.title })}
                      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 16px', borderBottom: li < m.lessons.length - 1 ? `1px solid ${BORDER}` : 'none', cursor: clickable ? 'pointer' : unlocked ? 'default' : 'not-allowed', opacity: unlocked ? 1 : 0.5, background: active ? `${BRAND}10` : 'transparent' }}>
                      <div style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0, background: isEnrolled && l.done ? BRAND : unlocked ? '#EDE8E1' : '#F0ECE6', color: isEnrolled && l.done ? '#fff' : MUTED2 }}>{isEnrolled && l.done ? <Check size={10} /> : !unlocked ? <Lock size={9} /> : li + 1}</div>
                      {l.type === 'video' ? <Play size={12} color={unlocked ? BRAND : '#C9C5BE'} /> : <BookOpen size={12} color={unlocked ? BRAND : '#C9C5BE'} />}
                      <span style={{ flex: 1, fontSize: 13.5, color: unlocked ? INK : '#C9C5BE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</span>
                      <span style={{ fontSize: 11, color: MUTED2 }}>{l.duration}</span>
                      {isEnrolled && l.done && <span style={{ fontSize: 10, fontWeight: 800, color: '#2AA76E', background: '#E8F8EE', padding: '1px 8px', borderRadius: 100 }}>Done</span>}
                      {isEnrolled && onLessonMore && (
                        <button aria-label={`More for ${l.title}`}
                          onClick={(e) => { e.stopPropagation(); onLessonMore({ ...l, module: m.title }); }}
                          style={{ background: 'none', border: 'none', padding: 4, margin: '-4px -2px -4px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', color: MUTED2, flexShrink: 0 }}>
                          <MoreVertical size={14}/>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { VideoPlayer, Curriculum };
