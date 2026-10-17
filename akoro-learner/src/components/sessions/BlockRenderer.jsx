import { useState, useRef, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, AGENT_STYLES } from '../../constants.js';
import { ZapIcon, ChevDownIcon, Icon } from '../common/Icons.jsx';
import { AgentAvatar } from '../common/AgentAvatar.jsx';
import { citeLabel, inlinePieces, toReaderCite } from '../../lib/askAnswer.js';
import { parseQuoted } from '../../lib/quotedMessage.js';
import QuoteChip from '../common/QuoteChip.jsx';

/* Where a step sits in the arc of the topic. Four kinds, because that is the
   shape of learning something: name it, see how it works, use it, tie it
   together. Colour rather than a number, so a learner can see at a glance that
   they are still in the foundations — or that they have reached the end. */
const KINDS = {
  foundation:  { label: "Foundation", fg: "#FCD34D", bg: "rgba(252,211,77,.14)" },
  mechanism:   { label: "How it works", fg: "#7DD3FC", bg: "rgba(125,211,252,.14)" },
  application: { label: "Use it",      fg: "#86EFAC", bg: "rgba(134,239,172,.14)" },
  synthesis:   { label: "Put together", fg: "#C4B5FD", bg: "rgba(196,181,253,.16)" },
};

function KindChip({ kind }) {
  const k = KINDS[kind];
  if (!k) return null;
  return (
    <span style={{ fontSize:9, fontWeight:800, letterSpacing:".04em", textTransform:"uppercase",
      color:k.fg, background:k.bg, borderRadius:5, padding:"2px 6px", whiteSpace:"nowrap" }}>
      {k.label}
    </span>
  );
}

