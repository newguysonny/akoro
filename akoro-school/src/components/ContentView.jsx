/**
 * ContentView — renders generated content as formatted text instead of a
 * monospaced blob.
 *
 * The content generator returns Markdown-ish prose (blog posts, activities) or
 * numbered caption options with hashtags (social). Both were shown in a <pre>,
 * so headings, bold and lists arrived as literal ** and # characters.
 *
 * Social output gets its own treatment: each caption option becomes a copyable
 * card with the hashtags pulled out, because a teacher posts ONE option — they
 * don't want to hand-select it out of a wall of text.
 */
import { useState } from 'react';
import { Copy, Check, Hash } from 'lucide-react';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, FONT } from '../constants.js';

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Escaped first, so generated text can never inject markup. */
function mdToHtml(md) {
  const lines = esc(md).split('\n');
  let html = '', list = null;
  const inline = (t) => t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|\s)_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/(#[A-Za-z0-9_]+)/g, '<span class="tag">$1</span>');
  const close = () => { if (list) { html += `</${list}>`; list = null; } };

  for (const raw of lines) {
    const l = raw.trim();
    const ul = l.match(/^[-*•]\s+(.*)$/);
    const ol = l.match(/^\d+[.)]\s+(.*)$/);
    if (ul) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(ul[1])}</li>`; continue; }
    if (ol) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(ol[1])}</li>`; continue; }
    close();
    if (!l) continue;
    if (/^#{1,6}\s/.test(l)) { const n = Math.min(l.match(/^#+/)[0].length + 1, 6); html += `<h${n}>${inline(l.replace(/^#+\s*/, ''))}</h${n}>`; continue; }
    if (/^(-{3,}|={3,})$/.test(l)) { html += '<hr>'; continue; }
    if (/^>\s?/.test(l)) { html += `<blockquote>${inline(l.replace(/^>\s?/, ''))}</blockquote>`; continue; }
    html += `<p>${inline(l)}</p>`;
  }
  close();
  return html;
}

/* Split social output into individual caption options. The generator is asked
   for "2–3 caption options", which it numbers — so a numbered line that starts
   a block is an option boundary. Falls back to one option when it doesn't. */
function splitOptions(text) {
  const parts = String(text || '').split(/\n(?=(?:\*\*)?(?:Option\s*)?\d+[.):]\s)/i)
    .map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return parts.map((p) => {
    const body = p.replace(/^(?:\*\*)?(?:Option\s*)?\d+[.):]\s*(?:\*\*)?/i, '').trim();
    const tags = body.match(/#[A-Za-z0-9_]+/g) || [];
    return { body: body.replace(/#[A-Za-z0-9_]+/g, '').replace(/[ \t]+\n/g, '\n').trim(), tags };
  });
}

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ } }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: done ? GREEN : MUTED, fontSize: 12, fontWeight: 700, fontFamily: FONT }}>
      {done ? <Check size={13} /> : <Copy size={13} />}{done ? 'Copied' : label}
    </button>
  );
}

export default function ContentView({ content, kind, style }) {
  const options = kind === 'social' ? splitOptions(content) : null;

  if (options) {
    return (
      <div style={{ padding: '14px 16px', ...style }}>
        {options.map((o, i) => (
          <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: '13px 15px', marginBottom: 10, background: WHITE }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: AMBER }}>Option {i + 1}</span>
              <CopyBtn text={[o.body, o.tags.join(' ')].filter(Boolean).join('\n\n')} />
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.65, color: INK, whiteSpace: 'pre-wrap', fontFamily: FONT }}>{o.body}</div>
            {o.tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
                {o.tags.map((t, j) => (
                  <span key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '3px 9px', borderRadius: 20, background: `${AMBER}12`, color: AMBER, fontSize: 11.5, fontWeight: 700, fontFamily: FONT }}>
                    <Hash size={10} />{t.slice(1)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="ak-content-view" style={{ padding: '16px 20px', ...style }}
      dangerouslySetInnerHTML={{ __html: mdToHtml(content) }}>
    </div>
  );
}

/* Mounted once by the pages that use ContentView. */
export const contentViewStyles = `
  .ak-content-view { font-family: ${FONT}; font-size: 13.5px; line-height: 1.72; color: ${INK}; }
  .ak-content-view h2 { font-size: 18px; font-weight: 900; margin: 4px 0 10px; color: ${INK}; }
  .ak-content-view h3 { font-size: 15.5px; font-weight: 800; margin: 20px 0 7px; color: ${INK}; }
  .ak-content-view h4, .ak-content-view h5, .ak-content-view h6 { font-size: 13.5px; font-weight: 800; margin: 16px 0 5px; color: ${MUTED}; text-transform: uppercase; letter-spacing: .04em; }
  .ak-content-view p { margin: 0 0 11px; }
  .ak-content-view ul, .ak-content-view ol { margin: 0 0 12px; padding-left: 22px; }
  .ak-content-view li { margin-bottom: 5px; }
  .ak-content-view strong { font-weight: 800; }
  .ak-content-view hr { border: none; border-top: 1px solid ${BORDER}; margin: 18px 0; }
  .ak-content-view blockquote { margin: 0 0 12px; padding: 9px 14px; border-left: 3px solid ${AMBER}; background: ${LIGHT}; border-radius: 0 8px 8px 0; color: ${MUTED}; }
  .ak-content-view .tag { color: ${AMBER}; font-weight: 700; }
  .ak-content-view > *:first-child { margin-top: 0; }
  .ak-content-view > *:last-child { margin-bottom: 0; }
`;
