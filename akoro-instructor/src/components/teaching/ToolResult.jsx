/**
 * ToolResult — the one look every teaching tool's result shares.
 *
 * The server returns the result template (akoro-api teaching/template.js):
 *   { title, summary, meta, highlights[], entries[{ title, tag, layout, sections[] }] }
 * and this draws it: a header band in the tool's accent colour, quick facts, then
 * a stack of entry cards, each a few labelled sections (text, list/steps, chips,
 * fields, script, scores). Nothing here knows which tool made the result, so a
 * new tool needs no UI.
 */
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const FONT = "'Nunito', sans-serif";

/* Accent per tool — the header band and the entry numbering take it. */
export const TOOL_ACCENT = {
  'misconceptions': '#DC2626',
  'real-world':     '#EA580C',
  'lesson-hooks':   '#2563EB',
  'lesson-plan':    '#4F46E5',
  'activity':       '#DB2777',
  'assignment':     '#16A34A',
  'vocabulary':     '#0D9488',
  'essay-grader':   '#CA8A04',
  'podcast':        '#6C3BFF',
};
export const TOOL_NAME = { 'podcast': 'Podcast Generator', 'misconceptions': 'Common Misconceptions', 'real-world': 'Real-World Connections',
  'lesson-hooks': 'Lesson Hooks', 'vocabulary': 'Vocabulary Builder', 'essay-grader': 'Essay Grader', 'lesson-plan': 'Lesson Plan',
  'activity': 'Activities Creator', 'assignment': 'Assignment Creator' };
// Tabler icons (icons, not emoji).
export const TOOL_ICON = { 'podcast': 'ti-headphones', 'misconceptions': 'ti-brain', 'real-world': 'ti-world', 'lesson-hooks': 'ti-anchor', 'vocabulary': 'ti-abc',
  'essay-grader': 'ti-chart-bar', 'lesson-plan': 'ti-clipboard-list', 'activity': 'ti-sparkles', 'assignment': 'ti-writing' };
export const accentFor = (key) => TOOL_ACCENT[key] || '#6C3BFF';

