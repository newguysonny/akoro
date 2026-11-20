/**
 * LegalShell — the learner legal page's chrome, shared so every app reads the
 * same way. Content stays per audience: each app passes its own sections.
 *
 * <LegalShell title updated back onBack><h2/><p/>…</LegalShell>
 * The children are rendered inside the same card and type scale as the learner
 * app (Nunito, 15px body, 1.65 line height).
 */
const SURFACE = "var(--ak-surface, #fff)";
const BORDER = "var(--ak-border, #e9e9f2)";
const TEXT = "var(--ak-text, #1c1c28)";
const SUB = "var(--ak-text-sub, #5f5f76)";

export function LegalShell({ title, updated, onBack, children }) {
  return (
    <div style={{ minHeight: "100%", background: "var(--ak-bg, #f7f7fb)", fontFamily: "'Nunito', sans-serif", color: TEXT }}>
      <header style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}`, padding: "16px 18px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 10 }}>
        {onBack ? (
          <button type="button" onClick={onBack} aria-label="Back"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: TEXT, lineHeight: 1 }}>‹</button>
        ) : null}
        <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>{title}</h1>
      </header>
      <div style={{ padding: "18px 16px 24px" }}>
        <article style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: "20px 18px", fontSize: 15, lineHeight: 1.65, color: SUB }}>
          {updated ? <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--ak-text-muted, #8a8aa3)" }}>Last updated {updated}</p> : null}
          {children}
        </article>
      </div>
    </div>
  );
}
