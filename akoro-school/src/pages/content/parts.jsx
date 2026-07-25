/**
 * Content hub — constants + panels (mirrors the settings-billing tab pattern).
 * Tabs: Blog Generator · Social Post Generator · Activities Creator ·
 * External Channels · Content Settings.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PenLine, Megaphone, Sparkles, Share2, SlidersHorizontal, BookOpen,
  Facebook, Instagram, Twitter, Music2, Loader2, Copy, Check, CheckCircle2, ChevronRight,
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
  blog:     { title: 'Blog Post Generator',  topicLabel: 'What should the post be about?', topicPh: 'e.g. Our new science lab and what students are building' },
  social:   { title: 'Social Post Generator', topicLabel: 'What are you announcing?',       topicPh: 'e.g. Open day this Saturday, 10am' },
  activity: { title: 'Activities Creator',    topicLabel: 'Topic or learning goal',          topicPh: 'e.g. Introduce fractions to JSS1' },
};

function GeneratorPanel({ kind, onToast }) {
  const cfg = GEN_CONFIG[kind];
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('');
  const [audience, setAudience] = useState('');
  const [platform, setPlatform] = useState('');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!topic.trim()) { onToast?.('Tell me what it’s about'); return; }
    setBusy(true); setResult('');
    try {
      const res = await apiPost('/api/school/content/generate', {
        kind, topic: topic.trim(), tone: tone.trim() || null,
        audience: audience.trim() || null, platform: platform || null, extra: extra.trim() || null,
      });
      setResult(res?.data?.content || '');
    } catch (e) { onToast?.(e.message || 'Could not generate'); }
    finally { setBusy(false); }
  };

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
            <button onClick={copy} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: copied ? GREEN : MUTED, fontSize: 12, fontWeight: 700, fontFamily: FONT }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre style={{ margin: 0, padding: '14px 16px', fontSize: 13, lineHeight: 1.6, color: INK, fontFamily: FONT, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{result}</pre>
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

export {
  TABS, EXTERNAL, SETTINGS_TAB, VALID_TABS, NO_SAVE_TABS, CHANNELS,
  QUICK_GUIDE, QuickGuide, GeneratorPanel, ContentSettingsPanel, ExternalChannelsPanel,
};
