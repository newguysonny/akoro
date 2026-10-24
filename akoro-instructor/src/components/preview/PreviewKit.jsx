/*
 * PreviewKit — the pieces the draft previews share (battle, self study):
 * the Settings / Preview / … tab bar, collapsible settings sections that show
 * their values as chips when closed, and the Preview stage (a blurred
 * glimpse of what plays, with a Play button over it).
 */
import { useState } from 'react';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

export function PreviewTabs({ tabs, value, onChange }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 18, borderBottom: `1px solid ${C.border}`, marginBottom: 12, fontFamily: C.font }}>
      {tabs.map(([key, label]) => {
        const on = value === key;
        return (
          <button key={key} type="button" role="tab" aria-selected={on} onClick={() => onChange(key)}
            style={{ padding: '8px 0 9px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: C.font,
              fontSize: 12.5, fontWeight: on ? 800 : 600, color: on ? C.ink : C.muted,
              borderBottom: `2px solid ${on ? C.brand : 'transparent'}`, marginBottom: -1 }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Chips({ items = [] }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
      {list.map((t, i) => (
        <span key={i} style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 7, background: C.tagBg, color: C.ink2, border: `1px solid ${C.borderSoft}`, fontFamily: C.font }}>{t}</span>
      ))}
    </div>
  );
}

/** A settings section: its title, and when closed a summary (chips or a line). */
export function Section({ title, icon, defaultOpen = false, summary = null, chips = [], children, badge = null }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: `1px solid ${C.borderSoft}`, padding: '12px 2px', fontFamily: C.font }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: C.font, textAlign: 'left' }}>
        {icon && <Ico ti={icon} size={15} color={C.brand} />}
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 850, color: C.ink }}>{title}</span>
        {badge}
        <Ico ti={open ? 'ti-chevron-up' : 'ti-chevron-down'} size={15} color={C.muted2} />
      </button>
      {!open && (summary || chips.length > 0) && (
        <div style={{ marginTop: 4 }}>
          {summary && <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{summary}</div>}
          <Chips items={chips} />
        </div>
      )}
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

/** A labelled setting row inside an open section. */
export function Field({ label, hint, children, inline = false }) {
  return (
    <div style={{ marginBottom: 12, display: inline ? 'flex' : 'block', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontFamily: C.font }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 750, color: C.ink }}>{label}</div>
        {hint && <div style={{ fontSize: 10.5, color: C.muted2, marginTop: 1, lineHeight: 1.4 }}>{hint}</div>}
      </div>
      <div style={{ marginTop: inline ? 0 : 6, flexShrink: 0 }}>{children}</div>
    </div>
  );
}

export function Toggle({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      style={{ width: 38, height: 22, borderRadius: 12, border: 'none', cursor: 'pointer', padding: 2, background: on ? C.brand : C.border, transition: 'background .15s', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start' }}>
      <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
    </button>
  );
}

export const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.inputBg,
  color: C.ink, fontSize: 12.5, fontFamily: C.font, boxSizing: 'border-box',
};

/** The Preview stage: a blurred glimpse of what plays, with Play over it. */
export function PlayStage({ glimpse, label = 'Play preview', sub, onPlay, secondary = null }) {
  return (
    <div style={{ position: 'relative', minHeight: 380, borderRadius: 16, overflow: 'hidden', border: `1px solid ${C.borderSoft}`, background: C.bg }}>
      <div aria-hidden="true" style={{ filter: 'blur(5px)', opacity: 0.55, pointerEvents: 'none', padding: 14 }}>{glimpse}</div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20, textAlign: 'center' }}>
        <button type="button" onClick={onPlay}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '8px 22px 8px 8px', borderRadius: 999, border: `1px solid ${C.border}`, background: C.surface, boxShadow: '0 6px 20px rgba(0,0,0,.10)', cursor: 'pointer', fontFamily: C.font }}>
          <span style={{ width: 34, height: 34, borderRadius: '50%', background: tint(14), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ico ti="ti-player-play" size={16} color={C.brand} />
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 850, color: C.ink }}>{label}</span>
        </button>
        {sub && <div style={{ fontSize: 11.5, color: C.muted, maxWidth: 300, lineHeight: 1.5, background: C.surface, padding: '4px 10px', borderRadius: 8 }}>{sub}</div>}
        {secondary}
      </div>
    </div>
  );
}
