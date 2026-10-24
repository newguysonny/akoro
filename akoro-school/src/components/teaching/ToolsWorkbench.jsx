/**
 * ToolsWorkbench — the teaching tools laid out like the content hub: a left rail
 * of tools plus a note, a right card holding the form and its result, and a
 * full-width strip of past generations underneath.
 *
 * It shares TeachingTools' renderers (doc cards, flashcards, podcast, grades),
 * so a tool looks identical here and in the AI chat — the only difference is
 * the chrome around it.
 *
 * Locked tools are the ones also sold in the Apps Center: they stay listed with
 * their price, and unlock the moment the teacher buys them.
 */
import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Lock, Clock, Trash2, Loader2, Info } from 'lucide-react';
import { apiGet, apiDelete } from '../../services/api.js';
import { ToolRunner } from './TeachingTools.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, BLUE, RED, FONT } from '../../constants.js';

const naira = (kobo) => `₦${Math.round((kobo || 0) / 100).toLocaleString('en-NG')}`;
const fmtDateTime = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};

/* A short "what this is for" note per tool, in the voice of the content hub's
   quick guide — the rail alone doesn't tell a teacher WHEN to reach for one. */
const NOTES = {
  podcast:        ['Give students something to listen to on the way home.', 'Two hosts make it a conversation, which holds attention far better than narration. The transcript doubles as reading practice.'],
  misconceptions: ['Find out what they already believe — wrongly.', 'Most class confusion is a wrong idea that feels right. Run this before you teach the topic, not after.'],
  'real-world':   ['Answer “why are we learning this?” before it is asked.', 'Grounded in everyday Nigerian life, with the jobs that actually depend on the topic.'],
  'lesson-hooks': ['Win the first two minutes.', 'Every hook is something you DO, with materials a real classroom has.'],
  vocabulary:     ['Key terms as flashcards, a list, or a printed handout.', 'Definitions are written for the class level you enter, not for a dictionary.'],
  'lesson-plan':  ['A full period, minute by minute.', 'Every activity says what you do and what the students do, with differentiation both ways.'],
  assignment:     ['Homework with the marking scheme already written.', 'The questions and the answers are separate cards, so you can hand out one without the other.'],
};

export default function ToolsWorkbench() {
  const [tools, setTools] = useState(null);
  const [key, setKey] = useState(null);
  const [err, setErr] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    apiGet('/api/teaching/tools')
      .then((r) => {
        const list = r.data || r || [];
        setTools(list);
        setKey((k) => k || list.find((t) => !t.locked)?.key || list[0]?.key || null);
      })
      .catch((e) => setErr(e?.message || 'Could not load the tools'));
  }, []);

  const tool = (tools || []).find((t) => t.key === key) || null;
  const free = (tools || []).filter((t) => !t.locked);
  const locked = (tools || []).filter((t) => t.locked);

  const Rail = ({ t }) => {
    const on = t.key === key;
    return (
      <button onClick={() => setKey(t.key)} style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left',
        padding: '11px 13px', borderRadius: 10, border: 'none', cursor: 'pointer',
        background: on ? BLUE : 'transparent', color: on ? WHITE : MUTED,
        fontSize: 13.5, fontWeight: on ? 700 : 600, fontFamily: FONT, transition: 'all .12s',
      }}
        onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = LIGHT; }}
        onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
        <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{t.emoji}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block' }}>{t.name}</span>
          <span style={{ display: 'block', fontSize: 11, fontWeight: 600, lineHeight: 1.4, marginTop: 2,
            color: on ? 'rgba(255,255,255,.82)' : MUTED2 }}>{t.blurb}</span>
        </span>
        {t.locked && <Lock size={13} color={on ? WHITE : MUTED2} style={{ marginTop: 2 }} />}
      </button>
    );
  };

  if (err) return <div style={{ color: RED, fontSize: 13.5, fontWeight: 700, fontFamily: FONT }}>{err}</div>;
  if (!tools) return <div style={{ color: MUTED2, fontFamily: FONT }}>Loading tools…</div>;

  const note = NOTES[key];

  return (
    <>
      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left rail */}
        <aside style={{ width: 268, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={railHeading}>TEACHING TOOLS</div>
            {free.map((t) => <Rail key={t.key} t={t} />)}
            {locked.length > 0 && (
              <>
                <div style={railHeading}>UNLOCK IN APPS CENTER</div>
                {locked.map((t) => <Rail key={t.key} t={t} />)}
              </>
            )}
          </div>

          {note && (
            <div style={{ background: `${AMBER}0A`, border: `1px solid ${AMBER}33`, borderRadius: 14, padding: '13px 15px', fontFamily: FONT }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Info size={13} color={AMBER} />
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, color: AMBER }}>WHEN TO USE IT</span>
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, marginBottom: 5 }}>{note[0]}</div>
              <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.55 }}>{note[1]}</div>
            </div>
          )}
        </aside>

        {/* Right card — the tool itself */}
        <section style={{ flex: 1, minWidth: 300, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '22px 24px' }}>
          {!tool ? <div style={{ color: MUTED2, fontFamily: FONT }}>Pick a tool.</div>
            : tool.locked ? <LockedPanel tool={tool} />
            : <ToolRunner tool={tool} showHeader onDone={() => setRefreshKey((k) => k + 1)} />}
        </section>
      </div>

      {tool && !tool.locked && <PastGenerations toolKey={tool.key} refreshKey={refreshKey} />}
    </>
  );
}

