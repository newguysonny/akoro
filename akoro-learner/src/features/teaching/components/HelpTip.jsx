// Small "?" beside a form label: the field's explanation lives here instead
// of in permanent helper text, so the form stays clean. Click/tap toggles;
// any outside pointer or Escape closes it.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../../components/common/Icons.jsx";

export default function HelpTip({ text, label = "More about this field" }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  if (!text) return null;
  return (
    <span ref={boxRef} className="relative inline-flex items-center" style={{ lineHeight: 1 }}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        className="flex items-center justify-center rounded-full"
        style={{ width: 16, height: 16, border: "1px solid var(--ak-border2)", color: "var(--ak-text-sub)", background: "transparent", fontSize: 10.5, fontWeight: 800, cursor: "pointer" }}
      >
        ?
      </button>
      {open && (
        <span role="tooltip"
          className="absolute rounded-lg text-[11.5px] leading-relaxed z-50"
          style={{ top: 22, left: 0, width: 240, padding: "9px 11px", fontWeight: 600,
            background: "var(--ak-surface, #fff)", color: "var(--ak-text)",
            border: "1px solid var(--ak-border2)", boxShadow: "0 10px 28px rgba(15,23,42,.18)" }}>
          {text}
        </span>
      )}
    </span>
  );
}
