/**
 * CourseDetailsPage — constants + section/child components.
 */
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronDown, Play, Users, Clock, Star, Globe, Lock,
  CheckCircle2, Radio, ShoppingCart, CalendarPlus, MonitorPlay, BookOpen,
  Brain, Award, Swords, TrendingUp, Calendar, ArrowRight, Share2, Flag, Check, Plus, Video, Crown, PartyPopper, MoreVertical,
  Bot, Gem, Zap, Tornado, Sparkles, Triangle,
} from 'lucide-react';
import { API, apiPost } from '../../services/api.js';
import { BRAND } from '../../constants.js';
import { Icon } from '../../components/common/Icons.jsx';
import { AgentAvatar } from '../../components/common/AgentAvatar.jsx';
import BattleModal from '../../features/battles/index.js';

/* ── palette ──────────────────────────────────────────────── */

const INK = '#1A1A2E', MUTED = '#6B6B80', MUTED2 = '#9490A0', BORDER = '#EDE8E1';
const LIGHT = '#FAF8F5', BG = '#F7F5F2', GREEN = '#10B981', RED = '#EF4444', GOLD = '#F59E0B';
const FONT = "'Nunito', sans-serif";

const GlobalCss = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
    @keyframes cp-pulse{0%,100%{opacity:1}50%{opacity:.35}}
    @keyframes cp-spin{to{transform:rotate(360deg)}}
    .cp-scroll::-webkit-scrollbar{height:6px}
    .cp-scroll::-webkit-scrollbar-thumb{background:#DDD8CF;border-radius:3px}
  `}</style>
);

/* ── primitives ───────────────────────────────────────────── */
const card = { background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 18, fontFamily: FONT };

function Btn({ children, variant = 'primary', size = 'md', onClick, style }) {
  const sizes = { sm: { padding: '7px 14px', fontSize: 12.5 }, md: { padding: '10px 18px', fontSize: 13.5 }, lg: { padding: '13px 24px', fontSize: 14.5 } };
  const variants = {
    primary: { background: BRAND, color: '#fff', border: `1.5px solid ${BRAND}` },
    red:     { background: RED, color: '#fff', border: `1.5px solid ${RED}` },
    green:   { background: GREEN, color: '#fff', border: `1.5px solid ${GREEN}` },
    outline: { background: '#fff', color: '#3A3A52', border: `1.5px solid #D4CEC4` },
    ghost:   { background: 'transparent', color: MUTED, border: '1.5px solid transparent' },
    glass:   { background: 'rgba(255,255,255,.12)', color: '#fff', border: '1.5px solid rgba(255,255,255,.3)' },
  };
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontFamily: FONT, fontWeight: 800, borderRadius: 100, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s', ...sizes[size], ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

/* Avatar — a colored disc. Static UI passes a lucide icon (preferred) or
   initials; a ti-* string renders through Tabler; a stored agent_emoji
   draws its AgentAvatar glyph (unknown keys draw the bot). */
const Avatar = ({ icon: Ico, initials, emoji, bg = BORDER, size = 40, ring, color }) => (
  <div style={{ width: size, height: size, background: bg, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.32), fontWeight: 900, letterSpacing: 0.4, color: color || MUTED2, boxShadow: ring ? `0 0 0 2px #fff,0 0 0 4px ${BRAND}` : 'none' }}>
    {Ico ? <Ico size={Math.round(size * 0.46)} color={color || MUTED2}/> : initials ? initials : emoji ? <AgentAvatar emoji={emoji} size={Math.round(size * 0.62)}/> : null}
  </div>
);

const LiveBadge = () => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 100, background: RED, color: '#fff', fontSize: 10, fontWeight: 900 }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', animation: 'cp-pulse 1.3s ease infinite' }} />LIVE
  </span>
);

const StarRow = ({ rating, count }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: MUTED }}>
    <span style={{ display: 'flex' }}>{[...Array(5)].map((_, i) => <Star key={i} size={12} fill={i < Math.round(rating || 0) ? GOLD : 'none'} stroke={i < Math.round(rating || 0) ? 'none' : '#C9C5BE'} strokeWidth={1.5} />)}</span>
    <strong style={{ color: INK }}>{rating || '—'}</strong>{count && <span>({count})</span>}
  </span>
);

const PLATFORMS = { zoom: ['#2D8CFF', 'Zoom'], meet: ['#34A853', 'Google Meet'], teams: ['#5B5EA6', 'MS Teams'], youtube: ['#FF0000', 'YouTube Live'] };
const PlatformBadge = ({ platform }) => {
  const cfg = PLATFORMS[platform];
  if (!cfg) return null;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 100, background: cfg[0], color: '#fff', fontSize: 10, fontWeight: 800 }}><Video size={10} />{cfg[1]}</span>;
};