const TONE = {
  danger:  { color: '#DC2626', ti: 'ti-alert-circle' },
  success: { color: '#16A34A', ti: 'ti-circle-check' },
  info:    { color: '#2563EB', ti: 'ti-help-circle' },
  idea:    { color: '#7C3AED', ti: 'ti-bulb' },
  accent:  { color: '#EA580C', ti: 'ti-list-numbers' },
  warn:    { color: '#D97706', ti: 'ti-clock' },
  teal:    { color: '#0D9488', ti: 'ti-target' },
  neutral: { color: '#6B7280', ti: 'ti-file-text' },
};
// A label that names its own icon beats the tone's default one.
const ICON_BY_LABEL = [
  [/profession|career|job/i, 'ti-briefcase'], [/context|connection/i, 'ti-link'],
  [/material/i, 'ti-package'], [/timing|time/i, 'ti-clock'], [/step|implementation/i, 'ti-list-numbers'],
  [/outcome|objective|goal|by the end/i, 'ti-target'], [/question|check/i, 'ti-list-check'],
  [/discussion|talk/i, 'ti-message-circle'], [/teacher does/i, 'ti-school'], [/students do/i, 'ti-users'],
  [/strength/i, 'ti-thumb-up'], [/improve/i, 'ti-trending-up'], [/feedback/i, 'ti-message-2'],
  [/fix|strateg/i, 'ti-bulb'], [/example/i, 'ti-presentation'], [/definition/i, 'ti-book'],
];
const toneOf = (s) => TONE[s.tone] || TONE.neutral;
const iconOf = (s) => ICON_BY_LABEL.find(([re]) => re.test(s.label || ''))?.[1] || toneOf(s).ti;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// **bold** only; everything else is escaped, so model text cannot inject markup.
const rich = (t) => ({ __html: esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') });
const Rich = ({ children, style }) => <span style={style} dangerouslySetInnerHTML={rich(children)} />;

// "Ask the class (2 min)" → { text: "Ask the class", min: "2 min" }
const splitMinutes = (t) => {
  const m = String(t).match(/^(.*?)\s*\((\d+\s*(?:min|mins|minutes?))\)\.?$/i);
  return m ? { text: m[1], min: m[2].replace(/minutes?|mins/i, 'min') } : { text: t, min: '' };
};

function Label({ s }) {
  if (!s.label) return null;
  const { color } = toneOf(s);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
      <span style={{ width: 24, height: 24, borderRadius: '50%', background: `${color}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Ico ti={iconOf(s)} size={13} color={color} />
      </span>
      <span style={{ fontSize: 13, fontWeight: 800, color }}>{s.label}</span>
    </div>
  );
}

const body = { fontSize: 13.5, color: C.ink, lineHeight: 1.65 };

function Section({ s, accent }) {
  const { color } = toneOf(s);
  if (s.kind === 'text') {
    return <div style={{ marginBottom: 14 }}><Label s={s} /><p style={{ ...body, margin: 0, paddingLeft: s.label ? 32 : 0 }}><Rich>{s.body}</Rich></p></div>;
  }
  if (s.kind === 'list' && s.ordered) {
    return (
      <div style={{ marginBottom: 14 }}>
        <Label s={s} />
        <div style={{ paddingLeft: s.label ? 32 : 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {s.items.map((x, i) => {
            const { text, min } = splitMinutes(x);
            return (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: accent, color: '#fff', fontSize: 11.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
                <span style={{ ...body, flex: 1, minWidth: 0 }}><Rich>{text}</Rich></span>
                {min && <span style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, background: `${C.border}80`, borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap', flexShrink: 0 }}>{min}</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (s.kind === 'list') {
    return (
      <div style={{ marginBottom: 14 }}>
        <Label s={s} />
        <ul style={{ ...body, margin: 0, paddingLeft: s.label ? 52 : 20 }}>
          {s.items.map((x, i) => <li key={i} style={{ marginBottom: 4 }}><Rich>{x}</Rich></li>)}
        </ul>
      </div>
    );
  }
  if (s.kind === 'chips') {
    return (
      <div style={{ marginBottom: 14 }}>
        <Label s={s} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: s.label ? 32 : 0 }}>
          {s.items.map((x, i) => (
            <span key={i} style={{ padding: '5px 12px', borderRadius: 999, background: `${color}12`, border: `1px solid ${color}33`, fontSize: 12, fontWeight: 700, color: C.ink }}>{x}</span>
          ))}
        </div>
      </div>
    );
  }
  if (s.kind === 'fields') {
    return (
      <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {s.items.map((f, i) => (
          <div key={i} style={body}><strong style={{ color: C.ink }}>{f.label}:</strong> <span style={{ color: C.muted }}><Rich>{f.value}</Rich></span></div>
        ))}
      </div>
    );
  }
  if (s.kind === 'scores') {
    return (
      <div style={{ marginBottom: 14 }}>
        <Label s={{ ...s, tone: 'teal' }} />
        {s.items.map((b, i) => (
          <div key={i} style={{ padding: '7px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.border}`, paddingLeft: s.label ? 32 : 0 }}>
            <div style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'baseline' }}>
              <span style={{ fontWeight: 700, color: C.ink, flex: 1, minWidth: 0 }}>{b.criterion}</span>
              <span style={{ fontWeight: 800, color: C.muted, flexShrink: 0 }}>{b.score}{b.outOf != null ? `/${b.outOf}` : ''}</span>
            </div>
            {b.comment && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{b.comment}</div>}
          </div>
        ))}
      </div>
    );
  }
  if (s.kind === 'script') {
    return (
      <div style={{ marginBottom: 6 }}>
        {s.turns.map((t, i) => (
          <div key={i} style={{ ...body, marginBottom: 8 }}><strong>{t.speaker}:</strong> <Rich>{t.text}</Rich></div>
        ))}
      </div>
    );
  }
  return null;
}

/* Split layout: text-like sections on the left, chips/fields on the right; one
   column on a phone (the grid's minmax does the collapsing). */
function Body({ e, accent }) {
  if (e.layout === 'split') {
    const side = e.sections.filter((s) => s.kind === 'chips');
    const main = e.sections.filter((s) => s.kind !== 'chips');
    if (side.length && main.length) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: '4px 28px' }}>
          <div>{main.map((s, i) => <Section key={i} s={s} accent={accent} />)}</div>
          <div>{side.map((s, i) => <Section key={i} s={s} accent={accent} />)}</div>
        </div>
      );
    }
  }
  return <>{e.sections.map((s, i) => <Section key={i} s={s} accent={accent} />)}</>;
}

function Entry({ e, n, accent, total }) {
  const compact = e.layout === 'compact';
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 16, padding: compact ? '14px 16px' : '18px 20px', background: C.surface, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: compact ? 8 : 14 }}>
        {!compact && total > 1 && (
          <span style={{ width: 28, height: 28, borderRadius: 9, background: `${accent}18`, color: accent, fontSize: 13, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n + 1}</span>
        )}
        <div style={{ fontSize: compact ? 14.5 : 16, fontWeight: 900, color: C.ink, flex: 1, minWidth: 0, lineHeight: 1.3 }}>{e.title}</div>
        {e.tag && <span style={{ fontSize: 12, fontWeight: 800, color: accent, background: `${accent}14`, borderRadius: 999, padding: '3px 11px', whiteSpace: 'nowrap' }}>{e.tag}</span>}
      </div>
      <Body e={e} accent={accent} />
    </div>
  );
}

