/**
 * Content hub — constants + panels (mirrors the settings-billing tab pattern).
 * Tabs: Blog Generator · Social Post Generator · Activities Creator ·
 * External Channels · Content Settings.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PenLine, Megaphone, Sparkles, Share2, SlidersHorizontal, BookOpen,
  Facebook, Instagram, Twitter, Music2, Loader2, Copy, Check, CheckCircle2, ChevronRight, Send, X, Clock,
} from 'lucide-react';
import { Btn, Inp } from '../../components/Primitives.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, BLUE, PURPLE, FONT } from '../../constants.js';

const TABS = [
  { key: 'blog',     label: 'Blog Generator',        icon: PenLine },
  { key: 'social',   label: 'Social Post Generator', icon: Megaphone },
  { key: 'activity', label: 'Activities Creator',    icon: Sparkles },
];
const EXTERNAL = [
  { key: 'channels', label: 'External Channels', icon: Share2 },
];
const SETTINGS_TAB = { key: 'settings', label: 'Content Settings', icon: SlidersHorizontal };

const VALID_TABS = ['blog', 'social', 'activity', 'channels', 'settings'];
const NO_SAVE_TABS = ['blog', 'social', 'activity', 'channels']; // only Settings uses the Save footer

const CHANNELS = [
  { key: 'facebook',  label: 'Facebook',    color: '#1877F2', Icon: Facebook },
  { key: 'instagram', label: 'Instagram',   color: '#E4405F', Icon: Instagram },
  { key: 'twitter',   label: 'X (Twitter)', color: '#0F1419', Icon: Twitter },
  { key: 'tiktok',    label: 'TikTok',      color: '#010101', Icon: Music2 },
];

const fmtDateTime = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};

/* ── AI post pill + channel picker ───────────────────────────────────── */
const REASON_LABEL = {
  not_connected: 'Not connected', missing_page_token: 'Missing Page token/ID', missing_ig_account: 'Missing IG business account',
  missing_token: 'Missing access token', needs_image: 'Attach an image first', needs_video: 'Attach a video first',
  container_failed: 'Instagram rejected the image', publish_failed: 'Publish failed', post_failed: 'Post failed', unsupported: 'Not supported',
};

