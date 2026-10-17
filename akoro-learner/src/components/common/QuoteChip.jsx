/**
 * QuoteChip — a reader passage quoted into the chat (the copilot pattern).
 *
 *   <QuoteChip quote={q} onClear={…}/>   above the composer: the passage the
 *                                         learner selected, removable
 *   <QuoteChip quote={q} inBubble/>      inside a sent message, above the
 *                                         question
 *
 * `quote` is { text, pageNumber } (lib/quotedMessage.js).
 */
import { Icon } from './Icons.jsx';

export default function QuoteChip({ quote, onClear = null, inBubble = false, dark = false }) {
  if (!quote?.text) return null;
  const onBrand = inBubble && !dark;   // a sent bubble is the brand gradient
  const ink = onBrand ? 'rgba(255,255,255,.88)' : 'var(--ak-text-sub)';
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 7, minWidth: 0,
      padding: inBubble ? '6px 8px' : '7px 8px 7px 10px', marginBottom: inBubble ? 6 : 8,
      borderRadius: 10, borderLeft: `3px solid ${onBrand ? 'rgba(255,255,255,.65)' : 'var(--ak-accent)'}`,
      background: onBrand ? 'rgba(255,255,255,.14)' : (inBubble ? 'var(--ak-surface)' : 'var(--ak-tag-bg)'),
    }}>
      <Icon name="ti-corner-down-right" size={13} color={ink} style={{ flexShrink: 0, marginTop: 1 }}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        {quote.pageNumber && (
          <span style={{ display: 'block', fontSize: 9.5, fontWeight: 900, letterSpacing: '.04em', textTransform: 'uppercase', color: ink, marginBottom: 1 }}>
            Page {quote.pageNumber}
          </span>
        )}
        <span style={{
          display: '-webkit-box', WebkitLineClamp: inBubble ? 2 : 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          fontSize: 11.5, lineHeight: 1.45, fontWeight: 600, color: ink, whiteSpace: 'normal', wordBreak: 'break-word',
        }}>
          {quote.text}
        </span>
      </div>
      {onClear && (
        <button type="button" onClick={onClear} aria-label="Remove the quoted passage" title="Remove"
          style={{ flexShrink: 0, width: 22, height: 22, padding: 0, border: 'none', borderRadius: '50%', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: ink }}>
          <Icon name="ti-x" size={13}/>
        </button>
      )}
    </div>
  );
}