function ActionChips({ course, onAgentSession }) {
  const [calAdded, setCalAdded] = useState(false);
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    try {
      if (navigator.share) { await navigator.share({ title: course.title, url }); return; }
      await navigator.clipboard.writeText(url);
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { /* cancelled */ }
  };
  const chips = [
    { key: 'cal', label: calAdded ? 'Added' : 'Add to calendar', icon: <CalendarPlus size={13} />, active: calAdded, onClick: () => setCalAdded((v) => !v) },
    { key: 'agent', label: 'Agent session', icon: <Brain size={13} />, onClick: () => onAgentSession?.() },
    { key: 'share', label: copied ? 'Link copied' : 'Share class', icon: copied ? <Check size={13} /> : <Share2 size={13} />, active: copied, onClick: share },
    { key: 'host', label: 'Host revision session', icon: <Plus size={13} />, onClick: () => {} },
    { key: 'report', label: 'Report', icon: <Flag size={13} />, onClick: () => {} },
  ];
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {chips.map((a) => (
        <button key={a.key} onClick={a.onClick} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 100, cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 800, border: `1.5px solid ${a.active ? BRAND : '#DDD8CF'}`, background: a.active ? BRAND : '#fff', color: a.active ? '#fff' : MUTED }}>
          {a.icon}{a.label}
        </button>
      ))}
    </div>
  );
}

const SectionTitle = ({ children, sub }) => (
  <div style={{ marginBottom: 14 }}>
    <h2 style={{ fontFamily: FONT, fontSize: 20, fontWeight: 900, color: INK, margin: 0 }}>{children}</h2>
    {sub && <p style={{ fontSize: 13, color: MUTED, margin: '4px 0 0' }}>{sub}</p>}
  </div>
);

/* ── defaults (fallback when a course has no data yet) ─────── */
const DEFAULT_MODULES = [
  { title: 'Module 1: Foundations of Calculus', lessons: [
    { title: 'Introduction to limits', duration: '9min', done: false, type: 'video' },
    { title: 'Continuity & discontinuities', duration: '11min', done: false, type: 'video' },
    { title: 'The concept of a derivative', duration: '13min', done: false, type: 'video' },
    { title: 'Quiz: Limits', duration: '—', done: false, type: 'quiz' },
  ] },
  { title: 'Module 2: Differentiation Techniques', lessons: [
    { title: 'Chain Rule', duration: '14min', done: false, type: 'video' },
    { title: 'Product & Quotient Rule', duration: '16min', done: false, type: 'video' },
    { title: 'Implicit Differentiation', duration: '12min', done: false, type: 'video' },
    { title: 'Quiz: Differentiation', duration: '—', done: false, type: 'quiz' },
  ] },
];
const DEFAULT_COURSE = {
  title: 'Course', subject: 'General', level: 'All levels', rating: null, ratingCount: '',
  students: 0, hours: 0, instructor: 'Instructor', updated: '', priceLabel: 'Free',
  priceOld: null, emoji: 'ti-book', description: '', schedule: null, reviews: null, teachers: null,
};

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