// ── Subtopic header, with the objectives folded into it ──────────────────
//
// This used to be a static header plus a separate "Objectives" checklist
// underneath. They were the same array: the header drew one segment per
// must-know part, and the checklist printed those same parts as a numbered
// list. Two renderings of one thing, one of which grew as long as the topic.
//
// Now the segments ARE the objectives — steppable with < >, one shown at a
// time. Fill carries the state a learner needs: solid means done or in hand,
// faint means not reached yet, and a ring marks whichever one they are looking
// at. Browsing ahead never changes where the session actually is.
function SubtopicHeader({ block, opacity }) {
  // Two shapes arrive here.
  //
  // A current backend sends `items` — every step of the ladder — and the header
  // is navigable. An older one sends only `subtopic` and `total`, and used to
  // draw a plain progress bar of `total` segments.
  //
  // Falling back to [subtopic] collapsed that bar to a SINGLE segment and left
  // two dead arrows beside it: strictly worse than what it replaced, and
  // indistinguishable from the feature being missing. So without items the
  // header renders exactly the bar it always did, and no controls it cannot
  // honour.
  const hasItems = Array.isArray(block.items) && block.items.length > 0;
  const items    = hasItems ? block.items
                            : Array.from({ length: Math.max(1, block.total || 1) },
                                         (_, i) => (i === (block.idx || 0) ? block.subtopic : ""));
  const map      = Array.isArray(block.map) ? block.map : [];
  const total   = items.length || block.total || 1;
  const active  = Math.min(block.idx || 0, total - 1);   // where the SESSION is
  const [view, setView] = useState(active);              // where the LEARNER is looking

  // The session moving on pulls the view along, unless they have deliberately
  // stepped away to read ahead — in which case yanking it back mid-read would
  // be the rudest possible behaviour.
  const followed = useRef(true);
  useEffect(() => { if (followed.current) setView(active); }, [active]);

  const go = (d) => {
    const next = Math.max(0, Math.min(total - 1, view + d));
    followed.current = next === active;
    setView(next);
  };

  const arrow = (dir, disabled) => (
    <button
      onClick={() => go(dir)}
      disabled={disabled}
      aria-label={dir < 0 ? "Previous objective" : "Next objective"}
      style={{
        width: 22, height: 22, borderRadius: 6, flexShrink: 0, cursor: disabled ? "default" : "pointer",
        background: disabled ? "rgba(255,255,255,.04)" : "rgba(255,255,255,.10)",
        border: "0.5px solid rgba(255,255,255,.16)", color: disabled ? "rgba(255,255,255,.22)" : "#C7D2FE",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, lineHeight: 1, padding: 0, fontWeight: 700,
      }}>
      {dir < 0 ? "\u2039" : "\u203A"}
    </button>
  );

  return (
    <div style={{ background:"#1E1B4B", borderRadius:10, padding:"10px 13px", margin:"10px 0 4px", opacity }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
        <div style={{ fontSize:10, color:"#A5B4FC", fontWeight:600 }}>
          {block.topic}{block.subject ? ` \u00B7 ${block.subject}` : ""}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <span style={{ fontSize:10, color:"#A5B4FC", fontVariantNumeric:"tabular-nums" }}>
            {view + 1}/{total}
          </span>
          {hasItems && arrow(-1, view === 0)}
          {hasItems && arrow(1, view === total - 1)}
        </div>
      </div>

      <div style={{ display:"flex", alignItems:"baseline", gap:7, marginTop:5, flexWrap:"wrap" }}>
        {map[view]?.kind && <KindChip kind={map[view].kind}/>}
        <div style={{ fontSize:13, fontWeight:800, color:"#fff", lineHeight:1.4, flex:1, minWidth:"60%" }}>
          {items[view] || block.subtopic}
        </div>
      </div>

      {/* The path, not just the stop. "Builds on X" is what turns a list into a
          route: it says why this step is here and what it assumes you already
          have, so a learner who is lost knows exactly which step to go back to. */}
      {(map[view]?.whyNow || map[view]?.buildsOn != null) && (
        <div style={{ marginTop:5, display:"flex", flexDirection:"column", gap:2 }}>
          {map[view]?.buildsOn != null && items[map[view].buildsOn] && (
            <button
              onClick={() => { followed.current = false; setView(map[view].buildsOn); }}
              style={{ background:"none", border:"none", padding:0, textAlign:"left", cursor:"pointer",
                fontSize:10, color:"#A5B4FC", fontWeight:600 }}>
              \u21b0 builds on {map[view].buildsOn + 1}. {items[map[view].buildsOn]}
            </button>
          )}
          {map[view]?.whyNow && (
            <div style={{ fontSize:10.5, color:"#C7D2FE", lineHeight:1.45, opacity:.9 }}>
              {map[view].whyNow}
            </div>
          )}
        </div>
      )}

      {/* Reading ahead is allowed, but it must never look like progress. */}
      {view !== active && (
        <div style={{ fontSize:9.5, color:"#FBBF24", marginTop:3, fontWeight:600 }}>
          {view > active ? "Coming up" : "Already covered"} \u2014 you\u2019re on {active + 1}
        </div>
      )}

      <div style={{ display:"flex", gap:3, marginTop:7 }}>
        {items.map((label, i) => (
          <button
            key={i}
            onClick={hasItems ? () => { followed.current = i === active; setView(i); } : undefined}
            disabled={!hasItems}
            title={label || undefined}
            aria-label={hasItems ? `Objective ${i + 1}: ${label}` : `Step ${i + 1} of ${total}`}
            style={{
              flex:1, height:5, borderRadius:3, padding:0, cursor: hasItems ? "pointer" : "default",
              background: i <= active ? "#818CF8" : "rgba(255,255,255,0.15)",
              border: i === view ? "1px solid #F9FAFB" : "1px solid transparent",
              boxSizing:"border-box",
            }}/>
        ))}
      </div>
    </div>
  );
}

// ── Inline replayable voice player ───────────────────────────────
// Used by user (recorded audio) and agent (streamed TTS) bubbles so any
// spoken turn can be played back. `tint` colours the control to match the
// owning bubble; `dark` flips the text/track colours for dark agent bubbles.
function AudioPlayer({ url, tint = BRAND, dark = false }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const onEnd  = () => { setPlaying(false); setProgress(0); };
    const onTime = () => setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0);
    a.addEventListener("ended", onEnd);
    a.addEventListener("timeupdate", onTime);
    return () => { a.removeEventListener("ended", onEnd); a.removeEventListener("timeupdate", onTime); };
  }, [url]);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  const trackBg = dark ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.45)";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:6 }}>
      <audio ref={ref} src={url} preload="metadata" />
      <div onClick={toggle} style={{ width:26, height:26, borderRadius:"50%", flexShrink:0,
        background: dark ? `${tint}33` : "rgba(255,255,255,.55)", display:"flex",
        alignItems:"center", justifyContent:"center", cursor:"pointer",
        border:`1px solid ${dark ? `${tint}66` : "rgba(255,255,255,.7)"}` }}>
        <Icon name={playing ? "ti-player-pause" : "ti-player-play"} size={12} color={dark ? tint : "#fff"}/>
      </div>
      <div style={{ flex:1, height:4, borderRadius:3, background:trackBg, overflow:"hidden", minWidth:60 }}>
        <div style={{ height:"100%", width:`${progress}%`, background: dark ? tint : "#fff",
          borderRadius:3, transition:"width .1s linear" }}/>
      </div>
    </div>
  );
}

