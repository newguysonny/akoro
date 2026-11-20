// GENERATED from design-system/shared/SettingsCard.jsx — edit it there, then run: node design-system/sync.mjs
/**
 * SettingsCard — the learner app's settings row, shared as the unification
 * ground for the four apps (Phase 19 step 5).
 *
 * Markup and styling are the learner's: a rounded surface card with a tinted
 * icon tile, a bold title, a muted subtitle, an optional right-aligned hint and
 * a chevron. Everything is inline on the app's CSS variables with fallbacks, so
 * it drops into any app without importing a shell or a stylesheet.
 *
 * Props
 *   icon      React node rendered inside the tinted tile (the caller picks the
 *             app's own icon set; nothing is imported here)
 *   title     string (bold line)
 *   subtitle  string (muted line under the title)
 *   hint      optional string shown before the chevron (e.g. "@username")
 *   chevron   optional node replacing the default "›" (pass the app's icon)
 *   color     accent for the icon tile tint (defaults to the app accent)
 *   onClick   when set the row is a button; omit for a static row
 *   testId    optional data-testid
 */
export function SettingsCard({ icon, title, subtitle, hint, chevron, color = "var(--ak-accent, #6d3bf5)", onClick, testId, style }) {
  const base = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "calc(100% - 32px)",
    margin: "0 16px 12px",
    borderRadius: 16,
    padding: "14px 16px",
    background: "var(--ak-surface, #fff)",
    border: "1px solid var(--ak-border, #e9e9f2)",
    boxShadow: "0 1px 6px rgba(0,0,0,.06)",
    fontFamily: "'Nunito', sans-serif",
    textAlign: "left",
    ...(onClick ? { cursor: "pointer" } : null),
    ...style,
  };
  const content = (
    <>
      <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: "var(--ak-text, #1c1c28)" }}>{title}</span>
        {subtitle ? <span style={{ display: "block", fontSize: 12, color: "var(--ak-text-muted, #8a8aa3)" }}>{subtitle}</span> : null}
      </span>
      {hint ? <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ak-text-muted, #8a8aa3)", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hint}</span> : null}
      {chevron ?? <span aria-hidden="true" style={{ color: "var(--ak-text-muted, #8a8aa3)", fontSize: 18, lineHeight: 1 }}>›</span>}
    </>
  );

  if (!onClick) return <div style={base} data-testid={testId}>{content}</div>;
  return (
    <button type="button" onClick={onClick} data-testid={testId} style={{ ...base, border: base.border }}>
      {content}
    </button>
  );
}

/** A titled group of cards; the learner's hub uses one per section. */
export function SettingsGroup({ title, children, style }) {
  return (
    <section style={style}>
      {title ? (
        <h2 style={{ margin: "0 16px 8px", fontSize: 12, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ak-text-muted, #8a8aa3)", fontFamily: "'Nunito', sans-serif" }}>
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}