/* ── reviews ──────────────────────────────────────────────── */
/* People get initials discs — typography, not emoji. */
const initialsOf = (name = '') => (String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')) || '?';
const RV_BG = ['#D4EAD8', '#E4D4F0', '#C8D8E8', '#F0E4C8', '#F8E8FF', '#FFE8C0'];
// Post a course review (enrolled learners only). Returns the saved review.
async function submitCourseReview(courseId, rating, comment) {
  const r = await fetch(`${API}/api/courses/${courseId}/reviews`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, comment }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Please sign in to review');
  if (r.status === 403) throw new Error('Enrol in this course to leave a review');
  if (!r.ok) throw new Error(d.message || 'Could not post review');
  return d.data || d;
}

function ReviewForm({ courseId }) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!rating || busy) return;
    setBusy(true); setErr('');
    try { await submitCourseReview(courseId, rating, text.trim()); setPosted(true); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (posted) return (
    <div style={{ ...card, padding: 16, marginBottom: 14, fontSize: 13.5, fontWeight: 700, color: '#2AA76E' }}><Check size={13} style={{ display: "inline-block", verticalAlign: "-2px" }} /> Thanks for your review!</div>
  );
  return (
    <div style={{ ...card, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 900, color: INK, marginBottom: 8 }}>Rate this course</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} onClick={() => setRating(i)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 1 }}>
            <Star size={24} fill={i <= rating ? GOLD : 'none'} color={i <= rating ? GOLD : '#CFC8BC'} strokeWidth={1.5} />
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Share what you thought… (optional)"
        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${BORDER}`, fontFamily: FONT, fontSize: 13, color: INK, background: '#fff', outline: 'none', resize: 'vertical' }} />
      {err && <div style={{ fontSize: 12, fontWeight: 600, color: '#EF4444', marginTop: 6 }}>{err}</div>}
      <Btn variant="primary" onClick={submit} style={{ marginTop: 10, opacity: (!rating || busy) ? .6 : 1 }}>{busy ? 'Posting…' : 'Submit review'}</Btn>
    </div>
  );
}

function Reviews({ reviews, courseId, canReview }) {
  const data = reviews?.length
    ? reviews.map((r, i) => ({ initials: initialsOf(r.name), bg: RV_BG[i % RV_BG.length], name: r.name, rating: r.rating, date: r.date, text: r.text }))
    : [
        { initials: 'CO', bg: '#D4EAD8', name: 'Chukwuemeka O.', rating: 5, date: '2 days ago', text: 'The lessons finally made calculus click for me. Loved the worked examples.' },
        { initials: 'NA', bg: '#E4D4F0', name: 'Ngozi A.', rating: 5, date: '1 week ago', text: 'Clear, well-paced and the quizzes really help retention.' },
        { initials: 'BF', bg: '#C8D8E8', name: 'Babatunde F.', rating: 4, date: '2 weeks ago', text: 'Solid course. Would love even more practice questions.' },
      ];
  return (
    <div>
      {canReview && courseId && <ReviewForm courseId={courseId} />}
      <div className="cp-scroll" style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
      {data.map((r, i) => (
        <div key={i} style={{ ...card, padding: 18, flex: '0 0 min(320px,82vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar initials={r.initials} bg={r.bg} size={40} />
            <div><div style={{ fontSize: 14, fontWeight: 800, color: INK }}>{r.name}</div><div style={{ fontSize: 11, color: MUTED2 }}>Student</div></div>
            <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 100, background: '#E8F8EE', color: '#2AA76E' }}>Verified</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex' }}>{[...Array(r.rating)].map((_, j) => <Star key={j} size={12} fill={GOLD} strokeWidth={0} />)}</div>
            <span style={{ fontSize: 11, color: MUTED2 }}>{r.date}</span>
          </div>
          <p style={{ fontSize: 13.5, color: '#3A3A52', lineHeight: 1.6, fontStyle: 'italic', margin: 0 }}>"{r.text}"</p>
        </div>
      ))}
      </div>
    </div>
  );
}

/* ── battles ──────────────────────────────────────────────── */
const AGENTS = [
  { id: 'nexus', name: 'Nexus', icon: Bot, owner: 'You', bg: `${BRAND}1A`, color: BRAND, isYou: true },
  { id: 'pythia', name: 'Pythia', icon: Gem, owner: 'Dr. Amara', bg: '#EDE8F8', color: '#7C3AED', isTeacher: true },
  { id: 'axiom', name: 'Axiom', icon: Zap, owner: 'Mr. Tobi', bg: '#FFF4C8', color: '#D97706', isTeacher: true },
  { id: 'zeno', name: 'Zeno', icon: Tornado, owner: 'Chukwuemeka', bg: '#D4EAD8', color: '#059669' },
  { id: 'ada', name: 'Ada', icon: Sparkles, owner: 'Ngozi', bg: '#E4D4F0', color: '#7C3AED' },
  { id: 'sigma', name: 'Sigma', icon: Triangle, owner: 'Babatunde', bg: '#C8D8E8', color: '#2563EB' },
];
const BATTLES = [
  { id: 1, topic: 'Chain Rule Gauntlet', a: 0, b: 1, sa: 7, sb: 5, status: 'live', viewers: 23 },
  { id: 2, topic: 'Limits Speed Round', a: 2, b: 3, sa: 4, sb: 6, status: 'live', viewers: 11 },
  { id: 3, topic: 'Integration Masters', a: 4, b: 5, sa: 0, sb: 0, status: 'upcoming', viewers: 0 },
  { id: 4, topic: 'WAEC Prep Battle', a: 1, b: 4, sa: 9, sb: 7, status: 'completed', viewers: 0 },
];

function BattleCard({ b, onOpen }) {
  // b.a / b.b may be agent indices (demo) or agent objects (real)
  const A = typeof b.a === 'object' ? b.a : AGENTS[b.a];
  const B = typeof b.b === 'object' ? b.b : AGENTS[b.b];
  const sa = b.sa != null ? b.sa : (A.score || 0), sb = b.sb != null ? b.sb : (B.score || 0);
  const aWin = b.status === 'completed' && sa > sb;
  const bWin = b.status === 'completed' && sb > sa;
  const Side = ({ ag, score, win }) => (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <Avatar icon={ag.icon} emoji={ag.emoji} color={ag.color} bg={ag.bg || `${ag.color || BRAND}1A`} size={42} ring={ag.isYou ? true : undefined} />
        {win && <div style={{ position: 'absolute', top: -8, right: -8, fontSize: 15 }}><Crown size={15} fill={GOLD} color={GOLD}/></div>}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: INK, marginTop: 4 }}>{ag.name}</div>
      {ag.owner && <div style={{ fontSize: 10.5, color: MUTED2 }}>{ag.owner}</div>}
      {ag.isTeacher && <div style={{ fontSize: 9, fontWeight: 800, color: BRAND }}>Teacher</div>}
      <div style={{ fontSize: 19, fontWeight: 900, color: ag.color, marginTop: 2 }}>{score}</div>
    </div>
  );
  return (
    <div style={{ ...card, padding: 18, flex: '0 0 min(300px,82vw)', display: 'flex', flexDirection: 'column', gap: 12, border: b.status === 'live' ? `1px solid ${BRAND}` : `1px solid ${BORDER}` }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: INK, marginBottom: 4 }}>{b.topic}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {b.status === 'live' && <LiveBadge />}
          {b.status === 'upcoming' && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 100, background: `${BRAND}14`, color: BRAND }}>Starting soon</span>}
          {b.status === 'completed' && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 100, background: '#E8F8EE', color: '#2AA76E' }}>Ended</span>}
          {b.status === 'live' && <span style={{ fontSize: 10.5, color: MUTED2, display: 'flex', alignItems: 'center', gap: 3 }}><Users size={10} />{b.viewers}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Side ag={A} score={sa} win={aWin} />
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: INK, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, flexShrink: 0 }}>VS</div>
        <Side ag={B} score={sb} win={bWin} />
      </div>
      <Btn variant={b.status === 'live' ? 'primary' : 'outline'} size="sm" style={{ width: '100%', opacity: b.id ? 1 : .6 }}
        onClick={() => b.id && onOpen?.(b)}>
        {b.status === 'live' ? <><Swords size={12} />Watch live</> : b.status === 'upcoming' ? <><Play size={12} />Preview</> : <>View result</>}
      </Btn>
    </div>
  );
}

function BattlesSection({ battles: real, leaderboard: realLb, lobbies }) {
  const BATTLE_LIST = real?.length ? real : BATTLES;
  const [filter, setFilter] = useState('all');
  const [openBattle, setOpenBattle] = useState(null);
  const [joining, setJoining] = useState(null);
  const [lobbyState, setLobbyState] = useState(null);
  const lobbyList = lobbyState ?? lobbies ?? [];

  const joinLobby = async (lb) => {
    if (joining) return;
    setJoining(lb.id);
    try {
      await apiPost(`/api/battle/battles/${lb.id}/join`, {});
      setLobbyState((prev) => (prev ?? lobbies ?? []).map((x) => x.id === lb.id ? { ...x, alreadyJoined: true } : x));
      setOpenBattle({ id: lb.id, status: 'lobby', topic: lb.topic });
    } catch { /* full / already in / expired — surfaced by disabled state */ }
    finally { setJoining(null); }
  };
  const live = BATTLE_LIST.filter((b) => b.status === 'live');
  const upcoming = BATTLE_LIST.filter((b) => b.status === 'upcoming');
  const completed = BATTLE_LIST.filter((b) => b.status === 'completed');
  const leaderboard = realLb?.length
    ? realLb.map((ag) => ({ ...ag, bg: `${ag.color || BRAND}1A` }))
    : AGENTS.map((ag) => ({ ...ag, pts: BATTLES.reduce((s, b) => s + (b.a === AGENTS.indexOf(ag) ? b.sa : b.b === AGENTS.indexOf(ag) ? b.sb : 0), 0) })).sort((x, y) => y.pts - x.pts).slice(0, 5);

  const Group = ({ label, color, items }) => items.length === 0 ? null : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, animation: color === RED ? 'cp-pulse 1.3s ease infinite' : 'none' }} />
        <span style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: '.04em', textTransform: 'uppercase', color }}>{label} · {items.length}</span>
      </div>
      <div className="cp-scroll" style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>{items.map((b) => <BattleCard key={b.id} b={b} onOpen={setOpenBattle} />)}</div>
    </div>
  );

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionTitle sub="Agents battle around the clock on this class's curriculum.">24/7 Knowledge Battles</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12 }}>
        {[['Live', live.length, RED], ['Upcoming', upcoming.length, BRAND], ['Completed', completed.length, GREEN], ['Battles', BATTLE_LIST.length, '#2563EB']].map(([l, v, c]) => (
          <div key={l} style={{ ...card, padding: 14 }}><div style={{ fontSize: 20, fontWeight: 900, color: c }}>{v}</div><div style={{ fontSize: 11.5, color: MUTED }}>{l}</div></div>
        ))}
      </div>
      {/* Open lobbies — join to play */}
      {lobbyList.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: '.04em', textTransform: 'uppercase', color: '#E8884A' }}>Open lobbies · {lobbyList.length}</div>
          <div className="cp-scroll" style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
            {lobbyList.map((lb) => (
              <div key={lb.id} style={{ ...card, padding: 16, flex: '0 0 min(260px,80vw)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{lb.topic}</div>
                <div style={{ fontSize: 11.5, color: MUTED }}>{lb.participants} in · {lb.spotsLeft} spot{lb.spotsLeft === 1 ? '' : 's'} left</div>
                <Btn variant={lb.alreadyJoined ? 'outline' : 'primary'} size="sm" style={{ width: '100%', opacity: (joining === lb.id || lb.spotsLeft <= 0) ? .6 : 1 }}
                  onClick={() => lb.alreadyJoined ? setOpenBattle({ id: lb.id, status: 'lobby', topic: lb.topic }) : joinLobby(lb)}>
                  {joining === lb.id ? 'Joining…' : lb.alreadyJoined ? <><Swords size={12} />Enter lobby</> : lb.spotsLeft <= 0 ? 'Full' : <><Plus size={12} />Join battle</>}
                </Btn>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: '#F0ECE6', borderRadius: 12, width: 'fit-content' }}>
        {[['all', 'All battles'], ['live', 'Live now']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding: '7px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 800, background: filter === k ? INK : 'transparent', color: filter === k ? '#fff' : MUTED }}>{l}</button>
        ))}
      </div>
      {/* Grouped lists */}
      {filter === 'live' ? (
        live.length ? <Group label="Live now" color={RED} items={live} /> : <div style={{ ...card, padding: 24, textAlign: 'center', color: MUTED2, fontSize: 13 }}>No live battles right now.</div>
      ) : (
        <>
          <Group label="Live now" color={RED} items={live} />
          <Group label="Starting soon" color={BRAND} items={upcoming} />
          <Group label="Completed" color={MUTED2} items={completed} />
        </>
      )}
      <div style={{ ...card, padding: 18 }}>
        <div style={{ fontSize: 13.5, fontWeight: 900, color: INK, marginBottom: 10 }}>Course Leaderboard</div>
        {leaderboard.map((ag, i) => (
          <div key={ag.id || ag.name || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: i < leaderboard.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
            <div style={{ width: 22, textAlign: 'center', fontSize: 15, fontWeight: 900, color: i === 0 ? GOLD : MUTED2 }}>{i === 0 ? <Crown size={14} fill={GOLD} color={GOLD}/> : i + 1}</div>
            <Avatar icon={ag.icon} emoji={ag.emoji} color={ag.color} bg={ag.bg || `${ag.color || BRAND}1A`} size={32} ring={ag.isYou ? true : undefined} />
            <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{ag.name}{ag.isYou && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: '#fff', background: INK, padding: '1px 7px', borderRadius: 100 }}>You</span>}</div>{ag.owner && <div style={{ fontSize: 11, color: MUTED2 }}>{ag.owner}</div>}</div>
            <div style={{ fontWeight: 900, color: ag.isYou ? BRAND : INK }}>{ag.pts} <span style={{ fontSize: 10, color: MUTED2, fontWeight: 700 }}>pts</span></div>
          </div>
        ))}
      </div>
      {openBattle && <BattleModal battle={openBattle} onClose={() => setOpenBattle(null)} />}
    </section>
  );
}

/* ── peer revisions ───────────────────────────────────────── */
const REVISIONS = [
  { id: 1, topic: 'Chain Rule deep-dive', host: 'Chukwuemeka O.', bg: '#D4EAD8', time: 'Starts in 12 min', joined: 8, max: 12, status: 'starting' },
  { id: 2, topic: 'Integration by Parts Q&A', host: 'Ngozi A.', bg: '#E4D4F0', time: 'Live now', joined: 6, max: 10, status: 'live' },
  { id: 3, topic: 'Differential Equations Study Hall', host: 'Tobi M.', bg: '#C8D8E8', time: 'Tomorrow · 4 PM', joined: 0, max: 15, status: 'upcoming' },
];
const RV_HOST_BG = ['#D4EAD8', '#E4D4F0', '#C8D8E8', '#F0E4C8'];
function RevisionsSection({ revisions, onJoinLive }) {
  const list = revisions?.length
    ? revisions.map((s, i) => ({ id: i, topic: s.topic, host: s.host, bg: RV_HOST_BG[i % RV_HOST_BG.length], time: s.time, joined: s.joined, max: s.max, status: s.status === 'live' ? 'live' : 'upcoming' }))
    : REVISIONS;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionTitle sub="Student-hosted group review sessions.">Peer Revision</SectionTitle>
      <div className="cp-scroll" style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
        {list.map((s) => (
          <div key={s.id} style={{ ...card, padding: 18, flex: '0 0 min(300px,82vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ marginBottom: 6 }}>
                {s.status === 'live' && <LiveBadge />}
                {s.status === 'starting' && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 100, background: `${BRAND}14`, color: BRAND }}>Starting soon</span>}
                {s.status === 'upcoming' && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 100, background: '#F0ECE6', color: MUTED2 }}>Upcoming</span>}
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>{s.topic}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar initials={initialsOf(s.host)} bg={s.bg} size={32} />
              <div><div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{s.host}</div><div style={{ fontSize: 11, color: MUTED2, display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={10} />{s.time}</div></div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUTED2, marginBottom: 5 }}><span><Users size={10} style={{ display: 'inline', marginRight: 3 }} />{s.joined}/{s.max}</span><span>{Math.round((s.joined / s.max) * 100)}% full</span></div>
              <div style={{ height: 5, background: '#EDE8E1', borderRadius: 4, overflow: 'hidden' }}><div style={{ height: '100%', width: `${(s.joined / s.max) * 100}%`, background: BRAND, borderRadius: 4 }} /></div>
            </div>
            <Btn variant={s.status === 'upcoming' ? 'outline' : s.status === 'live' ? 'green' : 'primary'} size="sm" style={{ width: '100%' }} onClick={onJoinLive}>
              {s.status === 'upcoming' ? <><CalendarPlus size={12} />Reserve</> : <><Radio size={12} />{s.status === 'live' ? 'Join' : 'Join early'}</>}
            </Btn>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── map API → view shape ─────────────────────────────────── */
function mapCourse(api) {
  if (!api) return { course: DEFAULT_COURSE, modules: DEFAULT_MODULES, type: 'live', enrolled: false };
  const isFree = api.is_free || api.price === 0;
  const priceLabel = isFree ? 'Free' : `₦${Number(api.price || 0).toLocaleString('en-NG')}`;
  const modules = Array.isArray(api.modules) && api.modules.length
    ? api.modules.map((m) => ({ title: m.title, lessons: (m.lessons || []).map((l) => ({ id: l.id, title: l.title, duration: l.duration || '—', done: !!l.done, type: l.type || 'video', isPreview: !!l.isPreview })) }))
    : DEFAULT_MODULES;
  return {
    type: api.type === 'video' || api.course_type === 'video' ? 'video' : 'live',
    enrolled: !!api.enrolled,
    modules,
    course: {
      id: api.id || null, slug: api.slug || null, platform: api.platform || null,
      title: api.title || DEFAULT_COURSE.title, subject: api.subject || DEFAULT_COURSE.subject,
      level: api.level || DEFAULT_COURSE.level, rating: api.rating != null ? Number(api.rating) : null,
      ratingCount: api.rating_count || '', students: api.total_students || 0, hours: api.total_hours || 0,
      instructor: api.instructor_name || DEFAULT_COURSE.instructor, updated: api.updated || '',
      description: api.description || '', priceLabel, priceOld: null, emoji: api.emoji || DEFAULT_COURSE.emoji,
      price: Number(api.price || 0), is_free: isFree,   // raw kobo + flag for checkout
      schedule: Array.isArray(api.schedule) && api.schedule.length ? api.schedule : null,
      reviews: Array.isArray(api.reviews) && api.reviews.length ? api.reviews : null,
      teachers: Array.isArray(api.teachers) && api.teachers.length ? api.teachers : null,
      battles: Array.isArray(api.battles) && api.battles.length ? api.battles : null,
      leaderboard: Array.isArray(api.leaderboard) && api.leaderboard.length ? api.leaderboard : null,
      revisions: Array.isArray(api.revisions) && api.revisions.length ? api.revisions : null,
    },
  };
}

/* ── guest / overview view ────────────────────────────────── */
function CourseOverview({ type, isEnrolled, course, modules, onPlay, onEnrol, enrolling, onJoinLive, onAddToCart, addingCart, inCart, onAgentSession, onLessonMore }) {
  const isVideo = type === 'video';
  const isFree = course.priceLabel === 'Free';
  const tabs = isVideo ? ['about', 'curriculum', 'teachers', 'reviews'] : ['about', 'schedule', 'curriculum', 'teachers', 'reviews'];
  const [tab, setTab] = useState('about');
  const done = modules.reduce((a, m) => a + m.lessons.filter((l) => l.done).length, 0);
  const total = modules.reduce((a, m) => a + m.lessons.length, 0);
  const teachers = course.teachers
    ? course.teachers.map((t) => ({ initials: initialsOf(t.name), bg: '#C8E8D4', name: t.name, title: t.title || 'Instructor', bio: `Instructor for ${course.title}.` }))
    : [{ initials: initialsOf(course.instructor), bg: '#C8E8D4', name: course.instructor, title: 'Lead Instructor', bio: `Instructor for ${course.title}.` }];
  const schedule = course.schedule || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Hero */}
      <div style={{ position: 'relative', borderRadius: 22, overflow: 'hidden', background: 'linear-gradient(135deg,#231a4d,#0d2137)' }}>
        <div style={{ position: 'relative', zIndex: 1, padding: 24, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ fontSize: 64, color: 'rgba(255,255,255,.9)' }}>{course.emoji?.startsWith('ti-') ? <Icon name={course.emoji} size={64}/> : (course.emoji || <Icon name="ti-book" size={64}/>)}</div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {isVideo ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 900, padding: '2px 9px', borderRadius: 100, background: BRAND, color: '#fff' }}><Video size={10}/> VIDEO COURSE</span> : <LiveBadge />}
              {!isVideo && course.platform && <PlatformBadge platform={course.platform} />}
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,.7)', background: 'rgba(255,255,255,.1)', padding: '3px 10px', borderRadius: 100 }}>{course.subject}</span>
            </div>
            <h1 style={{ fontFamily: FONT, color: '#fff', fontSize: 24, fontWeight: 900, lineHeight: 1.2, margin: '0 0 6px' }}>{course.title}</h1>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'rgba(255,255,255,.65)' }}>
              <StarRow rating={course.rating} count={course.ratingCount} />
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Users size={13} />{course.students} enrolled</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Clock size={13} />{course.hours} hours</span>
              {isVideo && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Globe size={13} />English</span>}
            </div>
            <div style={{ marginTop: 8, fontSize: 11.5, color: 'rgba(255,255,255,.6)' }}>By <span style={{ color: '#C4B5FD' }}>{course.instructor}</span></div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 180 }}>
            {!isEnrolled && (isVideo
              ? <Btn variant="primary" size="lg" onClick={onEnrol} style={{ background: '#fff', color: BRAND, border: '1.5px solid #fff', opacity: enrolling ? .6 : 1 }}><ShoppingCart size={15} />{enrolling ? 'Enrolling…' : isFree ? 'Enrol · Free' : `Buy · ${course.priceLabel}`}</Btn>
              : <Btn variant="red" size="lg" onClick={onEnrol} style={{ opacity: enrolling ? .6 : 1 }}><Radio size={15} />{enrolling ? 'Enrolling…' : 'Enrol · Join live'}</Btn>)}
            {!isEnrolled && onAddToCart && (
              <Btn variant="ghost" size="lg" onClick={onAddToCart} style={{ background: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,.55)', opacity: addingCart ? .6 : 1 }}>
                {inCart ? <><Check size={15} /> In cart — view</> : <><Plus size={15} /> {addingCart ? 'Adding…' : 'Add to cart'}</>}
              </Btn>
            )}
            {isEnrolled && isVideo && <Btn variant="primary" size="lg" onClick={onPlay} style={{ background: '#fff', color: BRAND, border: '1.5px solid #fff' }}><Play size={15} />Continue watching</Btn>}
            {isEnrolled && !isVideo && <Btn variant="red" size="lg" onClick={onJoinLive}><Radio size={15} />Join live now</Btn>}
          </div>
        </div>
        {isEnrolled && (
          <div style={{ position: 'relative', zIndex: 1, padding: '0 24px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,.6)', marginBottom: 6 }}><span>Your progress</span><span>{done}/{total} lessons</span></div>
            <div style={{ height: 5, background: 'rgba(255,255,255,.15)', borderRadius: 4, overflow: 'hidden' }}><div style={{ height: '100%', width: `${total ? (done / total) * 100 : 0}%`, background: BRAND, borderRadius: 4 }} /></div>
          </div>
        )}
      </div>

      {/* Action chips */}
      <ActionChips course={course} onAgentSession={() => {
        // Open on the first lesson that really exists — the viewer is honest
        // when the stream is not accessible to this learner yet.
        const firstLesson = (modules || []).flatMap((m) => m.lessons || []).find((l) => l?.id) || null;
        onAgentSession?.(firstLesson);
      }} />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: '#F0ECE6', borderRadius: 14, width: 'fit-content', flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 800, textTransform: 'capitalize', background: tab === t ? INK : 'transparent', color: tab === t ? '#fff' : MUTED }}>{t}</button>
        ))}
      </div>

      {/* About */}
      {tab === 'about' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 18 }}>
          <div style={{ gridColumn: 'span 1', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ ...card, padding: 22 }}>
              <h3 style={{ fontSize: 14, fontWeight: 900, color: INK, margin: '0 0 10px' }}>About this {isVideo ? 'course' : 'class'}</h3>
              <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.7, margin: 0 }}>{course.description || 'A complete course covering the full syllabus with lessons, quizzes and an AI agent companion.'}</p>
            </div>
            <div style={{ ...card, padding: 22 }}>
              <h3 style={{ fontSize: 14, fontWeight: 900, color: INK, margin: '0 0 10px' }}>Requirements</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {['Basic prior knowledge of the subject', 'An Akoro account (free or Pro)', 'A device with internet access'].map((r) => (
                  <div key={r} style={{ display: 'flex', gap: 8, fontSize: 13.5, color: MUTED }}><CheckCircle2 size={15} color={BRAND} style={{ flexShrink: 0, marginTop: 2 }} />{r}</div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!isEnrolled && (
              <div style={{ ...card, padding: 20 }}>
                <div style={{ textAlign: 'center', marginBottom: 14 }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: INK }}>{course.priceLabel}</div>
                </div>
                {isVideo
                  ? <Btn variant="primary" onClick={onEnrol} style={{ width: '100%', opacity: enrolling ? .6 : 1 }}><ShoppingCart size={14} />{enrolling ? 'Enrolling…' : 'Enrol now'}</Btn>
                  : <Btn variant="red" onClick={onEnrol} style={{ width: '100%', opacity: enrolling ? .6 : 1 }}><Radio size={14} />{enrolling ? 'Enrolling…' : 'Enrol · Join class'}</Btn>}
                <div style={{ textAlign: 'center', fontSize: 11, color: MUTED2, margin: '10px 0 14px' }}>30-day money-back guarantee</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13.5, color: MUTED }}>
                  {[[<Play size={13} />, isVideo ? `${course.hours}h on-demand video` : 'Live sessions'], [<Brain size={13} />, 'AI agent included'], [<Award size={13} />, 'Certificate of completion']].map(([ic, tx], i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: BRAND }}>{ic}</span>{tx}</div>)}
                </div>
              </div>
            )}
            <div style={{ ...card, padding: 20 }}>
              {[[`${course.students}`, 'Students enrolled'], [`${course.rating || '—'}`, 'Average rating'], [`${total}`, 'Lessons']].map(([v, l]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${BORDER}`, fontSize: 13.5 }}><span style={{ color: MUTED }}>{l}</span><span style={{ fontWeight: 800, color: INK }}>{v}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Schedule (live) */}
      {tab === 'schedule' && !isVideo && (
        <div style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(schedule.length ? schedule : [{ topic: 'Schedule to be announced', date: 'TBA', time: '', status: 'upcoming' }]).map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 14, borderRadius: 14, border: `1px solid ${s.status === 'live' ? '#FECACA' : BORDER}`, background: s.status === 'live' ? '#FFF5F5' : s.status === 'recorded' ? LIGHT : '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.status === 'live' ? RED : s.status === 'upcoming' ? BRAND : '#C9C5BE', animation: s.status === 'live' ? 'cp-pulse 1.3s ease infinite' : 'none' }} />
                <div><div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{s.topic}</div><div style={{ fontSize: 12, color: MUTED2 }}>{s.date}{s.time ? ` · ${s.time}` : ''}</div></div>
              </div>
              {s.status === 'live' && <Btn variant="red" size="sm" onClick={onJoinLive}><Radio size={11} />Join</Btn>}
              {s.status === 'upcoming' && <Btn variant="outline" size="sm"><CalendarPlus size={11} />RSVP</Btn>}
              {s.status === 'recorded' && <Btn variant="ghost" size="sm"><MonitorPlay size={11} />Replay</Btn>}
            </div>
          ))}
        </div>
      )}

      {/* Curriculum */}
      {tab === 'curriculum' && <Curriculum modules={modules} isEnrolled={isEnrolled} hours={course.hours} onPick={isEnrolled ? onPlay : null} onLessonMore={isEnrolled ? onLessonMore : null} />}

      {/* Teachers */}
      {tab === 'teachers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 18 }}>
          {teachers.map((t, i) => (
            <div key={i} style={{ ...card, padding: 22 }}>
              <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
                <Avatar initials={t.initials} bg={t.bg} size={52} />
                <div><div style={{ fontSize: 15, fontWeight: 900, color: INK }}>{t.name}</div><div style={{ fontSize: 12, fontWeight: 800, color: BRAND }}>{t.title}</div></div>
              </div>
              <p style={{ fontSize: 13.5, color: MUTED, margin: 0 }}>{t.bio}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reviews */}
      {tab === 'reviews' && <Reviews reviews={course.reviews} courseId={course.id} canReview={isEnrolled} />}

      {/* Always-on community sections */}
      <BattlesSection battles={course.battles} leaderboard={course.leaderboard} lobbies={course.openLobbies} />
      <RevisionsSection revisions={course.revisions} onJoinLive={onJoinLive} />
    </div>
  );
}

/* ── enrolled video player view ───────────────────────────── */
function EnrolledVideoView({ course, modules, onAgentSession, onLessonMore }) {
  const first = (() => {
    for (const m of modules) { const l = (m.lessons || []).find((x) => x.type === 'video'); if (l) return { ...l, module: m.title }; }
    return { title: 'Lesson', type: 'video', module: modules[0]?.title };
  })();
  const [lesson, setLesson] = useState(first);
  const [tab, setTab] = useState('content');
  const done = modules.reduce((a, m) => a + m.lessons.filter((l) => l.done).length, 0);
  const total = modules.reduce((a, m) => a + m.lessons.length, 0);
  const complete = total > 0 && done === total;

  const [certBusy, setCertBusy] = useState(false);
  const [certErr, setCertErr] = useState('');
  const getCertificate = async () => {
    if (!course.id || certBusy) return;
    setCertBusy(true); setCertErr('');
    try {
      const r = await fetch(`${API}/api/courses/${course.id}/certificate`, { method: 'POST', credentials: 'include' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'Certificate not available yet');
      const url = (d.data || d).certificate_url;
      if (url) window.open(url, '_blank'); else setCertErr('Certificate is generating — try again shortly');
    } catch (e) { setCertErr(e.message); }
    finally { setCertBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {complete && (
        <div style={{ ...card, padding: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: 'linear-gradient(135deg,#F0FFF6,#EAF6FF)', border: '1px solid #CDEBD8' }}>
          <PartyPopper size={34} color="#F59E0B" style={{ flexShrink: 0 }}/>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: INK }}>Course complete!</div>
            <div style={{ fontSize: 12.5, color: MUTED }}>You’ve finished every lesson. Download your certificate.</div>
            {certErr && <div style={{ fontSize: 12, fontWeight: 600, color: '#EF4444', marginTop: 4 }}>{certErr}</div>}
          </div>
          <Btn variant="primary" onClick={getCertificate} style={{ opacity: certBusy ? .6 : 1 }}><Award size={15} />{certBusy ? 'Preparing…' : 'Get certificate'}</Btn>
        </div>
      )}
      <div style={{ borderRadius: 18, overflow: 'hidden', border: `1px solid ${BORDER}` }}>
        <VideoPlayer lesson={lesson} courseEmoji={course.emoji} />
        <div style={{ background: '#0d1220', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div><div style={{ color: 'rgba(255,255,255,.4)', fontSize: 11 }}>{lesson?.module}</div><div style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>{lesson?.title}</div></div>
          <span style={{ color: 'rgba(255,255,255,.5)', fontSize: 12 }}>{done}/{total} · {total ? Math.round((done / total) * 100) : 0}%</span>
        </div>
      </div>

      {/* Action chips */}
      <ActionChips course={course} onAgentSession={() => onAgentSession?.(lesson)} />

      <div style={{ display: 'flex', gap: 4, padding: 4, background: '#F0ECE6', borderRadius: 14, width: 'fit-content', flexWrap: 'wrap' }}>
        {[['content', 'Course content'], ['about', 'About'], ['reviews', 'Reviews'], ['battles', 'Battles'], ['revisions', 'Live revisions']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 800, background: tab === id ? INK : 'transparent', color: tab === id ? '#fff' : MUTED }}>{label}</button>
        ))}
      </div>

      {tab === 'content' && <Curriculum modules={modules} isEnrolled hours={course.hours} onPick={setLesson} currentTitle={lesson?.title} onLessonMore={onLessonMore} />}
      {tab === 'about' && <div style={{ ...card, padding: 22 }}><p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.7, margin: 0 }}>{course.description || 'A complete course covering the full syllabus with lessons and quizzes.'}</p></div>}
      {tab === 'reviews' && <Reviews reviews={course.reviews} courseId={course.id} canReview />}
      {tab === 'battles' && <BattlesSection battles={course.battles} leaderboard={course.leaderboard} lobbies={course.openLobbies} />}
      {tab === 'revisions' && <RevisionsSection revisions={course.revisions} />}
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────── */

export { INK, MUTED, BORDER, LIGHT, BG, FONT, GlobalCss, card, Btn, Avatar, LiveBadge, StarRow, PLATFORMS, PlatformBadge, ActionChips, SectionTitle, DEFAULT_MODULES, DEFAULT_COURSE, VideoPlayer, Curriculum, RV_BG, Reviews, AGENTS, BATTLES, BattleCard, BattlesSection, REVISIONS, RV_HOST_BG, RevisionsSection, mapCourse, CourseOverview, EnrolledVideoView };