/** The header band: title, summary and the subject / class / quick-fact chips. */
export function ResultHeader({ data, accent, icon, name }) {
  const chips = [data.meta?.subject, data.meta?.class].filter(Boolean);
  return (
    <div style={{ borderRadius: 18, padding: '20px 22px', marginBottom: 14, color: '#fff', background: `linear-gradient(135deg, ${accent}, ${accent}CC)`, position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', right: -30, top: -40, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,.12)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', opacity: .9, marginBottom: 6, position: 'relative' }}>
        {icon && (typeof icon === 'string' && icon.startsWith('ti-') ? <Ico ti={icon} size={15} color={accent} /> : <span style={{ fontSize: 15 }}>{icon}</span>)}{name}
      </div>
      <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.25, position: 'relative' }}>{data.title}</div>
      {data.summary && <div style={{ fontSize: 13.5, opacity: .92, marginTop: 6, lineHeight: 1.5, position: 'relative' }}>{data.summary}</div>}
      {(chips.length > 0 || data.highlights?.length > 0) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12, position: 'relative' }}>
          {chips.map((c) => <span key={c} style={{ padding: '4px 12px', borderRadius: 999, background: 'rgba(255,255,255,.22)', fontSize: 12, fontWeight: 800 }}>{c}</span>)}
          {(data.highlights || []).map((h) => (
            <span key={h.label} style={{ padding: '4px 12px', borderRadius: 999, background: 'rgba(255,255,255,.14)', fontSize: 12, fontWeight: 700 }}>{h.label}: <strong>{h.value}</strong></span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The entry cards. Compact entries sit two-up; everything else stacks. */
export function ResultEntries({ data, accent }) {
  const entries = data.entries || [];
  const compact = entries.length > 0 && entries.every((e) => e.layout === 'compact');
  return (
    <div style={compact
      ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 10 }
      : { display: 'flex', flexDirection: 'column', gap: 12 }}>
      {entries.map((e, n) => <Entry key={n} e={e} n={n} accent={accent} total={entries.length} />)}
    </div>
  );
}

/* Print markup for the same template, so "Save as PDF" matches the screen. */
export function resultToHtml(data) {
  const sec = (s) => {
    const lab = s.label ? `<div class="lbl">${esc(s.label)}</div>` : '';
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    let inner = '';
    if (s.kind === 'text') inner = `<p>${inline(s.body)}</p>`;
    else if (s.kind === 'list') inner = `<${s.ordered ? 'ol' : 'ul'}>${s.items.map((x) => `<li>${inline(x)}</li>`).join('')}</${s.ordered ? 'ol' : 'ul'}>`;
    else if (s.kind === 'chips') inner = `<p>${s.items.map((x) => `<span class="chip">${esc(x)}</span>`).join(' ')}</p>`;
    else if (s.kind === 'fields') inner = s.items.map((f) => `<p><strong>${esc(f.label)}:</strong> ${inline(f.value)}</p>`).join('');
    else if (s.kind === 'script') inner = s.turns.map((t) => `<p><strong>${esc(t.speaker)}:</strong> ${inline(t.text)}</p>`).join('');
    else if (s.kind === 'scores') inner = `<ul>${s.items.map((b) => `<li><strong>${esc(b.criterion)}</strong> ${b.score}${b.outOf != null ? `/${b.outOf}` : ''}${b.comment ? ` — ${esc(b.comment)}` : ''}</li>`).join('')}</ul>`;
    return `<div class="blk">${lab}${inner}</div>`;
  };
  const meta = [data.meta?.subject, data.meta?.class, ...(data.highlights || []).map((h) => `${h.label}: ${h.value}`)].filter(Boolean).join(' · ');
  return `<h1>${esc(data.title)}</h1>${data.summary ? `<p class="sub">${esc(data.summary)}</p>` : ''}${meta ? `<p class="sub">${esc(meta)}</p>` : ''}` +
    (data.entries || []).map((e) => `<div class="card"><h2>${esc(e.title)}${e.tag ? ` <small>(${esc(e.tag)})</small>` : ''}</h2>${e.sections.map(sec).join('')}</div>`).join('');
}

export const resultFont = FONT;
