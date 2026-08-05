/**
 * TeachingTools — the teaching tool suite, rendered from the backend catalog.
 *
 * The form is built from `fields` returned by GET /api/teaching/tools, so a new
 * tool added on the server appears here with no frontend change. Only the four
 * OUTPUT shapes are known to this file:
 *
 *   doc      → titled cards of labelled blocks (most tools)
 *   markdown → plain readable text (fallback)
 *   cards    → flippable flashcards (vocabulary)
 *   script   → transcript + narrated audio with a speed control (podcast)
 *   grades   → one result card per essay
 *
 * Used by the school portal page and by the AI chat on a school website, which
 * passes `onInsert` to drop the result into the conversation.
 */
import { useState, useEffect, useRef } from 'react';
import { Sparkles, Copy, Check, Printer, Loader2, ArrowLeft, Volume2, Play, Pause, MessageSquarePlus,
  AlertCircle, CheckCircle2, HelpCircle, Lightbulb, Briefcase, Link2, Clock, Package, Target,
  ListChecks, MessageCircle, GraduationCap, Users, FileText, Award } from 'lucide-react';
import { apiGet, apiPost } from '../../services/api.js';

const FONT = "'Nunito', sans-serif";
const BRAND = '#6C3BFF', AMBER = '#E8853A', MUTED = '#6B6B80', MUTED2 = '#9A96A8',
      BORDER = '#EDE8E1', INK = '#1A1A2E', LIGHT = '#F7F5F2', WHITE = '#fff', GREEN = '#16A34A', RED = '#DC2626';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

/* Block labels are free text from the model, so they're matched on keywords
   rather than an exact list — a tool can invent a label and still get a sensible
   icon and colour instead of falling out of the design. */
const LABEL_STYLES = [
  [/misconception|watch for|struggle/i,        { icon: AlertCircle,   color: '#DC2626' }],
  [/clarification|correct|answer|truth/i,      { icon: CheckCircle2,  color: '#16A34A' }],
  [/why|because|reason/i,                      { icon: HelpCircle,    color: '#2563EB' }],
  [/fix|strateg|support|tip/i,                 { icon: Lightbulb,     color: '#7C3AED' }],
  [/profession|career|job/i,                   { icon: Briefcase,     color: '#7C3AED' }],
  [/context|connection|application|real/i,     { icon: Link2,         color: '#0EA5E9' }],
  [/timing|time|duration/i,                    { icon: Clock,         color: '#D97706' }],
  [/material|resource|equipment/i,             { icon: Package,       color: '#0891B2' }],
  [/objective|outcome|end|goal|bridge/i,       { icon: Target,        color: '#DB2777' }],
  [/question|quick check|check for/i,          { icon: ListChecks,    color: '#059669' }],
  [/discussion|talk|prompt/i,                  { icon: MessageCircle, color: '#2563EB' }],
  [/teacher does|instruction|for students/i,   { icon: GraduationCap, color: '#7C3AED' }],
  [/students do|group|activity|try this/i,     { icon: Users,         color: '#EA580C' }],
  [/mark|score|grade|total/i,                  { icon: Award,         color: '#CA8A04' }],
];
const styleFor = (label) => (LABEL_STYLES.find(([re]) => re.test(label || ''))?.[1]) || { icon: FileText, color: BRAND };

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
    @media print{@page{margin:16mm}}
  </style></head><body>${bodyHtml}<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

/* ══════════════════════ Output renderers ══════════════════════ */

