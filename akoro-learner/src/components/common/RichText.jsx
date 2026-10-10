/**
 * RichText — renders the agent's markdown-subset output as styled React
 * elements (see richText.js for the parser). No HTML is generated anywhere,
 * so model output can never inject markup. ONE render path via <SpanRun>.
 */
import { parseRich } from './richText.js';

/* Headings scale with the text around them (13.5px text → 16.5 / 15 / 13.5). */
const H_STYLE = {
  1: { fontSize: '1.22em', fontWeight: 800, margin: '10px 0 4px' },
  2: { fontSize: '1.11em', fontWeight: 800, margin: '9px 0 4px' },
  3: { fontSize: '1em', fontWeight: 800, margin: '8px 0 3px' },
};

function Span({ s }) {
  if (s.code) return <code style={{ background: 'rgba(255,255,255,.14)', padding: '1px 5px', borderRadius: 5, fontSize: '0.92em', fontFamily: 'ui-monospace, monospace' }}>{s.text}</code>;
  return <span style={{ fontWeight: s.bold ? 800 : undefined, fontStyle: s.italic ? 'italic' : undefined }}>{s.text}</span>;
}

const SpanRun = ({ spans }) => <>{spans.map((s, i) => <Span key={i} s={s} />)}</>;

/* `size` / `lineHeight` let a host set the reading size — the Agent Chat's
   replies are 14.5px; everything else keeps the compact 13.5px. */
export default function RichText({ text, size = 13.5, lineHeight = 1.6 }) {
  const blocks = parseRich(text);
  if (!blocks.length) return null;
  return (
    <div style={{ fontSize: size, lineHeight, fontWeight: 500 }}>
      {blocks.map((b, i) => {
        if (b.type === 'hr') return <div key={i} style={{ borderTop: '1px solid rgba(255,255,255,.25)', margin: '8px 0' }} />;
        if (b.type === 'h') return <div key={i} style={H_STYLE[b.level]}><SpanRun spans={b.spans} /></div>;
        if (b.type === 'ul' || b.type === 'ol') {
          return (
            <div key={i} style={{ margin: '2px 0 4px', paddingLeft: 4 }}>
              {b.items.map((item, j) => (
                <div key={j} style={{ display: 'flex', gap: 7, margin: '3px 0' }}>
                  <span style={{ opacity: .65, flexShrink: 0, fontWeight: 800 }}>{b.type === 'ul' ? '•' : `${j + 1}.`}</span>
                  <span><SpanRun spans={item} /></span>
                </div>
              ))}
            </div>
          );
        }
        return (
          <div key={i} style={{ margin: '2px 0' }}>
            {/* Keep the author's single line breaks — the instructor chat's
                RichText refinement; without it multi-line answers collapse
                into one wall of text. */}
            {(() => {
              const paras = [];
              let current = [];
              b.spans.forEach((s) => {
                if (s.text.includes('\n')) {
                  const parts = s.text.split('\n');
                  current.push({ ...s, text: parts.shift() });
                  paras.push(current); current = [];
                  parts.forEach((part) => { if (part) paras.push([{ ...s, text: part }]); });
                } else current.push(s);
              });
              if (current.length) paras.push(current);
              return paras.map((spans, j) => <div key={j}><SpanRun spans={spans} /></div>);
            })()}
          </div>
        );
      })}
    </div>
  );
}
