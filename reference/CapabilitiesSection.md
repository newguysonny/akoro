import React, { useEffect, useState } from "react";

/**
 * CapabilitiesSection
 * Intro block plus alternating video-thumbnail / text feature rows.
 * Clicking a thumbnail's play button opens a built-in video overlay
 * (click backdrop, X or Esc to close).
 *
 * Props
 *  - eyebrow   small uppercase label (default "Capabilities")
 *  - title     section headline
 *  - intro     paragraph under the headline
 *  - accent    eyebrow color (default teal)
 *  - features  array of { title, body, linkLabel, href, thumbnail, video, duration }
 *                thumbnail  node drawn inside the 16:10 frame (default: built-in mockups)
 *                video      node shown in the overlay, e.g. <video src="..." controls autoPlay />
 *                           (default: "Your video goes here" placeholder)
 *                duration   text in the fake control bar (default "0:08 / 0:08")
 *  - onPlay    optional callback (feature, index) when a play button is clicked
 *
 * Fonts: set --cs-display and --cs-body on a parent, or edit the fallbacks.
 */

const C = {
  ink: "#10211F",
  teal: "#0B6B63",
  body: "#44544F",
  line: "#CBD4CC",
  soft: "#B9C5BC",
  amber: "#F2B84B",
};
const display = "var(--cs-display, 'Bricolage Grotesque', system-ui, sans-serif)";
const bodyFont = "var(--cs-body, 'Instrument Sans', system-ui, sans-serif)";

const bar = (w, bg = C.line, h = 6) => ({
  height: h,
  width: w,
  borderRadius: h / 2,
  background: bg,
});

const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/* ---------- default thumbnail mockups ---------- */

export const ThumbPlan = () => (
  <>
    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "22%", background: "#EAEEE8", padding: "18px 12px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={bar("70%", C.soft, 8)} />
      <div style={bar("90%", C.line, 8)} />
      <div style={bar("60%", C.line, 8)} />
      <div style={bar("80%", C.line, 8)} />
    </div>
    <div style={{ position: "absolute", left: "28%", right: "6%", top: "14%", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={bar("46%", C.ink, 10)} />
      <div style={{ height: 44, borderRadius: 8, background: "#FFFFFF", border: `1px solid ${C.line}` }} />
      {[[C.teal, "62%"], [C.teal, "48%"], [C.amber, "70%"]].map(([c, w], i) => (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ width: 14, height: 14, borderRadius: "50%", background: c }} />
          <div style={bar(w, C.soft, 8)} />
        </div>
      ))}
    </div>
  </>
);

