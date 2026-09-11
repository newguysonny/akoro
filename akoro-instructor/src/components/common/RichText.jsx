/**
 * RichText — renders the agent's markdown-subset output as styled React
 * elements (see richText.js for the parser). No HTML is generated anywhere,
 * so model output can never inject markup. Chat-sized typography by default.
 */
import { parseRich } from './richText.js';
import { INK, MUTED, FONT } from '../../constants.js';

const H_STYLE = {
  1: { fontSize: 16.5, fontWeight: 800, margin: '10px 0 4px' },
  2: { fontSize: 15, fontWeight: 800, margin: '9px 0 4px' },
  3: { fontSize: 13.5, fontWeight: 800, margin: '8px 0 3px' },
};

export default function RichText({ text, color = INK, onAgent = true }) {
  const blocks = parseRich(text);
  if (!blocks.length) return null;
  return (
    <div style={{ color, fontFamily: FONT, fontSize: 13, lineHeight: 1.55 }}>
      {blocks.map((b, i) => {
        if (b.type === 'hr') return <div key={i} style={{ borderTop: `1px solid ${MUTED}33`, margin: '8px 0' }} />;
        if (b.type === 'h') {
          const spans = b.spans.map((s, j) => <Spans key={j} s={s} />);
          return <div key={i} style={H_STYLE[b.level]}>{spans}</div>;
        }
        if (b.type === 'ul' || b.type === 'ol') {
          return (
            <div key={i} style={{ margin: '2px 0 4px', paddingLeft: 4 }}>
              {b.items.map((item, j) => (
                <div key={j} style={{ display: 'flex', gap: 7, margin: '2px 0' }}>
                  <span style={{ color: MUTED, flexShrink: 0, fontWeight: 700 }}>{b.type === 'ul' ? '•' : `${j + 1}.`}</span>
                  <span><Spans s={item} /></span>
                </div>
              ))}
            </div>
          );
        }
        // Paragraph: keep the author's single line breaks.
        const paras = [];
        let current = [];
        b.spans.forEach((s, j) => {
          if (s.text.includes('\n')) {
            const parts = s.text.split('\n');
            current.push({ ...s, text: parts.shift() });
            paras.push(current); current = [];
            parts.forEach((part, k) => { if (k < parts.length - 1) { if (part) paras.push([{ ...s, text: part }]); } else current.push({ ...s, text: part }); });
          } else current.push(s);
        });
        if (current.length) paras.push(current);
        return (
          <div key={i} style={{ margin: '2px 0' }}>
            {paras.map((spans, j) => <div key={j}>{spans.map((s, k) => <Spans key={k} s={s} />)}</div>)}
          </div>
        );
      })}
    </div>
  );
}

function Spans({ s }) {
  if (s.code) return <code style={{ background: 'rgba(124,58,237,.08)', padding: '1px 5px', borderRadius: 5, fontSize: '0.92em', fontFamily: 'ui-monospace, monospace' }}>{s.text}</code>;
  const weight = s.bold ? 800 : undefined;
  return <span style={{ fontWeight: weight, fontStyle: s.italic ? 'italic' : undefined }}>{s.text}</span>;
}