/* The protégé's text with [n] → citation chips (document-grounded sessions).
   A chip jumps the reader to the page/box or the recording moment. */
function CitedText({ text, citations, onCite, color }) {
  const pieces = inlinePieces(text, citations);
  return pieces.map((p, i) => {
    if (p.type === "bold") return <strong key={i}>{p.text}</strong>;
    if (p.type !== "cite") return <span key={i}>{p.text}</span>;
    const target = toReaderCite(p.cite);
    return (
      <button key={i} type="button" disabled={!target || !onCite}
        onClick={() => target && onCite?.(target)}
        title={p.cite.quote ? `“${p.cite.quote}”` : "Source"}
        aria-label={`Source ${p.cite.n}: ${citeLabel(p.cite)}`}
        style={{ display:"inline-flex", alignItems:"center", gap:3, margin:"0 2px", padding:"0 6px", borderRadius:10,
          border:`1px solid ${color}55`, background:`${color}1f`, color, fontSize:10.5, fontWeight:800,
          cursor: target && onCite ? "pointer" : "default", verticalAlign:"baseline", lineHeight:1.6 }}>
        <span className={`ti ${Number.isInteger(p.cite.pageNumber) ? "ti-file-text" : "ti-player-play"}`} aria-hidden="true" style={{ fontSize:10 }}/>
        {citeLabel(p.cite)}
      </button>
    );
  });
}

