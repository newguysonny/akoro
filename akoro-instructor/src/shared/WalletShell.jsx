// GENERATED from design-system/shared/WalletShell.jsx — edit it there, then run: node design-system/sync.mjs
/**
 * WalletShell — the learner wallet's layout, shared with the three consoles
 * (Phase 19 step 5). Same look as the learner page: a gradient balance card,
 * flat surface panels, pill presets and a row list for activity.
 *
 * Everything is inline on CSS variables with fallbacks and imports nothing, so
 * each app keeps its own data, endpoints and copy while the page looks the same.
 *
 * Props on WalletBalanceCard: label, amount, unit, note, icon, accent.
 * Panels: <WalletPanel title="Top up">…</WalletPanel>
 * Presets: <WalletPreset active onClick>…
 * Activity: <WalletRow title detail amount positive />
 */
const SURFACE = "var(--ak-surface, #fff)";
const BORDER = "var(--ak-border, #e9e9f2)";
const BG = "var(--ak-bg, #f7f7fb)";
const TEXT = "var(--ak-text, #1c1c28)";
const MUTED = "var(--ak-text-muted, #8a8aa3)";
const SUB = "var(--ak-text-sub, #5f5f76)";

export function WalletBalanceCard({ label = "Your balance", amount = 0, unit = "coins", note, icon, accent = "#6d3bf5" }) {
  return (
    <div style={{ background: `linear-gradient(135deg,${accent},#4C1DCC)`, borderRadius: 18, padding: "22px 20px", color: "#fff", marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.85 }}>{label}</div>
      <div style={{ fontSize: 40, fontWeight: 900, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
        {icon}{Number(amount || 0).toLocaleString()}{" "}
        <span style={{ fontSize: 16, fontWeight: 700, opacity: 0.85 }}>{unit}</span>
      </div>
      {note ? <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{note}</div> : null}
    </div>
  );
}

export function WalletPanel({ title, children, style }) {
  return (
    <section style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 16, marginBottom: 16, ...style }}>
      {title ? <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>{title}</div> : null}
      {children}
    </section>
  );
}

export function WalletPreset({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{ padding: "9px 13px", borderRadius: 100, cursor: "pointer", fontFamily: "'Nunito',sans-serif", fontSize: 12.5, fontWeight: 700,
        border: active ? "1px solid var(--ak-accent, #6d3bf5)" : `1px solid ${BORDER}`,
        background: active ? "rgba(109,59,245,.08)" : BG,
        color: active ? "var(--ak-accent, #6d3bf5)" : TEXT }}>
      {children}
    </button>
  );
}

export function WalletPrimaryButton({ onClick, disabled, children, style }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,var(--ak-accent, #6d3bf5),#4C1DCC)", color: "#fff", fontFamily: "'Nunito',sans-serif", fontSize: 13, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, ...style }}>
      {children}
    </button>
  );
}

export function WalletRow({ title, detail, amount, positive = true, last = false }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: last ? `1px solid ${BORDER}` : "none", borderBottom: last ? "none" : `1px solid ${BORDER}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{title}</div>
        {detail ? <div style={{ fontSize: 11.5, color: MUTED }}>{detail}</div> : null}
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 900, color: positive ? "#0a8f4c" : SUB, whiteSpace: "nowrap" }}>{amount}</div>
    </div>
  );
}
