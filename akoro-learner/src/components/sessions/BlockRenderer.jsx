import { useState, useRef, useEffect } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECTS, SUBJECT_COLORS, AGENT_STYLES } from '../../constants.js';
import { ZapIcon, ChevDownIcon } from '../common/Icons.jsx';

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
        <span style={{ fontSize:12, color: dark ? tint : "#fff", lineHeight:1 }}>{playing ? "❚❚" : "▶"}</span>
      </div>
      <div style={{ flex:1, height:4, borderRadius:3, background:trackBg, overflow:"hidden", minWidth:60 }}>
        <div style={{ height:"100%", width:`${progress}%`, background: dark ? tint : "#fff",
          borderRadius:3, transition:"width .1s linear" }}/>
      </div>
    </div>
  );
}

function BlockRenderer({ block, agentName, agentEmoji }) {
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
  if (block.type === "subtopic-hdr") return (
    <div style={{ background:"#1E1B4B", borderRadius:10, padding:"10px 13px", margin:"10px 0 4px",
      display:"flex", alignItems:"center", justifyContent:"space-between", opacity }}>
      <div>
        <div style={{ fontSize:10, color:"#A5B4FC", fontWeight:600, marginBottom:2 }}>
          {block.topic} · {block.subject}
        </div>
        <div style={{ fontSize:13, fontWeight:800, color:"#fff" }}>{block.subtopic}</div>
      </div>
      <div style={{ textAlign:"right" }}>
        <div style={{ fontSize:10, color:"#A5B4FC", marginBottom:4 }}>Subtopic progress</div>
        <div style={{ display:"flex", gap:3 }}>
          {Array.from({ length: block.total || 1 }).map((_,i) => (
            <div key={i} style={{ width:16, height:4, borderRadius:2,
              background: i <= (block.idx||0) ? "#818CF8" : "rgba(255,255,255,0.15)" }}/>
          ))}
        </div>
        <div style={{ fontSize:10, color:"#A5B4FC", marginTop:3 }}>{(block.idx||0)+1}/{block.total||1}</div>
      </div>
    </div>
  );

  /* ── plan strip ── */
  if (block.type === "plan") return (
    <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:4,
      padding:"5px 10px", background:"rgba(108,59,255,.18)", borderRadius:8, margin:"2px 0 6px", opacity }}>
      <span style={{ fontSize:10, fontWeight:700, color:"#A78BFA", marginRight:2 }}>NaNa plan:</span>
      {(block.phases || ["Phase 1 → what do they know","Phase 2 → must-know parts","Phase 3 → teach it back","Phase 4 → push further"]).map((p,i,arr)=>(
        <span key={i} style={{ fontSize:10, color:"#C4B5FD", fontWeight:600 }}>
          {p}{i < arr.length-1 && <span style={{ color:"rgba(255,255,255,.28)", margin:"0 3px" }}>·</span>}
        </span>
      ))}
    </div>
  );

  /* ── objectives strip ── */
  if (block.type === "objectives") return (
    <div style={{ padding:"6px 10px", background:"rgba(16,185,129,.10)", border:"0.5px solid rgba(16,185,129,.30)",
      borderRadius:8, margin:"2px 0 6px", opacity }}>
      <div style={{ fontSize:10, fontWeight:700, color:"#6EE7B7", marginBottom:4 }}>
        📌 Objectives — {block.subtopic}
      </div>
      {(block.items || []).map((obj,i)=>(
        <div key={i} style={{ fontSize:10.5, color:"#A7F3D0", lineHeight:1.5 }}>{i+1}. {obj}</div>
      ))}
    </div>
  );

  /* ── guide (NaNa Esumai) ── */
  if (block.type === "guide") return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8, marginBottom:4, opacity }}>
      <div style={{ width:28, height:28, borderRadius:"50%", background:nana.bg,
        border:`1.5px solid ${nana.ring}`, flexShrink:0, display:"flex",
        alignItems:"center", justifyContent:"center", fontSize:14 }}>{nana.emoji}</div>
      <div style={{ maxWidth:"80%" }}>
        {block.phase && (
          <div style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 9px",
            borderRadius:20, background:nana.bg, border:`0.5px solid ${nana.ring}`,
            fontSize:9.5, fontWeight:700, color:nana.color, marginBottom:4, flexWrap:"wrap" }}>
            {nana.emoji} {block.phase}
          </div>
        )}
        <div style={{ padding:"9px 13px", borderRadius:"4px 18px 18px 18px",
          background:nana.bg, border:`0.5px solid ${nana.ring}`,
          color:nana.color, fontSize:13.5, lineHeight:1.6, whiteSpace:"pre-wrap", fontWeight:500 }}>
          {block.text}
        </div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,.35)", marginTop:2 }}>{nana.name}</div>
      </div>
    </div>
  );

  /* ── student-agent (Atlas / real agent name) ── */
  if (block.type === "student-agent") return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8, marginBottom:4, opacity }}>
      <div style={{ width:28, height:28, borderRadius:"50%", background:student.bg,
        border:`1.5px solid ${student.ring}`, flexShrink:0, display:"flex",
        alignItems:"center", justifyContent:"center", fontSize:14 }}>{student.emoji}</div>
      <div style={{ maxWidth:"80%" }}>
        {block.phase && (
          <div style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"2px 9px",
            borderRadius:20, background:student.bg, border:`0.5px solid ${student.ring}50`,
            fontSize:9.5, fontWeight:700, color:student.color, marginBottom:4 }}>
            {student.emoji} {block.phase}
            {block.confidence !== undefined && (
              <span style={{ background:"rgba(255,255,255,.25)", borderRadius:6, padding:"1px 5px",
                fontSize:9, fontWeight:800, color: block.confidence >= 70 ? "#6EE7B7" : block.confidence >= 40 ? "#FDE68A" : "#FCA5A5" }}>
                {block.confidence}%
              </span>
            )}
          </div>
        )}
        <div style={{ padding:"9px 13px", borderRadius:"4px 18px 18px 18px",
          background:student.bg, border:`0.5px solid ${student.ring}`,
          color:student.color, fontSize:13.5, lineHeight:1.6, whiteSpace:"pre-wrap", fontWeight:500 }}>
          {block.text}
          {block.audioUrl && <AudioPlayer url={block.audioUrl} tint={student.color} dark />}
        </div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,.35)", marginTop:2 }}>{student.name}</div>
      </div>
    </div>
  );

  /* ── sargeant ── */
  if (block.type === "sargeant") return (
    <div style={{ border:`1.5px solid rgba(239,68,68,.40)`, borderRadius:12,
      overflow:"hidden", margin:"6px 0 8px", opacity }}>
      <div style={{ background:"linear-gradient(135deg,#7F1D1D,#991B1B)", padding:"7px 13px",
        display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:14 }}>⚡</span>
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
      <div style={{ border:`1.5px solid ${color}40`, borderRadius:12, overflow:"hidden",
        margin:"6px 0 10px", opacity }}>
        <div style={{ background:color, padding:"7px 13px", display:"flex",
          alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, fontWeight:800, color:"#fff" }}>
            {block.passed ? "✓ Assessment passed" : "⚠ Needs more practice"}
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
              ? `${block.agentName||"Agent"} confidence: ${pct}% ✓ — ready for ${block.nextSubtopic || "next subtopic"}.`
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
        overflow:"hidden", margin:"10px 0 8px", opacity }}>
        <div style={{ background:"linear-gradient(135deg,rgba(120,53,15,.80),rgba(146,64,14,.80))",
          padding:"7px 13px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <span style={{ fontSize:14 }}>{block.agentEmoji || "🤖"}</span>
            <span style={{ fontSize:12, fontWeight:800, color:"#FDE68A" }}>
              {block.agentName || "Agent"} — knowledge decay detected
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
              <span style={{ color:"#FCA5A5" }}>▼ Dropped {drop}% over {block.daysSince} days</span>
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
            <div key={i} style={{ fontSize:12, color:"#FCA5A5", marginBottom:3 }}>⚠ {m}</div>
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
      <div style={{ fontSize:36, marginBottom:8 }}>🎉</div>
      <div style={{ fontSize:15, fontWeight:800, color:"#F1F5F9", marginBottom:4 }}>
        {block.isDecay ? "Re-teach Complete!" : "Session Complete!"}
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
            {block.modality === "live" ? "🎙 Voice" : "🎤 Audio"}
          </span>
        )}
        {block.text}
        {block.audioUrl && <AudioPlayer url={block.audioUrl} dark={false} />}
      </div>
    </div>
  );

  return null;
}

/* ══════════════════════════════════════════════════════ */

export default BlockRenderer;