function PostModal({ creation, onClose, onPosted, onToast }) {
  const [channels, setChannels] = useState(null);   // connected channel keys
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);     // per-channel outcome

  useEffect(() => {
    apiGet('/api/instructor/social')
      .then((r) => setChannels((r?.data ?? []).filter((x) => x.connected).map((x) => x.platform)))
      .catch(() => setChannels([]));
  }, []);

  const post = async () => {
    const picked = Object.keys(sel).filter((k) => sel[k]);
    if (!picked.length) { onToast?.('Pick at least one channel'); return; }
    setBusy(true);
    try {
      const r = await apiPost(`/api/school/content/creations/${creation.id}/post`, { channels: picked });
      const res = r?.data?.results || {};
      setResults(res);
      onPosted?.(r?.data?.creation);
      const okCount = Object.values(res).filter((x) => x.ok).length;
      onToast?.(okCount ? `Posted to ${okCount} channel${okCount > 1 ? 's' : ''} ✓` : 'Couldn’t post — see details');
    } catch (e) { onToast?.(e.message || 'Could not post'); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3200, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 400, background: WHITE, borderRadius: 16, padding: '20px 22px', fontFamily: FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: INK }}>AI Post</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: MUTED2 }}><X size={18} /></button>
        </div>
        {results ? (
          <>
            <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 12px' }}>Results by channel:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(results).map(([k, r]) => {
                const c = CHANNELS.find((x) => x.key === k) || { label: k, color: MUTED, Icon: Send };
                return (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: `1px solid ${BORDER}`, borderRadius: 10 }}>
                    <c.Icon size={16} color={c.color} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: INK, flex: 1 }}>{c.label}</span>
                    {r.ok
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 800, color: GREEN }}><Check size={13} />{r.manual ? 'Ready' : 'Posted'}</span>
                      : <span style={{ fontSize: 11, fontWeight: 700, color: '#DC2626' }}>{REASON_LABEL[r.reason] || r.reason || 'Failed'}</span>}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Done</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 14px' }}>Choose where to publish this content.</p>
            {channels === null ? (
              <div style={{ color: MUTED2, fontSize: 13, padding: '10px 0' }}>Loading channels…</div>
            ) : channels.length === 0 ? (
              <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>No channels connected yet. Connect one from <b>External Channels</b> first.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {CHANNELS.filter((c) => channels.includes(c.key)).map((c) => {
                  const needsMedia = (c.key === 'instagram' || c.key === 'tiktok');
                  const hasMedia = !!creation?.media_url;
                  return (
                    <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: `1px solid ${BORDER}`, borderRadius: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!sel[c.key]} onChange={(e) => setSel((s) => ({ ...s, [c.key]: e.target.checked }))} />
                      <c.Icon size={16} color={c.color} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: INK, flex: 1 }}>{c.label}</span>
                      {needsMedia && !hasMedia && <span style={{ fontSize: 10, fontWeight: 700, color: '#B45309', background: '#FEF3C7', borderRadius: 20, padding: '2px 7px' }}>needs media</span>}
                    </label>
                  );
                })}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: INK, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
              <button onClick={post} disabled={busy || !channels?.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, border: 'none', background: busy || !channels?.length ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: busy || !channels?.length ? '#9CA3AF' : WHITE, fontSize: 12.5, fontWeight: 800, cursor: busy || !channels?.length ? 'default' : 'pointer', fontFamily: FONT }}>
                {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Send size={13} />}{busy ? 'Posting…' : 'Post now'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AiPostPill({ creation, onUpdated, onToast, size = 'md' }) {
  const [open, setOpen] = useState(false);
  const posted = !!(creation?.posted_at || (creation?.posted_channels || []).length);
  const pad = size === 'sm' ? '3px 9px' : '6px 12px';
  const fs = size === 'sm' ? 10.5 : 12;
  if (!creation?.id) return null;
  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); if (!posted) setOpen(true); }}
        title={posted ? `Posted${(creation.posted_channels || []).length ? ' · ' + creation.posted_channels.join(', ') : ''}` : 'Post with AI'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: pad, borderRadius: 999, border: 'none', cursor: posted ? 'default' : 'pointer', fontFamily: FONT, fontSize: fs, fontWeight: 800,
          background: posted ? `${GREEN}15` : `${AMBER}15`, color: posted ? GREEN : AMBER }}>
        {posted ? <Check size={size === 'sm' ? 11 : 13} /> : <Sparkles size={size === 'sm' ? 11 : 13} />}{posted ? 'Posted' : 'AI post'}
      </button>
      {open && <PostModal creation={creation} onClose={() => setOpen(false)} onPosted={onUpdated} onToast={onToast} />}
    </>
  );
}

const QUICK_GUIDE = {
  blog: [
    { t: 'Grounding', d: 'Posts are written in your school’s brand voice and tone from Content Settings — set those once for a consistent style.' },
    { t: 'Publishing', d: 'Generated blog posts can be copied straight into your website builder or newsletter.' },
  ],
  social: [
    { t: 'Options', d: 'Each run returns three caption variations so you can pick the best fit before posting.' },
    { t: 'Platform', d: 'Choose a target platform to tailor length and hashtags — Instagram and TikTok favour more emojis and tags.' },
  ],
  activity: [
    { t: 'Classroom-ready', d: 'Activities include objectives, materials, steps, a differentiation tip and an assessment idea.' },
    { t: 'Age', d: 'Add the class or age group so the activity is pitched at the right level.' },
  ],
  channels: [
    { t: 'Connect once', d: 'Link each social account so posts can be published later. Use OAuth for one-click, or paste credentials manually.' },
    { t: 'Security', d: 'Tokens are stored securely and never shown again — only the connection status is displayed.' },
  ],
  settings: [
    { t: 'Brand voice', d: 'Describe how your school “sounds” (e.g. warm, faith-based, ambitious). Every generator uses this.' },
    { t: 'Hashtags', d: 'Default hashtags are woven into social posts automatically where they fit naturally.' },
  ],
};

