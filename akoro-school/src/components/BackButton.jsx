/**
 * BackButton — the one standard back control used across the app (matches the
 * Domain / Billing settings pages): a bordered pill with an arrow + label.
 * Pass `onClick` (e.g. () => navigate(-1) or navigate('/settings-billing')) and
 * an optional `label` (defaults to "Back").
 */
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

export default function BackButton({ onClick, label = 'Back', style = {} }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${C.border}`,
        background: C.surface, color: C.muted, fontSize: 12.5, fontWeight: 700,
        cursor: 'pointer', fontFamily: C.font, ...style,
      }}
    >
      <Ico ti="ti-arrow-left" size={14} /> {label}
    </button>
  );
}