function LockedPanel({ tool }) {
  return (
    <div style={{ textAlign: 'center', padding: '34px 20px', fontFamily: FONT }}>
      <div style={{ fontSize: 34, marginBottom: 10 }}>{tool.emoji}</div>
      <div style={{ fontSize: 16, fontWeight: 900, color: INK }}>{tool.name}</div>
      <p style={{ fontSize: 13, color: MUTED, maxWidth: 380, margin: '8px auto 18px', lineHeight: 1.6 }}>{tool.blurb}</p>
      <a href="/apps" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 20px', borderRadius: 10, background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}>
        <Lock size={14} /> Unlock for {naira(tool.priceKobo)}
      </a>
      <div style={{ fontSize: 11.5, color: MUTED2, marginTop: 10 }}>Bought once — it then works here and in your AI chat.</div>
    </div>
  );
}

function PastGenerations({ toolKey, refreshKey }) {
  const [past, setPast] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGet(`/api/teaching/tools/outputs?key=${toolKey}`)
      .then((r) => setPast(r?.data || [])).catch(() => setPast([]));
  }, [toolKey]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const openOne = async (id) => {
    setBusy(true);
    try { const r = await apiGet(`/api/teaching/tools/outputs/${id}`); setOpen(r?.data || null); }
    catch { /* ignore */ } finally { setBusy(false); }
  };
  const remove = async (id, e) => {
    e.stopPropagation();
    try { await apiDelete(`/api/teaching/tools/outputs/${id}`); setPast((p) => p.filter((x) => x.id !== id)); } catch { /* ignore */ }
  };

  if (past && past.length === 0) return null;   // nothing yet — hide the strip

  return (
    <div style={{ marginTop: 22, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: INK, fontFamily: FONT }}>Past generations</div>
        <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT }}>swipe →</div>
      </div>

      {past === null ? (
        <div style={{ display: 'flex', gap: 12 }}>{[0, 1, 2].map((i) => <div key={i} style={{ flex: '0 0 214px', height: 84, borderRadius: 12, background: LIGHT }} />)}</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4, scrollSnapType: 'x proximity' }}>
          {past.map((o) => (
            <div key={o.id} onClick={() => openOne(o.id)} title="Open"
              style={{ flex: '0 0 auto', width: 214, scrollSnapAlign: 'start', cursor: 'pointer', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 13px', fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 6 }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = AMBER; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = BORDER; }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.title || 'Untitled'}</span>
                <button onClick={(e) => remove(o.id, e)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED2, padding: 0, flexShrink: 0 }}><Trash2 size={13} /></button>
              </div>
              {o.subject && <span style={{ fontSize: 10, fontWeight: 800, color: AMBER }}>{o.subject}</span>}
              <div style={{ fontSize: 10, color: MUTED2, marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={10} />{fmtDateTime(o.created_at)}</div>
            </div>
          ))}
        </div>
      )}

      {(open || busy) && (
        <div onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 3200, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 620, maxHeight: '86vh', overflowY: 'auto', background: WHITE, borderRadius: 16, padding: '20px 22px', fontFamily: FONT }}>
            {busy ? <Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} />
              : <ToolRunner.Result tool={{ key: open.kind, output: open.content?.output || guessOutput(open.content) }} out={open.content} title={open.title} />}
            <button onClick={() => setOpen(null)} style={{ marginTop: 16, padding: '9px 16px', borderRadius: 9, border: `1px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Close</button>
          </div>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// Saved payloads predate the `output` field, so infer it from what's inside.
function guessOutput(c) {
  if (!c) return 'markdown';
  if (Array.isArray(c.turns)) return 'script';
  if (Array.isArray(c.grades)) return 'grades';
  if (Array.isArray(c.cards) && c.cards[0]?.blocks) return 'doc';
  if (Array.isArray(c.cards)) return 'cards';
  return 'markdown';
}

const railHeading = { fontSize: 10, fontWeight: 800, letterSpacing: 1, color: MUTED2, padding: '8px 13px 6px', fontFamily: FONT };

export { Sparkles };
