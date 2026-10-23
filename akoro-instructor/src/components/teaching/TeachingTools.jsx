/**
 * TeachingTools — the teaching tool suite, rendered from the backend catalog.
 *
 * The form is built from `fields` returned by GET /api/teaching/tools, so a new
 * tool added on the server appears here with no frontend change. Only the four
 * result is drawn by ToolResult.jsx — every tool returns the same template.
 * This file keeps what is specific to a kind of output: the podcast player,
 * the flashcard study mode, and the print window. The doc / cards / grades
 * renderers below are only the fallback for results saved before the template.
 *
 * Used by the school portal page and by the AI chat on a school website, which
 * passes `onInsert` to drop the result into the conversation.
 */
import { useState, useEffect, useRef } from 'react';
import { Copy, Play, Download, AlertCircle, CheckCircle2, HelpCircle, Lightbulb, Briefcase, Link2, Clock, Package, Target, ListChecks, MessageCircle, GraduationCap, Users, FileText, Award } from 'lucide-react';
import { Ico } from '../../theme/Ico.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { C } from '../../theme/colors.js';
import { ResultHeader, ResultEntries, resultToHtml, accentFor } from './ToolResult.jsx';

const TT_FONT = "'Nunito', sans-serif";
const BRAND = '#6C3BFF', TT_AMBER = '#E8853A', TT_MUTED2 = '#9A96A8',
      TT_LIGHT = '#F7F5F2', GREEN = '#16A34A', RED = '#DC2626';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/* Block labels are free text from the model, so they're matched on keywords
   rather than an exact list — a tool can invent a label and still get a sensible
   icon and colour instead of falling out of the design. */
const LABEL_STYLES = [
  [/misconception|watch for|struggle/i,        { icon: AlertCircle, ti: 'ti-alert-circle',   color: '#DC2626' }],
  [/clarification|correct|answer|truth/i,      { icon: CheckCircle2, ti: 'ti-circle-check',  color: '#16A34A' }],
  [/why|because|reason/i,                      { icon: HelpCircle, ti: 'ti-help-circle',    color: '#2563EB' }],
  [/fix|strateg|support|tip/i,                 { icon: Lightbulb, ti: 'ti-bulb',     color: '#7C3AED' }],
  [/profession|career|job/i,                   { icon: Briefcase, ti: 'ti-briefcase',     color: '#7C3AED' }],
  [/context|connection|application|real/i,     { icon: Link2, ti: 'ti-link',         color: '#0EA5E9' }],
  [/timing|time|duration/i,                    { icon: Clock, ti: 'ti-clock',         color: '#D97706' }],
  [/material|resource|equipment/i,             { icon: Package, ti: 'ti-package',       color: '#0891B2' }],
  [/objective|outcome|end|goal|bridge/i,       { icon: Target, ti: 'ti-target',        color: '#DB2777' }],
  [/question|quick check|check for/i,          { icon: ListChecks, ti: 'ti-list-check',    color: '#059669' }],
  [/discussion|talk|prompt/i,                  { icon: MessageCircle, ti: 'ti-message-circle', color: '#2563EB' }],
  [/teacher does|instruction|for students/i,   { icon: GraduationCap, ti: 'ti-school', color: '#7C3AED' }],
  [/students do|group|activity|try this/i,     { icon: Users, ti: 'ti-users',         color: '#EA580C' }],
  [/mark|score|grade|total/i,                  { icon: Award, ti: 'ti-award',         color: '#CA8A04' }],
];
const styleFor = (label) => (LABEL_STYLES.find(([re]) => re.test(label || ''))?.[1]) || { icon: FileText, ti: 'ti-file-text', color: BRAND };

