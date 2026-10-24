/**
 * Loading — the one loading state for the instructor app, the look the grading paper introduced:
 * a spinner and what is loading, over a pulsing skeleton shaped like what is coming.
 *
 *   <Loading label="Loading the activity…" />               a sheet (default) — pages, modals, panels
 *   <Loading variant="rows" label="Loading chats…" rows={4} />  list rows — drawers, side lists, roster
 *   <Loading variant="inline" label="Loading roster…" />     just the spinner and words — tight spots
 *   <Loading variant="bar" />                                 one or two text-line bars — a sentence
 *
 * Plain "Loading…" text is retired; when it is a <select> option or a hint (text only), keep the words.
 */
import { C } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const pulse = { animation: 'pulse-dot 1.5s ease-in-out infinite' };
const Bar = ({ w, h = 12, mt = 10, br = 6 }) => <div style={{ width: w, height: h, borderRadius: br, background: C.tagBg, marginTop: mt }} />;

function Head({ label, size = 14, color = C.brand, textColor = C.muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 800, color: textColor, fontFamily: C.font }}>
      <Ico ti="ti-loader-2" size={size} color={color} style={{ animation: 'spin .8s linear infinite' }} /> {label}
    </div>
  );
}

export default function Loading({ label = 'Loading…', variant = 'card', rows = 3, color, style }) {
  if (variant === 'inline') {
    return <div role="status" aria-label={label} style={{ padding: 14, ...style }}><Head label={label} color={color || C.brand} textColor={color || C.muted} /></div>;
  }
  if (variant === 'bar') {
    return <span role="status" aria-label={label} style={{ display: 'block', ...pulse, ...style }}><Bar w="92%" h={11} mt={0} /><Bar w="64%" h={11} mt={7} /></span>;
  }
  if (variant === 'rows') {
    return (
      <div role="status" aria-label={label} style={{ padding: '10px 4px', ...pulse, ...style }}>
        <Head label={label} />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: C.tagBg, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}><Bar w={`${78 - (i % 3) * 12}%`} h={11} mt={0} /><Bar w={`${52 - (i % 2) * 10}%`} h={9} mt={7} /></div>
          </div>
        ))}
      </div>
    );
  }
  // card — a sheet-shaped placeholder
  return (
    <div role="status" aria-label={label} style={{ padding: '18px 20px 28px', ...pulse, ...style }}>
      <Head label={label} />
      <div style={{ marginTop: 14, border: `1px solid ${C.border}`, borderRadius: 10, padding: '22px 22px 28px', background: C.surface }}>
        <Bar w="52%" h={14} mt={0} />
        <Bar w="90%" /><Bar w="80%" />
        <div style={{ marginTop: 22, border: `1px solid ${C.border}`, borderRadius: 8, height: 100, background: C.bg }} />
        <Bar w="86%" mt={22} /><Bar w="72%" />
      </div>
    </div>
  );
}