function QuickGuide({ tab }) {
  const items = QUICK_GUIDE[tab] || QUICK_GUIDE.blog;
  return (
    <div style={{ background: `${BLUE}08`, border: `1px solid ${BLUE}22`, borderRadius: 14, padding: '14px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <BookOpen size={15} color={BLUE} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: BLUE, fontFamily: FONT }}>Quick Guide</span>
      </div>
      {items.map((it, i) => (
        <p key={it.t} style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6, margin: i === 0 ? 0 : '10px 0 0', fontFamily: FONT, ...(i > 0 ? { paddingTop: 10, borderTop: `1px solid ${BLUE}18` } : {}) }}>
          <b style={{ color: INK }}>{it.t}:</b> {it.d}
        </p>
      ))}
    </div>
  );
}

const lbl = { fontSize: 12, fontWeight: 700, color: MUTED, fontFamily: FONT, display: 'block', margin: '0 0 5px' };
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' };

/* ── Generator panel (blog / social / activity) ──────────────────────── */
const GEN_CONFIG = {
  blog:     { title: 'Blog Post Generator',  topicLabel: 'What should the post be about?', topicPh: 'e.g. Our new science lab and what students are building', pastLabel: 'Past blogs' },
  social:   { title: 'Social Post Generator', topicLabel: 'What are you announcing?',       topicPh: 'e.g. Open day this Saturday, 10am', pastLabel: 'Past posts' },
  activity: { title: 'Activities Creator',    topicLabel: 'Topic or learning goal',          topicPh: 'e.g. Introduce fractions to JSS1', pastLabel: 'Past activities' },
};
const BLOG_TYPES = [
  { v: 'newsletter',   l: 'Newsletter' },
  { v: 'event_recap',  l: 'Event recap' },
  { v: 'achievement',  l: 'Achievement highlight' },
  { v: 'announcement', l: 'Announcement' },
  { v: 'general',      l: 'General post' },
];
const BLOG_LABEL = Object.fromEntries(BLOG_TYPES.map((b) => [b.v, b.l]));