function Doc({ data }) {
  return (
    <div>
      {(data.cards || []).map((c, n) => (
        <div key={n} style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px', marginBottom: 12, background: WHITE }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: INK, marginBottom: 12 }}>{c.heading}</div>
          {(c.blocks || []).map((b, k) => {
            const { icon: Icon, color } = styleFor(b.label);
            return (
              <div key={k} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 7, background: `${color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={12} color={color} />
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color }}>{b.label}</span>
                </div>
                {b.chips?.length ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 29 }}>
                    {b.chips.map((x, j) => (
                      <span key={j} style={{ padding: '5px 11px', borderRadius: 8, background: LIGHT, border: `1px solid ${BORDER}`, fontSize: 12, fontWeight: 700, color: INK }}>{x}</span>
                    ))}
                  </div>
                ) : b.bullets?.length ? (
                  <ul style={{ margin: 0, paddingLeft: 48, color: INK, fontSize: 13.5, lineHeight: 1.65 }}>
                    {b.bullets.map((x, j) => <li key={j} style={{ marginBottom: 4 }}><Bold>{x}</Bold></li>)}
                  </ul>
                ) : (
                  <p style={{ margin: 0, paddingLeft: 29, fontSize: 13.5, color: INK, lineHeight: 1.65 }}><Bold>{b.text}</Bold></p>
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
          <div key={n} style={{ borderTop: n === 0 ? 'none' : `1px solid ${BORDER}`, padding: '10px 0' }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{k.term}</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{k.definition}</div>
            {k.example && <div style={{ fontSize: 12, color: MUTED2, fontStyle: 'italic', marginTop: 3 }}>{k.example}</div>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>{i + 1} / {cards.length}</span>
        <button onClick={() => setListMode(true)} style={chip}>See all</button>
      </div>
      <div
        onClick={() => setFlipped((f) => !f)}
        style={{ minHeight: 168, borderRadius: 14, border: `1.5px solid ${flipped ? BRAND : BORDER}`,
          background: flipped ? `${BRAND}08` : WHITE, padding: '22px 20px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
        {!flipped ? (
          <div style={{ fontSize: 20, fontWeight: 900, color: INK }}>{c.term}</div>
        ) : (
          <>
            <div style={{ fontSize: 14, color: INK, fontWeight: 600, lineHeight: 1.55 }}>{c.definition}</div>
            {c.example && <div style={{ fontSize: 12.5, color: MUTED, fontStyle: 'italic', marginTop: 10 }}>{c.example}</div>}
            {c.tip && <div style={{ fontSize: 12, color: AMBER, fontWeight: 700, marginTop: 8 }}>💡 {c.tip}</div>}
          </>
        )}
        <div style={{ fontSize: 10.5, color: MUTED2, marginTop: 14 }}>{flipped ? 'Tap to hide' : 'Tap to reveal'}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={() => { setI((n) => Math.max(0, n - 1)); setFlipped(false); }} disabled={i === 0} style={{ ...ghost, flex: 1 }}>Previous</button>
        <button onClick={() => { setI((n) => Math.min(cards.length - 1, n + 1)); setFlipped(false); }} disabled={i >= cards.length - 1} style={{ ...ghost, flex: 1 }}>Next</button>
      </div>
    </div>
  );
}

function Podcast({ data, onError }) {
  const [audio, setAudio] = useState(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showScript, setShowScript] = useState(true);
  const ref = useRef(null);

  // playbackRate is reset whenever a new src loads, so it's reapplied here
  // rather than only in the speed handler.
  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed, audio]);

  const narrate = async () => {
    setBusy(true);
    try {
      const r = await apiPost('/api/teaching/tools/podcast/audio', { turns: data.turns || [] });
      setAudio((r?.data ?? r)?.audio || null);
    } catch (e) { onError(e?.message || 'Could not create the audio'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      {!audio ? (
        <button onClick={narrate} disabled={busy} style={{ ...primary, width: '100%', justifyContent: 'center', marginBottom: 14 }}>
          {busy ? <><Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> Recording the episode…</> : <><Volume2 size={15} /> Generate audio</>}
        </button>
      ) : (
        <div style={{ background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <audio ref={ref} src={audio} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)} controls style={{ width: '100%' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={() => { const a = ref.current; if (!a) return; playing ? a.pause() : a.play(); }} style={ghost}>
              {playing ? <Pause size={13} /> : <Play size={13} />} {playing ? 'Pause' : 'Play'}
            </button>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED }}>Speed</span>
            {SPEEDS.map((s) => (
              <button key={s} onClick={() => setSpeed(s)}
                style={{ ...chip, borderColor: speed === s ? BRAND : BORDER, color: speed === s ? BRAND : MUTED, fontWeight: speed === s ? 800 : 600 }}>
                {s}×
              </button>
            ))}
            <a href={audio} download="podcast.mp3" style={{ ...ghost, textDecoration: 'none' }}>Download</a>
          </div>
        </div>
      )}

      <button onClick={() => setShowScript((s) => !s)} style={chip}>{showScript ? 'Hide transcript' : 'Show transcript'}</button>
      {showScript && (
        <div style={{ marginTop: 12 }}>
          {data.summary && <p style={{ fontSize: 12.5, color: MUTED, marginBottom: 12 }}>{data.summary}</p>}
          {(data.turns || []).map((t, n) => (
            <div key={n} style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 11.5, fontWeight: 900, color: BRAND }}>{t.speaker}</span>
              <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.6 }}>{t.text}</div>
            </div>
          ))}
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
        const col = pct >= 70 ? GREEN : pct >= 50 ? AMBER : RED;
        return (
          <div key={n} style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: INK }}>{g.label}</span>
              <span style={{ fontSize: 15, fontWeight: 900, color: col }}>{g.score}/{g.outOf} <span style={{ fontSize: 11.5, color: MUTED }}>({pct}%)</span></span>
            </div>
            {(g.breakdown || []).map((b, k) => (
              <div key={k} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '5px 0', borderTop: k === 0 ? 'none' : `1px solid ${BORDER}` }}>
                <span style={{ fontWeight: 700, color: INK, minWidth: 0, flex: 1 }}>{b.criterion}</span>
                <span style={{ fontWeight: 800, color: MUTED, flexShrink: 0 }}>{b.score}/{b.outOf}</span>
              </div>
            ))}
            {g.feedback && <p style={{ fontSize: 12.5, color: MUTED, marginTop: 10, lineHeight: 1.55 }}>{g.feedback}</p>}
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
          <ArrowLeft size={13} /> All tools
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
          <button key={t.key} onClick={() => setTool(t)} disabled={t.locked}
            style={{ ...toolCard, opacity: t.locked ? .55 : 1, cursor: t.locked ? 'default' : 'pointer' }}>
            <span style={{ fontSize: 22 }}>{t.emoji}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{t.name}{t.locked ? ' 🔒' : ''}</div>
              <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.45, marginTop: 2 }}>
                {t.locked ? 'Unlock this in Tools & Assets' : t.blurb}
              </div>
            </div>
          </button>
        ))}
      </div>
      {!tools.length && !error && <div style={{ color: MUTED2, fontSize: 13, padding: 20 }}>Loading tools…</div>}
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
            <div style={{ fontSize: 15, fontWeight: 900, color: INK }}>{tool.name}</div>
          </div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 16px' }}>{tool.blurb}</p>
        </>
      )}

      {tool.fields.map((f) => (
        <div key={f.name} style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11.5, fontWeight: 800, color: MUTED, display: 'block', marginBottom: 5 }}>
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
        {busy ? <><Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> Working…</> : <><Sparkles size={15} /> Generate</>}
      </button>
      {error && <div style={errBox}>{error}</div>}

      {out && <Result tool={tool} out={out} onInsert={onInsert} onError={setError} />}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Result({ tool, out, onInsert, onError = () => {}, title }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(out.content || ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  const print = () => {
    const head = out.title || title || tool.name;
    if (tool.output === 'doc') {
      const meta = [out.subject, out.class].filter(Boolean).join(' · ');
      printDoc(head, `<h1>${esc(head)}</h1>${out.subtitle ? `<p class="sub">${esc(out.subtitle)}</p>` : ''}${meta ? `<p class="sub">${esc(meta)}</p>` : ''}` +
        (out.cards || []).map((c) => `<div class="card"><h2>${esc(c.heading)}</h2>` +
          (c.blocks || []).map((b) => `<div class="blk"><div class="lbl">${esc(b.label)}</div>` +
            (b.chips?.length ? `<p>${b.chips.map((x) => `<span class="chip">${esc(x)}</span>`).join(' ')}</p>`
              : b.bullets?.length ? `<ul>${b.bullets.map((x) => `<li>${boldish(x)}</li>`).join('')}</ul>`
              : `<p>${boldish(b.text)}</p>`) + '</div>').join('') + '</div>').join(''));
      return;
    }
    if (tool.output === 'cards') {
      printDoc(head, `<h1>${esc(out.title || head)}</h1>` +
        (out.cards || []).map((c) => `<div class="card"><div class="term">${esc(c.term)}</div><div class="def">${esc(c.definition)}</div>${c.example ? `<div class="ex">${esc(c.example)}</div>` : ''}</div>`).join(''));
      return;
    }
    printDoc(head, `<h1>${esc(head)}</h1>${mdToHtml(out.content || '')}`);
  };

  return (
    <div style={{ marginTop: 18, borderTop: `1px solid ${BORDER}`, paddingTop: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={copy} style={ghost}>{copied ? <Check size={13} color={GREEN} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}</button>
        <button onClick={print} style={ghost}><Printer size={13} /> Save as PDF</button>
        {onInsert && <button onClick={() => onInsert(out.content || '')} style={ghost}><MessageSquarePlus size={13} /> Send to chat</button>}
        {out.coinsCharged > 0 && <span style={{ fontSize: 11, color: MUTED2, alignSelf: 'center' }}>{out.coinsCharged.toLocaleString()} coins</span>}
      </div>

      {tool.output === 'doc' && (
        <>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 19, fontWeight: 900, color: INK }}>{out.title || title}</div>
            {out.subtitle && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>{out.subtitle}</div>}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', marginTop: 9 }}>
              {out.subject && <span style={{ ...pill, background: `${AMBER}18`, color: AMBER }}>{out.subject}</span>}
              {out.class   && <span style={{ ...pill, background: `${BRAND}18`, color: BRAND }}>{out.class}</span>}
            </div>
          </div>
          <Doc data={out} />
        </>
      )}
      {tool.output === 'cards'  && <Flashcards data={out} />}
      {tool.output === 'script' && <Podcast data={out} onError={onError} />}
      {tool.output === 'grades' && <Grades data={out} />}
      {tool.output === 'markdown' && (
        <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: mdToHtml(out.content || '') }} />
      )}
    </div>
  );
}
ToolRunner.Result = Result;

const input = { width: '100%', padding: '10px 12px', borderRadius: 9, border: `1px solid ${BORDER}`, fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' };
const primary = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '11px 18px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${BRAND},#5326CC)`, color: WHITE, fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT };
const ghost = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 13px', borderRadius: 9, border: `1px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT };
const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 11px', borderRadius: 999, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT };
const toolCard = { display: 'flex', gap: 11, alignItems: 'flex-start', textAlign: 'left', padding: '14px 15px', borderRadius: 12, border: `1px solid ${BORDER}`, background: WHITE, cursor: 'pointer', fontFamily: FONT };
const pill = { padding: '4px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 800, fontFamily: FONT };
const errBox = { marginTop: 12, padding: '10px 12px', borderRadius: 9, background: `${RED}0F`, border: `1px solid ${RED}33`, color: RED, fontSize: 12.5, fontWeight: 700 };
