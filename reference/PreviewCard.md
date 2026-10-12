import React, { useEffect, useState } from "react";

/**
 * PreviewCard
 * A looping product-preview card: a tilted "app window" that cycles through
 * frames, with a play button on top that calls `onPlay` (open your video there).
 *
 * Sizing uses CSS container query units (cqw), so everything scales with the
 * card's width. Drop it in any width and it stays proportional.
 *
 * Props
 *  - frames    array of { badge, eyebrow, title, content }  (default: DEFAULT_FRAMES)
 *  - interval  ms between frames (default 1800)
 *  - paused    pause the loop from outside (default false)
 *  - video     node shown inside the video overlay, e.g. <video src="..." controls autoPlay />
 *              (default: a "Your video goes here" placeholder)
 *  - onPlay    optional callback fired when the play button is clicked
 *
 * Clicking play opens a built-in overlay (click backdrop, X or Esc to close),
 * and the frame loop pauses while it is open.
 *  - playLabel accessible label for the play button
 *
 * Fonts: set --pc-display and --pc-body on a parent, or edit the fallbacks below.
 */

const C = {
  ink: "#10211F",
  teal: "#0B6B63",
  tealDark: "#0B4F49",
  amber: "#F2B84B",
  muted: "#5A6A66",
  body: "#44544F",
  line: "#B9C5BC",
  peach: "#F0C9B5",
  peachGlow: "rgba(232,150,110,0.35)",
};

const display = "var(--pc-display, 'Bricolage Grotesque', system-ui, sans-serif)";
const bodyFont = "var(--pc-body, 'Instrument Sans', system-ui, sans-serif)";

const inputShadow = `0 1.4cqw 0 ${C.peach}, 0 3cqw 5cqw ${C.peachGlow}`;

const panel = (gap) => ({
  marginTop: "1cqw",
  background: "#FFFFFF",
  borderRadius: "1.6cqw",
  padding: "2.6cqw 3cqw",
  boxShadow: inputShadow,
  display: "flex",
  flexDirection: "column",
  gap,
});

const dot = (bg, extra) => ({
  width: "2.6cqw",
  height: "2.6cqw",
  borderRadius: "50%",
  background: bg,
  flex: "none",
  ...extra,
});

const pill = (bg, color) => ({
  background: bg,
  color,
  fontSize: "1.5cqw",
  fontWeight: 600,
  padding: "0.5cqw 1.4cqw",
  borderRadius: "2cqw",
  whiteSpace: "nowrap",
});

const row = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "2cqw",
  fontSize: "2cqw",
  color: C.ink,
};

export const DEFAULT_FRAMES = [
  {
    badge: "New Lumen Review",
    eyebrow: "Good afternoon",
    title: "Let's clear your review queue",
    content: (
      <div style={panel("3.6cqw")}>
        <div style={{ fontSize: "2cqw", color: "#7A8985" }}>
          Ask Lumen to review an agreement…
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "2cqw",
            fontSize: "1.8cqw",
            fontWeight: 600,
            color: C.ink,
          }}
        >
          <span style={{ fontSize: "3cqw", lineHeight: 1 }}>+</span>
          <span>Add to matter</span>
          <span
            style={{
              marginLeft: "auto",
              width: "4cqw",
              height: "4cqw",
              borderRadius: "50%",
              background: "#9DB5AF",
            }}
          />
        </div>
      </div>
    ),
  },
  {
    badge: "Review plan",
    eyebrow: "Step by step",
    title: "Here's how I'll review it",
    content: (
      <div style={panel("1.9cqw")}>
        {[
          ["Read the agreement", C.teal, 400],
          ["Compare against your playbook", C.teal, 400],
          ["Flag the deviations", C.amber, 600],
          ["Draft the redline", "#FFFFFF", 400],
        ].map(([label, bg, weight], i) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1.8cqw",
              fontSize: "2cqw",
              fontWeight: weight,
              color: i === 3 ? C.muted : C.ink,
            }}
          >
            <span
              style={dot(
                bg,
                i === 3 ? { border: `0.3cqw solid ${C.line}`, boxSizing: "border-box" } : null
              )}
            />
            <span>{label}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    badge: "Findings",
    eyebrow: "Checked against your playbook",
    title: "Two clauses need your eyes",
    content: (
      <div style={{ ...panel("1.8cqw"), padding: "2.4cqw 3cqw" }}>
        <div style={row}>
          <span>Limitation of liability</span>
          <span style={pill("#FBEFD3", "#7A4B00")}>Needs attention</span>
        </div>
        <div style={row}>
          <span>Termination</span>
          <span style={pill("#DDEBE8", C.tealDark)}>Matches playbook</span>
        </div>
        <div style={row}>
          <span>Indemnification</span>
          <span style={pill("#FBEFD3", "#7A4B00")}>Needs attention</span>
        </div>
      </div>
    ),
  },
  {
    badge: "Redline ready",
    eyebrow: "Tracked changes",
    title: "Your draft is ready to review",
    content: (
      <div style={panel("1.4cqw")}>
        <div style={{ fontSize: "1.8cqw", fontWeight: 600, color: C.ink }}>
          8.2 Limitation of liability
        </div>
        <div style={{ fontSize: "1.8cqw", lineHeight: 1.5, color: C.body }}>
          Each party's total liability is{" "}
          <span style={{ color: "#B4452B", textDecoration: "line-through" }}>
            unlimited for all claims
          </span>{" "}
          <span style={{ color: C.teal, textDecoration: "underline", fontWeight: 600 }}>
            capped at twelve months of fees
          </span>
          , except where the law says otherwise.
        </div>
        <div style={{ height: "0.8cqw", width: "86%", borderRadius: "0.4cqw", background: "#E3E8E2" }} />
        <div style={{ height: "0.8cqw", width: "64%", borderRadius: "0.4cqw", background: "#E3E8E2" }} />
      </div>
    ),
  },
];