export const ThumbCards = () => (
  <div style={{ position: "absolute", left: "6%", right: "6%", top: "12%", display: "flex", gap: 14 }}>
    {[C.ink, C.teal, C.amber].map((c, i) => (
      <div key={i} style={{ flex: 1, background: "#FFFFFF", border: `1px solid ${C.line}`, borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={bar(["60%", "50%", "55%"][i], c, 8)} />
        <div style={bar("100%")} />
        <div style={bar(["85%", "90%", "80%"][i])} />
        <div style={bar(["70%", "60%", "65%"][i])} />
      </div>
    ))}
  </div>
);

export const ThumbDraft = () => (
  <>
    <div style={{ position: "absolute", left: "8%", top: "12%", width: "50%", bottom: "20%", background: "#FFFFFF", border: `1px solid ${C.line}`, borderRadius: 8, padding: 14, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={bar("40%", C.ink, 8)} />
      <div style={bar("100%")} />
      <div style={bar("92%", C.amber)} />
      <div style={bar("88%", C.amber)} />
      <div style={bar("100%")} />
      <div style={bar("70%")} />
    </div>
    <div style={{ position: "absolute", left: "62%", right: "6%", top: "12%", bottom: "20%", background: "#EAEEE8", border: `1px solid ${C.line}`, borderRadius: 8, padding: 12, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={bar("60%", C.teal, 8)} />
      <div style={bar("100%", C.soft)} />
      <div style={bar("80%", C.soft)} />
    </div>
  </>
);

export const DEFAULT_FEATURES = [
  {
    title: "Walks the agreement clause by clause",
    body: "Describe what you need and Lumen Review lays out a step-by-step review plan. Open any step to see what it read, what it compared and why it reached its conclusion.",
    linkLabel: "Explore more",
    href: "#explore-plan",
    thumbnail: <ThumbPlan />,
    duration: "0:08 / 0:08",
  },
  {
    title: "Judgment grounded in your own precedent",
    body: "Every finding draws on your playbooks, approved fallback language and past negotiated deals, so the advice matches how your team really works, not a generic template.",
    linkLabel: "Explore more",
    href: "#explore-research",
    thumbnail: <ThumbCards />,
    duration: "0:08 / 0:08",
  },
  {
    title: "From one request to a redlined draft",
    body: "Turn a single instruction into tracked-change edits and a short risk summary. Each suggestion links to the clause and the precedent behind it, so you can verify fast and spend your time on the judgment calls.",
    linkLabel: "Explore more",
    href: "#explore-draft",
    thumbnail: <ThumbDraft />,
    duration: "0:07 / 0:07",
  },
];

/* ---------- pieces ---------- */

function VideoThumb({ feature, onPlay }) {
  return (
    <div style={{ position: "relative", aspectRatio: "16 / 10", borderRadius: 14, overflow: "hidden", background: "#DFE5DE", border: `1px solid ${C.line}` }}>
      {feature.thumbnail}
      <button
        type="button"
        aria-label={`Play video: ${feature.title}`}
        onClick={onPlay}
        style={{ position: "absolute", left: "50%", top: "46%", transform: "translate(-50%, -50%)", width: 68, height: 68, borderRadius: "50%", border: 0, background: "#FFFFFF", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 20px rgba(16,33,31,0.25)" }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill={C.ink} /></svg>
      </button>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 52, background: "rgba(16,33,31,0.88)", display: "flex", alignItems: "center", gap: 14, padding: "0 16px", boxSizing: "border-box", color: "#FFFFFF", fontSize: 13 }}>
        <span>{feature.duration || "0:08 / 0:08"}</span>
        <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.3)" }}>
          <div style={{ width: "100%", height: 4, borderRadius: 2, background: "#FFFFFF" }} />
        </div>
      </div>
    </div>
  );
}

function VideoOverlay({ video, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Video" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box", background: "rgba(5,15,14,0.88)", fontFamily: bodyFont }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "min(960px, 100%)", aspectRatio: "16 / 9", borderRadius: 12, overflow: "hidden", background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#CFE3DF" }}>
        {video || <span>Your video goes here</span>}
        <button type="button" aria-label="Close video" onClick={onClose} style={{ position: "absolute", right: 8, top: 8, width: 44, height: 44, border: 0, borderRadius: "50%", background: "rgba(255,255,255,0.14)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    </div>
  );
}

/* ---------- main component ---------- */

export default function CapabilitiesSection({
  eyebrow = "Capabilities",
  title = "Contract review that works like a sharp second reader",
  intro = "Lumen Review reads agreements against your playbook, your past deals and the clauses you actually negotiate. Ask in plain language, and it plans the review, flags the risk and drafts the redline, with every call linked back to its source.",
  accent = C.teal,
  features = DEFAULT_FEATURES,
  onPlay,
}) {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <section style={{ width: "100%", boxSizing: "border-box", padding: "56px 24px 24px", fontFamily: bodyFont, color: C.ink }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", display: "flex", flexDirection: "column", gap: 88 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 860 }}>
          <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: accent }}>{eyebrow}</div>
          <h2 style={{ margin: 0, fontFamily: display, fontWeight: 700, fontSize: "clamp(34px, 5.2vw, 56px)", lineHeight: 1.05, letterSpacing: "-0.02em" }}>{title}</h2>
          <p style={{ margin: 0, fontSize: 18, lineHeight: 1.6, color: C.body }}>{intro}</p>
        </div>

        {features.map((f, i) => (
          <div key={f.title} style={{ display: "flex", flexDirection: i % 2 ? "row-reverse" : "row", flexWrap: "wrap", alignItems: "center", gap: "32px 64px" }}>
            <div style={{ flex: "1 1 440px", minWidth: 0 }}>
              <VideoThumb
                feature={f}
                onPlay={() => {
                  setOpenIndex(i);
                  if (onPlay) onPlay(f, i);
                }}
              />
            </div>
            <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
              <h3 style={{ margin: 0, fontFamily: display, fontWeight: 500, fontSize: "clamp(26px, 3.4vw, 34px)", lineHeight: 1.15, letterSpacing: "-0.01em" }}>{f.title}</h3>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.65, color: C.body }}>{f.body}</p>
              {f.href && (
                <a href={f.href} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 16, minHeight: 44, color: accent }}>
                  {f.linkLabel || "Explore more"} <Arrow />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {openIndex !== null && (
        <VideoOverlay video={features[openIndex].video} onClose={() => setOpenIndex(null)} />
      )}
    </section>
  );
}

/*
 * Usage
 *
 *   <CapabilitiesSection />
 *
 *   <CapabilitiesSection
 *     features={DEFAULT_FEATURES.map((f, i) => ({
 *       ...f,
 *       video: <video src={`/clip-${i + 1}.mp4`} controls autoPlay style={{ width: "100%", height: "100%" }} />,
 *     }))}
 *   />
 */