function GeneratorPanel({ kind, onToast, onGenerated }) {
  const cfg = GEN_CONFIG[kind];
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('');
  const [audience, setAudience] = useState('');
  const [platform, setPlatform] = useState('');
  const [blogType, setBlogType] = useState('newsletter');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [copied, setCopied] = useState(false);
  const [lastCreation, setLastCreation] = useState(null);
  const [success, setSuccess] = useState(false);

  const generate = async () => {
    if (!topic.trim()) { onToast?.('Tell me what it’s about'); return; }
    setBusy(true); setResult('');
    try {
      const res = await apiPost('/api/school/content/generate', {
        kind, topic: topic.trim(), tone: tone.trim() || null,
        audience: audience.trim() || null, platform: platform || null,
        blogType: kind === 'blog' ? blogType : null, extra: extra.trim() || null,
      });
      setResult(res?.data?.content || '');
      setLastCreation(res?.data?.creation || null);
      setSuccess(true);
      onGenerated?.();   // ask the page to refresh the Past creations section
    } catch (e) { onToast?.(e.message || 'Could not generate'); }
    finally { setBusy(false); }
  };

  const KIND_NOUN = { blog: 'blog post', social: 'social post', activity: 'activity' }[kind];

  const copy = async () => {
    try { await navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <cfg.Icon2 />
        <h3 style={{ fontSize: 15, fontWeight: 800, color: INK, margin: 0, fontFamily: FONT }}>{cfg.title}</h3>
      </div>
      <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 16px', fontFamily: FONT }}>Generate on-brand content in seconds. Refine the options and hit Generate.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={lbl}>{cfg.topicLabel}</label>
          <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} placeholder={cfg.topicPh} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {kind === 'blog' && (
            <div style={{ flex: 1, minWidth: 150 }}>
              <label style={lbl}>Blog type</label>
              <select value={blogType} onChange={(e) => setBlogType(e.target.value)} style={inputStyle}>
                {BLOG_TYPES.map((b) => <option key={b.v} value={b.v}>{b.l}</option>)}
              </select>
            </div>
          )}
          {kind === 'social' && (
            <div style={{ flex: 1, minWidth: 150 }}>
              <label style={lbl}>Platform</label>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={inputStyle}>
                <option value="">All platforms</option>
                {CHANNELS.map((c) => <option key={c.key} value={c.label}>{c.label}</option>)}
              </select>
            </div>
          )}
          {kind === 'activity' && (
            <div style={{ flex: 1, minWidth: 150 }}>
              <label style={lbl}>Class / age group</label>
              <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. JSS1 / age 11–12" style={inputStyle} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 150 }}>
            <label style={lbl}>Tone (optional)</label>
            <input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Overrides your default voice" style={inputStyle} />
          </div>
        </div>
        <div>
          <label style={lbl}>Extra instructions (optional)</label>
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Anything else to include or avoid" style={inputStyle} />
        </div>
        <div>
          <button onClick={generate} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: busy ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: busy ? '#9CA3AF' : WHITE, fontSize: 13.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: FONT }}>
            {busy ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Sparkles size={15} />}{busy ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {result && (
        <div style={{ marginTop: 20, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', background: LIGHT, borderBottom: `1px solid ${BORDER}` }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: INK, fontFamily: FONT }}>Result</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
              {lastCreation && <AiPostPill creation={lastCreation} onUpdated={(c) => { setLastCreation(c); onGenerated?.(); }} onToast={onToast} size="sm" />}
              <button onClick={copy} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: copied ? GREEN : MUTED, fontSize: 12, fontWeight: 700, fontFamily: FONT }}>
                {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <pre style={{ margin: 0, padding: '14px 16px', fontSize: 13, lineHeight: 1.6, color: INK, fontFamily: FONT, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{result}</pre>
        </div>
      )}

      {/* Success modal */}
      {success && (
        <div onClick={() => setSuccess(false)} style={{ position: 'fixed', inset: 0, zIndex: 3100, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 380, background: WHITE, borderRadius: 18, padding: '26px 24px', fontFamily: FONT, textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: `${GREEN}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <CheckCircle2 size={28} color={GREEN} />
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: INK, marginBottom: 6 }}>Your {KIND_NOUN} is ready</div>
            <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 20px', lineHeight: 1.55 }}>It’s been added to your {cfg.pastLabel.toLowerCase()}. Post it now or open the full view.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {lastCreation && <div style={{ display: 'flex', justifyContent: 'center' }}><AiPostPill creation={lastCreation} onUpdated={(c) => { setLastCreation(c); loadPast(); }} onToast={onToast} /></div>}
              <button onClick={() => { setSuccess(false); if (lastCreation) navigate(`/content/creation/${lastCreation.id}`); }} style={{ padding: '10px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Open full view</button>
              <button onClick={() => setSuccess(false)} style={{ padding: '9px', borderRadius: 10, border: `1.5px solid ${BORDER}`, background: WHITE, color: INK, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// tiny per-kind icon injected (keeps GEN_CONFIG data-only)
GEN_CONFIG.blog.Icon2     = () => <PenLine size={17} color={AMBER} />;
GEN_CONFIG.social.Icon2   = () => <Megaphone size={17} color={AMBER} />;
GEN_CONFIG.activity.Icon2 = () => <Sparkles size={17} color={AMBER} />;

/* ── Content settings panel (self-persisting via footer Save) ─────────── */
function ContentSettingsPanel({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 800, color: INK, margin: '0 0 4px', fontFamily: FONT }}>Content Settings</h3>
      <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 16px', fontFamily: FONT }}>These preferences shape every generated blog post, caption and activity.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={lbl}>Brand voice</label>
          <textarea value={value.voice || ''} onChange={(e) => set('voice', e.target.value)} rows={3}
            placeholder="e.g. Warm, faith-based and ambitious. We celebrate every child and speak to parents like partners." style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div>
          <label style={lbl}>Default tone</label>
          <input value={value.tone || ''} onChange={(e) => set('tone', e.target.value)} placeholder="e.g. friendly and professional" style={inputStyle} />
        </div>
        <div>
          <label style={lbl}>Default hashtags</label>
          <input value={value.hashtags || ''} onChange={(e) => set('hashtags', e.target.value)} placeholder="#YourSchool #Education #Lagos" style={inputStyle} />
        </div>
      </div>
    </div>
  );
}

/* ── External channels panel (cards → dedicated channel pages) ────────── */
function ExternalChannelsPanel({ onToast }) {
  const navigate = useNavigate();
  const [state, setState] = useState(null);

  useEffect(() => {
    apiGet('/api/instructor/social')
      .then((r) => {
        const map = Object.fromEntries((r?.data ?? []).map((x) => [x.platform, x]));
        setState(map);
      })
      .catch(() => setState({}));
  }, []);

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 800, color: INK, margin: '0 0 4px', fontFamily: FONT }}>External Channels</h3>
      <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 16px', fontFamily: FONT }}>Connect the social accounts you’ll publish to. Open a channel to link it via OAuth or paste credentials.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
        {CHANNELS.map((c) => {
          const connected = !!state?.[c.key]?.connected;
          return (
            <button key={c.key} onClick={() => navigate(`/content/channel/${c.key}`)}
              style={{ textAlign: 'left', cursor: 'pointer', background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px', display: 'flex', flexDirection: 'column', gap: 10, fontFamily: FONT, transition: 'border-color .15s, box-shadow .15s' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = c.color; e.currentTarget.style.boxShadow = `0 4px 14px ${c.color}18`; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.boxShadow = 'none'; }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: `${c.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <c.Icon size={19} color={c.color} />
                </div>
                <ChevronRight size={16} color={MUTED2} />
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{c.label}</div>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 3, color: connected ? GREEN : MUTED, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {connected && <CheckCircle2 size={11} />}{state === null ? '…' : connected ? 'Connected' : 'Not connected'}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Past creations — own full-width section (swipeable single row) ────── */
const PAST_LABEL = { blog: 'Past blogs', social: 'Past posts', activity: 'Past activities' };
function PastCreations({ kind, refreshKey, onToast }) {
  const navigate = useNavigate();
  const [past, setPast] = useState(null);

  const load = useCallback(() => {
    apiGet(`/api/school/content/creations?kind=${kind}`).then((r) => setPast(r?.data || [])).catch(() => setPast([]));
  }, [kind]);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (past && past.length === 0) return null; // nothing yet — hide the section

  return (
    <div style={{ marginTop: 22, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: INK, fontFamily: FONT }}>{PAST_LABEL[kind] || 'Past creations'}</div>
        <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT }}>swipe →</div>
      </div>
      {past === null ? (
        <div style={{ display: 'flex', gap: 12 }}>{[0, 1, 2].map((i) => <div key={i} style={{ flex: '0 0 214px', height: 92, borderRadius: 12, background: LIGHT }} />)}</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4, scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch' }}>
          {past.map((c) => (
            <div key={c.id} onClick={() => navigate(`/content/creation/${c.id}`)} title="Open"
              style={{ flex: '0 0 auto', width: 214, scrollSnapAlign: 'start', textAlign: 'left', cursor: 'pointer', background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 13px', fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 6 }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = AMBER; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = BORDER; }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                {c.subtype && kind === 'blog' && <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: .4, color: BLUE, background: `${BLUE}12`, borderRadius: 20, padding: '2px 8px' }}>{BLOG_LABEL[c.subtype] || c.subtype}</span>}
                {c.subtype && kind === 'social' && <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: .4, color: PURPLE, background: `${PURPLE}12`, borderRadius: 20, padding: '2px 8px' }}>{c.subtype}</span>}
                {(!c.subtype || kind === 'activity') && <span />}
                <AiPostPill creation={c} onUpdated={() => load()} onToast={onToast} size="sm" />
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.topic || 'Untitled'}</div>
              <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{(c.content || '').replace(/[#*_`>]/g, '').slice(0, 120)}</div>
              <div style={{ fontSize: 10, color: MUTED2, marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={10} />{fmtDateTime(c.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export {
  TABS, EXTERNAL, SETTINGS_TAB, VALID_TABS, NO_SAVE_TABS, CHANNELS, BLOG_LABEL,
  QUICK_GUIDE, QuickGuide, GeneratorPanel, ContentSettingsPanel, ExternalChannelsPanel,
  AiPostPill, PastCreations, fmtDateTime,
};