function BlockRenderer({ block, agentName, agentEmoji, onCite = null }) {
  const student = { ...AGENT_STYLES.student, name: agentName || "Agent", emoji: agentEmoji || "🤖" };
  const nana    = AGENT_STYLES.nana;
  const sarg    = AGENT_STYLES.sargeant;
  const opacity = block.faded ? 0.55 : 1;

  /* ── system divider ── */
  if (block.type === "system-divider") return (
    <div style={{ display:"flex", alignItems:"center", gap:8, margin:"14px 0 6px", opacity }}>
      <div style={{ flex:1, height:"0.5px", background:"rgba(255,255,255,.15)" }}/>
      <span style={{ fontSize:9.5, color:"rgba(255,255,255,.38)", whiteSpace:"nowrap", fontStyle:"italic" }}>{block.label}</span>
      <div style={{ flex:1, height:"0.5px", background:"rgba(255,255,255,.15)" }}/>
    </div>
  );

  /* ── subtopic-hdr ── */
  if (block.type === "subtopic-hdr") return <SubtopicHeader block={block} opacity={opacity} />;

  /* The "NaNa plan" strip and the "Objectives" checklist used to render here.
     Both are gone. The plan exposed internal workflow phases rather than a
     learner action, while the checklist was the subtopic progress bar written
     out longhand: identical array, identical order. The existing objective
     header remains the single source of visible progress. */

  /* ── guide (NaNa Esumai) ── */
  if (block.type === "guide") return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8, marginBottom:4, opacity }}>
      <div style={{ width:28, height:28, borderRadius:"50%", background:nana.bg,
        border:`1.5px solid ${nana.ring}`, flexShrink:0, display:"flex",
        alignItems:"center", justifyContent:"center" }}><AgentAvatar emoji={nana.emoji} size={19}/></div>
      <div style={{ maxWidth:"80%" }}>
        {block.learningState && (
          <div style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 9px",
            borderRadius:20, background:nana.bg, border:`0.5px solid ${nana.ring}`,
            fontSize:9.5, fontWeight:700, color:nana.color, marginBottom:4, flexWrap:"wrap" }}>
            <AgentAvatar emoji={nana.emoji} size={11}/> Learning state: {block.learningState}
          </div>
        )}
        <div style={{ padding:"9px 13px", borderRadius:"4px 18px 18px 18px",
          background:nana.bg, border:`0.5px solid ${nana.ring}`,
          color:nana.color, fontSize:13.5, lineHeight:1.6, whiteSpace:"pre-wrap", fontWeight:500 }}>
          {block.text}
        </div>
        {block.nextLearningMove && (
          <div style={{ fontSize:10, color:"#C7D2FE", margin:"5px 2px 0", lineHeight:1.45, fontWeight:600 }}>
            <b style={{ color:"#E0E7FF", fontWeight:800 }}>Next:</b> {block.nextLearningMove}
          </div>
        )}
        <div style={{ fontSize:10, color:"rgba(255,255,255,.35)", marginTop:2 }}>{nana.name}</div>
      </div>
    </div>
  );

  /* ── student-agent (Atlas / real agent name) ── */
  if (block.type === "student-agent") return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8, marginBottom:4, opacity }}>
      <div style={{ width:28, height:28, borderRadius:"50%", background:student.bg,
        border:`1.5px solid ${student.ring}`, flexShrink:0, display:"flex",
        alignItems:"center", justifyContent:"center" }}><AgentAvatar emoji={student.emoji} size={19}/></div>
      <div style={{ maxWidth:"80%" }}>
        {block.currentIdea && (
          <div style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"2px 9px",
            borderRadius:20, background:student.bg, border:`0.5px solid ${student.ring}50`,
            fontSize:9.5, fontWeight:700, color:student.color, marginBottom:4, flexWrap:"wrap" }}>
            <AgentAvatar emoji={student.emoji} size={11}/> Current idea: {block.currentIdea}
          </div>
        )}
        <div style={{ padding:"9px 13px", borderRadius:"4px 18px 18px 18px",
          background:student.bg, border:`0.5px solid ${student.ring}`,
          color:student.color, fontSize:13.5, lineHeight:1.6, whiteSpace:"pre-wrap", fontWeight:500 }}>
          {block.citations?.length
            ? <CitedText text={block.text} citations={block.citations} onCite={onCite} color={student.color}/>
            : block.text}
          {block.audioUrl && <AudioPlayer url={block.audioUrl} tint={student.color} dark />}
        </div>
        {block.whyThisResponse && (
          <div style={{ fontSize:10, color:"rgba(255,255,255,.43)", margin:"5px 2px 0", lineHeight:1.45, fontWeight:600 }}>
            <b style={{ color:"rgba(255,255,255,.60)", fontWeight:800 }}>Why this response:</b> {block.whyThisResponse}
          </div>
        )}
        <div style={{ fontSize:10, color:"rgba(255,255,255,.35)", marginTop:2 }}>{student.name}</div>
      </div>
    </div>
  );

  /* ── sargeant ── */
  if (block.type === "sargeant") return (
    <div style={{ border:`1.5px solid rgba(239,68,68,.40)`, borderRadius:12,
      /* flexShrink:0 is load-bearing, not cosmetic.
         The blocks list is a flex COLUMN, and a flex item whose overflow is
         anything but visible has an automatic minimum size of ZERO — so this
         card could be compressed to nothing under vertical pressure, leaving
         only its 1.5px border on screen. That is what a "drift warning that
         renders as just a red line" was. Every card here that clips its own
         overflow needs this. */
      overflow:"hidden", flexShrink:0, margin:"6px 0 8px", opacity }}>
      <div style={{ background:"linear-gradient(135deg,#7F1D1D,#991B1B)", padding:"7px 13px",
        display:"flex", alignItems:"center", gap:8 }}>
        <Icon name="ti-bolt" size={14} color="#FDE047"/>
        <span style={{ fontSize:12, fontWeight:800, color:"#fff" }}>
          Sargeant{block.phase ? ` — ${block.phase}` : ""}
        </span>
      </div>
      <div style={{ padding:"10px 13px", background:"rgba(239,68,68,.08)",
        fontSize:13, color:"#FCA5A5", lineHeight:1.6, whiteSpace:"pre-wrap" }}>
        {block.text}
      </div>
    </div>
  );

  /* ── assess-result ── */
  if (block.type === "assess-result") {
    const pct   = block.confidence ?? 0;
    const color = pct >= 70 ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444";
    return (
      <div style={{ border:`1.5px solid ${color}40`, borderRadius:12, overflow:"hidden", flexShrink:0,
        margin:"6px 0 10px", opacity }}>
        <div style={{ background:color, padding:"7px 13px", display:"flex",
          alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, fontWeight:800, color:"#fff" }}>
            {block.passed ? <><Icon name="ti-check" size={12}/> Assessment passed</> : <><Icon name="ti-alert-triangle" size={12}/> Needs more practice</>}
            {block.subtopic ? ` — ${block.subtopic}` : ""}
          </span>
          <span style={{ fontSize:12, fontWeight:900, color:"#fff" }}>{pct}%</span>
        </div>
        <div style={{ padding:"10px 13px", background:"rgba(0,0,0,.25)" }}>
          <div style={{ height:8, background:"rgba(255,255,255,.12)", borderRadius:4, overflow:"hidden", marginBottom:8 }}>
            <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:4, transition:"width .5s" }}/>
          </div>
          <div style={{ fontSize:11.5, color:"rgba(255,255,255,.65)", lineHeight:1.55 }}>
            {block.passed
              ? `${block.agentName||"Agent"} confidence: ${pct}% — ready for ${block.nextSubtopic || "next subtopic"}.`
              : `${block.agentName||"Agent"} confidence: ${pct}% — below 70%. Please re-teach before advancing.`
            }
          </div>
        </div>
      </div>
    );
  }

  /* ── decay-notice (student agent notifying human) ── */
  if (block.type === "decay-notice") {
    const drop = (block.prevConfidence || 0) - (block.confidence || 0);
    return (
      <div style={{ border:"1.5px solid rgba(245,158,11,.45)", borderRadius:12,
        overflow:"hidden", flexShrink:0, margin:"10px 0 8px", opacity }}>
        <div style={{ background:"linear-gradient(135deg,rgba(120,53,15,.80),rgba(146,64,14,.80))",
          padding:"7px 13px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <AgentAvatar emoji={block.agentEmoji} size={16}/>
            <span style={{ fontSize:12, fontWeight:800, color:"#FDE68A" }}>
              {block.agentName || "Agent"} — needs revision
            </span>
          </div>
          <span style={{ fontSize:12, fontWeight:900, color:"#FCA5A5" }}>
            {block.prevConfidence}% → {block.confidence}%
          </span>
        </div>
        <div style={{ padding:"12px 13px", background:"rgba(245,158,11,.08)" }}>
          {/* Confidence drop bar */}
          <div style={{ marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"rgba(255,255,255,.45)", marginBottom:4 }}>
              <span>Previous: {block.prevConfidence}%</span>
              <span style={{ color:"#FCA5A5", display:"inline-flex", alignItems:"center", gap:3 }}><Icon name="ti-trending-down" size={10}/> Dropped {drop}% over {block.daysSince} days</span>
              <span style={{ color:"#FCA5A5" }}>Now: {block.confidence}%</span>
            </div>
            <div style={{ height:6, background:"rgba(255,255,255,.12)", borderRadius:3, overflow:"hidden" }}>
              <div style={{ height:"100%", display:"flex" }}>
                <div style={{ width:`${block.confidence}%`, background:"#EF4444", borderRadius:3 }}/>
                <div style={{ width:`${drop}%`, background:"rgba(239,68,68,.25)" }}/>
              </div>
            </div>
          </div>
          {/* Agent message */}
          <p style={{ fontSize:13, color:"#FDE68A", lineHeight:1.6, margin:"0 0 8px", fontWeight:500 }}>
            My confidence on <strong>{block.topic}</strong> has dropped significantly. I've been making mistakes with:
          </p>
          {(block.misconceptions || []).map((m,i)=>(
            <div key={i} style={{ fontSize:12, color:"#FCA5A5", marginBottom:3, display:"flex", alignItems:"center", gap:4 }}><Icon name="ti-alert-triangle" size={11}/> {m}</div>
          ))}
          <p style={{ fontSize:12.5, color:"rgba(255,255,255,.55)", lineHeight:1.5, margin:"8px 0 0", fontStyle:"italic" }}>
            Can you re-teach me this? I need to refresh my understanding.
          </p>
        </div>
      </div>
    );
  }

  /* ── session-complete ── */
  if (block.type === "session-complete") return (
    <div style={{ textAlign:"center", padding:"20px 16px",
      background:"linear-gradient(135deg,rgba(108,59,255,.18),rgba(16,185,129,.10))",
      borderRadius:16, border:"1.5px solid rgba(108,59,255,.35)", margin:"8px 0", opacity }}>
      <div style={{ marginBottom:8 }}><Icon name="ti-confetti" size={36} color="#FBBF24"/></div>
      <div style={{ fontSize:15, fontWeight:800, color:"#F1F5F9", marginBottom:4 }}>
        {block.isDecay ? "Revision Complete!" : "Session Complete!"}
      </div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,.55)", lineHeight:1.6 }}>{block.text}</div>
    </div>
  );

  /* ── user message ── */
  if (block.type === "user") return (
    <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:4, opacity }}>
      <div style={{ maxWidth:"78%", padding:"9px 13px",
        borderRadius:"18px 18px 4px 18px", background:`linear-gradient(135deg,${BRAND},#4C1DCC)`,
        color:"#fff", fontSize:13.5, lineHeight:1.55, whiteSpace:"pre-wrap", fontWeight:500 }}>
        {(block.modality === "audio" || block.modality === "live") && (
          <span style={{ fontSize:10, fontWeight:700, opacity:.75, display:"block", marginBottom:2 }}>
            {block.modality === "live" ? <><Icon name="ti-microphone" size={10}/> Voice</> : <><Icon name="ti-headphones" size={10}/> Audio</>}
          </span>
        )}
        {(() => {
          // A reader passage the learner quoted shows as a card above their words.
          const { quote, question } = parseQuoted(block.text);
          return <><QuoteChip quote={quote} inBubble/>{question}</>;
        })()}
        {block.audioUrl && <AudioPlayer url={block.audioUrl} dark={false} />}
      </div>
    </div>
  );

  return null;
}

/* ══════════════════════════════════════════════════════ */

export default BlockRenderer;