/* ── Minimal Markdown → HTML. Enough for headings, bold, italic, lists and
   rules, which is all the tool prompts ask the model to produce. Escaped
   first, so model output can never inject markup. ── */
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function mdToHtml(md) {
  const lines = esc(md).split('\n');
  let html = '', inList = false;
  const inline = (t) => t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const l = raw.trim();
    const li = l.match(/^[-*]\s+(.*)$/) || l.match(/^\d+\.\s+(.*)$/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (!l) { continue; }
    if (/^#{1,6}\s/.test(l)) { const n = l.match(/^#+/)[0].length; html += `<h${n}>${inline(l.replace(/^#+\s*/, ''))}</h${n}>`; continue; }
    if (/^(---|===)$/.test(l)) { html += '<hr>'; continue; }
    html += `<p>${inline(l)}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

// **bold** only — everything else is escaped, so model text can't inject markup.
const boldish = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

function Bold({ children }) {
  return <span dangerouslySetInnerHTML={{ __html: boldish(children) }} />;
}

function printDoc(title, bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    body{font-family:Georgia,'Times New Roman',serif;max-width:760px;margin:0 auto;padding:36px 28px;color:#1a1a2e;line-height:1.6}
    h1{font-size:24px;border-bottom:2px solid #333;padding-bottom:8px}
    h2{font-size:19px;margin-top:26px} h3{font-size:16px}
    ul{padding-left:22px} li{margin-bottom:5px} hr{border:none;border-top:1px solid #ccc;margin:22px 0}
    code{background:#f1f1f4;padding:1px 4px;border-radius:3px;font-size:.92em}
    .card{border:1px solid #999;border-radius:8px;padding:12px 14px;margin-bottom:10px;page-break-inside:avoid}
    .term{font-weight:700;font-size:15px} .def{margin-top:4px} .ex{font-style:italic;color:#555;margin-top:4px;font-size:.94em}
    .card h2{margin:0 0 10px;font-size:17px} .blk{margin-bottom:12px}
    .lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:3px}
    .blk p{margin:0} .blk ul{margin:0}
    .chip{display:inline-block;border:1px solid #bbb;border-radius:20px;padding:2px 9px;margin-right:5px;font-size:.9em}
    .sub{color:#555;font-style:italic;margin-top:-4px}
    @media print{@page{margin:16mm}} ol{padding-left:22px} small{font-weight:400;color:#666}
  </style></head><body>${bodyHtml}<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

/* ══════════════════════ Output renderers ══════════════════════ */

function Doc({ data }) {
  return (
    <div>
      {(data.cards || []).map((c, n) => (
        <div key={n} style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', marginBottom: 12, background: C.surface }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: C.ink, marginBottom: 12 }}>{c.heading}</div>
          {(c.blocks || []).map((b, k) => {
            const { icon: Icon, ti, color } = styleFor(b.label);
            return (
              <div key={k} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 7, background: `${color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Ico ti={ti} size={12} color={color} />
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color }}>{b.label}</span>
                </div>
                {b.chips?.length ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 29 }}>
                    {b.chips.map((x, j) => (
                      <span key={j} style={{ padding: '5px 11px', borderRadius: 8, background: TT_LIGHT, border: `1px solid ${C.border}`, fontSize: 12, fontWeight: 700, color: C.ink }}>{x}</span>
                    ))}
                  </div>
                ) : b.bullets?.length ? (
                  <ul style={{ margin: 0, paddingLeft: 48, color: C.ink, fontSize: 13.5, lineHeight: 1.65 }}>
                    {b.bullets.map((x, j) => <li key={j} style={{ marginBottom: 4 }}><Bold>{x}</Bold></li>)}
                  </ul>
                ) : (
                  <p style={{ margin: 0, paddingLeft: 29, fontSize: 13.5, color: C.ink, lineHeight: 1.65 }}><Bold>{b.text}</Bold></p>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Flashcards({ data }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [listMode, setListMode] = useState(false);
  const cards = data.cards || [];
  if (!cards.length) return null;
  const c = cards[Math.min(i, cards.length - 1)];

  if (listMode) {
    return (
      <div>
        <button onClick={() => setListMode(false)} style={chip}>Flashcards</button>
        {cards.map((k, n) => (
          <div key={n} style={{ borderTop: n === 0 ? 'none' : `1px solid ${C.border}`, padding: '10px 0' }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{k.term}</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{k.definition}</div>
            {k.example && <div style={{ fontSize: 12, color: TT_MUTED2, fontStyle: 'italic', marginTop: 3 }}>{k.example}</div>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{i + 1} / {cards.length}</span>
        <button onClick={() => setListMode(true)} style={chip}>See all</button>
      </div>
      <div
        onClick={() => setFlipped((f) => !f)}
        style={{ minHeight: 168, borderRadius: 14, border: `1.5px solid ${flipped ? BRAND : C.border}`,
          background: flipped ? `${BRAND}08` : C.surface, padding: '22px 20px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
        {!flipped ? (
          <div style={{ fontSize: 20, fontWeight: 900, color: C.ink }}>{c.term}</div>
        ) : (
          <>
            <div style={{ fontSize: 14, color: C.ink, fontWeight: 600, lineHeight: 1.55 }}>{c.definition}</div>
            {c.example && <div style={{ fontSize: 12.5, color: C.muted, fontStyle: 'italic', marginTop: 10 }}>{c.example}</div>}
            {c.tip && <div style={{ fontSize: 12, color: TT_AMBER, fontWeight: 700, marginTop: 8 }}><Ico ti="ti-bulb" size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />{c.tip}</div>}
          </>
        )}
        <div style={{ fontSize: 10.5, color: TT_MUTED2, marginTop: 14 }}>{flipped ? 'Tap to hide' : 'Tap to reveal'}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={() => { setI((n) => Math.max(0, n - 1)); setFlipped(false); }} disabled={i === 0} style={{ ...ghost, flex: 1 }}>Previous</button>
        <button onClick={() => { setI((n) => Math.min(cards.length - 1, n + 1)); setFlipped(false); }} disabled={i >= cards.length - 1} style={{ ...ghost, flex: 1 }}>Next</button>
      </div>
    </div>
  );
}

const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

/**
 * Podcast — the generated episode as a real player.
 *
 * The transcript follows the audio: the segment list the server returns carries
 * each turn's byte range, and OpenAI's mp3 is constant bit-rate, so the byte
 * fraction maps onto the time fraction. That gives a current-turn highlight and
 * click-a-line-to-jump without decoding anything. It is a proxy for real
 * timestamps — close enough that a listener can't tell, and free.
 */
function Podcast({ data, tool, onError }) {
  const [audio, setAudio] = useState(null);
  const [segments, setSegments] = useState([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [voices, setVoices] = useState({});
  // Voice options come from the tool's own field definition, so the list can
  // never drift from what the server accepts. A reopened past generation has no
  // catalog behind it, hence the fallback to whatever the script was made with.
  const voiceOptions = tool?.fields?.find((f) => f.name === 'voiceA')?.options || [];
  const [voiceA, setVoiceA] = useState(data.voiceA || voiceOptions[0] || '');
  const [voiceB, setVoiceB] = useState(data.voiceB || voiceOptions[1] || '');
  const [narratedWith, setNarratedWith] = useState(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [showScript, setShowScript] = useState(true);
  const ref = useRef(null);

  // playbackRate resets whenever a new src loads, so it is reapplied on both.
  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed, audio]);
  useEffect(() => { if (ref.current) ref.current.volume = volume; }, [volume, audio]);

  const narrate = async () => {
    setBusy(true);
    try {
      const r = await apiPost('/api/teaching/tools/podcast/audio', {
        turns: data.turns || [], voiceA, voiceB,
      });
      const d = r?.data ?? r;
      setAudio(d?.audio || null);
      setSegments(d?.segments || []);
      setTotalBytes(d?.totalBytes || 0);
      setVoices(d?.voices || {});
      setNarratedWith(`${voiceA}|${voiceB}`);
      setTime(0); setPlaying(false);
    } catch (e) { onError(e?.message || 'Could not create the audio'); }
    finally { setBusy(false); }
  };

  // Re-narrating is a fresh round of text-to-speech and is charged again, so
  // the button only offers itself once the voices actually differ from the
  // ones this recording was made with.
  const voicesChanged = narratedWith !== null && narratedWith !== `${voiceA}|${voiceB}`;

  const voicePickers = (compact) => (
    voiceOptions.length === 0 ? null : (
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: compact ? 0 : 12 }}>
        {[['First voice', voiceA, setVoiceA], ['Second voice', voiceB, setVoiceB]].map(([label, val, set]) => (
          <label key={label} style={{ flex: '1 1 180px', minWidth: 160 }}>
            <span style={{ display: 'block', fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 4 }}>{label}</span>
            <select value={val} onChange={(e) => set(e.target.value)} style={{ ...input, padding: '8px 10px' }}>
              {voiceOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
      </div>
    )
  );

  const seek = (t) => { const a = ref.current; if (a) { a.currentTime = Math.max(0, Math.min(t, duration || 0)); setTime(a.currentTime); } };
  const nudge = (by) => seek((ref.current?.currentTime || 0) + by);
  const toggle = () => { const a = ref.current; if (!a) return; playing ? a.pause() : a.play(); };

  // Which turn is sounding now, and where each one starts.
  const startOf = (i) => (totalBytes && duration && segments[i] ? (segments[i].byteStart / totalBytes) * duration : null);
  const currentTurn = (() => {
    if (!totalBytes || !duration || !segments.length) return -1;
    const b = (time / duration) * totalBytes;
    return segments.findIndex((sg) => b >= sg.byteStart && b < sg.byteEnd);
  })();

  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <div>
      {!audio ? (
        <>
          {voicePickers()}
          <button onClick={narrate} disabled={busy} style={{ ...primary, width: '100%', justifyContent: 'center', marginBottom: 14 }}>
            {busy
              ? <><Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> Recording the episode…</>
              : <><Ico ti="ti-volume" size={15} /> Generate audio</>}
          </button>
        </>
      ) : (
        <div style={{ background: TT_LIGHT, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
          <audio ref={ref} src={audio} preload="metadata"
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
            onEnded={() => { setPlaying(false); setTime(0); }}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            style={{ display: 'none' }} />

          {/* Scrubber */}
          <input type="range" min={0} max={duration || 0} step={0.1} value={time}
            onChange={(e) => seek(Number(e.target.value))}
            style={{ width: '100%', accentColor: BRAND, cursor: 'pointer' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: TT_MUTED2, fontWeight: 700, marginTop: -2 }}>
            <span>{fmtTime(time)}</span><span>{fmtTime(duration)}</span>
          </div>

          {/* Transport */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 10 }}>
            <button onClick={() => nudge(-10)} title="Back 10 seconds" style={iconBtn}><Ico ti="ti-player-skip-back" size={16} /></button>
            <button onClick={toggle} style={playBtn}>
              {playing ? <Ico ti="ti-player-pause" size={19} color="#fff" /> : <Ico ti="ti-player-play" size={19} color="#fff" style={{ marginLeft: 2 }} />}
            </button>
            <button onClick={() => nudge(10)} title="Forward 10 seconds" style={iconBtn}><Ico ti="ti-player-skip-forward" size={16} /></button>
          </div>

          {/* Speed · volume · download */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: .3 }}>SPEED</span>
            {SPEEDS.map((sp) => (
              <button key={sp} onClick={() => setSpeed(sp)}
                style={{ ...chip, padding: '4px 9px',
                  borderColor: speed === sp ? BRAND : C.border,
                  background: speed === sp ? `${BRAND}12` : 'transparent',
                  color: speed === sp ? BRAND : C.muted, fontWeight: speed === sp ? 800 : 600 }}>
                {sp}×
              </button>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 6 }}>
              <Ico ti="ti-volume" size={13} color={C.muted} />
              <input type="range" min={0} max={1} step={0.05} value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                style={{ width: 74, accentColor: BRAND, cursor: 'pointer' }} />
            </div>
            <a href={audio} download="podcast.mp3" style={{ ...ghost, textDecoration: 'none', marginLeft: 'auto' }}>
              <Ico ti="ti-download" size={13} /> Download
            </a>
          </div>

          {Object.keys(voices).length > 0 && (
            <div style={{ fontSize: 11, color: TT_MUTED2, marginTop: 9 }}>
              {Object.entries(voices).map(([who, v]) => `${who} — ${v}`).join('   ·   ')}
            </div>
          )}

          {/* Change the cast without regenerating the script */}
          {voiceOptions.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              {voicePickers(true)}
              <button onClick={narrate} disabled={busy || !voicesChanged}
                title={voicesChanged ? 'Records the same script again with the new voices' : 'Pick different voices to re-record'}
                style={{ ...ghost, marginTop: 10, opacity: busy || !voicesChanged ? .55 : 1 }}>
                {busy
                  ? <><Ico ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} /> Re-recording…</>
                  : <><Ico ti="ti-rotate" size={13} /> Re-narrate with these voices</>}
              </button>
              {voicesChanged && !busy && (
                <span style={{ fontSize: 11, color: TT_MUTED2, marginLeft: 10 }}>Charged again — the script is reused, the audio is new.</span>
              )}
            </div>
          )}
        </div>
      )}

      <button onClick={() => setShowScript((v) => !v)} style={chip}>
        {showScript ? 'Hide transcript' : 'Show transcript'}
      </button>

      {showScript && (
        <div style={{ marginTop: 12 }}>
          {data.summary && <p style={{ fontSize: 12.5, color: C.muted, marginBottom: 12 }}>{data.summary}</p>}
          {(data.turns || []).map((t, n) => {
            const at = startOf(n);
            const on = n === currentTurn;
            return (
              <div key={n}
                onClick={() => { if (at != null) { seek(at); ref.current?.play(); } }}
                title={at != null ? 'Play from here' : undefined}
                style={{
                  marginBottom: 8, padding: '8px 11px', borderRadius: 10,
                  cursor: at != null ? 'pointer' : 'default',
                  background: on ? `${BRAND}0E` : 'transparent',
                  borderLeft: `3px solid ${on ? BRAND : 'transparent'}`,
                }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 900, color: BRAND }}>{t.speaker}</span>
                  {at != null && <span style={{ fontSize: 10.5, color: TT_MUTED2, fontWeight: 700 }}>{fmtTime(at)}</span>}
                </div>
                <div style={{ fontSize: 13.5, color: C.ink, lineHeight: 1.6 }}>{t.text}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Grades({ data }) {
  return (
    <div>
      {(data.grades || []).map((g, n) => {
        const pct = g.outOf ? Math.round((g.score / g.outOf) * 100) : 0;
        const col = pct >= 70 ? GREEN : pct >= 50 ? TT_AMBER : RED;
        return (
          <div key={n} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{g.label}</span>
              <span style={{ fontSize: 15, fontWeight: 900, color: col }}>{g.score}/{g.outOf} <span style={{ fontSize: 11.5, color: C.muted }}>({pct}%)</span></span>
            </div>
            {(g.breakdown || []).map((b, k) => (
              <div key={k} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '5px 0', borderTop: k === 0 ? 'none' : `1px solid ${C.border}` }}>
                <span style={{ fontWeight: 700, color: C.ink, minWidth: 0, flex: 1 }}>{b.criterion}</span>
                <span style={{ fontWeight: 800, color: C.muted, flexShrink: 0 }}>{b.score}/{b.outOf}</span>
              </div>
            ))}
            {g.feedback && <p style={{ fontSize: 12.5, color: C.muted, marginTop: 10, lineHeight: 1.55 }}>{g.feedback}</p>}
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════ Main ══════════════════════ */

export default function TeachingTools({ onInsert, compact = false }) {
  const [tools, setTools] = useState([]);
  const [tool, setTool] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet('/api/teaching/tools')
      .then((r) => setTools(r.data || r || []))
      .catch((e) => setError(e?.message || 'Could not load the tools'));
  }, []);

  if (tool) {
    return (
      <div>
        <button onClick={() => setTool(null)} style={{ ...ghost, marginBottom: 14 }}>
          <Ico ti="ti-arrow-left" size={13} /> All tools
        </button>
        <ToolRunner tool={tool} onInsert={onInsert} showHeader />
      </div>
    );
  }

  return (
    <div>
      {error && <div style={errBox}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fill,minmax(230px,1fr))', gap: 10 }}>
        {tools.map((t) => (
          <button key={t.key} onClick={() => setTool(t)} style={{ ...toolCard, cursor: 'pointer' }}>
            <span style={{ fontSize: 15, fontWeight: 900, color: '#6B7280' }}>{(t.name || 'T').trim().charAt(0).toUpperCase()}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{t.name}</div>
              <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.45, marginTop: 2 }}>
                {t.blurb}
              </div>
            </div>
          </button>
        ))}
      </div>
      {!tools.length && !error && <div style={{ color: TT_MUTED2, fontSize: 13, padding: 20 }}>Loading tools…</div>}
    </div>
  );
}

/**
 * ToolRunner — one tool's form and its result. Exported so the Tools & Assets
 * workbench can host exactly the same thing inside its own chrome; nothing
 * about a tool's behaviour or appearance is duplicated between the two.
 */
export function ToolRunner({ tool, onInsert, onDone, showHeader = false }) {
  const [form, setForm] = useState(() => Object.fromEntries(tool.fields.map((f) => [f.name, f.default || ''])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [out, setOut] = useState(null);

  // Switching tools in the rail reuses this component — reset, or the new tool
  // inherits the previous one's form values and result.
  useEffect(() => {
    setForm(Object.fromEntries(tool.fields.map((f) => [f.name, f.default || ''])));
    setOut(null); setError('');
  }, [tool.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setBusy(true); setError(''); setOut(null);
    try {
      const r = await apiPost(`/api/teaching/tools/${tool.key}`, form);
      setOut(r?.data ?? r);
      onDone?.();
    } catch (e) { setError(e?.message || 'Could not generate that.'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      {showHeader && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
            <span style={{ fontSize: 20 }}>{tool.emoji}</span>
            <div style={{ fontSize: 15, fontWeight: 900, color: C.ink }}>{tool.name}</div>
          </div>
          <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 16px' }}>{tool.blurb}</p>
        </>
      )}

      {tool.fields.map((f) => (
        <div key={f.name} style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, display: 'block', marginBottom: 5 }}>
            {f.label}{f.required && <span style={{ color: RED }}> *</span>}
          </label>
          {f.type === 'select' ? (
            <select value={form[f.name] || ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} style={input}>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : f.long ? (
            <textarea value={form[f.name] || ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              rows={f.rows || 3} placeholder={f.placeholder} style={{ ...input, resize: 'vertical' }} />
          ) : (
            <input value={form[f.name] || ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              placeholder={f.placeholder} style={input} />
          )}
        </div>
      ))}

      <button onClick={run} disabled={busy} style={{ ...primary, width: '100%', justifyContent: 'center' }}>
        {busy ? <><Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> Working…</> : <><Ico ti="ti-sparkles" size={15} /> Generate</>}
      </button>
      {error && <div style={errBox}>{error}</div>}

      {out && <Result tool={tool} out={out} onInsert={onInsert} onError={setError} onReset={() => setOut(null)} />}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Result({ tool, out, onInsert, onError = () => {}, title, onReset }) {
  const [copied, setCopied] = useState(false);
  const [study, setStudy] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(out.content || ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  // Every tool answers in the one template (entries[]); results saved before it
  // still carry their old per-tool shape, which the server lifts on read, and the
  // legacy renderers below are the fallback if one slips through unlifted.
  const templated = Array.isArray(out.entries) && out.entries.length > 0;
  const accent = accentFor(tool.key);
  const head = out.title || title || tool.name;

  const print = () => {
    if (templated) { printDoc(head, resultToHtml(out)); return; }
    printDoc(head, `<h1>${esc(head)}</h1>${mdToHtml(out.content || '')}`);
  };

  return (
    <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
      {templated && <ResultHeader data={{ ...out, title: head }} accent={accent} icon={tool.emoji} name={tool.name} />}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={copy} style={ghost}>{copied ? <Ico ti="ti-check" size={13} color={GREEN} /> : <Ico ti="ti-copy" size={13} />} {copied ? 'Copied' : 'Copy'}</button>
        <button onClick={print} style={ghost}><Ico ti="ti-printer" size={13} /> Save as PDF</button>
        {onInsert && <button onClick={() => onInsert(out.content || '')} style={ghost}><Ico ti="ti-message-plus" size={13} /> Send to chat</button>}
        {tool.output === 'cards' && templated && (
          <button onClick={() => setStudy((v) => !v)} style={ghost}><Ico ti={study ? 'ti-layout-list' : 'ti-cards'} size={13} /> {study ? 'See all' : 'Flashcards'}</button>
        )}
        {onReset && <button onClick={onReset} style={{ ...ghost, marginLeft: 'auto' }}><Ico ti="ti-plus" size={13} /> Create another</button>}
        {out.coinsCharged > 0 && <span style={{ fontSize: 11, color: TT_MUTED2 }}>{out.coinsCharged.toLocaleString()} coins</span>}
      </div>

      {tool.output === 'script' ? <Podcast data={out} tool={tool} onError={onError} />
        : tool.output === 'cards' && study ? <Flashcards data={out} />
        : templated ? <ResultEntries data={out} accent={accent} />
        : tool.output === 'doc' ? <Doc data={out} />
        : tool.output === 'cards' ? <Flashcards data={out} />
        : tool.output === 'grades' ? <Grades data={out} />
        : <div style={{ fontSize: 13.5, color: C.ink, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: mdToHtml(out.content || '') }} />}
    </div>
  );
}
ToolRunner.Result = Result;

const input = { width: '100%', padding: '10px 12px', borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: TT_FONT, color: C.ink, background: C.surface, boxSizing: 'border-box' };
const primary = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '11px 18px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${BRAND},#5326CC)`, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: TT_FONT };
const ghost = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 13px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: TT_FONT };
const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 11px', borderRadius: 999, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: TT_FONT };
const toolCard = { display: 'flex', gap: 11, alignItems: 'flex-start', textAlign: 'left', padding: '14px 15px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer', fontFamily: TT_FONT };
const iconBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', border: `1px solid ${C.border}`, background: C.surface, color: C.muted, cursor: 'pointer' };
const playBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: '50%', border: 'none', background: `linear-gradient(135deg,${BRAND},#5326CC)`, cursor: 'pointer', boxShadow: `0 4px 14px ${BRAND}55` };
const pill = { padding: '4px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 800, fontFamily: TT_FONT };
const errBox = { marginTop: 12, padding: '10px 12px', borderRadius: 9, background: `${RED}0F`, border: `1px solid ${RED}33`, color: RED, fontSize: 12.5, fontWeight: 700 };
