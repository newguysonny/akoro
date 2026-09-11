/**
 * CopyMessageButton — a subtle per-message copy affordance. Copies the raw
 * text (markdown included, exactly what the agent said), flips to a check for
 * a moment on success. Clipboard API with a legacy fallback (execCommand) for
 * older webviews; failures leave the icon untouched — a copy button must
 * never throw into the chat.
 */
import { useState } from 'react';
import { Icon } from './Icons.jsx';

export async function copyPlainText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch { return false; }
  }
}

export default function CopyMessageButton({ text, dark = false, label = 'Copy message' }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={async () => {
        if (await copyPlainText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 20, padding: 0, border: 'none', background: 'transparent',
        cursor: 'pointer', color: dark ? '#94A3B8' : 'var(--ak-text-muted, #9490A0)',
        opacity: .55, borderRadius: 6,
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = 1; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = .55; }}
    >
      <Icon name={done ? 'ti-check' : 'ti-copy'} size={12} />
    </button>
  );
}
