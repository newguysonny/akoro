/**
 * RichText — renders the agent's markdown-subset output as styled React
 * elements (see richText.js for the parser). No HTML is generated anywhere,
 * so model output can never inject markup.
 */
import { parseRich } from './richText.js';
import { BRAND } from '../../constants.js';

const H_STYLE = {
  1: { fontSize: 16.5, fontWeight: 800, margin: '10px 0 4px' },
  2: { fontSize: 15, fontWeight: 800, margin: '9px 0 4px' },
  3: { fontSize: 13.5, fontWeight: 800, margin: '8px 0 3px' },
};

export default function RichText({ text }) {
  const blocks = parseRich(text);
  if (!blocks.length) return null;
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.6, fontWeight: 500 }}>
      {blocks.map((b, i) => {
        if (b.type === 'hr') return <div key={i} style={{ borderTop: '1px solid rgba(255,255,255,.25)', margin: '8px 0' }} />;
        if (b.type === 'h') return <div key={i} style={H_STYLE[b.level]}>{b.spans.map((s, j) => <Spans key={j} s={s} />)}</div>;
        if (b.type === 'ul' || b.type === 'ol') {
          return (
            <div key={i} style={{ margin: '2px 0 4px', paddingLeft: 4 }}>
              {b.items.map((item, j) => (
                <div key={j} style={{ display: 'flex', gap: 7, margin: '2px 0' }}>
                  <span style={{ opacity: .65, flexShrink: 0, fontWeight: 800 }}>{b.type === 'ul' ? '•' : `${j + 1}.`}</span>
                  <span><Spans s={item} /></span>
                </div>
              ))}
            </div>
          );
        }
        return <div key={i} style={{ margin: '2px 0' }}>{b.spans.map((s, j) => <Spans key={j} s={s} />)}</div>;
      })}
    </div>
  );
}

function Spans({ s }) {
  if (s.code) return <code style={{ background: 'rgba(255,255,255,.14)', padding: '1px 5px', borderRadius: 5, fontSize: '0.92em', fontFamily: 'ui-monospace, monospace' }}>{s.text}</code>;
  const weight = s.bold ? 800 : undefined;
  return <span style={{ fontWeight: weight, fontStyle: s.italic ? 'italic' : undefined }}>{s.text}</span>;
}
