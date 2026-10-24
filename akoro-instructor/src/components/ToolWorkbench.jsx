/**
 * ToolWorkbench — where a purchased tool actually gets used.
 *
 * The App Center has always been a shop. It lists tools, takes payment, and
 * once you own one it renders a green "Unlocked ✓" badge with no action behind
 * it. There was nowhere to run the thing you had just bought.
 *
 * Meanwhile /api/teaching/tools has been complete the whole time: nine tools
 * each declaring their own input `fields`, a POST /:key that runs one, and a
 * /outputs endpoint whose own comment says "so the workbench can list them the
 * way the content hub lists past creations". Nothing in any app called it.
 *
 * So this is not a new feature so much as the missing half of one. It renders
 * each tool's declared fields rather than hard-coding a form per tool, which
 * means a tenth tool added on the server appears here with no frontend change
 * — the server already describes what it needs.
 */
import { useState, useEffect, useCallback } from 'react';
import { Copy } from 'lucide-react';
import { Ico } from '../theme/Ico.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { GREEN } from '../constants.js';
import { C } from '../theme/colors.js';
import Loading from "./Loading.jsx";

/* ── One rendered card of a doc output ───────────────────────────── */
// The server returns { title, subtitle, cards:[{ heading, blocks:[…] }] } and
// each block carries exactly one of text / bullets / chips. Rendering all three
// shapes here is what lets one component serve every tool.
function Block({ block }) {
  const bold = (s) => String(s ?? '').split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} style={{ color: C.ink }}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>);

  return (
    <div style={{ marginBottom: 14 }}>
      {block.label && (
        <div style={{ fontFamily: C.font, fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
          textTransform: 'uppercase', color: C.muted2, marginBottom: 5 }}>{block.label}</div>
      )}
      {block.text && (
        <p style={{ fontFamily: C.font, fontSize: 14, lineHeight: 1.65, color: C.muted, margin: 0 }}>
          {bold(block.text)}
        </p>
      )}
      {Array.isArray(block.bullets) && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {block.bullets.map((b, i) => (
            <li key={i} style={{ fontFamily: C.font, fontSize: 14, lineHeight: 1.6, color: C.muted, marginBottom: 4 }}>
              {bold(b)}
            </li>
          ))}
        </ul>
      )}
      {Array.isArray(block.chips) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {block.chips.map((c, i) => (
            <span key={i} style={{ fontFamily: C.font, fontSize: 12, padding: '3px 9px', borderRadius: 999,
              background: C.bg, border: `1px solid ${C.border}`, color: C.ink }}>{c}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function DocOutput({ doc }) {
  const [copied, setCopied] = useState(false);
  // Plain text, because what a teacher does with this is paste it into a lesson
  // note or a WhatsApp group — not admire it in a card.
  const asText = () => [
    doc.title, doc.subtitle, '',
    ...(doc.cards || []).flatMap((c) => [
      c.heading, ...(c.blocks || []).map((b) =>
        b.text ? b.text
          : Array.isArray(b.bullets) ? b.bullets.map((x) => `• ${x}`).join('\n')
          : Array.isArray(b.chips) ? b.chips.join(', ') : ''), '']),
  ].join('\n').replace(/\*\*/g, '');

  const copy = async () => {
    try { await navigator.clipboard.writeText(asText()); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { /* clipboard blocked — the text is on screen anyway */ }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ fontFamily: C.font, fontSize: 19, fontWeight: 800, color: C.ink, margin: 0 }}>{doc.title}</h3>
          {doc.subtitle && <p style={{ fontFamily: C.font, fontSize: 13.5, color: C.muted, margin: '4px 0 0' }}>{doc.subtitle}</p>}
        </div>
        <button onClick={copy} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          fontFamily: C.font, fontSize: 12.5, fontWeight: 600, padding: '7px 12px', borderRadius: 8,
          border: `1px solid ${C.border}`, background: C.surface, color: C.ink, cursor: 'pointer' }}>
          {copied ? <Ico ti="ti-check" size={13} color={GREEN}/> : <Ico ti="ti-copy" size={13}/>} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {(doc.cards || []).map((card, i) => (
          <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            {card.heading && (
              <div style={{ fontFamily: C.font, fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 12 }}>
                {card.heading}
              </div>
            )}
            {(card.blocks || []).map((b, j) => <Block key={j} block={b}/>)}
          </div>
        ))}
      </div>
    </div>
  );
}


/* ── The three outputs that are not documents ────────────────────
   Six tools return `doc`. Three do not, and each has its own shape declared on
   the server: podcast returns a two-speaker script, vocabulary returns term
   cards, essay-grader returns scored criteria. Rendering all four is what makes
   the workbench usable for nine tools rather than six — the other three were
   falling through to a JSON dump, which is a developer's view of a teacher's
   worksheet. */

function ScriptOutput({ doc }) {
  // Two speakers, alternating. Colouring by speaker rather than by turn index
  // means the eye tracks who is talking, which is the only thing a script is
  // read for.
  const speakers = [...new Set((doc.turns || []).map((t) => t.speaker))];
  return (
    <div>
      <h3 style={{ fontFamily: C.font, fontSize: 19, fontWeight: 800, color: C.ink, margin: 0 }}>{doc.title}</h3>
      {doc.summary && <p style={{ fontFamily: C.font, fontSize: 13.5, color: C.muted, margin: '4px 0 16px' }}>{doc.summary}</p>}
      <div style={{ display: 'grid', gap: 10 }}>
        {(doc.turns || []).map((t, i) => {
          const mine = speakers.indexOf(t.speaker) === 0;
          return (
            <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${mine ? C.brand : GREEN}`, borderRadius: 10, padding: '11px 14px' }}>
              <div style={{ fontFamily: C.font, fontSize: 11.5, fontWeight: 800, letterSpacing: '.04em',
                color: mine ? C.brand : GREEN, marginBottom: 4 }}>{t.speaker}</div>
              <p style={{ fontFamily: C.font, fontSize: 14, lineHeight: 1.6, color: C.muted, margin: 0 }}>{t.text}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VocabOutput({ doc }) {
  return (
    <div>
      <h3 style={{ fontFamily: C.font, fontSize: 19, fontWeight: 800, color: C.ink, margin: '0 0 16px' }}>{doc.title}</h3>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
        {(doc.cards || []).map((c, i) => (
          <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontFamily: C.font, fontSize: 15, fontWeight: 800, color: C.ink, marginBottom: 6 }}>{c.term}</div>
            <p style={{ fontFamily: C.font, fontSize: 13.5, lineHeight: 1.55, color: C.muted, margin: '0 0 8px' }}>{c.definition}</p>
            {c.example && (
              <p style={{ fontFamily: C.font, fontSize: 13, lineHeight: 1.5, color: C.muted2, margin: '0 0 6px', fontStyle: 'italic' }}>
                {c.example}
              </p>
            )}
            {c.tip && (
              <div style={{ fontFamily: C.font, fontSize: 12.5, color: C.ink, background: C.bg,
                border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px' }}>{c.tip}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GradesOutput({ doc }) {
  // A mark out of a total, not a percentage: that is what goes in the register,
  // and converting it here would only make the teacher convert it back.
  const bar = (score, outOf) => Math.max(0, Math.min(100, ((score || 0) / (outOf || 1)) * 100));
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {(doc.grades || []).map((g, i) => (
        <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
            <span style={{ fontFamily: C.font, fontSize: 15, fontWeight: 800, color: C.ink }}>{g.label || `Essay ${i + 1}`}</span>
            <span style={{ fontFamily: C.font, fontSize: 17, fontWeight: 800, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>
              {g.score}<span style={{ fontSize: 13, color: C.muted2 }}> / {g.outOf}</span>
            </span>
          </div>

          {(g.breakdown || []).map((b, j) => (
            <div key={j} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                <span style={{ fontFamily: C.font, fontSize: 13, color: C.ink }}>{b.criterion}</span>
                <span style={{ fontFamily: C.font, fontSize: 12.5, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
                  {b.score}/{b.outOf}
                </span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: C.bg, overflow: 'hidden' }}>
                <div style={{ width: `${bar(b.score, b.outOf)}%`, height: '100%',
                  background: bar(b.score, b.outOf) >= 70 ? GREEN : C.brand }}/>
              </div>
              {b.comment && (
                <p style={{ fontFamily: C.font, fontSize: 12.5, color: C.muted, margin: '4px 0 0', lineHeight: 1.5 }}>{b.comment}</p>
              )}
            </div>
          ))}

          {[['Strengths', g.strengths, GREEN], ['To improve', g.improvements, C.brand]].map(([label, items, colour]) =>
            (items || []).length ? (
              <div key={label} style={{ marginTop: 10 }}>
                <div style={{ fontFamily: C.font, fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
                  textTransform: 'uppercase', color: colour, marginBottom: 4 }}>{label}</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {items.map((x, k) => (
                    <li key={k} style={{ fontFamily: C.font, fontSize: 13.5, lineHeight: 1.55, color: C.muted }}>{x}</li>
                  ))}
                </ul>
              </div>
            ) : null)}

          {g.feedback && (
            <p style={{ fontFamily: C.font, fontSize: 13.5, lineHeight: 1.6, color: C.muted,
              marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>{g.feedback}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* Pick the renderer from the SHAPE, not from the tool key. A past run loaded
   from /outputs/:id carries the document without the tool that made it. */
export function Output({ doc }) {
  if (Array.isArray(doc?.turns))  return <ScriptOutput doc={doc}/>;
  if (Array.isArray(doc?.grades)) return <GradesOutput doc={doc}/>;
  if (Array.isArray(doc?.cards) && doc.cards.some((c) => c.term)) return <VocabOutput doc={doc}/>;
  if (Array.isArray(doc?.cards))  return <DocOutput doc={doc}/>;
  return (
    <pre style={{ fontFamily: C.font, fontSize: 13, whiteSpace: 'pre-wrap', color: C.muted,
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      {JSON.stringify(doc, null, 2)}
    </pre>
  );
}

/* ── The workbench ───────────────────────────────────────────────── */
export default function ToolWorkbench({ toolKey, onBack }) {
  const [tool, setTool]       = useState(null);
  const [values, setValues]   = useState({});
  const [busy, setBusy]       = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState('');
  const [past, setPast]       = useState([]);

  const loadPast = useCallback(() => {
    apiGet(`/api/teaching/tools/outputs?key=${encodeURIComponent(toolKey)}`)
      .then((r) => setPast(r.data || r.outputs || []))
      .catch(() => { /* history is a convenience; its absence is not an error */ });
  }, [toolKey]);

  useEffect(() => {
    apiGet('/api/teaching/tools')
      .then((r) => {
        const t = (r.data || []).find((x) => x.key === toolKey);
        setTool(t || null);
        // Seed defaults from the field declarations so a teacher can press Run
        // immediately and see what the tool does, rather than facing an empty
        // form and guessing.
        const seed = {};
        for (const f of (t?.fields || [])) if (f.default) seed[f.name] = f.default;
        setValues(seed);
      })
      .catch((e) => setError(e.message || 'Could not load this tool'));
    loadPast();
  }, [toolKey, loadPast]);

  // The list endpoint returns id/title/created_at only — no content — so a
  // past run has to be fetched before it can be shown. Setting o.content
  // directly rendered an empty document, which reads as a broken tool rather
  // than a missing field.
  const openPast = async (o) => {
    setError('');
    try {
      const r = await apiGet(`/api/teaching/tools/outputs/${o.id}`);
      const doc = r.data?.content || r.data;
      setResult(doc);
      window.scrollTo?.({ top: 0, behavior: 'smooth' });
    } catch (e) { setError(e.message || 'Could not open that run'); }
  };

  const run = async () => {
    const missing = (tool?.fields || []).filter((f) => f.required && !String(values[f.name] || '').trim());
    if (missing.length) { setError(`${missing[0].label} is needed to run this.`); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      const res = await apiPost(`/api/teaching/tools/${toolKey}`, values);
      setResult(res.data || res);
      loadPast();
    } catch (e) {
      // The server distinguishes "you cannot afford this" from "it broke", and
      // so should the message — one is actionable, the other is not.
      setError(/coin/i.test(e.message || '')
        ? 'Not enough coins to run this tool. Top up in your wallet.'
        : (e.message || 'Could not run this tool'));
    } finally { setBusy(false); }
  };

  if (error && !tool) {
    return <div style={{ fontFamily: C.font, color: C.muted, padding: 20 }}>{error}</div>;
  }
  if (!tool) {
    return <Loading label="Loading the tool…" />;
  }

  return (
    <div>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16,
        fontFamily: C.font, fontSize: 13, fontWeight: 600, color: C.muted, background: 'none',
        border: 'none', padding: 0, cursor: 'pointer' }}>
        <Ico ti="ti-arrow-left" size={14}/> All tools
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 26 }}>{tool.emoji}</span>
        <h2 style={{ fontFamily: C.font, fontSize: 22, fontWeight: 800, color: C.ink, margin: 0 }}>{tool.name}</h2>
      </div>
      <p style={{ fontFamily: C.font, fontSize: 14, color: C.muted, margin: '0 0 20px', maxWidth: '60ch', lineHeight: 1.6 }}>
        {tool.blurb}
      </p>

      {/* The form is built from the tool's OWN field declarations, so a tool
          added on the server needs no change here to become usable. */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
          {(tool.fields || []).map((f) => (
            <label key={f.name} style={{ display: 'block', gridColumn: f.long ? '1 / -1' : 'auto' }}>
              <span style={{ display: 'block', fontFamily: C.font, fontSize: 12.5, fontWeight: 600,
                color: C.ink, marginBottom: 5 }}>
                {f.label}{f.required && <span style={{ color: C.brand }}> *</span>}
              </span>
              {f.type === 'select' ? (
                <select
                  value={values[f.name] ?? f.default ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  style={inputStyle}>
                  {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.long ? (
                <textarea
                  rows={3}
                  value={values[f.name] ?? ''}
                  placeholder={f.placeholder || ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: C.font }}/>
              ) : (
                <input
                  value={values[f.name] ?? ''}
                  placeholder={f.placeholder || ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  style={inputStyle}/>
              )}
            </label>
          ))}
        </div>

        {error && (
          <div style={{ marginTop: 14, fontFamily: C.font, fontSize: 13, color: '#B45309' }}>{error}</div>
        )}

        <button onClick={run} disabled={busy} style={{
          marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 7,
          fontFamily: C.font, fontSize: 14, fontWeight: 700, padding: '10px 18px', borderRadius: 10,
          border: 'none', background: busy ? C.border : C.brand, color: busy ? C.muted : '#fff',
          cursor: busy ? 'default' : 'pointer' }}>
          {busy ? <Ico ti="ti-loader-2" size={15} className="spin"/> : <Ico ti="ti-sparkles" size={15}/>}
          {busy ? 'Working…' : `Run ${tool.name}`}
        </button>
      </div>

      {result && (
        <div style={{ marginBottom: 24 }}>
          <Output doc={result}/>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: C.font, fontSize: 12,
            fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted2, marginBottom: 10 }}>
            <Ico ti="ti-clock" size={12}/> Earlier runs
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {past.slice(0, 8).map((o) => (
              <button key={o.id} onClick={() => openPast(o)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  textAlign: 'left', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
                  padding: '10px 13px', cursor: 'pointer' }}>
                <span style={{ fontFamily: C.font, fontSize: 13.5, color: C.ink, fontWeight: 600 }}>
                  {o.title || 'Untitled'}
                </span>
                <span style={{ fontFamily: C.font, fontSize: 11.5, color: C.muted2 }}>
                  {o.created_at ? new Date(o.created_at).toLocaleDateString('en-GB',
                    { day: 'numeric', month: 'short' }) : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', fontFamily: C.font, fontSize: 14,
  padding: '9px 11px', borderRadius: 9, border: `1px solid ${C.border}`,
  background: C.surface, color: C.ink, outline: 'none',
};
