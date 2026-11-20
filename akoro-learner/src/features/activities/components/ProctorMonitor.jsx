import { BRAND, RED, GREEN, GOLD } from '../../../constants.js';

/**
 * ProctorMonitor — webcam feed + live proctoring status.
 *
 * Shows the candidate's camera, the TF.js-derived local signals, and the
 * backend's rolling cheat-probability meter. Purely presentational: the
 * useProctoring hook owns the video/canvas refs and capture loop; the parent
 * owns the WS-fed `probability` / `level` / `escalations`.
 */
function ProctorMonitor({ videoRef, canvasRef, status, signals, probability = 0, level = "clear", escalations = [], frameW = 320, frameH = 240 }) {
  const levelColor = { clear: GREEN, low: GOLD, elevated: "#FB923C", high: RED }[level] || GREEN;

  const statusLine = {
    idle:    "Initializing…",
    loading: "Loading proctor model…",
    running: "Proctoring active",
    denied:  "Camera/mic permission denied",
    error:   "Proctor unavailable",
  }[status] || status;

  const chips = [];
  if (signals.faceCount === 0) chips.push({ label: "No face", c: RED });
  if (signals.faceCount > 1)   chips.push({ label: `${signals.faceCount} faces`, c: RED });
  if (signals.lookingAway)     chips.push({ label: "Looking away", c: GOLD });
  if (signals.audioLevel > 0.35) chips.push({ label: "Noise", c: GOLD });
  if (chips.length === 0 && status === "running") chips.push({ label: "All clear", c: GREEN });

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10, fontFamily:"'Nunito',sans-serif" }}>
      <div style={{ position:"relative", borderRadius:16, overflow:"hidden", background:"#000",
        border:`2px solid ${status==="running" ? levelColor : "rgba(255,255,255,.1)"}`, aspectRatio:"4/3" }}>
        <video ref={videoRef} muted playsInline
          style={{ width:"100%", height:"100%", objectFit:"cover", transform:"scaleX(-1)" }} />
        {/* Hidden 320x240 work canvas — capture + TF.js read happen here. */}
        <canvas ref={canvasRef} width={frameW} height={frameH} style={{ display:"none" }} />

        {/* Live status pill */}
        <div style={{ position:"absolute", top:8, left:8, display:"flex", alignItems:"center", gap:6,
          background:"rgba(8,8,18,.7)", padding:"4px 10px", borderRadius:20, backdropFilter:"blur(6px)" }}>
          <span style={{ width:8, height:8, borderRadius:"50%", background:levelColor,
            animation: status==="running" ? "pulse-dot 1.2s ease-in-out infinite" : "none" }} />
          <span style={{ fontSize:11, fontWeight:800, color:"#E2E8F0" }}>{statusLine}</span>
        </div>

        {/* Recording dot */}
        {status==="running" && (
          <div style={{ position:"absolute", top:10, right:10, width:10, height:10, borderRadius:"50%",
            background:RED, boxShadow:`0 0 8px ${RED}` }} />
        )}
      </div>

      {/* Cheat-probability meter */}
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
          <span style={{ fontSize:10.5, fontWeight:800, color:"#94A3B8", letterSpacing:.3 }}>INTEGRITY</span>
          <span style={{ fontSize:10.5, fontWeight:900, color:levelColor }}>{level.toUpperCase()} · {(probability*100).toFixed(0)}%</span>
        </div>
        <div style={{ height:6, borderRadius:6, background:"rgba(255,255,255,.08)", overflow:"hidden" }}>
          <div style={{ width:`${Math.round(probability*100)}%`, height:"100%", background:levelColor, transition:"width .4s" }} />
        </div>
      </div>

      {/* Signal chips */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
        {chips.map((c, i) => (
          <span key={i} style={{ fontSize:10.5, fontWeight:700, color:c.c, background:`${c.c}1A`,
            border:`1px solid ${c.c}33`, borderRadius:8, padding:"3px 9px" }}>{c.label}</span>
        ))}
      </div>

      {escalations.length > 0 && (
        <div style={{ background:"rgba(248,113,113,.08)", border:"1px solid rgba(248,113,113,.2)",
          borderRadius:10, padding:"8px 10px" }}>
          <span style={{ fontSize:10, fontWeight:800, color:RED, letterSpacing:.3 }}>FLAGGED PATTERNS</span>
          {escalations.map((e, i) => (
            <div key={i} style={{ fontSize:11, fontWeight:600, color:"#FCA5A5", marginTop:3 }}>
              · {e.type.replace(/_/g," ")} ({e.severity})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ProctorMonitor;
