/**
 * Course details — shared primitives (buttons, avatars, badges, chips).
 */
import { useState } from 'react';
import { Star, Video, CalendarPlus, Brain, Check, Share2, Plus, Flag } from 'lucide-react';
import { BRAND } from '../../../constants.js';
import { AgentAvatar } from '../../../components/common/AgentAvatar.jsx';
import { MUTED, MUTED2, INK, BORDER, RED, GREEN, GOLD, FONT, PLATFORMS } from './parts-rules.js';

const GlobalCss = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
    @keyframes cp-pulse{0%,100%{opacity:1}50%{opacity:.35}}
    @keyframes cp-spin{to{transform:rotate(360deg)}}
    .cp-scroll::-webkit-scrollbar{height:6px}
    .cp-scroll::-webkit-scrollbar-thumb{background:#DDD8CF;border-radius:3px}
  `}</style>
);

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

export { GlobalCss, Btn, Avatar, LiveBadge, StarRow, PlatformBadge, ActionChips, SectionTitle };
