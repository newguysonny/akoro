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
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);   // iOS ignores select() alone
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
}

/**
 * Copy text that is still being fetched. Browsers (Safari, phone webviews)
 * refuse a clipboard write that comes after an await — the tap's permission
 * is gone by then — so the write starts inside the tap and the text is
 * handed to it as a promise. Call it straight from the click handler.
 */
export async function copyTextFrom(getText) {
  const text = Promise.resolve().then(getText).then((t) => String(t || ''));
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = text.then((t) => { if (!t) throw new Error('nothing to copy'); return new Blob([t], { type: 'text/plain' }); });
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return true;
    } catch { /* fall through: older browsers, or a write refused */ }
  }
  const t = await text.catch(() => '');
  return t ? copyPlainText(t) : false;
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
