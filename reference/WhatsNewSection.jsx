import React from "react";

/**
 * WhatsNewSection
 * Heading, intro and a wrapping row of feature cards (thumbnail, title, text, link).
 *
 * Props
 *  - title     section headline (default "What's new in Lumen Review")
 *  - intro     paragraph under the headline
 *  - accent    link color (default teal)
 *  - items     array of { title, body, linkLabel, href, thumbnail }
 *                thumbnail  node drawn inside the 16:10 frame (default: built-in mockups)
 *
 * Fonts: set --wn-display and --wn-body on a parent, or edit the fallbacks.
 */

const C = {
  ink: "#10211F",
  teal: "#0B6B63",
  body: "#44544F",
  line: "#CBD4CC",
  amber: "#F2B84B",
};
const display = "var(--wn-display, 'Bricolage Grotesque', system-ui, sans-serif)";
const bodyFont = "var(--wn-body, 'Instrument Sans', system-ui, sans-serif)";

const bar = (w, bg = C.line, h = 8) => ({
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

const thumbFrame = {
  aspectRatio: "16 / 10",
  borderRadius: 12,
  background: "#FFFFFF",
  border: `1px solid ${C.line}`,
  padding: 16,
  boxSizing: "border-box",
};

/* ---------- default thumbnail mockups ---------- */

export const ThumbWorkspace = () => (
  <div style={{ ...thumbFrame, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, alignContent: "start" }}>
    {["#EAEEE8", "#EAEEE8", "#DDEBE8", "#EAEEE8", "#FBEFD3", "#EAEEE8"].map((bg, i) => (
      <div key={i} style={{ height: 44, borderRadius: 6, background: bg }} />
    ))}
  </div>
);

export const ThumbClauses = () => (
  <div style={{ ...thumbFrame, display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={bar("40%", C.ink, 10)} />
    <div style={bar("100%")} />
    <div style={bar("90%")} />
    <div style={bar("94%", C.amber)} />
    <div style={bar("76%")} />
    <div style={bar("84%")} />
  </div>
);

export const ThumbTable = () => (
  <div style={{ ...thumbFrame, display: "flex", flexDirection: "column", gap: 8 }}>
    {[
      [C.ink, C.ink, C.ink, 10],
      [C.line, "#B7DAD5", C.line, 8],
      [C.line, C.line, "#F6D898", 8],
      [C.line, "#B7DAD5", C.line, 8],
    ].map(([a, b, c, h], i) => (
      <div key={i} style={{ display: "flex", gap: 8 }}>
        <div style={{ ...bar(undefined, a, h), flex: 2 }} />
        <div style={{ ...bar(undefined, b, h), flex: 1 }} />
        <div style={{ ...bar(undefined, c, h), flex: 1 }} />
      </div>
    ))}
  </div>
);

export const DEFAULT_ITEMS = [
  {
    title: "Matter Workspaces",
    body: "Keep documents, templates, conversations and deal history in one place. Return to a matter and pick up exactly where you left off.",
    linkLabel: "Learn more",
    href: "#new-workspaces",
    thumbnail: <ThumbWorkspace />,
  },
  {
    title: "Fallback Clause Builder",
    body: "Draft negotiation fallbacks from your approved positions. You stay in control, choosing the position, attaching precedent and checking the language before it goes out.",
    linkLabel: "Learn more",
    href: "#new-fallback",
    thumbnail: <ThumbClauses />,
  },
  {
    title: "Portfolio Table Review",
    body: "Run a whole folder of contracts against your checklist. Answers land in one sortable table, each one traceable to the clause it came from.",
    linkLabel: "Learn more",
    href: "#new-portfolio",
    thumbnail: <ThumbTable />,
  },
];

export default function WhatsNewSection({
  title = "What's new in Lumen Review",
  intro = "The latest features, built to help legal teams move faster, go deeper and sign with more confidence.",
  accent = C.teal,
  items = DEFAULT_ITEMS,
}) {
  return (
    <section style={{ width: "100%", boxSizing: "border-box", padding: "24px 24px 96px", fontFamily: bodyFont, color: C.ink }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
          <h2 style={{ margin: 0, fontFamily: display, fontWeight: 700, fontSize: "clamp(30px, 4vw, 42px)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>{title}</h2>
          <p style={{ margin: 0, fontSize: 18, lineHeight: 1.6, color: C.body }}>{intro}</p>
        </div>

        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 28 }}>
          {items.map((it) => (
            <article key={it.title} style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
              {it.thumbnail}
              <h3 style={{ margin: 0, fontFamily: display, fontWeight: 500, fontSize: 26, letterSpacing: "-0.01em" }}>{it.title}</h3>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: C.body }}>{it.body}</p>
              {it.href && (
                <a href={it.href} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, minHeight: 44, color: accent }}>
                  {it.linkLabel || "Learn more"} <Arrow />
                </a>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/*
 * Usage
 *
 *   <WhatsNewSection />
 *
 *   <WhatsNewSection
 *     items={[{ title: "...", body: "...", href: "/docs/x", thumbnail: <img src="/x.png" alt="" style={{ width: "100%", borderRadius: 12 }} /> }]}
 *   />
 */
