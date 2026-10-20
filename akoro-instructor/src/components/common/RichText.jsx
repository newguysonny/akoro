/**
 * RichText — renders the agent's markdown-subset output as styled React
 * elements (see richText.js for the parser). No HTML is generated anywhere,
 * so model output can never inject markup. Chat-sized typography by default.
 *
 * ONE render path: every block funnels spans through <SpanRun>. A span array
 * is never passed where a single span is expected (that bug once rendered
 * bullets with no text).
 */
import { parseRich } from './richText.js';
import { C, tint } from '../../theme/colors.js';

const H_STYLE = {
  1: { fontSize: 16.5, fontWeight: 800, margin: '10px 0 4px' },
  2: { fontSize: 15, fontWeight: 800, margin: '9px 0 4px' },
  3: { fontSize: 13.5, fontWeight: 800, margin: '8px 0 3px' },
};

function Span({ s }) {
  if (s.code) return <code style={{ background: 'rgba(124,58,237,.08)', padding: '1px 5px', borderRadius: 5, fontSize: '0.92em', fontFamily: 'ui-monospace, monospace' }}>{s.text}</code>;
  return <span style={{ fontWeight: s.bold ? 800 : undefined, fontStyle: s.italic ? 'italic' : undefined }}>{s.text}</span>;
}

const SpanRun = ({ spans }) => <>{spans.map((s, i) => <Span key={i} s={s} />)}</>;

export default function RichText({ text, color = C.ink }) {
  const blocks = parseRich(text);
  if (!blocks.length) return null;
  return (
    <div style={{ color, fontFamily: C.font, fontSize: 13, lineHeight: 1.55 }}>
      {blocks.map((b, i) => {
        if (b.type === 'hr') return <div key={i} style={{ borderTop: `1px solid ${tint(20, C.muted)}`, margin: '8px 0' }} />;
        if (b.type === 'h') return <div key={i} style={H_STYLE[b.level]}><SpanRun spans={b.spans} /></div>;
        if (b.type === 'ul' || b.type === 'ol') {
          return (
            <div key={i} style={{ margin: '2px 0 4px', paddingLeft: 4 }}>
              {b.items.map((item, j) => (
                <div key={j} style={{ display: 'flex', gap: 7, margin: '3px 0' }}>
                  <span style={{ color: C.muted, flexShrink: 0, fontWeight: 700 }}>{b.type === 'ul' ? '•' : `${j + 1}.`}</span>
                  <span><SpanRun spans={item} /></span>
                </div>
              ))}
            </div>
          );
        }
        // Paragraph: keep the author's single line breaks.
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
        return (
          <div key={i} style={{ margin: '2px 0' }}>
            {paras.map((spans, j) => <div key={j}><SpanRun spans={spans} /></div>)}
          </div>
        );
      })}
    </div>
  );
}