const KEYFRAMES = `
@keyframes pcIn { from { opacity: 0; margin-top: 10px } to { opacity: 1; margin-top: 0 } }
@media (prefers-reduced-motion: reduce) { .pc-stage { animation: none !important } }
`;

export default function PreviewCard({
  frames = DEFAULT_FRAMES,
  interval = 1800,
  paused = false,
  onPlay,
  video = null,
  playLabel = "Play product video",
}) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (paused || open || frames.length < 2) return undefined;
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return undefined;
    }
    const id = setInterval(() => setIndex((i) => (i + 1) % frames.length), interval);
    return () => clearInterval(id);
  }, [paused, open, interval, frames.length]);

  const frame = frames[index % frames.length];

  return (
    <div style={{ width: "100%", containerType: "inline-size" }}>
      <style>{KEYFRAMES}</style>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          borderRadius: 10,
          overflow: "hidden",
          background: "#FAF7F4",
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          fontFamily: bodyFont,
        }}
      >
        <div
          key={index}
          className="pc-stage"
          style={{
            position: "absolute",
            left: "8cqw",
            right: "6cqw",
            top: "12cqw",
            transform: "perspective(900px) rotateX(28deg) rotateZ(-9deg)",
            transformOrigin: "50% 50%",
            display: "flex",
            flexDirection: "column",
            gap: "1.6cqw",
            animation: "pcIn 0.3s ease both",
          }}
        >
          <div
            style={{
              alignSelf: "flex-end",
              background: "#FFFFFF",
              borderRadius: "3cqw",
              padding: "0.7cqw 1.6cqw",
              fontSize: "1.5cqw",
              fontWeight: 600,
              color: C.ink,
              boxShadow: "0 0.6cqw 1.6cqw rgba(16,33,31,0.18)",
              display: "flex",
              alignItems: "center",
              gap: "1cqw",
            }}
          >
            <span>{frame.badge}</span>
            {index === 0 && (
              <span
                style={{
                  display: "inline-block",
                  width: "3.4cqw",
                  height: "1.8cqw",
                  borderRadius: "1cqw",
                  background: C.teal,
                }}
              />
            )}
          </div>
          <div style={{ fontSize: "2.2cqw", color: C.muted, textAlign: "center" }}>
            {frame.eyebrow}
          </div>
          <div
            style={{
              fontFamily: display,
              fontWeight: 700,
              fontSize: "3.8cqw",
              color: C.tealDark,
              textAlign: "center",
              letterSpacing: "-0.01em",
            }}
          >
            {frame.title}
          </div>
          {frame.content}
        </div>

        <button
          type="button"
          aria-label={playLabel}
          onClick={() => {
            setOpen(true);
            if (onPlay) onPlay();
          }}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 64,
            height: 64,
            borderRadius: "50%",
            border: "3px solid #FFFFFF",
            background: "#3A3F42",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" fill="#FFFFFF" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Product video"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            boxSizing: "border-box",
            background: "rgba(5,15,14,0.88)",
            fontFamily: bodyFont,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              width: "min(960px, 100%)",
              aspectRatio: "16 / 9",
              borderRadius: 12,
              overflow: "hidden",
              background: C.ink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              color: "#CFE3DF",
            }}
          >
            {video || <span>Your video goes here</span>}
            <button
              type="button"
              aria-label="Close video"
              onClick={() => setOpen(false)}
              style={{
                position: "absolute",
                right: 8,
                top: 8,
                width: 44,
                height: 44,
                border: 0,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.14)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/*
 * Usage
 *
 *   import PreviewCard from "./PreviewCard";
 *
 *   <PreviewCard />   // play opens the "Your video goes here" overlay
 *
 *   <PreviewCard video={<video src="/demo.mp4" controls autoPlay style={{ width: "100%", height: "100%" }} />} />
 *
 * Custom frames:
 *
 *   <PreviewCard frames={[{ badge: "...", eyebrow: "...", title: "...", content: <YourPanel /> }]} />
 */
